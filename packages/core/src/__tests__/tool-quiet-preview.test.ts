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
import {
  formatAsKeyValueLines,
  formatQuietJsonValue,
  formatToolInvocationLine,
  projectToolArgsPreview,
} from '../tool-quiet-preview.js';
import { projectToolActivityArgs } from '../tool-activity-args.js';

describe('tool quiet preview', () => {
  it('redacts secrets in values and embedded keys', () => {
    const value = formatQuietJsonValue({ password: 'correct-horse', ok: true }, 'en').body;
    assert.doesNotMatch(value, /correct-horse/);
    assert.match(value, /redacted/i);
    const key = formatAsKeyValueLines({ 'password=secret': true }, 0, 'en');
    assert.doesNotMatch(key, /secret/);
    assert.match(key, /redacted/i);
  });
});

describe('formatToolInvocationLine', () => {
  it('names a Bash call by its command', () => {
    const line = formatToolInvocationLine(
      { toolName: 'Bash', args: { command: 'git status --porcelain' } },
      'en',
    );
    assert.equal(line, 'git status --porcelain');
  });

  it('names a GoalSet call by its condition', () => {
    const line = formatToolInvocationLine(
      { toolName: 'GoalSet', args: { condition: 'all tests in packages/runtime pass' } },
      'en',
    );
    assert.equal(line, 'all tests in packages/runtime pass');
  });

  it('names an AskUserQuestion call by its first question with a count suffix', () => {
    const line = formatToolInvocationLine(
      {
        toolName: 'AskUserQuestion',
        args: {
          questions: [
            { question: '选哪个方案?', options: [{ label: 'A' }, { label: 'B' }] },
            { question: '继续吗?', options: [{ label: '是' }, { label: '否' }] },
          ],
        },
      },
      'zh-CN',
    );
    assert.equal(line, '选哪个方案? 等 2 问');
    assert.equal(
      formatToolInvocationLine(
        {
          toolName: 'AskUserQuestion',
          args: { questions: [{ question: '選哪個方案？' }, { question: '繼續嗎？' }] },
        },
        'zh-TW',
      ),
      '選哪個方案？ 等 2 問',
    );
  });

  it('keeps the ScheduledTask title headline', () => {
    const line = formatToolInvocationLine(
      {
        toolName: 'ScheduledTask',
        args: { title: '每天 9:00 生成日报', schedule: { kind: 'cron' } },
      },
      'zh-CN',
    );
    assert.equal(line, '每天 9:00 生成日报');
  });
});

