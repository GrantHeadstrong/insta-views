import chromium from "@sparticuz/chromium";
const puppeteer = await import("puppeteer-core");

export default async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Need ?url param");

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: "new",
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25_000 });

    const views = await page.$eval(
      'span[aria-label$=" views"]',
      (el) => +el.textContent.replace(/[^0-9]/g, "")
    );

    res.json({ views });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await browser.close();
  }
};
