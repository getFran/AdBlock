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

globalThis.__adblock = { matched, report, testMatch };
