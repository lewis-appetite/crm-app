import { parseConnections, parseMessages, parseCampaigns, parseActivity, normalizeCompany, daysAgo, businessDaysAgo, todayDMY, Contact, followUpMessages } from '@/lib/sheets';
import { fetchSheetRange, resolveConnectionsColumn } from '@/lib/sheetsApi';
import { fetchFromAppsScript } from '@/lib/appsScript';

export type DraftEmailResult =
  | { ok: true; skipped: false; to: string; subject: string; warnings: string[] }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

interface GmailMessageSummary {
  date: string;
  from: string;
  direction: 'sent' | 'received';
  body: string;
}

interface GmailThreadSummary {
  threadId: string;
  subject: string;
  isTargetThread: boolean;
  messages: GmailMessageSummary[];
}

function contactHistory(c: Contact, templateText: Record<string, string>): string {
  const touches: string[] = [];
  if (c.message) touches.push(`initial LinkedIn message ("${c.message}"${templateText[c.message] ? `: ${templateText[c.message].slice(0, 120)}` : ''})`);
  followUpMessages(c).forEach((abbr, i) => touches.push(`follow-up ${i + 1} ("${abbr}")`));
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

// Deterministic pre-draft warnings — computed from sheet data alone.
// "Ball in their court" is a separate, LLM-judgment warning added after the
// drafting call, since it requires reading actual email content.
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

function formatGmailThreads(threads: GmailThreadSummary[], targetEmail: string): { targetThreadId: string | null; text: string } {
  const formatThread = (t: GmailThreadSummary) =>
    [
      `Subject: "${t.subject}"`,
      ...t.messages.map(m => `  [${m.direction}, ${m.date}] ${m.from}: ${m.body.replace(/\s+/g, ' ').trim()}`),
    ].join('\n');

  if (threads.length === 0) {
    return { targetThreadId: null, text: 'No prior email history found for this contact or company.' };
  }

  const targetThread = threads.find(t => t.isTargetThread) ?? null;
  const colleagueThreads = threads.filter(t => !t.isTargetThread);

  const parts: string[] = [];
  parts.push(
    targetThread
      ? `PAST EMAIL THREAD WITH ${targetEmail} (draft as a reply to this):\n${formatThread(targetThread)}`
      : `No prior email thread with ${targetEmail} directly — this will be a new email, not a reply.`
  );
  if (colleagueThreads.length) {
    parts.push('', `EMAIL THREADS WITH OTHER PEOPLE AT THIS COMPANY:`, colleagueThreads.map(formatThread).join('\n\n'));
  }

  return { targetThreadId: targetThread?.threadId ?? null, text: parts.join('\n') };
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

  // Best-effort — a Gmail search failure shouldn't block drafting, it just
  // means the draft falls back to CRM-only context (LinkedIn touches, replies).
  let gmailThreads: GmailThreadSummary[] = [];
  const emailDomain = target.email.split('@')[1];
  try {
    const result = await fetchFromAppsScript<{ threads: GmailThreadSummary[] }>({
      gmailSearch: { targetEmail: target.email, companyDomain: emailDomain },
    });
    gmailThreads = result.threads ?? [];
  } catch (err) {
    console.error('Gmail context search failed, continuing without it', err);
  }
  const { targetThreadId, text: gmailContextText } = formatGmailThreads(gmailThreads, target.email);

  // Diagnostic: threads exist at this company but none matched the target's
  // exact email — most likely the address on file differs from whatever
  // address the real prior thread actually used (alias, typo, reformatting).
  if (gmailThreads.length > 0 && !targetThreadId) {
    warnings.push(
      `Found ${gmailThreads.length} email thread(s) at ${target.company} but none matched ${target.email} directly — created a new email instead of a reply.`
    );
  }

  const context = [
    `TARGET CONTACT:`,
    contactHistory(target, templateText),
    ``,
    `COMPANY: ${target.company}`,
    campaign ? `Cake campaign status: ${campaign.status}${campaign.cakeSentDate ? ` (cake sent ${campaign.cakeSentDate})` : ''}${campaign.notes ? ` — notes: ${campaign.notes}` : ''}` : 'No cake campaign for this company.',
    ``,
    `OTHER PEOPLE I'VE CONTACTED AT ${target.company.toUpperCase()} (per CRM, LinkedIn-side):`,
    colleagues.length ? colleagues.map(c => contactHistory(c, templateText)).join('\n') : '- none yet',
    ``,
    `EMAIL HISTORY (from Gmail):`,
    gmailContextText,
  ].join('\n');

  const systemPrompt = [
    `You write short outreach emails for Lewis, founder of Appetite — a company that sends branded celebration cakes to B2B prospects as a creative way to open sales conversations ("cake campaigns"): a real cake with the prospect company's branding is delivered to their office, then Lewis follows up with the people there.`,
    ``,
    `Write an email from Lewis to the target contact. Rules:`,
    `- Lead with substance: a result, a specific reason for writing, or a question. NEVER open with "following up", "circling back", "just checking in", or any phrase that labels the email as a follow-up.`,
    `- Max 3 short paragraphs of 1-2 sentences each. Must be skimmable.`,
    `- One purpose per email, ending in exactly one closing question.`,
    `- Personalise from real context: their role, their company, what was actually said in prior LinkedIn messages or emails. No generic filler.`,
    `- If EMAIL HISTORY shows a past thread with this contact, this is a reply — reference what was actually said, don't reintroduce yourself or the cake concept from scratch.`,
    `- Only these proof points may be used, verbatim meaning — never invent or inflate stats: "my last campaign booked meetings with 43% of my target list on day one" and "businesses adopting cold caking are booking meetings with 30% of their target accounts."`,
    `- No fake urgency or manufactured deadlines.`,
    `- Tone: casual, confident, light cake wordplay allowed but max one pun.`,
    `- Don't invent facts, meetings, or interest that isn't in the context.`,
    `- Sign off exactly: "Best,\\nLewis"`,
    ``,
    `Subject should be short and lowercase, referencing the cake or their office where natural (skip this if replying in an existing thread — it's ignored for replies).`,
    ``,
    `Also judge from EMAIL HISTORY: if the target's own last message committed to an action ("I'll check with X", "let me get back to you", "I'll loop in Y"), set ballInTheirCourt=true with a one-sentence note on what they owe — this doesn't change what you write, it's a separate heads-up.`,
    ``,
    `Call the write_email tool with the finished draft.`,
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
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: 'user', content: context }],
      tools: [
        {
          name: 'write_email',
          description: 'Save the drafted email',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Short, lowercase email subject (ignored if replying in an existing thread)' },
              body: { type: 'string', description: 'The full email body, with real line breaks between paragraphs' },
              ballInTheirCourt: { type: 'boolean', description: 'True if their last message committed to an action they still owe' },
              ballInTheirCourtNote: { type: 'string', description: 'One sentence on what they owe, if ballInTheirCourt is true' },
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

  if (toolUse?.input?.ballInTheirCourt) {
    const note = toolUse.input.ballInTheirCourtNote?.trim();
    warnings.push(note ? `Ball's in their court — ${note}` : `They may already owe you a reply — check before chasing.`);
  }

  // Drafting counts as touching the contact today - Lewis treats a created
  // draft as good as sent, so the follow-up cadence shouldn't still think
  // they're overdue once it's sitting in Gmail.
  const lastContactedCol = await resolveConnectionsColumn('lastContacted');

  const draftResponse = await fetchFromAppsScript<{ draftMode: string | null; draftReplyError: string | null }>({
    rowIndex,
    cells: [{ col: lastContactedCol, value: todayDMY() }],
    draft: { to: target.email, subject, body, ...(targetThreadId ? { threadId: targetThreadId } : {}) },
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

  if (targetThreadId && draftResponse.draftMode !== 'reply') {
    warnings.push(
      draftResponse.draftReplyError
        ? `Couldn't reply in the existing thread (${draftResponse.draftReplyError}) — created a new email instead.`
        : `Couldn't reply in the existing thread — created a new email instead.`
    );
  }

  return { ok: true, skipped: false, to: target.email, subject, warnings };
}
