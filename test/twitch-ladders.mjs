#!/usr/bin/env node
// Which player_type x platform combinations give a full quality ladder, and which ones stay out of an ad pod?
//
// The chain's last resort is `autoplay`, the only backup that keeps coming back clean while every web token is inside
// the pod. It tops out at 360p30, which is what a viewer sees for the first ~30 s of a preroll (2026-10-24,
// jaimemellado_) and for the 6-40 s of a multi-pod midroll where the whole web pool is contaminated (2026-10-23).
// Two questions, and they need different runs:
//
//   ladders (any time):  is the 360p ceiling a property of the player type or of `platform: android`?
//                        ANSWERED 2026-10-24: the type. autoplay and picture-by-picture are capped at 360p30 on web,
//                        android and ios alike, and the five main types give the full ladder on all three.
//   immunity (--watch):  does a main type on another platform ALSO stay out of the pod, the way autoplay does?
//                        A token requested while a pod runs joins it (2026-10-23), so the combinations have to be
//                        asked for at the same instant or the comparison is just "the break ended". Hence Promise.all
//                        per poll, and a watch loop, because a stitched break cannot be provoked.
//
// No browser and no extension: PlaybackAccessToken answers anonymously with the public Client-ID, same as the probe
// of 2026-10-15.
//   node test/twitch-ladders.mjs [--twitch=<login>] [--types=a,b] [--platforms=web,android]
//   node test/twitch-ladders.mjs --twitch=<login> --watch=900   (poll the decisive combinations until a break)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const source = fs.readFileSync(path.join(ROOT, 'src', 'twitch', 'worker.js'), 'utf8');
const CLIENT_ID = (/CLIENT_ID = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'test', 'verify.mjs'), 'utf8')) || [])[1];
const HASH = (/PLAYBACK_ACCESS_TOKEN_HASH = '([^']+)'/.exec(source) || [])[1];
if (!CLIENT_ID || !HASH) throw new Error('client id or query hash not found in the sources');

const WATCH = Number(opt('watch', 0));
const EVERY = Number(opt('every', WATCH ? 3 : 5)) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

const gql = async (body) => {
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
};

// the master's quality ladder, read the way the worker reads it: the NAME of each EXT-X-MEDIA group
const laddersOf = (text) => {
  const names = [];
  for (const line of text.split('\n')) {
    const hit = /^#EXT-X-MEDIA:.*?NAME="([^"]+)"/.exec(line.trim());
    if (hit && !names.includes(hit[1])) names.push(hit[1]);
  }
  return names;
};
const topVariantUrl = (text) => {
  const lines = text.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:') && lines[i + 1] && !lines[i + 1].startsWith('#')) return lines[i + 1];
  }
  return null;
};

// one fresh token, its master and the state of its top variant's playlist right now
async function probe(channel, playerType, platform) {
  const row = { platform, playerType, label: platform + '/' + playerType, ladder: [] };
  try {
    const variables = { isLive: true, login: channel, isVod: false, vodID: '', playerType, platform };
    const answer = await gql({ operationName: 'PlaybackAccessToken', variables, extensions: { persistedQuery: { version: 1, sha256Hash: HASH } } });
    const access = answer && answer.data && answer.data.streamPlaybackAccessToken;
    if (!access) throw new Error((answer && answer.errors && answer.errors[0] && answer.errors[0].message) || 'no token');
    const flags = JSON.parse(access.value);
    row.token = access.value;
    row.signature = access.signature;
    row.flags = [flags.show_ads, flags.server_ads, flags.hide_ads].map((v) => (v ? 'Y' : 'n')).join('/');
    // the token can silently ignore what we asked for: report what it actually says it is
    row.got = flags.player_type === playerType && flags.platform === platform ? '' : ` (token says ${flags.player_type}/${flags.platform})`;
    const url =
      'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8?allow_source=true&fast_bread=true&p=' +
      Math.floor(Math.random() * 1e7) + '&player_backend=mediaplayer&playlist_include_framerate=true&reassignments_supported=false&sig=' +
      encodeURIComponent(access.signature) + '&supported_codecs=avc1&token=' + encodeURIComponent(access.value);
    const master = await fetch(url);
    if (!master.ok) throw new Error('usher ' + master.status);
    const text = await master.text();
    row.ladder = laddersOf(text);
    const variant = topVariantUrl(text);
    if (variant) {
      const media = await fetch(variant);
      if (media.ok) {
        const playlist = await media.text();
        row.ads = /twitch-stitched-ad/.test(playlist) ? 'AD' : /twitch-maf-ad/.test(playlist) ? 'maf' : 'clean';
      }
    }
  } catch (e) {
    row.error = String((e && e.message) || e).slice(0, 60);
  }
  return row;
}

let channel = opt('twitch', null);
if (!channel) {
  const top = await gql({ query: '{ streams(first: 1) { edges { node { broadcaster { login } } } } }' });
  channel = top.data.streams.edges[0].node.broadcaster.login;
}

