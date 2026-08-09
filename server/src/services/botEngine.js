/**
 * Bot Engine (AGENTS §5–§13 / §21).
 *
 * A single engine drives the whole cold-start bot pool:
 *  - schedules a (random 30–90s) reply to human bottles that get no human reply
 *  - posts a few lightweight topics itself when the lobby is quiet
 *  - scales activity down automatically as real users arrive (CSI)
 *  - template-first: only calls an AI model when enable_ai_reply + a key exist
 *
 * Bots are distinct from humans via account_type = 'BOT' (seeded in db.js).
 */
const {
  db, save, genId, findBottleById, findUserById,
  getBotProfiles, getEnabledBots, recordBotActivity, seedBotsIfNeeded
} = require('../db');
const { moderate } = require('./moderation');
const aiProvider = require('./aiProvider');

// ----- Template pools (AGENTS §9: multiple random variants, no obvious repeats) -----
// Keyword buckets matched against the bottle content (lowercased).
const REPLY_TEMPLATES = {
  '有人吗|有人在吗|有人聊天吗|有没有人|找人聊': [
    '有人在的，怎么啦？',
    '我也在，想聊点啥？',
    '这儿有人呀，说说看～',
    '嘿，我在呢，今天过得怎么样？'
  ],
  '无聊|好无聊|太无聊|没事干': [
    '无聊的时候就来找人唠唠呗～',
    '同感，最近有点闲，你一般怎么打发时间？',
    '无聊的话要不要随便瞎聊两句？',
    '无聊最难受了，要不要说说在想啥'
  ],
  '睡不着|失眠|熬夜|半夜|凌晨': [
    '这么晚还没睡呀，是睡不着还是舍不得睡？',
    '夜猫子一枚？在想什么呢',
    '失眠最难受了，要不要聊聊转移下注意力',
    '午夜场搭子报到，陪你熬会儿'
  ],
  '累|好累|疲惫|加班|下班|压力': [
    '听起来今天挺辛苦的，先喘口气～',
    '辛苦啦，是工作还是生活琐事呀？',
    '累的时候来这儿吐个槽也挺好',
    '给自己放个小假吧，今天已经很努力了'
  ],
  'emo|难过|伤心|委屈|焦虑|抑郁|想哭': [
    '抱抱，怎么啦？想说的话这儿有人听',
    '听起来有点低落，愿意说说吗',
    '压力大的时候确实难熬，慢慢来',
    '我在听着呢，不急，慢慢说'
  ],
  '开心|高兴|快乐|好心情|幸福|兴奋': [
    '哇，沾沾喜气！发生什么好事啦？',
    '快乐的事要分享呀，说来听听～',
    '看到你开心我也跟着开心了',
    '好事要记录一下，是什么呀？'
  ],
  '吃饭|饿了|美食|宵夜|吃啥': [
    '深夜放毒还是被饿醒？哈哈',
    '吃了吗？没吃的话先填饱肚子',
    '美食最能治愈了，今天吃的啥',
    '夜宵局还缺人吗，我也饿了'
  ],
  generic: [
    '说得好，继续～',
    '哈哈这话有意思',
    '我也在听呢，展开讲讲？',
    '感觉你挺有意思的',
    '嗯嗯，然后呢？',
    '莫名有点共鸣',
    '这种小事聊起来反而放松',
    '随手回一个，你在就好',
    '这个话题我喜欢，再多说点？',
    '听起来不错呀，你怎么想的呢'
  ]
};

// Proactive lobby topics (AGENTS §12). Kept neutral, non-spammy.
const TOPIC_TEMPLATES = [
  '今天大家都几点下班呀？',
  '最近有没有什么特别上头的歌？',
  '睡不着的人现在都在干嘛呢',
  '如果明天突然放一天假，你最想去哪？',
  '周末一般喜欢宅着还是出去浪？',
  '今晚的月亮还挺圆的，有人一起发呆吗',
  '你们那边现在天气怎么样？',
  '最近在追什么剧或者综艺吗？',
  '有没有那种一想到就觉得开心的小事？',
  '深夜食堂时间到，大家都吃了啥？'
];

let pendingReplies = new Map(); // bottleId -> timeout handle
let postTimer = null;

function config() { return db().config; }
function rand(min, max) { return min + Math.random() * (max - min); }

