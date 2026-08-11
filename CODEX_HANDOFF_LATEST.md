# 漂屿项目最新交接文件（新账号从这里开始）

更新时间：2026-08-11（Asia/Shanghai）
交接状态：当前版本已提交、已推送、已部署
当前功能基线：`3e34aa4`（共鸣广场）
当前主题提交：`50aa21f`（温暖岛屿品牌配色）
当前推荐流提交：`1b70a3c`（推荐与最新内容池分离）

> 新账号接手时，只需先完整阅读本文件。除非要核对历史产品决策，不必先阅读其他文档。

## 1. 项目入口

| 项目 | 地址/路径 |
|---|---|
| 本地仓库 | `D:\Program Files (x86)\workbody\2026-08-09-12-39-25\piaoyu-drift-island` |
| GitHub | `https://github.com/Lisben99/piaoyu-drift-island` |
| 生产网站 | `https://www.piaoyuisland.xyz/` |
| Render 后端 | `https://drift-island-api.onrender.com` |
| 健康检查 | `https://drift-island-api.onrender.com/api/health` |
| Render 服务 | `srv-d9rl0g7avr4c739iccn0` |
| Render 后台 | `https://dashboard.render.com/web/srv-d9rl0g7avr4c739iccn0/events` |

Git 当前状态：

- 主分支：`main`
- 兼容部署分支：`master`
- 新账号接手时以 `git log -1` 和线上 `/api/health` 为准；主题功能提交必须包含 `50aa21f`
- Render 监听 `main` 并自动部署
- 前端无构建步骤，仓库根目录的 `index.html` 直接发布
- 后端位于 `server/`，Render 执行 `npm install` 后运行 `node src/index.js`
- 生产数据库：PostgreSQL，但应用以 `kv_store` JSON 文档整体持久化

## 2. 当前产品定位

漂屿保留五个主导航，但各自职责已明确：

1. 首页：签到、等级、快捷业务入口。
2. 大厅：匿名、短暂、随机的漂流瓶相遇。
3. 共鸣：Soul 式兴趣内容社区，先通过内容共鸣，再认识用户。
4. 消息：已经建立的聊天和互动关系。
5. 我的：资料、兴趣、等级、资产与账号设置。

原“社区”已改名为“共鸣”，页面标题为“共鸣广场”。用户端采用米白、海绿、珊瑚橙的“温暖岛屿”视觉，延续漂屿原有品牌；管理后台不换肤。

设计主色：

- 海绿主色：`#1F7A74`
- 深海绿：`#155E5A`
- 珊瑚橙：`#EF7B62`
- 米白背景：`#F7F3EA`
- 深海正文：`#203536`
- 灰绿次级文字：`#7C8985`
- 危险操作：`#D95C50`
- 等级金：`#DDA95E`
- 成功色：`#59A994`

## 3. 最近已完成并上线的内容

生产提交 `3e34aa4` 完成以下功能：

### 3.1 共鸣广场 UI

- 底栏“社区”更名为“共鸣”，图标替换为波形共鸣 SVG。
- 页面标题改为“共鸣广场”，副标题为“遇见与你同频的灵魂”。
- 三个内容流：为你推荐、最新、我关注的。
- 横向兴趣筛选：全部、音乐、电影、阅读、摄影、旅行、独处、情感、City Walk、宠物、游戏、运动、美食。
- 每日一问卡片，点击后自动打开发布弹层并预选话题。
- 发布支持文字、最多 9 图、话题、心情和每日问题 ID。
- 动态展示话题、心情、作者性别 SVG、认证、等级和关注状态。
- 原点赞数据不迁移，UI 和新接口别名统一显示为“共鸣”。
- 主要操作变为：共鸣、评论、聊聊。
- “聊聊”先展示开场白面板，再调用原有付费/拉黑/审核聊天流程。
- 自己的三点菜单：编辑、删除。
- 他人的三点菜单：不感兴趣、举报、拉黑。

