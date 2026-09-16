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
import { z } from 'zod';
import {
  DEEP_RESEARCH_ACTIVE_STAGES,
  DEEP_RESEARCH_ARTIFACT_NAME_MAX_CHARS,
  DEEP_RESEARCH_ARTIFACT_ROLES,
  DEEP_RESEARCH_CHECKPOINT_ITEM_MAX_CHARS,
  DEEP_RESEARCH_CHECKPOINT_ITEMS_MAX,
  DEEP_RESEARCH_CHECKPOINT_TEXT_MAX_CHARS,
  DEEP_RESEARCH_CHECKLIST_STATUSES,
  DEEP_RESEARCH_DEFAULT_CHECKLIST,
  DEEP_RESEARCH_INSPECTED_REF_KINDS,
  DEEP_RESEARCH_LOCATOR_MAX_CHARS,
  DEEP_RESEARCH_OBJECTIVE_MAX_CHARS,
  DEEP_RESEARCH_REFS_MAX,
  DEEP_RESEARCH_REPORT_SECTION_KEYS,
  DEEP_RESEARCH_REPORT_SECTION_STATUSES,
  DEEP_RESEARCH_SCOPE_LEVELS,
  DEEP_RESEARCH_STEP_KINDS,
  DEEP_RESEARCH_STEP_LIST_ITEMS_MAX,
  DEEP_RESEARCH_STEP_STATUSES,
  DEEP_RESEARCH_STEP_TEXT_MAX_CHARS,
  normalizeDeepResearchObjective,
  type DeepResearchRun,
  type DeepResearchArtifactRef,
  type DeepResearchEvent,
  type DeepResearchStore,
} from '@maka/core/deep-research-run';
import { redactSecrets } from '@maka/core/redaction';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { type ArtifactRecord } from '@maka/core/artifacts';
import type { MakaTool, MakaToolContext } from './tool-runtime.js';

export const DEEP_RESEARCH_START_TOOL_NAME = TOOL_NAMES.deepResearchStart;
export const DEEP_RESEARCH_SAVE_ARTIFACT_TOOL_NAME = TOOL_NAMES.deepResearchSaveArtifact;
export const DEEP_RESEARCH_READ_ARTIFACT_TOOL_NAME = TOOL_NAMES.deepResearchReadArtifact;
export const DEEP_RESEARCH_UPDATE_CHECKLIST_TOOL_NAME = TOOL_NAMES.deepResearchUpdateChecklist;
export const DEEP_RESEARCH_RECORD_STEP_TOOL_NAME = TOOL_NAMES.deepResearchRecordStep;
export const DEEP_RESEARCH_CHECKPOINT_TOOL_NAME = TOOL_NAMES.deepResearchCheckpoint;
export const DEEP_RESEARCH_STATUS_TOOL_NAME = TOOL_NAMES.deepResearchStatus;
export const DEEP_RESEARCH_COMPLETE_TOOL_NAME = TOOL_NAMES.deepResearchComplete;

const DEEP_RESEARCH_ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.askUserQuestion,
  TOOL_NAMES.read,
  TOOL_NAMES.glob,
  TOOL_NAMES.grep,
  TOOL_NAMES.webSearch,
  DEEP_RESEARCH_START_TOOL_NAME,
  DEEP_RESEARCH_SAVE_ARTIFACT_TOOL_NAME,
  DEEP_RESEARCH_READ_ARTIFACT_TOOL_NAME,
  DEEP_RESEARCH_UPDATE_CHECKLIST_TOOL_NAME,
  DEEP_RESEARCH_RECORD_STEP_TOOL_NAME,
  DEEP_RESEARCH_CHECKPOINT_TOOL_NAME,
  DEEP_RESEARCH_STATUS_TOOL_NAME,
  DEEP_RESEARCH_COMPLETE_TOOL_NAME,
]);

export const DEEP_RESEARCH_ARTIFACT_CONTENT_MAX_CHARS = 512_000;
export const DEEP_RESEARCH_ARTIFACT_READ_DEFAULT_CHARS = 32_000;
export const DEEP_RESEARCH_ARTIFACT_READ_MAX_CHARS = 64_000;
export const DEEP_RESEARCH_STATUS_ARTIFACTS_MAX = 100;

const stableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Expected a stable research, task, or artifact id.')
  .refine(
    (value) => redactSecrets(value) === value,
    'Research references cannot contain secret-like values.',
  );

export interface DeepResearchArtifactStore {
  create(input: {
    sessionId: string;
    turnId: string;
    name: string;
    kind: 'file';
    content: string;
    mimeType: 'text/markdown';
    source: 'deep_research';
    summary: string;
    deepResearchRole: (typeof DEEP_RESEARCH_ARTIFACT_ROLES)[number];
    id: string;
  }): Promise<ArtifactRecord>;
  get(artifactId: string): Promise<ArtifactRecord | null>;
  readText(
    artifactId: string,
    options?: { maxBytes?: number },
  ): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
  delete(artifactId: string): Promise<void>;
}

export interface BuildDeepResearchToolsDeps {
  store: DeepResearchStore;
  artifactStore: DeepResearchArtifactStore;
}

export function buildDeepResearchTools(deps: BuildDeepResearchToolsDeps): MakaTool[] {
  return [
    buildStartTool(deps),
    buildSaveArtifactTool(deps),
    buildReadArtifactTool(deps),
    buildUpdateChecklistTool(deps),
    buildRecordStepTool(deps),
    buildCheckpointTool(deps),
    buildStatusTool(deps),
    buildCompleteTool(deps),
  ];
}

