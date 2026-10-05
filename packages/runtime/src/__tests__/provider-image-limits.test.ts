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
import type { ModelMessage } from '../model-protocol.js';
import {
  deferredImagePart,
  deferredToolResultImagePart,
  dropDeferredImages,
  limitProviderRequestImages,
  providerImageRemovedMessage,
  providerImageRequestLimits,
  providerImageTooLargeMessage,
  providerImageWindowStart,
  resolveDeferredImages,
} from '../provider-image-limits.js';

const userImage = (bytes: number): ModelMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: 'look' },
    { type: 'file', data: { type: 'data', data: new Uint8Array(bytes) }, mediaType: 'image/png' },
  ],
});

const toolImage = (callId: string, bytes: number): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: callId,
      toolName: 'Read',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'Image read successfully.' },
          {
            type: 'file',
            data: { type: 'data', data: Buffer.alloc(bytes).toString('base64') },
            mediaType: 'image/png',
          },
        ],
      },
    },
  ],
});

function imageCount(messages: readonly ModelMessage[]): number {
  return (JSON.stringify(messages).match(/"mediaType":"image\/png"/g) ?? []).length;
}

function noteCount(messages: readonly ModelMessage[]): number {
  return messages
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as unknown[]) : []))
    .flatMap((part: any) =>
      part.type === 'tool-result' && part.output.type === 'content' ? part.output.value : [part],
    )
    .filter((part: any) => part.type === 'text' && /^\[An image was removed/.test(part.text))
    .length;
}

const deferredToolImage = (
  callId: string,
  bytes: number,
  mediaType = 'image/png',
): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: callId,
      toolName: 'Read',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'Image read successfully.' },
          deferredToolResultImagePart(
            { kind: 'session_file', sessionId: 'session-1', relativePath: callId },
            mediaType,
            bytes,
          ),
        ],
      },
    },
  ],
});

const attachmentMessage = (name: string, bytes: number): ModelMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: name },
    deferredImagePart({
      kind: 'image',
      name,
      mimeType: 'image/png',
      bytes,
      ref: { kind: 'session_file', sessionId: 'session-1', relativePath: name },
    }),
  ],
});

/** A user message carrying stored attachments of these sizes. */
const attachmentsMessage = (name: string, sizes: readonly number[]): ModelMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: name },
    ...sizes.map((bytes, index) =>
      deferredImagePart({
        kind: 'image',
        name: `${name}-${index}`,
        mimeType: 'image/png',
        bytes,
        ref: { kind: 'session_file', sessionId: 'session-1', relativePath: `${name}-${index}` },
      }),
    ),
  ],
});

/** One tool result carrying `count` stored images. */
const toolImages = (
  callId: string,
  count: number,
  sizes: (count: number) => number[] = (n) => new Array<number>(n).fill(1),
): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: callId,
      toolName: 'Read',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'Images read.' },
          ...sizes(count).map((bytes, index) =>
            deferredToolResultImagePart(
              { kind: 'session_file', sessionId: 'session-1', relativePath: `${callId}-${index}` },
              'image/png',
              bytes,
            ),
          ),
        ],
      },
    },
  ],
});

/** The recorded sizes of the stored images still in the messages, in order. */
function imageSizes(messages: readonly ModelMessage[]): number[] {
  return [
    ...JSON.stringify(messages).matchAll(
      /"type":"deferred","source":"[a-z_]+","ref":\{[^}]*\},"bytes":(\d+)/g,
    ),
  ].map((match) => Number(match[1]));
}

