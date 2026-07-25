// Pattern: Service Layer (orchestrator), Tier 2 of the agent. Runs only when
// diagnose.js's deterministic fast path (Tier 1) doesn't recognize the alert.
// This is where the system is genuinely AI-native: instead of giving up, an
// LLM investigates using real SigNoz telemetry as tools, then proposes a
// diagnosis and, optionally, a fix.
//
// Provider-agnostic on purpose: this file calls the Vercel AI SDK's
// generateText() with a model object from llmClient.getModel(). It never
// imports a provider SDK (Anthropic/Google/OpenAI) directly, so switching
// LLM_PROVIDER in .env is the only change needed to run on a different model.
//
// Guardrails enforced here, not left to the model's good behavior:
//   - Tools are read-only queries against SigNoz (signozClient.js never
//     calls anything that mutates SigNoz state).
//   - The model can only propose one of the 3 known control-plane setting
//     keys (VALID_KEYS). Anything else is discarded, never applied.
//   - The whole investigation has a hard timeout. On timeout, failure, or a
//     missing API key for the configured provider, this falls back to a
//     safe "no action, needs human" result instead of hanging or guessing.
//   - The proposed action still passes through safetyCheck.js afterward in
//     remediation.service.js, same as Tier 1's path. No special privilege
//     for an AI-originated action.
//   - Every tool call gets its own OTel span, and the overall investigation
//     span carries gen_ai.* usage attributes, so the agent's own
//     investigation is visible as a trace in SigNoz, not just the infra
//     it's investigating.

const { trace } = require('@opentelemetry/api');
const { generateText, tool } = require('ai');
const { z } = require('zod');
const llmClient = require('../clients/llmClient');
const signozClient = require('../clients/signozClient');

const VALID_KEYS = ['use_backup_data', 'active_model', 'retry_enabled'];
const INVESTIGATION_TIMEOUT_MS = 10000;
const MAX_STEPS = 4;
const TRACER_NAME = 'watcher-service';

const SYSTEM_PROMPT = `You are an SRE investigation agent for a small system with 3 services:
worker-service (handles support tickets), control-plane (holds 3 settings), and
watcher-service (you). An alert fired that does not match any known failure
pattern. Investigate using your tools, then respond with ONLY a JSON object,
no other text:
{"diagnosis": "<one sentence, what you found>", "action": null | {"key": "use_backup_data"|"active_model"|"retry_enabled", "value": <matching value>}}
Only propose an action if you have real evidence from the tools supporting it.
If you're not confident, set action to null and say so in the diagnosis.`;

function safeFallback(reason) {
  return { diagnosis: `no automated fix, ${reason}`, action: null };
}

function parseFinalAnswer(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    let action = null;
    if (parsed.action && VALID_KEYS.includes(parsed.action.key)) {
      action = { key: parsed.action.key, value: parsed.action.value };
    }
    return { diagnosis: parsed.diagnosis || 'investigated, no clear diagnosis', action };
  } catch {
    return safeFallback('could not parse the investigation result');
  }
}

function buildTools(tracer) {
  return {
    query_recent_traces: tool({
      description: "List recent spans for a service, to see what it's been doing.",
      parameters: z.object({
        serviceName: z.string().describe('e.g. worker-service, control-plane, watcher-service'),
        minutes: z.number().optional().describe('lookback window, defaults to 15'),
      }),
      execute: async ({ serviceName, minutes }) =>
        tracer.startActiveSpan('signoz.query_recent_traces', async (span) => {
          span.setAttribute('signoz.tool', 'query_recent_traces');
          span.setAttribute('signoz.service_name', serviceName);
          const result = await signozClient.queryRecentTraces(serviceName, minutes);
          span.setAttribute('signoz.ok', Boolean(result.ok));
          span.end();
          return result;
        }),
    }),
    query_error_spans: tool({
      description: 'List recent error spans (status.code = STATUS_CODE_ERROR) for a service.',
      parameters: z.object({
        serviceName: z.string(),
        minutes: z.number().optional(),
      }),
      execute: async ({ serviceName, minutes }) =>
        tracer.startActiveSpan('signoz.query_error_spans', async (span) => {
          span.setAttribute('signoz.tool', 'query_error_spans');
          span.setAttribute('signoz.service_name', serviceName);
          const result = await signozClient.queryErrorSpans(serviceName, minutes);
          span.setAttribute('signoz.ok', Boolean(result.ok));
          span.end();
          return result;
        }),
    }),
  };
}

async function runInvestigation(alertPayload) {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan('investigate.tier2', async (span) => {
    span.setAttribute('investigate.provider', llmClient.LLM_PROVIDER);
    span.setAttribute('gen_ai.request.model', llmClient.LLM_MODEL);
    try {
      if (!llmClient.isConfigured()) {
        span.setAttribute('investigate.skipped', 'no_api_key');
        return safeFallback(`${llmClient.LLM_PROVIDER} API key not configured`);
      }

      const result = await generateText({
        model: llmClient.getModel(),
        system: SYSTEM_PROMPT,
        prompt: `Alert payload:\n${JSON.stringify(alertPayload)}`,
        tools: buildTools(tracer),
        maxSteps: MAX_STEPS,
      });

      span.setAttribute('gen_ai.usage.input_tokens', result.usage?.promptTokens || 0);
      span.setAttribute('gen_ai.usage.output_tokens', result.usage?.completionTokens || 0);
      span.setAttribute('investigate.steps', result.steps?.length || 0);

      return parseFinalAnswer(result.text || '');
    } catch (err) {
      span.recordException(err);
      return safeFallback(`investigation error: ${err.message}`);
    } finally {
      span.end();
    }
  });
}

async function investigate(alertPayload) {
  return Promise.race([
    runInvestigation(alertPayload),
    new Promise((resolve) =>
      setTimeout(() => resolve(safeFallback('investigation timed out')), INVESTIGATION_TIMEOUT_MS)
    ),
  ]);
}

module.exports = { investigate };
