#!/usr/bin/env node
// Publishes a version from this machine: makes the repository public if it still is private, creates and pushes the
// tag v<version> (which starts .github/workflows/release.yml), waits for that run and prints the release and its zip.
// Idempotent: every step is skipped when already done.
//
//   node scripts/publish.mjs <github token> [--version 1.2.3]
//
// The version defaults to package.json's. The token needs the repo scope; it is never written anywhere. Nothing of
// this needs to run in CI: it is the one-off that opens the repo and the manual way to ship a version by hand.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from '../build.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const token = args.find((a) => !a.startsWith('--')) || process.env.GITHUB_TOKEN;
const versionArg = args.indexOf('--version');
const version = versionArg >= 0 ? args[versionArg + 1] : JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
if (!token) {
  console.error('usage: node scripts/publish.mjs <github token> [--version 1.2.3]');
  process.exit(2);
}
if (!/^\d+(\.\d+){1,3}$/.test(version)) {
  console.error(`"${version}" is not a version`);
  process.exit(2);
}
const repo = config.release.repo;
const tag = 'v' + version;
const api = async (method, url, body) => {
  const response = await fetch('https://api.github.com' + url, {
    method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'getfran-adblock-publish', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (!response.ok && response.status !== 404) throw new Error(`${method} ${url}: HTTP ${response.status} ${json && json.message ? json.message : ''}`);
  return { status: response.status, json };
};
const git = (command) => execSync('git ' + command, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log('[publish] ' + line);

// 1. the repository: public, with its description and homepage
const repoInfo = (await api('GET', `/repos/${repo}`)).json;
if (repoInfo.private) {
  const updated = await api('PATCH', `/repos/${repo}`, {
    private: false,
    description: "Chrome extension (MV3) that blocks ads on every website, including YouTube and Twitch. AdGuard lists, AdGuard scriptlets and Purple Ads Blocker's Twitch stream swap, in a shell.",
    homepage: `https://github.com/${repo}/releases/latest`,
    has_wiki: false,
    has_projects: false,
  });
  say(`repository made public (visibility now ${updated.json.visibility})`);
} else {
  say('repository is already public');
}

// 2. the tag, local and remote
const localTags = git('tag -l').split('\n').filter(Boolean);
if (!localTags.includes(tag)) {
  git(`tag -a ${tag} -m "getFran AdBlock ${version}"`);
  say(`tag ${tag} created`);
} else {
  say(`tag ${tag} already exists locally`);
}
const remoteTags = git('ls-remote --tags origin')
  .split('\n')
  .map((l) => l.split('\t')[1] || '')
  .filter(Boolean);
if (!remoteTags.includes('refs/tags/' + tag)) {
  git(`push origin ${tag}`);
  say(`tag ${tag} pushed: the release workflow starts`);
} else {
  say(`tag ${tag} is already on origin`);
}

// 3. the workflow run for that tag
let run = null;
for (let i = 0; i < 60; i++) {
  const runs = (await api('GET', `/repos/${repo}/actions/runs?event=push&per_page=20`)).json.workflow_runs || [];
  run = runs.find((r) => r.head_branch === tag) || null;
  if (run && run.status === 'completed') break;
  say(run ? `workflow ${run.status}... (${run.html_url})` : 'waiting for the workflow run to appear...');
  await sleep(10000);
}
if (!run) {
  say('no workflow run found for the tag after 10 minutes: check the Actions tab');
  process.exit(1);
}
say(`workflow ${run.status}, conclusion ${run.conclusion}: ${run.html_url}`);
if (run.conclusion !== 'success') process.exit(1);

// 4. the release and what the extension will read
const release = await api('GET', `/repos/${repo}/releases/tags/${tag}`);
if (release.status === 404) {
  say('the run succeeded but no release exists for the tag: check the Release step');
  process.exit(1);
}
for (const asset of release.json.assets || []) say(`asset ${asset.name} (${Math.round(asset.size / 1024)} KB): ${asset.browser_download_url}`);
const latest = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: 'follow' });
say(`releases/latest resolves to ${latest.url} (what the update check reads)`);
