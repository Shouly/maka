<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# Phase 7c — the app ships its own ripgrep

Closes the first release blocker (2026-09-13). The Grep tool is ripgrep, and
the app assumed the machine had one: the sandboxed worker probed PATH plus
three Homebrew/usr prefixes, and the unsandboxed executor spawned a bare
`rg`. A packaged app launched from Finder gets the login-less PATH, so on a
machine without Homebrew ripgrep every search failed with `spawn rg ENOENT`.

## What landed

- `packages/runtime/src/ripgrep-locator.ts` — one candidate list for both
  spawners: `MAKA_RIPGREP_PATH` first, then PATH, then the package-manager
  prefixes; `resolveRipgrepPath` takes the first executable one. The worker
  launch spec and `LocalWorkspaceExecutor` both use it (the executor resolves
  once and keeps a bare `rg` as the last resort). Exported as
  `@maka/runtime/ripgrep-locator`.
- `apps/desktop/bundled-tools.json` — a `ripgrep` entry: 15.2.0, MIT OR
  Unlicense, one release archive per shipped target (darwin arm64 / x64,
  win32 x64, linux x64 musl / arm64 gnu) with the digest ripgrep publishes.
- `apps/desktop/scripts/prepare-ripgrep.mjs` — fetches the archive the
  manifest names for this machine (or `MAKA_RIPGREP_TARGET`), refuses it
  unless its SHA-256 matches, extracts `rg` and `LICENSE-MIT` into
  `resources/bin/` (gitignored) and writes a pin beside them; a rerun with a
  matching pin is a no-op. Runs from `build:resources`. Offline, an existing
  pin is kept and a missing binary is a warning — an error under
  `MAKA_REQUIRE_RIPGREP=1`.
- `electron-builder.config.mjs` — `beforePack` fetches the binary for the
  TARGET platform and arch (`package:macos-x64` on Apple Silicon ships x64),
  failing the package if it cannot; `resources/bin/rg` → `Resources/bin/rg`
  (`rg.exe` on Windows), the MIT licence → `licenses/ripgrep/`, and the
  binary listed under `mac.binaries` so it is signed with the app's identity
  (an unsigned helper fails notarization for the whole app under the
  hardened runtime). `mac.binaries` entries resolve against the `.app`
  bundle (`path.resolve(appPath, entry)` in app-builder-lib's
  MacTargetHelper), hence `Contents/Resources/bin/rg`.
- `runtime-host-boot.ts` — before the Runtime Host is spawned, sets
  `MAKA_RIPGREP_PATH` to the bundled copy (packaged: `Resources/bin`;
  development: `apps/desktop/resources/bin`) when it exists and nothing set it
  from outside. The Host inherits the environment; the sandboxed worker's
  launch spec reads it from there.
- `scripts/verify-packaged-app.mjs` now requires `bin/rg` and the licence in
  a packaged build. READMEs and the Windows support doc no longer ask users
  to install ripgrep for the Desktop.

The bundled copy wins over PATH on purpose: it is the version the release
was tested with, and the worker's flags are pinned to it.

## Verification

- Runtime tsc; desktop main tsc; ASF headers; knip.
- `@maka/runtime` tests (`ripgrep-locator`, `filesystem-worker-launch-spec`,
  `filesystem-worker`, `builtin-tools`): 92 pass. `prepare-ripgrep.test.mjs`
  (manifest shape, target naming, pin check) and
  `verify-packaged-app.test.mjs` pass.
- The script fetched 15.2.0 for darwin-arm64 on this machine, the archive
  digest matched, `resources/bin/rg --version` answers, and a second run is
  a no-op. A launched development app reports `MAKA_RIPGREP_PATH` pointing
  at that binary from its main process.

## Owed

- A packaged macOS build through notarization with the extra binary
  signed (`package:macos-arm64`), and `verify-packaged-app` against it.
- A Windows packaging run: `tar -xf` on the `.zip` relies on Windows 10+
  bsdtar, which the nightly runners have; confirm.
- The CLI still resolves ripgrep from PATH; bundling it there is a separate
  release-cli change.
