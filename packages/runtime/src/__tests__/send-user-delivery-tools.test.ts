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
import { describe, test } from 'node:test';
import type { ArtifactRecord } from '@maka/core/artifacts';
import { decodeCanonicalToolResultContent } from '@maka/core/tool-result-record-schema';
import { TOOL_NAMES } from '@maka/core/tool-names';

import type {
  FilesystemExecuteInput,
  FilesystemExecutor,
  FilesystemResult,
} from '../filesystem-executor.js';
import { FilesystemWorkerClientError } from '../filesystem-worker/client.js';
import { sandboxErrorMetadata } from '../sandbox/errors.js';
import {
  buildSendUserFileTool,
  SEND_USER_FILE_DESCRIPTION,
  SEND_USER_FILE_UNAVAILABLE,
  sendUserFileModelText,
} from '../send-user-file-tool.js';
import {
  buildSendUserMessageTool,
  SEND_USER_MESSAGE_DELIVERED,
  SEND_USER_MESSAGE_DESCRIPTION,
} from '../send-user-message-tool.js';
import type { MakaToolContext } from '../tool-runtime.js';
import type { ToolArtifactCandidate } from '../tool-artifacts.js';

const CWD = '/workspace/maka';

describe('SendUserFile', () => {
  test('resolves relative paths from the session cwd through the filesystem authority', async () => {
    const reads: FilesystemExecuteInput[] = [];
    const recorded: ToolArtifactCandidate[][] = [];
    const tool = buildSendUserFileTool({ filesystem: fakeFilesystem(reads) });

    const result = await tool.impl(
      {
        files: ['out/report.md', '/elsewhere/chart.png'],
        status: 'proactive',
        caption: '  The report and its chart.  ',
      },
      recordingContext(recorded),
    );

    assert.deepEqual(
      reads.map((read) => read.operation),
      [
        { kind: 'read', path: 'out/report.md', limit: 1 },
        { kind: 'read', path: '/elsewhere/chart.png', limit: 1 },
      ],
    );
    assert.deepEqual(
      reads.map((read) => read.cwd),
      [CWD, CWD],
    );
    assert.deepEqual(recorded[0], [
      {
        kind: 'file',
        name: 'report.md',
        mimeType: 'text/markdown',
        source: 'user_delivery',
        summary: 'The report and its chart.',
        sourcePath: `${CWD}/out/report.md`,
      },
      {
        kind: 'image',
        name: 'chart.png',
        mimeType: 'image/png',
        source: 'user_delivery',
        summary: 'The report and its chart.',
        sourcePath: '/elsewhere/chart.png',
      },
    ]);
    assert.deepEqual(result, {
      kind: 'user_file_delivery',
      status: 'proactive',
      caption: 'The report and its chart.',
      display: 'render',
      files: [
        {
          artifactId: 'artifact-report.md',
          name: 'report.md',
          path: `${CWD}/out/report.md`,
          kind: 'file',
          mimeType: 'text/markdown',
          sizeBytes: 9,
        },
        {
          artifactId: 'artifact-chart.png',
          name: 'chart.png',
          path: '/elsewhere/chart.png',
          kind: 'image',
          mimeType: 'image/png',
          sizeBytes: 9,
        },
      ],
    });
    // The durable event has to survive the canonical validator unchanged.
    assert.deepEqual(decodeCanonicalToolResultContent(result), result);
  });

  test('an unset display is decided by file type, as the reference has it', async () => {
    const tool = buildSendUserFileTool({ filesystem: fakeFilesystem([]) });

    // "Leave it unset to let the client decide by file type" — a listing is
    // not worth taking the pane for, so plain text attaches.
    const text = await tool.impl({ files: ['notes.txt'], status: 'normal' }, recordingContext([]));
    assert.equal(text.display, 'attach');
    assert.equal(Object.hasOwn(text, 'caption'), false);
    assert.equal(text.files[0]?.kind, 'file');

    // The kinds the pane draws take it: an image, a page, a PDF, and the text
    // kinds it renders rather than lists.
    for (const file of ['shot.png', 'page.html', 'paper.pdf', 'notes.md', 'flow.mermaid']) {
      const result = await tool.impl({ files: [file], status: 'normal' }, recordingContext([]));
      assert.equal(result.display, 'render', file);
    }

    // An explicit choice is never second-guessed.
    const forced = await tool.impl(
      { files: ['shot.png'], status: 'normal', display: 'attach' },
      recordingContext([]),
    );
    assert.equal(forced.display, 'attach');
  });

  test('derives the artifact kind from the extension', async () => {
    for (const [file, kind] of [
      ['a.pdf', 'pdf'],
      ['a.html', 'html'],
      ['a.patch', 'diff'],
      ['a.webp', 'image'],
      ['a.tar.gz', 'file'],
    ] as const) {
      const recorded: ToolArtifactCandidate[][] = [];
      const tool = buildSendUserFileTool({ filesystem: fakeFilesystem([]) });
      await tool.impl({ files: [file], status: 'normal' }, recordingContext(recorded));
      assert.equal(recorded[0]?.[0]?.kind, kind, file);
    }
  });

  test('fails the whole call and names the file when a path cannot be opened', async () => {
    const recorded: ToolArtifactCandidate[][] = [];
    const tool = buildSendUserFileTool({
      filesystem: {
        execute: async (input) => {
          if (input.operation.path.endsWith('missing.md')) {
            throw new Error('File not found: /workspace/maka/missing.md');
          }
          return { kind: 'read', content: '' } satisfies FilesystemResult;
        },
      },
    });

    await assert.rejects(
      async () =>
        await tool.impl(
          { files: ['ok.md', 'missing.md'], status: 'normal' },
          recordingContext(recorded),
        ),
      (error: unknown) => {
        assert.match(
          String((error as Error).message),
          /SendUserFile could not deliver missing\.md/,
        );
        assert.match(String((error as Error).message), /File not found/);
        return true;
      },
    );
    // Nothing may be recorded when any file in the batch is refused.
    assert.equal(recorded.length, 0);
  });

  test('refuses a directory with the reason the filesystem gave', async () => {
    const tool = buildSendUserFileTool({
      filesystem: {
        execute: async () => {
          throw new Error('EISDIR: illegal operation on a directory');
        },
      },
    });

    await assert.rejects(
      async () => await tool.impl({ files: ['docs'], status: 'normal' }, recordingContext([])),
      /SendUserFile could not deliver docs: EISDIR/,
    );
  });

  test('keeps sandbox_boundary_required and its expansion on a boundary refusal', async () => {
    const requiredExpansion = {
      filesystem: {
        entries: [
          { path: '/outside/secret.pdf', access: 'read' as const, scope: 'exact' as const },
        ],
      },
    };
    const tool = buildSendUserFileTool({
      filesystem: {
        execute: async () => {
          throw new FilesystemWorkerClientError({
            reason: 'sandbox_boundary_required',
            stage: 'validation',
            recoverable: true,
            requiredExpansion,
          });
        },
      },
    });

    await assert.rejects(
      async () =>
        await tool.impl({ files: ['/outside/secret.pdf'], status: 'normal' }, recordingContext([])),
      (error: unknown) => {
        const metadata = sandboxErrorMetadata(error);
        assert.equal(metadata?.reason, 'sandbox_boundary_required');
        assert.equal(metadata?.domain, 'filesystem');
        assert.equal(metadata?.recoverable, true);
        assert.deepEqual(metadata?.requiredExpansion, requiredExpansion);
        assert.match(
          String((error as Error).message),
          /SendUserFile could not deliver \/outside\/secret\.pdf/,
        );
        return true;
      },
    );
  });

  test('names the files the Artifact store could not keep', async () => {
    const tool = buildSendUserFileTool({ filesystem: fakeFilesystem([]) });
    const context = toolContext({
      recordArtifacts: async (candidates) =>
        candidates.filter((candidate) => candidate.name !== 'huge.bin').map(artifactFor),
    });

    await assert.rejects(
      async () =>
        await tool.impl({ files: ['small.md', 'huge.bin', 'other.md'], status: 'normal' }, context),
      (error: unknown) => {
        assert.match(String((error as Error).message), /could not attach huge\.bin/);
        return true;
      },
    );
  });

  test('refuses to run on a surface with no artifact recorder', async () => {
    const tool = buildSendUserFileTool({ filesystem: fakeFilesystem([]) });

    await assert.rejects(
      async () => await tool.impl({ files: ['a.md'], status: 'normal' }, toolContext({})),
      new RegExp(SEND_USER_FILE_UNAVAILABLE.slice(0, 40)),
    );
  });

  test('tells the model how many files landed and which artifact each became', () => {
    assert.equal(
      sendUserFileModelText({
        kind: 'user_file_delivery',
        status: 'normal',
        display: 'render',
        files: [
          { artifactId: 'a1', name: 'r.md', path: '/w/r.md', kind: 'file', sizeBytes: 1 },
          { artifactId: 'a2', name: 'c.png', path: '/w/c.png', kind: 'image', sizeBytes: 2 },
        ],
      }),
      '2 files delivered to user.\n  /w/r.md → artifact id: a1\n  /w/c.png → artifact id: a2',
    );
    assert.equal(
      sendUserFileModelText({
        kind: 'user_file_delivery',
        status: 'normal',
        display: 'attach',
        files: [{ artifactId: 'a1', name: 'r.md', path: '/w/r.md', kind: 'file', sizeBytes: 1 }],
      }),
      '1 file delivered to user.\n  /w/r.md → artifact id: a1',
    );
  });

  test('carries the register the description promises', () => {
    const tool = buildSendUserFileTool({ filesystem: fakeFilesystem([]) });

    assert.equal(tool.name, TOOL_NAMES.sendUserFile);
    assert.equal(tool.description, SEND_USER_FILE_DESCRIPTION);
    // The reference's own sentences, which this description is ported from.
    assert.match(tool.description, /any file the user would want to see/u);
    assert.match(tool.description, /as they are produced, not batched at the end of the task/u);
    assert.match(tool.description, /Do NOT send routine working files/u);
    assert.match(tool.description, /a stream of cards for one file is noise/u);
    assert.match(tool.description, /Re-send a file only when it has meaningfully changed/u);
    assert.match(tool.description, /verify with ls first/u);
    // Batch delivery is atomic, and the description is the only place that
    // says so before the call is made.
    assert.match(tool.description, /fails the WHOLE call and names the file/u);
    // It must NOT promise that the card carries the caption: the transcript
    // draws no caption, the same as the reference.
    assert.doesNotMatch(tool.description, /carrying the caption/u);
  });
});

