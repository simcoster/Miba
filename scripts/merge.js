#!/usr/bin/env node
/**
 * Merges the current branch into main with squash.
 * Fails if already on main.
 *
 * Usage: npm run merge
 */
const { execSync } = require('child_process');
const readline = require('readline');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

  if (currentBranch === 'main') {
    console.error('Cannot run merge on main. Check out a feature branch first.');
    process.exit(1);
  }

  // Check for uncommitted changes
  const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (status) {
    const answer = await ask('There are uncommitted changes. Should we commit them? [Y/n] ');
    if (answer === 'n' || answer === 'no') {
      console.log('Aborted.');
      process.exit(1);
    }
    execSync('git add -A', { stdio: 'inherit' });
    execSync('git commit -m "WIP"', { stdio: 'inherit' });
  }

  execSync('git checkout main', { stdio: 'inherit' });
  execSync(`git merge --squash ${currentBranch}`, { stdio: 'inherit' });

  // Check if squash produced anything to commit
  let hasStagedChanges = false;
  try {
    execSync('git diff --cached --quiet', { stdio: 'pipe' });
  } catch {
    hasStagedChanges = true; // diff --quiet exits 1 when there are changes
  }
  if (!hasStagedChanges) {
    console.error('There are no committed changes. Commit something first!');
    process.exit(1);
  }

  const commitMessage = currentBranch.replace(/-/g, ' ');
  execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
  console.log(`Squash-merged ${currentBranch} into main`);
}

main();