export function isDeepResearchToolAllowed(tool: Pick<MakaTool, 'name'>): boolean {
  return DEEP_RESEARCH_ALLOWED_TOOL_NAMES.has(tool.name);
}

function buildStartTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    objective: string;
    scope_level: (typeof DEEP_RESEARCH_SCOPE_LEVELS)[number];
  },
  string
> {
  return {
    name: DEEP_RESEARCH_START_TOOL_NAME,
    displayName: 'Initialize Research Workspace',
    description: [
      'Open the durable Deep Research workspace for this session and fix its objective. Every other DeepResearch tool refuses until this has run, so call it once, first, as soon as a request is real research rather than a question you can answer from what you already have.',
      '',
      '- The workspace survives context compaction, interruption and process restart: it is where evidence lives, not the transcript. `scope_level` sets the budget, and the workspace opens in the knowledge_base stage with a fixed four-item checklist.',
      '- Returns the whole workspace projection: objective, stage, checklist, report sections, artifact inventory and latest checkpoint. Every writing DeepResearch tool returns that same projection, so you see the current state after each write.',
      '- Retrying the same tool call is safe.',
      '- From here the lifecycle is: archive sources with DeepResearchSaveArtifact, record what you did with DeepResearchRecordStep, move the checklist with DeepResearchUpdateChecklist, checkpoint each round with DeepResearchCheckpoint, and close with DeepResearchComplete.',
    ].join('\n'),
    parameters: z.object({
      objective: z
        .string()
        .trim()
        .min(1)
        .max(DEEP_RESEARCH_OBJECTIVE_MAX_CHARS)
        .describe('The concrete research question and requested outcome.'),
      scope_level: z
        .enum(DEEP_RESEARCH_SCOPE_LEVELS)
        .default('standard')
        .describe('Research budget: quick, standard, or deep.'),
    }),
    impl: async (input, ctx) => {
      const objective = normalizeDeepResearchObjective(input.objective);
      if (!objective) throw new Error('Deep Research objective is invalid');
      const run = await deps.store.start(
        ctx.sessionId,
        objective,
        input.scope_level,
        mutationContext(ctx),
      );
      return renderRunStatus(run);
    },
  };
}

function buildReadArtifactTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    artifact_id: string;
    offset_chars?: number;
    max_chars?: number;
  },
  string
> {
  return {
    name: DEEP_RESEARCH_READ_ARTIFACT_TOOL_NAME,
    displayName: 'Read Research Artifact',
    description: [
      'Read a bounded chunk of one artifact already saved in this research workspace. Use it to bring evidence back into context after compaction, an interruption or a restart, with the artifact ids DeepResearchStatus lists.',
      '',
      '- It reads a window, not a whole file. offset_chars and max_chars page through long artifacts, and every answer states the offset, end and total so the next call continues exactly where this one stopped.',
      '- Page in only what you need. The workspace exists so evidence can stay out of context.',
      '- Fails when the workspace has not been started, when the id belongs to another session, and when the stored content no longer matches the hash the research ledger recorded. That last one means the artifact changed underneath the workspace and can no longer be cited as evidence.',
    ].join('\n'),
    parameters: z.object({
      artifact_id: stableIdSchema.describe('Research artifact id from the current workspace.'),
      offset_chars: z
        .number()
        .int()
        .min(0)
        .max(DEEP_RESEARCH_ARTIFACT_CONTENT_MAX_CHARS)
        .optional()
        .describe('Zero-based character offset for chunked reads.'),
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(DEEP_RESEARCH_ARTIFACT_READ_MAX_CHARS)
        .optional()
        .describe(
          `Maximum characters to return (default ${DEEP_RESEARCH_ARTIFACT_READ_DEFAULT_CHARS}).`,
        ),
    }),
    impl: async (input, ctx) => {
      const run = await deps.store.read(ctx.sessionId);
      if (!run) {
        throw new Error(`Call ${DEEP_RESEARCH_START_TOOL_NAME} before reading research artifacts`);
      }
      const ref = run.artifacts.find((artifact) => artifact.artifactId === input.artifact_id);
      if (!ref) throw new Error('Research artifact is not part of this session workspace');
      const record = await deps.artifactStore.get(input.artifact_id);
      if (!record || record.sessionId !== ctx.sessionId || record.source !== 'deep_research') {
        throw new Error('Research artifact is missing, deleted, or belongs to another session');
      }
      const read = await deps.artifactStore.readText(input.artifact_id, {
        maxBytes: DEEP_RESEARCH_ARTIFACT_CONTENT_MAX_CHARS * 4,
      });
      if (!read.ok) throw new Error(`Research artifact could not be read: ${read.reason}`);
      const contentHash = `sha256:${createHash('sha256').update(read.text).digest('hex')}`;
      if (contentHash !== ref.contentHash) {
        throw new Error('Research artifact content no longer matches the durable research ledger');
      }
      const offset = input.offset_chars ?? 0;
      const maxChars = input.max_chars ?? DEEP_RESEARCH_ARTIFACT_READ_DEFAULT_CHARS;
      const selected: string[] = [];
      let total = 0;
      for (const character of read.text) {
        if (total >= offset && total < offset + maxChars) selected.push(character);
        total += 1;
      }
      const end = Math.min(total, offset + maxChars);
      const chunk = safeResearchArtifactContent(selected.join(''));
      return [
        `<deep-research-artifact id="${ref.artifactId}" role="${ref.role}" offset="${offset}" end="${end}" total="${total}">`,
        `Name: ${normalizeInlineText(ref.name)}`,
        ...(ref.locator ? [`Locator: ${normalizeInlineText(ref.locator)}`] : []),
        `Truncated: ${end < total}`,
        '',
        chunk,
        '</deep-research-artifact>',
      ].join('\n');
    },
  };
}

function buildSaveArtifactTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    role: (typeof DEEP_RESEARCH_ARTIFACT_ROLES)[number];
    name: string;
    content: string;
    summary: string;
    locator?: string;
    source_artifact_ids?: string[];
    report_section_key?: (typeof DEEP_RESEARCH_REPORT_SECTION_KEYS)[number];
    report_section_status?: Exclude<
      (typeof DEEP_RESEARCH_REPORT_SECTION_STATUSES)[number],
      'pending'
    >;
  },
  string
> {
  return {
    name: DEEP_RESEARCH_SAVE_ARTIFACT_TOOL_NAME,
    displayName: 'Save Research Artifact',
    description: [
      'Persist one Markdown artifact into the research workspace, outside the model context and readable again later by id. Anything worth citing later has to be saved here, because the transcript will not survive compaction.',
      '',
      '- Order matters. Archive raw source material first as role=source, each with the locator it came from — a URL, a repository path — and only then write what you concluded from it. An evidence_note, outline, report_section, report or handoff must cite the source artifact ids it rests on; a source artifact cites nothing.',
      '- role=report_section also needs its section key and a status of drafted or completed. Those keys are the sections DeepResearchComplete checks for.',
      '- Returns the new artifact id with the whole workspace projection. Keep the id: checklist evidence, checkpoints and completion all refer to artifacts by id.',
      '- Retrying the identical call is safe. Retrying the same tool call with different content or metadata fails instead of writing twice; changed content belongs in a new call.',
      '- Fails when the workspace has not been started, when it is already completed, and when a role rule above is unmet; the message names the field.',
    ].join('\n'),
    parameters: z
      .object({
        role: z
          .enum(DEEP_RESEARCH_ARTIFACT_ROLES)
          .describe('Artifact role in the two-stage research workspace.'),
        name: z
          .string()
          .trim()
          .min(1)
          .max(DEEP_RESEARCH_ARTIFACT_NAME_MAX_CHARS)
          .describe('Human-readable Markdown filename.'),
        content: z
          .string()
          .min(1)
          .max(DEEP_RESEARCH_ARTIFACT_CONTENT_MAX_CHARS)
          .describe('Exact Markdown body to persist.'),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(DEEP_RESEARCH_CHECKPOINT_TEXT_MAX_CHARS)
          .describe('Short description shown in the artifact list.'),
        locator: z
          .string()
          .trim()
          .min(1)
          .max(DEEP_RESEARCH_LOCATOR_MAX_CHARS)
          .optional()
          .describe(
            'Required for source artifacts: URL, repository path, or other inspectable source locator.',
          ),
        source_artifact_ids: z
          .array(stableIdSchema)
          .max(DEEP_RESEARCH_REFS_MAX)
          .optional()
          .describe('Direct raw source artifact ids supporting this derived artifact.'),
        report_section_key: z
          .enum(DEEP_RESEARCH_REPORT_SECTION_KEYS)
          .optional()
          .describe('Required when role=report_section.'),
        report_section_status: z
          .enum(['drafted', 'completed'])
          .optional()
          .describe('Required when role=report_section.'),
      })
      .superRefine((input, ctx) => {
        const sourceIds = input.source_artifact_ids ?? [];
        if (input.role === 'source' && !input.locator) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locator'],
            message: 'Source artifacts require a locator.',
          });
        }
        if (input.role === 'source' && sourceIds.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['source_artifact_ids'],
            message: 'Source artifacts cannot cite other research artifacts.',
          });
        }
        if (input.role !== 'source' && sourceIds.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['source_artifact_ids'],
            message: `${input.role} artifacts require direct source artifact ids.`,
          });
        }
        if (
          input.role === 'report_section' &&
          (!input.report_section_key || !input.report_section_status)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['report_section_key'],
            message: 'Report section artifacts require a section key and status.',
          });
        }
        if (
          input.role !== 'report_section' &&
          (input.report_section_key || input.report_section_status)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['report_section_key'],
            message: 'Report section metadata is only valid for role=report_section.',
          });
        }
      }),
    impl: async (input, ctx) => {
      const artifactId = stableArtifactId(ctx);
      const sourceArtifactIds = dedupe(input.source_artifact_ids ?? []);
      const inputHash = `sha256:${createHash('sha256').update(input.content).digest('hex')}`;
      const replayEvent = await findToolCallEvent(deps.store, ctx.sessionId, ctx.toolCallId);
      if (replayEvent) {
        if (replayEvent.type !== 'research_artifact_recorded') {
          throw new Error(
            `Deep Research tool call ${ctx.toolCallId} was already used for ${replayEvent.type}`,
          );
        }
        const replay = replayEvent.artifact;
        const replayRecord = await deps.artifactStore.get(replay.artifactId);
        if (
          replay.artifactId !== artifactId ||
          replay.role !== input.role ||
          replay.name !== input.name ||
          (replay.summary ?? replayRecord?.summary) !== input.summary ||
          replay.locator !== input.locator ||
          replay.contentHash !== inputHash ||
          !sameStringArray(replay.sourceArtifactIds, sourceArtifactIds) ||
          replay.reportSectionKey !== input.report_section_key ||
          replay.reportSectionStatus !== input.report_section_status
        ) {
          throw new Error(
            'Deep Research artifact tool call was retried with different content or metadata',
          );
        }
        const replayRun = await deps.store.read(ctx.sessionId);
        if (!replayRun) throw new Error('Deep Research artifact replay is missing its workspace');
        return `Research artifact ${artifactId} was already saved.\n${renderRunStatus(replayRun)}`;
      }
      await requireActiveRun(deps.store, ctx.sessionId);
      const artifact = await deps.artifactStore.create({
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        name: input.name,
        kind: 'file',
        content: input.content,
        mimeType: 'text/markdown',
        source: 'deep_research',
        summary: input.summary,
        deepResearchRole: input.role,
        id: artifactId,
      });
      let run: DeepResearchRun;
      try {
        run = await deps.store.recordArtifact(
          ctx.sessionId,
          {
            artifactId,
            role: input.role,
            name: input.name,
            summary: input.summary,
            createdAt: artifact.createdAt,
            ...(input.locator ? { locator: input.locator } : {}),
            contentHash: inputHash,
            sourceArtifactIds,
            ...(input.report_section_key ? { reportSectionKey: input.report_section_key } : {}),
            ...(input.report_section_status
              ? { reportSectionStatus: input.report_section_status }
              : {}),
          },
          mutationContext(ctx),
        );
      } catch (error) {
        await deps.artifactStore.delete(artifactId).catch(() => undefined);
        throw error;
      }
      return `Saved ${input.role} artifact ${artifactId}.\n${renderRunStatus(run)}`;
    },
  };
}

function buildUpdateChecklistTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    item_id: string;
    status: (typeof DEEP_RESEARCH_CHECKLIST_STATUSES)[number];
    evidence_artifact_ids?: string[];
    blocked_reason?: string;
  },
  string
> {
  return {
    name: DEEP_RESEARCH_UPDATE_CHECKLIST_TOOL_NAME,
    displayName: 'Update Research Checklist',
    description: [
      'Move one item of the durable research checklist. The items are fixed at start, and the checklist is what DeepResearchComplete is measured against, so keep it current as the work happens rather than settling it at the end.',
      '',
      '- status=completed requires evidence_artifact_ids naming artifacts already saved here. An item cannot be completed on the strength of having looked; the evidence has to exist in the workspace.',
      '- status=blocked requires blocked_reason, written so it still means something to a reader after a restart: what is missing, not that something is missing. A reason on any other status is rejected.',
      '- in_progress and skipped are worth using honestly too; a skipped item is a decision a later reader needs to see.',
      '- Returns the whole workspace projection, with every item shown alongside its evidence and blocker.',
      '- Fails on an unknown item_id: the checklist is fixed and cannot be extended.',
    ].join('\n'),
    parameters: z
      .object({
        item_id: stableIdSchema
          .refine(
            (value) => DEEP_RESEARCH_DEFAULT_CHECKLIST.some((item) => item.itemId === value),
            'Unknown Deep Research checklist item.',
          )
          .describe('Checklist item id, exactly as the workspace projection lists it.'),
        status: z
          .enum(DEEP_RESEARCH_CHECKLIST_STATUSES)
          .describe('New status for this item. Replaces the current one.'),
        evidence_artifact_ids: z
          .array(stableIdSchema)
          .max(DEEP_RESEARCH_REFS_MAX)
          .optional()
          .describe('Saved artifact ids that prove this item. Required for status=completed.'),
        blocked_reason: z
          .string()
          .trim()
          .min(1)
          .max(DEEP_RESEARCH_STEP_TEXT_MAX_CHARS)
          .optional()
          .describe('What is missing. Required for status=blocked and rejected on any other.'),
      })
      .superRefine((input, ctx) => {
        if (input.status === 'completed' && (input.evidence_artifact_ids?.length ?? 0) === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence_artifact_ids'],
            message: 'Completed checklist items require evidence artifacts.',
          });
        }
        if (input.status === 'blocked' && !input.blocked_reason) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['blocked_reason'],
            message: 'Blocked checklist items require a reason.',
          });
        }
        if (input.status !== 'blocked' && input.blocked_reason) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['blocked_reason'],
            message: 'A blocked reason is only valid for blocked checklist items.',
          });
        }
      }),
    impl: async (input, ctx) => {
      await requireRun(deps.store, ctx.sessionId);
      const run = await deps.store.updateChecklist(
        ctx.sessionId,
        {
          itemId: input.item_id,
          status: input.status,
          evidenceArtifactIds: dedupe(input.evidence_artifact_ids ?? []),
          ...(input.blocked_reason ? { blockedReason: input.blocked_reason } : {}),
        },
        mutationContext(ctx),
      );
      return renderRunStatus(run);
    },
  };
}

function buildRecordStepTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    kind: (typeof DEEP_RESEARCH_STEP_KINDS)[number];
    status: (typeof DEEP_RESEARCH_STEP_STATUSES)[number];
    objective: string;
    summary: string;
    roots?: string[];
    keywords?: string[];
    ignored_paths?: string[];
    stopping_condition: string;
    expected_evidence: string;
    evidence_artifact_ids?: string[];
    inspected_refs?: Array<{
      kind: (typeof DEEP_RESEARCH_INSPECTED_REF_KINDS)[number];
      locator: string;
      label?: string;
      source_artifact_id?: string;
    }>;
    worker_run_ids?: string[];
    blocked_reason?: string;
  },
  string
