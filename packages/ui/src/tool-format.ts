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

import { TOOL_NAMES, type ToolName } from '@maka/core/tool-names';
import type { UiLocale } from './locale-helpers.js';
import { redactSecrets } from './redact.js';
import { getToolActivityCopy } from './tool-activity/copy.js';

/**
 * `mcp__<server>__<tool>` is the name Runtime mints for a proxied MCP tool
 * (`packages/runtime/src/mcp-tools.ts`). Splitting it back out is how a row
 * says which server answered without the transcript carrying a second field —
 * and how anything naming that tool says the tool rather than the wire.
 */
export function parseMcpToolName(name: string): { serverId: string; toolName: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice('mcp__'.length);
  const separator = rest.indexOf('__');
  if (separator <= 0) return undefined;
  return { serverId: rest.slice(0, separator), toolName: rest.slice(separator + 2) };
}

/**
 * The row for a tool search, from the call rather than the result.
 *
 * The reference titles this row with what was ASKED: a `select:` names one
 * tool and reads as loading it, anything else reads as its own words. What the
 * search FOUND is a separate statement (`describeLoadToolResult`) — a row that
 * led with the answer would leave the question nowhere.
 *
 * The arguments may arrive wrapped. Where the connector is declared as a
 * provider's own search tool, the model's call nests them under `arguments`
 * beside the transport's call id, and that wrapper stays in the durable record
 * because replay reads the id back out of it.
 */
export function describeToolSearchCall(args: unknown, locale: UiLocale): string {
  const outer = args as Record<string, unknown> | null | undefined;
  const nested = outer?.arguments;
  const source = (nested && typeof nested === 'object' ? nested : outer) as
    | Record<string, unknown>
    | null
    | undefined;
  const raw = typeof source?.query === 'string' ? source.query.trim() : '';
  const copy = getToolActivityCopy(locale).loadTools;
  if (!raw) return copy.loadingTools;
  const named = /^select:(.*)$/iu.exec(raw);
  if (!named) return safeDisplayText(raw) || copy.loadingTools;
  // `select:A,B` names several; the row says the first and the count is the
  // group card's business.
  const first = (named[1] ?? '').split(',')[0]?.trim() ?? '';
  // A proxied tool is named for its server on the wire; the row names the tool.
  const display = safeDisplayText(parseMcpToolName(first)?.toolName ?? first);
  return display ? copy.loadingNamedTool(display) : copy.loadingTools;
}

function safeDisplayText(value: string): string {
  return redactSecrets(value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim());
}

export function formatRedactedJson(value: unknown): string {
  try {
    return redactSecrets(JSON.stringify(value, null, 2));
  } catch {
    return redactSecrets(String(value));
  }
}

export function formatToolIntent(intent: string): string {
  const safe = redactSecrets(intent.replace(/\s+/g, ' ').trim());
  return safe.length > 240 ? `${safe.slice(0, 240)}…` : safe;
}
