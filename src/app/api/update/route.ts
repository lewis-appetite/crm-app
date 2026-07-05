import { NextRequest, NextResponse } from 'next/server';

interface LogEntry {
  date: string;
  rowIndex: number;
  name: string;
  company: string;
  action: string;
  template: string;
  detail: string;
}

interface UpdatePayload {
  rowIndex: number;
  cells: { col: string; value: string }[];
  log?: LogEntry;
}

export async function POST(req: NextRequest) {
  try {
    const { rowIndex, cells, log }: UpdatePayload = await req.json();
    if ((!cells || cells.length === 0) && !log) {
      return NextResponse.json({ ok: true });
    }
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL!;
    const res = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, cells: cells ?? [], log }),
      redirect: 'follow',
    });
    // Apps Script returns 200 with an HTML error page when the script throws,
    // so any non-JSON body means the write failed
    const text = await res.text();
    let scriptOk = false;
    try { JSON.parse(text); scriptOk = true; } catch { /* HTML error page */ }
    if (!res.ok || !scriptOk) {
      throw new Error(`Script responded with ${res.status}: ${text.slice(0, 200)}`);
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
