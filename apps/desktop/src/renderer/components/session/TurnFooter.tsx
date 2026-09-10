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

// The bar under an answer, and the lineage badges beside it.
//
// The enabled set is NOT decided here. `deriveTurnFooterActions` decides it
// from the turn's status and lineage alone, and this renders what it decided —
// which is what keeps "can I regenerate this" one answer rather than one per
// surface. A disabled action stays rendered so the row does not change width
// when a turn starts running.

import { memo, useState } from 'react';
import type { TurnLineageBadge } from '@maka/ui';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import type { AnthropiconName } from '../icons/Anthropicon.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/cn.js';
import type { TurnFooterAction, TurnFooterActionId } from '../../lib/ported/turn-footer-actions.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { messageActionBarClass, messageActionButtonClass } from './message-action-bar.js';

const ICON_BY_ACTION: Record<TurnFooterActionId, AnthropiconName> = {
  regenerate: 'arrowCounterClockwise',
  branch: 'pullRequest',
  copy: 'copy',
};

export const TurnFooter = memo(function TurnFooter(props: {
  actions: readonly TurnFooterAction[];
  /** Model · duration · cost, as text beside the actions. */
  meta?: string;
  lineageBadges?: readonly TurnLineageBadge[];
  onAction: (id: TurnFooterActionId) => void | Promise<void>;
  onOpenLineage: (turnId: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).turn;
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div role="toolbar" aria-label={copy.actionsLabel} className={messageActionBarClass}>
        {props.actions.map((action) => (
          <Tooltip key={action.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={action.label}
                disabled={!action.enabled}
                onClick={() => {
                  void Promise.resolve(props.onAction(action.id))
                    .then(() => {
                      if (action.id === 'copy') {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      }
                    })
                    .catch(() => undefined);
                }}
                className={messageActionButtonClass}
              >
                <Anthropicon
                  name={action.id === 'copy' && copied ? 'check' : ICON_BY_ACTION[action.id]}
                  size={16}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{action.tooltip ?? action.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {props.meta && (
        <span className="text-[0.6875rem] leading-4 text-text-muted tabular-nums">
          {props.meta}
        </span>
      )}
      {(props.lineageBadges ?? []).map((badge) => (
        <button
          key={badge.id}
          type="button"
          onClick={() => props.onOpenLineage(badge.targetTurnId)}
          aria-label={badge.tooltip ?? badge.label}
          className={cn(
            'ui-control-squish ui-control-squish-ghost inline-flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[0.6875rem] leading-4 text-text-muted outline-none',
            'hover:text-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)]',
          )}
        >
          <Anthropicon
            name={badge.direction === 'forward' ? 'arrowUpRight' : 'arrowRight'}
            size={12}
          />
          {badge.label}
        </button>
      ))}
    </div>
  );
});
