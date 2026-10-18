// The popup: the per-site switch and the update notice. Reads the active tab's host, the stored list and the update
// state from the service worker (src/background.js: sites:get / sites:set / update:get / update:check), toggles the
// host and reloads the tab so the change shows, and links the newer release when there is one.

const RELEASES_URL = 'https://github.com/' + __REPO__ + '/releases';

const hostOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};
const covers = (site, host) => host === site || host.endsWith('.' + site);
const send = (message) => chrome.runtime.sendMessage(message);
const el = (id) => document.getElementById(id);

async function main() {
  el('version').textContent = 'v' + chrome.runtime.getManifest().version;
  el('check').addEventListener('click', async (event) => {
    event.preventDefault();
    el('check').textContent = 'Checking...';
    const answer = await send({ type: 'update:check' }).catch((e) => ({ update: null, error: String(e) }));
    renderUpdate(answer && answer.update, true);
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab && tab.url ? hostOf(tab.url) : null;
  const [{ sites = [] }, { update = null }] = await Promise.all([send({ type: 'sites:get' }), send({ type: 'update:get' })]);
  render(tab, host, sites);
  renderUpdate(update, false);
}

// the banner while a newer release exists; after an explicit check, the footer link says what was found
function renderUpdate(update, explicit) {
  const box = el('update');
  const check = el('check');
  if (update && update.available) {
    box.hidden = false;
    box.querySelector('span').textContent = 'Version ' + update.latest + ' is available.';
    box.querySelector('button').onclick = () => chrome.tabs.create({ url: update.url || RELEASES_URL });
    check.textContent = 'Check for updates';
    return;
  }
  box.hidden = true;
  if (!explicit) check.textContent = 'Check for updates';
  else if (update && update.error) check.textContent = 'Could not check (' + update.error + ')';
  else if (update && update.latest) check.textContent = 'Up to date (' + update.latest + ' is the latest)';
  else check.textContent = 'No release published yet';
}

function render(tab, host, sites) {
  const current = el('current');
  const list = el('list');
  current.textContent = '';
  list.textContent = '';

  if (!host) {
    current.innerHTML = '<div class="state">This tab is not a web page (http/https).</div>';
  } else {
    const covering = sites.filter((s) => covers(s, host));
    const off = covering.length > 0;
    const site = document.createElement('div');
    site.className = 'site';
    site.textContent = host;
    const state = document.createElement('div');
    state.className = 'state' + (off ? ' off' : '');
    state.textContent = off ? 'Switched off here' + (covering[0] !== host ? ' (through ' + covering[0] + ')' : '') : 'Blocking';
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = (off ? 'Switch on for ' : 'Switch off for ') + host;
    button.addEventListener('click', async () => {
      button.disabled = true;
      const next = off ? sites.filter((s) => !covers(s, host)) : [...sites, host];
      await apply(tab, next);
    });
    current.append(site, state, button);
  }

  if (!sites.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No site';
    list.append(empty);
  }
  for (const s of sites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = s;
    const remove = document.createElement('button');
    remove.textContent = 'Switch on';
    remove.title = 'Block again on ' + s;
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      await apply(tab, sites.filter((x) => x !== s));
    });
    li.append(name, remove);
    list.append(li);
  }
}

async function apply(tab, next) {
  const answer = await send({ type: 'sites:set', sites: next });
  if (answer && answer.error) {
    alert('Could not apply the change: ' + answer.error);
    return;
  }
  if (tab && tab.id != null && tab.url && hostOf(tab.url)) {
    try {
      await chrome.tabs.reload(tab.id);
    } catch {
      // a tab that cannot be reloaded (closed meanwhile)
    }
  }
  window.close();
}

main().catch((e) => {
  el('current').textContent = 'Error: ' + e.message;
});
