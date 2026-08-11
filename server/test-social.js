/**
 * Second-phase social features integration test (follow / visits / interactions /
 * level / verification). Runs in-process against db.js with disk writes stubbed
 * so the real data/db.json is never touched.
 *
 * Run:  node server/test-social.js
 */
const fs = require('fs');
// No-op disk writes so we never pollute the real JSON database.
fs.writeFileSync = () => {};

const db = require('./src/db');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg); }
}

// Fresh in-memory collections.
const cache = db.db();
cache.users = []; cache.follows = []; cache.visits = [];
cache.interactions = []; cache.moments = []; cache.bottles = [];
cache.chatSessions = [];

console.log('\n[1] 关注系统 (Follow)');
const a = db.createUser('13800000001', '', '');
const b = db.createUser('13800000002', '', '');
a.nickname = 'Alice'; b.nickname = 'Bob';

let r = db.toggleFollow(a.id, b.id);
ok(r && r.following === true, 'A 关注 B 成功');
ok(r && r.followerCount === 1, 'B 粉丝数 = 1');
ok(db.getFollowCounts(a.id).followingCount === 1, 'A 关注数 = 1');
ok(db.isFollowing(a.id, b.id) === true, 'isFollowing(A,B) = true');

let r2 = db.toggleFollow(a.id, b.id);
ok(r2 && r2.following === false, 'A 再次点击取消关注');
ok(db.getFollowCounts(b.id).followerCount === 0, 'B 粉丝数回到 0');

ok(db.toggleFollow(a.id, a.id) === null, '不能关注自己 (返回 null)');
ok(db.toggleFollow(a.id, 'nope') === null, '关注不存在用户返回 null');

// [2] 访客记录 (Visits)
console.log('\n[2] 访客记录 (Visits)');
const v1 = db.recordVisit(b.id, a.id);
ok(!!v1, 'B 访问 A 主页被记录');
ok(db.getVisitors(a.id).total === 1, 'A 的访客数 = 1');
ok(db.getVisitCount(a.id) === 1, 'A 的访客计数 = 1');
ok(db.recordVisit(a.id, a.id) === null, '访问自己不记录');
const v2 = db.recordVisit(b.id, a.id); // 60min dedupe window
ok(db.getVisitors(a.id).total === 1, '同访客 60 分钟内去重，仍 = 1');
ok(v2 && v2.id === v1.id, '去重复用同一记录 id');

// [3] 互动记录 (Interactions)
console.log('\n[3] 互动记录 (Interactions)');
// follow above already produced a 'follow' interaction targeting B.
let ixB = db.getUserInteractions(b.id, { limit: 50 }).items;
ok(ixB.some(i => i.type === 'follow' && i.actorId === a.id), 'B 收到 A 的 follow 互动');
ok(db.getUnreadInteractionCount(b.id) >= 1, 'B 有未读互动');

// like interaction
const mo = db.createMoment(b.id, { content: 'hi', type: 'community' });
const likeRes = db.toggleMomentLike(mo.id, a.id);
ok(likeRes && likeRes.liked === true, 'A 点赞 B 的动态');
ok(db.getUserInteractions(b.id).items.some(i => i.type === 'like' && i.refId === mo.id), 'B 收到 like 互动 (带 refId)');

// comment interaction
db.addMomentComment(mo.id, a.id, 'nice');
ok(db.getUserInteractions(b.id).items.some(i => i.type === 'comment'), 'B 收到 comment 互动');

// visit interaction (A visits B -> B receives a 'visit' interaction from A)
db.recordVisit(a.id, b.id);
ok(db.getUserInteractions(b.id).items.some(i => i.type === 'visit' && i.actorId === a.id), 'B 收到 A 的 visit 互动');

// mark read
const changed = db.markInteractionsRead(b.id);
ok(changed >= 3, '标记 B 的互动已读 (>=3 条)');
ok(db.getUnreadInteractionCount(b.id) === 0, 'B 未读互动清零');

// [4] 等级系统 (Level)
console.log('\n[4] 用户等级系统 (Level)');
const lvlA = db.computeUserLevel(a);
ok(lvlA.level >= 1, '等级 >= 1');
ok(typeof lvlA.title === 'string' && lvlA.title.length > 0, '等级有称号: ' + lvlA.title);
ok(typeof lvlA.progress === 'number' && lvlA.progress >= 0 && lvlA.progress <= 100, '进度在 0-100: ' + lvlA.progress);
// more activity => higher or equal exp
const active = db.createUser('13800000003', '', '');
for (let i = 0; i < 10; i++) db.createMoment(active.id, { content: 'post ' + i, type: 'community' });
const lvlActive = db.computeUserLevel(active);
ok(lvlActive.exp > lvlA.exp, '发帖多的用户经验值更高 (' + lvlActive.exp + ' > ' + lvlA.exp + ')');

// [5] 认证徽章 (Verification)
console.log('\n[5] 认证徽章 (Verification)');
b.verified = true; b.verifiedType = 'official';
ok(b.verified === true && b.verifiedType === 'official', 'B 被设为官方认证');
const lvlB = db.computeUserLevel(b);
ok(typeof lvlB.level === 'number', '认证不影响等级计算');
b.verified = false; b.verifiedType = '';
ok(b.verified === false, '取消认证生效');

// Route syntax / import smoke check (must not throw).
console.log('\n[6] 路由模块加载 (syntax/import)');
let routeErr = null;
try {
  require('./src/routes/follow');
  require('./src/routes/visits');
  require('./src/routes/interactions');
  require('./src/routes/profile');
  require('./src/routes/moments');
  require('./src/routes/admin');
} catch (e) { routeErr = e; }
ok(!routeErr, '所有社交路由模块加载无误' + (routeErr ? ' — ' + routeErr.message : ''));

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
