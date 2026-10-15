// Cosmetic filtering runtime (ISOLATED world, every http(s) page and frame, document_start).
//
// Two stylesheets:
//   1. generic selectors (rules without a domain), bundled in this file and injected synchronously at
//      document_start, before the page has any content;
//   2. the domain's own rules, read from cosmetic/bucket-N.json (N = hash of the hostname's last two
//      labels, see src/lib/hash.js) with a fetch of the extension package: a few milliseconds, injected
//      as soon as it arrives. If the domain has exceptions (#@#) to generic selectors, the generic sheet
//      is rewritten without them at the same time.
// Stylesheets go through document.adoptedStyleSheets, which the page's Content-Security-Policy cannot
// block (CSP governs <style> elements, not CSSOM); a <style> element is the fallback.

import { BUCKETS, GENERIC, WILD } from '../../.cache/gen/cosmetic-generic.js';
import { bucketKey, bucketOf } from '../lib/hash.js';

(function () {
  if (self.__adblockCosmetic) return;
  const status = (self.__adblockCosmetic = { generic: 0, specific: 0, exceptions: 0, css: 0, bucket: null, error: null });

  const host = location.hostname.toLowerCase();
  const labels = host.split('.');
  const candidates = [];
  for (let i = 0; i < labels.length - 1; i++) candidates.push(labels.slice(i).join('.'));
  const hostMatches = (domain) => host === domain || host.endsWith('.' + domain);
  const selectorOf = (item) => (typeof item === 'string' ? item : item.x.some(hostMatches) ? null : item.s);

  function cssFor(hide, css) {
    let text = '';
    // :is() takes a forgiving selector list: one unsupported selector does not drop the whole rule
    for (let i = 0; i < hide.length; i += 400) text += ':is(' + hide.slice(i, i + 400).join(',') + '){display:none!important}\n';
    return text + css.join('\n');
  }

  function inject(text) {
    if (!text) return null;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return sheet;
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = text;
      (document.head || document.documentElement).appendChild(style);
      return style;
    }
  }

  const entries = [];
  // "rule34.*" matches rule34.<tld> for any single-label TLD; these ride along in every page
  for (const key of Object.keys(WILD)) {
    const base = key.slice(0, -2);
    if (candidates.some((c) => c.startsWith(base + '.') && !c.slice(base.length + 1).includes('.'))) entries.push(WILD[key]);
  }

  const exceptionsOf = (list) => {
    const except = new Set();
    for (const e of list) for (const s of e.e || []) except.add(s);
    return except;
  };

  // 1. generic, now
  let genericExcept = exceptionsOf(entries);
  const genericHide = GENERIC.filter((s) => !genericExcept.has(s));
  const genericSheet = inject(cssFor(genericHide, []));
  status.generic = genericHide.length;

  // 2. the domain's bucket, as soon as it arrives
  const key = bucketKey(host);
  if (key) {
    const bucket = bucketOf(key, BUCKETS);
    status.bucket = bucket;
    fetch(chrome.runtime.getURL('cosmetic/bucket-' + bucket + '.json'))
      .then((r) => r.json())
      .then((data) => {
        const own = [];
        for (const c of candidates) if (data[c]) own.push(data[c]);
        const except = exceptionsOf([...entries, ...own]);
        status.exceptions = except.size;
        if (except.size > genericExcept.size && genericSheet instanceof CSSStyleSheet) {
          genericExcept = except;
          genericSheet.replaceSync(cssFor(GENERIC.filter((s) => !except.has(s)), []));
        }
        const hide = [];
        const css = [];
        for (const e of [...entries, ...own]) {
          for (const item of e.h || []) {
            const s = selectorOf(item);
            if (s && !except.has(s)) hide.push(s);
          }
          for (const rule of e.c || []) css.push(rule);
        }
        status.specific = hide.length;
        status.css = css.length;
        inject(cssFor(hide, css));
      })
      .catch((e) => {
        status.error = String(e);
      });
  }

  // a page that resets document.adoptedStyleSheets loses our sheets: put the generic one back once the DOM is ready
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      if (genericSheet instanceof CSSStyleSheet && !document.adoptedStyleSheets.includes(genericSheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, genericSheet];
      }
    },
    { once: true },
  );
})();
