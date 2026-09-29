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

// Upstreams: the provider accounts requests go to. A row switches one on or
// off; its menu edits it, replaces its credential, or deletes it. The
// credential is only ever sent, never shown: the server keeps it sealed.

import { useEffect, useState } from 'react';
import type { ConsoleUpstream, ConsoleUpstreamKind } from '../../../src/admin-console/types.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsRow, SettingsSection } from '@desktop/components/settings/settings-row.js';
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
import { Textarea } from '@desktop/components/ui/textarea.js';
import { api } from '../api.js';
import { useConsole } from '../context.js';
import { Chip, LoadFailed, LoadingRows, reportFailure, smallButton } from '../ui.js';
import { useResource } from '../use-resource.js';

const KINDS: readonly ConsoleUpstreamKind[] = ['anthropic', 'vertex', 'openrouter'];
/** Kinds whose credential is one API key (Vertex takes a service account). */
const takesApiKey = (kind: ConsoleUpstreamKind) => kind !== 'vertex';

type Editing =
  | { readonly mode: 'add' }
  | { readonly mode: 'edit'; readonly upstream: ConsoleUpstream }
  | { readonly mode: 'key'; readonly upstream: ConsoleUpstream };

export function UpstreamsPage() {
  const { copy } = useConsole();
  const text = copy.upstreams;
  const upstreams = useResource(() => api.get<ConsoleUpstream[]>('/upstreams'), 'upstreams');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<ConsoleUpstream | null>(null);

  const where = (upstream: ConsoleUpstream) => {
    const config = upstream.config as Record<string, string | undefined>;
    if (upstream.kind === 'vertex') {
      return [config.projectId, config.region].filter(Boolean).join(' · ');
    }
    return upstream.kind === 'openrouter'
      ? 'openrouter.ai'
      : (config.baseUrl ?? 'api.anthropic.com');
  };

  return (
    <>
      <SettingsSection
        title={text.title}
        description={text.help}
        action={
          <Button {...smallButton} onClick={() => setEditing({ mode: 'add' })}>
            {text.add}
          </Button>
        }
      >
        {upstreams.error && !upstreams.data ? (
          <LoadFailed error={upstreams.error} onRetry={upstreams.reload} />
        ) : !upstreams.data ? (
          <LoadingRows />
        ) : upstreams.data.length === 0 ? (
          <SettingsEmpty title={text.empty} body={text.emptyHelp} />
        ) : (
          upstreams.data.map((upstream) => (
            <SettingsRow
              key={upstream.id}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{upstream.name}</span>
                  <span className="text-text-muted">
                    · {text.kinds[upstream.kind] ?? upstream.kind}
                  </span>
                  {!upstream.enabled && <Chip tone="neutral">{copy.common.disabled}</Chip>}
                </span>
              }
              description={
                <span className="block truncate">
                  <span data-mono="true">{where(upstream)}</span> ·{' '}
                  {text.modelsUsing(upstream.modelCount)}
                </span>
              }
              control={
                <span className="flex items-center gap-2">
                  <Switch
                    aria-label={text.enableAria(upstream.name)}
                    checked={upstream.enabled}
                    onCheckedChange={(enabled) =>
                      void api
                        .patch<ConsoleUpstream[]>(`/upstreams/${upstream.id}`, { enabled })
                        .then(upstreams.replace)
                        .catch((error: unknown) => reportFailure(text.toggleFailed, error))
                    }
                  />
                  <RowActionsMenu
                    label={copy.common.moreActions(upstream.name)}
                    actions={[
                      {
                        label: copy.common.edit,
                        icon: 'edit',
                        onSelect: () => setEditing({ mode: 'edit', upstream }),
                      },
                      {
                        label: text.changeKey,
                        icon: 'lock',
                        onSelect: () => setEditing({ mode: 'key', upstream }),
                      },
                      {
                        label: copy.common.delete,
                        icon: 'trash',
                        danger: true,
                        onSelect: () => setDeleting(upstream),
                      },
                    ]}
                  />
                </span>
              }
            />
          ))
        )}
      </SettingsSection>

      <UpstreamDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={upstreams.replace}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? text.deleteTitle(deleting.name) : ''}
        description={text.deleteBody}
        confirmText={copy.common.delete}
        cancelText={copy.common.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={() => {
          if (!deleting) return;
          return api
            .delete<ConsoleUpstream[]>(`/upstreams/${deleting.id}`)
            .then(upstreams.replace)
            .catch((error: unknown) => reportFailure(text.deleteFailed, error))
            .finally(() => setDeleting(null));
        }}
      />
    </>
  );
}

/**
 * Adding an upstream asks for everything; editing one changes its name and
 * settings and keeps its credential; replacing the credential asks for that
 * alone.
 */
