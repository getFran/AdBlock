#!/usr/bin/env node
// Live verification of dist/ in a real browser with the extension loaded unpacked.
//
//   node test/verify.mjs [generic|youtube|twitch|all] [--channel=msedge|chromium|chrome] [--headless=true]
//                        [--seconds=120] [--twitch=<login>] [--video=<youtube id>] [--keep-profile]
//
// Default browser: msedge (Playwright's Chromium has no H.264, which Twitch needs; branded Chrome >= 137
// refuses --load-extension). Each run starts from a fresh profile under test/profiles/ unless --keep-profile.
// Every check prints what it saw; a check that saw no ad says so instead of passing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) || 'all';
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const flag = (name) => args.includes(`--${name}`);
const CHANNEL = opt('channel', 'msedge');
const HEADLESS = opt('headless', 'false') === 'true';
const SECONDS = Number(opt('seconds', 120));
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

const say = (...a) => console.log(...a);
const section = (title) => say(`\n=== ${title} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  console.error('dist/manifest.json not found: run "npm run build" first');
  process.exit(1);
}

async function launch(profile) {
  const userDataDir = path.join(ROOT, 'test', 'profiles', profile);
  if (!flag('keep-profile')) fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: CHANNEL,
    headless: HEADLESS,
    viewport: { width: 1366, height: 800 },
    locale: 'es-ES',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
  if (!sw) throw new Error('the extension service worker never started: is the extension loaded? (check --channel)');
  await sleep(500);
  const dnr = await sw.evaluate(() => globalThis.__adblock.report());
  say(`extension ${dnr.version} loaded in ${CHANNEL}: rulesets enabled = ${dnr.enabled.join(', ')}`);
  if (dnr.missing.length) say(`!! rulesets declared but NOT enabled: ${dnr.missing.join(', ')} (static rule limit?)`);
  say(`static rules still available for this extension: ${dnr.availableStaticRules}`);
  return { context, sw };
}

const matchedSince = async (sw, since) => sw.evaluate((t) => globalThis.__adblock.matched.filter((m) => m.at >= t), since);

function watchBlocked(page) {
  const blocked = [];
  page.on('requestfailed', (r) => {
    const err = (r.failure() && r.failure().errorText) || '';
    if (err.includes('BLOCKED_BY_CLIENT')) blocked.push(r.url());
  });
  return blocked;
}

// ---------------------------------------------------------------------------------------------------------
async function testGeneric({ context, sw }) {
  section('generic: network rules + cosmetic CSS');
  const page = await context.newPage();
  const blocked = watchBlocked(page);
  const since = Date.now();

  for (const site of ['https://www.marca.com/', 'https://www.elmundo.es/', 'https://www.as.com/']) {
    const before = blocked.length;
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => say(site, e.message));
    await sleep(8000);
    const cosmetic = await page.evaluate(() => ({
      adopted: document.adoptedStyleSheets.length,
      rules: document.adoptedStyleSheets.reduce((n, s) => n + s.cssRules.length, 0),
      styleTags: document.querySelectorAll('style').length,
    }));
    const sample = blocked.slice(before, before + 5).map((u) => u.replace(/^https?:\/\//, '').slice(0, 60));
    say(`${site}: ${blocked.length - before} requests blocked by the client (e.g. ${sample.join(' | ')}) | adoptedStyleSheets=${cosmetic.adopted} with ${cosmetic.rules} rules`);
  }
  const matched = await matchedSince(sw, since);
  const byRuleset = {};
  for (const m of matched) byRuleset[m.ruleset] = (byRuleset[m.ruleset] || 0) + 1;
  say(`DNR matches reported by the service worker: ${matched.length} (${Object.entries(byRuleset).map(([k, v]) => `${k}:${v}`).join(', ')})`);
  await page.close();
  return { blocked: blocked.length, matched: matched.length };
}

// ---------------------------------------------------------------------------------------------------------
async function dismissConsent(page) {
  for (let i = 0; i < 3; i++) {
    const url = page.url();
    const clicked = await page
      .evaluate(() => {
        const buttons = [...document.querySelectorAll('button, a[role="button"]')];
        const wanted = buttons.find((b) => /rechazar todo|reject all|aceptar todo|accept all/i.test(b.innerText || b.getAttribute('aria-label') || ''));
        if (wanted) {
          wanted.click();
          return (wanted.innerText || wanted.getAttribute('aria-label') || '').trim();
        }
        return null;
      })
      .catch(() => null);
    if (clicked) {
      say(`consent dialog: clicked "${clicked}" on ${url.slice(0, 50)}`);
      await sleep(3000);
      continue;
    }
    if (!url.includes('consent.')) return;
    await sleep(2000);
  }
}

async function playerState(page) {
  return page.evaluate(() => {
    const p = document.getElementById('movie_player');
    const v = document.querySelector('video');
    const r = (p && p.getPlayerResponse && p.getPlayerResponse()) || {};
    return {
      ad: !!(p && p.classList.contains('ad-showing')),
      adUi: !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-text, .ytp-ad-preview-container, .ytp-ad-skip-button-container'),
      t: v ? Math.round(v.currentTime * 10) / 10 : null,
      paused: v ? v.paused : null,
      playerState: p && p.getPlayerState ? p.getPlayerState() : null,
      videoId: r.videoDetails && r.videoDetails.videoId,
      adPlacements: r.adPlacements ? r.adPlacements.length : null,
      adSlots: r.adSlots ? r.adSlots.length : null,
      playerAds: r.playerAds ? r.playerAds.length : null,
      playability: r.playabilityStatus && r.playabilityStatus.status,
    };
  });
}

async function testYoutube({ context, sw }) {
  section('youtube: player response pruned, no ad UI');
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[AdBlock')) logs.push(t);
  });
  const blocked = watchBlocked(page);
  const since = Date.now();
  const video = opt('video', 'dQw4w9WgXcQ');
  await context.addCookies([{ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' }]);
  await page.goto(`https://www.youtube.com/watch?v=${video}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissConsent(page);
  await page.waitForSelector('#movie_player', { timeout: 60000 }).catch(() => say('!! #movie_player never appeared'));
  await sleep(3000);

  const inline = await page.evaluate(() => {
    const r = window.ytInitialPlayerResponse || {};
    return { present: !!window.ytInitialPlayerResponse, adPlacements: r.adPlacements, adSlots: r.adSlots, playerAds: r.playerAds, streaming: !!r.streamingData, status: r.playabilityStatus && r.playabilityStatus.status };
  });
  say(`ytInitialPlayerResponse: present=${inline.present} status=${inline.status} streamingData=${inline.streaming} adPlacements=${JSON.stringify(inline.adPlacements)} adSlots=${JSON.stringify(inline.adSlots)} playerAds=${JSON.stringify(inline.playerAds)}`);
  const applied = await page.evaluate(() => window.__adblockYoutube);
  say(`rules applied in MAIN world: ${applied ? applied.applied.length : 'NONE (script did not run)'}${applied && applied.failed.length ? ' | failed: ' + applied.failed.join(' | ') : ''}`);
  const playerAdsDisplay = await page.evaluate(() => {
    const e = document.getElementById('player-ads');
    return e ? getComputedStyle(e).display : 'absent';
  });
  say(`#player-ads (generic rule with a youtube.com exception, must NOT be hidden): display=${playerAdsDisplay}`);

  const samples = [];
  for (let i = 0; i < 25; i++) {
    samples.push(await playerState(page));
    await sleep(1000);
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const adSeen = samples.some((s) => s.ad || s.adUi);
  say(`first video ${last.videoId}: playability=${last.playability} getPlayerResponse() adPlacements=${last.adPlacements} adSlots=${last.adSlots} playerAds=${last.playerAds}`);
  say(`25 s of playback: ad-showing/ad UI seen = ${adSeen} | currentTime ${first.t} -> ${last.t} | playerState ${last.playerState} (1 = playing)`);

  // in-app navigation to a related video: the player response now comes through fetch (/youtubei/v1/player)
  await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
  await sleep(3000);
  const navigated = await page.evaluate(() => {
    const current = new URLSearchParams(location.search).get('v');
    const a = [...document.querySelectorAll('a[href^="/watch?v="]')].find((el) => !el.href.includes('v=' + current) && el.offsetParent);
    if (!a) return null;
    const href = a.getAttribute('href');
    a.click();
    return href;
  });
  if (navigated) {
    say(`clicked related video ${navigated}`);
    await sleep(10000);
    const s2 = [];
    for (let i = 0; i < 15; i++) {
      s2.push(await playerState(page));
      await sleep(1000);
    }
    const l2 = s2[s2.length - 1];
    say(`second video ${l2.videoId}: playability=${l2.playability} adPlacements=${l2.adPlacements} adSlots=${l2.adSlots} playerAds=${l2.playerAds} | ad UI seen=${s2.some((s) => s.ad || s.adUi)} | currentTime ${s2[0].t} -> ${l2.t}`);
  } else {
    say('no related video link found to test the fetch path');
  }
  const matched = await matchedSince(sw, since);
  const ads = matched.filter((m) => /doubleclick|googlesyndication|googleads|pagead|youtube\.com\/(api\/stats\/ads|pagead|ptracking)/.test(m.url));
  say(`network: ${blocked.length} requests blocked by the client, ${matched.length} DNR matches (${ads.length} ad/tracking-looking)`);
  if (logs.length) say('console: ' + logs.slice(0, 5).join(' || '));
  await page.close();
  return { adSeen, pruned: last.adPlacements === null && last.adSlots === null };
}

// ---------------------------------------------------------------------------------------------------------
async function pickTwitchChannel(context) {
  const wanted = opt('twitch', null);
  if (wanted) return wanted;
  const res = await context.request.post('https://gql.twitch.tv/gql', {
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    data: { query: '{ streams(first: 20) { edges { node { broadcaster { login } viewersCount game { name } } } } }' },
  });
  const json = await res.json().catch(() => null);
  const edges = (json && json.data && json.data.streams && json.data.streams.edges) || [];
  if (!edges.length) throw new Error('could not list live streams via GQL: ' + JSON.stringify(json).slice(0, 200));
  const top = edges.slice(0, 5).map((e) => `${e.node.broadcaster.login} (${e.node.viewersCount}, ${e.node.game && e.node.game.name})`);
  say('top live channels: ' + top.join(' | '));
  return edges[0].node.broadcaster.login;
}

async function testTwitch({ context }) {
  section('twitch: DATERANGE classes and the backup probe');
  const page = await context.newPage();
  const lines = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[AdBlock/twitch')) {
      lines.push(t);
      say('  ' + t.slice(0, 220));
    }
  });
  const login = await pickTwitchChannel(context);
  say(`watching https://www.twitch.tv/${login} for up to ${SECONDS} s`);
  await page.goto(`https://www.twitch.tv/${login}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const started = Date.now();
  let lastReport = 0;
  while (Date.now() - started < SECONDS * 1000) {
    await sleep(1000);
    // content gates ("Start Watching" for mature content) and the muted-autoplay overlay
    await page
      .evaluate(() => {
        const gate = document.querySelector('button[data-a-target="content-classification-gate-overlay-start-watching-button"], button[data-a-target="player-overlay-mature-accept"]');
        if (gate) gate.click();
      })
      .catch(() => {});
    if (Date.now() - lastReport > 15000) {
      lastReport = Date.now();
      const s = await page
        .evaluate(() => {
          const v = document.querySelector('video');
          const t = window.__adblockTwitch || {};
          return { ready: v ? v.readyState : null, time: v ? Math.round(v.currentTime) : null, paused: v ? v.paused : null, workers: t.workers, hooked: t.hookedWorkers, headers: t.gqlHeaders, classes: t.classes, breaks: (t.breaks || []).length, probes: (t.probes || []).length };
        })
        .catch((e) => ({ error: e.message }));
      say(`  [${Math.round((Date.now() - started) / 1000)} s] video readyState=${s.ready} t=${s.time} paused=${s.paused} | workers=${s.workers} hooked=${s.hooked} gqlHeaders=${JSON.stringify(s.headers)} | classes=${JSON.stringify(s.classes)} breaks=${s.breaks} probes=${s.probes}`);
      if (s.probes > 0 && Date.now() - started > 30000) break;
    }
  }
  const final = await page.evaluate(() => window.__adblockTwitch).catch(() => null);
  const report = { login, seconds: Math.round((Date.now() - started) / 1000), ...(final || {}), consoleLines: lines };
  fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
  const file = path.join(ROOT, '.cache', `twitch-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  say(`\nDATERANGE classes seen: ${JSON.stringify(final && final.classes)}`);
  say(`ad breaks seen: ${final ? final.breaks.length : 0}; backup probes run: ${final ? final.probes.length : 0}`);
  for (const p of (final && final.probes) || []) {
    say(`probe at ${new Date(p.at).toISOString()} on ${p.channel} (player at ${p.quality}, break ${p.break.rollType || '?'}):`);
    for (const r of p.results) say(`  ${r.playerType.padEnd(19)} ${r.verdict.padEnd(10)} ${r.quality || ''} ${r.adSegments || ''} ${r.classes || ''} ${r.detail || ''} ${r.token ? 'show_ads=' + r.token.show_ads + ' hide_ads=' + r.token.hide_ads : ''}`);
  }
  if (!final || !final.breaks.length) say('NO ad break was seen in this run: the probe could not be exercised (DATERANGE classes above are what the player saw).');
  say(`report written to ${file}`);
  await page.close();
  return report;
}

// ---------------------------------------------------------------------------------------------------------
async function main() {
  const { context, sw } = await launch(which);
  try {
    if (which === 'generic' || which === 'all') await testGeneric({ context, sw });
    if (which === 'youtube' || which === 'all') await testYoutube({ context, sw });
    if (which === 'twitch' || which === 'all') await testTwitch({ context, sw });
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error('verify failed:', e);
  process.exit(1);
});
