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
 *   ALIYUN_SMS_SIGN      签名名称（默认值：恒创联众，可经环境变量覆盖）
 *   ALIYUN_SMS_TEMPLATE  模板编号（默认值：100001，可经环境变量覆盖）
 *   注：KEY/SECRET 缺失时，即使 SMS_PROVIDER=aliyun 也会自动回退 dev 模式。
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'dev'; // 'dev' | 'aliyun'
const CODE_EXPIRE_MINUTES = 5;
// 非密配置默认值（个人实名账号「系统赠送」的签名与模板，可经环境变量覆盖）
const ALIYUN_SMS_SIGN_DEFAULT = '恒创联众';
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

// 将阿里云常见错误码翻译成可读中文，便于在前端/日志中直接定位问题根因
// （OUT_OF_SERVICE = 套餐包余量不足；签名/模板/参数类错误分别给出对应提示）
function describeAliyunError(code, message) {
  const map = {
    'isv.OUT_OF_SERVICE': '短信套餐包余量不足（请在阿里云号码认证控制台购买短信认证套餐包）',
    'isv.SIGNATURE_ILLEGAL': '短信签名不合法（当前应使用系统赠送的「恒创联众」）',
    'isv.TEMPLATE_ILLEGAL': '短信模板不合法（当前应使用系统赠送的「100001」）',
    'isv.PRODUCT_UN_SUBSCRIPT': '短信认证服务未开通（请在 dypns.console.aliyun.com 开通短信认证）',
    'isv.AMOUNT_NOT_ENOUGH': '账户余额不足',
    'isv.MOBILE_NUMBER_ILLEGAL': '手机号格式不合法',
    'isv.BUSINESS_LIMIT_CONTROL': '触发阿里云流控，请稍后再试'
  };
  if (code && map[code]) return map[code];
  return `阿里云错误 code=${code || '未知'} message=${message || ''}`;
}

async function sendSMSAliyun(phone) {
  const signName = process.env.ALIYUN_SMS_SIGN || ALIYUN_SMS_SIGN_DEFAULT;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE || ALIYUN_SMS_TEMPLATE_DEFAULT;
  // 诊断日志：发码前把实际使用的签名/模板打印出来，便于在 Render 日志里快速定位
  // 「签名不存在 / 模板不合法」等配置问题（短信认证的签名、模板均为系统赠送，暂不支持自定义）。
  console.log(`[SMS][ALIYUN] send -> phone=${phone} signName=${signName} templateCode=${templateCode}`);
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
    throw new Error(describeAliyunError(body.code, body.message || '') + (body.requestId ? ` requestId=${body.requestId}` : ''));
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

async function sendVerificationCode(phone, purpose = 'login') {
  // 发送间隔控制（按「联系方式 + 用途」独立限频，避免登录发码与找回密码发码互相干扰）
  const key = phone + ':' + purpose;
  const last = lastSendAt.get(key);
  if (last) {
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed < SEND_INTERVAL_SECONDS) {
      const wait = Math.ceil(SEND_INTERVAL_SECONDS - elapsed);
      return { success: false, error: `请${wait}秒后再试` };
    }
  }
  lastSendAt.set(key, Date.now());

  // 生产配置（SMS_PROVIDER=aliyun）但密钥缺失：这是部署错误，不能静默回退 dev 模式
  // 生成验证码（会把 code 返回到 API 响应里，生产环境等同于泄漏）。直接报错提示配置问题。
  if (SMS_PROVIDER === 'aliyun' && !(process.env.ALIYUN_SMS_KEY && process.env.ALIYUN_SMS_SECRET)) {
    console.error('[SMS] SMS_PROVIDER=aliyun 但密钥缺失，拒绝静默回退 dev 模式');
    lastSendAt.delete(key);
    return { success: false, error: '短信服务未正确配置（缺少阿里云密钥）' };
  }

  // 开发模式：本地生成并存储验证码
  if (!aliyunEnabled()) {
    const code = generateCode();
    const database = db.db();
    if (!database.smsCodes) database.smsCodes = [];
    // 清理过期/已用的旧码，避免 smsCodes 无限堆积
    const now = Date.now();
    database.smsCodes = database.smsCodes.filter(c => !c.used && c.expiresAt > now);
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
    lastSendAt.delete(key); // 发送失败不占用发送间隔（key 须与限频一致：phone + ':' + purpose）
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
        // 1=验证码大小写不敏感（短信认证接口文档规定取值只能是 1 或 2，0 会报 isv.ValidateFail）
        caseAuthPolicy: 1
      });
      const RuntimeOptions = require('@alicloud/tea-util').RuntimeOptions;
      const resp = await client.checkSmsVerifyCodeWithOptions(req, new RuntimeOptions());
      const body = resp && resp.body;
      console.log('[SMS][ALIYUN] CheckSmsVerifyCode raw response:', JSON.stringify(body));
      // 阿里云返回结构：body.code==='OK' 且 body.model.verifyResult==='PASS' 才算真正通过
      const ok = body && body.code === 'OK' && body.model && body.model.verifyResult === 'PASS';
      if (ok) return { success: true };
      const why = (body && body.model && body.model.verifyResult) || (body && body.message) || '验证码不正确或已过期';
      return { success: false, error: '验证码校验失败：' + why };
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
