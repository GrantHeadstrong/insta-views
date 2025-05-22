import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fetch from "node-fetch";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36";
const IG_COOKIE = process.env.IG_SESSIONID
  ? `sessionid=${process.env.IG_SESSIONID}`
  : "";

export default async function handler(req, res) {
  const reelUrl = req.query.url;
  const shortcode = reelUrl?.match(/\/reel\/([^/]+)/)?.[1];
  if (!shortcode)
    return res.status(400).json({ error: "Bad or missing ?url" });

  /* 1️⃣  Cookie-aware JSON endpoint (fast, works behind login wall) */
  try {
    const url = `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`;
    const data = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: IG_COOKIE },
    }).then((r) => r.json());

    const views =
      data?.items?.[0]?.video_view_count ??
      data?.items?.[0]?.view_count ??
      null;
    if (views != null) return res.json({ views });
  } catch { /* fall through */ }

  /* 2️⃣  GraphQL backup (also sends cookie) */
  try {
    const hash = "99c3ec9b3e879def1a2c730ea4101cf6";
    const gql =
      "https://www.instagram.com/graphql/query/" +
      `?query_hash=${hash}` +
      `&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;

    const data = await fetch(gql, {
      headers: { "User-Agent": UA, Cookie: IG_COOKIE },
    }).then((r) => r.json());

    const views = data?.data?.shortcode_media?.video_view_count;
    if (views != null) return res.json({ views });
  } catch { /* fall through */ }

  /* 3️⃣  Last-chance Puppeteer */
  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "new",
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    if (IG_COOKIE) {
      const [name, value] = IG_COOKIE.split("=");
      await page.setCookie({
        name,
        value,
        domain: ".instagram.com",
        path: "/",
      });
    }
    await page.goto(reelUrl, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 3000));

    const views = await page.evaluate(() => {
      const clean = (t) => t.replace(/[^0-9]/g, "");
      const n = [...document.querySelectorAll("*")]
        .map((el) => el.innerText)
        .find((t) => / views?$/.test(t?.trim()));
      return n ? clean(n) : "N/A";
    });

    await browser.close();
    return res.json({ views });
  } catch (e) {
    return res.status(500).json({ error: e.toString() });
  }
}
