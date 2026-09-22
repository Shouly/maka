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

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isWorkHubCreateDefaults, type WorkHubCreateDefaults } from '@maka/core/session';
import { decodeWorkspaceTarget, type WorkspaceTarget } from '@maka/runtime-host/protocol';

export interface WorkHubCreationContext {
  readonly workspace: WorkspaceTarget;
  readonly defaults: WorkHubCreateDefaults;
}

/** The Host fingerprints the whole creation context, including its default permissions. */
export function createWorkHubCreationContexts(root: string) {
  const pending = new Map<string, Promise<WorkHubCreationContext>>();
  async function loadOrCreate(key: string, create: () => Promise<WorkHubCreationContext>) {
    const file = join(root, `${createHash('sha256').update(key).digest('hex')}.json`);
    let raw: string | undefined;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (raw !== undefined) {
      const record = JSON.parse(raw) as Partial<WorkHubCreationContext> | null;
      if (!record || !isWorkHubCreateDefaults(record.defaults)) {
        throw new Error('Invalid task creation context');
      }
      return { workspace: decodeWorkspaceTarget(record.workspace), defaults: record.defaults };
    }
    const context = await create();
    await mkdir(root, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(context), { flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return context;
  }
  return {
    async resolve(key: string, create: () => Promise<WorkHubCreationContext>): Promise<WorkHubCreationContext> {
      const existing = pending.get(key);
      if (existing) return existing;
      const result = loadOrCreate(key, create);
      pending.set(key, result);
      try {
        return await result;
      } finally {
        pending.delete(key);
      }
    },
  };
}
