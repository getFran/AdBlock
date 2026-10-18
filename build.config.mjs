// Build configuration. Filter ids are AdGuard's (ruleset_<id> in @adguard/dnr-rulesets); the full
// catalogue with names is in node_modules/@adguard/dnr-rulesets/dist/filters/chromium-mv3/declarative/ruleset_0.
export default {
  rulesets: {
    // Network rulesets (declarativeNetRequest) enabled by default. Chrome guarantees 30.000 static rules per
    // extension plus a pool of 300.000 shared with every other extension, and 1.000 regex rules; the build
    // prints the totals and refuses to exceed the regex limit.
    //   2  AdGuard Base (includes EasyList)        3  AdGuard Tracking Protection (≈ EasyPrivacy)
    //   9  AdGuard Spanish/Portuguese             17  AdGuard URL Tracking
    //  18  Cookie Notices  19  Popups  21  Other Annoyances  22  Widgets
    enabled: [2, 3, 9, 17, 18, 19, 21, 22],
  },
  cosmetic: {
    // Rulesets whose element-hiding rules (##, #@#) and CSS injection rules (#$#) are compiled to CSS.
    from: [2, 9, 18, 19, 21, 22],
    // Domain-specific selectors are split into this many content scripts, each loaded only on its domains.
    buckets: 32,
  },
  youtube: {
    hosts: ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'],
    // Scriptlet and JS rules for the hosts above are taken from this AdGuard ruleset's filter text...
    adguardRuleset: 2,
    // ...with its YouTube lines (cosmetic and JS) swapped for a snapshot of the live filter, because the npm
    // package lags the filter by weeks (36 days between the September and October 2026 releases) and AdGuard
    // touches its YouTube rules every few days. `npm run vendor` refreshes the snapshot.
    adguardLive: {
      url: 'https://filters.adtidy.org/extension/chromium-mv3/filters/2.txt',
      snapshot: 'vendor/adguard-base-youtube.txt',
    },
    // ...plus uBlock Origin's quick fixes, converted to AdGuard syntax. Only these uBO scriptlets are kept:
    // the rest of the YouTube block in quick-fixes.txt uses uBO-only scriptlets that @adguard/scriptlets
    // does not implement (rpnt, trusted-edit-inbound-object, trusted-rpfr, trusted-prevent-dom-bypass...).
    // Its plain cosmetic rules for the YouTube hosts go to the cosmetic build too: they hide the "ad blockers
    // violate YouTube's Terms of Service" snackbar and toast, which no AdGuard list covers (2026-10-18).
    uassets: {
      url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt',
      snapshot: 'vendor/uassets-quick-fixes.txt',
      scriptlets: ['json-prune', 'json-prune-fetch-response', 'json-prune-xhr-response', 'adjust-setTimeout'],
    },
    // Our own lines, in AdGuard syntax, compiled by the same pipelines as the lists above; only what no maintained
    // list carries. 2026-10-18: the "Ad blockers are not allowed on YouTube" popup (ytd-enforcement-message-view-model)
    // that Fran saw. Its payload travels in every player response of a flagged account
    // (auxiliaryUi.messageRenderers.enforcementMessageViewModel) and the app shows it when the player fires
    // onAbnormalityDetected (base.js of 2026-10-18: a preroll slot that did not play, or the SABR stream saying ads
    // were due while the client's response has none, "html5_enable_t1_enf_on_sabr"). AdGuard Base neuters that
    // handler (Promise.then proxy, already in the build); these lines remove the payload itself, the countermeasure
    // uBO users applied by hand in 2023 and that no list keeps today. The record (src/youtube/record.js) shows
    // whether a response still carries it.
    local: [
      "youtube.com,youtubekids.com,youtube-nocookie.com#%#//scriptlet('set-constant', 'ytInitialPlayerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel', 'undefined')",
      "youtube.com,youtubekids.com,youtube-nocookie.com#%#//scriptlet('json-prune', 'auxiliaryUi.messageRenderers.enforcementMessageViewModel playerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel')",
      "youtube.com,youtubekids.com,youtube-nocookie.com#%#//scriptlet('json-prune-fetch-response', 'auxiliaryUi.messageRenderers.enforcementMessageViewModel playerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel', '', '/playlist\\?list=|player\\?|watch\\?[tv]=/')",
      "youtube.com,youtubekids.com,youtube-nocookie.com#%#//scriptlet('json-prune-xhr-response', 'auxiliaryUi.messageRenderers.enforcementMessageViewModel playerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel', '', '/playlist\\?list=|\\/player(?!.*(get_drm_license))|watch\\?[tv]=|get_watch\\?/')",
    ],
  },
  twitch: {
    hosts: ['twitch.tv'],
  },
};
