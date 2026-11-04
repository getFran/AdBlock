// Twitch ad blocking, page side (MAIN world, document_start, declared in the manifest).
//
// Ported from Purple Ads Blocker by Arthur Bolsoni, https://github.com/arthurbolsoni/Purple-adblock
// (Apache License 2.0), serviceWorker/src/ as of 2026-10-10: index.ts (the Worker subclass that prepends our code to
// the player's worker script, the rule that nothing of ours reaches the worker before the player's first message, and
// the id of the first player created in a worker for pause/play, C-13), page/fetch-hook.ts (the GQL headers the
// backup token requests reuse; edge.ads.twitch.tv answered empty, F-04), page/xhr-hook.ts (the same for XHR),
// page/gql-bridge.ts (GQL requests run by the page for the worker) and page/player-reload.ts (the soft reload, from
// TwitchAdSolutions' vaft script, MIT, notice below).
//
// What this does on twitch.tv:
//   1. Wraps window.fetch and XMLHttpRequest: requests to edge.ads.twitch.tv (the client-side ad, CSAI, asked during a
//      twitch-maf-ad slot) are answered with an empty 200 without touching the network; the headers of the page's own
//      gql.twitch.tv requests (Client-Integrity, X-Device-Id, Authorization, Client-Version, Client-Session-Id) are
//      remembered for the worker's backup tokens.
//   2. Replaces window.Worker: the player's worker script is read synchronously and recreated as a blob with the
//      worker-side code (src/twitch/worker.js) prepended, so the hook owns the worker's fetch from its first line.
//   3. Answers the worker: GQL calls (run with the page's original fetch and headers), pause/play (sent to the worker
//      as the player's own RPC), and its log and events, which go to the console under [AdBlock/twitch] and to
//      window.__adblockTwitch (breaks, events, blank URIs, csaiBlocked, log) as the evidence when something fails.
//   4. After a break, if the video stands still for a few seconds while not paused, or never got any data at all
//      (readyState 0 at 0 s: a player born inside a preroll that nothing started, 2026-10-25 and 31), one pause/play
//      and, if still stuck, one soft reload of the player. Nothing otherwise: the worker's playlists are what keep it playing.
//
// A release build (__RELEASE__, build.mjs --release) keeps 1, 2, the GQL/pause/play answers of 3 and the guard of 4;
// the console, window.__adblockTwitch, the samples and the record are development only.

const WORKER_CODE = __WORKER_CODE__;
const TAG = '[AdBlock/twitch]';
const GQL_HOST = 'gql.twitch.tv';
const ADS_HOST = 'edge.ads.twitch.tv';
const GQL_HEADERS = ['Client-Integrity', 'X-Device-Id', 'Authorization', 'Client-Version', 'Client-Session-Id'];
const ALIASES = { 'X-Device-Id': ['Device-ID'] };
const STALL_MS = 6000; // the clock or the picture still this long, tab visible, not paused: a restart
const WATCH_MS = 60000; // how long after a break's end the guard keeps watching
const SAMPLE_KEEP = 900; // 15 min of one sample per second: video position, paused, readyState, ad UI
const AD_UI_RUN = 3; // Twitch's ad UI seen this many samples in a row makes a record
const SAVE_AFTER_BREAK_MS = 20000; // the record of a break waits for what the player does after it
const SAVE_MIN_GAP_MS = 60000; // at most one automatic record per minute
const DUMP_TIMEOUT_MS = 1500; // how long a record waits for the worker's playlists
const BREAK_SAMPLES_BEFORE_MS = 5000; // every break keeps its own window of samples, from this long before it began...
const BREAK_SAMPLES_AFTER_MS = 30000; // ...to this long after it ended: a record written long after it still carries them
const RECORD_MAX_BYTES = 8000000; // the record travels as a data URL to chrome.downloads: measured on 2026-11-04, a 48 MB one
// downloads fine from the service worker (the 2 MB limit is for navigations); 8 MB keeps a file readable and is only
// reached by a tab with many breaks, whose older playlists go first
// Twitch's ad UI, as vaft and Purple look for it
const AD_UI_SELECTORS = ['[data-a-target="video-ad-label"]', '[data-a-target="video-ad-countdown"]', '.video-ad-label', '[data-test-selector="ad-banner-default-text"]', '[data-a-target="player-ad-notice"]', '[data-a-target="ad-banner-default-text"]', '.stream-display-ad'];