> {
  const boundedText = z.string().trim().min(1).max(DEEP_RESEARCH_STEP_TEXT_MAX_CHARS);
  const boundedList = z
    .array(z.string().trim().min(1).max(DEEP_RESEARCH_LOCATOR_MAX_CHARS))
    .max(DEEP_RESEARCH_STEP_LIST_ITEMS_MAX);
  return {
    name: DEEP_RESEARCH_RECORD_STEP_TOOL_NAME,
    displayName: 'Record Research Step',
    description: [
      'Record one bounded unit of investigation — a local exploration or a round of web research — after it has run. It is how a search becomes part of the durable record: what you were looking for, where you looked, when you stopped, and what came out.',
      '',
      '- kind=local_exploration requires the roots you searched under; kind=web_research requires the queries or keywords you ran. Declaring the bound is the point, and an unbounded sweep is not a step.',
      '- stopping_condition and expected_evidence describe the step you just ran, not a plan. They are what tells a later reader whether it finished or merely ran out of patience.',
      '- status=completed requires evidence_artifact_ids for artifacts already saved with DeepResearchSaveArtifact. status=blocked requires blocked_reason. status=stopped records a step you ended deliberately without evidence. A blocked reason on any other status is rejected.',
      '- inspected_refs records what you actually opened and worker_run_ids the child runs that did the work, so the step can be audited without the transcript.',
      '- Returns the whole workspace projection.',
    ].join('\n'),
    parameters: z
      .object({
        kind: z
          .enum(DEEP_RESEARCH_STEP_KINDS)
          .describe('local_exploration searches the workspace; web_research searches the web.'),
        status: z
          .enum(DEEP_RESEARCH_STEP_STATUSES)
          .describe('How the step ended: completed, blocked, or stopped deliberately.'),
        objective: boundedText.describe('What this one step set out to establish.'),
        summary: boundedText.describe('What the step actually found.'),
        roots: boundedList
          .optional()
          .describe('Directories or paths searched. Required for kind=local_exploration.'),
        keywords: boundedList
          .optional()
          .describe('Queries or search terms used. Required for kind=web_research.'),
        ignored_paths: boundedList
          .optional()
          .describe('Paths deliberately excluded from this step.'),
        stopping_condition: boundedText.describe('What ended the step, as it actually ended.'),
        expected_evidence: boundedText.describe('What the step was expected to produce.'),
        evidence_artifact_ids: z
          .array(stableIdSchema)
          .max(DEEP_RESEARCH_REFS_MAX)
          .optional()
          .describe('Saved artifact ids produced by this step. Required for status=completed.'),
        inspected_refs: z
          .array(
            z.object({
              kind: z
                .enum(DEEP_RESEARCH_INSPECTED_REF_KINDS)
                .describe('What kind of thing was opened.'),
              locator: z
                .string()
                .trim()
                .min(1)
                .max(DEEP_RESEARCH_LOCATOR_MAX_CHARS)
                .describe('Path, symbol, or URL, precise enough to open again.'),
              label: z
                .string()
                .trim()
                .min(1)
                .max(DEEP_RESEARCH_STEP_TEXT_MAX_CHARS)
                .optional()
                .describe('Short human-readable name for this reference.'),
              source_artifact_id: stableIdSchema
                .optional()
                .describe('Saved source artifact that archived this reference.'),
            }),
          )
          .max(DEEP_RESEARCH_STEP_LIST_ITEMS_MAX)
          .optional()
          .describe('What this step actually opened and read.'),
        worker_run_ids: z
          .array(stableIdSchema)
          .max(DEEP_RESEARCH_STEP_LIST_ITEMS_MAX)
          .optional()
          .describe('Child agent run ids that carried out this step.'),
        blocked_reason: boundedText
          .optional()
          .describe('What is missing. Required for status=blocked and rejected on any other.'),
      })
      .superRefine((input, ctx) => {
        if (input.kind === 'local_exploration' && (input.roots?.length ?? 0) === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roots'],
            message: 'Local exploration requires at least one bounded root.',
          });
        }
        if (input.kind === 'web_research' && (input.keywords?.length ?? 0) === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['keywords'],
            message: 'Web research requires at least one query or keyword.',
          });
        }
        if (input.status === 'completed' && (input.evidence_artifact_ids?.length ?? 0) === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['evidence_artifact_ids'],
            message: 'Completed research steps require persisted evidence.',
          });
        }
        if (input.status === 'blocked' && !input.blocked_reason) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['blocked_reason'],
            message: 'Blocked research steps require a reason.',
          });
        }
        if (input.status !== 'blocked' && input.blocked_reason) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['blocked_reason'],
            message: 'A blocked reason is only valid for blocked research steps.',
          });
        }
      }),
    impl: async (input, ctx) => {
      await requireRun(deps.store, ctx.sessionId);
      const run = await deps.store.recordStep(
        ctx.sessionId,
        {
          kind: input.kind,
          status: input.status,
          objective: input.objective,
          summary: input.summary,
          roots: dedupe(input.roots ?? []),
          keywords: dedupe(input.keywords ?? []),
          ignoredPaths: dedupe(input.ignored_paths ?? []),
          stoppingCondition: input.stopping_condition,
          expectedEvidence: input.expected_evidence,
          evidenceArtifactIds: dedupe(input.evidence_artifact_ids ?? []),
          inspectedRefs: (input.inspected_refs ?? []).map((ref) => ({
            kind: ref.kind,
            locator: ref.locator,
            ...(ref.label ? { label: ref.label } : {}),
            ...(ref.source_artifact_id ? { sourceArtifactId: ref.source_artifact_id } : {}),
          })),
          workerRunIds: dedupe(input.worker_run_ids ?? []),
          ...(input.blocked_reason ? { blockedReason: input.blocked_reason } : {}),
        },
        mutationContext(ctx),
      );
      return renderRunStatus(run);
    },
  };
}

function buildCheckpointTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    round: number;
    stage: (typeof DEEP_RESEARCH_ACTIVE_STAGES)[number];
    status: 'active' | 'blocked';
    summary: string;
    open_questions?: string[];
    next_steps?: string[];
    artifact_ids?: string[];
  },
  string
> {
  const itemArray = z
    .array(z.string().trim().min(1).max(DEEP_RESEARCH_CHECKPOINT_ITEM_MAX_CHARS))
    .max(DEEP_RESEARCH_CHECKPOINT_ITEMS_MAX);
  const refArray = z.array(stableIdSchema).max(DEEP_RESEARCH_REFS_MAX);
  return {
    name: DEEP_RESEARCH_CHECKPOINT_TOOL_NAME,
    displayName: 'Checkpoint Research',
    description: [
      'Write a durable checkpoint at the end of a research round, and before anything that will cost you context. It is the resume point: a later turn, after compaction or a restart, reads this and carries on instead of running the round again.',
      '',
      '- Write it for a reader who has lost the conversation. open_questions are what is still unanswered, next_steps are concrete enough to act on without you, and artifact_ids name the artifacts that reader has to load to continue.',
      '- `round` is monotonic, and `stage` says which half of the work you are in: knowledge_base while evidence is being gathered, report_writing once sections are being drafted.',
      '- status=blocked records that research cannot proceed without outside input; active means it can.',
      '- Returns the whole workspace projection, with this checkpoint as the latest one.',
    ].join('\n'),
    parameters: z.object({
      round: z.number().int().min(1).describe('Monotonic research round number.'),
      stage: z.enum(DEEP_RESEARCH_ACTIVE_STAGES).describe('Current two-stage workflow phase.'),
      status: z
        .enum(['active', 'blocked'])
        .describe('Whether research can proceed without outside input.'),
      summary: z
        .string()
        .trim()
        .min(1)
        .max(DEEP_RESEARCH_CHECKPOINT_TEXT_MAX_CHARS)
        .describe('What was established during this round.'),
      open_questions: itemArray
        .optional()
        .describe('Questions still requiring evidence or resolution.'),
      next_steps: itemArray.optional().describe('Concrete continuation steps.'),
      artifact_ids: refArray.optional().describe('Known research artifact ids required to resume.'),
    }),
    impl: async (input, ctx) => {
      await requireRun(deps.store, ctx.sessionId);
      const run = await deps.store.recordCheckpoint(
        ctx.sessionId,
        {
          round: input.round,
          stage: input.stage,
          status: input.status,
          summary: input.summary,
          openQuestions: dedupe(input.open_questions ?? []),
          nextSteps: dedupe(input.next_steps ?? []),
          taskIds: [],
          artifactIds: dedupe(input.artifact_ids ?? []),
        },
        mutationContext(ctx),
      );
      return renderRunStatus(run);
    },
  };
}

function buildStatusTool(
  deps: BuildDeepResearchToolsDeps,
): MakaTool<Record<string, never>, string> {
  return {
    name: DEEP_RESEARCH_STATUS_TOOL_NAME,
    displayName: 'Read Research Workspace',
    description: [
      'Read the durable research workspace: objective, stage, checklist with its evidence, report sections, artifact inventory, recent steps and the latest checkpoint. Takes no arguments and changes nothing.',
      '',
      '- Read it first in any turn that did not start this research — after compaction, an interruption or a restart — before deciding what to do next. The workspace, not the transcript, is the state of the work.',
      '- The artifact inventory is where ids for DeepResearchReadArtifact come from. Older artifacts beyond the display limit are counted rather than listed.',
      '- Answers with an uninitialized workspace when nothing has been started, which is how a fresh session tells itself apart from a resumed one. DeepResearchStart opens it.',
      '- Every writing DeepResearch tool returns this same projection, so calling it straight after one of those is redundant.',
    ].join('\n'),
    parameters: z.object({}),
    impl: async (_input, ctx) => {
      const run = await deps.store.read(ctx.sessionId);
      return run ? renderRunStatus(run) : '<deep-research-workspace state="uninitialized" />';
    },
  };
}

function buildCompleteTool(deps: BuildDeepResearchToolsDeps): MakaTool<
  {
    report_artifact_id: string;
    handoff_artifact_id: string;
    implementation_tasks: string[];
    recommended_issues?: string[];
    recommended_pull_requests?: string[];
    verification_commands: string[];
  },
  string
