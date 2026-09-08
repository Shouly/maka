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

import type { createRevisionDraftStore } from './revision-draft.js';
import type { DesktopSessionSummary, SessionSubmitResult } from '../bridge/sessions.js';

/** One edit transaction. Only its owner may transition the shared draft. */
export function createRevisionActions(deps: {
  draft: ReturnType<typeof createRevisionDraftStore>;
  selected(): string | undefined;
  subscribeSelection(listener: () => void): () => void;
  select(id: string): void;
  upsert(row: DesktopSessionSummary): void;
  revise(
    id: string,
    input: { sourceTurnId: string; copyId: string },
  ): Promise<DesktopSessionSummary>;
  settle(id: string, signal: AbortSignal): Promise<{ settled: boolean }>;
  submit(id: string, text: string, messageId: string): Promise<SessionSubmitResult>;
  abandon(id: string, copyId: string): Promise<void>;
  setText(id: string, text: string): void;
  show(id: string, text: string, messageId: string): void;
  remove(id: string, messageId: string): void;
  refresh(): Promise<unknown>;
}) {
  let active: { copyId: string; abort: AbortController } | undefined;
  async function cancel(): Promise<void> {
    const draft = deps.draft.getState().draft;
    if (!draft || draft.phase === 'sending' || draft.messageId !== undefined) return;
    active?.abort.abort();
    active = undefined;
    const started = draft.copyStarted === true || draft.revisionSessionId !== undefined;
    if (started) {
      deps.draft.markCleanup();
      try {
        await deps.abandon(draft.sourceSessionId, draft.copyId);
      } catch (error) {
        if (deps.draft.getState().draft?.copyId === draft.copyId)
          deps.draft.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    if (deps.draft.getState().draft?.copyId !== draft.copyId) return;
    deps.draft.cancel();
    if (draft.revisionSessionId) deps.setText(draft.revisionSessionId, '');
    if (deps.selected() === draft.revisionSessionId) deps.select(draft.sourceSessionId);
    if (started) await deps.refresh();
  }

  async function submit(): Promise<void> {
    const draft = deps.draft.getState().draft;
    if (
      !draft ||
      draft.cleanupRequested ||
      active ||
      (draft.phase !== 'editing' && draft.phase !== 'uncertain')
    )
      return;
    const text = draft.text.trim();
    if (!text) return;
    const operation = { copyId: draft.copyId, abort: new AbortController() };
    active = operation;
    let forkId = draft.revisionSessionId;
    let submitted = false;
    let expectedSelection = draft.sourceSessionId;
    const owns = () => deps.draft.getState().draft?.copyId === draft.copyId;
    const current = () => owns() && !operation.abort.signal.aborted;
    deps.draft.markPreparing();
    const off = deps.subscribeSelection(() => {
      const selected = deps.selected();
      if (!submitted && selected !== expectedSelection) {
        void cancel().catch(() => undefined);
      }
    });
    try {
      if (!forkId) {
        const row = await deps.revise(draft.sourceSessionId, {
          sourceTurnId: draft.sourceTurnId,
          copyId: draft.copyId,
        });
        if (!current()) return;
        forkId = row.id;
        deps.upsert(row);
      }
      if (!current()) return;
      deps.draft.markForked(forkId);
      // Preparation remains cancellable until submission begins.
      deps.draft.markPreparing();
      deps.setText(forkId, text);
      expectedSelection = forkId;
      deps.select(forkId);
      const { settled } = await deps.settle(forkId, operation.abort.signal);
      if (!current()) return;
      if (!settled) throw new Error('Revised transcript did not become ready');
      const messageId = draft.messageId ?? crypto.randomUUID();
      deps.draft.markSending(messageId);
      deps.show(forkId, text, messageId);
      submitted = true;
      const result = await deps.submit(forkId, text, messageId);
      if (!owns()) return;
      if (!result.ok) {
        if (result.reason === 'outcome_unknown') deps.draft.uncertain(result.reason);
        else {
          deps.remove(forkId, messageId);
          deps.draft.fail(result.reason);
        }
        return;
      }
      if (result.disposition === 'locally_saved') {
        deps.draft.uncertain('outcome_unknown');
        return;
      }
      deps.setText(forkId, '');
      deps.draft.complete();
    } catch (error) {
      if (!owns()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (submitted) {
        // An IPC failure says nothing about admission. Retry the same id.
        deps.draft.uncertain(message);
      } else {
        // Retain a prepared fork for retry; cancel explicitly cleans it up.
        deps.draft.fail(message);
      }
      throw error;
    } finally {
      off();
      if (active === operation) active = undefined;
    }
  }
  function reconcile(sessionId: string | undefined, messageIds: readonly string[]) {
    const draft = deps.draft.getState().draft;
    if (
      !sessionId ||
      draft?.phase !== 'uncertain' ||
      !draft.messageId ||
      sessionId !== draft.revisionSessionId ||
      !messageIds.includes(draft.messageId)
    )
      return;
    deps.setText(sessionId, '');
    deps.draft.complete();
  }
  return { submit, cancel, reconcile };
}
