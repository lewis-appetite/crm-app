# CRM App — Claude Context

## What This Is

A personal LinkedIn outreach CRM. A Next.js 14 app that uses **Google Sheets as the database**. The workflow: connect with people on LinkedIn → send an initial message → follow up after an interval → track replies.

## Tech Stack

- Next.js 14 (App Router), React 18, TypeScript
- Google Sheets API (read + write) — no traditional DB
- CSS Modules
- Hosted locally / dev server

## Data Model

Three Google Sheets tabs:

### Connections tab (one row per contact)
| Col | Letter | Field |
|-----|--------|-------|
| 0 | A | First Name |
| 1 | B | Last Name |
| 2 | C | LinkedIn URL |
| 3 | D | Company |
| 4 | E | Position |
| 5 | F | List |
| 6 | G | Function |
| 7 | H | Connected On |
| 8 | I | Message (abbreviation of initial message sent) |
| 9 | J | Reply (status: "Interested", "Dead lead", "Not interested", etc.) |
| 10 | K | Follow Ups (count) |
| 11 | L | Follow Up Message 1 (abbreviation of follow-up template used) |
| 12 | M | Follow Up Message 2 (abbreviation of second follow-up template used) |
| 13 | N | Last Contacted (date, DD/MM/YYYY) |
| 14 | O | Comment |
| 15 | P | Email |
| 16 | Q | Phone |
| 17 | R | Call booked (date, DD/MM/YYYY — set by the Today tab's "Meeting booked" action; graduates the contact out of both Today queues) |
| 18 | S | Priority — app-written label ("🎂 Cake" / "🔥 Interested" / blank) so the reason a contact is being tracked closely is visible directly in the sheet, not just in Today. See `computePriorityLabel` |

Columns are mapped by position in `src/lib/sheets.ts` (COL) — new columns must be APPENDED (S, T, …), never inserted mid-sheet. All date columns display DD/MM/YYYY; the app parses displayed values, so never change that display format. Cols I/L/M have sheet-side dropdown validation fed from Messages!C (warning mode, not reject — reject would break Apps Script writes).

### Messages tab (one row per template)
| Col | Field |
|-----|-------|
| 0 | Message Type |
| 1 | Target |
| 2 | Abbreviation (short code used in Connections sheet) |
| 3 | Full Message text |

### Activity tab (append-only log, one row per action)
| Col | Field |
|-----|-------|
| A | Date (DD/MM/YYYY) |
| B | Row (Connections rowIndex) |
| C | Name |
| D | Company |
| E | Action (`new` / `followup1` / `followup2` / `followup3` / `reply`) |
| F | Template abbreviation |
| G | Detail (reply value for `reply` actions) |

Appended by the Apps Script on writes (see `apps-script/Code.gs`). Exists because Last Contacted is overwritten on each touch — the log makes streaks/weekly stats permanent history. `getStats` merges log events with lastContacted-derived events (log wins on same contact+day) so pre-log history still counts. Other actions logged: `snooze` (detail = reappear date, read by `getActiveSnoozes`), `emaildraft` (detail = auto/manual, drives auto-draft dedupe), `callbooked`.

### Campaigns tab (cake-campaign pipeline)
| Col | Field |
|-----|-------|
| A | Company (matched to Connections via `normalizeCompany`) |
| B | Status — lifecycle stages mirroring the Appetite platform: `Planned` / `Delivered` / `Reply` / `Meeting` / `Pipeline` / `Closed Won` / `Closed Lost` |
| C | Cake sent (date — auto-stamped by the Apps Script on first transition to Delivered) |
| D | Notes |

Legacy statuses still work by keyword: anything containing closed/won/lost/dead is closed, containing planned is planned, everything else (e.g. old "Cake sent" values) is active. Managed from the Today tab's Manage companies panel (stage dropdown per company).

## Key Logic (`src/lib/sheets.ts`)

**Today queue** (`getTodayQueue`) — two cadence-based tiers, grouped by company, excluding dead contacts, snoozed contacts, and anyone with Call booked set:
- **Tier 1 (🎂)**: contacts at active campaign companies (Delivered/Reply/Meeting/Pipeline). Due when never touched or ≥ `CAKE_TOUCH_DAYS` (default 3) **working** days since last touch. Within a company, positive-reply contacts sort first.
- **Tier 2 (🔥)**: `Reply` = Interested/Yes anywhere else. Due when ≥ `HOT_TOUCH_DAYS` (default 2) calendar days since last touch.

**Priority column sync** — `computePriorityLabel` mirrors the tier logic above but without the cadence gating (it's "why track this contact" not "due today", so it doesn't need daily rewrites). Written to col S whenever the underlying reason could have changed: `POST /api/sync-priority` (`{ company }`) recomputes and batch-writes every contact at that company after a campaign stage change; single-contact Reply changes (Today tab, All tab) write col S inline in the same request. `apps-script/Code.gs backfillPriorityColumn()` is the one-time initializer for existing rows.

**Follow-up queue** — contacts where:
- `message` is set (initial message was sent)
- Not dead (`reply` not in: dead lead, not interested, blocked, gone cold)
- Not `reply === "interested"`
- `daysAgo(lastContacted) >= FOLLOW_UP_INTERVAL_DAYS`
- Sorted: contacts with no follow-up message yet first, then oldest last-contacted

**New contacts queue** — contacts where:
- `message` is empty AND `lastContacted` is empty AND not dead

**AI suggestion** — for a given contact, looks at contacts with similar role/function, finds the template abbreviation with the highest reply rate (min 2 data points), returns it with a reply rate %.

## API Routes

- `GET /api/sheet` — fetches Connections + Messages + Activity tabs, returns `{ followUps, newContacts, messages, allContacts, activity, intervalDays, dailyNewGoal }`
- `POST /api/update` — forwards `{ rowIndex, cells, log? }` to the Apps Script web app, which updates Connections cells and appends `log` to the Activity tab
- `GET /api/cake-images` — lists PNGs from the cake designs Drive folder, cached 300s
- `POST /api/enrich` — starts a FullEnrich email lookup (registers a webhook + the contact's rowIndex as a `custom` field), returns `enrichmentId`. `GET /api/enrich?id=&rowIndex=` polls it; on `FINISHED` it writes the email to col P and triggers an auto-draft itself (fast path for when the client is still around)
- `POST /api/enrich/webhook` — FullEnrich calls this on `contact_finished`, independent of client polling. Verifies `X-Signature-SHA1` (HMAC-SHA1 of the raw body, `FULLENRICH_API_KEY` as secret) before trusting the payload. Same write + auto-draft path as the GET poll — this is what makes enrichment survive the phone locking or the tab closing mid-lookup
- `POST /api/draft-email` — `{ rowIndex }`: manual draft trigger (button tap), always drafts regardless of same-day history. Both this and the auto-draft path share `src/lib/draftEmail.ts`, which builds context from two sources — the CRM sheet (same-company contacts, templates, replies, campaign notes) and Gmail itself (searches the target's own thread plus anyone `@company-domain` via `GmailApp.search` in the Apps Script, last 3 messages per thread, ~15 messages total) — then asks Anthropic (`ANTHROPIC_MODEL`, default `claude-sonnet-5`, forced tool-use via a `write_email` tool for reliably-structured output) for a short email under a fixed rule set (no "following up" openers, max 3 short paragraphs, one closing question, only two pre-approved proof-point stats, sign-off "Best,\nLewis"). If a thread with the target already exists it drafts as a reply in that thread (`GmailThread.createDraftReply`) instead of a new email. Computes warnings shown in the toast on manual drafts — never blocks creation: three deterministic (3+ touches with no reply, contacted within the last 3 working days, other contacts already engaged at the same company) plus one LLM-judged "ball in their court" flag (their last email committed to an action they still owe) read from the actual Gmail thread content. Auto-drafts (`auto: true`) are guarded by a same-day dedupe check against the Activity log (action `emaildraft`, detail `auto`/`manual`) so a slow poll and a late webhook for the same enrichment can't both create a draft

## Environment Variables

```
GOOGLE_SHEET_ID=
GOOGLE_SHEETS_API_KEY=
GOOGLE_APPS_SCRIPT_URL=
FOLLOW_UP_INTERVAL_DAYS=14
DAILY_NEW_GOAL=25
CAKE_TOUCH_DAYS=3
HOT_TOUCH_DAYS=2
FULLENRICH_API_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
```

Writes go through the Apps Script web app — the API key is read-only. The key must have both the Sheets API and Drive API enabled (Drive is used for cake images).

## UI Tabs

1. **Follow-ups** — contacts due for re-engagement, one card at a time
2. **New** — untouched connections; cake-image matches sort first with inline preview
3. **Messages** — template library with reply rates (card/table views)
4. **Cake** — copyable ChatGPT prompt + Drive template link for generating cake designs
5. **All** — searchable/filterable list of every contact with inline editing
6. **Stats** — today count, streak, week-on-week bar chart, reply rates by stage

## Gamification (goal: 25 new + all due follow-ups daily)

- **Goal bar** (all tabs): progress rings for New today / Follow-ups today, streak flame, combo chip
- **Streak**: goal-based (≥ DAILY_NEW_GOAL new sends) for days covered by the Activity log; any-activity for earlier days
- **Send flow**: card shows suggested template pre-personalised → "Copy & open LinkedIn" → "Sent" logs template + date + Activity row, auto-advances, builds combo (resets on tab switch)
- **Celebrations**: confetti overlay on hitting the daily goal and on logging an "Interested" reply (shows the template's updated reply rate)
- If no template is explicitly picked, "Sent" credits the suggested template shown on the card

---

## Known Bugs / Active Work

### ~~Bug: Follow-ups shows 0, New Contacts shows ~8 (both wrong)~~ — FIXED
- **Root cause**: `parseDate` was trying `new Date(cleaned)` first, which parses `DD/MM/YYYY` as `MM/DD/YYYY` (JS assumes American format). Contacts last-contacted on day 1–12 had their dates swapped, making them appear more recent than reality — so they never crossed the 14-day threshold.
- **Fix**: moved the `DD/MM/YYYY` slash-splitter before the JS `Date()` fallback in `parseDate`.

---

## Planned Changes (Phase 2/3 of gamification)

- **True reply attribution** — currently a positive reply credits every template in the contact's sequence (Reply col has no timestamp, so we can't know which message triggered it). Once the Activity log accumulates, attribute each `reply` event to the last message sent to that contact before the reply date. Keep sequence-credit as fallback for pre-log contacts.
- **Explore/exploit nudges** — occasionally suggest under-tested templates ("only 4 sends, needs data") so new messages get sample size
- **Messages tab** — confidence indicators on reply rates + week-over-week trend arrows (needs Activity log data to accumulate)
- **Streak polish** — streak-at-risk warning, milestone badges, personal bests

---

## Style / Conventions

- No comments unless the WHY is non-obvious
- No unnecessary abstractions — keep logic in `src/lib/sheets.ts` and route handlers
- CSS Modules for all styling
- Optimistic UI updates with error rollback on contact actions
