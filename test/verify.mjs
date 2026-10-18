#!/usr/bin/env node
// Live verification of dist/ in a real browser with the extension loaded unpacked.
//
//   node test/verify.mjs [generic|youtube|twitch|all] [--channel=msedge|chromium|chrome] [--headless=true]
//                        [--seconds=120] [--twitch=<login>] [--video=<youtube id>] [--keep-profile]
//
// Default browser: Playwright's Chromium (--channel=chromium, which brings H.264/AAC; branded Chrome >= 137 refuses
// --load-extension and Edge is not installed). Each run starts from a fresh profile under test/profiles/ unless
// --keep-profile. Twitch: --twitch=<login>[,<login>...] watches each channel up to --seconds and stops after the first
// complete stitched break; without --twitch the top live channel is used.
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
const CHANNEL = opt('channel', 'chromium');
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
  const profiles = path.join(ROOT, 'test', 'profiles');
  const userDataDir = flag('keep-profile') ? path.join(profiles, profile) : path.join(profiles, `${profile}-${Date.now()}`);
  // best effort: a profile still locked by a browser that did not exit stays on disk
  for (const old of fs.existsSync(profiles) ? fs.readdirSync(profiles) : []) {
    if (old !== path.basename(userDataDir) && !flag('keep-profile')) {
      try {
        fs.rmSync(path.join(profiles, old), { recursive: true, force: true });
      } catch {
        say(`(could not remove old profile ${old}: still in use)`);
      }
    }
  }
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

  // The per-site switch, on the site that broke on 2026-10-16: AdGuard Tracking Protection's `||umami.` rule blocks
  // the Umami dashboard's own scripts. With getfran.dev switched off nothing on it may be blocked and no cosmetic
  // sheet injected (the content scripts are not registered for it, and a DNR allowAllRequests rule covers its frames).
  section('per-site switch: umami.getfran.dev');
  const before = await sw.evaluate(() => globalThis.__adblock.getDisabledSites());
  const probe = async (label) => {
    const p = await context.newPage();
    const b = watchBlocked(p);
    await p.goto('https://umami.getfran.dev/login', { waitUntil: 'load', timeout: 60000 }).catch((e) => say(`  ${label}: ${e.message}`));
    await sleep(4000);
    const sheets = await p.evaluate(() => document.adoptedStyleSheets.length).catch(() => -1);
    say(`  ${label}: ${b.length} requests blocked${b.length ? ' (e.g. ' + b.slice(0, 3).map((u) => u.replace(/^https?:\/\//, '').slice(0, 60)).join(' | ') + ')' : ''}, adoptedStyleSheets=${sheets}`);
    await p.close();
    return { blocked: b.length, sheets };
  };
  await sw.evaluate(() => globalThis.__adblock.setDisabledSites([]));
  const on = await probe('with blocking on');
  await sw.evaluate(() => globalThis.__adblock.setDisabledSites(['getfran.dev']));
  const off = await probe('with getfran.dev switched off');
  await sw.evaluate((sites) => globalThis.__adblock.setDisabledSites(sites), before);
  const switchOk = on.blocked > 0 && off.blocked === 0 && off.sheets === 0;
  say(`per-site switch: ${switchOk ? 'works (blocked with it on, nothing blocked and no cosmetic sheet with it off)' : 'NOT verified !!'}; list restored to ${JSON.stringify(before)}`);
  return { blocked: blocked.length, matched: matched.length, switchOk };
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
  const applied = await page.evaluate(() => window.__adblockYoutube && { applied: window.__adblockYoutube.applied, failed: window.__adblockYoutube.failed });
  say(`rules applied in MAIN world: ${applied ? applied.applied.length : 'NONE (script did not run)'}${applied && applied.failed.length ? ' | failed: ' + applied.failed.join(' | ') : ''}`);
  // the two halves of the defence against the "Ad blockers are not allowed on YouTube" popup: AdGuard's neutering of
  // the onAbnormalityDetected handler (the first raw JS rule of the Base, a Promise.then proxy) and our pruning of the
  // popup's payload (build.config.mjs youtube.local)
  const names = (applied && applied.applied) || [];
  const abnormality = names.some((n) => /^js:\(\(\)=>\{const t=\{apply:\(t,o,n\)=>\{const e=n/.test(n));
  // the labels truncate each argument to 30 characters (build.mjs)
  const payload = ['json-prune(auxiliaryUi', 'json-prune-fetch-response(auxiliaryUi', 'json-prune-xhr-response(auxiliaryUi', 'set-constant(ytInitialPlayerResponse.auxili'].filter((p) => names.some((n) => n.startsWith(p)));
  say(`anti-popup rules: onAbnormalityDetected neutered=${abnormality}${abnormality ? '' : ' !!'} | enforcement payload pruned by ${payload.length}/4 rules${payload.length === 4 ? '' : ' !!'}`);
  const playerAdsDisplay = await page.evaluate(() => {
    const e = document.getElementById('player-ads');
    return e ? getComputedStyle(e).display : 'absent';
  });
  say(`#player-ads (generic rule with a youtube.com exception, must NOT be hidden): display=${playerAdsDisplay}`);

  // The "ad blockers violate YouTube's Terms of Service" snackbar/toast (what Fran saw on 2026-10-18) is hidden by
  // uBO's quick-fixes rules, which the cosmetic build takes for the YouTube hosts; no AdGuard list has them. It only
  // shows up on flagged accounts, so from a fresh profile the check is that the selectors reached the page's CSS.
  const warningSelectors = await page.evaluate(() => {
    const wanted = ['ytSnackbarContainerOpened', 'yt-notification-action-renderer'];
    const found = new Set();
    for (const sheet of document.adoptedStyleSheets) {
      try {
        for (const rule of sheet.cssRules) for (const w of wanted) if (rule.cssText.includes(w)) found.add(w);
      } catch {}
    }
    return wanted.map((w) => `${w}=${found.has(w)}`);
  });
  say(`"ad blockers violate the Terms" snackbar/toast selectors in the injected CSS: ${warningSelectors.join(', ')}${warningSelectors.some((w) => w.endsWith('false')) ? ' !!' : ''}`);

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

  // the record the extension writes to Downloads/AdBlock/ when the popup or the error screen shows up (src/youtube/record.js):
  // asked by hand here, its download checked, and its content read back (the player responses as the server sent them)
  const savedName = await page.evaluate(() => (window.__adblockYoutube && window.__adblockYoutube.save ? window.__adblockYoutube.save('verify') : null)).catch(() => null);
  await sleep(3000);
  const download = savedName ? await sw.evaluate((name) => globalThis.__adblock.downloadState(name), savedName).catch((e) => ({ error: e.message })) : null;
  say(`record: ${savedName ? savedName + ' -> ' + JSON.stringify(download) : 'save() not available on the page !!'}`);
  if (download && download.state === 'complete' && download.filename && fs.existsSync(download.filename)) {
    try {
      const r = JSON.parse(fs.readFileSync(download.filename, 'utf8'));
      const players = r.responses.filter((x) => /\/player/.test(x.url));
      const findings = r.responses.flatMap((x) => x.findings.map((f) => f.path));
      say(`record content: version ${r.version}, loggedIn=${r.loggedIn}, ${r.responses.length} responses (${players.length} /player: status ${[...new Set(players.map((p) => p.status))].join(',') || '-'}, auxiliaryUi ${players.some((p) => p.auxiliaryUi) ? 'PRESENT' : 'absent'}), anti-adblock findings: ${findings.length ? findings.join(' | ') : 'none'}, ${r.events.length} events, ${r.log.length} log lines`);
    } catch (e) {
      say(`record content: could not read ${download.filename}: ${e.message} !!`);
    }
  } else if (savedName) say('record: download not complete !!');
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

// Twitch's ad UI, as vaft and Purple look for it, plus the "commercial break" placeholder text
const AD_UI_SELECTORS = ['[data-a-target="video-ad-label"]', '[data-a-target="video-ad-countdown"]', '.video-ad-label', '[data-test-selector="ad-banner-default-text"]', '[data-a-target="player-ad-notice"]', '[data-a-target="ad-banner-default-text"]', '.stream-display-ad'];
const AD_UI_TEXT = /commercial break in progress|pausa publicitaria|anuncio en curso/i;
const STALL_LIMIT_S = 5; // the video still longer than this, not paused, is a stall worth a line
const AFTER_BREAK_S = 30; // how long a channel is still watched after a break ended

// one sample per second of what the page shows
async function twitchSample(page) {
  return page
    .evaluate(
      ({ selectors, text }) => {
        const videos = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
        const v = videos[0];
        const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        const t = window.__adblockTwitch || {};
        const ui = selectors.filter((s) => document.querySelector(s));
        const player = document.querySelector('[data-a-target="video-player"], .video-player, #root');
        const placeholder = player && new RegExp(text, 'i').test(player.innerText || '') ? 'text' : null;
        return {
          at: Date.now(),
          t: v ? Math.round(v.currentTime * 10) / 10 : null,
          paused: v ? v.paused : null,
          ready: v ? v.readyState : null,
          frames: q ? q.totalVideoFrames : null,
          videos: videos.length,
          adUi: [...ui, ...(placeholder ? [placeholder] : [])],
          workers: t.workers,
          hooked: t.hookedWorkers,
          headers: t.gqlHeaders,
          classes: t.classes,
          breaks: (t.breaks || []).length,
          breakEnds: (t.breakEnds || []).length,
          csai: t.csaiBlocked,
          restarts: (t.restarts || []).length,
        };
      },
      { selectors: AD_UI_SELECTORS, text: AD_UI_TEXT.source },
    )
    .catch((e) => ({ at: Date.now(), error: e.message }));
}

// the stretches where the video did not move while not paused, from the samples: [{from, to, seconds}].
// key 't' is the clock (currentTime); 'frames' the decoded frames: a picture frozen while the clock runs
function stalls(samples, key = 't') {
  const out = [];
  let run = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const still = a[key] != null && b[key] != null && b[key] === a[key] && b.paused === false && a.paused === false;
    if (still) {
      if (!run) run = { from: a.at, to: b.at, t: b.t };
      else run.to = b.at;
    } else if (run) {
      out.push({ ...run, seconds: Math.round((run.to - run.from) / 1000) });
      run = null;
    }
  }
  if (run) out.push({ ...run, seconds: Math.round((run.to - run.from) / 1000) });
  return out;
}

async function watchTwitchChannel({ context, sw, login, seconds, blockedAll, requested }) {
  const page = await context.newPage();
  const since = Date.now();
  const blocked = watchBlocked(page);
  const lines = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[AdBlock/twitch')) {
      lines.push(t);
      say('  ' + t.slice(0, 240));
    }
  });
  page.on('request', (r) => requested.add(r.url()));
  say(`\nwatching https://www.twitch.tv/${login} for up to ${seconds} s (stops ${AFTER_BREAK_S} s after a stitched break ends)`);
  await page.goto(`https://www.twitch.tv/${login}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const started = Date.now();
  const samples = [];
  let lastReport = 0;
  let lastBreakEnd = null;
  while (Date.now() - started < seconds * 1000) {
    await sleep(1000);
    // content gates ("Start Watching" for mature content) and the muted-autoplay overlay
    await page
      .evaluate(() => {
        const gate = document.querySelector('button[data-a-target="content-classification-gate-overlay-start-watching-button"], button[data-a-target="player-overlay-mature-accept"]');
        if (gate) gate.click();
      })
      .catch(() => {});
    const s = await twitchSample(page);
    samples.push(s);
    if (s.adUi && s.adUi.length && !(samples[samples.length - 2] || {}).adUi?.length) say(`  !! ad UI visible at ${Math.round((s.at - started) / 1000)} s: ${s.adUi.join(', ')}`);
    if (s.breakEnds > 0 && lastBreakEnd === null) lastBreakEnd = s.at;
    if (s.breaks > s.breakEnds) lastBreakEnd = null; // a break (or the same one again) is running
    if (Date.now() - lastReport > 15000) {
      lastReport = Date.now();
      say(`  [${Math.round((Date.now() - started) / 1000)} s] video t=${s.t} paused=${s.paused} readyState=${s.ready} videos=${s.videos} adUi=${JSON.stringify(s.adUi)} | workers=${s.workers} hooked=${s.hooked} gqlHeaders=${JSON.stringify(s.headers)} | classes=${JSON.stringify(s.classes)} breaks=${s.breaks} ended=${s.breakEnds} restarts=${s.restarts} csai=${JSON.stringify(s.csai)}`);
    }
    if (lastBreakEnd !== null && Date.now() - lastBreakEnd > AFTER_BREAK_S * 1000) break;
  }
  const final = await page.evaluate(() => window.__adblockTwitch).catch(() => null);
  const matched = await matchedSince(sw, since);
  // the record the extension writes to Downloads/AdBlock/ when an ad gets through: asked by hand here, and its download checked
  const savedName = await page.evaluate(() => (window.__adblockTwitch && window.__adblockTwitch.save ? window.__adblockTwitch.save('verify') : null)).catch(() => null);
  await sleep(3000);
  const download = savedName ? await sw.evaluate((name) => globalThis.__adblock.downloadState(name), savedName).catch((e) => ({ error: e.message })) : null;
  say(`  record: ${savedName ? savedName + ' -> ' + JSON.stringify(download) : 'save() not available on the page'}`);
  if (download && download.state === 'complete' && download.filename && fs.existsSync(download.filename)) {
    try {
      const r = JSON.parse(fs.readFileSync(download.filename, 'utf8'));
      const w = r.worker || {};
      say(`  record content: version ${r.version}, ${r.samples.length} samples, ${r.log.length} log lines, ${r.events.length} events, ${r.breakEnds.length} break(s), worker ${w.channel ? w.channel + '@' + w.quality + ' backups=' + (w.backups || []).join(',') + ' recent playlists=' + (w.recent || []).length : 'NONE'}`);
    } catch (e) {
      say(`  record content: could not read (${e.message})`);
    }
  }
  blockedAll.push(...blocked);
  await page.close();
  return { login, seconds: Math.round((Date.now() - started) / 1000), started, samples, final, lines, blocked, matched };
}

async function testTwitch({ context, sw }) {
  section('twitch: stream swap on stitched breaks, CSAI answered empty, video and ad UI watched');
  // DNR alone: would the AdGuard rulesets block the client-side ad request? (the page hook answers it first, so this
  // is asked of the engine directly rather than read from the matches)
  const dnr = await sw.evaluate(() => globalThis.__adblock.testMatch('https://edge.ads.twitch.tv/ads?bp=midroll&foo=1', 'https://www.twitch.tv', 'xmlhttprequest')).catch((e) => ({ error: e.message }));
  say(`DNR on edge.ads.twitch.tv (without the page hook): ${dnr.error ? 'could not test: ' + dnr.error : dnr.matchedRules.length ? 'BLOCKED by ' + dnr.matchedRules.map((r) => r.rulesetId + '#' + r.ruleId).join(', ') : 'NOT blocked by any enabled ruleset'}`);

  const wanted = opt('twitch', null);
  const logins = wanted ? wanted.split(',').map((s) => s.trim()).filter(Boolean) : [await pickTwitchChannel(context)];
  const blockedAll = [];
  const requested = new Set();
  const runs = [];
  for (const login of logins) {
    const run = await watchTwitchChannel({ context, sw, login, seconds: SECONDS, blockedAll, requested });
    runs.push(run);
    if (run.final && run.final.breakEnds && run.final.breakEnds.length) break; // one complete stitched break is what the check needs
    say(`  no complete stitched break on ${login} in ${run.seconds} s${logins.indexOf(login) < logins.length - 1 ? ': next channel' : ''}`);
  }

  fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
  const file = path.join(ROOT, '.cache', `twitch-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const report = { runs: runs.map((r) => ({ ...r, samples: r.samples })), blocked: blockedAll };
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  // --- the verdicts --------------------------------------------------------------------------------------
  let verified = false;
  for (const run of runs) {
    const f = run.final;
    if (!f) continue;
    say(`\n${run.login}: ${run.seconds} s watched, DATERANGE classes ${JSON.stringify(f.classes)}, masters ${f.masters.length}, workers hooked ${f.hookedWorkers}/${f.workers}`);
    const allStalls = stalls(run.samples);
    const long = allStalls.filter((s) => s.seconds >= STALL_LIMIT_S);
    const frozen = stalls(run.samples, 'frames').filter((s) => s.seconds >= STALL_LIMIT_S);
    say(`  video: ${run.samples.filter((s) => s.t != null).length} samples, clock stalls of ${STALL_LIMIT_S} s or more: ${long.length}${long.length ? ' (' + long.map((s) => s.seconds + ' s at +' + Math.round((s.from - run.started) / 1000) + ' s').join(', ') + ')' : ''}; picture frozen (no new frames) ${STALL_LIMIT_S} s or more: ${frozen.length}${frozen.length ? ' (' + frozen.map((s) => s.seconds + ' s at +' + Math.round((s.from - run.started) / 1000) + ' s').join(', ') + ') !!' : ''}`);
    const adUiSamples = run.samples.filter((s) => s.adUi && s.adUi.length);
    say(`  ad UI of Twitch seen in ${adUiSamples.length} of ${run.samples.length} samples${adUiSamples.length ? ' (' + [...new Set(adUiSamples.flatMap((s) => s.adUi))].join(', ') + ')' : ''}`);
    say(`  CSAI: ${JSON.stringify(f.csaiBlocked)} answered empty by the page hook; ${run.blocked.filter((u) => u.includes('edge.ads.twitch.tv')).length} requests to edge.ads.twitch.tv blocked by DNR instead`);
    const adOnNetwork = f.blankUris.filter((u) => requested.has(u));
    say(`  ad media: ${f.blankUris.length} URI(s) listed for the blank segment, ${f.events.filter((e) => e.type === 'blankAnswered').length} answered blank in the worker, ${adOnNetwork.length} seen on the network by the browser${adOnNetwork.length ? ' !! ' + adOnNetwork.slice(0, 3).join(' | ') : ''}`);
    const restarts = f.events.filter((e) => e.type === 'sequenceRestart' || e.type === 'stallRestart');
    if (restarts.length) say(`  restarts: ${restarts.map((e) => e.type + (e.kind ? '/' + e.kind : '') + ' at +' + Math.round((e.at - run.started) / 1000) + ' s').join(', ')}`);

    for (const b of f.breaks) {
      const end = f.breakEnds.find((e) => e.at === b.at);
      const windowFrom = b.at - 2000;
      const windowTo = end ? end.endedAt + AFTER_BREAK_S * 1000 : Date.now();
      const inWindow = run.samples.filter((s) => s.at >= windowFrom && s.at <= windowTo);
      const breakStalls = stalls(inWindow);
      const longest = breakStalls.reduce((m, s) => Math.max(m, s.seconds), 0);
      const longestFrozen = stalls(inWindow, 'frames').reduce((m, s) => Math.max(m, s.seconds), 0);
      const uiIn = inWindow.filter((s) => s.adUi && s.adUi.length).length;
      const atEnd = end ? run.samples.find((s) => s.at >= end.endedAt) : null;
      const later = end ? run.samples.find((s) => s.at >= end.endedAt + 10000) : null;
      const movedAfter = atEnd && later && later.t != null && atEnd.t != null ? Math.round((later.t - atEnd.t) * 10) / 10 : null;
      say(`\n  STITCHED BREAK at +${Math.round((b.at - run.started) / 1000)} s: roll=${b.rollType || '?'} pod=${b.podLength || '?'} player at ${b.quality || '?'} first poll ${b.adSegments}/${b.segments} ad segments${b.resumed ? ' (resumed)' : ''}`);
      if (!end) {
        say(`    still running when the watch ended: NOT a complete sample`);
        continue;
      }
      say(`    ${Math.round(end.durationMs / 1000)} s long, ${end.polls} polls with ad segments: ${end.swapped} answered with a backup playlist, ${end.merged} merged, ${end.blanked} with segments left for the blank segment (${end.blankListed} URI(s) listed)`);
      say(`    backups used: ${end.backups.map((x) => x.type + '@' + x.quality + (x.shift != null ? ' (seq ' + (x.shift >= 0 ? '+' : '') + x.shift + ')' : '')).join(' > ') || 'NONE'}`);
      say(`    playlists with ad segments fetched by the player from Twitch: ${adOnNetwork.length} ad URI(s) on the network ${adOnNetwork.length ? '!!' : '(none)'}`);
      say(`    video during the break and ${AFTER_BREAK_S} s after: longest clock stall ${longest} s${longest >= STALL_LIMIT_S ? ' !!' : ''}, longest frozen picture ${longestFrozen} s${longestFrozen >= STALL_LIMIT_S ? ' !!' : ''}; ad UI in ${uiIn} of ${inWindow.length} samples${uiIn ? ' !!' : ''}`);
      say(`    after the break: currentTime moved ${movedAfter == null ? '(no sample)' : movedAfter + ' s in 10 s'}${movedAfter != null && movedAfter < 5 ? ' !!' : ''}`);
      const ok = adOnNetwork.length === 0 && longest < STALL_LIMIT_S && longestFrozen < STALL_LIMIT_S && uiIn === 0 && movedAfter != null && movedAfter >= 5 && end.swapped + end.merged > 0;
      say(`    => ${ok ? 'BLOCKED: the player got clean playlists, kept playing and showed no ad UI' : 'NOT CLEAN: see the !! lines above'}`);
      verified = verified || ok;
    }
    if (!f.breaks.length) say(`  no stitched break on this channel: the swap was not exercised here`);
  }
  if (!runs.some((r) => r.final && r.final.breaks.length)) say('\nNO stitched ad break was seen in this run: the blocking is NOT verified (DATERANGE classes above are what the player saw).');
  else if (!verified) say('\nA stitched break was seen but the checks did not all pass: the blocking is NOT verified.');
  say(`report written to ${file}`);
  return { verified, runs: runs.length };
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