describe('projectToolArgsPreview', () => {
  it('keeps only the formatter-readable fields, shaped like the args', () => {
    const preview = projectToolArgsPreview('Write', {
      path: 'packages/ui/src/tool-activity.tsx',
      content: 'a very large file body that must never reach the wire',
    });
    assert.deepEqual(preview, { path: 'packages/ui/src/tool-activity.tsx' });
  });

  // The allowlist is the only way an argument reaches a live row, so a tool
  // whose fields are not on it shows its bare name for as long as it runs.
  // Both of these went unnoticed until the row started appearing while the
  // arguments were still being written.
  it('names the task a Task call is about, in either spelling', () => {
    assert.deepEqual(projectToolArgsPreview('TaskGet', { taskId: '3' }), { taskId: '3' });
    assert.deepEqual(projectToolArgsPreview('Read', { ref: 'r', task_id: '7' }), {
      ref: 'r',
      task_id: '7',
    });
  });

  it('names the skill a Skill call runs, and not the payload beside it', () => {
    assert.deepEqual(
      projectToolArgsPreview('Skill', { skill: 'code-review', args: 'high --secret sk-abc' }),
      { skill: 'code-review' },
    );
  });

  it('redacts secrets embedded in command strings', () => {
    const preview = projectToolArgsPreview('Bash', {
      command: 'curl -H "Authorization: Bearer super-secret-token-value" https://example.com',
    });
    const serialized = JSON.stringify(preview);
    assert.doesNotMatch(serialized, /super-secret-token-value/);
    assert.match(serialized, /redacted/i);
  });

  it('drops sensitive keys entirely', () => {
    const preview = projectToolArgsPreview('SomeTool', {
      title: 'hello',
      password: 'hunter2',
      api_key: 'abcdef',
    });
    assert.deepEqual(preview, { title: 'hello' });
  });

  it('does not put generic input payloads on the live wire', () => {
    assert.equal(
      projectToolArgsPreview('third_party_tool', {
        input: 'short private body',
        inputPreview: { text: 'forged private body', bytes: 19, truncated: false },
        size: { cols: 80, rows: 24 },
      }),
      undefined,
    );
  });

  it('names deep research starts from their bounded objective preview', () => {
    const preview = projectToolArgsPreview('DeepResearchStart', {
      objective: 'Inspect the runtime host boundary',
      scope_level: 'standard',
      artifact_content: 'must not reach the live wire',
    });
    assert.deepEqual(preview, {
      objective: 'Inspect the runtime host boundary',
      scope_level: 'standard',
    });
    assert.equal(
      formatToolInvocationLine({ toolName: 'DeepResearchStart', args: preview }, 'en'),
      'Inspect the runtime host boundary (standard)',
    );
  });

  it('bounds long values and whole-preview size', () => {
    const preview = projectToolArgsPreview('Bash', { command: 'x'.repeat(5000) });
    const command = (preview as { command: string }).command;
    assert.ok(command.length <= 240, `expected <=240 chars, got ${command.length}`);
    assert.ok(command.endsWith('…'));
    assert.ok(JSON.stringify(preview).length <= 2048);
  });

  it('lets Bash and Agent say what they are for, and no other tool', () => {
    assert.deepEqual(
      projectToolArgsPreview('Bash', { command: 'npm test', description: 'Run the unit tests' }),
      { command: 'npm test', description: 'Run the unit tests' },
    );
    assert.deepEqual(
      projectToolArgsPreview('Agent', { prompt: 'long brief', description: 'Survey the tests' }),
      { description: 'Survey the tests' },
    );
    assert.equal(
      (
        projectToolArgsPreview('mcp__notes__save', { title: 't', description: 'private body' }) as
          | Record<string, unknown>
          | undefined
      )?.description,
      undefined,
    );
  });

  it('never previews an uncommitted task write as current state', () => {
    assert.equal(
      projectToolArgsPreview('TaskCreate', { subject: 'one', description: 'the first task' }),
      undefined,
    );
    assert.equal(
      projectToolArgsPreview('TaskUpdate', { taskId: '1', status: 'completed' }),
      undefined,
    );
  });

  it('does not accept forged question payloads from third-party tools', () => {
    assert.equal(
      projectToolArgsPreview('third_party_tool', {
        questions: [{ question: 'private body' }],
      }),
      undefined,
    );
  });

  it('preserves the TaskInput projected inputPreview shape', () => {
    const projected = projectToolActivityArgs('TaskInput', {
      ref: 'maka://runtime/background-tasks/1',
      input: 'ls -la\n',
      size: { cols: 80, rows: 24 },
    });
    const preview = projectToolArgsPreview('TaskInput', projected);
    const line = formatToolInvocationLine({ toolName: 'TaskInput', args: preview }, 'zh-CN');
    assert.ok(line !== undefined);
    assert.match(line, /后台终端交互/);
    assert.match(line, /80x24/);
  });

  it('returns undefined when nothing displayable exists', () => {
    assert.equal(projectToolArgsPreview('Bash', {}), undefined);
    assert.equal(projectToolArgsPreview('Bash', undefined), undefined);
    assert.equal(projectToolArgsPreview('Bash', { content: 'not a headline field' }), undefined);
  });
});

describe('formatToolInvocationLine — a wrapped call', () => {
  const line = (args: unknown, toolName = 'ToolSearch') =>
    formatToolInvocationLine({ toolName, args }, 'en');

  it('reads the query out of a provider search envelope', () => {
    // Declared as a provider's own search connector, the call arrives as
    // `{ arguments: {...}, call_id }`. The wrapper stays in the durable record
    // — replay reads the id back out of it — so the row unwraps it instead.
    assert.equal(
      line({ arguments: { query: 'select:BrowserClick', max_results: 1 }, call_id: 'call_x' }),
      'select:BrowserClick',
    );
  });

  it('still reads a bare call, which is what every other wire sends', () => {
    assert.equal(line({ query: 'list scheduled tasks' }), 'list scheduled tasks');
  });

  it('no other tool is unwrapped: `arguments` is an ordinary name', () => {
    assert.equal(line({ arguments: { query: 'nested' }, query: 'own' }, 'Grep'), 'own');
  });
});
