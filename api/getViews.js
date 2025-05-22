import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fetch from "node-fetch";

export default async function handler(req, res) {
  /* ───────────────── Input check ───────────────── */
  const reelUrl = req.query.url;
  if (!reelUrl)
    return res.status(400).json({ error: "Missing ?url=https://…" });

  /* ─────────────── 1️⃣  Fast path – IG GraphQL ─────────────── */
  try {
    const shortcode = reelUrl.match(/\/reel\/([^/]+)/)?.[1];
    if (!shortcode) throw new Error("Bad reel URL");

    const gql = `https://www.instagram.com/graphql/query/` +
      `?query_hash=7d9519a04da32efc7c6073d3cdcb93bf` +
      `&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;

    const json = await fetch(gql, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.instagram.com/" }
    }).then(r => r.json());

    const plays = json?.data?.shortcode_media?.video_view_count;
    if (plays != null) return res.json({ views: plays });
  } catch (_) {
    /* fall through to Puppeteer */
  }

  /* ─────────────── 2️⃣  Fallback – headless Chrome ─────────────── */
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "new",
      defaultViewport: { width: 1280, height: 720 }
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ Referer: "https://www.instagram.com/" });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    await page.goto(reelUrl, { waitUntil: "domcontentloaded" });

    /* Wait until IG’s meta description appears (safer than fixed timeout) */
    await page.waitForSelector('meta[property="og:description"]', { timeout: 10000 });

    const views = await page.evaluate(() => {
      const clean = t => t.replace(/[^0-9]/g, "");

      /* a) aria-label selector */
      const aria = document.querySelector('span[aria-label$=" views"]');
      if (aria) return clean(aria.textContent);

      /* b) any element whose text ends with “ views” */
      const any = [...document.querySelectorAll("*")]
        .map(el => el.innerText)
        .find(t => / views?$/.test(t?.trim()));
      if (any) return clean(any);

      /* c) og:description meta tag */
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
