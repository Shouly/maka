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

// The `mcp` namespace of the preload bridge, wrapped.

import type {
  McpConfigFile,
  McpConfigImportResult,
  McpServerConfig,
  McpServerStatus,
  McpTestResult,
} from '@maka/core/mcp';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Mcp = MakaBridge['mcp'];

export type {
  McpConfigFile,
  McpConfigImportResult,
  McpServerConfig,
  McpServerStatus,
  McpTestResult,
};

const mcp = (): Mcp => requireNamespace('mcp');

export function getMcpConfig(host?: DesktopRuntimeHostRef): Promise<McpConfigFile> {
  return mcp().getConfig(host);
}

export function listMcpStatuses(host?: DesktopRuntimeHostRef): Promise<McpServerStatus[]> {
  return mcp().listStatuses(host);
}

export function addMcpServer(
  serverId: string,
  config: McpServerConfig,
  host?: DesktopRuntimeHostRef,
): ReturnType<Mcp['add']> {
  return mcp().add(serverId, config, host);
}

/**
 * Add a directory entry with its shipped config.
 *
 * Separate from `add` because it is the CATALOG path: `add` reports a taken id
 * as a value so a form can put it on the id field, while installing a template
 * whose id is already there is not a case the directory can reach (an
 * installed entry stops offering the action).
 */
export function installMcpServer(
  serverId: string,
  config: McpServerConfig,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigFile> {
  return mcp().install(serverId, config, host);
}

/**
 * Import a pasted `mcp.json`.
 *
 * The SOURCE crosses, not a parsed object: main owns the version rules (1, 2
 * and 3, each with its own protocol-preference constraints) and answers a
 * refusal as a `reason` VALUE, so the dialog can name what is wrong instead of
 * fishing prose out of a flattened IPC error. Servers this file does not
 * mention are preserved.
 */
export function importMcpConfig(
  source: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigImportResult> {
  return mcp().importConfig(source, host);
}

/**
 * Withdraw a directory install that is still running.
 *
 * Resolves with the config as it stands AFTER the rollback. Main removes only
 * the entry that install itself wrote: an upsert that replaced the same id
 * while the cancel waited survives, credentials and all.
 */
export function cancelMcpServerInstall(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigFile> {
  return mcp().cancelInstall(serverId, host);
}

export function upsertMcpServer(
  serverId: string,
  config: McpServerConfig,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigFile> {
  return mcp().upsert(serverId, config, host);
}

export function removeMcpServer(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigFile> {
  return mcp().remove(serverId, host);
}

export function testMcpServer(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpTestResult> {
  return mcp().test(serverId, host);
}

/**
 * Start the OAuth round for a server whose state is `needs-auth`.
 *
 * Main owns the browser hop and resolves with the status the round produced,
 * so there is nothing here to poll: the resolved status IS the answer, and the
 * change subscription refreshes the rest of the page behind it.
 */
export function loginMcpServer(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpServerStatus> {
  return mcp().login(serverId, host);
}

/** End an in-flight login round. Resolves false when none is active. */
export function cancelMcpServerLogin(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<boolean> {
  return mcp().cancelLogin(serverId, host);
}

/** Drop the stored credential. Offered only where `authenticated` is true. */
export function logoutMcpServer(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpServerStatus> {
  return mcp().logout(serverId, host);
}

export function subscribeMcpChanges(handler: (statuses: McpServerStatus[]) => void): () => void {
  return toUnsubscribe(tryNamespace('mcp')?.subscribeChanges(handler));
}
