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

# Phase 8 — the tool surface and the system prompt, rebuilt as contracts

Done 2026-09-13. The model-facing surface — what the tools are called, what
their descriptions promise, what comes back, and what the system prompt says —
now follows the conventions of the Claude Code / Cowork harness the owner
supplied as reference (`toolsfullspec_0913.md`, `fullsystemprompt_0911.md`):
consistent names, descriptions that state failure modes and guardrails, minimal
success output and actionable failure output, prose kept in files, and a
provider-stable static prefix with per-turn facts delivered beside the turn.
The reference's *content* was not copied: it describes a cloud workspace with a
device bridge, and Maka's tools act on the user's machine inside the sandbox
boundary, so every section was written for that.

## What landed

### Names

- `packages/core/src/tool-names.ts` — the registry. First-party tools are
  PascalCase (`ToolSearch`, `TaskStop`, `TaskInput`, `RequestSandboxBoundary`,
  `TodoRead`/`TodoWrite`, `UpdatePlan`/`CancelPlan`, `Agent`/`ListAgents`/
  `AgentOutput`, `SwarmStatus`, `ViewAgentGraph`/`UpdateAgentGraph`/
  `YieldAgentGraph`, eight `DeepResearch*`, `Computer`, six `Browser*`,
  `MemoryRemember`/`MemoryExtract`); `apply_patch` keeps OpenAI's spelling and
  MCP proxies keep `mcp__<server>__<tool>`. Every production reference is
  `TOOL_NAMES.*`, so a rename is one edit. There is no alias table: the
  product has never shipped, the only ledger that carried the old spellings
  was one developer's, and it was deleted rather than carried (see
  [Phase 8c](#phase-8c--the-compatibility-layers-come-out)).
- `ToolSearch` travels the OpenAI Responses wire as `MakaToolSearch`
  (`TOOL_SEARCH_PROVIDER_NAME`), since OpenAI owns a hosted tool of that name.

### Behaviour and results

- **Grep** gained `output_mode` (`files_with_matches` default, `content`,
  `count`), `ignore_case`, `context`, `head_limit` (default 250) and
  `multiline`, in both the sandboxed worker and the host-local executor; the
  model receives plain text (`path:line:text`, paths, or `path:count` plus a
  total), `No matches found`, and a truncation note.
- **Glob** takes `path` (was `cwd`), returns newest-first, capped at 200 with a
  note, `No files found` when empty.
- **Edit** gained `replace_all`; the multiple-match error now counts the
  matches and names both ways out; `replacements` reports the count.
- **Write** refuses to overwrite a file the session has not seen through
  Read, Write, Edit or apply_patch (`write_unread_target`, a
  bounded per-session ledger in `builtin-tools.ts` threaded as
  `allowOverwrite` through the worker protocol and the host executor).
  Creating a file never needs a prior read.
- **Bash** gained an optional `description` for the interface; the model
  receives plain text — the captured output, led by `Exit code N` only when
  the command failed, `(no output)` when silent, and a `Sandbox denial:` line
  naming the backend when the sandbox signalled one. Background runs keep
  their structured ref. The durable result the UI renders is unchanged.
- Write/Edit summaries end with "(file state is current in your
  context — no need to Read it back)".

### Descriptions

Every first-party description was rewritten in one register: a purpose line,
then bullets for behaviour, failure modes, guardrails and what comes back;
parameter detail moved into `.describe()`. Cross-references use the new names.
The Computer action matrix was tightened and completed.

### System prompt

- `packages/runtime/resources/prompts/NN-id.md` holds the static layer
  (identity, how you work, response format, progress updates, using tools,
  workspace and deliverables, working unattended); `npm run generate:prompts`
  compiles it into `system-prompt/prompt-catalog.generated.ts`, and
  `assembleMainSessionSystemPrompt` prepends it in catalog order. The layer is
  identical for every session, so it never churns the provider prefix.
- `system-prompt/environment-prompt.ts` — the session-level block (working
  directory, git repository and branch, platform, temporary directory, time
  zone), rendered by the composer into both the main and the child-agent
  prompt.
