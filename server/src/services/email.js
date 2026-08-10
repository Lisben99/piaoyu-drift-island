/**
 * Email Verification Service — 邮箱验证码注册/登录通道
 *
 * 与短信通道（sms.js）平行：用户可用「邮箱 + 邮件验证码」注册登录，
 * 首次验证自动建号。短信通道（阿里云）当前停用，邮箱通道专为绕过短信
 * 依赖而加，让项目在没有短信资质时也能跑起来。
 *
 * 发送策略（EMAIL_PROVIDER）：
 *   - dev（默认）：本地生成验证码并直接返回 devCode 给前端，不发真实邮件，
 *     便于零配置先把流程跑通（验证码显示在前端，开发/演示零成本）。
 *   - resend（推荐·生产）：经 Resend HTTPS API 发送真实邮件。
 *     Render 免费实例屏蔽出站 SMTP（465/587）端口，Gmail/QQ 等传统 SMTP
 *     在线上连不通；Resend 走 HTTPS(443) API，不受 SMTP 端口封锁影响。
 *     ⚠️ 需在 Resend 控制台配置 RESEND_API_KEY；发送真实用户邮件还需在
 *     Resend 验证自有域名（否则只能发往本人已验证邮箱 onboarding@resend.dev）。
 *   - smtp：保留的兼容通道（nodemailer），适合本地自托管或能出网 SMTP 的环境。
 *
 * 校验：无论 dev / resend / smtp，验证码均由本地存储并本地比对（邮件服务商
 * 不提供「下发即校验」的闭环接口），verifyCode 永远本地比对。
 *
 * 环境变量（密钥类在 Render 控制台填写，render.yaml 中 sync:false）：
 *   EMAIL_PROVIDER  resend | smtp | dev（默认 dev；生产设为 resend）
 *   RESEND_API_KEY  Resend 控制台获取的 API Key（re_ 开头）
 *   EMAIL_FROM      发件人地址；resend 模式缺省回退 "漂屿 <onboarding@resend.dev>"
 *   （可选，仅 smtp 模式用到）SMTP_HOST/PORT/USER/PASS/FROM
 *   注：EMAIL_PROVIDER=resend 但 RESEND_API_KEY 缺失时自动回退 dev，避免部署间隙发信硬报错。
 */

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'dev'; // 'dev' | 'smtp' | 'resend'
const CODE_EXPIRE_MINUTES = 5;
const SEND_INTERVAL_SECONDS = 60;

const db = require('../db');

// 进程内发送间隔记录（dev / smtp / resend 共用，重启即清空，仅用于限频）
const lastSendAt = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 是否启用 Resend 发送：需 EMAIL_PROVIDER=resend 且 RESEND_API_KEY 齐备；
// 开关是 resend 但 Key 缺失时自动回退 dev，避免部署间隙发信硬报错。
function resendEnabled() {
  if (EMAIL_PROVIDER === 'resend' && !!process.env.RESEND_API_KEY) return true;
  return false;
}

// 是否启用真实 SMTP 发送：需 EMAIL_PROVIDER=smtp 且凭据齐备；
// 开关是 smtp 但凭据缺失时自动回退 dev，避免部署间隙发信硬报错。
function smtpEnabled() {
  const hasCreds = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
  if (EMAIL_PROVIDER === 'smtp') {
    if (hasCreds) return true;
    console.warn('[EMAIL] EMAIL_PROVIDER=smtp 但 SMTP 凭据缺失，临时回退 dev 模式');
    return false;
  }
  return false;
}

// 经 Resend HTTPS API 发送（无需 SMTP、无需新依赖，原生 fetch 即可）。
// 参考文档：https://resend.com/docs/api-reference/emails/send-email
async function sendViaResend(email, code) {
  const from = process.env.EMAIL_FROM || '漂屿 <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: '漂屿 - 邮箱验证码',
      html: `<p>您的邮箱验证码是 <b>${code}</b>，5 分钟内有效。</p><p>如非本人操作，请忽略此邮件。</p>`
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return await res.json();
}

async function sendSmtp(email, code) {
  // 懒加载：dev / resend 模式永远不会触发，避免未安装 nodemailer 时启动报错
  const nodemailer = require('nodemailer');
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: '漂屿 - 邮箱验证码',
    text: `您的验证码是 ${code}，5 分钟内有效。如非本人操作请忽略。`,
    html: `<p>您的邮箱验证码是 <b>${code}</b>，5 分钟内有效。</p><p>如非本人操作，请忽略此邮件。</p>`
  });
}

async function sendVerificationCode(email, purpose = 'login') {
  // 发送间隔控制（按「联系方式 + 用途」独立限频，避免登录发码与找回密码发码互相干扰）
  const key = email + ':' + purpose;
  const last = lastSendAt.get(key);
  if (last) {
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed < SEND_INTERVAL_SECONDS) {
      const wait = Math.ceil(SEND_INTERVAL_SECONDS - elapsed);
      return { success: false, error: `请${wait}秒后再试` };
    }
  }
  lastSendAt.set(key, Date.now());

  const code = generateCode();
  const database = db.db();
  if (!database.emailCodes) database.emailCodes = [];
  database.emailCodes.push({
    id: db.genId('email'),
    email,
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + CODE_EXPIRE_MINUTES * 60 * 1000,
    used: false
  });
  db.save();

  // 生产模式 A：调用 Resend API 发送真实邮件（默认生产通道）
  if (resendEnabled()) {
    try {
      const r = await sendViaResend(email, code);
      return { success: true, delivered: true, id: r && r.id };
    } catch (e) {
      lastSendAt.delete(email); // 发送失败不占用发送间隔
      console.error('[EMAIL][RESEND] 发送失败:', e.message);
      return { success: false, error: '邮件发送失败：' + e.message };
    }
  }

  // 生产模式 B：调用 SMTP 发送真实邮件（兼容通道，Render 线上通常不可达）
  if (smtpEnabled()) {
    try {
      await sendSmtp(email, code);
      return { success: true, delivered: true };
    } catch (e) {
      lastSendAt.delete(email); // 发送失败不占用发送间隔
      console.error('[EMAIL][SMTP] 发送失败:', e.message);
      return { success: false, error: '邮件发送失败：' + e.message };
    }
  }

  // 开发模式：本地生成，验证码返回前端
  console.log(`[EMAIL][DEV] To: ${email}, Code: ${code}`);
  return { success: true, devCode: code };
}

async function verifyCode(email, code) {
  const database = db.db();
  const now = Date.now();
  const record = (database.emailCodes || [])
    .filter(c => c.email === email && !c.used && c.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!record) return { success: false, error: '验证码已过期，请重新获取' };
  if (record.code !== code) return { success: false, error: '验证码不正确' };
  record.used = true;
  db.save();
  return { success: true };
}

module.exports = { sendVerificationCode, verifyCode, smtpEnabled, resendEnabled };
