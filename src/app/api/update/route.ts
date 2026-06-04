import { NextRequest, NextResponse } from 'next/server';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY!;

interface UpdatePayload {
  rowIndex: number;
  action: 'contacted' | 'dead' | 'visited';
  date: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: UpdatePayload = await req.json();
    const { rowIndex, action, date } = body;

    const updates: { range: string; values: string[][] }[] = [];

    if (action === 'contacted') {
      // Update Last Contacted (col L = index 12)
      updates.push({
        range: `Connections!L${rowIndex}`,
        values: [[date]],
      });
    } else if (action === 'dead') {
      // Update Reply? col (col I = index 9) to "Dead lead"
      updates.push({
        range: `Connections!I${rowIndex}`,
        values: [['Dead lead']],
      });
    } else if (action === 'visited') {
      // Just update Last Contacted when LinkedIn link is tapped
      updates.push({
        range: `Connections!L${rowIndex}`,
        values: [[date]],
      });
    }

    if (updates.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate?key=${API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updates,
      }),
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
