// The popup: two tabs. "This site" is the per-site switch (reads the active tab's host, the stored list and the update
// state from the service worker, src/background.js: sites:get / sites:set / update:get / update:check, toggles the host
// and reloads the tab so the change shows). "What's new" is CHANGELOG.md as the build parsed it (__CHANGELOG__), with
// the installed version marked; a dot on that tab marks the first open after an update (background.js stores whatsNew
// when the version changes). The update banner links the newer release when there is one.

const RELEASES_URL = 'https://github.com/' + __REPO__ + '/releases';
const CHANGELOG_URL = 'https://github.com/' + __REPO__ + '/blob/main/CHANGELOG.md';
const CHANGELOG = __CHANGELOG__; // [{ version, date, items: [markdown text] }], newest first

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
  const version = chrome.runtime.getManifest().version;
  el('version').textContent = 'v' + version;
  el('check').addEventListener('click', async (event) => {
    event.preventDefault();
    el('check').textContent = 'Checking...';
    const answer = await send({ type: 'update:check' }).catch((e) => ({ update: null, error: String(e) }));
    renderUpdate(answer && answer.update, true);
  });
  el('full').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: CHANGELOG_URL });
  });
  renderChangelog(version);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab && tab.url ? hostOf(tab.url) : null;
  const [{ sites = [] }, { update = null }, { whatsNew = null }] = await Promise.all([send({ type: 'sites:get' }), send({ type: 'update:get' }), chrome.storage.local.get('whatsNew')]);
  render(tab, host, sites);
  renderUpdate(update, false);
  setupTabs(whatsNew === version);
}

function setupTabs(unread) {
  const tabs = [el('tab-site'), el('tab-news')];
  const dot = el('news-dot');
  dot.hidden = !unread;
  const select = (chosen) => {
    for (const tab of tabs) {
      const on = tab === chosen;
      tab.setAttribute('aria-selected', String(on));
      el(tab.getAttribute('aria-controls')).hidden = !on;
    }
    if (chosen === el('tab-news') && !dot.hidden) {
      dot.hidden = true;
      chrome.storage.local.remove('whatsNew').catch(() => {});
    }
  };
  for (const tab of tabs) tab.addEventListener('click', () => select(tab));
}

function renderChangelog(installed) {
  const list = el('changelog');
  list.textContent = '';
  for (const entry of CHANGELOG) {
    const li = document.createElement('li');
    li.className = 'entry';
    const head = document.createElement('div');
    head.className = 'entry-head';
    const version = document.createElement('span');
    version.className = 'version';
    version.textContent = entry.version;
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = entry.date;
    head.append(version, date);
    if (entry.version === installed) {
      const mark = document.createElement('span');
      mark.className = 'installed';
      mark.textContent = 'installed';
      head.append(mark);
    }
    const items = document.createElement('ul');
    for (const text of entry.items) {
      const item = document.createElement('li');
      item.append(...inline(text));
      items.append(item);
    }
    li.append(head, items);
    list.append(li);
  }
  if (!CHANGELOG.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No entries';
    list.append(empty);
  }
}

// the markdown of an item: `code` and **bold**, nothing else
function inline(text) {
  const nodes = [];
  for (const part of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      nodes.push(code);
    } else if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      nodes.push(strong);
    } else {
      nodes.push(document.createTextNode(part));
    }
  }
  return nodes;
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
