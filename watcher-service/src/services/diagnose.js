// Pattern: Service Layer. The decision-making: "what is wrong, and what one
// setting should we flip?" A plain if/else on the alert rule name on purpose:
// for 2 known failure modes an LLM buys unpredictability during a live demo.
// The alert rule name is how the two alerts are told apart, since both arrive
// at the same webhook URL.
//
// Day 2: real branches, but diagnosis still trusts the alert. Day 3 adds a
// SigNoz query (signozClient) so it confirms the failure from real telemetry.

// CONTRACTS.md Section 2 isn't finalized yet, so we don't know the exact field
// SigNoz uses for the rule name. This reads whichever of the common shapes is
// present, so diagnose keeps working once A pastes in the real payload.
function extractRuleName(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload.ruleName,
    payload.alertName,
    payload.commonLabels && payload.commonLabels.alertname,
    Array.isArray(payload.alerts) &&
      payload.alerts[0] &&
      payload.alerts[0].labels &&
      payload.alerts[0].labels.alertname,
  ];
  return candidates.find((c) => typeof c === 'string' && c.length > 0) || '';
}

async function diagnose(alertPayload) {
  const ruleName = extractRuleName(alertPayload);
  const n = ruleName.toLowerCase();

  // Failure A — database outage. Fix: fall back to backup data.
  if (n.includes('db') || n.includes('error') || n.includes('error-rate')) {
    return {
      diagnosis: 'customer-db unreachable — elevated error rate on worker-service',
      action: { key: 'use_backup_data', value: true },
      detected_via: ruleName || 'db-error-rate-alert',
    };
  }

  // Failure B — cost per ticket spiked. Fix: switch to the cheaper model.
  if (n.includes('cost')) {
    return {
      diagnosis: 'estimated cost per ticket abnormally high',
      action: { key: 'active_model', value: 'gpt-cheap' },
      detected_via: ruleName || 'cost-spike-alert',
// at the same webhook URL. Real payload shape confirmed in CONTRACTS.md
// Section 2 (captured from an actual db-error-rate-alert firing): the rule
// name lives at alerts[0].labels.alertname (mirrored at commonLabels.alertname).

function getAlertName(alertPayload) {
  return (
    alertPayload?.alerts?.[0]?.labels?.alertname ||
    alertPayload?.commonLabels?.alertname ||
    ''
  );
}

async function diagnose(alertPayload) {
  const alertname = getAlertName(alertPayload);

  if (alertname.includes('db-error-rate')) {
    return {
      diagnosis: 'customer-db unreachable, error rate crossed threshold',
      action: { key: 'use_backup_data', value: true },
      detected_via: alertname,
    };
  }

  if (alertname.includes('cost-spike')) {
    return {
      diagnosis: 'per-ticket cost crossed threshold',
      action: { key: 'active_model', value: 'gpt-cheap' },
      detected_via: alertname,
    };
  }

  return {
    diagnosis: `unrecognized alert (${ruleName || 'no rule name'}), no action taken`,
    action: null,
    detected_via: ruleName,
    diagnosis: `unrecognized alert: ${alertname || 'unknown'}`,
    action: null,
    detected_via: alertname,
  };
}

module.exports = { diagnose };
