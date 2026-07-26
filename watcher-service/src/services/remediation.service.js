// Pattern: Service Layer (orchestrator). THIS is the agent loop, the heart of
// watcher-service. It ties the other pieces together in a fixed order:
//
//   1. diagnose      : what is wrong? (services/diagnose.js)
//   2. safety-check  : is the chosen fix allowed? (services/safetyCheck.js)
//   3. apply         : flip the setting via control-plane (clients/controlPlaneClient.js)
//   4. report        : write a permanent incident record (control-plane)
//
// The ORDER never changes — that's what makes the agent predictable and
// auditable: a fix is never applied without a safety check first, and every
// alert gets an incident record whether it was allowed or blocked.
// alerts.controller.js already wraps this call in .catch(), so a thrown error
// here (e.g. control-plane unreachable) is logged, not silently swallowed, and
// simply skips the remaining steps for that alert.

const { trace } = require('@opentelemetry/api');
const { diagnose } = require('./diagnose');
const { checkSafety } = require('./safetyCheck');
const controlPlane = require('../clients/controlPlaneClient');

const tracer = trace.getTracer('watcher-service');

async function handleAlert(alert) {
  // One span wraps the whole remediation so the watcher's reasoning is one
  // trace in SigNoz, and the control-plane calls nest under it.
  return tracer.startActiveSpan('watcher.remediation', async (span) => {
    try {
      // 1. Diagnose.
      const result = await diagnose(alert);
      span.setAttribute('watcher.diagnosis', result.diagnosis);
      console.log(`[watcher] diagnosis: ${result.diagnosis}`);

      // 2. Read current state, then safety-check the proposed action.
      const settings = await controlPlane.getSettings();
      const safety = checkSafety(result.action, settings);
      span.setAttribute('watcher.action', result.action ? result.action.key : 'none');
      span.setAttribute('safety_check.result', safety.allowed ? 'allowed' : 'blocked');

      // 3. Apply the fix — unless there's nothing to do, or safety blocked it.
      if (!result.action) {
        console.log('[watcher] no action to take.');
      } else if (!safety.allowed) {
        console.log(`[watcher] safety check BLOCKED: ${safety.reason}`);
      } else {
        console.log(`[watcher] applying fix: ${result.action.key}=${result.action.value}`);
        await controlPlane.applySetting(result.action.key, result.action.value);
        console.log('[watcher] fix applied — worker will pick it up on its next ticket.');
      }

      // 4. Always record an incident — applied, blocked, or no-op — so there's
      //    a permanent audit trail outside SigNoz (CONTRACTS.md Section 5).
      const { id } = await controlPlane.reportIncident({
        detected_via: result.detected_via,
        diagnosis: result.diagnosis,
        action_taken: result.action ? `${result.action.key}=${result.action.value}` : 'none',
        safety_check_result: safety.allowed ? 'allowed' : 'blocked',
        cost_before: null,
        cost_after: null,
      });
      console.log(`[watcher] incident #${id} recorded.`);
    } finally {
      span.end();
    }
  });
}

module.exports = { handleAlert };
