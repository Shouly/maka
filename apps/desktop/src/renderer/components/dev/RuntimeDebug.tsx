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

import { useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import {
  useActiveTurns,
  useLiveTurnSnapshot,
  useProjectContext,
  useRendererStores,
} from '../../hooks/use-workspace.js';
import {
  sessionsStore,
  activeSessionStore,
  turnActionsStore,
  connectionsStore,
  settingsStore,
  projectsStore,
  hostScopeStore,
} from '../../store/index.js';
import { getRuntimeDebugCopy } from '../../locales/runtime-debug-copy.js';
import { errorMessage } from '../../store/resource-store.js';
import { DesignSmoke } from './DesignSmoke.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';

/** Temporary acceptance surface. It uses the same stores Phase 2 will consume. */
export function RuntimeDebug() {
  useRendererStores();
  const copy = getRuntimeDebugCopy(useUiLocale());
  const catalog = useStore(sessionsStore);
  const active = useStore(activeSessionStore);
  const actions = useStore(turnActionsStore);
  const connections = useStore(connectionsStore);
  const settings = useStore(settingsStore.host);
  const clientSettings = useStore(settingsStore.client, (state) => state.data);
  const projects = useStore(projectsStore.defaults);
  const scope = useStore(hostScopeStore);
  const turns = useActiveTurns();
  const live = useLiveTurnSnapshot();
  const project = useProjectContext();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string>();
  const [design, setDesign] = useState(false);
  const id = catalog.activeId;
  const draft = id ? (drafts[id] ?? '') : '';
  const pending = id ? (actions.pending[id] ?? []) : [];
  const invoke = (operation: () => Promise<unknown>) => {
    setError(undefined);
    void Promise.resolve()
      .then(operation)
      .catch((cause) => setError(errorMessage(cause)));
  };
  const submit = () => {
    if (!id || !draft.trim() || pending.includes('send')) return;
    const text = draft;
    invoke(async () => {
      const result = await turnActionsStore.send(id, {
        type: 'send',
        turnId: crypto.randomUUID(),
        text,
      });
      if (result.ok)
        setDrafts((current) => (current[id] === text ? { ...current, [id]: '' } : current));
    });
  };
  const interaction = id ? active.interactions[id]?.[0] : undefined;
  const answer = async () => {
    if (!id || !interaction) return;
    const payload = JSON.parse(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error(copy.error);
    if (payload.requestId !== interaction.requestId) throw new Error(copy.error);
    switch (interaction.type) {
      case 'sandbox_boundary_request':
        await turnActionsStore.respondSandbox(id, payload);
        break;
      case 'client_capability_request':
        await turnActionsStore.respondCapability(id, payload);
        break;
      case 'user_question_request':
        await turnActionsStore.respondQuestion(id, payload);
        break;
      case 'form_request':
        await turnActionsStore.respondForm(id, payload);
        break;
    }
    setResponse('');
  };
  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-surface-1"
      data-maka-runtime-debug
      data-active-session={id}
    >
      <header className="flex items-center justify-between border-b border-hairline p-4">
        <div>
          <h1 className="text-lg font-medium">{copy.title}</h1>
          <p className="text-sm text-text-secondary">{copy.description}</p>
          <p className="font-mono text-xs text-text-muted" data-maka-runtime-live>
            {JSON.stringify(live)} · {project.projectId ?? '-'}
          </p>
        </div>
        <select
          aria-label={copy.theme}
          value={clientSettings?.appearance.theme ?? 'auto'}
          disabled={!clientSettings}
          className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm"
          onChange={(event) => {
            const theme = event.target.value;
            if (theme === 'auto' || theme === 'light' || theme === 'dark')
              invoke(() => settingsStore.updateClient({ appearance: { theme } }));
          }}
        >
          <option value="auto">{copy.auto}</option>
          <option value="light">{copy.light}</option>
          <option value="dark">{copy.dark}</option>
        </select>
        <Button variant="outline" onClick={() => setDesign(!design)}>
          {design ? copy.runtime : copy.design}
        </Button>
      </header>
      {design ? (
        <DesignSmoke showThemeControl={false} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
          <aside className="overflow-auto border-r border-hairline p-3" aria-label={copy.sessions}>
            <div className="mb-3 flex gap-2">
              <Button
                disabled={catalog.loading || !scope.host}
                onClick={() => invoke(() => sessionsStore.create())}
              >
                {copy.create}
              </Button>
              <Button variant="ghost" onClick={() => invoke(sessionsStore.refresh)}>
                {copy.refresh}
              </Button>
            </div>
            {!catalog.sessions.length && (
              <p className="text-sm text-text-secondary">{copy.empty}</p>
            )}
            {catalog.sessions.map((row) => (
              <button
                key={row.id}
                data-session-key={row.id}
                type="button"
                aria-pressed={id === row.id}
                onClick={() => sessionsStore.select(row.id)}
                className={`mb-1 block w-full rounded-lg p-3 text-left text-sm ${id === row.id ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
              >
                <span className="block truncate">{row.name || row.id}</span>
                <span className="text-xs text-text-secondary">
                  {row.profileName} · {row.status}
                </span>
              </button>
            ))}
          </aside>
          <main className="min-w-0 overflow-auto p-5">
            {(error ||
              catalog.error ||
              active.error ||
              scope.error ||
              (id && actions.errors[id])) && (
              <p role="alert" className="mb-3 text-danger">
                {error ||
                  catalog.error ||
                  active.error ||
                  scope.error ||
                  (id && actions.errors[id])}
              </p>
            )}
            {!id ? (
              <p>{copy.select}</p>
            ) : (
              <>
                <p role="status" className="mb-3 text-sm text-text-secondary">
                  {active.observationReady ? copy.ready : copy.pending}
                </p>
                <label className="mb-2 block text-sm" htmlFor="debug-message">
                  {copy.prompt}
                </label>
                <Textarea
                  id="debug-message"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="my-3 flex flex-wrap gap-2">
                  <Button
                    disabled={!draft.trim() || pending.includes('send') || !active.observationReady}
                    onClick={submit}
                  >
                    {copy.send}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending.includes('stop')}
                    onClick={() => invoke(() => turnActionsStore.stop(id))}
                  >
                    {copy.stop}
                  </Button>
                  <Button variant="ghost" onClick={() => invoke(() => turnActionsStore.resume(id))}>
                    {copy.resume}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => invoke(() => turnActionsStore.compact(id))}
                  >
                    {copy.compact}
                  </Button>
                </div>
                <div className="mb-4 flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={!active.range?.hasOlder}
                    onClick={() => invoke(activeSessionStore.loadBefore)}
                  >
                    {copy.before}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!active.range?.hasNewer}
                    onClick={() => invoke(activeSessionStore.loadAfter)}
                  >
                    {copy.after}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!active.range?.hasNewer}
                    onClick={() => invoke(activeSessionStore.loadLatest)}
                  >
                    {copy.latest}
                  </Button>
                </div>
                <h2 className="mb-2 font-medium">{copy.turns}</h2>
                <pre
                  data-maka-turn-projection
                  className="overflow-auto rounded-lg bg-surface-2 p-4 text-xs"
                >
                  {JSON.stringify(turns, null, 2)}
                </pre>
                <details className="mt-4" open={!!interaction}>
                  <summary>{copy.interactions}</summary>
                  <pre className="overflow-auto text-xs">
                    {JSON.stringify(active.interactions[id] ?? [], null, 2)}
                  </pre>
                  {interaction && (
                    <div>
                      <label htmlFor="debug-response">{copy.response}</label>
                      <Textarea
                        id="debug-response"
                        value={response}
                        onChange={(event) => setResponse(event.target.value)}
                      />
                      <Button
                        disabled={pending.includes('interaction')}
                        onClick={() => invoke(answer)}
                      >
                        {copy.respond}
                      </Button>
                    </div>
                  )}
                </details>
                <details className="mt-4">
                  <summary>{copy.queue}</summary>
                  <pre className="overflow-auto text-xs">
                    {JSON.stringify(active.queues[id] ?? null, null, 2)}
                  </pre>
                </details>
                <details className="mt-4">
                  <summary>{copy.outcome}</summary>
                  <pre className="overflow-auto text-xs">
                    {JSON.stringify(actions.sendResults[id] ?? null, null, 2)}
                  </pre>
                </details>
              </>
            )}
            <details className="mt-4">
              <summary>{copy.state}</summary>
              <pre className="overflow-auto text-xs">
                {JSON.stringify(
                  {
                    sessionId: id,
                    range: active.range,
                    health: active.health,
                    host: scope.host,
                    connections: connections.data?.connections.length,
                    connectionError: connections.error,
                    settingsLoaded: !!settings.data,
                    settingsError: settings.error,
                    projects: projects.data?.snapshot.projects.length,
                    projectError: projects.error,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </main>
        </div>
      )}
    </div>
  );
}
