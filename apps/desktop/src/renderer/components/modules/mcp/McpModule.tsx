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
// Configured connectors first, the shipped directory below them — the same order
// the reference design's connectors page uses, and the order that matters
// after the first run.
//
// The page owns the store's connection for as long as it is mounted (see
// `store/mcp-store.ts` for why config and statuses are read as one value).
// Everything the user does here is a write plus a re-read; the Host also
// pushes status transitions, so a server that connects on its own moves
// without anyone pressing anything.
//
// Search and the filter pills are the reference page's, and they mean what
// they say there: the search covers ids, endpoints and TOOL NAMES, and the
// pills split what the search left into connected and not. Both are view
// state — nothing is stored, and a status the Host pushes re-sorts the pills
// under the user without touching what they typed.
//
// A row's long facts (every tool name, the stderr tail) open UNDER the row
// rather than in a dialog: the pre-rewrite page had an inspector column for
// them, this page has none, and a modal would cover the row being explained.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import type { McpServerConfig, McpServerStatus } from '@maka/core/mcp';
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
import {
  ListEmptyState,
  ListFilterPills,
  ListRow,
  ListSearch,
  ListSection,
  ListStaleNotice,
  ListTabsDivider,
  listToolbarButtonClass,
  listToolbarIconButtonClass,
  listToolbarPrimaryButtonClass,
} from '../../ui/list-page.js';
import { ModuleListSkeleton, ModulePage } from '../module-page.js';
import { ExtensionsTabs, ExtensionsViewTabs, type ExtensionsView } from '../ExtensionsTabs.js';
import { McpMarket, type McpInstallPhase } from './McpMarket.js';
import { McpServerDialog } from './McpServerDialog.js';
import { McpServerDetails } from './McpServerDetails.js';
import {
  CONNECTOR_STATE_TONE,
  connectorEndpoint,
  connectorFilterCounts,
  connectorImportSummary,
  connectorRows,
  connectorState,
  connectorStateLabel,
  connectorTransportLabel,
  filterConnectorRows,
  mcpImportFailureMessage,
  type ConnectorFilter,
  type ConnectorRow,
} from './connectors-list.js';
import { cn } from '../../../lib/cn.js';
import { moduleListState } from '../../../lib/module-list-state.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { toast } from '../../../store/toast-store.js';
import { mcpStore } from '../../../store/index.js';
import { mcpDraftFromConfig, type McpServerDraft } from '../../../lib/ported/mcp-server-draft.js';
import { mcpWriteFailureMessage } from '../../../lib/ported/mcp-write-failure.js';
import { getMcpCatalog, type McpCatalogEntry } from '../../../lib/ported/mcp-catalog.js';
import { McpBrandMark, hasMcpBrandMark } from '../../../lib/ported/mcp-brand-marks.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';
import { getMcpCopy } from '../../../locales/mcp-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';
import { getConnectorsPageCopy } from '../../../locales/connectors-page-copy.js';

const detailsDomId = (serverId: string) => `mcp-details-${serverId}`;

