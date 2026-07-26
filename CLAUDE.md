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
| Field | Header text |
|-------|-------------|
| First Name | `First Name` |
| Last Name | `Last Name` |
| URL | `URL` |
| Company | `Company` |
| Position | `Position` |
| List | `List` |
| Function | `Function` |
| Connected On | `Connected On` |
| Message (abbreviation of initial message sent) | `Message` |
| Reply (status: "Interested", "Dead lead", "Not interested", etc.) | `Reply?` |
| Follow Ups (count) | `Follow ups` |
| Follow Up Message 1 | `Follow Up Message 1` |
| Follow Up Message 2 | `Follow Up Message 2` |
| Last Contacted (date, DD/MM/YYYY) | `Last Contacted` |
| Comment | `Comment` |
| Email | `Email` |
| Phone | `Phone` |
| Call booked (date — set by the Today tab's "Meeting booked" action; graduates the contact out of both Today queues) | `Call booked` |
| Priority — app-written label ("🎂 Cake" / "🔥 Interested" / blank), see `computePriorityLabel` | `Priority` |
| Region (`UK`/`US`; blank = always visible regardless of time-of-day sorting) | `Region` |

**Columns are resolved by header text, not position** (`buildConnectionsColumnMap` in `src/lib/sheets.ts`). The sheet can be reordered, and columns inserted anywhere, without touching any code — the app reads row 1 on every load and builds a field→letter map, which `/api/sheet` returns to the client for writes. Server routes that write a single column without loading the whole sheet (`/api/enrich`, `/api/enrich/webhook`, `/api/sync-priority`) resolve it via `resolveConnectionsColumn()` / `buildConnectionsColumnMap()` at request time instead. The Apps Script mirrors this with its own `connectionsHeaderIndex_()` / `connectionsHeaderIndexOrAppend_()` helpers — `setupPhase0`, `setupDataHygiene`, and `backfillPriorityColumn` all locate columns by header name rather than fixed letters. Only requirement: the header **text** in row 1 must match what's listed above — rename a header and update `CONNECTIONS_FIELD_HEADERS` in `sheets.ts` to match. All date columns display DD/MM/YYYY; the app parses displayed values, so never change that display format. Message/Follow Up 1/Follow Up 2 have sheet-side dropdown validation fed from Messages!C (warning mode, not reject — reject would break Apps Script writes).

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

### Campaigns tab (cake-campaign pipeline + company-level ICP tracking)

Like Connections, columns are resolved by **header text**, not fixed position (`buildCampaignsColumnMap` / `CAMPAIGNS_FIELD_HEADERS` in `src/lib/sheets.ts`, mirrored in `apps-script/Code.gs` by `campaignsHeaderIndex_`/`campaignsHeaderIndexOrAppend_`). The sheet can be reordered and columns can be added without touching code — a field just reads as `''` if its header isn't found, rather than silently reading the wrong column. Current fields and their header text:

| Field | Header text |
|-------|-------------|
| Company (matched to Connections via `normalizeCompany`) | `Company` |
| Status — lifecycle stages mirroring the Appetite platform: `Planned` / `Delivered` / `Reply` / `Meeting` / `Pipeline` / `Closed Won` / `Closed Lost`. Blank for ICP-only rows (see below) | `Status` |
| Cake sent (date — auto-stamped by the Apps Script on first transition to Delivered) | `Cake sent` |
| Notes | `Notes` |
| Industry | `Industry` |
| Company Size | `Company Size` |
| Funding Stage | `Funding Stage` |
| Region (firmographic, unrelated to the Connections tab's time-of-day Region) | `Region` |
| ICP Fit (freeform, e.g. `Strong`) | `ICP Fit` |
| Focus — TRUE/blank, manual Focus-tab shortlist flag. Independent of Status; app-written via `handleAddToFocus`/`handleRemoveFromFocus`, read by `getFocusQueue`/`getFocusSuggestions` in `sheets.ts` | `Focus` |

Not every row is a real campaign — the firmographic/ICP fields let signal from ordinary (no-cake) LinkedIn/email outreach live alongside actual cake campaigns, so patterns can be found across both when asked. These rows are added directly in the sheet (no app UI for it), typically after Claude scans Connections for un-logged strong signals and hands over a candidate list to review.

`isCampaignActive` (`src/lib/sheets.ts`) is a strict **allowlist** (status contains delivered/reply/meeting/pipeline/"cake sent") — deliberately not "anything not closed/planned", because blank-Status ICP rows must default to inactive or they'd silently get pulled into Focus's Tier 1 cake-chase cadence. `isCampaignClosed`/`isCampaignPlanned` still keyword-match as before. Focus tab membership is separately gated by the `Focus` flag (see below), so ICP-only and non-shortlisted rows never appear there either. Managed from the Focus tab's "Manage shortlist" panel (stage dropdown + Focus toggle per company).

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
FOLLOW_UP_INTERVAL_DAYS=7
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

## In-progress: CRM overhaul plan

User asked for a larger restructure (2026-07-25 onward). Status per piece, so a fresh conversation can resume without re-deriving this:

**Done:**
- Phase 0: Activity tab created (never existed before — silently broke snoozes/streaks/draft-dedupe until fixed), R/S headers added, Priority backfilled.
- Follow-up interval changed 14 → 7 calendar days (`FOLLOW_UP_INTERVAL_DAYS`).
- Connections column mapping made fully header-driven (see Data Model above) — this was prerequisite work so the sheet could be freely reorganized.
- User has since reordered the whole Connections sheet (grouped contact info, pushed Message/FU1/FU2/Last Contacted to the end) and added a **Region** column — confirmed working with zero code changes, proving the header-driven refactor.
- **Component split**: `OutreachApp.tsx` (was 2000+ lines) split into `src/components/tabs/{CakeTab,StatsTab,MessagesTab,ConnectionsTab,FocusTab}.tsx`. State/handlers with cross-tab reach (contact data, edit state, campaign mutations) stay in `OutreachApp.tsx` and are passed down as props; tab-local UI state (search/filter, view toggle, copy-timeout) moved into the tab component that owns it.
- **Region-based time-of-day sort**: `getRegionMode`/`normalizeRegion`/`regionSortRank` in `sheets.ts`. Matches `United Kingdom`/`UK`/`GB`/`Great Britain` and `United States`/`US`/`USA`; blank region sorts mid-pack (never filtered). 06:00–21:59 local time favors UK contacts in New/Follow-ups ordering, 22:00–05:59 favors US; header shows a live "🇬🇧 UK hours"/"🇺🇸 US hours" chip. Follow-ups queue is re-sorted client-side (stable sort layered on the server's cadence-priority order); New tab sorts region rank between the cake-image check and the user's chosen sort.
- **Nav restructure**: collapsed to 4 top-level tabs (Follow-ups / New / Focus / All); Messages/Cake/Stats moved into a "⋯" dropdown menu (`MORE_TABS` in `OutreachApp.tsx`), still the same `Tab` values under the hood.
- **Focus tab** replaces Today. `getFocusQueue` (`sheets.ts`) now gates group membership on `CampaignEntry.focus` (manual shortlist, Campaigns `Focus` column) instead of "any active/interested company" — Tier 1/Tier 2 cadence logic is unchanged, just scoped to shortlisted companies. `getFocusSuggestions` surfaces active-cake-campaign or Interested-reply companies not yet shortlisted, for one-tap add in the Focus tab's "Manage shortlist" panel (which also still handles per-company cake stage + notes, now with a Remove-from-Focus button per row).
- **Overlap rule**: `getFollowUpQueue` now takes a `focusedCompanyKeys` set and excludes those companies' contacts — they only show in Focus. `TierContact.followUpDue` (computed via the shared `isFollowUpDue` predicate) badges "Follow-up also due" on Focus contacts who'd otherwise independently qualify for Follow-ups.
- **Campaigns tab made header-driven** (like Connections): `buildCampaignsColumnMap`/`CAMPAIGNS_FIELD_HEADERS` in `sheets.ts` resolve every field (`Company`/`Status`/`Cake sent`/`Notes`/`Industry`/`Company Size`/`Funding Stage`/`Region`/`ICP Fit`/`Focus`) by header text rather than fixed column letter — triggered by discovering the original positional mapping had gone stale (real sheet had `ICP Fit` at J, not the assumed `ICP Signal` at I, and Region/Company Size/Funding Stage didn't line up either). `apps-script/Code.gs`'s campaign-write handler now resolves `Company`/`Status`/`Cake sent`/`Notes`/`Focus` via new `campaignsHeaderIndex_`/`campaignsHeaderIndexOrAppend_` helpers (generalized from the Connections ones into shared `sheetHeaderIndex_`/`sheetHeaderIndexOrAppend_`) instead of hardcoded `getRange(i+1, N)` column numbers.

**Requires manual follow-up (not code):**
- **Campaigns tab needs a column header `Focus`** (TRUE/blank), anywhere in the row — position no longer matters now that it's header-driven. Until this header exists, every company parses as `focus: false` and the Focus tab will show empty/only auto-suggestions.
- **`apps-script/Code.gs` was updated again** (header-driven campaign writes, see above) — paste the latest version into the Apps Script editor and redeploy.

**Not yet built:**
- **A/B testing**: user defines tests in chat (2 existing template abbreviations + a stage), stored as a new **Experiments tab** (Test ID / Name / Stage / Variant A / Variant B / Status / Started / Ended / Winner / Notes) rather than an in-app builder. Assignment via deterministic hash of `(rowIndex + testId)` — not `rowIndex % 2`, since sheet position correlates with import batch/company/region and would confound results. Follow-ups tab gets a pinned section for contacts matching an active test's stage; New tab auto-shows the assigned initial-message variant. Results must show a sample-size/confidence gate ("142/400 sent — too early to call") rather than declaring winners on small numbers.
  - Volume reality at last check (2026-07-25): initial-message pool is huge (2,600+, can conclude in weeks). FU1 pool (~150, grows ~25/day) needs about a month for a directional read. FU2 pool (~73) needs 1–2 months — premature calls here would be noise, not signal. Re-check actual numbers before starting a test rather than trusting these.
- **Desktop-responsive layout** — app is currently a fixed ~480px mobile shell (`.shell` in `OutreachApp.module.css`). Not started.

---

## Style / Conventions

- No comments unless the WHY is non-obvious
- No unnecessary abstractions — keep logic in `src/lib/sheets.ts` and route handlers
- CSS Modules for all styling
- Optimistic UI updates with error rollback on contact actions
