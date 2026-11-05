// Summarises the Twitch break records the development build drops in Downloads\AdBlock\ (one per stitched break).
// Each record carries every break of its tab so far, each with its own window of video samples (5 s before to 30 s
// after; records before 2026-11-04 only had the tab's last 300 s): a break is read from the first record that
// contains its end, which is the one written 20 s after it when it was not clean. Usage:
//   node test/twitch-records.mjs [dir] [--since=YYYY-MM-DD] [--verbose]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'AdBlock');
const since = (args.find((a) => a.startsWith('--since=')) || '').slice(8);
const verbose = args.includes('--verbose');

const files = fs.readdirSync(dir).filter((f) => f.startsWith('twitch-') && f.endsWith('.json')).sort();
const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);
const runs = (list, key) => {
  const out = [];
  for (const item of list) {
    const k = key(item);
    if (out.length && out[out.length - 1].k === k) out[out.length - 1].n++;
    else out.push({ k, n: 1 });
  }
  return out;
};

const seen = new Set();
let shown = 0;
for (const file of files) {
  if (since && file.slice(7, 17) < since) continue;
  const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const fresh = (r.breakEnds || []).filter((b) => !seen.has(r.url + '#' + b.at));
  if (!fresh.length) continue;
  console.log(`\n=== ${file}  v${r.version}  ${r.url}  reason=${r.reason}  workers=${r.hookedWorkers}/${r.workers}  csai=${JSON.stringify(r.csaiBlocked)}  masters=${(r.masters || []).length}`);
  for (const b of fresh) {
    seen.add(r.url + '#' + b.at);
    shown++;
    const end = b.endedAt || b.at;
    const w0 = b.at - 5000, w1 = end + 30000;
    const ev = (r.events || []).filter((e) => e.at >= b.at - 10000 && e.at <= end + 60000);
    const counts = {};
    for (const e of ev) counts[e.type] = (counts[e.type] || 0) + 1;
    const maxAd = Math.max(0, ...ev.filter((e) => e.type === 'adDetected').map((e) => e.adSegments));
    // off quality is against the variant the player polled at the time (`player`, since 2026-11-05): a break's
    // `quality` is the one it began with, and a cold player climbs during a preroll (zeling, 2026-11-05: 360p to
    // 1080p60 four seconds into 42 s of autoplay@360p, and this read 0)
    const label = (x) => `${x.type}@${x.quality}${x.player && x.player !== x.quality ? ' for ' + x.player : ''}`;
    const chain = runs(b.backups || [], label);
    const offQuality = (b.backups || []).filter((x) => x.quality !== (x.player || b.quality)).length;
    const shifts = [...new Set((b.backups || []).map((x) => x.shift))];
    // the break's own samples (since 2026-11-04: attached 30 s after it ended, or cut at the save in its own record,
    // written 20 s after it) or the tab's ring, if it reaches back
    const own = b.samples && b.samples.length ? b.samples : null;
    const partial = own && b.samplesPartial;
    const samples = own || (r.samples || []).filter((s) => s.at >= w0 && s.at <= w1);
    const covered = own ? own[0].at <= w0 : r.samples && r.samples.length && r.samples[0].at <= w0;
    // stalls: consecutive visible, unpaused samples whose clock (or decoded frames, with the clock moving) does not advance
    let clockRun = 0, clockMax = 0, picRun = 0, picMax = 0, paused = 0, lowReady = 0, adUi = 0, hidden = 0, errs = 0, videos = 0;
    for (let i = 1; i < samples.length; i++) {
      const p = samples[i - 1], s = samples[i];
      if (s.paused) paused++;
      if (s.ready < 3) lowReady++;
      if (s.adUi && s.adUi.length) adUi++;
      if (s.vis === false) hidden++;
      if (s.err) errs++;
      videos = Math.max(videos, s.videos || 0);
      const active = !s.paused && s.vis !== false;
      clockRun = active && s.t === p.t ? clockRun + 1 : 0;
      picRun = active && s.t > p.t && s.frames === p.frames ? picRun + 1 : 0;
      clockMax = Math.max(clockMax, clockRun);
      picMax = Math.max(picMax, picRun);
    }
    const widths = runs(samples, (s) => s.w).map((x) => `${x.k}x${x.n}`).join(' ');
    const restarts = (r.restarts || []).filter((x) => x.at >= b.at && x.at <= end + 60000);
    const dur = b.durationMs != null ? Math.round(b.durationMs / 1000) : '?';
    console.log(`\n--- ${hhmmss(b.at)}Z ${b.channel} ${b.quality} ${b.rollType} pod=${b.podLength} dur=${dur}s adSeg<=${maxAd} resumed=${b.resumed}`);
    console.log(`    polls=${b.polls} swapped=${b.swapped} held=${b.held} merged=${b.merged} blanked=${b.blanked} passed=${b.passed || 0} blankListed=${b.blankListed} blankAnswered=${b.blankAnswered}  shifts=${shifts.join('/')}  offQuality=${offQuality}  sourceChanges=${chain.length - 1}`);
    console.log(`    chain: ${chain.map((x) => `${x.k}x${x.n}`).join(' > ')}`);
    console.log(`    events: ${JSON.stringify(counts)}`);
    for (const e of ev) if (['PlayerError', 'PlayerRecoverableError', 'playerState', 'sequenceRestart', 'backupHeld', 'pageRebased', 'adUi', 'blankInserted', 'backupsAwaited', 'adPassedThrough', 'stallRestart'].includes(e.type)) console.log(`      ${hhmmss(e.at)} ${e.type} ${JSON.stringify({ ...e, type: undefined, at: undefined })}`);
    if (!samples.length) console.log('    samples: NONE in window');
    else console.log(`    samples=${samples.length}${partial ? ' (cut at the save)' : ''} covered=${!!covered} clockStill<=${clockMax}s pictureStill<=${picMax}s paused=${paused} ready<3=${lowReady} adUi=${adUi} hidden=${hidden} err=${errs} videos<=${videos} frames ${samples[0].frames}->${samples[samples.length - 1].frames}  t ${samples[0].t.toFixed(1)}->${samples[samples.length - 1].t.toFixed(1)}`);
    if (samples.length) console.log(`    width: ${widths}`);
    for (const x of restarts) console.log(`    RESTART ${hhmmss(x.at)} ${JSON.stringify(x)}`);
    if (verbose) for (const x of b.backups || []) console.log(`      ${hhmmss(x.at)} ${label(x)} +${x.shift}`);
  }
}
console.log(`\n${shown} breaks in ${files.length} files`);
