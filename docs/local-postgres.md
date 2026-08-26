# Local Postgres

This project expects a Postgres instance reachable via `DATABASE_URL`. Docker
wasn't available in the environment this was built in (daemon not running, no
root access), so a native `initdb`-created cluster was used instead — no
Docker required, and no root/sudo either.

## One-time setup

```bash
initdb -D pgdata -U herdsafe --auth=trust --no-locale --encoding=UTF8
```

`pgdata/` is gitignored — it's local state, not part of the repo.

## Start / stop

```bash
# start (background), logs to pgdata/logfile
pg_ctl -D pgdata -l pgdata/logfile -o "-p 5433 -k $(pwd)/pgdata" start

# stop
pg_ctl -D pgdata stop

# check status
pg_ctl -D pgdata status
```

Port **5433** (not the default 5432) was chosen deliberately — this machine
already had a different Postgres server bound to 5432 for another project, and
this setup avoids touching it.

## Create the database (first time only)

```bash
psql -h 127.0.0.1 -p 5433 -U herdsafe -d postgres -c "CREATE DATABASE herdsafe;"
```

## If you'd rather use Docker

If Docker is available in your environment, a `docker-compose.yml` equivalent
is trivial to add back — a single `postgres:16-alpine` service, since nothing
in the app code depends on how Postgres is hosted (that's the point of driving
everything off `DATABASE_URL`, per the architecture rules in `PROJECT_GUIDE.md`
Section 7). Not included here since it wasn't usable in this environment.

## Switching to hosted Postgres later

Just change `DATABASE_URL` in `.env.local` (e.g. to a Neon/Supabase/Railway
connection string) and re-run `npx prisma migrate deploy`. No code changes.