export function McpModule(props: {
  host?: DesktopRuntimeHostRef;
  /** Switches to the other Extensions face; the shell's own navigation call. */
  onSelectModule?: (module: 'skills' | 'mcp') => void;
}) {
  const locale = useUiLocale();
  const modulesShared = getModulesCopy(locale);
  const extensions = modulesShared.extensions;
  const copy = getMcpCopy(locale);
  const modules = modulesShared.mcp;
  const connectors = getConnectorsPageCopy(locale);
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
  const [view, setView] = useState<ExtensionsView>('yours');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServerDraft | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConnectorFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Directory installs run beside the page's other work rather than inside
  // `busy`: the whole point of a cancellable install is that its own Cancel
  // stays pressable while it runs, and `busy` disables every control.
  const [installPhases, setInstallPhases] = useState<Record<string, McpInstallPhase>>({});
  const cancelledInstalls = useRef(new Set<string>());

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
  const rows = useMemo(() => connectorRows(servers, statuses), [servers, statuses]);
  const counts = useMemo(() => connectorFilterCounts(rows, query), [rows, query]);
  const visible = useMemo(
    () => filterConnectorRows(rows, { query, filter }),
    [rows, query, filter],
  );
  const display = moduleListState({
    loading,
    error,
    loaded: snapshot !== undefined,
    count: servers.length,
  });
  const retry = (
    <Button variant="outline" size="sm" onClick={() => void mcpStore.refresh()}>
      {copy.page.refresh}
    </Button>
  );

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

  /** Paste an `mcp.json`. A refusal is a reason code, not a rejection. */
  const importConfig = async (source: string) => {
    setBusy('import');
    const before = ids;
    try {
      const result = await mcpStore.importConfig(source, host);
      if (result.status === 'invalid') {
        toast({
          title: copy.errors.import,
          description: mcpImportFailureMessage(result, copy),
          variant: 'destructive',
        });
        return;
      }
      const summary = connectorImportSummary({
        before,
        after: Object.keys(result.config.mcpServers),
        importedCount: result.importedCount,
      });
      toast({
        title: copy.toast.imported,
        description:
          result.importedCount === 0
            ? connectors.import.nothingImported
            : summary.replaced > 0
              ? connectors.import.replacedSummary(summary.added, summary.replaced)
              : copy.toast.importedDetail(result.importedCount),
        variant: 'success',
      });
      setDialogOpen(false);
      // Whatever it wrote is on the Yours face; the directory is not where the
      // result of an import can be seen.
      setView('yours');
      setQuery('');
      setFilter('all');
    } catch (cause) {
      report(copy.errors.import, cause);
    } finally {
      setBusy(null);
    }
  };

  const install = (entry: McpCatalogEntry) => {
    if (installPhases[entry.id]) return;
    cancelledInstalls.current.delete(entry.id);
    setInstallPhases((current) => ({ ...current, [entry.id]: 'installing' }));
    void (async () => {
      try {
        await mcpStore.install(entry.id, entry.config, host);
        // A cancelled install still resolves (main returns the rolled-back
        // config); saying "installed" then would contradict the row that just
        // disappeared.
        if (cancelledInstalls.current.has(entry.id)) return;
        toast({
          title: entry.setupRequired
            ? copy.toast.templateInstalled(entry.name)
            : copy.toast.installed(entry.name),
          description: entry.setupRequired
            ? copy.toast.templateInstalledDetail
            : copy.toast.installedDetail,
          variant: 'success',
        });
      } catch (cause) {
        if (!cancelledInstalls.current.has(entry.id))
          report(copy.errors.install(entry.name), cause);
      } finally {
        // The cancel owns the phase from the moment it starts: clearing it
        // here would flash the card back to "Install" while the rollback is
        // still in flight.
        const wasCancelled = cancelledInstalls.current.delete(entry.id);
        if (!wasCancelled) setInstallPhases((current) => withoutKey(current, entry.id));
      }
    })();
  };

  const cancelInstall = (entry: McpCatalogEntry) => {
    if (installPhases[entry.id] !== 'installing') return;
    cancelledInstalls.current.add(entry.id);
    setInstallPhases((current) => ({ ...current, [entry.id]: 'cancelling' }));
    void (async () => {
      try {
        await mcpStore.cancelInstall(entry.id, host);
        toast({ title: copy.toast.installCancelled(entry.name), variant: 'info' });
      } catch (cause) {
        cancelledInstalls.current.delete(entry.id);
        report(copy.errors.cancelInstall(entry.name), cause);
      } finally {
        setInstallPhases((current) => withoutKey(current, entry.id));
      }
    })();
  };

  /** Directory → Yours, with that server's editor open on top of its row. */
  const manage = (serverId: string) => {
    const config = snapshot?.config.mcpServers[serverId];
    if (!config) return;
    setView('yours');
    setQuery('');
    setFilter('all');
    setExpanded(serverId);
    setEditing(mcpDraftFromConfig(serverId, config));
    setDialogOpen(true);
  };

  const clearSearch = () => setQuery('');

  return (
    <ModulePage
      title={extensions.title}
      tabs={
        <>
          <ExtensionsTabs current="mcp" onSelect={(face) => props.onSelectModule?.(face)} />
          <ListTabsDivider />
          <ExtensionsViewTabs current={view} onSelect={setView} />
        </>
      }
      actions={
        <>
          <ListSearch
            value={query}
            onChange={setQuery}
            label={copy.page.searchAria}
            placeholder={copy.page.searchPlaceholder}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
            className={listToolbarPrimaryButtonClass}
          >
            {copy.page.add}
          </button>
        </>
      }
    >
      {view === 'yours' ? (
        <>
          {display.staleNotice && (
            <ListStaleNotice title={modulesShared.refreshFailed} action={retry} />
          )}
          {display.face === 'loading' ? (
            <ModuleListSkeleton />
          ) : display.face === 'failed' ? (
            <ListEmptyState icon={serverIcon} title={copy.errors.load} action={retry} />
          ) : display.face === 'empty' ? (
            <ListEmptyState
              icon={serverIcon}
              title={copy.page.noInstalled}
              description={copy.page.noInstalledDetail}
              action={
                <Button variant="secondary" size="sm" onClick={() => setView('discover')}>
                  {extensions.discover}
                </Button>
              }
            />
          ) : (
            <>
              <ListFilterPills<ConnectorFilter>
                label={connectors.filters.label}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: connectors.filters.all, count: counts.all },
                  {
                    value: 'connected',
                    label: connectors.filters.connected,
                    count: counts.connected,
                  },
                  {
                    value: 'not-connected',
                    label: connectors.filters.notConnected,
                    count: counts['not-connected'],
                  },
                ]}
              />
              {visible.length === 0 ? (
                query.trim() ? (
                  <ListEmptyState
                    icon={searchIcon}
                    title={copy.page.noInstalledMatch}
                    description={copy.page.noInstalledMatchDetail(query.trim())}
                    action={
                      <Button variant="secondary" size="sm" onClick={clearSearch}>
                        {copy.page.clearSearch}
                      </Button>
                    }
                  />
                ) : (
                  <ListEmptyState
                    icon={serverIcon}
                    title={
                      filter === 'connected'
                        ? connectors.filters.emptyConnected
                        : connectors.filters.emptyNotConnected
                    }
                    description={connectors.filters.emptyDetail}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                        {connectors.filters.all}
                      </Button>
                    }
                  />
                )
              ) : (
                <ListSection
                  id="mcp-configured"
                  label={modules.installedTitle}
                  count={visible.length}
                >
                  {visible.map((row) => (
                    <Fragment key={row.id}>
                      <McpServerRow
                        row={row}
                        busy={busy}
                        installPhase={installPhases[row.id]}
                        expanded={expanded === row.id}
                        copy={copy}
                        modules={modules}
                        connectors={connectors}
                        onToggleDetails={() =>
                          setExpanded((current) => (current === row.id ? null : row.id))
                        }
                        onToggle={(enabled) =>
                          void run(`toggle:${row.id}`, modules.enableFailed, () =>
                            mcpStore.upsert(row.id, { ...row.config, enabled }, host),
                          )
                        }
                        onTest={() =>
                          void (async () => {
                            setBusy(`test:${row.id}`);
                            try {
                              const result = await mcpStore.test(row.id, host);
                              toast({
                                title: result.ok
                                  ? copy.toast.connectionOk
                                  : copy.toast.connectionFailed,
                                description: result.ok
                                  ? copy.toast.toolLatency(
                                      result.status.toolCount,
                                      result.latencyMs,
                                    )
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
                          setEditing(mcpDraftFromConfig(row.id, row.config));
                          setDialogOpen(true);
                        }}
                        onSignIn={() =>
                          void run(`login:${row.id}`, modules.signInFailed, () =>
                            mcpStore.login(row.id, host),
                          )
                        }
                        onSignOut={() =>
                          void run(`logout:${row.id}`, modules.signOutFailed, () =>
                            mcpStore.logout(row.id, host),
                          )
                        }
                        onCancelInstall={() => {
                          const entry = getMcpCatalog(locale).find((item) => item.id === row.id);
                          if (entry) cancelInstall(entry);
                        }}
                        onRemove={() => setPendingRemove(row.id)}
                      />
                      {expanded === row.id && (
                        <McpServerDetails id={detailsDomId(row.id)} row={row} />
                      )}
                    </Fragment>
                  ))}
                </ListSection>
              )}
            </>
          )}
        </>
      ) : (
        <ListSection id="mcp-market" label={modules.marketTitle}>
          <p className="pb-4 text-sm leading-5 text-text-muted">{modules.marketDescription}</p>
          <McpMarket
            installedIds={ids}
            installPhases={installPhases}
            query={query}
            disabled={busy !== null}
            onInstall={install}
            onCancelInstall={cancelInstall}
            onManage={(entry) => manage(entry.id)}
            onClearSearch={clearSearch}
          />
        </ListSection>
      )}

      <McpServerDialog
        open={dialogOpen}
        seed={editing}
        takenIds={editing ? ids.filter((id) => id !== editing.id) : ids}
        saving={busy?.startsWith('save:') === true}
        importing={busy === 'import'}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(undefined);
        }}
        onSubmit={(serverId, config) => void save(serverId, config)}
        onImport={(source) => void importConfig(source)}
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
type ConnectorsCopy = ReturnType<typeof getConnectorsPageCopy>;

