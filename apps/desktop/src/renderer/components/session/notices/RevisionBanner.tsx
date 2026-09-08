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

// Two things about versions, in one strip.
//
// The BANNER says an edit is in progress: the transcript on screen still shows
// the message the user sent, and the edited text has not gone anywhere yet, so
// something has to say so and offer the way out.
//
// The NAVIGATION says this task is one of several versions of itself. A
// revision is a separate Session with its own transcript, so "previous
// version" is a task switch, not a scroll — which is why it is a stepper next
// to the banner rather than a control inside a turn.

import { memo } from 'react';
import { useStore } from 'zustand';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { cn } from '../../../lib/cn.js';
import { deriveSessionRevisionNavigation } from '../../../lib/ported/session-revisions.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { getComposerCopy } from '../../../locales/composer-copy.js';
import { getDesktopConversationCopy } from '../../../locales/conversation-copy.js';
import { revisionDraftStore, sessionsStore } from '../../../store/index.js';
import { versionStepButtonClass } from '../message-action-bar.js';

export const RevisionBanner = memo(function RevisionBanner(props: {
  sessionId: string;
  onCancel: () => void;
  onSubmit: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const actions = getDesktopConversationCopy(locale).actions;
  const chat = getConversationCopy(locale).chat;
  const draft = useStore(revisionDraftStore, (state) => state.draft);
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const navigation = deriveSessionRevisionNavigation(sessions, props.sessionId);
  const showDraft =
    draft !== undefined &&
    (draft.sourceSessionId === props.sessionId || draft.revisionSessionId === props.sessionId);

  if (!showDraft && !navigation) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {showDraft && (
        <div
          role="status"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-hairline bg-surface-2 p-3"
        >
          <Anthropicon name="edit" size={18} className="shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5 text-text-primary">
              {actions.revisionBannerTitle}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-text-secondary">
              {draft.phase === 'uncertain'
                ? getComposerCopy(locale).send.outcomeUnknownDescription
                : (draft.error ?? actions.revisionBannerDetail)}
            </p>
          </div>
          {(draft.phase === 'uncertain' ||
            (draft.revisionSessionId && draft.phase === 'editing' && !draft.cleanupRequested)) && (
            <Button size="sm" onClick={props.onSubmit}>
              {getTranscriptCopy(locale).turn.save}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={draft.phase === 'sending' || draft.phase === 'uncertain'}
            onClick={props.onCancel}
          >
            {actions.revisionCancelLabel}
          </Button>
        </div>
      )}

      {navigation && (
        <div
          className="inline-flex items-center gap-1"
          role="group"
          aria-label={chat.revisionVersionsAriaLabel}
        >
          <button
            type="button"
            aria-label={chat.previousRevision}
            disabled={!navigation.previousSessionId}
            onClick={() =>
              navigation.previousSessionId && props.onSelectSession(navigation.previousSessionId)
            }
            className={versionStepButtonClass}
          >
            <Anthropicon name="caretRight" size={16} className={cn('rotate-180')} />
          </button>
          <span className="select-none text-xs tabular-nums text-text-muted">
            {chat.revisionVersion(navigation.current, navigation.total)}
          </span>
          <button
            type="button"
            aria-label={chat.nextRevision}
            disabled={!navigation.nextSessionId}
            onClick={() =>
              navigation.nextSessionId && props.onSelectSession(navigation.nextSessionId)
            }
            className={versionStepButtonClass}
          >
            <Anthropicon name="caretRight" size={16} />
          </button>
        </div>
      )}
    </div>
  );
});
