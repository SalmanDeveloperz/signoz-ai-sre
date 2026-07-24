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

## Architecture: layered (routes -> controllers -> services -> repositories)

The service is split into 4 layers plus a shared Postgres connection, each
with exactly one job:

- **routes**: map a URL + HTTP verb to a controller function. No logic.
- **controllers**: read `req`, call one service function, write `res`. No SQL,
  no business rules.
- **services**: hold business rules (e.g. which setting keys are valid). This
  is the only layer allowed to make a decision.
- **repositories**: hold every raw SQL statement for one table. This is the
  only layer allowed to talk to Postgres.
- **db/pool.js**: the single shared `pg.Pool` instance every repository
  imports, so the process never opens more than one connection pool.

A change to a business rule (e.g. adding a 4th valid setting key) touches a
service file only. A change to the schema touches a repository file only. A
change to a URL path touches a route file only.

## File-by-file

| File | Role |
|---|---|
| [`package.json`](package.json) | Declares dependencies (express, express-async-errors, pg, OpenTelemetry packages) and the `npm start` script. |
| [`migrations/001_init.sql`](migrations/001_init.sql) | Creates the `control_settings` and `incidents` tables. Not run automatically, see [Database setup](#database-setup) below. |
| [`.env.example`](.env.example) | Template listing every environment variable this service reads. Copy to `.env` (or set via docker-compose) for a real run. |
| [`src/db/pool.js`](src/db/pool.js) | Singleton `pg.Pool`, connected via `DATABASE_URL`. The only file that constructs a Pool. |
| [`src/repositories/settings.repository.js`](src/repositories/settings.repository.js) | All raw SQL for `control_settings`. Exposes `getSettings()`, `setSetting()`. |
| [`src/repositories/incidents.repository.js`](src/repositories/incidents.repository.js) | All raw SQL for `incidents`. Exposes `createIncident()`, `listIncidents()`. |
| [`src/services/settings.service.js`](src/services/settings.service.js) | Business rule: which setting keys are valid. Calls the settings repository. |
| [`src/services/incidents.service.js`](src/services/incidents.service.js) | Passthrough to the incidents repository today; the seam for future incident rules. |
| [`src/controllers/settings.controller.js`](src/controllers/settings.controller.js) | `req`/`res` handling for `/settings`. Calls the settings service only. |
| [`src/controllers/incidents.controller.js`](src/controllers/incidents.controller.js) | `req`/`res` handling for `/incidents`. Calls the incidents service only. |
| [`src/routes/settings.routes.js`](src/routes/settings.routes.js) | `express.Router()` mapping `GET/PUT /settings` to the settings controller. |
| [`src/routes/incidents.routes.js`](src/routes/incidents.routes.js) | `express.Router()` mapping `POST/GET /incidents` to the incidents controller. |
| [`src/instrumentation.js`](src/instrumentation.js) | Sets up the OpenTelemetry SDK (service name, OTLP exporter to SigNoz, auto-instrumentation for Express/HTTP). Must be the first thing `server.js` requires. |
| [`src/server.js`](src/server.js) | Wiring only: mounts both routers, `express.json()`, and the error-handling middleware. No route definitions, no SQL, no business rules. |
| [`Dockerfile`](Dockerfile) | Packages the service for `docker-compose up` alongside SigNoz and the other two services. |
| [`.gitignore`](.gitignore) | Keeps `node_modules/` and a real `.env` out of git. |

---

## Request Flow

**Middleware chain, in order, for every request:**
1. `express.json()`: parses the body into `req.body` if present.
2. Route matching: the mounted router (`settings.routes.js` or
   `incidents.routes.js`) matches path + verb.
3. Controller function for that route runs.
4. Error-handling middleware: only runs if something in step 3 throws or
   rejects.

**Success path, `GET /settings` (read):**
1. HTTP request in: `GET /settings`.
2. `express.json()` runs (no body to parse, passes through).
3. `settings.routes.js` matches `GET /settings` -> `settingsController.getSettings`.
4. `settings.controller.js: getSettings()` runs, calls `settingsService.getSettings()`.
5. `settings.service.js: getSettings()` runs, calls `settingsRepository.getSettings()`.
6. `settings.repository.js: getSettings()` runs `SELECT key, value FROM control_settings`.
7. `db/pool.js` executes the query against Postgres, returns rows.
8. Repository merges rows over `DEFAULT_SETTINGS`, returns a plain object.
9. Service returns that object unchanged.
10. Controller sends `res.status(200).json(...)`.

**Success path, `PUT /settings` (write):**
1. HTTP request in: `PUT /settings` with JSON body `{ key, value, updated_by }`.
2. `express.json()` parses the body into `req.body`.
3. `settings.routes.js` matches `PUT /settings` -> `settingsController.updateSetting`.
4. `settings.controller.js: updateSetting()` reads `key`, `value`, `updated_by`
   from `req.body`, calls `settingsService.updateSetting(key, value, updated_by)`.
5. `settings.service.js: updateSetting()` checks `key` against `VALID_KEYS`.
   - If invalid: returns `{ error: 'unknown key' }`, no repository call, no SQL runs.
   - If valid: calls `settingsRepository.setSetting(key, value, updatedBy)`,
     then `settingsRepository.getSettings()` for a fresh read.
6. `settings.repository.js: setSetting()` runs the `INSERT ... ON CONFLICT
   (key) DO UPDATE` upsert via `db/pool.js`.
7. Service returns `{ settings: <fresh object> }` or `{ error: ... }`.
8. Controller: if `result.error`, `res.status(400).json({ error })`; else
   `res.status(200).json(result.settings)`.

**Error path:**
1. A repository call's `pool.query(...)` promise rejects (e.g. Postgres
   unreachable, constraint violation).
2. The controller function is `async`, so the rejection propagates as a
   thrown error inside an Express handler.
3. `express-async-errors` (required at the top of `server.js`, before routes
   are mounted) patches Express so this rejection is forwarded to the error
   middleware instead of crashing the process or hanging the request.
4. The 4-argument error middleware in `server.js` runs: `console.error(err)`,
   then `res.status(500).json({ error: 'internal error' })`.

**404 path:**
1. Request hits a path/verb no router matches (e.g. `GET /nope`).
2. Both mounted routers decline to match, control falls through to Express's
   built-in default handler (no custom 404 handler is defined in this
   service).
3. Express sends its default response: `404 Not Found`, HTML body
   `Cannot GET /nope` (or the matching verb).

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
  `retry_enabled` (checked in `settings.service.js`). Anything else is
  rejected before touching the database.
- On success, `settings.repository.js` does an upsert (`INSERT ... ON
  CONFLICT (key) DO UPDATE`) so the first write to a key and every write
  after it take the same code path.
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

- `npm install` completed successfully (flat version, 249 packages; layered
  version adds `express-async-errors`, 251 packages).
- All 4 endpoints were smoke-tested against the real `app-postgres` database,
  both before and after the routes/controllers/services/repositories split,
  with identical request/response shapes both times:
  - `GET /settings` → 200, correct merged settings.
  - `PUT /settings` with a valid key → 200, returns updated full settings;
    change persisted on a follow-up `GET`.
  - `PUT /settings` with an invalid key → 400 `{ "error": "unknown key" }`.
  - `POST /incidents` → 201 `{ "id": ... }`.
  - `GET /incidents` → 200, array containing the row just created, most
    recent first.
  - `GET` on an unmatched path → 404, Express's default HTML body.

**Not yet verified:** the service running inside its own Docker container
(only run directly with `node` so far), and its appearance in SigNoz's
service list under the name `control-plane`. There's no `docker-compose.yml`
wiring it in yet.
