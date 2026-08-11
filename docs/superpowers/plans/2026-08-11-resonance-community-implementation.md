# 共鸣广场与梦境灵魂主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户端全站升级为梦境灵魂视觉，并把现有社区改造成基于兴趣、话题和内容共鸣的“共鸣广场”。

**Architecture:** 保持现有单页 `index.html` 与 Express/JSON-blob 数据层，不做框架迁移。后端通过现有 `db.js`、`profile.js`、`moments.js` 渐进扩展；新建聚焦的 `community.js` 承载话题、每日问题、搜索和不感兴趣接口，历史动态与点赞数据原地兼容。

**Tech Stack:** HTML/CSS/原生 JavaScript、Node.js、Express、PostgreSQL JSON blob/本地 JSON、Node 内置 `assert`/`node:test`。

## Global Constraints

- 仅改用户端视觉，管理后台不改版。
- 不引入新的前端框架或构建步骤。
- 保留现有用户、动态、关注、点赞、评论、聊天和等级数据。
- 第一阶段不实现短视频、直播、语音匹配、群聊房、礼物打赏、复杂性格测试或 AI 推荐模型。
- 公开社区动态和私人朋友圈继续分离。
- 覆盖 360、375、390、430px 竖屏；保持动态视口和安全区规则。
- 测试限定为核心数据、接口、前端结构与语法检查，避免重复全站审核。

---

### Task 1: 建立梦境灵魂主题变量与共享组件

**Files:**
- Modify: `index.html:8-734`
- Modify: `server/test-mobile-ui.js`

**Interfaces:**
- Produces CSS variables: `--dream-primary`, `--dream-primary-dark`, `--dream-accent`, `--dream-bg`, `--dream-surface`, `--dream-text`, `--dream-muted`, `--dream-danger`, `--dream-level`.
- Existing page markup continues using current class names; shared button/card/input/modal rules consume the variables.

- [ ] **Step 1: Write the failing theme structure test**

```js
test('user UI exposes the approved dream theme tokens', () => {
  for (const token of ['--dream-primary:#7561d1', '--dream-accent:#c878b7', '--dream-bg:#f7f5fc']) {
    assert.ok(html.toLowerCase().includes(token));
  }
  assert.match(html, /\.primary-button\{[^}]*var\(--dream-primary\)/s);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node server/test-mobile-ui.js`  
Expected: FAIL because the approved tokens are absent.

- [ ] **Step 3: Add variables and shared component rules**

```css
:root{
  --dream-primary:#7561d1;--dream-primary-dark:#5947b4;
  --dream-accent:#c878b7;--dream-bg:#f7f5fc;
  --dream-surface:rgba(255,255,255,.88);--dream-text:#28243d;
  --dream-muted:#8f899f;--dream-danger:#e5747d;--dream-level:#dda95e;
  --dream-gradient:linear-gradient(135deg,#7561d1,#c878b7);
}
```

Update shared page backgrounds, primary/ghost/danger buttons, cards, inputs, headers, tab bars and modal surfaces to use these variables. Add `prefers-reduced-motion` handling.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node server/test-mobile-ui.js && node server/check-frontend.js`  
Expected: all assertions pass and both inline scripts parse.

- [ ] **Step 5: Commit**

```bash
git add index.html server/test-mobile-ui.js
git commit -m "feat(ui): add dream soul design system"
```

### Task 2: 扩展社区数据模型与受控配置

**Files:**
- Modify: `server/src/db.js:413-475, 750-900, 1260-1320`
- Create: `server/src/communityCatalog.js`
- Create: `server/test-community-core.js`

**Interfaces:**
- `COMMUNITY_INTERESTS: Array<{id:string,label:string}>`
- `COMMUNITY_MOODS: Array<{id:string,label:string,emoji:string}>`
- `listCommunityTopics(): CommunityTopic[]`
- `getTodayPrompt(now = Date.now()): DailyPrompt`
- `createMoment(userId, {content,images,type,topicId,mood,dailyPromptId})`
- `listMoments({community,viewerId,followedByUserId,topicId,sort,limit,offset})`
- User fields: `interestIds: string[]`, `strangerChatPolicy: 'all'|'followers'|'closed'`.

- [ ] **Step 1: Write failing data tests**

```js
const { COMMUNITY_INTERESTS, COMMUNITY_MOODS, getTodayPrompt } = require('./src/communityCatalog');
assert.ok(COMMUNITY_INTERESTS.length >= 10);
assert.ok(COMMUNITY_MOODS.some(item => item.id === 'calm'));
assert.equal(getTodayPrompt(new Date('2026-08-11T04:00:00Z').getTime()).dateKey, '2026-08-11');

