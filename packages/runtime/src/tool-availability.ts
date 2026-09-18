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

import type { ToolCategory } from '@maka/core/permission';
import { TOOL_NAMES, TOOL_SEARCH_PROVIDER_NAME } from '@maka/core/tool-names';
import type { ToolAvailabilityDiagnostic } from '@maka/core/usage-stats/types';
import MiniSearch from 'minisearch';
import { z } from 'zod';

import { estimateTokens } from './context-budget-helpers.js';
import {
  canonicalizeToolSet,
  requestCompositionToolSchemas,
  stableHash,
  toolSchemaCharsForDiagnostics,
} from './request-shape.js';
import { toolActivationKey } from './tool-activation-identity.js';
import type { JSONObject } from './model-protocol.js';
import type { NativeToolDeferral } from './native-tool-deferral.js';
import type { MakaTool, ToolGating } from './tool-runtime.js';

/** Canonical name of Maka's provider-independent deferred-tool search connector. */
export const TOOL_SEARCH_NAME = TOOL_NAMES.toolSearch;
/** Provider-safe alias used because OpenAI Responses reserves the plain name. */
export { TOOL_SEARCH_PROVIDER_NAME };
export const TOOL_SEARCH_DEFAULT_LIMIT = 5;
export const TOOL_SEARCH_MAX_LIMIT = 20;
export const TOOL_SEARCH_MAX_SCHEMA_CHARS = 64 * 1024;

/** Tools that remain visible whenever they are bound. */
const DIRECT_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.bash,
  TOOL_NAMES.read,
  TOOL_NAMES.archiveRead,
  TOOL_NAMES.write,
  TOOL_NAMES.edit,
  TOOL_NAMES.glob,
  TOOL_NAMES.grep,
  TOOL_NAMES.webFetch,
  TOOL_NAMES.askUserQuestion,
  // Delivery is default-loaded, as in the reference harness: a ToolSearch
  // round trip before the first file card would defeat "send it the moment it
  // exists". Delegation stays deferred.
  TOOL_NAMES.sendUserFile,
  TOOL_NAMES.sendUserMessage,
  TOOL_NAMES.taskStop,
  // The task list is default-loaded for the same reason, and because the
  // reference harness loads it directly too. `<keeping_the_person_informed>`
  // asks for a list "whenever the work has stages worth watching" — a search
  // round trip before the first of them is a step between the request and the
  // thing that shows the person it landed.
  TOOL_NAMES.taskCreate,
  TOOL_NAMES.taskUpdate,
  TOOL_NAMES.taskList,
  TOOL_NAMES.taskGet,
  // Existing carve-out pending the separate skill-discovery decision.
  TOOL_NAMES.skill,
  TOOL_NAMES.skillSearch,
  // Provider-routed equivalent of the direct Write/Edit surface.
  TOOL_NAMES.applyPatch,
]);

/**
 * Discovery capability-family derived from a tool's permission `categoryHint`.
 *
 * This reuses the existing permission taxonomy (`ToolCategory`) purely for
 * *presentation* in the deferred-tool search inventory: it never loads a tool
 * schema and never affects permission classification. Several permission
 * categories intentionally collapse into one browsing family (e.g. every shell
 * bucket → `shell`). `custom_tool` is deliberately `null` so our own
 * session-scoped tools without a stronger hint keep falling back to `other`.
 *
 * The map is TOTAL over `ToolCategory` on purpose: adding a new category to the
 * union forces an explicit decision here (family or `null`) at compile time,
 * instead of silently collapsing the new category into `other`.
 */
