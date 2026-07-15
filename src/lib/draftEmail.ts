import { parseConnections, parseMessages, parseCampaigns, parseActivity, normalizeCompany, daysAgo, todayDMY, Contact } from '@/lib/sheets';
import { fetchSheetRange } from '@/lib/sheetsApi';
import { postToAppsScript } from '@/lib/appsScript';

export type DraftEmailResult =
  | { ok: true; skipped: false; to: string; subject: string; warnings: string[] }
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

function businessDaysAgo(dateStr: string): number | null {
  const days = daysAgo(dateStr);
  if (days === null) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let count = 0;
  const cursor = new Date(today);
  for (let i = 0; i < days; i++) {
    cursor.setDate(cursor.getDate() - 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Deterministic pre-draft warnings — computed from sheet data alone, no LLM
// needed. "Ball in their court" (reading what a reply actually committed to)
// is a separate, LLM-judgment feature layered on once Gmail thread search
// is wired in — that needs real message content, not just CRM columns.
function buildWarnings(target: Contact, colleagues: Contact[]): string[] {
  const warnings: string[] = [];

  const touchCount = (target.message ? 1 : 0) + (parseInt(target.followUps) || 0);
  if (touchCount >= 3 && !target.reply) {
    warnings.push(`${touchCount}+ touches, no reply — consider switching channel instead.`);
  }

  const bdays = businessDaysAgo(target.lastContacted);
  if (bdays !== null && bdays < 3) {
    warnings.push(`Last contacted ${target.lastContacted} (${bdays} working day${bdays === 1 ? '' : 's'} ago) — too soon?`);
  }

  if (colleagues.length > 0) {
    const summary = colleagues
      .slice(0, 5)
      .map(c => `${c.firstName} (${c.reply || (c.message ? 'sent' : 'not contacted')})`)
      .join(', ');
    warnings.push(`${colleagues.length} other contact${colleagues.length === 1 ? '' : 's'} at ${target.company}: ${summary}`);
  }

  return warnings;
}

// Drafts an email for a contact and saves it to Gmail drafts.
// `auto: true` marks it as triggered by enrichment completion (poll or webhook)
// rather than an explicit button tap — those get a same-day dedupe guard so a
// slow poll and a late-arriving webhook for the same enrichment can't both fire.
export async function draftEmailForContact(rowIndex: number, auto: boolean): Promise<DraftEmailResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { ok: false, error: 'ANTHROPIC_API_KEY is not configured' };
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

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
  const warnings = buildWarnings(target, colleagues);

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
    `You write short outreach emails for Lewis, founder of Appetite — a company that sends branded celebration cakes to B2B prospects as a creative way to open sales conversations ("cake campaigns"): a real cake with the prospect company's branding is delivered to their office, then Lewis follows up with the people there.`,
    ``,
    `Write an email from Lewis to the target contact. Rules:`,
    `- Lead with substance: a result, a specific reason for writing, or a question. NEVER open with "following up", "circling back", "just checking in", or any phrase that labels the email as a follow-up.`,
    `- Max 3 short paragraphs of 1-2 sentences each. Must be skimmable.`,
    `- One purpose per email, ending in exactly one closing question.`,
    `- Personalise from real context: their role, their company, what was actually said. No generic filler.`,
    `- Only these proof points may be used, verbatim meaning — never invent or inflate stats: "my last campaign booked meetings with 43% of my target list on day one" and "businesses adopting cold caking are booking meetings with 30% of their target accounts."`,
    `- No fake urgency or manufactured deadlines.`,
    `- Tone: casual, confident, light cake wordplay allowed but max one pun.`,
    `- Don't invent facts, meetings, or interest that isn't in the context.`,
    `- Sign off exactly: "Best,\\nLewis"`,
    ``,
    `Subject should be short and lowercase, referencing the cake or their office where natural. Call the write_email tool with the finished subject and body — body should have real line breaks between paragraphs.`,
  ].join('\n');

  // Forced tool use instead of "reply with JSON in text" - guarantees a real
  // parsed object back from the API, so a stray unescaped character in the
  // body can never silently produce a blank draft the way regex/JSON.parse
  // extraction from free text did.
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: context }],
      tools: [
        {
          name: 'write_email',
          description: 'Save the drafted email',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Short, lowercase email subject' },
              body: { type: 'string', description: 'The full email body, with real line breaks between paragraphs' },
            },
            required: ['subject', 'body'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'write_email' },
    }),
  });

  const anthropicJson = await anthropicRes.json();
  if (!anthropicRes.ok) {
    return { ok: false, error: anthropicJson?.error?.message || `Anthropic API responded ${anthropicRes.status}` };
  }

  const toolUse = anthropicJson.content?.find((b: { type: string }) => b.type === 'tool_use');
  const subject: string = toolUse?.input?.subject?.trim() || '';
  const body: string = toolUse?.input?.body?.trim() || '';
  if (!subject || !body) {
    return { ok: false, error: 'Model returned an incomplete draft (missing subject or body)' };
  }

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

  return { ok: true, skipped: false, to: target.email, subject, warnings };
}
