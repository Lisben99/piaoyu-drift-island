# 漂屿等级系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有实时推算等级升级为后端经验流水制，并交付统一等级摘要、经验详情页、升级提示和全站等级徽章。

**Architecture:** 保留当前 JSON/PostgreSQL `kv_store` 文档存储，在数据库根对象增加 `experienceEvents`，在用户上保存一次性旧经验基线和独立签到连续天数。所有计分通过 `awardExperience()`，所有展示通过 `computeUserLevel()`；业务路由只负责提供幂等事件键并把奖励摘要附加到原响应。

**Tech Stack:** Node.js 18+、Express、现有 `server/src/db.js` 文档数据库、单文件 HTML/CSS/JavaScript 前端、Node 内置 `assert`。

## Global Constraints

- 等级与经验只由后端计算，前端不得自行推算。
- 旧用户用旧公式固化一次性基线；新用户经验从 0 开始。
- 同一 `eventKey` 只能计分一次；超过每日上限时原业务仍成功。
- 采用十级称号与阈值：`0,20,60,120,220,360,550,800,1120,1500`。
- 不提供付费经验、排行榜或等级推荐加权，不改变漂流币数值。
- 用户端优先适配微信 WebView 竖屏 360、375、390、430px。

---

### Task 1: 经验流水、迁移与等级计算核心

**Files:**
- Create: `server/test-level-system.js`
- Modify: `server/src/db.js:70-110,281-330,698-746,1107-1165`

**Interfaces:**
- Produces: `awardExperience(userId, type, { eventKey, sourceId, now, points })`
- Produces: `computeUserLevel(userOrId)` and `getExperienceHistory(userId, limit)`
- Produces: `LEVEL_TIERS` and `EXPERIENCE_RULES`

- [ ] **Step 1: Write failing core tests**

Create an isolated in-process test that clears `users`, `moments`, `bottles`, `chatSessions`, and `experienceEvents`, creates a new user, then asserts:

```js
const fresh = db.createUser('13800009001', '', 'secret1');
assert.equal(db.computeUserLevel(fresh).exp, 0);
const first = db.awardExperience(fresh.id, 'bottle_created', { eventKey: 'bottle:b1', sourceId: 'b1', now });
assert.equal(first.awarded, 2);
assert.equal(db.awardExperience(fresh.id, 'bottle_created', { eventKey: 'bottle:b1', sourceId: 'b1', now }).awarded, 0);
assert.equal(db.computeUserLevel(fresh).exp, 2);
```

Also assert the fourth same-day bottle gives zero, next-day bottle gives two, Lv.2 begins at 20, max level stays Lv.10, history is newest first, and a legacy user receives a frozen baseline only once.

- [ ] **Step 2: Run RED**

Run: `node server/test-level-system.js` using Node v24.14.0.
Expected: failure because `awardExperience` and `experienceEvents` do not exist.

- [ ] **Step 3: Implement storage defaults and migration**

Add `experienceEvents: []` to `createDefaultDB()`. New users get `experienceBase: 0`, `experienceMigratedAt`, and `checkin.experienceConsecutive: 0`. Existing users without a migration marker receive the old computed contribution score as a fixed `experienceBase`; the migration runs after local/PG load and persists once.

- [ ] **Step 4: Implement rules and award engine**

Use these exported rules:

```js
const EXPERIENCE_RULES = {
  daily_checkin: { points: 2, dailyLimit: 1, label: '每日签到' },
  profile_completed: { points: 10, once: true, label: '完善资料' },
  bottle_created: { points: 2, dailyLimit: 3, label: '发布漂流瓶' },
  bottle_reply: { points: 3, dailyLimit: 5, label: '有效回复' },
  moment_created: { points: 3, dailyLimit: 2, label: '发布动态' },
  comment_created: { points: 1, dailyLimit: 5, label: '有效评论' },
  like_received: { points: 1, dailyLimit: 5, label: '收到点赞' },
  report_accepted: { points: 2, dailyLimit: 3, label: '有效举报' },
  streak_bonus: { points: 0, label: '连续签到奖励' }
};
```

`awardExperience()` rejects missing users/rules/event keys, returns the existing event for duplicates, enforces per-China-calendar-day limits, writes `xp-*` records, calls `save()`, and returns `{ awarded, reason, event, level, previousLevel, leveledUp }`.

- [ ] **Step 5: Run GREEN and commit**

Run the new test plus `server/test-social.js`; commit as `feat(level): add experience ledger and migration`.

---

### Task 2: 业务路由计分与统一等级接口

**Files:**
- Create: `server/test-level-routes.js`
- Modify: `server/src/routes/auth.js`
- Modify: `server/src/routes/profile.js`
- Modify: `server/src/routes/coins.js`
- Modify: `server/src/routes/bottles.js`
- Modify: `server/src/routes/moments.js`
- Modify: `server/src/routes/admin.js`

**Interfaces:**
- Consumes: `awardExperience`, `computeUserLevel`, `getExperienceHistory`, `LEVEL_TIERS`, `EXPERIENCE_RULES`
- Produces: `GET /api/profile/level/me`
- Produces: business response property `experienceAward`

