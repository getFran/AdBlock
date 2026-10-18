// YouTube (MAIN world, document_start, registered by the service worker so it runs before any page script).
//
// Every rule in .cache/gen/youtube-rules.js is a scriptlet compiled at build time by @adguard/scriptlets
// (json-prune patches JSON.parse and Response.json, json-prune-fetch-response patches fetch,
// json-prune-xhr-response patches XMLHttpRequest, set-constant neuters the inline ytInitialPlayerResponse
// fields, adjust-setTimeout speeds the 17 s timer...) or a raw JS rule from AdGuard Base (the
// onAbnormalityDetected and about:blank-iframe countermeasures). The arguments come from AdGuard Base and
// uAssets quick-fixes; nothing is hand-written here.
//
// Development builds also install the record (src/youtube/record.js: the last player responses, written to
// Downloads/AdBlock/ when the enforcement popup or the error screen appears) and expose it as window.__adblockYoutube.
// A release (__RELEASE__, build.mjs --release) runs the rules alone: no global on the page, no console.

import rules from '../../.cache/gen/youtube-rules.js';
import { installRecord } from './record.js';

(function () {
  if (!__RELEASE__ && window.__adblockYoutube) return;
  // the record first: its hooks on Response/XMLHttpRequest must sit under the rules' to see the server's bytes
  const state = __RELEASE__ ? { applied: [], failed: [] } : installRecord(__EXT_VERSION__);
  const host = location.hostname.toLowerCase();
  const matches = (domain) => host === domain || host.endsWith('.' + domain);
  const { applied, failed } = state;
  for (const rule of rules) {
    if (!rule.d.some(matches) || rule.x.some(matches)) continue;
    try {
      rule.run();
      applied.push(rule.n);
    } catch (e) {
      failed.push(rule.n);
      if (!__RELEASE__) console.debug('[AdBlock/youtube] rule failed:', rule.n, e);
    }
  }
  if (!__RELEASE__) console.debug('[AdBlock/youtube] applied', applied.length, 'rules on', host, failed.length ? '(failed: ' + failed.join(' | ') + ')' : '');
})();
