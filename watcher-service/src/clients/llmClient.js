// Pattern: Client. Picks and constructs whichever LLM provider is configured
// via LLM_PROVIDER, using the Vercel AI SDK's unified model interface. This
// is the ONLY file in the codebase that knows provider-specific package
// names. investigate.js just calls getModel() and hands the result to the
// AI SDK's generateText(), it never touches a provider SDK directly.
// Swapping providers, or adding a new one, is a change here only.

const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const LLM_MODEL = process.env.LLM_MODEL || '';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o-mini',
};

function isConfigured() {
  if (LLM_PROVIDER === 'gemini') return Boolean(GOOGLE_API_KEY);
  if (LLM_PROVIDER === 'anthropic') return Boolean(ANTHROPIC_API_KEY);
  if (LLM_PROVIDER === 'openai') return Boolean(OPENAI_API_KEY);
  return false;
}

function getModel() {
  const modelId = LLM_MODEL || DEFAULT_MODELS[LLM_PROVIDER];

  if (LLM_PROVIDER === 'gemini') {
    const { createGoogleGenerativeAI } = require('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey: GOOGLE_API_KEY })(modelId);
  }
  if (LLM_PROVIDER === 'anthropic') {
    const { createAnthropic } = require('@ai-sdk/anthropic');
    return createAnthropic({ apiKey: ANTHROPIC_API_KEY })(modelId);
  }
  if (LLM_PROVIDER === 'openai') {
    const { createOpenAI } = require('@ai-sdk/openai');
    return createOpenAI({ apiKey: OPENAI_API_KEY })(modelId);
  }
  throw new Error(`Unknown LLM_PROVIDER: ${LLM_PROVIDER}`);
}

module.exports = { isConfigured, getModel, LLM_PROVIDER, LLM_MODEL: LLM_MODEL || DEFAULT_MODELS[LLM_PROVIDER] };
