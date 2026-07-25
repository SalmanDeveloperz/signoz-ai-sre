// Pattern: Client. Isolates the Anthropic SDK call behind one function.
// Tier 2's actual "brain": given the alert and a set of tools, asks Claude
// to investigate and decide. investigate.js owns the tool-calling loop and
// the OTel spans around each turn; this file only knows how to make one
// call to the API, same separation of concerns as every other client in
// this codebase.

const Anthropic = require('@anthropic-ai/sdk');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function isConfigured() {
  return Boolean(client);
}

async function createMessage({ system, messages, tools }) {
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');
  return client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system,
    messages,
    tools,
  });
}

module.exports = { isConfigured, createMessage, ANTHROPIC_MODEL };
