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

// Adding a model the endpoint would not list.
//
// Discovery answers for most connections; a gateway that serves models it does
// not enumerate, or a relay with no `/models` route, leaves the user with a
// model id they know and a picker that does not offer it.
//
// The context window is required rather than optional, and that is the whole
// point of the dialog being a dialog. Without one Maka falls back to a
// conservative 32k and compacts a long conversation that never needed
// compacting — a silently degraded session is much harder to notice than a
// second field.

import { useEffect, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';

export function AddModelDialog(props: {
  open: boolean;
  existingIds: readonly string[];
  onOpenChange: (open: boolean) => void;
  onAdd: (input: { id: string; contextWindow: number }) => void;
}) {
  const copy = getSettingsModelsCopy(useUiLocale()).detail;
  const [id, setId] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) return;
    setId('');
    setContextWindow('');
    setError(null);
  }, [props.open]);

  const submit = () => {
    const modelId = id.trim();
    if (!modelId) return setError(copy.addModelIdRequired);
    if (props.existingIds.includes(modelId)) return setError(copy.addModelIdDuplicate);
    const window = Number.parseInt(contextWindow.trim(), 10);
    if (!Number.isFinite(window) || window <= 0) {
      return setError(copy.addModelContextWindowRequired);
    }
    props.onAdd({ id: modelId, contextWindow: window });
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.addModel}</DialogTitle>
          <DialogDescription>{copy.addModelIdFieldHelp}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="maka-add-model-id">{copy.addModelIdField}</Label>
            <Input
              id="maka-add-model-id"
              value={id}
              placeholder={copy.addModelIdPlaceholder}
              onChange={(event) => {
                setId(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="maka-add-model-context">{copy.addModelContextWindow}</Label>
            <Input
              id="maka-add-model-context"
              value={contextWindow}
              inputMode="numeric"
              placeholder="200000"
              onChange={(event) => {
                setContextWindow(event.target.value);
                setError(null);
              }}
            />
            <p className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">
              {copy.addModelContextWindowHelp}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-[0.8125rem] leading-[1.125rem] text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button onClick={submit}>{copy.addModelConfirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
