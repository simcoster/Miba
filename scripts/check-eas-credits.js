#!/usr/bin/env node
/**
 * Checks EAS account credits before building.
 * Run before internal/production builds to see remaining credits.
 * Aborts if insufficient credits for the requested platform(s).
 *
 * Usage: node scripts/check-eas-credits.js [android|ios|all]
 *   android - 1 build, ~$1
 *   ios     - 1 build, ~$2
 *   all     - 2 builds (Android + iOS), ~$3
 */
const { execSync } = require('child_process');

const BUILD_COST = {
  android: 1,  // $1 per Android medium build
  ios: 2,      // $2 per iOS medium build
  all: 3,      // $1 + $2 for both
};

function main() {
  const platformArg = process.argv[2]?.toLowerCase();
  const isGateMode = !!platformArg; // When platform passed, we gate the build
  const platform = platformArg || 'all';
  const estimatedCost = BUILD_COST[platform] ?? BUILD_COST.all;

  try {
    const output = execSync('eas account:usage --json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const data = JSON.parse(output);

    const builds = data.builds?.plan;
    const period = data.account?.billingPeriod;

    if (!builds) {
      console.log('Could not parse EAS credits. Proceeding with build...\n');
      return;
    }

    // Plan uses "credits" - 4500 limit = $45, 100 per $1
    const limit = builds.limit ?? 0;
    const used = builds.used ?? 0;
    const remaining = Math.max(0, limit - used);
    const remainingDollars = remaining / 100;

    const limitDollars = (limit / 100).toFixed(0);
    const usedDollars = (used / 100).toFixed(1);

    console.log('\n--- EAS Credits ---');
    console.log(`  Remaining: $${remainingDollars.toFixed(1)} (~${Math.floor(remaining / 100)} builds at $1 each)`);
    console.log(`  Used this cycle: $${usedDollars} / $${limitDollars}`);
    if (period) {
      console.log(`  Billing period: ${period.daysRemaining} days left`);
    }
    console.log(`  This build: ~$${estimatedCost} (${platform})`);
    console.log('------------------\n');

    if (isGateMode && remainingDollars < estimatedCost) {
      const account = data.account?.name ?? 'your-account';
      console.error('\n❌ Build cancelled: insufficient credits.\n');
      console.error(`   You have $${remainingDollars.toFixed(1)} remaining but this build costs ~$${estimatedCost}.`);
      console.error(`   ${platform === 'all' ? 'Android + iOS builds require ~$3.' : ''}`);
      console.error(`\n   Add credits at: https://expo.dev/accounts/${account}/settings/billing\n`);
      process.exit(1);
    }
  } catch (e) {
    // Non-fatal: might be offline or not logged in
    console.warn('Could not fetch EAS credits:', e.message || e);
    console.log('Proceeding with build...\n');
  }
}

main();
