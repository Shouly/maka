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

// The `shellRuns` namespace of the preload bridge, wrapped.
//
// `subscribeUpdates` is what the transcript projection folds over to turn a
// terminal tool call into a live shell-run row (`foldShellRunUpdates`).

import type { ShellRunUpdate } from '@maka/core/events';
import type { ShellRunPtyDataEvent, ShellRunPtySnapshot } from '@maka/runtime/shell-run-contract';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type ShellRuns = MakaBridge['shellRuns'];

export type { ShellRunUpdate };

const shellRuns = (): ShellRuns => requireNamespace('shellRuns');

export function listShellRuns(sessionId: string): Promise<ShellRunUpdate[]> {
  return shellRuns().list(sessionId);
}

export function attachShellRun(input: {
  sessionId: string;
  ref: string;
}): Promise<ShellRunPtySnapshot | null> {
  return shellRuns().attach(input);
}

export function detachShellRun(input: { sessionId: string; ref: string }): Promise<void> {
  return shellRuns().detach(input);
}

export function startShellRun(sessionId: string): Promise<ShellRunUpdate> {
  return shellRuns().start(sessionId);
}

export function writeShellRun(input: {
  sessionId: string;
  ref: string;
  input?: string;
  size?: { cols: number; rows: number };
}): Promise<ShellRunUpdate | null> {
  return shellRuns().write(input);
}

export function stopShellRun(input: {
  sessionId: string;
  ref: string;
}): Promise<ShellRunUpdate | null> {
  return shellRuns().stop(input);
}

export function subscribeShellRunUpdates(handler: (update: ShellRunUpdate) => void): () => void {
  return toUnsubscribe(tryNamespace('shellRuns')?.subscribeUpdates(handler));
}

export function subscribeShellRunPtyData(
  handler: (event: ShellRunPtyDataEvent) => void,
): () => void {
  return toUnsubscribe(tryNamespace('shellRuns')?.subscribePtyData(handler));
}

export function subscribeShellRunResync(
  handler: (event: { sessionId: string }) => void,
): () => void {
  return toUnsubscribe(tryNamespace('shellRuns')?.subscribeResync(handler));
}
