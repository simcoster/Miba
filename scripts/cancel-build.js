#!/usr/bin/env node
/**
 * Cancel ALL EAS builds that are not finished or canceled.
 * Loops until no cancellable builds remain (handles pagination via repeated fetches).
 * Usage: npm run build:cancel
 */
const { execSync } = require('child_process');

const TERMINAL_STATUSES = ['FINISHED', 'CANCELED', 'ERRORED'];

function getBuilds() {
  const out = execSync('eas build:list --limit 50 --json --non-interactive', {
    encoding: 'utf8',
  });
  const jsonMatch = out.match(/\[[\s\S]*\]/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
}

function getCancellableBuilds(builds) {
  return builds.filter((b) => !TERMINAL_STATUSES.includes(b.status));
}

function cancelBuild(buildId) {
  execSync(`eas build:cancel ${buildId}`, { stdio: 'inherit' });
}

let totalCanceled = 0;

while (true) {
  const builds = getBuilds();
  const cancellable = getCancellableBuilds(builds);

  if (cancellable.length === 0) {
    break;
  }

  for (const build of cancellable) {
    console.log(`Cancelling build ${build.id} (${build.status}, ${build.platform}, ${build.buildProfile || '?'})...`);
    try {
      cancelBuild(build.id);
      totalCanceled++;
    } catch (e) {
      console.error(`Failed to cancel ${build.id}:`, e.message);
    }
  }
}

if (totalCanceled === 0) {
  console.log('No builds to cancel.');
} else {
  console.log(`Done. Cancelled ${totalCanceled} build(s).`);
}