const CATEGORY_FAMILY: Record<ToolCategory, { id: string; label: string } | null> = {
  read: { id: 'filesystem', label: 'Filesystem & search' },
  file_write: { id: 'filesystem', label: 'Filesystem & search' },
  fs_destructive: { id: 'filesystem', label: 'Filesystem & search' },
  shell_safe: { id: 'shell', label: 'Shell & processes' },
  shell_unsafe: { id: 'shell', label: 'Shell & processes' },
  privileged: { id: 'shell', label: 'Shell & processes' },
  git_destructive: { id: 'shell', label: 'Shell & processes' },
  web_read: { id: 'web', label: 'Web & network' },
  network_send: { id: 'web', label: 'Web & network' },
  browser: { id: 'browser', label: 'Browser automation' },
  computer_use: { id: 'computer_use', label: 'Computer use' },
  client_capability: { id: 'client_capability', label: 'Client capabilities' },
  subagent: { id: 'agents', label: 'Agent orchestration' },
  // null = intentionally ungrouped; falls back to the `other` bucket.
  custom_tool: null,
};

/** The `select:` query form, matched case-insensitively on the prefix only. */
const TOOL_SEARCH_SELECT_PREFIX = 'select:';

/** Optional search metadata for a subset of the bound deferred tools. */
export interface ToolGroup {
  id: string;
  toolNames: readonly string[];
  label?: string;
  description?: string;
}

export interface ToolAvailabilityConfig {
  /**
   * Search-space presentation metadata derived from the current bound tools.
   * Supplying this config enables default deferral; omitting it keeps every
   * bound tool direct for an explicit wire-schema ceiling.
   */
  groups?: readonly ToolGroup[];
  /**
   * The wire dialect that can hold a schema without showing it to the model.
   * Availability then stops being "what was sent" and becomes "what was
   * pointed at", which is what keeps the request's tool block — and the cached
   * prefix standing on it — still across a search.
   */
  nativeDeferral?: NativeToolDeferral;
}

export interface ToolSearchResult {
  readonly activated: string[];
  readonly blocked?: {
    readonly name: string;
    readonly reason: 'schema_too_large' | 'schema_budget_exhausted';
    readonly schemaChars: number;
  };
}

export function toolAvailabilityHash(
  config: ToolAvailabilityConfig | undefined,
): `sha256:${string}` {
  return stableHash({
    mode: config === undefined ? 'full' : (config.nativeDeferral ?? false) ? 'native' : 'search',
    groups: (config?.groups ?? []).map((group) => ({
      id: group.id,
      toolNames: [...new Set(group.toolNames)].sort(compareExactString),
      ...(group.label !== undefined ? { label: group.label } : {}),
      ...(group.description !== undefined ? { description: group.description } : {}),
    })),
  });
}

function compareExactString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Everything the backend needs for one turn. */
export interface ToolAvailabilityPlan {
  /** Full dispatch set (sorted bound tools + search connector + repair fallback). */
  providerTools: MakaTool[];
  /** Step-0 model-visible subset. */
  activeTools: string[];
  /** Recomputes the provider-visible subset from the turn-owned activation map. */
  projectActiveTools?: (_options?: unknown) => { activeTools: string[] };
  /** Tool names the repair path matches against; tracks the current step snapshot. */
  currentRepairToolNames: () => string[];
  /** Execute-boundary gating against the immutable step-start snapshot. */
  gating?: ToolGating;
  /**
   * Tools whose schema rides the wire but must stay out of the model's
   * context until something points at them. Only the native mode fills it;
   * the withholding mode has no such tools, because it withholds instead.
   */
  deferredNames?: ReadonlySet<string>;
  diagnostics: (
    activeTools: readonly string[],
    visibleToolSchemaChars: number,
  ) => ToolAvailabilityDiagnostic | undefined;
}

interface SearchGroup {
  id: string;
  toolNames: string[];
  label?: string;
  description?: string;
}

interface SearchDocument {
  id: string;
  name: string;
  searchText: string;
}

/**
 * Immutable, backend-scoped bound-tool inventory and MiniSearch index.
 *
 * Mutable activation belongs to the per-send TurnScope and is passed to
 * prepare(). Constructing one AiSdkBackend therefore constructs one index; all
 * turns on that backend reuse it without sharing activation state.
 */