describe('provider image limits', () => {
  test('a request under both limits keeps every image', () => {
    assert.equal(providerImageWindowStart([1, 1, 1, 1], { maxImages: 4, maxBytes: 100 }), 0);
  });

  test('passing the count limit drops the oldest images down to half of it', () => {
    // The fifth image passes four; what is left must fit two.
    assert.equal(providerImageWindowStart([1, 1, 1, 1, 1], { maxImages: 4, maxBytes: 100 }), 3);
  });

  test('passing the byte limit drops the oldest images down to half of it', () => {
    // 10 + 10 + 10 passes 25; what is left must fit 12.5.
    assert.equal(providerImageWindowStart([10, 10, 10], { maxImages: 100, maxBytes: 25 }), 2);
    // Small images ahead of a large one go as a batch until the rest fits half.
    assert.equal(
      providerImageWindowStart([2, 2, 2, 2, 10, 4], { maxImages: 100, maxBytes: 20 }),
      5,
    );
  });

  test('after a batch the next images go out without another drop until a limit is passed again', () => {
    const limits = { maxImages: 4, maxBytes: 100 };
    const starts = Array.from({ length: 10 }, (_, index) =>
      providerImageWindowStart(new Array<number>(index + 1).fill(1), limits),
    );
    // Five images drop three; the sixth and seventh fit; the eighth drops again.
    assert.deepEqual(starts, [0, 0, 0, 0, 3, 3, 3, 6, 6, 6]);
  });

  test('the newest image is always kept, even past half of a limit on its own', () => {
    assert.equal(providerImageWindowStart([5, 6, 30], { maxImages: 100, maxBytes: 40 }), 2);
    assert.equal(providerImageWindowStart([1, 1, 1], { maxImages: 1, maxBytes: 100 }), 2);
  });

  test('images just added are not dropped to make room while they fit on their own', () => {
    const limits = { maxImages: 100, maxBytes: 12 };
    // The newest three keep together; the batch alone would keep one of them.
    assert.equal(providerImageWindowStart([3, 3.4, 3.4, 3.4], limits), 3);
    assert.equal(providerImageWindowStart([3, 3.4, 3.4, 3.4], limits, [1]), 1);
    // When everything fits, nothing is dropped.
    assert.equal(providerImageWindowStart([1, 1, 3, 3], limits, [2]), 0);
    // Past the limits on their own, they are dropped as a batch like any others.
    assert.equal(providerImageWindowStart([3, 5, 5, 5], limits, [1]), 2);
    // The first index whose images fit is the one kept from: here the later one.
    assert.equal(providerImageWindowStart([3, 5, 5, 5, 5], limits), 4);
    assert.equal(providerImageWindowStart([3, 5, 5, 5, 5], limits, [1, 3]), 3);
  });

  test("a user's new attachments keep together past an older image", () => {
    const megabyte = 1024 * 1024;
    const limits = providerImageRequestLimits({});
    const messages = [
      attachmentMessage('old', 3 * megabyte),
      { role: 'assistant', content: 'ok' } as ModelMessage,
      attachmentsMessage('now', [3.4 * megabyte, 3.4 * megabyte, 3.4 * megabyte]),
    ];
    const limited = limitProviderRequestImages(messages, limits);
    assert.equal(limited.removedImages, 1);
    assert.equal(noteCount([limited.messages[0]!]), 1);
    assert.equal(limited.messages[2], messages[2]);
  });

  test('images one tool result adds keep together while they fit, and go as a batch past that', () => {
    const limits = { maxImages: 10, maxBytes: 1_000 };
    const step = (images: number): ModelMessage[] => [
      attachmentsMessage('look', [1, 1, 1, 1]),
      { role: 'assistant', content: 'reading' } as ModelMessage,
      toolImages('call-1', images),
    ];
    // Eight new images after four: the user's four go, the tool's eight stay,
    // where the batch alone would keep only six of them.
    assert.equal(providerImageWindowStart(new Array<number>(12).fill(1), limits), 6);
    const messages = step(8);
    const fits = limitProviderRequestImages(messages, limits);
    assert.equal(fits.removedImages, 4);
    assert.equal(fits.messages[2], messages[2]);
    assert.equal(imageCount([fits.messages[2]!]), 8);
    // Twelve do not fit on their own: dropped as before, to half the limit.
    const batch = limitProviderRequestImages(step(12), limits);
    assert.equal(batch.removedImages, 6);
    assert.equal(imageCount(batch.messages), 10);
  });

  test('across requests the start never moves back, and limiting a limited request removes nothing', () => {
    const limits = { maxImages: 10, maxBytes: 100 };
    // mulberry32: the same sequence on every run.
    let seed = 7;
    const random = (below: number): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) % below;
    };
    const sizes = (count: number) => Array.from({ length: count }, () => 1 + random(40));
    let requests = 0;
    let removals = 0;
    for (let session = 0; session < 40; session++) {
      const history: ModelMessage[] = [];
      let previous = 0;
      const request = () => {
        const limited = limitProviderRequestImages(history, limits);
        requests += 1;
        if (limited.removedImages > previous) removals += 1;
        assert.ok(limited.removedImages >= previous, `${limited.removedImages} < ${previous}`);
        previous = limited.removedImages;
        assert.equal(limitProviderRequestImages(limited.messages, limits).removedImages, 0);
        const kept = imageSizes(limited.messages);
        assert.ok(
          kept.length === 1 ||
            (kept.length <= limits.maxImages &&
              kept.reduce((total, size) => total + size, 0) <= limits.maxBytes),
          JSON.stringify(kept),
        );
      };
      for (let turn = 0; turn < 6; turn++) {
        history.push(attachmentsMessage(`turn-${turn}`, sizes(random(4))));
        request();
        for (let stepIndex = random(4); stepIndex > 0; stepIndex--) {
          history.push({ role: 'assistant', content: 'working' } as ModelMessage);
          history.push(toolImages(`call-${turn}-${stepIndex}`, random(6), sizes));
          request();
        }
        history.push({ role: 'assistant', content: 'done' } as ModelMessage);
      }
    }
    // The sessions do pass the limits, many times over.
    assert.ok(requests > 400 && removals > 100, `${requests} requests, ${removals} removals`);
  });

  test('removed images become one note each in the message that held them', () => {
    const messages = [userImage(10), toolImage('call-1', 10), toolImage('call-2', 10)];
    const limited = limitProviderRequestImages(messages, { maxImages: 100, maxBytes: 25 });

    assert.equal(limited.removedImages, 2);
    assert.equal(imageCount(limited.messages), 1);
    assert.equal(noteCount(limited.messages), 2);
    // The user's own text and the tool's text stay where they were.
    assert.deepEqual((limited.messages[0]!.content as any[])[0], { type: 'text', text: 'look' });
    assert.equal(
      (limited.messages[1]!.content as any[])[0].output.value[0].text,
      'Image read successfully.',
    );
    // The newest image is the one that went out, untouched.
    assert.equal(limited.messages[2], messages[2]);
  });

  test('a base64 tool image is measured by its decoded size', () => {
    const messages = [toolImage('call-1', 10), toolImage('call-2', 10)];
    assert.equal(
      limitProviderRequestImages(messages, { maxImages: 100, maxBytes: 20 }).removedImages,
      0,
    );
    assert.equal(
      limitProviderRequestImages(messages, { maxImages: 100, maxBytes: 19 }).removedImages,
      1,
    );
  });

  test('consecutive requests share an identical prefix until the next batch is dropped', () => {
    const limits = { maxImages: 4, maxBytes: 100 };
    const history: ModelMessage[] = [{ role: 'user', content: 'start' }];
    const requests: ModelMessage[][] = [];
    for (let index = 0; index < 8; index += 1) {
      history.push(toolImage(`call-${index}`, 1));
      requests.push(limitProviderRequestImages(history, limits).messages);
    }
    const extends_ = (previous: ModelMessage[], next: ModelMessage[]) =>
      JSON.stringify(next.slice(0, previous.length)) === JSON.stringify(previous);
    // Requests 1–4 only append; the fifth drops a batch; 6 and 7 append to it;
    // the eighth drops the next batch.
    assert.deepEqual(
      requests.slice(1).map((request, index) => extends_(requests[index]!, request)),
      [true, true, true, false, true, true, false],
    );
    assert.deepEqual(
      requests.map((request) => imageCount(request)),
      [1, 2, 3, 4, 2, 3, 4, 2],
    );
  });

  test('a request without a removed image comes back as the same messages', () => {
    const messages = [userImage(1), { role: 'assistant', content: 'ok' } as ModelMessage];
    const limited = limitProviderRequestImages(messages, { maxImages: 4, maxBytes: 100 });
    assert.equal(limited.removedImages, 0);
    assert.equal(limited.messages[0], messages[0]);
    assert.equal(limited.messages[1], messages[1]);
  });

  test('every model and wire gets the same limits unless a caller sets them', () => {
    assert.deepEqual(providerImageRequestLimits({}), {
      maxImages: 100,
      maxBytes: 12 * 1024 * 1024,
    });
    assert.deepEqual(providerImageRequestLimits({ maxImages: 4, maxBytes: 25 }), {
      maxImages: 4,
      maxBytes: 25,
    });
  });

  test('the notes name the limits in force', () => {
    assert.equal(
      providerImageRemovedMessage(providerImageRequestLimits({})),
      '[An image was removed to keep this request within its image limits (100 images, 12MB in total); older images are removed first.]',
    );
    assert.equal(
      providerImageRemovedMessage({ maxImages: 4, maxBytes: 25 }),
      '[An image was removed to keep this request within its image limits (4 images, 25 bytes in total); older images are removed first.]',
    );
    assert.match(providerImageTooLargeMessage({ maxImages: 4, maxBytes: 1536 }), /the 1\.5KB of/);
  });

  test('a deferred attachment is measured by its recorded size and read only when sent', async () => {
    const messages = [
      attachmentMessage('one', 10),
      attachmentMessage('two', 10),
      attachmentMessage('three', 10),
    ];
    const limited = limitProviderRequestImages(messages, { maxImages: 100, maxBytes: 25 });
    assert.equal(limited.removedImages, 2);

    const reads: string[] = [];
    const resolved = await resolveDeferredImages(limited.messages, async (image, mediaType) => {
      reads.push(image.source === 'attachment' ? image.name : 'tool');
      return { type: 'file', data: { type: 'data', data: new Uint8Array(image.bytes) }, mediaType };
    });
    assert.deepEqual(reads, ['three']);
    assert.equal(noteCount(resolved), 2);
    assert.equal(imageCount(resolved), 1);
    assert.equal(JSON.stringify(resolved).includes('"deferred"'), false);
  });
  test('a deferred tool image is chosen by its recorded size and read only when sent', async () => {
    const messages = [
      deferredToolImage('call-1', 10),
      deferredToolImage('call-2', 10),
      deferredToolImage('call-3', 10),
    ];
    const limited = limitProviderRequestImages(messages, { maxImages: 100, maxBytes: 25 });
    assert.equal(limited.removedImages, 2);

    const reads: string[] = [];
    const resolved = await resolveDeferredImages(limited.messages, async (image, mediaType) => {
      reads.push(image.ref.kind === 'session_file' ? image.ref.relativePath : '');
      assert.equal(image.source, 'tool_result');
      return { type: 'file', data: { type: 'data', data: 'AAAA' }, mediaType };
    });
    assert.deepEqual(reads, ['call-3']);
    assert.equal(noteCount(resolved), 2);
    const sent = (resolved[2]!.content as any[])[0].output.value[1];
    assert.deepEqual(sent, {
      type: 'file',
      data: { type: 'data', data: 'AAAA' },
      mediaType: 'image/png',
    });
    assert.equal(JSON.stringify(resolved).includes('"deferred"'), false);
  });

  test('a deferred image counts and resolves whatever its media type says', async () => {
    // Deciding by the media type would leave this one deferred, and the
    // placeholder would be sent as it is.
    const messages = [
      attachmentMessage('one', 10),
      deferredToolImage('call-1', 10, 'application/octet-stream'),
    ];
    const limited = limitProviderRequestImages(messages, { maxImages: 1, maxBytes: 100 });
    assert.equal(limited.removedImages, 1);

    const reads: string[] = [];
    const resolved = await resolveDeferredImages(messages, async (image, mediaType) => {
      reads.push(image.source);
      return { type: 'text', text: `read ${mediaType}` };
    });
    assert.deepEqual(reads, ['attachment', 'tool_result']);
    assert.equal(JSON.stringify(resolved).includes('"deferred"'), false);
    assert.match(JSON.stringify(resolved), /read application\/octet-stream/);
  });

  test('a deferred image never resolved goes out as the note, not as its placeholder', () => {
    const messages = [attachmentMessage('one', 10), deferredToolImage('call-1', 10), userImage(1)];
    const dropped = dropDeferredImages(messages, 'NOTE');

    assert.equal(JSON.stringify(dropped).includes('"deferred"'), false);
    assert.deepEqual((dropped[0]!.content as any[])[1], { type: 'text', text: 'NOTE' });
    assert.deepEqual((dropped[1]!.content as any[])[0].output.value[1], {
      type: 'text',
      text: 'NOTE',
    });
    // An image already read is left as it is.
    assert.equal(dropped[2], messages[2]);
  });
});
