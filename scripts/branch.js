#!/usr/bin/env node
/**
 * Creates a new git branch from the given name.
 * Sanitizes: lowercase, spaces → hyphens, removes special chars.
 *
 * Usage: npm run branch -- "some change"
 * Creates branch: some-change
 */
const { execSync } = require('child_process');

const raw = process.argv[2];
if (!raw || !raw.trim()) {
  console.error('Usage: npm run branch -- "branch name"');
  process.exit(1);
}

const name = raw
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^a-z0-9-]/g, '');

if (!name) {
  console.error('Branch name is empty after sanitization');
  process.exit(1);
}

execSync(`git checkout -b ${name}`, { stdio: 'inherit' });
console.log(`Created and checked out branch: ${name}`);
