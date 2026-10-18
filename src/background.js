// MV3 service worker. Network blocking is declarative (the rulesets in the manifest); cosmetic filtering and the
// YouTube/Twitch logic live in content scripts. This worker:
//   - registers those content scripts (chrome.scripting, not the manifest) so that a site switched off in the popup
//     gets none of them, and keeps a DNR allowAllRequests rule per switched-off site so nothing of it is blocked;
//   - answers the popup (the list of switched-off sites, add, remove; the update state);
//   - asks GitHub once a day whether a newer release exists and marks the icon when it does: an unpacked extension never
//     updates itself, the person downloads the new zip (README, "Update");
//   - development builds only (__RELEASE__ false, build.mjs): writes the Twitch and YouTube records (src/twitch/page.js,
//     src/youtube/record.js) to Downloads/AdBlock/ and offers diagnostics to test/verify.mjs.
// Nothing here is on the hot path.

const CONTENT_SCRIPTS = __CONTENT_SCRIPTS__; // from build.mjs: { id, matches, js, runAt, world?, allFrames?, matchOriginAsFallback? }
// Sites switched off from the start. In development: Fran's own services (the Umami dashboard on umami.getfran.dev broke
// under AdGuard Tracking Protection's `||umami.` rule, every host named umami.*, first party included, 2026-10-16).
// A release switches nothing off: whoever installs it has their own sites, and the popup.
const DEFAULT_DISABLED = __RELEASE__ ? [] : ['getfran.dev'];
const DISABLED_RULE_BASE = 1000; // dynamic DNR rule ids of the switched-off sites: base + index
const DISABLED_RULE_PRIORITY = 10000000; // above every static rule (AdGuard's own allow rules reach ~100,000)
// The update check. <repo>/releases/latest answers with a redirect to /releases/tag/<version>: the version is read from
// the final URL, with no API call and no quota. By alarm once a day, at startup and when the popup opens, never closer
// than UPDATE_MIN_GAP_MS unless the popup asks for it.
const RELEASES_URL = 'https://github.com/' + __REPO__ + '/releases';
const UPDATE_ALARM = 'update-check';
const UPDATE_PERIOD_MIN = 24 * 60;
const UPDATE_MIN_GAP_MS = 6 * 60 * 60 * 1000;

// --- the per-site switch ---------------------------------------------------------------------------------

// a hostname as the popup or verify typed it: no scheme, no path, no port, no leading www., lower case
function normalizeSite(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].split(':')[0].replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) || s === 'localhost' ? s : null;
}
const patternsFor = (site) => [`*://${site}/*`, `*://*.${site}/*`];

async function getDisabledSites() {
  const { disabledSites } = await chrome.storage.local.get('disabledSites');
  return Array.isArray(disabledSites) ? disabledSites : null;
}

async function setDisabledSites(sites) {
  const clean = [...new Set((sites || []).map(normalizeSite).filter(Boolean))].sort();
  await chrome.storage.local.set({ disabledSites: clean });
  await applyDisabledSites(clean);
  return clean;
}

