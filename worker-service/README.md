# worker-service

The agent that does the actual job in this project: it handles fake support
tickets, looks up a fake customer, and can be told to fail on command so the
rest of the system (SigNoz alerts, watcher-service) has something real to
react to. Implements the worker-service section of AGENTS.md and CONTRACTS.md
Sections 1, 3, and 4.

## Why this service exists

Every hackathon team in this track will show a dashboard. What makes this
project different is a second AI agent that watches the first one and fixes
it automatically. But you can't demo "watching and fixing an agent" without
a real agent doing real work that can actually break. worker-service is that
agent: simple on purpose, but wired up so its failures are real, visible in
SigNoz, and fixable through the shared control-plane settings.

## How it fits with the other two services

support ticket
|
v
worker-service <-- reads settings every request
| ^
| traces/errors | writes settings
v |
SigNoz ----alert----> watcher-service
|
v
control-plane (settings + incident log)


- **control-plane** (Talha's service, port 4001) holds the 3 shared switches
  and the incident log. worker-service calls `GET /settings` on it before
  every ticket, to find out how it should behave right now.
- **watcher-service** (Hassan's service, in progress) is the one that
  actually changes those switches, by calling `PUT /settings` on
  control-plane, after diagnosing a problem via SigNoz.
- worker-service never talks to watcher-service directly, and watcher-service
  never talks to worker-service directly. control-plane is the only thing
  standing between them. Neither agent needs to know the other exists.

## What it actually does

1. A ticket comes in via `POST /tickets`.
2. Before doing anything else, it asks control-plane for the current
   settings (`use_backup_data`, `active_model`, `retry_enabled`).
3. If `use_backup_data` is `true`, it skips the real (fake) database lookup
   entirely and returns cached customer data instead. This is the actual fix
   watcher-service applies when the database is down.
4. Otherwise, it tries a real (fake) customer lookup. If the fake database
   has been broken on purpose, this fails, and the ticket comes back with
   `db_broken: true` and a 503.
5. It also reports an `estimated_cost_usd` per ticket, which climbs if the
   cost-spike failure has been triggered and the active model is still the
   expensive one. This is what the second demo failure (cost spike) hooks
   into.

## Debug endpoints, and why they exist

These exist purely so the team can trigger both demo failures on command
during a live demo, instead of waiting for a real bug to happen on cue.

| Endpoint | What it does |
|---|---|
| `POST /debug/break-db` | Turns on the fake database outage. Every ticket lookup fails after this until fixed. |
| `POST /debug/fix-db` | Turns the outage back off. |
| `POST /debug/spike-cost` | Makes `estimated_cost_usd` jump for every ticket, as long as `active_model` is still `gpt-standard`. |
| `POST /debug/fix-cost` | Turns the cost spike back off. |

## Endpoints

### `POST /tickets`

Request: { "customerId": 1 }

Normal response (200):
{ "ticket_id": 4, "customer": { "id": 1, "name": "Test Customer" },
"model": "gpt-standard", "estimated_cost_usd": 0.02, "db_broken": false }

DB broken response (503):
{ "ticket_id": 3, "error": "customer db unreachable",
"model": "gpt-standard", "estimated_cost_usd": 0.02, "db_broken": true }

Backup data response (200, once watcher-service sets use_backup_data=true):
{ "ticket_id": 4, "customer": { "id": 1, "name": "cached-customer" },
"model": "gpt-standard", "estimated_cost_usd": 0.02, "db_broken": false }

If control-plane itself is unreachable (502):
{ "error": "control-plane unreachable" }


### `POST /debug/break-db`, `/debug/fix-db`, `/debug/spike-cost`, `/debug/fix-cost`
Each returns a plain text confirmation (`"db broken"`, `"cost spiked"`, etc.),
no request body needed.

## Files

| File | Role |
|---|---|
| `src/server.js` | Defines all 5 HTTP routes. Reads settings from control-plane before handling each ticket, decides between real lookup and backup data. |
| `src/customerDb.js` | The fake customer database: a real (fake) lookup, plus the on/off switches for the two demo failures. |
| `src/controlPanelClient.js` | The only file that talks to control-plane. One function: `getSettings()`. |
| `src/instrumentation.js` | OpenTelemetry SDK setup, exports traces to SigNoz under the service name `worker-service`. Must be the first thing `server.js` requires. |
| `.env.example` | Template for `PORT`, `CONTROL_PLANE_URL`, and the OpenTelemetry variables. |
| `Dockerfile` | Packages the service for docker-compose. |

## Local setup

Needs control-plane already running (see `control-plane/README.md` for its
own Postgres setup).

```bash
npm install
CONTROL_PLANE_URL=http://localhost:4001 node src/server.js
```

Should print: `worker-service listening on port 4000`

## How to test the full loop by hand

```bash
# Normal ticket
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId": 1}'

# Break the fake DB, ticket now fails
curl -X POST http://localhost:4000/debug/break-db
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId": 1}'

# Simulate watcher-service's fix by flipping the setting directly
curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"use_backup_data","value":true,"updated_by":"you"}'

# Ticket now succeeds again, using cached data
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId": 1}'

# Reset both switches back to normal when done testing
curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"use_backup_data","value":false,"updated_by":"you"}'
curl -X POST http://localhost:4000/debug/fix-db
```

## Verified so far

- `POST /tickets` returns correct data on a normal lookup
- `POST /debug/break-db` correctly causes `/tickets` to return 503 with `db_broken: true`
- Flipping `use_backup_data` to `true` on control-plane (via `PUT /settings`) is picked up on the very next ticket, with no restart needed
- Both switches reset back to a clean state after testing
- `POST /tickets` returns a 502 instead of crashing the process if control-plane is unreachable

## Not done yet

- Not yet confirmed showing up in SigNoz's service list (needs a check in the SigNoz UI)
- Cost-spike scenario is implemented but hasn't been exercised against a real SigNoz alert yet
- No safety check or retry_enabled logic wired in yet, that lives on the watcher-service side
- Not yet run inside its own Docker container, only tested with `node src/server.js` directly