- `system-prompt/turn-reminder.ts` — the per-turn facts (date and time,
  serving model, permission mode derived from the live boundary, boundary
  kind and revision, Plan overlay) as a `<system-reminder>` block the turn
  appends as a trailing user-role context on every step. The host injects the
  renderer (`renderTurnReminder` in `AiSdkBackendInput`); a backend built
  without it sends nothing.

### Tests and gates

- Goldens: `packages/runtime/src/__tests__/golden/main-session-static-prompt.txt`
  and `packages/runtime-host/src/__tests__/golden/tool-surface.json`
  (every direct tool's name, description and JSON schema as the provider
  receives them). Refresh with `MAKA_UPDATE_GOLDEN=1`; the golden directories
  are formatter- and header-exempt.
- Legacy-name compatibility tests in runtime, ui, core and CLI drive each old
  spelling through its real entry point.
- The headless coding profile's frozen tools hash moved
  (`HEADLESS_CODING_V1_TOOLS_HASH`), as it must whenever a description in that
  profile changes.
- `SECURITY.md` §2.1 now defines the agent process as the Runtime Host child
  process, which is where the tools have run since the Host split.

## Phase 8b — fidelity pass

The first pass borrowed the reference's *style*; the owner asked for its
*shape*: the same prompt sections, the same parameter names and result text
per tool, the two delivery tools ported, and cards in the relx register. This
pass did that.

### System prompt, in the reference's sections

`resources/prompts/` now holds `<application_details>`, `<maka_behavior>`
(product_information, refusal_handling, tone_and_formatting with
lists_and_bullets and progress_updates, responding_to_mistakes_and_criticism,
doing_the_work, search_first, knowledge_cutoff), `<ask_user_question_tool>`,
`<task_list_tools>` with its verification_step, `<send_user_message_tool>`,
`<citation_requirements>`, `<unattended_operation>`, `<scheduled_tasks>`,
`<workspace_and_tools>` (file_creation_advice, unnecessary_tool_use_avoidance,
using_tools, web_content_restrictions, skills, workspace_explanation,
file_handling_rules, producing_outputs, sharing_files with its good example,
package_management, examples, additional_skills_reminder) and the closing
parallel-tool-calls sentence. Each section is the reference's, rewritten for a
local machine: one filesystem, the workbar instead of SendUserFile-to-cloud,
the sandbox boundary instead of a device bridge. The environment block is the
reference's `<env>` form; the per-turn block is `<system-reminder>`.

### Tools, parameter by parameter

- **Read** `file_path` / `offset` / `limit`, `cat -n` output, `EISDIR` /
  `ENOENT` / empty-file notes, the reference description verbatim (plus the
  cwd-relative sentence).
- **Write** `file_path` / `content`; `File created successfully at:` /
  `File updated successfully at:`.
- **Edit** `file_path` / `old_string` / `new_string` / `replace_all`; the
  read-before-edit guard (`edit_unread_target`); the reference's multi-match
  message word for word; `The file … has been updated successfully.`
- **Glob** `pattern` / `path`; oldest first, newest last, as the reference
  measured.
- **Grep** `pattern` / `path` / `glob` / `type` / `output_mode` / `-i` /
  `-n` / `-A` / `-B` / `-C` / `context` / `multiline` / `head_limit` /
  `offset`; the reference description.
- **Bash** `command` / `description` / `timeout` (ms; `timeout_ms` still
  accepted) / `run_in_background` / `pty`; the reference description with its
  `# Git` section, Maka's bullets under `# Maka`.
- **AskUserQuestion** `questions[{question, header, options[{label,
  description}], multiSelect}]`; result `Your questions have been answered:
  "q"="label"`. Core, the persisted interaction record, the Host protocol,
  the desktop guard and the CLI TUI all carry the new fields; `header` is
  required everywhere, including in stored records. The reference's option
  `preview`
  is deliberately NOT implemented (owner decision): no field, no side-by-side
  layout, no CLI preview rows.
- **Agent** `prompt` / `description` / `subagent_type` / `model` /
  `isolation` / `write_back`; **Skill** `skill` / `args`; **ToolSearch**
  `query` / `max_results` with `select:` and `+word` forms.
- **WebSearch** `query` / `allowed_domains` / `blocked_domains`; output
  `Web search results for query: … Links: […] REMINDER: …` (with each link's
  snippet). **WebFetch** `url` / `prompt`; the prompt is answered by the
  session's auxiliary model against the page, the way the reference's small
  model does.
