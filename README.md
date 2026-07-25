# signoz-ai-sre

An AI SRE demo: one service does real work and can be told to fail on command, a second AI agent watches it through SigNoz and fixes it automatically, both mediated by one shared settings service. Built for a SigNoz/OpenTelemetry hackathon.

Full data contracts: [`CONTRACTS.md`](CONTRACTS.md). Agent/AI coding rules: [`AGENTS.md`](AGENTS.md).

## Table of contents

1. [The problem, in plain English](#1-the-problem-in-plain-english)
2. [What we've built so far](#2-whats-been-built-so-far)
3. [Functional requirements, per service](#3-functional-requirements-per-service)
4. [Current architecture](#4-current-architecture)
5. [Ticket vocabulary + master endpoint reference](#5-ticket-vocabulary--master-endpoint-reference)
6. [The AI / agent layer, in full](#6-the-ai--agent-layer-in-full)
7. [End-to-end flow: today's demo (manual)](#7-end-to-end-flow-todays-demo-manual)
8. [End-to-end flow: complete demo (target)](#8-end-to-end-flow-complete-demo-target)
9. [Target architecture (after the gap is closed)](#9-target-architecture-after-the-gap-is-closed)
10. [The UI (React/Next.js)](#10-the-ui-reactnextjs)
11. [Exact steps to close the gap](#11-exact-steps-to-close-the-gap)
12. [Status matrix + readiness checklist](#12-status-matrix--readiness-checklist)
13. [Run it / test it yourself](#13-run-it--test-it-yourself)

---

## 1. The problem, in plain English

Software breaks in a small number of predictable ways (a dependency goes down, a cost suddenly spikes), and today a human has to notice, diagnose, and fix it, usually at 3am. This project builds a tiny, honest version of the fix: one service that can fail in exactly 2 predictable ways, a monitoring system (SigNoz) that notices, and a second automated agent that diagnoses which failure it is, checks that the fix it's about to make is actually safe, applies the fix, and writes down what it did, all without a human touching anything.

**In one sentence: the pager doesn't fire, an agent fires instead, and it leaves a paper trail proving what it did and why.**

---

## 2. What's been built so far

| Capability | Status | Where |
|---|---|---|
| A working "production" service that answers requests and can be told to fail on demand | Done | `worker-service` |
| A shared place to store behavior switches and change them live, with no restart | Done | `control-plane` |
| A shared audit log of every automated action taken | Done (storage works, nothing writes to it automatically yet) | `control-plane` |
| A service that receives SigNoz's alerts | Done (receives and logs only) | `watcher-service` |
| The agent actually diagnosing an alert and picking the right fix | **Not done** | `watcher-service/src/services/diagnose.js` |
| The agent checking its fix is safe before applying it | **Not done** | `watcher-service/src/services/safetyCheck.js` |
| The agent applying the fix and logging the incident automatically | **Not done** | `watcher-service/src/services/remediation.service.js` |
| Real SigNoz alert rules pointed at the agent | **Not done** | SigNoz UI, not yet configured |
| Any real AI/LLM call anywhere in the system | **Not done** | see [Section 6](#6-the-ai--agent-layer-in-full) |
| A UI for demoing, instead of raw curl/terminal | **Not done** | see [Section 10](#10-the-ui-reactnextjs) |

**What you can already show, right now, without writing another line of code:** a service failing on command, its failure visible as an error trace in SigNoz, and the exact fix for that failure taking effect live the moment you flip one setting, with no restart. What's missing is *who flips the setting*: today it's a human running `curl`, the goal is the agent doing it by itself within seconds of the failure.

---

## 3. Functional requirements, per service

Plain-English requirements, written so a non-technical reviewer can check them off one by one. STATUS reflects the real code today, not the plan.

### control-plane (the shared settings + audit log)

| ID | Requirement | Status |
|---|---|---|
| FR-CP-01 | Store exactly 3 configuration switches (`use_backup_data`, `active_model`, `retry_enabled`), with sensible defaults if never set. | Done |
| FR-CP-02 | Let any service read all 3 switches in a single call. | Done |
| FR-CP-03 | Let a caller change exactly one switch at a time; reject unknown switch names loudly (400 error), never silently. | Done |
| FR-CP-04 | Record who changed a switch and when, for audit purposes. | Done |
| FR-CP-05 | Permanently record every automated incident: what was detected, what was diagnosed, what action was taken, whether it was allowed or blocked by the safety check, and the cost before/after. | Storage works; nothing calls it automatically yet |
| FR-CP-06 | Let anyone retrieve the full incident history, most recent first. | Done |

### worker-service (the thing that does real work and can be told to fail)

| ID | Requirement | Status |
|---|---|---|
| FR-WK-01 | Accept a simulated customer-support "ticket" and respond with how it was handled. | Done |
| FR-WK-02 | Check control-plane's current settings before handling each ticket, so behavior changes take effect on the very next request, no restart. | Done |
| FR-WK-03 | When `use_backup_data` is on, skip the simulated database and answer from cached data instead. | Done |
| FR-WK-04 | When the simulated database is marked broken, fail the ticket clearly, with a machine-readable `db_broken: true` flag. | Done |
| FR-WK-05 | Report a simulated per-ticket cost that rises when a cost-spike condition is active and the expensive model is still selected. | Done |
| FR-WK-06 | Provide on-demand controls to turn both failure conditions on and off, for reliable demo triggering. | Done |
| FR-WK-07 | Emit OpenTelemetry traces for every request, tagged with the service name, so SigNoz can see error rates. | Done |
| FR-WK-08 | Tag each trace with the specific business labels `CONTRACTS.md` Section 3 defines (`ticket.id`, `db.broken`, `model.name`, `estimated_cost_usd`) so watcher-service and dashboards can search for them. | **Done.** `POST /tickets` now sets all 4 attributes on the active span via `@opentelemetry/api`'s `trace.getActiveSpan()`. |

### watcher-service (the agent)

| ID | Requirement | Status |
|---|---|---|
| FR-WS-01 | Accept SigNoz's alert webhook and respond immediately, before doing any analysis, so SigNoz's call never times out or retries the same alert. | Done |
| FR-WS-02 | Diagnose which of the known failures an alert represents, and decide the one correct fix for it. | **Not done**, stub always returns "no diagnosis" |
| FR-WS-03 | Check a proposed fix against a hardcoded safety rule before applying it, and refuse unsafe ones. | **Not done**, stub always allows |
| FR-WS-04 | Apply an approved fix by updating the matching setting on control-plane. | **Not done**, commented out |
| FR-WS-05 | Record every alert it handles as an incident on control-plane, whether the fix was applied or blocked. | **Not done**, commented out |
| FR-WS-06 | Expose a liveness endpoint independent of alert traffic. | Done |
| FR-WS-07 (stretch) | Query SigNoz directly for recent telemetry to confirm or enrich a diagnosis beyond the alert payload alone. | **Not done**, stub returns empty data |

---

## 4. Current architecture

```
   +------------------------------------+
   |           worker-service            |  Node/Express, port 4000
   |  reads settings before every ticket |
   +------------------+-------------------+
                       |
             traces + errors go to SigNoz
                       v
   +------------------------------------+
   |               SigNoz                |  observability platform, port 8080
   |  (no alert rules configured yet)    |
   +--------------------------------------+
                       :
                (webhook not wired to any real alert yet)
                       v
   +------------------------------------+
   |           watcher-service           |  Node/Express, port 4002
   |  receives + logs alerts, no action  |
   +------------------+-------------------+
                       |
        reads/writes settings, writes incidents
                       v
   +------------------------------------+
   |            control-plane            |  Node/Express, port 4001
   |     (3 settings + incident log)     |
   +------------------------------------+
                       ^
                       |
        worker-service reads settings from here too
```

### Current file map (accurate as of this document)

```
control-plane/
  src/
    instrumentation.js        # connects to SigNoz, must load first
    server.js                 # wiring only: mounts routers, error middleware
    db/pool.js                 # singleton Postgres connection
    routes/{settings,incidents}.routes.js
    controllers/{settings,incidents}.controller.js
    services/{settings,incidents}.service.js
    repositories/{settings,incidents}.repository.js
  migrations/001_init.sql

worker-service/
  src/
    instrumentation.js
    server.js                 # all 5 routes defined directly here
    customerDb.js              # in-memory fake DB + failure switches
    controlPanelClient.js      # only talks to control-plane, one function: getSettings()

watcher-service/
  src/
    instrumentation.js
    server.js
    routes/{alerts,status}.routes.js
    controllers/{alerts,status}.controller.js
    services/
      remediation.service.js   # the agent loop, only step 1 of 4 wired
      diagnose.js               # STUB
      safetyCheck.js            # STUB
    clients/
      controlPlaneClient.js     # working, unused until remediation is wired
      signozClient.js           # STUB
```

No React/Next.js app exists yet anywhere in the repo (see [Section 10](#10-the-ui-reactnextjs)). No LLM client exists yet anywhere in the repo (see [Section 6](#6-the-ai--agent-layer-in-full)).

---

## 5. Ticket vocabulary + master endpoint reference

**What is a "ticket"?** A simulated customer-support request. It is not stored anywhere permanently, worker-service keeps ticket IDs as an in-memory counter that resets to 0 every time the service restarts. There is no ticket database, only the fake customer-lookup layer described below.

**How is a ticket generated?** By sending `POST /tickets` to worker-service with an optional JSON body `{ "customerId": "<any string>" }`. If `customerId` is omitted, worker-service falls back to using the ticket's own numeric ID as the customer ID for the real-lookup path, or the literal string `"unknown"` for the backup-data path. There is no other input, no ticket "type," no priority field, nothing else the caller can set.

**Every possible outcome of `POST /tickets`:**

| Condition | HTTP status | Response shape | Meaning |
|---|---|---|---|
| Normal, `use_backup_data=false`, DB not broken | 200 | `{ticket_id, customer:{id,name}, model, estimated_cost_usd, db_broken:false}` | Happy path |
| `use_backup_data=true` | 200 | same shape, `customer.name` is `"cached-customer"` | This *is* Fix A working |
| DB broken, `use_backup_data=false` | 503 | `{ticket_id, error:"customer db unreachable", model, estimated_cost_usd, db_broken:true}` | This *is* Failure A |
| Cost spiked + `active_model` still `gpt-standard` | 200 | `estimated_cost_usd: 0.85` instead of `0.02` | This *is* Failure B |
| Cost spiked + `active_model` changed | 200 | `estimated_cost_usd: 0.02` | This *is* Fix B working |
| control-plane unreachable | 502 | `{error:"control-plane unreachable"}` | Dependency failure, not a demo scenario |

### Master endpoint reference (every API in the system today)

| Service | Method | Path | Purpose | Who calls it today |
|---|---|---|---|---|
| control-plane | `GET` | `/settings` | Read all 3 current switches | worker-service (every ticket), humans testing |
| control-plane | `PUT` | `/settings` | Change one switch | humans testing (should be watcher-service) |
| control-plane | `POST` | `/incidents` | Log one automated action | humans testing (should be watcher-service) |
| control-plane | `GET` | `/incidents` | List the audit trail | humans testing, future UI |
| worker-service | `POST` | `/tickets` | Handle one simulated support ticket | humans testing, future traffic generator/UI |
| worker-service | `POST` | `/debug/break-db` | Turn on Failure A | humans testing, future UI "Break DB" button |
| worker-service | `POST` | `/debug/fix-db` | Turn off Failure A | humans testing |
| worker-service | `POST` | `/debug/spike-cost` | Turn on Failure B | humans testing, future UI "Spike Cost" button |
| worker-service | `POST` | `/debug/fix-cost` | Turn off Failure B | humans testing |
| watcher-service | `POST` | `/alerts/webhook` | Receive a SigNoz alert | humans testing today; **SigNoz itself once alert rules exist** |
| watcher-service | `GET` | `/watcher/status` | Liveness probe | humans testing, docker-compose, future UI |

---

## 6. The AI / agent layer, in full

**Where the AI actually is right now: nowhere.** `diagnose.js` is a deterministic `if/else` stub, and it doesn't even branch yet. This is a real gap, not a hidden design choice, be upfront about it. The reasoning documented in the code for using `if/else` instead of an LLM for the 2 core failures is deliberate: a live demo cannot afford an LLM saying something unpredictable on stage. That reasoning is sound *for the 2 known failures specifically*, but it means today there is no AI/LLM call anywhere in this codebase.

### Every agent use case the design supports

| Use case | What triggers it | What the agent should decide | Exact API call it makes to fix it | Status |
|---|---|---|---|---|
| UC1: Recognize Failure A (DB outage) | Alert rule name contains `db-error-rate` | Turn on `use_backup_data` | `PUT control-plane:4001/settings {key:"use_backup_data", value:true, updated_by:"watcher"}` | Not wired |
| UC2: Recognize Failure B (cost spike) | Alert rule name contains `cost-spike` | Switch `active_model` to the cheap option | `PUT control-plane:4001/settings {key:"active_model", value:"gpt-cheap", updated_by:"watcher"}` | Not wired |
| UC3: Block an unsafe fix | A chosen fix would be `retry_enabled=false` while `use_backup_data=true` | Refuse to apply it | No `PUT` call made; incident logged with `safety_check_result:"blocked"` | Not wired |
| UC4: Log every action taken | After every alert, fixed or blocked | Always write one row | `POST control-plane:4001/incidents {...}` | Not wired |
| UC5: Unrecognized alert | Alert rule name matches neither known failure | Do nothing dangerous, log it as unrecognized | `POST /incidents` with `action_taken:"none"`, no `PUT /settings` call | Not designed yet, should be added alongside UC1/UC2 as the `else` branch |
| UC6 (stretch): Confirm diagnosis against real telemetry | Before deciding a fix, ask SigNoz what it's actually seeing | Use SigNoz's query API/MCP server to corroborate the alert before acting | `signozClient.getRecentErrorLogs(...)` | Stub |
| UC7 (proposed): AI-narrated incident report | After a fix is decided (deterministically) | Generate the human-readable `diagnosis` sentence for the incident log via an LLM call | New: `llmClient.narrate(alert, action)` | Not built, see below |

### How the agent will "call" a fix, concretely

This is the entire mechanism, there is no message queue, no event bus:

1. SigNoz calls `POST watcher-service:4002/alerts/webhook` with the real alert JSON.
2. `alerts.controller.js` responds `200 {received:true}` immediately, then calls `remediation.service.js`'s `handleAlert(alert)` in the background.
3. `handleAlert` calls `diagnose(alert)` → returns `{diagnosis, action, detected_via}`.
4. `handleAlert` calls `controlPlaneClient.getSettings()` to see current state, then `checkSafety(action, settings)`.
5. If allowed and `action` isn't null: `handleAlert` calls `controlPlaneClient.applySetting(action.key, action.value)`, which does `PUT control-plane:4001/settings`.
6. Regardless of allowed/blocked: `handleAlert` calls `controlPlaneClient.reportIncident({...})`, which does `POST control-plane:4001/incidents`.
7. worker-service's *next* ticket automatically picks up the new setting on its normal `GET /settings` call (FR-WK-02). The agent never talks to worker-service directly.

### Exactly where real AI (an LLM call) fits, without breaking the demo

| Option | What it does | Demo risk |
|---|---|---|
| **A. Narrate the incident (recommended first)** | After the deterministic `diagnose()` + `checkSafety()` run, send the alert + chosen action to an LLM and use its one-sentence reply as the incident's `diagnosis` text instead of a canned string. | None: 2s hard timeout, canned fallback string on any failure, the actual fix in step 5 above never waits on this. |
| **B. Classify unknown alerts (UC5/UC6 combined)** | For alerts that don't match the 2 known rule names, ask an LLM (with real SigNoz telemetry via option UC6) whether this looks like a known failure or needs a human. | Low: only triggers on alerts the deterministic path already doesn't recognize. |
| **C. Explain a blocked safety check** | Generate a friendlier reason string when UC3 blocks a fix. | None, same pattern as A. |

**To build option A** (smallest, highest demo value): add `watcher-service/src/clients/llmClient.js` exporting `narrate(alert, action)`, call it from `remediation.service.js` right before `reportIncident()`, wrap in try/catch with a 2-second timeout and a hardcoded fallback sentence, add the API key to `watcher-service/.env.example`.

---

## 7. End-to-end flow: today's demo (manual)

Every step below is a real API call you make by hand. This is what you can show right now.

| # | Actor | Exact API call | What happens |
|---|---|---|---|
| 1 | You | `GET control-plane:4001/settings` | Show the baseline: all defaults |
| 2 | You | `POST worker-service:4000/tickets {"customerId":"c1"}` | 200, normal ticket, cost 0.02 |
| 3 | You | `POST worker-service:4000/debug/break-db` | Failure A now active |
| 4 | You | `POST worker-service:4000/tickets {"customerId":"c1"}` | 503, `db_broken:true`. **Open SigNoz UI here, show the error trace live.** |
| 5 | You (standing in for the agent) | `PUT control-plane:4001/settings {"key":"use_backup_data","value":true,"updated_by":"you"}` | This is the exact call watcher-service should make automatically |
| 6 | You | `POST worker-service:4000/tickets {"customerId":"c1"}` | 200 again, `customer.name:"cached-customer"`, no restart needed |
| 7 | You (standing in for the agent) | `POST control-plane:4001/incidents {...}` | This is the exact call watcher-service should make automatically |
| 8 | You | `GET control-plane:4001/incidents` | Show the audit trail |
| 9 | You | `POST worker-service:4000/debug/fix-db` then reset `use_backup_data` to `false` | Clean state for the next run |
| 10 | You | Repeat 3-9 with `/debug/spike-cost` and `active_model` instead | Demonstrates Failure B / Fix B the same way |
| 11 | You | `POST watcher-service:4002/alerts/webhook {"ruleName":"db-error-rate-alert"}` | Shows the webhook endpoint exists and responds, but logs "no diagnosis yet", this is the honest "here's exactly what's left" beat of the demo |

---

## 8. End-to-end flow: complete demo (target)

Same failures, but **step 5-7 above happen with nobody touching a keyboard.** This requires [Section 11](#11-exact-steps-to-close-the-gap) to be done first.

| # | Actor | Exact API call | What happens |
|---|---|---|---|
| 1 | UI or script | `POST worker-service:4000/tickets` (repeated every few seconds) | Live "traffic" visible on screen |
| 2 | You, on stage | Click "Break DB" in the UI → `POST worker-service:4000/debug/break-db` | The one manual trigger left, simulating a real outage |
| 3 | worker-service | Tickets start returning 503, traces tagged `db.broken=true` sent to SigNoz | Automatic |
| 4 | **SigNoz** | Its error-rate alert rule crosses threshold and fires | **Automatic, no human** |
| 5 | **SigNoz** | `POST watcher-service:4002/alerts/webhook {realPayload}` | **Automatic** |
| 6 | **watcher-service** | `diagnose()` recognizes `db-error-rate`, picks `use_backup_data=true` | **Automatic** |
| 7 | **watcher-service** | `checkSafety()` approves it | **Automatic** |
| 8 | **watcher-service** | `PUT control-plane:4001/settings {use_backup_data:true}` | **Automatic** |
| 9 | **watcher-service** | `POST control-plane:4001/incidents {...}` (diagnosis text optionally LLM-narrated) | **Automatic** |
| 10 | worker-service | The very next ticket in the live traffic stream succeeds again, using cached data | **Automatic** |
| 11 | UI | Incident feed and settings panel update live (polling `GET /incidents` and `GET /settings`) | **Automatic** |
| 12 | You, on stage | Point at the timestamps: alert fired → incident logged → traffic recovered, all within seconds, nobody touched anything after step 2 | This *is* the demo's punchline |

Repeat with "Spike Cost" for Failure B. Optionally add a UC3 beat: trigger a scenario where the agent's proposed fix would be unsafe, and show it get blocked and explained in the incident log instead of silently applied, proving the agent has a hard boundary it cannot cross.

---

## 9. Target architecture (after the gap is closed)

```
   +--------------------------------------------------+
   |         React/Next.js dashboard (browser)          |
   |  live settings + incident feed + demo controls      |
   +----------------------+------------------------------+
                           | polls GET /settings, GET /incidents
                           | calls POST /tickets, /debug/*  (demo buttons)
                           v
   +------------------------------------+       +--------------------------+
   |           worker-service            |------>|          SigNoz          |
   |  tags traces with CONTRACTS.md      |traces |  2 real alert rules:     |
   |  Section 3 labels (done)            |       |  db-error-rate, cost-spike|
   +--------------------------------------+       +------------+-------------+
                       ^                                        |
                       | GET /settings (every ticket)            | webhook, automatic
                       |                                          v
   +------------------------------------+       +--------------------------+
   |            control-plane            |<------|      watcher-service      |
   |   3 settings + incident log (Postgres)|PUT/POST| diagnose -> safety ->   |
   +------------------------------------+       |  apply -> report          |
                                                 |  + optional LLM narration |
                                                 +--------------------------+
```

New pieces vs. today: 2 real SigNoz alert rules, `diagnose.js`/`safetyCheck.js` wired for real, `remediation.service.js` fully connected, `llmClient.js` (new file), and the React/Next.js dashboard (new app, Section 10). Custom span attributes in worker-service (FR-WK-08) are already done.

---

## 10. The UI (React/Next.js)

The system works without a UI, all 3 services are pure APIs. The UI exists purely to make the demo watchable instead of a terminal full of JSON.

### What it needs to have

| Panel | Data source | Purpose |
|---|---|---|
| **Live settings panel** | Poll `GET control-plane:4001/settings` every 2s | Shows the 3 switches changing in real time when the agent acts, this is the "proof" panel |
| **Incident timeline** | Poll `GET control-plane:4001/incidents` every 2s | Shows each incident as a card: detected via, diagnosis, action taken, safety check result, timestamp. This is the audit trail made visible |
| **Live ticket feed / traffic indicator** | Either poll a small counter or just show the last few `POST /tickets` responses | Gives the demo a "pulse", something visibly moving before the failure hits |
| **Demo control buttons** | `POST worker-service:4000/debug/break-db`, `/debug/spike-cost`, and their `/fix-*` counterparts | Replaces typing curl commands live on stage with one click |
| **Status strip** | `GET worker-service:4000` (add a basic health route) and `GET watcher-service:4002/watcher/status` | Shows all services are up before you start |
| **Link-out to SigNoz** | Just a link to `localhost:8080` | SigNoz's own UI is the source of truth for traces/alerts, don't rebuild it, just point at it |

### Why React/Next.js specifically

Next.js gives a single small app that can both serve the dashboard and (optionally) proxy calls to the 3 backend services, avoiding CORS setup during a rushed hackathon build. A plain Create-React-App or Vite React app works too if Next.js feels like overhead, the requirement is "one page, a few live-polling panels, a few buttons," not a framework choice, pick whichever your team already knows best.

### Functional requirements for the UI

| ID | Requirement |
|---|---|
| FR-UI-01 | Display all 3 current settings, refreshing automatically without a page reload. |
| FR-UI-02 | Display the incident list as a human-readable timeline, most recent first, refreshing automatically. |
| FR-UI-03 | Provide one-click buttons for both failure triggers and both failure fixes (manual override, useful if the automatic path isn't ready yet). |
| FR-UI-04 | Visually distinguish an "allowed" action from a "blocked" one in the incident timeline (this is UC3's payoff moment). |
| FR-UI-05 | Never require the presenter to open a terminal during the live demo. |

This is not built yet. Nothing in the repo currently serves a browser page.

---

## 11. Exact steps to close the gap

1. **Capture a real SigNoz alert payload.** Create one throwaway alert rule in the SigNoz UI, point it at watcher-service's webhook (or webhook.site first), force it to fire, copy the exact JSON into `CONTRACTS.md` Section 2. Confirms the real field name for the alert's rule identifier.
2. **Create the 2 real SigNoz alert rules**: worker-service error rate (Failure A), `estimated_cost_usd` rate of change (Failure B). Point both at watcher-service's webhook. The span attributes these rules need (FR-WK-08) are already in place.
3. **Wire `diagnose.js`**: branch on the real rule name from step 1, add the `else` branch for UC5 (unrecognized alert, do nothing dangerous, log it anyway).
4. **Wire `safetyCheck.js`**: the one hardcoded UC3 rule (block `retry_enabled=false` while `use_backup_data=true`).
5. **Uncomment steps 2-4 in `remediation.service.js`**, connecting the already-working `controlPlaneClient.js` functions.
6. **(Recommended) Build option A from Section 6**: the LLM-narrated incident text, this is the smallest real "AI" addition with the least demo risk.
7. **Build the UI** (Section 10).
8. **Rehearse Section 8's flow end to end**, timing it, with zero manual curl commands after the one failure-trigger click.

---

## 12. Status matrix + readiness checklist

| Service | Built | Talks to control-plane | Runs in docker-compose | Real SigNoz-driven behavior |
|---|:---:|:---:|:---:|:---:|
| control-plane | Yes | n/a (it *is* the store) | Yes | Yes, all 3 services' traces reach SigNoz |
| worker-service | Yes | Yes | Yes | Tickets + debug switches work; custom trace labels done (FR-WK-08) |
| watcher-service | Yes (skeleton) | Client code exists, unused | Yes | No, diagnose/safety-check/apply/report are stubs |
| Real AI/LLM usage | No | | | See Section 6 |
| UI | No | | | See Section 10 |

**Readiness checklist:**
- [x] control-plane built, tested, layered, documented
- [x] worker-service built, tested, reads live settings from control-plane
- [x] watcher-service skeleton built, receives webhooks, responds correctly
- [x] All 4 containers build and run together via `docker compose up`
- [x] worker-service tags traces with `CONTRACTS.md` Section 3 labels (FR-WK-08)
- [ ] `CONTRACTS.md` Section 2 filled with a real captured SigNoz alert payload
- [ ] 2 real SigNoz alert rules created and firing
- [ ] `diagnose.js` and `safetyCheck.js` wired for real, including the unrecognized-alert case
- [ ] `remediation.service.js` steps 2-4 uncommented and working
- [ ] At least one real AI/LLM call somewhere in the loop (Section 6, option A minimum)
- [ ] React/Next.js UI built with the 5 panels in Section 10
- [ ] Full loop demoed with zero manual curls after the initial failure trigger (Section 8)

---

## 13. Run it / test it yourself

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

The full copy-paste test sequence is [Section 7](#7-end-to-end-flow-todays-demo-manual) above, every line there is a real, runnable command against the live stack. Per-service deep dives: [`control-plane/README.md`](control-plane/README.md), [`worker-service/README.md`](worker-service/README.md).

```bash
docker compose down   # stop everything, keeps the Postgres volume
```
