# Changelog

What changed in each release of getFran AdBlock, newest first. The popup shows the same list under
**What's new**, and the Monday release of fresh filter lists adds its own line here.

## 1.0.11 — 2026-11-23

- The popup has a **What's new** tab with this changelog. A dot on the tab marks the first time you open the
  popup after an update.
- The note under the list of switched-off sites is gone; what the switch does is in the README.

## 1.0.10 — 2026-11-23

- Pages with a big DOM, Amazon search results for one, no longer crawl. The cosmetic stylesheet is now one rule
  per selector instead of `:is()` chunks that Chrome cannot index: 9 s of style work per Amazon results page
  became 0.6 s.

## 1.0.9 — 2026-11-23

- Filter lists of 2026-11-23.

## 1.0.8 — 2026-11-21

- Twitch: after an ad break the stream picks up exactly where the ad-free backup left it, and the player no
  longer restarts when a break begins. Twitch changed its ad playlists on 2026-11-19 and the previous alignment
  left the stream 26 to 52 seconds behind after every break.

## 1.0.7 — 2026-11-16

- Filter lists of 2026-11-16.

## 1.0.6 — 2026-11-09

- Filter lists of 2026-11-09.

## 1.0.5 — 2026-11-02

- Filter lists of 2026-11-02.

## 1.0.4 — 2026-10-31

- Twitch: an ad break right as a channel loads no longer leaves the player black for minutes. The extension
  waits for every backup token instead of the first, lets a brand-new player start on the ad rather than on
  blank segments, and restarts a player that never received data.

## 1.0.3 — 2026-10-26

- Filter lists of 2026-10-26.
- Twitch: a break right after loading waits up to 2.5 s for the backup tokens before deciding what to serve.

## 1.0.2 — 2026-10-22

- Twitch: the player no longer restarts at the end of every ad break on channels with 1-second segments.

## 1.0.1 — 2026-10-21

- Open YouTube and Twitch tabs reload when the extension is installed, so it works without a manual refresh.
- Twitch: reading the player's worker script is retried when the first attempt fails.

## 1.0.0 — 2026-10-19

- First release: AdGuard filter lists through declarativeNetRequest, cosmetic hiding, YouTube ad removal with
  the AdGuard and uBlock Origin rules, ad-free stream swap on Twitch, a per-site switch and a daily check for
  new releases.
