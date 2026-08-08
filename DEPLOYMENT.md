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

后端目前预留了三个生产服务商开关，但**真实 SDK 对接代码尚未实现（均为占位桩）**。把环境变量切到生产值**不会**自动生效，仅会打印日志 / 回退到本地逻辑。要真正上线，需补齐 SDK 实现（见第 10 节）。

相关环境变量（在 Render Dashboard → 服务 → Environment 中设置，或在 `render.yaml` 中改后推送）：

| 服务 | 开关变量 | 可选值 | 需要的密钥变量 |
| --- | --- | --- | --- |
| 短信 | `SMS_PROVIDER` | `dev` / `aliyun` | `ALIYUN_SMS_KEY`, `ALIYUN_SMS_SECRET`, `ALIYUN_SMS_SIGN`, `ALIYUN_SMS_TEMPLATE` |
| 支付 | `PAYMENT_PROVIDER` | `dev` / `wechat` | `WECHAT_PAY_MCHID`, `WECHAT_PAY_APPID`, `WECHAT_PAY_SERIAL`, `WECHAT_PAY_PRIVATE_KEY`, `WECHAT_PAY_APIV3` |
| 内容审核 | `MODERATION_PROVIDER` | `local` / `tencent` | `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` |
| 签名 | `JWT_SECRET` | 已自动生成 | — |

- **dev 模式短信**：返回 `devCode`，前端直接显示，方便测试，但用户收不到真实短信。
- **local 审核**：本地关键词过滤（见 `server/src/services/moderation.js` 的敏感词表，可按需扩充）。
- **修改环境变量后**：Render 会自动重新部署生效。

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
| 短信收不到 | 当前是 dev 模式，仅返回 `devCode`；aliyun 为占位桩，未真正发送 |
| 充值后没到账 | dev 模式需在前端点「确认」触发模拟到账；wechat 为占位桩 |
| WebSocket 连不上 | 地址为 `wss://drift-island-api.onrender.com/ws?token=<用户token>` |
| 改密码后旧密码还能用 | 应该用 `change-password` 接口改线上库；只改 `db.js` 不影响已存在数据 |

---

## 10. 待完成 / 已知缺口

1. **真实对接三大服务商**（当前为占位桩）：
   - 阿里云短信：需安装 `@alicloud/sms20170525` 或直连 HTTP API，实现 `server/src/services/sms.js` 的 `aliyun` 分支。
   - 微信支付：需安装微信支付 SDK，实现 `createOrder` / `confirmPayment` / `refundOrder` 的真实调用与回调验签（`server/src/services/payment.js`）。
   - 腾讯内容审核：需安装 `tencentcloud-sdk-nodejs`，实现 `moderateTencent`（`server/src/services/moderation.js`）。
2. 微信支付回调地址（`/api/recharge/callback`）需在商户平台配置并补充路由实现。
3. 生产服务商密钥需由运营方提供后填入 Render 环境变量。
4. 建议补充：操作日志可视化、定期数据库备份脚本、错误监控（如 Sentry）。
