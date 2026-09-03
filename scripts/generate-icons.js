#!/usr/bin/env bun
/**
 * Automated Icon Generator for ScanSmith AI Studio
 * Generates all multi-platform Tauri application icons from SVG source.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const svgSource = path.join(rootDir, "src", "assets", "logo.svg");
const assetsLogo = path.join(rootDir, "src", "assets", "logo.svg");
const publicLogo = path.join(rootDir, "public", "app-icon.svg");
const publicTauri = path.join(rootDir, "public", "tauri.svg");

console.log("🎨 ScanSmith AI Studio Icon Generator");
console.log("-------------------------------------");

if (!fs.existsSync(svgSource)) {
  console.error(`❌ Source SVG file not found at: ${svgSource}`);
  process.exit(1);
}

// 1. Sync SVG to web assets and public directory
console.log("📄 Syncing vector assets (logo.svg & public/app-icon.svg)...");
fs.copyFileSync(svgSource, assetsLogo);
fs.copyFileSync(svgSource, publicLogo);
fs.copyFileSync(svgSource, publicTauri);

// 2. Run Tauri icon generation CLI
console.log("⚙️  Generating Tauri platform icons (ICO, ICNS, PNGs, Appx Tiles)...");
const result = spawnSync("bun", ["x", "tauri", "icon", "app-icon.svg"], {
  stdio: "inherit",
  cwd: rootDir,
  shell: true,
});

if (result.status !== 0) {
  console.error("\n❌ Failed to generate icons via Tauri CLI.");
  process.exit(result.status || 1);
}

// 3. Verify generated icons in src-tauri/icons/
const iconDir = path.join(rootDir, "src-tauri", "icons");
const requiredFiles = [
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
  "StoreLogo.png"
];

console.log("\n🔍 Verifying generated icon assets:");
let allValid = true;
for (const file of requiredFiles) {
  const filePath = path.join(iconDir, file);
  if (fs.existsSync(filePath)) {
    const size = (fs.statSync(filePath).size / 1024).toFixed(1);
    console.log(`  ✅ ${file.padEnd(20)} (${size} KB)`);
  } else {
    console.log(`  ❌ Missing: ${file}`);
    allValid = false;
  }
}

if (!allValid) {
  console.error("\n⚠️ Some required icon formats were missing.");
  process.exit(1);
}

console.log("\n🎉 All app icons successfully generated and positioned in src-tauri/icons/!\n");