- [ ] **Step 1: Write failing route tests**

Start the real Express app on an ephemeral port with an isolated in-memory database. Register/login two users and verify:

```js
assert.equal((await call('GET', '/api/auth/me', token)).json.level, 1);
assert.equal((await call('POST', '/api/moments', token, { content: '第一条' })).json.experienceAward.awarded, 3);
assert.equal((await call('GET', '/api/profile/level/me', token)).json.level.exp, 3);
```

Add route cases for bottle creation, bottle reply, comment, received like, check-in duplicate, profile completion once, valid/dismissed report handling, and level consistency between `/auth/me`, `/profile/:id`, community author and level detail.

- [ ] **Step 2: Run RED**

Expected: `/profile/level/me` is absent and action responses lack `experienceAward`.

- [ ] **Step 3: Add unified response summaries**

`/auth/me` returns `level`, `levelTitle`, `exp`, `nextExp`, and `progress`. Add authenticated `/profile/level/me` before `/:id`, returning `{ success, level, tiers, rules, history }` with public-safe rule fields only.

- [ ] **Step 4: Award from successful actions**

Attach unique keys based on created object ids, for example `moment:${moment.id}`, `comment:${comment.id}`, `bottle:${bottle.id}`, `reply:${reply.id}`, `checkin:${user.id}:${today}`, `profile-complete:${user.id}`, `like:${moment.id}:${likerId}`, and `report:${report.id}`. Only an accepted report (`result !== 'dismissed'`) awards its reporter. A like awards the content author only when `liked === true`, the liker differs from the author, and the key has never been used.

- [ ] **Step 5: Add independent consecutive experience milestones**

Increment `checkin.experienceConsecutive` without changing the existing coin-cycle field. At 3/7/14/30 days award 2/5/10/20 points through `streak_bonus` with a date-keyed event.

- [ ] **Step 6: Run GREEN and commit**

Run route, level-core, social and social-server tests; commit as `feat(level): award experience from user activity`.

---

### Task 3: 我的等级卡、详情页与升级提示

**Files:**
- Create: `server/test-level-ui.js`
- Modify: `index.html:404-420,670-680,1130-1315,1333-1360,1495-1510,1530-1555,3360-3420`

**Interfaces:**
- Consumes: `GET /api/auth/me`, `GET /api/profile/level/me`, `experienceAward`
- Produces: `levelBadgeHtml()`, `renderLevelProgress()`, `renderLevelDetail()`, `handleExperienceAward()`

- [ ] **Step 1: Write failing frontend tests**

Extract the actual production helpers from `index.html` and assert a Lv.3 summary renders `60 / 120`, a max-level summary renders `已满级`, invalid data degrades to Lv.1, and `handleExperienceAward()` only displays when `leveledUp` is true. Add structural assertions for `page-level-detail`, its scroll root, and the absence of `momentCount / 5` level calculation.

- [ ] **Step 2: Run RED**

Run `node --test server/test-level-ui.js`; expect missing helper/page failures.

- [ ] **Step 3: Add mobile level UI**

Add an independently scrolling `page-level-detail` with safe-area navbar. In “我的”, replace the heuristic badge with a clickable card containing level, title, progress bar, current/next experience and distance to next level. The detail view renders tier ladder, earn rules and recent ledger items, with loading/empty/error/max-level states.

- [ ] **Step 4: Add centralized upgrade feedback**

In `api()`, after parsing a successful JSON response, call `handleExperienceAward(data.experienceAward)`. Store the last shown event id in memory so retries do not duplicate the toast/modal. Show only `leveledUp`, not every award.

- [ ] **Step 5: Unify badges and responsive constraints**

Make all existing level badges use backend values and keep `flex:none`; nickname containers remain `min-width:0` and ellipsize before gender/verification/level badges. Add width checks for 360/375/390/430 source contracts.

- [ ] **Step 6: Run GREEN and commit**

Run level UI and mobile UI tests, extract all inline scripts for `node --check`, then commit as `feat(ui): add level progress and detail page`.

---

### Task 4: 集成验证与部署

**Files:**
- Modify only files required by a reproduced integration failure.

**Interfaces:**
- Consumes all prior tasks; produces deployable `main` and `master` refs.

- [ ] **Step 1: Run focused full verification**

Run with Node v24.14.0:

```text
server/test-level-system.js
server/test-level-routes.js
server/test-level-ui.js
server/test-mobile-ui.js
server/test-social.js
server/test-social-server.js
```

Also run inline-script syntax check and `git diff --check`.

- [ ] **Step 2: Verify repository scope**

Confirm no unrelated admin visual changes, no drift-coin value changes, no secret/data files, and no uncommitted work.

- [ ] **Step 3: Merge and push**

Fast-forward/merge `codex/level-system` into `main`, rerun the three level tests on merged `main`, push `main`, then push `main:master` so Render receives the backend change.

- [ ] **Step 4: Confirm deployment**

Confirm GitHub Pages build succeeds and Render reports a successful deploy/healthy `/api/health`. Report the deployed commit and any known limitations.
