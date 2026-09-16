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

import { normalizeSessionTaskDocument, type SessionTaskDocument } from '@maka/core/session-task';
import { requireEntityId, requireExactRecord } from './codec.js';
import { invalidProtocolFrame } from './errors.js';
import { defineOperation } from './operation-spec.js';

const QUERY_ERRORS = [
  'host_not_ready',
  'host_draining',
  'operation_unavailable',
  'invalid_request',
  'not_found',
  'internal_failure',
] as const;

export interface SessionTaskQueryInput {
  readonly sessionId: string;
}

export interface SessionTaskQueryResult extends SessionTaskDocument {
  readonly sessionId: string;
}

export const SESSION_TASK_OPERATION_SPECS = {
  'session.task.query': defineOperation<
    SessionTaskQueryInput,
    SessionTaskQueryResult,
    (typeof QUERY_ERRORS)[number]
  >({
    mode: 'query',
    availability: 'ready',
    errors: QUERY_ERRORS,
    decodeInput: decodeSessionTaskQueryInput,
    decodeOutput: decodeSessionTaskQueryResult,
  }),
} as const;

export function decodeSessionTaskQueryInput(value: unknown): SessionTaskQueryInput {
  const input = requireExactRecord(value, 'SessionTask query input', ['sessionId']);
  return { sessionId: requireEntityId(input.sessionId, 'sessionId') };
}

export function decodeSessionTaskQueryResult(value: unknown): SessionTaskQueryResult {
  const result = requireExactRecord(value, 'SessionTask query result', [
    'sessionId',
    'nextId',
    'items',
  ]);
  const normalized = normalizeSessionTaskDocument({
    nextId: result.nextId,
    items: result.items,
  });
  if (!normalized.ok) {
    throw invalidProtocolFrame(`Invalid SessionTask result: ${normalized.message}`);
  }
  return {
    sessionId: requireEntityId(result.sessionId, 'sessionId'),
    nextId: normalized.value.nextId,
    items: normalized.value.items,
  };
}
