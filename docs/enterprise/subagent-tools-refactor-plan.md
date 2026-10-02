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

## Renderer

- The Agent step is its description, one line, no panel; a finished run of exactly one call is named by
  that call. Copy reads "Ran an agent" / "运行了子代理".
- While a child runs the Turn an Agent or SendMessage call started (catalog `runningTurnIds`), that row
  runs (`childAgentRunning`, a client-only overlay in `lib/child-agent-runs.ts`), the run holding it keeps
  shimmering, named by it (no working mark: that is the model's), the parent's rail row reads running, and
  a light tray tucked under the parent's composer (full width, its foot under the composer's top edge)
  gives each running agent a line — the rail's breathing dot, its description, its type when not the
  default, and its clock right-aligned in a column — that opens it (past four lines the tray scrolls).
  With the composer away (a revision draft, an unreadable boundary) the tray stands on its own. The clock
  counts from the catalog's `runningSince` (kernel `AgentRun.turnStartedAt`, the earliest running Turn's
  start; a continuation keeps the Turn's first replayed event's time, `continuationTurnStartedAt`).
- A child's crumb leads back to the parent, and its composer is a one-line composer face with the note,
  Stop and the way back; Escape stops it while the note has focus, which it takes when the child opens —
  the composer's own rule, so no other surface's Escape (a pane, an approval card) also stops the agent.
- A child is hidden from the rail, and read through its parent, only while that parent is open (in the
  catalog and not archived); otherwise it is the user's own conversation.
- The sessions store keeps a row's last informative `runningTurnIds` across the desktop cache's reads,
  which carry none (`retainRunningTurnIds`): read as "nothing running", every step a child took flipped
  all of the above off and on.
- A child is named by its description (cut to 80 code points).
- A child's requests (sandbox boundary, client capability, form) are answered from its parent: while the
  parent is on screen, `child-interactions-store` reads each running child's pending requests (on start,
  when the catalog's `awaitingUser` turns on, and on every change reported for it); the parent's prompt slot
  shows its own request first, then the agents' with a line naming the agent, and answers on the child's
  Session. The tray line turns amber and says "等你处理" in place of its clock (the rail's words, as a
  form waits as well as an approval), the run holding the Agent row wears the waiting pill, and the
  parent's rail row reads "等你处理".
- `liveRunState.awaitingUser` (epoch 168): the Host's interaction coordinator says, from its live set,
  which running sessions are parked on a request for the user — every kind, a client capability included,
  which never touched the Session's stored status. An answered entry is marked settling before the catalog
  is told, so a read in between does not still report the wait.

## Not done

- Children cannot message their parent (`SendMessage` to `"main"`); SendMessage and ListAgents are withheld
  from children until that exists.
- The worktree child executor and patch write-back remain in the tree, unused by any type.
- The orchestration subsystem (graph/swarm coordinator, supervisor wakes, `AgentOutput`) awaits deletion.
