#!/usr/bin/env node
/**
 * Generate changelog files from Conventional Commits, scoped per MAJOR version series.
 *
 *   CHANGELOG.md          -> the current (highest) major series, e.g. all v1.x.y releases
 *   CHANGELOG.v0.md, ...  -> one archive file per completed (older) major series
 *
 * The idea: CHANGELOG.md only ever holds the major series we are actively shipping.
 * When the first release of a new major lands (e.g. v1.0.0), the previous series is
 * frozen into CHANGELOG.v0.md and CHANGELOG.md is regenerated for the v1.x range.
 *
 * When no version tags exist yet we assume v0.0.0: a single CHANGELOG.md over all history.
 *
 * Run via `npm run changelog` so that node_modules/.bin is on PATH and `git-cliff` resolves.
 * Regeneration is idempotent — it always rebuilds from git history + cliff.toml.
 */

import { execSync, execFileSync } from 'node:child_process';

const CONFIG = 'cliff.toml';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/** Parse "v1.2.3" / "1.2.3-beta" -> { major, minor, patch }, or null if not a version tag. */
function parseVersion(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/** The repository's first commit — used as the lower bound for the oldest series' archive. */
let _root;
function rootCommit() {
  if (!_root) {
    _root = git(['rev-list', '--max-parents=0', 'HEAD']).trim().split('\n')[0];
  }
  return _root;
}

/** All version tags (vX.Y.Z), ascending. */
function versionTags() {
  let out = '';
  try {
    out = git(['tag', '--list', 'v[0-9]*.[0-9]*.[0-9]*']);
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => parseVersion(t))
    .sort(compareVersions);
}

function runCliff(outFile, range) {
  const rangeArg = range ? ` ${range}` : '';
  console.log(`  git-cliff -> ${outFile}${range ? `  (range: ${range})` : '  (full history)'}`);
  execSync(`git-cliff --config ${CONFIG} --output "${outFile}"${rangeArg}`, { stdio: 'inherit' });
}

const tags = versionTags();

// Remember the last (highest) tag of each major. tags is ascending, so the last
// write per major wins.
const lastTagByMajor = new Map();
for (const tag of tags) {
  lastTagByMajor.set(parseVersion(tag).major, tag);
}

const majors = [...lastTagByMajor.keys()].sort((a, b) => a - b);
const currentMajor = majors.length ? majors[majors.length - 1] : 0;

/**
 * git range for a major series:
 *   lower bound = last tag of the previous major (exclusive) — none for major 0
 *   upper bound = last tag of this major, or HEAD for the current (open) series
 */
function rangeForMajor(major, isCurrent) {
  const lower = lastTagByMajor.get(major - 1) ?? null;
  const upper = isCurrent ? 'HEAD' : lastTagByMajor.get(major);
  if (!lower) {
    // Oldest series. The current open series needs no range (full history -> HEAD);
    // a completed archive runs from the repo root up to its final tag.
    return isCurrent ? '' : `${rootCommit()}..${upper}`;
  }
  return `${lower}..${upper}`;
}

console.log(`Current major series: v${currentMajor}.x` + (tags.length ? '' : ' (no tags — assuming v0.0.0)'));

// Current major -> CHANGELOG.md
runCliff('CHANGELOG.md', rangeForMajor(currentMajor, true));

// Completed majors -> CHANGELOG.v<m>.md archives
for (const major of majors) {
  if (major === currentMajor) continue;
  runCliff(`CHANGELOG.v${major}.md`, rangeForMajor(major, false));
}

console.log('Done.');
