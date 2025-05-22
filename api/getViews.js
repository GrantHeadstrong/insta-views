import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const reelUrl = req.query.url;
  if (!reelUrl)
    return res.status(400).json({ error: "Missing ?url=https://…" });

  /* ───────────── 1️⃣  Fast path — GraphQL ───────────── */
  try {
    const shortcode = reelUrl.match(/\/reel\/([^/]+)/)?.[1];
    if (!shortcode) throw new Error("Bad reel URL");

    const gql =
      "https://www.instagram.com/graphql/query/" +
      "?query_hash=99c3ec9b3e879def1a2c730ea4101cf6" +
      "&variables=" +
      encodeURIComponent(JSON.stringify({ shortcode }));

    const json = await fetch(gql, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.instagram.com/",
      },
    }).then((r) => r.json());

    const plays = json?.data?.shortcode_media?.video_view_count;
    if (plays != null) return res.json({ views: plays });
  } catch (_) {
    /* fall through to Puppeteer */
  }

  /* ───────────── 2️⃣  Fallback — headless Chrome ───────────── */
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "new",
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      Referer: "https://www.instagram.com/",
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    );
    await page.goto(reelUrl, { waitUntil: "domcontentloaded" });

    /* Give lazy JS a moment but don’t hard-error if selector missing */
    await page.waitForTimeout(3000);

    const views = await page.evaluate(() => {
      const clean = (t) => t.replace(/[^0-9]/g, "");

      /* a) JSON inside <script id="__NEXT_DATA__"> (if present) */
      try {
        const jsonTxt =
          document.querySelector("#__NEXT_DATA__")?.textContent;
        if (jsonTxt) {
          const data = JSON.parse(jsonTxt);
          const count =
            data.props?.pageProps?.graphql?.shortcode_media
              ?.video_view_count;
          if (count != null) return clean(String(count));
        }
      } catch (_) {}

      /* b) aria-label selector */
      const aria = document.querySelector('span[aria-label$=" views"]');
      if (aria) return clean(aria.textContent);

      /* c) any element whose text ends with “ views” */
      const any = [...document.querySelectorAll("*")]
        .map((el) => el.innerText)
        .find((t) => / views?$/.test(t?.trim()));
      if (any) return clean(any);

      /* d) og:description meta tag */
      const og = document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content");
      const m = og?.match(/ ([0-9.,]+) views?/);
      if (m) return clean(m[1]);

      return "N/A";
    });

    await browser.close();
    return res.json({ views });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Puppeteer error: " + err.toString() });
  }
}
