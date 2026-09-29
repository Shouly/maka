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

// One model: how people see it (name, order, whether it is on), what the
// app is told it can do, how much it counts against allowances, and the
// upstreams its requests go to. Each field writes when it is left, as the
// Settings pages' fields do; the answer is the whole list, which replaces
// the page's copy.

import { useEffect, useRef, useState } from 'react';
import type {
  ConsoleModel,
  ConsoleModelCapabilities,
  ConsoleModelPatch,
  ConsoleRouteDraft,
  ConsoleUpstream,
} from '../../../src/admin-console/types.js';
import {
  RowActionsMenu,
  SettingsModal,
  SettingsModalField,
} from '@desktop/components/settings/settings-kit.js';
import {
  SettingsRow,
  SettingsSection,
  settingsFieldWidthClass,
} from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { ConfirmDialog } from '@desktop/components/ui/confirm-dialog.js';
import { Input } from '@desktop/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@desktop/components/ui/select.js';
import { Switch } from '@desktop/components/ui/switch.js';
import { cn } from '@desktop/lib/cn.js';
import { api, segment } from '../api.js';
import { useConsole } from '../context.js';
import { navigate } from '../router.js';
import { NotFoundPanel } from './not-found.js';
import { Chip, DetailHeader, LoadFailed, LoadingRows, reportFailure, smallButton } from '../ui.js';
import { useResource } from '../use-resource.js';

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const AUTO = '__auto__';

type CapabilityChange = Partial<Record<keyof ConsoleModelCapabilities, unknown>>;

