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

# Agent tool family — reference captures (Claude Code, 2026-09-20)

Captured live from a Claude Code session. Everything below is verbatim; ids and paths are the session's own.

## Agent — launch result (tool result text)

```
Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: aca27ebb2f2fa8eb4 (internal ID - do not mention to user. Use SendMessage with to: 'aca27ebb2f2fa8eb4', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes. You know nothing about its results until that notification arrives — do not report, assume, or predict them; continue other work or respond to the user in the meantime.
Do not duplicate this agent's work — avoid working with the same files or topics it is using.
output_file: /private/tmp/claude-501/.../tasks/aca27ebb2f2fa8eb4.output
Do NOT Read or tail this file via the shell tool — it is the full subagent JSONL transcript and reading it will overflow your context. If the user asks for progress, say the agent is still running; you'll get a completion notification.
```

Parameters: `description` (3-5 words), `prompt`, `subagent_type`, `model` (sonnet|opus|haiku|…), `isolation` (worktree|remote).

## ListAgents — output

```
This session is maka-0e [106d26] — the name other sessions use to message it (it is not listed below; a message to it would be a message to yourself).

Subagents (2):
  aca27ebb2f2fa8eb4  ·  general-purpose  ·  completed  ·  started 7s ago
  af88fa216132dd341  ·  general-purpose  ·  running  ·  started 5s ago

Peer sessions (1):
  maka-cd [c7c004]  ·  interactive  ·  idle  ·  started 9h ago
```

After TaskStop the row reads `· killed ·`.

## TaskStop — on an agent

```json
{"message":"Successfully stopped task: af88fa216132dd341 (Reference probe: long sleep)","task_id":"af88fa216132dd341","task_type":"local_agent","command":"Reference probe: long sleep"}
```

(`task_type` is `local_bash` for a Bash task; `command` carries the agent's `description`.) Description: "Stops a running background task by its ID … To stop a background agent spawned with a name, pass that name as task_id". Parameter `task_id`.

## SendMessage — continue an agent

```json
{"success":true,"message":"Resuming agent aca27eb","resumedAgentId":"aca27ebb2f2fa8eb4","pin":{"id":"aca27ebb2f2fa8eb4","name":"aca27ebb2f2fa8eb4","ref":"a682cf"}}
```

Parameters: `to` (agentId or name), `message`, `summary` (5-10 words, transcript row label only), `notify_when_idle` (cross-session only).

## Completion notification — agent

Same preamble as the Bash notification (`[SYSTEM NOTIFICATION - NOT USER INPUT]` …). Then:

```
<task-notification>
<task-id>aca27ebb2f2fa8eb4</task-id>
<tool-use-id>toolu_019xNdcLbyT4XGcTTAU3yrEy</tool-use-id>
<output-file>/private/tmp/claude-501/.../tasks/aca27ebb2f2fa8eb4.output</output-file>
<status>completed</status>
<summary>Agent "Reference probe: reply once" finished</summary>
<note>A task-notification fires each time this agent stops with no live background children of its own. The user can send it another message and resume it, so the same task-id may notify more than once.</note>
<result>ready</result>
<usage><subagent_tokens>22621</subagent_tokens><tool_uses>0</tool_uses><duration_ms>2984</duration_ms></usage>
</task-notification>
```

Variant when the agent stopped while it still had background work of its own:

```
<note>This agent stopped with background work of its own still running. It may resume on its own when that work completes or reports, and the same task-id notifies again if it does; the result below may be interim.</note>
```

Observed: a TaskStop-killed agent STILL produced a notification (status `completed`, the interim result); a resumed agent (SendMessage) notifies again under the same task-id with the new `<result>`.

Mid-turn delivery: appended to the tool-result turn with no wrapper. Idle delivery: a new turn wrapped in `<system-reminder>` (same as Bash).

## Agent — tool description (system prompt, abridged to the operative sentences)

- "Launch a new agent to handle complex, multi-step tasks."
- `subagent_type`: `"fork"` forks yourself (inherits full context, same model); any other type starts a fresh agent (general-purpose by default).
- "A fresh agent costs more than it looks. It knows only what you put in the prompt, and you see only the summary it sends back…"
- "Reach for this when you have independent work to run in parallel, when the user asks for a side quest…, or when answering would mean reading across several files…"
- "Do the work yourself when it is a handful of tool calls… Once you've delegated something, don't also run it yourself; wait for the result. When in doubt, don't spawn."
- "brief it like the peer it is: state the goal and what you have already ruled out, point it at the files and docs…, keep the scope explicit and narrow."
- "A fork runs in the background… Subagents run in the background; you'll be notified when one completes. Never fabricate or predict a pending agent's results…"
- "The agent's final report is not shown to the user — relay what matters."
- "Use SendMessage with the agent's ID or name to continue a previously spawned agent with its context intact; a new Agent call starts fresh."
- "Each agent type's model, reasoning effort, and tools come from its definition."
- "`isolation: \"worktree\"` gives the agent its own git worktree (auto-cleaned if unchanged)."
