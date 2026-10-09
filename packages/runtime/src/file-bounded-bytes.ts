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
import { open, stat } from 'node:fs/promises';
import { MAX_ATTACHMENT_BYTES } from '@maka/core/attachments';

export class BoundedFileReadError extends Error {}

/** Read an already authorised canonical path, without decoding or truncating its bytes. */
export async function readBoundedFileBytes(
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_ATTACHMENT_BYTES) {
    throw new BoundedFileReadError('Invalid file byte limit');
  }
  signal?.throwIfAborted();
  const before = await stat(path, { bigint: true });
  if (!before.isFile())
    throw new BoundedFileReadError(`Attachment "${path}" is not a regular file.`);
  if (before.size > BigInt(maxBytes)) {
    throw new BoundedFileReadError(`Attachment "${path}" exceeds the ${maxBytes}-byte size limit.`);
  }
  const flags =
    constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await open(path, flags);
  const changed = () =>
    new BoundedFileReadError(`Attachment "${path}" changed while being read; retry delivery.`);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeNs !== before.mtimeNs ||
      opened.ctimeNs !== before.ctimeNs
    )
      throw changed();
    // One extra byte detects growth; a shrinking or rewritten file is refused too.
    const bytes = Buffer.allocUnsafe(Number(opened.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const read = await handle.read(
        bytes,
        offset,
        Math.min(1024 * 1024, bytes.length - offset),
        offset,
      );
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    signal?.throwIfAborted();
    const [after, current] = await Promise.all([
      handle.stat({ bigint: true }),
      stat(path, { bigint: true }),
    ]);
    if (
      offset !== Number(opened.size) ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw changed();
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
