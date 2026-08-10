# 漂屿 Drift Island — 项目交接文档 (HANDOFF)

> 本文件供接手本项目的开发者 / 智能体（如 Codex、Claude 等）快速建立全貌并安全继续开发。
> 最后更新：2026-08-10，对应提交 `6cc4269`（main / master 一致）。

---

## 0. 一句话概要

**漂屿（Drift Island）** 是一个匿名漂流瓶社交 Web 应用：用户丢出匿名漂流瓶、在大厅浏览/回复、可私聊、还有伪装成"普通岛民"的 AI Bot 主动搭话。
架构 = 前端静态页（GitHub Pages）+ Node/Express 后端（Render 免费实例）+ PostgreSQL（Render 托管）+ 阿里云短信 + Resend 邮件 + 硅基流动 AI。

---

## 1. 仓库与分支约定

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/Lisben99/piaoyu-drift-island`（**公开**） |
| 默认分支 | `main` |
| 镜像分支 | `master`（与 main 同步，便于某些平台拉取） |
| 当前 HEAD | `6cc4269` |

**约定（务必遵守）**：每次把代码 push 到 `main` 后，必须同步一次 `master`：
```bash
git push origin main
git push origin main:master
```

---

## 2. 技术栈

- **前端**：原生 HTML + 内联 CSS/JS（`index.html` 承载大厅/登录/注册/聊天/我的 全部逻辑），无构建步骤。
- **后端**：Node.js + Express 4，`server/src/index.js` 入口；同时用 `express.static` 托管仓库根目录的静态页（所以访问 Render 后端地址也能看到页面）。
- **实时**：WebSocket（`ws` 库），地址由 `config.js` 的 `DRIFT_WS_HOST` 决定，走 `wss://`。
- **数据库**：生产用 Render 托管 PostgreSQL（`DATABASE_URL`）；本地无 `DATABASE_URL` 时自动回退到 `server/data/db.json`（JSON 文件，仅本地开发）。
- **鉴权**：JWT（`jsonwebtoken`）+ `bcryptjs` 密码哈希。
- **短信**：阿里云「短信认证」Dypnsapi（`@alicloud/dypnsapi20170525`）。
- **邮件**：Resend（`nodemailer` 直连 HTTPS API）。
- **AI**：硅基流动 SiliconFlow（默认模型 `Qwen/Qwen3-8B`），代码在 `aiProvider.js`，可切 OpenAI 兼容。
- **内容审核**：腾讯云 TMS（文本安全），缺密钥自动回退本地关键词过滤。

---

## 3. 部署拓扑（线上现状）

```
浏览器 ──► www.piaoyuisland.xyz (GitHub Pages, CDN)
                 │  (页面内的 API 请求)
                 ▼
        drift-island-api.onrender.com/api  (Node/Express, 免费实例)
                 │
   ┌─────────────┼─────────────────┬──────────────┬──────────────┐
   ▼             ▼                 ▼              ▼              ▼
PostgreSQL   阿里云短信 Dypnsapi  Resend 邮件   硅基流动 AI    腾讯云 TMS
(Render)      (验证码)            (验证码/通知)  (Bot 回复)    (内容审核)
```

- **前端入口**：`https://www.piaoyuisland.xyz/`（裸域 `piaoyuisland.xyz` 也会跳转到 www）
- **后端 API**：`https://drift-island-api.onrender.com/api`
- **健康检查**：`https://drift-island-api.onrender.com/api/health`（返回含 `email_provider`、`sms_provider` 等状态）
- **管理后台**：`https://www.piaoyuisland.xyz/admin.html`（注意：走 Render 后端地址也会暴露 `admin.html`，但 GitHub Pages 入口不暴露）

**域名解析**（阿里云 DNS）：
- `www` → CNAME → `lisben99.github.io`（GitHub Pages）
- `@` → 4 条 A 记录 → `185.199.108~111.153`（GitHub Pages 裸域）
- `piaoyuisland.xyz` 已在 Resend 验证为发件域名（DKIM/SPF/DMARC 记录已加）

