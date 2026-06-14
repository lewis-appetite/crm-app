import { NextRequest, NextResponse } from 'next/server';

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
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL!;
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, cells }),
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`Script responded with ${res.status}`);
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
