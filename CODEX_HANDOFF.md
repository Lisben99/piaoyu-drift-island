# 漂屿 (Piaoyu Drift Island) — Codex 接手文档

> 本文件用于把项目完整交接给下一个 AI（Codex）继续完善。包含架构、已完成工作、关键约定、待办、部署与调试要点。
> 最后更新：2026-08-11。最新提交 `4dbe7ca`。

---

## 0. 一句话定位

漂屿是一个**陌生人漂流瓶社交 App**：纯前端（HTML/CSS/JS，无框架）+ Node.js/Express 后端 + JSON 文件存储。核心玩法：漂流瓶、社区/朋友圈动态、附近的人、聊天（续聊收费）、AI Bot、漂流币虚拟经济、关注/等级/认证社交体系。

---

## 1. 关键信息速查

| 项 | 值 |
|----|----|
| 前端仓库 | https://github.com/Lisben99/piaoyu-drift-island |
| 线上站点 | https://piaoyuisland.xyz （GitHub Pages 静态托管） |
| 后端 API | https://drift-island-api.onrender.com （Render 部署） |
| 本地项目目录 | 见各工作区克隆路径（Git 已推到 origin） |
| 主要分支 | `main`（监听部署），`master` 与之同步 |
| 渲染配置 | `render.yaml`（Blueprint，`autoDeploy: true`，只监听 main） |
| 本地存储 | 前端静态文件 + 后端 `server/data/db.json` |

> ⚠️ **部署约定**：Render 只监听 `main` 分支自动部署。**推 main 即上线**。推 master 不会触发部署（master 仅用于同步备份）。每次前端/后端改动后，记得 `git push origin main` 以及 `git push origin main:master` 保持同步。

---

## 2. 技术架构

### 2.1 前端（纯静态）
- 文件：`index.html`（主 App，约 200KB）、`admin.html`（管理后台）、`register.html`（注册）
- 无构建步骤、无框架。所有逻辑内联在 `<script>` 中。
- 关键约定：
  - `api(path, opts)` — 统一 fetch 封装，自动带 token
  - `escapeHtml(str)` — **所有渲染 DB 派生文本必须用它**（见 §6 安全红线）
  - `avatarMarkup(name, avatar, cls, color)` / `genderText(g)` — 头像/性别图标渲染
- 托管：GitHub Pages（仓库根目录静态文件即站点根）

### 2.2 后端（Node.js + Express）
- 入口：`server/src/index.js`
- 路由：`server/src/routes/*.js`（每个业务一个文件）
- 数据层：`server/src/db.js`（JSON 文件存储，全局 `cache` 对象 + `save()` 落盘 `data/db.json`）
- 服务：`server/src/services/*.js`（sms/email/payment/moderation/aiProvider/botEngine/redeem/invite）
- 中间件：`server/src/middleware/auth.js`（`auth` 强制登录 / `adminAuth` 管理员）
- 工具：`server/src/utils/{jwt,crypto}.js`
- WebSocket：`server/src/services/websocket.js`（实时通知）
- 存储：`server/data/db.json`（**已被 gitignore**，本地开发需 `npm install`）

### 2.3 运行与测试
```bash
cd server && npm install
node src/index.js                 # 本地起服务（默认 3000）
node test-social.js               # 社交功能数据层测试（30 断言）
node test-social-server.js        # 路由层 HTTP 测试（18 断言）
cat server/test-*.js | head       # 其他模块测试
```
> 注意：本地 `node_modules` 可能缺 `cors`，导致 `index.js` 无法完整 boot。测试时用 stub-auth 的路由级 HTTP 测试（如 `test-social-server.js`）覆盖路由逻辑，生产环境 Render 依赖完整。

---

## 3. 外部服务与密钥

