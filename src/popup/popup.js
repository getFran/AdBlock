// The popup: the per-site switch. Reads the active tab's host and the stored list from the service worker
// (src/background.js, messages sites:get / sites:set), toggles the host, and reloads the tab so the change shows.

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

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab && tab.url ? hostOf(tab.url) : null;
  const { sites = [] } = await send({ type: 'sites:get' });
  render(tab, host, sites);
}

function render(tab, host, sites) {
  const current = document.getElementById('current');
  const list = document.getElementById('list');
  current.textContent = '';
  list.textContent = '';

  if (!host) {
    current.innerHTML = '<div class="state">Esta pestaña no es una web (http/https).</div>';
  } else {
    const covering = sites.filter((s) => covers(s, host));
    const off = covering.length > 0;
    const site = document.createElement('div');
    site.className = 'site';
    site.textContent = host;
    const state = document.createElement('div');
    state.className = 'state' + (off ? ' off' : '');
    state.textContent = off ? 'Desactivado aquí' + (covering[0] !== host ? ' (por ' + covering[0] + ')' : '') : 'Bloqueando';
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = off ? 'Activar en ' + host : 'Desactivar en ' + host;
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
    empty.textContent = 'Ninguno';
    list.append(empty);
  }
  for (const s of sites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = s;
    const remove = document.createElement('button');
    remove.textContent = 'Activar';
    remove.title = 'Volver a bloquear en ' + s;
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
    alert('No se pudo aplicar: ' + answer.error);
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
  document.getElementById('current').textContent = 'Error: ' + e.message;
});
