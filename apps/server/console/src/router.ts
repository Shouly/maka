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

// Where the console is: a path under /admin, read and written through the
// History API. The server answers every such path with the page.

import { useSyncExternalStore } from 'react';

export type Route =
  | { readonly page: 'members' }
  | { readonly page: 'member'; readonly id: string }
  | { readonly page: 'quotas' }
  | { readonly page: 'models' }
  | { readonly page: 'model'; readonly id: string }
  | { readonly page: 'upstreams' }
  | { readonly page: 'usage' }
  | { readonly page: 'audit' }
  /** A console path that names no page. */
  | { readonly page: 'not-found' };

export type Section = 'members' | 'quotas' | 'models' | 'upstreams' | 'usage' | 'audit';

const BASE = '/admin';

/** A path names a page exactly: a list, or a list and one encoded id. */
export function parseRoute(pathname: string): Route {
  const parts = pathname
    .replace(/^\/admin\/?/, '')
    .split('/')
    .filter(Boolean);
  const [head, encoded, ...rest] = parts;
  if (rest.length > 0) return { page: 'not-found' };
  let id: string | undefined;
  try {
    id = encoded === undefined ? undefined : decodeURIComponent(encoded);
  } catch {
    return { page: 'not-found' };
  }
  switch (head) {
    case 'members':
      return id ? { page: 'member', id } : { page: 'members' };
    case 'models':
      return id ? { page: 'model', id } : { page: 'models' };
    case 'quotas':
    case 'upstreams':
    case 'usage':
    case 'audit':
      return id ? { page: 'not-found' } : { page: head };
    case undefined:
      return { page: 'members' };
    default:
      return { page: 'not-found' };
  }
}

export function routePath(route: Route): string {
  switch (route.page) {
    case 'member':
      return `${BASE}/members/${encodeURIComponent(route.id)}`;
    case 'model':
      return `${BASE}/models/${encodeURIComponent(route.id)}`;
    case 'not-found':
      return window.location.pathname;
    default:
      return `${BASE}/${route.page}`;
  }
}

/** The nav entry a route belongs to; none for a path that names no page. */
export function sectionOf(route: Route): Section | undefined {
  if (route.page === 'member') return 'members';
  if (route.page === 'model') return 'models';
  if (route.page === 'not-found') return undefined;
  return route.page;
}

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => {
  for (const listener of listeners) listener();
});

export function navigate(route: Route): void {
  const path = routePath(route);
  if (path !== window.location.pathname) window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => window.location.pathname,
  );
  return parseRoute(pathname);
}
