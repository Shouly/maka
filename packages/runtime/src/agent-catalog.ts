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

// The agent types a session can launch, as the design has them: a general
// agent that can do what its caller can, and two read-only ones. A type is a
// role card and a rule for which tools it goes without; everything else a
// child reads and holds is composed the way a main session's is.

import type { PermissionMode } from '@maka/core/permission';
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  SUBAGENT_PROFILES,
  type SubagentPreset,
  type SubagentProfile,
} from '@maka/core/subagent-settings';

export const GENERAL_PURPOSE_AGENT_TYPE = 'general-purpose';
export const EXPLORE_AGENT_TYPE = 'Explore';
export const PLAN_AGENT_TYPE = 'Plan';
/** What `Agent` runs when no `subagent_type` is given. */
export const DEFAULT_AGENT_TYPE = GENERAL_PURPOSE_AGENT_TYPE;
export const BUILTIN_AGENT_PROFILES = SUBAGENT_PROFILES;

export type AgentProfile = SubagentProfile;

export interface AgentDefinition {
  definitionVersion: number;
  /** What `subagent_type` names, and the id recorded on the child. */
  profile: AgentProfile;
  id: string;
  name: string;
  /** The one line the agent types listing gives it. */
  description: string;
  /**
   * `explore` keeps the child read-only whatever its parent may do; any other
   * mode follows the parent, Full access included.
   */
  permissionMode: PermissionMode;
  /** What this type goes without on top of what no child has. */
  excludedTools: readonly string[];
  /** The role card: the first section of the child's system prompt. */
  systemPrompt: string;
}

export interface AgentDefinitionListItem {
  id: string;
  profile: AgentProfile;
  name: string;
  description: string;
  availability: { status: 'available' };
  permissionMode: PermissionMode;
  /** The listing's `(Tools: …)`: `*`, or what the type goes without. */
  tools: string;
}

export type SubagentPresetAvailability =
  | { status: 'available' }
  | {
      status: 'unavailable';
      reason:
        | 'disabled'
        | 'missing_connection'
        | 'provider_retired'
        | 'connection_disabled'
        | 'model_disabled';
    };

export interface SubagentPresetListItem extends SubagentPreset {
  availability: SubagentPresetAvailability;
}

/**
 * What no child agent holds. A child cannot start another agent or talk to
 * one, ask the user anything, change the user's memory, set itself up to come
 * back later, or take over the session's own plan and goal — the design's
 * general agent goes without the same things. It cannot schedule work either:
 * a scheduled run carries its own permission mode, so a read-only child
 * could otherwise start a run that writes. Nor can it change the app's
 * settings, which no agent's message may authorize.
 */
export const CHILD_EXCLUDED_TOOL_NAMES: readonly string[] = Object.freeze([
  TOOL_NAMES.agent,
  TOOL_NAMES.sendMessage,
  TOOL_NAMES.listAgents,
  TOOL_NAMES.agentOutput,
  TOOL_NAMES.swarmStatus,
  TOOL_NAMES.viewAgentGraph,
  TOOL_NAMES.updateAgentGraph,
  TOOL_NAMES.yieldAgentGraph,
  TOOL_NAMES.askUserQuestion,
  TOOL_NAMES.memoryWrite,
  TOOL_NAMES.memoryStrReplace,
  TOOL_NAMES.memoryAppend,
  TOOL_NAMES.memoryDelete,
  TOOL_NAMES.sendLater,
  TOOL_NAMES.scheduledTaskCreate,
  TOOL_NAMES.scheduledTaskList,
  TOOL_NAMES.scheduledTaskUpdate,
  TOOL_NAMES.scheduledTaskDelete,
  TOOL_NAMES.scheduledTaskRun,
  TOOL_NAMES.copilotSettingsUpdate,
  TOOL_NAMES.submitPlan,
  TOOL_NAMES.updatePlan,
  TOOL_NAMES.cancelPlan,
  TOOL_NAMES.goalSet,
  TOOL_NAMES.goalClear,
  TOOL_NAMES.goalPause,
  TOOL_NAMES.goalResume,
  TOOL_NAMES.goalStatus,
]);

