#!/usr/bin/env node
// Build of the extension: node build.mjs            -> dist/ (load it unpacked in chrome://extensions)
//                         node build.mjs --release  -> dist/ for a GitHub release: no records, no diagnostics, no console,
//                                                      no globals on the pages, no downloads/feedback permissions
//                         node build.mjs --vendor   -> refresh vendor/ (uAssets quick-fixes, AdGuard Base's YouTube rules)
// EXT_VERSION=1.2.3 overrides the version of package.json (the release workflow builds the version of the tag).
//
// The extension is a shell: nothing here decides what is an ad. The build takes
//   - DNR rulesets and filter texts from @adguard/dnr-rulesets (the package version is the filter snapshot,
//     except for the YouTube rules, which come from a vendored snapshot of the live AdGuard Base filter),
//   - scriptlet implementations from @adguard/scriptlets,
//   - YouTube arguments from AdGuard Base and from uBlock Origin's quick-fixes.txt (vendored snapshot),
// and compiles them into static assets plus four small runtimes under src/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { scriptlets } from '@adguard/scriptlets';
import { convertUboToAdg } from '@adguard/scriptlets/converters';
import { isValidScriptletName } from '@adguard/scriptlets/validators';
import config from './build.config.mjs';
import { bucketKey, bucketOf } from './src/lib/hash.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const GEN = path.join(ROOT, '.cache', 'gen');
const PKG_DIR = path.join(ROOT, 'node_modules', '@adguard', 'dnr-rulesets', 'dist', 'filters', 'chromium-mv3', 'declarative');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const PKG_VERSION = readJson(path.join(ROOT, 'node_modules', '@adguard', 'dnr-rulesets', 'package.json')).version;
const SCRIPTLETS_VERSION = readJson(path.join(ROOT, 'node_modules', '@adguard', 'scriptlets', 'package.json')).version;
const RELEASE = process.argv.includes('--release');
const EXT_VERSION = process.env.EXT_VERSION || readJson(path.join(ROOT, 'package.json')).version;
if (!/^\d+(\.\d+){1,3}$/.test(EXT_VERSION)) throw new Error(`EXT_VERSION "${EXT_VERSION}" is not a Chrome extension version (1 to 4 dot-separated integers)`);
// what every bundle sees: the kind of build, the version and the GitHub repo whose releases the update check reads
const DEFINE = { __RELEASE__: String(RELEASE), __EXT_VERSION__: JSON.stringify(EXT_VERSION), __REPO__: JSON.stringify(config.release.repo) };
const TARGET = 'chrome128';

const log = (...args) => console.log('[build]', ...args);
const warn = (...args) => console.warn('[build] WARNING:', ...args);

// ---------------------------------------------------------------------------------------------------------
// AdGuard rulesets: each ruleset_<id>.json starts with a metadata rule (a dummy block of dummy.rule.adguard.com)
// that carries the original filter text, the hash map and the source map. The DNR rules go to dist/ as they
// are, without that rule; the filter text feeds the cosmetic and YouTube builds.

