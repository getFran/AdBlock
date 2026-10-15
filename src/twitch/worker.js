// Twitch probe, worker side. This file is bundled first and prepended by src/twitch/page.js to the player's
// own worker script, so it runs in the player worker before Twitch's code.
//
// Ported from Purple Ads Blocker by Arthur Bolsoni, https://github.com/arthurbolsoni/Purple-adblock
// (Apache License 2.0): serviceWorker/src/bootstrap.ts (keep the original fetch, wrap self.fetch),
// modules/player/ad-detector.ts (the ad markers: DATERANGE CLASS twitch-stitched-ad, ID stitched-ad-*,
// segment titles other than "live"), modules/twitch/twitch.service.ts (PlaybackAccessToken with the public
// client id and the usher URL built from the page's own), modules/twitch/page-gql.ts (GQL through the page).
//
// This is a PROBE, not a blocker: playlists reach the player untouched. It
//   - logs the master playlists the player loads (channel, player_type and ad flags of the token),
//   - logs every #EXT-X-DATERANGE CLASS the first time it is seen, and the ad roll type when present,
//   - when a playlist carries twitch-stitched-ad, requests the same stream with every backup player_type
//     in parallel and classifies each answer: clean, announced (marker over live segments), ads, or error.
// The results go to the page (window.__adblockTwitch.probes) and to the console.