> {
  const handoffList = z
    .array(z.string().trim().min(1).max(DEEP_RESEARCH_CHECKPOINT_ITEM_MAX_CHARS))
    .max(DEEP_RESEARCH_CHECKPOINT_ITEMS_MAX);
  return {
    name: DEEP_RESEARCH_COMPLETE_TOOL_NAME,
    displayName: 'Complete Research',
    description: [
      'Close the research workspace on a finished report. Call it only once every checklist item is settled and every report section has a current artifact; it is the last DeepResearch call, and the workspace cannot be written to afterwards.',
      '',
      '- Both ids must name artifacts already saved here: the final source-backed report (role=report) and the handoff (role=handoff). The handoff is what someone else picks the work up from, so implementation_tasks and verification_commands are required, along with at least one of recommended_issues or recommended_pull_requests.',
      '- Before closing, every source artifact, every report section artifact, the report and the handoff are re-read and checked against the research ledger. The call fails if any is missing, belongs to another workspace, or no longer matches the hash recorded when it was saved.',
      '- A report section with no current artifact fails the call. Save the missing section with DeepResearchSaveArtifact and call again.',
      '- Returns the completed workspace projection. Retrying the same tool call is safe.',
    ].join('\n'),
    parameters: z
      .object({
        report_artifact_id: stableIdSchema.describe(
          'Artifact id of the final source-backed report.',
        ),
        handoff_artifact_id: stableIdSchema.describe(
          'Artifact id of the saved role=handoff artifact.',
        ),
        implementation_tasks: handoffList
          .min(1)
          .describe('Concrete work items someone else can pick up from the handoff.'),
        recommended_issues: handoffList
          .optional()
          .describe('Issues worth filing. At least one issue or pull request is required.'),
        recommended_pull_requests: handoffList
          .optional()
          .describe('Pull requests worth opening. At least one issue or pull request is required.'),
        verification_commands: handoffList
          .min(1)
          .describe('Commands that check the recommended work, runnable as written.'),
      })
      .superRefine((input, ctx) => {
        if (
          (input.recommended_issues?.length ?? 0) === 0 &&
          (input.recommended_pull_requests?.length ?? 0) === 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['recommended_issues'],
            message: 'Provide at least one recommended issue or pull request.',
          });
        }
      }),
    impl: async (input, ctx) => {
      const handoff = {
        artifactId: input.handoff_artifact_id,
        implementationTasks: dedupe(input.implementation_tasks),
        recommendedIssues: dedupe(input.recommended_issues ?? []),
        recommendedPullRequests: dedupe(input.recommended_pull_requests ?? []),
        verificationCommands: dedupe(input.verification_commands),
      };
      const replay = await findToolCallEvent(deps.store, ctx.sessionId, ctx.toolCallId);
      if (replay) {
        const run = await deps.store.complete(
          ctx.sessionId,
          input.report_artifact_id,
          handoff,
          mutationContext(ctx),
        );
        return renderRunStatus(run);
      }
      const existing = await requireActiveRun(deps.store, ctx.sessionId);
      await validateCompletionArtifacts(
        deps.artifactStore,
        existing,
        input.report_artifact_id,
        input.handoff_artifact_id,
      );
      const run = await deps.store.complete(
        ctx.sessionId,
        input.report_artifact_id,
        handoff,
        mutationContext(ctx),
      );
      return renderRunStatus(run);
    },
  };
}

async function requireActiveRun(
  store: DeepResearchStore,
  sessionId: string,
): Promise<DeepResearchRun> {
  const run = await store.read(sessionId);
  if (!run) {
    throw new Error(`Call ${DEEP_RESEARCH_START_TOOL_NAME} before using the research workspace`);
  }
  if (run.status === 'completed') {
    throw new Error('Deep Research workspace is already completed');
  }
  return run;
}

async function requireRun(store: DeepResearchStore, sessionId: string): Promise<DeepResearchRun> {
  const run = await store.read(sessionId);
  if (!run) {
    throw new Error(`Call ${DEEP_RESEARCH_START_TOOL_NAME} before using the research workspace`);
  }
  return run;
}

async function findToolCallEvent(
  store: DeepResearchStore,
  sessionId: string,
  toolCallId: string,
): Promise<DeepResearchEvent | undefined> {
  return (await store.readEvents(sessionId)).find((event) => event.refs?.toolCallId === toolCallId);
}

async function validateCompletionArtifacts(
  artifactStore: DeepResearchArtifactStore,
  run: DeepResearchRun,
  reportArtifactId: string,
  handoffArtifactId: string,
): Promise<void> {
  const required = new Map<string, DeepResearchArtifactRef>();
  for (const source of run.artifacts.filter((artifact) => artifact.role === 'source')) {
    required.set(source.artifactId, source);
  }
  for (const section of run.reportSections) {
    if (!section.artifactId) {
      throw new Error(`Deep Research report section ${section.key} has no current artifact`);
    }
    const ref = run.artifacts.find((artifact) => artifact.artifactId === section.artifactId);
    if (!ref || ref.role !== 'report_section' || ref.reportSectionKey !== section.key) {
      throw new Error(
        `Deep Research report section ${section.key} has an invalid current artifact`,
      );
    }
    required.set(ref.artifactId, ref);
  }
  for (const [artifactId, role] of [
    [reportArtifactId, 'report'],
    [handoffArtifactId, 'handoff'],
  ] as const) {
    const ref = run.artifacts.find((artifact) => artifact.artifactId === artifactId);
    if (!ref || ref.role !== role) {
      throw new Error(`Deep Research ${role} artifact ${artifactId} is missing from the ledger`);
    }
    required.set(ref.artifactId, ref);
  }
  for (const ref of required.values()) {
    await validateArtifactIntegrity(artifactStore, run.sessionId, ref);
  }
}

