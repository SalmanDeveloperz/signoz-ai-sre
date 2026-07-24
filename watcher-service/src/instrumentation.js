// instrumentation.js — watcher-service
// Connects this service to SigNoz. Must be the FIRST require in server.js so
// it can auto-instrument Express/HTTP before those modules load. Same pattern
// as control-plane's; only OTEL_SERVICE_NAME differs (set in docker-compose).
//
// NOTE: traces only for now, matching the shared pattern. watcher-service's
// value is its *reasoning*, which shows up as logs — once the team adds a logs
// exporter to this shared file (Member A's task), the diagnosis lines this
// service prints will also land in SigNoz. Until then they're visible via
// `docker compose logs watcher-service`.

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'unnamed-service',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://signoz-ingester:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().then(() => process.exit(0));
});
