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
import { afterEach, test } from 'node:test';
import type { MakaBridge } from '../../../preload/bridge-contract.js';
import { archiveSession, removeSession, unarchiveSession } from '../../bridge/sessions.js';
import { ExpectedOperationError } from '../../bridge/expected-operation-error.js';
import {
  getShellCopy,
  localizedShellErrorMessage,
  sessionSettingFailureCopy,
} from '../../locales/shell-copy.js';

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});

function bridge(answer: unknown, failure?: Error) {
  const calls: unknown[] = [];
  const invoke =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args]);
      if (failure) throw failure;
      return answer;
    };
  globalThis.window = {
    maka: {
      sessions: {
        archive: invoke('archive'),
        unarchive: invoke('unarchive'),
        remove: invoke('remove'),
      },
    } as unknown as MakaBridge,
  } as unknown as Window & typeof globalThis;
  return calls;
}

test('retirement bridge turns coded refusals into actionable localized errors', async () => {
  const id = '["local","2f34a351-f4e7-4295-983a-686e4f2daeea"]';
  const options = { revisionFamily: true, requireArchived: true };
  const busyCopy = {
    en: 'This task or a linked task is still running or has pending work. Finish or stop it before trying again.',
    'zh-CN': '当前任务或关联任务仍在运行或有待处理工作，请先完成或停止任务后再试。',
    'zh-TW': '目前任務或關聯任務仍在執行或有待處理工作，請先完成或停止任務後再試。',
  };
  for (const [method, action] of [
    ['archive', archiveSession],
    ['unarchive', unarchiveSession],
    ['remove', removeSession],
  ] as const) {
    for (const code of [
      'session_busy',
      'operation_conflict',
      'operation_unavailable',
      'not_found',
    ] as const) {
      const calls = bridge({ ok: false, code });
      await assert.rejects(action(id, options), (error: unknown) => {
        assert.ok(error instanceof ExpectedOperationError);
        assert.equal(error.code, code);
        for (const locale of ['en', 'zh-CN', 'zh-TW'] as const) {
          const description = localizedShellErrorMessage(error, 'fallback', locale);
          assert.equal(
            description,
            code === 'session_busy'
              ? busyCopy[locale]
              : getShellCopy(locale).sessionSettingsActions.updateFailures[code],
          );
          assert.doesNotMatch(description, /Rate limit|模型速率|模型速率限制/);
        }
        return true;
      });
      assert.deepEqual(calls, [[method, id, options]]);
    }
  }
});

test('retirement bridge unwraps successful actions without changing removal semantics', async () => {
  for (const action of [archiveSession, unarchiveSession]) {
    bridge({ ok: true, result: undefined });
    assert.equal(await action('session-1'), undefined);
  }
  for (const disposition of ['removed', 'restored'] as const) {
    const outcome = { disposition, archivedSubtaskCount: disposition === 'removed' ? 2 : 0 };
    bridge({ ok: true, result: outcome });
    assert.deepEqual(await removeSession('session-1'), outcome);
  }
});

test('unexpected transport failures keep their identity, and real rate limits keep their copy', async () => {
  const failure = new Error('HTTP 429 Too Many Requests');
  bridge(undefined, failure);
  for (const action of [archiveSession, unarchiveSession, removeSession]) {
    await assert.rejects(action('session-1'), (error: unknown) => error === failure);
  }
  assert.equal(localizedShellErrorMessage(failure, 'fallback', 'en'), 'Rate limit exceeded');
});

test('neutral session-busy wording also remains suitable for settings', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW'] as const) {
    const error = new ExpectedOperationError('session_busy');
    const description = sessionSettingFailureCopy(locale, 'model', error).description;
    assert.equal(
      description,
      getShellCopy(locale).sessionSettingsActions.updateFailures.session_busy,
    );
    assert.doesNotMatch(description, /Rate limit|模型速率/);
  }
});
