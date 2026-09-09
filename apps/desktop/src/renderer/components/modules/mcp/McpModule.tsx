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

// MCP: the servers this workspace connects to, and what each one is doing.
//
// Configured servers first, the shipped directory below them — the same order
// the reference design's connectors page uses, and the order that matters
// after the first run.
//
// The page owns the store's connection for as long as it is mounted (see
// `store/mcp-store.ts` for why config and statuses are read as one value).
// Everything the user does here is a write plus a re-read; the Host also
// pushes status transitions, so a server that connects on its own moves
// without anyone pressing anything.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import type { McpServerConfig, McpServerStatus } from '@maka/core/mcp';
import { isMcpStdioConfig } from '@maka/core/mcp';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { Switch } from '../../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { menuDangerItemClass, menuTriggerButtonClass } from '../../ui/menu-variants.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { SettingsRow, SettingsSection } from '../../settings/settings-row.js';
import { ModuleEmpty, ModuleLead, ModuleListSkeleton, ModulePage } from '../module-page.js';
import { ExtensionsTabs } from '../ExtensionsTabs.js';
import { McpMarket } from './McpMarket.js';
import { McpServerDialog } from './McpServerDialog.js';
import { cn } from '../../../lib/cn.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { toast } from '../../../store/toast-store.js';
import { mcpStore } from '../../../store/index.js';
import { mcpDraftFromConfig, type McpServerDraft } from '../../../lib/ported/mcp-server-draft.js';
import { mcpWriteFailureMessage } from '../../../lib/ported/mcp-write-failure.js';
import type { McpCatalogEntry } from '../../../lib/ported/mcp-catalog.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';
import { getMcpCopy } from '../../../locales/mcp-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';

/** State → chip tone. `needs-auth` asks for a person, so it is `attention`. */
const STATE_TONE = {
  disabled: 'neutral',
  disconnected: 'neutral',
  connecting: 'active',
  connected: 'success',
  'needs-auth': 'attention',
  error: 'error',
} as const;

