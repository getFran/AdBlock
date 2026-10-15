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
    // ...plus uBlock Origin's quick fixes, converted to AdGuard syntax. Only these uBO scriptlets are kept:
    // the rest of the YouTube block in quick-fixes.txt uses uBO-only scriptlets that @adguard/scriptlets
    // does not implement (rpnt, trusted-edit-inbound-object, trusted-rpfr, trusted-prevent-dom-bypass...).
    uassets: {
      url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt',
      snapshot: 'vendor/uassets-quick-fixes.txt',
      scriptlets: ['json-prune', 'json-prune-fetch-response', 'json-prune-xhr-response', 'adjust-setTimeout'],
    },
  },
  twitch: {
    hosts: ['twitch.tv'],
  },
};
