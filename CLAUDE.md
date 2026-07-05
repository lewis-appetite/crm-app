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

Appended by the Apps Script on writes (see `apps-script/Code.gs`). Exists because Last Contacted is overwritten on each touch — the log makes streaks/weekly stats permanent history. `getStats` merges log events with lastContacted-derived events (log wins on same contact+day) so pre-log history still counts.

## Key Logic (`src/lib/sheets.ts`)

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

## Environment Variables

```
GOOGLE_SHEET_ID=
GOOGLE_SHEETS_API_KEY=
GOOGLE_APPS_SCRIPT_URL=
FOLLOW_UP_INTERVAL_DAYS=14
DAILY_NEW_GOAL=25
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

- **Explore/exploit nudges** — occasionally suggest under-tested templates ("only 4 sends, needs data") so new messages get sample size
- **Messages tab** — confidence indicators on reply rates + week-over-week trend arrows (needs Activity log data to accumulate)
- **Streak polish** — streak-at-risk warning, milestone badges, personal bests

---

## Style / Conventions

- No comments unless the WHY is non-obvious
- No unnecessary abstractions — keep logic in `src/lib/sheets.ts` and route handlers
- CSS Modules for all styling
- Optimistic UI updates with error rollback on contact actions