export class ToolAvailabilityRuntime {
  private readonly tools: readonly MakaTool[];
  private readonly toolsByName: ReadonlyMap<string, MakaTool>;
  private readonly activationKeysByName: ReadonlyMap<string, `sha256:${string}`>;
  private readonly groups: readonly SearchGroup[];
  private readonly searchableNames: ReadonlySet<string>;
  private readonly directNames: ReadonlySet<string>;
  private readonly searchIndex?: MiniSearch<SearchDocument>;
  private readonly nativeDeferral: NativeToolDeferral | undefined;

  constructor(
    tools: readonly MakaTool[],
    config: ToolAvailabilityConfig | undefined,
    private readonly invalidTool: MakaTool,
  ) {
    if (tools.some((tool) => tool.name === TOOL_SEARCH_NAME)) {
      throw new Error(`Tool name "${TOOL_SEARCH_NAME}" is reserved by Runtime`);
    }
    if (tools.some((tool) => tool.name === TOOL_SEARCH_PROVIDER_NAME)) {
      throw new Error(`Tool name "${TOOL_SEARCH_PROVIDER_NAME}" is reserved by Runtime`);
    }
    this.nativeDeferral = config?.nativeDeferral;
    this.tools = [...tools];
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    this.activationKeysByName = new Map(tools.map((tool) => [tool.name, toolActivationKey(tool)]));

    const known = new Set(this.toolsByName.keys());
    const searchable =
      config === undefined
        ? new Set<string>()
        : new Set([...known].filter((name) => !DIRECT_TOOL_NAMES.has(name)));
    const claimed = new Set<string>();
    const groups: SearchGroup[] = [];
    for (const group of config?.groups ?? []) {
      if (!group.id) continue;
      const members: string[] = [];
      for (const name of group.toolNames) {
        // The first source to claim a currently bound tool owns its inventory row.
        if (!searchable.has(name) || claimed.has(name)) continue;
        claimed.add(name);
        members.push(name);
      }
      if (members.length === 0) continue;
      members.sort(compareExactString);
      groups.push({
        id: group.id,
        toolNames: members,
        ...(group.label !== undefined ? { label: group.label } : {}),
        ...(group.description !== undefined ? { description: group.description } : {}),
      });
    }
    const ungrouped = [...searchable].filter((name) => !claimed.has(name)).sort(compareExactString);
    if (ungrouped.length > 0) {
      // Bucket ungrouped native tools by their permission `categoryHint` so the
      // search inventory advertises a compact capability-family map instead of a
      // single opaque `other` group. This reads metadata already on the bound
      // tool (no schema is loaded) and never affects permission classification.
      // A caller-supplied group with a colliding id keeps precedence: family
      // members merge into it. Tools with no hint (or `custom_tool`) still fall
      // back to `other`.
      const familyMembers = new Map<string, { label?: string; names: string[] }>();
      const otherNames: string[] = [];
      for (const name of ungrouped) {
        const hint = this.toolsByName.get(name)?.categoryHint;
        // A mapped-but-`null` entry (e.g. custom_tool) and an absent hint both
        // route to `other`; only a non-null family is bucketed.
        const family = hint ? CATEGORY_FAMILY[hint] : null;
        if (!family) {
          otherNames.push(name);
          continue;
        }
        const bucket = familyMembers.get(family.id) ?? { label: family.label, names: [] };
        bucket.names.push(name);
        familyMembers.set(family.id, bucket);
      }
      for (const id of [...familyMembers.keys()].sort(compareExactString)) {
        const bucket = familyMembers.get(id)!;
        const existing = groups.find((group) => group.id === id);
        if (existing) {
          existing.toolNames = [...existing.toolNames, ...bucket.names].sort(compareExactString);
        } else {
          groups.push({
            id,
            toolNames: [...bucket.names].sort(compareExactString),
            ...(bucket.label !== undefined ? { label: bucket.label } : {}),
          });
        }
      }
      if (otherNames.length > 0) {
        const fallback = groups.find((group) => group.id === 'other');
        if (fallback) {
          fallback.toolNames = [...fallback.toolNames, ...otherNames].sort(compareExactString);
        } else {
          groups.push({ id: 'other', toolNames: otherNames.sort(compareExactString) });
        }
      }
    }
    this.groups = groups;
    this.searchableNames = searchable;
    this.directNames = new Set([...known].filter((name) => !searchable.has(name)));

    if (searchable.size > 0) {
      const groupByToolName = new Map(
        groups.flatMap((group) => group.toolNames.map((name) => [name, group] as const)),
      );
      const index = new MiniSearch<SearchDocument>({
        fields: ['name', 'searchText'],
        storeFields: ['name'],
        idField: 'id',
        searchOptions: {
          boost: { name: 4, searchText: 1 },
          combineWith: 'OR',
          prefix: true,
          fuzzy: 0.2,
        },
      });
      index.addAll(
        [...searchable].map((name) => {
          const tool = this.toolsByName.get(name)!;
          const group = groupByToolName.get(name);
          return {
            id: name,
            name,
            searchText: [
              name.replaceAll('_', ' '),
              tool.description,
              group?.id,
              group?.label,
              group?.description,
            ]
              .filter((value): value is string => value !== undefined && value.length > 0)
              .join(' '),
          };
        }),
      );
      this.searchIndex = index;
    }
  }