- **SendUserFile** `files` / `status` / `caption` / `display` → a
  `user_file_delivery` result whose files are `user_delivery` artifacts in
  the Files face; `N file(s) delivered to user.` **SendUserMessage**
  `message` → a `user_message` result; `Message delivered to user.` Both are
  default-loaded; delegation and the todo tools stay deferred, as the child
  tool-ceiling tests pin.
- Each tool takes exactly one spelling of each parameter; every projection
  that keys on an argument name (core quiet previews, permission review,
  artifact derivation, ui previews, CLI summaries) reads that one.

### Rendering, in the relx register

- A delivery renders as a strip of 120×120 file cards (name, extension badge,
  size, image thumbnail when `display` is `render`), the caption beneath, a
  "proactive" tag when the model offered them; the card opens the Files face
  on that artifact. It stands after its tool group like an answer, not
  inside the folded step list.
- A sent message renders verbatim as Markdown in a labelled block; the step
  folds to "Sent a message".
- Grep and Glob results render in the list panel (path link, line, text,
  "N more omitted"). Bash and Agent rows show their `description` as the
  label.
- The question panel shows, for `multiSelect`, checkboxes with a Submit
  button; single-select stays click-to-answer. It does not draw the `header`
  (see Phase 8e).

## Verification

All run 2026-09-13 on the finished tree, in this order:

- `npm run build:test`, `npm run typecheck`, `npm run lint`, `npm run
  format:check`, `node scripts/gen-prompt-catalog.mjs --check`,
  `node scripts/gen-bundled-skill-catalog.mjs --check`, locale hygiene, ASF
  headers, the renderer architecture ledger, the e2e budget and third-party
  notices: all green. knip reports the same 39 unused files as before the
  phase; the one new unlisted dependency (`app-builder-lib` in
  `electron-builder.config.mjs`) belongs to Phase 7c.
- Workspace dist tests: desktop 1634 + 294 renderer-state, runtime-host 1925
  (12 skipped), cli 1046 (3 skipped), core 835, mcp 250, ui 245,
  computer-use 117, website 11, storage 1244 (8 skipped), eval 82 (its
  `cancellation while waiting for ready line` case flaked once under the
  parallel run and passes alone), runtime 3525 of 3539 with 13 skipped — the
  one failure is `model-adapter-onerror`, which fails on this machine before
  and after the phase.
- Electron smoke: 44 checks, no renderer errors; core-dialogue regression;
  streaming-switch smoke: no errors.
- Goldens generated on macOS; the tool-surface golden test skips on Windows
  because the Bash description carries the host shell dialect.

Phase 8b, re-run on the integrated tree the same day: every static gate
green; dist tests desktop 1634 + 310 renderer-state, runtime-host 1925 (12
skipped), cli 1050 (3 skipped), core 846, mcp 250, ui 245, computer-use 117,
website 11; storage 1244 and eval 82 each flaked one timing case under the
parallel run and pass alone; runtime 3569 of 3583 (13 skipped) with only
`model-adapter-onerror` failing, as before. Electron smoke: 44 checks, no
renderer errors (the multi-question step now presses Submit on the
multi-select question); core-dialogue and streaming-switch smokes green.
Both goldens and the headless wire hash regenerated after the last change.


## Phase 8c — the compatibility layers come out

Same day, owner's decision: the product has never shipped, the only store
carrying the old spellings was one developer's, and a compatibility layer for
it is dead weight. The dev state root was moved to a timestamped backup and
every shim this refactor had added was deleted.

- **Tool-name aliases** — `LEGACY_TOOL_NAME_ALIASES`, `canonicalToolName()`,
  `isLegacyToolName()`, `toolNameMatches()` and all 122 call sites across
  core, runtime, runtime-host, ui, cli and the renderer. Every comparison is
  now `name === TOOL_NAMES.x`. `TOOL_SEARCH_PROVIDER_NAME` stays: it answers
  a provider constraint (OpenAI Responses reserves `tool_search`), not a
  history.
