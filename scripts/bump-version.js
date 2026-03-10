#!/usr/bin/env node
/**
 * Increments the version in package.json.
 * Used before internal/production builds so Android and iOS share the same version.
 *
 * Usage: node scripts/bump-version.js [patch|minor|major]
 * Default: patch (e.g. 1.0.2 → 1.0.3)
 * minor: 1.0.2 → 1.1.0
 * major: 1.0.2 → 2.0.0
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const bump = process.argv[2] || 'patch';
const [major, minor, patch] = pkg.version.split('.').map(Number);

let newVersion;
switch (bump) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
}

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Bumped version: ${major}.${minor}.${patch} → ${newVersion}`);
