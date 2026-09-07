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

// ⌘K.
//
// A dialog with one text field and a grouped result list. Keyboard is the
// point: the field keeps focus the whole time and ArrowUp/Down move a
// highlight through the results rather than focus, so typing never stops. Enter
// runs the highlighted row, Escape closes.
//
// Look is the reference design system's menu surface, reused rather than
// re-styled: the same `menu-variants` row class as every dropdown, so a
// palette row and a menu row are the same object at two sizes.

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.js';
import { menuItemClass, menuSeparatorClass } from '../ui/menu-variants.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { sessionsStore } from '../../store/index.js';
import { useSessionList } from '../../hooks/use-session-list.js';
import {
  buildPaletteCommands,
  buildSessionCommands,
  filterPaletteCommands,
  type PaletteCommand,
  type PaletteCommandInput,
} from './commands.js';

export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandInput: Omit<PaletteCommandInput, 'locale' | 'activeSessionId'>;
}) {
  const locale = useUiLocale();
  const copy = getShellCopy(locale).commandPalette;
  const activeSessionId = useStore(sessionsStore, (state) => state.activeId);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // The list stays live while the palette is open, which is why the rows come
  // from the same model the sidebar renders rather than a snapshot.
  const { model } = useSessionList('');

  useEffect(() => {
    if (props.open) {
      setQuery('');
      setHighlight(0);
    }
  }, [props.open]);

  const commands = useMemo(
    () => [
      ...buildPaletteCommands({ ...props.commandInput, locale, activeSessionId }),
      ...buildSessionCommands({
        locale,
        rows: model.rows,
        activeSessionId,
        onSelectSession: (id) => sessionsStore.select(id),
      }),
    ],
    [props.commandInput, locale, activeSessionId, model.rows],
  );
  const results = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);
  const groups = useMemo(() => {
    const byGroup = new Map<string, PaletteCommand[]>();
    for (const command of results) {
      const bucket = byGroup.get(command.group);
      if (bucket) bucket.push(command);
      else byGroup.set(command.group, [command]);
    }
    return [...byGroup.entries()];
  }, [results]);
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);
  const current = Math.min(highlight, Math.max(0, flat.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-palette-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    props.onOpenChange(false);
    void command.run();
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        data-maka-contract="command-palette"
        className="top-[18%] max-h-[70vh] translate-y-0 md:max-w-xl"
        onOpenAutoFocus={(event) => {
          // Radix would focus the first row; the field is what must have it.
          event.preventDefault();
          listRef.current?.parentElement?.querySelector('input')?.focus();
        }}
      >
        <DialogTitle className="sr-only">{copy.label}</DialogTitle>
        <DialogDescription className="sr-only">{copy.placeholder}</DialogDescription>
        <div className="flex items-center gap-2 text-text-muted">
          <Anthropicon name="search" size={20} />
          <input
            type="text"
            value={query}
            aria-label={copy.searchLabel}
            aria-controls="command-palette-results"
            placeholder={copy.placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlight((index) => Math.min(index + 1, flat.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlight((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(flat[current]);
              }
            }}
            className="min-w-0 flex-1 border-0 bg-transparent text-base leading-6 text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <div className={menuSeparatorClass} />
        <PaletteResults
          ref={listRef}
          groups={groups}
          flat={flat}
          current={current}
          copy={copy}
          onHighlight={setHighlight}
          onRun={run}
        />
        <div className={menuSeparatorClass} />
        {/* The glyphs are symbols, not copy: they name physical keys and read
            the same in every locale, so only the verbs come from the catalog. */}
        <p className="flex gap-4 text-xs leading-4 text-text-muted">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-alpha-1 px-1 font-mono">↑↓</kbd>
            {copy.selectHint}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-alpha-1 px-1 font-mono">↵</kbd>
            {copy.runHint}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded bg-alpha-1 px-1 font-mono">esc</kbd>
            {copy.closeHint}
          </span>
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The result list on its own.
 *
 * Split out because it is the only part of the palette that renders without a
 * portal: Radix mounts dialog content into `document.body` after mount, so a
 * markup test of the whole dialog would assert on nothing. This is the piece
 * worth asserting on — the grouping, the accessible names, and which row is
 * marked selected.
 */
export const PaletteResults = forwardRef<
  HTMLDivElement,
  {
    groups: ReadonlyArray<readonly [string, PaletteCommand[]]>;
    flat: readonly PaletteCommand[];
    current: number;
    copy: { resultsLabel: string; emptyTitle: string; emptyDescription: string };
    onHighlight: (index: number) => void;
    onRun: (command: PaletteCommand) => void;
  }
>(function PaletteResults({ groups, flat, current, copy, onHighlight, onRun }, ref) {
  return (
    <div
      ref={ref}
      id="command-palette-results"
      role="listbox"
      aria-label={copy.resultsLabel}
      className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2"
    >
      {flat.length === 0 ? (
        <div className="px-2 py-8 text-center" role="status">
          <p className="text-sm text-text-primary">{copy.emptyTitle}</p>
          <p className="mt-1 text-sm text-text-muted">{copy.emptyDescription}</p>
        </div>
      ) : (
        groups.map(([group, items]) => (
          <div key={group}>
            <p className="px-2.5 pb-1 pt-2 text-xs leading-4 text-text-muted">{group}</p>
            {items.map((command) => {
              const index = flat.indexOf(command);
              const highlighted = index === current;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={highlighted}
                  aria-label={command.label}
                  data-palette-command={command.id}
                  data-palette-highlighted={highlighted ? 'true' : undefined}
                  onPointerMove={() => onHighlight(index)}
                  onClick={() => onRun(command)}
                  className={cn(
                    menuItemClass,
                    'w-full justify-start gap-2 text-left',
                    highlighted && 'bg-menu-hover',
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center text-text-muted">
                    <Anthropicon name={command.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint && (
                    <span className="ml-2 shrink-0 text-xs text-text-muted">{command.hint}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
});
