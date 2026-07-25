# signoz-ai-sre

An AI SRE demo, built for SigNoz's **Track 1: AI & Agent Observability**. One service does real work and can be told to fail on command. A second agent watches it through SigNoz. Known failures get fixed instantly and deterministically. Unknown failures get **actually investigated by an LLM using SigNoz's own telemetry as tools**, and that investigation is itself traced in SigNoz. Everything is mediated by one shared, auditable settings service.

Full data contracts: [`CONTRACTS.md`](CONTRACTS.md). Agent/AI coding rules: [`AGENTS.md`](AGENTS.md).

## Table of contents

1. [The problem, in plain English](#1-the-problem-in-plain-english)
2. [What's been built so far](#2-whats-been-built-so-far)
3. [Functional requirements, per service](#3-functional-requirements-per-service)
4. [Current architecture](#4-current-architecture)
5. [Ticket vocabulary + master endpoint reference](#5-ticket-vocabulary--master-endpoint-reference)
6. [The AI / agent layer, in full](#6-the-ai--agent-layer-in-full)
7. [Why this is a good problem to solve](#7-why-this-is-a-good-problem-to-solve)
8. [Target architecture (what's left)](#8-target-architecture-whats-left)
9. [The UI (React/Next.js)](#9-the-ui-reactnextjs)
10. [SigNoz: dashboards, alerts, exceptions, LLM cost](#10-signoz-dashboards-alerts-exceptions-llm-cost)
11. [Exact steps to close the gap](#11-exact-steps-to-close-the-gap)
12. [Status matrix + readiness checklist](#12-status-matrix--readiness-checklist)
13. [Run it yourself: Windows, Linux, macOS](#13-run-it-yourself-windows-linux-macos)

---

## 1. The problem, in plain English

Software breaks in ways that fall into two buckets. **Known patterns**: you've seen this exact failure before, there's a known fix, a human just needs to notice and apply it, usually at 3am. **Novel failures**: nobody anticipated this exact shape, so there's no hardcoded rule, someone has to actually look at traces and logs, form a hypothesis, and decide. This project automates both, honestly: known patterns get instant, deterministic fixes with zero AI risk involved; novel failures get investigated by an LLM that uses SigNoz's own telemetry as tools, the same way a human SRE would, and its entire investigation is itself traced and auditable.

**In one sentence: the pager doesn't fire for either bucket, an accountable agent handles both, and every action, human-anticipated or AI-investigated, leaves a paper trail proving what happened and why.**

---

## 2. What's been built so far

| Capability | Status | Where |
|---|---|---|
| A working "production" service that answers requests and can be told to fail on demand | Done, verified live | `worker-service` |
| A shared place to store behavior switches and change them live, with no restart | Done, verified live | `control-plane` |
| A permanent audit log of every automated action taken | Done, verified live, every test alert wrote a real row | `control-plane` |
| 2 real SigNoz alert rules, firing automatically on real telemetry | Done, both confirmed firing without any manual trigger of the webhook itself | SigNoz UI |
| Tier 1: deterministic diagnosis + safety check + fix + report for the 2 known failures | Done, verified live with real SigNoz-fired alerts | `watcher-service/src/services/{diagnose,safetyCheck,remediation.service}.js` |
| Tier 2: an LLM agent that investigates *unrecognized* alerts using real SigNoz telemetry as tools | **Built and verified up to the LLM call itself.** The SigNoz query tools, the tool-calling loop, the guardrails, the OTel spans, all tested with real data. Needs an `ANTHROPIC_API_KEY` to actually invoke the model, see [Section 6](#6-the-ai--agent-layer-in-full). | `watcher-service/src/services/investigate.js`, `src/clients/{llmClient,signozClient}.js` |
| A UI for demoing, instead of raw curl/terminal | **Not done** | see [Section 9](#9-the-ui-reactnextjs) |
| SigNoz dashboards for cost, LLM usage, agent activity | **Not done**, panels documented and ready to build | see [Section 10](#10-signoz-dashboards-alerts-exceptions-llm-cost) |

**What you can already show, right now, with zero manual curls after the initial failure trigger:** break the DB or spike the cost, SigNoz notices on its own, calls the agent on its own, the agent fixes it and logs why, on its own. That's Tier 1, proven twice with real alerts. For a failure nobody anticipated, Tier 2 will investigate it with a real LLM the moment `ANTHROPIC_API_KEY` is set, everything downstream of that is already built and tested against real SigNoz data.

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
| FR-CP-05 | Permanently record every automated incident: what was detected, what was diagnosed, what action was taken, whether it was allowed or blocked, and the cost before/after. | Done, verified: every test alert (Tier 1 and Tier 2) wrote a real row |
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
| FR-WK-08 | Tag each trace with the specific business labels `CONTRACTS.md` Section 3 defines (`ticket.id`, `db.broken`, `model.name`, `estimated_cost_usd`) so watcher-service and dashboards can search for them. | Done. `POST /tickets` sets all 4 attributes on the active span. |

### watcher-service (the agent, both tiers)

| ID | Requirement | Status |
|---|---|---|
| FR-WS-01 | Accept SigNoz's alert webhook and respond immediately, before doing any analysis, so SigNoz's call never times out or retries the same alert. | Done |
| FR-WS-02 | Diagnose which of the known failures an alert represents (Tier 1), and decide the one correct fix for it. | Done. Branches on `alerts[0].labels.alertname`, handles `db-error-rate` and `cost-spike`. |
| FR-WS-03 | Check a proposed fix against a hardcoded safety rule before applying it, and refuse unsafe ones. | Done. Blocks `retry_enabled=false` while `use_backup_data=true`. |
| FR-WS-04 | Apply an approved fix by updating the matching setting on control-plane. | Done, verified live for both known failures. |
| FR-WS-05 | Record every alert it handles as an incident on control-plane, whether the fix was applied, blocked, or no action was taken. | Done, verified for Tier 1 and Tier 2 alike. |
| FR-WS-06 | Expose a liveness endpoint independent of alert traffic. | Done |
| FR-WS-07 | For alerts Tier 1 doesn't recognize, investigate using real SigNoz telemetry (traces, error spans) as tools for an LLM, instead of giving up. | **Done**, the tools and the tool-calling loop are real and tested against live SigNoz data (see [Section 6](#6-the-ai--agent-layer-in-full)). Needs `ANTHROPIC_API_KEY` to make the actual model call. |
| FR-WS-08 | Tier 2's proposed action must be restricted to the same 3 known setting keys as Tier 1, anything else discarded; the whole investigation must have a hard timeout; every LLM/tool call must be traced. | Done: `VALID_KEYS` allowlist, 10s timeout via `Promise.race`, manual OTel spans with `gen_ai.*` attributes on the LLM call and `signoz.*` attributes on each tool call. |

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
   |  2 real alert rules live:           |
   |  db-error-rate-alert (Failure A)    |
   |  cost-spike-alert (Failure B)       |
   +--------------------------------------+
                       |
              webhook fires automatically
                       v
   +--------------------------------------------------+
   |                 watcher-service                    |  Node/Express, port 4002
   |                                                      |
   |  Tier 1 (known failures, deterministic, instant):    |
   |    diagnose -> safety-check -> apply -> report       |
   |                                                      |
   |  Tier 2 (unrecognized alerts, LLM-investigated):     |
   |    investigate.js: LLM + SigNoz query tools loop  ---|--> reads traces
   |    (guarded: read-only tools, 3-key action allowlist, |    from SigNoz
   |     10s timeout, every call traced)                  |    (query_range API)
   +------------------+---------------------------------+
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
      remediation.service.js   # the loop: diagnose -> safety -> apply -> report
      diagnose.js               # Tier 1 if/else; falls through to Tier 2 when unmatched
      safetyCheck.js            # the one hardcoded safety rule
      investigate.js            # NEW: Tier 2 orchestrator, LLM tool-calling loop
    clients/
      controlPlaneClient.js     # PUT /settings, POST /incidents, GET /settings
      llmClient.js               # NEW: wraps the Anthropic SDK call
      signozClient.js            # NEW: real SigNoz Query API v4 client (read-only)
```

No React/Next.js app exists yet anywhere in the repo (see [Section 9](#9-the-ui-reactnextjs)).

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
| control-plane | `PUT` | `/settings` | Change one switch | watcher-service (Tier 1 and Tier 2 both), humans testing |
| control-plane | `POST` | `/incidents` | Log one automated action | watcher-service, humans testing |
| control-plane | `GET` | `/incidents` | List the audit trail | humans testing, future UI |
| worker-service | `POST` | `/tickets` | Handle one simulated support ticket | humans testing, future traffic generator/UI |
| worker-service | `POST` | `/debug/break-db` | Turn on Failure A | humans testing, future UI "Break DB" button |
| worker-service | `POST` | `/debug/fix-db` | Turn off Failure A | humans testing |
| worker-service | `POST` | `/debug/spike-cost` | Turn on Failure B | humans testing, future UI "Spike Cost" button |
| worker-service | `POST` | `/debug/fix-cost` | Turn off Failure B | humans testing |
| watcher-service | `POST` | `/alerts/webhook` | Receive a SigNoz alert | **SigNoz itself**, confirmed firing automatically for both alert rules |
| watcher-service | `GET` | `/watcher/status` | Liveness probe | humans testing, docker-compose, future UI |
| SigNoz | `POST` | `/api/v4/query_range` | Tier 2's read-only telemetry queries | watcher-service's `signozClient.js` |

---

## 6. The AI / agent layer, in full

### Two tiers, and why both exist

**Tier 1 (deterministic, unchanged from before):** the 2 known failures resolve instantly via plain `if/else` on the alert's rule name. No LLM involved, no unpredictability. This is the reliability backbone, proven live twice with real SigNoz-fired alerts.

**Tier 2 (new, the actual "AI-native" part):** when an alert's name matches neither known pattern, `diagnose.js` hands off to `investigate.js`, which runs a real LLM tool-calling loop against Claude, using SigNoz's own Query API as the LLM's "eyes." This is the functionally necessary use of AI in this system, not decoration, it's the only thing that handles a failure nobody anticipated at all.

### Guardrails (why this is safe to demo)

| Guardrail | How it's enforced |
|---|---|
| Action allowlist | `investigate.js`'s `VALID_KEYS` list discards any proposed action outside `use_backup_data` / `active_model` / `retry_enabled`, before it ever reaches `remediation.service.js`. control-plane's `PUT /settings` enforces the same allowlist again, independently. |
| Read-only investigation | `signozClient.js` only ever calls `query_range`. There is no function in this codebase that can write to SigNoz. |
| Bounded tools | The LLM is given exactly 2 tools: `query_recent_traces`, `query_error_spans`. No shell, no file access, no arbitrary HTTP. |
| Hard timeout | The whole investigation races against a 10s timer (`INVESTIGATION_TIMEOUT_MS`). On timeout it resolves to a safe "no action, needs human" result instead of hanging. |
| Missing API key = safe no-op | If `ANTHROPIC_API_KEY` isn't set, `investigate.js` skips straight to the fallback result. Verified: an unrecognized alert with no key configured left settings untouched and logged `"no automated fix, ANTHROPIC_API_KEY not configured"`. |
| No privileged path for AI-proposed actions | Tier 2's output goes through the exact same `safetyCheck.js` as Tier 1, in the exact same `remediation.service.js` code path. No special case. |
| Unconditional audit trail | `reportIncident()` fires whether the outcome was applied, blocked, or "insufficient evidence." Nothing is silently dropped, for either tier. |
| Everything is traced | Every LLM call and every SigNoz tool call gets its own OpenTelemetry span, so the agent's *own investigation* is visible as a trace in SigNoz, not just the infra it's investigating. |

**Will the agent modify code? No.** Its entire vocabulary of possible actions, in either tier, is 3 named config switches on control-plane. It cannot write files, run shell commands, deploy, or touch source code. That's not a limitation we're apologizing for, it's the design: safety through a small, enumerable action space, not through hoping a model behaves.

### Tier 2's exact flow, verified against real infrastructure

```
1. SigNoz fires an alert whose name matches neither known pattern
2. POST watcher-service:4002/alerts/webhook
3. diagnose.js's Tier 1 fails to match -> calls investigate(alertPayload)
4. investigate.js starts a bounded loop (max 4 turns) against Claude:
     system prompt: "investigate using your tools, respond with ONLY
                      {diagnosis, action|null}, action must be one of the
                      3 known keys"
   a. Claude requests tool query_recent_traces({serviceName, minutes})
      -> signozClient.queryRecentTraces() -> real POST to SigNoz's
         /api/v4/query_range, SIGNOZ-API-KEY header, real span rows back
   b. Claude may request query_error_spans(...) for more evidence
   c. Claude returns final JSON: diagnosis + action (or null)
5. Action validated against VALID_KEYS (discarded if not one of the 3 keys)
6. Same safetyCheck.js as Tier 1 evaluates it
7. If allowed and an action exists: PUT control-plane/settings
8. POST control-plane/incidents, always
9. Every step above (each tool call, the LLM call itself) is its own OTel
   span, nested under an "investigate.tier2" parent span
```

**Verified today, without a real LLM key yet:**
- `signozClient.queryRecentTraces('worker-service', 15)` called directly inside the running container returned 10 real span rows.
- The `investigate.tier2` span it produces is a real, queryable trace, confirmed by querying SigNoz for `watcher-service`'s own spans and finding it in the list.
- Sending an unrecognized alert with no `ANTHROPIC_API_KEY` configured correctly left control-plane's settings untouched and logged an honest incident explaining why.

**What's left to see the LLM actually reason:** set `ANTHROPIC_API_KEY` (and `SIGNOZ_API_KEY`, see below) and fire an unrecognized alert. Nothing else needs to change.

### Two gotchas found the hard way (worth knowing before you touch this)

1. **SigNoz's internal hostname is `signoz-signoz-0`, not `signoz`.** Found by inspecting `signoz-network` directly, the old default in `.env.example`/`docker-compose.yml` was wrong and would have silently returned zero query results forever, no error, just empty data.
2. **Trace query timestamps are nanoseconds since epoch, not milliseconds.** Every other timestamp in this codebase is milliseconds. Getting this wrong doesn't error either, `query_range` returns `200 success` with an empty `list`, which looks exactly like "no data in this time range" instead of "your request is malformed."

### Getting a SigNoz API key (for `SIGNOZ_API_KEY`)

1. SigNoz UI -> Settings -> **Service Accounts** -> **New Service Account**, name it e.g. `watcher-service`.
2. Open it -> **Keys** tab -> **Add Key**, name it, no expiration is fine for a hackathon. Copy the key immediately, it's shown once.
3. Back on the **Overview** tab -> **Roles** -> select `signoz-viewer` (read-only is all this client needs) -> **you must click "Save Changes"**, selecting the role alone does not persist it, a real gotcha hit while building this.
4. Put the key in a root `.env` file (gitignored) as `SIGNOZ_API_KEY=...`. `docker-compose.yml` reads it from there.

---

## 7. Why this is a good problem to solve

**The track is "AI & Agent Observability": trace, monitor, debug AI-native systems.** The example builds listed include "Self-healing infra with SigNoz metrics" and "SRE Sidekick built on SigNoz." This project is both at once, not one:

- **Self-healing infra**: Tier 1, proven with 2 real SigNoz-fired alerts, zero AI risk, instant deterministic recovery.
- **SRE Sidekick / agent-native observability**: Tier 2, an LLM that investigates using SigNoz's own telemetry as tools, exactly what a human SRE does, and its own reasoning process is itself a traced, observable SigNoz trace, not a black box.

**Why this beats "add tracing to a backend":** anyone can emit HTTP spans. What's actually hard, and actually matches the track's brief, is making an *agent's own cognition* observable, its tool calls, its token usage, its reasoning latency, sitting in SigNoz right next to the infrastructure it's diagnosing. That's the differentiator: open a trace during the demo and you're not just looking at a request, you're watching the agent think.

**Real-world framing for the pitch:** "Imagine `worker-service` is a real production API and `control-plane` is a real feature-flag service you already have. `watcher-service` is the on-call engineer. For the 2 failure classes we've seen before, it doesn't even wake up a human, it just fixes it. For something nobody's seen before, it doesn't wake up a human either, it investigates first, using the exact same dashboards a human would open, and only then decides, with a hard boundary it can never cross and a paper trail for everything it does or doesn't do."

**Judging criteria fit:**
| Criterion | How this project answers it |
|---|---|
| Potential Impact | Automates both the boring 3am pages and the actually-hard investigative triage, not just one |
| Creativity & Innovation | The agent's own reasoning is observable, not just the app it watches |
| Technical Excellence | Guardrails enforced in code (allowlist, timeout, read-only tools), not promises; small dependency footprint, no framework bloat |
| Best Use of SigNoz | Alerts, traces, a real Query API integration, and LLM spans all feeding one system |
| User Experience | (once Section 9's UI exists) one page, no terminal, live |
| Presentation Quality | This README, `CONTRACTS.md`, and per-service READMEs document the whole system precisely |

---

## 8. Target architecture (what's left)

```
   +--------------------------------------------------+
   |         React/Next.js dashboard (browser)          |
   |  live settings + incident feed + agent reasoning    |
   |  panel + demo controls                              |
   +----------------------+------------------------------+
                           | polls GET /settings, GET /incidents
                           | calls POST /tickets, /debug/*  (demo buttons)
                           v
   +------------------------------------+       +--------------------------+
   |           worker-service            |------>|          SigNoz          |
   |  tags traces with CONTRACTS.md      |traces |  2 real alert rules      |
   |  Section 3 labels (done)            |       |  + dashboards for cost,  |
   +--------------------------------------+       |  LLM tokens/cost, agent |
                       ^                          |  investigation activity |
                       | GET /settings              +------------+-------------+
                       |                                          |
   +------------------------------------+       +--------------------------+
   |            control-plane            |<------|      watcher-service      |
   |   3 settings + incident log (Postgres)|PUT/POST| Tier 1 (done) +         |
   +------------------------------------+       |  Tier 2 (done, needs a    |
                                                 |  real ANTHROPIC_API_KEY)  |
                                                 +--------------------------+
```

**New pieces vs. Section 4's current architecture:** just the React/Next.js dashboard (Section 9) and the SigNoz dashboards (Section 10). Everything backend, including Tier 2's full pipeline, is already built and tested against real infrastructure, it's waiting on a real `ANTHROPIC_API_KEY` to actually invoke the model, not on more code.

---

## 9. The UI (React/Next.js)

The system works without a UI, all 3 services are pure APIs. The UI exists purely to make the demo watchable instead of a terminal full of JSON.

### What it needs to have

| Panel | Data source | Purpose |
|---|---|---|
| **Live settings panel** | Poll `GET control-plane:4001/settings` every 2s | Shows the 3 switches changing in real time when the agent acts, this is the "proof" panel |
| **Incident timeline** | Poll `GET control-plane:4001/incidents` every 2s | Each incident as a card: detected via, diagnosis, action taken, safety result, timestamp, and which tier handled it |
| **Agent reasoning panel (the Tier 2 differentiator)** | New: watcher-service could expose a small `GET /investigations/:id` or the incident's diagnosis text already carries it | For AI-investigated incidents, show the actual tool calls made and the reasoning trail, turns "the agent thought about it" into something visible |
| **"Open in SigNoz" deep link per incident** | Static link built from the incident's timestamp | Jumps to that trace's spans in SigNoz's own UI, tool calls, LLM span with tokens/cost, right there |
| **Live ticket feed / traffic indicator** | Last few `POST /tickets` responses | Gives the demo a pulse before the failure hits |
| **Demo control buttons** | `POST worker-service:4000/debug/break-db`, `/debug/spike-cost`, `/fix-*`, plus a "trigger unknown failure" button | Replaces typing curl commands live on stage with one click |
| **Status strip** | `GET worker-service:4000`, `GET watcher-service:4002/watcher/status` | Shows all services are up before you start |
| **Link-out to SigNoz** | `localhost:8080` | SigNoz's own UI is the source of truth for traces/alerts/dashboards, don't rebuild it |

### Why React/Next.js specifically

Next.js gives a single small app that can both serve the dashboard and (optionally) proxy calls to the 3 backend services, avoiding CORS setup during a rushed build. A plain Vite React app works too, the requirement is "one page, a few live-polling panels, a few buttons," not a framework choice.

### Functional requirements for the UI

| ID | Requirement |
|---|---|
| FR-UI-01 | Display all 3 current settings, refreshing automatically without a page reload. |
| FR-UI-02 | Display the incident list as a human-readable timeline, most recent first, refreshing automatically, tagged by which tier handled it. |
| FR-UI-03 | Provide one-click buttons for both failure triggers and both failure fixes, plus one for triggering an unrecognized alert to force Tier 2 to run live. |
| FR-UI-04 | Visually distinguish an "allowed" action from a "blocked" one in the incident timeline. |
| FR-UI-05 | Never require the presenter to open a terminal during the live demo. |

Not built yet. Nothing in the repo currently serves a browser page.

---

## 10. SigNoz: dashboards, alerts, exceptions, LLM cost

This section is the guide for making full use of SigNoz, not just as a data pipe, but as the system's actual observability surface, which is the whole point of the track.

### 10.1 Alerts (already built, reference)

| Alert | Type | Query | Threshold | Channel |
|---|---|---|---|---|
| `db-error-rate-alert` | Metric-based | `signoz_calls_total`, filter `service.name='worker-service' AND status.code='STATUS_CODE_ERROR'`, Rate/Sum | `> 0`, 5min rolling | `watcher-service` webhook |
| `cost-spike-alert` | Trace-based | `avg(estimated_cost_usd)`, filter `service.name='worker-service'` | `> 0.5`, 5min rolling | `watcher-service` webhook |

Both point at `http://watcher-service:4002/alerts/webhook`. To add a 3rd (e.g. for a future failure mode), repeat the same pattern, reuse the existing webhook channel, and give `diagnose.js` a matching branch or let Tier 2 handle it as unrecognized.

### 10.2 Exceptions

SigNoz's Exceptions tab tracks errors recorded via OpenTelemetry's `span.recordException()` API. This codebase calls it explicitly in `investigate.js`'s catch block, so any failure inside Tier 2 (a malformed LLM response, a network error calling Anthropic, a bug) will show up there, not just in `docker compose logs`. To verify once `ANTHROPIC_API_KEY` is set: check SigNoz's Exceptions tab after a Tier 2 run, especially useful for debugging a misbehaving investigation without needing container log access.

### 10.3 Dashboards to build (none exist yet, this is the plan)

Create via SigNoz UI -> Dashboards -> New Dashboard -> Add Panel. Suggested panels, each with the exact query to use:

| Panel | Data source | Query | Why it matters for the demo |
|---|---|---|---|
| Worker error rate | Metrics | `signoz_calls_total`, filter `status.code='STATUS_CODE_ERROR'`, group by `service.name` | Shows Failure A visually spiking and recovering |
| Cost per ticket over time | Traces | `avg(estimated_cost_usd)`, filter `service.name='worker-service'` | Shows Failure B's cost spike and the fix bringing it back down, live, on screen |
| LLM token usage | Traces | `sum(gen_ai.usage.input_tokens)` and `sum(gen_ai.usage.output_tokens)`, filter `service.name='watcher-service'` | Proves the agent is making real LLM calls, not faking it, exactly the "AI-native observability" ask |
| LLM investigation latency | Traces | `avg(durationNano)` on spans named `llm.investigate_turn` | Shows Tier 2's real-world response time |
| Agent tool-call volume | Traces | `count()` on spans named `signoz.query_recent_traces` / `signoz.query_error_spans` | Shows how many times the agent looked at telemetry before deciding |
| Incidents by tier (requires the optional tier tag from Section 11, step 9) | Traces or a custom metric exported from `remediation.service.js` | count grouped by tier | The "N resolved instantly, M required AI investigation" story for judges |

All of these are span **attributes already being set** by the code in this repo (`gen_ai.*` in `investigate.js`, `estimated_cost_usd` in `worker-service`, span names throughout), building the dashboard is pure SigNoz UI work, no new instrumentation needed.

### 10.4 LLM cost, concretely

Anthropic's per-token pricing multiplied by `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` (already captured per LLM call span) gives real dollar cost per investigation. A dashboard panel summing tokens over a time range, multiplied by the model's published rate, turns into a literal "here's what our AI agent cost us today" number, worth having on screen next to `estimated_cost_usd` (the fake business cost worker-service reports), the contrast between the two costs is a good demo beat.

---

## 11. Exact steps to close the gap

1. ~~Capture a real SigNoz alert payload~~ **Done.**
2. ~~Create both real SigNoz alert rules~~ **Done.**
3. ~~Wire `diagnose.js`, `safetyCheck.js`, `remediation.service.js`~~ **Done.**
4. ~~Build Tier 2: SigNoz query tools, LLM tool-calling loop, guardrails, tracing~~ **Done**, verified against real SigNoz data.
5. **Set `ANTHROPIC_API_KEY` and `SIGNOZ_API_KEY`** in a root `.env` file (see Section 6's "getting a SigNoz API key"), then fire an alert with a name that matches neither known pattern and watch Tier 2 actually reason.
6. **Build the UI** (Section 9).
7. **Build the SigNoz dashboards** (Section 10.3), all the underlying data already exists.
8. **Rehearse the full loop live**: break DB, watch it self-heal (Tier 1); fire an unrecognized alert, watch the LLM investigate and decide (Tier 2); show the dashboards updating; show the trace of the agent's own reasoning in SigNoz.
9. Optional polish: tag incidents with which tier handled them (add a column or prefix the `detected_via` string), export it as its own metric for the "N vs M" dashboard panel in Section 10.3.

---

## 12. Status matrix + readiness checklist

| Service | Built | Talks to control-plane | Runs in docker-compose | Real SigNoz-driven behavior |
|---|:---:|:---:|:---:|:---:|
| control-plane | Yes | n/a (it *is* the store) | Yes | Yes, all 3 services' traces reach SigNoz |
| worker-service | Yes | Yes | Yes | Tickets + debug switches work; custom trace labels done (FR-WK-08) |
| watcher-service (Tier 1) | Yes | Yes | Yes | Both known failures verified end to end with real SigNoz-fired alerts |
| watcher-service (Tier 2) | Yes | Yes | Yes | SigNoz query tools + tool-calling loop verified with real data; needs `ANTHROPIC_API_KEY` for the model call itself |
| UI | No | | | See Section 9 |
| SigNoz dashboards | No | | | See Section 10.3 |

**Readiness checklist:**
- [x] control-plane built, tested, layered, documented
- [x] worker-service built, tested, reads live settings from control-plane
- [x] watcher-service Tier 1 built, tested, both known failures verified live with real SigNoz alerts
- [x] All 4 containers build and run together via `docker compose up`
- [x] worker-service tags traces with `CONTRACTS.md` Section 3 labels (FR-WK-08)
- [x] `CONTRACTS.md` Section 2 filled with a real captured SigNoz alert payload
- [x] Both real SigNoz alert rules created and confirmed firing automatically end to end
- [x] `diagnose.js`, `safetyCheck.js`, `remediation.service.js` fully wired
- [x] Tier 2 built: real SigNoz Query API client, LLM tool-calling loop, guardrails, OTel spans, all verified against live infrastructure
- [ ] `ANTHROPIC_API_KEY` set and a live Tier 2 investigation run end to end with a real model response
- [ ] SigNoz dashboards built (Section 10.3)
- [ ] React/Next.js UI built with the panels in Section 9
- [x] Full Tier 1 loop demoed with zero manual curls after the initial failure trigger, for both failures, with real SigNoz-fired alerts

---

## 13. Run it yourself: Windows, Linux, macOS

Requires Docker Desktop running and SigNoz already up (`foundryctl cast`, see `casting.yaml`) since `docker-compose.yml` joins SigNoz's existing network. `docker compose` itself is identical on all 3 platforms, only the traffic-generation loop and env var syntax differ below.

### 1. Configure secrets (optional, only needed for Tier 2)

Create a `.env` file in the repo root (gitignored, never commit it):
```
SIGNOZ_API_KEY=<from SigNoz Settings -> Service Accounts, see Section 6>
ANTHROPIC_API_KEY=<from console.anthropic.com>
ANTHROPIC_MODEL=claude-sonnet-5
```
Without these, everything still works, Tier 2 just safely no-ops on unrecognized alerts instead of investigating.

### 2. Start everything (same command, all platforms)

```bash
docker compose up -d --build
docker compose ps
```
All 4 should show `Up`/`healthy`: `app-postgres`, `control-plane`, `watcher-service`, `worker-service`.

| Service | Port |
|---|---|
| control-plane | `4001` |
| watcher-service | `4002` |
| worker-service | `4000` |
| app-postgres | `5433` (host, avoids a local Postgres install on 5432) |
| SigNoz UI | `8080` |

### 3. Test the happy path and both failures (identical `curl` commands on macOS/Linux and Windows 10+, curl.exe ships built in)

```bash
curl -s http://localhost:4001/settings
curl -s -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'

# Failure A: break the DB, watch SigNoz fire the alert automatically within ~1-2 min
curl -s -X POST http://localhost:4000/debug/break-db
```

**Generate continuous traffic** (needed so SigNoz's alert has sustained data to evaluate against, a one-off ticket isn't enough):

- **macOS / Linux (bash):**
  ```bash
  while true; do curl -s -o /dev/null -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'; sleep 1; done
  ```
- **Windows (PowerShell):**
  ```powershell
  while ($true) { Invoke-RestMethod -Method Post -Uri http://localhost:4000/tickets -ContentType "application/json" -Body '{"customerId":"c1"}' | Out-Null; Start-Sleep -Seconds 1 }
  ```
- **Windows (Git Bash, if installed):** identical to the macOS/Linux command above.

Stop the loop (Ctrl+C), then:
```bash
curl -s http://localhost:4001/settings   # use_backup_data should now be true
curl -s http://localhost:4001/incidents  # a new row explaining what happened
curl -s -X POST http://localhost:4000/debug/fix-db
curl -s -X PUT http://localhost:4001/settings -H "Content-Type: application/json" -d '{"key":"use_backup_data","value":false,"updated_by":"reset"}'
```

Repeat with `/debug/spike-cost` / `/debug/fix-cost` and watch `active_model` flip instead, for Failure B.

### 4. Test Tier 2 (unrecognized alert)

```bash
curl -s -X POST http://localhost:4002/alerts/webhook -H "Content-Type: application/json" -d '{
  "alerts":[{"labels":{"alertname":"something-nobody-anticipated"}}],
  "commonLabels":{"alertname":"something-nobody-anticipated"}
}'
docker compose logs watcher-service --tail 10
```
Without `ANTHROPIC_API_KEY`: settings unchanged, incident logged as `"no automated fix, ANTHROPIC_API_KEY not configured"`. With it: the LLM actually investigates using SigNoz's telemetry and may propose a fix.

### 5. Watch it in SigNoz

Open `http://localhost:8080` -> Services tab, all 3 app services should be listed once they've handled a request. Alerts tab shows both rules and their firing history. Traces tab, search for `investigate.tier2` to see Tier 2's own reasoning as a trace.

### 6. Stop everything

```bash
docker compose down   # stop everything, keeps the Postgres volume
```

Per-service deep dives: [`control-plane/README.md`](control-plane/README.md), [`worker-service/README.md`](worker-service/README.md).