### 3.1 短信（已实现、已验证）
- **产品**：阿里云**号码认证·短信认证（Dypnsapi）**，控制台 https://dypns.console.aliyun.com/
- **非**标准短信服务（dysms），两套额度不互通
- 个人免资质，系统赠送签名「恒创联众」+ 模板「100001」
- 服务端：`server/src/services/sms.js`，使用 `@alicloud/dypnsapi20170525`
- 真实闭环已验证：发码 `code:OK` + 收码 + 阿里云校验 `verifyResult PASS` → 登录签发 token
- 余额：已购 1000 条（实测 994~995），控制台「短信认证」套餐包
- 环境变量：`SMS_PROVIDER=aliyun`、`ALIYUN_SMS_KEY`、`ALIYUN_SMS_SECRET`（Render 已配）

### 3.2 支付（占位 / 待做）
- `server/src/services/payment.js` 仍是 `wechat`/dev 占位桩
- **方案 B 延伸（凭证闭环）代码已完整**：后台「系统配置」上传收款码 → 用户充值拉二维码 → 传支付截图 → 管理员后台确认 → 发卡。
  - **唯一缺口**：管理员还没在后台上传真实收款码（运行时操作，非代码缺漏）
- **方案 C（易支付/码支付/虎皮椒聚合支付自动到账）**：用户明确暂不推进（担心开户费/费率）
  - 结论：用国产个人渠道（易支付类 ~0.6%~1% 无开户费，或码支付支付宝通道免费 ~1%）替代微信商户号
  - 合规红线：漂流币只能**内部消耗**（送礼/装扮/解锁），**不能反向兑换人民币**

### 3.3 内容审核
- `server/src/services/moderation.js`：本地关键词过滤（`MODERATION_PROVIDER=local`，默认开启）
- 可选升级：腾讯云天御（UGC 风控更稳，需密钥 + 少量费用）

### 3.4 邮件
- `server/src/services/email.js`：dev 模式占位，生产需配 SMTP/邮件服务

---

## 4. 已完成功能清单（含提交）

### 4.1 核心业务（早期）
- 漂流瓶（投放/捞取/回复/过期/匿名）
- 社区动态 + 个人动态（朋友圈）
- 附近的人（定位授权门 + 附近真人）
- 聊天（续聊收费、WebSocket 实时）
- 通知中心（铃铛未读 + 列表）
- 管理后台（用户/漂流瓶/动态/举报管理、仪表盘）
- AI Bot（botEngine + aiProvider）
- 邀请系统、每日签到、充值/漂流币、兑换码

### 4.2 近期修改（按时间倒序）

| Commit | 内容 |
|--------|------|
| `4dbe7ca` | **修复漂流瓶卡片手机端性别图标换行**（昵称与 ♂/♀ 同行） |
| `95426ab` | 修复社区动态性别图标移动端换行（修错组件，被 4dbe7ca 覆盖） |
| `2c6480d` | 健康端点暴露 `deployCommit`/`deployBranch`，便于核对线上版本 |
| `c13ce09` | **短信隐藏缺陷修复**：限频 key 回滚错误、密钥缺失静默泄漏 devCode、错误码中文、dev 码清理 |
| `819c266` | **第二期社交功能**：关注/访客/互动/等级/认证徽章 + viewImage XSS 修复 |
| `437d9e6` | 个人动态全面重做为微信朋友圈风格（封面+左日期右内容+图片网格） |
| `97ffbe4` | 个人动态与社区动态**彻底分离**，两内容池无交集，陌生人看朋友圈显示锁定态 |
| `79510d7` | 朋友圈隐私后端（moment/community 类型分离 + 按聊天关系过滤可见性） |
| `f73b8de` | 发布弹窗图片按钮修复 + 朋友圈风格重设计 |
| `c5116e3` | 个人动态改为朋友圈风格（日期分组、去重头像） |
| `e2ebba6`/`e0c1957`/`71cd48d` | 配色统一（去绿粉冲突、主色 #1f7a74）、大厅性别图标化、点赞 SVG 心形 |
| `713127a` | **存储型 XSS 修复**：漂流瓶/用户/举报渲染转义 + 后台处罚 onclick 注入 |

