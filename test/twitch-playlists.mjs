#!/usr/bin/env node
// Checks of the pure playlist pieces of src/twitch/worker.js on synthetic playlists shaped like the ones Purple's
// findings describe (a stitched midroll announced past the last segment, a preroll at MEDIA-SEQUENCE 0, a clean
// backup numbered from another base). No browser, no network:  node test/twitch-playlists.mjs
//
// The worker file is an IIFE over `self`; it is run here with a fake scope and the pieces it exports for tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(ROOT, 'src', 'twitch', 'worker.js'), 'utf8');
const scope = { fetch: async () => new Response(''), postMessage() {}, addEventListener() {} };
const quiet = { ...console, log() {} };
new Function('self', 'console', code)(scope, quiet);
const W = scope.__adblockTwitchWorker;
assert.ok(W, 'the worker did not export its pieces');

let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log('ok  ' + name);
};

const t0 = Date.parse('2026-10-15T18:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const HOST = 'https://sae12.playlist.ttvnw.net/v1/playlist/';
const CDN = 'https://video-edge-abc.sae12.abs.hls.ttvnw.net/v1/segment/';

// a live playlist: `count` segments of 2 s from `seq` at `start`, two prefetch lines, the usual DATERANGEs
function live({ seq, start, count = 14, prefetch = 2, extra = '', dur = 2 }) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6', '#EXT-X-MEDIA-SEQUENCE:' + seq, '#EXT-X-TWITCH-LIVE-SEQUENCE:' + seq];
  lines.push('#EXT-X-DATERANGE:ID="source-1",CLASS="twitch-stream-source",START-DATE="' + iso(start) + '",END-ON-NEXT="YES",X-TV-TWITCH-STREAM-SOURCE="live"');
  lines.push('#EXT-X-DATERANGE:ID="trigger-1",CLASS="twitch-trigger",START-DATE="' + iso(start) + '",END-ON-NEXT="YES",X-TV-TWITCH-TRIGGER-URL="https://video-weaver.example/trigger"');
  for (let i = 0; i < count; i++) {
    lines.push('#EXT-X-PROGRAM-DATE-TIME:' + iso(start + i * dur * 1000));
    lines.push('#EXTINF:' + dur.toFixed(3) + ',live');
    lines.push(CDN + 'live-' + (seq + i) + '.ts');
  }
  for (let i = 0; i < prefetch; i++) lines.push('#EXT-X-TWITCH-PREFETCH:' + CDN + 'live-' + (seq + count + i) + '.ts');
  if (extra) lines.push(extra);
  return lines.join('\n') + '\n';
}

// the same with the last `ads` segments stitched: titles Amazon|..., inside a twitch-stitched-ad range, source Amazon
function stitched({ seq, start, liveCount, ads, podId = 'pod-1' }) {
  const adStart = start + liveCount * 2000;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6', '#EXT-X-MEDIA-SEQUENCE:' + seq, '#EXT-X-TWITCH-LIVE-SEQUENCE:' + seq];
  lines.push('#EXT-X-DATERANGE:ID="source-1",CLASS="twitch-stream-source",START-DATE="' + iso(start) + '",END-ON-NEXT="YES",X-TV-TWITCH-STREAM-SOURCE="live"');
  lines.push('#EXT-X-DATERANGE:ID="stitched-ad-' + podId + '",CLASS="twitch-stitched-ad",START-DATE="' + iso(adStart) + '",DURATION=' + (ads * 2 + 0.234).toFixed(3) + ',X-TV-TWITCH-AD-ROLL-TYPE="MIDROLL",X-TV-TWITCH-AD-POD-LENGTH="1",X-TV-TWITCH-AD-AD-SESSION-ID="s1"');
  lines.push('#EXT-X-DATERANGE:ID="quartile-1",CLASS="twitch-ad-quartile",START-DATE="' + iso(adStart) + '",DURATION=1.000,X-TV-TWITCH-AD-QUARTILE="1"');
  lines.push('#EXT-X-DATERANGE:ID="source-2",CLASS="twitch-stream-source",START-DATE="' + iso(adStart) + '",END-ON-NEXT="YES",X-TV-TWITCH-STREAM-SOURCE="Amazon|123"');
  for (let i = 0; i < liveCount; i++) {
    lines.push('#EXT-X-PROGRAM-DATE-TIME:' + iso(start + i * 2000));
    lines.push('#EXTINF:2.000,live');
    lines.push(CDN + 'live-' + (seq + i) + '.ts');
  }
  lines.push('#EXT-X-DISCONTINUITY');
  for (let i = 0; i < ads; i++) {
    lines.push('#EXT-X-PROGRAM-DATE-TIME:' + iso(adStart + i * 2000));
    lines.push('#EXTINF:2.000,Amazon|123');
    lines.push(CDN + 'ad-' + i + '.ts');
  }
  return lines.join('\n') + '\n';
}

check('a live playlist has no ads and no marker', () => {
  const d = W.detectAds(live({ seq: 4680, start: t0 }));
  assert.equal(d.class, 'NONE');
  assert.deepEqual(d.adSegments, []);
  assert.equal(W.newestNumber(live({ seq: 4680, start: t0 })), 4680 + 14 + 2 - 1);
});

