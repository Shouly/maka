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

import { createHash } from 'node:crypto';
import { jsonSchema } from 'ai';
import type { ToolActivityKind } from '@maka/core/events';
import type {
  McpCallResult,
  McpToolBinding,
  McpToolDescriptor,
  McpToolSnapshot,
} from '@maka/core/mcp';
import type { InteractionFormInput, InteractionFormResult } from '@maka/core/interaction';
import type { PermissionMode, ToolCategory } from '@maka/core/permission';
import { REQUEST_COMPOSITION_MAX_TOOL_DESCRIPTION_LENGTH } from '@maka/core/run-composition';
import type { ExecutionBoundary } from '@maka/core/sandbox-boundary';
import type { ToolRecoveryMode } from '@maka/core/runtime-event';
import { modelFacingInputSchema } from './mcp-input-schema.js';
import type { ToolResultContentPart, ToolResultOutput } from './model-protocol.js';
import {
  estimateTextTokens,
  formatCount,
  newToolResultFileName,
  saveToolResultText,
  savedToolResultNotice,
  toolResultFilePath,
  toolResultSaveTicket,
  truncateUtf8,
  type SavedToolResult,
} from './tool-result-file.js';
import type { MakaTool } from './tool-runtime.js';

const MAX_PROVIDER_TOOL_NAME = 64;
const HASH_CHARS = 10;

const MAX_NATIVE_IMAGE_BASE64_CHARS = 20_000_000;
const MAX_NATIVE_IMAGES = 4;
/** The most text one result shows the model, in estimated tokens (UTF-8 bytes / 4). */
export const MCP_MAX_RESULT_TOKENS = 25_000;
/** A result with no image is saved to a file past this many characters, whatever its tokens. */
export const MCP_MAX_INLINE_CHARS = 50_000;
const MAX_MODEL_TEXT_BYTES = MCP_MAX_RESULT_TOKENS * 4;
const MAX_SUMMARIZED_BLOCKS = 100;
const TRUNCATION_MARKER = '\n…[truncated by Copilot]';

export interface McpToolProvider {
  toolSnapshot(): McpToolSnapshot;
  prepareTool?(
    binding: McpToolBinding,
    args: Record<string, unknown>,
    options: Omit<McpToolCallOptions, 'emitProgress'>,
  ): Promise<McpPreparedToolCall>;
  callTool(
    binding: McpToolBinding,
    args: Record<string, unknown>,
    options: McpToolCallOptions,
  ): Promise<McpCallResult>;
}

export interface McpPreparedToolCall {
  execute(options?: {
    readonly emitProgress?: (current: number, total: number) => void;
    readonly requestInteraction?: McpToolCallOptions['requestInteraction'];
  }): Promise<McpCallResult>;
  cancel(): Promise<void> | void;
}

export interface McpToolCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly context: McpToolInvocationContext;
  readonly emitProgress?: (current: number, total: number) => void;
  readonly requestInteraction?: (
    form: InteractionFormInput,
    options?: { readonly cancellationSignal?: AbortSignal },
  ) => Promise<InteractionFormResult>;
}

export interface McpToolInvocationContext {
  readonly sessionId: string;
  readonly runId?: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly cwd: string;
  readonly executionBoundary?: ExecutionBoundary;
  readonly permissionMode?: PermissionMode;
}

export interface BuildMcpToolsOptions {
  callTimeoutMs?: number;
  categoryHint?: ToolCategory;
  hostAdmission?: MakaTool['hostAdmission'];
  recoveryMode?: ToolRecoveryMode;
  executionLocation?: 'host' | 'remote';
  activityKindForDescriptor?: (descriptor: McpToolDescriptor) => ToolActivityKind | undefined;
  /**
   * Directory a result too long to show is saved under, one folder per
   * Session. Absent, nothing is saved and the result's text is cut instead.
   */
  toolResultRoot?: string;
}

export interface McpIdentifiedTool {
  readonly tool: MakaTool;
  readonly serverId: string;
  readonly toolName: string;
}

export function buildMcpTools(
  provider: McpToolProvider,
  options: BuildMcpToolsOptions = {},
): MakaTool[] {
  return buildMcpToolsWithIdentities(provider, options).map(({ tool }) => tool);
}