async function validateArtifactIntegrity(
  artifactStore: DeepResearchArtifactStore,
  sessionId: string,
  ref: DeepResearchArtifactRef,
): Promise<void> {
  const record = await artifactStore.get(ref.artifactId);
  if (!record) {
    throw new Error(`Deep Research artifact ${ref.artifactId} is missing or deleted`);
  }
  if (record.sessionId !== sessionId || record.source !== 'deep_research') {
    throw new Error(`Deep Research artifact ${ref.artifactId} belongs to another workspace`);
  }
  if (
    record.kind !== 'file' ||
    record.mimeType !== 'text/markdown' ||
    record.deepResearchRole !== ref.role
  ) {
    throw new Error(
      `Deep Research artifact ${ref.artifactId} type or role does not match the ledger`,
    );
  }
  const read = await artifactStore.readText(ref.artifactId, {
    maxBytes: DEEP_RESEARCH_ARTIFACT_CONTENT_MAX_CHARS * 4,
  });
  if (!read.ok) {
    throw new Error(`Deep Research artifact ${ref.artifactId} could not be read: ${read.reason}`);
  }
  const contentHash = `sha256:${createHash('sha256').update(read.text).digest('hex')}`;
  if (contentHash !== ref.contentHash) {
    throw new Error(`Deep Research artifact ${ref.artifactId} content does not match the ledger`);
  }
}

function mutationContext(ctx: MakaToolContext): {
  runId?: string;
  turnId: string;
  toolCallId: string;
} {
  return {
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    turnId: ctx.turnId,
    toolCallId: ctx.toolCallId,
  };
}

function stableArtifactId(ctx: MakaToolContext): string {
  const digest = createHash('sha256')
    .update(`${ctx.sessionId}\n${ctx.turnId}\n${ctx.toolCallId}`)
    .digest('hex');
  const uuidLike = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
  return `dr-${uuidLike}`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeInlineText(value: string): string {
  return redactSecrets(value)
    .replace(/<\/?deep-research-(?:workspace|artifact)\b[^>]{0,4096}>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeResearchArtifactContent(value: string): string {
  return redactSecrets(value).replace(
    /<\/?deep-research-(?:workspace|artifact)\b[^>]{0,4096}>/gi,
    '',
  );
}

export function renderDeepResearchRunStatus(run: DeepResearchRun): string {
  const latest = run.checkpoints.at(-1);
  const lines = [
    `<deep-research-workspace status="${run.status}" stage="${run.stage}" scope="${run.scopeLevel}" round="${run.round}">`,
    `Objective: ${normalizeInlineText(run.objective)}`,
    `Artifacts: ${run.artifacts.length} (${DEEP_RESEARCH_ARTIFACT_ROLES.map(
      (role) => `${role}=${run.artifacts.filter((artifact) => artifact.role === role).length}`,
    ).join(', ')})`,
  ];
  const visibleArtifacts = run.artifacts.slice(-DEEP_RESEARCH_STATUS_ARTIFACTS_MAX);
  for (const artifact of visibleArtifacts) {
    lines.push(
      `- ${normalizeInlineText(artifact.artifactId)} [${artifact.role}] ${normalizeInlineText(artifact.name)}`,
    );
  }
  lines.push('Checklist:');
  for (const item of run.checklist) {
    lines.push(
      `- [${item.status}] ${normalizeInlineText(item.itemId)}: ${normalizeInlineText(item.title)}` +
        (item.evidenceArtifactIds.length > 0
          ? ` (evidence: ${item.evidenceArtifactIds.join(', ')})`
          : '') +
        (item.blockedReason ? ` (blocked: ${normalizeInlineText(item.blockedReason)})` : ''),
    );
  }
  lines.push('Report sections:');
  for (const section of run.reportSections) {
    lines.push(
      `- [${section.status}] ${section.key}${section.artifactId ? ` (${section.artifactId})` : ''}`,
    );
  }
  lines.push(`Research steps: ${run.steps.length}`);
  for (const step of run.steps.slice(-10)) {
    lines.push(
      `- [${step.status}] ${step.kind}: ${normalizeInlineText(step.summary)}` +
        (step.workerRunIds.length > 0 ? ` (workers: ${step.workerRunIds.join(', ')})` : '') +
        (step.blockedReason ? ` (blocked: ${normalizeInlineText(step.blockedReason)})` : ''),
    );
  }
  if (run.artifacts.length > visibleArtifacts.length) {
    lines.push(
      `- ${run.artifacts.length - visibleArtifacts.length} older artifact(s) omitted from this status view`,
    );
  }
  if (latest) {
    lines.push(`Latest checkpoint: ${normalizeInlineText(latest.summary)}`);
    if (latest.openQuestions.length > 0) {
      lines.push(`Open questions: ${latest.openQuestions.map(normalizeInlineText).join(' | ')}`);
    }
    if (latest.nextSteps.length > 0) {
      lines.push(`Next steps: ${latest.nextSteps.map(normalizeInlineText).join(' | ')}`);
    }
    if (latest.artifactIds.length > 0) {
      lines.push(`Resume artifacts: ${latest.artifactIds.join(', ')}`);
    }
  }
  if (run.reportArtifactId) lines.push(`Final report: ${run.reportArtifactId}`);
  if (run.handoff) {
    lines.push(`Handoff artifact: ${run.handoff.artifactId}`);
    lines.push(
      `Implementation tasks: ${run.handoff.implementationTasks.map(normalizeInlineText).join(' | ')}`,
    );
    lines.push(
      `Verification commands: ${run.handoff.verificationCommands.map(normalizeInlineText).join(' | ')}`,
    );
  }
  lines.push('</deep-research-workspace>');
  return lines.join('\n');
}

const renderRunStatus = renderDeepResearchRunStatus;
