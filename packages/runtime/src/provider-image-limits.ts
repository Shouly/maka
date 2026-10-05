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

import {
  MAX_PROVIDER_IMAGE_REQUEST_BYTES,
  MAX_PROVIDER_IMAGE_REQUEST_COUNT,
} from '@maka/core/attachments';
import type { AttachmentRef, StorageRef } from '@maka/core/events';
import { steeringEventIdOf } from './model-history.js';
import type {
  FileData,
  FilePart,
  ModelMessage,
  TextPart,
  ToolResultContentPart,
} from './model-protocol.js';

/** What one provider request may carry in images. */
export interface ProviderImageRequestLimits {
  readonly maxImages: number;
  readonly maxBytes: number;
}

export function providerImageRequestLimits(input: {
  maxImages?: number;
  maxBytes?: number;
}): ProviderImageRequestLimits {
  return {
    maxImages: input.maxImages ?? MAX_PROVIDER_IMAGE_REQUEST_COUNT,
    maxBytes: input.maxBytes ?? MAX_PROVIDER_IMAGE_REQUEST_BYTES,
  };
}

/** A byte count as the model reads it: whole megabytes where it can be. */
function formatImageBytes(bytes: number): string {
  const units: Array<[number, string]> = [
    [1024 * 1024, 'MB'],
    [1024, 'KB'],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) return `${Number((bytes / size).toFixed(1))}${unit}`;
  }
  return `${bytes} bytes`;
}

/** Stands in for an image a request no longer carries. */
export function providerImageRemovedMessage(limits: ProviderImageRequestLimits): string {
  return `[An image was removed to keep this request within its image limits (${limits.maxImages} images, ${formatImageBytes(limits.maxBytes)} in total); older images are removed first.]`;
}

/** Stands in for an image read by a tool that is too large for any request on its own. */
export function providerImageTooLargeMessage(limits: ProviderImageRequestLimits): string {
  return `Image was read, but it is larger than the ${formatImageBytes(limits.maxBytes)} of images one request can carry, so it was not sent. Downscale it and read it again.`;
}

/** Stands in for an image attachment that is too large for any request on its own. */
export function providerImageAttachmentTooLargeMessage(
  name: string,
  limits: ProviderImageRequestLimits,
): string {
  return `Image attachment "${name}" was not sent: it is larger than the ${formatImageBytes(limits.maxBytes)} of images one request can carry.`;
}

/**
 * A stored image whose bytes are not read yet: an attachment the user sent, or
 * an image a tool returned. The record that stored it gives its size, so a
 * request's images are chosen first and only the ones it sends are read. It
 * never reaches a provider: `resolveDeferredImages` reads or replaces every
 * one before the request goes out, and `dropDeferredImages` turns any left
 * into a note.
 */
export type DeferredImageData =
  | {
      readonly type: 'deferred';
      readonly source: 'attachment';
      readonly ref: StorageRef;
      readonly bytes: number;
      readonly name: string;
    }
  | {
      readonly type: 'deferred';
      readonly source: 'tool_result';
      readonly ref: StorageRef;
      readonly bytes: number;
    };

export function deferredImagePart(image: AttachmentRef): FilePart {
  const data: DeferredImageData = {
    type: 'deferred',
    source: 'attachment',
    ref: image.ref,
    bytes: image.bytes,
    name: image.name,
  };
  return { type: 'file', data: data as unknown as FilePart['data'], mediaType: image.mimeType };
}

/** An image a tool returned, deferred like an attachment by its stored size. */
export function deferredToolResultImagePart(
  ref: StorageRef,
  mediaType: string,
  bytes: number,
): Extract<ToolResultContentPart, { type: 'file' }> {
  const data: DeferredImageData = { type: 'deferred', source: 'tool_result', ref, bytes };
  return { type: 'file', data: data as unknown as FileData, mediaType };
}

/**
 * Index of the oldest image a request still carries, given the size of every
 * image it would carry, oldest first.
 *
 * Images are dropped in batches. Once the images from the current start would
 * pass either limit, the start moves forward until what is left fits within
 * half of each, so the next several images go out without dropping any more.
 * The newest image is always kept.
 *
 * Images just added are not dropped to make that room. `newImagesFrom` are the
 * indexes where they start, in order: those since the message that opened the
 * turn, and those since the model last answered. From the first of them whose
 * images fit within the limits on their own, the start goes no further: it
 * stops there, or where the images before it were already dropped to, or
 * where what is left fits half, whichever is first. When none fits, the
 * batch is dropped as before.
 *
 * Only the request decides the answer, so two requests that differ by images
 * appended at the end keep the same start until the next batch is dropped,
 * and the prefix they share stays identical; the start never moves back.
 */
