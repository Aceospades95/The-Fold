# 🪺 The Fold

**A self-hosted home base for two.** Shared budgets, split expenses, trip planning, and household lists — one app, on your own server, built around how *you two* actually run your life.

The Fold exists because the pieces were scattered: Splitwise for splits, Mint for budgets, a spreadsheet for road trips, a notes app for groceries, and none of them talk to each other. Here they're one system — plan a trip, and its expenses land in the budget; assign a chore, and it can show up on your calendar.

## What works today (v0.1)

- **Real accounts, linked when you're ready.** Each person signs up on their own and gets a full solo budget. Generate an **invite code** and your partner either signs up with it or redeems it from their existing account — their solo history merges in as their personal envelopes, and from then on you share one household: joint budget, personal budgets, one running balance.
- **Income & funding** — each person's income sources (any pay cadence), normalized to monthly, with per-month overrides for bonus or slow months.
- **Paycheck breakdown & the gross-vs-net question.** Record gross pay and deductions (taxes, 401k, insurance) per paycheck; The Fold derives take-home. A "Paychecks & how we split" panel on the Budget page shows each person's gross → deductions → net waterfall and what **50/50 vs by-net vs by-gross** would each cost this month — click the one you want and the budget re-splits.
- **Themes** — light, dark, or follow-system, with five accent palettes (violet, emerald, rose, sky, amber). Per-device, so you can each pick your own look.

### The budget (the part we polished first)

- **Envelope budgeting built for two.** A starter budget arrives grouped into **Home / Food / Getting around / Life & health / Goals** — collapsible sections with their own subtotals.
- **Budgeted → Spent → Available** on every row, so you always know what's actually left, not just what you planned.
- **Rollover envelopes.** Turn it on for travel, car repairs, gifts — leftovers (and overspends) carry into next month. Turn it off for groceries and it resets monthly, the way you'd expect.
- **Targets & sinking funds.** "Budget $700 every month," or "save $2,700 by September 12" — The Fold does the division and tells you what to put in this month to stay on track.
- **Left to assign, per person.** Each of you sees income − your share of the joint budget − your personal envelopes. The household summary shows income, assigned, and unassigned at a glance.
- **Pace tracking.** "Day 27 of 31 — 87% through the month, 68% of budget spent — on pace," with a marker on the bar for today.
- **Move money** between envelopes when life happens, and one-click **Cover** on anything overspent.
- **Auto-fill** a month from last month's amounts, your targets, a 3-month average, or last month's actual spending.
- **Category drilldown** — click any envelope for six months of budgeted-vs-spent bars, this month's transactions, quick-set buttons, and its settings (rollover, target, group).
- **Trends** — six months of budgeted vs spent, where the money went by group, and the biggest movers versus last month.
- **Shared budget, split your way** — joint categories funded 50/50, proportional to income, or custom percentages; the app shows each person's share every month.
- **Personal budgets** — your own envelopes out of your own remaining income. No questions asked.

### Spending

- **Splitwise-style expenses** — any expense can be split 50/50, by income, custom amounts, or "they owe it all"; a running balance shows who owes whom, with one-click settle-up records.
- **One purchase, several categories.** A $240 Costco run can be $104 groceries, $76 household, and $60 of someone's personal fun money — each slice lands in its own envelope.
- **"By category" splitting.** With a multi-category purchase, The Fold works out who owes what: personal lines go to their owner, shared lines split by your household rule. That Costco run becomes Jake $160.80 / Sam $79.20 automatically.
- **Classify queue** — imported transactions that arrive bare land in a "needs a category" list you can clear in a few clicks (or split across categories).
- **Trip planner** — trips with ordered stops (dates, lodging, notes), budget buckets (Lodging / Transport / Food / …), planned-vs-actual expenses per bucket, and remaining/over-budget rollups. Wishlist ideas live next to fully planned routes.
- **Trips flow into the budget** — post any trip expense into a monthly budget category with a split, one click, no double entry.
- **Lists** — to-dos, chores, groceries, wishlists (with prices and links), assignable to either of you, with due dates.
- **Recurring transactions** — rent, internet, subscriptions post themselves on schedule (split and all), with automatic catch-up after server downtime.
- **CSV statement import** — map your bank/card export's columns once, auto-rules pre-fill categories and splits ("Costco → Groceries, 50/50"), and duplicate rows are skipped on re-import.
- **Net worth (the Mint part)** — accounts for checking, savings, investments, retirement, property, and debts — joint or per-person — with dated balance snapshots and a household net-worth trend chart.
- **Calendar feed (live integration)** — an iCal URL that Google Calendar subscribes to: trips, stops, and dated to-dos appear on both your calendars automatically.
- **Home Assistant webhooks** — The Fold POSTs events (chores due, trip countdowns, budget overruns) to an HA webhook trigger; your automations take it from there.
- **API tokens** — scoped bearer tokens so HA, Siri/Google shortcuts, or scripts can add grocery items, complete chores, and read a summary.
- **Dashboard** — month at a glance: shared + personal budget burn, who-owes-whom, net worth, next trip countdown, your open tasks.
- **Tested money math** — a vitest suite covers splits, contributions, balances, recurring, imports, and the API's edge cases (`npm test`).
- **Installable** — PWA manifest, so it lives on your phone home screens.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next (bank sync, Google two-way sync, investments, Home Assistant date-night button…) and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for exactly how each integration will be wired.

## Quick start (Docker / unRAID)

```bash
git clone https://github.com/Aceospades95/The-Fold.git
cd The-Fold
docker compose up -d --build
```

Open `http://<server-ip>:8484`, run the one-time setup (you + your partner), and you're in.
All data lives in a single SQLite file under `./data/` — back it up by copying the folder.

**unRAID specifics**

1. Install the *Compose Manager* plugin (or use the Docker tab → Add Container with a locally built image).
2. Point the stack at this repo; map `/data` to `/mnt/user/appdata/the-fold/`.
3. Port `8484` → whatever you like.
4. Optional: once the GitHub Action publishes `ghcr.io/aceospades95/the-fold:latest` (runs on every push to `main`), switch `docker-compose.yml` from `build: .` to the image and update like any other container.

Want demo data to poke at first? `docker compose exec the-fold npm run seed` (fresh installs only — it never touches an existing household).

## Development

```bash
npm install
npm run dev:server   # API on :8484 (tsx watch)
npm run dev:web      # Vite dev server on :5173, proxies /api
npm run seed         # demo household: jake@example.com / sam@example.com, password "thefold"
npm run typecheck    # strict TS across server + web + shared
```

Node ≥ 22.5 (uses the built-in `node:sqlite` — zero native dependencies).

## Stack

| Layer | Choice | Why |
|---|---|---|
| API | Fastify 5 + TypeScript | small, fast, typed |
| DB | SQLite via `node:sqlite` | one file, trivial backups, perfect for a 2-person app |
| Web | React 19 + Vite + Tailwind 4 | quick to build on, easy to keep pretty |
| Deploy | single Docker container | unRAID-friendly, no external services required |

Architecture details, data model, and the "how does one app hold all of this" answer: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
