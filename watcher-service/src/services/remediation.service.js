// Pattern: Service Layer (orchestrator). THIS is the agent loop, the heart of
// watcher-service. It ties the other pieces together in a fixed order:
//
//   1. diagnose      : what is wrong? (services/diagnose.js)
//   2. safety-check  : is the chosen fix allowed? (services/safetyCheck.js)
//   3. apply         : flip the setting via control-plane (clients/controlPlaneClient.js)
//   4. report        : write a permanent incident record (control-plane)
//
// This order never changes, which is what makes the agent's behavior
// predictable and auditable: a fix is never applied without a safety check
// first, and every alert gets an incident record whether it was allowed or
// blocked. alerts.controller.js already wraps this call in .catch(), so a
// thrown error here (e.g. control-plane unreachable) is logged, not silently
// swallowed, and simply skips the remaining steps for that alert.

const { diagnose } = require('./diagnose');
const { checkSafety } = require('./safetyCheck');
const controlPlane = require('../clients/controlPlaneClient');

async function handleAlert(alert) {
  // Step 1: diagnose.
  const result = await diagnose(alert);
  console.log(
    `diagnosis: ${result.diagnosis} ` +
      `(action: ${result.action ? `${result.action.key}=${result.action.value}` : 'none'})`
  );

  // Step 2: safety check, against the settings as they are right now.
  const settings = await controlPlane.getSettings();
  const safety = checkSafety(result.action, settings);

  // Step 3: apply, only if the fix was both proposed and allowed.
  if (!safety.allowed) {
    console.log(`safety check BLOCKED: ${safety.reason}`);
  } else if (result.action) {
    await controlPlane.applySetting(result.action.key, result.action.value);
    console.log(`applied fix: ${result.action.key}=${result.action.value}`);
  }

  // Step 4: report, always, whether allowed, blocked, or no action at all.
  await controlPlane.reportIncident({
    detected_via: result.detected_via,
    diagnosis: result.diagnosis,
    action_taken: result.action ? `${result.action.key}=${result.action.value}` : 'none',
    safety_check_result: safety.allowed ? 'allowed' : 'blocked',
    cost_before: null,
    cost_after: null,
  });
}

module.exports = { handleAlert };