const rulesetCache = new Map();
function readRuleset(id) {
  if (rulesetCache.has(id)) return rulesetCache.get(id);
  const file = path.join(PKG_DIR, `ruleset_${id}`, `ruleset_${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`ruleset_${id} is not in @adguard/dnr-rulesets ${PKG_VERSION}`);
  const rules = readJson(file);
  const first = rules[0];
  const isMeta = first && first.metadata && first.condition && first.condition.urlFilter === 'dummy.rule.adguard.com';
  const out = {
    id,
    rules: isMeta ? rules.slice(1) : rules,
    filterText: isMeta ? String(first.metadata.filterContent || '').replace(/\r/g, '') : '',
    regexCount: isMeta ? first.metadata.metadata.regexpRulesCount : 0,
  };
  if (id === config.youtube.adguardRuleset) out.filterText = overlayYoutube(out.filterText);
  rulesetCache.set(id, out);
  return out;
}

// A cosmetic or JS rule (##, #@#, #$#, #?#, #%#, #@%#...) whose domain list names one of the hosts, with or without
// a [$modifier] prefix. Network rules never match: those come precompiled as DNR rules and are left alone.
function isRuleFor(line, hosts) {
  if (!line || line[0] === '!') return false; // a commented-out rule is a comment
  const m = /^(?:\[\$[^\]]*\])?([^#\s]*)#[@%$?]*#/.exec(line);
  if (!m) return false;
  const { include, exclude } = splitDomains(m[1]);
  return onHosts([...include, ...exclude], hosts);
}

// The npm package lags AdGuard's filter by weeks and the YouTube rules move every few days, so the YouTube lines of
// AdGuard Base come from vendor/adguard-base-youtube.txt (a snapshot of the live filter, `npm run vendor`) instead of
// the package's text: every cosmetic and JS rule naming a YouTube host is swapped, exceptions included.
function overlayYoutube(filterText) {
  const { snapshot } = config.youtube.adguardLive;
  const file = path.join(ROOT, snapshot);
  if (!fs.existsSync(file)) throw new Error(`${snapshot} is missing: run "npm run vendor"`);
  const hosts = config.youtube.hosts;
  const text = fs.readFileSync(file, 'utf8');
  const updated = (/^! .*updated ([^,)]+)/m.exec(text) || [])[1] || '?';
  const live = text.split('\n').map((l) => l.trim()).filter((l) => l && l[0] !== '!');
  const kept = [];
  const removed = new Set();
  for (const raw of filterText.split('\n')) {
    if (isRuleFor(raw.trim(), hosts)) removed.add(raw.trim());
    else kept.push(raw);
  }
  const changed = live.filter((l) => !removed.has(l)).length + [...removed].filter((l) => !live.includes(l)).length;
  log(`adguard: ${removed.size} YouTube rules of the npm package swapped for ${live.length} of the live filter (${updated}, ${snapshot}): ${changed} lines differ`);
  return kept.join('\n') + '\n' + live.join('\n') + '\n';
}

function filterNames() {
  const meta = readJson(path.join(PKG_DIR, 'ruleset_0', 'ruleset_0.json'));
  const names = {};
  for (const f of meta[0].metadata.additionalProperties.metadata.filters) names[f.filterId] = f.name;
  return names;
}

function buildRulesets() {
  const names = filterNames();
  fs.mkdirSync(path.join(DIST, 'rulesets'), { recursive: true });
  const resources = [];
  let total = 0;
  let regex = 0;
  for (const id of config.rulesets.enabled) {
    const rs = readRuleset(id);
    fs.writeFileSync(path.join(DIST, 'rulesets', `ruleset_${id}.json`), JSON.stringify(rs.rules));
    resources.push({ id: `ruleset_${id}`, enabled: true, path: `rulesets/ruleset_${id}.json` });
    total += rs.rules.length;
    regex += rs.regexCount;
    log(`ruleset_${id} ${names[id] || ''}: ${rs.rules.length} rules, ${rs.regexCount} regex`);
  }
  log(`DNR total: ${total} rules, ${regex} regex (Chrome: 30000 guaranteed + 300000 shared, 1000 regex)`);
  if (regex > 1000) throw new Error('more than 1000 regex rules: Chrome would refuse to enable the rulesets');
  return resources;
}

// ---------------------------------------------------------------------------------------------------------
// Cosmetic rules -> CSS. Element hiding (domains##selector), exceptions (domains#@#selector) and CSS injection
// (domains#$#selector { css }). Extended CSS (#?#, :contains(), :upward()...) is not supported yet and is skipped.

const EXT_PSEUDO = /:(?:contains|-abp-[a-z]+|upward|matches-css(?:-before|-after)?|xpath|nth-ancestor|remove|has-text|min-text-length|matches-attr|matches-path|matches-prop|others|watch-attr|if|if-not|style|remove-attr|remove-class|matches-media)\(/;
const PLAIN_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const WILD_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.\*$/;

function cosmeticAccumulator() {
  return {
    generic: new Set(),
    genericExceptAll: new Set(),
    entries: new Map(), // domain -> { h: [selector | {s, x}], c: [css rule], e: [exception selector] }
    wild: new Map(), // same, for "domain.*" wildcard-TLD domains (evaluated at runtime on every page)
    stats: { hide: 0, css: 0, except: 0, skippedExt: 0, skippedDomain: 0, skippedGenericCss: 0 },
  };
}

function entryFor(acc, domain) {
  const map = PLAIN_DOMAIN.test(domain) ? acc.entries : WILD_DOMAIN.test(domain) ? acc.wild : null;
  if (!map) {
    acc.stats.skippedDomain++;
    return null;
  }
  if (!map.has(domain)) map.set(domain, { h: [], c: [], e: [] });
  return map.get(domain);
}

function parseCosmetic(filterText, acc) {
  for (const raw of filterText.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '!' || line[0] === '[') continue;
    if (line.includes('#%#') || line.includes('#@%#')) continue; // scriptlets and JS rules: see buildYoutube
    const m = /^([^#]*)#(@?)(\$\??|\?|)#(.+)$/.exec(line);
    if (!m) continue;
    const [, domainPart, exc, kind, body] = m;
    if (kind === '?' || kind === '$?') {
      acc.stats.skippedExt++;
      continue;
    }
    const selector = body.trim();
    if (EXT_PSEUDO.test(selector) || selector.includes('[-ext-') || /\bremove\s*:/.test(selector)) {
      acc.stats.skippedExt++;
      continue;
    }
    const isCss = kind === '$';
    const domains = domainPart ? domainPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
    const include = domains.filter((d) => !d.startsWith('~'));
    const exclude = domains.filter((d) => d.startsWith('~')).map((d) => d.slice(1));

    if (exc === '@') {
      if (!include.length) acc.genericExceptAll.add(selector);
      else for (const d of include) entryFor(acc, d)?.e.push(selector);
      acc.stats.except++;
      continue;
    }
    if (!include.length) {
      if (isCss) {
        acc.stats.skippedGenericCss++;
        continue;
      }
      acc.generic.add(selector);
      for (const d of exclude) entryFor(acc, d)?.e.push(selector); // "~example.com##sel": everywhere but there
      acc.stats.hide++;
      continue;
    }
    for (const d of include) {
      const entry = entryFor(acc, d);
      if (!entry) continue;
      if (isCss) entry.c.push(selector);
      else entry.h.push(exclude.length ? { s: selector, x: exclude } : selector);
    }
    acc.stats[isCss ? 'css' : 'hide']++;
  }
}

function dedupeEntry(entry) {
  const seen = new Set();
  entry.h = entry.h.filter((item) => {
    const key = typeof item === 'string' ? item : item.s + '|' + item.x.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  entry.c = [...new Set(entry.c)];
  entry.e = [...new Set(entry.e)];
  if (!entry.c.length) delete entry.c;
  if (!entry.e.length) delete entry.e;
  if (!entry.h.length) delete entry.h;
  return entry;
}

// uBlock Origin's quick fixes carry plain cosmetic rules for YouTube that no AdGuard list has: the "ad blockers violate
// YouTube's Terms of Service" snackbar (bottom left, since 2026-10-15) and the older toast. Only the YouTube hosts' lines
// come in; parseCosmetic drops what is uBO-only (##^script…:has-text()).
function uassetsYoutubeCosmetic() {
  const file = path.join(ROOT, config.youtube.uassets.snapshot);
  if (!fs.existsSync(file)) throw new Error(`${config.youtube.uassets.snapshot} is missing: run "npm run vendor"`);
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l[0] !== '!' && !l.includes('##+js(') && isRuleFor(l, config.youtube.hosts))
    .join('\n');
}

function buildCosmetic() {
  const acc = cosmeticAccumulator();
  for (const id of config.cosmetic.from) parseCosmetic(readRuleset(id).filterText, acc);
  const before = { ...acc.stats };
  parseCosmetic(uassetsYoutubeCosmetic(), acc);
  const s0 = acc.stats;
  log(`cosmetic: uassets YouTube rules: ${s0.hide - before.hide} hide, ${s0.css - before.css} css, ${s0.except - before.except} exceptions, ${s0.skippedExt - before.skippedExt} skipped (uBO-only)`);
  const before2 = { ...acc.stats };
  parseCosmetic(localFilterText(), acc);
  log(`cosmetic: local YouTube rules: ${acc.stats.hide - before2.hide} hide, ${acc.stats.css - before2.css} css`);
  for (const sel of acc.genericExceptAll) acc.generic.delete(sel);

  // Domain-specific rules go to cosmetic/bucket-N.json, N = hash of the domain's last two labels, so the
  // runtime fetches one small file per page. (Declaring one content script per bucket with the domains as
  // match patterns was tried first: ~53k patterns in the manifest kept Chromium from starting for minutes.)
  const buckets = Array.from({ length: config.cosmetic.buckets }, () => ({}));
  for (const [domain, entry] of acc.entries) buckets[bucketOf(bucketKey(domain), buckets.length)][domain] = dedupeEntry(entry);
  const wild = {};
  for (const [domain, entry] of acc.wild) wild[domain] = dedupeEntry(entry);

  fs.mkdirSync(GEN, { recursive: true });
  fs.mkdirSync(path.join(DIST, 'cosmetic'), { recursive: true });
  fs.writeFileSync(
    path.join(GEN, 'cosmetic-generic.js'),
    `// generated by build.mjs from @adguard/dnr-rulesets ${PKG_VERSION}\n` +
      `export const BUCKETS = ${buckets.length};\n` +
      `export const GENERIC = ${JSON.stringify([...acc.generic])};\n` +
      `export const WILD = ${JSON.stringify(wild)};\n`,
  );
  let largest = 0;
  buckets.forEach((data, i) => {
    const text = JSON.stringify(data);
    largest = Math.max(largest, text.length);
    fs.writeFileSync(path.join(DIST, 'cosmetic', `bucket-${i}.json`), text);
  });

  const s = acc.stats;
  log(
    `cosmetic: ${acc.generic.size} generic selectors, ${acc.entries.size} domains in ${buckets.length} buckets (largest ${Math.round(largest / 1024)} KB), ` +
      `${acc.wild.size} wildcard-TLD domains; rules: ${s.hide} hide, ${s.css} css, ${s.except} exceptions; ` +
      `skipped: ${s.skippedExt} extended-css, ${s.skippedGenericCss} generic css, ${s.skippedDomain} odd domains`,
  );
}