/** Only a child holds this one, and only to hand its report back. */
export const PARENT_EXCLUDED_TOOL_NAMES: readonly string[] = Object.freeze([
  TOOL_NAMES.subagentHandback,
]);

const FILE_WRITE_TOOL_NAMES: readonly string[] = Object.freeze([
  TOOL_NAMES.write,
  TOOL_NAMES.edit,
  TOOL_NAMES.notebookEdit,
  TOOL_NAMES.applyPatch,
]);

const READ_ONLY_RULES = [
  '=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===',
  'This is a READ-ONLY {task} task. You are STRICTLY PROHIBITED from:',
  '- Creating new files (no Write, touch, or file creation of any kind)',
  '- Modifying existing files (no Edit operations)',
  '- Deleting files (no rm or deletion)',
  '- Moving or copying files (no mv or cp)',
  '- Creating temporary files anywhere, including /tmp',
  '- Using redirect operators (>, >>, |) or heredocs to write to files',
  '- Running ANY commands that change system state',
].join('\n');

const READ_ONLY_BASH_RULES = [
  '- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)',
  '- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification',
].join('\n');

export const GENERAL_PURPOSE_AGENT_DEFINITION: AgentDefinition = {
  definitionVersion: 1,
  profile: GENERAL_PURPOSE_AGENT_TYPE,
  id: GENERAL_PURPOSE_AGENT_TYPE,
  name: 'General purpose',
  description:
    'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
  permissionMode: 'ask',
  excludedTools: [],
  systemPrompt: [
    "You are an agent for Copilot. Given the user's message, you should use the tools available to complete the task. Complete the task fully—don't gold-plate, but don't leave it half-done. When you complete the task, hand back a concise report covering what was done and any key findings through SubagentHandback — the caller will relay this to the user, so it only needs the essentials.",
    '',
    'Your strengths:',
    '- Searching for code, configurations, and patterns across large codebases',
    '- Analyzing multiple files to understand system architecture',
    '- Investigating complex questions that require exploring many files',
    '- Performing multi-step research tasks',
    '',
    'Guidelines:',
    "- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.",
    "- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.",
    '- Be thorough: Check multiple locations, consider different naming conventions, look for related files.',
    "- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.",
    '- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.',
    '- You are already the dedicated agent for this task. Do the work directly — do not re-delegate your entire assignment to another single subagent.',
  ].join('\n'),
};

export const EXPLORE_AGENT_DEFINITION: AgentDefinition = {
  definitionVersion: 1,
  profile: EXPLORE_AGENT_TYPE,
  id: EXPLORE_AGENT_TYPE,
  name: 'Explore',
  description:
    'Read-only search agent for broad fan-out searches — when answering means sweeping many files, directories, or naming conventions and you only need the conclusion, not the file dumps. It reads excerpts rather than whole files, so it locates code; it doesn\'t review or audit it. Specify search breadth: "medium" for moderate exploration, "very thorough" for multiple locations and naming conventions.',
  permissionMode: 'explore',
  excludedTools: FILE_WRITE_TOOL_NAMES,
  systemPrompt: [
    'You are a file search specialist for Copilot. You excel at thoroughly navigating and exploring codebases.',
    '',
    READ_ONLY_RULES.replace('{task}', 'exploration'),
    '',
    'Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.',
    '',
    'Your strengths:',
    '- Rapidly finding files using glob patterns',
    '- Searching code and text with powerful regex patterns',
    '- Reading and analyzing file contents',
    '',
    'Guidelines:',
    '- Use Glob for broad file pattern matching',
    '- Use Grep for searching file contents with regex',
    '- Use Read when you know the specific file path you need to read',
    READ_ONLY_BASH_RULES,
    '- Adapt your search approach based on the thoroughness level specified by the caller',
    '- Hand back your final report with SubagentHandback - do NOT attempt to create files',
    '',
    'NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:',
    '- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations',
    '- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files',
    '',
    "Complete the user's search request efficiently and report your findings clearly.",
  ].join('\n'),
};

