const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('user UI exposes the approved warm island theme and resonance navigation', () => {
  const normalized = html.toLowerCase().replace(/\s+/g, '');
  for (const token of ['--island-primary:#1f7a74', '--island-accent:#ef7b62', '--island-bg:#f7f3ea']) {
    assert.ok(normalized.includes(token), `missing ${token}`);
  }
  assert.ok(!normalized.includes('--dream-primary'), 'purple dream theme must be fully retired');
  assert.match(html, /共鸣广场/);
  assert.match(html, /communityInterestChips/);
  assert.match(html, /communityDailyPrompt/);
  assert.match(extractFunction(html, 'renderTabBar'), /label:\s*'共鸣'/);
});

function extractFunction(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `index.html must define ${name}()`);
  const declarationStart = source.slice(Math.max(0, match.index - 6), match.index) === 'async '
    ? match.index - 6
    : match.index;
  const bodyStart = source.indexOf('{', match.index);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(declarationStart, index + 1);
  }
  throw new Error(`Unable to extract ${name}() from index.html`);
}

function createPage(id, roots = []) {
  const active = new Set();
  return {
    id,
    scrollTop: 0,
    classList: {
      add(name) { active.add(name); },
      remove(name) { active.delete(name); },
      contains(name) { return active.has(name); },
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-scroll-root]');
      return roots;
    },
  };
}

function runFunctions({ visualViewport, innerHeight = 800, pages = [] } = {}) {
  const styleValues = new Map();
  const windowListeners = [];
  const viewportListeners = [];
  const scrollCalls = [];
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const context = {
    window: {
      innerHeight,
      visualViewport: visualViewport === undefined ? undefined : {
        height: visualViewport,
        addEventListener(type, listener) { viewportListeners.push([type, listener]); },
      },
      addEventListener(type, listener) { windowListeners.push([type, listener]); },
      scrollTo(...args) { scrollCalls.push(args); },
    },
    document: {
      documentElement: { style: { setProperty(name, value) { styleValues.set(name, value); } } },
      getElementById(id) { return pageById.get(id) || null; },
      querySelectorAll(selector) {
        assert.equal(selector, '.page');
        return pages;
      },
    },
    onPageEnter() {},
  };
  context.$ = (id) => context.document.getElementById(id);
  vm.createContext(context);
  vm.runInContext('var currentPage = null; var navStack = [];', context);
  for (const name of ['syncAppViewport', 'resetPageScroll', 'navigateTo']) {
    vm.runInContext(extractFunction(html, name), context);
  }
  return { context, scrollCalls, styleValues, viewportListeners, windowListeners };
}

function runGenderIcon() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'genderIcon'), context);
  return context.genderIcon;
}

function renderMomentCard(authorId) {
  const context = {
    window: { _momentCache: {} },
    currentUser: { id: 'me' },
    genderIcon: () => '<svg class="gender-icon"></svg>',
    verifiedBadgeHtml: () => '',
    levelBadgeHtml: () => '<span class="level-badge">Lv.2</span>',
    escapeHtml: value => String(value),
    avatarMarkup: () => '<div class="moment-avatar"></div>',
    avatarColor: () => '#17857e',
    formatTime: () => '刚刚',
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'momentCardHtml'), context);
  return context.momentCardHtml({
    id: 'moment-1',
    content: '动态内容',
    images: [],
    comments: [],
    likedByMe: false,
    likeCount: 0,
    commentCount: 0,
    createdAt: Date.now(),
    author: { id: authorId, nickname: '用户', gender: 'male', level: 2, following: false },
  });
}

function pageMarkup(id) {
  const openTag = new RegExp(`<div\\b[^>]*\\bid="page-${id}"[^>]*>`).exec(html);
  assert.ok(openTag, `page-${id} must be a page div`);
  const start = openTag.index;
  const firstTagEnd = start + openTag[0].length - 1;
  const firstTag = openTag[0];
  let depth = 0;
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return { firstTag, innerHtml: html.slice(firstTagEnd + 1, match.index) };
  }
  throw new Error(`page-${id} is not closed`);
}

