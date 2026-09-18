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

/**
 * The canonical names of every first-party tool the model can see.
 *
 * Convention: first-party tools are PascalCase, grouped by a family prefix
 * where a family exists (`Browser*`, `DeepResearch*`, `Goal*`, `Task*`,
 * `*AgentGraph`). Only names a provider protocol owns keep their protocol
 * spelling (`apply_patch`), and MCP proxies keep the `mcp__<server>__<tool>`
 * shape. Everything that branches on a tool name — tool builders, availability
 * lists, projections, renderers — reads the constant here rather than a string
 * literal, so a rename is one edit.
 */

export const TOOL_NAMES = {
  // File and shell
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  applyPatch: 'apply_patch',
  taskStop: 'TaskStop',
  taskInput: 'TaskInput',
  archiveRead: 'ArchiveRead',
  // Interaction
  askUserQuestion: 'AskUserQuestion',
  requestSandboxBoundary: 'RequestSandboxBoundary',
  // Delivery
  sendUserFile: 'SendUserFile',
  sendUserMessage: 'SendUserMessage',
  // Skills and deferred tools
  skill: 'Skill',
  skillSearch: 'SkillSearch',
  toolSearch: 'ToolSearch',
  // Session bookkeeping
  taskCreate: 'TaskCreate',
  taskList: 'TaskList',
  taskGet: 'TaskGet',
  taskUpdate: 'TaskUpdate',
  submitPlan: 'SubmitPlan',
  updatePlan: 'UpdatePlan',
  cancelPlan: 'CancelPlan',
  goalSet: 'GoalSet',
  goalClear: 'GoalClear',
  goalPause: 'GoalPause',
  goalResume: 'GoalResume',
  goalStatus: 'GoalStatus',
  // Scheduled tasks. Split one-verb-per-tool like the reference's own set:
  // one tool with a `mode` made the model pick the verb inside the arguments,
  // where a wrong pick reads as a valid call.
  scheduledTaskCreate: 'ScheduledTaskCreate',
  scheduledTaskList: 'ScheduledTaskList',
  scheduledTaskUpdate: 'ScheduledTaskUpdate',
  scheduledTaskDelete: 'ScheduledTaskDelete',
  scheduledTaskRun: 'ScheduledTaskRun',
  /** The one reminder that comes back HERE rather than opening a fresh session. */
  sendLater: 'SendLater',
  // Delegation
  agent: 'Agent',
  listAgents: 'ListAgents',
  agentOutput: 'AgentOutput',
  swarmStatus: 'SwarmStatus',
  viewAgentGraph: 'ViewAgentGraph',
  updateAgentGraph: 'UpdateAgentGraph',
  yieldAgentGraph: 'YieldAgentGraph',
  // Deep Research
  deepResearchStart: 'DeepResearchStart',
  deepResearchReadArtifact: 'DeepResearchReadArtifact',
  deepResearchSaveArtifact: 'DeepResearchSaveArtifact',
  deepResearchUpdateChecklist: 'DeepResearchUpdateChecklist',
  deepResearchRecordStep: 'DeepResearchRecordStep',
  deepResearchCheckpoint: 'DeepResearchCheckpoint',
  deepResearchStatus: 'DeepResearchStatus',
  deepResearchComplete: 'DeepResearchComplete',
  // Client capabilities
  computer: 'Computer',
  browserNavigate: 'BrowserNavigate',
  browserSnapshot: 'BrowserSnapshot',
  browserClick: 'BrowserClick',
  browserType: 'BrowserType',
  browserWait: 'BrowserWait',
  browserExtract: 'BrowserExtract',
  // Web, history, settings, memory
  webFetch: 'WebFetch',
  webSearch: 'WebSearch',
  searchHistory: 'SearchHistory',
  readHistory: 'ReadHistory',
  copilotSettingsGet: 'CopilotSettingsGet',
  copilotSettingsUpdate: 'CopilotSettingsUpdate',
  memoryList: 'MemoryList',
  memoryRead: 'MemoryRead',
  memoryWrite: 'MemoryWrite',
  memoryStrReplace: 'MemoryStrReplace',
  memoryAppend: 'MemoryAppend',
  memoryDelete: 'MemoryDelete',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/**
 * The name the OpenAI Responses adapter sends for `ToolSearch`. OpenAI owns a
 * hosted tool of the same family (#3958), so the wire name carries a prefix
 * there and is mapped back before anything else reads it.
 */
export const TOOL_SEARCH_PROVIDER_NAME = 'CopilotToolSearch';

const CANONICAL_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(TOOL_NAMES));

export function isFirstPartyToolName(name: string): name is ToolName {
  return CANONICAL_TOOL_NAMES.has(name);
}
