#!/usr/bin/env node
/**
 * Prompts for confirmation before building, showing runtimeVersion and platform.
 * For internal/production: bumps version first, then runs eas build (unless --nobump).
 *
 * Usage: node scripts/build-with-confirm.js <profile> <platform> [--yes] [--nobump]
 *   profile: internal | production
 *   platform: android | ios | all
 *   --yes: skip confirmation (for CI)
 *   --nobump: do not bump version (use current version as runtimeVersion)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

function computeNewVersion() {
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function main() {
  const args = process.argv.slice(2);
  const skipConfirm = args.includes('--yes');
  const noBump = args.includes('--nobump');
  const filtered = args.filter(a => a !== '--yes' && a !== '--nobump');
  const profile = filtered[0];
  const platform = (filtered[1] || 'all').toLowerCase();

  if (!['internal', 'production'].includes(profile)) {
    console.error('Usage: node scripts/build-with-confirm.js <internal|production> <android|ios|all> [--yes] [--nobump]');
    process.exit(1);
  }

  const runtimeVersion = noBump ? currentVersion : computeNewVersion();
  const platformDisplay = platform === 'all' ? 'ios+android' : platform;

  const prompt = [
    `About to build with runtimeVersion ${runtimeVersion}, on ${platformDisplay}, current version ${currentVersion}.`,
    noBump ? '(--nobump: version will not be incremented)' : '',
    'Continue? [Y/n] ',
  ].filter(Boolean).join('\n');

  function runBuild() {
    if (['internal', 'production'].includes(profile) && !noBump) {
      execSync('node scripts/bump-version.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    }
    execSync(`eas build --profile ${profile} --platform ${platform}`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  }

  if (skipConfirm) {
    console.log(prompt.trim());
    console.log('(auto-confirming with --yes)\n');
    runBuild();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(prompt, (answer) => {
    rl.close();
    const trimmed = (answer || 'y').trim().toLowerCase();
    if (trimmed === 'n' || trimmed === 'no') {
      console.log('Build cancelled.');
      process.exit(1);
    }
    runBuild();
  });
}

main();