(function () {
  if (!__RELEASE__ && window.__adblockTwitch) return;
  const state = {
    workers: 0,
    hookedWorkers: 0,
    gqlHeaders: [],
    classes: {},
    masters: [],
    breaks: [],
    breakEnds: [],
    events: [],
    blankUris: [],
    csaiBlocked: {},
    restarts: [],
    samples: [],
    saves: [],
    version: __EXT_VERSION__,
    log: [],
  };
  if (!__RELEASE__) window.__adblockTwitch = state;
  const originalFetch = window.fetch;
  const NativeWorker = window.Worker;
  const workers = new Set();
  let knownHeaders = {};

  function log(...args) {
    if (__RELEASE__) return;
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    state.log.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (state.log.length > 3000) state.log.splice(0, state.log.length - 3000);
    console.log(TAG, ...args);
  }
  // the worker's own lines (already on the console from the worker) only go to the record
  function record(...args) {
    if (__RELEASE__) return;
    state.log.push(new Date().toISOString().slice(11, 23) + ' [worker] ' + args.join(' '));
    if (state.log.length > 3000) state.log.splice(0, state.log.length - 3000);
  }
  function emit(type, data) {
    if (__RELEASE__) return;
    state.events.push({ type, at: Date.now(), ...(data || {}) });
    if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
  }

  const urlOf = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url) || '';
  const hostOf = (input) => {
    try {
      return new URL(urlOf(input), location.href).host;
    } catch {
      return '';
    }
  };
  const isGql = (input) => hostOf(input) === GQL_HOST;
  const isEdgeAds = (input) => hostOf(input) === ADS_HOST;

  // GQL_HEADERS of a request: the Request's own headers, then init's (init wins, as in fetch)
  function pickHeaders(input, init) {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init && init.headers).forEach((value, name) => headers.set(name, value));
    const found = {};
    for (const name of GQL_HEADERS) {
      const value = [name, ...(ALIASES[name] || [])].map((alias) => headers.get(alias)).find((v) => v);
      if (value) found[name] = value;
    }
    return found;
  }

  function broadcast(message) {
    for (const w of workers) w.sendFromAdblock(message);
  }

  // F-04: the client-side ad request, counted by break type (bp=preroll|midroll)
  function onCsaiBlocked(url, via) {
    let bp = 'other';
    try {
      bp = new URL(url, location.href).searchParams.get('bp') || 'other';
    } catch {
      // keep other
    }
    state.csaiBlocked[bp] = (state.csaiBlocked[bp] || 0) + 1;
    log('CSAI request answered empty (' + via + ', bp=' + bp + ', total ' + JSON.stringify(state.csaiBlocked) + '): ' + url.slice(0, 100));
    emit('csaiBlocked', { bp, via, url: url.slice(0, 200) });
  }

  // 1. page fetch hook
  window.fetch = function (input, init) {
    try {
      if (isGql(input)) {
        const merged = { ...knownHeaders, ...pickHeaders(input, init) };
        if (GQL_HEADERS.some((name) => merged[name] !== knownHeaders[name])) {
          knownHeaders = merged;
          state.gqlHeaders = Object.keys(merged);
          broadcast({ funcName: 'adblockGqlHeaders', value: merged });
        }
      }
    } catch {
      // never let this break the page's request
    }
    try {
      if (isEdgeAds(input)) {
        onCsaiBlocked(urlOf(input), 'fetch');
        return Promise.resolve(new Response('', { status: 200 }));
      }
    } catch {
      // the request goes as the page made it
    }
    return originalFetch.apply(this, arguments);
  };

  // 1b. the same for XHR: readyState, status and the body are read-only getters on the prototype; own properties shadow them
  (function installXhrHook() {
    const urls = new WeakMap();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        urls.set(this, String(url));
      } catch {
        // keep going
      }
      return open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const url = urls.get(this);
      try {
        if (url && isEdgeAds(url)) {
          const values = { readyState: 4, status: 200, statusText: 'OK', responseText: '', response: '', responseURL: url };
          for (const [name, value] of Object.entries(values)) Object.defineProperty(this, name, { configurable: true, value });
          setTimeout(() => {
            for (const type of ['readystatechange', 'load', 'loadend']) this.dispatchEvent(new Event(type));
          }, 0);
          onCsaiBlocked(url, 'xhr');
          return undefined;
        }
      } catch {
        // a failure here must not stop the page's request
      }
      return send.call(this, body);
    };
  })();

  // the worker's script, read synchronously so the hook is in place before the worker starts; a read that fails leaves
  // the whole tab unhooked until a reload, so it is tried three times
  function readScript(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.send();
        if (xhr.status >= 200 && xhr.status < 300 && typeof xhr.responseText === 'string') return xhr.responseText;
      } catch {
        // once more
      }
    }
    return null;
  }

  async function runGql({ id, body, headers }) {
    try {
      const response = await originalFetch.call(window, 'https://gql.twitch.tv/gql#origin=twilight', {
        method: 'POST',
        headers: { ...knownHeaders, ...headers },
        body,
      });
      return { id, status: response.status, body: await response.text() };
    } catch (e) {
      return { id, status: 0, error: String(e) };
    }
  }

  // --- the soft reload of the player, the last resort of the guard below --------------------------------
  // findReactNode and the root lookup in findReactRootNode are copied from TwitchAdSolutions' vaft script,
  // vaft/vaft-ublock-origin.js (getPlayerAndState), by way of Purple's page/player-reload.ts:
  //   by ryanbr, the maintained fork: https://github.com/ryanbr/TwitchAdSolutions/blob/74f1248f22a61fcbb559882f93cb60ca25b414e8/vaft/vaft-ublock-origin.js
  //   by pixeltris, the original project: https://github.com/pixeltris/TwitchAdSolutions
  // MIT License (TwitchAdSolutions: pixeltris/TwitchAdSolutions and its fork ryanbr/TwitchAdSolutions)
  // Copyright (c) 2020-present TwitchAdSolutions Contributors. Permission is hereby granted, free of charge, to any
  // person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the
  // Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
  // furnished to do so, subject to the following conditions: The above copyright notice and this permission notice
  // shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
  // WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
  // FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
  // OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  function findReactNode(root, constraint) {
    if (root.stateNode && constraint(root.stateNode)) return root.stateNode;
    let node = root.child;
    while (node) {
      const result = findReactNode(node, constraint);
      if (result) return result;
      node = node.sibling;
    }
    return null;
  }
  function findReactRootNode() {
    let reactRootNode = null;
    const rootNode = document.querySelector('#root');
    if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
      reactRootNode = rootNode._reactRootContainer._internalRoot.current;
    }
    if (reactRootNode == null && rootNode != null) {
      const containerName = Object.keys(rootNode).find((x) => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
      if (containerName != null) reactRootNode = rootNode[containerName];
    }
    return reactRootNode;
  }
  // true when the player state was found and setSrc ran (same player instance, same access token)
  function reloadTwitchPlayer() {
    try {
      const root = findReactRootNode();
      if (!root) return false;
      const playerState = findReactNode(root, (node) => node.setSrc && node.setInitialPlaybackSettings);
      if (!playerState) return false;
      const holder = findReactNode(root, (node) => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
      const instance = holder && holder.props && holder.props.mediaPlayerInstance;
      const player = (instance && instance.playerInstance) || instance;
      const group = player && player.core && player.core.state && player.core.state.quality && player.core.state.quality.group;
      if (group) localStorage.setItem('video-quality', JSON.stringify({ default: group }));
      playerState.setSrc({ isNewMediaPlayerInstance: false, refreshAccessToken: false });
      if (player && player.play) {
        const p = player.play();
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  // --- the guard after a break ----------------------------------------------------------------------------
  function mainVideo() {
    const videos = [...document.querySelectorAll('video')];
    videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
    return videos[0] || null;
  }

  let guard = null;
  // From the first poll with ad segments until WATCH_MS after the break's end, once a second: the clock (currentTime)
  // and the picture (decoded frames) must both move while the tab is visible and the video is not paused. Still for
  // STALL_MS: one pause/play (Purple's E6, through the worker's RPC); still STALL_MS later: one soft reload (vaft's
  // setSrc). Once each per break. A frozen picture with the clock running is what Fran saw on 2026-10-16. A video that
  // never got data (readyState 0, clock at 0, no frame decoded) counts even though it reads as paused: Twitch's player
  // has not called play yet, and no viewer holds a video there, since a paused video still buffers and its readyState
  // rises. That is how a player born inside a preroll sat black 38 s on 2026-10-25 and 5 min 20 s on 2026-10-31.
  function guardBreak(worker, info) {
    if (guard) clearInterval(guard.timer);
    const g = { worker, breakAt: info && info.at, endedAt: null, last: null, lastMoved: Date.now(), lastPainted: Date.now(), restarted: false, reloaded: false, timer: null };
    guard = g;
    g.timer = setInterval(() => {
      const v = mainVideo();
      const now = Date.now();
      if (v) {
        const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
        const frames = q ? q.totalVideoFrames : null;
        const t = v.currentTime;
        if (g.last === null || t !== g.last.t) g.lastMoved = now;
        if (g.last === null || frames === null || frames !== g.last.frames) g.lastPainted = now;
        g.last = { t, frames };
        const noData = v.readyState === 0 && t === 0 && !(frames > 0);
        const watching = document.visibilityState === 'visible' && !v.ended && (!v.paused || noData);
        const why = !watching ? null : now - g.lastMoved >= STALL_MS ? (noData ? 'no data' : 'clock') : now - g.lastPainted >= STALL_MS ? 'picture' : null;
        if (why && !g.restarted) {
          g.restarted = true;
          g.lastMoved = g.lastPainted = now;
          log('video ' + why + ' still for ' + Math.round(STALL_MS / 1000) + ' s (t=' + t.toFixed(1) + ', frames=' + frames + ', readyState=' + v.readyState + '): pause/play');
          state.restarts.push({ at: now, kind: 'pause-play', why, t, frames, breakAt: g.breakAt });
          emit('stallRestart', { kind: 'pause-play', why, t, frames });
          worker.rpc('pause');
          worker.rpc('play');
          worker.rpc('play');
        } else if (why && g.restarted && !g.reloaded) {
          g.reloaded = true;
          g.lastMoved = g.lastPainted = now;
          const ok = reloadTwitchPlayer();
          log('video ' + why + ' still after the pause/play: soft reload of the player ' + (ok ? 'ran' : 'FAILED (player state not found)'));
          state.restarts.push({ at: now, kind: 'reload', why, ok, t, frames, breakAt: g.breakAt });
          emit('stallRestart', { kind: 'reload', why, ok, t, frames });
        }
      }
      if (g.endedAt !== null && now - g.endedAt > WATCH_MS) {
        clearInterval(g.timer);
        if (guard === g) guard = null;
      }
    }, 1000);
  }

  // --- the record: what a session reads when an ad got through ---------------------------------------------
  // One sample per second of the main video and of Twitch's ad UI; a record 20 s after a stitched break ended, with
  // what the player did after it, but only when the break was not clean (breakFlaws below: about a hundred clean
  // breaks from 2026-10-16 to 26 made one file each, and from then on a file in Downloads/AdBlock/ means there is
  // something to read), when the ad UI stays visible, or by hand (window.__adblockTwitch.save()).
  // It goes to Downloads/AdBlock/<name>.json through twitch-bridge.js and the service worker.
  let adUiRun = 0;
  // frames: decoded video frames so far (getVideoPlaybackQuality). A clock that runs while frames stop is a picture
  // frozen on its last frame with the audio going on, which currentTime alone never shows (2026-10-16, pausenpaii)
  function sample() {
    try {
      const v = mainVideo();
      const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      const adUi = AD_UI_SELECTORS.filter((s) => document.querySelector(s));
      state.samples.push({
        at: Date.now(),
        t: v ? Math.round(v.currentTime * 10) / 10 : null,
        paused: v ? v.paused : null,
        ready: v ? v.readyState : null,
        frames: q ? q.totalVideoFrames : null,
        dropped: q ? q.droppedVideoFrames : null,
        w: v ? v.videoWidth : null,
        err: v && v.error ? v.error.code : 0,
        videos: document.querySelectorAll('video').length,
        vis: document.visibilityState === 'visible',
        adUi,
      });
      if (state.samples.length > SAMPLE_KEEP) state.samples.splice(0, state.samples.length - SAMPLE_KEEP);
      if (adUi.length) {
        adUiRun++;
        if (adUiRun === AD_UI_RUN) {
          log('Twitch ad UI visible: ' + adUi.join(', '));
          emit('adUi', { selectors: adUi });
          save('ad-ui');
        }
      } else {
        adUiRun = 0;
      }
    } catch {
      // never from a timer
    }
  }

  // What makes the record of a break worth writing: a preroll (the case still being watched), a held, merged, blanked
  // or passed-through poll, a backup off the player's quality, a player that stopped polling, a restart by the guard,
  // and in the samples since the break began while the tab was visible: the ad UI, a media error, the clock or the
  // picture still while not paused, or no picture at all (videoWidth 0: 2026-10-25 and 31, jaimemellado_, a preroll at
  // a channel change left the new player paused and black, 38 s and then 5 min 20 s)
  function breakFlaws(info) {
    const why = [];
    if (!info) return why;
    if (info.rollType === 'PREROLL') why.push('preroll');
    if (info.held) why.push('held ' + info.held);
    if (info.merged) why.push('merged ' + info.merged);
    if (info.blanked) why.push('blanked ' + info.blanked);
    if (info.passed) why.push('ad passed ' + info.passed);
    const off = (info.backups || []).filter((x) => x.quality !== info.quality).length;
    if (off) why.push(off + ' off quality');
    if (info.polls < 2 && info.durationMs > 10000) why.push(info.polls + ' poll(s) in ' + Math.round(info.durationMs / 1000) + ' s');
    if (state.restarts.some((r) => r.at >= info.at)) why.push('restart');
    const limit = STALL_MS / 1000;
    const longest = { still: 0, dark: 0 };
    let run = { still: 0, dark: 0 };
    let adUi = 0;
    let err = 0;
    let last = null;
    for (const s of state.samples) {
      if (s.at < info.at || !s.vis) {
        last = null;
        run = { still: 0, dark: 0 };
        continue;
      }
      if (s.adUi.length) adUi++;
      if (s.err) err++;
      const playing = last && !s.paused && !last.paused;
      const still = playing && (s.t === last.t || (s.frames != null && s.frames === last.frames));
      run.dark = s.w === 0 ? run.dark + 1 : 0;
      run.still = still ? run.still + 1 : 0;
      longest.dark = Math.max(longest.dark, run.dark);
      longest.still = Math.max(longest.still, run.still);
      last = s;
    }
    if (adUi) why.push('ad UI ' + adUi + ' s');
    if (err) why.push('media error');
    if (longest.still >= limit) why.push('still ' + longest.still + ' s');
    if (longest.dark >= limit) why.push('no picture ' + longest.dark + ' s');
    return why;
  }

  let lastSave = -Infinity;
  const pendingDumps = new Map(); // record name -> { finish, fallback }
  function save(reason) {
    const now = Date.now();
    if (reason !== 'manual' && reason !== 'verify' && now - lastSave < SAVE_MIN_GAP_MS) return null;
    lastSave = now;
    const name = 'twitch-' + new Date(now).toISOString().replace(/[:.]/g, '-') + '-' + reason + '.json';
    const finish = (dump) => {
      const record = {
        name,
        reason,
        at: new Date(now).toISOString(),
        url: location.href,
        version: state.version,
        userAgent: navigator.userAgent,
        workers: state.workers,
        hookedWorkers: state.hookedWorkers,
        gqlHeaders: state.gqlHeaders,
        classes: state.classes,
        masters: state.masters,
        breaks: state.breaks,
        breakEnds: state.breakEnds,
        events: state.events,
        blankUris: state.blankUris,
        csaiBlocked: state.csaiBlocked,
        restarts: state.restarts,
        samples: state.samples,
        worker: dump || null,
        log: state.log.slice(-1500),
      };
      let json = JSON.stringify(record);
      // Over budget, the playlists go first and the samples never. Until 2026-11-04 the budget was 1.2 MB, every record
      // was over it, and the trim cut the worker's 80 playlists to the 10 after the break (a held in the middle of it
      // had none left) and the samples to 300 s (a clean break read from the record of another, 20 min later, had none).
      // Now: the playlists of the earlier breaks (a break that was not clean had its own record with them), then the
      // worker's oldest down to 10, then the log; the last break's playlists, the samples and the events stay whole.
      if (json.length > RECORD_MAX_BYTES && record.breakEnds.length > 1) {
        record.breakEnds = record.breakEnds.map((b, i) => (i < record.breakEnds.length - 1 ? { ...b, playlists: [], playlistsTrimmed: (b.playlists || []).length } : b));
        json = JSON.stringify(record);
      }
      if (json.length > RECORD_MAX_BYTES && record.worker && record.worker.recent) {
        while (json.length > RECORD_MAX_BYTES && record.worker.recent.length > 10) {
          record.worker.recent.shift();
          json = JSON.stringify(record);
        }
      }
      if (json.length > RECORD_MAX_BYTES) {
        record.log = record.log.slice(-300);
        json = JSON.stringify(record);
      }
      window.postMessage({ source: 'adblock-twitch', type: 'save', name, json }, location.origin);
      state.saves.push({ at: now, reason, name, bytes: json.length });
      log('record ' + name + ' sent to Downloads/AdBlock/ (' + reason + ', ' + Math.round(json.length / 1024) + ' KB)');
    };
    // the main player's worker answers with playlists; an idle worker answers with none and is kept as the fallback
    const pending = { fallback: null };
    const timer = setTimeout(() => {
      if (pendingDumps.delete(name)) finish(pending.fallback);
    }, DUMP_TIMEOUT_MS);
    pending.finish = (dump) => {
      clearTimeout(timer);
      pendingDumps.delete(name);
      finish(dump);
    };
    pendingDumps.set(name, pending);
    let asked = 0;
    for (const w of workers) {
      if (w.__adblock && w.__adblock.started) {
        w.sendFromAdblock({ funcName: 'adblockDump', name });
        asked++;
      }
    }
    if (!asked) pending.finish(null);
    return name;
  }

  // what Twitch's player core tells the page: its state changes and anything that looks like an error, to the record
  let lastPlayerState = null;
  function notePlayerMessage(data) {
    try {
      const key = data.arg && data.arg.key;
      if (key === 'state' && data.arg.value !== lastPlayerState) {
        lastPlayerState = data.arg.value;
        emit('playerState', { value: String(data.arg.value).slice(0, 40) });
      } else if (/error/i.test(String(data.type || data.funcName || key || ''))) {
        emit('playerError', { type: String(data.type || data.funcName || key).slice(0, 60), value: JSON.stringify(data.arg || data.value || null).slice(0, 200) });
      }
    } catch {
      // never from the player's own traffic
    }
  }

  function onWorkerMessage(worker, event) {
    const data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (!data.adblock) {
      notePlayerMessage(data);
      return;
    }
    switch (data.adblock) {
      case 'log':
        record(...(data.args || []));
        break;
      case 'event':
        if (!__RELEASE__ && data.event) {
          state.events.push(data.event);
          if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
        }
        break;
      case 'classes':
        if (__RELEASE__) break;
        for (const c of data.classes || []) state.classes[c] = (state.classes[c] || 0) + 1;
        break;
      case 'master':
        if (!__RELEASE__) state.masters.push(data.info);
        break;
      case 'break':
        if (!__RELEASE__) state.breaks.push(data.info);
        guardBreak(worker, data.info);
        break;
      case 'break-end':
        if (!__RELEASE__) state.breakEnds.push(data.info);
        if (guard) guard.endedAt = Date.now();
        else guardBreak(worker, data.info);
        if (!__RELEASE__) {
          const info = data.info;
          // the break's own samples, so a record written long after it (a clean break makes none) still carries what
          // the viewer saw: 2026-11-04, two clean breaks of esportmaniacos read from a record 20 min later had none
          setTimeout(() => {
            const from = info.at - BREAK_SAMPLES_BEFORE_MS, to = (info.endedAt || info.at) + BREAK_SAMPLES_AFTER_MS;
            info.samples = state.samples.filter((s) => s.at >= from && s.at <= to);
          }, Math.max(0, (info.endedAt || Date.now()) + BREAK_SAMPLES_AFTER_MS - Date.now()));
          setTimeout(() => {
            const why = breakFlaws(info);
            const seconds = Math.round(((info && info.durationMs) || 0) / 1000);
            if (!why.length) {
              log('break of ' + seconds + ' s clean: no record');
              return;
            }
            log('break of ' + seconds + ' s not clean (' + why.join(', ') + '): record');
            emit('breakFlaws', { why });
            save('break');
          }, SAVE_AFTER_BREAK_MS);
        }
        break;
      case 'dump': {
        if (__RELEASE__) break;
        const pending = pendingDumps.get(data.name);
        if (!pending) break;
        if (data.dump && data.dump.recent && data.dump.recent.length) pending.finish(data.dump);
        else pending.fallback = pending.fallback || data.dump || null;
        break;
      }
      case 'blank':
        if (__RELEASE__) break;
        for (const uri of data.uris || []) if (!state.blankUris.includes(uri)) state.blankUris.push(uri);
        if (state.blankUris.length > 500) state.blankUris.splice(0, state.blankUris.length - 500);
        break;
      case 'pause':
      case 'play':
        worker.rpc(data.adblock);
        break;
      case 'gql':
        runGql(data).then((answer) => worker.sendFromAdblock({ funcName: 'adblockGqlResponse', value: answer }));
        break;
    }
  }

  // 2. Worker hook
  class HookedWorker extends NativeWorker {
    constructor(url, options) {
      const script = readScript(String(url));
      if (script === null) {
        super(url, options);
        state.workers++;
        log('worker NOT hooked, script unreadable:', String(url).slice(0, 100));
        return;
      }
      const blob = new Blob([WORKER_CODE, '\n', script], { type: 'text/javascript' });
      super(URL.createObjectURL(blob), options);
      // playerId: the first player the page creates in this worker (its "create" message); pause and play go to it.
      // A player created later in the same worker (the picture-by-picture one) does not take it (C-13).
      this.__adblock = { started: false, queue: [], playerId: 1, playerCreated: false };
      state.workers++;
      state.hookedWorkers++;
      workers.add(this);
      this.addEventListener('message', (event) => onWorkerMessage(this, event));
      log('worker hooked (' + script.length + ' bytes):', String(url).slice(0, 100));
    }

    // The page's own messages (the player's RPC). Nothing from us reaches the worker before the first one:
    // Purple saw a message sent earlier kill the player worker.
    postMessage(message, ...rest) {
      const a = this.__adblock;
      try {
        if (a && message && message.funcName === 'create' && message.id != null && !a.playerCreated) {
          a.playerId = message.id;
          a.playerCreated = true;
        }
        if (a && message && message.funcName === 'delete' && message.id === a.playerId) a.playerCreated = false;
      } catch {
        // keep going
      }
      super.postMessage(message, ...rest);
      if (a && !a.started) {
        a.started = true;
        if (Object.keys(knownHeaders).length) a.queue.push({ funcName: 'adblockGqlHeaders', value: knownHeaders });
        for (const m of a.queue) super.postMessage(m);
        a.queue = [];
      }
    }

    sendFromAdblock(message) {
      const a = this.__adblock;
      if (!a) return;
      if (a.started) super.postMessage(message);
      else a.queue.push(message);
    }

    // the player's own RPC into its worker: pause and play by the main player's id
    rpc(funcName) {
      const a = this.__adblock;
      if (!a || !a.started) return;
      super.postMessage({ funcName, args: undefined, id: a.playerId });
    }

    terminate() {
      workers.delete(this);
      super.terminate();
    }
  }
  window.Worker = HookedWorker;

  if (!__RELEASE__) {
    state.save = (reason) => save(reason || 'manual');
    setInterval(sample, 1000);
  }

  log('page hook installed');
})();
