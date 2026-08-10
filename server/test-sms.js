/**
 * SMS 集成 / 验证脚本
 * ----------------------------------------------------------------
 * 用法：
 *   1) dev 模式（默认，不发真实短信，仅校验本地发码+校验闭环）：
 *        node server/test-sms.js
 *
 *   2) 真实阿里云发码（需先配置环境变量 + 传一个手机号）：
 *        SMS_TEST_REAL=1 \
 *        ALIYUN_SMS_KEY=xxx ALIYUN_SMS_SECRET=yyy \
 *        [ALIYUN_SMS_SIGN=恒创联众] [ALIYUN_SMS_TEMPLATE=100001] \
 *        node server/test-sms.js 13800138000
 *
 * 说明：短信认证(SendSmsVerifyCode) 的签名/模板均为「系统赠送」，默认值
 *       恒创联众 / 100001 即可，无需自定义。仅 Signature/Secret 必填。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const DB_BACKUP = DB_PATH + '.smsbak';

async function main() {
  const real = process.env.SMS_TEST_REAL === '1';
  const phone = process.argv[2];

  if (real) {
    if (!phone) { console.error('真实模式需要传入手机号：node test-sms.js 13800138000'); process.exit(1); }
    if (!process.env.ALIYUN_SMS_KEY || !process.env.ALIYUN_SMS_SECRET) {
      console.error('真实模式需要 ALIYUN_SMS_KEY 与 ALIYUN_SMS_SECRET'); process.exit(1);
    }
    process.env.SMS_PROVIDER = 'aliyun';
    const sms = require('./src/services/sms');
    console.log(`[REAL] 向 ${phone} 发送真实验证码（阿里云）...`);
    const r = await sms.sendVerificationCode(phone);
    if (!r.success) { console.error('FAIL 发送失败:', r.error); process.exit(1); }
    console.log('PASS 阿里云已受理，请查收手机短信。返回：', JSON.stringify(r.detail && r.detail || r));
    process.exit(0);
  }

  // ---- dev 模式闭环测试 ----
  // 备份 db.json，避免污染仓库数据
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_BACKUP);
  try {
    const sms = require('./src/services/sms');

    const testPhone = '13800138000';
    console.log('[DEV] 发送验证码...');
    const send = await sms.sendVerificationCode(testPhone);
    if (!send.success) throw new Error('发送失败: ' + send.error);
    if (!send.devCode) throw new Error('dev 模式应返回 devCode');
    console.log('PASS 发码成功，devCode =', send.devCode);

    console.log('[DEV] 用错误验证码校验（应失败）...');
    const wrong = await sms.verifyCode(testPhone, '000000');
    if (wrong.success) throw new Error('错误验证码竟校验通过');
    console.log('PASS 错误验证码被正确拒绝');

    console.log('[DEV] 用正确验证码校验（应通过）...');
    const right = await sms.verifyCode(testPhone, send.devCode);
    if (!right.success) throw new Error('正确验证码校验失败: ' + right.error);
    console.log('PASS 正确验证码校验通过');

    console.log('\n✅ SMS 发码 + 校验闭环正常（dev 模式）');
    process.exit(0);
  } catch (e) {
    console.error('❌ 测试失败:', e.message);
    process.exit(1);
  } finally {
    if (fs.existsSync(DB_BACKUP)) { fs.copyFileSync(DB_BACKUP, DB_PATH); fs.unlinkSync(DB_BACKUP); }
  }
}

main();