export function buildMcpToolsWithIdentities(
  provider: McpToolProvider,
  options: BuildMcpToolsOptions = {},
): McpIdentifiedTool[] {
  const names = new Map<string, string>();
  const snapshot = provider.toolSnapshot();
  return snapshot.tools.map(({ descriptor, binding }) => {
    const inputSchema = modelFacingInputSchema(descriptor.inputSchema);
    const identity = `${descriptor.serverId}\0${descriptor.name}`;
    const name = mcpProxyToolName(descriptor.serverId, descriptor.name);
    const collision = names.get(name);
    if (collision && collision !== identity) {
      throw new Error(`MCP proxy tool name collision: ${name}`);
    }
    names.set(name, identity);
    return {
      serverId: descriptor.serverId,
      toolName: descriptor.name,
      tool: {
        name,
        description: mcpToolDescription(descriptor),
        displayName: descriptor.annotations?.title?.trim() || descriptor.name,
        activityKind: options.activityKindForDescriptor?.(descriptor) ?? 'tool',
        // MCP annotations are advisory provider claims, not a security boundary.
        // The trusted composition may select a stricter open-world category;
        // ordinary MCP servers retain the side-effecting network default.
        categoryHint: options.categoryHint ?? 'network_send',
        ...(options.hostAdmission ? { hostAdmission: options.hostAdmission } : {}),
        ...(options.recoveryMode ? { recoveryMode: options.recoveryMode } : {}),
        // The MCP server remains the sole authority for the complete JSON
        // Schema. Runtime only carries a model-facing form of it to the AI SDK.
        parameters: jsonSchema(inputSchema),
        ...(provider.prepareTool
          ? {
              prepareExecution: async (args: unknown, context) => {
                const prepared = await provider.prepareTool!(binding, asArguments(args), {
                  signal: context.abortSignal,
                  timeoutMs: options.callTimeoutMs,
                  context: {
                    sessionId: context.sessionId,
                    runId: context.runId,
                    turnId: context.turnId,
                    toolCallId: context.toolCallId,
                    cwd: context.cwd,
                    executionBoundary: context.executionBoundary,
                    permissionMode: context.permissionMode,
                  },
                });
                return {
                  execute: async (executionContext) => {
                    const ticket = toolResultSaveTicket();
                    return boundMcpResult(
                      await prepared.execute({
                        ...(executionContext.emitProgress
                          ? { emitProgress: executionContext.emitProgress }
                          : {}),
                        ...(executionContext.requestUserForm
                          ? {
                              requestInteraction: (form, interactionOptions) =>
                                executionContext.requestUserForm!(form, interactionOptions),
                            }
                          : {}),
                      }),
                      options.toolResultRoot,
                      { sessionId: context.sessionId, origin: executionContext.origin },
                      ticket,
                    );
                  },
                  cancel: () => prepared.cancel(),
                };
              },
            }
          : {}),
        impl: async (args: unknown, context) => {
          const ticket = toolResultSaveTicket();
          // Managed network authority applies equally to Direct and nested CodeMode dispatch.
          if (
            options.executionLocation !== 'remote' &&
            context.executionBoundary?.kind === 'managed' &&
            context.executionBoundary.profile.network.kind !== 'enabled'
          ) {
            if (!context.requestSandboxBoundary) {
              throw new Error('MCP network access requires sandbox boundary approval');
            }
            const settlement = await context.requestSandboxBoundary(
              { network: { enabled: true } },
              `Call MCP tool ${descriptor.serverId}/${descriptor.name}. Approving opens the network for this whole session, Bash commands included.`,
            );
            if (settlement.request.status !== 'approved') {
              throw new Error('MCP network access denied');
            }
          }
          const result = await provider.callTool(binding, asArguments(args), {
            signal: context.abortSignal,
            timeoutMs: options.callTimeoutMs,
            context: {
              sessionId: context.sessionId,
              turnId: context.turnId,
              toolCallId: context.toolCallId,
              cwd: context.cwd,
            },
            ...(context.emitProgress ? { emitProgress: context.emitProgress } : {}),
            ...(context.requestUserForm
              ? {
                  requestInteraction: (
                    form: InteractionFormInput,
                    interactionOptions?: { readonly cancellationSignal?: AbortSignal },
                  ) => context.requestUserForm!(form, interactionOptions),
                }
              : {}),
          });
          return boundMcpResult(result, options.toolResultRoot, context, ticket);
        },
        toModelOutput: ({ output }) => mcpResultToModelOutput(output),
      } satisfies MakaTool,
    };
  });
}

function mcpToolDescription(descriptor: McpToolDescriptor): string {
  const description =
    descriptor.description?.trim() ||
    `MCP tool ${descriptor.name} provided by ${descriptor.serverId}`;
  return description.slice(0, REQUEST_COMPOSITION_MAX_TOOL_DESCRIPTION_LENGTH);
}

export function mcpProxyToolName(serverId: string, toolName: string): string {
  const raw = `mcp__${sanitizeNamePart(serverId)}__${sanitizeNamePart(toolName)}`;
  if (raw.length <= MAX_PROVIDER_TOOL_NAME) return raw;
  const hash = createHash('sha256')
    .update(`${serverId}\0${toolName}`)
    .digest('hex')
    .slice(0, HASH_CHARS);
  return `${raw.slice(0, MAX_PROVIDER_TOOL_NAME - HASH_CHARS - 2)}__${hash}`;
}

