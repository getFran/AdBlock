#!/usr/bin/env node
// The notes of a GitHub release: which lists this build carries, and how to install or update.
//   node scripts/release-notes.mjs <version>   (after npm install; reads node_modules and vendor/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../build.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const version = process.argv[2] || readJson(path.join(ROOT, 'package.json')).version;
const pkgVersion = (name) => readJson(path.join(ROOT, 'node_modules', '@adguard', name, 'package.json')).version;
const header = (file, re) => (re.exec(fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').slice(0, 3).join('\n')) || [])[1] || 'unknown date';
const adguardLive = header(config.youtube.adguardLive.snapshot, /updated ([^,)]+)/);
const uassets = header(config.youtube.uassets.snapshot, /vendored on (\S+)/);
const repo = config.release.repo;

process.stdout.write(`Filter lists in this build:

- AdGuard DNR rulesets (\`@adguard/dnr-rulesets\` ${pkgVersion('dnr-rulesets')}): Base with EasyList, Tracking Protection, Spanish/Portuguese, URL Tracking, Cookie Notices, Popups, Other Annoyances, Widgets
- AdGuard Base YouTube rules from the live filter, updated ${adguardLive}
- AdGuard Scriptlets (\`@adguard/scriptlets\` ${pkgVersion('scriptlets')})
- uBlock Origin quick fixes, YouTube rules, snapshot of ${uassets.slice(0, 10)}

**Install:** download \`getfran-adblock-${version}.zip\`, extract it, open \`chrome://extensions\`, turn on Developer mode and click **Load unpacked** on the extracted \`getfran-adblock\` folder.

**Update:** extract the new zip over the same folder, replacing everything, and click the reload icon of the extension in \`chrome://extensions\`. Your switched-off sites are kept.

Details: https://github.com/${repo}#install
`);
