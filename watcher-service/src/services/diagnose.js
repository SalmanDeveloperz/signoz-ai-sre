// Pattern: Service Layer. The decision-making — "what is wrong, and what one
// setting should we flip?" A plain if/else on the alert rule name on purpose:
// for 2 known failure modes an LLM buys unpredictability during a live demo.
// The alert rule name (CONTRACTS.md Section 2) is how the two alerts are told
// apart, since both arrive at the same webhook URL.
//
// STUB — real branches wired on Day 3. Returns "no action" so the loop is safe
// to run before they exist.

async function diagnose(alertPayload) {
  const ruleName = (alertPayload && alertPayload.ruleName) || '';

  // TODO(Day 3):
  //   ruleName includes 'db-error-rate' -> { key: 'use_backup_data', value: true }
  //   ruleName includes 'cost-spike'    -> { key: 'active_model', value: 'gpt-cheap' }

  return { diagnosis: 'skeleton: no diagnosis yet', action: null, detected_via: ruleName };
}

module.exports = { diagnose };
