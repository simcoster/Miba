#!/usr/bin/env node
/**
 * Start Expo dev server with USB tunnel for Android.
 * Kills stale ADB connections, waits for device, sets up reverse ports, then starts Metro.
 *
 * Usage: node scripts/start-usb.js  (or npm run start:usb)
 */
const { execSync, spawn } = require('child_process');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
  } catch (e) {
    if (!opts.ignoreError) throw e;
    return null;
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('Resetting ADB...');
  run('adb kill-server', { ignoreError: true });
  run('adb start-server');

  console.log('Waiting for device...');
  await delay(2500);

  // Retry reverse in case device wasn't ready
  for (let i = 0; i < 3; i++) {
    try {
      run('adb reverse tcp:8081 tcp:8081');
      run('adb reverse tcp:19000 tcp:19000');
      console.log('\nConnect to exp://localhost:8081 in Expo Go\n');
      break;
    } catch (e) {
      if (i === 2) {
        console.error('adb reverse failed after retries. Is the device connected?');
        process.exit(1);
      }
      await delay(1000);
    }
  }

  const child = spawn('npx expo start --localhost', { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 0));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
