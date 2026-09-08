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

// The frame the three module pages share.
//
// It replaces the CONTENT column and nothing else (plan §2.12): the window
// titlebar above keeps its three columns and its sidebar toggle, and the page
// starts below it. `MainHeader` is the same 48px row the conversation uses, so
// a module page and a task read as the same application rather than as two.
//
// One frame rather than three copies because the two contracts the shell and
// the tests key on — `module-main` on the page and `module-actions` on the
// header's right slot — have to be on every page and cannot be on any other
// element. A page that forgot one would look finished and be unreachable.

import type { ReactNode } from 'react';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { MainHeader } from '../layout/MainHeader.js';

export function ModulePage(props: {
  title: string;
  icon: AnthropiconName;
  /** Header-right controls. Wrapped in the `module-actions` contract node. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="module-main">
      <MainHeader
        contextIcon={<Anthropicon name={props.icon} size={16} />}
        title={<span className="px-2.5 font-medium">{props.title}</span>}
        actions={
          <div data-maka-contract="module-actions" className="flex items-center gap-1">
            {props.actions}
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto w-full max-w-3xl pt-6">{props.children}</div>
      </div>
    </div>
  );
}

/**
 * The one-line lead under a page's header.
 *
 * Separate from `SettingsSection`'s description because it describes the PAGE,
 * not the first group on it — a section title immediately under the page title
 * would say the same word twice.
 */
export function ModuleLead(props: { children: ReactNode }) {
  return <p className="mb-6 text-sm leading-5 text-text-secondary">{props.children}</p>;
}

/** A row of skeletons standing in for a list that has not arrived. */
export function ModuleListSkeleton(props: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <div key={index} className="h-14 w-full animate-pulse rounded-xl bg-skeleton" />
      ))}
    </div>
  );
}

/** What a list says when it is empty, in the shape the reference design uses. */
export function ModuleEmpty(props: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-hairline px-6 py-10 text-center">
      <p className="text-sm leading-5 text-text-primary">{props.title}</p>
      {props.body && <p className="text-[13px] leading-[18px] text-text-secondary">{props.body}</p>}
      {props.action}
    </div>
  );
}