### 3.2 搜索与话题

- 新增共鸣搜索页：按用户、受控话题、公开社区动态分组。
- 私人朋友圈 `type: 'moment'` 不进入公开搜索。
- 新增话题聚合页和参与发布入口。
- 推荐流可以按 `topicId` 过滤。

### 3.3 用户兴趣与私聊隐私

- 用户新增 `interestIds: string[]`，前端最多选择并展示 5 个。
- 用户新增 `strangerChatPolicy: 'all' | 'followers' | 'closed'`。
- 编辑资料页可以同时保存资料、兴趣和陌生人私聊权限。
- 后端聊天入口对新会话执行权限校验；已有会话不因设置改变被强制中断。
- 公开资料返回兴趣、私聊策略和收到的共鸣总数。

### 3.4 推荐与内容安全

- “最新”只展示最近 24 小时的合规公开动态，并严格按发布时间倒序。
- “为你推荐”只从 24 小时前至 14 天内的合规公开动态选取，因此不会与“最新”重复。
- 推荐采用可解释规则：兴趣匹配 35、内容质量 20、互动亲和 15、新鲜度 15、新/低曝光作者 10、每日问题 5。
- 推荐排除自己、异常账号、拉黑作者、不感兴趣内容，以及其他推荐会话中 24 小时内已经曝光的内容。
- 同一推荐会话分页保持稳定；切换后新会话不会再次展示 24 小时内已看过的推荐。
- 每 10 条推荐中同一作者最多 1 条、同话题最多 3 条、已关注作者最多 2 条。
- 推荐优先活跃真人；只有没有真人候选时才使用 Bot 内容兜底。
- 推荐/最新/关注流排除已删除内容。
- 当前用户“不感兴趣”的动态会从其内容流排除。
- 当前用户拉黑的作者会从其内容流排除。
- 社区搜索仅搜索公开社区动态。

### 3.5 等级系统

等级系统已经在更早提交中改为后端经验流水制，当前继续沿用：

| 等级 | 称号 | 累计经验 |
|---|---|---:|
| Lv.1 | 初到海岸 | 0 |
| Lv.2 | 拾贝者 | 20 |
| Lv.3 | 漂流者 | 60 |
| Lv.4 | 灯塔守望者 | 120 |
| Lv.5 | 群岛旅人 | 220 |
| Lv.6 | 潮汐信使 | 360 |
| Lv.7 | 深海回声 | 550 |
| Lv.8 | 星海航行者 | 800 |
| Lv.9 | 群岛领航员 | 1120 |
| Lv.10 | 漂屿传说 | 1500 |

共鸣社区新增的经验事件：

- `community_daily_post`：发布共鸣动态，+3，每天最多 2 次。
- `resonance_received`：收到真实用户共鸣，+1，每天最多 5 次。
- `community_comment_received`：收到社区评论，+1，每天最多 5 次。
- `daily_prompt_participation`：参与每日一问，+2，每天最多 1 次。

所有经验继续通过 `awardExperience()`、唯一 `eventKey` 和中国日期键防重复。取消共鸣不会追回少量经验，但再次共鸣不会重复发放。

### 3.6 温暖岛屿视觉

- `index.html` 使用统一 `--island-*` CSS 变量。
- 用户端卡片、按钮、输入框、弹窗、顶部/底部导航使用米白表面、海绿主操作和珊瑚橙强调。
- 保留危险操作的珊瑚红和等级金色。
- 增加 `prefers-reduced-motion` 处理。
- 管理后台 `admin.html` 未进行主题重构。

## 4. 关键代码位置

