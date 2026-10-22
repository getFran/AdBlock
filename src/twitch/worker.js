// Twitch ad blocking, worker side. This file is bundled first and prepended by src/twitch/page.js to the player's
// own worker script, so it runs in the player worker before Twitch's code and owns its `fetch`.
//
// Ported from Purple Ads Blocker by Arthur Bolsoni, https://github.com/arthurbolsoni/Purple-adblock
// (Apache License 2.0), serviceWorker/src/ as of 2026-10-10:
//   bootstrap.ts, app.controller.ts      the fetch routes: blank URIs, the usher masters, the player's media playlists
//   modules/player/player.ts             stream swap (E4), pinned and contaminated types (F-10), prewarm at the channel
//                                        load and at the page's picture-by-picture request (F-19, F-22), backup sequence
//                                        numbers (F-23), restart when the numbers go back (F-24), backups behind (F-25),
//                                        the backup types asked together (F-26), blank URIs (F-14)
//   modules/player/ad-detector.ts        the ad markers and the three signals of a stitched break (T-203)
//   modules/player/segments.ts           segments read from the playlist lines
//   modules/player/m3u8.ts               merge by PROGRAM-DATE-TIME (F-13), blankAds (F-14), stripAdDateranges (F-20)
//   modules/player/sequence.ts           MEDIA-SEQUENCE against date-time
//   modules/player/blank-segment.ts      BLANK_MP4, from TwitchAdSolutions (MIT, notice below)
//   modules/player/ad-break.ts           the break state machine
//   modules/stream/master.ts, stream.types.ts   variants of a master, picked by quality and codec family (F-11)
//   modules/twitch/twitch.service.ts, page-gql.ts   PlaybackAccessToken through the page, the usher URL (F-08)
// and its findings docs/findings/2026-10-08-backup-behind.md, -blank-segments.md, -prewarm-backups.md,
// 2026-10-09-sequence-numbering.md, -preroll-numbering.md, -prewarm-at-load.md.
//
// Purple's settings are fixed at its defaults of 2026-10-10 (docs/feat.md) except the backup order, which is the one
// decided for this project on 2026-10-15: site, popout, frontpage, mobile_web, embed, then autoplay (platform android,
// 360p) as the last resort. Not in the chain: picture-by-picture (360p only). Not ported: pause/play at the break
// edges (Purple's pausePlayOnBreaks, off by default), the reload after a break (reloadAfterAd, off), the popout token
// for the page's own request (forcePopoutToken) and the whitelist. No settings, no UI.
//
// What reaches the player:
//   - outside a break, every playlist as Twitch sent it (a break announced past the last segment loses only the
//     prefetch lines that point at its first ad segments, and those URIs are answered blank);
//   - on a poll with ad segments, the playlist of the first clean backup of the player's quality, its MEDIA-SEQUENCE
//     aligned to the page's numbering; the type that worked goes first next time, a type that came with ads is left
//     out for 2 s, a type whose playlist only announces its own break gets a new token but its live segments are
//     still usable this poll (announcement stripped), before any drop to 360p;
//   - with no clean backup of the player's quality: the announced one sanitized, else the last same-quality backup
//     again if it is under 3 s old (one poll without new segments beats a resolution switch: the picture froze on
//     2026-10-16 in a break that went 1080p60 <-> 360p five times), else autoplay at 360p;
//   - with none of those, the page's playlist with each ad segment replaced by the backup segment at the same
//     date-time, and the ones left listed as they are but answered with the blank segment when the player asks.
// Diagnostics: console under [AdBlock/twitch:worker], and window.__adblockTwitch on the page (events, breaks, log).

