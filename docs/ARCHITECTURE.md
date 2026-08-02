# Architecture

## The core question: how does *one* app hold all of this?

The Fold is a **modular monolith around one shared spine**. The spine is small and boring on purpose:

- **household & members** — everything belongs to the household; most things can be assigned to a member.
- **money** — integer cents everywhere; every expense can carry a *split* (who owes what share).
- **dates** — anything with a date (trip, stop, due item) can surface on the calendar feed.

Every feature is a module that plugs into that spine rather than a separate app:

```
                    ┌─────────────────────────────────────────┐
                    │            household spine              │
                    │   members · money+splits · dates        │
                    └──┬──────┬──────┬──────┬──────┬──────────┘
                       │      │      │      │      │
                    budget  spending  trips  lists  (later: investments,
                    (envelopes) (splits)  (stops+buckets)  (todo/grocery/wish)   recipes, date night)
                       │      │      │      │      │
                    ┌──┴──────┴──────┴──────┴──────┴──────────┐
                    │        integration edge (adapters)      │
                    │  iCal feed · Google APIs · SimpleFIN/   │
                    │  Plaid · SMTP · Home Assistant webhooks │
                    │  · Tandoor · Overseerr · Shy Local      │
                    └─────────────────────────────────────────┘
```

Two rules keep it coherent as it grows:

1. **Features write to the spine, not to each other.** The trip planner doesn't know about budget internals — it *posts a transaction* (the spine's money concept). Recipes won't know about lists — they'll *add list items*. That's why "have it permeate into all these different areas" works: everything already speaks transaction/list-item/event.
2. **Integrations are adapters at the edge.** Google, banks, Home Assistant, Tandoor, Overseerr are all replaceable adapters that translate between an external service and spine concepts. The app never depends on any of them being configured.

## Repo layout

```
shared/     TypeScript types + money/split/income math used by both sides
server/     Fastify API, SQLite schema & migrations, iCal builder, seed script
  src/routes/   auth · household · income · budget · transactions · trips · lists · calendar · summary
web/        React SPA (Vite + Tailwind), one page per module
Dockerfile / docker-compose.yml   single-container deploy; /data volume holds the SQLite file
.github/workflows/docker.yml      publishes ghcr.io image on push to main
```

## Data model (v1)

```
households ─┬─ users ─┬─ income_sources
            │         └─ month_incomes (per-month income override)
            ├─ category_groups ── categories ── allocations (per YYYY-MM month)
            │                     (rollover, target_type/cents/date)
            ├─ transactions ─┬─ transaction_splits    ← who owes whom (Splitwise math)
            │                └─ transaction_lines     ← which envelopes it hit
            ├─ recurring_transactions · import_rules
            ├─ accounts ── account_snapshots          ← net worth over time
            ├─ trips ─┬─ trip_categories (budget buckets)
            │         ├─ trip_stops (ordered; dates, lodging)
            │         └─ trip_expenses (planned + actual; → posted_transaction_id)
            └─ lists ── list_items (assignee, due date, price/url for wishlists)
```

**Two independent split dimensions.** This is the key idea in the money model, and keeping them separate is what makes the messy real-world cases work:

- `transaction_lines` answer *which envelopes does this purchase come out of* — a $240 Costco run is $104 Groceries + $76 Household + $60 Jake's Fun money. Lines are the source of truth for all category spending.
- `transaction_splits` answer *who owes whom* — the same run might be Jake $160.80 / Sam $79.20.

They interact only when you ask them to: the "by category" split mode derives person shares from the lines (a line in someone's personal envelope is theirs alone; shared lines split by the household rule). Everything else — budgets, trends, balances — reads whichever dimension it cares about and ignores the other.

**Rollover is a fold, not a stored balance.** Each category's month-by-month ledger is folded forward in one pass: `available = carryover + allocated − spent`, and `carryover = rollover ? previous available : 0`. Nothing is denormalized, so toggling rollover or fixing an old transaction reprices history correctly with no migration or repair job. Overspend carries as a negative balance rather than silently vanishing.

**Targets are derived too.** A monthly target suggests its own amount; a by-date target computes `ceil((target − balance so far) / months remaining)` so a trip fund tells you what to set aside this month.

Key decisions:

- **Money is integer cents.** No floats, ever. Splits must sum exactly to the amount (server-enforced); remainder cents are distributed deterministically.
- **Balances are derived, not stored.** `net = Σ(paid) − Σ(owed shares)` per person, over all transactions. Settle-ups are just transactions of kind `settlement` (payer = who paid, single split = who received), so the same formula nets them out. No drift, no reconciliation bugs.
- **Budget scopes.** A category is `shared` or `personal(owner)`. Shared allocations are funded by the household split rule (equal / income-proportional / custom %); the app computes each member's contribution and their leftover for personal budgeting. You can have a shared category paid 100% by one person this month — the funding rule and the payment are separate facts.
- **Trips separate *planned* from *actual*.** Every trip expense has `planned_cents` (estimate) and nullable `actual_cents` (what it really cost). Buckets roll up both, so "remaining budget" is honest before and during the trip. Posting to the monthly budget copies the actual into a real transaction and links both ways (`trip_expense_id` ↔ `posted_transaction_id`) so nothing double-counts and deleting either side degrades gracefully.
- **Months are `YYYY-MM` strings, dates are `YYYY-MM-DD`.** All-day semantics, no timezone gymnastics anywhere in v1.

## Auth & security model

- Session cookie (httpOnly, SameSite=Lax), scrypt-hashed passwords, hashed session tokens in the DB, 30-day sliding expiry.
- Every query is scoped by `household_id` from the session — routes cannot reach across households even though today there's only one.
- The calendar feed is the only unauthenticated read, guarded by a random 128-bit token in the URL (rotatable in Settings) — the same model Google/Proton use for secret iCal addresses.
- Designed for LAN/VPN or reverse-proxy exposure. If you put it on the open internet, front it with your usual unRAID reverse proxy (SWAG/NPM) + HTTPS; cookie `Secure` flag and rate limiting are on the roadmap alongside remote access.

## Why SQLite (and when it would change)

Two users, single writer, tiny working set: SQLite in WAL mode is the honest fit — one file in `/data`, backup = copy, zero services to babysit. The escape hatch if the app ever grows real multi-tenant ambitions is Postgres; the data layer is plain SQL behind small query functions, so the migration is mechanical rather than architectural.

## Extension points that already exist

- **`shared/` types** are the contract between server and web — new modules add types there first.
- **Migrations** are numbered SQL batches in `server/src/db.ts`; the runner applies anything newer than the DB's version.
- **The iCal feed** is the template for outbound adapters: pure function from spine data → external format.
- **`settings` table** (per-household key/value) is where integration credentials/config will live (Google tokens, SimpleFIN access URLs, HA webhook secrets) — encrypted-at-rest is planned before the first credential lands there.
