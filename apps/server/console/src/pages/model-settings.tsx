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

// One organization model, as both pages that list models change it: its
// settings (the name people see, the allowance rate, the order), its switch,
// and deleting it. Every write carries the revision the page last read; a
// refusal because it changed elsewhere reads the list again and says so.

import { useEffect, useRef, useState } from 'react';
import type { ConsoleModel, ConsoleModelPatch } from '../../../src/admin-console/types.js';
import { SettingsModal, SettingsModalField } from '@desktop/components/settings/settings-kit.js';
import { Button } from '@desktop/components/ui/button.js';
import { ConfirmDialog } from '@desktop/components/ui/confirm-dialog.js';
import { Input } from '@desktop/components/ui/input.js';
import { api, segment } from '../api.js';
import { useConsole } from '../context.js';
import { formatNumber } from '../format.js';
import { reportWriteFailure } from '../ui.js';
import {
  COST_WEIGHT_MAX,
  DISPLAY_NAME_MAX,
  isCostWeight,
  isDisplayName,
  isSortOrder,
  SORT_ORDER_MAX,
} from '../validation.js';

/** Change one model; the answer is the model as it now is. */
export function patchModel(
  model: ConsoleModel,
  patch: Omit<ConsoleModelPatch, 'expectedRevision'>,
): Promise<ConsoleModel> {
  return api.patch<ConsoleModel>(`/models/${segment(model.id)}`, {
    expectedRevision: model.revision,
    ...patch,
  } satisfies ConsoleModelPatch);
}

/** A list with one model put back as the server answered it. */
export function withModel(models: readonly ConsoleModel[], next: ConsoleModel): ConsoleModel[] {
  return models.map((model) => (model.id === next.id ? next : model));
}

type FieldErrors = { name?: string; weight?: string; order?: string };
type Fields = { name: string; weight: string; order: string };

const fieldsOf = (model: ConsoleModel): Fields => ({
  name: model.displayName,
  weight: String(model.costWeight),
  order: String(model.sortOrder),
});

/**
 * Open while `model` is set. When it is read again while open (it changed
 * elsewhere), the fields not typed in take the new values; what was typed stays.
 */