// ---------------------------------------------------------------------------------------------------------
// YouTube: scriptlet rules (domains#%#//scriptlet('name', 'arg'...)) and raw JS rules (domains#%#code) for the
// YouTube hosts, from AdGuard Base and from uAssets quick-fixes (uBO syntax, converted). Each becomes a
// function in .cache/gen/youtube-rules.js; src/youtube/main.js runs the ones whose domains match.

const UBO_ALIASES = { 'nano-stb': 'adjust-setTimeout', 'nano-setTimeout-booster': 'adjust-setTimeout', 'nano-sib': 'adjust-setInterval' };

function splitDomains(domainPart) {
  const domains = domainPart ? domainPart.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
  return { include: domains.filter((d) => !d.startsWith('~')), exclude: domains.filter((d) => d.startsWith('~')).map((d) => d.slice(1)) };
}

// Arguments of //scriptlet('a', 'b'): quoted with ' or ", comma separated; only \' (or \") is an escape.
function splitArgs(inner) {
  const out = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    const q = inner[i];
    if (q !== "'" && q !== '"') throw new Error(`unquoted scriptlet argument in: ${inner}`);
    i++;
    let s = '';
    while (i < inner.length && inner[i] !== q) {
      if (inner[i] === '\\' && inner[i + 1] === q) {
        s += q;
        i += 2;
      } else {
        s += inner[i++];
      }
    }
    i++;
    out.push(s);
  }
  return out;
}