function sanitizeNamePart(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return sanitized || 'unnamed';
}

function asArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('MCP tool arguments must be an object');
}

/**
 * A result the model would be shown more than it can take: past
 * {@link MCP_MAX_INLINE_CHARS} characters or {@link MCP_MAX_RESULT_TOKENS}
 * estimated tokens, every block counted, and with no image, it is saved to a
 * file ({@link mcpResultFileText}) and the result becomes the sentence that
 * names it. A result with an image stays, its text cut to the token limit
 * when it is shown.
 *
 * Only a result the model reads is bounded here. A call from a Code Mode
 * cell hands its result to the cell's code, which cannot read a file; it is
 * held to the cell's own limit on a nested result instead, and what the cell
 * returns is bounded as that call's result.
 */
async function boundMcpResult(
  result: McpCallResult,
  root: string | undefined,
  context: { readonly sessionId: string; readonly origin?: 'provider' | 'code_mode' },
  /** Taken when the call started: a Session retired since gets no file. */
  ticket: number,
): Promise<McpCallResult> {
  if (root === undefined || context.origin === 'code_mode') return result;
  const blocks = Array.isArray(result.content) ? result.content : [];
  if (blocks.some((block) => block.type === 'image')) return result;
  const text = mcpResultToModelOutput(result, {
    textBytes: Number.POSITIVE_INFINITY,
    summarizedBlocks: Number.POSITIVE_INFINITY,
  })
    .value.flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
  if (text.length <= MCP_MAX_INLINE_CHARS && estimateTextTokens(text) <= MCP_MAX_RESULT_TOKENS) {
    return result;
  }
  const file = mcpResultFileText(result);
  try {
    const saved = await saveToolResultText(
      toolResultFilePath(root, context.sessionId, newToolResultFileName()),
      file.text,
      ticket,
    );
    const notice =
      file.complete || saved.truncated ? savedToolResultNotice(saved) : partialFileNotice(saved);
    return { content: [{ type: 'text', text: notice }] };
  } catch {
    return result;
  }
}

function partialFileNotice(saved: SavedToolResult): string {
  return `Output too long to show, and not all of it could be saved: ${saved.path} holds ${formatCount(saved.chars)} characters of it, and a line in the file marks what was left out. Read it with Read or search it with Grep.`;
}

/**
 * A result as a saved file holds it, for Read to page and Grep to search:
 * every block in order, each under a line that names it, then
 * `structuredContent` under its own. Text is written as it is, and JSON laid
 * out ({@link layOutJson}); binary data is described in its block's line, not
 * written. `complete` is false when a part could not be written; a line says
 * so where it would have been.
 */
export function mcpResultFileText(result: McpCallResult): { text: string; complete: boolean } {
  const sections: string[] = [];
  let complete = true;
  const json = (value: unknown): string => {
    try {
      const text = JSON.stringify(value);
      if (text !== undefined) return layOutJson(text) ?? text;
    } catch {
      // Written below as a part left out.
    }
    complete = false;
    return '[This part could not be written.]';
  };
  const binary = (what: string, base64Chars: number) =>
    `--- ${what}: binary, ${formatCount(base64Chars)} base64 characters, not written ---`;
  for (const block of Array.isArray(result.content) ? result.content : []) {
    switch (block.type) {
      case 'text':
        sections.push(`--- text ---\n${readableText(block.text)}`);
        break;
      case 'resource': {
        const name = `resource ${block.uri}${block.mimeType ? ` (${block.mimeType})` : ''}`;
        if (block.text !== undefined) sections.push(`--- ${name} ---\n${readableText(block.text)}`);
        if (block.blob !== undefined) sections.push(binary(name, block.blob.length));
        if (block.text === undefined && block.blob === undefined) sections.push(`--- ${name} ---`);
        break;
      }
      case 'resource_link': {
        const { type: _type, ...link } = block;
        sections.push(`--- resource link ${block.uri} ---\n${json(link)}`);
        break;
      }
      case 'image':
      case 'audio':
        sections.push(binary(`${block.type} (${block.mimeType})`, block.data.length));
        break;
      default:
        sections.push(`--- block of an unknown type ---\n${json(block.value)}`);
    }
  }
  if (result.structuredContent !== undefined) {
    sections.push(`--- structuredContent ---\n${json(result.structuredContent)}`);
  }
  return { text: sections.join('\n'), complete };
}

function readableText(text: string): string {
  return layOutJson(text) ?? text;
}