- **Tool-argument aliases** — `tool-arg-aliases.ts` and every preprocess that
  folded `path`→`file_path`, `timeout_ms`→`timeout`, `name`→`skill`,
  `task`→`prompt`, `subagent_id`/`profile`→`subagent_type`,
  `limit`→`max_results`. Each tool takes one spelling. The graph tools' own
  `subagent_id` / `agent_id` / `profile` fields are product vocabulary and
  were not touched. Removing the wrappers left the generated JSON Schema
  byte-identical, so the tool-surface golden and the headless wire hash did
  not move.
- **Question-record tolerance** — `header` is required in both the durable
  shape and the record schema; the retired `preview` key is no longer
  admitted; the "decodes to `''`" default is gone.
- **Dual-spelling reads** at the projection boundaries (working set, artifact
  derivation, CLI transcript, quiet previews) read the canonical name only.
  The `path` / `file` fallbacks in `tool-quiet-preview.ts` stay: they predate
  this refactor and serve MCP and third-party tools.
- Upstream Apache Maka's own legacy handling stays untouched — legacy
  permission events, `legacy_run` / `legacy_turn` locators,
  `legacyContentSha256`, `runtime_legacy_invocation_openings` and the rest.
  It is upstream's contract with upstream's users and would conflict on every
  sync.

Verified on the integrated tree: every static gate green; dist tests desktop
1634 + 310 renderer-state, runtime-host 1924 (12 skipped), cli 1048 (3
skipped), core 842, mcp 250, ui 237, computer-use 117, website 11, eval 82,
storage 1243, runtime 3551 of 3565 — the only failures are
`model-adapter-onerror` and a git-worktree cleanup race, both of which fail on
this machine before and after. Electron smoke (44 checks, no renderer
errors), core-dialogue and streaming-switch all green against a freshly
created, empty state root.

## Phase 8d — FormatJson is deleted

Owner's call, same day. The tool pretty-printed a JSON file in place with an
optional key sort, and nothing else. The reference tool surface has no
counterpart, the model never needed a dedicated tool for something Bash and
Edit already do, and every byte of it — a tool, a worker operation, a
filesystem-executor branch, a model-output formatter, a result kind — was
surface the model had to read past. It is gone, not deprecated.

- **Tool** — the `FormatJson` object in `builtin-tools.ts` and the
  `formatJson` entry in `TOOL_NAMES`.
- **Worker protocol** — the `format_json` request and result schemas in
  `filesystem-worker/protocol.ts` and its operation in `operations.ts`.
  `operationAccess` now reads `write` for `write`, `apply_patch` and `edit`
  only.
- **Executors** — the `format_json` branches in `filesystem-executor.ts` and
  `workspace-executor.ts`, and its case in `file-tool-model-output.ts`.
- **Tests** — the `builtin FormatJson (file in place)` suite and the
  `format_json` cases in the worker, authority and file-worker suites.
- **Goldens** — the interactive tool surface drops from 16 tools to 15:
  AskUserQuestion, Bash, Edit, Glob, Grep, Read, RequestSandboxBoundary,
  SendUserFile, SendUserMessage, Skill, SkillSearch, TodoRead, TodoWrite,
  Write, apply_patch. The headless coding profile's tool hash is unchanged —
  FormatJson was never in it.

Deleting the tool's test suite took the file's shared helpers with it; they
were restored from the pre-deletion text, `toolset()` and `sightedEditTool()`
included, and the suite is whole again.

Verified on a clean build of every workspace: lint, format, typecheck, ASF
headers, locale hygiene, TUI copy, renderer architecture and stale-dist all
pass, and so does the whole test run bar `model-adapter-onerror`, which fails
the same way against HEAD's own `model-adapter.ts` (its 14 tests pass; the
file fails on asynchronous activity after a test ends). Electron smoke, core
dialogue, streaming switch and composer prompts are green, and the worker
bundled into the desktop app carries no `format_json`. The multi-select hint
the new AskUserQuestion overlay draws was added to the TUI copy allowance
beside the single-select one. The `CHANGELOG.md` line naming FormatJson is an
upstream release record and stays as written.

Two knip findings in `apps/desktop` predate this work and are untouched: an
unlisted `app-builder-lib` in the electron-builder config, and the duplicate
export pair in `renderer/lib/ported/workbar-layout.ts`.