function UpstreamDialog(props: {
  editing: Editing | null;
  onClose: () => void;
  onSaved: (upstreams: ConsoleUpstream[]) => void;
}) {
  const { copy } = useConsole();
  const text = copy.upstreams;
  const editing = props.editing;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ConsoleUpstreamKind>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [projectId, setProjectId] = useState('');
  const [region, setRegion] = useState('global');
  const [apiKey, setApiKey] = useState('');
  const [serviceAccount, setServiceAccount] = useState('');
  const [invalidKey, setInvalidKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    const upstream = editing.mode === 'add' ? undefined : editing.upstream;
    const config = (upstream?.config ?? {}) as Record<string, string | undefined>;
    setName(upstream?.name ?? '');
    setKind(upstream?.kind ?? 'anthropic');
    setBaseUrl(config.baseUrl ?? '');
    setProjectId(config.projectId ?? '');
    setRegion(config.region ?? 'global');
    setApiKey('');
    setServiceAccount('');
    setInvalidKey(false);
  }, [editing]);

  if (!editing) return null;
  const showSettings = editing.mode !== 'key';
  const showCredential = editing.mode !== 'edit';

  const credential = (): Record<string, unknown> | undefined => {
    if (takesApiKey(kind)) return apiKey.trim() ? { apiKey: apiKey.trim() } : undefined;
    if (!serviceAccount.trim()) return undefined;
    try {
      const parsed = JSON.parse(serviceAccount) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      return { serviceAccount: parsed };
    } catch {
      setInvalidKey(true);
      return undefined;
    }
  };
  const config = () => {
    if (kind === 'vertex') return { projectId: projectId.trim(), region: region.trim() };
    return kind === 'anthropic' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {};
  };

  const submit = () => {
    setInvalidKey(false);
    let request: Promise<ConsoleUpstream[]>;
    if (editing.mode === 'add') {
      const secret = credential();
      if (!secret) {
        setInvalidKey(true);
        return;
      }
      request = api.post('/upstreams', { name, kind, config: config(), credential: secret });
    } else if (editing.mode === 'edit') {
      request = api.patch(`/upstreams/${editing.upstream.id}`, { name, config: config() });
    } else {
      const secret = credential();
      if (!secret) {
        setInvalidKey(true);
        return;
      }
      request = api.patch(`/upstreams/${editing.upstream.id}`, { credential: secret });
    }
    setSaving(true);
    request
      .then((next) => {
        props.onSaved(next);
        props.onClose();
      })
      .catch((error: unknown) => reportFailure(text.saveFailed, error))
      .finally(() => setSaving(false));
  };

  const title =
    editing.mode === 'add'
      ? text.addTitle
      : editing.mode === 'edit'
        ? text.editTitle(editing.upstream.name)
        : text.keyTitle(editing.upstream.name);

  return (
    <SettingsModal
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={title}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={props.onClose}>
            {copy.common.cancel}
          </Button>
          <Button disabled={saving || (showSettings && !name.trim())} onClick={submit}>
            {saving ? copy.common.saving : copy.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {showSettings && (
          <>
            <SettingsModalField label={text.name} htmlFor="upstream-name">
              <Input
                id="upstream-name"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                value={name}
                placeholder={text.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </SettingsModalField>
            <SettingsModalField label={text.kind} htmlFor="upstream-kind">
              <Select
                value={kind}
                disabled={editing.mode !== 'add'}
                onValueChange={(value) => setKind(value as ConsoleUpstreamKind)}
              >
                <SelectTrigger id="upstream-kind" aria-label={text.kind}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {text.kinds[entry]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsModalField>
            {kind === 'anthropic' && (
              <SettingsModalField
                label={text.baseUrl}
                htmlFor="upstream-base-url"
                hint={text.baseUrlHelp}
              >
                <Input
                  id="upstream-base-url"
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                  value={baseUrl}
                  placeholder="https://api.anthropic.com"
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </SettingsModalField>
            )}
            {kind === 'vertex' && (
              <>
                <SettingsModalField label={text.projectId} htmlFor="upstream-project">
                  <Input
                    id="upstream-project"
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  />
                </SettingsModalField>
                <SettingsModalField
                  label={text.region}
                  htmlFor="upstream-region"
                  hint={text.regionHelp}
                >
                  <Input
                    id="upstream-region"
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono"
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                  />
                </SettingsModalField>
              </>
            )}
          </>
        )}
        {showCredential &&
          (takesApiKey(kind) ? (
            <SettingsModalField
              label={text.apiKey}
              htmlFor="upstream-key"
              hint={
                invalidKey ? (
                  <span className="text-danger">{text.credentialRequired}</span>
                ) : kind === 'openrouter' ? (
                  text.openRouterKeyHelp
                ) : undefined
              }
            >
              <Input
                id="upstream-key"
                type="password"
                autoComplete="off"
                autoFocus={editing.mode === 'key'}
                value={apiKey}
                placeholder={kind === 'openrouter' ? 'sk-or-…' : 'sk-ant-…'}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </SettingsModalField>
          ) : (
            <SettingsModalField
              label={text.serviceAccount}
              htmlFor="upstream-service-account"
              hint={
                invalidKey ? (
                  <span className="text-danger">{text.serviceAccountInvalid}</span>
                ) : (
                  text.serviceAccountHelp
                )
              }
            >
              <Textarea
                id="upstream-service-account"
                spellCheck={false}
                autoFocus={editing.mode === 'key'}
                className="field-sizing-content min-h-[88px] max-h-48 font-mono text-xs"
                value={serviceAccount}
                onChange={(event) => setServiceAccount(event.target.value)}
              />
            </SettingsModalField>
          ))}
      </div>
    </SettingsModal>
  );
}
