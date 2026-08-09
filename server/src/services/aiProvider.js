/**
 * AI Provider (AGENTS §19).
 *
 * Real LLM client built on the OpenAI-compatible Chat Completions protocol, so
 * it works with DeepSeek / OpenAI / 通义千问(Qwen) / 智谱(GLM) / Kimi / 任意自建
 * OpenAI-compatible endpoint — only the base_url + model + key differ.
 *
 * The Bot engine is "AI when configured": it calls generateReply() lazily. With
 * no provider/key present (or on any network/API error) this returns null, so
 * the engine falls back to templates and costs zero. Never throws.
 *
 * Configure via environment variables (secrets stay out of db.json):
 *   AI_PROVIDER   deepseek | openai | qwen | glm | moonshot | openai-compatible
 *   AI_API_KEY    your provider key (required to actually call the model)
 *   AI_BASE_URL   optional override of the API base URL
 *   AI_MODEL      optional override of the model name
 *   AI_TEMPERATURE optional (default 0.9)
 *
 * @param {{message?:string, context?:string[], persona?:string, mode?:'reply'|'post'}} input
 * @returns {Promise<string|null>} generated text, or null to use templates
 */
const PROVIDER_DEFAULTS = {
  deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
  openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  glm: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  'openai-compatible': { baseURL: '', model: '' }
};

function resolveConfig() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  if (!provider) return null;
  const def = PROVIDER_DEFAULTS[provider];
  if (!def) return null;
  const baseURL = process.env.AI_BASE_URL || def.baseURL;
  const model = process.env.AI_MODEL || def.model;
  if (!baseURL || !model || !process.env.AI_API_KEY) return null;
  return {
    baseURL: baseURL.replace(/\/$/, ''),
    model,
    apiKey: process.env.AI_API_KEY,
    temperature: process.env.AI_TEMPERATURE ? parseFloat(process.env.AI_TEMPERATURE) : 0.9
  };
}

function buildMessages({ message, persona, mode }) {
  const character = persona && persona.trim()
    ? `你的角色设定是：${persona.trim()}。请始终用这个角色的口吻说话。`
    : '你是一个活泼、真诚的普通网友。';

  const replySystem =
    '你在一个匿名漂流瓶社区「漂屿」里和陌生网友聊天。' +
    character +
    '请针对用户刚丢出的漂流瓶内容，回一句自然、真诚、像真人网友的话。要求：' +
    '1) 用中文；2) 简短，不超过60字；3) 像朋友随口一句，不要说教、不要列条目、' +
    '不要用「作为一个AI」之类的话；4) 可以接话、提问或共情，但别过度热情；' +
    '5) 不要带#话题标签，不要刷表情包。只输出那一句话，不要加引号。';

  const postSystem =
    '你在一个匿名漂流瓶社区「漂屿」里。' +
    character +
    '请写一条你自己想丢出去的漂流瓶内容——像深夜无聊随手写的一句话，' +
    '邀请陌生人来聊天。要求：1) 用中文；2) 简短，不超过40字；3) 口语化、接地气，' +
    '像真人在吐槽或发呆，不要文艺腔、不要广告、不要链接；4) 不要带#话题标签，' +
    '不要刷表情包。只输出那一句话，不要加引号。';

  const system = mode === 'post' ? postSystem : replySystem;
  const user = mode === 'post'
    ? '请生成一条可以丢出去的漂流瓶内容。'
    : (message && message.trim() ? message.trim() : '（对方没有写具体内容）');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function cleanText(text, maxLen) {
  if (!text) return null;
  let t = String(text).trim();
  // strip a single pair of surrounding quotes if present
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/\s+/g, ' ');
  if (t.length > maxLen) t = t.slice(0, maxLen);
  return t || null;
}

async function generateReply(input = {}) {
  const cfg = resolveConfig();
  if (!cfg) return null; // no provider/key -> template mode (free)

  const mode = input.mode === 'post' ? 'post' : 'reply';
  const messages = buildMessages({ message: input.message, persona: input.persona, mode });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: 200,
        stream: false
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[AIProvider] HTTP ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    const maxLen = mode === 'post' ? 60 : 120;
    return cleanText(content, maxLen);
  } catch (e) {
    console.error('[AIProvider] request failed, falling back to template:', e.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Whether a real provider is wired up (for admin dashboard display).
function isConfigured() {
  return !!resolveConfig();
}

module.exports = { generateReply, isConfigured };
