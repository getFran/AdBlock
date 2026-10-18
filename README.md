# getFran AdBlock

A Chrome extension (Manifest V3) that blocks ads on every website with AdGuard's filter lists, and handles
YouTube and Twitch separately: YouTube's ads are pruned from the player responses with AdGuard's scriptlets,
and Twitch's stitched ads are replaced with a clean copy of the live stream, the technique of Purple Ads
Blocker.

It is a shell: nothing in this repository decides what an ad is. The rulesets, the cosmetic rules, the
scriptlets and their arguments come from `@adguard/dnr-rulesets`, `@adguard/scriptlets`, uBlock Origin's
`quick-fixes.txt` and Purple Ads Blocker, and a new release is mostly a new snapshot of those lists.

It is not on the Chrome Web Store. You download a zip from the [Releases](../../releases) page and load it
unpacked; the extension tells you when a newer release exists.

## Install

1. Download `getfran-adblock-<version>.zip` from the [latest release](../../releases/latest) and extract it.
   Keep the extracted `getfran-adblock` folder somewhere permanent: Chrome loads the extension from there.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `getfran-adblock` folder.

Chrome may warn at startup that an extension is running in developer mode. That is how every unpacked
extension works; there is no way around it outside the Web Store.

Chrome 128 or newer. Playwright's Chromium and other Chromium browsers that accept unpacked extensions work too.

## Update

Unpacked extensions do not update themselves. Once a day the extension asks GitHub whether a newer release
exists (one request to `github.com/getFran/AdBlock/releases/latest`, nothing else is sent). When there is
one, the icon shows a red **NEW** badge and the popup links to the release:

1. Download the new zip and extract it **over the same folder**, replacing everything.
2. In `chrome://extensions`, click the reload icon of getFran AdBlock (or restart Chrome).

Your switched-off sites are kept: the extension keeps the same identity as long as it is loaded from the
same folder.

## Switching it off on a site

Click the icon and **Switch off for &lt;site&gt;**. That site and its subdomains get no network blocking, no
cosmetic CSS and none of the YouTube or Twitch scripts, and the tab reloads. The popup lists the sites
switched off and switches them back on.

## What it does, in short

- **Every site:** 8 AdGuard rulesets as static declarativeNetRequest rules (Base with EasyList, Tracking
  Protection, Spanish/Portuguese, URL Tracking, Cookie Notices, Popups, Other Annoyances, Widgets; about
  205,000 rules) plus their element-hiding rules as CSS, injected at `document_start`.
- **YouTube:** AdGuard Base's YouTube rules compiled with `@adguard/scriptlets` (the player response loses
  its ad placements before the player sees it), the rules uBlock Origin keeps in `quick-fixes.txt`, and four
  local rules that remove the payload of the "Ad blockers are not allowed on YouTube" dialog.
- **Twitch:** inside the player's worker, every playlist that carries stitched ad segments is swapped for the
  same-quality playlist of a backup stream (a token of another player type) while the break lasts; the
  client-side ad request is answered empty. Ported from Purple Ads Blocker. A guard restarts the player if
  the picture freezes after a break.

## Privacy

Everything runs inside your browser. The extension makes no request of its own except the daily version
check against GitHub, which carries no data about you. There is no account, no telemetry, no remote
configuration. A release build has no console output and leaves nothing on the page.

Permissions: `declarativeNetRequest` (the blocking), `scripting` and `storage` (the per-site switch),
`alarms` (the daily check), and access to all sites, which an ad blocker needs.

## Known limits

- Extended CSS rules (`#?#`, `:contains()`, `:upward()`...) are not supported: about 5,300 cosmetic rules are
  skipped. Standard `:has()` works.
- A YouTube account that Google has flagged may still see enforcement dialogs; the rules remove the payload
  the dialog is built from, but YouTube changes this often. New releases bring the latest rules.
- Twitch's stitched breaks only happen when Twitch inserts them; the swap has been verified on real breaks,
  but Twitch changes its player too.

## Development

Node 22 or newer.

```
npm install
npm run build              # development build -> dist/ (records, diagnostics, console; permissions downloads + feedback)
npm run build:release      # the build that is released: none of that
npm run vendor             # refresh vendor/: uAssets quick-fixes and the live AdGuard Base YouTube rules
npm test                   # the pure Twitch playlist pieces, no browser
npm run smoke              # loads dist/ in Playwright's Chromium and checks manifest, content scripts, alarm, pages
npm run verify -- generic|youtube|twitch|all   # real pages in Playwright's Chromium (development build)
```

Updating the lists by hand: `npm install @adguard/dnr-rulesets@latest @adguard/scriptlets@latest && npm run vendor
&& npm run build`. For YouTube alone `npm run vendor && npm run build` is enough: AdGuard's YouTube rules are
taken from the live filter because the npm package lags it by weeks.

### Releases

`.github/workflows/release.yml` builds `getfran-adblock-<version>.zip` with `npm run build:release` and
publishes a GitHub release:

- on a tag `v*`: the version of the tag, with the lists committed at that tag;
- every Monday (and on demand): the latest `@adguard/dnr-rulesets`, `@adguard/scriptlets` and vendored
  snapshots. If any list changed, it commits them to `main`, bumps the patch version, tags and releases.
  If nothing changed, it does nothing.

The development build keeps the evidence tooling: a record of each Twitch break and of YouTube's enforcement
dialog is written to `Downloads/AdBlock/`, `window.__adblockTwitch` and `window.__adblockYoutube` expose the
state, and `test/verify.mjs` reads the matched rules. None of that is in a release.

## License and credits

GPL-3.0 (`LICENSE`): the extension bundles AdGuard's filter lists and scriptlets and uBlock Origin's uAssets,
all GPL-3.0. The Twitch logic is ported from [Purple Ads Blocker](https://github.com/arthurbolsoni/Purple-adblock)
(Apache-2.0) and the blank segment and player reload come from [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions)
(MIT). `THIRD_PARTY_NOTICES.md` has the details and the license texts.
