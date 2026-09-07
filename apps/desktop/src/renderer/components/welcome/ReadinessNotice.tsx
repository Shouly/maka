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

// Why the next task cannot be submitted, said before it is attempted.
//
// `deriveTaskReadinessNotice` is the ported rule: only runtime and workspace
// blockers get a banner, because model blockers already have a connection-
// specific recovery surface of their own and two banners saying overlapping
// things is worse than one.

import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { cn } from '../../lib/cn.js';
import { newTaskStore } from '../../store/index.js';
import { deriveTaskReadinessNotice } from '../../lib/ported/task-readiness-notice.js';

export function ReadinessNotice(props: { onOpenWorkspacePicker: () => void }) {
  const locale = useUiLocale();
  const readiness = useStore(newTaskStore, (state) => state.readiness);
  const notice = deriveTaskReadinessNotice(readiness, locale);
  if (!notice) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3',
        notice.tone === 'destructive'
          ? 'border-danger-line bg-danger-subtle'
          : 'border-warning-line bg-warning-subtle',
      )}
    >
      <Anthropicon
        name="warningCircle"
        size={18}
        className={cn(
          'mt-0.5 shrink-0',
          notice.tone === 'destructive' ? 'text-danger' : 'text-warning',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-text-primary">{notice.title}</p>
        <p className="mt-0.5 text-sm leading-5 text-text-secondary">{notice.description}</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (notice.action === 'workspace_picker') props.onOpenWorkspacePicker();
          else void newTaskStore.refresh();
        }}
      >
        {notice.actionLabel}
      </Button>
    </div>
  );
}
