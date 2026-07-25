// Pattern: Service Layer (orchestrator), Tier 2 of the agent. Runs only when
// diagnose.js's deterministic fast path (Tier 1) doesn't recognize the alert.
// This is where the system is genuinely AI-native: instead of giving up, an
// LLM investigates using real SigNoz telemetry as tools, then proposes a
// diagnosis and, optionally, a fix.
//
// Guardrails enforced here, not left to the model's good behavior:
//   - Tools are read-only queries against SigNoz (signozClient.js never
//     calls anything that mutates SigNoz state).
//   - The model can only propose one of the 3 known control-plane setting
//     keys (VALID_KEYS). Anything else is discarded, never applied.
//   - The whole investigation has a hard timeout. On timeout, failure, or a
//     missing ANTHROPIC_API_KEY, this falls back to a safe "no action,
//     needs human" result instead of hanging or guessing.
//   - The proposed action still passes through safetyCheck.js afterward in
//     remediation.service.js, same as Tier 1's path. No special privilege
//     for an AI-originated action.
//   - Every LLM call and every tool call gets its own OTel span, so the
//     agent's own investigation is visible as a trace in SigNoz, not just
//     the infra it's investigating.

const { trace } = require('@opentelemetry/api');
const llmClient = require('../clients/llmClient');
const signozClient = require('../clients/signozClient');

const VALID_KEYS = ['use_backup_data', 'active_model', 'retry_enabled'];
const INVESTIGATION_TIMEOUT_MS = 10000;
const MAX_TOOL_TURNS = 4;
const TRACER_NAME = 'watcher-service';

const TOOLS = [
  {
    name: 'query_recent_traces',
    description: "List recent spans for a service, to see what it's been doing.",
    input_schema: {
      type: 'object',
      properties: {
        serviceName: { type: 'string' },
        minutes: { type: 'number' },
      },
      required: ['serviceName'],
    },
  },
  {
    name: 'query_error_spans',
    description: 'List recent error spans (status.code = STATUS_CODE_ERROR) for a service.',
    input_schema: {
      type: 'object',
      properties: {
        serviceName: { type: 'string' },
        minutes: { type: 'number' },
      },
      required: ['serviceName'],
    },
  },
];

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

async function callTool(name, input) {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(`signoz.${name}`, async (span) => {
    span.setAttribute('signoz.tool', name);
    span.setAttribute('signoz.service_name', input.serviceName || '');
    let result;
    if (name === 'query_recent_traces') {
      result = await signozClient.queryRecentTraces(input.serviceName, input.minutes);
    } else if (name === 'query_error_spans') {
      result = await signozClient.queryErrorSpans(input.serviceName, input.minutes);
    } else {
      result = { ok: false, reason: `unknown tool: ${name}` };
    }
    span.setAttribute('signoz.ok', Boolean(result.ok));
    span.end();
    return result;
  });
}

async function runInvestigation(alertPayload) {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan('investigate.tier2', async (span) => {
    try {
      if (!llmClient.isConfigured()) {
        span.setAttribute('investigate.skipped', 'no_api_key');
        return safeFallback('ANTHROPIC_API_KEY not configured');
      }

      const messages = [{ role: 'user', content: `Alert payload:\n${JSON.stringify(alertPayload)}` }];

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await tracer.startActiveSpan('llm.investigate_turn', async (llmSpan) => {
          const res = await llmClient.createMessage({ system: SYSTEM_PROMPT, messages, tools: TOOLS });
          llmSpan.setAttribute('gen_ai.request.model', llmClient.ANTHROPIC_MODEL);
          llmSpan.setAttribute('gen_ai.usage.input_tokens', res.usage?.input_tokens || 0);
          llmSpan.setAttribute('gen_ai.usage.output_tokens', res.usage?.output_tokens || 0);
          llmSpan.setAttribute('gen_ai.response.stop_reason', res.stop_reason || '');
          llmSpan.end();
          return res;
        });

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason !== 'tool_use') {
          const textBlock = response.content.find((block) => block.type === 'text');
          span.setAttribute('investigate.turns', turn + 1);
          return parseFinalAnswer(textBlock ? textBlock.text : '');
        }

        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const result = await callTool(block.name, block.input || {});
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
        messages.push({ role: 'user', content: toolResults });
      }

      span.setAttribute('investigate.turns', MAX_TOOL_TURNS);
      return safeFallback('investigation exceeded max turns');
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