  prepare(
    activeTools: Map<string, string>,
    requiredToolNames: ReadonlySet<string> = new Set(),
  ): ToolAvailabilityPlan {
    if (!this.searchIndex) {
      const canonical = canonicalizeToolSet(this.tools, this.invalidTool);
      return {
        providerTools: canonical.providerTools,
        activeTools: canonical.activeTools,
        currentRepairToolNames: () => canonical.activeTools,
        diagnostics: () => undefined,
      };
    }

    const connector = this.buildSearchConnector(activeTools);
    const allTools = [...this.tools, connector];
    const canonical = canonicalizeToolSet(allTools, this.invalidTool);
    const knownNames = new Set(canonical.providerTools.map((tool) => tool.name));
    // Activation belongs to a stable logical contribution, not a temporary
    // wrapper object or merely its name. Equivalent Host wrappers survive
    // per-step rebuilding; a replaced Plugin generation does not.
    for (const [name, activatedKey] of activeTools) {
      if (this.activationKeysByName.get(name) !== activatedKey) activeTools.delete(name);
    }
    const requiredNames = [...requiredToolNames].filter((name) => knownNames.has(name));
    const step = { active: new Set<string>() };
    const computeActive = (): string[] => {
      const names = new Set<string>([...this.directNames, TOOL_SEARCH_NAME]);
      for (const name of activeTools.keys()) {
        if (knownNames.has(name)) names.add(name);
      }
      for (const name of requiredNames) names.add(name);
      const active = canonicalizeToolSet(allTools, this.invalidTool, names).activeTools;
      // Replace, rather than mutate, so an in-flight step retains its own snapshot.
      step.active = new Set(active);
      return active;
    };

    if (this.nativeDeferral !== undefined) {
      // Every schema goes out, every step, in the same order — the tool block
      // is written once and never rewritten, so the prefix cached behind it
      // survives a search. What the model may SEE is `defer_loading` plus the
      // references the connector hands back; what it may CALL is still
      // `step.active`, and that stays this Runtime's answer alone.
      const wire = canonical.activeTools;
      computeActive();
      return {
        providerTools: canonical.providerTools,
        activeTools: wire,
        projectActiveTools: () => {
          computeActive();
          return { activeTools: wire };
        },
        currentRepairToolNames: () => [...step.active],
        gating: { gatedNames: this.searchableNames, activeNames: () => step.active },
        deferredNames: this.searchableNames,
        // The wire is no longer the measure of anything: every schema is on it.
        // What a reader wants to know is what reached the model's context, so
        // both halves of the diagnostic come from the visible set — a char
        // count of the whole wire beside a count of three tools would report
        // this mode saving nothing, which is the opposite of true.
        diagnostics: () => {
          const visible = [...step.active];
          return this.buildDiagnostic(
            allTools,
            visible,
            toolSchemaCharsForDiagnostics(canonical.providerTools, visible),
          );
        },
      };
    }

    return {
      providerTools: canonical.providerTools,
      activeTools: computeActive(),
      projectActiveTools: () => ({ activeTools: computeActive() }),
      currentRepairToolNames: () => [...step.active],
      gating: { gatedNames: this.searchableNames, activeNames: () => step.active },
      diagnostics: (active, chars) => this.buildDiagnostic(allTools, active, chars),
    };
  }

