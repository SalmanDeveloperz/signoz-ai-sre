// Pattern: Client. Isolates all calls to SigNoz's Query API behind named
// functions. This is Tier 2's read-only "eyes": the investigation agent
// (services/investigate.js) uses these as tools to look at real telemetry
// instead of guessing from the alert payload alone.
//
// Guardrail: this file only ever calls query_range (read-only). It never
// calls anything that could mutate SigNoz (dashboards, alert rules, etc).
//
// Auth: SigNoz requires a Service Account API key, generated at
// Settings -> Service Accounts -> a "viewer" role account -> Keys, passed
// as the SIGNOZ-API-KEY header. Viewer role specifically, since this
// client never needs to write anything.
//
// NOTE (found by hand, not documented anywhere obvious): traces query
// timestamps are nanoseconds since epoch, not milliseconds like most other
// timestamps in this codebase. Getting this wrong doesn't error, it just
// silently returns zero rows.

const SIGNOZ_URL = process.env.SIGNOZ_URL || 'http://signoz-signoz-0:8080';
const SIGNOZ_API_KEY = process.env.SIGNOZ_API_KEY || '';

async function queryRange(compositeQuery, { minutes = 15, limit = 10 } = {}) {
  if (!SIGNOZ_API_KEY) {
    return { ok: false, reason: 'SIGNOZ_API_KEY not configured' };
  }
  const endNs = Date.now() * 1e6;
  const startNs = endNs - minutes * 60 * 1e9;
  try {
    const res = await fetch(`${SIGNOZ_URL}/api/v4/query_range`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'SIGNOZ-API-KEY': SIGNOZ_API_KEY },
      body: JSON.stringify({ start: startNs, end: endNs, step: 60, compositeQuery }),
    });
    if (!res.ok) {
      return { ok: false, reason: `SigNoz query_range -> ${res.status}` };
    }
    const body = await res.json();
    const list = body?.data?.result?.[0]?.list || [];
    return { ok: true, rows: list.slice(0, limit).map((row) => row.data) };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function queryRecentTraces(serviceName, minutes = 15) {
  return queryRange(
    {
      queryType: 'builder',
      panelType: 'list',
      builderQueries: {
        A: {
          queryName: 'A',
          dataSource: 'traces',
          aggregateOperator: 'noop',
          aggregateAttribute: {},
          filters: { items: [{ key: { key: 'service.name' }, op: '=', value: serviceName }], op: 'AND' },
          expression: 'A',
          disabled: false,
          limit: 10,
          offset: 0,
          pageSize: 10,
          selectColumns: [
            { key: 'serviceName' },
            { key: 'name' },
            { key: 'durationNano' },
            { key: 'httpStatusCode' },
          ],
        },
      },
    },
    { minutes }
  );
}

async function queryErrorSpans(serviceName, minutes = 15) {
  return queryRange(
    {
      queryType: 'builder',
      panelType: 'list',
      builderQueries: {
        A: {
          queryName: 'A',
          dataSource: 'traces',
          aggregateOperator: 'noop',
          aggregateAttribute: {},
          filters: {
            items: [
              { key: { key: 'service.name' }, op: '=', value: serviceName },
              { key: { key: 'status.code' }, op: '=', value: 'STATUS_CODE_ERROR' },
            ],
            op: 'AND',
          },
          expression: 'A',
          disabled: false,
          limit: 10,
          offset: 0,
          pageSize: 10,
          selectColumns: [{ key: 'serviceName' }, { key: 'name' }, { key: 'durationNano' }],
        },
      },
    },
    { minutes }
  );
}

module.exports = { queryRecentTraces, queryErrorSpans };
