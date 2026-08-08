/**
 * Content Moderation Service
 * 
 * Production: Integrates with Tencent Cloud Text Moderation API
 * Development: Uses local keyword filtering
 * 
 * To enable production moderation:
 * 1. Set MODERATION_PROVIDER=tencent in environment
 * 2. Set TENCENT_SECRET_ID, TENCENT_SECRET_KEY
 * 3. Uses tencentcloud-sdk-nodejs-tms (already in package.json)
 *    - 缺密钥时自动回退本地关键词过滤
 *    - API 调用失败/不合规(Suggestion!=Pass)时拦截内容
 */

const MODERATION_PROVIDER = process.env.MODERATION_PROVIDER || 'local';

// Basic sensitive word list (expand in production)
const SENSITIVE_WORDS = [
  // Political
  '反动', '颠覆', '台独', '藏独', '疆独',
  // Violence
  '炸弹', '枪支', '弹药', '杀人', '自杀', '恐怖',
  // Sexual
  '色情', '淫秽', '卖淫', '嫖娼', '裸体', '性服务',
  // Gambling
  '赌博', '博彩', '彩票',
  // Drugs
  '毒品', '大麻', '海洛因', '冰毒', '吸毒',
  // Fraud
  '诈骗', '传销', '洗钱',
  // Other
  '广告', '微信号', 'QQ群', '加我', '免费领'
];

function moderateLocal(text) {
  const lower = text.toLowerCase();
  for (const word of SENSITIVE_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      return {
        pass: false,
        reason: `内容包含敏感词：${word}`,
        suggestion: '请修改后重新发布'
      };
    }
  }
  return { pass: true };
}

/**
 * Tencent Cloud Text Moderation (production).
 * Reads credentials from env; falls back to local filter if keys missing.
 */
async function moderateTencent(text) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;

  if (!secretId || !secretKey) {
    console.warn('[MODERATION][TENCENT] 密钥未配置，回退本地关键词过滤');
    return moderateLocal(text);
  }

  // Lazy require so local mode never loads the SDK at startup
  const tencentcloud = require('tencentcloud-sdk-nodejs-tms');
  const TmsClient = tencentcloud.tms.v20200713.Client;

  const client = new TmsClient({
    credential: { secretId, secretKey },
    region: 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'tms.tencentcloudapi.com' } }
  });

  const resp = await client.TextModeration({
    Content: Buffer.from(text, 'utf-8').toString('base64')
  });

  // Suggestion: 'Pass' (通过) / 'Review' (疑似) / 'Block' (违规)
  if (resp.Suggestion === 'Pass') {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `内容疑似不合规（腾讯云审核标记：${resp.Label || resp.Suggestion || '未知'}）`,
    suggestion: '请修改后重新发布'
  };
}

async function moderate(text) {
  if (!text || text.trim().length === 0) {
    return { pass: false, reason: '内容不能为空' };
  }
  
  if (MODERATION_PROVIDER === 'tencent') {
    return moderateTencent(text);
  }
  return moderateLocal(text);
}

module.exports = { moderate, SENSITIVE_WORDS };
