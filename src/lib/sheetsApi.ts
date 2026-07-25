// Shared read path for the Sheets API — used by any server route that needs
// raw tab data (the main /api/sheet route, and background jobs like drafting).

import { buildConnectionsColumnMap } from '@/lib/sheets';

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

// For routes that only need to resolve a column letter (e.g. writing a
// single cell) without pulling the whole Connections tab.
export async function resolveConnectionsColumn(field: string): Promise<string> {
  const headerRow = await fetchSheetRange('Connections!1:1');
  const letter = buildConnectionsColumnMap(headerRow[0] || []).letter[field];
  if (!letter) throw new Error(`Connections tab has no "${field}" column`);
  return letter;
}
