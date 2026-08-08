/**
 * SMS Service
 * 
 * Production: Integrates with Aliyun SMS API
 * Development: Returns code in response (for testing)
 * 
 * To enable production SMS:
 * 1. Set SMS_PROVIDER=aliyun in environment
 * 2. Set ALIYUN_SMS_KEY, ALIYUN_SMS_SECRET, ALIYUN_SMS_SIGN, ALIYUN_SMS_TEMPLATE
 * 3. Uses @alicloud/pop-core (RPC client) — already in package.json
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'dev'; // 'dev' or 'aliyun'
const CODE_EXPIRE_MINUTES = 5;
const SEND_INTERVAL_SECONDS = 60;

const db = require('../db');

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Send SMS via Aliyun (production).
 * Reads credentials from env vars; throws if not fully configured.
 */
async function sendSMSAliyun(phone, code) {
  const accessKeyId = process.env.ALIYUN_SMS_KEY;
  const accessKeySecret = process.env.ALIYUN_SMS_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE;

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new Error('阿里云短信未配置完整（请设置 ALIYUN_SMS_KEY / SECRET / SIGN / TEMPLATE）');
  }

  // Lazy require so dev mode never needs the SDK loaded at startup
  const Core = require('@alicloud/pop-core');
  const client = new Core({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://dysmsapi.aliyuncs.com',
    apiVersion: '2017-05-25'
  });

  const params = {
    PhoneNumbers: phone,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code })
  };

  const resp = await client.request('SendSms', params, { method: 'POST', format: 'JSON' });
  if (resp.Code !== 'OK') {
    throw new Error('短信发送失败: ' + (resp.Message || resp.Code));
  }
  return { success: true };
}

async function sendSMS(phone, code) {
  if (SMS_PROVIDER === 'aliyun') {
    try {
      return await sendSMSAliyun(phone, code);
    } catch (e) {
      console.error('[SMS][ALIYUN] 发送失败:', e.message);
      return { success: false, error: '短信发送失败：' + e.message };
    }
  } else {
    // Development mode: just log the code (returned to client for testing)
    console.log(`[SMS][DEV] To: ${phone}, Code: ${code}`);
    return { success: true, devCode: code };
  }
}

async function sendVerificationCode(phone) {
  const database = db.db();
  
  // Check send interval
  const existing = database.smsCodes
    .filter(c => c.phone === phone)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  
  if (existing) {
    const elapsed = (Date.now() - existing.createdAt) / 1000;
    if (elapsed < SEND_INTERVAL_SECONDS) {
      const wait = Math.ceil(SEND_INTERVAL_SECONDS - elapsed);
      return { success: false, error: `请${wait}秒后再试` };
    }
  }
  
  // Generate and store code
  const code = generateCode();
  database.smsCodes.push({
    id: db.genId('sms'),
    phone,
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + CODE_EXPIRE_MINUTES * 60 * 1000,
    used: false
  });
  db.save();
  
  // Send SMS
  const result = await sendSMS(phone, code);

  if (!result.success) {
    return { success: false, error: result.error || '短信发送失败，请稍后重试' };
  }
  
  const response = { success: true };
  if (result.devCode) {
    response.devCode = result.devCode; // Only in dev mode
  }
  return response;
}

function verifyCode(phone, code) {
  const database = db.db();
  const now = Date.now();
  
  // Find the latest unused, non-expired code for this phone
  const record = database.smsCodes
    .filter(c => c.phone === phone && !c.used && c.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  
  if (!record) {
    return { success: false, error: '验证码已过期，请重新获取' };
  }
  
  if (record.code !== code) {
    return { success: false, error: '验证码不正确' };
  }
  
  // Mark as used
  record.used = true;
  db.save();
  
  return { success: true };
}

module.exports = { sendVerificationCode, verifyCode };
