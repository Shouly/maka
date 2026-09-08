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

// The MCP page's data: the configured servers and what each one is doing.
//
// Config and statuses are read TOGETHER and stored as one value, because they
// are one screen: a row is a config entry plus its status, and reading them
// into two stores means a repaint where a server that exists has no status
// yet (or, worse, a status row for a server the config no longer has).
//
// Unlike the connections store this one is not part of the app's lifetime —
// nothing outside the module page reads MCP — so the page owns `observe()` for
// as long as it is mounted. `subscribeChanges` pushes statuses on every
// connection transition; each one re-reads the pair, which is cheap and keeps
// the invariant above.

import * as api from '../bridge/mcp.js';
import type { McpConfigFile, McpServerConfig, McpServerStatus } from '../bridge/mcp.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';
import { createResourceStore } from './resource-store.js';

export interface McpSnapshot {
  readonly config: McpConfigFile;
  readonly statuses: readonly McpServerStatus[];
}

export function createMcpStore(bridge = api) {
  const store = createResourceStore<McpSnapshot>();
  const read = (host: DesktopRuntimeHostRef | undefined) => async (): Promise<McpSnapshot> => {
    const [config, statuses] = await Promise.all([
      bridge.getMcpConfig(host),
      bridge.listMcpStatuses(host),
    ]);
    return { config, statuses };
  };
  return {
    ...store,
    observe(host: DesktopRuntimeHostRef | undefined) {
      return store.connect(read(host), (refresh) => bridge.subscribeMcpChanges(refresh));
    },
    add: (serverId: string, config: McpServerConfig, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.addMcpServer(serverId, config, host)),
    install: (serverId: string, config: McpServerConfig, host?: DesktopRuntimeHostRef) =>
      // `structuredClone` because the catalog entry's config is a module-level
      // constant: handing the same object to the bridge twice is how a shared
      // `env` map ends up carrying the last install's edits.
      store.mutate(() => bridge.installMcpServer(serverId, structuredClone(config), host)),
    upsert: (serverId: string, config: McpServerConfig, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.upsertMcpServer(serverId, config, host)),
    remove: (serverId: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.removeMcpServer(serverId, host)),
    test: (serverId: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.testMcpServer(serverId, host)),
    login: (serverId: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.loginMcpServer(serverId, host)),
    logout: (serverId: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.logoutMcpServer(serverId, host)),
  };
}

export const mcpStore = createMcpStore();
