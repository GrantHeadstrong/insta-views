/**
 * scripts/appendToSheet.js
 * ------------------------
 * Prerequisites (taken from GitHub secrets at runtime):
 *   • API_URL            – https://<your-vercel-app>.vercel.app/api/getViews
 *   • SHEET_ID           – Google-Sheet ID string
 *   • GOOGLE_CLIENT_EMAIL
 *   • GOOGLE_PRIVATE_KEY (with \n line breaks intact)
 *
 * Sheet layout:
 *   A  B  C  D  E  F                      G
 *   -----------------------------------------
 *   |       …       |  Instagram URL  | Views |
 *   | Row 2 …       |  (F2:F)         | (G2…) |
 */

import { google } from "googleapis";
import fetch from "node-fetch";

/* ──────────────────────────── 1. env vars ──────────────────────────── */
const {
  API_URL,
  SHEET_ID,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CLIENT_EMAIL,
} = process.env;

if (!API_URL || !SHEET_ID || !GOOGLE_PRIVATE_KEY || !GOOGLE_CLIENT_EMAIL) {
  throw new Error("Missing one or more required environment variables");
}

/* ───────────────────── 2. Google Sheets authentication ─────────────── */
const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), // restore real newlines
  ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

/* ───────────────────── 3. Read column F (URLs) ──────────────────────── */
const readResp = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "F2:F",
});
const urls = readResp.data.values?.flat() ?? [];

if (urls.length === 0) {
  console.log("No URLs found in column F — nothing to update.");
  process.exit(0);
}

/* ───────────────────── 4. Fetch view counts ─────────────────────────── */
const viewValues = []; // will become [["1234"], ["ERROR"], [""]] etc.

for (const url of urls) {
  // Keep row alignment if the cell is blank or not a URL
  if (!url || !url.startsWith("http")) {
    viewValues.push([""]);
    continue;
  }

  try {
    const response = await fetch(`${API_URL}?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const { views } = await response.json();
    console.log(`${url} → ${views}`);
    viewValues.push([views]);
  } catch (err) {
    console.error(`${url} failed:`, err.message);
    viewValues.push(["ERROR"]);
  }
}

/* ───────────────────── 5. Write results to column G ─────────────────── */
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `G2:G${urls.length + 1}`,
  valueInputOption: "USER_ENTERED",
  requestBody: { values: viewValues },
});

console.log(`✅  Column G updated for ${urls.length} rows.`);