  /** The tools this Runtime holds back from the model's context. */
  deferredToolNames(): ReadonlySet<string> {
    return this.nativeDeferral === undefined ? new Set<string>() : this.searchableNames;
  }

  /**
   * Re-admit the tools an earlier turn already pointed the provider at.
   *
   * Only in the native mode, and only for names this Runtime still binds: the
   * transcript says what was pointed at, this says whether that still means
   * anything. The withholding mode deliberately forgets at a turn boundary —
   * nothing there outlives the request that carried it.
   */
  seedActivation(activeTools: Map<string, string>, names: readonly string[]): void {
    if (this.nativeDeferral === undefined) return;
    for (const name of names) {
      if (!this.searchableNames.has(name)) continue;
      const key = this.activationKeysByName.get(name);
      if (key !== undefined) activeTools.set(name, key);
    }
  }

  /** The activated tools as OpenAI function declarations, for its search output. */
  private openAiToolDefinitions(names: readonly string[]): JSONObject[] {
    const tools = names
      .map((name) => this.toolsByName.get(name))
      .filter((tool): tool is MakaTool => tool !== undefined);
    return requestCompositionToolSchemas(
      tools,
      tools.map((tool) => tool.name),
    ).map(
      (shape) =>
        ({
          type: 'function',
          name: shape.name,
          description: shape.description,
          // The complete declaration, `defer_loading` included: OpenAI asks for
          // the whole definition back, and these are deferred tools being
          // loaded — dropping the flag would describe them as something else.
          defer_loading: true,
          parameters: shape.inputSchema,
        }) as JSONObject,
    );
  }

