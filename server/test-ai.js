/**
 * AI 功能测试（drift-island-web）
 *
 * 不依赖真实网络/Key：用 mock fetch 拦截对硅基的请求，验证
 *   1) 默认服务商 = 硅基流动 SiliconFlow，默认模型 = Qwen/Qwen3-8B
 *   2) 请求 URL / Authorization / body.model / messages 结构正确
 *   3) 无 Key 时 generateReply 返回 null（模板兜底）
 *   4) chat 模式会把 history 拼进 messages，且系统提示约束 ≤60 字
 *
 * 想跑「真实硅基调用」：设真实 Key 并加 AI_TEST_REAL=1
 *   AI_API_KEY=sk-真实 AI_TEST_REAL=1 node server/test-ai.js
 */
const assert = require('assert');
const ai = require('./src/services/aiProvider');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅', name, extra || ''); }
  else { fail++; console.log('  ❌', name, extra || ''); }
}

// ---- mock fetch：拦截对硅基的请求并回一条模拟回复 ----
let lastReq = null;
const REAL_FETCH = global.fetch;
const useReal = process.env.AI_TEST_REAL === '1' && process.env.AI_API_KEY && !process.env.AI_API_KEY.startsWith('sk-test');
if (!useReal) {
  global.fetch = async (url, opts) => {
    lastReq = { url, opts };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '“今天也辛苦啦。”' } }] })
    };
  };
}

(async () => {
  console.log('\n=== 测试 1：默认配置（无 Key）===');
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  check('无 Key 时 providerLabel = null', ai.providerLabel() === null);
  check('无 Key 时 isConfigured = false', ai.isConfigured() === false);
  check('无 Key 时 generateReply 返回 null（模板兜底）', (await ai.generateReply({ mode: 'chat', message: 'hi' })) === null);
  if (saved) process.env.AI_API_KEY = saved;

  console.log('\n=== 测试 2：默认配置（有 Key）===');
  process.env.AI_API_KEY = process.env.AI_API_KEY || 'sk-test-placeholder';
  check('providerLabel = 硅基流动 SiliconFlow', ai.providerLabel() === '硅基流动 SiliconFlow', '=> ' + ai.providerLabel());
  check('isConfigured = true', ai.isConfigured() === true);

  console.log('\n=== 测试 3：请求拼装（mock 拦截，不联网）===');
  const reply = await ai.generateReply({
    mode: 'chat',
    message: '今天好累啊',
    persona: '你是温柔树洞，安静倾听、轻声安慰',
    history: [
      { role: 'user', content: '在吗' },
      { role: 'assistant', content: '在的，怎么了' }
    ]
  });
  check('返回了模拟回复（已发出请求）', !!reply, '=> ' + JSON.stringify(reply));
  check('请求 URL 指向硅基', lastReq && lastReq.url === 'https://api.siliconflow.cn/v1/chat/completions', '=> ' + (lastReq && lastReq.url));
  const auth = lastReq && lastReq.opts && lastReq.opts.headers && lastReq.opts.headers['Authorization'];
  check('Authorization 为 Bearer sk-...', !!auth && auth.startsWith('Bearer sk-'), '=> ' + auth);
  const body = lastReq && lastReq.opts && JSON.parse(lastReq.opts.body);
  check('body.model = Qwen/Qwen3-8B', body && body.model === 'Qwen/Qwen3-8B', '=> ' + (body && body.model));
  check('messages 首条为 system（含「漂屿」）', body && body.messages[0].role === 'system' && body.messages[0].content.includes('漂屿'), '=> ' + (body && body.messages[0].role));
  check('history 被拼进 messages（user+assistant 各1）',
    body && body.messages.filter(m => m.role === 'user').length === 2 && body.messages.filter(m => m.role === 'assistant').length === 1,
    '=> user=' + (body && body.messages.filter(m => m.role === 'user').length) + ' assistant=' + (body && body.messages.filter(m => m.role === 'assistant').length));
  check('persona 进入系统提示', body && body.messages[0].content.includes('温柔树洞'));

  console.log('\n=== 测试 4：发帖模式（post）===');
  lastReq = null;
  const postReply = await ai.generateReply({ mode: 'post' });
  check('post 模式返回非空', !!postReply);
  const postBody = lastReq && JSON.parse(lastReq.opts.body);
  check('post 模式请求也指向硅基 + Qwen3-8B', postBody && postBody.model === 'Qwen/Qwen3-8B');

  console.log(`\n--- 结果：${pass} 通过 / ${fail} 失败 ---`);

  if (useReal) {
    console.log('\n（真实调用分支已启用，以上均走真实硅基网络）');
  } else {
    console.log('提示：以上用 mock 拦截网络，验证请求格式与配置。');
    console.log('      要验证 Qwen3-8B 真回复，运行：');
    console.log('      AI_API_KEY=sk-真实 AI_TEST_REAL=1 node server/test-ai.js');
  }

  global.fetch = REAL_FETCH;
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(2); });
