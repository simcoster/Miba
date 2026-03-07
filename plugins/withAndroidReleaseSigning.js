const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SIGNING_BLOCK = /# Release signing \(from withAndroidReleaseSigning[^]*?MYAPP_UPLOAD_KEY_PASSWORD=.*\n/g;

/**
 * Injects Android release signing config for local AAB builds.
 * Set env vars before prebuild: ANDROID_KEY_ALIAS, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD.
 * Optional: ANDROID_KEYSTORE_FILE (default: simcoster__miba.jks).
 * Place the keystore in android/app/ before building.
 */
function withAndroidReleaseSigning(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const storeFile =
        process.env.ANDROID_KEYSTORE_FILE || process.env.MYAPP_UPLOAD_STORE_FILE || 'simcoster__miba.jks';
      const keyAlias =
        process.env.ANDROID_KEY_ALIAS || process.env.MYAPP_UPLOAD_KEY_ALIAS;
      const storePassword =
        process.env.ANDROID_KEYSTORE_PASSWORD || process.env.MYAPP_UPLOAD_STORE_PASSWORD;
      const keyPassword =
        process.env.ANDROID_KEY_PASSWORD || process.env.MYAPP_UPLOAD_KEY_PASSWORD;

      if (!keyAlias || !storePassword || !keyPassword) {
        return config;
      }

      const projectRoot = config.modRequest.platformProjectRoot;
      const gradlePropsPath = path.join(projectRoot, 'gradle.properties');
      const buildGradlePath = path.join(projectRoot, 'app', 'build.gradle');

      let gradleProps = await fs.promises.readFile(gradlePropsPath, 'utf8');
      gradleProps = gradleProps.replace(SIGNING_BLOCK, '');
      gradleProps += `
# Release signing (from withAndroidReleaseSigning - local AAB)
MYAPP_UPLOAD_STORE_FILE=${storeFile}
MYAPP_UPLOAD_KEY_ALIAS=${keyAlias}
MYAPP_UPLOAD_STORE_PASSWORD=${storePassword}
MYAPP_UPLOAD_KEY_PASSWORD=${keyPassword}
`;
      await fs.promises.writeFile(gradlePropsPath, gradleProps);

      let buildGradle = await fs.promises.readFile(buildGradlePath, 'utf8');
      if (!buildGradle.includes('signingConfigs.release')) {
        buildGradle = buildGradle.replace(
          /(signingConfigs \{\s+debug \{[^}]+\})\s+(\})/s,
          `$1
        release {
            if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                storeFile file(MYAPP_UPLOAD_STORE_FILE)
                storePassword MYAPP_UPLOAD_STORE_PASSWORD
                keyAlias MYAPP_UPLOAD_KEY_ALIAS
                keyPassword MYAPP_UPLOAD_KEY_PASSWORD
            }
        }
    $2`
        );
      }
      // Only replace in release block (debug block must keep signingConfigs.debug)
      const releaseIdx = buildGradle.indexOf('release {');
      const debugIdx = buildGradle.indexOf('debug {');
      if (releaseIdx > debugIdx) {
        const beforeRelease = buildGradle.slice(0, releaseIdx);
        const afterRelease = buildGradle.slice(releaseIdx);
        const replaceIdx = afterRelease.indexOf('signingConfig signingConfigs.debug');
        if (replaceIdx !== -1) {
          buildGradle =
            beforeRelease +
            afterRelease.slice(0, replaceIdx) +
            'signingConfig signingConfigs.release' +
            afterRelease.slice(replaceIdx + 'signingConfig signingConfigs.debug'.length);
        }
      }
      await fs.promises.writeFile(buildGradlePath, buildGradle);

      return config;
    },
  ]);
}

module.exports = withAndroidReleaseSigning;
