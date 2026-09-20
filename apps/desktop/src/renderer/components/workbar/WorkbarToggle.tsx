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
import { useSessionArtifacts } from '../../hooks/use-session-artifacts.js';
import { cn } from '../../lib/cn.js';
import { getSessionPanelCopy } from '../../locales/session-panel-copy.js';
import type { WorkbarModel } from '../../hooks/use-workbar.js';

export function WorkbarToggle(props: {
  sessionId: string;
  workbar: WorkbarModel;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const outputs = useSessionArtifacts(props.sessionId);
  const { collapsed } = props.workbar;
  const label = copy.label;
  const hasCount = outputs.loaded && outputs.records.length > 0;
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
      aria-description={hasCount ? copy.outputCount(outputs.records.length) : undefined}
      aria-controls="maka-session-panel"
      aria-keyshortcuts="Meta+Alt+S"
      data-maka-contract="session-workbar-toggle"
      className={cn(
        'maka-no-drag text-sm leading-5 font-normal tabular-nums',
        hasCount && 'w-auto gap-1 px-2.5',
      )}
    >
      <Anthropicon
        name="tasks"
        size={18}
        weight={577.75}
        className={hasCount ? '-ml-1' : undefined}
      />
      {hasCount && (
        <span aria-hidden="true" data-maka-activity-count="">
          {outputs.records.length}
        </span>
      )}
    </Button>
  );
}
