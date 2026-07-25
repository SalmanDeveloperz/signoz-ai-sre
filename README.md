# signoz-ai-sre

SigNoz Hackathon by Tourists. An AI SRE demo: a fake ticket-answering service (`worker-service`) breaks on command, SigNoz detects it, a second AI agent (`watcher-service`) diagnoses and fixes it automatically through a shared settings service (`control-plane`).

Full data contracts: [`CONTRACTS.md`](CONTRACTS.md). Agent/AI working rules: [`AGENTS.md`](AGENTS.md).

---

## The 3 services and the idea

```
support ticket
     |
     v
worker-service  <-- reads settings every request
   |      ^
   | traces/errors      | writes settings, reads settings
   v      |
 SigNoz -----alert----> watcher-service
                              |
                              v
                control-plane (settings + incident log)
```

Nobody talks to worker-service or watcher-service to change behavior. The only shared state is control-plane's `/settings`. That's the whole design: one agent misbehaves, a second agent watches and corrects it, entirely through one shared control point.

---

## Status matrix

| Service | Built | Talks to control-plane | Runs in docker-compose | Real SigNoz-driven behavior |
|---|:---:|:---:|:---:|:---:|
| **control-plane** | Yes | n/a (it *is* the store) | Yes | Yes, both other services' traces reach SigNoz |
| **worker-service** | Yes | Yes, reads `/settings` per ticket | Yes | Tickets work, `/debug/*` failure switches work |
| **watcher-service** | Yes (skeleton) | Client code exists, unused | Yes | No, diagnose/safety-check/apply/report are stubs |

**One-line summary:** control-plane and worker-service are solid and tested end to end. watcher-service receives alerts and logs them, but doesn't diagnose or act on anything real yet, that's the one piece standing between this and a fully automatic demo.

---

## Use cases (what this is meant to demo)

| # | Use case | Trigger | Works today? |
|---|---|---|---|
| UC1 | Normal operation | `POST /tickets` | Yes |
| UC2 | Database outage → auto-fix | `POST /debug/break-db` on worker-service, SigNoz alert fires, watcher-service should flip `use_backup_data` | Failure + manual fix work. Automatic detection→fix not wired (watcher-service stub). |
| UC3 | Cost spike → auto-fix | `POST /debug/spike-cost`, SigNoz alert fires, watcher-service should flip `active_model` | Failure + manual fix work. Automatic detection→fix not wired. |
| UC4 | Safety check blocks an unsafe fix | watcher-service tries `retry_enabled=false` while `use_backup_data=true` | Not wired, `safetyCheck.js` is a stub that allows everything. |
| UC5 | Incident history / audit trail | `GET /incidents` on control-plane | Works, but nothing writes to it automatically yet since watcher-service never calls `reportIncident()`. |
| UC6 (stretch) | watcher-service queries SigNoz directly for real telemetry | `signozClient.js` | Stub, returns empty logs. |

---

## control-plane, in depth

Owns 2 things in Postgres: 3 settings switches, and an incident log. Layered structure: `routes` → `controllers` → `services` → `repositories` → `db/pool.js`.

| Endpoint | What it does |
|---|---|
| `GET /settings` | Returns the 3 switches (`use_backup_data`, `active_model`, `retry_enabled`), merged over defaults. |
| `PUT /settings` | The *only* way any service changes behavior. Rejects unknown keys with 400. Returns the fresh full settings object. |
| `POST /incidents` | Appends one incident row (`detected_via`, `diagnosis`, `action_taken`, `safety_check_result`, `cost_before/after`). |
| `GET /incidents` | Lists all incidents, most recent first. |

Full file-by-file breakdown and request lifecycle: **[`control-plane/README.md`](control-plane/README.md)**.

---

## worker-service, in depth

| Endpoint | What it does |
|---|---|
| `POST /tickets` | Reads `/settings` from control-plane first. If `use_backup_data`, returns cached data without touching the fake DB. Otherwise looks the customer up; 503 if the fake DB is broken. Cost is `0.85` if spiked and `active_model` is still `gpt-standard`, else `0.02`. |
| `POST /debug/break-db` / `/debug/fix-db` | Toggles the fake DB's broken flag. |
| `POST /debug/spike-cost` / `/debug/fix-cost` | Toggles the fake cost-spike flag. |

All in-memory state, resets on restart. Full details, endpoint examples, verified test log: **[`worker-service/README.md`](worker-service/README.md)**.

---

## watcher-service, in depth

**Purpose:** the thing that wakes up when SigNoz sees something wrong, and is the only service allowed to change control-plane's settings on the app's behalf.

