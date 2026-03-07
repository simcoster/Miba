#!/usr/bin/env node
/**
 * Cancel the most recent EAS build.
 * Usage: node scripts/cancel-build.js
 */
const { execSync } = require('child_process');

try {
  const out = execSync('eas build:list --limit 1 --json --non-interactive', {
    encoding: 'utf8',
  });
  const jsonMatch = out.match(/\[[\s\S]*\]/);
  const builds = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  const build = Array.isArray(builds) ? builds[0] : null;
  if (!build?.id) {
    console.log('No builds found.');
    process.exit(1);
  }
  console.log(`Cancelling build ${build.id} (${build.status}, ${build.platform})...`);
  execSync(`eas build:cancel ${build.id}`, { stdio: 'inherit' });
} catch (e) {
  if (e.status !== undefined) process.exit(e.status);
  throw e;
}
