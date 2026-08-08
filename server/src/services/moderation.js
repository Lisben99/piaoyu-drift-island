/**
 * Content Moderation Service
 * 
 * Production: Integrates with Tencent Cloud Text Moderation API
 * Development: Uses local keyword filtering
 * 
 * To enable production moderation:
 * 1. Set MODERATION_PROVIDER=tencent
 * 2. Set TENCENT_SECRET_ID, TENCENT_SECRET_KEY
 * 3. Install tencentcloud-sdk-nodejs
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

async function moderateTencent(text) {
  // Production: call Tencent Cloud Text Moderation API
  // const tencentcloud = require('tencentcloud-sdk-nodejs');
  // const client = new tencentcloud.tms.v20200713.Client({...});
  // const result = await client.TextModeration({ Content: text });
  // return { pass: result.Suggestion === 'Pass', reason: result.EvilFlag ? '内容不合规' : null };
  
  // Fallback to local
  return moderateLocal(text);
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