const serverIcon = <Anthropicon name="connectors" size={20} />;
const searchIcon = <Anthropicon name="search" size={20} />;

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = record;
  return rest;
}

function McpServerRow(props: {
  row: ConnectorRow;
  busy: string | null;
  installPhase: McpInstallPhase | undefined;
  expanded: boolean;
  copy: McpPageCopy;
  modules: McpModulesCopy;
  connectors: ConnectorsCopy;
  onToggleDetails: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onCancelInstall: () => void;
  onRemove: () => void;
}) {
  const { row, copy, modules, connectors } = props;
  const { id: serverId, config, status } = row;
  const locale = useUiLocale();
  const enabled = config.enabled !== false;
  const state = connectorState(row);
  const busy = props.busy !== null;
  const negotiated =
    status?.state === 'connected' && status.negotiatedProtocol
      ? copy.detail.negotiatedProtocol(
          status.negotiatedProtocol.era,
          status.negotiatedProtocol.revision,
        )
      : undefined;
  // A server installed from the market keeps its vendor's mark; anything
  // else gets the generic tile.
  const catalogEntry = hasMcpBrandMark(serverId)
    ? getMcpCatalog(locale).find((entry) => entry.id === serverId)
    : undefined;

  return (
    <ListRow
      icon={catalogEntry ? <McpBrandMark entry={catalogEntry} /> : serverIcon}
      title={serverId}
      chips={
        <>
          <span className={cn(statusChipClass, statusChipToneClass(CONNECTOR_STATE_TONE[state]))}>
            {connectorStateLabel(row, copy, modules)}
          </span>
          {props.installPhase && (
            <span className={cn(statusChipClass, statusChipToneClass('active'))}>
              {props.installPhase === 'cancelling'
                ? copy.card.cancelling
                : connectors.install.installing}
            </span>
          )}
          {negotiated && (
            <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
              {negotiated}
            </span>
          )}
        </>
      }
      meta={
        status?.error ? (
          <span className="text-danger">{status.error}</span>
        ) : (
          `${connectorTransportLabel(row, copy)} · ${connectorEndpoint(config)}`
        )
      }
      busy={busy}
      trailing={
        <>
          {props.installPhase && (
            <Button
              variant="secondary"
              size="sm"
              disabled={props.installPhase === 'cancelling'}
              aria-busy={props.installPhase === 'cancelling' || undefined}
              aria-label={
                props.installPhase === 'cancelling'
                  ? copy.card.cancellingAria(serverId)
                  : copy.card.cancelAria(serverId)
              }
              onClick={props.onCancelInstall}
            >
              {props.installPhase === 'cancelling' ? copy.card.cancelling : copy.card.cancel}
            </Button>
          )}
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
          <button
            type="button"
            className={menuTriggerButtonClass}
            aria-expanded={props.expanded}
            // Only while it exists: a control pointing at an id that is not in
            // the document names nothing for a screen reader.
            aria-controls={props.expanded ? detailsDomId(serverId) : undefined}
            aria-label={
              props.expanded ? connectors.details.hide(serverId) : connectors.details.show(serverId)
            }
            onClick={props.onToggleDetails}
          >
            <Anthropicon name={props.expanded ? 'caretDown' : 'caretRight'} size={20} />
          </button>
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
        </>
      }
    />
  );
}
