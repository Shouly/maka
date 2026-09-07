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

// The tool renderer registry: renderer id → the component that draws it.
//
// Ported in shape from the reference design system's `toolRegistry`, with one
// change that matters. relx keys its registry on TOOL NAME, because its tools
// are a fixed list it ships. Maka's are not: MCP servers, skills and
// connectors add tools at runtime, and a name-keyed registry would fall
// through to a generic renderer for every one of them. Maka's runtime already
// classifies each call by activity kind and each result by result kind, so
// those are the keys — a new MCP tool that returns a diff gets the diff
// renderer without anyone registering it.
//
// `resolveToolRendererId` (tool-presentation.ts) makes that decision; this
// file only maps its answer to a component, so the decision stays testable
// without React.

import type { ReactNode } from 'react';
import type { ToolActivityItem } from '@maka/ui';
import { DiffResult } from './renderers/DiffResult.js';
import { TerminalResult } from './renderers/TerminalResult.js';
import { WebSearchErrorResult, WebSearchResult } from './renderers/WebSearchResult.js';
import { AgentSwarmResult, SubagentResult } from './renderers/SubagentResult.js';
import {
  ArchivedResult,
  FileWriteResult,
  ImageResult,
  JsonResult,
  PendingResult,
  TextResult,
  WorkflowResult,
} from './renderers/SimpleResults.js';
import { resolveToolRendererId, type ToolRendererId } from './tool-presentation.js';

export interface ToolContentContext {
  /** Opens a child task in the shell. */
  readonly onOpenSession: (sessionId: string) => void;
  /** Hands a URL to the host; the renderer never navigates itself. */
  readonly onOpenExternal: (url: string) => void;
  /**
   * Opens the right pane's Files face on the artifact a row produced.
   *
   * The row knows a workspace PATH; the pane owns the artifact catalog and
   * resolves the two. A row with no path (an image whose ref is not a session
   * file) still opens the face, which is the useful half of the answer.
   */
  readonly onOpenFile?: (path: string | undefined) => void;
  /** Attaches the right pane's Terminal face to a live shell run. */
  readonly onOpenTerminal?: (ref: string) => void;
}

/**
 * The body for one row, or `null` when the renderer has none. Written as a
 * switch rather than a component map so the narrowing of `item.result` by kind
 * is the compiler's, not a cast's.
 */
export function renderToolContent(item: ToolActivityItem, context: ToolContentContext): ReactNode {
  const id: ToolRendererId = resolveToolRendererId(item);
  const result = item.result;
  switch (id) {
    case 'pending':
      return <PendingResult item={item} />;
    case 'none':
      return null;
    case 'diff':
      return result?.kind === 'file_diff' ? (
        <DiffResult
          paths={result.paths}
          diff={result.diff}
          {...(context.onOpenFile ? { onOpenFile: context.onOpenFile } : {})}
        />
      ) : null;
    case 'file_write':
      return result?.kind === 'file_write' ? (
        <FileWriteResult
          result={result}
          {...(context.onOpenFile ? { onOpenFile: context.onOpenFile } : {})}
        />
      ) : null;
    case 'terminal':
      return result?.kind === 'terminal' || result?.kind === 'shell_run' ? (
        <TerminalResult
          item={item}
          result={result}
          {...(context.onOpenTerminal ? { onOpenTerminal: context.onOpenTerminal } : {})}
        />
      ) : null;
    case 'web_search':
      return result?.kind === 'web_search' ? (
        <WebSearchResult result={result} onOpenExternal={context.onOpenExternal} />
      ) : null;
    case 'web_search_error':
      return result?.kind === 'web_search_error' ? <WebSearchErrorResult result={result} /> : null;
    case 'subagent':
      return result?.kind === 'subagent' ? (
        <SubagentResult result={result} onOpenSession={context.onOpenSession} />
      ) : null;
    case 'agent_swarm':
      return result?.kind === 'agent_swarm' ? (
        <AgentSwarmResult result={result} onOpenSession={context.onOpenSession} />
      ) : null;
    case 'json':
      return result?.kind === 'json' ? <JsonResult result={result} /> : null;
    case 'image':
      return result?.kind === 'image' ? (
        <ImageResult
          item={item}
          result={result}
          {...(context.onOpenFile ? { onOpenFile: context.onOpenFile } : {})}
        />
      ) : null;
    case 'archived':
      return result?.kind === 'archived_tool_result' ? <ArchivedResult result={result} /> : null;
    case 'workflow':
      return result?.kind === 'rive_workflow' ? <WorkflowResult result={result} /> : null;
    case 'text':
      return result?.kind === 'text' || result?.kind === 'summary' ? (
        <TextResult result={result} />
      ) : null;
  }
}