function parseJsRule(rule) {
  const at = rule.indexOf('#%#');
  const { include, exclude } = splitDomains(rule.slice(0, at));
  const body = rule.slice(at + 3).trim();
  if (body.startsWith('//scriptlet(')) {
    const args = splitArgs(body.slice('//scriptlet('.length, body.lastIndexOf(')')));
    return { include, exclude, name: args[0], args: args.slice(1) };
  }
  return { include, exclude, js: body };
}

const onHosts = (domains, hosts) => domains.some((d) => hosts.some((h) => d === h || d.endsWith('.' + h)));

// The few lines of our own (build.config.mjs youtube.local), in AdGuard syntax, fed to the same pipelines as the lists.
const localFilterText = () => (config.youtube.local || []).join('\n');

function youtubeRulesFromAdguard(hosts) {
  const rules = [];
  const exceptions = []; // domains#@%#body disables the rule with the same body on those domains
  const texts = [
    { source: 'adguard', text: readRuleset(config.youtube.adguardRuleset).filterText },
    { source: 'local', text: localFilterText() },
  ];
  for (const { source, text } of texts) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line[0] === '!') continue;
      if (line.includes('#@%#')) {
        const at = line.indexOf('#@%#');
        const { include } = splitDomains(line.slice(0, at));
        if (onHosts(include, hosts)) exceptions.push({ include, body: line.slice(at + 4).trim() });
        continue;
      }
      if (!line.includes('#%#')) continue;
      const parsed = parseJsRule(line);
      if (!onHosts(parsed.include, hosts)) continue;
      rules.push({ ...parsed, body: line.slice(line.indexOf('#%#') + 3).trim(), source });
    }
  }
  const covered = (domain, exc) => exc.include.some((d) => domain === d || domain.endsWith('.' + d));
  return rules.filter((r) => {
    const matching = exceptions.filter((e) => e.body === r.body);
    if (!matching.length) return true;
    r.include = r.include.filter((d) => !matching.some((e) => covered(d, e)));
    if (!r.include.length) log(`adguard: rule disabled by its own exception: ${r.body.slice(0, 60)}…`);
    return r.include.length > 0;
  });
}

