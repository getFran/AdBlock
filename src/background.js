// MV3 service worker. Network blocking is declarative (the rulesets in the manifest); cosmetic filtering and the
// YouTube/Twitch logic live in content scripts. This worker:
//   - registers those content scripts (chrome.scripting, not the manifest) so that a site switched off in the popup
//     gets none of them, and keeps a DNR allowAllRequests rule per switched-off site so nothing of it is blocked;
//   - answers the popup (the list of switched-off sites, add, remove);
//   - writes the Twitch and YouTube records (src/twitch/page.js, src/youtube/record.js) to Downloads/AdBlock/;
//   - offers diagnostics to test/verify.mjs. Nothing here is on the hot path.

const CONTENT_SCRIPTS = __CONTENT_SCRIPTS__; // from build.mjs: { id, matches, js, runAt, world?, allFrames?, matchOriginAsFallback? }
// Sites switched off from the start: Fran's own services. The Umami dashboard on umami.getfran.dev broke under
// AdGuard Tracking Protection's `||umami.` rule (every host named umami.*, first party included), 2026-10-16.
const DEFAULT_DISABLED = ['getfran.dev'];
const DISABLED_RULE_BASE = 1000; // dynamic DNR rule ids of the switched-off sites: base + index
const DISABLED_RULE_PRIORITY = 10000000; // above every static rule (AdGuard's own allow rules reach ~100,000)
const MATCHED_LIMIT = 1000;
const matched = [];

// --- diagnostics -----------------------------------------------------------------------------------------

async function report() {
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  const available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
  const manifest = chrome.runtime.getManifest();
  const declared = manifest.declarative_net_request.rule_resources.map((r) => r.id);
  const missing = declared.filter((id) => !enabled.includes(id));
  const out = { enabled, missing, availableStaticRules: available, version: manifest.version };
  console.log('[AdBlock] rulesets enabled:', enabled.join(', '), '| not enabled:', missing.join(', ') || 'none', '| static rules still available:', available);
  return out;
}

// Only fires for unpacked extensions (declarativeNetRequestFeedback): a ring buffer of matches for test/verify.mjs.
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    matched.push({
      url: info.request.url,
      type: info.request.type,
      tabId: info.request.tabId,
      ruleset: info.rule.rulesetId,
      ruleId: info.rule.ruleId,
      at: Date.now(),
    });
    if (matched.length > MATCHED_LIMIT) matched.splice(0, matched.length - MATCHED_LIMIT);
  });
}

// Would the enabled rulesets act on this request? Asked of the engine directly (test/verify.mjs uses it for
// edge.ads.twitch.tv, which the Twitch page hook answers before any request is made).
function testMatch(url, initiator, type) {
  return chrome.declarativeNetRequest.testMatchOutcome({ url, initiator, type: type || 'xmlhttprequest', method: 'get' });
}

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
  console.log('[AdBlock] switched off on:', sites.join(', ') || 'no site', '| content scripts:', wanted.map((s) => s.id).join(', '));
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

chrome.runtime.onInstalled.addListener(() => {
  ensureApplied().catch((e) => console.error('[AdBlock] per-site switch failed to apply', e));
  report().catch((e) => console.error('[AdBlock] report failed', e));
});
chrome.runtime.onStartup.addListener(() => {
  ensureApplied().catch((e) => console.error('[AdBlock] per-site switch failed to apply', e));
});

// --- messages: the popup, and the Twitch/YouTube records --------------------------------------------------------

const saves = [];
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
    case 'save': {
      // a record from the Twitch or YouTube page script (relayed by bridge.js): Downloads/AdBlock/<name>. A data URL keeps
      // this inside the service worker (no blob URLs here); the page caps the record well under Chrome's URL limit.
      const name = String(message.name || 'record.json').replace(/[^\w.-]/g, '_');
      const url = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(String(message.json || ''))));
      chrome.downloads
        .download({ url, filename: 'AdBlock/' + name, conflictAction: 'uniquify', saveAs: false })
        .then((id) => {
          saves.push({ name, id, at: Date.now(), bytes: String(message.json || '').length });
          if (saves.length > 100) saves.splice(0, saves.length - 100);
          console.log('[AdBlock] record saved: Downloads/AdBlock/' + name);
          sendResponse({ ok: true, id });
        })
        .catch((e) => {
          console.error('[AdBlock] record NOT saved:', name, e);
          sendResponse({ ok: false, error: String(e) });
        });
      return true;
    }
    default:
      return false;
  }
});

// test/verify.mjs: the state of a record's download, by the name the page gave it
async function downloadState(name) {
  const save = saves.find((s) => s.name === name);
  if (!save) return { known: false };
  const [item] = await chrome.downloads.search({ id: save.id });
  return item ? { known: true, state: item.state, bytes: item.totalBytes, filename: item.filename, error: item.error } : { known: true, state: 'gone' };
}

globalThis.__adblock = { matched, report, testMatch, saves, downloadState, getDisabledSites, setDisabledSites, ensureApplied, normalizeSite };