/**
 * The design names a Plan type but its role card was never captured; this one
 * is ours, built on the Explore card's read-only rules.
 */
export const PLAN_AGENT_DEFINITION: AgentDefinition = {
  definitionVersion: 1,
  profile: PLAN_AGENT_TYPE,
  id: PLAN_AGENT_TYPE,
  name: 'Plan',
  description:
    'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
  permissionMode: 'explore',
  excludedTools: FILE_WRITE_TOOL_NAMES,
  systemPrompt: [
    'You are a software architect and planning specialist for Copilot. You explore codebases and design implementation plans.',
    '',
    READ_ONLY_RULES.replace('{task}', 'planning'),
    '',
    'Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.',
    '',
    'Your process:',
    "1. Understand the requirements in the caller's brief, and any perspective or constraints it assigns you.",
    '2. Explore thoroughly: read the files the brief points to, find the existing patterns and conventions with Glob, Grep and Read, and trace the code paths the change will touch.',
    '3. Design the solution: weigh the approaches against the constraints, follow the existing patterns where they fit, and name the trade-offs.',
    '4. Detail the plan: a step-by-step implementation strategy, in order, with the dependencies between the steps and the risks to watch.',
    '',
    'Guidelines:',
    READ_ONLY_BASH_RULES,
    '- Hand back your plan with SubagentHandback - do NOT attempt to create files',
    '',
    'End the plan with the files most critical to carrying it out:',
    '',
    '### Critical Files for Implementation',
    '- /absolute/path/to/file - why it matters',
    '',
    'You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files.',
  ].join('\n'),
};

export const BUILTIN_AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  GENERAL_PURPOSE_AGENT_DEFINITION,
  EXPLORE_AGENT_DEFINITION,
  PLAN_AGENT_DEFINITION,
];

export function listBuiltinAgentDefinitions(): AgentDefinitionListItem[] {
  return BUILTIN_AGENT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    profile: definition.profile,
    name: definition.name,
    description: definition.description,
    availability: { status: 'available' },
    permissionMode: definition.permissionMode,
    tools: agentToolsLabel(definition),
  }));
}

/** The listing's `(Tools: …)`, in the design's words: everything, or everything but. */
export function agentToolsLabel(definition: Pick<AgentDefinition, 'excludedTools'>): string {
  if (definition.excludedTools.length === 0) return '*';
  return `All tools except ${[TOOL_NAMES.agent, ...definition.excludedTools].join(', ')}`;
}

export function getBuiltinAgentDefinitionByProfile(profile: string): AgentDefinition | undefined {
  return BUILTIN_AGENT_DEFINITIONS.find((definition) => definition.profile === profile);
}

export function requireBuiltinAgentDefinitionByProfile(profile: string): AgentDefinition {
  const definition = getBuiltinAgentDefinitionByProfile(profile);
  if (!definition) {
    const available = BUILTIN_AGENT_PROFILES.join(', ');
    throw new Error(`Agent type '${profile}' not found. Available agents: ${available}`);
  }
  return definition;
}

/**
 * The tools a child of this type holds, out of what a main session would hold
 * in its place. Everything not named here stays — deferred where the main
 * session defers it.
 */
export function selectChildAgentTools<T extends { readonly name: string }>(
  tools: readonly T[],
  definition: Pick<AgentDefinition, 'excludedTools'>,
): T[] {
  const excluded = new Set([...CHILD_EXCLUDED_TOOL_NAMES, ...definition.excludedTools]);
  return tools.filter((tool) => !excluded.has(tool.name));
}
