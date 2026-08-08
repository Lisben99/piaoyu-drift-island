# 漂屿 (Drift Island) 部署与运维文档

> 最后更新：2026-08-09
> 适用版本：仓库 `Lisben99/piaoyu-drift-island` main 分支

---

## 1. 线上访问地址

| 用途 | 地址 |
| --- | --- |
| 用户前端 (GitHub Pages) | https://lisben99.github.io/piaoyu-drift-island/ |
| 管理后台 | https://drift-island-api.onrender.com/admin.html |
| 后端 API | https://drift-island-api.onrender.com/api |
| 健康检查 | https://drift-island-api.onrender.com/api/health |

---

## 2. 管理员账号

- **用户名**：`admin`
- **密码**：已从默认 `admin123` 修改（见历史记录）。请使用你设置的新密码登录。
- **登录入口**：上面的「管理后台」地址，或直接 `POST /api/admin/login`。

### 修改管理员密码

后端提供 `POST /api/admin/change-password` 接口（需先以管理员身份登录拿到 token）：

```bash
# 1) 登录拿到 token
TOKEN=$(curl -s -X POST https://drift-island-api.onrender.com/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"当前密码"}' | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')

# 2) 修改密码
curl -X POST https://drift-island-api.onrender.com/api/admin/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"currentPassword":"当前密码","newPassword":"新密码"}'
# 返回 {"success":true,"message":"密码修改成功"}
```

> ⚠️ `server/src/db.js` 里 `DEFAULT_ADMIN` 的密码哈希**只影响全新初始化的库**。线上 PostgreSQL 里已存在的 admin 记录，必须用上面的接口修改，改代码不会自动生效。

---

## 3. 架构概览

```
用户浏览器 (GitHub Pages 静态页)
        │  HTTPS /api
        ▼
Render Web Service (Node.js + Express + ws)   ← 本项目后端
        │
        ▼
Render PostgreSQL  (DATABASE_URL 自动注入)
   整库以单个 JSON 文档存于 kv_store 表 (key='drift_db')
```

- **前端**：纯 HTML/CSS/JS。`index.html` / `admin.html` 通过 `config.js` 的 `window.DRIFT_API_BASE` 指向后端地址。
- **后端**：Node.js 22 + Express + `ws`（WebSocket）。入口 `server/src/index.js`。
- **数据库**：生产用 PostgreSQL；本地无 `DATABASE_URL` 时回退到 `server/data/db.json` 文件。
- **认证**：JWT，用户与管理员使用独立的 token 体系。
- **CORS**：生产环境配置为 `*`（允许 GitHub Pages 跨域访问）。

---

## 4. 本地运行

**前置条件**：Node.js 22+（推荐用 WorkBuddy 管理的 22.22.2）。

```bash
cd server
npm install --cache ./.npm-cache      # 避免 Windows 中文用户名路径问题
npm start                             # = node src/index.js
```

- 默认使用 JSON 文件存储（`server/data/db.json`）。
- 若设置 `DATABASE_URL` 环境变量，则自动切换到 PostgreSQL。
- 前端：直接用浏览器打开 `index.html`（`config.js` 默认走相对路径 `/api`，本地需同源）；或起一个静态服务器把请求代理到后端 3000 端口。
- E2E 测试：`node server/e2e-test.js`（共 53 项）。

---

## 5. 部署方式（Render Blueprint）

- **仓库**：`Lisben99/piaoyu-drift-island`，分支 `main`。
- **配置文件**：仓库根目录 `render.yaml`，定义了：
  - 一个免费版 PostgreSQL 数据库 `drift-island-db`
  - 一个免费版 Web Service `drift-island-api`
- **自动部署**：`autoDeploy: true`，推送到 `main` 即自动重新构建并部署。
- **初次部署**：在 Render 控制台用 GitHub 账号授权后，选择仓库以 Blueprint 方式导入即可。