const moment = db.createMoment(user.id, { content:'hello', type:'community', topicId:'music', mood:'calm' });
assert.equal(moment.topicId, 'music');
assert.equal(moment.mood, 'calm');
```

- [ ] **Step 2: Verify RED**

Run: `node server/test-community-core.js`  
Expected: FAIL because catalog and extended moment fields do not exist.

- [ ] **Step 3: Implement catalog and backward-compatible fields**

Use immutable catalog IDs. `getTodayPrompt()` selects a prompt by China calendar day; historic moments without fields enrich as `null`. Validate all IDs against the catalog before persistence.

- [ ] **Step 4: Add deterministic rule ranking**

```js
score = interestMatch * 35 + interactionAffinity * 25 + freshness * 25 + quality * 15;
```

Return chronological order for `latest`, follow-filtered chronological order for `following`, and score order for `recommend`. Exclude blocked/dismissed authors before pagination.

- [ ] **Step 5: Verify GREEN**

Run: `node server/test-community-core.js && node server/test-social.js`  
Expected: all assertions pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.js server/src/communityCatalog.js server/test-community-core.js
git commit -m "feat(community): add interests topics moods and ranking"
```

### Task 3: 提供社区与资料 API

**Files:**
- Create: `server/src/routes/community.js`
- Modify: `server/src/routes/moments.js:30-180`
- Modify: `server/src/routes/profile.js:9-130`
- Modify: `server/src/index.js:38-58`
- Create: `server/test-community-server.js`

**Interfaces:**
- `GET /api/community/catalog -> {interests,moods}`
- `GET /api/community/topics -> {topics}`
- `GET /api/community/prompts/today -> {prompt}`
- `GET /api/community/search?q= -> {users,topics,moments}`
- `POST /api/moments/:id/dismiss -> {success:true}`
- `PUT /api/moments/:id -> {success:true,moment}`
- `PATCH /api/profile/interests -> {success:true,interestIds}`
- `PATCH /api/profile/chat-policy -> {success:true,strangerChatPolicy}`
- Existing `GET /api/moments/community` consumes `sort` and optional `topicId`.

- [ ] **Step 1: Write failing HTTP route tests**

```js
const catalog = await call('GET','/api/community/catalog');
ok(catalog.status === 200 && catalog.json.interests.length >= 10, 'catalog available');
const update = await call('PATCH','/api/profile/interests',{interestIds:['music','reading','travel']});
ok(update.json.interestIds.length === 3, 'interests saved');
const feed = await call('GET','/api/moments/community?sort=recommend&topicId=music');
ok(feed.json.moments.every(m => m.topicId === 'music'), 'topic filter works');
```

- [ ] **Step 2: Verify RED**

Run: `node server/test-community-server.js`  
Expected: 404 or missing fields.

- [ ] **Step 3: Implement validated routes**

Reject invalid interest/topic/mood IDs with 400. Search only public community content. Edit only the author's own public post. Dismiss only affects the current viewer.

- [ ] **Step 4: Extend moment enrichment**

Return `topic`, `mood`, `dailyPromptId`, `resonanceCount`, `resonatedByMe`, author interests and chat policy eligibility. Keep legacy `likeCount`/`likedByMe` for one deployment as compatibility aliases.

- [ ] **Step 5: Verify GREEN**

Run: `node server/test-community-server.js && node server/test-social-server.js`  
Expected: all route assertions pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/community.js server/src/routes/moments.js server/src/routes/profile.js server/src/index.js server/test-community-server.js
git commit -m "feat(api): expose resonance community endpoints"
```

### Task 4: 重建共鸣广场和发布体验

**Files:**
- Modify: `index.html:1195-1240, 3970-4475`
- Modify: `server/test-mobile-ui.js`

**Interfaces:**
- `loadCommunityCatalog(): Promise<void>`
- `renderInterestChips(): string`
- `renderDailyPrompt(): string`
- `switchCommunityTab('recommend'|'latest'|'following'): void`
- `openCommunitySearch(): void`
- `openMomentCompose(type, presetTopicId = null): void`
- `momentCardHtml(moment): string`
- `openChatStarter(momentId, authorId): void`

- [ ] **Step 1: Write failing structure tests**

```js
const community = pageMarkup('community').innerHtml;
assert.match(community, /共鸣广场/);
assert.match(community, /communityInterestChips/);
assert.match(community, /communityDailyPrompt/);
assert.doesNotMatch(community, />社区</);

