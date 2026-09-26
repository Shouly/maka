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
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  createSqliteAgentRunStore,
  normalizeRootTurnAdmissionPayload,
} from '../agent-run-store.js';
import { normalizeSubmittedTurnIntent } from '../submitted-turn-intent.js';

test('root admission preserves an explicit empty inline-reference marker from its sources', () => {
  const content = { text: 'plain', inlineReferences: [] } as const;
  const normalized = normalizeRootTurnAdmissionPayload(content, [
    {
      messageId: 'message-1',
      content,
      placement: 'next_turn',
      disposition: 'followup',
    },
  ]);

  assert.deepEqual(normalized.normalizedInput, content);
  assert.deepEqual(normalized.sourceMessages[0]?.content, content);
});

test('root admission preserves and validates each source submission digest', () => {
  const digest = `sha256:${'a'.repeat(64)}` as const;
  const source = {
    messageId: 'message-1',
    content: { text: 'prepared', displayText: 'submitted' },
    submittedContentDigest: digest,
    placement: 'next_turn' as const,
    disposition: 'followup' as const,
  };
  const normalized = normalizeRootTurnAdmissionPayload(source.content, [source]);

  assert.equal(normalized.sourceMessages[0]?.submittedContentDigest, digest);
  assert.throws(() =>
    normalizeRootTurnAdmissionPayload(source.content, [
      { ...source, submittedContentDigest: 'sha256:not-a-digest' },
    ]),
  );
});

test('root admission preserves and validates each source submitted placement', () => {
  const content = { text: 'promoted follow-up' } as const;
  const source = {
    messageId: 'promoted-message',
    content,
    submittedPlacement: 'next_turn' as const,
    placement: 'current_turn' as const,
    disposition: 'steering' as const,
  };

  assert.equal(
    normalizeRootTurnAdmissionPayload(content, [source]).sourceMessages[0]?.submittedPlacement,
    'next_turn',
  );
  assert.throws(() =>
    normalizeRootTurnAdmissionPayload(content, [
      { ...source, submittedPlacement: 'invalid-placement' },
    ]),
  );
});

test('root admission refuses a source Message that still carries a Skill outcome', () => {
  // A sent /<name> is not resolved at admission any more, so a record that
  // claims an outcome is not one this build wrote.
  const content = { text: '/writer draft' } as const;
  const source = {
    messageId: 'message-skill',
    content,
    placement: 'next_turn' as const,
    disposition: 'followup' as const,
  };
  assert.equal(normalizeRootTurnAdmissionPayload(content, [source]).sourceMessages.length, 1);
  assert.throws(() =>
    normalizeRootTurnAdmissionPayload(content, [
      { ...source, skillInvocation: { loaded: [], failed: [], receipts: [] } } as typeof source,
    ]),
  );
});

test('a stored root admission that still carries a Skill outcome is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maka-root-admission-skill-'));
  try {
    const store = createSqliteAgentRunStore(root);
    const admitted = await store.admitRootTurn({
      sessionId: 'session',
      turnId: 'turn-skill',
      proposedRunId: 'run-skill',
      proposedUserMessageId: 'message-skill',
      execution: { kind: 'external_message' },
      previousRootTurnId: null,
      normalizedInput: { text: '/writer draft' },
      sourceMessages: [],
      admittedAt: 10,
    });
    store.close?.();

    const database = new DatabaseSync(join(root, 'runtime.sqlite'));
    try {
      database
        .prepare(
          'UPDATE core_root_turn_admissions SET record_json = ? WHERE session_id = ? AND turn_id = ?',
        )
        .run(
          JSON.stringify({
            ...admitted.admission,
            skillInvocation: { loaded: [], failed: [], receipts: [] },
          }),
          'session',
          'turn-skill',
        );
    } finally {
      database.close();
    }

    const reopened = createSqliteAgentRunStore(root);
    try {
      await assert.rejects(
        reopened.readRootTurnAdmission('session', 'turn-skill'),
        /malformed fields/,
      );
    } finally {
      reopened.close?.();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a submitted intent is exactly one orchestration override', () => {
  const orchestration = { mode: 'graph', source: 'host_api' } as const;
  assert.deepEqual(normalizeSubmittedTurnIntent({ turnOrchestration: orchestration }), {
    turnOrchestration: orchestration,
  });
  // Asking for nothing is no intent at all, and an older shape that carried
  // skill ids is not read as something else.
  for (const value of [
    {},
    { skillIds: ['writer'] },
    { turnOrchestration: orchestration, skillIds: ['writer'] },
    { turnOrchestration: { ...orchestration, extra: true } },
    { turnOrchestration: { mode: 'graph' } },
  ]) {
    assert.throws(() => normalizeSubmittedTurnIntent(value), JSON.stringify(value));
  }
});

test('admits a quote-only root Turn input (#4804)', () => {
  const content = {
    text: '',
    quotes: [{ text: 'quoted passage worth answering' }],
  } as const;
  const normalized = normalizeRootTurnAdmissionPayload(content, []);

  assert.ok(normalized.normalizedInput);
  assert.equal(normalized.normalizedInput?.quotes?.[0]?.text, 'quoted passage worth answering');
});

test('admits an attachment-only root Turn input (#4804)', () => {
  const content = {
    text: '',
    attachments: [
      {
        kind: 'image' as const,
        name: 'diagram.png',
        mimeType: 'image/png',
        bytes: 1024,
        ref: { kind: 'workspace_file', relativePath: 'blobs/diagram.png' },
      },
    ],
  } as const;
  const normalized = normalizeRootTurnAdmissionPayload(content, []);

  assert.equal(normalized.normalizedInput?.attachments?.[0]?.name, 'diagram.png');
});

test('still rejects a truly contentless root Turn input', () => {
  assert.throws(
    () => normalizeRootTurnAdmissionPayload({ text: '' }, []),
    /Invalid root turn normalized input/u,
  );
});
