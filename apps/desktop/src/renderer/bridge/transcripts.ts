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

// The `transcripts` namespace of the preload bridge, wrapped.
//
// `open` streams byte-budgeted batches (128KB fragment / 512KB range) into a
// `DesktopTranscriptRangeStore`; the handle it resolves to is the paging API
// (`loadBefore` / `loadAfter` / `loadAround` / `close`). The renderer never
// holds the whole history — see `lib/ported/desktop-transcript-range-store.ts`.

import type {
  DesktopTranscriptBatch,
  DesktopTranscriptHandle,
} from '../../preload/transcript-contract.js';
import { requireNamespace } from './bridge.js';

export type { DesktopTranscriptBatch, DesktopTranscriptHandle };

export function openTranscript(
  sessionId: string,
  handler: (batch: DesktopTranscriptBatch) => void,
  registerCancellation?: (cancel: () => void) => void,
): Promise<DesktopTranscriptHandle> {
  return requireNamespace('transcripts').open(sessionId, handler, registerCancellation);
}

/** The namespace itself, for the settlement reader which owns its own handle. */
export function transcriptSource(): { open: typeof openTranscript } {
  return { open: openTranscript };
}