function youtubeRulesFromUassets(hosts) {
  const file = path.join(ROOT, config.youtube.uassets.snapshot);
  if (!fs.existsSync(file)) throw new Error(`${config.youtube.uassets.snapshot} is missing: run "npm run vendor"`);
  const rules = [];
  const dropped = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '!' || !line.includes('##+js(')) continue;
    const { include } = splitDomains(line.slice(0, line.indexOf('##+js(')));
    if (!onHosts(include, hosts)) continue;
    let converted;
    try {
      converted = convertUboToAdg(line);
    } catch (e) {
      dropped.push(`${line.slice(0, 60)}… (${e.message})`);
      continue;
    }
    for (const adg of converted) {
      const parsed = parseJsRule(adg);
      const name = UBO_ALIASES[parsed.name.replace(/^ubo-/, '')] || parsed.name.replace(/^ubo-/, '');
      if (!config.youtube.uassets.scriptlets.includes(name)) {
        dropped.push(`${name} (uBO-only or not allowed in build.config)`);
        continue;
      }
      rules.push({ ...parsed, name, source: 'uassets' });
    }
  }
  if (dropped.length) log(`uassets: dropped ${dropped.length} YouTube rules: ${[...new Set(dropped)].join('; ')}`);
  return rules;
}

function buildYoutube() {
  const hosts = config.youtube.hosts;
  const all = [...youtubeRulesFromAdguard(hosts), ...youtubeRulesFromUassets(hosts)];
  const byKey = new Map();
  for (const r of all) {
    const key = r.js ? 'js:' + r.js : r.name + JSON.stringify(r.args);
    if (byKey.has(key)) {
      const prev = byKey.get(key);
      prev.include = [...new Set([...prev.include, ...r.include])];
      continue;
    }
    byKey.set(key, r);
  }
  const out = [];
  for (const r of byKey.values()) {
    let code;
    let label;
    if (r.js) {
      code = r.js;
      label = 'js:' + r.js.slice(0, 40);
    } else {
      if (!isValidScriptletName(r.name)) {
        warn(`unknown scriptlet "${r.name}" (from ${r.source}), skipped`);
        continue;
      }
      code = scriptlets.invoke({ name: r.name, args: r.args, engine: 'extension', version: SCRIPTLETS_VERSION, verbose: false });
      label = `${r.name}(${r.args.map((a) => a.slice(0, 30)).join(', ')})`;
    }
    out.push({ n: label, s: r.source, d: r.include, x: r.exclude, code });
  }
  fs.mkdirSync(GEN, { recursive: true });
  const body = out
    .map((r) => `  { n: ${JSON.stringify(r.n)}, s: ${JSON.stringify(r.s)}, d: ${JSON.stringify(r.d)}, x: ${JSON.stringify(r.x)}, run: function () {\n${r.code}\n  } }`)
    .join(',\n');
  fs.writeFileSync(
    path.join(GEN, 'youtube-rules.js'),
    `// generated by build.mjs: AdGuard Base (@adguard/dnr-rulesets ${PKG_VERSION}) + uAssets quick-fixes, compiled with @adguard/scriptlets ${SCRIPTLETS_VERSION}\nexport default [\n${body}\n];\n`,
  );
  log(`youtube: ${out.length} rules (${out.filter((r) => r.s === 'adguard').length} AdGuard, ${out.filter((r) => r.s === 'uassets').length} uAssets, ${out.filter((r) => r.s === 'local').length} local)`);
  for (const r of out) log(`  [${r.s}] ${r.d.join(',')} -> ${r.n}`);
  return out.length;
}