**保活**：`.github/workflows/keepalive.yml` 每 10 分钟 ping 一次 `/api/health`，规避 Render 免费实例 15 分钟无请求后的冷启动（首屏/首次 API 卡 30~50s）。

---

## 4. 环境变量（Render 后台）

来源：`render.yaml`（Render Blueprint 自动建服务时读取）。**注意 `sync: false` 的变量 Render 不会自动创建，必须去后台手动 Add。**

| 变量 | 值/来源 | 说明 |
|---|---|---|
| `DATABASE_URL` | 从 Render DB 自动注入 | PostgreSQL 连接串 |
| `JWT_SECRET` | Render 自动生成 | JWT 签名密钥 |
| `SMS_PROVIDER` | `aliyun`（固定） | 短信通道 |
| `ALIYUN_SMS_KEY` | **sync:false（手动填）** | 阿里云 AccessKeyId |
| `ALIYUN_SMS_SECRET` | **sync:false（手动填）** | 阿里云 AccessKeySecret |
| `ALIYUN_SMS_SIGN` | sync:false（默认「恒创联众」） | 短信签名 |
| `ALIYUN_SMS_TEMPLATE` | sync:false（默认「100001」） | 短信模板 |
| `PAYMENT_PROVIDER` | `dev`（占位桩） | 支付未对接真实微信 |
| `MODERATION_PROVIDER` | `tencent`（固定） | 腾讯云 TMS |
| `TENCENT_SECRET_ID` | **sync:false（手动填）** | 腾讯云 SecretId |
| `TENCENT_SECRET_KEY` | **sync:false（手动填）** | 腾讯云 SecretKey |
| `EMAIL_PROVIDER` | `resend`（固定） | 邮件通道 |
| `RESEND_API_KEY` | **sync:false（手动填，必填）** | Resend API Key（`re_` 开头）；缺失则邮件走 `dev` 模式（只打印日志） |
| `EMAIL_FROM` | sync:false（建议 `漂屿 <noreply@piaoyuisland.xyz>`） | 发件人 |
| `SMTP_HOST/PORT/USER/PASS/FROM` | sync:false（SMTP 备用模式用，当前未启用） | 仅 `EMAIL_PROVIDER=smtp` 时生效 |

> ⚠️ **密钥绝不入库**。任何 `sync:false` 变量都只存在于 Render 后台，不要写进仓库文件。

---

## 5. 已完成功能（按时间线）

| 提交 | 功能 |
|---|---|
| `2bb8f19` / `a7c0d4f` | 阿里云短信认证注册/登录（`CheckSmsVerifyCode` 的 `caseAuthPolicy` 0→1 修复，响应解析修正） |
| `fcbe591` → `848ea12` | Bot 引擎：冷启动、模板/AI 回复、主动发帖、后台管理 |
| `95ecae2` / `a57cd23` | AI 默认切到硅基流动 SiliconFlow（Qwen3-8B，免费） |
| `d080c28` | Bot 公共展示伪装成普通用户（去 AI/官方标识，改名如「晚风」） |
| `10923fc` / `2e2172f` | Bot 性别强制 `male/female`（不再显示「岛民」）；发帖/回复性别字段正确写入 |
| `3d3afc6` | 三层防护彻底消除 Bot 回复中的 AI 痕迹（prompt 约束 + `containsAIExposure()` 关键词过滤 + 数据层 gender 规范化） |
| `1de1b11` | 「聊聊」按钮不再自动发送帖子内容；聊天页正确显示对方昵称头像 |
| `7cea386` | 未读消息角标系统（会话 `lastReadAt` + `unreadCount` + 前端 tab 红点） |
| `e6d3745` / `3d2cb71` | 邮箱验证码登录生产配置 + Resend 自有域名 `piaoyuisland.xyz` 验证（让任意用户收码） |
| `eb70b00` | GitHub Actions 定时保活 Render 后端 |
| `d8f66f5` | 清理误提交的本地 DB 备份 `data/db.json.smsbak` 并加入 `.gitignore` |
| `3f7ef10` | **忘记密码**：邮箱/手机号验证重置密码（含登录/找回发码限频按「联系方式:用途」区分） |
| `6cc4269` | 登录页默认「账号密码登录」，底部「使用验证码登录」可切换 |

