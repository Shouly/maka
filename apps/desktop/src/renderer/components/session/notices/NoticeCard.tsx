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

// One notice above the composer. Same shape as the welcome surface's readiness
// banner, so a person who has seen one recognizes the next.
//
// `role` is a choice, not a constant: a blocked send is an alert (it interrupts
// what the reader was about to do), and an event stream that reconnected is a
// status (it will resolve itself). Announcing the second one as an alert
// teaches people to ignore the first.

import type { ReactNode } from 'react';
import { Anthropicon } from '../../icons/Anthropicon.js';
import type { AnthropiconName } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { cn } from '../../../lib/cn.js';

export type NoticeTone = 'info' | 'warning' | 'destructive';

const TONE_SURFACE: Record<NoticeTone, string> = {
  info: 'border-hairline bg-surface-2',
  warning: 'border-warning-line bg-warning-subtle',
  destructive: 'border-danger-line bg-danger-subtle',
};

const TONE_ICON: Record<NoticeTone, string> = {
  info: 'text-text-muted',
  warning: 'text-warning',
  destructive: 'text-danger',
};

const TONE_GLYPH: Record<NoticeTone, AnthropiconName> = {
  info: 'info',
  warning: 'warningCircle',
  destructive: 'warningCircle',
};

export interface NoticeAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

export function NoticeCard(props: {
  tone: NoticeTone;
  title: string;
  description?: string;
  actions?: readonly NoticeAction[];
  /** `alert` interrupts; `status` reports. Default follows the tone. */
  role?: 'alert' | 'status';
  children?: ReactNode;
}) {
  const role = props.role ?? (props.tone === 'destructive' ? 'alert' : 'status');
  return (
    <div
      role={role}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3',
        TONE_SURFACE[props.tone],
      )}
    >
      <Anthropicon
        name={TONE_GLYPH[props.tone]}
        size={18}
        className={cn('mt-0.5 shrink-0', TONE_ICON[props.tone])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-text-primary">{props.title}</p>
        {props.description && (
          <p className="mt-0.5 text-sm leading-5 text-text-secondary">{props.description}</p>
        )}
        {props.children}
      </div>
      {(props.actions ?? []).map((action) => (
        <Button
          key={action.label}
          size="sm"
          variant="secondary"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