// ---------------------------------------------------------------------------------------------------------

async function bundle(entry, outfile, extra = {}) {
  await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    format: 'iife',
    target: TARGET,
    outfile: path.join(DIST, outfile),
    legalComments: 'inline',
    logLevel: 'warning',
    // a release folds the __RELEASE__ branches away (esbuild only removes dead branches when it minifies syntax)
    minifySyntax: RELEASE,
    ...extra,
    define: { ...DEFINE, ...(extra.define || {}) },
  });
}

async function buildTwitch() {
  const worker = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'twitch', 'worker.js')],
    bundle: true,
    write: false,
    format: 'iife',
    target: TARGET,
    legalComments: 'inline',
    logLevel: 'warning',
    minifySyntax: RELEASE,
    define: DEFINE,
  });
  const code = worker.outputFiles[0].text;
  await bundle('src/twitch/page.js', 'twitch.js', { define: { __WORKER_CODE__: JSON.stringify(code) } });
  log(`twitch: worker hook ${code.length} bytes inlined into twitch.js`);
}

// The extension's icon: icons/dogwifhatnike.png (Fran's pick, 2026-10-15) rendered once to the four sizes Chrome
// uses (icons/icon-<size>.png, committed); the build only copies them.
const ICON_SIZES = [16, 32, 48, 128];
function copyIcons() {
  fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });
  for (const size of ICON_SIZES) fs.copyFileSync(path.join(ROOT, 'icons', `icon-${size}.png`), path.join(DIST, 'icons', `icon-${size}.png`));
}

const hostPatterns = (hosts) => hosts.map((h) => `https://*.${h}/*`);

// The content scripts. Not declared in the manifest: the service worker registers them (chrome.scripting) with the
// sites switched off in the popup excluded, which the manifest cannot express. Same fields as before, camel-cased.
const ALL_CONTENT_SCRIPTS = [
  { id: 'cosmetic', matches: ['http://*/*', 'https://*/*'], js: ['cosmetic/runtime.js'], runAt: 'document_start', allFrames: true, matchOriginAsFallback: true },
  { id: 'youtube', matches: hostPatterns(config.youtube.hosts), js: ['youtube.js'], runAt: 'document_start', allFrames: true, world: 'MAIN' },
  { id: 'twitch', matches: hostPatterns(config.twitch.hosts), js: ['twitch.js'], runAt: 'document_start', world: 'MAIN' },
  // ISOLATED world: relays the Twitch and YouTube records to the service worker (chrome.downloads); all frames because
  // youtube.js also runs in embeds
  { id: 'bridge', matches: hostPatterns([...config.twitch.hosts, ...config.youtube.hosts]), js: ['bridge.js'], runAt: 'document_start', allFrames: true },
];
// the bridge only carries records: a release has none
const CONTENT_SCRIPTS = RELEASE ? ALL_CONTENT_SCRIPTS.filter((s) => s.id !== 'bridge') : ALL_CONTENT_SCRIPTS;

