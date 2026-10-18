// ISOLATED world on twitch.tv and the YouTube hosts (registered by the service worker, document_start): the only piece on
// those pages with chrome.runtime. It relays the page scripts' records (window.__adblockTwitch.save, src/twitch/page.js;
// window.__adblockYoutube.save, src/youtube/record.js) to the service worker, which writes them to Downloads/AdBlock/
// with chrome.downloads. Nothing else: no page access, no blocking.

const SOURCES = new Set(['adblock-twitch', 'adblock-youtube']);

window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (event.source !== window || !data || !SOURCES.has(data.source) || data.type !== 'save') return;
  try {
    chrome.runtime.sendMessage({ type: 'save', name: String(data.name || ''), json: String(data.json || '') }, () => {
      // the answer is not needed; reading lastError keeps Chrome quiet when the worker is asleep
      void chrome.runtime.lastError;
    });
  } catch {
    // the extension was reloaded under this page: nothing to do until the tab reloads
  }
});