/** A token count as typed: empty is automatic, a positive whole number is itself, anything else is refused. */
function tokenCount(value: string): number | undefined | null {
  if (value === '') return undefined;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function ModelDetailPage(props: { id: string }) {
  const { copy } = useConsole();
  const text = copy.models;
  const models = useResource(() => api.get<ConsoleModel[]>('/models'), 'models');
  const [deleting, setDeleting] = useState(false);
  const [addingRoute, setAddingRoute] = useState(false);
  // Capability changes go out one at a time, each carrying the ones before
  // it: two made in quick succession (a field left by clicking a level)
  // would otherwise each send the stored set plus only their own change.
  const capabilityWrites = useRef<Promise<unknown>>(Promise.resolve());
  const unsaved = useRef<{ id: string; capabilities: ConsoleModelCapabilities } | null>(null);
  const path = `/models/${segment(props.id)}`;

  if (models.error && !models.data) {
    return (
      <SettingsSection>
        <LoadFailed error={models.error} onRetry={models.reload} />
      </SettingsSection>
    );
  }
  if (!models.data) return <LoadingRows rows={4} />;
  const model = models.data.find((entry) => entry.id === props.id);
  if (!model) {
    return (
      <NotFoundPanel
        title={copy.notFound.modelTitle}
        body={copy.notFound.modelBody}
        action={copy.notFound.toModels}
        onAction={() => navigate({ page: 'models' })}
      />
    );
  }

  /** Write a change; whether it was stored. */
  const patch = (body: ConsoleModelPatch): Promise<boolean> =>
    api
      .patch<ConsoleModel[]>(path, body)
      .then((next) => {
        models.replace(next);
        return true;
      })
      .catch((error: unknown) => {
        reportFailure(copy.common.saveFailed, error);
        return false;
      });
  /** A change, or one worked out from the latest set, including changes not yet stored. */
  const capabilities = (
    change: CapabilityChange | ((current: ConsoleModelCapabilities) => CapabilityChange),
  ): Promise<boolean> => {
    const base =
      unsaved.current?.id === model.id ? unsaved.current.capabilities : model.capabilities;
    const next: Record<string, unknown> = {
      ...base,
      ...(typeof change === 'function' ? change(base) : change),
    };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
    }
    // A default level the list no longer offers goes with it.
    const levels = (next.thinkingLevels as string[] | undefined) ?? [];
    if (
      typeof next.defaultThinkingLevel === 'string' &&
      !levels.includes(next.defaultThinkingLevel)
    ) {
      delete next.defaultThinkingLevel;
    }
    const pending = { id: model.id, capabilities: next as ConsoleModelCapabilities };
    unsaved.current = pending;
    const write = capabilityWrites.current.then(() =>
      patch({ capabilities: pending.capabilities }),
    );
    capabilityWrites.current = write;
    return write.finally(() => {
      if (unsaved.current === pending) unsaved.current = null;
    });
  };
  const setRoutes = (routes: readonly ConsoleRouteDraft[]) =>
    api
      .put<ConsoleModel[]>(`${path}/routes`, { routes })
      .then(models.replace)
      .catch((error: unknown) => {
        reportFailure(text.routeFailed, error);
        throw error;
      });
  const currentRoutes = (): ConsoleRouteDraft[] =>
    model.routes.map((route) => ({
      upstreamId: route.upstreamId,
      upstreamModel: route.upstreamModel,
      priority: route.priority,
    }));
  const levels = model.capabilities.thinkingLevels ?? [];
  const images = model.capabilities.inputModalities;

  return (
    <>
      <DetailHeader
        aside={
          <RowActionsMenu
            label={copy.common.moreActions(model.displayName)}
            actions={[
              {
                label: text.deleteModel,
                icon: 'trash',
                danger: true,
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        }
      >
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[0.9375rem] font-semibold leading-5">
              {model.displayName}
            </h2>
            {!model.enabled && <Chip tone="neutral">{copy.common.disabled}</Chip>}
            {model.routes.length === 0 && <Chip tone="attention">{text.noRoute}</Chip>}
          </span>
          <span
            data-mono="true"
            className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary"
          >
            {model.id}
          </span>
        </div>
      </DetailHeader>

      <SettingsSection title={text.basics}>
        <SettingsRow
          title={text.name}
          control={
            <TextField
              label={text.name}
              value={model.displayName}
              onCommit={(displayName) => (displayName ? patch({ displayName }) : false)}
            />
          }
        />
        <SettingsRow
          title={text.enable}
          description={text.enabledHelp}
          control={
            <Switch
              aria-label={text.enableAria(model.displayName)}
              checked={model.enabled}
              onCheckedChange={(enabled) => void patch({ enabled })}
            />
          }
        />
        <SettingsRow
          title={text.order}
          description={text.orderHelp}
          control={
            <TextField
              label={text.order}
              numeric
              value={String(model.sortOrder)}
              onCommit={(value) => {
                const sortOrder = Number(value);
                return value !== '' && Number.isInteger(sortOrder) ? patch({ sortOrder }) : false;
              }}
            />
          }
        />
        <SettingsRow
          title={text.weight}
          description={text.weightHelp}
          control={
            <TextField
              label={text.weight}
              numeric
              value={String(model.costWeight)}
              onCommit={(value) => {
                const costWeight = Number(value);
                return value !== '' && Number.isFinite(costWeight) && costWeight >= 0
                  ? patch({ costWeight })
                  : false;
              }}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title={text.routes}
        description={text.routesHelp}
        action={
          <Button {...smallButton} onClick={() => setAddingRoute(true)}>
            {text.addRoute}
          </Button>
        }
      >
        {model.routes.length === 0 ? (
          <SettingsRow title={text.noRoutes} control={null} />
        ) : (
          model.routes.map((route) => (
            <SettingsRow
              key={route.upstreamId}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{route.upstreamName}</span>
                  <span className="text-text-muted">
                    · {copy.upstreams.kinds[route.upstreamKind] ?? route.upstreamKind}
                  </span>
                  {!route.upstreamEnabled && <Chip tone="neutral">{copy.common.disabled}</Chip>}
                </span>
              }
              description={
                <span className="block truncate">
                  {text.routeDetail(route.upstreamModel, route.priority)}
                </span>
              }
              control={
                <Button
                  {...smallButton}
                  onClick={() =>
                    void setRoutes(
                      currentRoutes().filter((entry) => entry.upstreamId !== route.upstreamId),
                    ).catch(() => undefined)
                  }
                >
                  {copy.common.remove}
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={text.capabilities} description={text.capabilitiesHelp}>
        <SettingsRow
          title={text.reference}
          description={text.referenceHelp}
          control={
            <TextField
              label={text.reference}
              mono
              value={model.capabilities.referenceModelId ?? ''}
              placeholder={model.id}
              onCommit={(value) => capabilities({ referenceModelId: value || undefined })}
            />
          }
        />
        <SettingsRow
          title={text.contextWindow}
          control={
            <TextField
              label={text.contextWindow}
              numeric
              value={
                model.capabilities.contextWindow ? String(model.capabilities.contextWindow) : ''
              }
              placeholder={copy.models.capabilityAuto}
              onCommit={(value) => {
                const contextWindow = tokenCount(value);
                return contextWindow === null ? false : capabilities({ contextWindow });
              }}
            />
          }
        />
        <SettingsRow
          title={text.maxOutput}
          control={
            <TextField
              label={text.maxOutput}
              numeric
              value={
                model.capabilities.maxOutputTokens ? String(model.capabilities.maxOutputTokens) : ''
              }
              placeholder={copy.models.capabilityAuto}
              onCommit={(value) => {
                const maxOutputTokens = tokenCount(value);
                return maxOutputTokens === null ? false : capabilities({ maxOutputTokens });
              }}
            />
          }
        />
        <SettingsRow title={text.thinking} description={text.thinkingHelp} layout="stacked">
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((level) => {
              const on = levels.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() =>
                    void capabilities((current) => {
                      const chosen = current.thinkingLevels ?? [];
                      return {
                        thinkingLevels: chosen.includes(level)
                          ? chosen.filter((entry) => entry !== level)
                          : LEVELS.filter((entry) => entry === level || chosen.includes(entry)),
                      };
                    })
                  }
                  className={cn(
                    'h-7 cursor-pointer rounded-[7px] px-2.5 text-sm leading-5 outline-none transition-colors focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                    on
                      ? 'bg-alpha-2 font-medium text-text-primary'
                      : 'text-text-secondary shadow-[inset_0_0_0_1px_var(--alpha-2)] hover:bg-alpha-1',
                  )}
                >
                  {text.levels[level] ?? level}
                </button>
              );
            })}
          </div>
        </SettingsRow>
        <SettingsRow
          title={text.defaultThinking}
          control={
            <Select
              value={model.capabilities.defaultThinkingLevel ?? AUTO}
              disabled={levels.length === 0}
              onValueChange={(value) =>
                void capabilities({ defaultThinkingLevel: value === AUTO ? undefined : value })
              }
            >
              <SelectTrigger aria-label={text.defaultThinking} variant="ghost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{text.defaultThinkingNone}</SelectItem>
                {levels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {text.levels[level] ?? level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={text.imageInput}
          control={
            <TriState
              label={text.imageInput}
              value={images === undefined ? undefined : images.includes('image')}
              onChange={(value) =>
                void capabilities({
                  inputModalities:
                    value === undefined ? undefined : value ? ['text', 'image'] : ['text'],
                })
              }
            />
          }
        />
        <SettingsRow
          title={text.tools}
          control={
            <TriState
              label={text.tools}
              value={model.capabilities.supportsTools}
              onChange={(value) => void capabilities({ supportsTools: value })}
            />
          }
        />
      </SettingsSection>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={text.deleteTitle(model.displayName)}
        description={text.deleteBody}
        confirmText={copy.common.delete}
        cancelText={copy.common.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={() =>
          api
            .delete(path)
            .then(() => navigate({ page: 'models' }))
            .catch((error: unknown) => reportFailure(text.deleteFailed, error))
            .finally(() => setDeleting(false))
        }
      />
      <AddRouteDialog
        open={addingRoute}
        model={model}
        onClose={() => setAddingRoute(false)}
        onAdd={(route) =>
          setRoutes([
            ...currentRoutes().filter((entry) => entry.upstreamId !== route.upstreamId),
            route,
          ])
        }
      />
    </>
  );
}

/**
 * A settings-row field that writes when it is left or on Enter; Escape puts
 * back what is stored, and so does a value that was refused (by the page, as
 * `false`, or by the server) rather than leaving one that is not stored.
 */
function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  numeric?: boolean;
  mono?: boolean;
  onCommit: (value: string) => false | Promise<boolean>;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const stored = useRef(props.value);
  stored.current = props.value;
  const commit = () => {
    const next = draft.trim();
    if (next === props.value) return;
    const written = props.onCommit(next);
    if (written === false) {
      setDraft(props.value);
      return;
    }
    void written.then((ok) => {
      if (!ok) setDraft(stored.current);
    });
  };
  return (
    <Input
      aria-label={props.label}
      className={cn(settingsFieldWidthClass, props.mono && 'font-mono')}
      value={draft}
      placeholder={props.placeholder}
      inputMode={props.numeric ? 'numeric' : undefined}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}

/** Automatic (the vendor's facts), supported, or not. */
function TriState(props: {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  const { copy } = useConsole();
  const value = props.value === undefined ? AUTO : props.value ? 'yes' : 'no';
  return (
    <Select
      value={value}
      onValueChange={(next) => props.onChange(next === AUTO ? undefined : next === 'yes')}
    >
      <SelectTrigger aria-label={props.label} variant="ghost">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>{copy.models.capabilityAuto}</SelectItem>
        <SelectItem value="yes">{copy.models.capabilityYes}</SelectItem>
        <SelectItem value="no">{copy.models.capabilityNo}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function AddRouteDialog(props: {
  open: boolean;
  model: ConsoleModel;
  onClose: () => void;
  onAdd: (route: ConsoleRouteDraft) => Promise<unknown>;
}) {
  const { copy } = useConsole();
  const text = copy.models;
  const upstreams = useResource(
    () => (props.open ? api.get<ConsoleUpstream[]>('/upstreams') : Promise.resolve([])),
    String(props.open),
  );
  const [upstreamId, setUpstreamId] = useState('');
  const [upstreamModel, setUpstreamModel] = useState('');
  const [priority, setPriority] = useState('0');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setUpstreamId('');
    setUpstreamModel(props.model.capabilities.referenceModelId ?? props.model.id);
    setPriority(
      String(props.model.routes.reduce((next, route) => Math.max(next, route.priority + 1), 0)),
    );
  }, [props.open, props.model]);

  const order = Number(priority);
  const orderValid = priority.trim() !== '' && Number.isInteger(order) && order >= 0;
  const submit = () => {
    if (saving || !orderValid) return;
    setSaving(true);
    props
      .onAdd({ upstreamId, upstreamModel: upstreamModel.trim(), priority: order })
      .then(props.onClose)
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  const choices = upstreams.data ?? [];

  return (
    <SettingsModal
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      title={text.routeTitle}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={props.onClose}>
            {copy.common.cancel}
          </Button>
          <Button
            disabled={saving || !upstreamId || !upstreamModel.trim() || !orderValid}
            onClick={submit}
          >
            {saving ? copy.common.saving : copy.common.add}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SettingsModalField
          label={text.upstream}
          htmlFor="route-upstream"
          hint={upstreams.data && choices.length === 0 ? text.noUpstreams : undefined}
        >
          <Select value={upstreamId} onValueChange={setUpstreamId}>
            <SelectTrigger id="route-upstream" aria-label={text.upstream}>
              <SelectValue placeholder={text.upstreamPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((upstream) => (
                <SelectItem key={upstream.id} value={upstream.id}>
                  {upstream.name} · {copy.upstreams.kinds[upstream.kind] ?? upstream.kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsModalField>
        <SettingsModalField
          label={text.upstreamModel}
          htmlFor="route-model"
          hint={text.upstreamModelHelp}
        >
          <Input
            id="route-model"
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            value={upstreamModel}
            onChange={(event) => setUpstreamModel(event.target.value)}
          />
        </SettingsModalField>
        <SettingsModalField
          label={text.priority}
          htmlFor="route-priority"
          hint={
            orderValid ? undefined : <span className="text-danger">{text.priorityInvalid}</span>
          }
        >
          <Input
            id="route-priority"
            inputMode="numeric"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </SettingsModalField>
      </div>
    </SettingsModal>
  );
}
