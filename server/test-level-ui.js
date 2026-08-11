const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist in index.html`);
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = bodyStart; i < html.length; i++) {
    const ch = html[i];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function extractPage(id) {
  const open = new RegExp(`<div\\b[^>]*id="${id}"[^>]*>`).exec(html);
  assert.ok(open, `${id} must exist`);
  const token = /<div\b[^>]*>|<\/div>/g;
  token.lastIndex = open.index;
  let depth = 0;
  let match;
  while ((match = token.exec(html))) {
    if (match[0].startsWith('</')) depth--;
    else depth++;
    if (depth === 0) return html.slice(open.index, token.lastIndex);
  }
  throw new Error(`unterminated page ${id}`);
}

const modalCalls = [];
const context = {
  window: {},
  showModal: (...args) => modalCalls.push(args),
  escapeHtml: value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
};
vm.createContext(context);
vm.runInContext(extractFunction('renderLevelProgress'), context);
vm.runInContext(extractFunction('handleExperienceAward'), context);

const regular = context.renderLevelProgress({
  level: 3, title: '漂流者', exp: 80, nextExp: 120, progress: 33
});
assert.match(regular, /Lv\.3/);
assert.match(regular, /漂流者/);
assert.match(regular, /80\s*\/\s*120/);
assert.match(regular, /width:\s*33%/);

const maxed = context.renderLevelProgress({
  level: 10, title: '漂屿传说', exp: 1600, nextExp: null, progress: 100
});
assert.match(maxed, /已满级/);
assert.doesNotMatch(maxed, /null/);

const fallback = context.renderLevelProgress(null);
assert.match(fallback, /Lv\.1/);
assert.match(fallback, /0\s*\/\s*20/);

context.handleExperienceAward({ awarded: 3, leveledUp: false });
assert.equal(modalCalls.length, 0, 'ordinary experience awards do not interrupt the user');
const upgrade = {
  awarded: 10,
  leveledUp: true,
  event: { id: 'xp-upgrade-1' },
  level: { level: 2, title: '拾贝者' }
};
context.handleExperienceAward(upgrade);
assert.equal(modalCalls.length, 1, 'a level upgrade displays one celebration');
assert.match(modalCalls[0].join(' '), /Lv\.2/);
context.handleExperienceAward(upgrade);
assert.equal(modalCalls.length, 1, 'the same event never displays twice');

const levelPage = extractPage('page-level-detail');
assert.match(levelPage, /data-scroll-root/, 'level detail page owns a scroll root');
assert.match(levelPage, /id="levelDetailContent"/, 'level detail has a render target');
assert.doesNotMatch(html, /momentCount\s*\|\|\s*0\)\s*\/\s*5/, 'the frontend must not calculate its own level');

console.log('level UI: all assertions passed');
