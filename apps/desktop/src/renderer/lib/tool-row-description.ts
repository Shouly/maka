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

// The `description` argument a step row prefers over the call's literal text.
//
// Bash now takes an optional `description` and Agent a required one. Both are
// written by the model for a reader, and both beat what the quiet preview can
// make of the arguments: a Bash row that says "Run the renderer typecheck"
// tells a reader more than 320 characters of piped shell, and an Agent row is
// otherwise its whole prompt, truncated mid-sentence.
//
// Kept out of `@maka/core`'s `formatToolInvocationLine` on purpose. That
// function is shared with the CLI and the TUI, and its rule is "format the
// arguments"; this one is "prefer the model's own label", which only the row
// header wants — the expanded panel still shows the command verbatim.
//
// Two tools, by name, and no general "any tool with a description" rule: an
// MCP tool's `description` is the tool's own documentation echoed back into
// the call, and showing that as the row label would make every call of it read
// identically.

import { TOOL_NAMES } from '@maka/core/tool-names';
import type { ToolActivityItem } from '@maka/ui';
import { redactSecrets } from '@maka/core/display-redaction';

/** How much of a description a one-line row will show before it is cut. */
export const TOOL_ROW_DESCRIPTION_MAX = 200;

const DESCRIBED_TOOLS: ReadonlySet<string> = new Set([TOOL_NAMES.bash, TOOL_NAMES.agent]);

function describedArgs(item: ToolActivityItem): Record<string, unknown> | undefined {
  const args = item.args ?? item.argsPreview;
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
}

/**
 * The row label a call's own `description` supplies, or undefined.
 *
 * A description is one line by construction, but it is model output, so it is
 * flattened and bounded here rather than trusted to be: a description with a
 * newline in it would otherwise make the step row two rows tall and push every
 * later row down.
 */
export function toolRowDescription(item: ToolActivityItem): string | undefined {
  if (!DESCRIBED_TOOLS.has(item.toolName)) return undefined;
  const raw = describedArgs(item)?.description;
  if (typeof raw !== 'string') return undefined;
  const flattened = raw.replace(/\s+/gu, ' ').trim();
  if (!flattened) return undefined;
  const bounded =
    flattened.length > TOOL_ROW_DESCRIPTION_MAX
      ? `${flattened.slice(0, TOOL_ROW_DESCRIPTION_MAX)}…`
      : flattened;
  return redactSecrets(bounded);
}