## Phase 8e — the question header is not drawn

Owner's call: the desktop page should not render an AskUserQuestion `header`.
The chip sat over a question that already states itself in a full sentence, so
it read as a label on a label, in the live panel above the composer and again
in the settled transcript record.

- **Live panel** (`composer/InteractionPrompts.tsx`) — the chip span is gone;
  the question is the header row's only text.
- **Transcript record** (`session/AskUserQuestionRecord.tsx`) — the chip span
  is gone; each entry is the question in muted text over its answers.
- **Shape** — unchanged. `header` stays required on the tool, stays in
  `readUserQuestions`, and stays in the persisted result. It is the model's
  index term for the decision, not copy for the reader, and the reference
  requires it.
- **Test** — the record test now asserts the header is absent from the card's
  text, for a single- and a multi-select question both.

The CLI's bottom picker still prefixes the question with `[header]`
(`pi-tui-pickers.ts`). That surface was not in the ask and is untouched.

### The confirm key is an arrow in both modes

The panel had kept a named button for multi-select — "Submit" on the last
question, "Next" before it — on the reasoning that ticks alone do not send and
nothing else on the row said so. relx does not do that: its `ConfirmButton` is
an icon in both modes, → to turn the page and ↑ to send, and what tells a
multi-select reader that ticking is not sending is the bar the key sits in.

Maka now matches it:

- `ConfirmButton` is one presentational component. It takes its whole name as
  a prop, because an arrow has no text for a reader to fall back on. Passing
  the label in rather than reading the locale inside keeps it hook-free, which
  is what the renderer-architecture ledger records.
- Multi-select gets relx's bottom bar: the count of what is ticked on the
  left, Skip and the confirm key on the right.
- Single-select keeps Skip on the "Something else" row and shows the confirm
  key only on the final question — until then, picking an option advances by
  itself.
- `submit` and `nextQuestion` are gone from the composer copy; `selectedCount`
  replaces them in all three locales. Skip stays a word: "move on without
  answering" is not a direction.
- The Electron smoke now finds the key by its label, `Submit answers`, and
  captures the multi-select bar as `phase3a-question-multi.png`.

### The confirm key is brand, not blue

Owner caught the premise: the send colour was recorded as the blue accent
"not relx's brand orange", and that is backwards. In relx every solid send or
confirm key is `ui-control-squish-brand` — the composer's send key, the
knowledge composer's, and `AskUserPanel`'s own confirm. The accent role only
ever appears as a tint behind blue text, on the composer's active meta chip;
it is never a solid action fill. The misreading came from a parenthetical in
the relx inventory saying brand was "NOT the primary button colour", which
meant only that it is not `--fill-primary`.

- `ui-control-squish-accent-fill` was a Maka invention with exactly one
  consumer, this key. The key is `ui-control-squish-brand` now and the class
  is deleted rather than left for something to find.
- Nothing else was wrong: the welcome composer's send key was already brand,
  and the meta chip already used the tinted `ui-control-squish-accent`.
- The two places that recorded the wrong rule are corrected: the Phase 3b
  report's composer entry, and the inventory line whose parenthetical caused
  it.

## Phase 8f — the model calls itself Copilot

Owner's decision: the name the model reads is Copilot, not Maka. This is the
prompt-facing name only. The packages, the app, the window title, the transcript
label and the `~/.maka` config directory are all untouched — nothing about the
codebase or the product identity moved.

Renamed, everywhere the model can read it:

- **Prompt resources** — 38 mentions across six files. `10-maka-behavior.md`
  became `10-copilot-behavior.md`, its section id `copilot-behavior`, and its
  tag `<copilot_behavior>`.
- **Tool names** — `MakaSettingsGet`/`MakaSettingsUpdate` became
  `CopilotSettingsGet`/`CopilotSettingsUpdate`, and the OpenAI Responses alias
  `MakaToolSearch` became `CopilotToolSearch`. The `TOOL_NAMES` keys moved with
  their values, so no key reads `maka*` while its value says Copilot.
- **Tool copy the model reads** — the settings tools' display names,
  descriptions, confirmation question and result messages; the internal
  filesystem-failure text in `builtin-tools.ts`; the Computer tool's display
  name; the DeepResearch prompt lines.
