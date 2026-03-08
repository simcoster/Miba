#!/usr/bin/env node
/**
 * Increments the minor version in package.json (e.g. 1.0.2 → 1.1.0).
 * Used before internal/production builds so Android and iOS share the same version.
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor + 1}.0`;

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Bumped version: ${major}.${minor}.${patch} → ${newVersion}`);