  private buildSearchConnector(
    activeTools: Map<string, string>,
  ): MakaTool<{ query: string; max_results?: number }, ToolSearchResult> {
    const description = renderInventory(this.groups, this.nativeDeferral === undefined);
    const searchArguments = z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .describe(
          'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
        ),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(TOOL_SEARCH_MAX_LIMIT)
        .optional()
        .describe(`Maximum number of results to return (default: ${TOOL_SEARCH_DEFAULT_LIMIT})`),
    });
    // OpenAI's search tool owns its own call shape: the model's arguments
    // arrive nested under `arguments`, beside the `call_id` the SDK has already
    // used as the tool call's id. Runtime validates what actually arrives, or
    // every search fails its own schema before it runs.
    const openAiCall = this.nativeDeferral === 'openai-responses';
    const parameters = openAiCall
      ? z.object({ arguments: searchArguments, call_id: z.string().nullish() })
      : searchArguments;
    return {
      name: TOOL_SEARCH_NAME,
      description,
      parameters,
      // On OpenAI's Responses wire this IS the provider's search connector, so
      // the declaration carries the prose and the argument schema; everywhere
      // else it is an ordinary function tool. Either way Runtime runs it.
      ...(openAiCall
        ? {
            providerTool: {
              kind: 'openai-tool-search' as const,
              description,
              // The declaration describes the SEARCH arguments, not the
              // envelope around them — that part is OpenAI's own.
              parameters: toolArgumentSchema(TOOL_SEARCH_NAME, description, searchArguments),
            },
          }
        : {}),
      impl: (input, context) => {
        const { query, max_results: limit = TOOL_SEARCH_DEFAULT_LIMIT } = unwrapSearchArguments(
          input as Record<string, unknown>,
        );
        const normalizedQuery = query.trim();
        // Whether a tool already held is skipped depends on what the answer IS
        // in this mode.
        //
        // Withholding: the answer is the activation, and a held tool's schema
        // is already on the wire — re-admitting it would buy nothing and would
        // spend the schema budget below on bytes already sent. Skipped.
        //
        // Native: the answer is the ranking, and the reader reads it as one.
        // Dropping a held tool from it does not save anything — the definition
        // is already loaded either way — it just answers a different question
        // than the one asked. Observed live: a search for `+desktop_browser
        // snapshot`, whose best match was held from an earlier turn, came back
        // with the browser's click and type tools instead, and the reader
        // recorded the result as wrong.
        const ranked = this.rankToolSearchQuery(normalizedQuery)
          .filter((name) => this.nativeDeferral !== undefined || !activeTools.has(name))
          .slice(0, TOOL_SEARCH_MAX_LIMIT)
          .filter((name) => this.searchableNames.has(name));
        const activated: string[] = [];
        let blocked: ToolSearchResult['blocked'];
        let schemaChars = 0;
        for (const name of ranked) {
          if (activated.length >= limit) break;
          const tool = this.toolsByName.get(name);
          if (!tool) continue;
          const chars = toolSchemaCharsForDiagnostics([tool], [tool.name]);
          if (chars > TOOL_SEARCH_MAX_SCHEMA_CHARS) {
            blocked ??= { name, reason: 'schema_too_large', schemaChars: chars };
            continue;
          }
          if (schemaChars + chars > TOOL_SEARCH_MAX_SCHEMA_CHARS) {
            blocked = { name, reason: 'schema_budget_exhausted', schemaChars: chars };
            break;
          }
          activated.push(name);
          schemaChars += chars;
        }
        for (const name of activated) activeTools.set(name, this.activationKeysByName.get(name)!);
        const result: ToolSearchResult = {
          activated,
          ...(blocked ? { blocked } : {}),
        };
        context.emitRunTrace?.('tool_searched', 'Deferred tools searched', {
          query: normalizedQuery,
          requestedLimit: limit,
          maxResults: limit,
          ranked,
          activated,
          newlyActivated: activated,
          schemaChars,
          ...(blocked ? { blocked } : {}),
        });
        return result;
      },
      toModelOutput: ({ output }) => {
        const result = output as ToolSearchResult;
        // Anthropic reads a reference, not a name: a `tool_reference` in this
        // result is what makes the deferred definition appear, and it appears
        // INLINE here rather than by rewriting the tool block, which is the
        // whole point — the prefix in front of it never moves. Anything the
        // reader still has to be told (a budget refusal, an empty search) rides
        // alongside as text, because a result with no content at all is not a
        // result.
        // OpenAI loads from the definitions themselves rather than from a
        // reference, so the search returns what it found in full. Its output
        // contract has room for nothing else, so a budget refusal cannot be
        // reported here — the reader simply gets fewer tools than it asked for.
        if (this.nativeDeferral === 'openai-responses') {
          return { type: 'json', value: { tools: this.openAiToolDefinitions(result.activated) } };
        }
        if (this.nativeDeferral === 'anthropic') {
          const references = result.activated.map((toolName) => ({
            type: 'custom' as const,
            providerOptions: { anthropic: { type: 'tool-reference', toolName } },
          }));
          // References alone whenever there are any. Anthropic documents this
          // result as a list of references and nothing else, and a block beside
          // them is a shape nothing here has ever put on a real request — not
          // worth risking on the rare path where a budget refusal happens. A
          // refusal is already in the run trace, and the other native dialect
          // has nowhere to report one either: the reader sees fewer tools,
          // which is what a refusal means.
          return references.length > 0
            ? { type: 'content', value: references }
            : // Nothing matched. A result still has to say something.
              {
                type: 'content',
                value: [{ type: 'text', text: JSON.stringify({ activated: [] }) }],
              };
        }
        return {
          type: 'json',
          value: {
            activated: [...result.activated],
            ...(result.blocked ? { blocked: { ...result.blocked } } : {}),
          },
        };
      },
    };
  }

  /**
   * Which deferred tools a query names, in the order they should be activated.
   *
   * Three query forms, because three different things a caller can know:
   * `select:A,B` when it knows the exact names (a listing gave them, or an
   * earlier search did) and ranking would only get in the way; `+word` when it
   * knows part of the name but not the rest; and free text when it knows only
   * what it needs to do. The first two are filters over the same inventory, so
   * a name that is not bound is simply absent rather than an error.
   */
  private rankToolSearchQuery(query: string): string[] {
    if (query.toLowerCase().startsWith(TOOL_SEARCH_SELECT_PREFIX)) {
      const requested = query
        .slice(TOOL_SEARCH_SELECT_PREFIX.length)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      // Exact and case-sensitive: a tool name is an identifier, and activating
      // a near neighbour of the one that was asked for is worse than nothing.
      return [...new Set(requested)].filter((name) => this.toolsByName.has(name));
    }
    const required: string[] = [];
    const terms: string[] = [];
    for (const token of query.split(/\s+/)) {
      if (token.startsWith('+') && token.length > 1) required.push(token.slice(1).toLowerCase());
      else if (token.length > 0) terms.push(token);
    }
    const remainder = terms.join(' ');
    const ranked = (
      remainder === ''
        ? [...this.searchableNames]
        : this.searchIndex!.search(remainder).map((result) => String(result.id))
    ).filter((name) => required.every((term) => name.toLowerCase().includes(term)));
    if (required.length === 0 || ranked.length > 0) return ranked;
    // A `+term` that ranked nothing still names something: fall back to the
    // name filter alone so the required word is never silently dropped.
    return [...this.searchableNames].filter((name) =>
      required.every((term) => name.toLowerCase().includes(term)),
    );
  }

  private buildDiagnostic(
    allTools: readonly MakaTool[],
    active: readonly string[],
    visibleToolSchemaChars: number,
  ): ToolAvailabilityDiagnostic {
    const activeSet = new Set(active);
    const enabledSourceIds = this.groups
      .filter((group) => group.toolNames.every((name) => activeSet.has(name)))
      .map((group) => group.id)
      .sort(compareExactString);
    const availableSourceIds = this.groups
      .filter((group) => !group.toolNames.every((name) => activeSet.has(name)))
      .map((group) => group.id)
      .sort(compareExactString);
    const full = canonicalizeToolSet(allTools, this.invalidTool);
    const fullToolSchemaChars = toolSchemaCharsForDiagnostics(full.providerTools, full.activeTools);
    const toolSchemaCharReduction = Math.max(0, fullToolSchemaChars - visibleToolSchemaChars);

    return {
      mode: this.nativeDeferral === undefined ? 'search' : 'native',
      enabledSourceIds,
      availableSourceIds,
      connectorToolName: TOOL_SEARCH_NAME,
      visibleToolNamesBySource: groupToolNamesById(this.groups),
      visibleToolCount: active.length,
      fullToolCount: full.activeTools.length,
      hiddenToolCount: Math.max(0, full.activeTools.length - active.length),
      visibleToolSchemaChars,
      fullToolSchemaChars,
      toolSchemaCharReduction,
      estimatedToolSchemaTokenReduction: estimateTokens(toolSchemaCharReduction),
    };
  }
}