const hasFullLadder = (row) => (row.ladder || []).some((name) => /^(1080|936|900|864|720)/.test(name));

if (!WATCH) {
  const TYPES = opt('types', 'site,popout,frontpage,mobile_web,embed,autoplay,picture-by-picture').split(',');
  const PLATFORMS = opt('platforms', 'web,android,ios').split(',');
  console.log(`[ladders] channel ${channel}, ${TYPES.length} player types x ${PLATFORMS.length} platforms, all asked for at the same instant`);
  console.log('');
  console.log('platform  player_type          flags(show/server/hide)  ladder');
  const combos = [];
  for (const platform of PLATFORMS) for (const playerType of TYPES) combos.push([playerType, platform]);
  const rows = await Promise.all(combos.map(([type, platform]) => probe(channel, type, platform)));
  for (const row of rows) {
    const ladder = row.error ? 'ERROR ' + row.error : row.ladder.join('/') + (row.ads ? '   [' + row.ads + ']' : '');
    console.log(`${row.platform.padEnd(9)} ${row.playerType.padEnd(20)} ${(row.flags || '-').padEnd(24)} ${ladder}${row.got || ''}`);
  }
  const ok = rows.filter((row) => !row.error);
  console.log('');
  console.log(`[ladders] full ladder: ${ok.filter(hasFullLadder).map((row) => row.label).join(', ') || 'none'}`);
  console.log(`[ladders] capped:      ${ok.filter((row) => !hasFullLadder(row)).map((row) => row.label + '(' + (row.ladder[0] || '?') + ')').join(', ') || 'none'}`);
  const stitched = ok.filter((row) => row.ads === 'AD');
  console.log(stitched.length
    ? `[ladders] stitched ad right now in: ${stitched.map((row) => row.label).join(', ')}`
    : '[ladders] no stitched ad anywhere right now: use --watch to catch a break for the immunity half');
} else {
  // The immunity half. Asking for every combination on a loop would create hundreds of viewing sessions and, worse,
  // a brand new session can be served a PREROLL of its own: in the snapshots of 2026-10-24 the only token carrying an
  // ad was whichever one was created first, which says nothing about a channel-wide pod. So: keep ONE ordinary
  // session open and poll its media playlist the way a player does (no new tokens), and only when the stitched ad
  // shows up there, ask for every combination at the same instant. A midroll pod is channel-wide, so an already
  // open session sees it.
  const WATCHED = opt('combos', 'site@web,popout@web,site@android,embed@android,site@ios,autoplay@android').split(',').map((combo) => combo.split('@'));
  const sentinel = await probe(channel, 'site', 'web');
  if (sentinel.error) throw new Error('cannot open the sentinel session: ' + sentinel.error);
  const master = await (await fetch(
    'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8?allow_source=true&fast_bread=true&p=' +
    Math.floor(Math.random() * 1e7) + '&player_backend=mediaplayer&playlist_include_framerate=true&reassignments_supported=false&sig=' +
    encodeURIComponent(sentinel.signature) + '&supported_codecs=avc1&token=' + encodeURIComponent(sentinel.token)
  )).text();
  const watchUrl = topVariantUrl(master);
  if (!watchUrl) throw new Error('no variant to watch');
  console.log(`[ladders] watching ${channel} for ${WATCH} s: one open session polled every ${EVERY / 1000} s, no new tokens until a break`);
  console.log(`[ladders] on a stitched ad, asks for ${WATCHED.map(([type, platform]) => platform + '/' + type).join(', ')} at the same instant`);
  const until = Date.now() + WATCH * 1000;
  let breaks = 0;
  let inBreak = false;
  while (Date.now() < until) {
    let playlist = '';
    try {
      const res = await fetch(watchUrl);
      playlist = res.ok ? await res.text() : '';
    } catch {
      playlist = '';
    }
    const stitched = /twitch-stitched-ad/.test(playlist);
    if (stitched && !inBreak) {
      inBreak = true;
      breaks++;
      const rows = await Promise.all(WATCHED.map(([type, platform]) => probe(channel, type, platform)));
      const ad = rows.filter((row) => row.ads === 'AD');
      const clean = rows.filter((row) => row.ads === 'clean');
      console.log(`${stamp()}  BREAK on the open session; fresh tokens: AD in ${ad.map((row) => row.label).join(', ') || 'none'}`);
      console.log(`${stamp()}    clean: ${clean.map((row) => row.label + ' @' + (row.ladder[0] || '?')).join(', ') || 'none'}`);
      const prize = clean.filter(hasFullLadder);
      console.log(`${stamp()}    clean AND full ladder: ${prize.map((row) => row.label).join(', ') || 'NONE (autoplay stays the only way out)'}`);
    } else if (!stitched && inBreak) {
      inBreak = false;
      console.log(`${stamp()}  break over on the open session`);
    }
    await sleep(EVERY);
  }
  console.log(`[ladders] done: ${breaks} breaks seen`);
}
