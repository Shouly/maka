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

// The `diagnostics` namespace of the preload bridge, wrapped.
//
// Main assembles the report (app/runtime versions, recent logs, the target's
// execution context) and puts it on the clipboard; the renderer only says
// which surface asked and what it was showing.

import { tryNamespace } from './bridge.js';
import type { DesktopDiagnosticInput } from '../../preload/diagnostics-contract.js';

export async function copyDiagnosticReport(input: DesktopDiagnosticInput): Promise<boolean> {
  try {
    await tryNamespace('diagnostics')?.copyReport?.(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the previous run of the app ended in a main-process interruption.
 *
 * "Take" is literal: main clears the marker when it is read, so exactly one
 * surface reports one crash once. The renderer only decides whether to show a
 * notice; the report itself is assembled by `copyPreviousMainProcessInterruption`.
 */
export async function takePreviousMainProcessInterruption(): Promise<boolean> {
  try {
    return (await tryNamespace('diagnostics')?.takePreviousMainProcessInterruption()) === true;
  } catch {
    return false;
  }
}

/** Put the previous run's interruption report on the clipboard. */
export async function copyPreviousMainProcessInterruption(): Promise<boolean> {
  try {
    await tryNamespace('diagnostics')?.copyPreviousMainProcessInterruption();
    return true;
  } catch {
    return false;
  }
}
