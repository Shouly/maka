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

// What a Skill tool load leaves behind for diagnostics: a bounded receipt of
// the request and what it resolved to, projected into run-trace data without
// the raw request text. Nothing here reaches the model or the transcript.

import type { LoadedSkillInstructions } from './skills.js';

const SKILL_RECEIPT_REQUEST_MAX_BYTES = 512;
const SKILL_RECEIPT_REF_MAX_BYTES = 512;
const SKILL_RECEIPT_ID_MAX_BYTES = 128;
const SKILL_RECEIPT_NAME_MAX_BYTES = 256;

/** Why the Skill tool could not load what it was asked for. */
export type SkillLoadFailureReason =
  | 'invalid_name'
  | 'not_found'
  | 'disabled'
  | 'host_incompatible';

export type SkillInvocationReceipt =
  | {
      request: string;
      success: true;
      ref: string;
      id: string;
      name: string;
      scope: LoadedSkillInstructions['scope'];
      source: LoadedSkillInstructions['source'];
      truncated: boolean;
    }
  | {
      request: string;
      success: false;
      reason: SkillLoadFailureReason;
    };

export function loadedSkillInvocationReceipt(
  request: string,
  skill: LoadedSkillInstructions,
): SkillInvocationReceipt {
  return {
    request: boundSkillInvocationRequest(request),
    success: true,
    ref: truncateUtf8(skill.ref, SKILL_RECEIPT_REF_MAX_BYTES),
    id: truncateUtf8(skill.id, SKILL_RECEIPT_ID_MAX_BYTES),
    name: truncateUtf8(skill.name, SKILL_RECEIPT_NAME_MAX_BYTES),
    scope: skill.scope,
    source: skill.source,
    truncated: skill.truncated,
  };
}

export function failedSkillInvocationReceipt(
  request: string,
  reason: SkillLoadFailureReason,
): SkillInvocationReceipt {
  return { request: boundSkillInvocationRequest(request), success: false, reason };
}

/** Privacy-preserving trace projection: the request's length, never its text. */
export function skillInvocationReceiptTraceData(
  receipt: SkillInvocationReceipt,
): Record<string, unknown> {
  if (!receipt.success) {
    return {
      invocation: 'model_tool',
      success: false,
      reason: receipt.reason,
      requestChars: receipt.request.length,
    };
  }
  return {
    invocation: 'model_tool',
    success: true,
    skillRef: receipt.ref,
    skillId: receipt.id,
    skillName: receipt.name,
    skillScope: receipt.scope,
    skillSource: receipt.source,
    truncated: receipt.truncated,
  };
}

function boundSkillInvocationRequest(request: string): string {
  // Requests are identifiers, not prompts. Still bound them and strip
  // controls, so diagnostics cannot become an unbounded or log-injection
  // channel.
  // eslint-disable-next-line no-control-regex
  const cleaned = request.replace(/[\u0000-\u001F\u007F]/g, '');
  return truncateUtf8(cleaned || '[invalid]', SKILL_RECEIPT_REQUEST_MAX_BYTES);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}
