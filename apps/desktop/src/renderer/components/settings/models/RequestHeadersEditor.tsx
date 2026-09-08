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

// Extra HTTP headers this connection sends, edited without ever showing what
// they say.
//
// A header value is a credential: gateways authenticate with them, and the
// Host stores them in the same vault as the API key and never projects them
// back. So a saved header arrives as a NAME with no value, and the editor has
// a third state per row beyond "empty" and "typed" — RETAINED, meaning "leave
// whatever is stored alone". Without it the only way to keep a header would be
// to retype a secret the user cannot see, and the common edit (rename a header,
// add a second one) would silently blank the first one's value.

import { useState } from 'react';
import { normalizeRequestHeaderUpdates } from '@maka/core/runtime-policy';
import type { RequestHeaderUpdate } from '@maka/core/llm-connections';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';

export interface RequestHeaderDraft {
  readonly id: number;
  readonly name: string;
  readonly value: string;
  /** True while the row still stands for a stored value the user has not replaced. */
  readonly retained: boolean;
}

export function savedRequestHeaderDrafts(names: readonly string[]): RequestHeaderDraft[] {
  return names.map((name, index) => ({ id: index + 1, name, value: '', retained: true }));
}

/**
 * The wire form of the drafts. A retained row with nothing typed sends only its
 * name, which is how the Host is told to keep the stored value; every other row
 * sends name and value, and an absent row is a deletion.
 */
export function requestHeaderUpdates(
  drafts: readonly RequestHeaderDraft[],
): readonly RequestHeaderUpdate[] {
  return normalizeRequestHeaderUpdates(
    drafts
      .filter((draft) => draft.name.trim().length > 0)
      .map(({ name, value, retained }) =>
        retained && value.length === 0 ? { name: name.trim() } : { name: name.trim(), value },
      ),
  );
}

export function RequestHeadersEditor(props: {
  headers: readonly RequestHeaderDraft[];
  onChange: (headers: RequestHeaderDraft[]) => void;
  disabled?: boolean;
}) {
  const copy = getSettingsModelsCopy(useUiLocale()).detail;
  const [nextId, setNextId] = useState(
    () => props.headers.reduce((highest, header) => Math.max(highest, header.id), 0) + 1,
  );

  const update = (id: number, patch: Partial<RequestHeaderDraft>) => {
    props.onChange(
      props.headers.map((header) => (header.id === id ? { ...header, ...patch } : header)),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {props.headers.length === 0 && (
        <p className="text-[13px] leading-[18px] text-text-muted">{copy.noRequestHeaders}</p>
      )}
      {props.headers.map((header) => (
        <div key={header.id} className="flex items-center gap-2">
          <Input
            aria-label={copy.headerName}
            placeholder={copy.headerName}
            className="w-48"
            disabled={props.disabled}
            value={header.name}
            onChange={(event) => update(header.id, { name: event.target.value })}
          />
          <Input
            aria-label={copy.headerValue}
            // A retained row advertises that a value is stored rather than
            // showing a fake one: an input pre-filled with dots is
            // indistinguishable from a real short value the user typed.
            placeholder={header.retained ? copy.retainedHeaderValue : copy.headerValue}
            className="min-w-0 flex-1"
            type="password"
            autoComplete="off"
            disabled={props.disabled}
            value={header.value}
            onChange={(event) => update(header.id, { value: event.target.value, retained: false })}
          />
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={copy.removeHeader}
            disabled={props.disabled}
            onClick={() => props.onChange(props.headers.filter((entry) => entry.id !== header.id))}
          >
            <Anthropicon name="trash" size={16} />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={props.disabled}
          onClick={() => {
            props.onChange([
              ...props.headers,
              { id: nextId, name: '', value: '', retained: false },
            ]);
            setNextId(nextId + 1);
          }}
        >
          {copy.addHeader}
        </Button>
      </div>
    </div>
  );
}
