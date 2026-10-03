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

// The console's frame, laid out as Maka's Settings: a rail of grouped pages
// on the left (192px, surface-1, hairline on its right) and the page on the
// right, under a top bar that carries the way back from a detail. The
// signed-in administrator and signing out sit at the foot of the rail.

import { useEffect, useRef, type ReactNode } from 'react';
import type { ConsoleSession } from '../../src/admin-console/types.js';
import { Anthropicon, type AnthropiconName } from '@desktop/components/icons/Anthropicon.js';
import { Toaster } from '@desktop/components/ui/toaster.js';
import { cn } from '@desktop/lib/cn.js';
import { signOut } from './api.js';
import { ConsoleContext, useConsole } from './context.js';
import type { ConsoleCopy, ConsoleLocale } from './copy.js';
import { AuditPage } from './pages/audit.js';
import { MemberDetailPage } from './pages/member-detail.js';
import { MembersPage } from './pages/members.js';
import { ModelProviderPage } from './pages/model-provider.js';
import { ModelProvidersPage } from './pages/model-providers.js';
import { ModelsPage } from './pages/models.js';
import { NotFoundPanel } from './pages/not-found.js';
import { QuotasPage } from './pages/quotas.js';
import { UsagePage } from './pages/usage.js';
import { WebSearchPage } from './pages/web-search.js';
import { navigate, type Route, type Section, sectionOf, useRoute } from './router.js';
import { Avatar, reportFailure } from './ui.js';

const NAV: readonly {
  readonly group: keyof ConsoleCopy['nav']['groups'];
  readonly sections: readonly Section[];
}[] = [
  { group: 'organization', sections: ['members', 'quotas'] },
  { group: 'models', sections: ['model-providers', 'models'] },
  { group: 'tools', sections: ['web-search'] },
  { group: 'records', sections: ['usage', 'audit'] },
];

const ICONS: Readonly<Record<Section, AnthropiconName>> = {
  members: 'users',
  quotas: 'gauge',
  'model-providers': 'buildings',
  models: 'shapes',
  'web-search': 'globe',
  usage: 'usage',
  audit: 'scroll',
};

export function App(props: { locale: ConsoleLocale; copy: ConsoleCopy; session: ConsoleSession }) {
  const route = useRoute();
  const section = sectionOf(route);
  const { copy } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const pageKey =
    route.page === 'member' || route.page === 'model-provider'
      ? `${route.page}:${route.id}`
      : route.page;

  // Each page opens at its top, as each Settings page does.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [pageKey]);
  useEffect(() => {
    document.title = `${section ? copy.nav[section] : copy.notFound.title} · ${copy.product}`;
  }, [copy, section]);

  const back: { label: string; to: Route } | undefined =
    route.page === 'member'
      ? { label: copy.nav.members, to: { page: 'members' } }
      : route.page === 'model-provider'
        ? { label: copy.nav['model-providers'], to: { page: 'model-providers' } }
        : undefined;

  return (
    <ConsoleContext.Provider value={props}>
      <div className="flex h-dvh w-full bg-surface-2 text-sm leading-5 text-text-primary">
        <nav
          aria-label={copy.nav.label}
          className="flex w-56 shrink-0 flex-col border-r-[1px] border-alpha-2 bg-surface-1"
        >
          <div className="flex shrink-0 flex-col gap-0.5 px-5 pt-5 pb-2">
            <span className="text-[0.9375rem] font-semibold leading-5">{copy.product}</span>
            <span className="truncate text-xs leading-[17px] text-text-muted">
              {new URL(props.session.serverUrl).host}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
            {NAV.map((group) => (
              <div key={group.group} className="flex flex-col gap-3">
                <p className="px-2 pt-3 text-xs leading-[17px] text-text-muted">
                  {copy.nav.groups[group.group]}
                </p>
                <ul className="flex flex-col gap-px">
                  {group.sections.map((id) => {
                    const active = id === section;
                    return (
                      <li key={id}>
                        <a
                          href={`/admin/${id}`}
                          aria-current={active ? 'page' : undefined}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                            event.preventDefault();
                            navigate({ page: id });
                          }}
                          className={cn(
                            'flex h-8 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left text-sm leading-5 outline-none transition-colors focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                            active
                              ? 'bg-alpha-2 font-medium text-text-primary'
                              : 'text-text-secondary hover:bg-alpha-1',
                          )}
                        >
                          <Anthropicon
                            name={ICONS[id]}
                            size={20}
                            className="shrink-0 text-text-secondary"
                          />
                          <span className="min-w-0 truncate">{copy.nav[id]}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t-[1px] border-alpha-2 px-3 py-3">
            <Avatar name={props.session.user.name} url={props.session.user.avatarUrl} size={28} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm leading-5">{props.session.user.name}</span>
              <span className="truncate text-xs leading-[17px] text-text-muted">
                {props.session.user.email}
              </span>
            </div>
            <button
              type="button"
              aria-label={copy.nav.signOut}
              title={copy.nav.signOut}
              onClick={() =>
                void signOut().catch((error: unknown) =>
                  reportFailure(copy.nav.signOutFailed, error),
                )
              }
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary outline-none transition-colors hover:bg-alpha-1 hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
            >
              <Anthropicon name="logout" size={20} />
            </button>
          </div>
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[3.25rem] shrink-0 items-center px-8 pt-3 pb-2">
            {back && (
              <button
                type="button"
                aria-label={copy.nav.back(back.label)}
                onClick={() => navigate(back.to)}
                className="-ml-2.5 flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 text-sm leading-5 text-text-primary outline-none transition-colors hover:bg-sidebar-menu-hover focus-visible:shadow-[var(--sidebar-focus-shadow)]"
              >
                <Anthropicon name="arrowLeft" size={16} className="shrink-0" />
                <span className="truncate">{back.label}</span>
              </button>
            )}
          </div>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-8 pt-2 pb-12">
            <div className="mx-auto w-full max-w-[880px]">
              <Page route={route} />
            </div>
          </div>
        </main>
      </div>
      <Toaster />
    </ConsoleContext.Provider>
  );
}

function Page(props: { route: Route }): ReactNode {
  const { route } = props;
  switch (route.page) {
    case 'members':
      return <MembersPage />;
    case 'member':
      return <MemberDetailPage key={route.id} id={route.id} />;
    case 'quotas':
      return <QuotasPage />;
    case 'model-providers':
      return <ModelProvidersPage />;
    case 'model-provider':
      return <ModelProviderPage key={route.id} id={route.id} />;
    case 'models':
      return <ModelsPage />;
    case 'web-search':
      return <WebSearchPage />;
    case 'usage':
      return <UsagePage />;
    case 'audit':
      return <AuditPage />;
    case 'not-found':
      return <NotFoundInConsole />;
  }
}

function NotFoundInConsole() {
  const { copy } = useConsole();
  return (
    <NotFoundPanel
      title={copy.notFound.title}
      body={copy.notFound.body}
      action={copy.notFound.toMembers}
      onAction={() => navigate({ page: 'members' })}
    />
  );
}