function writeManifest({ resources }) {
  const manifest = {
    manifest_version: 3,
    name: 'getFran AdBlock',
    version: EXT_VERSION,
    // what a person sees in chrome://extensions; the lists' version is in the build log, not here
    description: 'Blocks ads on every website, including YouTube and Twitch.',
    minimum_chrome_version: '128',
    homepage_url: 'https://github.com/' + config.release.repo,
    icons: Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/icon-${size}.png`])),
    // scripting + storage: the content scripts and the per-site switch; alarms: the daily update check. Development builds
    // add declarativeNetRequestFeedback (test/verify.mjs reads the matched rules) and downloads (the Twitch and YouTube
    // records, src/background.js)
    permissions: ['declarativeNetRequest', 'scripting', 'storage', 'alarms', ...(RELEASE ? [] : ['declarativeNetRequestFeedback', 'downloads'])],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'background.js' },
    declarative_net_request: { rule_resources: resources },
    action: { default_popup: 'popup.html', default_title: 'getFran AdBlock', default_icon: Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/icon-${size}.png`])) },
    // the cosmetic runtime fetches its domain's bucket from the extension package
    web_accessible_resources: [{ resources: ['cosmetic/bucket-*.json'], matches: ['<all_urls>'] }],
  };
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function download(url) {
  log(`downloading ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.text()).replace(/\r/g, '');
}

// Both snapshots are downloaded before either is written: a failed download leaves vendor/ as it was.
async function vendor() {
  const ua = config.youtube.uassets;
  const adg = config.youtube.adguardLive;
  const [uaText, adgText] = await Promise.all([download(ua.url), download(adg.url)]);
  const stamp = new Date().toISOString();
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });

  fs.writeFileSync(path.join(ROOT, ua.snapshot), `! Snapshot of uAssets quick-fixes.txt vendored on ${stamp} from ${ua.url}\n! Refresh with: npm run vendor\n` + uaText);
  log(`wrote ${ua.snapshot} (${uaText.split('\n').length} lines)`);

  const meta = (key) => ((new RegExp(`^! ${key}: (.+)$`, 'm').exec(adgText) || [])[1] || '?').trim();
  const lines = adgText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l[0] !== '!' && isRuleFor(l, config.youtube.hosts));
  const header =
    `! YouTube rules of the live AdGuard Base filter (version ${meta('Version')}, updated ${meta('TimeUpdated')}), vendored on ${stamp} from ${adg.url}\n` +
    `! Only the cosmetic and JS rules whose domains name a YouTube host; the build swaps them in for the npm package's (build.mjs overlayYoutube).\n` +
    `! Refresh with: npm run vendor\n`;
  fs.writeFileSync(path.join(ROOT, adg.snapshot), header + lines.join('\n') + '\n');
  log(`wrote ${adg.snapshot} (${lines.length} rules; filter ${meta('Version')} of ${meta('TimeUpdated')})`);
}

async function main() {
  if (process.argv.includes('--vendor')) return vendor();
  const started = Date.now();
  log(`${RELEASE ? 'release' : 'development'} build, version ${EXT_VERSION}`);
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.rmSync(GEN, { recursive: true, force: true });
  fs.mkdirSync(GEN, { recursive: true });

  const resources = buildRulesets();
  buildCosmetic();
  buildYoutube();
  await bundle('src/background.js', 'background.js', { format: 'esm', define: { __CONTENT_SCRIPTS__: JSON.stringify(CONTENT_SCRIPTS) } });
  await bundle('src/popup/popup.js', 'popup.js');
  fs.copyFileSync(path.join(ROOT, 'src', 'popup', 'popup.html'), path.join(DIST, 'popup.html'));
  await bundle('src/cosmetic/runtime.js', 'cosmetic/runtime.js');
  await bundle('src/youtube/main.js', 'youtube.js');
  await buildTwitch();
  if (!RELEASE) await bundle('src/bridge.js', 'bridge.js');
  copyIcons();
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(ROOT, file), path.join(DIST, file));
  writeManifest({ resources });

  const size = (f) => Math.round(fs.statSync(path.join(DIST, f)).size / 1024) + ' KB';
  log(`bundles: cosmetic/runtime.js ${size('cosmetic/runtime.js')}, youtube.js ${size('youtube.js')}, twitch.js ${size('twitch.js')}, background.js ${size('background.js')}`);
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${DIST}`);
}

main().catch((e) => {
  console.error('[build] FAILED:', e);
  process.exit(1);
});