function kwMatch(text, kws) { return kws.some(k => text.includes(k)); }

function weightedPick(bots) {
  const total = bots.reduce((s, b) => s + (b.activityWeight || 1), 0);
  let r = Math.random() * total;
  for (const b of bots) {
    r -= (b.activityWeight || 1);
    if (r <= 0) return b;
  }
  return bots[bots.length - 1];
}

function pickTemplateReply(bottle) {
  const text = (bottle.content || '').toLowerCase();
  for (const [keys, variants] of Object.entries(REPLY_TEMPLATES)) {
    if (keys === 'generic') continue;
    if (kwMatch(text, keys.split('|'))) {
      return variants[Math.floor(Math.random() * variants.length)];
    }
  }
  const generic = REPLY_TEMPLATES.generic;
  return generic[Math.floor(Math.random() * generic.length)];
}

// Cold Start Index (AGENTS §11). Negative when the lobby is quiet.
function computeCSI() {
  const cfg = config();
  const now = Date.now();
  const recent = now - 10 * 60 * 1000; // last 10 minutes
  const users = db().users.filter(u => (u.account_type || 'HUMAN') === 'HUMAN');
  const humanUsers = users.length;
  const bottles = db().bottles.filter(b => !b.deleted);

  let recentHumanMsgs = 0;
  let humanBottles = 0;
  let answeredHumanBottles = 0;

  for (const b of bottles) {
    const author = findUserById(b.authorId);
    const isHuman = !author || (author.account_type || 'HUMAN') === 'HUMAN';
    const replies = b.replies || [];
    const hasHumanReply = replies.some(r => (r.senderAccountType || 'HUMAN') === 'HUMAN');

    if (b.createdAt >= recent && isHuman) recentHumanMsgs += 1;
    for (const r of replies) {
      if ((r.senderAccountType || 'HUMAN') === 'HUMAN' && r.createdAt >= recent) recentHumanMsgs += 1;
    }
    if (isHuman) {
      humanBottles += 1;
      if (hasHumanReply) answeredHumanBottles += 1;
    }
  }

  const humanReplyRate = humanBottles > 0 ? answeredHumanBottles / humanBottles : 0;
  const unanswered = humanBottles - answeredHumanBottles;

  const csi = (cfg.csi_w1 || 1) * humanUsers
    + (cfg.csi_w2 || 10) * recentHumanMsgs
    + (cfg.csi_w3 || 50) * humanReplyRate
    - (cfg.csi_w4 || 2) * unanswered;

  return { csi, humanUsers, recentHumanMsgs, humanReplyRate, unanswered };
}

function shouldTriggerReply() {
  const cfg = config();
  if (!cfg.enable_bot) return false;
  const { csi } = computeCSI();
  if (csi > (cfg.csi_high_threshold || 50)) return false; // healthy -> bots stand down
  const p = cfg.bot_reply_probability != null ? cfg.bot_reply_probability : 0.8;
  return Math.random() < p;
}

function shouldProactivePost() {
  const cfg = config();
  if (!cfg.enable_bot) return false;
  if (!cfg.enable_bot_public_post || !cfg.bot_public_post_enabled) return false;
  const { csi } = computeCSI();
  if (csi > (cfg.csi_high_threshold || 50)) return false;
  return true;
}

function selectBotForReply() {
  const cfg = config();
  const maxReplies = cfg.bot_daily_max_replies || 200;
  const bots = getEnabledBots().filter(b =>
    (b.dailyReplies || 0) < (b.dailyMaxReplies != null ? b.dailyMaxReplies : maxReplies));
  if (!bots.length) return null;
  return weightedPick(bots);
}

function selectBotForPost() {
  const cfg = config();
  const maxPosts = cfg.bot_daily_max_posts || 12;
  const bots = getEnabledBots().filter(b =>
    (b.dailyPosts || 0) < (b.dailyMaxPosts != null ? b.dailyMaxPosts : maxPosts));
  if (!bots.length) return null;
  return weightedPick(bots);
}