export function providerImageWindowStart(
  sizes: readonly number[],
  limits: ProviderImageRequestLimits,
  newImagesFrom: readonly number[] = [],
): number {
  const start = batchWindowStart(sizes, limits);
  for (const from of newImagesFrom) {
    if (start <= from || from >= sizes.length) break;
    if (!suffixFits(sizes, from, limits.maxImages, limits.maxBytes)) continue;
    // Before `from`, what earlier batches dropped stays dropped.
    const dropped = batchWindowStart(sizes.slice(0, from), limits);
    const half = firstStartWithin(sizes, Math.floor(limits.maxImages / 2), limits.maxBytes / 2);
    return Math.min(from, Math.max(dropped, half));
  }
  return start;
}

/** The start as the batches leave it, nothing held back. */
function batchWindowStart(sizes: readonly number[], limits: ProviderImageRequestLimits): number {
  const halfImages = Math.floor(limits.maxImages / 2);
  const halfBytes = limits.maxBytes / 2;
  let start = 0;
  let bytes = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    bytes += sizes[index]!;
    if (index - start + 1 <= limits.maxImages && bytes <= limits.maxBytes) continue;
    while (start < index && (index - start + 1 > halfImages || bytes > halfBytes)) {
      bytes -= sizes[start]!;
      start += 1;
    }
  }
  return start;
}

/** The images from `from` on are within `maxImages` and `maxBytes`. */
function suffixFits(
  sizes: readonly number[],
  from: number,
  maxImages: number,
  maxBytes: number,
): boolean {
  if (sizes.length - from > maxImages) return false;
  let bytes = 0;
  for (let index = from; index < sizes.length; index += 1) bytes += sizes[index]!;
  return bytes <= maxBytes;
}

/** The first index from which the images are within both bounds; the newest at the latest. */
function firstStartWithin(sizes: readonly number[], maxImages: number, maxBytes: number): number {
  let start = sizes.length;
  let bytes = 0;
  while (
    start > 0 &&
    sizes.length - start + 1 <= maxImages &&
    bytes + sizes[start - 1]! <= maxBytes
  ) {
    start -= 1;
    bytes += sizes[start]!;
  }
  return Math.min(start, sizes.length - 1);
}

/**
 * The size of every image the messages carry, in order, and where the images
 * just added start: those from the message that opened the turn (the newest
 * user message that is not steering), and those after the newest assistant
 * message, which are the user's own at the first step and the tool results'
 * after it.
 */
function requestImages(messages: readonly ModelMessage[]): {
  sizes: number[];
  newImagesFrom: number[];
} {
  const sizes: number[] = [];
  let turnFrom: number | undefined;
  let sinceAnswerFrom = 0;
  for (const message of messages) {
    if (message.role === 'user' && steeringEventIdOf(message) === undefined) {
      turnFrom = sizes.length;
    }
    forEachImagePart(message, (part) => {
      sizes.push(imagePartBytes(part));
      return part;
    });
    if (message.role === 'assistant') sinceAnswerFrom = sizes.length;
  }
  const newImagesFrom = [...new Set([turnFrom ?? sinceAnswerFrom, sinceAnswerFrom])].sort(
    (left, right) => left - right,
  );
  return { sizes, newImagesFrom };
}

function requestWindowStart(
  messages: readonly ModelMessage[],
  limits: ProviderImageRequestLimits,
): number {
  const { sizes, newImagesFrom } = requestImages(messages);
  return providerImageWindowStart(sizes, limits, newImagesFrom);
}

/** How many images `limitProviderRequestImages` would remove from these messages. */
export function countRemovedProviderRequestImages(
  messages: readonly ModelMessage[],
  limits: ProviderImageRequestLimits,
): number {
  return requestWindowStart(messages, limits);
}

/**
 * Replace every image before the request's window start with a short note,
 * in the message that held it. Messages without a removed image are returned
 * as the same objects.
 */
export function limitProviderRequestImages(
  messages: readonly ModelMessage[],
  limits: ProviderImageRequestLimits,
): { messages: ModelMessage[]; removedImages: number } {
  const start = requestWindowStart(messages, limits);
  if (start === 0) return { messages: [...messages], removedImages: 0 };
  const note = providerImageRemovedMessage(limits);
  let seen = 0;
  const limited = messages.map((message) =>
    forEachImagePart(message, (part) => {
      seen += 1;
      return seen <= start ? { type: 'text', text: note } : part;
    }),
  );
  return { messages: limited, removedImages: start };
}

