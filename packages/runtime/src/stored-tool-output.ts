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

import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { formatAttachmentResourceRef } from '@maka/core/attachments';
import type { TerminalSavedOutput, ToolResultContent } from '@maka/core/events';
import type { ProducedTerminalResult } from './bash-output-limits.js';
import type { MakaToolContext } from './tool-runtime.js';
import { TOOL_RESULT_FILE_MAX_BYTES, truncateUtf8 } from './tool-result-file.js';

/** Read an already admitted producer file, with a bounded, consistent snapshot. */
export async function readOutputSnapshot(
  path: string,
  maxBytes = TOOL_RESULT_FILE_MAX_BYTES,
): Promise<Uint8Array> {
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes))
      throw new Error('Saved output is not a bounded regular file');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      offset !== bytes.length ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error('Saved output changed while taking its snapshot');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function storeToolOutput(
  context: Pick<MakaToolContext, 'sessionId' | 'recordArtifacts'>,
  text: string,
  name = 'tool-output.txt',
): Promise<TerminalSavedOutput> {
  if (!context.recordArtifacts) throw new Error('Saved output storage is unavailable');
  const kept = truncateUtf8(text, TOOL_RESULT_FILE_MAX_BYTES);
  const records = await context.recordArtifacts([
    {
      name,
      kind: 'file',
      source: 'saved_tool_output',
      mimeType: 'text/plain; charset=utf-8',
      content: kept,
    },
  ]);
  if (records.length !== 1 || records[0]!.sessionId !== context.sessionId)
    throw new Error('Saved output publication did not return its resource');
  return {
    ref: formatAttachmentResourceRef({
      kind: 'session_file',
      sessionId: context.sessionId,
      relativePath: records[0]!.id,
    })!,
    chars: kept.length,
    truncated: kept.length < text.length,
  };
}

/** Consume private producer state; no path-bearing intermediate result can reach the ledger. */
export async function storeTerminalOutput(
  result: ProducedTerminalResult | Extract<ToolResultContent, { kind: 'shell_run' }>,
  context: MakaToolContext,
): Promise<Extract<ToolResultContent, { kind: 'terminal' | 'shell_run' }>> {
  if (result.kind !== 'terminal') return result;
  const { outputSpool, ...preview } = result;
  if (!outputSpool) return preview;
  try {
    if (!context.recordArtifacts) return preview;
    const bytes = await readOutputSnapshot(outputSpool.path);
    const saved = await storeToolOutput(
      context,
      Buffer.from(bytes).toString('utf8'),
      basename(outputSpool.path),
    );
    return {
      ...preview,
      savedOutput: { ...saved, truncated: saved.truncated || outputSpool.truncated },
    };
  } catch {
    // Execution already finished. A publication failure must not invite re-executing the command.
    return preview;
  } finally {
    await unlink(outputSpool.path).catch(() => undefined);
  }
}
