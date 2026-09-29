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

// Setting one allowance: a number of units, or none — which for the
// organization means unlimited and for a person means the default again.

import { useEffect, useState } from 'react';
import { SettingsModal, SettingsModalField } from '@desktop/components/settings/settings-kit.js';
import { Button } from '@desktop/components/ui/button.js';
import { Input } from '@desktop/components/ui/input.js';
import { useConsole } from '../context.js';

export function QuotaDialog(props: {
  open: boolean;
  title: string;
  value: number | null;
  /** The label of the way to set none: "Unlimited" or "Use the default". */
  clearLabel: string;
  onClose: () => void;
  onSave: (limit: number | null) => Promise<void>;
}) {
  const { copy } = useConsole();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setDraft(props.value === null ? '' : String(props.value));
    setInvalid(false);
  }, [props.open, props.value]);

  const save = (limit: number | null) => {
    // Enter while the last save is still out would send it twice.
    if (saving) return;
    setSaving(true);
    void props
      .onSave(limit)
      .then(props.onClose)
      // The page has already said why; the dialog stays open to try again.
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  const submit = () => {
    const limit = Number(draft.trim());
    if (draft.trim() === '' || !Number.isFinite(limit) || limit < 0) {
      setInvalid(true);
      return;
    }
    save(limit);
  };

  return (
    <SettingsModal
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="sm"
      title={props.title}
      description={copy.quotas.units}
      footer={
        <>
          <Button variant="ghost" disabled={saving} className="mr-auto" onClick={() => save(null)}>
            {props.clearLabel}
          </Button>
          <Button variant="secondary" disabled={saving} onClick={props.onClose}>
            {copy.common.cancel}
          </Button>
          <Button disabled={saving} onClick={submit}>
            {saving ? copy.common.saving : copy.common.save}
          </Button>
        </>
      }
    >
      <SettingsModalField
        label={copy.quotas.limit}
        htmlFor="quota-limit"
        hint={invalid ? <span className="text-danger">{copy.quotas.invalidLimit}</span> : undefined}
      >
        <Input
          id="quota-limit"
          inputMode="numeric"
          autoFocus
          value={draft}
          placeholder={copy.quotas.limitPlaceholder}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') submit();
          }}
        />
      </SettingsModalField>
    </SettingsModal>
  );
}
