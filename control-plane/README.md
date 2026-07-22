# control-plane

## What this service is

`control-plane` is the shared brain that `worker-service` and `watcher-service`
both talk to. It does not do any diagnosis or ticket handling itself, it just
holds two things in Postgres and hands them out over a small HTTP API:

1. **3 settings switches** (`use_backup_data`, `active_model`, `retry_enabled`)
   that `worker-service` reads before every ticket, and that `watcher-service`
   flips when it decides a fix is needed.
2. **An incident log** that `watcher-service` writes to every time it reacts
   to an alert, so there's a permanent record outside of SigNoz.

Every field name and endpoint shape below is copied exactly from
[`CONTRACTS.md`](../CONTRACTS.md) Sections 1 and 5. If something here ever
looks like it disagrees with `CONTRACTS.md`, `CONTRACTS.md` wins, and this
file needs fixing.

---

## File-by-file

| File | Role |
|---|---|
| [`package.json`](package.json) | Declares dependencies (express, pg, OpenTelemetry packages) and the `npm start` script. |
| [`migrations/001_init.sql`](migrations/001_init.sql) | Creates the `control_settings` and `incidents` tables. Not run automatically, see [Database setup](#database-setup) below. |
| [`.env.example`](.env.example) | Template listing every environment variable this service reads. Copy to `.env` (or set via docker-compose) for a real run. |
| [`src/db.js`](src/db.js) | The only file that talks to Postgres. Exposes 4 functions: `getSettings`, `setSetting`, `createIncident`, `listIncidents`. No Express code lives here. |
| [`src/instrumentation.js`](src/instrumentation.js) | Sets up the OpenTelemetry SDK (service name, OTLP exporter to SigNoz, auto-instrumentation for Express/HTTP). Must be the first thing `server.js` requires. |
| [`src/server.js`](src/server.js) | Defines the 4 HTTP routes and wires each one to the matching `db.js` function. Deliberately thin. |
| [`Dockerfile`](Dockerfile) | Packages the service for `docker-compose up` alongside SigNoz and the other two services. |
| [`.gitignore`](.gitignore) | Keeps `node_modules/` and a real `.env` out of git. |

---

## Request lifecycle (what actually happens when a request arrives)

1. Node loads `src/server.js`. Its literal first line is
   `require('./instrumentation')`, so the OpenTelemetry SDK is wired up
   *before* Express even exists, which is what makes every route below show
   up as a traced span in SigNoz automatically, with no per-route code needed.
2. Express parses the request. `express.json()` middleware turns the request
   body into `req.body` for `PUT /settings` and `POST /incidents`.
3. The route handler in `server.js` calls exactly one function on `db.js`,
   never writes SQL itself.
4. `db.js` runs the query against Postgres through its connection pool and
   returns plain JS values (objects/arrays), never raw pg row objects with
   driver-specific quirks left in.
5. `server.js` sends that value back as JSON with the status code documented
   below.

Nothing here retries, queues, or caches: a request either succeeds and
returns, or throws and Express's default error handling turns it into a
500. That's intentional for a hackathon MVP: correctness and legibility over
resilience.

---

## Endpoints

### `GET /settings`
Returns the 3 switches merged over their defaults (`use_backup_data=false`,
`active_model='gpt-standard'`, `retry_enabled=true`). Any key never written to
`control_settings` yet falls back to its default, which is why the response
always has all 3 keys even on a brand-new database.

```
200 OK
{ "use_backup_data": false, "active_model": "gpt-standard", "retry_enabled": true }
```

### `PUT /settings`
The only door `watcher-service` has into changing worker-service's behavior.

Request body:
```json
{ "key": "use_backup_data", "value": true, "updated_by": "watcher" }
```

- `key` must be exactly one of `use_backup_data`, `active_model`,
  `retry_enabled`. Anything else is rejected before touching the database.
- On success, `db.setSetting` does an upsert (`INSERT ... ON CONFLICT (key)
  DO UPDATE`) so the first write to a key and every write after it take the
  same code path.
- The response is the *fresh, full* settings object (a re-read via
  `getSettings`), not just the one key that changed, so a caller never has
  to guess what the other two switches currently are.

```
200 OK  -> full updated settings object
400 Bad Request -> { "error": "unknown key" }   (key not in the allowed list)
```

### `POST /incidents`
`watcher-service` calls this every time it reacts to an alert, whether it
applied a fix or blocked itself via the safety check.

Request body (all 6 fields expected, matching `CONTRACTS.md` Section 5):
```json
{
  "detected_via": "db-error-rate-alert",
  "diagnosis": "customer-db unreachable, 5 consecutive failures",
  "action_taken": "use_backup_data=true",
  "safety_check_result": "allowed",
  "cost_before": 0.02,
  "cost_after": 0.02
}
```

```
201 Created
{ "id": 7 }
```

`id` is the new row's serial primary key, enough for the caller to
reference it later, no need to echo the whole row back.

### `GET /incidents`
Returns every incident, most recent first (`ORDER BY started_at DESC`).
This is the paper trail: even if SigNoz's UI is misbehaving during a demo,
this endpoint independently proves the watcher did something and when.

```
200 OK
[ { "id": 7, "started_at": "...", "resolved_at": null, "detected_via": "...", ... }, ... ]
```

---

## Database setup

`001_init.sql` is plain SQL, nothing in this service runs it automatically.
Run it by hand, once, after Postgres is up:

```bash
psql -h <host> -p <port> -U hackathon -d hackathon -f migrations/001_init.sql
```

It uses `CREATE TABLE IF NOT EXISTS`, so re-running it is harmless.

### Current dev setup (as of this write-up)

There is no `docker-compose.yml` in this repo yet (worker-service and
watcher-service aren't built), so for local development a standalone
Postgres container was started by hand:

```bash
docker run -d --name app-postgres --network signoz-network -p 55432:5432 \
  -e POSTGRES_USER=hackathon -e POSTGRES_PASSWORD=hackathon -e POSTGRES_DB=hackathon \
  postgres:16
```

- It's attached to `signoz-network` (the same Docker network SigNoz's own
  containers use) so that once a real `docker-compose.yml` exists, other
  services can reach it by container name `app-postgres` on the container's
  internal port `5432`, matching `.env.example`'s
  `postgres://hackathon:hackathon@app-postgres:5432/hackathon`.
- The host port is mapped to **55432**, not 5432, because a native Postgres
  install already owns port 5432 on this machine. Host port 55432 is a local
  testing detail only, nothing in the service code hardcodes it. It's purely
  what you pass to `psql`/`DATABASE_URL` when connecting *from the host*
  instead of from inside another container.
- `migrations/001_init.sql` has already been run against it; both tables
  exist.

### Running the service locally against it

```bash
cd control-plane
npm install     # already done, see below
PORT=4001 \
DATABASE_URL=postgres://hackathon:hackathon@localhost:55432/hackathon \
OTEL_SERVICE_NAME=control-plane \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces \
node src/server.js
```

(SigNoz's OTLP collector is already running with ports 4317/4318 published
to the host, so `localhost:4318` works for a locally-run process; a
containerized `control-plane` would instead use the `signoz-otel-collector`
hostname as in `.env.example`.)

---

## Verified so far

- `npm install` completed successfully (249 packages).
- All 4 endpoints were smoke-tested against the real `app-postgres` database
  above:
  - `GET /settings` → 200, correct defaults on an empty table.
  - `PUT /settings` with a valid key → 200, returns updated full settings;
    change persisted on a follow-up `GET`.
  - `PUT /settings` with an invalid key → 400 `{ "error": "unknown key" }`.
  - `POST /incidents` → 201 `{ "id": 1 }`.
  - `GET /incidents` → 200, array containing the row just created.

**Not yet verified:** the service running inside its own Docker container
(only run directly with `node` so far), and its appearance in SigNoz's
service list under the name `control-plane`. There's no `docker-compose.yml`
wiring it in yet.
