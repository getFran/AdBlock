#!/usr/bin/env node
// Loads dist/ in Playwright's Chromium and checks what a build must have before it is zipped: the manifest and its
// permissions, the registered content scripts, the update-check alarm and its stored result, and three pages without
// extension errors. Works on both builds and tells them apart by the manifest:
//   npm run build && node test/smoke.mjs            npm run build:release && node test/smoke.mjs
// --headed shows the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
const release = !manifest.permissions.includes('downloads');
const headed = process.argv.includes('--headed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ': ' + detail : ''));
  if (!ok) failed++;
};

console.log(`smoke: ${release ? 'release' : 'development'} build ${manifest.version} (${DIST})`);
const profiles = path.join(ROOT, 'test', 'profiles');
const userDataDir = path.join(profiles, `smoke-${Date.now()}`);
fs.mkdirSync(userDataDir, { recursive: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !headed,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--mute-audio'],
});
try {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
  check('service worker started', !!sw);
  if (!sw) process.exit(1);
  await sleep(4000); // onInstalled: content scripts, alarm, the first update check

  const info = await sw.evaluate(async () => ({
    version: chrome.runtime.getManifest().version,
    permissions: chrome.runtime.getManifest().permissions,
    scripts: (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort(),
    alarms: (await chrome.alarms.getAll()).map((a) => a.name),
    update: (await chrome.storage.local.get('update')).update || null,
    disabled: (await chrome.storage.local.get('disabledSites')).disabledSites,
    rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
    diagnostics: typeof globalThis.__adblock !== 'undefined',
  }));
  const wantScripts = release ? ['cosmetic', 'twitch', 'youtube'] : ['bridge', 'cosmetic', 'twitch', 'youtube'];
  const devOnly = ['downloads', 'declarativeNetRequestFeedback'];
  check('version', info.version === manifest.version, info.version);
  check(
    'permissions',
    JSON.stringify(info.permissions) === JSON.stringify(manifest.permissions) && info.permissions.includes('alarms') && devOnly.every((p) => info.permissions.includes(p) !== release),
    info.permissions.join(', '),
  );
  check('content scripts', JSON.stringify(info.scripts) === JSON.stringify(wantScripts), info.scripts.join(', '));
  check('update alarm', info.alarms.includes('update-check'), info.alarms.join(', ') || 'none');
  check('rulesets enabled', info.rulesets.length === manifest.declarative_net_request.rule_resources.length, `${info.rulesets.length} of ${manifest.declarative_net_request.rule_resources.length}`);
  check('diagnostics ' + (release ? 'absent' : 'present'), info.diagnostics === !release);
  check('default switched-off sites', JSON.stringify(info.disabled) === JSON.stringify(release ? [] : ['getfran.dev']), JSON.stringify(info.disabled));
  check('update check ran', !!(info.update && info.update.checkedAt), info.update ? `latest=${info.update.latest} available=${info.update.available} error=${info.update.error}` : 'no state');

  const errors = [];
  context.on('weberror', (e) => errors.push(e.error().message));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://example.com/', { waitUntil: 'load', timeout: 30000 }).catch((e) => errors.push('example.com: ' + e.message));
  const twitchGlobal = await page
    .goto('https://www.twitch.tv/directory', { waitUntil: 'domcontentloaded', timeout: 45000 })
    .then(() => page.evaluate(() => typeof window.__adblockTwitch))
    .catch((e) => 'unreachable: ' + e.message);
  const youtubeGlobal = await page
    .goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    .then(() => page.evaluate(() => typeof window.__adblockYoutube))
    .catch((e) => 'unreachable: ' + e.message);
  const ownErrors = errors.filter((m) => /adblock|chrome-extension/i.test(m));
  check('no extension errors on the pages', ownErrors.length === 0, ownErrors.join(' | ') || `${errors.length} page error(s), none ours`);
  if (!String(twitchGlobal).startsWith('unreachable')) check('twitch.tv global ' + (release ? 'absent' : 'present'), twitchGlobal === (release ? 'undefined' : 'object'), twitchGlobal);
  else console.log('skip twitch.tv: ' + twitchGlobal);
  if (!String(youtubeGlobal).startsWith('unreachable')) check('youtube.com global ' + (release ? 'absent' : 'present'), youtubeGlobal === (release ? 'undefined' : 'object'), youtubeGlobal);
  else console.log('skip youtube.com: ' + youtubeGlobal);
} finally {
  await context.close().catch(() => {});
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
