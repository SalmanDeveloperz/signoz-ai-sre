// Pattern: Client. Isolates all calls to SigNoz behind named functions. Asks
// SigNoz "what just happened on worker-service?" after an alert fires, so
// diagnosis is based on real telemetry, not just the alert payload.
//
// STUB — implemented on Day 3. Two paths: the plain Query API first, then the
// SigNoz MCP server (UC6 stretch goal) once the plain path works.

const SIGNOZ_URL = process.env.SIGNOZ_URL || 'http://signoz:8080';

async function getRecentErrorLogs(serviceName, minutes = 2) {
  // TODO(Day 3): real /api query against SIGNOZ_URL. Returning empty keeps
  // Day 2's hardcoded-diagnosis path working before this is wired up.
  return { serviceName, minutes, logs: [] };
}

module.exports = { getRecentErrorLogs };
