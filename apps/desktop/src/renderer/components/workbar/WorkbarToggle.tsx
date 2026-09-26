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

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { TextShimmer } from '../ui/text-shimmer.js';
import { useSessionArtifacts } from '../../hooks/use-session-artifacts.js';
import { currentTaskIndex, useTaskProgress } from '../../hooks/use-task-progress.js';
import { useShellLiveTurn } from '../../hooks/use-workspace.js';
import { cn } from '../../lib/cn.js';
import { getSessionPanelCopy } from '../../locales/session-panel-copy.js';
import type { WorkbarModel } from '../../hooks/use-workbar.js';

// The header switch for the session panel. Bare, it is an icon. While a task
// is under way it says which step ("Step 2 of 4") — sweeping while a turn
// works on it — and otherwise how many files the session has produced: the
// reference's badge, read the same way whether the panel is open or not. It
// sweeps only while the panel is out of sight: showing, the panel's running
// task sweeps the same step, and one sweep is enough.
export function WorkbarToggle(props: {
  sessionId: string;
  workbar: WorkbarModel;
  /** The session panel is on screen, opened or peeking. */
  panelShowing: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const outputs = useSessionArtifacts(props.sessionId);
  const progress = useTaskProgress(props.sessionId);
  const live = useShellLiveTurn(props.sessionId).turnActive;
  const sweeping = live && !props.panelShowing;
  const { collapsed } = props.workbar;
  const label = copy.label;
  const current = currentTaskIndex(progress.tasks);
  const step = current >= 0 ? copy.stepOf(current + 1, progress.tasks.length) : undefined;
  const hasCount = step === undefined && outputs.loaded && outputs.records.length > 0;
  const badged = step !== undefined || hasCount;
  return (
    <Button
      variant="ghost"
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      size="iconSm"
      onClick={
        collapsed && props.workbar.workbarHasColumn
          ? props.workbar.showActivity
          : props.workbar.toggle
      }
      aria-label={label}
      aria-expanded={!collapsed}
      data-state={collapsed ? 'closed' : 'open'}
      aria-description={step ?? (hasCount ? copy.outputCount(outputs.records.length) : undefined)}
      aria-controls="maka-session-panel"
      aria-keyshortcuts="Meta+Alt+S"
      data-maka-contract="session-workbar-toggle"
      className={cn(
        'maka-no-drag text-sm leading-5 font-normal tabular-nums',
        badged && 'w-auto max-w-[16rem] gap-1 px-2.5',
      )}
    >
      <Anthropicon
        name="tasks"
        size={18}
        weight={577.75}
        className={cn('shrink-0', badged && '-ml-1')}
      />
      {/* Hidden from readers: the switch's description already says it. */}
      {step !== undefined && (
        <span
          aria-hidden="true"
          data-maka-activity-step={live ? 'live' : 'stopped'}
          className="min-w-0 truncate text-[var(--progress-current-text)]"
        >
          {sweeping ? (
            <TextShimmer className="max-w-full truncate [--base-color:var(--progress-current-text)]">
              {step}
            </TextShimmer>
          ) : (
            step
          )}
        </span>
      )}
      {hasCount && (
        <span aria-hidden="true" data-maka-activity-count="">
          {outputs.records.length}
        </span>
      )}
    </Button>
  );
}
