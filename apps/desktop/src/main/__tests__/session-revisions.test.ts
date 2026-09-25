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

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { collapseSessionRevisions, revisionFamilySessionIds } from '@maka/core/session-revisions';
import { type SessionSummary } from '@maka/core/session';
import { deriveMessageVersions } from '../../renderer/lib/ported/session-revisions.js';

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    name: overrides.name ?? 'Conversation',
    isFlagged: false,
    isArchived: false,
    labels: [],
    hasUnread: false,
    status: 'active',
    backend: 'fake',
    llmConnectionSlug: 'test',
    connectionLocked: true,
    model: 'test',
    permissionMode: 'ask',
    ...overrides,
  };
}

describe('edit-and-resend session revisions', () => {
  it('folds durable versions into one sidebar slot after restart', () => {
    const root = summary('root', { lastMessageAt: 10 });
    const version2 = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionOfTurnId: 'turn-2',
      revisionIndex: 2,
      revisionState: 'committed',
      lastMessageAt: 20,
    });
    const ordinaryBranch = summary('branch', {
      parentSessionId: 'root',
      branchOfTurnId: 'turn-1',
      lastMessageAt: 15,
    });

    assert.deepEqual(
      collapseSessionRevisions([version2, ordinaryBranch, root]).map((session) => session.id),
      ['version-2', 'branch'],
    );
  });

  it('restores the most recently continued version as the sidebar head', () => {
    const continuedRoot = summary('root', { lastMessageAt: 30 });
    const version2 = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionIndex: 2,
      revisionState: 'committed',
      lastMessageAt: 20,
    });

    assert.deepEqual(
      collapseSessionRevisions([version2, continuedRoot]).map((session) => session.id),
      ['root'],
    );
  });

  it('hides a crash-orphaned draft version after restart', () => {
    const root = summary('root', { lastMessageAt: 10 });
    const draft = summary('draft', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionIndex: 2,
      revisionState: 'preparing',
    });

    assert.deepEqual(collapseSessionRevisions([draft, root]).map((session) => session.id), ['root']);
    assert.equal(deriveMessageVersions([draft, root], 'root').size, 0);
  });

  it('keeps the selected old version in the same sidebar slot', () => {
    const root = summary('root', { lastMessageAt: 10 });
    const version2 = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionIndex: 2,
      revisionState: 'committed',
      lastMessageAt: 20,
    });

    assert.deepEqual(
      collapseSessionRevisions([version2, root], 'root').map((session) => session.id),
      ['root'],
    );
  });

  it('keeps lifecycle actions scoped to versions, not ordinary branches', () => {
    const root = summary('root');
    const version2 = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
    });
    const branch = summary('branch', { parentSessionId: 'root', branchOfTurnId: 'turn-1' });

    assert.deepEqual(revisionFamilySessionIds([root, version2, branch], 'version-2'), [
      'root',
      'version-2',
    ]);
    assert.deepEqual(revisionFamilySessionIds([root, version2, branch], 'branch'), ['branch']);
  });

  it('counts versions per message, whichever version is on screen', () => {
    const root = summary('root');
    // Edit message 2 of root, then edit that edit again.
    const version2 = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionOfTurnId: 'turn-2',
      revisionTurnId: 'turn-2b',
      revisionIndex: 2,
      revisionState: 'committed',
    });
    const version3 = summary('version-3', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'version-2',
      revisionOfTurnId: 'turn-2b',
      revisionTurnId: 'turn-2c',
      revisionIndex: 3,
      revisionState: 'committed',
    });
    const sessions = [version3, root, version2];

    assert.deepEqual(deriveMessageVersions(sessions, 'root').get('turn-2'), {
      current: 1,
      total: 3,
      nextSessionId: 'version-2',
    });
    assert.deepEqual(deriveMessageVersions(sessions, 'version-2').get('turn-2b'), {
      current: 2,
      total: 3,
      previousSessionId: 'root',
      nextSessionId: 'version-3',
    });
    assert.deepEqual(deriveMessageVersions(sessions, 'version-3').get('turn-2c'), {
      current: 3,
      total: 3,
      previousSessionId: 'version-2',
    });
  });

  it('keeps edits of different messages apart', () => {
    const root = summary('root');
    const version2 = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionOfTurnId: 'turn-2',
      revisionTurnId: 'turn-2b',
      revisionIndex: 2,
      revisionState: 'committed',
    });
    // Message 3 of version 2 (which carries turn-1 and turn-2b over).
    const version3 = summary('version-3', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'version-2',
      revisionOfTurnId: 'turn-3b',
      revisionTurnId: 'turn-3c',
      revisionIndex: 3,
      revisionState: 'committed',
    });
    const versions = deriveMessageVersions([root, version2, version3], 'version-3');

    assert.deepEqual(versions.get('turn-2b'), {
      current: 2,
      total: 2,
      previousSessionId: 'root',
    });
    assert.deepEqual(versions.get('turn-3c'), {
      current: 2,
      total: 2,
      previousSessionId: 'version-2',
    });
    assert.equal(versions.has('turn-1'), false);
  });

  it('shows no versions for an edit whose turn has not started', () => {
    const root = summary('root');
    const preparing = summary('version-2', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionOfTurnId: 'turn-2',
      revisionIndex: 2,
      revisionState: 'preparing',
    });

    assert.equal(deriveMessageVersions([root, preparing], 'version-2').size, 0);
  });
});
