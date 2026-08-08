/**
 * SMS Service
 * 
 * Production: Integrates with Aliyun SMS API
 * Development: Returns code in response (for testing)
 * 
 * To enable production SMS:
 * 1. Set SMS_PROVIDER=aliyun in environment
 * 2. Set ALIYUN_SMS_KEY, ALIYUN_SMS_SECRET, ALIYUN_SMS_SIGN, ALIYUN_SMS_TEMPLATE
 * 3. Install @alicloud/sms20170525 or use HTTP API directly
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'dev'; // 'dev' or 'aliyun'
const CODE_EXPIRE_MINUTES = 5;
const SEND_INTERVAL_SECONDS = 60;

const db = require('../db');

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendSMS(phone, code) {
  if (SMS_PROVIDER === 'aliyun') {
    // Production: call Aliyun SMS API
    // const { sendSms } = require('./aliyun-sms');
    // return sendSms(phone, code);
    
    // Placeholder - implement with real SDK when credentials are available
    console.log(`[SMS] To: ${phone}, Code: ${code} (Aliyun SMS - configure credentials)`);
    return Promise.resolve({ success: true });
  } else {
    // Development mode: just log the code
    console.log(`[SMS][DEV] To: ${phone}, Code: ${code}`);
    return Promise.resolve({ success: true, devCode: code });
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
    return { success: false, error: '短信发送失败，请稍后重试' };
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
