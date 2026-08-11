const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `index.html must define ${name}()`);
  const bodyStart = source.indexOf('{', match.index);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
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
