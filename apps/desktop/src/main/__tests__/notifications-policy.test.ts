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

import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deduplicateRunNotifications,
  resolveNotificationContent,
  shouldRaiseRunNotification,
  type RunNotificationEvent,
} from '../notifications-policy.js';

it('gates native notifications through every required condition', () => {
  const base = { enabled: true, supported: true, windowFocused: false, e2e: false };
  const cases = [
    [base, true],
    [{ ...base, enabled: false }, false],
    [{ ...base, supported: false }, false],
    [{ ...base, windowFocused: true }, false],
    [{ ...base, e2e: true }, false],
  ] as const;

  for (const [input, expected] of cases) {
    assert.equal(shouldRaiseRunNotification(input), expected);
  }
});

it('keeps distinct localized fallback copy for every attention kind', () => {
  const copies = (['completed', 'errored', 'waiting'] as const).map((kind) =>
    resolveNotificationContent({ kind }, 'zh-CN'),
  );
  assert.equal(new Set(copies.map((copy) => copy.title)).size, 3);
  assert.deepEqual(resolveNotificationContent({ kind: 'waiting' }, 'zh-CN'), {
    title: '等你回答',
    body: 'Maka 需要你的回答才能继续，点击查看。',
  });
  assert.deepEqual(resolveNotificationContent({ kind: 'completed' }, 'zh-TW'), {
    title: '回答已產生',
    body: 'Maka 已完成本次回答，按一下以檢視。',
  });
});

it('sanitizes notification content, caps it, and falls back per field', () => {
  const clean = resolveNotificationContent(
    { kind: 'completed', title: '  会话  A  ', body: 'line one\n\nline two\tindented' },
    'zh-CN',
  );
  assert.deepEqual(clean, { title: '会话 A', body: 'line one line two indented' });

  for (const value of ['', '   ', undefined]) {
    assert.deepEqual(
      resolveNotificationContent({ kind: 'completed', title: value, body: value }, 'zh-CN'),
      { title: '回答已生成', body: 'Maka 已完成本轮回答，点击查看。' },
    );
  }

  const capped = resolveNotificationContent(
    { kind: 'completed', title: 'S', body: 'x'.repeat(500) },
    'zh-CN',
  );
  assert.equal(capped.body.length, 160);
  assert.ok(capped.body.endsWith('…'));

  assert.deepEqual(
    resolveNotificationContent({ kind: 'errored', title: '出错的会话', body: '' }, 'zh-CN'),
    { title: '出错的会话', body: '本轮回答未能完成，点击查看详情。' },
  );
});

it('raises one Host event once, and forgets the oldest past its bound', async () => {
  const raised: string[] = [];
  const notify = deduplicateRunNotifications(async (input) => {
    raised.push(`${input.hostEpoch}/${input.sessionId}/${input.eventId}`);
  });
  const event = (eventId: string, overrides: Partial<RunNotificationEvent> = {}) => ({
    kind: 'completed' as const,
    hostEpoch: 'host-1',
    sessionId: 'session-1',
    eventId,
    ...overrides,
  });

  await notify(event('first'));
  await notify(event('first'));
  await notify(event('first', { sessionId: 'session-2' }));
  await notify(event('first', { hostEpoch: 'host-2' }));
  assert.deepEqual(raised, ['host-1/session-1/first', 'host-1/session-2/first', 'host-2/session-1/first']);

  for (let index = 0; index < 512; index += 1) await notify(event(`filler-${index}`));
  raised.length = 0;
  await notify(event('first'));
  assert.deepEqual(raised, ['host-1/session-1/first']);
});