export function McpModule(props: {
  host?: DesktopRuntimeHostRef;
  /** Switches to the other Extensions face; the shell's own navigation call. */
  onSelectModule?: (module: 'skills' | 'mcp') => void;
}) {
  const locale = useUiLocale();
  const extensions = getModulesCopy(locale).extensions;
  const copy = getMcpCopy(locale);
  const modules = getModulesCopy(locale).mcp;
  const reportShellError = useSettingsErrorReporter();
  // A write that may not have survived is neither success nor plain failure
  // (upstream #4505): it gets its own sentence instead of the generic retry.
  const report = (title: string, cause: unknown) => {
    const durability = mcpWriteFailureMessage(cause, copy);
    if (durability) {
      toast({ title, description: durability, variant: 'destructive' });
      return;
    }
    reportShellError(title, cause);
  };
  const host = props.host;
  const snapshot = useStore(mcpStore, (state) => state.data);
  const loading = useStore(mcpStore, (state) => state.loading);
  const error = useStore(mcpStore, (state) => state.error);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServerDraft | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  useEffect(() => mcpStore.observe(host), [host?.profileId, host?.hostId]);

  const servers = useMemo(
    () => Object.entries(snapshot?.config.mcpServers ?? {}),
    [snapshot?.config],
  );
  const statuses = useMemo(() => {
    const byId = new Map<string, McpServerStatus>();
    for (const status of snapshot?.statuses ?? []) byId.set(status.serverId, status);
    return byId;
  }, [snapshot?.statuses]);
  const ids = servers.map(([id]) => id);

  const run = async (key: string, failure: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await operation();
      return true;
    } catch (cause) {
      report(failure, cause);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (serverId: string, config: McpServerConfig) => {
    const isEdit = editing !== undefined;
    setBusy(`save:${serverId}`);
    try {
      if (isEdit) {
        await mcpStore.upsert(serverId, config, host);
      } else {
        const result = await mcpStore.add(serverId, config, host);
        // A taken id comes back as a VALUE, so the dialog stays open with the
        // id field to fix rather than closing on a write that did not happen.
        if (result.status === 'exists') {
          toast({
            title: copy.errors.save,
            description: modules.duplicateId,
            variant: 'destructive',
          });
          return;
        }
      }
      toast({ title: copy.toast.saved, description: copy.toast.savedDetail, variant: 'success' });
      setDialogOpen(false);
      setEditing(undefined);
    } catch (cause) {
      report(copy.errors.save, cause);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ModulePage
      title={extensions.title}
      icon="tool"
      tabs={<ExtensionsTabs current="mcp" onSelect={(face) => props.onSelectModule?.(face)} />}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            {copy.page.add}
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={copy.page.refresh}
            disabled={busy !== null}
            onClick={() => void mcpStore.refresh()}
          >
            <Anthropicon name="arrowClockwise" size={16} />
          </Button>
        </>
      }
    >
      <ModuleLead>{modules.description}</ModuleLead>

      <SettingsSection title={modules.installedTitle}>
        {loading && !snapshot ? (
          <div className="py-3">
            <ModuleListSkeleton />
          </div>
        ) : error ? (
          <div className="py-3">
            <ModuleEmpty
              title={copy.errors.load}
              action={
                <Button variant="outline" size="sm" onClick={() => void mcpStore.refresh()}>
                  {copy.page.refresh}
                </Button>
              }
            />
          </div>
        ) : servers.length === 0 ? (
          <div className="py-3">
            <ModuleEmpty title={copy.page.noInstalled} body={copy.page.noInstalledDetail} />
          </div>
        ) : (
          servers.map(([id, config]) => (
            <McpServerRow
              key={id}
              serverId={id}
              config={config}
              status={statuses.get(id)}
              busy={busy}
              copy={copy}
              modules={modules}
              onToggle={(enabled) =>
                void run(`toggle:${id}`, modules.enableFailed, () =>
                  mcpStore.upsert(id, { ...config, enabled }, host),
                )
              }
              onTest={() =>
                void (async () => {
                  setBusy(`test:${id}`);
                  try {
                    const result = await mcpStore.test(id, host);
                    toast({
                      title: result.ok ? copy.toast.connectionOk : copy.toast.connectionFailed,
                      description: result.ok
                        ? copy.toast.toolLatency(result.status.toolCount, result.latencyMs)
                        : (result.status.error ?? copy.errors.unavailableStatus),
                      variant: result.ok ? 'success' : 'destructive',
                    });
                  } catch (cause) {
                    report(copy.errors.test, cause);
                  } finally {
                    setBusy(null);
                  }
                })()
              }
              onEdit={() => {
                setEditing(mcpDraftFromConfig(id, config));
                setDialogOpen(true);
              }}
              onSignIn={() =>
                void run(`login:${id}`, modules.signInFailed, () => mcpStore.login(id, host))
              }
              onSignOut={() =>
                void run(`logout:${id}`, modules.signOutFailed, () => mcpStore.logout(id, host))
              }
              onRemove={() => setPendingRemove(id)}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={modules.marketTitle} description={modules.marketDescription}>
        <div className="py-3">
          <McpMarket
            installedIds={ids}
            busyId={busy?.startsWith('install:') ? busy.slice('install:'.length) : null}
            disabled={busy !== null}
            onInstall={(entry: McpCatalogEntry) => {
              void (async () => {
                const ok = await run(`install:${entry.id}`, copy.errors.install(entry.name), () =>
                  mcpStore.install(entry.id, entry.config, host),
                );
                if (!ok) return;
                // A template that ships blank credential slots installs
                // DISABLED, so the toast has to say what is still owed rather
                // than reporting a connection that is not going to happen.
                toast({
                  title: entry.setupRequired
                    ? copy.toast.templateInstalled(entry.name)
                    : copy.toast.installed(entry.name),
                  description: entry.setupRequired
                    ? copy.toast.templateInstalledDetail
                    : copy.toast.installedDetail,
                  variant: 'success',
                });
              })();
            }}
          />
        </div>
      </SettingsSection>

      <McpServerDialog
        open={dialogOpen}
        seed={editing}
        takenIds={editing ? ids.filter((id) => id !== editing.id) : ids}
        saving={busy?.startsWith('save:') === true}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(serverId, config) => void save(serverId, config)}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title={pendingRemove ? copy.remove.title(pendingRemove) : ''}
        description={copy.remove.description}
        confirmText={copy.remove.confirm}
        cancelText={copy.remove.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const id = pendingRemove;
          if (!id) return;
          const ok = await run(`remove:${id}`, copy.errors.remove, () => mcpStore.remove(id, host));
          if (ok) toast({ title: copy.toast.removed, variant: 'success' });
          setPendingRemove(null);
        }}
      />
    </ModulePage>
  );
}

type McpPageCopy = ReturnType<typeof getMcpCopy>;
type McpModulesCopy = ReturnType<typeof getModulesCopy>['mcp'];

function McpServerRow(props: {
  serverId: string;
  config: McpServerConfig;
  status: McpServerStatus | undefined;
  busy: string | null;
  copy: McpPageCopy;
  modules: McpModulesCopy;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRemove: () => void;
}) {
  const { serverId, config, status, copy, modules } = props;
  const enabled = config.enabled !== false;
  const state = status?.state ?? (enabled ? 'disconnected' : 'disabled');
  const busy = props.busy !== null;
  const endpoint = isMcpStdioConfig(config)
    ? [config.command, ...(config.args ?? [])].join(' ')
    : config.url;

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{serverId}</span>
          <span className={cn(statusChipClass, statusChipToneClass(STATE_TONE[state]))}>
            {stateLabel(state, status, copy, modules)}
          </span>
        </span>
      }
      description={
        <span className="flex flex-col gap-0.5">
          <span className="truncate">{endpoint}</span>
          {status?.error && <span className="text-danger">{status.error}</span>}
        </span>
      }
      control={
        <span className="flex items-center gap-2">
          {state === 'needs-auth' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              aria-busy={props.busy === `login:${serverId}` || undefined}
              onClick={props.onSignIn}
            >
              {props.busy === `login:${serverId}` ? modules.signingIn : modules.signIn}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-busy={props.busy === `test:${serverId}` || undefined}
            onClick={props.onTest}
          >
            {props.busy === `test:${serverId}` ? copy.row.testing : copy.row.test}
          </Button>
          <Switch
            aria-label={modules.enableServer(serverId)}
            checked={enabled}
            disabled={busy}
            onCheckedChange={props.onToggle}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={menuTriggerButtonClass}
                aria-label={modules.serverActions(serverId)}
                disabled={busy}
              >
                <Anthropicon name="dotsVertical" size={20} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={props.onEdit}>{copy.row.edit}</DropdownMenuItem>
              {/* Offered only where there is a stored credential to drop. */}
              {status?.authenticated && (
                <DropdownMenuItem onSelect={props.onSignOut}>{modules.signOut}</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onRemove}>
                {copy.row.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      }
    />
  );
}

function stateLabel(
  state: McpServerStatus['state'],
  status: McpServerStatus | undefined,
  copy: McpPageCopy,
  modules: McpModulesCopy,
): string {
  switch (state) {
    case 'connected':
      return copy.row.connected(status?.toolCount ?? 0);
    case 'connecting':
      return copy.row.connecting;
    case 'disabled':
      return copy.row.disabled;
    case 'needs-auth':
      return modules.needsAuth;
    case 'error':
      return copy.row.failed;
    case 'disconnected':
      return copy.row.disconnected;
  }
}
