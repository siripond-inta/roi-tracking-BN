# ROI Tracking — Backend

Express 5 + MySQL API. Database schema/migrations are managed with **Drizzle ORM**; the whole
stack (MySQL + migrations + API) can be run with Docker Compose.

```
roi-tracking-BN/
├── config/db.config.js   Raw mysql2 pool used by the current controllers
├── controllers/ routes/ middleware/   Express app code
├── services/
│   ├── finance.js        All ROI / cash-flow / payback logic (pure functions, no DB access)
│   └── ledger-input.js   Validates ledger input and expands month ranges into monthly rows
├── tests/                Unit tests for services/ (`npm test`)
├── db/
│   ├── schema.js         Drizzle table definitions — source of truth for the DB schema
│   ├── index.js          Drizzle client instance (mysql2 pool + drizzle()), for new/refactored code
│   └── seed.js           Resets + fills every table with mock data (see "Seeding mock data")
├── drizzle/              Generated SQL migrations (drizzle-kit generate output)
├── drizzle.config.js
├── Dockerfile
└── docker-compose.yml    mysql + migrate + seed (on-demand) + backend
```

## Database schema & Drizzle ORM

Manual table creation via phpMyAdmin has been replaced by **Drizzle ORM**. The schema lives as
code in [`db/schema.js`](db/schema.js) and is the single source of truth — tables are
created/updated by generating and running migrations instead of clicking through phpMyAdmin.

The schema implements the `roi_tracking_db` DBML spec (v1.2 — Gap Analysis Update): `users`,
`project_types`, `entry_types`, `categories`, `projects`, `project_access`, `project_ledger`,
`system_settings`.

Notable columns:

- `categories.category_group` — `REV` (direct revenue), `BEN` (indirect benefit), `INV` / `OPC` /
  `ADC` (investment / operating / additional cost). The group decides the category code prefix
  (`REV001`, `BEN002`, …), whether it is an inflow or outflow, and how it is counted (see below).
  `BEN` categories must have `unit_label` + `rate_label` (e.g. "hours saved per month" ×
  "hourly wage").
- `categories.allow_custom_name` — an "other" category (`REVOTH`, `BENOTH`, `INVOTH`, `OPCOTH`,
  `ADCOTH`, added by migration `0004`): the user must type the item name, stored in
  `project_ledger.custom_name`, and reports show that name instead of the category's.
- `project_types.calculation_method` — `REVENUE`, `COST_SAVING` or `MIXED`.
- `projects.status` — `planning`, `in_progress`, `completed` (and `archived`).
- `project_ledger` — one row per project, phase (`ESTIMATED` / `ACTUAL`) and month
  (`period_index`); indirect benefits also store `unit_qty` × `unit_cost`.

## How ROI is calculated

All calculations live in [`services/finance.js`](services/finance.js) and every endpoint that
returns figures (project list, report analytics, form preview) goes through it, so the numbers
match on every page.

| Source | Category group | Entered as | Counted when project type is |
|---|---|---|---|
| Direct revenue | `REV` | amount (THB) per month | `REVENUE`, `MIXED` |
| Indirect benefit | `BEN` | quantity per month × rate per unit | `COST_SAVING`, `MIXED` |
| Cost | `INV` / `OPC` / `ADC` | amount (THB) per month | always |

- **ROI (%)** = (counted benefit − cost) ÷ cost × 100
- **Payback period (months)** = total cost ÷ (total counted benefit ÷ number of months), shown with
  one decimal — e.g. 661,000 ÷ (1,086,000 ÷ 12) = 7.3 months. Estimated figures use the project
  duration; actual figures use the months recorded so far. `null` when there is no benefit yet.
- **Indirect benefit, annualized** = average monthly indirect benefit × 12
- **Break-even month** (`breakEvenMonth`) = the month the cumulative cash flow (the chart) climbs back to 0,
  interpolated within the month — e.g. 6.2. `null` while cumulative cash is still negative. Shown next to
  the payback figure because the average-based payback can differ when monthly benefits are uneven.
- **ROI when there is no cost** = `null` (shown as "—") instead of 0%.
- **Worthwhile** = ROI ≥ the project's `target_roi_percent`, judged on: the estimate (no actual data yet),
  the actual figures (all months recorded, or the project is completed), or — while actual data covers only
  part of the project — the **projected** full-project ROI = actual months so far + plan for the remaining
  months (`summary.projected`, `worthwhileBasis: 'projected'`). A project with benefit but no cost counts as
  worthwhile.