| 文件 | 当前作用 |
|---|---|
| `index.html` | 全部用户端 HTML、CSS 和原生 JavaScript；共鸣页、搜索、话题、发布、资料编辑均在此 |
| `admin.html` | 管理后台，当前不参与温暖岛屿主题换肤 |
| `config.js` | 前端 API 与 WebSocket 地址 |
| `server/src/db.js` | JSON 文档数据层、推荐排序、动态字段、经验系统、不感兴趣记录 |
| `server/src/communityCatalog.js` | 兴趣、话题、心情、每日问题受控目录 |
| `server/src/routes/community.js` | 目录、话题、每日问题和搜索 API |
| `server/src/routes/moments.js` | 共鸣动态创建、列表、共鸣、评论、编辑、删除、不感兴趣 |
| `server/src/routes/profile.js` | 等级详情、公开资料、兴趣和私聊权限 |
| `server/src/routes/chat.js` | 会话创建、陌生人私聊权限、付费和黑名单规则 |
| `server/src/routes/follow.js` | 关注、粉丝和关注列表 |
| `server/src/routes/blacklist.js` | 拉黑、解除拉黑和黑名单 |
| `server/src/index.js` | Express 入口、静态资源、路由挂载、健康端点 |
| `render.yaml` | Render 服务、PostgreSQL 与环境变量配置 |

前端共鸣关键函数可直接搜索：

- `loadCommunityCatalog()`
- `renderInterestChips()`
- `renderDailyPrompt()`
- `momentCardHtml()`
- `renderCommunityFeed()` / `loadMoreCommunity()` / `switchCommunityTab()`
- `openMomentCompose()` / `submitMoment()`
- `openCommunitySearch()` / `renderCommunitySearch()`
- `viewCommunityTopic()` / `renderCommunityTopic()`
- `openChatStarter()`
- `editCommunityMoment()` / `dismissCommunityMoment()`
- `renderEditProfile()` / `saveProfile()`

## 5. 新增或扩展的数据字段

### 用户

```js
{
  interestIds: [],
  strangerChatPolicy: 'all' // all | followers | closed
}
```

历史用户缺少字段时，读取逻辑分别降级为 `[]` 和 `'all'`。

### 公开社区动态

```js
{
  type: 'community',
  topicId: null,
  mood: null,
  dailyPromptId: null,
  editedAt: null,
  likes: [],       // 原数据继续保存，共鸣复用该数组
  comments: []
}
```

私人朋友圈继续使用 `type: 'moment'`，不得混入公开推荐、搜索和话题页。

### 不感兴趣

数据库根集合：

```js
contentDismissals: [
  { id, userId, momentId, createdAt }
]
```

推荐曝光数据库根集合：

```js
feedExposures: [
  { id, userId, momentId, feed: 'recommend', sessionId, createdAt }
]
```

曝光记录保留 7 天用于自动清理，但推荐去重窗口为最近 24 小时。

## 6. 新增/扩展接口

所有社区接口需要用户登录令牌。

| 方法 | 接口 | 用途 |
|---|---|---|
| GET | `/api/community/catalog` | 兴趣与心情目录 |
| GET | `/api/community/topics` | 受控话题 |
| GET | `/api/community/prompts/today` | 当日问题 |
| GET | `/api/community/search?q=` | 搜索用户、话题和公开动态 |
| GET | `/api/moments/community?sort=recommend\|latest\|following&topicId=` | 共鸣内容流 |
| POST | `/api/moments` | 创建动态，接受 `topicId/mood/dailyPromptId` |
| POST | `/api/moments/:id/like` | 旧点赞接口；同时返回共鸣别名 |
| PUT | `/api/moments/:id` | 作者编辑公开社区动态 |
| POST | `/api/moments/:id/dismiss` | 当前用户标记不感兴趣 |
| POST | `/api/moments/:id/comment` | 评论动态 |
| DELETE | `/api/moments/:id` | 作者删除动态 |
| PATCH | `/api/profile/interests` | 保存最多 5 个受控兴趣 |
| PATCH | `/api/profile/chat-policy` | 保存陌生人私聊权限 |
| GET | `/api/profile/level/me` | 当前等级、规则和经验流水 |

