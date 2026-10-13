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

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { StoredMessage } from '@maka/core/session';
import { decodeCanonicalToolResultContent } from '@maka/core/tool-result-record-schema';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import {
  collectConversationCopySessionFileRefs,
  rewriteConversationCopyMessage,
} from '../conversation-copy.js';

for (const kind of ['subagent', 'agent_swarm'] as const) {
  test(`${kind} delivery remains readable through three detached branches and source GC`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-resource-closure-'));
    const owner = await tryAcquireInteractiveRootOwner(
      await resolveStorageRoot({ path: root, kind: 'interactive' }),
    );
    assert.ok(owner);
    const store = await openInteractiveArtifactStoreForWrite(owner.lease);
    try {
      await store.create({
        id: 'child-report',
        sessionId: 'child',
        turnId: 'child-turn',
        name: 'report.txt',
        kind: 'file',
        source: 'user_delivery',
        content: 'child result',
      });
      await store.copyConversationArtifacts({
        sourceSessionId: 'child',
        targetSessionId: 'parent',
        turnIds: [],
        includeArtifactIds: ['child-report'],
      });
      await store.purgeSessionArtifacts('child');
      const child = {
        childSessionId: 'child',
        agentName: 'Worker',
        turnId: 'child-turn',
        runId: 'child-run',
        status: 'completed',
        summary: 'done',
        artifactIds: ['child-report'],
      };
      const content = decodeCanonicalToolResultContent(
        kind === 'subagent'
          ? { kind, ...child, permissionMode: 'ask' }
          : {
              kind,
              status: 'completed',
              startedAt: 1,
              completedAt: 2,
              durationMs: 1,
              items: [{ ...child, itemId: 'item', index: 0, profile: 'default', started: true }],
            },
      );
      let message: StoredMessage = {
        type: 'tool_result',
        id: 'result',
        turnId: 'parent-turn',
        ts: 2,
        toolUseId: 'call',
        isError: false,
        content,
      };
      let source = 'parent';
      for (const target of ['branch-1', 'branch-2', 'branch-3']) {
        const dependencies = collectConversationCopySessionFileRefs({
          sourceSessionId: source,
          messages: [message],
          runtimeEvents: [],
        });
        const copy = await store.copyConversationArtifacts({
          sourceSessionId: source,
          targetSessionId: target,
          turnIds: ['parent-turn'],
          includeArtifactIds: [...dependencies],
        });
        assert.ok(copy.artifactIds.has('child-report'));
        message = rewriteConversationCopyMessage(message, {
          mode: 'exact',
          sourceSessionId: source,
          targetSessionId: target,
          artifactIds: copy.artifactIds,
          linkedChildren: { mode: 'snapshot' },
          runIds: new Map(),
          runtimeEventIds: new Map(),
          providerTraceIds: new Map(),
        });
        await store.purgeSessionArtifacts(source);
        await store.collectGarbage({ maxPaths: 100 });
        assert.deepEqual(await store.readTextInSession(target, 'child-report'), {
          ok: true,
          text: 'child result',
        });
        assert.deepEqual(await store.readTextInSession('unrelated', 'child-report'), {
          ok: false,
          reason: 'not_found',
        });
        source = target;
      }
    } finally {
      store.close();
      await owner.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
