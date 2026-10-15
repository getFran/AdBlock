// YouTube (MAIN world, document_start, declared in the manifest so it runs before any page script).
//
// Every rule in .cache/gen/youtube-rules.js is a scriptlet compiled at build time by @adguard/scriptlets
// (json-prune patches JSON.parse and Response.json, json-prune-fetch-response patches fetch,
// json-prune-xhr-response patches XMLHttpRequest, set-constant neuters the inline ytInitialPlayerResponse
// fields, adjust-setTimeout speeds the 17 s timer...) or a raw JS rule from AdGuard Base (the
// onAbnormalityDetected and about:blank-iframe countermeasures). The arguments come from AdGuard Base and
// uAssets quick-fixes; nothing is hand-written here.

import rules from '../../.cache/gen/youtube-rules.js';

(function () {
  if (window.__adblockYoutube) return;
  const host = location.hostname.toLowerCase();
  const matches = (domain) => host === domain || host.endsWith('.' + domain);
  const applied = [];
  const failed = [];
  for (const rule of rules) {
    if (!rule.d.some(matches) || rule.x.some(matches)) continue;
    try {
      rule.run();
      applied.push(rule.n);
    } catch (e) {
      failed.push(rule.n);
      console.debug('[AdBlock/youtube] rule failed:', rule.n, e);
    }
  }
  window.__adblockYoutube = { applied, failed };
  console.debug('[AdBlock/youtube] applied', applied.length, 'rules on', host, failed.length ? '(failed: ' + failed.join(' | ') + ')' : '');
})();
