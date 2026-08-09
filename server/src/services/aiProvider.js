/**
 * AI Provider abstraction (AGENTS §19).
 *
 * The Bot engine is template-first: it only calls an AI model when
 * `enable_ai_reply` is on AND a real provider is configured. With no API key
 * present this always returns null, so the engine falls back to templates and
 * costs zero. The interface mirrors the spec so a real provider (OpenAI,
 * 国内模型, self-hosted) can be wired in without touching bot logic.
 *
 * @param {{message:string, context?:string[], persona?:string}} input
 * @returns {Promise<string|null>} generated reply, or null to use templates
 */
async function generateReply({ message, context, persona }) {
  // No provider configured -> template mode (free, zero API cost).
  if (!process.env.AI_PROVIDER || !process.env.AI_API_KEY) {
    return null;
  }

  // Real provider wiring would live here, e.g.:
  //   const text = await callProvider({ message, context, persona });
  //   return text;
  // For now we intentionally fall back to templates to keep costs at zero.
  return null;
}

module.exports = { generateReply };
