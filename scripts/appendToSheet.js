import { google } from "googleapis";
import fetch from "node-fetch";

const {
  API_URL,
  SHEET_ID,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CLIENT_EMAIL,
  REEL_URL,
} = process.env;

const auth = new google.auth.JWT(
  GOOGLE_CLIENT_EMAIL,
  null,
  GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);
const sheets = google.sheets({ version: "v4", auth });

const { views } = await fetch(`${API_URL}?url=${REEL_URL}`).then((r) =>
  r.json()
);

await sheets.spreadsheets.values.append({
  spreadsheetId: SHEET_ID,
  range: "A1",
  valueInputOption: "USER_ENTERED",
  requestBody: { values: [[new Date().toISOString(), views]] },
});
console.log("Logged", views);
