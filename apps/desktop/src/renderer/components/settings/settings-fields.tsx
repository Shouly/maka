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

// Text fields for settings rows that write when the person is done, not on
// every keystroke. The single-line field commits on Enter and blur, and Escape
// puts back what is stored; its local value is re-seeded whenever the stored
// one changes, so a write that failed (or that was sanitized) shows what is
// actually stored rather than what was typed. The multi-line field writes only
// when its own "Save changes" is pressed.

import { useEffect, useState } from 'react';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Textarea } from '../ui/textarea.js';
import { settingsFieldWidthClass } from './settings-row.js';

function useCommittedValue(persisted: string, onCommit: (value: string) => void) {
  const [value, setValue] = useState(persisted);
  useEffect(() => setValue(persisted), [persisted]);
  const commit = () => {
    const next = value.trim();
    if (next === persisted) return;
    onCommit(next);
  };
  return { value, setValue, commit, revert: () => setValue(persisted) };
}

/** A single-line field, 224px wide, at the right of a settings row. */
export function CommittedInput(props: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const field = useCommittedValue(props.value, props.onCommit);
  return (
    <Input
      aria-label={props.label}
      className={settingsFieldWidthClass}
      value={field.value}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      disabled={props.disabled}
      onChange={(event) => field.setValue(event.target.value)}
      onBlur={field.commit}
      onKeyDown={(event) => {
        // A composing IME's Enter confirms a candidate; it is not a submit.
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') field.commit();
        if (event.key === 'Escape') field.revert();
      }}
    />
  );
}

/**
 * A multi-line field under its row's title, as wide as the row (the
 * instructions field). Typing and leaving the field write nothing: an
 * edit grows "Save changes" and "Discard" under it, and only Save writes.
 */
export function DraftTextarea(props: {
  id?: string;
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  saveLabel: string;
  discardLabel: string;
  /** Resolves once written; a rejection (the caller reports it) keeps the draft. */
  onSave: (value: string) => Promise<void>;
}) {
  // null while nothing is being edited: the field shows what is stored.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== null && draft !== props.value;
  const save = async (value: string) => {
    setSaving(true);
    try {
      await props.onSave(value);
      // Show what was stored (the server trims it) — unless typing went on.
      setDraft((current) => (current === value ? null : current));
    } catch {
      // Already reported by the caller; the draft stays for another try.
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex w-full flex-col gap-3">
      {/* Grows with its text from 88px to 160px, then scrolls; no resize grip. */}
      <Textarea
        id={props.id}
        aria-label={props.label}
        className="field-sizing-content min-h-[88px] max-h-40 w-full resize-none"
        value={draft ?? props.value}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        disabled={props.disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      {dirty && (
        // 28px buttons: 14px text, 10px sides, radius 7.
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            className="rounded-[7px] text-sm"
            disabled={saving}
            onClick={() => {
              if (draft !== null) void save(draft);
            }}
          >
            {props.saveLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-[7px] text-sm"
            disabled={saving}
            onClick={() => setDraft(null)}
          >
            {props.discardLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
