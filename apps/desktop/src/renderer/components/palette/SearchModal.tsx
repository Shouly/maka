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

// Full-text search across every Host's transcripts.
//
// `data-maka-contract="search-modal"` is a hard contract: `main-window.ts`'s
// diagnostic probe looks for that attribute, and for an OPEN one, to decide
// whether the renderer is showing a modal. A Radix dialog content element
// carrying it satisfies both readings — Radix only mounts the content while
// the dialog is open, so "present" and "open" coincide.
//
// The query is debounced rather than sent per keystroke: `search.thread` walks
// stored transcripts on every Host, which is not a per-character operation.

import { useEffect, useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import type { SearchResult } from '@maka/core/search';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.js';
import { menuItemClass, menuSeparatorClass } from '../ui/menu-variants.js';
import { cn } from '../../lib/cn.js';
import { searchThreads } from '../../bridge/search.js';
import { getPaletteCopy } from '../../locales/palette-copy.js';

const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 30;

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'ready'; results: readonly SearchResult[] }
  | { kind: 'failed'; message: string };

export function SearchModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const copy = getPaletteCopy(useUiLocale()).search;
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  // Every request carries a generation so a slow early query cannot overwrite
  // the answer to a later one.
  const generation = useRef(0);

  useEffect(() => {
    if (props.open) return;
    setQuery('');
    setState({ kind: 'idle' });
    generation.current += 1;
  }, [props.open]);

  useEffect(() => {
    const trimmed = query.trim();
    const request = ++generation.current;
    if (!props.open || trimmed.length === 0) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'searching' });
    const timer = setTimeout(() => {
      void searchThreads({ source: 'thread', query: trimmed, limit: RESULT_LIMIT })
        .then((result) => {
          if (request !== generation.current) return;
          if (Array.isArray(result)) setState({ kind: 'ready', results: result });
          else setState({ kind: 'failed', message: result.message });
        })
        .catch(() => {
          if (request === generation.current) setState({ kind: 'failed', message: copy.failed });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, props.open, copy.failed]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        data-maka-contract="search-modal"
        className="top-[18%] max-h-[70vh] translate-y-0 md:max-w-xl"
      >
        <DialogTitle className="sr-only">{copy.title}</DialogTitle>
        <DialogDescription className="sr-only">{copy.description}</DialogDescription>
        <div className="flex items-center gap-2 text-text-muted">
          <Anthropicon name="search" size={20} />
          <input
            type="search"
            value={query}
            autoFocus
            aria-label={copy.inputLabel}
            aria-controls="search-modal-results"
            placeholder={copy.placeholder}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-base leading-6 text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <div className={menuSeparatorClass} />
        <div
          id="search-modal-results"
          role="listbox"
          aria-label={copy.resultsLabel}
          aria-busy={state.kind === 'searching' || undefined}
          className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2"
        >
          {state.kind === 'idle' && (
            <p className="px-2 py-8 text-center text-sm text-text-muted" role="status">
              {copy.idle}
            </p>
          )}
          {state.kind === 'searching' && (
            <p className="px-2 py-8 text-center text-sm text-text-muted" role="status">
              {copy.searching}
            </p>
          )}
          {state.kind === 'failed' && (
            <p className="px-2 py-8 text-center text-sm text-danger" role="alert">
              {state.message}
            </p>
          )}
          {state.kind === 'ready' && state.results.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-text-muted" role="status">
              {copy.empty}
            </p>
          )}
          {state.kind === 'ready' &&
            state.results.map((result, index) => {
              const target = result.target?.kind === 'thread' ? result.target : undefined;
              return (
                <button
                  key={`${target?.sessionId ?? result.title}:${index}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-label={copy.openResult(result.title)}
                  disabled={!target}
                  onClick={() => {
                    if (!target) return;
                    props.onOpenChange(false);
                    props.onSelectSession(target.sessionId);
                  }}
                  className={cn(menuItemClass, 'w-full items-start justify-start gap-2 py-2 text-left')}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-text-muted">
                    <Anthropicon name="chat" size={20} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm leading-5 text-text-primary">
                      {result.title}
                    </span>
                    {result.snippet && (
                      <span className="line-clamp-2 text-xs leading-4 text-text-muted">
                        {result.snippet}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