/**
 * The tools an earlier turn already pointed the provider at.
 *
 * In the native mode a reference keeps the tool expanded for the rest of the
 * conversation, so the gate has to agree across turns or the two drift: the
 * model sees a tool the gate has forgotten, calls it, and is told to search for
 * what it is already holding — once per turn, and each search pays the cache
 * cost the mode exists to avoid.
 *
 * This is one half. The other is the projection re-emitting those references
 * when it replays the result: Runtime rebuilds the history every turn, and a
 * result materialized as plain json says nothing to the provider. Identity is
 * checked by the caller — a name recovered from the past is a claim, not a
 * licence.
 */
export function recoverActivatedToolNames(messages: readonly unknown[]): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'tool' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isRecord(part) || part.type !== 'tool-result') continue;
      if (part.toolName !== TOOL_SEARCH_NAME && part.toolName !== TOOL_SEARCH_PROVIDER_NAME) {
        continue;
      }
      const output = part.output;
      if (!isRecord(output)) continue;
      // Two shapes say the same thing: the json the search returns to a
      // withholding wire, and the references it hands a native one.
      if (output.type === 'json' && isRecord(output.value)) {
        const activated = output.value.activated;
        if (Array.isArray(activated)) {
          for (const name of activated) if (typeof name === 'string') names.add(name);
        }
        // The third shape: OpenAI is handed whole declarations, and their names
        // are the same claim the other two make.
        const declarations = output.value.tools;
        if (Array.isArray(declarations)) {
          for (const declaration of declarations) {
            if (isRecord(declaration) && typeof declaration.name === 'string') {
              names.add(declaration.name);
            }
          }
        }
        continue;
      }
      if (output.type !== 'content' || !Array.isArray(output.value)) continue;
      for (const contentPart of output.value) {
        if (!isRecord(contentPart) || contentPart.type !== 'custom') continue;
        const options = contentPart.providerOptions;
        if (!isRecord(options)) continue;
        const anthropic = options.anthropic;
        if (!isRecord(anthropic) || anthropic.type !== 'tool-reference') continue;
        if (typeof anthropic.toolName === 'string') names.add(anthropic.toolName);
      }
    }
  }
  return [...names];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The search arguments, whichever call shape carried them.
 *
 * A plain function tool is called with them directly. OpenAI's search tool
 * wraps them: `{ arguments: { query, ... }, call_id }`, where `call_id` is the
 * same value the SDK already used as the tool call's id — nothing here has to
 * carry it, only to see past it.
 */
