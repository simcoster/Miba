#!/usr/bin/env node
/**
 * Merges the current branch into main with squash.
 * Fails if already on main.
 *
 * Usage: npm run merge
 */
const { execSync } = require('child_process');

const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

if (currentBranch === 'main') {
  console.error('Cannot run merge on main. Check out a feature branch first.');
  process.exit(1);
}

execSync('git checkout main', { stdio: 'inherit' });
execSync(`git merge --squash ${currentBranch}`, { stdio: 'inherit' });
const commitMessage = currentBranch.replace(/-/g, ' ');
execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
console.log(`Squash-merged ${currentBranch} into main`);
