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

// The conversation surface — PLACEHOLDER.
//
// Phase 3 replaces this file with the real transcript: user rows with
// attachments and quotes, assistant markdown streamed through
// `StreamPopMarkdown`, the tool timeline and its renderer registry, turn
// footers, revision navigation and history paging. What is here now is the
// smallest thing that proves the pipeline underneath is connected: the same
// `TurnViewModel[]` Phase 3 will render, laid out as plain cards.
//
// Deliberately NOT here: any of the scroll authority, folding or paging
// machinery. Half an implementation of those would have to be unpicked rather
// than extended.

import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import Markdown from '../ui/Markdown.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { activeSessionStore, turnActionsStore } from '../../store/index.js';
import { useActiveTurns, useLiveTurnSnapshot } from '../../hooks/use-workspace.js';
import { getConversationCopy } from '@maka/ui';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';

export function SessionView(props: { sessionId: string }) {
  const locale = useUiLocale();
  const conversation = getConversationCopy(locale);
  const sidebar = getSidebarCopy(locale);
  const turns = useActiveTurns();
  const live = useLiveTurnSnapshot();
  const observationReady = useStore(activeSessionStore, (state) => state.observationReady);
  const pending = useStore(turnActionsStore, (state) => state.pending[props.sessionId] ?? []);

  return (
    <div className="chat-area flex min-h-0 flex-1 flex-col" data-maka-contract="transcript">
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2"
        role="log"
        aria-live="polite"
        aria-busy={!observationReady || undefined}
      >
        <div className="mx-auto flex w-full max-w-[var(--chat-feed-max)] flex-col gap-4">
          {turns.length === 0 && (
            <p className="py-16 text-center text-sm text-text-muted" role="status">
              {observationReady ? conversation.empty.ariaLabel : sidebar.loading}
            </p>
          )}
          {turns.map((turn) => (
            <article
              key={turn.turnId}
              data-maka-transcript-turn={turn.turnId}
              className="flex flex-col gap-2"
            >
              {turn.user?.text && (
                <div className="chat-user-bubble self-end rounded-xl bg-surface-2 px-3 py-2 text-sm leading-6 text-text-primary">
                  {turn.user.text}
                </div>
              )}
              {turn.assistant?.text && (
                <div className="chat-assistant-response standard-markdown text-sm leading-6 text-chat-text-primary">
                  <Markdown>{turn.assistant.text}</Markdown>
                </div>
              )}
              <div className="flex items-center gap-3 text-xs leading-4 text-text-muted">
                <span>{sidebar.turnStatus[turn.status]}</span>
                {turn.tools.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Anthropicon name="tool" size={12} />
                    {turn.tools.length}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
      <div
        className={cn(
          'shrink-0 border-t border-hairline px-4 py-3 text-center text-xs leading-4 text-text-muted',
        )}
        role="status"
      >
        {live.phase !== undefined || pending.includes('send')
          ? sidebar.running
          : conversation.composer.placeholder}
      </div>
    </div>
  );
}