test('syncAppViewport uses the rounded visual viewport height and falls back to innerHeight', () => {
  const visual = runFunctions({ visualViewport: 667.6 });
  visual.context.syncAppViewport();
  assert.equal(visual.styleValues.get('--app-height'), '668px');

  const fallback = runFunctions({ visualViewport: undefined, innerHeight: 731.2 });
  fallback.context.syncAppViewport();
  assert.equal(fallback.styleValues.get('--app-height'), '731px');
});

test('syncAppViewport preserves the stable app height while the iOS keyboard is open', () => {
  const runtime = runFunctions({ visualViewport: 760 });
  runtime.context.syncAppViewport();
  runtime.context.document.activeElement = { tagName: 'INPUT' };
  runtime.context.window.visualViewport.height = 430;
  runtime.context.syncAppViewport();

  assert.equal(runtime.styleValues.get('--app-height'), '760px');
  assert.equal(runtime.context.window.__appKeyboardOpen, true);
  assert.match(html, /html\.keyboard-open #app \.main-tab-page\.active>\.tab-bar\{display:none\}/);
  assert.match(extractFunction(html, 'keepInputAboveKeyboard'), /scrollRoot\.scrollTop/);
});

test('resetPageScroll clears the page and all nested scroll roots', () => {
  const roots = [{ scrollTop: 31 }, { scrollTop: 62 }];
  const page = createPage('page-lobby', roots);
  page.scrollTop = 93;
  const runtime = runFunctions({ pages: [page] });

  runtime.context.resetPageScroll(page);

  assert.equal(page.scrollTop, 0);
  assert.deepEqual(roots.map((root) => root.scrollTop), [0, 0]);
  assert.deepEqual(runtime.scrollCalls, [[0, 0]]);
});

test('navigateTo preserves stack and replace semantics before resetting after page entry', () => {
  const lobbyRoot = { scrollTop: 23 };
  const settingsRoot = { scrollTop: 31 };
  const home = createPage('page-home');
  const lobby = createPage('page-lobby', [lobbyRoot]);
  const settings = createPage('page-settings', [settingsRoot]);
  const runtime = runFunctions({ pages: [home, lobby, settings] });
  vm.runInContext("currentPage = 'home';", runtime.context);
  const entries = [];
  runtime.context.onPageEnter = (pageId) => {
    entries.push(pageId);
    if (pageId === 'lobby') { lobby.scrollTop = 101; lobbyRoot.scrollTop = 102; }
    if (pageId === 'settings') { settings.scrollTop = 201; settingsRoot.scrollTop = 202; }
  };

  runtime.context.navigateTo('lobby', false);
  assert.equal(vm.runInContext('JSON.stringify(navStack)', runtime.context), '["home"]');
  assert.equal(lobby.classList.contains('active'), true);
  assert.equal(lobby.scrollTop, 0);
  assert.equal(lobbyRoot.scrollTop, 0);

  runtime.context.navigateTo('settings', true);
  assert.equal(vm.runInContext('JSON.stringify(navStack)', runtime.context), '[]');
  assert.equal(vm.runInContext('currentPage', runtime.context), 'settings');
  assert.equal(settings.scrollTop, 0);
  assert.equal(settingsRoot.scrollTop, 0);
  assert.deepEqual(entries, ['lobby', 'settings']);
});

test('each main tab page has one dedicated scroll root', () => {
  for (const id of ['home', 'lobby', 'community', 'messages', 'settings']) {
    const { firstTag, innerHtml } = pageMarkup(id);
    assert.match(firstTag, /\bmain-tab-page\b/, `page-${id} must use main-tab-page`);
    assert.equal((innerHtml.match(/\bdata-scroll-root\b/g) || []).length, 1, `page-${id} must have one scroll root`);
  }
});

test('lobby renders the shared five-item bottom navigation', async () => {
  const { innerHtml } = pageMarkup('lobby');
  assert.match(innerHtml, /class="tab-bar"[^>]*id="tabbar-lobby"/, 'lobby must own its tab-bar container');

  const elements = {
    'lobbyList': { innerHTML: '' },
    'lobbyCoins': { textContent: '' },
    'tabbar-lobby': { innerHTML: '' },
  };
  const context = {
    window: { unreadTotal: 2 },
    lobbyFilter: 'all',
    currentUser: { id: 'u-1', coins: 12 },
    document: { getElementById: id => elements[id] || null },
    api: async () => ({ success: true, bottles: [] }),
  };
  context.$ = id => context.document.getElementById(id);
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'renderTabBar'), context);
  vm.runInContext(extractFunction(html, 'renderLobby'), context);
  await context.renderLobby();

  const tabItems = elements['tabbar-lobby'].innerHTML.match(/class="tab-item/g) || [];
  assert.equal(tabItems.length, 5, 'lobby bottom navigation must contain five destinations');
  assert.match(elements['tabbar-lobby'].innerHTML, /tab-item active[^>]*onclick="navigate\('lobby'\)"/, 'lobby tab must be active');
});

