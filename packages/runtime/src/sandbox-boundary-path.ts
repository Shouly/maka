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

import { mkdirSync, promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { realpathAllowMissing } from './path-containment.js';
import {
  MAX_SANDBOX_BOUNDARY_PATH_CHARS,
  validateSandboxBoundaryExpansion,
  type SandboxBoundaryAccess,
  type SandboxBoundaryExpansion,
  type SandboxBoundaryScope,
} from '@maka/core/sandbox-boundary';
import type { PermissionProfile } from '@maka/core/permission-profile';

export interface NormalizedSandboxBoundaryPath {
  readonly displayPath: string;
  readonly enforcementPath: string;
  readonly access: SandboxBoundaryAccess;
  readonly scope: SandboxBoundaryScope;
  readonly targetType: 'file' | 'directory' | 'other' | 'missing';
}

/**
 * A boundary declaration the caller can correct and submit again.
 *
 * Filesystem failures are deliberately not wrapped in this error: an invalid
 * declaration is actionable model input, while realpath/stat/permission/I/O
 * failures describe an unavailable host operation and need to retain their
 * original classification.
 */
export class SandboxBoundaryDeclarationError extends Error {
  override readonly name = 'SandboxBoundaryDeclarationError';
}

export async function normalizeSandboxBoundaryPath(input: {
  path: string;
  access: SandboxBoundaryAccess;
  scope: SandboxBoundaryScope | 'auto';
  cwd: string;
}): Promise<NormalizedSandboxBoundaryPath> {
  if (
    !input.path ||
    input.path.includes('\0') ||
    input.path.length > MAX_SANDBOX_BOUNDARY_PATH_CHARS
  ) {
    throw new SandboxBoundaryDeclarationError(
      'Sandbox boundary path is invalid or exceeds the length limit.',
    );
  }
  const canonicalCwd = await fs.realpath(input.cwd);
  const displayPath = resolve(canonicalCwd, input.path);
  const enforcementPath = await realpathAllowMissing(displayPath);
  const targetType = await targetTypeFor(enforcementPath);
  const scope =
    input.scope === 'auto' ? (targetType === 'directory' ? 'subtree' : 'exact') : input.scope;
  // A directory that does not exist yet can be granted — `mkdir ~/new` needs
  // exactly that, and refusing it left the parent (the whole home directory)
  // as the only thing to ask for. It is created before a sandbox that has to
  // name it runs (`materializeApprovedWriteDirectories`).
  if (scope === 'subtree' && targetType !== 'directory' && targetType !== 'missing') {
    throw new SandboxBoundaryDeclarationError(
      'A subtree sandbox boundary must target a directory, existing or not yet created.',
    );
  }
  return { displayPath, enforcementPath, access: input.access, scope, targetType };
}

export async function normalizeSandboxBoundaryExpansion(
  expansion: SandboxBoundaryExpansion,
  cwd: string,
): Promise<SandboxBoundaryExpansion> {
  const validated = validateSandboxBoundaryExpansion(expansion);
  if (!validated.ok) throw new SandboxBoundaryDeclarationError(validated.message);
  const entries = await Promise.all(
    (validated.expansion.filesystem?.entries ?? []).map(async (entry) => {
      const normalized = await normalizeSandboxBoundaryPath({
        ...entry,
        cwd,
      });
      if (normalized.scope === 'exact' && normalized.targetType === 'directory') {
        throw new SandboxBoundaryDeclarationError(
          'An exact sandbox boundary cannot target a directory; use subtree for directory access.',
        );
      }
      return {
        path: normalized.enforcementPath,
        access: normalized.access,
        scope: normalized.scope,
      };
    }),
  );
  const normalized = validateSandboxBoundaryExpansion({
    ...(entries.length > 0 ? { filesystem: { entries } } : {}),
    ...(validated.expansion.network ? { network: validated.expansion.network } : {}),
  });
  if (!normalized.ok) throw new SandboxBoundaryDeclarationError(normalized.message);
  return normalized.expansion;
}

async function targetTypeFor(path: string): Promise<NormalizedSandboxBoundaryPath['targetType']> {
  try {
    const stat = await fs.stat(path);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (isMissingPathError(error)) return 'missing';
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/**
 * Read only is read-only: a write cannot be asked for, only the user switching
 * the session to Manual allows one. The same sentence wherever a write is
 * refused for that reason — the file tools, a Bash declaration, the request
 * tool itself.
 */
export const READ_ONLY_WRITE_REFUSED_MESSAGE =
  'This session is Read only, so writing cannot be requested; only the user can allow it, by switching the session to Manual. Work within read-only and say what you could not do.';

export function expansionRequestsWrite(expansion: SandboxBoundaryExpansion): boolean {
  return (expansion.filesystem?.entries ?? []).some((entry) => entry.access === 'write');
}

/**
 * Make every approved write directory exist before a sandbox that enforces it
 * starts. A grant can name a directory before it exists, and the sandbox can
 * only be as narrow as what is there: Linux mounts and Windows ACLs cannot
 * name a missing path at all, and on macOS a write into a missing directory is
 * enforced through its nearest existing ancestor — which, with the grant
 * itself absent, would be whatever lies above it. Runs before every sandboxed
 * command and file operation, so a granted directory the user removed comes
 * back, empty, the next time a tool runs; only write grants approved as whole
 * directories are created, and a failure is left for the sandboxed operation
 * to report.
 */
export function materializeApprovedWriteDirectories(profile: PermissionProfile): void {
  if (profile.type !== 'managed' || profile.fileSystem.kind !== 'restricted') return;
  for (const entry of profile.fileSystem.entries) {
    if (entry.kind !== 'path' || entry.access !== 'write' || entry.match === 'exact') continue;
    try {
      mkdirSync(entry.path, { recursive: true });
    } catch {
      // Reported by the operation that needed it.
    }
  }
}
