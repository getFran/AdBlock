// YouTube record (MAIN world, document_start, installed before the rules of main.js so its hooks sit under theirs).
//
// The anti-adblock popup ("Ad blockers are not allowed on YouTube", ytd-enforcement-message-view-model) and the
// player's error screen only show up on accounts YouTube has flagged: a fresh profile never reproduces them, so the
// evidence has to come from Fran's own Chrome, and Fran does not copy anything from the console. Like the Twitch record,
// this keeps the last player/next responses as the page received them (before any pruning), watches the DOM for the
// popup and the error screen, and when one shows up (or by hand: window.__adblockYoutube.save()) sends a JSON through
// src/bridge.js to the service worker, which writes it to Downloads/AdBlock/youtube-<date>-<reason>.json.
//
// It changes nothing on the page: no blocking, no hiding, no clicks.

const RESPONSE_KEEP = 20;
const EVENT_KEEP = 200;
const LOG_KEEP = 300;
const SAVE_MIN_GAP_MS = 60000;
const SAVE_DELAY_MS = 3000; // after the popup appears, so the responses that came with it are in
const RECORD_MAX_BYTES = 1200000; // data URL through the service worker: Chrome's URL limit is 2 MB
const FINDING_MAX_BYTES = 20000;
const INTERESTING_URL = /youtubei\/v1\/(player|next|get_watch|reel\/reel_item_watch)/;
// keys kept whole: the popup's own, plus any openPopupAction whose content talks about ad blockers (the "are you still
// watching" popup also travels as an openPopupAction and is noise)
const INTERESTING_KEY = /enforcement|adblock|ad_block|auxiliaryUi/i;
const POPUP_KEY = /^openPopupAction$/;
const POPUP_TEXT = /enforcement|ad.?block/i;
const POPUP_SELECTOR = 'ytd-enforcement-message-view-model, yt-upsell-dialog-renderer, ytd-popup-container tp-yt-paper-dialog[aria-modal="true"]';
const ERROR_SELECTOR = 'yt-playability-error-supported-renderers#error-screen > *, #movie_player > .ytp-error';