兼容字段：

- 旧接口继续返回 `likeCount` / `likedByMe`。
- 新前端优先使用 `resonanceCount` / `resonatedByMe`。
- 暂时不要删除旧字段，否则旧页面或缓存客户端会出错。

## 7. 验证方式

系统 PATH 中可能存在 Node 11，不要直接假设 `node` 足够新。当前可用现代 Node：

```powershell
$node = 'C:\Users\共产主义接班人\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
```

精简核心回归：

```powershell
& $node server/test-community-core.js
& $node server/test-community-server.js
& $node server/test-social-server.js
& $node server/test-level-system.js
& $node --test server/test-mobile-ui.js
& $node server/check-frontend.js
git diff --check
```

在 `3e34aa4` 合并后的 `main` 上，以上全部退出码为 0：

- 社区数据核心：通过。
- 社区 HTTP 接口：通过。
- 社交 HTTP：20/20 通过。
- 等级核心：通过。
- 移动 UI 结构：14/14 通过。
- `index.html` 与 `admin.html` 内联脚本语法：通过。

不要运行会真实发送短信、邮件、充值或写生产数据的测试，除非用户明确要求并确认成本/影响。

## 8. 部署流程

用户偏好快速迭代，不要求每一步做重复全站审核。常规安全流程：

1. 在 `codex/<feature>` 分支修改。
2. 只运行与本次修改有关的核心测试和脚本语法检查。
3. 合并到 `main`。
4. 推送：

```powershell
git push origin main
git push origin main:master
```

5. 验证 Render：

```powershell
Invoke-RestMethod 'https://drift-island-api.onrender.com/api/health'
```

确认 `deployCommit` 等于本次目标提交，并检查：

```powershell
$html = (Invoke-WebRequest -UseBasicParsing 'https://www.piaoyuisland.xyz/?deploy=<commit>').Content
$html.Contains('--island-primary:#1f7a74')
$html.Contains('共鸣广场')
```

共鸣功能上线时的验证快照（切换账号后请重新读取健康端点）：

- `status: ok`
- `database: postgresql`
- `deployBranch: main`
- `deployCommit: 3e34aa40712d787dea5c5d478cda4ecfc31b48ec`
- 生产 HTML 应包含温暖岛屿主题和“共鸣广场”。

## 9. 尚未完全实现或需要继续优化

以下是设计方案与当前实际代码之间的明确差距，新账号应优先按用户最新反馈推进，不要把它们误报为已经完成：

### P0：真实移动端视觉走查

- 这次按用户要求快速上线，没有重新执行 360/375/390/430px 全页面人工走查。
- 应在真实微信 WebView、iPhone Safari 和 Android Chrome 检查共鸣页、发布弹层、搜索、话题页、聊聊面板、资料编辑和软键盘。
- 温暖岛屿主题目前主要通过共享变量和末尾 CSS 覆盖完成；海绿色旧组件可以自然继承品牌色，但仍需依据真实手机截图逐页精修米白层级、珊瑚橙强调和阴影。

### P1：共鸣功能补齐

- 兴趣目前只在“编辑资料”选择，尚未实现首次进入共鸣广场的兴趣引导。
- 话题页当前为单一聚合流，尚未拆分“热门/最新”两个标签。
- 每日问题尚未显示参与人数，也没有管理后台配置界面；当前为服务器静态轮换。
- 搜索尚未实现热门话题和最近搜索记录。
- 评论仍为平铺列表，尚未实现 `parentCommentId` 一级回复和提及。
- 动态编辑 UI 当前主要编辑正文；图片、话题和心情的完整编辑体验仍可增强。
- 内容发布失败会保留当前弹层内容，但没有独立的本地草稿持久化。

### P1：推荐、安全和反刷

