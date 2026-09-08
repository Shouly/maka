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

// Picking a folder on a machine that is not this one.
//
// A native file dialog can only browse the Desktop's own filesystem, so a
// project on a remote Runtime Host is chosen through the Host's published
// roots instead. The Host decides what is reachable (`getDirectoryRoots`); the
// renderer only walks what it is given, and every entry it lists is a
// directory by construction — `DesktopProjectDirectoryEntry` carries a name
// and nothing else.
//
// What gets registered is the folder currently OPEN, not a selected row: the
// breadcrumb is the selection, which is why there is no per-row "choose"
// affordance and why the primary button reads "add this folder".

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRecord } from '@maka/core/project';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import { cn } from '../../lib/cn.js';
import {
  getProjectDirectoryRoots,
  listProjectDirectory,
  registerProjectDirectory,
  type DesktopProjectDirectoryEntry,
  type DesktopProjectDirectoryRoot,
  type DesktopRuntimeHostRef,
} from '../../bridge/projects.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getShellCopy, localizedShellErrorMessage } from '../../locales/shell-copy.js';

export function DirectoryBrowserDialog(props: {
  open: boolean;
  host: DesktopRuntimeHostRef | undefined;
  hostName: string | undefined;
  onOpenChange: (open: boolean) => void;
  onRegistered: (project: ProjectRecord) => void;
}) {
  const locale = useUiLocale();
  const copy = getShellCopy(locale).projectActions;
  const own = getSettingsCopy(locale).workspace;
  const shared = getSettingsSharedCopy(locale);
  const [roots, setRoots] = useState<readonly DesktopProjectDirectoryRoot[]>([]);
  const [root, setRoot] = useState<DesktopProjectDirectoryRoot | undefined>(undefined);
  const [segments, setSegments] = useState<readonly string[]>([]);
  const [entries, setEntries] = useState<readonly DesktopProjectDirectoryEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // Monotonic: a reply for a folder the user has already navigated away from
  // must not repaint the list.
  const request = useRef(0);
  const host = props.host;
  const open = props.open;

  const load = useCallback(
    async (target: { root: DesktopProjectDirectoryRoot; segments: readonly string[] }) => {
      if (!host) return;
      const sequence = ++request.current;
      setLoading(true);
      setError(undefined);
      try {
        const listed = await listProjectDirectory(
          { rootId: target.root.id, segments: [...target.segments] },
          host,
        );
        if (sequence !== request.current) return;
        setRoot(target.root);
        setSegments(target.segments);
        setEntries(listed);
      } catch (cause) {
        if (sequence === request.current)
          setError(localizedShellErrorMessage(cause, copy.readPathFailedFallback, locale));
      } finally {
        if (sequence === request.current) setLoading(false);
      }
    },
    [host, copy.readPathFailedFallback, locale],
  );

  useEffect(() => {
    if (!open || !host) return;
    const sequence = ++request.current;
    setRoots([]);
    setRoot(undefined);
    setSegments([]);
    setEntries([]);
    setShowHidden(false);
    setLoading(true);
    setError(undefined);
    void getProjectDirectoryRoots(host)
      .then(async (published) => {
        if (sequence !== request.current) return;
        setRoots(published);
        const first = published[0];
        if (!first) throw new Error('Runtime Host did not publish a project directory');
        const listed = await listProjectDirectory({ rootId: first.id, segments: [] }, host);
        if (sequence !== request.current) return;
        setRoot(first);
        setSegments([]);
        setEntries(listed);
      })
      .catch((cause: unknown) => {
        if (sequence === request.current)
          setError(localizedShellErrorMessage(cause, copy.readPathFailedFallback, locale));
      })
      .finally(() => {
        if (sequence === request.current) setLoading(false);
      });
    return () => {
      request.current += 1;
    };
  }, [open, host, copy.readPathFailedFallback, locale]);

  const visible = showHidden ? entries : entries.filter((entry) => !entry.name.startsWith('.'));
  const busy = loading || registering;

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="md:max-w-[560px]">
        <DialogHeader closeLabel={shared.close}>
          <DialogTitle>{copy.remoteDirectoryTitle(props.hostName ?? 'Runtime Host')}</DialogTitle>
          <DialogDescription>{own.directoryBrowserOpen}</DialogDescription>
        </DialogHeader>

        <nav
          aria-label={copy.remoteDirectoryBreadcrumbs}
          className="flex flex-wrap items-center gap-1"
        >
          {roots.map((candidate) => (
            <Button
              key={candidate.id}
              variant={candidate.id === root?.id ? 'secondary' : 'ghost'}
              size="sm"
              disabled={busy}
              onClick={() => void load({ root: candidate, segments: [] })}
            >
              {candidate.label || copy.remoteDirectoryHome}
            </Button>
          ))}
          {segments.map((segment, index) => (
            <Button
              key={`${index}:${segment}`}
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (root) void load({ root, segments: segments.slice(0, index + 1) });
              }}
            >
              {segment}
            </Button>
          ))}
        </nav>

        <div className="max-h-[320px] min-h-[160px] overflow-y-auto rounded-xl border border-hairline">
          {error !== undefined ? (
            <div className="flex flex-col items-start gap-2 p-4" role="alert">
              <p className="text-sm leading-5 text-danger">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (root) void load({ root, segments });
                }}
              >
                {copy.remoteDirectoryRetry}
              </Button>
            </div>
          ) : loading ? (
            <p className="p-4 text-sm leading-5 text-text-muted" role="status">
              {copy.remoteDirectoryLoading}
            </p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-sm leading-5 text-text-muted" role="status">
              {copy.remoteDirectoryEmpty}
            </p>
          ) : (
            <ul className="flex flex-col p-1">
              {visible.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (root) void load({ root, segments: [...segments, entry.name] });
                    }}
                    className={cn(
                      'flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm leading-5',
                      'text-text-secondary outline-none transition-colors hover:bg-alpha-1 hover:text-text-primary',
                      'focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-not-allowed',
                    )}
                  >
                    <Anthropicon name="folder" size={16} className="shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="md:justify-between">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showHidden}
            onClick={() => setShowHidden((value) => !value)}
          >
            {showHidden ? copy.remoteDirectoryHideHidden : copy.remoteDirectoryShowHidden}
          </Button>
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
              {copy.remoteDirectoryCancel}
            </Button>
            <Button
              disabled={!root || busy}
              onClick={() => {
                if (!root || !host) return;
                setRegistering(true);
                request.current += 1;
                void registerProjectDirectory({ rootId: root.id, segments: [...segments] }, host)
                  .then((project) => {
                    props.onRegistered(project);
                    props.onOpenChange(false);
                  })
                  .catch((cause: unknown) =>
                    setError(
                      localizedShellErrorMessage(cause, copy.projectUpdateFailedFallback, locale),
                    ),
                  )
                  .finally(() => setRegistering(false));
              }}
            >
              {copy.remoteDirectorySelect}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