// Content scripts registered with the switched-off sites excluded (updated in place when already registered), and
// one allowAllRequests rule per site: every request of its frames is allowed, whatever the static rules say.
async function applyDisabledSites(sites) {
  const excludeMatches = sites.flatMap(patternsFor);
  const wanted = CONTENT_SCRIPTS.map((s) => ({ ...s, excludeMatches, persistAcrossSessions: true }));
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const have = new Set(registered.map((s) => s.id));
  const stale = registered.filter((s) => !CONTENT_SCRIPTS.some((w) => w.id === s.id)).map((s) => s.id);
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  try {
    const toUpdate = wanted.filter((s) => have.has(s.id));
    const toRegister = wanted.filter((s) => !have.has(s.id));
    if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
    if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
  } catch (e) {
    // a field Chrome will not update in place: start over
    console.warn('[AdBlock] content scripts re-registered from scratch:', String(e));
    const ids = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
    await chrome.scripting.registerContentScripts(wanted);
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter((r) => r.id >= DISABLED_RULE_BASE && r.id < DISABLED_RULE_BASE + 100000).map((r) => r.id);
  const addRules = sites.map((site, i) => ({
    id: DISABLED_RULE_BASE + i,
    priority: DISABLED_RULE_PRIORITY,
    action: { type: 'allowAllRequests' },
    condition: { requestDomains: [site], resourceTypes: ['main_frame', 'sub_frame'] },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  if (!__RELEASE__) console.log('[AdBlock] switched off on:', sites.join(', ') || 'no site', '| content scripts:', wanted.map((s) => s.id).join(', '));
}

// the stored list, with the defaults written the first time
async function ensureApplied() {
  let sites = await getDisabledSites();
  if (sites === null) {
    sites = DEFAULT_DISABLED.slice();
    await chrome.storage.local.set({ disabledSites: sites });
  }
  await applyDisabledSites(sites);
  return sites;
}

// --- the update check ------------------------------------------------------------------------------------

// "1.2.3" or "v1.2.3" -> [1, 2, 3]; a Chrome extension version has 1 to 4 integer parts
function versionParts(text) {
  const m = /^v?(\d+(?:\.\d+){0,3})$/.exec(String(text || '').trim());
  return m ? m[1].split('.').map(Number) : null;
}

function isNewer(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

async function getUpdateState() {
  const { update } = await chrome.storage.local.get('update');
  return update && typeof update === 'object' ? update : null;
}

// the icon: a red NEW badge and a title naming the version while a newer release exists; nothing otherwise
async function showUpdateState(update) {
  const available = !!(update && update.available);
  await chrome.action.setBadgeText({ text: available ? 'NEW' : '' });
  if (available) {
    await chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
  await chrome.action.setTitle({ title: available ? 'getFran AdBlock: version ' + update.latest + ' is available' : 'getFran AdBlock' });
}

// { checkedAt, current, latest, url, available, error }: latest is null while the repo has no release; on a network
// error the previous latest stands and error says why
async function checkForUpdate(force) {
  const previous = await getUpdateState();
  if (!force && previous && Date.now() - (previous.checkedAt || 0) < UPDATE_MIN_GAP_MS) return previous;
  const current = chrome.runtime.getManifest().version;
  const update = {
    checkedAt: Date.now(),
    current,
    latest: previous ? previous.latest : null,
    url: previous && previous.url ? previous.url : RELEASES_URL,
    available: false,
    error: null,
  };
  try {
    const response = await fetch(RELEASES_URL + '/latest', { redirect: 'follow', cache: 'no-store', credentials: 'omit' });
    const m = /\/releases\/tag\/(v?\d+(?:\.\d+){0,3})(?:[/?#]|$)/.exec(response.url || '');
    if (m) {
      update.latest = m[1].replace(/^v/, '');
      update.url = response.url;
    } else {
      update.latest = null; // no release (GitHub answers 404 or the releases index)
      update.url = RELEASES_URL;
      if (!response.ok && response.status !== 404) update.error = 'HTTP ' + response.status;
    }
  } catch (e) {
    update.error = String((e && e.message) || e);
  }
  update.available = !!update.latest && isNewer(update.latest, current);
  await chrome.storage.local.set({ update });
  await showUpdateState(update);
  return update;
}

function scheduleUpdateCheck() {
  // create replaces an alarm of the same name: safe at every install and startup
  chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: UPDATE_PERIOD_MIN });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate(false).catch(() => {});
});

// --- development only: the records and the diagnostics of test/verify.mjs -----------------------------------

const dev = __RELEASE__
  ? null
  : (() => {
      const MATCHED_LIMIT = 1000;
      const matched = [];
      const saves = [];

      // Only fires for unpacked extensions (declarativeNetRequestFeedback): a ring buffer of matches for test/verify.mjs.
      if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
        chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
          matched.push({ url: info.request.url, type: info.request.type, tabId: info.request.tabId, ruleset: info.rule.rulesetId, ruleId: info.rule.ruleId, at: Date.now() });
          if (matched.length > MATCHED_LIMIT) matched.splice(0, matched.length - MATCHED_LIMIT);
        });
      }

      async function report() {
        const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
        const available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
        const manifest = chrome.runtime.getManifest();
        const declared = manifest.declarative_net_request.rule_resources.map((r) => r.id);
        const missing = declared.filter((id) => !enabled.includes(id));
        console.log('[AdBlock] rulesets enabled:', enabled.join(', '), '| not enabled:', missing.join(', ') || 'none', '| static rules still available:', available);
        return { enabled, missing, availableStaticRules: available, version: manifest.version };
      }

      // Would the enabled rulesets act on this request? Asked of the engine directly (test/verify.mjs uses it for
      // edge.ads.twitch.tv, which the Twitch page hook answers before any request is made).
      function testMatch(url, initiator, type) {
        return chrome.declarativeNetRequest.testMatchOutcome({ url, initiator, type: type || 'xmlhttprequest', method: 'get' });
      }

      // a record from the Twitch or YouTube page script (relayed by bridge.js): Downloads/AdBlock/<name>. A data URL keeps
      // this inside the service worker (no blob URLs here); the page caps the record well under Chrome's URL limit.
      async function saveRecord(message) {
        const name = String(message.name || 'record.json').replace(/[^\w.-]/g, '_');
        const json = String(message.json || '');
        const url = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(json)));
        try {
          const id = await chrome.downloads.download({ url, filename: 'AdBlock/' + name, conflictAction: 'uniquify', saveAs: false });
          saves.push({ name, id, at: Date.now(), bytes: json.length });
          if (saves.length > 100) saves.splice(0, saves.length - 100);
          console.log('[AdBlock] record saved: Downloads/AdBlock/' + name);
          return { ok: true, id };
        } catch (e) {
          console.error('[AdBlock] record NOT saved:', name, e);
          return { ok: false, error: String(e) };
        }
      }

      // test/verify.mjs: the state of a record's download, by the name the page gave it
      async function downloadState(name) {
        const save = saves.find((s) => s.name === name);
        if (!save) return { known: false };
        const [item] = await chrome.downloads.search({ id: save.id });
        return item ? { known: true, state: item.state, bytes: item.totalBytes, filename: item.filename, error: item.error } : { known: true, state: 'gone' };
      }

      return { matched, saves, report, testMatch, saveRecord, downloadState };
    })();