(function (scope) {
  if (scope.__adblockHooked) return;
  scope.__adblockHooked = true;

  const TAG = '[AdBlock/twitch:worker]';
  const request = scope.fetch.bind(scope);
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  // persisted query hash and template as used by Brave's vaft scriptlet and Purple (docs/server/tokens.md)
  const PLAYBACK_ACCESS_TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
  const PLAYBACK_ACCESS_TOKEN_QUERY =
    'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }}';
  const PROBE_TYPES = [
    { playerType: 'embed', platform: 'web' },
    { playerType: 'popout', platform: 'web' },
    { playerType: 'autoplay', platform: 'android' }, // 360p stream, the "low quality fallback" of vaft/Purple
    { playerType: 'picture-by-picture', platform: 'web' },
    { playerType: 'frontpage', platform: 'web' },
    { playerType: 'mobile_web', platform: 'web' },
    { playerType: 'site', platform: 'web' },
  ];
  const PROBE_COOLDOWN_MS = 60000;
  const PAGE_GQL_TIMEOUT_MS = 5000;

  const state = {
    channel: null,
    usherUrl: null,
    variants: [],
    quality: null,
    seenClasses: new Set(),
    polls: 0,
    lastProbeAt: 0,
    probing: false,
    gqlHeaders: {},
    gqlPending: new Map(),
    gqlNext: 1,
  };

  const post = (message) => {
    try {
      scope.postMessage(message);
    } catch {
      // the page is gone
    }
  };
  const log = (...args) => {
    console.log(TAG, ...args);
    post({ adblock: 'log', args: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) });
  };

  // messages from the page (only ours; the player's RPC uses other funcNames)
  scope.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || typeof data.funcName !== 'string' || !data.funcName.startsWith('adblock')) return;
    if (data.funcName === 'adblockGqlHeaders') {
      state.gqlHeaders = data.value || {};
    } else if (data.funcName === 'adblockGqlResponse') {
      const done = data.value && state.gqlPending.get(data.value.id);
      if (done) {
        state.gqlPending.delete(data.value.id);
        done(data.value);
      }
    }
  });

  // --- helpers -------------------------------------------------------------------------------------

  const urlOf = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url) || '';
  const isUsher = (url) => /^https:\/\/usher\.ttvnw\.net\/api\/(v2\/)?channel\/hls\//.test(url);
  const isPlaylist = (url) => /\.m3u8(\?|$)/.test(url) && !isUsher(url);
  const attr = (line, name) => {
    const at = line.indexOf(name + '="');
    if (at < 0) return '';
    const start = at + name.length + 2;
    return line.slice(start, line.indexOf('"', start));
  };
  const numberAttr = (line, name) => parseFloat((new RegExp('[:,]' + name + '=([0-9.]+)').exec(line) || [])[1] || '');

  function tokenFlags(token) {
    try {
      const t = JSON.parse(token);
      return { player_type: t.player_type, platform: t.platform, show_ads: t.show_ads, server_ads: t.server_ads, hide_ads: t.hide_ads, adblock: t.adblock };
    } catch {
      return { unparsed: String(token).slice(0, 40) };
    }
  }

  function tokenFromUsherUrl(url) {
    try {
      return new URL(url).searchParams.get('token');
    } catch {
      return null;
    }
  }

  // variants of a master playlist: EXT-X-MEDIA NAME of the variant's VIDEO group, else IVS-NAME / STABLE-VARIANT-ID
  function parseVariants(text) {
    const groups = {};
    const variants = [];
    const lines = text.split('\n').map((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-MEDIA:')) {
        const group = attr(line, 'GROUP-ID');
        if (group && !groups[group]) groups[group] = attr(line, 'NAME');
      } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const uri = lines[i + 1] || '';
        if (!uri || uri.startsWith('#')) continue;
        const group = attr(line, 'VIDEO');
        variants.push({
          name: (group && groups[group]) || attr(line, 'IVS-NAME') || attr(line, 'STABLE-VARIANT-ID') || group || '?',
          resolution: (/RESOLUTION=(\d+x\d+)/.exec(line) || [])[1] || '',
          bandwidth: numberAttr(line, 'BANDWIDTH') || 0,
          url: uri,
        });
      }
    }
    return variants;
  }

  // the usher URL of a backup: the page's own usher request with token, sig and p replaced (Purple F-08)
  function usherUrl(channel, access, original) {
    const replaced = { token: encodeURIComponent(access.token), sig: encodeURIComponent(access.signature), p: String(Math.floor(Math.random() * 1e7)) };
    if (original) {
      try {
        const url = new URL(original);
        const path = url.pathname.startsWith('/api/v2/') ? '/api/v2/channel/hls/' : '/api/channel/hls/';
        const seen = new Set();
        const params = url.search
          .slice(1)
          .split('&')
          .filter(Boolean)
          .map((pair) => {
            const name = decodeURIComponent(pair.split('=')[0]);
            if (!(name in replaced)) return pair;
            seen.add(name);
            return name + '=' + replaced[name];
          });
        for (const name of Object.keys(replaced)) if (!seen.has(name)) params.push(name + '=' + replaced[name]);
        return 'https://usher.ttvnw.net' + path + encodeURIComponent(channel) + '.m3u8?' + params.join('&');
      } catch {
        // not a URL: Purple's parameters below
      }
    }
    return (
      'https://usher.ttvnw.net/api/channel/hls/' + encodeURIComponent(channel) + '.m3u8?allow_source=true&fast_bread=true&p=' + replaced.p +
      '&player_backend=mediaplayer&playlist_include_framerate=true&reassignments_supported=false&sig=' + replaced.sig +
      '&supported_codecs=avc1&token=' + replaced.token
    );
  }

  // --- GQL: through the page (its original fetch and its headers), else from here -------------------

  function gqlViaPage(body, headers) {
    const id = state.gqlNext++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!state.gqlPending.delete(id)) return;
        resolve(request('https://gql.twitch.tv/gql#origin=twilight', { method: 'POST', headers, body }));
      }, PAGE_GQL_TIMEOUT_MS);
      state.gqlPending.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer.status ? new Response(answer.body || '', { status: answer.status }) : request('https://gql.twitch.tv/gql#origin=twilight', { method: 'POST', headers, body }));
      });
      post({ adblock: 'gql', id, body, headers });
    });
  }

  async function gql(body) {
    const headers = { ...state.gqlHeaders, 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' };
    const response = await gqlViaPage(JSON.stringify(body), headers);
    const text = await response.text();
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new Error('GQL HTTP ' + response.status + ': ' + text.slice(0, 80));
    }
    const access = (answer && answer.data && answer.data.streamPlaybackAccessToken) || (answer && answer.streamPlaybackAccessToken);
    if (access && access.value && access.signature) return { token: access.value, signature: access.signature };
    const error = answer && answer.errors && answer.errors[0] && answer.errors[0].message;
    return { error: error || ('no token in answer: ' + text.slice(0, 80)) };
  }

  async function playbackAccessToken(channel, playerType, platform) {
    const variables = { isLive: true, login: channel, isVod: false, vodID: '', playerType, platform };
    const persisted = await gql({ operationName: 'PlaybackAccessToken', variables, extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_ACCESS_TOKEN_HASH } } });
    if (persisted.token) return persisted;
    const full = await gql({ operationName: 'PlaybackAccessToken_Template', query: PLAYBACK_ACCESS_TOKEN_QUERY, variables });
    if (full.token) return full;
    throw new Error('PlaybackAccessToken ' + playerType + ': ' + (full.error || persisted.error));
  }

  // --- playlist inspection ------------------------------------------------------------------------

  const isStitched = (line) => line.startsWith('#EXT-X-DATERANGE:') && (attr(line, 'CLASS').startsWith('twitch-stitched') || attr(line, 'ID').startsWith('stitched-ad'));

  function inspect(text) {
    const lines = text.split('\n').map((l) => l.trim());
    const classes = new Set();
    let rollType = '';
    let podLength = '';
    let stitched = false;
    let segments = 0;
    let adSegments = 0;
    let mediaSequence = null;
    for (const line of lines) {
      if (line.startsWith('#EXT-X-DATERANGE:')) {
        const cls = attr(line, 'CLASS');
        if (cls) classes.add(cls);
        if (isStitched(line)) {
          stitched = true;
          rollType = rollType || attr(line, 'X-TV-TWITCH-AD-ROLL-TYPE');
          podLength = podLength || attr(line, 'X-TV-TWITCH-AD-POD-LENGTH');
        }
      } else if (line.startsWith('#EXTINF:')) {
        segments++;
        const title = line.slice(line.indexOf(',') + 1).trim();
        if (title && title !== 'live') adSegments++;
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.slice(22), 10);
      } else if (line.startsWith('#EXT-X-CUE-OUT')) {
        classes.add('(EXT-X-CUE-OUT)');
      }
    }
    const verdict = adSegments ? 'ads' : stitched ? 'announced' : 'clean';
    return { classes: [...classes], stitched, rollType, podLength, segments, adSegments, mediaSequence, verdict };
  }

  function onMaster(url, text) {
    const token = tokenFromUsherUrl(url);
    const flags = token ? tokenFlags(token) : {};
    const variants = parseVariants(text);
    let channel = null;
    try {
      channel = decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.m3u8$/, ''));
    } catch {
      // keep null
    }
    const info = { channel, playerType: flags.player_type, flags, variants: variants.map((v) => v.name) };
    log('master ' + (channel || '?') + ' player_type=' + flags.player_type + ' show_ads=' + flags.show_ads + ' server_ads=' + flags.server_ads + ' hide_ads=' + flags.hide_ads + ' variants=' + info.variants.join('/'));
    post({ adblock: 'master', info });
    if (flags.player_type === 'picture-by-picture' && state.usherUrl) return; // the page's own PbyP master: not the stream being watched
    state.channel = channel;
    state.usherUrl = url;
    state.variants = variants;
  }

  function onPlaylist(url, text) {
    if (!text.startsWith('#EXTM3U') || !text.includes('#EXTINF')) return;
    state.polls++;
    const current = state.variants.find((v) => v.url.split('?')[0] === url.split('?')[0]);
    if (current) state.quality = current.name;
    const info = inspect(text);
    const fresh = info.classes.filter((c) => !state.seenClasses.has(c));
    for (const c of fresh) state.seenClasses.add(c);
    if (fresh.length) {
      log('DATERANGE classes seen: ' + fresh.join(', ') + (info.stitched ? ' (roll=' + (info.rollType || '?') + ', pod=' + (info.podLength || '?') + ', adSegments=' + info.adSegments + '/' + info.segments + ')' : ''));
      post({ adblock: 'classes', classes: fresh });
    }
    if (state.polls % 30 === 1) log('poll #' + state.polls + ' quality=' + (state.quality || '?') + ' seq=' + info.mediaSequence + ' segments=' + info.segments + ' classes=[' + info.classes.join(',') + ']');
    if (info.stitched && Date.now() - state.lastProbeAt > PROBE_COOLDOWN_MS) {
      state.lastProbeAt = Date.now();
      const breakInfo = { at: Date.now(), channel: state.channel, quality: state.quality, rollType: info.rollType, podLength: info.podLength, adSegments: info.adSegments, segments: info.segments, classes: info.classes };
      log('AD BREAK in the player playlist: roll=' + (info.rollType || '?') + ' pod=' + (info.podLength || '?') + ' adSegments=' + info.adSegments + '/' + info.segments + ' -> probing backups');
      post({ adblock: 'break', info: breakInfo });
      runProbe(breakInfo).catch((e) => log('probe failed: ' + e));
    }
  }

  // --- the backup probe ---------------------------------------------------------------------------

  async function probeOne({ playerType, platform }, startedAt) {
    const r = { playerType, platform };
    try {
      const access = await playbackAccessToken(state.channel, playerType, platform);
      r.token = tokenFlags(access.token);
      const master = await (await request(usherUrl(state.channel, access, state.usherUrl))).text();
      const variants = parseVariants(master);
      r.variants = variants.map((v) => v.name).join('/');
      const pick = variants.find((v) => v.name === state.quality) || variants[0];
      if (!pick) {
        r.verdict = 'no-variants';
        r.detail = master.replace(/\s+/g, ' ').slice(0, 120);
        return r;
      }
      r.quality = pick.name;
      const playlist = await (await request(pick.url)).text();
      const info = inspect(playlist);
      r.verdict = info.verdict;
      r.adSegments = info.adSegments + '/' + info.segments;
      r.classes = info.classes.join(',');
      r.mediaSequence = info.mediaSequence;
    } catch (e) {
      r.verdict = 'error';
      r.detail = String((e && e.message) || e).slice(0, 160);
    } finally {
      r.ms = Date.now() - startedAt;
    }
    return r;
  }

  async function runProbe(breakInfo) {
    if (state.probing || !state.channel) return;
    state.probing = true;
    const startedAt = Date.now();
    try {
      const results = await Promise.all(PROBE_TYPES.map((p) => probeOne(p, startedAt)));
      const summary = results.map((r) => r.playerType + '=' + r.verdict + (r.quality ? '@' + r.quality : '') + (r.token && r.token.show_ads === false ? '(show_ads:false)' : '')).join('  ');
      log('BACKUP PROBE (' + (Date.now() - startedAt) + ' ms, player at ' + (state.quality || '?') + '): ' + summary);
      for (const r of results) log('  ' + r.playerType + ': ' + JSON.stringify(r));
      post({ adblock: 'probe', result: { at: startedAt, channel: state.channel, quality: state.quality, break: breakInfo, results } });
    } finally {
      state.probing = false;
    }
  }

  // --- the fetch hook: responses are cloned, the player gets the original ----------------------------

  scope.fetch = async function (input, init) {
    const url = urlOf(input);
    const response = await request(input, init);
    try {
      if (isUsher(url)) {
        response.clone().text().then((text) => onMaster(url, text)).catch(() => {});
      } else if (isPlaylist(url)) {
        response.clone().text().then((text) => onPlaylist(url, text)).catch(() => {});
      }
    } catch {
      // never let the probe touch the player's request
    }
    return response;
  };

  log('worker hook installed');
})(self);
