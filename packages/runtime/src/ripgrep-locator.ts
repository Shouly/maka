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

// Where ripgrep is, in one place.
//
// The Grep tool is ripgrep; the runtime does not carry a JavaScript search.
// Two callers spawn it — the sandboxed filesystem worker (through its launch
// spec) and the unsandboxed local executor — and both used to look in
// different places, the executor in nothing but a bare `rg` on PATH. A
// packaged app launched from Finder gets the login-less PATH, so on a
// machine without Homebrew ripgrep the tool failed with `spawn rg ENOENT`.
//
// Order: the binary the product ships (`MAKA_RIPGREP_PATH`, set by the
// Desktop main process to its bundled copy), then PATH, then the package
// managers' well-known prefixes. The bundled copy wins over PATH on purpose:
// it is the version the release was tested with, and a user's own `rg` may
// be older than the flags the worker passes.

import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export const RIPGREP_PATH_ENV = 'MAKA_RIPGREP_PATH';

export function ripgrepExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'rg.exe' : 'rg';
}

/** Every path worth trying, most trusted first. Existence is not checked here. */
export function ripgrepCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  const executableName = ripgrepExecutableName(platform);
  const bundled = env[RIPGREP_PATH_ENV]?.trim();
  return unique([
    ...(bundled ? [bundled] : []),
    ...(env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, executableName)),
    ...(platform === 'win32' ? [] : ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']),
  ]);
}

/** The first candidate that exists and is executable, resolved through symlinks. */
export async function resolveRipgrepPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  for (const candidate of ripgrepCandidates(env, platform)) {
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Not here; try the next.
    }
  }
  return undefined;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
