// Twitch, ISOLATED world (declared in the manifest, document_start): the only piece on twitch.tv with chrome.runtime.
// It relays the page script's records (window.__adblockTwitch.save, src/twitch/page.js) to the service worker, which
// writes them to Downloads/AdBlock/ with chrome.downloads. Nothing else: no page access, no blocking.

window.addEventListener('message', (event) => {
  const data = event && event.data;
  if (event.source !== window || !data || data.source !== 'adblock-twitch' || data.type !== 'save') return;
  try {
    chrome.runtime.sendMessage({ type: 'save', name: String(data.name || ''), json: String(data.json || '') }, () => {
      // the answer is not needed; reading lastError keeps Chrome quiet when the worker is asleep
      void chrome.runtime.lastError;
    });
  } catch {
    // the extension was reloaded under this page: nothing to do until the tab reloads
  }
});
