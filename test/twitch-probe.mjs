#!/usr/bin/env node
// Is the Twitch hook alive in whatever dist/ holds, release build included? Loads dist/ in Playwright's Chromium, opens
// a live channel and watches the network for --seconds (default 90): the usher masters the page asks for (the backup
// player types only appear when our worker hook prewarms them), the playlist polls, any ad-segment or edge.ads
// request, the video clock and Twitch's ad UI. Optional: --twitch=<login>, --pip (puts the video in picture-in-picture
// after 20 s), --navigate (goes to the directory after 20 s so Twitch's mini player takes over).
//   npm run build:release && node test/twitch-probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.ADBLOCK_DIST ? path.resolve(process.env.ADBLOCK_DIST) : path.join(ROOT, 'dist'); // e.g. an extracted release zip
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const SECONDS = Number(opt('seconds', 90));
const CLIENT_ID = (/CLIENT_ID = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'test', 'verify.mjs'), 'utf8')) || [])[1];
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
const release = !manifest.permissions.includes('downloads');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log('[probe] ' + line);

say(`${release ? 'release' : 'development'} build ${manifest.version}`);
const userDataDir = path.join(ROOT, 'test', 'profiles', `probe-${Date.now()}`);
fs.mkdirSync(userDataDir, { recursive: true });
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !flag('headed'),
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
try {
  let login = opt('twitch', null);
  if (!login) {
    const res = await context.request.post('https://gql.twitch.tv/gql', {
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
      data: { query: '{ streams(first: 10) { edges { node { broadcaster { login } viewersCount } } } }' },
    });
    const json = await res.json();
    login = json.data.streams.edges[0].node.broadcaster.login;
  }
  // when does the service worker finish registering the content scripts? A page opened before that gets no hook
  const launched = Date.now();
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
  let registeredAfterMs = null;
  for (let i = 0; sw && !flag('race') && i < 100; i++) {
    const ids = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)).catch(() => []);
    if (ids.includes('twitch')) {
      registeredAfterMs = Date.now() - launched;
      break;
    }
    await sleep(100);
  }
  say(`service worker ${sw ? 'up' : 'MISSING'}; twitch content script registered ${registeredAfterMs == null ? 'NOT within 10 s' : registeredAfterMs + ' ms after launch'}${flag('race') ? ' (--race: not waiting for it)' : ''}`);
  const page = await context.newPage();
  const masters = new Map(); // player_type -> count
  const hosts = new Map(); // host kind -> count
  const adHits = [];
  let polls = 0;
  page.on('request', (request) => {
    const url = request.url();
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.hostname === 'usher.ttvnw.net') {
      // the player type travels inside the token JSON, not as a query parameter of its own
      let type = u.searchParams.get('player_type');
      if (!type) {
        try {
          type = JSON.parse(u.searchParams.get('token') || '{}').player_type || '?';
        } catch {
          type = '?';
        }
      }
      masters.set(type, (masters.get(type) || 0) + 1);
    } else if (u.hostname.endsWith('playlist.ttvnw.net')) {
      polls++;
    } else if (u.hostname === 'edge.ads.twitch.tv') {
      adHits.push('edge.ads ' + (u.searchParams.get('bp') || ''));
    } else if (/\.hls\.ttvnw\.net$/.test(u.hostname) && /segment|\.ts$|\.mp4$/.test(u.pathname)) {
      const kind = /amazon|\/ad\/|stitched/i.test(url) ? 'ad-like segment' : 'segment';
      hosts.set(kind, (hosts.get(kind) || 0) + 1);
      if (kind !== 'segment' && adHits.length < 5) adHits.push('segment ' + url.slice(0, 120));
    }
  });
  const AD_UI = ['[data-a-target="video-ad-label"]', '[data-a-target="video-ad-countdown"]', '.video-ad-label', '[data-test-selector="ad-banner-default-text"]', '[data-a-target="player-ad-notice"]', '[data-a-target="ad-banner-default-text"]', '.stream-display-ad'];
  say(`opening twitch.tv/${login} for ${SECONDS} s${flag('pip') ? ' with picture-in-picture at 20 s' : ''}${flag('navigate') ? ', navigating away at 20 s' : ''}`);
  await page.goto(`https://www.twitch.tv/${login}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const samples = [];
  let adUiSeen = 0;
  for (let t = 0; t < SECONDS; t += 5) {
    await sleep(5000);
    const s = await page
      .evaluate((selectors) => {
        const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
        const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        return {
          videos: document.querySelectorAll('video').length,
          t: v ? Math.round(v.currentTime * 10) / 10 : null,
          paused: v ? v.paused : null,
          w: v ? v.videoWidth : null,
          frames: q ? q.totalVideoFrames : null,
          pip: !!document.pictureInPictureElement,
          adUi: selectors.filter((sel) => document.querySelector(sel)),
          hooked: typeof window.__adblockTwitch,
        };
      }, AD_UI)
      .catch(() => null);
    if (s) {
      samples.push(s);
      if (s.adUi.length) adUiSeen++;
      say(`${String(t + 5).padStart(3)} s: videos=${s.videos} t=${s.t} paused=${s.paused} w=${s.w} frames=${s.frames} pip=${s.pip} adUi=${JSON.stringify(s.adUi)} | masters=${JSON.stringify(Object.fromEntries(masters))} polls=${polls}`);
    }
    if (t + 5 === 20 && flag('pip')) {
      const ok = await page.evaluate(async () => {
        const v = document.querySelector('video');
        try {
          await v.requestPictureInPicture();
          return 'pip on';
        } catch (e) {
          return 'pip failed: ' + e.message;
        }
      });
      say(ok);
    }
    if (t + 5 === 20 && flag('navigate')) {
      await page.evaluate(() => document.querySelector('a[href="/directory"], a[data-a-target="browse-link"]')?.click());
      say('clicked Browse: the mini player should take over');
    }
  }
  const backupTypes = [...masters.keys()].filter((k) => !['site', 'picture-by-picture', '?'].includes(k));
  say('--- result');
  say(`masters by player_type: ${JSON.stringify(Object.fromEntries(masters))}`);
  say(`worker hook ${backupTypes.length ? 'ACTIVE (backup tokens prewarmed: ' + backupTypes.join(', ') + ')' : 'NOT SEEN (no backup master requested)'}`);
  say(`playlist polls ${polls}, segments ${JSON.stringify(Object.fromEntries(hosts))}, ad requests ${adHits.length ? adHits.join(', ') : 'none'}`);
  const moving = samples.filter((s, i) => i && s.t != null && samples[i - 1].t != null && s.t > samples[i - 1].t).length;
  say(`video: ${samples.length} samples, clock moved in ${moving}, ad UI seen in ${adUiSeen}, max width ${Math.max(...samples.map((s) => s.w || 0))}`);
} finally {
  await context.close().catch(() => {});
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
