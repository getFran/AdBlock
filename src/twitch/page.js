// Twitch probe, page side (MAIN world, document_start, declared in the manifest).
//
// Ported from Purple Ads Blocker by Arthur Bolsoni, https://github.com/arthurbolsoni/Purple-adblock
// (Apache License 2.0): serviceWorker/src/index.ts (the Worker subclass that prepends code to the player's
// worker script, and the rule that nothing of ours reaches the worker before the player's first message),
// page/fetch-hook.ts (the GQL headers the backup token requests reuse) and page/gql-bridge.ts (GQL
// requests run by the page for the worker). Reduced to what the probe needs: no blocking is done here.
//
// What this does on twitch.tv:
//   1. Wraps window.fetch to remember the headers of the page's own gql.twitch.tv requests
//      (Client-Integrity, X-Device-Id, Authorization, Client-Version, Client-Session-Id).
//   2. Replaces window.Worker: the player's worker script is read synchronously and recreated as a blob
//      with the worker-side hook (src/twitch/worker.js) prepended, so the hook sees every playlist fetch.
//   3. Answers the worker's requests: GQL calls (run with the page's original fetch and headers) and
//      log lines, which go to the console under the [AdBlock/twitch] tag and to window.__adblockTwitch.

const WORKER_CODE = __WORKER_CODE__;
const TAG = '[AdBlock/twitch]';
const GQL_HOST = 'gql.twitch.tv';
const GQL_HEADERS = ['Client-Integrity', 'X-Device-Id', 'Authorization', 'Client-Version', 'Client-Session-Id'];
const ALIASES = { 'X-Device-Id': ['Device-ID'] };

(function () {
  if (window.__adblockTwitch) return;
  const state = (window.__adblockTwitch = { workers: 0, hookedWorkers: 0, gqlHeaders: [], classes: {}, masters: [], breaks: [], probes: [], log: [] });
  const originalFetch = window.fetch;
  const NativeWorker = window.Worker;
  const workers = new Set();
  let knownHeaders = {};

  function log(...args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    state.log.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (state.log.length > 2000) state.log.splice(0, state.log.length - 2000);
    console.log(TAG, ...args);
  }

  const urlOf = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url) || '';
  const isGql = (input) => {
    try {
      return new URL(urlOf(input), location.href).host === GQL_HOST;
    } catch {
      return false;
    }
  };

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
      // never let the probe break the page's request
    }
    return originalFetch.apply(this, arguments);
  };

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

  function onWorkerMessage(worker, event) {
    const data = event && event.data;
    if (!data || typeof data !== 'object' || !data.adblock) return;
    switch (data.adblock) {
      case 'log':
        log(...(data.args || []));
        break;
      case 'classes':
        for (const c of data.classes || []) state.classes[c] = (state.classes[c] || 0) + 1;
        break;
      case 'master':
        state.masters.push(data.info);
        break;
      case 'break':
        state.breaks.push(data.info);
        break;
      case 'probe':
        state.probes.push(data.result);
        if (console.table) console.table(data.result.results);
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
      this.__adblock = { started: false, queue: [] };
      state.workers++;
      state.hookedWorkers++;
      workers.add(this);
      this.addEventListener('message', (event) => onWorkerMessage(this, event));
      log('worker hooked (' + script.length + ' bytes):', String(url).slice(0, 100));
    }

    // The page's own messages (the player's RPC). Nothing from us reaches the worker before the first one:
    // Purple saw a message sent earlier kill the player worker.
    postMessage(message, ...rest) {
      super.postMessage(message, ...rest);
      const a = this.__adblock;
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

    terminate() {
      workers.delete(this);
      super.terminate();
    }
  }
  window.Worker = HookedWorker;

  log('page hook installed');
})();