export function ModelSettingsDialog(props: {
  model: ConsoleModel | undefined;
  onClose: () => void;
  onSaved: (model: ConsoleModel) => void;
  /** It changed elsewhere: read the list again. */
  onStale: () => void;
}) {
  const { copy, locale } = useConsole();
  const text = copy.model;
  const { model } = props;
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [order, setOrder] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const latest = useRef(model);
  latest.current = model;
  const seeded = useRef<Fields & { id: string }>(undefined);
  const openedId = model?.id;
  const revision = model?.revision;

  // Each opening starts from the model as it is.
  useEffect(() => {
    const current = latest.current;
    if (!current) return;
    const fields = fieldsOf(current);
    seeded.current = { id: current.id, ...fields };
    setName(fields.name);
    setWeight(fields.weight);
    setOrder(fields.order);
    setErrors({});
  }, [openedId]);

  useEffect(() => {
    const current = latest.current;
    const before = seeded.current;
    if (!current || !before || before.id !== current.id || revision === undefined) return;
    const fields = fieldsOf(current);
    seeded.current = { id: current.id, ...fields };
    setName((typed) => (typed === before.name ? fields.name : typed));
    setWeight((typed) => (typed === before.weight ? fields.weight : typed));
    setOrder((typed) => (typed === before.order ? fields.order : typed));
  }, [revision]);

  const close = () => {
    if (!inFlight.current) props.onClose();
  };

  const submit = () => {
    if (!model || inFlight.current) return;
    const displayName = name.trim();
    const costWeight = Number(weight.trim());
    const sortOrder = Number(order.trim());
    const invalid: FieldErrors = {
      ...(!displayName
        ? { name: text.invalidName }
        : isDisplayName(displayName)
          ? {}
          : { name: text.nameTooLong(formatNumber(locale, DISPLAY_NAME_MAX)) }),
      ...(weight.trim() !== '' && isCostWeight(costWeight)
        ? {}
        : { weight: text.invalidWeight(formatNumber(locale, COST_WEIGHT_MAX)) }),
      ...(order.trim() !== '' && isSortOrder(sortOrder)
        ? {}
        : { order: text.invalidOrder(formatNumber(locale, SORT_ORDER_MAX)) }),
    };
    if (invalid.name || invalid.weight || invalid.order) {
      setErrors(invalid);
      return;
    }
    const patch = {
      ...(displayName !== model.displayName ? { displayName } : {}),
      ...(costWeight !== model.costWeight ? { costWeight } : {}),
      ...(sortOrder !== model.sortOrder ? { sortOrder } : {}),
    };
    if (Object.keys(patch).length === 0) {
      props.onClose();
      return;
    }
    inFlight.current = true;
    setSaving(true);
    patchModel(model, patch)
      .then((saved) => {
        props.onSaved(saved);
        props.onClose();
      })
      .catch((error: unknown) => reportWriteFailure(text.saveFailed, error, props.onStale))
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  };

  const hint = (error: string | undefined, help: string) =>
    error ? (
      <span role="alert" className="text-danger">
        {error}
      </span>
    ) : (
      help
    );

  return (
    <SettingsModal
      open={model !== undefined}
      onOpenChange={(open) => !open && close()}
      size="sm"
      title={text.settingsTitle}
      description={model ? text.source(model.provider.name, model.providerModel) : undefined}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button type="submit" form="model-settings-form" disabled={saving}>
            {saving ? copy.common.saving : copy.common.save}
          </Button>
        </>
      }
    >
      <form
        id="model-settings-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={saving} className="flex min-w-0 flex-col gap-5">
          <SettingsModalField
            label={text.displayName}
            htmlFor="model-name"
            hint={hint(errors.name, text.displayNameHelp)}
          >
            <Input
              id="model-name"
              autoFocus
              autoComplete="off"
              value={name}
              aria-invalid={errors.name ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setErrors(({ name: _, ...rest }) => rest);
              }}
            />
          </SettingsModalField>
          <SettingsModalField
            label={text.costWeight}
            htmlFor="model-weight"
            hint={hint(errors.weight, text.costWeightHelp)}
          >
            <Input
              id="model-weight"
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              value={weight}
              aria-invalid={errors.weight ? true : undefined}
              onChange={(event) => {
                setWeight(event.target.value);
                setErrors(({ weight: _, ...rest }) => rest);
              }}
            />
          </SettingsModalField>
          <SettingsModalField
            label={text.sortOrder}
            htmlFor="model-order"
            hint={hint(errors.order, text.sortOrderHelp)}
          >
            <Input
              id="model-order"
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
              value={order}
              aria-invalid={errors.order ? true : undefined}
              onChange={(event) => {
                setOrder(event.target.value);
                setErrors(({ order: _, ...rest }) => rest);
              }}
            />
          </SettingsModalField>
        </fieldset>
      </form>
    </SettingsModal>
  );
}

/** Open while `model` is set; closes when the delete is done or refused. */
export function DeleteModelDialog(props: {
  model: ConsoleModel | undefined;
  onClose: () => void;
  onDeleted: () => void;
  onStale: () => void;
}) {
  const { copy } = useConsole();
  const text = copy.model;
  // The dialog keeps its words through its closing fade.
  const shown = useRef(props.model);
  if (props.model) shown.current = props.model;
  const model = shown.current;
  return (
    <ConfirmDialog
      open={props.model !== undefined}
      onOpenChange={(open) => !open && props.onClose()}
      title={model ? text.deleteTitle(model.displayName) : ''}
      description={text.deleteBody}
      confirmText={text.delete}
      cancelText={copy.common.cancel}
      variant="destructive"
      waitForConfirm
      onConfirm={async () => {
        const target = props.model;
        if (!target) return;
        try {
          await api.delete(`/models/${segment(target.id)}`, {
            expectedRevision: target.revision,
          });
          props.onDeleted();
        } catch (error) {
          reportWriteFailure(text.deleteFailed, error, props.onStale);
        }
      }}
    />
  );
}