(function (scope) {
  if (scope.__adblockHooked) return;
  scope.__adblockHooked = true;

  const TAG = '[AdBlock/twitch:worker]';
  // true in a release build (build.mjs --release): no console, no playlists kept for a record, no exports for the tests.
  // typeof because test/twitch-playlists.mjs runs this file unbundled, where __RELEASE__ is not defined
  const RELEASE = typeof __RELEASE__ !== 'undefined' && __RELEASE__;
  const request = scope.fetch.bind(scope);
  const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const GQL_URL = 'https://gql.twitch.tv/gql#origin=twilight';
  // persisted query hash and template as used by Brave's vaft scriptlet and Purple (docs/server/tokens.md)
  const PLAYBACK_ACCESS_TOKEN_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
  const PLAYBACK_ACCESS_TOKEN_QUERY =
    'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }}';

  // F-09, this project's order: the types that gave the player's quality in the probe of 2026-10-15 first
  const BACKUP_TYPES = ['site', 'popout', 'frontpage', 'mobile_web', 'embed'];
  const LOW_QUALITY_TYPE = 'autoplay'; // 360p, requested with platform android; never pinned
  const platformOf = (type) => (type === LOW_QUALITY_TYPE ? 'android' : 'web');
  // F-10 had 5 s for a type whose backup had ads; with five web types that each come back with ads within seconds of a
  // fresh token, 5 s left the pool empty 5 times in one 84 s break (esportmaniacos, 2026-10-16) and the player went to
  // 360p each time. A fresh token is ready in 0.3 s: 2 s is enough to let it answer
  const CONTAMINATED_MS = 2000;
  const HOLD_MS = 3000; // a same-quality backup playlist this fresh is given again rather than dropping to 360p or restarting the player for backups one number behind
  const BLANK_TTL_MS = 120000; // F-14: an ad URI is answered blank this long after the last poll that listed it
  const PREWARM_MS = 60000; // F-19: at most one prewarm per this many ms
  const RECOVERING_MS = 10000; // ad-break.ts: clean polls this long after a break bring the state back to idle
  const PAGE_GQL_TIMEOUT_MS = 5000;
  const MAIN_SOURCE = 'page';
  const SEQUENCE_TOLERANCE = 0.05; // sequence.ts: PROGRAM-DATE-TIME jitter, in segments

  // --- blank segment (F-14) --------------------------------------------------------------------------
  // BLANK_MP4 is copied verbatim from TwitchAdSolutions' vaft script, vaft/vaft-ublock-origin.js (hookWorkerFetch,
  // `BLANK_MP4`), by way of Purple's blank-segment.ts:
  //   by ryanbr, the maintained fork: https://github.com/ryanbr/TwitchAdSolutions/blob/74f1248f22a61fcbb559882f93cb60ca25b414e8/vaft/vaft-ublock-origin.js
  //   by pixeltris, the original project: https://github.com/pixeltris/TwitchAdSolutions
  // It is an fMP4 init segment only (ftyp + moov with an mp4a and an avc1 track, no samples): the player gets a valid
  // file with nothing to play instead of the ad.
  //
  // MIT License (TwitchAdSolutions: pixeltris/TwitchAdSolutions and its fork ryanbr/TwitchAdSolutions)
  // Copyright (c) 2020-present TwitchAdSolutions Contributors
  // Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  // documentation files (the "Software"), to deal in the Software without restriction, including without limitation
  // the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  // to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
  // copyright notice and this permission notice shall be included in all copies or substantial portions of the
  // Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
  // LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
  // SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  // OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  // DEALINGS IN THE SOFTWARE.
  const BLANK_MP4 =
    'AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAA' +
    'AAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAA' +
    'AAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAt' +
    'aGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAA' +
    'ABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAA' +
    'AgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAA' +
    'AAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAAD' +
    'AAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAA' +
    'AAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAA' +
    'AABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwg' +
    'AAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAA' +
    'AAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6A' +
    'AA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAA' +
    'AAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAAB' +
    'AACCNQAAAAACQAAA';
  let blankBytes = null;
  // a new Response for each request (a body can be read once)
  function blankSegment() {
    if (!blankBytes) blankBytes = Uint8Array.from(atob(BLANK_MP4), (c) => c.charCodeAt(0));
    return new Response(blankBytes.slice(), { headers: { 'Content-Type': 'video/mp4' } });
  }

  // --- state and messaging -----------------------------------------------------------------------------

  const state = {
    channel: null,
    usherUrl: null,
    quality: null, // name of the variant the player polls (720p60...)
    playerVariants: new Map(), // variant URL without query -> variant of the player's master
    pbypVariants: new Set(), // variant URLs of the page's picture-by-picture masters: never the player's playlist
    backups: new Map(), // playerType -> { variants, token, at }: the stored master of each backup type
    pendingAccess: new Map(), // playerType -> token request in flight
    pinnedType: null, // F-10: type of the last clean backup delivered
    contaminatedUntil: new Map(), // F-10: type -> time until which it is skipped
    blankUris: new Map(), // F-14: ad URI -> time of the last poll that listed it
    lastPrewarm: -Infinity,
    pageSequence: null, // F-23: newest live segment of the last page playlist without ads
    sequenceShifts: new Map(), // F-23: backup variant URL -> shift, for the current break
    source: MAIN_SOURCE, // F-24: where the playlist being built comes from
    delivered: null, // F-24: { source, newest } of the last playlist given to the player
    lastDelivered: null, // the text of that playlist, the reference when the page's own playlist comes back
    pageShift: 0, // what the page's own MEDIA-SEQUENCE gets so that it continues the last delivery after a break, until the next master
    lastBackup: null, // { text, at, quality, source } of the last same-quality backup delivered, for HOLD_MS
    adState: 'idle', // ad-break.ts: idle | ad | recovering
    endedAt: 0,
    break: null, // accounting of the current break, posted to the page at its end
    seenClasses: new Set(),
    polls: 0,
    blankAnswered: 0,
    gqlHeaders: {},
    gqlPending: new Map(),
    gqlNext: 1,
    recent: [], // the last playlist texts seen (player polls, backups, what was delivered): the evidence of a break
  };

  const post = (message) => {
    try {
      scope.postMessage(message);
    } catch {
      // the page is gone
    }
  };
  const log = (...args) => {
    if (RELEASE) return;
    console.log(TAG, ...args);
    post({ adblock: 'log', args: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))) });
  };
  const emit = (type, data) => post({ adblock: 'event', event: { type, at: Date.now(), ...(data || {}) } });
  const RECENT_KEEP = 80;
  const remember = (kind, url, text) => {
    if (RELEASE) return;
    state.recent.push({ at: Date.now(), kind, url: String(url).slice(0, 160), text });
    if (state.recent.length > RECENT_KEEP) state.recent.splice(0, state.recent.length - RECENT_KEEP);
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
    } else if (data.funcName === 'adblockDump') {
      // the page is writing a record: this worker's state and its recent playlists
      post({
        adblock: 'dump',
        name: data.name,
        dump: {
          channel: state.channel,
          quality: state.quality,
          pinnedType: state.pinnedType,
          adState: state.adState,
          backups: [...state.backups.keys()],
          contaminated: [...state.contaminatedUntil.entries()],
          polls: state.polls,
          blankAnswered: state.blankAnswered,
          delivered: state.delivered,
          pageShift: state.pageShift,
          recent: state.recent,
        },
      });
    }
  });

  // --- helpers -----------------------------------------------------------------------------------------

  const urlOf = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url) || '';
  const withoutQuery = (url) => url.split(/[?#]/)[0];
  const isUsher = (url) => /^https:\/\/usher\.ttvnw\.net\/api\/(v2\/)?channel\/hls\//.test(url);
  const isM3u8 = (url) => /\.m3u8(\?|$)/.test(url);
  const attr = (line, name) => {
    const at = line.indexOf(name + '="');
    if (at < 0) return '';
    const start = at + name.length + 2;
    return line.slice(start, line.indexOf('"', start));
  };
  const numberAttr = (line, name) => parseFloat((new RegExp('[:,]' + name + '=([0-9.]+)').exec(line) || [])[1] || '');
  const uriAttr = (line) => (/URI="([^"]*)"/.exec(line) || [])[1] || null;

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

  function channelFromUsher(url) {
    try {
      return decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.m3u8$/, ''));
    } catch {
      return null;
    }
  }

  const isPbypUsher = (url) => {
    const token = tokenFromUsherUrl(url);
    return token ? tokenFlags(token).player_type === 'picture-by-picture' : url.includes('picture-by-picture');
  };

  // --- master playlists: variants, picked by quality and codec family (master.ts, stream.types.ts) -------

  // EXT-X-MEDIA NAME of the variant's VIDEO group (v1 masters), else IVS-NAME / STABLE-VARIANT-ID (the page's v2 master)
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
          codecs: attr(line, 'CODECS'),
          bandwidth: numberAttr(line, 'BANDWIDTH') || 0,
          url: uri,
        });
      }
    }
    return variants;
  }

  function codecFamily(codecs) {
    for (const codec of String(codecs || '').split(',').map((c) => c.trim().toLowerCase())) {
      if (codec.startsWith('avc1') || codec.startsWith('avc3')) return 'avc';
      if (codec.startsWith('hvc1') || codec.startsWith('hev1')) return 'hevc';
      if (codec.startsWith('av01')) return 'av1';
    }
    return '';
  }
  const qualityName = (quality) => String(quality || '').replace(/\s*\(source\)\s*$/i, '').trim();
  const highest = (list) => list.reduce((best, x) => (!best || x.bandwidth > best.bandwidth ? x : best), undefined);

  // F-11: same quality and codec family; else the same resolution, same family first; else the best of the family
  function pickVariant(list, target) {
    const family = codecFamily(target.codecs);
    const quality = qualityName(target.quality);
    const sameFamily = (x) => family !== '' && codecFamily(x.codecs) === family;
    if (family) {
      const same = highest(list.filter((x) => sameFamily(x) && quality !== '' && qualityName(x.name) === quality));
      if (same) return same;
    } else if (quality) {
      const named = list.find((x) => qualityName(x.name) === quality);
      if (named) return named;
    }
    if (target.resolution) {
      const sameResolution = list.filter((x) => x.resolution === target.resolution);
      const found = highest(sameResolution.filter(sameFamily)) || highest(sameResolution);
      if (found) return found;
    }
    return highest(list.filter(sameFamily)) || highest(list);
  }

  // --- segments of a media playlist (segments.ts) -------------------------------------------------------

  const EXTINF = /^#EXTINF:([^,]*),?(.*)$/;

  // The tags between two URI lines belong to the segment of the second one; tags after the last URI belong to none.
  // time: the segment's own PROGRAM-DATE-TIME in ms, or the previous segment's time plus its duration.
  function readSegments(lines) {
    const segments = [];
    let extinf = -1;
    let ownTime = null;
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
        const time = Date.parse(line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length));
        ownTime = Number.isNaN(time) ? null : time;
      } else if (line.startsWith('#EXTINF:')) {
        extinf = index;
      } else if (line && !line.startsWith('#')) {
        const m = extinf >= 0 ? EXTINF.exec(lines[extinf].trim()) || [] : [];
        const durationText = m[1] || '';
        const title = (m[2] || '').trim();
        const previous = segments[segments.length - 1];
        const time = ownTime != null ? ownTime : previous && previous.time != null ? previous.time + previous.duration * 1000 : null;
        segments.push({ extinf, uri: index, duration: parseFloat(durationText) || 0, durationText, title, time });
        extinf = -1;
        ownTime = null;
      }
    });
    return segments;
  }

  // --- ad detection (ad-detector.ts): the only place that knows the ad markers --------------------------

  const TITLE_MARKERS = ['stitched', 'Amazon', 'DCM,'];
  const URI_MARKERS = ['/adsquared/', '/_404/', '/processing'];
  const AD_CLASSES = ['twitch-stitched-ad', 'twitch-maf-ad'];
  const AD_ATTRIBUTES = ['X-TV-TWITCH-AD-AD-SESSION-ID=', 'X-TV-TWITCH-AD-RADS-TOKEN='];

  const isAdUri = (uri) => URI_MARKERS.some((marker) => uri.includes(marker));
  const isAdSegment = (title, uri) => TITLE_MARKERS.some((marker) => title.includes(marker)) || isAdUri(uri);
  const isStitchedMarker = (line) => line.startsWith('#EXT-X-DATERANGE:') && (attr(line, 'CLASS').startsWith('twitch-stitched') || attr(line, 'ID').startsWith('stitched-ad'));

  // twitch-trigger alone is in every playlist (B-021): it counts only with an ad attribute
  function isPlaylistMarker(line) {
    if (line.startsWith('#EXT-X-CUE-OUT')) return true;
    if (!line.startsWith('#EXT-X-DATERANGE:')) return false;
    const cls = attr(line, 'CLASS');
    return AD_CLASSES.includes(cls) || cls.startsWith('twitch-stitched') || attr(line, 'ID').startsWith('stitched-ad') || AD_ATTRIBUTES.some((a) => line.includes(a));
  }

  // T-203: in a playlist with a stitched-ad marker, a segment is an ad when its title is not "live", when a stitched-ad
  // START-DATE + DURATION covers more than half of it, or when the twitch-stream-source in force at its time is not "live"
  function stitchedBreak(lines) {
    if (!lines.some(isStitchedMarker)) return null;
    const ranges = [];
    const sources = [];
    for (const line of lines) {
      if (!line.startsWith('#EXT-X-DATERANGE:')) continue;
      const start = Date.parse(attr(line, 'START-DATE'));
      if (Number.isNaN(start)) continue;
      const duration = numberAttr(line, 'DURATION');
      if (isStitchedMarker(line) && duration > 0) ranges.push({ start, end: start + duration * 1000 });
      if (attr(line, 'CLASS') === 'twitch-stream-source') sources.push({ start, value: attr(line, 'X-TV-TWITCH-STREAM-SOURCE') });
    }
    sources.sort((a, b) => a.start - b.start);
    return ({ title, time, duration }) => {
      if (title && title !== 'live') return true;
      if (time == null) return false;
      const end = time + duration * 1000;
      if (ranges.some((range) => Math.min(end, range.end) - Math.max(time, range.start) > (duration * 1000) / 2)) return true;
      const source = sources.filter((s) => s.start <= time).pop();
      return source != null && source.value !== 'live';
    };
  }

  // class of a media playlist (NONE, MARKED_LIVE, SSAI) and the indexes of its ad segments
  function detectAds(text) {
    const lines = text.split('\n').map((line) => line.trim());
    const inStitchedBreak = stitchedBreak(lines);
    const adSegments = [];
    readSegments(lines).forEach((segment, index) => {
      if (isAdSegment(segment.title, lines[segment.uri]) || (inStitchedBreak && inStitchedBreak(segment))) adSegments.push(index);
    });
    if (adSegments.length) return { class: 'SSAI', adSegments };
    return { class: lines.some(isPlaylistMarker) ? 'MARKED_LIVE' : 'NONE', adSegments };
  }

  // T-204: a backup is clean when it has no ad segment and no stitched-ad marker (an announced break of its own)
  const isCleanBackup = (text) => detectAds(text).class !== 'SSAI' && !text.split('\n').some((line) => isStitchedMarker(line.trim()));

  // what the logs say about a playlist
  function summarize(text) {
    const lines = text.split('\n').map((l) => l.trim());
    const classes = new Set();
    let rollType = '';
    let podLength = '';
    let stitched = false;
    let segments = 0;
    for (const line of lines) {
      if (line.startsWith('#EXT-X-DATERANGE:')) {
        const cls = attr(line, 'CLASS');
        if (cls) classes.add(cls);
        if (isStitchedMarker(line)) {
          stitched = true;
          rollType = rollType || attr(line, 'X-TV-TWITCH-AD-ROLL-TYPE');
          podLength = podLength || attr(line, 'X-TV-TWITCH-AD-POD-LENGTH');
        }
      } else if (line.startsWith('#EXTINF:')) {
        segments++;
      } else if (line.startsWith('#EXT-X-CUE-OUT')) {
        classes.add('(EXT-X-CUE-OUT)');
      }
    }
    const detected = detectAds(text);
    return { classes: [...classes], stitched, rollType, podLength, segments, adSegments: detected.adSegments.length, cls: detected.class, mediaSequence: mediaSequence(lines) };
  }

  // --- sequence numbers against date-time (sequence.ts) -------------------------------------------------

  const MEDIA_SEQUENCE = '#EXT-X-MEDIA-SEQUENCE:';

  function mediaSequence(lines) {
    const line = lines.find((raw) => raw.trim().startsWith(MEDIA_SEQUENCE));
    const value = line ? Number(line.trim().slice(MEDIA_SEQUENCE.length)) : NaN;
    return Number.isInteger(value) ? value : null;
  }

  // F-24: the last number the player can fetch from a playlist, prefetch URIs included
  function newestNumber(text) {
    const lines = text.split('\n');
    const first = mediaSequence(lines);
    if (first == null) return null;
    const count = lines.filter((raw) => {
      const line = raw.trim();
      return line.startsWith('#EXTINF:') || line.startsWith('#EXT-X-TWITCH-PREFETCH:');
    }).length;
    return first + count - 1;
  }

  // the newest segment that is not an ad and has a date-time; with beforeAds, the newest before the first ad segment
  function sequenceReference(text, beforeAds) {
    const lines = text.split('\n');
    const first = mediaSequence(lines);
    if (first == null) return null;
    const segments = readSegments(lines);
    const ads = new Set(detectAds(text).adSegments);
    const end = beforeAds && ads.size ? Math.min(...ads) : segments.length;
    for (let index = end - 1; index >= 0; index--) {
      const segment = segments[index];
      if (!ads.has(index) && segment.time != null && segment.duration > 0) return { sequence: first + index, time: segment.time, duration: segment.duration };
    }
    return null;
  }

  // what to add to the backup's numbers so each of its segments gets the number the page's playlist gives the moment
  // where it ends (a backup segment starting inside a page segment gets the next number)
  function sequenceShift(backup, reference) {
    const own = sequenceReference(backup);
    if (!own) return null;
    const position = reference.sequence + (own.time - reference.time) / (reference.duration * 1000);
    return Math.ceil(position - own.sequence - SEQUENCE_TOLERANCE) || 0;
  }

  // only the MEDIA-SEQUENCE line moves; EXT-X-TWITCH-LIVE-SEQUENCE stays (it numbers the live stream alike on every token)
  function shiftSequence(text, shift) {
    if (!shift) return text;
    const lines = text.split('\n');
    const index = lines.findIndex((raw) => raw.trim().startsWith(MEDIA_SEQUENCE));
    const first = mediaSequence(lines);
    if (index < 0 || first == null) return text;
    lines[index] = lines[index].replace(String(first), String(first + shift));
    return lines.join('\n');
  }

  // what to add to the page's own numbers when its playlist comes back after a delivery from another source, so that
  // its segments continue the numbers the player holds. Live segments of 1 s and ad segments of 2 s (caedrel247,
  // 2026-10-19) leave the page's count 19 numbers behind the backups' after a 76 s break: given as it came, the player
  // waits for numbers that are 19 s away and F-24 restarts it at the end of every break. null when either side has no
  // dated segment; 0 when the page already continues the delivery (the usual case with segments of the same length)
  function pageRebase(page, delivered) {
    const reference = sequenceReference(delivered);
    return reference ? sequenceShift(page, reference) : null;
  }

  // --- playlist edits (m3u8.ts): on the lines of the original text, every tag kept where it was ----------

  // EXT-X-MAP line in effect for each segment, in segment order; null in a playlist without one
  function mapsOf(lines, segments) {
    const maps = [];
    let current = null;
    let next = 0;
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line.startsWith('#EXT-X-MAP:')) current = line;
      while (next < segments.length && segments[next].uri === index) {
        maps.push(current);
        next++;
      }
    });
    return maps;
  }

  // F-13: a backup segment matches when its PROGRAM-DATE-TIME is less than half the ad segment's duration away
  function nearest(candidates, segment) {
    if (segment.time == null) return undefined;
    const tolerance = ((segment.duration > 0 ? segment.duration : 2) * 1000) / 2;
    let best;
    for (const candidate of candidates) {
      if (candidate.time == null) continue;
      const distance = Math.abs(candidate.time - segment.time);
      if (distance < tolerance && (!best || distance < Math.abs(best.time - segment.time))) best = candidate;
    }
    return best;
  }

  const isAheadLine = (line) => line.startsWith('#EXT-X-TWITCH-PREFETCH:') || line.startsWith('#EXT-X-PRELOAD-HINT:') || line.startsWith('#EXT-X-PART:');

  // Each ad segment of the main playlist (first text) gets the nearest live segment of a backup, backups in order;
  // only its #EXTINF and URI lines change. A backup segment with another EXT-X-MAP brings that MAP line before it and
  // the main one comes back before the next main segment; a backup with EXT-X-MAP is not used in a playlist without one.
  function mergeWithBackups(contents) {
    if (!contents.length) return { text: '', replaced: 0, remaining: [] };
    const main = contents[0];
    const backups = contents.slice(1);
    const lines = main.split('\n');
    const backupSegments = backups.map((text) => {
      const backupLines = text.split('\n');
      const segments = readSegments(backupLines);
      const maps = mapsOf(backupLines, segments);
      const ads = new Set(detectAds(text).adSegments);
      const out = [];
      segments.forEach((segment, index) => {
        if (!ads.has(index)) out.push({ ...segment, uriLine: backupLines[segment.uri].trim(), map: maps[index] });
      });
      return out;
    });

    const segments = readSegments(lines);
    const mainMaps = mapsOf(lines, segments);
    const ads = new Set(detectAds(main).adSegments);
    const replacements = new Map();
    const remaining = [];
    segments.forEach((segment, index) => {
      if (!ads.has(index)) return;
      const usable = (candidate) => (candidate.map == null) === (mainMaps[index] == null);
      let replacement;
      for (const candidates of backupSegments) {
        replacement = nearest(candidates.filter(usable), segment);
        if (replacement) break;
      }
      if (replacement) replacements.set(index, replacement);
      else remaining.push(index);
    });
    if (!replacements.size) return { text: main, replaced: 0, remaining };

    // the line each segment starts at for the MAP it needs: its #EXTINF, else its URI
    const anchors = new Map(segments.map((segment, index) => [segment.extinf >= 0 ? segment.extinf : segment.uri, index]));
    const lastUri = segments.length ? segments[segments.length - 1].uri : -1;
    const out = [];
    let mainMap = null;
    let outMap = null;
    const useMap = (map) => {
      if (map == null || map === outMap) return;
      out.push(map);
      outMap = map;
    };
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line.startsWith('#EXT-X-MAP:')) {
        mainMap = outMap = line;
        out.push(raw);
        return;
      }
      const anchored = anchors.get(index);
      if (anchored != null) {
        const r = replacements.get(anchored);
        useMap(r ? r.map : mainMap);
      } else if (index > lastUri && isAheadLine(line)) {
        useMap(mainMap);
      }
      const owner = segments.findIndex((segment) => segment.extinf === index || segment.uri === index);
      const replacement = owner >= 0 ? replacements.get(owner) : undefined;
      if (!replacement) out.push(raw);
      else if (segments[owner].extinf === index) out.push('#EXTINF:' + replacement.durationText + ',' + replacement.title);
      else out.push(replacement.uriLine);
    });
    return { text: out.join('\n'), replaced: replacements.size, remaining };
  }

  // URI of a line that makes the player fetch media ahead of the segments
  function aheadUri(line) {
    if (line.startsWith('#EXT-X-TWITCH-PREFETCH:')) return line.slice('#EXT-X-TWITCH-PREFETCH:'.length).trim();
    if (line.startsWith('#EXT-X-PART:') || line.startsWith('#EXT-X-PRELOAD-HINT:')) return uriAttr(line);
    return null;
  }

  // F-14: the ad segments no backup replaced (adSegments: indexes in segment order) keep their lines and their URIs are
  // listed, with the EXT-X-MAP only ad segments use, for the fetch hook to answer with the blank segment. Lines that make
  // the player fetch ad media ahead go, and their URIs are listed too: the EXT-X-PART lines of an ad segment; the
  // PART, PRELOAD-HINT and TWITCH-PREFETCH lines after the last segment when it is an ad or when they follow a break
  // announced after it (B-034); any of them with an ad URI. A break announced past the last segment also loses the
  // EXT-X-DISCONTINUITY and EXT-X-MAP lines that follow it: they open the ad's timeline, which the player never gets
  // (2026-10-16: a midroll swapped clean left the picture frozen while the clock ran). Every other line stays.
  function blankAds(text, adSegments, playlistUrl) {
    const lines = text.split('\n');
    const segments = readSegments(lines);
    const ads = new Set(adSegments.filter((index) => index >= 0 && index < segments.length));
    const resolve = (uri) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
      try {
        return new URL(uri, playlistUrl).href;
      } catch {
        return uri;
      }
    };

    const segmentUris = [...ads].sort((a, b) => a - b).map((index) => resolve(lines[segments[index].uri].trim()));
    const known = new Set(segmentUris);
    const last = segments.length - 1;
    const lastUri = last >= 0 ? segments[last].uri : -1;
    const announced = lines.findIndex((line, index) => index > lastUri && isStitchedMarker(line.trim()));

    const maps = [];
    const ahead = [];
    const removed = new Set();
    let map = null;
    const closeMap = () => {
      if (map && map.segments.length && map.segments.every((index) => ads.has(index))) maps.push(map.uri);
    };
    let owner = 0; // segment whose URI line comes next: the tags before a URI line belong to that segment
    lines.forEach((raw, index) => {
      while (owner < segments.length && segments[owner].uri < index) owner++;
      const line = raw.trim();
      if (announced >= 0 && index > announced && (line.startsWith('#EXT-X-DISCONTINUITY') || line.startsWith('#EXT-X-MAP:'))) {
        removed.add(index);
        return;
      }
      if (line.startsWith('#EXT-X-MAP:')) {
        closeMap();
        const uri = uriAttr(line);
        map = uri == null ? null : { uri: resolve(uri), segments: [] };
        return;
      }
      if (owner < segments.length && segments[owner].uri === index) {
        if (map) map.segments.push(owner);
        return;
      }
      const uri = aheadUri(line);
      if (uri == null) return;
      const absolute = resolve(uri);
      const tail = owner >= segments.length;
      const ad =
        known.has(absolute) ||
        isAdUri(absolute) ||
        (!tail && line.startsWith('#EXT-X-PART:') && ads.has(owner)) ||
        (tail && (ads.has(last) || (announced >= 0 && index > announced)));
      if (!ad) return;
      removed.add(index);
      ahead.push(absolute);
    });
    closeMap();

    return {
      text: removed.size ? lines.filter((_, index) => !removed.has(index)).join('\n') : text,
      uris: [...segmentUris, ...maps, ...ahead],
      segments: segmentUris.length,
    };
  }

  // F-20: the ad's own DATERANGE lines, which the page's ad UI starts from, leave a playlist we deliver edited
  const AD_DATERANGE = /^#EXT-X-DATERANGE:.*CLASS="(twitch-stitched-ad|twitch-ad-quartile)"/;
  function stripAdDateranges(text) {
    const lines = text.split('\n');
    const kept = lines.filter((line) => !AD_DATERANGE.test(line.trim()));
    return kept.length === lines.length ? text : kept.join('\n');
  }

  // --- GQL through the page (its original fetch and its headers), else from here (page-gql.ts) ------------

  function gqlViaPage(body, headers) {
    const id = state.gqlNext++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!state.gqlPending.delete(id)) return;
        log('GQL request ' + id + ' not answered by the page; sent from the worker');
        resolve(request(GQL_URL, { method: 'POST', headers, body }));
      }, PAGE_GQL_TIMEOUT_MS);
      state.gqlPending.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer.status ? new Response(answer.body || '', { status: answer.status }) : request(GQL_URL, { method: 'POST', headers, body }));
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
    return { error: error || 'no token in answer: ' + text.slice(0, 80) };
  }

  // F-07: the persisted query first, the full query when it gives no token
  async function playbackAccessToken(channel, playerType, platform) {
    const variables = { isLive: true, login: channel, isVod: false, vodID: '', playerType, platform };
    const persisted = await gql({ operationName: 'PlaybackAccessToken', variables, extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_ACCESS_TOKEN_HASH } } });
    if (persisted.token) return persisted;
    const full = await gql({ operationName: 'PlaybackAccessToken_Template', query: PLAYBACK_ACCESS_TOKEN_QUERY, variables });
    if (full.token) return full;
    throw new Error('PlaybackAccessToken ' + playerType + ': ' + (full.error || persisted.error));
  }

  // F-08: the usher URL of a backup is the page's own usher request with token, sig and p replaced
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

  // --- the backup masters, one per player type (stream.ts) ----------------------------------------------

  // a token request for a type while one is in flight waits for it
  function createStreamAccess(type) {
    if (!state.channel) return Promise.resolve();
    const inFlight = state.pendingAccess.get(type);
    if (inFlight) return inFlight;
    const pending = requestStreamAccess(type).finally(() => state.pendingAccess.delete(type));
    state.pendingAccess.set(type, pending);
    return pending;
  }

  async function requestStreamAccess(type) {
    const channel = state.channel;
    const started = Date.now();
    try {
      const access = await playbackAccessToken(channel, type, platformOf(type));
      const master = await (await request(usherUrl(channel, access, state.usherUrl))).text();
      const variants = parseVariants(master);
      if (channel !== state.channel) return; // the player moved to another channel meanwhile
      if (!variants.length) {
        log('backup ' + type + ': master without variants (' + master.replace(/\s+/g, ' ').slice(0, 100) + ')');
        return;
      }
      state.backups.set(type, { variants, token: tokenFlags(access.token), at: Date.now() });
      log('backup ' + type + ': master ready in ' + (Date.now() - started) + ' ms, variants ' + variants.map((v) => v.name).join('/'));
    } catch (e) {
      log('backup ' + type + ': token or master failed: ' + String((e && e.message) || e).slice(0, 160));
    }
  }

  // F-19, F-22: a token for each backup type with no stored master, at most once per PREWARM_MS
  function prewarmBackups(reason) {
    if (!state.channel) return;
    const now = Date.now();
    if (now - state.lastPrewarm < PREWARM_MS) return;
    const types = backupPlayerTypes().filter((type) => !state.backups.has(type));
    if (!types.length) return;
    state.lastPrewarm = now;
    for (const type of types) createStreamAccess(type);
    log('prewarm (' + reason + '): tokens asked for ' + types.join(', '));
    emit('backupsPrewarmed', { reason, types });
  }

  // --- the player (player.ts) --------------------------------------------------------------------------

  // F-09 + F-10: the pinned type first, autoplay last
  function backupPlayerTypes() {
    const pinned = state.pinnedType && BACKUP_TYPES.includes(state.pinnedType) ? state.pinnedType : null;
    const ordered = pinned ? [pinned, ...BACKUP_TYPES.filter((type) => type !== pinned)] : BACKUP_TYPES.slice();
    return [...ordered, LOW_QUALITY_TYPE];
  }

  // F-11: the variant of the player's master the polled playlist belongs to, else the quality name
  function variantTarget(url) {
    const variant = state.playerVariants.get(withoutQuery(url));
    return variant ? { quality: variant.name, resolution: variant.resolution, codecs: variant.codecs } : { quality: state.quality || '' };
  }

  function pauseAndPlay(why) {
    log('pause/play requested: ' + why);
    post({ adblock: 'pause' });
    post({ adblock: 'play' });
    post({ adblock: 'play' });
  }

  async function fetchBackup(type, target) {
    const master = state.backups.get(type);
    if (!master) return { type, data: null, dump: [], contaminated: false, verdict: 'no-master' };
    const variant = pickVariant(master.variants, target);
    if (!variant) {
      state.backups.delete(type);
      return { type, data: null, dump: [], contaminated: false, verdict: 'no-variant' };
    }
    let text;
    try {
      const response = await request(variant.url);
      if (!response.ok) throw new Error('status ' + response.status);
      text = await response.text();
    } catch (e) {
      state.backups.delete(type);
      return { type, data: null, dump: [], contaminated: false, verdict: 'error', detail: String((e && e.message) || e).slice(0, 100), variant };
    }
    remember('backup:' + type, variant.url, text);
    if (!isCleanBackup(text)) {
      // T-204: a backup announcing its own break is dropped like one with ads; its live segments still serve the merge
      state.backups.delete(type);
      return { type, data: null, dump: [text], contaminated: true, verdict: detectAds(text).class === 'SSAI' ? 'ads' : 'announced', variant };
    }
    return { type, data: text, dump: [text], contaminated: false, verdict: 'clean', variant };
  }

  // F-09, F-10: a type that gave no clean backup gets a new token; one whose backup had ad segments is left out for a
  // while. One that only announced its break is not: its live segments serve this poll and the new token the next
  function noteBackup(backup, dump) {
    if (!backup.data) createStreamAccess(backup.type);
    for (const text of backup.dump) dump.push(text);
    if (backup.verdict === 'ads') state.contaminatedUntil.set(backup.type, Date.now() + CONTAMINATED_MS);
  }

  // F-23: the backup gets the numbers the page's playlist gives the same date-time; one shift per variant and break
  function alignSequence(backup, variant, main) {
    const key = withoutQuery(variant.url);
    let shift = state.sequenceShifts.get(key);
    if (shift == null) {
      const reference = state.pageSequence || sequenceReference(main, true);
      const computed = reference ? sequenceShift(backup, reference) : null;
      if (computed == null) return { text: backup, shift: null };
      shift = computed;
      state.sequenceShifts.set(key, shift);
      if (shift) emit('sequenceShifted', { playerType: null, shift });
    }
    return { text: shiftSequence(backup, shift), shift };
  }

  // F-25: a playlist from another source whose newest number is not past the last one's: the player would wait
  function listsNothingNew(text, source) {
    if (!state.delivered || state.delivered.source === source) return false;
    const newest = newestNumber(text);
    return newest != null && newest <= state.delivered.newest;
  }

  function useBackup(backup, aligned, source) {
    if (backup.type !== LOW_QUALITY_TYPE) state.pinnedType = backup.type;
    const b = state.break;
    const quality = backup.variant ? backup.variant.name : '?';
    if (b) {
      b.swapped++;
      const last = b.backups[b.backups.length - 1];
      if (!last || last.type !== backup.type || last.quality !== quality) b.backups.push({ type: backup.type, quality, at: Date.now(), shift: aligned.shift });
    }
    if (state.source !== source) {
      log('player <- backup ' + backup.type + '@' + quality + ' (MEDIA-SEQUENCE shift ' + (aligned.shift == null ? 'n/a' : (aligned.shift >= 0 ? '+' : '') + aligned.shift) + ', newest ' + newestNumber(aligned.text) + ')');
      emit('backupUsed', { playerType: backup.type, quality, shift: aligned.shift });
    }
    state.source = source;
    if (backup.type !== LOW_QUALITY_TYPE) state.lastBackup = { text: aligned.text, at: Date.now(), quality, source };
    return aligned.text;
  }

  // F-14: these URIs are answered with the blank segment from now on
  function listBlank(uris, counted) {
    const now = Date.now();
    const added = uris.slice(0, counted).filter((uri) => !isBlankSegment(uri)).length;
    for (const [uri, at] of state.blankUris) if (now - at > BLANK_TTL_MS) state.blankUris.delete(uri);
    for (const uri of uris) state.blankUris.set(uri, now);
    if (added) {
      if (state.break) state.break.blankListed += added;
      emit('blankInserted', { count: added });
      post({ adblock: 'blank', uris: uris.slice(0, counted) });
    }
  }

  function isBlankSegment(url) {
    const at = state.blankUris.get(url);
    return at != null && Date.now() - at <= BLANK_TTL_MS;
  }

  // ad-break.ts: idle -> ad on the first poll with ad segments, ad -> recovering on the first without, back to idle
  // after RECOVERING_MS of clean polls; ads inside that window are the same break
  function adBreakPoll(ads, text, summary) {
    const now = Date.now();
    switch (state.adState) {
      case 'idle':
        if (ads) {
          state.adState = 'ad';
          startBreak(now, summary, false);
        }
        break;
      case 'ad':
        if (!ads) {
          state.adState = 'recovering';
          state.endedAt = now;
          endBreak(now);
        }
        break;
      case 'recovering':
        if (ads) {
          state.adState = 'ad';
          startBreak(now, summary, true);
        } else if (now - state.endedAt >= RECOVERING_MS) {
          state.adState = 'idle';
          state.break = null;
        }
        break;
    }
  }

  function startBreak(now, summary, resumed) {
    state.break = {
      at: now,
      resumed,
      channel: state.channel,
      quality: state.quality,
      rollType: summary.rollType,
      podLength: summary.podLength,
      adSegments: summary.adSegments,
      segments: summary.segments,
      classes: summary.classes,
      polls: 0,
      swapped: 0,
      merged: 0,
      blanked: 0,
      blankListed: 0,
      held: 0,
      backups: [],
    };
    log('AD BREAK' + (resumed ? ' (again)' : '') + ' in the player playlist: roll=' + (summary.rollType || '?') + ' pod=' + (summary.podLength || '?') + ' adSegments=' + summary.adSegments + '/' + summary.segments + ' seq=' + summary.mediaSequence + ' quality=' + (state.quality || '?'));
    post({ adblock: 'break', info: { ...state.break } });
  }

  function endBreak(now) {
    const b = state.break;
    if (!b) return;
    const info = { ...b, endedAt: now, durationMs: now - b.at, blankAnswered: state.blankAnswered, playlists: RELEASE ? [] : state.recent.filter((r) => r.at >= b.at - 10000) };
    log('AD BREAK over after ' + Math.round(info.durationMs / 1000) + ' s: polls=' + b.polls + ' swapped=' + b.swapped + ' held=' + (b.held || 0) + ' merged=' + b.merged + ' blanked=' + b.blanked + ' (uris listed ' + b.blankListed + ', answered blank so far ' + state.blankAnswered + ') backups=' + (b.backups.map((x) => x.type + '@' + x.quality).join(' > ') || 'none'));
    post({ adblock: 'break-end', info });
  }

  // F-24: the player asks for the number after the last segment it fetched; when the playlist now comes from another
  // source and numbers below that, it would wait for numbers that never come: it is restarted (pause and play) once
  function followSequence(text) {
    const newest = newestNumber(text);
    if (newest == null) return;
    const previous = state.delivered;
    state.delivered = { source: state.source, newest };
    state.lastDelivered = text;
    if (!previous || previous.source === state.source || newest >= previous.newest) return;
    log('sequence back ' + previous.newest + ' -> ' + newest + ' at a change of source (' + previous.source.slice(-24) + ' -> ' + state.source.slice(-24) + ')');
    emit('sequenceRestart', { from: previous.newest, to: newest });
    pauseAndPlay('sequence back');
  }

  async function onFetch(text, url) {
    state.source = MAIN_SOURCE;
    // the page's numbers as the player knows them: every backup of this break is aligned to these (F-23)
    let out = await playlistFor(shiftSequence(text, state.pageShift), url);
    if (state.source === MAIN_SOURCE) out = rebasePage(out);
    followSequence(out);
    return out;
  }

  // the page's own playlist after a delivery from another source: its numbers get what continues that delivery, kept
  // for every page playlist until the next master. With segments of the same length on both sides this is 0
  function rebasePage(text) {
    const previous = state.delivered;
    if (!previous || previous.source === MAIN_SOURCE || !state.lastDelivered) return text;
    const extra = pageRebase(text, state.lastDelivered);
    if (!extra) return text;
    state.pageShift += extra;
    if (state.pageSequence) state.pageSequence = { ...state.pageSequence, sequence: state.pageSequence.sequence + extra }; // read before the rebase (F-23 reference)
    log('page playlist numbered ' + (extra > 0 ? '+' : '') + extra + ' to continue the last delivery (newest ' + newestNumber(text) + ' -> ' + (newestNumber(text) + extra) + '; offset now ' + (state.pageShift > 0 ? '+' : '') + state.pageShift + ')');
    emit('pageRebased', { shift: extra, total: state.pageShift });
    return shiftSequence(text, extra);
  }

  // the last same-quality backup playlist, given again while it is fresh (HOLD_MS): the player sees a poll without a
  // new segment, as live HLS has anyway, instead of a drop to 360p or a restart. null when there is none to give
  function holdLast(target, now, why) {
    const held = state.lastBackup;
    if (!held || now - held.at > HOLD_MS || qualityName(held.quality) !== qualityName(target.quality)) return null;
    log(why + ': the last ' + (target.quality || '?') + ' playlist (' + Math.round((now - held.at) / 100) / 10 + ' s old) given again');
    emit('backupHeld', { ageMs: now - held.at, why });
    const b = state.break;
    if (b) b.held = (b.held || 0) + 1;
    state.source = held.source;
    return held.text;
  }

  async function playlistFor(text, url) {
    if (!state.channel) return text;
    const summary = summarize(text);
    notePoll(summary);

    if (summary.cls === 'MARKED_LIVE') {
      // markers over live segments: the ad comes client-side (twitch-maf-ad, answered empty by the page) or the break
      // is announced past the last segment (B-034): its prefetch lines go and their URIs are answered blank
      state.pageSequence = sequenceReference(text) || state.pageSequence;
      const announced = blankAds(text, [], url);
      if (!announced.uris.length) return text;
      listBlank(announced.uris, announced.uris.length);
      log('break announced past the last segment: ' + announced.uris.length + ' prefetch URI(s) removed and answered blank');
      return stripAdDateranges(announced.text);
    }
    if (summary.cls !== 'SSAI') {
      adBreakPoll(false, text, summary);
      state.pageSequence = sequenceReference(text) || state.pageSequence;
      state.sequenceShifts.clear();
      return text;
    }

    adBreakPoll(true, text, summary);
    const b = state.break;
    if (b) b.polls++;
    emit('adDetected', { adSegments: summary.adSegments, segments: summary.segments });

    // F-09, F-10, F-25, F-26: the first type alone, then the rest at once, in order; a clean backup that lists nothing
    // past the player's newest number waits for the types after it. autoplay (360p) waits for everything of the
    // player's quality: a clean web type, an announced one with its announcement stripped, the last delivery held
    const dump = [];
    const target = variantTarget(url);
    const now = Date.now();
    const types = backupPlayerTypes().filter((type) => (state.contaminatedUntil.get(type) || 0) <= now);
    const rounds = [types.slice(0, 1), types.slice(1)].filter((round) => round.length);
    let behind = null;
    let announced = null;
    let low = null;
    for (const round of rounds) {
      const backups = await Promise.all(round.map((type) => fetchBackup(type, target)));
      for (const backup of backups) noteBackup(backup, dump);
      log('backups: ' + backups.map((x) => x.type + '=' + x.verdict + (x.variant ? '@' + x.variant.name : '') + (x.detail ? '(' + x.detail + ')' : '')).join('  '));
      for (const backup of backups) {
        if (backup.type === LOW_QUALITY_TYPE) {
          if (backup.data && !low) low = backup;
          continue;
        }
        if (backup.verdict === 'announced' && !announced && backup.variant && qualityName(backup.variant.name) === qualityName(target.quality)) announced = backup;
        if (!backup.data) continue;
        const source = withoutQuery(backup.variant.url);
        const aligned = alignSequence(backup.data, backup.variant, text);
        if (listsNothingNew(aligned.text, source)) {
          emit('backupBehind', { playerType: backup.type });
          log('backup ' + backup.type + ' lists nothing past ' + state.delivered.newest + ': kept as the last choice');
          if (!behind) behind = { backup, aligned, source };
          continue;
        }
        return useBackup(backup, aligned, source);
      }
    }
    if (behind) {
      // every clean backup numbers below the last delivery (2026-10-18, ibai: the four tokens taken after popout announced
      // its break were one segment behind): given one of them, F-24 would restart the player, which flushes its buffer
      // and resets its clock for a lag the backups close by the next poll. The last playlist is given again instead
      // while it is fresh; one poll without a new segment is ordinary live HLS. At parity nothing restarts: used as is
      const newest = newestNumber(behind.aligned.text);
      const kept = newest != null && newest < state.delivered.newest ? holdLast(target, now, 'every clean backup lists nothing past ' + state.delivered.newest) : null;
      if (kept != null) return kept;
      return useBackup(behind.backup, behind.aligned, behind.source);
    }
    if (announced) {
      // its break is announced past its last segment: the same treatment as the page's own announcement (prefetch,
      // DISCONTINUITY and MAP of the ad removed, the ad URIs answered blank, the ad DATERANGEs stripped)
      const cleaned = blankAds(announced.dump[0], [], announced.variant.url);
      if (cleaned.uris.length) listBlank(cleaned.uris, cleaned.uris.length);
      const source = withoutQuery(announced.variant.url);
      const aligned = alignSequence(stripAdDateranges(cleaned.text), announced.variant, text);
      if (!listsNothingNew(aligned.text, source)) {
        log('no clean backup at ' + (target.quality || '?') + ': ' + announced.type + ' with its own announcement stripped');
        emit('backupAnnouncedUsed', { playerType: announced.type });
        return useBackup({ ...announced, data: aligned.text }, aligned, source);
      }
    }
    const kept = holdLast(target, now, 'no clean backup at ' + (target.quality || '?'));
    if (kept != null) return kept;
    if (low) {
      const source = withoutQuery(low.variant.url);
      const aligned = alignSequence(low.data, low.variant, text);
      return useBackup(low, aligned, source);
    }

    // no clean backup: the page's playlist with ad segments replaced by time (F-13), the rest answered blank (F-14)
    const merged = mergeWithBackups([text, ...dump]);
    if (merged.replaced) emit('segmentsReplaced', { count: merged.replaced });
    if (b) b.merged++;
    if (!merged.remaining.length) {
      log('player <- page playlist with ' + merged.replaced + ' ad segment(s) replaced from the backups');
      return stripAdDateranges(merged.text);
    }
    const blanked = blankAds(merged.text, merged.remaining, url);
    listBlank(blanked.uris, blanked.segments);
    if (b) b.blanked++;
    log('player <- page playlist with ' + merged.replaced + ' ad segment(s) replaced and ' + blanked.segments + ' left (answered blank), ' + (blanked.uris.length - blanked.segments) + ' ahead URI(s) removed');
    return stripAdDateranges(blanked.text);
  }

  function notePoll(summary) {
    state.polls++;
    const fresh = summary.classes.filter((c) => !state.seenClasses.has(c));
    for (const c of fresh) state.seenClasses.add(c);
    if (fresh.length) {
      log('DATERANGE classes seen: ' + fresh.join(', ') + (summary.stitched ? ' (roll=' + (summary.rollType || '?') + ', pod=' + (summary.podLength || '?') + ', adSegments=' + summary.adSegments + '/' + summary.segments + ')' : ''));
      post({ adblock: 'classes', classes: fresh });
    }
    if (state.polls % 30 === 1) log('poll #' + state.polls + ' quality=' + (state.quality || '?') + ' seq=' + summary.mediaSequence + ' segments=' + summary.segments + ' class=' + summary.cls + ' classes=[' + summary.classes.join(',') + '] backups=[' + [...state.backups.keys()].join(',') + ']');
  }

  // --- the fetch routes (app.controller.ts) ------------------------------------------------------------

  const responseInit = (response) => {
    const headers = {};
    const type = response.headers.get('Content-Type');
    if (type) headers['Content-Type'] = type;
    return { status: response.status, statusText: response.statusText, headers };
  };

  // the player's usher request: channel, usher URL and variants; a new master clears the sequence state (F-23, F-24)
  async function onChannelMaster(input, init, url) {
    const response = await request(input, init);
    if (!response.ok) {
      log('usher answered ' + response.status + ' for ' + url.slice(0, 90));
      return response;
    }
    const text = await response.text();
    try {
      const channel = channelFromUsher(url);
      const flags = tokenFlags(tokenFromUsherUrl(url) || '');
      const variants = parseVariants(text);
      log('master ' + (channel || '?') + ' player_type=' + flags.player_type + ' show_ads=' + flags.show_ads + ' server_ads=' + flags.server_ads + ' hide_ads=' + flags.hide_ads + ' variants=' + variants.map((v) => v.name).join('/'));
      post({ adblock: 'master', info: { channel, playerType: flags.player_type, flags, variants: variants.map((v) => v.name) } });
      if (channel !== state.channel) {
        state.backups.clear();
        state.pendingAccess.clear();
        state.pinnedType = null;
        state.contaminatedUntil.clear();
        state.lastBackup = null;
        state.lastPrewarm = -Infinity;
      }
      state.channel = channel;
      state.usherUrl = url;
      state.playerVariants.clear();
      for (const variant of variants) state.playerVariants.set(withoutQuery(variant.url), variant);
      state.pageSequence = null;
      state.sequenceShifts.clear();
      state.delivered = null;
      state.lastDelivered = null;
      state.pageShift = 0;
      prewarmBackups('channel load');
    } catch (e) {
      log('master handling failed: ' + ((e && e.stack) || e));
    }
    return new Response(text, responseInit(response));
  }

  // E10: the page's own picture-by-picture master, 3 to 14 s before most stitched midrolls (B-044): it brings the
  // prewarm, and the mini player gets an empty answer, as in Purple
  async function onPbypMaster(input, init, url) {
    const response = await request(input, init);
    if (!response.ok) return response;
    try {
      const text = await response.text();
      for (const variant of parseVariants(text)) state.pbypVariants.add(withoutQuery(variant.url));
      log('picture-by-picture master requested by the page (answered empty): prewarming backups');
      post({ adblock: 'master', info: { channel: channelFromUsher(url), playerType: 'picture-by-picture', flags: tokenFlags(tokenFromUsherUrl(url) || ''), variants: [] } });
      prewarmBackups('picture-by-picture');
    } catch (e) {
      log('picture-by-picture handling failed: ' + ((e && e.stack) || e));
    }
    return new Response('', { status: 200 });
  }

  const isPlayerPlaylist = (url) => {
    const key = withoutQuery(url);
    if (state.pbypVariants.has(key)) return false;
    return state.playerVariants.has(key) || (isM3u8(url) && /\/v1\/playlist\//.test(url));
  };

  async function onMediaPlaylist(input, init, url) {
    const response = await request(input, init);
    if (!response.ok) return response;
    const text = await response.text();
    if (!text.startsWith('#EXTM3U')) return new Response(text, responseInit(response));
    remember('player', url, text);
    let out = text;
    try {
      const current = state.playerVariants.get(withoutQuery(url));
      if (current) state.quality = current.name;
      out = await onFetch(text, url);
      if (out !== text) remember('delivered', url, out);
    } catch (e) {
      // a failure in the blocking logic must not stop the player: it gets Twitch's playlist
      log('blocking logic failed, playlist passed through: ' + ((e && e.stack) || e));
      out = text;
    }
    return new Response(out, responseInit(response));
  }

  // The route is chosen here; the handlers run the original request themselves so that its own failures (an abort
  // by the player, a network error) reach the player as they are, instead of being retried
  scope.fetch = function (input, init) {
    let route = null;
    let url = '';
    try {
      url = urlOf(input);
      if (url && isBlankSegment(url)) {
        state.blankAnswered++;
        if (state.blankAnswered <= 5 || state.blankAnswered % 20 === 0) log('ad media answered with the blank segment (#' + state.blankAnswered + '): ' + url.slice(0, 100));
        emit('blankAnswered', { url });
        return Promise.resolve(blankSegment());
      }
      if (isUsher(url)) route = isPbypUsher(url) ? onPbypMaster : onChannelMaster;
      else if (isPlayerPlaylist(url)) route = onMediaPlaylist;
    } catch (e) {
      log('fetch hook failed to route, request passed through: ' + ((e && e.stack) || e));
      route = null;
    }
    return route ? route(input, init, url) : request(input, init);
  };

  // the pure pieces, for test/twitch-playlists.mjs
  if (!RELEASE) scope.__adblockTwitchWorker = { detectAds, readSegments, isCleanBackup, mergeWithBackups, blankAds, stripAdDateranges, newestNumber, sequenceReference, sequenceShift, shiftSequence, pageRebase, parseVariants, pickVariant, summarize };

  log('worker hook installed');
})(self);
