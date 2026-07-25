// Pattern: Service Layer. The decision-making: "what is wrong, and what one
// setting should we flip?" A plain if/else on the alert rule name on purpose:
// for 2 known failure modes an LLM buys unpredictability during a live demo.
// The alert rule name is how the two alerts are told apart, since both arrive
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
    diagnosis: `unrecognized alert: ${alertname || 'unknown'}`,
    action: null,
    detected_via: alertname,
  };
}

module.exports = { diagnose };
