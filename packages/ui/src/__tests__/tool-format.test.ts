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
import { test } from 'node:test';
import { projectToolArgsPreview } from '@maka/core/tool-quiet-preview';
import { resolveToolDisplayName } from '../tool-activity/display-name.js';
import type { ToolActivityItem } from '../materialize.js';
import { describeToolSearchCall } from '../tool-format.js';

test('a tool search row reads as the question it asked', () => {
  // `select:X` names one tool and reads as loading it; anything else is its
  // own words. The reference titles this row the same way.
  assert.equal(describeToolSearchCall({ query: 'select:ScheduledTaskList' }, 'en'), 'Loading tool: ScheduledTaskList');
  assert.equal(describeToolSearchCall({ query: 'select:A,B' }, 'zh-TW'), '載入工具：A');
  assert.equal(describeToolSearchCall({ query: 'list scheduled tasks' }, 'en'), 'list scheduled tasks');
  // Wrapped by a provider's own search connector, and read the same way.
  assert.equal(
    describeToolSearchCall({ arguments: { query: 'select:Grep' }, call_id: 'call_x' }, 'en'),
    'Loading tool: Grep',
  );
  // No query, a blank one, and a non-object all still say what the row is.
  assert.equal(describeToolSearchCall({}, 'en'), 'Loading tools');
  assert.equal(describeToolSearchCall({ query: '   ' }, 'zh-CN'), '正在加载工具');
  assert.equal(describeToolSearchCall(undefined, 'en'), 'Loading tools');
  // A proxied tool is named for its server on the wire; the row names the tool.
  assert.equal(
    describeToolSearchCall({ query: 'select:mcp__desktop_browser__BrowserSnapshot' }, 'en'),
    'Loading tool: BrowserSnapshot',
  );
});

test('WorkHub control shows its user-language status in live and recorded tool rows', () => {
  const base: ToolActivityItem = { toolUseId: 'control', toolName: 'mcp__desktop_workhub__control', args: {}, status: 'running' };
  for (const status of ['正在打开项目设置', 'Opening project settings']) {
    assert.equal(resolveToolDisplayName({ ...base, args: undefined, argsPreview: projectToolArgsPreview(base.toolName, { status }) }, 'en'), status);
    assert.equal(resolveToolDisplayName({ ...base, status: 'completed', args: { status } }, 'zh-CN'), status);
  }
  for (const status of ['', '   ', 42, 'x'.repeat(81), 'one\ntwo']) {
    assert.equal(resolveToolDisplayName({ ...base, args: { status } }, 'en'), base.toolName);
  }
  assert.equal(resolveToolDisplayName({ ...base, toolName: 'other', args: { status: 'Unrelated' } }, 'en'), 'other');
});
