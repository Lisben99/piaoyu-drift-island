/**
 * Email Verification Service — 邮箱验证码注册/登录通道
 *
 * 与短信通道（sms.js）平行：用户可用「邮箱 + 邮件验证码」注册登录，
 * 首次验证自动建号。短信通道（阿里云）当前停用，邮箱通道专为绕过短信
 * 依赖而加，让项目在没有短信资质时也能跑起来。
 *
 * 发送策略：
 *   - 未配置 SMTP（默认 dev 模式）：本地生成验证码并直接返回 devCode 给前端，
 *     不发真实邮件，便于零配置先把流程跑通。
 *   - 配置 EMAIL_PROVIDER=smtp 且 SMTP_HOST/USER/PASS/FROM 齐备：经 nodemailer
 *     发送真实验证码邮件。
 *
 * 校验：无论 dev 还是 smtp，验证码均由本地存储并本地比对（邮件服务商不提供
 * 「下发即校验」的闭环接口），verifyCode 永远本地比对。
 *
 * 环境变量（密钥类在 Render 控制台填写，render.yaml 中 sync:false）：
 *   EMAIL_PROVIDER  smtp | dev（默认 dev；生产设为 smtp）
 *   SMTP_HOST       邮件服务器，如 smtp.qq.com / smtp.gmail.com
 *   SMTP_PORT       端口（默认 465，SSL）
 *   SMTP_USER       发件账号
 *   SMTP_PASS       发件密码/授权码
 *   SMTP_FROM       发件人地址（可与 SMTP_USER 相同）
 *   注：EMAIL_PROVIDER=smtp 但凭据缺失时自动回退 dev，避免部署间隙发信硬报错。
 */

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'dev'; // 'dev' | 'smtp'
const CODE_EXPIRE_MINUTES = 5;
const SEND_INTERVAL_SECONDS = 60;

const db = require('../db');

// 进程内发送间隔记录（dev 与 smtp 共用，重启即清空，仅用于限频）
const lastSendAt = new Map();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 是否启用真实 SMTP 发送：需 EMAIL_PROVIDER=smtp 且凭据齐备；
// 开关是 smtp 但凭据缺失时自动回退 dev，避免部署间隙发信硬报错。
function smtpEnabled() {
  const hasCreds = !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
  if (EMAIL_PROVIDER === 'smtp') {
    if (hasCreds) return true;
    console.warn('[EMAIL] EMAIL_PROVIDER=smtp 但 SMTP 凭据缺失，临时回退 dev 模式');
    return false;
  }
  return false;
}

async function sendSmtp(email, code) {
  // 懒加载：dev 模式永远不会触发，避免未安装 nodemailer 时启动报错
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
    from: process.env.SMTP_FROM,
    to: email,
    subject: '漂屿 - 邮箱验证码',
    text: `您的验证码是 ${code}，5 分钟内有效。如非本人操作请忽略。`,
    html: `<p>您的邮箱验证码是 <b>${code}</b>，5 分钟内有效。</p><p>如非本人操作，请忽略此邮件。</p>`
  });
}

async function sendVerificationCode(email) {
  // 发送间隔控制
  const last = lastSendAt.get(email);
  if (last) {
    const elapsed = (Date.now() - last) / 1000;
    if (elapsed < SEND_INTERVAL_SECONDS) {
      const wait = Math.ceil(SEND_INTERVAL_SECONDS - elapsed);
      return { success: false, error: `请${wait}秒后再试` };
    }
  }
  lastSendAt.set(email, Date.now());

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

  // 生产模式：调用 SMTP 发送真实邮件
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

module.exports = { sendVerificationCode, verifyCode, smtpEnabled };
