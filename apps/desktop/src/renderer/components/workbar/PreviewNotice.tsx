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

// One look for every "there is nothing drawn here, and this is why".
//
// Ported from the reference design system's `file-preview/PreviewNotice`, for
// the reason its own comment gives: the wording differs per face, the layout
// must not. Every face in the pane — an empty artifact list, a diff that could
// not be read, a session with no trace, a browser with no page — renders this
// rather than its own centred paragraph.
//
// `tone="danger"` is for a FAILURE. An absence is `muted`: a task that wrote no
// files has not gone wrong, and colouring it red would teach the reader to
// ignore the colour.

import type { ReactNode } from 'react';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { cn } from '../../lib/cn.js';

export interface PreviewNoticeAction {
  label: string;
  icon?: AnthropiconName;
  onClick: () => void;
  pending?: boolean;
}

export function PreviewNotice(props: {
  title: string;
  detail?: string;
  hint?: string;
  icon?: AnthropiconName;
  tone?: 'muted' | 'danger';
  action?: PreviewNoticeAction;
  children?: ReactNode;
  role?: 'status' | 'alert';
}) {
  const tone = props.tone ?? 'muted';
  return (
    <div
      className="flex h-full min-h-[200px] items-center justify-center p-4"
      role={props.role ?? 'status'}
      {...(props.role === undefined ? { 'aria-live': 'polite' as const } : {})}
    >
      <div className="max-w-md px-4 text-center">
        {props.icon && (
          <div className="mb-3 flex justify-center text-text-muted" aria-hidden="true">
            <Anthropicon name={props.icon} size={32} />
          </div>
        )}
        <div
          className={cn(
            'mb-2 text-base font-medium leading-6',
            tone === 'danger' ? 'text-danger' : 'text-text-primary',
          )}
        >
          {props.title}
        </div>
        {props.detail && (
          <div className="mb-1 break-words text-sm leading-5 text-text-secondary">
            {props.detail}
          </div>
        )}
        {props.hint && <div className="mb-4 text-xs leading-4 text-text-muted">{props.hint}</div>}
        {props.action && (
          <Button
            variant="outline"
            size="sm"
            onClick={props.action.onClick}
            disabled={props.action.pending}
          >
            {props.action.icon && <Anthropicon name={props.action.icon} size={16} />}
            {props.action.label}
          </Button>
        )}
        {props.children}
      </div>
    </div>
  );
}