test('logout action lives in settings immediately before account deletion', () => {
  const home = pageMarkup('home').innerHtml;
  assert.doesNotMatch(home, /logoutBtn|退出登录/, 'home must not show logout');

  const settingsRenderer = extractFunction(html, 'renderSettings');
  const logoutIndex = settingsRenderer.indexOf('onclick="confirmLogout()"');
  const deleteIndex = settingsRenderer.indexOf("onclick=\"navigate('account-delete')\"");
  assert.ok(logoutIndex >= 0, 'settings must render the logout action');
  assert.ok(deleteIndex > logoutIndex, 'logout must appear immediately before account deletion');

  const between = settingsRenderer.slice(logoutIndex, deleteIndex);
  assert.equal((between.match(/class="settings-item"/g) || []).length, 1, 'no other settings item may separate logout and account deletion');
});

test('community following tab loads data instead of rendering a hard-coded empty state', () => {
  const renderer = extractFunction(html, 'renderCommunityFeed');
  assert.doesNotMatch(renderer, /if\s*\(sort\s*===\s*['"]following['"]\)/,
    'following tab must use the community API like other tabs');
  assert.match(renderer, /window\._communitySort\s*=\s*sort/);
  assert.match(renderer, /loadMoreCommunity\(true\)/);
});

test('community follow controls keep compact component classes and synchronize duplicate cards', () => {
  const toggle = extractFunction(html, 'toggleFollowUser');
  assert.doesNotMatch(toggle, /primary-button|ghost-button/,
    'card follow controls must not inherit full-size global button styles');
  assert.match(toggle, /updateFollowButtons\(userId,\s*res\.following\)/,
    'all visible cards for the same user must be synchronized');

  const card = extractFunction(html, 'momentCardHtml');
  assert.match(card, /moment-head-actions/, 'card actions must live in a dedicated compact group');
  assert.match(card, /author\.following/, 'initial follow state must come from the API');
});

test('moment identity stays beside the avatar and self delete moves into a bottom overflow menu', () => {
  const nameRule = /\.moment-name\{([^}]*)\}/.exec(html);
  assert.ok(nameRule, 'moment name style must exist');
  assert.match(nameRule[1], /flex:\s*0\s+1\s+auto/, 'nickname must not push identity badges toward action buttons');

  const selfCard = renderMomentCard('me');
  const header = selfCard.slice(selfCard.indexOf('<div class="moment-head">'), selfCard.indexOf('<div class="moment-actions">'));
  assert.doesNotMatch(header, />删除</, 'self card header must not contain delete');
  assert.match(selfCard, /class="moment-more-btn"/, 'self card must expose a three-dot button at the bottom right');
  assert.match(selfCard, /class="moment-overflow-menu"/, 'three-dot button must own a compact overflow menu');
  assert.match(selfCard, /class="moment-menu-delete"[^>]*>删除</, 'overflow menu must contain delete');

  const otherCard = renderMomentCard('other');
  assert.match(otherCard, /moment-chat-action[^>]*[\s\S]*聊聊/, 'other users enter chat through a contextual starter');
  assert.match(otherCard, /moment-follow-btn/, 'other users retain follow');
  assert.match(otherCard, /moment-more-btn/, 'other users expose content-safety actions');
  assert.match(otherCard, /不感兴趣[\s\S]*举报[\s\S]*拉黑/, 'other overflow contains dismiss, report and block');
  assert.doesNotMatch(otherCard, /moment-menu-delete/, 'delete remains author-only');
});

test('moment overflow menu opens one card at a time and toggles closed', () => {
  const makeMenu = id => {
    const active = new Set();
    return {
      id,
      classList: {
        add: name => active.add(name),
        remove: name => active.delete(name),
        contains: name => active.has(name),
      },
    };
  };
  const first = makeMenu('moment-menu-first');
  const second = makeMenu('moment-menu-second');
  second.classList.add('open');
  const context = {
    document: { querySelectorAll: () => [first, second] },
    $: id => ({ 'moment-menu-first': first, 'moment-menu-second': second })[id] || null,
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'closeMomentMenus'), context);
  vm.runInContext(extractFunction(html, 'toggleMomentMenu'), context);

  let stopped = false;
  context.toggleMomentMenu('first', { stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true, 'three-dot click must not bubble to the document closer');
  assert.equal(first.classList.contains('open'), true);
  assert.equal(second.classList.contains('open'), false, 'opening one menu closes the previous one');

  context.toggleMomentMenu('first', { stopPropagation() {} });
  assert.equal(first.classList.contains('open'), false, 'clicking the same three dots toggles it closed');
});

test('genderIcon renders accessible inline SVGs for both genders and supported sizes', () => {
  const genderIcon = runGenderIcon();
  const cases = [
    ['male', 'sm', '男生'],
    ['male', 'lg', '男生'],
    ['female', 'sm', '女生'],
    ['female', 'lg', '女生'],
  ];

  for (const [gender, variant, label] of cases) {
    const markup = genderIcon(gender, variant);
    assert.match(markup, /<svg\b/, `${gender} must render inline SVG`);
    assert.match(markup, new RegExp(`aria-label="${label}"`), `${gender} must have a Chinese accessible label`);
    assert.match(markup, new RegExp(`gender-icon--${gender}`), `${gender} must retain its color class`);
    assert.match(markup, new RegExp(`gender-icon--${variant}`), `${variant} must select its size class`);
  }
});

test('genderIcon normalizes valid input and returns nothing for invalid values', () => {
  const genderIcon = runGenderIcon();

  assert.match(genderIcon(' FEMALE '), /gender-icon--female/);
  assert.equal(genderIcon(), '');
  assert.equal(genderIcon('unknown'), '');
  assert.equal(genderIcon('<img src=x onerror=alert(1)>'), '');
  assert.equal(genderIcon('male', 'xl'), '');
});

test('the user frontend no longer uses Unicode gender symbols', () => {
  assert.doesNotMatch(html, /[\u2642\u2640]/);
});

test('community comments support explicit replies and preserve the reply target in the request', () => {
  assert.match(extractFunction(html, 'momentCardHtml'), /prepareMomentReply/);
  assert.match(extractFunction(html, 'prepareMomentReply'), /parentCommentId/);
  assert.match(extractFunction(html, 'addMomentComment'), /parentCommentId/);
  assert.match(extractFunction(html, 'cancelMomentReply'), /delete window\._commentReplyTargets/);
});

test('comment rows are the reply trigger and outside taps cancel without extra reply controls', () => {
  const card = extractFunction(html, 'momentCardHtml');
  assert.match(card, /prepareMomentReply\([^)]*,this\)/);
  assert.doesNotMatch(card, /mc-reply-action|取消回复|moment-replying/);
  assert.match(extractFunction(html, 'prepareMomentReply'), /reply-selected/);
  assert.match(extractFunction(html, 'handleMomentReplyOutsideClick'), /cancelAllMomentReplies/);
});
