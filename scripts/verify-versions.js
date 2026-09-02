#!/usr/bin/env bun
/**
 * Version Synchronization Validator
 * Ensures VERSION, package.json, Cargo.toml, and tauri.conf.json match.
 */

import fs from "fs";
import path from "path";

const rootDir = process.cwd();

function getVersionFile() {
  const versionPath = path.join(rootDir, "VERSION");
  if (!fs.existsSync(versionPath)) {
    console.error("❌ Missing VERSION file at root");
    process.exit(1);
  }
  return fs.readFileSync(versionPath, "utf8").trim();
}

function getPackageJsonVersion() {
  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

function getCargoTomlVersion() {
  const cargoPath = path.join(rootDir, "src-tauri", "Cargo.toml");
  const content = fs.readFileSync(cargoPath, "utf8");
  const match = content.match(/\[package\][\s\S]*?version\s*=\s*"([^"]+)"/);
  if (!match) {
    console.error("❌ Could not parse version from Cargo.toml");
    process.exit(1);
  }
  return match[1];
}

function getTauriConfVersion() {
  const tauriPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
  const conf = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
  return conf.version;
}

const mainVersion = getVersionFile();
const pkgVersion = getPackageJsonVersion();
const cargoVersion = getCargoTomlVersion();
const tauriVersion = getTauriConfVersion();

console.log("🔍 Checking Version Synchronization:");
console.log(`  • VERSION:            ${mainVersion}`);
console.log(`  • package.json:       ${pkgVersion}`);
console.log(`  • Cargo.toml:         ${cargoVersion}`);
console.log(`  • tauri.conf.json:    ${tauriVersion}`);

if (
  mainVersion !== pkgVersion ||
  mainVersion !== cargoVersion ||
  mainVersion !== tauriVersion
) {
  console.error("\n❌ Version mismatch detected!");
  console.error("All files must specify the exact same version string.");
  process.exit(1);
}

console.log("\n✅ All version files are perfectly synchronized!\n");