> 踩坑：render.yaml 中 `fromDatabase` 必须是**嵌套对象**格式，不能是字符串：
> ```yaml
> envVars:
>   - key: DATABASE_URL
>     fromDatabase:
>       name: drift-island-db
>       property: connectionString
> ```

---

## 6. 生产环境第三方服务配置（重要）

后端预留了三个生产服务商开关，当前完成情况：

| 服务 | 开关变量 | 状态 | 需要的密钥变量 |
| --- | --- | --- | --- |
| 短信 | `SMS_PROVIDER` | ✅ 已对接（阿里云「短信认证」Dypnsapi 通道） | `ALIYUN_SMS_KEY`, `ALIYUN_SMS_SECRET`, `ALIYUN_SMS_SIGN`, `ALIYUN_SMS_TEMPLATE` |
| 支付 | `PAYMENT_PROVIDER` | ⏳ 占位桩（待对接微信支付） | `WECHAT_PAY_MCHID`, `WECHAT_PAY_APPID`, `WECHAT_PAY_SERIAL`, `WECHAT_PAY_PRIVATE_KEY`, `WECHAT_PAY_APIV3` |
| 内容审核 | `MODERATION_PROVIDER` | ✅ 已对接（腾讯云 TMS） | `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` |
| 签名 | `JWT_SECRET` | 已自动生成 | — |

相关环境变量在 Render Dashboard → 服务 → Environment 中设置，或在 `render.yaml` 中改后推送（密钥类变量建议 `sync:false`，仅存于 Render，不进 git）。

- **dev 模式短信**：返回 `devCode`，前端直接显示，方便测试，但用户收不到真实短信。
- **local 审核**：本地关键词过滤（见 `server/src/services/moderation.js` 的敏感词表，可按需扩充）；无腾讯密钥时自动回退到 local。
- **修改环境变量后**：Render 会自动重新部署生效。

### 6.1 激活阿里云短信（个人实名账号 / 短信认证通道）

> 适用场景：无营业执照的**个人实名**账号，无法走标准 `SendSms`（需签名+模板资质审核）。改走「号码认证服务 → 短信认证」通道，免资质、系统赠送签名与模板，由阿里云生成并闭环校验验证码。

**第一步：RAM 授权**
1. 登录阿里云「访问控制 RAM」控制台 → 用户 → 找到使用的 AccessKey 对应的 RAM 用户。
2. 添加权限，搜索 `dypns`，授予 **`AliyunDypnsFullAccess`**（号码认证服务完全访问）。
3. 等待策略生效（通常分钟级）。

**第二步：在 Render 填入 2 个密钥（其余已内置，无需手填）**
到 Render Dashboard → `drift-island-api` → Environment，新增以下**两个私密变量**（`sync:false`，加密存储，不进 git）：

| Key | Value |
| --- | --- |
| `ALIYUN_SMS_KEY` | `<阿里云 AccessKey ID>`（见下方安全说明，勿写入本仓库） |
| `ALIYUN_SMS_SECRET` | `<阿里云 AccessKey Secret>` |

> 以下两项已作为代码默认值内置（个人实名账号「系统赠送」配置），**无需在 Render 填写**：
> - `ALIYUN_SMS_SIGN` = `信趣男女`
> - `ALIYUN_SMS_TEMPLATE` = `100001`
>
> `SMS_PROVIDER` 已在 `render.yaml` 中设为 `aliyun`（非密，随代码提交），部署即生效，也**无需手动改**。

> 🔒 **密钥存放原则**：`ALIYUN_SMS_KEY` / `ALIYUN_SMS_SECRET` 是凭证，**只填在 Render 控制台 Environment（加密存储，不进 git）**。请勿把真实值写进仓库文件——GitHub 推送保护会直接拦截，且公开仓库泄露凭证风险极高。真实值请从你的阿里云控制台或本项目沟通记录中获取后，粘贴到 Render 的对应变量里。激活并验证通过后，建议到阿里云 RAM 控制台**轮换**该 AccessKey（明文曾在聊天出现）。

