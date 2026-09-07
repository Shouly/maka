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

// The composer, as a PLACEHOLDER — the same plain textarea the welcome surface
// carries until Phase 3b brings the TipTap editor, mentions, attachments and
// the mode controls.
//
// It is here rather than absent because the transcript is not testable without
// it: sending, stopping, and the queue that fills while a turn runs all need a
// way in. `SessionView` takes it through a `composerSlot` prop, so 3b replaces
// this file without touching the transcript.
//
// It does carry two things that are NOT placeholders, because they belong to
// the transcript's own contract and Phase 3b only inherits them: the pending
// quotes a selection put in `composerDraftStore`, and the context ring.

import { useState } from 'react';
import { useStore } from 'zustand';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';
import { cn } from '../../lib/cn.js';
import { composerDraftStore, turnActionsStore } from '../../store/index.js';
import { pendingActionsOf } from '../../store/turn-actions-store.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { ContextUsageIndicator } from './notices/ContextUsageIndicator.js';

export function ComposerPlaceholder(props: {
  sessionId: string;
  running: boolean;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const conversation = getConversationCopy(locale).composer;
  const copy = getTranscriptCopy(locale);
  const actions = getDesktopConversationCopy(locale).actions;
  const [draft, setDraft] = useState('');
  const pending = useStore(turnActionsStore, (state) => pendingActionsOf(state, props.sessionId));
  const quotes = useStore(
    composerDraftStore,
    (state) => state.quotes[props.sessionId] ?? EMPTY_QUOTES,
  );
  const sending = pending.includes('send');
  const stopping = pending.includes('stop');

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    void turnActionsStore
      .send(props.sessionId, {
        type: 'send',
        turnId: crypto.randomUUID(),
        text,
        ...(quotes.length > 0
          ? {
              quotes: quotes.map((quote) => ({
                text: quote.text,
                ...(quote.sourceTurnId ? { sourceTurnId: quote.sourceTurnId } : {}),
              })),
            }
          : {}),
      })
      .then((result) => {
        if ('ok' in result && result.ok === false) return;
        setDraft('');
        composerDraftStore.clearQuotes(props.sessionId);
      })
      .catch((error) => props.onError(actions.operationFailedTitle, error));
  };

  return (
    <div className="chat-composer-surface flex w-full flex-col gap-2 rounded-[var(--chat-composer-radius)] p-2">
      {quotes.length > 0 && (
        <ul aria-label={copy.turn.quotes} className="flex flex-wrap gap-1.5 px-1">
          {quotes.map((quote) => (
            <li key={quote.id}>
              <button
                type="button"
                onClick={() => composerDraftStore.removeQuote(props.sessionId, quote.id)}
                aria-label={`${copy.turn.quotes}: ${quote.text}`}
                className="inline-flex max-w-64 cursor-pointer items-center gap-1 rounded-md bg-alpha-1 px-1.5 py-0.5 text-[0.6875rem] leading-4 text-text-muted outline-none hover:text-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
              >
                <Anthropicon name="reply" size={12} className="shrink-0" />
                <span className="truncate">{quote.text}</span>
                <Anthropicon name="x" size={12} className="shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        value={draft}
        aria-label={conversation.textareaAriaLabel}
        placeholder={conversation.placeholder}
        data-maka-contract="composer-input"
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        className={cn('min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:shadow-none')}
      />
      <div className="flex items-center gap-2">
        <ContextUsageIndicator sessionId={props.sessionId} />
        <span className="ml-auto flex items-center gap-2">
          {props.running ? (
            <Button
              size="icon"
              variant="secondary"
              aria-label={conversation.stopLabel}
              disabled={stopping}
              onClick={() => {
                void turnActionsStore
                  .stop(props.sessionId)
                  .catch((error) => props.onError(actions.operationFailedTitle, error));
              }}
            >
              <Anthropicon name="stop" size={20} />
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label={conversation.sendLabel}
              disabled={!draft.trim() || sending}
              onClick={submit}
            >
              <Anthropicon name={sending ? 'spinner' : 'arrowUp'} size={20} />
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

const EMPTY_QUOTES: readonly never[] = [];
