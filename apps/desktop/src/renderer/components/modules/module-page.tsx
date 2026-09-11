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

// The frame the three module pages share: Claude's list-page shape — a
// display title in the content column, a toolbar of pill tabs with the
// page's actions on the right, the list below — under the window titlebar,
// which keeps its three columns and its sidebar toggle.
//
// One frame rather than three copies because the two contracts the shell and
// the tests key on — `module-main` on the page and `module-actions` around
// the header's actions — have to be on every page and cannot be on any other
// element. A page that forgot one would look finished and be unreachable.

import type { ReactNode } from 'react';
import { ListPageHeader } from '../ui/list-page.js';

export function ModulePage(props: {
  title: string;
  subtitle?: string;
  /** Header-right controls. Wrapped in the `module-actions` contract node. */
  actions?: ReactNode;
  /** The toolbar's tabs (`ListTabs`), for pages that are one face of a set. */
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="module-main">
      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        {/* Claude's list pages: a 56rem column with 2rem gutters (832px of
            content) whose title row starts 48px below the top. The shell's
            titlebar is those 48px — it is empty above a module page — so the
            column adds nothing; padding here would push the title 48px lower
            than Claude's. An open search takes the whole actions row; the
            other controls hide until it closes (the `has()` rule on the
            actions node). */}
        <div className="mx-auto w-full max-w-4xl px-8">
          <ListPageHeader
            title={props.title}
            {...(props.subtitle ? { subtitle: props.subtitle } : {})}
            {...(props.tabs ? { toolbar: props.tabs } : {})}
            actions={
              <div
                data-maka-contract="module-actions"
                className="flex items-center gap-1 [&:has(>[role=search])>:not([role=search])]:hidden"
              >
                {props.actions}
              </div>
            }
          />
          <div className="pt-4">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

export function ModuleListSkeleton(props: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 pt-4" aria-hidden="true">
      {Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <div key={index} className="h-[3.75rem] w-full animate-pulse rounded-xl bg-skeleton" />
      ))}
    </div>
  );
}
