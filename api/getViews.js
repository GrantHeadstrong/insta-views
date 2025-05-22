import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const reelUrl = req.query.url;
  if (!reelUrl) return res.status(400).json({ error: "Missing ?url param" });

  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36";

  /* ───────────── 1️⃣  Fast path — Instagram GraphQL ───────────── */
  try {
    const shortcode = reelUrl.match(/\/reel\/([^/]+)/)?.[1];
    if (!shortcode) throw new Error("Bad reel URL");

    /* Two known hashes that return video_view_count (checked May-2025) */
    const hashes = [
      "99c3ec9b3e879def1a2c730ea4101cf6",
      "7d9519a04da32efc7c6073d3cdcb93bf",
    ];

    for (const hash of hashes) {
      const gql =
        "https://www.instagram.com/graphql/query/" +
        `?query_hash=${hash}` +
        `&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;

      const json = await fetch(gql, {
        headers: { "User-Agent": userAgent, Referer: "https://www.instagram.com/" },
      }).then((r) => r.json());

      const plays = json?.data?.shortcode_media?.video_view_count;
      if (plays != null) return res.json({ views: plays });
    }
  } catch {
    /* ignore and fall through */
  }

  /* ───────────── 2️⃣  Second path — raw HTML regex ───────────── */
  try {
    const html = await fetch(reelUrl, {
      headers: { "User-Agent": userAgent, Referer: "https://www.instagram.com/" },
    }).then((r) => r.text());

    const m = html.match(/"video_view_count":\s*([0-9]+)/);
    if (m) return res.json({ views: Number(m[1]) });
  } catch {
    /* ignore and fall through */
  }

  /* ───────────── 3️⃣  Final fallback — headless Chrome ───────────── */
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "new",
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ Referer: "https://www.instagram.com/" });
    await page.setUserAgent(userAgent);
    await page.goto(reelUrl, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 3000)); // brief pause for lazy JS

    const views = await page.evaluate(() => {
      const clean = (t) => t.replace(/[^0-9]/g, "");

      /* a) JSON in ld+json tag */
      try {
        const ld = document.querySelector('script[type="application/ld+json"]')
          ?.innerText;
        if (ld) {
          const obj = JSON.parse(ld);
          const cnt = obj?.interactionStatistic?.userInteractionCount;
          if (cnt) return clean(String(cnt));
        }
      } catch {}

      /* b) aria-label selector */
      const aria = document.querySelector('span[aria-label$=" views"]');
      if (aria) return clean(aria.textContent);

      /* c) any element ending with “ views” */
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
    return res.status(500).json({ error: err.toString() });
  }
}
