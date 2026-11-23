#!/usr/bin/env node
// CHANGELOG.md, parsed: one entry per release ("## <version> — <date>" followed by "- " items, newest first). Read by
// build.mjs (the popup's What's new tab carries the whole list), by scripts/release-notes.mjs (the release body opens
// with the entry of its version) and by the Monday workflow, which adds its own line before building:
//   node scripts/changelog.mjs add <version> <date> <text...>    inserts an entry at the top (no-op if it exists)
//   node scripts/changelog.mjs show                              prints what the parser sees
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');
const HEADING = /^## (\d+(?:\.\d+){1,3})\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/;

export function parseChangelog(text) {
  const entries = [];
  let entry = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    if (heading) {
      entry = { version: heading[1], date: heading[2], items: [] };
      entries.push(entry);
      continue;
    }
    if (line.startsWith('## ')) entry = null; // a heading that is not a release
    if (!entry) continue;
    if (line.startsWith('- ')) entry.items.push(line.slice(2).trim());
    else if (/^\s+\S/.test(raw) && entry.items.length) entry.items[entry.items.length - 1] += ' ' + line.trim(); // wrapped item
  }
  return entries;
}

export const readChangelog = () => parseChangelog(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
export const entryFor = (entries, version) => entries.find((e) => e.version === version) || null;

export function addEntry(version, date, text) {
  const current = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  if (entryFor(parseChangelog(current), version)) return false;
  const block = `## ${version} — ${date}\n\n- ${text}\n\n`;
  const at = current.search(/^## /m);
  const next = at < 0 ? current.replace(/\s*$/, '\n\n') + block : current.slice(0, at) + block + current.slice(at);
  fs.writeFileSync(CHANGELOG_FILE, next);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [command, version, date, ...rest] = process.argv.slice(2);
  if (command === 'add' && version && date && rest.length) {
    console.log(addEntry(version, date, rest.join(' ')) ? `CHANGELOG.md: entry ${version} added` : `CHANGELOG.md: entry ${version} was already there`);
  } else if (command === 'show') {
    for (const e of readChangelog()) console.log(`${e.version} (${e.date}): ${e.items.join(' | ')}`);
  } else {
    console.error('usage: node scripts/changelog.mjs add <version> <date> <text...> | show');
    process.exit(2);
  }
}