export function installRecord(version) {
  if (window.__adblockYoutube) return window.__adblockYoutube;
  const state = (window.__adblockYoutube = {
    version,
    applied: [],
    failed: [],
    responses: [],
    events: [],
    saves: [],
    log: [],
    save: (reason) => save(reason || 'manual'),
  });
  const log = (...args) => {
    state.log.push(new Date().toISOString().slice(11, 23) + ' ' + args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' '));
    if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
    console.debug('[AdBlock/youtube]', ...args);
  };
  const safeJson = (v) => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  // --- what the page received: every /player and /next body, summarized, with any anti-adblock piece kept whole ----

  // Paths (up to depth 7) whose key looks like the popup or the ad-block machinery, with that subtree as JSON.
  function findings(root) {
    const out = [];
    const seen = new WeakSet();
    const walk = (node, pathStr, depth) => {
      if (!node || typeof node !== 'object' || depth > 7 || seen.has(node) || out.length >= 8) return;
      seen.add(node);
      for (const key of Object.keys(node)) {
        const p = pathStr ? pathStr + '.' + key : key;
        const value = node[key];
        if (INTERESTING_KEY.test(key) || (POPUP_KEY.test(key) && POPUP_TEXT.test(safeJson(value)))) {
          const json = safeJson(value);
          out.push({ path: p, json: json.length > FINDING_MAX_BYTES ? json.slice(0, FINDING_MAX_BYTES) + '…' : json });
          if (out.length >= 8) return;
          continue;
        }
        if (value && typeof value === 'object') walk(value, p, depth + 1);
      }
    };
    walk(root, '', 0);
    return out;
  }

  function summarize(url, via, data) {
    try {
      const player = data && (data.playabilityStatus ? data : data.playerResponse && data.playerResponse.playabilityStatus ? data.playerResponse : null);
      const ps = player && player.playabilityStatus;
      const entry = {
        at: new Date().toISOString(),
        url: String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 120),
        via,
        keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 40) : typeof data,
        status: ps && ps.status,
        reason: ps && ps.reason,
        errorScreen: ps && ps.errorScreen ? Object.keys(ps.errorScreen) : undefined,
        videoId: player && player.videoDetails && player.videoDetails.videoId,
        adPlacements: player && Array.isArray(player.adPlacements) ? player.adPlacements.length : undefined,
        adSlots: player && Array.isArray(player.adSlots) ? player.adSlots.length : undefined,
        playerAds: player && Array.isArray(player.playerAds) ? player.playerAds.length : undefined,
        auxiliaryUi: player && player.auxiliaryUi ? safeJson(player.auxiliaryUi).slice(0, 2000) : undefined,
        findings: findings(data),
      };
      state.responses.push(entry);
      if (state.responses.length > RESPONSE_KEEP) state.responses.splice(0, state.responses.length - RESPONSE_KEEP);
      if (entry.findings.length || (entry.status && entry.status !== 'OK')) {
        log('response', entry.url, 'status', entry.status, 'findings', entry.findings.map((f) => f.path).join(', ') || 'none');
      }
    } catch (e) {
      log('summarize failed', String(e));
    }
  }

  const parseIfJson = (text) => {
    if (typeof text !== 'string') return null;
    const i = text.indexOf('{');
    if (i < 0 || i > 8) return null; // ")]}'" prefixes aside, a body that is not JSON is not ours
    try {
      return JSON.parse(text.slice(i));
    } catch {
      return null;
    }
  };

  // fetch: the scriptlets above us read the body with .text()/.json() on the original Response, so hooking the
  // prototype here sees the server's bytes, not the pruned copy they hand to the page
  for (const method of ['json', 'text']) {
    const original = Response.prototype[method];
    if (typeof original !== 'function') continue;
    Response.prototype[method] = function () {
      const result = original.apply(this, arguments);
      try {
        const url = this.url || '';
        if (INTERESTING_URL.test(url) && result && typeof result.then === 'function') {
          result.then((body) => summarize(url, 'fetch.' + method, method === 'json' ? body : parseIfJson(body))).catch(() => {});
        }
      } catch {}
      return result;
    };
  }

  // XHR: tagged on open, read on load
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (INTERESTING_URL.test(String(url))) {
        this.__adblockUrl = String(url);
        this.addEventListener('load', () => {
          try {
            summarize(this.__adblockUrl, 'xhr', this.responseType === 'json' ? this.response : parseIfJson(this.responseText));
          } catch {}
        });
      }
    } catch {}
    return xhrOpen.apply(this, arguments);
  };

  // --- what the page showed -----------------------------------------------------------------------------------

  function playerState() {
    try {
      const p = document.getElementById('movie_player');
      const v = document.querySelector('video');
      const r = (p && p.getPlayerResponse && p.getPlayerResponse()) || {};
      const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      return {
        videoId: r.videoDetails && r.videoDetails.videoId,
        status: r.playabilityStatus && r.playabilityStatus.status,
        reason: r.playabilityStatus && r.playabilityStatus.reason,
        auxiliaryUi: r.auxiliaryUi ? Object.keys(r.auxiliaryUi.messageRenderers || r.auxiliaryUi) : undefined,
        adPlacements: Array.isArray(r.adPlacements) ? r.adPlacements.length : null,
        currentTime: v ? Math.round(v.currentTime * 10) / 10 : null,
        paused: v ? v.paused : null,
        readyState: v ? v.readyState : null,
        frames: q ? q.totalVideoFrames : null,
        playerState: p && p.getPlayerState ? p.getPlayerState() : null,
        adShowing: !!(p && p.classList.contains('ad-showing')),
      };
    } catch (e) {
      return { error: String(e) };
    }
  }

  function event(type, extra) {
    const e = { at: new Date().toISOString(), type, url: location.href, player: playerState(), ...extra };
    state.events.push(e);
    if (state.events.length > EVENT_KEEP) state.events.splice(0, state.events.length - EVENT_KEEP);
    log('event', type, extra && extra.text ? extra.text.slice(0, 120) : '');
    return e;
  }

  const seenNodes = new WeakSet();
  let saveTimer = null;
  function scheduleSave(reason) {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save(reason);
    }, SAVE_DELAY_MS);
  }

  function scan() {
    try {
      for (const node of document.querySelectorAll(POPUP_SELECTOR)) {
        if (seenNodes.has(node)) continue;
        const text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text) continue; // an empty dialog host is Polymer's placeholder, not a popup
        seenNodes.add(node);
        event('popup', { tag: node.tagName.toLowerCase(), text: text.slice(0, 600), visible: !!node.offsetParent || getComputedStyle(node).display !== 'none' });
        if (/ad.?block|bloqueador|premium|anuncios/i.test(text) || node.tagName.toLowerCase() === 'ytd-enforcement-message-view-model') scheduleSave('popup');
      }
      for (const node of document.querySelectorAll(ERROR_SELECTOR)) {
        const host = node.parentElement || node;
        if (seenNodes.has(host)) continue;
        const text = (host.innerText || host.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text) continue;
        seenNodes.add(host);
        event('error-screen', { text: text.slice(0, 600) });
        scheduleSave('error-screen');
      }
    } catch {}
  }

  const start = () => {
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  // --- the record -----------------------------------------------------------------------------------------

  let lastSave = -Infinity;
  function save(reason) {
    const now = Date.now();
    if (reason !== 'manual' && reason !== 'verify' && now - lastSave < SAVE_MIN_GAP_MS) return null;
    lastSave = now;
    const name = 'youtube-' + new Date(now).toISOString().replace(/[:.]/g, '-') + '-' + reason + '.json';
    const record = {
      name,
      reason,
      at: new Date(now).toISOString(),
      url: location.href,
      version: state.version,
      userAgent: navigator.userAgent,
      loggedIn: !!(window.ytcfg && ytcfg.data_ && ytcfg.data_.LOGGED_IN),
      rules: { applied: state.applied, failed: state.failed },
      player: playerState(),
      events: state.events,
      responses: state.responses,
      log: state.log,
    };
    let json = JSON.stringify(record);
    while (json.length > RECORD_MAX_BYTES && record.responses.length > 3) {
      record.responses.shift();
      json = JSON.stringify(record);
    }
    window.postMessage({ source: 'adblock-youtube', type: 'save', name, json }, location.origin);
    state.saves.push({ at: now, reason, name, bytes: json.length });
    log('record ' + name + ' sent to Downloads/AdBlock/ (' + reason + ', ' + Math.round(json.length / 1024) + ' KB)');
    return name;
  }

  return state;
}