// Called from bottles.js whenever a HUMAN publishes a new bottle.
function scheduleBottleReply(bottleId) {
  const cfg = config();
  if (!cfg.enable_bot) return;
  const bottle = findBottleById(bottleId);
  if (!bottle || bottle.deleted) return;
  const author = findUserById(bottle.authorId);
  if (author && (author.account_type || 'HUMAN') === 'BOT') return; // no bot-on-bot replies
  const delay = rand(cfg.bot_reply_delay_min_seconds || 30, cfg.bot_reply_delay_max_seconds || 90) * 1000;
  if (pendingReplies.has(bottleId)) clearTimeout(pendingReplies.get(bottleId));
  const t = setTimeout(() => {
    runBottleReply(bottleId).catch(e => console.error('[BotEngine] reply error', e));
  }, delay);
  pendingReplies.set(bottleId, t);
}

async function runBottleReply(bottleId) {
  pendingReplies.delete(bottleId);
  const bottle = findBottleById(bottleId);
  if (!bottle || bottle.deleted) return;

  const replies = bottle.replies || [];
  if (replies.some(r => (r.senderAccountType || 'HUMAN') === 'HUMAN')) return; // human already replied
  if (replies.some(r => (r.senderAccountType || 'HUMAN') === 'BOT')) return;    // at most 1 bot reply/message

  if (!shouldTriggerReply()) return;

  const bot = selectBotForReply();
  if (!bot) return;

  let content = null;
  if (config().enable_ai_reply) {
    content = await aiProvider.generateReply({ message: bottle.content, persona: bot.personaPrompt });
  }
  if (!content) content = pickTemplateReply(bottle);
  if (!content) return;

  // All bot content must pass moderation (AGENTS §14).
  if (config().enable_content_moderation !== false) {
    const mod = await moderate(content);
    if (!mod.pass) { console.warn('[BotEngine] reply blocked by moderation:', mod.reason); return; }
  }

  // Lazy require to avoid a circular dependency with routes/bottles.
  const { recordBottleReply } = require('../routes/bottles');
  recordBottleReply(bottle, {
    senderId: bot.userId,
    senderNickname: bot.displayName,
    senderGender: bot.genderDisplay,
    senderAccountType: 'BOT',
    anonymous: false,
    content
  });
  recordBotActivity(bot.botId, 'reply');
}

function pickTopicTemplate() {
  return TOPIC_TEMPLATES[Math.floor(Math.random() * TOPIC_TEMPLATES.length)];
}

async function runProactivePost() {
  if (!shouldProactivePost()) return;
  const bot = selectBotForPost();
  if (!bot) return;
  const content = pickTopicTemplate();

  if (config().enable_content_moderation !== false) {
    const mod = await moderate(content);
    if (!mod.pass) { console.warn('[BotEngine] post blocked by moderation:', mod.reason); return; }
  }

  const bottle = {
    id: genId('bottle'),
    content,
    authorId: bot.userId,
    authorGender: '',               // bot label handled on frontend
    anonymous: false,
    status: 'displaying',
    deleted: false,
    replies: [],
    authorAccountType: 'BOT',
    createdAt: Date.now()
  };
  db().bottles.push(bottle);
  save();
  recordBotActivity(bot.botId, 'post');
}

function postIntervalMs() {
  return ((config().bot_public_post_interval_minutes || 20) * 60 * 1000);
}

function startProactivePosts() {
  stopProactivePosts();
  const tick = () => {
    runProactivePost().catch(e => console.error('[BotEngine] post error', e));
    postTimer = setTimeout(tick, postIntervalMs());
  };
  postTimer = setTimeout(tick, postIntervalMs());
}

function stopProactivePosts() {
  if (postTimer) { clearTimeout(postTimer); postTimer = null; }
}

function getBotStats() {
  const profiles = getBotProfiles();
  const enabled = profiles.filter(b => b.enabled).length;
  const postsToday = profiles.reduce((s, b) => s + (b.dailyPosts || 0), 0);
  const repliesToday = profiles.reduce((s, b) => s + (b.dailyReplies || 0), 0);
  return {
    total: profiles.length,
    enabled,
    postsToday,
    repliesToday,
    csi: computeCSI().csi
  };
}

async function init() {
  try {
    seedBotsIfNeeded();
  } catch (e) {
    console.error('[BotEngine] seed error', e);
  }
  startProactivePosts();
  console.log(`[BotEngine] initialized; bot profiles = ${getBotProfiles().length}`);
}

module.exports = {
  init,
  scheduleBottleReply,
  runProactivePost,
  computeCSI,
  getBotStats,
  startProactivePosts,
  stopProactivePosts
};
