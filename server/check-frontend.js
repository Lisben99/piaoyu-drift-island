/**
 * Syntax-check inline <script> blocks of the frontend HTML files.
 * Uses `new Function` to parse (no execution) so browser globals are fine.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = ['index.html', 'admin.html'];

let problems = 0;
for (const f of files) {
  const html = fs.readFileSync(path.join(root, f), 'utf-8');
  // Match <script ...>...</script> that have no src attribute
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, idx = 0;
  while ((m = re.exec(html)) !== null) {
    idx++;
    const code = m[1];
    try {
      new Function(code);
      console.log(`✅ ${f} inline script #${idx}: syntax OK (${code.length} chars)`);
    } catch (e) {
      problems++;
      console.error(`❌ ${f} inline script #${idx}: ${e.message}`);
    }
  }
  if (idx === 0) console.log(`ℹ️  ${f}: no inline script found`);
}
process.exit(problems ? 1 : 0);
