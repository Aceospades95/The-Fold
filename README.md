# 🪺 The Fold

**A self-hosted home base for two.** Shared budgets, split expenses, trip planning, and household lists — one app, on your own server, built around how *you two* actually run your life.

The Fold exists because the pieces were scattered: Splitwise for splits, Mint for budgets, a spreadsheet for road trips, a notes app for groceries, and none of them talk to each other. Here they're one system — plan a trip, and its expenses land in the budget; assign a chore, and it can show up on your calendar.

## What works today (v0.1)

- **Real accounts, linked when you're ready.** Each person signs up on their own and gets a full solo budget. Generate an **invite code** and your partner either signs up with it or redeems it from their existing account — their solo history merges in as their personal envelopes, and from then on you share one household: joint budget, personal budgets, one running balance.
- **Income & funding** — each person's income sources (any pay cadence), normalized to monthly, with per-month overrides for bonus or slow months.
- **Paycheck breakdown & the gross-vs-net question.** Record gross pay and deductions (taxes, 401k, insurance) per paycheck; The Fold derives take-home. A "Paychecks & how we split" panel on the Budget page shows each person's gross → deductions → net waterfall and what **50/50 vs by-net vs by-gross** would each cost this month — click the one you want and the budget re-splits.
- **Themes** — light, dark, or follow-system, with five accent palettes (violet, emerald, rose, sky, amber). Per-device, so you can each pick your own look.

### Plan — model it before you live it

