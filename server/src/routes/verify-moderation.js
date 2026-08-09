/**
 * TEMPORARY verification route — 仅用于确认腾讯云密钥是否真实可用。
 * 验证完成后由部署流程移除，不长期存在。
 * 不回显任何密钥明文，只返回布尔与腾讯云原始响应。
 */
const express = require('express');
const router = express.Router();

const TENCENT_REAL = process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY;

router.get('/', async (req, res) => {
  const out = {
    provider: process.env.MODERATION_PROVIDER || 'local',
    hasTencentKeys: !!TENCENT_REAL,
    raw: null,
    error: null
  };
  if (!TENCENT_REAL) {
    out.note = '未配置 TENCENT_SECRET_ID/KEY，当前为本地关键词过滤';
    return res.json(out);
  }
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs-tms');
    const TmsClient = tencentcloud.tms.v20200713.Client;
    const client = new TmsClient({
      credential: { secretId: process.env.TENCENT_SECRET_ID, secretKey: process.env.TENCENT_SECRET_KEY },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'tms.tencentcloudapi.com' } }
    });
    out.raw = await client.TextModeration({ Content: Buffer.from('测试正常内容').toString('base64') });
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
  }
  res.json(out);
});

module.exports = router;
