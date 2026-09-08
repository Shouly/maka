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

// Edit-and-resend, as a piece of state.
//
// Editing a sent message does not change it: the Host forks a new revision of
// the whole task before the edited turn and the edited text is the first thing
// sent there. That is three separate authorities in sequence — the Host mints
// the copy, the catalog store switches to it, the turn actions send into it —
// and between them the user is looking at a message that says something they
// did not send yet. This store is what that in-between looks like: which turn
// is being edited, what the text is now, and how far the fork has got.
//
// Deliberately dumb: it holds the draft and its phase, and the caller drives
// the transitions around its own awaits. Putting the orchestration in here
// would give the store two authorities to keep in sync (its own phase and the
// promise it started) with no way to test either without the bridge.

import { createStore } from 'zustand/vanilla';
import type { StoredMessage } from '@maka/core/session';

/** How far the fork has got. `editing` is local; the rest have asked the Host. */
export type RevisionDraftPhase = 'editing' | 'preparing' | 'sending' | 'uncertain';

export interface RevisionDraft {
  /** The task the edited message belongs to, before any fork. */
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  /**
   * Stable target identity for one logical copy action, so a retry after an
   * ambiguous failure reuses the reservation instead of minting a second fork.
   */
  readonly copyId: string;
  readonly text: string;
  readonly originalText: string;
  readonly phase: RevisionDraftPhase;
  /** The forked task, once the Host has named one. */
  readonly revisionSessionId?: string;
  readonly error?: string;
  readonly messageId?: string;
  readonly copyStarted?: boolean;
  readonly cleanupRequested?: boolean;
}

export interface RevisionDraftState {
  readonly draft: RevisionDraft | undefined;
}

/**
 * Why a message cannot be edited, or `undefined` when it can.
 *
 * The two refusals are the ones the original desktop shell made: the revision
 * copier cannot carry attachment references across the fork losslessly, and a
 * message whose display text was transformed on the way in (a slash command, a
 * skill invocation) would be re-sent as the transformed text rather than as
 * what the user typed. Both are refusals rather than silent degradations
 * because either would resend something different from what is on screen.
 */
export type RevisionRefusal = 'attachments' | 'transformed_text';

export function revisionRefusalFor(
  message: Extract<StoredMessage, { type: 'user' }> | undefined,
): RevisionRefusal | undefined {
  if (!message) return undefined;
  if (message.attachments && message.attachments.length > 0) return 'attachments';
  if (message.displayText !== undefined && message.displayText !== message.text) {
    return 'transformed_text';
  }
  return undefined;
}

/**
 * One reservation per (task, turn), for this window's lifetime.
 *
 * The original shell persisted these in `sessionStorage` so a reload mid-fork
 * reused the reservation. This one does not: a reload drops the draft with the
 * rest of the renderer state, so there is no draft left to retry through, and
 * a persisted id would only ever be read by a fork nobody is waiting for.
 */
const copyIds = new Map<string, string>();

export function revisionCopyId(sessionId: string, turnId: string): string {
  const key = `${sessionId}�${turnId}`;
  const existing = copyIds.get(key);
  if (existing) return existing;
  const minted =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `revision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  copyIds.set(key, minted);
  return minted;
}

/** Forget the reservation once the fork is confirmed — the next edit is new work. */
export function releaseRevisionCopyId(sessionId: string, turnId: string): void {
  copyIds.delete(`${sessionId}�${turnId}`);
}

export function createRevisionDraftStore() {
  const store = createStore<RevisionDraftState>(() => ({ draft: undefined }));
  const patch = (update: Partial<RevisionDraft>) => {
    const draft = store.getState().draft;
    if (!draft) return;
    store.setState({ draft: { ...draft, ...update } });
  };
  return {
    ...store,
    /**
     * Start editing. Refuses while another draft is open: two open drafts
     * would each fork the same task, and the second fork would be made from a
     * transcript the first one is already rewriting.
     */
    begin(input: { sessionId: string; turnId: string; text: string }): boolean {
      if (store.getState().draft) return false;
      store.setState({
        draft: {
          sourceSessionId: input.sessionId,
          sourceTurnId: input.turnId,
          copyId: revisionCopyId(input.sessionId, input.turnId),
          text: input.text,
          originalText: input.text,
          phase: 'editing',
        },
      });
      return true;
    },
    setText(text: string) {
      const draft = store.getState().draft;
      if (draft?.phase !== 'editing') return;
      patch({ text, error: undefined });
    },
    markPreparing() {
      patch({ phase: 'preparing', error: undefined, copyStarted: true });
    },
    /** The Host named the fork; the draft now belongs to it. */
    markForked(revisionSessionId: string) {
      patch({ phase: 'sending', revisionSessionId });
    },
    markCleanup() {
      patch({ cleanupRequested: true, phase: 'preparing' });
    },
    markSending(messageId: string) {
      patch({ phase: 'sending', messageId });
    },
    uncertain(error: string) {
      patch({ phase: 'uncertain', error });
    },
    fail(error: string) {
      patch({ phase: 'editing', error, messageId: undefined });
    },
    cancel() {
      const draft = store.getState().draft;
      if (draft) releaseRevisionCopyId(draft.sourceSessionId, draft.sourceTurnId);
      store.setState({ draft: undefined });
    },
    /** The edited text landed; release the reservation so a re-edit forks again. */
    complete() {
      const draft = store.getState().draft;
      if (draft) releaseRevisionCopyId(draft.sourceSessionId, draft.sourceTurnId);
      store.setState({ draft: undefined });
    },
  };
}

export const revisionDraftStore = createRevisionDraftStore();
