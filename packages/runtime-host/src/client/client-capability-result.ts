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

import { Buffer } from 'node:buffer';
import type { McpCallResult } from '@maka/core/mcp';
import { mcpResultFileText } from '@maka/runtime/mcp-tools';
import {
  CLIENT_CAPABILITY_MAX_RESULT_BYTES,
  decodeClientCapabilityResult,
  type ClientCapabilityCallResult,
  type ClientCapabilityContentBlock,
} from '../protocol/index.js';

/** The JSON the channel sends for a decoded result; one past the protocol's byte limit throws. */
export function encodeClientCapabilityResult(result: ClientCapabilityCallResult): string {
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json, 'utf8') > CLIENT_CAPABILITY_MAX_RESULT_BYTES) {
    throw new Error('Client Capability result exceeds the byte limit');
  }
  return json;
}

/**
 * Whether the channel sends `result` as it is: the same decode and encode it
 * runs on a provider's result, so the two cannot disagree.
 */
export function fitsClientCapabilityResult(result: unknown): boolean {
  try {
    encodeClientCapabilityResult(decodeClientCapabilityResult(result));
    return true;
  } catch {
    return false;
  }
}

/**
 * An MCP result as the Host takes it: whole, its blocks and
 * `structuredContent` as the server sent them. One the protocol cannot carry
 * as it is (more blocks, or a deeper or larger `structuredContent`, than it
 * allows) goes as the text a saved file would hold for it, with its images
 * when they fit; one past the protocol's byte limit even then fails the call.
 * `client` names the client in that failure, e.g. "Desktop" or "CLI".
 */
export function projectMcpClientCapabilityResult(
  result: McpCallResult,
  client: string,
): ClientCapabilityCallResult {
  const whole: ClientCapabilityCallResult = {
    content: result.content.map((block) => structuredClone(block)),
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: structuredClone(result.structuredContent) }),
  };
  if (fitsClientCapabilityResult(whole)) return whole;
  const text: ClientCapabilityContentBlock = {
    type: 'text',
    text: mcpResultFileText(result).text,
  };
  const images = whole.content.filter((block) => block.type === 'image');
  if (images.length > 0) {
    const withImages = { content: [text, ...images] };
    if (fitsClientCapabilityResult(withImages)) return withImages;
  }
  const textOnly = { content: [text] };
  if (fitsClientCapabilityResult(textOnly)) return textOnly;
  throw new Error(
    `The MCP result is larger than the ${CLIENT_CAPABILITY_MAX_RESULT_BYTES / (1024 * 1024)} MiB this ${client} client can return`,
  );
}