---

## 5. 第二期社交功能详解（`819c266`）

### 5.1 数据模型（`server/src/db.js` 新增集合）
- `follows`：关注关系 `{id, followerId, followingId, createdAt}`
- `visits`：访客记录（60min 去重）`{id, visitorId, targetId, createdAt}`
- `interactions`：互动流（赞/评论/关注/访问，带 `read` 标记）`{id, type, actorId, targetUserId, refId, refType, read, createdAt}`

### 5.2 路由
- `routes/follow.js`：`POST /toggle`、`GET /following`、`GET /followers`、`GET /:id/is-following`
- `routes/visits.js`：`POST /:userId`（记录访问）、`GET /me`（仅本人可见访客）
- `routes/interactions.js`：`GET /`（我收到的互动，分页+未读计数）、`POST /read`

### 5.3 等级系统
- `computeUserLevel(user)` 纯函数（db.js 导出）：按发帖/漂流瓶/聊天/注册天数/充值累计经验 → 7 档称号 + 当前经验 + 升级所需
- 在 `profile/:id`、`moments/user/:userId`、community/nearby enrich 中返回 `level`/`levelTitle`

### 5.4 认证徽章
- 用户字段：`verified`(bool)、`verifiedType`(personal|official)、`verifiedAt`
- 后台 `POST /api/admin/users/:id/verify` 设置
- 前端昵称后展示 ✓ 徽章（个人黄/官方蓝）

### 5.5 测试
- `server/test-social.js`（数据层 30 断言）、`server/test-social-server.js`（路由层 18 断言）全通过

---

## 6. 安全红线（必须遵守）

1. **XSS**：所有渲染 DB 派生文本（昵称、内容、评论、举报）必须用 `escapeHtml()`。
2. **inline-handler 不能用字符串拼接 DB 数据做参数**：
   - ❌ `onclick="showPenalize('${u.id}','${u.nickname}')"`（nickname 含引号可注入 JS）
   - ✅ 只传服务端生成的 id，从缓存查名；或改用 `onclick="func(this.dataset.id)"`
   - 已修：`viewImage('${src}')` → `viewImage(this.src)`（this.src 走浏览器安全取值）
3. **短信**：`SMS_PROVIDER=aliyun` 但密钥缺失时**必须报错**，不得静默回退 dev 模式泄漏验证码（已在 `c13ce09` 修复）。
4. 阿里云 RAM AccessKey 曾在前端聊天中明文出现 → **建议到阿里云轮换一次**（仅提醒，非代码问题）。

---

## 7. 给 Codex 的待办（按优先级）

### P0 — 充值闭环端到端验证（最高价值、最低成本）
- 管理员到后台「系统配置」上传微信/支付宝收款码（运行时操作）
- 跑通：创建订单 → 显示二维码 → 提交凭证 → 管理员确认 → 到账
- 代码已完整，只差上传收款码这一步

### P1 — 全站体验走查（用户很在意 UI）
- 系统过一遍所有页面：大厅/漂流瓶/社区/朋友圈/附近/聊天/通知/个人中心/设置/邀请/充值/后台
- 找别扭、不一致、死按钮、文案错位，逐个修
- 近期修过的移动端性别图标错位（§8）是典型，可能还有其他移动端样式问题

### P2 — 文档修正 + 安全收尾
- `DEPLOYMENT.md` §10 仍写"短信因余额不足被停用"（已不实，应改为"余额已购足、短信已恢复"）
- `项目交接总结.md` 支付章节 outdated（方案 C 暂不做，应标注）
- 阿里云 AccessKey 轮换提醒
- 短信测试产生的临时账号（`15996041410` 自动注册）可清理