保存后 Render 自动重新部署。

**第三步：验证**
- 访问健康检查 `GET /api/health`，响应里的 `sms_provider` 应为 `aliyun`。
- 走一次注册/登录获取验证码流程，目标手机会收到真实短信；回填验证码应能校验通过。

**实现要点（维护参考）**：
- SDK：`@alicloud/dypnsapi20170525`（默认导出 `Client`）。
- 接口：`SendSmsVerifyCode` / `CheckSmsVerifyCode`（阿里云生成验证码，后端不存储明文 code，闭环校验）。
- `templateParam` 必须为 `{"code":"##code##","min":"5"}`。
- `validTime` 单位为**秒**（本系统 = `CODE_EXPIRE_MINUTES * 60`）。
- `countryCode` 必须为 `"86"`（不是 `"CN"`）。
- 端点 `dypnsapi.aliyuncs.com`。

> ⚠️ **安全提示**：以上 AccessKey 曾在聊天中明文出现过。建议本服务激活并验证通过后，到阿里云 RAM 控制台**轮换（禁用并重建）该 AccessKey**，避免长期暴露。

---

## 7. Render 免费实例注意事项

- **休眠**：免费 Web Service 和数据库在空闲约 15 分钟后会休眠。
- **冷启动**：休眠后首次访问需要约 30 秒唤醒，可能出现首次请求超时 / 404。
  - 解决：稍等几秒后**重试一次**即可（短信、登录等接口均适用）。
- 免费数据库有连接数和存储限制，正式运营建议升级付费套餐。

---

## 8. 数据库与备份

- 生产库为 PostgreSQL，`kv_store` 表中以 `key='drift_db'` 存一份完整 JSON（`value` 为 JSONB）。
- **备份**：可用 `pg_dump` 或写脚本定期把该 JSON 导出存档。
- **重置（危险）**：删除 `kv_store` 中 `drift_db` 这一行会让服务下次启动时用默认值（含默认 admin 哈希）重新初始化，**会清空所有用户/漂流瓶/订单数据**。务必先备份。

---

## 9. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 首次访问很慢或 404 | Render 冷启动，重试一次 |
| 短信收不到 | 若已按 §6.1 配置 `SMS_PROVIDER=aliyun` 且 RAM 已授权，应收到真实短信；仍收不到请检查 RAM 权限（`AliyunDypnsFullAccess`）与 4 个密钥变量是否填对 |
| 充值后没到账 | dev 模式需在前端点「确认」触发模拟到账；wechat 为占位桩 |
| WebSocket 连不上 | 地址为 `wss://drift-island-api.onrender.com/ws?token=<用户token>` |
| 改密码后旧密码还能用 | 应该用 `change-password` 接口改线上库；只改 `db.js` 不影响已存在数据 |

---

## 10. 待完成 / 已知缺口

1. **微信支付对接**（当前为占位桩）：
   - 需安装微信支付 SDK，实现 `createOrder` / `confirmPayment` / `refundOrder` 的真实调用与回调验签（`server/src/services/payment.js`）。
   - 微信支付回调地址（`/api/recharge/callback`）需在商户平台配置并补充路由实现。
   - 待决策：H5 支付还是 JSAPI 支付（影响前端跳转与商户 AppID 配置）。
2. **已完成的真实对接**（供参考，无需重复实现）：
   - 阿里云短信：已用「短信认证」Dypnsapi 通道实现 `server/src/services/sms.js` 的 `aliyun` 分支（个人实名账号方案）。
   - 腾讯内容审核：已用 `tencentcloud-sdk-nodejs-tms` 实现 `server/src/services/moderation.js` 的 `moderateTencent`，无密钥时自动回退 local。
3. 生产服务商密钥需由运营方提供后填入 Render 环境变量（短信/审核密钥已具备，支付待提供）。
4. 建议补充：操作日志可视化、定期数据库备份脚本、错误监控（如 Sentry）。
