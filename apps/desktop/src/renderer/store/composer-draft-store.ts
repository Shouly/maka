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

// What the composer is holding that the composer does not own.
//
// Phase 3a only puts quotes here: selecting transcript text and choosing
// "quote into the composer" has to survive until the composer exists to read
// it, and the transcript must not reach into the composer to say so. Phase 3b
// adds the draft text, attachments and references beside them.
//
// Quotes are per task. A quote names the turn it came from, and that turn
// belongs to one task, so carrying a quote across a task switch would attach
// an excerpt to a conversation it was never part of.

import { createStore } from 'zustand/vanilla';
import type { QuoteRef } from '@maka/core/events';

export interface PendingQuote extends QuoteRef {
  /** Stable key for the chip list; the text alone is not unique. */
  readonly id: string;
}

export interface ComposerDraftState {
  readonly quotes: Readonly<Record<string, readonly PendingQuote[]>>;
}

let quoteSequence = 0;

export function createComposerDraftStore() {
  const store = createStore<ComposerDraftState>(() => ({ quotes: {} }));
  return {
    ...store,
    quotesFor(sessionId: string | undefined): readonly PendingQuote[] {
      return (sessionId ? store.getState().quotes[sessionId] : undefined) ?? [];
    },
    /**
     * Add an excerpt. The same excerpt from the same turn is idempotent —
     * quoting twice by accident is common (the affordance reappears whenever
     * the selection settles) and two identical chips say nothing new.
     */
    addQuote(sessionId: string, quote: QuoteRef): PendingQuote | undefined {
      const existing = store.getState().quotes[sessionId] ?? [];
      if (
        existing.some((row) => row.text === quote.text && row.sourceTurnId === quote.sourceTurnId)
      ) {
        return undefined;
      }
      const added: PendingQuote = { ...quote, id: `quote-${++quoteSequence}` };
      store.setState((state) => ({
        quotes: { ...state.quotes, [sessionId]: [...existing, added] },
      }));
      return added;
    },
    removeQuote(sessionId: string, id: string) {
      const existing = store.getState().quotes[sessionId];
      if (!existing) return;
      store.setState((state) => ({
        quotes: { ...state.quotes, [sessionId]: existing.filter((row) => row.id !== id) },
      }));
    },
    transferQuotes(from: string, to: string) {
      store.setState((state) => {
        const { [from]: moving, ...rest } = state.quotes;
        return { quotes: { ...rest, [to]: [...(rest[to] ?? []), ...(moving ?? [])] } };
      });
    },
    clearQuotes(sessionId: string) {
      if (!store.getState().quotes[sessionId]) return;
      store.setState((state) => {
        const { [sessionId]: _dropped, ...rest } = state.quotes;
        return { quotes: rest };
      });
    },
  };
}

export const composerDraftStore = createComposerDraftStore();
