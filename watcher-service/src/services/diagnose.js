// Pattern: Service Layer. Two tiers, in order:
//
//   Tier 1 (below, this function): a plain if/else on the alert rule name for
//   the 2 known failure modes, on purpose — an LLM buys unpredictability where
//   predictability is the whole point. The alert rule name is how the two
//   alerts are told apart, since both arrive at the same webhook URL. Real
//   payload shape confirmed in CONTRACTS.md Section 2: the rule name lives at
//   alerts[0].labels.alertname (mirrored at commonLabels.alertname).
//
//   Tier 2 (services/investigate.js): only reached when Tier 1 doesn't
//   recognize the alert. This is where an LLM actually investigates using
//   real SigNoz telemetry as tools, instead of the system just giving up.
//   Tier 1 always wins when it applies, keeping the 2 demoed failures fast
//   and deterministic; Tier 2 only runs for the cases nobody anticipated.

const { investigate } = require('./investigate');

function getAlertName(alertPayload) {
  return (
    alertPayload?.alerts?.[0]?.labels?.alertname ||
    alertPayload?.commonLabels?.alertname ||
    ''
  );
}

async function diagnose(alertPayload) {
  const alertname = getAlertName(alertPayload);

  // Tier 1 — known failures, deterministic.
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

  // Tier 2 — unrecognized alert: let the LLM investigate via SigNoz instead
  // of giving up. Returns { diagnosis, action } (action may be null).
  const investigation = await investigate(alertPayload);
  return {
    diagnosis: investigation.diagnosis,
    action: investigation.action,
    detected_via: alertname || 'unknown',
  };
}

module.exports = { diagnose };
