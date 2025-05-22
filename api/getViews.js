import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fetch from "node-fetch";

export default async function handler(req, res) {
  const reelUrl = req.query.url;
  if (!reelUrl) return res.status(400).json({ error: "Missing ?url" });

  const shortcode = reelUrl.match(/\/reel\/([^/]+)/)?.[1];
  if (!shortcode) return res.status(400).json({ error: "Bad reel URL" });

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36";

  /* ─────────── 1️⃣  Legacy JSON endpoint (fast & open) ─────────── */
  try {
    const url = `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`;
    const json = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://www.instagram.com/" },
    }).then((r) => r.json());

    const plays =
      json?.items?.[0]?.video_view_count ?? json?.items?.[0]?.view_count;
    if (plays != null) return res.json({ views: plays });
  } catch {
    /* ignore and keep going */
  }

  /* ─────────── 2️⃣  GraphQL backup ─────────── */
  try {
    const hash = "99c3ec9b3e879def1a2c730ea4101cf6";
    const gql =
      "https://www.instagram.com/graphql/query/" +
      `?query_hash=${hash}` +
      `&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;

    const json = await fetch(gql, {
      headers: { "User-Agent": UA, Referer: "https://www.instagram.com/" },
    }).then((r) => r.json());

    const plays = json?.data?.shortcode_media?.video_view_count;
    if (plays != null) return res.json({ views: plays });
  } catch {
    /* ignore and keep going */
  }

  /* ─────────── 3️⃣  Puppeteer last-chance ─────────── */
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "new",
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ Referer: "https://www.instagram.com/" });
    await page.setUserAgent(UA);
    await page.goto(reelUrl, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 3000)); // tiny pause

    const views = await page.evaluate(() => {
      const clean = (t) => t.replace(/[^0-9]/g, "");

      const aria = document.querySelector('span[aria-label$=" views"]');
      if (aria) return clean(aria.textContent);

      const any = [...document.querySelectorAll("*")]
        .map((el) => el.innerText)
        .find((t) => / views?$/.test(t?.trim()));
      if (any) return clean(any);

      const og = document
        .querySelector('meta[property="og:description"]')
        ?.content;
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
