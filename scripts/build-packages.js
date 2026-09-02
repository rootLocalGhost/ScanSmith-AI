#!/usr/bin/env bun
/**
 * Package Build Helper for ScanSmith AI Studio / scansmith-ai
 * Supports cross-target and specific Linux (Deb, Arch, AppImage) & Windows package formats.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const rootDir = process.cwd();

console.log("📦 ScanSmith AI Studio Package Builder");
console.log("---------------------------------------");

function runCommand(cmd, cmdArgs) {
  console.log(`\n🚀 Executing: ${cmd} ${cmdArgs.join(" ")}\n`);
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: rootDir,
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`❌ Command failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

// Ensure frontend is built first
function buildFrontend() {
  console.log("🔨 Building frontend assets with Vite...");
  runCommand("bun", ["run", "build"]);
}

function buildArchPackage() {
  console.log("🎯 Building Debian base package for Arch packaging...");
  runCommand("bun", ["x", "tauri", "build", "--bundles", "deb"]);

  const debDir = path.join(rootDir, "src-tauri", "target", "release", "bundle", "deb");
  const debFiles = fs.readdirSync(debDir).filter(f => f.endsWith(".deb"));
  if (debFiles.length === 0) {
    console.error("❌ No .deb file found to build Arch package");
    process.exit(1);
  }

  const debFile = path.join(debDir, debFiles[0]);
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
  const archBuildDir = path.join(rootDir, "arch_build");
  const outputPkgName = `scansmith-ai_${pkgVersion}_x86_64.pkg.tar.zst`;
  const outputPkgPath = path.join(rootDir, outputPkgName);

  console.log(`\n📦 Converting ${debFiles[0]} to Arch Linux package (${outputPkgName})...`);

  // Clean previous build dir
  if (fs.existsSync(archBuildDir)) {
    fs.rmSync(archBuildDir, { recursive: true, force: true });
  }
  fs.mkdirSync(archBuildDir, { recursive: true });

  // Extract deb into arch_build
  runCommand("ar", ["x", debFile], { cwd: archBuildDir });
  
  // Extract data.tar.*
  const arFiles = fs.readdirSync(rootDir).filter(f => f.startsWith("data.tar"));
  // ar x puts files in current working dir
  spawnSync("sh", ["-c", `cd "${archBuildDir}" && ar x "${debFile}" && tar -xf data.tar.* && rm -f control.tar.* data.tar.* debian-binary`]);

  // Calculate installed size in bytes
  const duResult = spawnSync("sh", ["-c", `du -sb "${archBuildDir}" | awk '{print $1}'`]);
  const sizeBytes = duResult.stdout ? duResult.stdout.toString().trim() : "50000000";

  const pkgInfoContent = [
    "pkgname = scansmith-ai-bin",
    "pkgbase = scansmith-ai-bin",
    `pkgver = ${pkgVersion}-1`,
    "pkgdesc = ScanSmith AI Studio - Intelligent Document Scan Digitizer & DOCX Converter",
    "url = https://github.com/rootlocalghost/ScanSmith-AI",
    `builddate = ${Math.floor(Date.now() / 1000)}`,
    "packager = ScanSmith Studio <noreply@github.com>",
    `size = ${sizeBytes}`,
    "arch = x86_64",
    "license = MIT",
    "depend = webkit2gtk-4.1",
    "depend = python",
    "provides = scansmith-ai",
    "conflict = scansmith-ai"
  ].join("\n") + "\n";

  fs.writeFileSync(path.join(archBuildDir, ".PKGINFO"), pkgInfoContent);

  // Compress into .pkg.tar.zst
  console.log("🗜️ Compressing with zstd into pacman package...");
  const packResult = spawnSync("sh", [
    "-c",
    `cd "${archBuildDir}" && tar --owner=0 --group=0 --numeric-owner -c --zstd -f "${outputPkgPath}" .PKGINFO usr`
  ]);

  if (packResult.status !== 0) {
    console.error("❌ Failed to create .pkg.tar.zst archive");
    process.exit(1);
  }

  // Clean up temp dir
  fs.rmSync(archBuildDir, { recursive: true, force: true });

  console.log(`\n✨ Arch Linux package created successfully!`);
  console.log(`📁 File: ${outputPkgPath}`);
  console.log(`💡 Install with: sudo pacman -U ${outputPkgName}\n`);
}

function handleBuild() {
  buildFrontend();

  if (args.includes("--arch")) {
    buildArchPackage();
    return;
  }

  if (args.includes("--all")) {
    console.log("🎯 Building all configured bundles...");
    runCommand("bun", ["x", "tauri", "build"]);
    return;
  }

  if (args.includes("--linux")) {
    console.log("🎯 Building Linux bundles (deb)...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "deb"]);
    return;
  }

  if (args.includes("--deb")) {
    console.log("🎯 Building Debian (.deb) package...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "deb"]);
    return;
  }

  if (args.includes("--appimage")) {
    console.log("🎯 Building AppImage bundle...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "appimage"]);
    return;
  }

  if (args.includes("--rpm")) {
    console.log("🎯 Building RPM (.rpm) package...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "rpm"]);
    return;
  }

  if (args.includes("--win") || args.includes("--windows")) {
    console.log("🎯 Building Windows targets (nsis, msi)...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "nsis,msi"]);
    return;
  }

  if (args.includes("--exe")) {
    console.log("🎯 Building Windows NSIS (.exe) installer...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "nsis"]);
    return;
  }

  if (args.includes("--msi")) {
    console.log("🎯 Building Windows MSI installer...");
    runCommand("bun", ["x", "tauri", "build", "--bundles", "msi"]);
    return;
  }

  // Default: build standard bundle
  console.log("🎯 Building standard Tauri packages...");
  runCommand("bun", ["x", "tauri", "build"]);
}

handleBuild();
