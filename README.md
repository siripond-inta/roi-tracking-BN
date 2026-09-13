# ROI Tracking — Backend

Express 5 + MySQL API. Database schema/migrations are managed with **Drizzle ORM**; the whole
stack (MySQL + migrations + API) can be run with Docker Compose.

```
roi-tracking-BN/
├── config/db.config.js   Raw mysql2 pool used by the current controllers
├── controllers/ routes/ middleware/   Express app code
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

> **Heads-up:** this schema matches the new DBML spec, which is *not* identical to what the
> current controllers/frontend actually query today (e.g. `users.company_name`,
> `projects.is_public` / `custom_project_type`, and lowercase `'Estimated'/'Actual'` phase values
> used in `controllers/project.controller.js` aren't part of the new schema; the new schema also
> adds required fields like `project_ledger.period_index`). Drizzle + Docker setup was done first
> by request — updating the application code to match this schema is a follow-up task.

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
dataset: 3 users (`project_owner` role), 3 projects each (9 total), a mix of `public` projects
(shared as read-only to the other two users via `project_access`, `permission_level: 'viewer'`)
and `private` projects (no access rows for anyone but the owner), plus estimated/actual
`project_ledger` entries, categories, entry types, project types, and system settings.

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
