# Roadmap

Phased so every stage ships something you two actually use, and the spine (household · money+splits · dates) never gets rebuilt.

## ✅ Phase 0.5 — Accounts, paychecks, themes

- [x] Self-serve signup: every person starts with their own solo budget.
- [x] Invite codes: sign up with a code to join a household, or redeem later — a solo budget merges in as that person's personal envelopes (active data kept, untouched starter content dropped, no duplicates).
- [x] Paycheck breakdowns: gross + deductions (tax / pre-tax / post-tax) per income source, net always derived.
- [x] Split basis: income-proportional splitting on take-home or gross, with a live comparison panel (50/50 vs net vs gross, in % and $) on the Budget page.
- [x] Theme system: light/dark/system + five accent palettes, per device.
- [x] Budgeting methods: envelopes (zero-based), 50/30/20 with adjustable percentages, pay-yourself-first with a savings goal, and plain spending tracking — all over the same engine, with need/want/save tags per category.
- [ ] Leave/unlink a household (reverse of merging) — needs a data-custody design first.
- [ ] Password reset via email (depends on the SMTP driver in Phase 2).

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

- [x] CSV import with a review-and-match screen (category + split per row, duplicate detection).
- [x] OFX/QFX import: no column mapping, FITID-based dedupe, statement balance → account snapshot.
- [x] Imports designate a source account, with per-account remembered profiles (mapping, sign, payer, split).
- [x] Import batches with history and one-click undo.
- [x] Credits/refunds as first-class transactions (negative amounts flow through budgets, balances, reports).
- [x] Auto-rules ("Costco → Groceries, 50/50") applied at import.
- [x] Recurring transactions (rent, subscriptions) that post themselves each month/year with catch-up.
- [x] Multi-category transactions (line items) and a classify queue for anything imported bare.
- [x] Transaction search + filters (text, category, account, payer) and per-account activity views.
- [x] Reports: cash flow, savings rate, spending by group, movers, who-spent-it by split share.
- [ ] SimpleFIN Bridge sync: accounts, balances, transactions on a schedule.
- [ ] Auto-rules that split across categories, not just one.
- [ ] Reconciliation: tick imported transactions against the statement balance.
- [ ] Settings encryption for stored credentials; rate limiting; cookie `Secure` when behind HTTPS.

## Phase 1b — Budget depth ✅

- [x] Category groups with collapsible sections and subtotals.
- [x] Rollover envelopes (leftovers and overspends carry forward); non-rollover envelopes reset monthly.
- [x] Targets: monthly amounts and save-by-a-date sinking funds with per-month suggestions.
- [x] Budgeted / spent / available on every row, with overspend highlighting and one-click cover.
- [x] Move money between envelopes; auto-fill a month from last month, targets, or averages.
- [x] Per-person "left to assign", household assigned/unassigned, and month-pace tracking.
- [x] Category drilldown: six-month history, this month's transactions, quick-set, settings.
- [x] Trends: budgeted vs spent over six months, spending by group, biggest movers.
- [x] Per-month income overrides for bonus and slow months.
- [ ] Month-in-review summary you can page back through.
- [ ] Drag-to-reorder categories and groups (buttons/APIs exist; drag UI pending).
- [ ] Credit-card float handling for people who pay the statement, not the purchase.

## Phase 2 — Calendar, tasks, email

- [ ] Google OAuth per member; app-created shared "The Fold" calendar; push trips/date nights as real events.
- [ ] Google Tasks mirror for opted-in lists (assignment → their task list), two-way completion.
- [ ] Cron scheduler in-server; weekly email digest + nudge emails via SMTP (dedicated Gmail app account).
- [ ] In-app notifications strip (things due, over-budget warnings).

## Phase 3 — Investments & net worth

- [x] Manual accounts (checking, savings, brokerage, retirement, property, debts) with balance snapshots.
- [x] Net-worth timeline for the household with joint and per-person accounts.
- [ ] SimpleFIN balance auto-snapshots where available; optional ticker prices for holdings.
- [ ] Per-person net worth breakdown view.

## Phase 4 — The conductor (home & fun)

- [x] Home Assistant: outbound webhooks on events (chores due, trip countdown, budget overruns) + scoped inbound tokens for lists/chores/summary.
- [ ] Tandoor: recipe picker, ingredients → grocery list.
- [ ] Overseerr/Plex: request + "start movie night" via HA scene.
- [ ] Date-night flow tying the above together; Shy Local idea exchange (small JSON contract).

## Phase 5 — Polish & quality of life

- [x] PWA manifest (installable on phones); offline grocery list still to come.
- [x] Automated test suite around the money math and API (splits, contributions, balances, recurring, imports).
- [ ] Attachments/receipts on transactions and trip expenses.
- [ ] Reports: category trends, spending by person, trip cost retrospectives.
- [ ] Data export (full JSON/CSV dump) and scheduled SQLite backups.

## Non-goals (on purpose)

- More than one household per instance, social features, or multi-tenant SaaS-ification.
- Storing bank credentials directly — only aggregator tokens (SimpleFIN/Plaid/Teller) or files you export yourself.
- Becoming a full trading/portfolio analytics tool.
