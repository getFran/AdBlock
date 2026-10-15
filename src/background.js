// Minimal MV3 service worker: diagnostics only. Network blocking is declarative (the rulesets in the manifest),
// cosmetic filtering and the YouTube/Twitch logic live in content scripts. Nothing here is on the hot path.

const MATCHED_LIMIT = 1000;
const matched = [];

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

// Only fires for unpacked extensions (declarativeNetRequestFeedback): a ring buffer of blocked requests for test/verify.mjs.
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

chrome.runtime.onInstalled.addListener(() => {
  report().catch((e) => console.error('[AdBlock] report failed', e));
});

// Would the enabled rulesets act on this request? Asked of the engine directly (test/verify.mjs uses it for
// edge.ads.twitch.tv, which the Twitch page hook answers before any request is made).
function testMatch(url, initiator, type) {
  return chrome.declarativeNetRequest.testMatchOutcome({ url, initiator, type: type || 'xmlhttprequest', method: 'get' });
}

// Records from the Twitch page script (relayed by twitch-bridge.js): written to Downloads/AdBlock/<name> so that a
// session can read them later. A data URL keeps this inside the service worker (no blob URLs here); the page caps
// the record well under Chrome's URL limit.
const saves = [];
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'save') return false;
  const name = String(message.name || 'record.json').replace(/[^\w.-]/g, '_');
  const url = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(String(message.json || ''))));
  chrome.downloads
    .download({ url, filename: 'AdBlock/' + name, conflictAction: 'uniquify', saveAs: false })
    .then((id) => {
      saves.push({ name, id, at: Date.now(), bytes: String(message.json || '').length });
      if (saves.length > 100) saves.splice(0, saves.length - 100);
      console.log('[AdBlock] Twitch record saved: Downloads/AdBlock/' + name);
      sendResponse({ ok: true, id });
    })
    .catch((e) => {
      console.error('[AdBlock] Twitch record NOT saved:', name, e);
      sendResponse({ ok: false, error: String(e) });
    });
  return true;
});

// test/verify.mjs: the state of a record's download, by the name the page gave it
async function downloadState(name) {
  const save = saves.find((s) => s.name === name);
  if (!save) return { known: false };
  const [item] = await chrome.downloads.search({ id: save.id });
  return item ? { known: true, state: item.state, bytes: item.totalBytes, filename: item.filename, error: item.error } : { known: true, state: 'gone' };
}

globalThis.__adblock = { matched, report, testMatch, saves, downloadState };
