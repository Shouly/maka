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

// Renaming in place, on the row itself.
//
// Not a dialog: renaming a task is a one-word edit, and a modal for it costs
// two extra keystrokes and takes the list away while you are looking at it to
// decide what the new name should be. Enter commits, Escape reverts, blur
// commits (a click elsewhere means "done", not "discard"), and an empty or
// unchanged value is a no-op rather than a rename to nothing.

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/cn.js';

export function InlineRename(props: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
  onCancel: (restoreFocus?: boolean) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards the blur handler: committing removes the input, which fires blur.
  const settled = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const name = draft.trim();
    if (!name || name === props.value) props.onCancel(false);
    else props.onCommit(name);
  };
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    props.onCancel(true);
  };
  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={props.label}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
      className={cn(
        'h-7 w-full min-w-0 rounded-md bg-surface-2 px-1.5 text-sm leading-[21px] text-text-primary shadow-[var(--field-shadow)] outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
        props.className,
      )}
    />
  );
}