- 推荐未实现“连续重复作者降权”。
- 社区操作尚未增加独立速率限制；目前依赖已有鉴权、审核、黑名单和经验幂等。
- 推荐列表没有单独读取审核状态字段；需结合现有内容审核数据结构再完善。
- `followers` 私聊策略由后端权威判断“发起者是否关注对方”；公开资料按钮的前端提示还可更精确。
- 已有聊天会话不会因后来关闭陌生人私聊而中断，这是有意的当前行为。

### P2：已有项目待办

- 充值闭环仍建议跑一次真实端到端：创建订单、提交凭证、后台确认、到账。
- `DEPLOYMENT.md` 和早期项目总结可能仍有过期描述。
- 历史聊天曾出现过阿里云 AccessKey 明文，建议在阿里云后台轮换；不要把任何密钥写入仓库或交接文档。

## 10. 安全与数据红线

1. 不提交 `server/data/db.json`、真实用户数据、付款凭证或 `.env`。
2. 不在前端或 Markdown 中写阿里云、腾讯云、Resend、JWT、数据库密钥。
3. 所有数据库派生文本进入 HTML 前使用 `escapeHtml()`。
4. inline `onclick` 不得直接拼接用户可控的昵称、正文或 URL；尽量只传服务器生成 ID。
5. 管理后台不是本轮换肤范围，除非用户明确要求。
6. 不更改漂流币价格、支付逻辑、短信策略或生产数据，除非用户明确授权。
7. 不使用 `git reset --hard`、强推或覆盖用户未提交修改。
8. PostgreSQL 使用整体 JSON 文档持久化，新增根集合必须加入 `createDefaultDB()` 并兼容历史数据缺失字段。

## 11. 近期重要提交

| 提交 | 内容 |
|---|---|
| `1b70a3c` | 推荐与最新内容池分离、推荐曝光去重、作者/话题多样性 |
| `50aa21f` | 用户端从紫粉调整为米白、海绿、珊瑚橙“温暖岛屿”主题 |
| `3e34aa4` | 共鸣广场、梦境主题、社区接口、兴趣/隐私和社区经验上线 |
| `fbdbba0` | 共鸣广场实施计划 |
| `875562f` | 共鸣广场与梦境灵魂设计方案 |
| `4d051a2` | 动态身份徽章对齐、删除移动到三点菜单 |
| `abb0683` | 修复关注内容流和动态卡片布局 |

原始方案文档仍可用于追溯：

- `docs/superpowers/specs/2026-08-11-resonance-community-dream-theme-design.md`
- `docs/superpowers/plans/2026-08-11-resonance-community-implementation.md`
- `docs/superpowers/specs/2026-08-11-level-system-design.md`
- `docs/superpowers/plans/2026-08-11-level-system.md`

## 12. 给新账号的首条提示词

可将以下内容连同本文件路径发给新账号：

```text
请完整阅读：
D:\Program Files (x86)\workbody\2026-08-09-12-39-25\piaoyu-drift-island\CODEX_HANDOFF_LATEST.md

这是漂屿项目的最新单文件交接。先确认 main、origin/main、origin/master 和线上 Render 的 deployCommit；然后根据我的最新需求继续开发。保持现有单文件前端 + Express/JSON 文档架构，不改管理后台视觉，不破坏历史动态/点赞/关注/聊天/等级数据。我的偏好是快速实施，只运行与本次修改直接相关的核心验证，有问题再迭代。
```

## 13. 接手后的第一组只读命令

```powershell
Set-Location 'D:\Program Files (x86)\workbody\2026-08-09-12-39-25\piaoyu-drift-island'
git status --short
git branch --show-current
git log -5 --oneline --decorate
git remote -v
Invoke-RestMethod 'https://drift-island-api.onrender.com/api/health'
```

预期：工作区干净，当前分支为 `main`，本地与远端包含推荐流提交 `1b70a3c`，线上健康端点报告最新 `main` 提交。若任一状态不同，先查明差异，不要直接覆盖。
