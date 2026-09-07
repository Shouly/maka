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

// The `inspector` namespace of the preload bridge, wrapped.

import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Inspector = MakaBridge['inspector'];

export type SessionTracePage = Awaited<ReturnType<Inspector['trace']>>;
export type SessionUsageSummary = Awaited<ReturnType<Inspector['summary']>>;
export type SessionContextDiagnostics = Awaited<ReturnType<Inspector['context']>>;

const inspector = (): Inspector => requireNamespace('inspector');

export function readSessionTrace(sessionId: string, cursor?: string): Promise<SessionTracePage> {
  return inspector().trace(sessionId, cursor);
}

export function readSessionUsageSummary(sessionId: string): Promise<SessionUsageSummary> {
  return inspector().summary(sessionId);
}

export function readSessionContextDiagnostics(
  sessionId: string,
): Promise<SessionContextDiagnostics> {
  return inspector().context(sessionId);
}

export function subscribeSessionUsageChanges(sessionId: string, handler: () => void): () => void {
  return toUnsubscribe(tryNamespace('inspector')?.subscribeUsageChanges(sessionId, handler));
}
