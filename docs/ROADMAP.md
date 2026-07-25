# Roadmap

Phased so every stage ships something you two actually use, and the spine (household · money+splits · dates) never gets rebuilt.

## ✅ Phase 0 — Foundation (this branch)

- Monorepo (Fastify + SQLite API, React SPA), single-container Docker deploy, GHCR publish action.
- Household setup, two members, session auth.
- Income sources per person, any pay cadence.
- Monthly budgets: shared categories with equal / income-proportional / custom funding split; personal categories per person; copy-last-month; spent/remaining bars.
- Expenses with Splitwise-style splits, running who-owes-whom balance, settle-up.
- Trip planner: wishlist ideas → planned trips; ordered stops with dates/lodging/notes; budget buckets; planned vs actual expenses; post-to-budget with split.
- Lists: to-dos, chores, groceries, wishlist (price + link), assignees, due dates.
- iCal calendar feed (trips, stops, due items) for Google Calendar subscription.
- Dashboard summary; demo seed data.

## Phase 1 — Make the money real

- [ ] CSV/OFX import with a review-and-match screen (category + split per row).
- [ ] SimpleFIN Bridge sync: accounts, balances, transactions on a schedule.
- [ ] Auto-rules ("Costco → Groceries, 50/50") applied at import.
- [ ] Recurring transactions (rent, subscriptions) that pre-fill each month.
- [ ] Monthly close: rollover options per category, month-in-review page.
- [ ] Settings encryption for stored credentials; rate limiting; cookie `Secure` when behind HTTPS.

## Phase 2 — Calendar, tasks, email

- [ ] Google OAuth per member; app-created shared "The Fold" calendar; push trips/date nights as real events.
- [ ] Google Tasks mirror for opted-in lists (assignment → their task list), two-way completion.
- [ ] Cron scheduler in-server; weekly email digest + nudge emails via SMTP (dedicated Gmail app account).
- [ ] In-app notifications strip (things due, over-budget warnings).

## Phase 3 — Investments & net worth

- [ ] Manual accounts (checking, savings, brokerage, retirement, property, debts) with balance snapshots.
- [ ] Net-worth timeline for the household; per-person and combined views.
- [ ] SimpleFIN balance auto-snapshots where available; optional ticker prices for holdings.

## Phase 4 — The conductor (home & fun)

- [ ] Home Assistant: outbound webhooks on events, scoped inbound token for lists/chores.
- [ ] Tandoor: recipe picker, ingredients → grocery list.
- [ ] Overseerr/Plex: request + "start movie night" via HA scene.
- [ ] Date-night flow tying the above together; Shy Local idea exchange (small JSON contract).

## Phase 5 — Polish & quality of life

- [ ] PWA (installable on phones, offline grocery list).
- [ ] Attachments/receipts on transactions and trip expenses.
- [ ] Reports: category trends, spending by person, trip cost retrospectives.
- [ ] Data export (full JSON/CSV dump) and scheduled SQLite backups.
- [ ] Automated test suite around the money math (splits, contributions, rollups) before Phase 1 lands.

## Non-goals (on purpose)

- More than one household per instance, social features, or multi-tenant SaaS-ification.
- Storing bank credentials directly — only aggregator tokens (SimpleFIN/Plaid/Teller) or files you export yourself.
- Becoming a full trading/portfolio analytics tool.