- **Other system prompts** — the WorkHub assistant preamble, the Daily Review
  preamble, and the subscription-fetch fallback all said "You are Maka".
- **Bundled skill** — the computer-use skill body, five mentions.
- **Turn reminder** — the two sandbox lines that said "No Maka-managed
  sandbox".

Type names (`MakaTool`, `MakaToolContext`), workspace imports (`@maka/*`) and
the `~/.maka` instruction path stayed: none of them is the product's name to the
model, and the path is a real directory that the prose must not misreport.

Verified on a clean build of every workspace: lint, format, typecheck, ASF
headers, locale hygiene, TUI copy, renderer architecture and stale-dist all
pass. Every workspace's tests pass except `model-adapter-onerror`, the
pre-existing failure recorded in Phase 8d. Electron smoke (44 checks, no
renderer errors) and the composer-prompt smoke are green. Both goldens were
regenerated: the static prompt now opens "You are Copilot" and carries no
"Maka", and the tool surface still lists 15 tools.

Left deliberately inconsistent, for the owner to decide: the transcript still
labels the assistant "Maka" (`packages/ui/src/conversation-copy.ts`, all three
locales), so a user sees "Maka" beside a model that calls itself Copilot.

## Phase 8g — the todo list becomes the reference task list

`TodoWrite` / `TodoRead` replaced a whole list on every write. Marking one item
done cost a full resend, and the tool description had to warn "include every
item that should remain, not only the ones that changed" — a dropped item was
one forgetful call away. The reference surface is four tools over identified
tasks, and the owner supplied a test report capturing its descriptions, JSON
schemas and 34 recorded calls verbatim, so there was something to copy.

### Copied verbatim

- **Descriptions** for TaskCreate, TaskList, TaskGet and TaskUpdate, and the
  parameter names and per-parameter descriptions from their schemas.
- **Result text**, which is the contract the model learns by seeing:
  `Task #1 created successfully: <subject>`, `No tasks found`,
  `#1 [pending] <subject> (owner) [blocked by #2]`, the multi-line TaskGet
  block, `Updated task #1 status`, `Updated task #1 deleted`, `Task not found`.
  All plain text, no JSON, no error codes.
- **Behaviour**: ids monotonic and never reused, dependencies written from
  either end and mirrored on both, a completed blocker dropping out of the
  open blocker list, `deleted` as a hard delete.

### Deliberately not copied

The report records seven defects in the reference implementation. Three of them
report success for work not done, so they are refusals here; `relx` fixed two of
the same three in its own port.

- An edge onto an unknown id is refused, naming the id, instead of being
  dropped behind `Updated task #3 blockedBy`.
- An edge that would close a cycle is refused. The reference lets a task block
  itself, producing a task that can never start, with no warning.
- An update naming no field to change is refused instead of answering
  `Updated task #2`, which hides a caller that built its arguments wrong.

One more is a consistency fix rather than a defect fix: the reference shows
completed blockers in TaskGet and hides them in TaskList, while TaskGet's own
description says to "verify its blockedBy list is empty before beginning work" —
advice its own output makes impossible to follow. Both surfaces now show open
blockers only, and the stored edge is kept.

### What moved

- `packages/core/src/session-task.ts` replaces `session-todo.ts`: the task,
  the document, create/update/delete, the cycle check and the wire decoder.
- `packages/storage/src/session-task-store.ts` reads, mutates and writes the
  document inside one transaction. Schema 2; a schema 1 row is refused, not
  migrated, because nothing shipped on it.
- `packages/runtime/src/session-task-tools.ts` is the four-tool surface.
- The Host coordinator, protocol codec, CLI overlay and Desktop adapter follow
  the document shape; `session.todo.query` is `session.task.query`.
- The interactive tool surface is 17 tools: the golden lists TaskCreate,
  TaskGet, TaskList and TaskUpdate where TodoRead and TodoWrite stood.

Verified on a clean build of every workspace: lint, format, typecheck, ASF
headers, locale hygiene, TUI copy, renderer architecture and stale-dist pass.
Every workspace's tests pass except `model-adapter-onerror`, the pre-existing
failure from Phase 8d. Ten new tests in `core` pin the model, including one per
refusal above. The Electron smoke is green at 44 checks with no renderer errors.