- Benefits that were entered but aren't counted for the project's type are reported separately as
  `excludedBenefit` instead of being silently dropped.

Project status is kept in sync automatically: saving the first actual data moves a project from
`planning` to `in_progress`, removing all actual data moves it back (and makes it private again),
`in_progress` / `completed` require actual data, and `completed` / `archived` projects reject ledger
changes as well as changes to project type, duration and target ROI.

Every authenticated request re-reads the user's role and `is_active` from the database, so a demoted or
deactivated account loses access immediately instead of when its 24-hour token expires.

## Entering ledger data

`PUT /api/projects/:id/ledgers/estimated` and `.../actual` replace all rows of that phase (in a
transaction — nothing is lost if validation fails). Each item covers a range of months; the API
expands it into one row per month and derives the entry type and transaction date from the
category and project start date:

```json
{ "ledgers": [
  { "category_id": "INV001", "total_value": 150000, "period_from": 1, "period_to": 1 },
  { "category_id": "BEN001", "unit_qty": 80, "unit_cost": 250, "period_from": 2, "period_to": 12, "note": "Less manual reporting" },
  { "category_id": "REV001", "total_value": 20000, "period_from": 3, "period_to": 12 }
] }
```

Negative numbers, month ranges outside the project duration, and indirect benefits with only a
quantity or only a rate are rejected with a 400 and a Thai error message.

`POST /api/projects/:id/analytics/preview` takes the same `{ phase, ledgers }` body and returns the
analytics as if those rows were saved (nothing is written). The report forms use it to show live
ROI / payback while the user is typing.

## Tests

| Level | Tool | Files | Command | Result file |
|---|---|---|---|---|
| Unit | Jest | `tests/unit/*.test.js` (finance, ledger input, auth middleware) | `npm run test:unit` | — |
| Integration (API) | Jest + Supertest | `tests/api/*.test.js` (auth, roles, projects, ledgers, calculations, admin, community) | `npm run test:api` | — |
| Unit + API with report | Jest | all of the above | `npm run test:report` | `test-reports/backend/jest-report.html`, `test-reports/backend/coverage/index.html` |
| API (system) | Postman / Newman | `postman/roi-tracking.postman_collection.json` | `npm run test:postman` | `test-reports/postman/newman-report.html` |

- `npm test` runs unit + API tests. Every test name starts with an ID (`IT-AUTH-01`, `IT-CAL-02`, …) so it
  can be referenced in documentation.
- The API tests use a **separate database** (`roi_tracking_test`, override with `TEST_DB_NAME`): it is
  dropped, migrated and seeded on every run using `MYSQL_ROOT_PASSWORD` from `.env`, so they never
  touch real data. MySQL (`docker compose up -d`) must be running.
- The Postman collection runs against the **running** backend (`npm run dev`) with the seeded demo
  accounts; it creates its own test project and deletes it at the end. Import the same file into
  Postman to run it from the Collection Runner.
- `test-reports/` is generated and git-ignored.

### Common commands

| Command | What it does |
|---|---|
| `npm run db:generate` | Diffs `db/schema.js` against the last migration and writes new SQL files to `drizzle/`. Run this after editing the schema. |
| `npm run db:migrate` | Applies pending SQL migrations from `drizzle/` to the database (tracked in a `__drizzle_migrations` table). This is what creates the tables — no phpMyAdmin needed. |
| `npm run db:push` | Dev-only shortcut: pushes the schema straight to the DB without generating migration files. Good for quick local iteration; use `generate` + `migrate` for anything you want tracked/reviewable. |
| `npm run db:studio` | Opens [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) in the browser to browse/edit data. |
| `npm run db:seed` | Resets and fills every table with mock data. See "Seeding mock data" below. |

These read DB connection settings from `.env` (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
optional `DB_PORT`) via `drizzle.config.js`.

## Seeding mock data

[`db/seed.js`](db/seed.js) **deletes all rows** in every table and inserts a consistent mock
dataset:

- 5 users: `nichakan@`, `somchai@` (not logged in for 4 years — shows up as dormant in the admin
  page) and `araya@example.com` (`project_owner`), `admin@example.com` (`admin`),
  `viewer@example.com` (`viewer`, read-only)
- the 3 project types (`REVENUE` / `COST_SAVING` / `MIXED`) and the categories for direct revenue,
  the 4 indirect benefits (staff time, documents, project analysis, error costs) and costs
- 9 projects — one of every project type × status combination — with estimated data, and actual
  data for the `in_progress` (6 months) and `completed` (12 months) ones. Projects with actual
  data are public (shared read-only via `project_access`).

