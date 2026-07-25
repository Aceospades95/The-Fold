# 🪺 The Fold

**A self-hosted home base for two.** Shared budgets, split expenses, trip planning, and household lists — one app, on your own server, built around how *you two* actually run your life.

The Fold exists because the pieces were scattered: Splitwise for splits, Mint for budgets, a spreadsheet for road trips, a notes app for groceries, and none of them talk to each other. Here they're one system — plan a trip, and its expenses land in the budget; assign a chore, and it can show up on your calendar.

## What works today (v0.1)

- **Two-person household** with individual sign-ins, set up in one screen.
- **Income & funding** — each person's income sources (any pay cadence), normalized to monthly.
- **Shared budget, split your way** — joint categories funded 50/50, proportional to income, or custom percentages; the app shows each person's share every month.
- **Personal budgets** — your own categories out of your own remaining income. No questions asked.
- **Splitwise-style expenses** — any expense can be split 50/50, by income, custom amounts, or "they owe it all"; a running balance shows who owes whom, with one-click settle-up records.
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
