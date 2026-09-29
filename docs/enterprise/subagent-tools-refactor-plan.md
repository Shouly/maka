<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# Subagent tools refactor

Reference: `~/Downloads/子代理工具实测参考.md` (2026-09-29, second revision with the
prompt-snapshot sections). Decisions taken with the user on 2026-09-29.

## Decisions

| Topic | Decision |
|---|---|
| Execution | Background, as today. `Agent` returns an ID; the report arrives as a `<task-notification>` |
| Report | Child calls `SubagentHandback({message})`; the notification's `<result>` is that message (last assistant text only as a fallback). Role card and Notes reworded to the hand-back form so the prompt no longer contradicts itself |
| Types | `general-purpose` (default when `subagent_type` is omitted), `Explore`, `Plan`. Settings presets stay as custom types built on one of the three |
| Plan role card | The reference has none; ours is written from the Explore card (read-only rules) with a planning brief |
| Child memory | As the reference: full `<user_memory>` rules + read-only note + snapshot + MemoryList/MemoryRead |
| Orchestration | `AgentOutput`, `SwarmStatus`, `*AgentGraph` are no longer bound; code stays for a later wholesale delete |

## Tool surface

- `Agent` — resident. Params `description`, `prompt`, `subagent_type?`. `model`, `write_back`, `isolation` removed.
- `SendMessage` — deferred. A finished child whose report has been read resumes; a running child — or a finished
  one whose report is still on its way — gets the message queued. A running child reads it at its next step as
  `The coordinator sent a message while you were working:\n…\n\nAddress this before completing your current task.`
  Failures return `{"success":false,"message":…}` instead of throwing. `summary` stays on our side only.
- `ListAgents` — resident, no parameters: this session's children (the reference lists in-process subagents).
- `TaskStop` — reference error forms: `No task found with ID: x`, `Task x is not running (status: completed)`.
- `SubagentHandback` — child only, resident there; ends the child's turn.
- No per-turn cap on how many agents one turn launches (the old limit of 5 is gone; the reference has none).
  Simultaneous spawns still queue behind a startup permit of 32, which never refuses.
- Queued messages a child did not read open its next Turn only after the ended Turn's report is acknowledged
  (`markChildAgentNotified`); a stopped or cancelled child's queue is dropped; a failed resume keeps the queue.
- Notification gains `<usage><subagent_tokens/><tool_uses/><duration_ms/></usage>` (omitted when the ledger
  cannot be read). A hand-back is kept up to 100,000 characters, then marked `…(+N chars)`.

## Children

- Composed like a main session (deferral, skills listing, client capabilities, MCP, plugins), then filtered.
  Every child: no Agent, SendMessage, ListAgents, AskUserQuestion, memory writes, SendLater, ScheduledTask*
  (a scheduled run carries its own permission mode, so a read-only child could start one that writes),
  CopilotSettingsUpdate, goals, plan tools, orchestration tools. `Explore`/`Plan` also lose Write, Edit, NotebookEdit, apply_patch,
  and run under the read-only `explore` boundary; `general-purpose` follows the parent.
- The durable snapshot (`subagentRuntime`, schema v2) keeps type, name, preset and role card; `toolNames` is gone.
- System prompt: role card · instruction sources · Notes · `<user_memory>` · read-only note · workspace instructions.
- After the prompt text, in the reference order: memory snapshot, deferred tools, hand-back reminder,
  environment, skills, `<user>`, date. No `<user_preferences>`, no behaviour sections, no agent types.

## Tasks

- [x] core: profiles, snapshot v2, `TOOL_NAMES.subagentHandback`
- [x] runtime: catalog + role cards, tools, hand-back loop stop, notification text + usage, coordinator
      messages into a running child (a message the child never read opens its next Turn), child prompt
      assembler, injection layout, tool availability
- [x] runtime-host: child composition through the normal composer, drop child tool plumbing and graph tools;
      the invocable-skills query re-reads the header after tool resolution (the archive/removal race used to
      be caught by the graph tools)
- [x] desktop: Settings › Subagents types (a row shows `displayName`, so SubagentHandback needs no case)
- [x] tests, build, dev app

## Not done

- Children cannot message their parent (`SendMessage` to `"main"`); SendMessage and ListAgents are withheld
  from children until that exists.
- The worktree child executor and patch write-back remain in the tree, unused by any type.
- The orchestration subsystem (graph/swarm coordinator, supervisor wakes, `AgentOutput`) awaits deletion.
