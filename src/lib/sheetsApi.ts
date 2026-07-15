// Shared read path for the Sheets API — used by any server route that needs
// raw tab data (the main /api/sheet route, and background jobs like drafting).

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

export async function fetchSheetRange(range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || 'Sheets API error');
  }
  const data = await res.json();
  return (data.values || []) as string[][];
}