## Phase 8h — the task list gets a face

Two gaps the Phase 8g refactor left: the four task tools drew the generic
wrench in the transcript, and the document reached the window boundary with
nothing in the renderer reading it. `todo.read` and `todo.subscribeChanges`
had been on the bridge since the Host grew the projection, unused.

### The tool rows

`relx`'s `TaskToolRenderer` gives all four tools one icon and a verb that
changes with the row's state. Ours does the same, with one deliberate
difference: relx sets `canExpand: () => false`, and we keep the rows
expandable, so the result text stays one click away.

- A `tasks` activity kind, mapped to the `tasks` glyph the icon font already
  carried and nobody used.
- Row titles by tool and state: Creating task / Task created, Updating task /
  Task updated, Fetching task #N / Fetched task #N, Listing tasks / Listed
  tasks. TaskGet names its target, because "Fetched task" alone says less than
  the row it came from.
- Group labels in all three locales.

### The session panel

Not a sixth workbar face. A second occupant of the same column, mutually
exclusive with the pane — which is how relx's `TaskSidebar` sits against its
preview panes, and which dissolves the width arithmetic that left this
decision open since 2026-09-10: at 1512 the transcript would have had 176px
with both open, and both are never open.

- `uiStore.sessionPanelOpen`, persisted. Opening it collapses the pane; any
  workbar action that reveals the pane closes it.
- Its own titlebar switch beside the workbar's, carrying the same lift so a
  reader can see which occupant has the column without opening either.
- `useTaskProgress` reads the document through a new `bridge/session-tasks.ts`
  and refreshes on the Host's invalidations. A generation counter drops a late
  reply for a session the reader has already left.
- Progress rows follow relx's `TaskItemRow` geometry, including the two
  reasons its comments give: the badge is a sibling column, not an inline
  span, because an inline badge lets a wrapped second line slide under it; and
  the row's bottom padding is the row gap, so the list keeps one 32px step.
  The badge holds the task id while the task is open and the check once it is
  done; the label is `activeForm` while running; a blocked row names only the
  blockers that still stand.

Verified on a clean build of every workspace: lint, format, typecheck, ASF
headers, locale hygiene, renderer architecture and stale-dist pass, and the
architecture ledger was refreshed for the four new renderer modules. The
Electron smoke is at 45 checks, the new one proving the two toggles hand the
column back and forth. Three renderer state tests cover the row: the completed
strike, the active form, and the blocked note naming only the open blocker.

Tests: `model-adapter-onerror` still fails as it has since Phase 8d. Two others
failed once under the parallel run and pass in isolation on repeat — the
OpenAI Responses continuation test and a gitoxide helper test, both timing
races this machine has shown before.

Still owed here: the panel holds Progress only. relx's sidebar also carries
Runs, Outputs and Context, and Maka's Files face is the piece that would have
to split — list in the panel, preview in the pane.

## Owed

- MCP server instructions are not surfaced to the model: `packages/mcp` does
  not expose the `instructions` field of the initialize result. When it does,
  they belong in the turn reminder.
- The user interface locale is not in the environment block; the runtime
  policy carries no locale. The prompt asks the model to answer in the user's
  language instead.
- The desktop client-settings tools (`MakaClientSettingsGet` /
  `MakaClientSettingsUpdate`) are not in the registry; `tool-format.ts`
  classifies them by capability id, as before.
- SendUserFile stores a copy of the delivered file as a session artifact,
  and the artifact reader only accepts sources under the session cwd. A file
  inside a bypass boundary but outside the cwd passes admission and then
  fails with "has to live inside the session working directory". Widening
  the reader (`execution-artifacts.ts` `readBoundedSourceFile`) is the fix.
- The FakeBackend emits no delivery results, so the Electron smoke does not
  exercise the new cards; the renderer state tests do. A fixture turn for
  them is the follow-up.
- `packages/ui/src/user-question-prompt-state.ts` lost its renderer consumer
  (the panel's draft model now lives in the renderer); the CLI still uses
  it. Fold or delete once the CLI prompt is re-based on the new shape.
- Cowork's artifact publishing (a hosted page with its own URL) has no
  counterpart: a file delivered here lives in the workspace and the Files
  face.