All seeded users share the same demo password: **`Passw0rd!`** (e.g. `nichakan@example.com` /
`Passw0rd!`).

```bash
npm run db:seed              # local, uses .env
docker compose run --rm seed # against the dockerized mysql
```

Re-run it any time you want to reset back to a clean, predictable dataset. Don't run it against a
database that has real data you want to keep.

## Day-to-day dev workflow

Rebuilding/restarting a Docker container on every code change is slow. The normal workflow while
actively developing is:

```bash
docker compose up -d       # only mysql (+ migrate) start by default — see table below
npm install
npm run dev                 # nodemon server.js on :3000, using .env (points at the dockerized mysql)
```

`.env`'s `DB_HOST`/`DB_USER`/`DB_PASSWORD` already point at the dockerized mysql's published port
(`localhost:3306`, app user `roi_app`), so `npm run dev` talks to the same database Docker manages
— no separate local MySQL install needed. Use `docker compose --profile full up -d --build` only
when you specifically want to test the fully containerized `backend` image too.

## Running with Docker

`docker-compose.yml` in this folder starts:

| Service | Purpose | Default port |
|---|---|---|
| `mysql` | Database, persisted in the `mysql_data` volume | `3306` |
| `migrate` | Runs automatically on every `up`. Applies pending Drizzle migrations, then exits (`Exited (0)` is success, not an error) — creates all tables, no phpMyAdmin needed | — |
| `seed` | **Not** run automatically (`profiles: [tools]`) — fills every table with mock data on demand: `docker compose run --rm seed`. See "Seeding mock data" | — |
| `backend` | **Not** run automatically (`profiles: [full]`) — see "Day-to-day dev workflow" above. Use `docker compose --profile full up -d` to include it | `3000` |

The compose file also sets a top-level `name: roi-tracking`. `roi-tracking-FN`'s
`docker-compose.yml` declares the same name, so even though they're separate repos started with
separate `docker compose up` commands, both show up grouped under one "roi-tracking" stack in
Docker Desktop, and share the same default Docker network.

No DB browser container is included — connect a regular MySQL client (e.g. DBeaver, TablePlus)
to `localhost:3306` instead: use `DOCKER_DB_USER`/`DOCKER_DB_PASSWORD` from `.env` for the app
database, or `root`/`MYSQL_ROOT_PASSWORD` for full access.

> **DBeaver / MySQL Workbench "Public Key Retrieval is not allowed":** MySQL 8's default auth
> plugin (`caching_sha2_password`) needs the client to fetch the server's public key to encrypt
> the password, which most GUI clients refuse to do automatically unless you allow it. In the
> connection's driver properties, set `allowPublicKeyRetrieval=true` and `useSSL=false` (fine for
> local dev over `localhost`).

### First-time setup

```bash
cp .env.example .env   # then edit values if you want
docker compose up --build
```

This starts MySQL, waits for it to become healthy, runs `migrate` to create all tables from the
Drizzle migrations, then starts the API on http://localhost:3000.

### Everyday commands

```bash
docker compose up -d              # start in the background
docker compose logs -f backend    # tail logs for one service
docker compose down               # stop and remove containers (keeps the mysql_data volume)
docker compose down -v            # also wipe the database volume (fresh start)
```

### Changing the schema later

1. Edit `db/schema.js`.
2. `npm run db:generate` to create a new migration file.
3. `docker compose up --build migrate` (or `docker compose run --rm migrate`) to apply it, then
   restart the API: `docker compose up -d backend`.

### Notes

- The `mysql`/`migrate`/`backend` containers do **not** use the `DB_HOST`/`DB_USER`/`DB_PASSWORD`
  values from `.env` — those are only for running the backend directly with `node`/`nodemon`
  against a locally installed MySQL. Docker gets its own root password (`MYSQL_ROOT_PASSWORD`) and
  a dedicated non-root application user (`DOCKER_DB_USER`/`DOCKER_DB_PASSWORD`), and `DB_HOST` is
  hardcoded to `mysql` (the compose service name) inside `docker-compose.yml`.
- This repo's frontend counterpart (`roi-tracking-FN`) has its own separate `docker-compose.yml`
  and calls this API at `http://localhost:3000` from the browser, so as long as this stack's
  `3000` port is published to the host, the two can run independently side by side.

## Running without Docker (local dev)

```bash
npm install
npm run db:migrate   # create tables in your local MySQL (reads .env)
npm run dev           # nodemon server.js on :3000
```
