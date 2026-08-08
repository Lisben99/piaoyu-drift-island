/**
 * SMS Service — 阿里云「短信认证」(号码认证服务 Dypnsapi 2017-05-25)
 *
 * 适用场景：个人实名认证账号（无企业资质）。免资质 / 签名 / 模板，使用控制台
 * 「系统赠送」的签名与模板。
 *   生产发码：SendSmsVerifyCode（阿里云生成验证码并下发，校验由阿里云闭环完成）
 *   生产校验：CheckSmsVerifyCode（异步，调用方需 await）
 *   开发模式：本地生成 + 控制台打印 + 返回 devCode（前端显示用）
 *
 * 环境变量（密钥类在 Render 控制台填写，render.yaml 中 sync:false）：
 *   SMS_PROVIDER         aliyun | dev（默认 dev；render.yaml 生产设为 aliyun）
 *   ALIYUN_SMS_KEY       阿里云 AccessKeyId（必填，生产必需）
 *   ALIYUN_SMS_SECRET    阿里云 AccessKeySecret（必填，生产必需）
 *   ALIYUN_SMS_SIGN      签名名称（默认值：信趣男女，可经环境变量覆盖）
 *   ALIYUN_SMS_TEMPLATE  模板编号（默认值：100001，可经环境变量覆盖）
 *   注：KEY/SECRET 缺失时，即使 SMS_PROVIDER=aliyun 也会自动回退 dev 模式。
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'dev'; // 'dev' | 'aliyun'
const CODE_EXPIRE_MINUTES = 5;
// 非密配置默认值（个人实名账号「系统赠送」的签名与模板，可经环境变量覆盖）
const ALIYUN_SMS_SIGN_DEFAULT = '信趣男女';
const ALIYUN_SMS_TEMPLATE_DEFAULT = '100001';
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
  const signName = process.env.ALIYUN_SMS_SIGN || ALIYUN_SMS_SIGN_DEFAULT;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE || ALIYUN_SMS_TEMPLATE_DEFAULT;
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
  // 记录完整原始响应，便于排查「接口成功但用户收不到」类问题
  console.error('[SMS][ALIYUN] SendSmsVerifyCode raw response:', JSON.stringify(body));
  if (!body) {
    throw new Error('阿里云返回空响应');
  }
  // 注意：阿里云该接口返回的是小写字段 code/message/success（非大写的 Code）
  const ok = body.success === true || body.code === 'OK';
  if (!ok) {
    throw new Error(`阿里云错误 code=${body.code} message=${body.message || ''} requestId=${body.requestId || ''}`);
  }
  return { success: true, detail: body, delivered: true };
}

// 是否启用阿里云真实短信：需 SMS_PROVIDER=aliyun 且 KEY/SECRET 齐备；
// 开关是 aliyun 但密钥缺失时自动回退 dev，避免部署间隙发信硬报错。
function aliyunEnabled() {
  const hasCreds = !!(process.env.ALIYUN_SMS_KEY && process.env.ALIYUN_SMS_SECRET);
  if (SMS_PROVIDER === 'aliyun') {
    if (hasCreds) return true;
    console.warn('[SMS] SMS_PROVIDER=aliyun 但 ALIYUN_SMS_KEY/SECRET 缺失，临时回退 dev 模式');
    return false;
  }
  return false;
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
  if (!aliyunEnabled()) {
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
    // 透传阿里云原始响应，便于前端/排查确认是否真正下发
    return { success: true, aliyun: r.detail, delivered: r.delivered };
  } catch (e) {
    lastSendAt.delete(phone); // 发送失败不占用发送间隔
    console.error('[SMS][ALIYUN] 发送失败:', e.message);
    return { success: false, error: '短信发送失败：' + e.message };
  }
}

async function verifyCode(phone, code) {
  // 生产模式：交给阿里云校验（闭环）
  if (aliyunEnabled()) {
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