check('a twitch-maf-ad slot over live segments is MARKED_LIVE and a clean backup', () => {
  const text = live({ seq: 10, start: t0, extra: '#EXT-X-DATERANGE:ID="maf-1",CLASS="twitch-maf-ad",START-DATE="' + iso(t0) + '",PLANNED-DURATION=60.000,END-ON-NEXT="YES",X-TTV-MAF-AD-PRIMARY-POD="6"' });
  assert.equal(W.detectAds(text).class, 'MARKED_LIVE');
  assert.equal(W.isCleanBackup(text), true);
  assert.deepEqual(W.blankAds(text, [], HOST + 'x.m3u8').uris, []);
});

check('a stitched midroll: the ad segments by title, range and source; the backup with its own announcement is not clean', () => {
  const text = stitched({ seq: 100, start: t0, liveCount: 10, ads: 4 });
  const d = W.detectAds(text);
  assert.equal(d.class, 'SSAI');
  assert.deepEqual(d.adSegments, [10, 11, 12, 13]);
  assert.equal(W.isCleanBackup(text), false);
  // the same break announced past the last segment (B-034): live segments only, prefetch lines to the first ad segments
  const announced = live({ seq: 100, start: t0, count: 14, prefetch: 0 }) + '#EXT-X-TWITCH-PREFETCH:' + CDN + 'live-114.ts\n' + '#EXT-X-DATERANGE:ID="stitched-ad-pod-2",CLASS="twitch-stitched-ad",START-DATE="' + iso(t0 + 15 * 2000) + '",DURATION=8.234,X-TV-TWITCH-AD-ROLL-TYPE="MIDROLL"\n' + '#EXT-X-DISCONTINUITY\n' + '#EXT-X-TWITCH-PREFETCH:' + CDN + 'ad-0.ts\n' + '#EXT-X-TWITCH-PREFETCH:' + CDN + 'ad-1.ts\n';
  const da = W.detectAds(announced);
  assert.equal(da.class, 'MARKED_LIVE');
  assert.equal(W.isCleanBackup(announced), false);
  const blanked = W.blankAds(announced, [], HOST + 'x.m3u8');
  assert.deepEqual(blanked.uris, [CDN + 'ad-0.ts', CDN + 'ad-1.ts']);
  assert.ok(!blanked.text.includes('ad-0.ts') && blanked.text.includes('live-114.ts'), 'only the prefetch lines after the announcement go');
  assert.ok(!blanked.text.includes('#EXT-X-DISCONTINUITY'), "the ad's DISCONTINUITY after the announcement goes too");
  const inside = W.blankAds(stitched({ seq: 100, start: t0, liveCount: 10, ads: 4 }), [10, 11, 12, 13], HOST + 'x.m3u8');
  assert.ok(inside.text.includes('#EXT-X-DISCONTINUITY'), 'a DISCONTINUITY before listed segments stays');
  assert.ok(W.stripAdDateranges(blanked.text).includes('twitch-trigger') && !W.stripAdDateranges(blanked.text).includes('twitch-stitched-ad'));
});

check('merge by date-time replaces every ad segment that a backup covers, keeps the count and the tags', () => {
  const main = stitched({ seq: 100, start: t0, liveCount: 10, ads: 4 });
  // the backup numbers the same moments from another base and its boundaries are 0.9 s earlier (B-054)
  const backup = live({ seq: 5000, start: t0 + 8 * 2000 - 900, count: 14 });
  const merged = W.mergeWithBackups([main, backup]);
  assert.equal(merged.replaced, 4);
  assert.deepEqual(merged.remaining, []);
  // the replaced segments still sit inside the stitched-ad range and under the Amazon stream source: the delivered text
  // is the merge with the ad's own DATERANGE lines stripped (F-20), and only then no segment reads as an ad
  assert.equal(W.detectAds(merged.text).class, 'SSAI', 'before the strip, range and source still mark them');
  assert.equal(W.detectAds(W.stripAdDateranges(merged.text)).class, 'NONE');
  assert.equal(merged.text.split('\n').filter((l) => l.startsWith('#EXTINF')).length, 14);
  assert.ok(merged.text.includes('#EXT-X-DISCONTINUITY') && merged.text.includes('#EXT-X-MEDIA-SEQUENCE:100'));
  assert.ok(!merged.text.includes('Amazon|123\n' + CDN + 'ad-'), 'no ad URI listed');
  // a backup that starts after the ads covers none of them: all remain, and blankAds lists their URIs
  const late = live({ seq: 5000, start: t0 + 20 * 2000, count: 14 });
  const none = W.mergeWithBackups([main, late]);
  assert.equal(none.replaced, 0);
  assert.deepEqual(none.remaining, [10, 11, 12, 13]);
  const blanked = W.blankAds(none.text, none.remaining, HOST + 'x.m3u8');
  assert.deepEqual(blanked.uris, [0, 1, 2, 3].map((i) => CDN + 'ad-' + i + '.ts'));
  assert.equal(blanked.segments, 4);
  assert.ok(blanked.text.includes(CDN + 'ad-0.ts'), 'the lines stay: the URI is answered blank by the fetch hook');
});

