# CRM App — Claude Context

## What This Is

A personal LinkedIn outreach CRM. A Next.js 14 app that uses **Google Sheets as the database**. The workflow: connect with people on LinkedIn → send an initial message → follow up after an interval → track replies.

## Tech Stack

- Next.js 14 (App Router), React 18, TypeScript
- Google Sheets API (read + write) — no traditional DB
- CSS Modules
- Hosted locally / dev server

## Data Model

Two Google Sheets tabs:

### Connections tab (one row per contact)
| Col | Letter | Field |
|-----|--------|-------|
| 0 | A | First Name |
| 1 | B | Last Name |
| 2 | C | LinkedIn URL |
| 3 | D | Company |
| 4 | E | Position |
| 5 | F | *(blank)* |
| 6 | G | Function |
| 7 | H | Connected On |
| 8 | I | Message (abbreviation of initial message sent) |
| 9 | J | Reply (status: "Interested", "Dead lead", "Not interested", etc.) |
| 10 | K | Follow Ups (count) |
| 11 | L | Follow Up Message 1 (abbreviation of follow-up template used) |
| 12 | M | Last Contacted (date, DD/MM/YYYY) |
| 13 | N | Comment |

### Messages tab (one row per template)
| Col | Field |
|-----|-------|
| 0 | Message Type |
| 1 | Target |
| 2 | Abbreviation (short code used in Connections sheet) |
| 3 | Full Message text |

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

- `GET /api/sheet` — fetches both Sheets tabs, returns `{ followUps, newContacts, messages, allContacts, intervalDays }`
- `POST /api/update` — batch-updates cells in the Connections sheet (last contacted date, reply status, etc.)

## Environment Variables

```
GOOGLE_SHEET_ID=
GOOGLE_SHEETS_API_KEY=
FOLLOW_UP_INTERVAL_DAYS=14
```

## UI Tabs

1. **Follow-ups** — contacts due for re-engagement
2. **New Contacts** — untouched connections (no initial message sent)
3. **Messages** — library of outreach templates

---

## Known Bugs / Active Work

### ~~Bug: Follow-ups shows 0, New Contacts shows ~8 (both wrong)~~ — FIXED
- **Root cause**: `parseDate` was trying `new Date(cleaned)` first, which parses `DD/MM/YYYY` as `MM/DD/YYYY` (JS assumes American format). Contacts last-contacted on day 1–12 had their dates swapped, making them appear more recent than reality — so they never crossed the 14-day threshold.
- **Fix**: moved the `DD/MM/YYYY` slash-splitter before the JS `Date()` fallback in `parseDate`.

---

## Planned Changes

### 1. Messages tab — show reply rate per template
- Each message template in the Messages tab should display its overall reply rate (% of contacts who replied "Interested" after receiving that template).
- This requires computing stats across `allContacts`: for each template abbreviation, count how many contacts have it in `message` or `followUpMessage1`, and how many of those have `reply === "interested"`.
- The existing `suggestMessage` function already does per-role stats — extract/generalise this into a `getMessageStats(contacts, messages)` function and expose it via the API.

### 2. Reply attribution — mark reply against both follow-up and initial message
- When a contact replies after a follow-up (i.e. `followUpMessage1` is set and `reply === "interested"`), the positive reply should count toward the reply rate of **both** the follow-up template AND the initial message template.
- Currently `suggestMessage` only checks `isFollowUp ? c.followUpMessage1 : c.message` — it doesn't cross-attribute replies.
- Update stats logic so a reply credits whichever templates were used in the sequence.

---

## Style / Conventions

- No comments unless the WHY is non-obvious
- No unnecessary abstractions — keep logic in `src/lib/sheets.ts` and route handlers
- CSS Modules for all styling
- Optimistic UI updates with error rollback on contact actions