describe('SendUserMessage', () => {
  test('returns the message verbatim as a durable user_message result', async () => {
    const tool = buildSendUserMessageTool();
    const message = '`token = abc`\n\n- second line';

    const result = await tool.impl({ message }, toolContext({}));

    assert.deepEqual(result, { kind: 'user_message', message });
    assert.deepEqual(decodeCanonicalToolResultContent(result), result);
  });

  test('acknowledges delivery to the model without echoing the message back', () => {
    const tool = buildSendUserMessageTool();

    assert.deepEqual(
      tool.toModelOutput?.({
        toolCallId: 'call-1',
        input: { message: 'secret' },
        output: { kind: 'user_message', message: 'secret' },
      }),
      { type: 'text', value: SEND_USER_MESSAGE_DELIVERED },
    );
    assert.equal(SEND_USER_MESSAGE_DELIVERED, 'Message delivered to user.');
  });

  test('is idempotent, parallel-safe and described the way the reference is', () => {
    const tool = buildSendUserMessageTool();

    assert.equal(tool.name, TOOL_NAMES.sendUserMessage);
    assert.equal(tool.recoveryMode, 'idempotent');
    assert.equal(tool.executionSemantics, undefined);
    assert.equal(tool.description, SEND_USER_MESSAGE_DESCRIPTION);
    assert.match(tool.description, /read verbatim/);
    assert.match(tool.description, /between tool calls/);
    assert.match(tool.description, /not.*for your final answer|final answer/);
  });
});

function fakeFilesystem(reads: FilesystemExecuteInput[]): Pick<FilesystemExecutor, 'execute'> {
  return {
    execute: async (input) => {
      reads.push(input);
      return { kind: 'read', content: 'delivered' } satisfies FilesystemResult;
    },
  };
}

function recordingContext(recorded: ToolArtifactCandidate[][]): MakaToolContext {
  return toolContext({
    recordArtifacts: async (candidates) => {
      recorded.push([...candidates]);
      return candidates.map(artifactFor);
    },
  });
}

function artifactFor(candidate: ToolArtifactCandidate): ArtifactRecord {
  return {
    id: `artifact-${candidate.name}`,
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: 1,
    name: candidate.name,
    kind: candidate.kind,
    sizeBytes: 9,
    ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
    source: 'user_delivery',
    relativePath: `session-1/${candidate.name}`,
  };
}

function toolContext(overrides: Partial<MakaToolContext>): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    cwd: CWD,
    toolCallId: 'call-1',
    abortSignal: new AbortController().signal,
    emitOutput: () => undefined,
    ...overrides,
  };
}