- **The Plan page** (inspired by a standalone planner we loved enough to absorb) is a full modeling sandbox for the shared pot: enter gross salaries, drag a 401(k) slider, list every paycheck deduction with its real tax treatment (§125 medical is FICA-free; plain pre-tax isn't) — and The Fold computes 2026 federal brackets, FICA with the wage-base cap, and a flat state rate to land on your **take-home pool**. Toggle *married filing jointly* vs *two single filers* and watch what marriage does to the bill.
- **A sankey of every dollar** — both incomes flowing through pre-tax, taxes, and post-tax into the pool, then out to living / savings / investments / trip fund / personal allowances. Hover anything for $/mo and % of gross.
- **Sliders that argue back** — drag any pool bucket and the others rebalance proportionally so it always totals 100%. Set a trip goal and get an ETA ("$6,000 ≈ 10.7 months — Jul 2027").
- **Who funds it vs. who it's *for*** — every planned category splits two ways at once: *funds* follows income share, and a per-line **benefit slider** captures whose expense it really is. A fairness check then shows what each of you puts in vs. what flows back, with the gap as a known, discussed number instead of a silent one. Personal allowances: equal dollars or proportional, with the trade-off spelled out.
- **Scenarios** — snapshot the whole page under a name ("Aggressive savings", "If Sam goes part-time"), reload or delete them anytime; the live plan autosaves as you drag.
- **The plan meets reality** — one click pre-fills the whole model from your *tracked* incomes and 3-month category averages, and a **plan vs. actually-happened** section scores each month against the model: spent vs. planned with a today marker, fixed bills that match show "✓ paid", and red only ever means *actually over* — never a scary extrapolation.

### The budget (the tracking side, polished first)

- **Four budgeting methods, one engine.** Pick how you want to budget in Settings and the Budget page reframes around it — switch anytime, nothing is lost:
  - **Envelopes (zero-based)** — assign every dollar, watch each envelope's available balance (YNAB-style; the default).
  - **50/30/20** — needs, wants, and savings held inside percentage lines of your take-home (percentages adjustable, e.g. 60/20/20). Every category carries a needs/wants/savings tag you can change.
  - **Pay yourself first** — a monthly savings goal funded off the top ("put $X into savings envelopes"), then one guilt-free "spend the rest" number.
  - **Just track spending** — no limits: income in, spending out, what you kept, top categories.
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
- **Statement import that knows your accounts** — pick which account a statement came from and The Fold remembers that account's format, sign convention, and payer, so future imports are one click. **CSV and OFX/QFX** both work (OFX skips column mapping entirely and dedupes on the bank's own transaction IDs, so overlapping exports never double-import). Every import is an undoable batch, statement credits come in as refunds, an OFX ledger balance can update the account's net-worth snapshot, and anything unclassified lands in the classify queue.
- **Refunds & credits** — returns show up as green `+$` transactions that give money back to the envelope and unwind the who-owes-whom math.
- **Stores with logos** — the add-expense box doubles as a store search: pick "Costco" and its logo and usual category come with it; new stores are created inline. Logos come from each store's website domain (Google's public favicon service, with letter-tile fallbacks), transactions show the store logo with a mini paid-by avatar, imports auto-match stores, and search finds them by name.
- **Duplicate protection** — manual entry warns when something with the same amount already exists nearby, imports pre-check every row against existing transactions (flagged rows arrive unchecked), and a "possible duplicates" review finds same-amount-same-week pairs to keep or delete — with "not a duplicate" decisions remembered.
- **Self-hosted account control** — the first account on the server is the admin; after that, signup is invite-only unless the admin opens registration (Settings → Server). Change your name, email, and password in Settings → Your account — changing the password signs out every other device, and you can see how many devices are signed in (with one-click "sign out everywhere else"). Sign-in attempts are rate-limited, so a bot hammering your login page gets a locked door, not a guessing game.
- **Reconciliation** — every transaction knows whether the bank has confirmed it: imports arrive ✓cleared, manual entries start pending. Filter Spending to an account and tick entries off as your statement shows them (or "mark all cleared"), so a forgotten Venmo or a pending check can't hide.
- **Month in review** — a recap page you can flip back through month by month: what you kept and your savings rate, who spent what by split share, where it went vs budget, which envelopes came in under, went over, or rolled savings forward, and the month's biggest purchases.
- **Insights — your habits, visualized.** A whole page of ways to *see* the money: a GitHub-style spending heatmap of the last 20 weeks, "the burn" (this month's cumulative spend racing last month toward the budget line), your average week by weekday, a money-flow diagram from each income into shared / personal / kept, a proportional "every dollar, to scale" treemap colored by group, the stores you keep going back to, and six-month sparklines per envelope. Habit tiles up top: no-spend days and streaks, your biggest spending day, how much runs on autopilot, and your typical purchase. Every chart has hover tooltips, a see-as-a-table twin, a colorblind-validated palette, and full dark-mode treatment.
- **Your data, exportable & backed up** — Settings → Your data downloads everything as JSON, all transactions as spreadsheet-ready CSV, and (admin) a consistent SQLite backup of the whole server. The server also writes itself a dated backup into `data/backups/` every day and keeps the newest 14 — restoring is copying one file back.
- **Search & filters** — search all spending by text, or filter by category, account, and who paid; every account on the Net worth page links to its activity.
- **Reports** — cash flow (income vs spent vs kept, with savings rate) over 6 or 12 months, where it went by group, biggest movers, and who-spent-it by each person's *share* of the splits.
- **Net worth (the Mint part)** — accounts for checking, savings, investments, retirement, property, and debts — joint or per-person — with dated balance snapshots and a household net-worth trend chart.
- **Calendar feed (live integration)** — an iCal URL that Google Calendar subscribes to: trips, stops, and dated to-dos appear on both your calendars automatically.
- **Home Assistant webhooks** — The Fold POSTs events (chores due, trip countdowns, budget overruns) to an HA webhook trigger; your automations take it from there.
- **API tokens** — scoped bearer tokens so HA, Siri/Google shortcuts, or scripts can add grocery items, complete chores, and read a summary.
- **Dashboard** — month at a glance: shared + personal budget burn, who-owes-whom, net worth, next trip countdown, your open tasks.
- **Tested money math** — a vitest suite covers splits, contributions, balances, recurring, imports, and the API's edge cases (`npm test`).
- **Installable & phone-first** — PWA manifest so it lives on your home screens, a four-tab bottom nav with a More sheet, budget rows and summaries laid out for a 390-px screen, and safe-area padding for notched phones. Dates use *your* clock — an expense added at 9pm never lands on tomorrow.
- **Built to stay up** — if the server restarts mid-use, one slim banner says so and the app quietly reconnects and refetches (no dead white screens); an expired session bounces you to sign-in instead of silently failing. Sessions renew themselves while you keep using the app, cookies turn on `Secure` behind HTTPS automatically, hashed assets cache forever, and the container ships a Docker healthcheck.
- **Day-one guidance** — a "Get set up" checklist on Home (income → first budget → first expense → invite your partner) that checks itself off and gets out of the way.

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