// --- lifecycle and messages --------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  ensureApplied().catch((e) => console.error('[AdBlock] per-site switch failed to apply', e));
  scheduleUpdateCheck();
  checkForUpdate(false).catch(() => {});
  if (dev) dev.report().catch((e) => console.error('[AdBlock] report failed', e));
});

chrome.runtime.onStartup.addListener(() => {
  ensureApplied().catch((e) => console.error('[AdBlock] per-site switch failed to apply', e));
  scheduleUpdateCheck();
  // the badge does not survive a browser restart: shown again from what is stored, then refreshed if old
  getUpdateState()
    .then((update) => showUpdateState(update))
    .then(() => checkForUpdate(false))
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  switch (message.type) {
    case 'sites:get':
      getDisabledSites()
        .then((sites) => sendResponse({ sites: sites || [] }))
        .catch((e) => sendResponse({ sites: [], error: String(e) }));
      return true;
    case 'sites:set':
      setDisabledSites(message.sites)
        .then((sites) => sendResponse({ sites }))
        .catch((e) => sendResponse({ error: String(e) }));
      return true;
    case 'update:get':
      // what is stored, at once; a check runs behind it when the last one is old
      getUpdateState()
        .then((update) => {
          sendResponse({ update });
          checkForUpdate(false).catch(() => {});
        })
        .catch((e) => sendResponse({ update: null, error: String(e) }));
      return true;
    case 'update:check':
      checkForUpdate(true)
        .then((update) => sendResponse({ update }))
        .catch((e) => sendResponse({ update: null, error: String(e) }));
      return true;
    case 'save':
      if (!dev) return false;
      dev.saveRecord(message).then(sendResponse);
      return true;
    default:
      return false;
  }
});

if (dev) globalThis.__adblock = { ...dev, getDisabledSites, setDisabledSites, ensureApplied, normalizeSite, checkForUpdate, getUpdateState };
