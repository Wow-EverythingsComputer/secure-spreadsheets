#!/usr/bin/env node
/*
 * Bump the plugin version EVERYWHERE it lives, in one shot:
 *   - docs/ext.json                "version" (what SN uses to offer the update)
 *   - docs/enhanced.js             VERSION (shown in the ⚙ panel + console)
 *   - docs/enhanced-preinit.js     __sePreinitVersion (stale-cache mismatch detector)
 *   - docs/index.html + docs/v2/index.html   ?v= cache-busters on both scripts
 * and re-syncs docs/enhanced*.js -> docs/v2/ (the live deployed copies).
 *
 * Usage: node bump-version.js 1.6.7
 */
const fs = require('fs');
const path = require('path');

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) {
  console.error('usage: node bump-version.js <x.y.z>');
  process.exit(1);
}

const root = __dirname;
function sub(file, re, repl) {
  const p = path.join(root, file);
  const s = fs.readFileSync(p, 'utf8');
  if (!re.test(s)) {
    console.error('ERROR: no match in ' + file + ' for ' + re);
    process.exit(1);
  }
  fs.writeFileSync(p, s.replace(re, repl));
  console.log('  bumped ' + file);
}

sub('docs/ext.json', /"version": "[^"]+"/, '"version": "' + v + '"');
sub('docs/enhanced.js', /var VERSION = "[^"]+"/, 'var VERSION = "' + v + '"');
sub('docs/enhanced-preinit.js', /__sePreinitVersion = "[^"]+"/, '__sePreinitVersion = "' + v + '"');
for (const f of ['docs/index.html', 'docs/v2/index.html']) {
  sub(f, /enhanced-preinit\.js\?v=[^"]+/, 'enhanced-preinit.js?v=' + v);
  sub(f, /enhanced\.js\?v=[^"]+/, 'enhanced.js?v=' + v);
}

// keep the deployed copies identical to the source copies
for (const f of ['enhanced.js', 'enhanced-preinit.js']) {
  fs.copyFileSync(path.join(root, 'docs', f), path.join(root, 'docs/v2', f));
  console.log('  synced docs/' + f + ' -> docs/v2/' + f);
}
console.log('done: v' + v + ' — commit + push to deploy');