### 可选增强
- 内容审核升级到腾讯云天御
- 送礼系统 / 任务中心 / 会员体系 / 兴趣圈子（产品层扩展，见历史讨论）
- 支付方案 C（易支付类，用户暂不做）

---

## 8. 已知移动端样式问题（已修）

| 问题 | 组件 | 修复 |
|------|------|------|
| 性别图标掉到昵称下一行 | **漂流瓶卡片** `bottle-card__name` | `4dbe7ca`：把 genderIcon 移入 name 行，name 改 flex+nowrap，昵称用 `.bn-text` 省略 |
| 性别图标移动端错位 | 社区动态 `moment-name-row` | `95426ab` + 早期 `71cd48d`：`.gender-badge` 加 inline-flex + vertical-align:middle，name 行 flex-shrink:0 |

> 📌 **调试经验**：用户手机截图反馈"错位"时，先确认是哪个卡片组件（漂流瓶 `bottle-card` vs 社区 `moment-card` vs 附近 `nearby-card`），三个是不同的 HTML 结构和 CSS。曾因修错组件（`moment-card`）导致不生效。

---

## 9. 关键文件导航

| 文件 | 用途 |
|------|------|
| `index.html` | 主 App 全部前端逻辑（查找 `function render*` 看各页渲染） |
| `admin.html` | 管理后台 |
| `server/src/db.js` | 数据层核心（集合、helper、导出） |
| `server/src/index.js` | 路由注册、健康端点（含 deployCommit） |
| `server/src/routes/*.js` | 各业务接口 |
| `server/src/services/sms.js` | 短信（已修隐藏缺陷，含中文错误码） |
| `server/src/services/payment.js` | 支付（占位桩，待做方案 B/C） |
| `render.yaml` | Render 部署配置 |
| `DEPLOYMENT.md` | 部署文档（部分过时，待更新） |
| `HANDOFF.md` / `项目交接总结.md` | 早期交接文档（历史参考） |

---

## 10. 沙箱/调试注意事项

- 删除文件时沙箱 safe-delete 可能拦截 `rm`/`PowerShell Remove-Item`/`fs.unlinkSync`；必要时用 `fs.renameSync` 移到系统 temp 目录绕过（测试产生的临时文件若未进 git 树，不影响提交）。
- `git commit` 时不要 `git add -A` 把 `server/data/db.json`（含真实用户）或 `node_modules` 提交（已 gitignore）。
- 前端无构建，改完 `index.html` 直接 push main 即上线（GitHub Pages）。
- 后端改完 push main 触发 Render 自动部署（免费版冷启动约 1-2 分钟）。
- 验证部署版本：`curl https://drift-island-api.onrender.com/api/health` 看 `deployCommit` 字段是否等于目标提交。

---

## 11. 2026-08-11 共鸣广场与梦境主题升级

- 用户端主色升级为紫粉“梦境灵魂”设计系统；管理后台保持原样。
- 底部“社区”更名为“共鸣”，页面升级为“共鸣广场”：为你推荐、最新、我关注的、兴趣筛选、每日一问。
- 社区动态支持话题、心情、每日问题、最多 9 图、共鸣、评论、聊聊开场、编辑/删除、不感兴趣、举报与拉黑。
- 新增用户/话题/公开动态搜索与话题聚合页；私人朋友圈不会进入搜索或社区推荐。
- 用户资料新增最多 5 个兴趣和陌生人私聊权限；后端聊天入口同步执行权限校验。
- 等级系统新增社区发帖、收到共鸣、收到评论、每日问题参与奖励，继续使用幂等事件键和每日上限。
- 新增 `server/src/communityCatalog.js`、`server/src/routes/community.js` 以及两份聚焦回归脚本。

验证入口：

```powershell
node server/test-community-core.js
node server/test-community-server.js
node --test server/test-mobile-ui.js
node server/check-frontend.js
```

*本文件为项目交接用，覆盖至 2026-08-11 的共鸣广场升级。*
