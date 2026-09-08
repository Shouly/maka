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

// Settings › Models: which model services this Runtime Host can reach, and
// which one a new task starts on.
//
// The page is four faces in one column — the connection list, one connection's
// detail, the provider catalog, and one provider's setup form — because
// Settings replaces the content column only (plan §2.12) and there is nowhere
// to put a second pane. The face is component state: the main process blocks
// navigation outright, so a URL is not available even as an implementation
// detail, and `uiStore` would make an ephemeral wizard step survive a restart.
//
// Everything reads `connectionsStore`, which `useRendererStores` already keeps
// observed against the scoped Runtime Host. This page must never open its own
// subscription: two observers of one catalog is how a settings page ends up
// showing one machine's connections while saving to another's.

import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { ConnectionsList } from './ConnectionsList.js';
import { ConnectionDetail } from './ConnectionDetail.js';
import { AddConnection } from './AddConnection.js';
import { ProviderSetupForm } from './ProviderSetupForm.js';
import { modelsViewParent, type ModelsView } from './models-view.js';
import { connectionsStore } from '../../../store/index.js';
import { toast } from '../../../store/toast-store.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';

export function ModelsSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const report = useSettingsErrorReporter();
  const snapshot = useStore(connectionsStore, (state) => state.data);
  const loading = useStore(connectionsStore, (state) => state.loading);
  const error = useStore(connectionsStore, (state) => state.error);
  const [view, setView] = useState<ModelsView>({ kind: 'list' });

  const connections = snapshot?.connections ?? [];
  const detailConnection =
    view.kind === 'detail'
      ? connections.find((row) => row.connectionId === view.connectionId)
      : undefined;

  // A connection can disappear underneath the detail page — deleted from the
  // TUI, or replaced by a Host-side sync. Falling back silently would leave the
  // user staring at a list wondering what they pressed, so the page says which
  // way it went.
  useEffect(() => {
    if (view.kind !== 'detail' || loading || snapshot === undefined) return;
    if (detailConnection) return;
    setView({ kind: 'list' });
    toast({ title: copy.panel.connectionRemoved });
  }, [view, loading, snapshot, detailConnection, copy]);

  const openList = useCallback(() => setView({ kind: 'list' }), []);
  const openDetail = useCallback(
    (connectionId: string) => setView({ kind: 'detail', connectionId }),
    [],
  );

  if (view.kind === 'detail' && detailConnection) {
    return (
      <ConnectionDetail
        connection={detailConnection}
        host={props.host}
        isDefault={snapshot?.defaultConnection === detailConnection.slug}
        onBack={openList}
        onDeleted={openList}
        onError={report}
      />
    );
  }

  if (view.kind === 'setup') {
    return (
      <ProviderSetupForm
        providerType={view.providerType}
        host={props.host}
        existingSlugs={connections.map((row) => row.slug)}
        onBack={() => setView(modelsViewParent(view))}
        onCreated={openDetail}
        onError={report}
      />
    );
  }

  if (view.kind === 'catalog') {
    return (
      <AddConnection
        host={props.host}
        connections={connections}
        onBack={openList}
        onPickProvider={(providerType) => setView({ kind: 'setup', providerType })}
        onConnected={openDetail}
        onError={report}
      />
    );
  }

  return (
    <ConnectionsList
      host={props.host}
      snapshot={snapshot}
      loading={loading}
      loadError={error}
      onOpenDetail={openDetail}
      onAddConnection={() => setView({ kind: 'catalog' })}
      onError={report}
    />
  );
}
