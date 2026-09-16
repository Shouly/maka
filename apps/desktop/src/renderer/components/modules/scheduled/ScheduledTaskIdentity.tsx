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

// The path to one scheduled task, drawn in the WINDOW TITLEBAR.
//
// The reference puts this path in its window's top row, beside the window
// controls rather than above the page's own title, and Maka's titlebar already
// takes an `identity` for exactly that. It is built from `MainHeader`'s own
// pieces rather than from a private copy of them, so it is the same 28px
// control, the same 14px text and the same faint `/` the session header uses —
// the two are the same row saying the same kind of thing.
//
// `maka-no-drag` is not optional: the titlebar is the app's only drag surface,
// and a control without it is dragged rather than clicked.

import { useStore } from 'zustand';
import { getScheduledTaskCopy, useUiLocale } from '@maka/ui';
import { MainHeaderBreadcrumb, MainHeaderTitleLabel } from '../../layout/MainHeader.js';
import {
  openScheduledTaskDetail,
  scheduledTaskDetailStore,
  scheduledTasksStore,
} from '../../../store/index.js';

export function ScheduledTaskIdentity() {
  const catalog = getScheduledTaskCopy(useUiLocale());
  const taskId = useStore(scheduledTaskDetailStore, (state) => state.taskId);
  const tasks = useStore(scheduledTasksStore, (state) => state.data);
  const task = taskId ? tasks?.find((row) => row.id === taskId) : undefined;
  // The list page owns the whole row when no task is open.
  if (!task) return null;
  return (
    <div
      data-maka-contract="titlebar-identity"
      className="flex min-w-0 items-center text-sm leading-5 text-sidebar-text-primary"
    >
      {/* The WHOLE path is medium, both halves — measured off the reference,
          where each crumb is 14px/500. It is the page's identity, not ordinary
          navigation text, which is why it is heavier than the session header's
          own title beside it. */}
      <MainHeaderBreadcrumb
        onClick={() => openScheduledTaskDetail(null)}
        linkClassName="maka-no-drag font-medium"
      >
        <span className="min-w-0 truncate">{catalog.page.title}</span>
      </MainHeaderBreadcrumb>
      <MainHeaderTitleLabel weight="medium" className="shrink">
        <span className="min-w-0 truncate">{task.title}</span>
      </MainHeaderTitleLabel>
    </div>
  );
}