const card = renderMomentCard('other');
assert.match(card, /共鸣/);
assert.match(card, /聊聊/);
assert.doesNotMatch(card, /点赞/);
```

- [ ] **Step 2: Verify RED**

Run: `node server/test-mobile-ui.js`  
Expected: FAIL on missing resonance markup.

- [ ] **Step 3: Implement page shell and feed**

Replace the existing community header with title, search and publish. Add three feed tabs, interest chips, daily prompt card and dream-themed cards. Preserve independent scroll root and bottom navigation.

- [ ] **Step 4: Upgrade publish modal**

Add mood and topic pickers, preset the daily prompt topic, retain draft fields on API or upload failure, and send `{content,images,type,topicId,mood,dailyPromptId}`.

- [ ] **Step 5: Implement resonance and chat starter UI**

Use the existing like endpoint while displaying “共鸣”. The chat starter sheet provides three deterministic prompts based on topic and a custom input; its final action calls the existing `startChat()` flow so coin and block rules remain authoritative.

- [ ] **Step 6: Verify GREEN and syntax**

Run: `node server/test-mobile-ui.js && node server/check-frontend.js`  
Expected: all assertions and syntax checks pass.

- [ ] **Step 7: Commit**

```bash
git add index.html server/test-mobile-ui.js
git commit -m "feat(ui): build resonance plaza experience"
```

### Task 5: 兴趣资料、搜索、话题页与隐私

**Files:**
- Modify: `index.html:1250-1570, 3480-3830, 4175-4345`
- Modify: `server/test-mobile-ui.js`
- Modify: `server/test-community-server.js`

**Interfaces:**
- New pages: `page-community-search`, `page-community-topic`.
- `renderCommunitySearch(query): Promise<void>`
- `viewCommunityTopic(topicId): Promise<void>`
- `renderInterestEditor(selectedIds): string`
- `saveCommunityInterests(): Promise<void>`
- `saveChatPolicy(policy): Promise<void>`

- [ ] **Step 1: Write failing page and privacy tests**

Assert that search never returns `type:'moment'`, profile editing caps interests at 5 visible tags, and `strangerChatPolicy:'closed'` disables the chat starter.

- [ ] **Step 2: Verify RED**

Run: `node server/test-mobile-ui.js && node server/test-community-server.js`  
Expected: FAIL on missing pages and policy behavior.

- [ ] **Step 3: Implement search and topic pages**

Group results under users, topics and dynamics. Topic detail exposes hot/latest tabs and a publish action with preset topic.

- [ ] **Step 4: Implement profile interest and privacy controls**

Add interest selection to edit profile and stranger chat policy to settings. Public profiles render at most five interests and total received resonance.

- [ ] **Step 5: Extend card overflow actions**

Self: edit/delete. Others: not interested/report/block. Close the menu after action and refresh only the affected card/feed.

- [ ] **Step 6: Verify GREEN**

Run: `node server/test-mobile-ui.js && node server/test-community-server.js && node server/check-frontend.js`  
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add index.html server/test-mobile-ui.js server/test-community-server.js
git commit -m "feat(community): add search topics interests and privacy"
```

### Task 6: 等级、反刷与社区经验

**Files:**
- Modify: `server/src/db.js:750-900`
- Modify: `server/src/routes/moments.js:72-180`
- Modify: `server/src/communityCatalog.js`
- Modify: `server/test-level-system.js`
- Modify: `server/test-community-server.js`

**Interfaces:**
- Experience event keys: `community_daily_post`, `resonance_received`, `community_comment_received`, `daily_prompt_participation`.
- All keys remain idempotent through `awardExperience(userId,type,{eventKey,sourceId})`.

- [ ] **Step 1: Write failing experience tests**

Verify one award per unique actor/content pair, daily cap enforcement and no repeated award after toggling resonance off/on.

- [ ] **Step 2: Verify RED**

Run: `node server/test-level-system.js`  
Expected: missing community event rules.

- [ ] **Step 3: Implement rules and daily caps**

Use China calendar keys. Do not claw back small awards when content is deleted or resonance is removed, but never award the same event key twice.

- [ ] **Step 4: Verify GREEN**

Run: `node server/test-level-system.js && node server/test-community-server.js`  
Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.js server/src/routes/moments.js server/src/communityCatalog.js server/test-level-system.js server/test-community-server.js
git commit -m "feat(level): reward healthy community activity"
```

### Task 7: 全站换肤收尾、移动端关键回归与部署

**Files:**
- Modify: `index.html` (remaining user page-specific styles only)
- Modify: `server/test-mobile-ui.js`
- Modify: `CODEX_HANDOFF.md`

**Interfaces:**
- No new runtime API; this task completes the approved theme coverage.

- [ ] **Step 1: Add theme coverage assertions**

Assert all user pages use shared dream surfaces/tokens and `admin.html` remains unchanged.

- [ ] **Step 2: Apply theme to remaining user pages**

Cover welcome/login/register, home, lobby, publish, bottles, notifications, messages/chat, profile/friend circle, coins/recharge/invite, blacklist/report/support/account deletion. Keep danger actions coral red and level accents gold.

- [ ] **Step 3: Run the essential verification set**

```bash
node server/test-community-core.js
node server/test-community-server.js
node server/test-mobile-ui.js
node server/test-level-system.js
node server/check-frontend.js
git diff --check
```

Expected: all exit 0 with no failed assertion or syntax error.

- [ ] **Step 4: Manual key-path check only**

At 375px verify login, lobby, resonance feed, publish modal, search, chat starter, messages and profile. Confirm no horizontal overflow, bottom navigation drift or keyboard obstruction.

- [ ] **Step 5: Update handoff and commit**

```bash
git add index.html server CODEX_HANDOFF.md
git commit -m "feat: launch resonance community and dream theme"
```

- [ ] **Step 6: Merge and deploy**

Fast-forward the implementation branch into `main`, push `main` and `main:master`, confirm public HTML contains `--dream-primary` and `/api/health` reports the deployed commit.