function unwrapSearchArguments(input: Record<string, unknown>): {
  query: string;
  max_results?: number;
} {
  const nested = input.arguments;
  const source = (nested !== null && typeof nested === 'object' ? nested : input) as Record<
    string,
    unknown
  >;
  return {
    query: String(source.query ?? ''),
    ...(typeof source.max_results === 'number' ? { max_results: source.max_results } : {}),
  };
}

/**
 * A tool's argument schema as JSON Schema, through the same conversion the
 * request composition uses — one source, so the declaration a provider reads
 * can never drift from the schema Runtime validates against.
 */
function toolArgumentSchema(
  name: string,
  description: string,
  parameters: unknown,
): Record<string, unknown> {
  const [shape] = requestCompositionToolSchemas(
    [{ name, description, parameters, impl: () => undefined } as MakaTool],
    [name],
  );
  return (shape?.inputSchema ?? {}) as Record<string, unknown>;
}

/**
 * `reportsBudgetRefusals` — only the withholding mode hands a refusal back to
 * the reader. The native dialects answer with references or declarations and
 * have nowhere to put one, so promising a signal they never send would be an
 * instruction about something that cannot happen.
 */
function renderInventory(groups: readonly SearchGroup[], reportsBudgetRefusals: boolean): string {
  const lines = groups.flatMap((group) => [
    `${group.id}:`,
    ...group.toolNames.map((name) => `- ${name}`),
  ]);
  return [
    'Fetches full schema definitions for deferred tools so they can be called.',
    '',
    'Deferred tools appear by name in the inventory below. Until fetched, only the name',
    'is known — there is no parameter schema, so the tool cannot be invoked, and a call',
    'before that fails as unknown. A successful search activates the top matches, whose',
    'full definitions appear on your next step; search again to activate more. Load every',
    ...(reportsBudgetRefusals
      ? [
          'tool you expect to need in one search. A blocked result means the best remaining',
          'match did not fit the schema budget: narrow the query.',
        ]
      : [
          'tool you expect to need in one search. A search that returns fewer tools than you',
          'asked for has reached its budget: narrow the query and search again.',
        ]),
    '',
    'Query forms:',
    '- "select:Read,Edit,Grep" — fetch these exact tools by name',
    '- "notebook jupyter" — keyword search, up to max_results best matches',
    '- "+slack send" — require "slack" in the name, rank by remaining terms',
    '',
    'Searchable tool inventory (group and canonical name only):',
    ...lines,
  ].join('\n');
}

function groupToolNamesById(groups: readonly SearchGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const group of [...groups].sort((a, b) => compareExactString(a.id, b.id))) {
    out[group.id] = [...group.toolNames].sort(compareExactString);
  }
  return out;
}