function mcpResultToModelOutput(
  output: unknown,
  limits: { readonly textBytes: number; readonly summarizedBlocks: number } = {
    textBytes: MAX_MODEL_TEXT_BYTES,
    summarizedBlocks: MAX_SUMMARIZED_BLOCKS,
  },
): Extract<ToolResultOutput, { type: 'content' }> {
  const result = output as Partial<McpCallResult>;
  const blocks = Array.isArray(result.content) ? result.content : [];
  const value: ToolResultContentPart[] = [];
  const nonVisual: unknown[] = [];
  let remainingTextBytes = limits.textBytes;
  let imageChars = 0;
  let imageCount = 0;
  let omittedSummaryBlocks = 0;

  const appendText = (text: string): void => {
    if (remainingTextBytes <= 0) return;
    const clipped = clipModelText(text, remainingTextBytes);
    remainingTextBytes -= Buffer.byteLength(clipped, 'utf8');
    value.push({ type: 'text', text: clipped });
  };
  const appendSummary = (summary: unknown): void => {
    if (nonVisual.length < limits.summarizedBlocks) nonVisual.push(summary);
    else omittedSummaryBlocks += 1;
  };

  for (const block of blocks) {
    if (block.type === 'text') appendText(block.text);
    else if (
      block.type === 'image' &&
      imageCount < MAX_NATIVE_IMAGES &&
      imageChars + block.data.length <= MAX_NATIVE_IMAGE_BASE64_CHARS
    ) {
      value.push({
        type: 'file',
        data: { type: 'data', data: block.data },
        mediaType: block.mimeType,
      });
      imageCount += 1;
      imageChars += block.data.length;
    } else appendSummary(summarizeNonVisualBlock(block, limits.textBytes));
  }
  if (nonVisual.length || omittedSummaryBlocks || result.structuredContent !== undefined) {
    appendText(
      safeJsonStringify({
        ...(nonVisual.length ? { content: nonVisual } : {}),
        ...(omittedSummaryBlocks ? { omittedContentBlocks: omittedSummaryBlocks } : {}),
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : {}),
      }),
    );
  }
  if (value.length === 0) value.push({ type: 'text', text: 'MCP tool completed with no content.' });
  return { type: 'content', value };
}

function summarizeNonVisualBlock(
  block: McpCallResult['content'][number],
  maxTextBytes: number,
): unknown {
  if (block.type === 'audio') {
    return {
      type: block.type,
      mimeType: block.mimeType,
      base64Chars: block.data.length,
    };
  }
  if (block.type === 'resource') {
    return {
      ...block,
      ...(block.text ? { text: clipModelText(block.text, maxTextBytes) } : {}),
      ...(block.blob ? { blob: undefined, base64Chars: block.blob.length } : {}),
    };
  }
  if (block.type === 'image') {
    return {
      type: block.type,
      mimeType: block.mimeType,
      base64Chars: block.data.length,
      omitted: 'too_large',
    };
  }
  if (block.type === 'unknown') return { type: block.type, omitted: true };
  return block;
}

/** At most `maxBytes` of UTF-8, the cut marked. */
function clipModelText(value: string, maxBytes: number): string {
  if (value.length <= maxBytes / 3 || Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');
  if (maxBytes <= markerBytes) return truncateUtf8(TRUNCATION_MARKER, maxBytes);
  return `${truncateUtf8(value, maxBytes - markerBytes)}${TRUNCATION_MARKER}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{"content":"MCP output could not be serialized"}';
  }
}

/**
 * `text` laid out for a saved file when it is a JSON object or array;
 * undefined when it is not. Two spaces to a level, and each `\n` in a string
 * written as a line break, so that Grep finds one field to a line and Read
 * pages a long string as the text it holds. Nothing else changes: the text is
 * re-spaced, not re-serialized, so every number stays exactly as the server
 * wrote it.
 */
export function layOutJson(text: string): string | undefined {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return undefined;
  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }
  let out = '';
  let depth = 0;
  const newline = () => `\n${'  '.repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      out += breakStringLines(text.slice(i, end + 1));
      i = end;
    } else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      let next = i + 1;
      while (/\s/u.test(text[next] ?? '')) next++;
      if (text[next] === close) {
        out += `${c}${close}`;
        i = next;
      } else {
        depth++;
        out += `${c}${newline()}`;
      }
    } else if (c === '}' || c === ']') {
      depth--;
      out += `${newline()}${c}`;
    } else if (c === ',') out += `,${newline()}`;
    else if (c === ':') out += ': ';
    else if (!/\s/u.test(c)) out += c;
  }
  return out;
}

/**
 * A JSON string token with each `\n` escape written as a line break, and
 * `\r\n` as CR LF. Every other escape stays, `\\` among them, so an escaped
 * backslash before an `n` is never taken for one.
 */
function breakStringLines(token: string): string {
  if (!token.includes('\\')) return token;
  return token.replace(/\\(?:r\\n|[\s\S])/gu, (escape) =>
    escape === '\\n' ? '\n' : escape === '\\r\\n' ? '\r\n' : escape,
  );
}