/**
 * Read the deferred images the messages carry from image `fromImage` on, in
 * request order, or replace each with what `read` puts in its place. Earlier
 * ones stay deferred and keep counting by their recorded size. A user
 * message's attachments and a tool result's images are both found here;
 * messages without one read are returned as the same objects.
 */
export async function resolveDeferredImages(
  messages: readonly ModelMessage[],
  read: (image: DeferredImageData, mediaType: string) => Promise<FilePart | TextPart>,
  fromImage = 0,
): Promise<ModelMessage[]> {
  const pending: Array<{ index: number; image: DeferredImageData; mediaType: string }> = [];
  let imageIndex = 0;
  for (const message of messages) {
    forEachImagePart(message, (part) => {
      const image = imageIndex >= fromImage ? deferredImageData(part) : undefined;
      if (image) {
        const mediaType = typeof part.mediaType === 'string' ? part.mediaType : '';
        pending.push({ index: imageIndex, image, mediaType });
      }
      imageIndex += 1;
      return part;
    });
  }
  if (pending.length === 0) return [...messages];
  const reads = new Map<number, FilePart | TextPart>();
  for (const { index, image, mediaType } of pending) {
    reads.set(index, await read(image, mediaType));
  }
  imageIndex = 0;
  return messages.map((message) =>
    forEachImagePart(message, (part) => {
      const resolved = reads.get(imageIndex);
      imageIndex += 1;
      return resolved ? (resolved as unknown as UnknownRecord) : part;
    }),
  );
}

/**
 * Replace every deferred image still in the messages with `note`. The last
 * step before a request goes out: a deferred image is a placeholder that no
 * provider can read, so one that was never resolved is not sent at all.
 */
export function dropDeferredImages(
  messages: readonly ModelMessage[],
  note: string,
): ModelMessage[] {
  return messages.map((message) =>
    forEachImagePart(message, (part) =>
      deferredImageData(part) ? { type: 'text', text: note } : part,
    ),
  );
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object';
}

function deferredImageData(part: unknown): DeferredImageData | undefined {
  if (!isRecord(part) || part.type !== 'file' || !isRecord(part.data)) return undefined;
  return part.data.type === 'deferred' ? (part.data as unknown as DeferredImageData) : undefined;
}

/**
 * An image part: a file part with an image media type, or any deferred image
 * whatever its media type says, so that every deferred image is limited and
 * resolved like the rest.
 */
function isImageFilePart(part: unknown): part is UnknownRecord {
  if (!isRecord(part) || part.type !== 'file') return false;
  if (deferredImageData(part)) return true;
  if (typeof part.mediaType !== 'string') return false;
  const mediaType = part.mediaType.toLowerCase();
  return mediaType === 'image' || mediaType.startsWith('image/');
}

/**
 * Visit the image parts of one message in order — its own file parts and the
 * file parts inside its tool results — and rebuild only what a visit changed.
 */
function forEachImagePart(
  message: ModelMessage,
  visit: (part: UnknownRecord) => UnknownRecord,
): ModelMessage {
  if (!Array.isArray(message.content)) return message;
  let changed = false;
  const content = (message.content as unknown[]).map((part) => {
    if (isImageFilePart(part)) {
      const next = visit(part);
      if (next !== part) changed = true;
      return next;
    }
    if (
      !isRecord(part) ||
      part.type !== 'tool-result' ||
      !isRecord(part.output) ||
      part.output.type !== 'content' ||
      !Array.isArray(part.output.value)
    ) {
      return part;
    }
    let outputChanged = false;
    const value = part.output.value.map((entry: unknown) => {
      if (!isImageFilePart(entry)) return entry;
      const next = visit(entry);
      if (next !== entry) outputChanged = true;
      return next;
    });
    if (!outputChanged) return part;
    changed = true;
    return { ...part, output: { ...part.output, value } };
  });
  return changed ? ({ ...message, content } as ModelMessage) : message;
}

/**
 * The decoded size of an inline image, or the recorded size of a deferred one;
 * a URL or provider reference weighs nothing here.
 */
function imagePartBytes(part: UnknownRecord): number {
  const deferred = deferredImageData(part);
  if (deferred) return Number.isFinite(deferred.bytes) ? Math.max(0, deferred.bytes) : 0;
  const data = isRecord(part.data) && part.data.type === 'data' ? part.data.data : part.data;
  if (typeof data === 'string') {
    const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
  }
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}