check('sequence alignment: the backup gets the numbers the page gives the same moment', () => {
  const page = live({ seq: 4700, start: t0, count: 14 });
  const reference = W.sequenceReference(page);
  assert.deepEqual(reference, { sequence: 4713, time: t0 + 13 * 2000, duration: 2 });
  // backup from a base 3 segments lower, segment boundaries 0.9 s later (B-054, soak h)
  const backup = live({ seq: 4700 + 10 - 3, start: t0 + 10 * 2000 + 900, count: 14 });
  const shift = W.sequenceShift(backup, reference);
  assert.equal(shift, 4, 'the backup segment starting inside page segment 4723 gets 4724: +4 over its own 4720');
  const shifted = W.shiftSequence(backup, shift);
  assert.ok(shifted.includes('#EXT-X-MEDIA-SEQUENCE:' + (4707 + 4)) && shifted.includes('#EXT-X-TWITCH-LIVE-SEQUENCE:4707'));
  assert.equal(W.sequenceShift(live({ seq: 4700, start: t0, count: 14 }), reference), 0, 'same base: no shift');
  // a preroll at MEDIA-SEQUENCE 0 with ad segments only has no reference
  const preroll = stitched({ seq: 0, start: t0, liveCount: 0, ads: 3 });
  assert.equal(W.sequenceReference(preroll, true), null);
  assert.equal(W.newestNumber(preroll), 2);
});

check('page rebase: after a break the page gets the numbers that continue the last delivery', () => {
  // caedrel247, 2026-10-19 15:07: live segments of 1 s, ad segments of 2 s; the last backup delivered ends at 91146
  // (15:07:15.890) and the page comes back with its 91127 at 15:07:17.595, 19 numbers behind
  const t = Date.parse('2026-10-19T15:06:47.890Z');
  const delivered = live({ seq: 91118, start: t, count: 29, dur: 1 });
  const page = live({ seq: 91098, start: t + 705, count: 30, dur: 1 });
  assert.equal(W.pageRebase(page, delivered), 21, 'the page segment starting inside 91147 gets 91148: +21 over its own 91127');
  const rebased = W.shiftSequence(page, 21);
  assert.ok(rebased.includes('#EXT-X-MEDIA-SEQUENCE:' + (91098 + 21)) && rebased.includes('#EXT-X-TWITCH-LIVE-SEQUENCE:91098'));
  assert.equal(W.newestNumber(rebased), 91148 + 2, 'two prefetch lines past 91148');
  // ibai, 2026-10-18 18:46: segments of 2 s on both sides, the page two numbers past the delivery as live HLS goes
  const same = live({ seq: 2129, start: t0, count: 29 });
  assert.equal(W.pageRebase(live({ seq: 2130, start: t0 + 840, count: 30 }), same), 0, 'the page already continues the delivery');
  // caedrel, 2026-10-22 13:04: a pod of 5 with short ad segments left the page 3 numbers ahead of the delivery
  const ahead = live({ seq: 6352, start: t0, count: 29 });
  assert.equal(W.pageRebase(live({ seq: 6356, start: t0 + 1557, count: 30 }), ahead), -3, 'pulled back to the delivery');
  // nothing to go by: no dated segment on one side
  assert.equal(W.pageRebase(page, '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:5\n'), null);
});

check('variants: the page v2 master and a backup v1 master, picked by quality and codec family', () => {
  const v2 = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",IVS-NAME="720p60",FRAME-RATE=60', HOST + 'a.m3u8', '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,CODECS="avc1.4D401F,mp4a.40.2",IVS-NAME="360p30"', HOST + 'b.m3u8'].join('\n');
  const v1 = ['#EXTM3U', '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES', '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked"', HOST + 'c.m3u8', '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES', '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60"', HOST + 'd.m3u8'].join('\n');
  const page = W.parseVariants(v2);
  assert.deepEqual(page.map((v) => v.name), ['720p60', '360p30']);
  const backup = W.parseVariants(v1);
  assert.deepEqual(backup.map((v) => v.name), ['1080p60 (source)', '720p60']);
  assert.equal(W.pickVariant(backup, { quality: page[0].name, resolution: page[0].resolution, codecs: page[0].codecs }).url, HOST + 'd.m3u8');
  assert.equal(W.pickVariant(backup, { quality: '1080p60' }).url, HOST + 'c.m3u8', 'the (source) suffix does not matter');
  assert.equal(W.pickVariant(backup, { quality: '480p30', resolution: '852x480', codecs: 'avc1.4D401F' }).url, HOST + 'c.m3u8', 'no match: the best of the same family');
});

check('summarize reports the roll type and the ad segment count for the logs', () => {
  const s = W.summarize(stitched({ seq: 100, start: t0, liveCount: 10, ads: 4 }));
  assert.equal(s.cls, 'SSAI');
  assert.equal(s.rollType, 'MIDROLL');
  assert.equal(s.adSegments, 4);
  assert.equal(s.segments, 14);
  assert.equal(s.mediaSequence, 100);
});

console.log(checks + ' checks passed');
