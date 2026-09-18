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

// The memory filesystem, for the settings page: list the files, open one,
// save one, delete one, flip the switch. Every write
// carries the version the page read, so a file the model or the background
// pass changed meanwhile comes back as a conflict with the current content
// rather than being overwritten unseen.

import type {
  MemoryDocumentProjection,
  MemoryFileProjection,
  MemoryMutateResult,
} from "@maka/runtime-host/protocol";
import { MemoryImportRefused } from "./config-transfer-service.js";
import type { DesktopRuntimeHostClient } from "./runtime-host-client.js";
import {
  handleReconnectableRead,
  type ReconnectableReadIpcMain,
} from "./ipc-reconnect-policy.js";

export interface MemoryListState {
  readonly enabled: boolean;
  readonly incognitoActive: boolean;
  /** Empty when the Runtime Host's files are not reachable from this machine. */
  readonly directoryPath: string;
  readonly files: readonly MemoryFileProjection[];
}

interface RuntimeHostMemoryIpcDeps {
  readonly ipcMain: ReconnectableReadIpcMain;
  readonly client: DesktopRuntimeHostClient;
  /** False when the Runtime Host's files are on another machine. */
  readonly allowLocalPaths?: boolean;
}

export function registerRuntimeHostMemoryIpc(
  deps: RuntimeHostMemoryIpcDeps,
): void {
  handleReconnectableRead(deps.ipcMain, "memory:list", () =>
    listMemory(deps),
  );
  deps.ipcMain.handle("memory:read", async (_event, path: unknown) => {
    if (typeof path !== "string") return null;
    const result = await deps.client.queryMemory({ kind: "read", path });
    return result.kind === "document" ? result.document : null;
  });
  deps.ipcMain.handle("memory:write", async (_event, input: unknown) => {
    const write = input as {
      path?: unknown;
      content?: unknown;
      ifVersion?: unknown;
    };
    if (
      typeof write.path !== "string" ||
      typeof write.content !== "string" ||
      typeof write.ifVersion !== "string"
    ) {
      return rejected("invalid_path");
    }
    return deps.client.mutateMemory({
      kind: "write",
      path: write.path,
      content: write.content,
      ifVersion: write.ifVersion,
    });
  });
  deps.ipcMain.handle("memory:delete", async (_event, input: unknown) => {
    const remove = input as { path?: unknown; ifVersion?: unknown };
    if (typeof remove.path !== "string" || typeof remove.ifVersion !== "string") {
      return rejected("invalid_path");
    }
    return deps.client.mutateMemory({
      kind: "delete",
      path: remove.path,
      ifVersion: remove.ifVersion,
    });
  });
  deps.ipcMain.handle("memory:setEnabled", async (_event, enabled: unknown) => {
    await deps.client.updateRuntimePolicy(() => ({
      kind: "set_memory",
      value: { enabled: enabled === true },
    }));
    return listMemory(deps);
  });
}

async function listMemory(
  deps: Pick<RuntimeHostMemoryIpcDeps, "client" | "allowLocalPaths">,
): Promise<MemoryListState> {
  const result = await deps.client.queryMemory({ kind: "list" });
  if (result.kind !== "list") {
    throw new Error("Runtime Host returned an invalid Memory listing");
  }
  return {
    enabled: result.enabled,
    incognitoActive: result.incognitoActive,
    directoryPath: deps.allowLocalPaths !== false ? result.directoryPath : "",
    files: result.files,
  };
}

function rejected(
  reason: Extract<MemoryMutateResult, { kind: "rejected" }>["reason"],
): MemoryMutateResult {
  return { kind: "rejected", reason, current: null };
}

/** Every memory file, for the configuration export. */
export async function readRuntimeHostMemoryFiles(
  client: DesktopRuntimeHostClient,
): Promise<Record<string, string>> {
  const listed = await client.queryMemory({ kind: "list" });
  if (listed.kind !== "list") return {};
  const files: Record<string, string> = {};
  for (const file of listed.files) {
    const read = await client.queryMemory({ kind: "read", path: file.path });
    if (read.kind === "document" && read.document) {
      files[file.path] = read.document.content;
    }
  }
  return files;
}

/**
 * Imports memory files: each replaces the file at its path, or creates it.
 * The version a conflict hands back is retried once — the import is the
 * user's explicit choice of content, so what was there yields to it.
 */
export async function writeRuntimeHostMemoryFiles(
  client: DesktopRuntimeHostClient,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const current = await client.queryMemory({ kind: "read", path });
    const document: MemoryDocumentProjection | null =
      current.kind === "document" ? current.document : null;
    let result = await client.mutateMemory({
      kind: "write",
      path,
      content,
      ifVersion: document?.version ?? "new",
    });
    if (result.kind === "rejected" && result.current) {
      result = await client.mutateMemory({
        kind: "write",
        path,
        content,
        ifVersion: result.current.version,
      });
    }
    if (result.kind === "rejected") throw new MemoryImportRefused(path, result.reason);
  }
}
