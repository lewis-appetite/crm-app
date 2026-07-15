// Shared low-level poster to the Apps Script web app — every server-side
// write path (cell updates, activity log, campaign upserts, Gmail drafts)
// goes through this so the "did it actually work" check lives in one place.

export interface AppsScriptPayload {
  rowIndex?: number;
  cells?: { col: string; value: string }[];
  log?: {
    date: string;
    rowIndex: number;
    name: string;
    company: string;
    action: string;
    template: string;
    detail: string;
  };
  campaign?: { company: string; status?: string; notes?: string };
  draft?: { to: string; subject: string; body: string };
}

export async function postToAppsScript(payload: AppsScriptPayload): Promise<void> {
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!scriptUrl) throw new Error('GOOGLE_APPS_SCRIPT_URL is not configured');

  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });

  // Apps Script returns 200 with an HTML error page when the script throws,
  // so any non-JSON body means the write failed
  const text = await res.text();
  let scriptOk = false;
  try { JSON.parse(text); scriptOk = true; } catch { /* HTML error page */ }
  if (!res.ok || !scriptOk) {
    throw new Error(`Apps Script responded ${res.status}: ${text.slice(0, 200)}`);
  }
}
