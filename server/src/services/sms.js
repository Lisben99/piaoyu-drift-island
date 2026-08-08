/**
 * SMS Service — 阿里云「短信认证」(号码认证服务 Dypnsapi 2017-05-25)
 *
 * 适用场景：个人实名认证账号（无企业资质）。免资质 / 签名 / 模板，使用控制台
 * 「系统赠送」的签名与模板。
 *   生产发码：SendSmsVerifyCode（阿里云生成验证码并下发，校验由阿里云闭环完成）
 *   生产校验：CheckSmsVerifyCode（异步，调用方需 await）
 *   开发模式：本地生成 + 控制台打印 + 返回 devCode（前端显示用）
 *
 * 环境变量（在 Render 控制台填写，render.yaml 中 sync:false）：
 *   SMS_PROVIDER      aliyun | dev
 *   ALIYUN_SMS_KEY    阿里云 AccessKeyId
 *   ALIYUN_SMS_SECRET 阿里云 AccessKeySecret
 *   ALIYUN_SMS_SIGN   控制台「系统赠送」的签名名称
 *   ALIYUN_SMS_TEMPLATE 控制台「系统赠送」的验证码模板编号
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'dev'; // 'dev' | 'aliyun'
const CODE_EXPIRE_MINUTES = 5;
const SEND_INTERVAL_SECONDS = 60;

const db = require('../db');

// 进程内发送间隔记录（dev 与 aliyun 共用，重启即清空，仅用于限频）
const lastSendAt = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

let _client = null;
function getClient() {
  if (_client) return _client;
  const accessKeyId = process.env.ALIYUN_SMS_KEY;
  const accessKeySecret = process.env.ALIYUN_SMS_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('阿里云短信未配置完整（请在 Render 设置 ALIYUN_SMS_KEY / ALIYUN_SMS_SECRET）');
  }
  // 懒加载：dev 模式永远不会触发
  const Dypnsapi = require('@alicloud/dypnsapi20170525');
  const Client = Dypnsapi.default; // tea SDK 的 Client 是 default 导出
  _client = new Client({
    accessKeyId,
    accessKeySecret,
    endpoint: 'dypnsapi.aliyuncs.com'
  });
  return _client;
}

async function sendSMSAliyun(phone) {
  const signName = process.env.ALIYUN_SMS_SIGN;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE;
  if (!signName || !templateCode) {
    throw new Error('阿里云短信未配置完整（请在 Render 设置 ALIYUN_SMS_SIGN / ALIYUN_SMS_TEMPLATE）');
  }
  const client = getClient();
  const Dypnsapi = require('@alicloud/dypnsapi20170525');
  const req = new Dypnsapi.SendSmsVerifyCodeRequest({
    phoneNumber: phone,
    signName,
    templateCode,
    codeType: 1,             // 1 = 数字
    codeLength: 6,
    validTime: CODE_EXPIRE_MINUTES * 60,   // 注意：该接口单位是秒
    interval: SEND_INTERVAL_SECONDS,
    countryCode: '86',       // 该接口仅支持国内号码，固定 86
    // 系统生成验证码模式：##code## 由阿里云按规则生成并下发，且阿里云可校验
    templateParam: JSON.stringify({ code: '##code##', min: String(CODE_EXPIRE_MINUTES) }),
    outId: 'drift-' + Date.now()
  });
  const RuntimeOptions = require('@alicloud/tea-util').RuntimeOptions;
  const resp = await client.sendSmsVerifyCodeWithOptions(req, new RuntimeOptions());
  const body = resp && resp.body;
  if (body && body.Code && body.Code !== 'OK') {
    throw new Error(body.Message || body.Code);
  }
  return { success: true };
}

async function sendVerificationCode(phone) {
  // 发送间隔控制
  const last = lastSendAt.get(phone);
  if (last) {
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed < SEND_INTERVAL_SECONDS) {
      const wait = Math.ceil(SEND_INTERVAL_SECONDS - elapsed);
      return { success: false, error: `请${wait}秒后再试` };
    }
  }
  lastSendAt.set(phone, Date.now());

  // 开发模式：本地生成并存储验证码
  if (SMS_PROVIDER !== 'aliyun') {
    const code = generateCode();
    const database = db.db();
    if (!database.smsCodes) database.smsCodes = [];
    database.smsCodes.push({
      id: db.genId('sms'),
      phone,
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + CODE_EXPIRE_MINUTES * 60 * 1000,
      used: false
    });
    db.save();
    console.log(`[SMS][DEV] To: ${phone}, Code: ${code}`);
    return { success: true, devCode: code };
  }

  // 生产模式：调用阿里云发送
  try {
    const r = await sendSMSAliyun(phone);
    if (!r.success) return { success: false, error: r.error || '短信发送失败，请稍后重试' };
    return { success: true };
  } catch (e) {
    lastSendAt.delete(phone); // 发送失败不占用发送间隔
    console.error('[SMS][ALIYUN] 发送失败:', e.message);
    return { success: false, error: '短信发送失败：' + e.message };
  }
}

async function verifyCode(phone, code) {
  // 生产模式：交给阿里云校验（闭环）
  if (SMS_PROVIDER === 'aliyun') {
    try {
      const client = getClient();
      const Dypnsapi = require('@alicloud/dypnsapi20170525');
      const req = new Dypnsapi.CheckSmsVerifyCodeRequest({
        phoneNumber: phone,
        verifyCode: code,
        countryCode: '86',
        caseAuthPolicy: 0
      });
      const RuntimeOptions = require('@alicloud/tea-util').RuntimeOptions;
      const resp = await client.checkSmsVerifyCodeWithOptions(req, new RuntimeOptions());
      const body = resp && resp.body;
      // 阿里云校验通过：Code === 'OK' 或 VerifyResult === true
      const ok = body && (body.Code === 'OK' || body.VerifyResult === true);
      if (ok) return { success: true };
      return { success: false, error: '验证码不正确或已过期' };
    } catch (e) {
      console.error('[SMS][ALIYUN] 校验失败:', e.message);
      return { success: false, error: '验证码校验失败：' + e.message };
    }
  }

  // 开发模式：本地比对
  const database = db.db();
  const now = Date.now();
  const record = (database.smsCodes || [])
    .filter(c => c.phone === phone && !c.used && c.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!record) return { success: false, error: '验证码已过期，请重新获取' };
  if (record.code !== code) return { success: false, error: '验证码不正确' };
  record.used = true;
  db.save();
  return { success: true };
}

module.exports = { sendVerificationCode, verifyCode };
