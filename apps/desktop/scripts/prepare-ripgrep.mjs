#!/usr/bin/env node
/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// Fetch the ripgrep the app ships, and pin it.
//
// The Grep tool is ripgrep, and the app used to assume the user's machine had
// one: a packaged build launched from Finder gets the login-less PATH, so on
// a machine without Homebrew ripgrep every search failed with `spawn rg
// ENOENT`. This script puts the release binary the manifest names into
// `apps/desktop/resources/bin/` (gitignored), where electron-builder picks it
// up as `Resources/bin/rg` and the main process points the Runtime Host at it
// (`MAKA_RIPGREP_PATH`).
//
// Nothing is trusted that the manifest does not name: the archive's SHA-256
// must match `bundled-tools.json` before it is opened, and the extracted
// binary's SHA-256 is written next to it so a stale or tampered copy is
// re-fetched rather than shipped.
//
//   node scripts/prepare-ripgrep.mjs                   # this machine's platform/arch
//   MAKA_RIPGREP_TARGET=win32-x64 node scripts/prepare-ripgrep.mjs
//   MAKA_SKIP_RIPGREP=1 …                              # leave resources/bin alone
//
// Offline: an existing pinned binary is kept; a missing one is a warning for a
// development build and an error when MAKA_REQUIRE_RIPGREP=1 (packaging).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(desktopRoot, 'bundled-tools.json');
const binDir = join(desktopRoot, 'resources', 'bin');

export function ripgrepTarget(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

export function ripgrepBinaryName(target) {
  return target.startsWith('win32-') ? 'rg.exe' : 'rg';
}

export function readRipgrepManifest(path = manifestPath) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const entry = manifest.ripgrep;
  if (!entry || typeof entry.version !== 'string' || typeof entry.assets !== 'object') {
    throw new Error(`${path}: no ripgrep entry`);
  }
  return entry;
}

export function ripgrepAsset(entry, target) {
  const asset = entry.assets[target];
  if (!asset) {
    throw new Error(
      `bundled-tools.json names no ripgrep asset for ${target} (known: ${Object.keys(entry.assets).join(', ')})`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`ripgrep ${target}: malformed sha256`);
  return {
    url: `https://github.com/${entry.repo}/releases/download/${entry.version}/${asset.archive}`,
    archive: asset.archive,
    sha256: asset.sha256,
  };
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The pin written beside the binary; matching it means nothing to do. */
function stampPath(target) {
  return join(binDir, `ripgrep-${target}.json`);
}

export function isPinned(entry, target, binaryPath = join(binDir, ripgrepBinaryName(target))) {
  const stamp = stampPath(target);
  if (!existsSync(stamp) || !existsSync(binaryPath)) return false;
  try {
    const pin = JSON.parse(readFileSync(stamp, 'utf8'));
    return pin.version === entry.version && pin.binarySha256 === sha256(binaryPath);
  } catch {
    return false;
  }
}

function findBinary(root, name) {
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory()) {
      const found = findBinary(path, name);
      if (found) return found;
    } else if (item.name === name) return path;
  }
  return undefined;
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

export async function prepareRipgrep({ target = ripgrepTarget(), log = console.log } = {}) {
  const entry = readRipgrepManifest();
  const binaryName = ripgrepBinaryName(target);
  const binaryPath = join(binDir, binaryName);
  if (isPinned(entry, target, binaryPath)) {
    log(`[ripgrep] ${entry.version} for ${target} already prepared`);
    return { binaryPath, fetched: false };
  }
  const asset = ripgrepAsset(entry, target);
  const work = mkdtempSync(join(tmpdir(), 'maka-ripgrep-'));
  try {
    const archivePath = join(work, asset.archive);
    log(`[ripgrep] fetching ${asset.url}`);
    await download(asset.url, archivePath);
    const actual = sha256(archivePath);
    if (actual !== asset.sha256) {
      throw new Error(`[ripgrep] ${asset.archive}: sha256 ${actual} does not match the manifest`);
    }
    const extracted = join(work, 'extracted');
    mkdirSync(extracted);
    // bsdtar (macOS, Windows 10+) and GNU tar both open .tar.gz; bsdtar also
    // opens .zip, which is what the Windows release ships as.
    execFileSync('tar', ['-xf', archivePath, '-C', extracted], { stdio: 'inherit' });
    const found = findBinary(extracted, binaryName);
    if (!found) throw new Error(`[ripgrep] ${asset.archive} does not contain ${binaryName}`);
    mkdirSync(binDir, { recursive: true });
    copyFileSync(found, binaryPath);
    if (!binaryName.endsWith('.exe')) chmodSync(binaryPath, 0o755);
    const licenseSource = findBinary(extracted, 'LICENSE-MIT');
    if (licenseSource) copyFileSync(licenseSource, join(binDir, 'ripgrep-LICENSE-MIT.txt'));
    writeFileSync(
      stampPath(target),
      `${JSON.stringify(
        {
          version: entry.version,
          target,
          archive: asset.archive,
          archiveSha256: asset.sha256,
          binarySha256: sha256(binaryPath),
          binarySizeBytes: statSync(binaryPath).size,
        },
        null,
        2,
      )}\n`,
    );
    log(`[ripgrep] ${entry.version} for ${target} → ${binaryPath}`);
    return { binaryPath, fetched: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.env.MAKA_SKIP_RIPGREP === '1') {
    console.log('[ripgrep] skipped (MAKA_SKIP_RIPGREP=1)');
  } else {
    const target = process.env.MAKA_RIPGREP_TARGET?.trim() || ripgrepTarget();
    try {
      await prepareRipgrep({ target });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (process.env.MAKA_REQUIRE_RIPGREP === '1') {
        console.error(message);
        process.exit(1);
      }
      console.warn(`${message}\n[ripgrep] continuing without a bundled binary; the Grep tool will use PATH.`);
    }
  }
}
