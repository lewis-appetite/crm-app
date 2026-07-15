import { parseConnections, parseMessages, parseCampaigns, parseActivity, normalizeCompany, daysAgo, todayDMY, Contact } from '@/lib/sheets';
import { fetchSheetRange } from '@/lib/sheetsApi';
import { postToAppsScript } from '@/lib/appsScript';

export type DraftEmailResult =
  | { ok: true; skipped: false; to: string; subject: string }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

function contactHistory(c: Contact, templateText: Record<string, string>): string {
  const touches: string[] = [];
  if (c.message) touches.push(`initial LinkedIn message ("${c.message}"${templateText[c.message] ? `: ${templateText[c.message].slice(0, 120)}` : ''})`);
  if (c.followUpMessage1) touches.push(`follow-up 1 ("${c.followUpMessage1}")`);
  if (c.followUpMessage2) touches.push(`follow-up 2 ("${c.followUpMessage2}")`);
  const days = daysAgo(c.lastContacted);
  const parts = [
    `${c.fullName} (${c.position || 'unknown role'})`,
    touches.length ? `sent: ${touches.join(', ')}` : 'not yet contacted',
    c.lastContacted ? `last contacted ${days !== null ? `${days} days ago` : c.lastContacted}` : '',
    c.reply ? `reply status: ${c.reply}` : 'no reply',
    c.comment ? `notes: ${c.comment}` : '',
  ].filter(Boolean);
  return '- ' + parts.join(' | ');
}

// Drafts an email for a contact and saves it to Gmail drafts.
// `auto: true` marks it as triggered by enrichment completion (poll or webhook)
// rather than an explicit button tap — those get a same-day dedupe guard so a
// slow poll and a late-arriving webhook for the same enrichment can't both fire.
export async function draftEmailForContact(rowIndex: number, auto: boolean): Promise<DraftEmailResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { ok: false, error: 'OPENAI_API_KEY is not configured' };
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const [connectionRows, messageRows, campaignRows, activityRows] = await Promise.all([
    fetchSheetRange('Connections'),
    fetchSheetRange('Messages'),
    fetchSheetRange('Campaigns').catch(() => [] as string[][]),
    fetchSheetRange('Activity').catch(() => [] as string[][]),
  ]);
  const contacts = parseConnections(connectionRows);
  const messages = parseMessages(messageRows);
  const campaigns = parseCampaigns(campaignRows);
  const activity = parseActivity(activityRows);

  const target = contacts.find(c => c.rowIndex === rowIndex);
  if (!target) return { ok: false, error: `No contact at row ${rowIndex}` };
  if (!target.email) return { ok: false, error: `${target.fullName} has no email on record` };

  if (auto) {
    const today = todayDMY();
    const alreadyDrafted = activity.some(
      a => a.rowIndex === rowIndex && a.action === 'emaildraft' && a.detail === 'auto' && a.date === today
    );
    if (alreadyDrafted) {
      return { ok: true, skipped: true, reason: 'already auto-drafted today' };
    }
  }

  const templateText: Record<string, string> = {};
  messages.forEach(m => { templateText[m.abbreviation] = m.fullMessage; });

  const companyKey = normalizeCompany(target.company);
  const colleagues = contacts.filter(
    c => normalizeCompany(c.company) === companyKey && c.rowIndex !== target.rowIndex && (c.message || c.reply)
  );
  const campaign = campaigns.find(c => normalizeCompany(c.company) === companyKey);

  const context = [
    `TARGET CONTACT:`,
    contactHistory(target, templateText),
    ``,
    `COMPANY: ${target.company}`,
    campaign ? `Cake campaign status: ${campaign.status}${campaign.cakeSentDate ? ` (cake sent ${campaign.cakeSentDate})` : ''}${campaign.notes ? ` — notes: ${campaign.notes}` : ''}` : 'No cake campaign for this company.',
    ``,
    `OTHER PEOPLE I'VE CONTACTED AT ${target.company.toUpperCase()}:`,
    colleagues.length ? colleagues.map(c => contactHistory(c, templateText)).join('\n') : '- none yet',
  ].join('\n');

  const systemPrompt = [
    `You write short outreach emails for Lewis, founder of Appetite — a company that sends branded celebration cakes to B2B prospects as a creative way to open sales conversations. Lewis runs "cake campaigns": a real cake with the prospect company's branding is delivered to their office, then Lewis follows up with the people there.`,
    ``,
    `Write a first email from Lewis to the target contact. Rules:`,
    `- 50-110 words. Short sentences. Warm, direct, zero corporate filler.`,
    `- Use the company context: if a cake was sent, reference it naturally. If colleagues were contacted or replied, weave that in ONLY if it helps ("I've been chatting with X on your team...") — never guilt-trip about ignored messages.`,
    `- Don't invent facts, meetings, or interest that isn't in the context.`,
    `- One clear ask: a quick call or a pointer to the right person.`,
    `- Sign off "Lewis".`,
    ``,
    `Return ONLY valid JSON: {"subject": "...", "body": "..."} — body uses \\n for line breaks.`,
  ].join('\n');

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ],
    }),
  });

  const openaiJson = await openaiRes.json();
  if (!openaiRes.ok) {
    return { ok: false, error: openaiJson?.error?.message || `OpenAI API responded ${openaiRes.status}` };
  }

  const raw: string = openaiJson.choices?.[0]?.message?.content ?? '';
  let subject = `Quick one — ${target.company}`;
  let body = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.subject) subject = parsed.subject;
    if (parsed.body) body = parsed.body;
  } catch { /* fall back to raw text as body */ }

  await postToAppsScript({
    draft: { to: target.email, subject, body },
    log: {
      date: todayDMY(),
      rowIndex,
      name: target.fullName,
      company: target.company,
      action: 'emaildraft',
      template: subject,
      detail: auto ? 'auto' : 'manual',
    },
  });

  return { ok: true, skipped: false, to: target.email, subject };
}
