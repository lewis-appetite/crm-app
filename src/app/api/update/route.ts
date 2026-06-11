import { NextRequest, NextResponse } from 'next/server';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

interface UpdatePayload {
  rowIndex: number;
  cells: { col: string; value: string }[];
}

export async function POST(req: NextRequest) {
  try {
    const { rowIndex, cells }: UpdatePayload = await req.json();

    if (!cells || cells.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const data = cells.map(({ col, value }) => ({
      range: `Connections!${col}${rowIndex}`,
      values: [[value]],
    }));

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate?key=${API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err?.error?.message || 'Sheets write error');
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
