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
//   4. After a break, if the video stands still for a few seconds while not paused, one pause/play and, if still
//      stuck, one soft reload of the player. Nothing otherwise: the worker's playlists are what keep it playing.

const WORKER_CODE = __WORKER_CODE__;
const TAG = '[AdBlock/twitch]';
const GQL_HOST = 'gql.twitch.tv';
const ADS_HOST = 'edge.ads.twitch.tv';
const GQL_HEADERS = ['Client-Integrity', 'X-Device-Id', 'Authorization', 'Client-Version', 'Client-Session-Id'];
const ALIASES = { 'X-Device-Id': ['Device-ID'] };
const STALL_MS = 6000; // the video still this long after a break, not paused: a restart
const WATCH_MS = 30000; // how long after a break's end the guard watches

(function () {
  if (window.__adblockTwitch) return;
  const state = (window.__adblockTwitch = {
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
    log: [],
  });
  const originalFetch = window.fetch;
  const NativeWorker = window.Worker;
  const workers = new Set();
  let knownHeaders = {};

  function log(...args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    state.log.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (state.log.length > 3000) state.log.splice(0, state.log.length - 3000);
    console.log(TAG, ...args);
  }
  // the worker's own lines (already on the console from the worker) only go to the record
  function record(...args) {
    state.log.push(new Date().toISOString().slice(11, 23) + ' [worker] ' + args.join(' '));
    if (state.log.length > 3000) state.log.splice(0, state.log.length - 3000);
  }
  function emit(type, data) {
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

  // the worker's script, read synchronously so the hook is in place before the worker starts
  function readScript(url) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send();
      return xhr.status >= 200 && xhr.status < 300 && typeof xhr.responseText === 'string' ? xhr.responseText : null;
    } catch {
      return null;
    }
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
  // After the worker reports the end of a break the video must move again. Still for STALL_MS while not paused: one
  // pause/play (Purple's E6, through the worker's RPC); still stuck STALL_MS later: one soft reload. Once each.
  function guardAfterBreak(worker, info) {
    if (guard) clearInterval(guard);
    const started = Date.now();
    let last = null;
    let lastMoved = Date.now();
    let restarted = false;
    let reloaded = false;
    guard = setInterval(() => {
      const v = mainVideo();
      const now = Date.now();
      if (v) {
        if (last === null || v.currentTime !== last) {
          last = v.currentTime;
          lastMoved = now;
        }
        const stuck = !v.paused && !v.ended && now - lastMoved >= STALL_MS;
        if (stuck && !restarted) {
          restarted = true;
          lastMoved = now;
          log('video still for ' + Math.round(STALL_MS / 1000) + ' s after the break (t=' + v.currentTime.toFixed(1) + ', readyState=' + v.readyState + '): pause/play');
          state.restarts.push({ at: now, kind: 'pause-play', t: v.currentTime, breakAt: info && info.at });
          emit('stallRestart', { kind: 'pause-play', t: v.currentTime });
          worker.rpc('pause');
          worker.rpc('play');
          worker.rpc('play');
        } else if (stuck && restarted && !reloaded) {
          reloaded = true;
          lastMoved = now;
          const ok = reloadTwitchPlayer();
          log('video still after the pause/play: soft reload of the player ' + (ok ? 'ran' : 'FAILED (player state not found)'));
          state.restarts.push({ at: now, kind: 'reload', ok, t: v.currentTime, breakAt: info && info.at });
          emit('stallRestart', { kind: 'reload', ok, t: v.currentTime });
        }
      }
      if (now - started > WATCH_MS) {
        clearInterval(guard);
        guard = null;
      }
    }, 1000);
  }

  function onWorkerMessage(worker, event) {
    const data = event && event.data;
    if (!data || typeof data !== 'object' || !data.adblock) return;
    switch (data.adblock) {
      case 'log':
        record(...(data.args || []));
        break;
      case 'event':
        if (data.event) {
          state.events.push(data.event);
          if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
        }
        break;
      case 'classes':
        for (const c of data.classes || []) state.classes[c] = (state.classes[c] || 0) + 1;
        break;
      case 'master':
        state.masters.push(data.info);
        break;
      case 'break':
        state.breaks.push(data.info);
        if (guard) {
          clearInterval(guard);
          guard = null;
        }
        break;
      case 'break-end':
        state.breakEnds.push(data.info);
        guardAfterBreak(worker, data.info);
        break;
      case 'blank':
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

  log('page hook installed');
})();
