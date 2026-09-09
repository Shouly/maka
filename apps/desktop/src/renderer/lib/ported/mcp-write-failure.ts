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

// Ported from upstream's `mcpWriteFailureMessage` (#4505). Since the config
// stores commit atomically, a write can end in a state that is neither
// success nor plain failure: published but of unconfirmed durability, and
// possibly with the MCP runtime no longer matching the file. Those two say so
// in their own words; every other failure keeps the shell's generic handling.

import type { McpCopy } from '../../locales/mcp-copy.js';

const DURABILITY_UNKNOWN = 'Atomic file commit outcome is unknown; reload before retrying';
const OUT_OF_SYNC = 'MCP write durability is uncertain and runtime state is out of sync';

export function mcpWriteFailureMessage(error: unknown, copy: McpCopy): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message.includes(OUT_OF_SYNC)) return copy.errors.writeOutOfSync;
  if (message.includes(DURABILITY_UNKNOWN)) return copy.errors.writeDurabilityUnknown;
  return undefined;
}
