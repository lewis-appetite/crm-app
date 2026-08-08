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
  campaign?: { company: string; status?: string; notes?: string; focus?: boolean };
  draft?: { to: string; subject: string; body: string; threadId?: string };
  gmailSearch?: { targetEmail: string; companyDomain?: string };
  batch?: { rowIndex: number; cells: { col: string; value: string }[] }[];
  deleteRows?: { rowIndex: number; firstName: string; lastName: string }[];
  addProspects?: {
    company: string;
    websiteUrl?: string;
    companyLinkedinUrl?: string;
    industry?: string;
    companySize?: string;
    fundingStage?: string;
    location?: string;
    outboundEvidence?: string;
    recentNews?: string;
    fitRating?: string;
    reasoning?: string;
    contactName?: string;
    position?: string;
    url?: string;
    status?: string;
    dateAdded?: string;
  }[];
  prospect?: {
    company: string; // applies to every row for this company
    status?: string;
    rejectionReason?: string;
    channel?: string;
    address?: string;
    addressConfirmedBy?: string;
    dateReviewed?: string;
  };
  experiment?: {
    testId: string;
    name?: string;
    stage?: string;
    variantA?: string;
    variantB?: string;
    status?: string;
    started?: string;
    ended?: string;
    winner?: string;
    notes?: string;
  };
}

export async function postToAppsScript(payload: AppsScriptPayload): Promise<unknown> {
  return callAppsScript(payload);
}

// For request types that return real data (currently just gmailSearch) rather
// than the generic { ok: true } write acknowledgement.
export async function fetchFromAppsScript<T>(payload: AppsScriptPayload): Promise<T> {
  return callAppsScript(payload) as Promise<T>;
}

async function callAppsScript(payload: AppsScriptPayload): Promise<unknown> {
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
  let json: unknown;
  try { json = JSON.parse(text); } catch { /* HTML error page */ }
  if (!res.ok || json === undefined) {
    throw new Error(`Apps Script responded ${res.status}: ${text.slice(0, 200)}`);
  }
  return json;
}