| File | Purpose | State today |
|---|---|---|
| `src/controllers/alerts.controller.js` | Responds `200 {received:true}` to SigNoz immediately, then hands off to remediation in the background (so SigNoz's webhook never times out and re-sends). | Working |
| `src/services/remediation.service.js` | **The agent loop.** Fixed order: 1) diagnose → 2) safety check → 3) apply fix via control-plane → 4) report incident. | Only step 1 runs. Steps 2-4 are commented-out TODOs. |
| `src/services/diagnose.js` | Should map the alert's rule name to one of the 2 known failures and pick a fix. Plain if/else on purpose, not an LLM. | **Stub**, always returns "no action". |
| `src/services/safetyCheck.js` | Should block disabling retries while backup data is active (UC4). | **Stub**, always allows. |
| `src/clients/controlPlaneClient.js` | `getSettings()`, `applySetting()`, `reportIncident()`. | Working, unused until steps 2-4 are wired. |
| `src/clients/signozClient.js` | Should query SigNoz for real telemetry after an alert (UC6). | **Stub**, returns empty logs. |

**Today, `POST /alerts/webhook` only logs the alert and a stub diagnosis. Nothing gets applied or reported.**

---

## Running the whole stack

Requires Docker Desktop running and SigNoz already up (`foundryctl cast`, see `casting.yaml`) since `docker-compose.yml` joins SigNoz's existing network.

```bash
docker compose up -d --build
docker compose ps            # all 4 should show Up/healthy: app-postgres, control-plane, watcher-service, worker-service
```

| Service | Port |
|---|---|
| control-plane | `4001` |
| watcher-service | `4002` |
| worker-service | `4000` |
| app-postgres | `5433` (host, avoids a local Postgres install on 5432) |
| SigNoz UI | `8080` |

---

## Thorough test walkthrough (copy-paste in order)

**1. control-plane baseline**
```bash
curl http://localhost:4001/settings
# {"use_backup_data":false,"active_model":"gpt-standard","retry_enabled":true}
```

**2. Normal ticket (UC1)**
```bash
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# 200, estimated_cost_usd: 0.02
```

**3. Database outage + manual fix (UC2, the part that works today)**
```bash
curl -X POST http://localhost:4000/debug/break-db
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# 503, db_broken:true

curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"use_backup_data","value":true,"updated_by":"you"}'
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# 200 again, customer.name: "cached-customer"

# reset
curl -X POST http://localhost:4000/debug/fix-db
curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"use_backup_data","value":false,"updated_by":"you"}'
```

**4. Cost spike + manual fix (UC3)**
```bash
curl -X POST http://localhost:4000/debug/spike-cost
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# estimated_cost_usd jumps to 0.85

curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"active_model","value":"gpt-mini","updated_by":"you"}'
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# cost back to 0.02 (model no longer gpt-standard)

# reset
curl -X POST http://localhost:4000/debug/fix-cost
curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"active_model","value":"gpt-standard","updated_by":"you"}'
```

**5. Incident log (UC5)**
```bash
curl -X POST http://localhost:4001/incidents -H "Content-Type: application/json" \
  -d '{"detected_via":"manual-test","diagnosis":"db outage","action_taken":"use_backup_data=true","safety_check_result":"allowed","cost_before":0.02,"cost_after":0.02}'
curl http://localhost:4001/incidents
```

**6. watcher-service (stub, logs only)**
```bash
curl http://localhost:4002/watcher/status
curl -X POST http://localhost:4002/alerts/webhook -H "Content-Type: application/json" \
  -d '{"ruleName":"db-error-rate-alert","status":"firing"}'
docker compose logs watcher-service   # "alert webhook received", then "diagnosis: skeleton: no diagnosis yet"
```

**7. Confirm in SigNoz**: open `http://localhost:8080` → Services tab → `control-plane`, `worker-service`, `watcher-service` should each be listed once they've handled a request.

```bash
docker compose down   # stop everything, keeps the Postgres volume
```

---

## What's left to win the hackathon

The demo story ("AI agent breaks, second AI agent fixes it live, provably, without a human") is not automatic yet. In order:

1. **Fire one real SigNoz alert, capture its exact webhook JSON**, paste it into `CONTRACTS.md` Section 2. Blocks everything below, it's the only unknown left.
2. **Create 2 SigNoz alert rules**: worker-service error rate (UC2) and cost-per-ticket spike (UC3), pointed at `watcher-service`'s `POST /alerts/webhook`.
3. **Wire `diagnose.js`**: branch on the real alert rule name, return the matching fix (`use_backup_data=true` or `active_model=cheap`).
4. **Wire `safetyCheck.js`**: the one hardcoded block (UC4), this is a big demo beat, it visibly proves the AI has a leash.
5. **Uncomment steps 2-4 in `remediation.service.js`**: apply the fix via `controlPlaneClient.applySetting()`, report via `reportIncident()`.
6. **Run the full loop with zero manual curls**: break the DB, watch SigNoz alert, watch watcher-service fix it, watch the ticket succeed again, all live.
7. Nice-to-have for judging: a simple incident-history view (even the raw `GET /incidents` JSON is fine), and watcher-service's reasoning logs exported to SigNoz so its "thinking" is visible there too, not just in `docker compose logs`.

Steps 1-6 are the difference between "we built 3 services" and "we built a self-healing system", which is the actual pitch.
