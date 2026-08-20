# Integrations

How The Fold connects to everything else you run. Each section says **what you get**, **how it's wired**, and **what it takes to set up**. Status legend: [shipped] live today · designed, next up · planned.

---

## Google Calendar — one-way feed [shipped]

**What you get:** trips, trip stops, and dated list items on both of your Google calendars, updating automatically. Zero Google setup.

**How:** The Fold serves a standard iCal feed at a secret URL (Settings → Calendar feed). In Google Calendar: *Other calendars → + → From URL*, paste, done — repeat on your partner's account, or add it to an existing shared calendar's account. Google refreshes subscribed feeds every few hours (that's a Google-side limit; fine for trips and due dates).

## Google Calendar & Tasks — two-way 

**What you get:** "Create calendar event" from any trip/list item onto a real **shared Google calendar** (instant, editable, with reminders — Google then handles notifications on your phones); assigned to-dos mirrored into each person's **Google Tasks**; and task/event edits syncing back.

**How it will be wired:** OAuth 2.0 per member (each of you connects your own Google account once in Settings), tokens stored in the household `settings` store. Events are written to a dedicated "The Fold" shared calendar the app creates on first connect. Google Tasks API mirrors items in lists you opt in (e.g. Chores), keyed by item id for two-way updates.

**Setup you'll do once (15 min):**
1. Google Cloud Console → new project ("the-fold").
2. Enable **Google Calendar API** and **Google Tasks API** (and **Gmail API** if you want the email driver below).
3. OAuth consent screen → External → add both your Gmail addresses as *test users* (test mode is permanent-friendly for a 2-person personal app; no verification review needed).
4. Create OAuth Client ID (Web application), authorized redirect `http://<server>:8484/api/google/callback`, and drop the client id/secret into The Fold's settings.

Scopes will be the narrow ones: `calendar.events` + `calendar.calendarlist.readonly`, `tasks`, and `gmail.send` only if the email driver uses Gmail.

## Email reminders & digests 

**What you get:** a weekly "state of the household" digest (budget burn, who owes whom, upcoming trip costs, overdue chores) and nudge emails ("rent hits in 3 days", "you're $40 from the Dining Out cap"), sent to both of you.

**Options, pick one at setup:**
- **Dedicated app account (recommended):** make `thefold.yourhouse@gmail.com`, give The Fold its SMTP app password (2FA + app password). Clean sender identity, your personal account stays untouched.
- **Your own Gmail:** same SMTP app-password mechanism, mail comes "from you".
- **Gmail API** via the OAuth above (`gmail.send`) if you'd rather avoid app passwords.

Implementation is a plain SMTP client + a cron loop in the server (it's already a long-running process); no external email SaaS needed on a self-hosted box.

## Bank & transaction sync (the Mint part) 

Real talk about pulling live financial data as a self-hoster in the US:

| Option | Cost | Fit |
|---|---|---|
| **SimpleFIN Bridge** | ~$1.50/mo | **Best first choice.** Built exactly for personal self-hosted apps: you connect your banks to SimpleFIN once, it hands The Fold a read-only access URL, the app polls transactions + balances (including investment account balances). No developer agreements, no OAuth dance per bank. Actual Budget & friends use this. |
| **Plaid** | Free sandbox; production requires an approved developer account (pay-as-you-go) | The polished aggregator Mint used. Doable for personal use but you're signing up as a "company," and per-connection pricing adds up. Worth it later if SimpleFIN's coverage misses one of your institutions. |
| **Teller** | Free tier (~100 accounts) | Good US coverage, developer-friendly; certificate-auth API. Solid alternate. |
| **CSV import** [shipped] | free | **Live today** on the Spending page: column mapping, sign-convention handling, auto-rules, duplicate skipping. OFX support later. |

**Design either way:** an `accounts` + `imported_transactions` staging table; a matching screen where imported rows become real transactions (pick category, pick split — or auto-rules like "Costco → Groceries, 50/50"). Imports never bypass the split engine, so who-owes-whom stays correct. Your manual entries and bank data reconcile instead of duplicating.

## Investments & net worth [shipped] (manual) / (auto)

**Live today:** the Net worth page tracks accounts — checking, savings, brokerage, retirement, property, vehicles, credit cards, loans — joint or per-person, with dated balance snapshots and a household net-worth trend line. Updating a balance takes two seconds and builds the history.

**Next:** SimpleFIN balance auto-snapshots (it returns investment account balances too) and optional ticker prices to break holdings out. Kept intentionally simple — this is "see our full picture," not a trading terminal.

## Home Assistant [shipped]

Both directions are live:

- **The Fold → HA (live):** Settings → Home Assistant. Paste an HA webhook-trigger URL (`http://homeassistant.local:8123/api/webhook/<id>`) and pick your events. The Fold POSTs JSON like `{"source":"the-fold","event":"trip_countdown","data":{"days_until":3,"trips":[…]}}` for: chores/to-dos due (`item_due`), trip countdowns at 7/3/1/0 days (`trip_countdown`), and budget categories crossing 100% (`budget_over`, fired once per category per month). A "Send test" button verifies the pipe; a daily in-server scheduler does the rest. What the automation does — lights, TTS announcements, dashboards — is normal HA config.
- **HA → The Fold (live):** Settings → API tokens. Create a scoped bearer token, then from HA (or a Siri/Google shortcut, or curl):
  - `POST /api/hooks/list-items` `{"list":"Groceries","text":"Oat milk"}` — add to any list by name
  - `POST /api/hooks/complete-item` `{"text":"oat milk"}` — check off the first open match
  - `GET /api/hooks/summary` — open item count, next trip, who-owes-whom
  Tokens can do exactly that and nothing else — no budget or account access.

## Date night: Plex + Overseerr + Tandoor (+ Shy Local) 

The one-button evening you described, as a concrete flow the modules already support:

1. **Plan** — a "Date night" entry (a lightweight event type on the trips/wishlist spine, or pulled from **Shy Local** once it exposes ideas over HTTP — a tiny JSON contract between your two apps: `GET /ideas`, `POST /planned`).
2. **Dinner** — pick a recipe via **Tandoor's REST API** (you host it; it has solid token auth). Missing ingredients → posted onto the Groceries list automatically.
3. **Movie** — search **Overseerr's API**; if it's not on Plex yet, The Fold files the request days ahead so it's ready.
4. **Start** — one button fires the HA webhook: lights dim, Plex client starts the movie (HA's `media_player` or Plex's own API), phones DND if you're feeling fancy.
5. **Done** — the evening's takeout/tickets land as a split expense in the budget like everything else.

Every arrow in that flow is an existing, documented API on software you already run — The Fold is just the conductor.

> Note on "Pandora recipes": assuming that's **Tandoor** (the popular self-hosted recipe manager) — if it's something else, the pattern holds as long as it has any HTTP API; the adapter just changes shape.

## Shy Local 

Since you're building it: the cleanest integration is a mutual mini-API — Shy Local exposes date/activity ideas; The Fold exposes `POST /api/trips` (status `idea`) and list items. Then ideas you save there appear on the wishlist here, and planning one promotes it to a dated, budgeted plan with calendar presence. Happy to define that contract as a one-page spec when you're ready.

---

## Priority order (opinionated)

1. **Bank sync via SimpleFIN + CSV import** — highest daily value; makes the budget real without data entry.
2. **Google OAuth (Calendar events + Tasks)** — the feed already covers viewing; this adds create/assign with native phone reminders.
3. **Email digest** — cheap to build once cron exists, keeps you both honest.
4. **Home Assistant webhooks** — small effort, big delight.
5. **Tandoor → grocery list**, then the full date-night conductor.
6. **Investments/net worth**, **Shy Local contract** as they mature.
