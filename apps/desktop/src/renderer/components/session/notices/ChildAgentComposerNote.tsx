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

// What stands in a child agent's composer.
//
// A child takes its task and any course corrections from the conversation
// that started it, and reports back there; a message typed here would reach
// the child behind its parent's back. So its Session is read, not written:
// the way back, and Stop while it runs — the one control the composer had
// that still means something here.

import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { cn } from '../../../lib/cn.js';
import { COMPOSER_PANEL_CLASS } from '../../../lib/composer-surface.js';
import { sessionsStore, turnActionsStore } from '../../../store/index.js';
import { pendingActionsOf } from '../../../store/turn-actions-store.js';
import { getChildAgentsCopy } from '../../../locales/child-agents-copy.js';

export function ChildAgentComposerNote(props: {
  sessionId: string;
  parentSessionId: string;
  running: boolean;
  onError: (title: string, error: unknown) => void;
}) {
  const copy = getChildAgentsCopy(useUiLocale());
  // The composer's own stop state: a stop in flight is not asked for twice,
  // whichever control asked.
  const stopping = useStore(turnActionsStore, (state) =>
    pendingActionsOf(state, props.sessionId).includes('stop'),
  );
  const stop = () => {
    if (stopping) return;
    void turnActionsStore
      .stop(props.sessionId, { source: 'stop_button' })
      .catch((error: unknown) => props.onError(copy.stopFailed, error));
  };
  // Escape stops it while it has focus, as Escape stops a turn from the
  // composer it stands in for — and like the composer it takes focus when the
  // child is opened, unless something else already holds it.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body)
      rootRef.current?.focus({ preventScroll: true });
  }, [props.sessionId]);
  return (
    // The composer's own face, one line tall (8 + 32 + 8), standing where the
    // face would: its bottom 30px above the meta row it would have had.
    <div
      ref={rootRef}
      tabIndex={-1}
      data-maka-contract="child-agent-composer"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !props.running || event.defaultPrevented) return;
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        stop();
      }}
      className={cn(
        COMPOSER_PANEL_CLASS,
        'mb-[30px] flex w-full items-center gap-2 p-2 outline-none',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center text-text-muted">
        <Anthropicon name="agent" size={20} aria-hidden="true" />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm leading-5 text-text-secondary">
        {copy.directedByParent}
      </p>
      {props.running && (
        <Button variant="secondary" disabled={stopping} onClick={stop}>
          {stopping ? copy.stopping : copy.stop}
        </Button>
      )}
      <Button variant="secondary" onClick={() => sessionsStore.select(props.parentSessionId)}>
        {copy.backToParent}
      </Button>
    </div>
  );
}