---

## 6. 待办 / 已知事项

1. **ICP 备案未做**：用户暂决定不备案。当前 GitHub Pages + Render 均为境外，无法备案；若要做社交功能合规上线，需迁境内服务器 + 企业主体（详见下方"合规提示"）。
2. **支付是 dev 桩**：`PAYMENT_PROVIDER=dev`，未对接真实微信支付。
3. **Render 免费实例限制**：免费层有冷启动/休眠；已用保活脚本缓解，但部署后首次访问或长时间空闲仍可能偶发慢。生产建议升级付费实例。
4. **数据备份规则**：`data/*.bak`、`data/*.smsbak` 已被 `.gitignore` 忽略，切勿提交含用户数据的备份。
5. **邮箱/短信验证码限频**：发送限频 key 为「联系方式:用途」（login / reset 独立），60 秒间隔。改发码逻辑时保持此隔离，否则用户在登录页发过码后切到找回密码会被挡。
6. **Resend 免费版**：未验证自己域名时只能发往账号本人邮箱；已验证 `piaoyuisland.xyz`，现可发往任意用户。

### 合规提示（重要）
漂屿是 **UGC + 即时通信 + AI 聊天** 的社交应用。**个人 ICP 备案几乎必然被管局驳回**（个人备案不允许交互/社交类）。若要正式运营：
- 注册个体工商户或公司 → 境内服务器（阿里云/腾讯云大陆节点）部署 → 企业备案；
- 视功能补《增值电信业务经营许可证》《网络文化经营许可证》；
- Resend 境外发信在国内不稳，建议改用阿里云邮件推送 / 腾讯云 SES。
（当前架构维持境外，合规风险由用户已知悉并暂接受。）

---

## 7. 本地运行

前置：Node >= 18。

```bash
# 后端（默认端口 3000，可用 PORT 覆盖）
cd server
npm install
EMAIL_PROVIDER=dev SMS_PROVIDER=dev node src/index.js
# 无 DATABASE_URL 时自动用 server/data/db.json（独立本地库，不影响生产）

# 前端：直接用浏览器打开 index.html 即可
# （config.js 默认指向 Render 生产后端；本地联调可临时改 DRIFT_API_BASE 指向 http://localhost:3000/api）
```

回归测试（忘记密码全链路）：
```bash
# 先起服务，再跑：
BASE=http://localhost:3000/api node server/test-reset.js
```

---

## 8. 部署步骤

- **后端**：push 到 `main` → Render 的 `autoDeploy: true` 自动重新部署（约 1~2 分钟）。
- **前端**：push 到 `main` → GitHub Pages 自动发布（约 1 分钟，CDN 有缓存，浏览器需 Ctrl+F5 强刷）。
- **务必**同步 `master`：`git push origin main:master`。
- 改了 Render 环境变量后，需等 Render 重新部署生效（在后台 Save Changes 会触发）。

---

## 9. 给其他智能体的注意事项（避坑）

1. **`sync:false` 变量不会自动建**：改了 `render.yaml` 里这些变量名/默认值后，必须提醒用户去 Render 后台手动 Add/Update，否则服务缺密钥（如 `RESEND_API_KEY` 缺失 → 邮件只走 dev 模式打日志，用户收不到真邮件）。
2. **两分支必须同步**：提交后记得 `git push origin main:master`，保持 main/master 一致是用户习惯。
3. **Bot 的无 AI 痕迹是硬约束**：任何改动 Bot 相关代码（prompt、回复、数据）都必须保持三点 —— (a) prompt 不承认 AI/机器人/助手；(b) `aiProvider.js` 的 `containsAIExposure()` 关键词过滤保留；(c) `db.js` 中 Bot 的 `gender` 必须是 `male`/`female`，绝不可出现「岛民」。
4. **前端是单文件内联**：`index.html` 内含全部页面逻辑（登录/注册/大厅/聊天/我的）。新增页面入口或交互逻辑改这里；`config.js` 只配 API 基地址与 WS 主机。
5. **前端改完需强刷**：GitHub Pages 走 CDN，用户侧可能缓存旧页，验证时务必 Ctrl+F5。
6. **WebSocket 走 wss**：`config.js` 的 `DRIFT_WS_HOST` 决定，跨域已配置 CORS。
7. **不要提交数据备份**：`.gitignore` 已忽略 `data/*.bak`、`data/*.smsbak`、`server/data/db.json`、`.env`；若误 `git add`，用 `git rm --cached` 移除而非强推覆盖历史（除非用户要求彻底抹除）。
8. **PostgreSQL 连接**：生产只读 `DATABASE_URL`；本地回退 JSON 库用于联调，二者数据结构需保持兼容（见 `db.js`）。

---

## 10. 关键文件索引

**根目录（前端 + 配置）**
- `index.html` — 主页面（大厅/登录/注册/聊天/我的 全部逻辑，内联 CSS/JS）
- `register.html` — 独立注册页
- `admin.html` — 管理后台（Bot 管理、配置开关等）
- `config.js` — 前端 API 基地址 `DRIFT_API_BASE`、WS 主机 `DRIFT_WS_HOST`
- `CNAME` — GitHub Pages 自定义域名 `www.piaoyuisland.xyz`
- `render.yaml` — Render Blueprint（建服务 + 环境变量）
- `DEPLOYMENT.md` — 部署细节文档（含短信/邮件/审核配置）
- `访问入口与部署清单.md` — 四类访问入口速查 + 上线检查清单
- `.github/workflows/keepalive.yml` — 保活脚本

**后端 `server/src/`**
- `index.js` — 入口（Express + 静态托管 + WebSocket + 启动自检日志）
- `db.js` — 数据访问层（用户/瓶子/会话/消息/Bot 种子；JSON 或 PG 双模式）
- `routes/auth.js` — `/auth/email/send`、`/auth/sms/send`、`/auth/login`、`/auth/register`、`/auth/reset/send`、`/auth/reset/confirm`、`/auth/me`
- `routes/chat.js` — 会话/消息/未读/已读
- `routes/bottles.js` — 漂流瓶列表/详情/回复
- `routes/coins.js` `profile.js` `report.js` `blacklist.js` `admin.js`
- `services/sms.js` — 阿里云短信（发送+校验，限频 key 含 purpose）
- `services/email.js` — 邮件（dev/resend/smtp，限频 key 含 purpose）
- `services/botEngine.js` — Bot 调度与回复
- `services/aiProvider.js` — AI 调用 + `containsAIExposure()` 过滤
- `utils/jwt.js` `utils/crypto.js` `middleware/auth.js`
- `test-reset.js` — 忘记密码回归测试

---

## 11. 线上地址速查

| 用途 | 地址 |
|---|---|
| 用户前端（推荐入口） | `https://www.piaoyuisland.xyz/` |
| 注册页 | `https://www.piaoyuisland.xyz/register.html` |
| 管理后台 | `https://www.piaoyuisland.xyz/admin.html` |
| 后端 API | `https://drift-island-api.onrender.com/api` |
| 健康检查 | `https://drift-island-api.onrender.com/api/health` |

---

*本文件随项目演进维护；下次重大改动后请同步更新第 5、6、9 节。*
