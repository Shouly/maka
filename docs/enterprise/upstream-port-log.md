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

# Upstream port log

## Policy

As of 2026-09-25 `enterprise` no longer merges `apache/maka`. The last merge
was the thirteenth sync, `c714de416` (upstream `09f0a5d36`, 2026-09-13).

Why: the renderer is a rewrite (61 of upstream's 618 renderer paths still exist
here), and the backend has diverged where we rebuilt it after the reference
(file tools, prompts and tool registry, memory, permission model, revisions).
Of the 155 upstream commits in batch 1 that touch backend code, 105 touch files
we have changed ourselves. A merge now costs more than it brings and can change
our semantics without a conflict marker.

Instead, upstream is read in batches. Each commit gets one of:

- **Port**: correctness, data-integrity or security fixes. Upstream's commit is
  a lead, not the answer: first confirm the bug exists in our code, then fix it
  against our code, which may mean a different fix than upstream's. A commit
  that applies cleanly and is right for us can be `git cherry-pick -x`.
- **Consider**: features or performance work we may want, built our way.
- **Model line**: model catalog, thinking and connection work. Decided together
  with the model-thinking catalog redesign
  (`model-thinking-catalog-redesign.md`), not here.
- **Diverged**: upstream went a way we deliberately did not; read for ideas.
- **Skip**: upstream renderer and Astryx UI, WorkHub, eval, CLI/ACP, plugins,
  CI, release and website.

The **watermark** is the last upstream commit triaged. The next batch starts
after it: `git log --reverse --no-merges <watermark>..upstream/main`.

Signals in the tables:

- **apply**: whether the commit's backend diff applies to `enterprise` as is.
  Backend here means core, runtime, runtime-host, storage and mcp, plus desktop
  main, preload and shared.
- **ours**: how many of the non-test backend files it touches we have changed
  since the merge base.

A conflict with `ours` = 0 means the commit depends on earlier upstream
commits, not that it collides with our work.

## Batch 1: `09f0a5d36..99cfeb7e9` (208 commits, 2026-09-13 → 2026-09-25)

Watermark after this batch: `99cfeb7e9`. Rows are proposed unless a
**Done** entry below says otherwise.

#### Done

- `c6de7e257` #5318: **bug confirmed**. A 429 without Retry-After, and a
  malformed Retry-After on a 5xx, ended the Turn. Fixed our way:
  - The failure kind alone decides retryability, through one exhaustive
    table, and Retry-After only paces a retry.
  - The OpenCode free-tier code `FreeUsageLimitError` is a billing code.
  - A 409 is no longer retried.
  - Unlike upstream, a truncated stream and the watchdog's own timeout stay on
    their bounded recovery paths, not the plain budget. Upstream only did this
    after #5270, which we do not have.
- `ba706ca64` #5672: **bug confirmed** (false alarms behind relays and
  gateways). Not deleted as upstream did: the note does give an action
  (declare a window), and Ollama really truncates silently. Now it fires only
  on Ollama connections.
- `412dc0390` #5658: **bug confirmed**. A resubscribe seeds the whole reply as
  one delta, and the 4 KB per-delta cap cut it. The per-delta cap is removed
  for text and thinking; the total caps stay. Upstream's offset refactor into
  core is not taken.
- `1ae4d5b89` #5319: **bug confirmed**. After one fold in a send, a later
  rejection could not fold, so a long turn failed. The reactive fold now
  re-arms at every accepted request. Unlike upstream, the proactive fold stays
  once per send: re-folding the live head before every step would spend a
  summary call to lose recent context.
- `2002f648e` #5466: **bug confirmed, reproduced** (the copy threw
  `canonical_args_hash_conflict`). Editing an earlier message failed once the
  model had used ArchiveRead: the copy rewrites the call's `ref`, but its
  dispatch kept the hash of the source args. The copy now re-stamps the
  dispatch, but only when the source dispatch authenticated the source call; a
  corrupt source is still refused. Our Read does not page tool results, so
  only ArchiveRead is affected.
- `8b0db8be1` #5676: **upstream's bug does not exist here**. Our Read caps in
  bytes (256 KB, per the reference). The same mistake existed in tool-result
  pruning, which estimated tokens from UTF-16 length: Chinese results were
  priced at a quarter of their cost and escaped archiving. Pruning now
  estimates from UTF-8 bytes. ASCII results are unchanged.
- `c6e3eb0cd` #5586: **bug confirmed**. On the OpenAI Chat wire the SDK
  JSON-stringifies a content tool result, so an image reached the model as
  base64 text. The OpenAI SDK types allow only text in a tool message and
  images in a user message. On that wire a tool result now keeps its text, and
  its images follow the tool-result group as one labelled user message.
  Known limit: a vision-capable thinking model on Chat sees a user message
  inside its tool loop.
- `30c406c9e` #5587: **premise does not hold for Claude 4.5+**. Anthropic's
  docs say 4.5 and later accept `input + max_tokens` past the window and stop
  with `model_context_window_exceeded`; only earlier models refuse. No output
  cap was added. What we kept: the earlier models' refusal ("input length and
  `max_tokens` exceed context limit") classified as a context overflow, so it
  folds instead of failing as a rejected request.
- `c6e3eb0cd` #5586, follow-up: a Host test (`execution-model-composition`)
  still pinned the old Chat wire shape (the image as JSON text in the tool
  message). It now checks that the bytes stay out of the tool message and
  arrive as a user `image_url`.
- `f02ac9433` #5406: **bug confirmed, reproduced**. Twenty thousand 15-byte
  PTY chunks held a keystroke for 23.3 s: every chunk was its own paced parser
  write, and a control cut queued behind all of them. Unstarted chunks now
  merge into the tail entry, up to the byte budget; the keystroke waited
  12 ms. Unlike upstream, a cut seals the tail, so output that arrives after
  a cut is never parsed ahead of it. The finalization test now holds one
  parse deterministically instead of relying on a flood. Upstream's other
  changes (no snapshot per client keystroke, slimmer replies, epoch 162) are
  performance work, not taken.
- `b62ca805e` #5610: **bug confirmed, different symptom**. Replay already
  dropped an unanswered call, so the next request was never refused. But
  recovery only answered Code Mode's `exec`. Any other tool interrupted by a
  crash stayed `prepared` forever once its run was sealed, so the Session
  could never be exported ("unsettled tool operation"), continuation replay
  refused it, and the model never learned the call may have run. Recovery now
  answers every dispatched, unanswered tool with an outcome-unknown result
  before sealing, including nested Code Mode calls. Sealed invocations and
  corrupt ledgers are left alone. Test fixtures that put the protocol marker
  on the user event now put it on the opening, as production does. Not taken:
  upstream's export-time repair of legacy ledgers (no backward compatibility).

- `412dc0390` #5658, follow-up: two desktop main tests
  (`assistant-stream.test.ts`) still assumed the 4 KB text delta cap. One now
  sets the cap explicitly to test redaction before a cut (tool output still
  uses that mechanism); the other checks a full reply within the total cap.
- `2d9843fef` #5325: **taken as is** (clean cherry-pick). The Host publishes
  admission before it imports execution composition, whose cold import took
  667 ms here. A connect that misses the startup deadline now reports the last
  connection failure.
- `891d0988f` #5536: **bug confirmed, reproduced** (the test never settled).
  A message dispatched to a Host that has since restarted was replayed with its
  old epoch forever: the new Host answers `outcome_unknown` for anything it
  cannot prove, and every later message of the Session waited behind it. The
  outbox now asks the Host what became of it (`turn.message.execution.query`):
  - Owned by a Turn: accepted, bound to that Turn.
  - Still in the Host queue: accepted as a follow-up.
  - Cancelled, or `not_admitted`: failed, and the user can remove it.
  - Left out, or the query failed: stays unknown and is asked again.
  `not_admitted` is a new positive answer (epoch 160): nothing durable names
  the identity and no submit of it is in flight. The query runs under the
  Session admission gate so it cannot race an admission write. Steering
  consumption writes its proof before deleting the admission row, so no
  window exists where neither names the message. The observer maps
  `not_admitted` to a retraction by name. Upstream's side-chat and WorkHub
  delegation changes have no counterpart here.
- `feb9cf22f` #5471: **bug confirmed, reproduced** (51 reads before the
  test's guard stopped it). A transcript catch-up re-armed itself after a
  failure too. A read of a dead subscription rejects at once, so the retry
  chain ran on microtasks alone: main pinned the CPU, and the subscription's
  close acknowledgement, which starts recovery, never arrived. A catch-up now
  re-arms only after it succeeds; a failure waits for the next announced
  watermark or the owner's recovery. Not taken: latching the error, moving
  pump failures ahead of the close handshake (both follow from the storm,
  which is gone), and reseeding evicted replicas on the live subscription (a
  refactor).
- `e06cf84ef` #5351: **bug confirmed, reproduced** over a real socket
  ("provider disconnected before admission"). A capability call carried its
  tool call id through an entity-id check (`[A-Za-z0-9_-]`, 128 chars). A Code
  Mode cell's nested call (`<id>:nested:<uuid>`) failed it, and so does a
  provider's own id such as Moonshot's `functions.x:0`. The client rejected
  the frame and the connection dropped. The id is now carried verbatim
  through the shared opaque-identity check (epoch 161). Both halves are
  taken, although triage said to skip WorkHub: WorkHub names its action after
  the tool call id and the Host requires an entity id there, so the id is now
  normalized once (stable on replay), and the model is told that id.
- `5a1252c79` #5534: **upstream's problem does not exist here**. Upstream
  has two selectors (`profile`, `subagent_id`) plus `executor_id`, and models
  filled the wrong one, for example a built-in profile as `subagent_id`. Our
  Agent tool has one `subagent_type` that resolves built-in profiles first and
  presets second, names the runnable profiles in its schema, and has no
  executor selector. What we took is the actionable error: an unknown
  selector used to say `Unknown subagent_id`, a field the model never sees.
  The Agent tool's own error now names `subagent_type`, says no child was
  started, and lists the built-in profiles. The preset catalog's error is
  shared with the agent graph, whose field is `subagent_id`, so it names the
  preset rather than either field.
- `17fa03647` #5682, Host half: **bug confirmed, reproduced** (the catalog
  never announced a Session parked on a sandbox boundary). A Session's status
  follows the Run's own events: a request makes it `waiting_for_user`, its
  ack makes it `running` again. Those events land after the Host's refresh
  at admission, so the root Turn loop refreshes once more, but it did so only
  for question and form requests and their answers. It now refreshes on every
  hosted interaction request and settlement ack, a sandbox boundary included,
  through the predicates the interaction authority already exports. The ack
  side is needed too: without it an approved boundary would stay "waiting".
  It has no dedicated test, because with the fake backend the Run completes
  right after the answer and that terminal refresh hides it. Client capability
  requests are not Run events and set no status; the Host refreshes them at
  admission. The notification and dock bounce half stays under Consider.
- `e92e4da21` #5086: **bug confirmed** (7 of the new tests fail on the old
  bridge). The CDP bridge kept in-flight commands by id alone, so a repeated
  id, in one session or across flattened sessions, overwrote the first entry:
  one result was delivered and the other dropped, and the client waited out
  its ~30s timeout. Taken as is: commands are keyed by session and id, and a
  duplicate within one session is refused.
- `8f3e80c59` #5483: **bug confirmed**. The embedded browser's rect is
  measured in renderer CSS px and was handed to the native view, which is
  placed in window DIP; they agree only at 100% zoom, so Cmd +/- misplaced
  the page. Main now scales the rect by the sender's zoom factor (edges
  scaled, then subtracted, so no rounding seam). Not taken: upstream reapplies
  a cached rect on `zoom-changed`, which Electron emits only for mouse-wheel
  zoom requests, not the menu's zoomIn/zoomOut we ship. Instead the renderer's
  per-frame measurement includes `devicePixelRatio`, so a zoom republishes
  even when the CSS rect stays the same.
- `efeba2ee4` #5603, security parts: **bugs confirmed** (6 of the new tests
  fail on the old code). The worst: a pre-registered client's id and secret
  followed whatever authorization server the resource's metadata named, so a
  malicious MCP server could collect the secret. Taken from upstream on an
  identical base:
  - A static client requires `oauth.issuer` and is refused when discovery
    finds another issuer; its tokens are used only under that issuer.
  - Stored credentials are bound to a hash of the static registration, and a
    change of issuer, client id or secret retires them.
  - An OAuth error callback is issuer-validated before its error is accepted.
  Not taken: the rest of the commit (the MCP editor, Module Hub routing, the
  update result and pending-login state), which is refactoring. A static
  client configured without `issuer` now fails with an error saying so; the
  editor has no OAuth fields, so it is set in the JSON config.

#### Deferred

- `c557cc41e` #5211: **bug exists, narrow**. A crash between a steering
  admission on one Turn and its handoff into a successor Root leaves the row
  naming the old Turn, and the handoff refuses it ("Message admission Turn
  conflict"). The fix needs the successor to prove the complete submitted
  payload, which touches storage contracts in four places. Deferred to after
  the rest of P2.

#### Moved to Consider after reading

- `f109ccde9` #5270: not a defect. It raises the EOF and idle-timeout
  recovery budget from one per step to ten, and keeps a failed response's
  fragment as interrupted output (persistence, projection and UI, 27 files).
  Ours is a deliberate one-retry policy; worth deciding as a product change.
- `4a42aaeab` #5287: a refactor of request settlement (−2,400 lines). No
  concrete failure is named.
- `837133a29` #4864: not a defect here. After a restart `recoverActiveGoal`
  already re-drives an active Goal. Upstream persists the successor intent so
  the exact evaluator verdict survives; ours re-evaluates instead.

### Port

Priority 1: failures a user hits.

| Commit | PR | What it fixes | Apply / ours | How |
|---|---|---|---|---|
| `c6de7e257` | #5318 | A 429 without Retry-After, or a gateway throttle that says "try again", ends the Turn instead of retrying. Retryability now comes from the failure kind alone. | conflict / 2 | re-implement |
| `ba706ca64` | #5672 | Removes the "provider dropped context" note. It guesses from input-token counts, and a relay or gateway moving requests between upstreams makes it fire falsely. | conflict / 5 | re-implement |
| `412dc0390` | #5658 | Stream deltas are capped at 4 KB, so long thinking shows "truncated" and loses text. Our `packages/ui/src/assistant-stream.ts` has the same cap. Deltas are now applied by offset, with one fold rule in core. | conflict / 3 | re-implement |
| `1ae4d5b89` | #5319 | A long Turn that compacted once can never compact again, so it overflows. The budget is now per accepted step. | conflict / 3 | re-implement |
| `2002f648e` | #5466 | Editing an earlier message fails with `canonical_args_hash_conflict` when the model had paged a truncated tool result. This hits our edit-and-resend. | conflict / 1 | check our Read paging, then re-implement |
| `8b0db8be1` | #5676 | Read pages and tool-result pruning are capped in UTF-16 characters, so Chinese text costs about 3× the tokens. The cap is now in UTF-8 bytes. | conflict / 2 | adapt to our Read |
| `f109ccde9` | #5270 | EOF, idle-timeout and transport failures recover under one budget, and interrupted response fragments are kept. | conflict / 15 | re-implement the runtime half; draw the interruption marker in our renderer |
| `4a42aaeab` | #5287 | Main request settlement is unified, so completed provider responses are preserved. | conflict / 9 | after #5270 |
| `b62ca805e` | #5610 | Interrupted tool calls are settled before an invocation's terminal event, so the ledger is never closed over an unsettled call. | conflict / 4 | re-implement |
| `c6e3eb0cd` | #5586 | OpenAI Chat requests send tool images as text, which inflates context. | conflict / 2 | re-implement |
| `f02ac9433` | #5406 | A PTY output flood delays a keystroke by seconds. | conflict / 5 | re-implement |
| `30c406c9e` | #5587 | Provider output is bounded during context recovery. | conflict / 2 | re-implement |

Priority 2: Host robustness.

| Commit | PR | What it fixes | Apply / ours | How |
|---|---|---|---|---|
| `2d9843fef` | #5325 | Admission is published before execution imports, which makes Host startup robust. | clean | cherry-pick |
| `837133a29` | #4864 | The Goal continuation outbox is durable. | clean | cherry-pick |
| `c557cc41e` | #5211 | Interrupted root handoffs are reconciled. | conflict / 3 | re-implement |
| `891d0988f` | #5536 | A message dispatched in a dead Host epoch never leaves the outbox. | conflict / 2 | re-implement |
| `feb9cf22f` | #5471 | A failed transcript replica read re-arms forever, pinning main at about 75% CPU. | conflict / 1 | check our main transcript path |
| `e06cf84ef` | #5351 | Nested Code Mode call ids drop the connection at the capability boundary. | conflict / 3 | re-implement (epoch bump) |
| `5a1252c79` | #5534 | Subagent spawn selection is explicit, with actionable errors. | conflict / 2 | re-implement |
| `17fa03647` | #5682 | Host half only: the Session is re-projected after a sandbox-boundary request, so the catalog no longer shows a parked Turn as running. | conflict / 4 | re-implement (notification half under Consider) |

Priority 3: import, export, browser and MCP security.

| Commit | PR | What it fixes | Apply / ours | How |
|---|---|---|---|---|
| `e108ab822` | #5413 | Hardens external-Session import boundaries. | conflict / 2 | re-implement |
| `0169d0731` | #5407 | One failed staged import aborts all startup recovery. | conflict / 0 | re-implement |
| `59a50e311` | #5588 | Export recovers interrupted invocations before bundling. | clean | cherry-pick |
| `efeba2ee4` | #5603 | Security parts only: MCP OAuth credentials and callbacks are bound to their issuer, and registration binding survives restarts. | conflict / 4 | re-implement the backend parts |
| `e92e4da21` | #5086 | A duplicate in-flight CDP id overwrites the pending command. | clean | cherry-pick |
| `8f3e80c59` | #5483 | The CUA browser viewport is wrong at UI zoom. | conflict / 0 | re-implement |
| `fd490b7f0` | #5598 | WebFetch resolves relative image sources. | clean | cherry-pick |

### Consider

| Commit(s) | PR | What | Note |
|---|---|---|---|
| `777a2363c`, `acab16537`, `fb9df6c3d` | #5532, #5550, #5628 | Catalog updates per row instead of a full `sessions.list()` and fresh row objects on every change. | Our `sessionsStore.refresh` replaces every row on every change. High value. |
| `4b3468857`, `d5bc0fad3`, `99cfeb7e9`, `01df8b186` | #5494, #5606, #5707, #5571 | The window paints before the Runtime Host is ready. | Large; mostly main. |
| `c9b0a2d97`, `177b2abba`, `e2a7cf233` | #5368, #5409, #5531 | Recall: ranked history passages, messages found by the files they carried, history search answered by recall. | Feeds our past-chats tools and search. |
| `17fa03647` | #5682 | Notification and dock bounce when a Turn waits on the user. | UI half of the Port row. |
| `c980b93a3`, `b062b40c4`, `a87e4520a` | #5387, #5410, #5517 | Usage screen reads consistent snapshots and reuses statistics. | Storage schema and epoch. |
| `518fd529c` | #5556 | Recovery and tool validation scale with long histories (schema 20). | Large. |
| `1c18700a7` | n/a | Name a project at creation; move tasks between projects. | Product feature. |
| `0042f4dfc` | #5560 | Cmd/Ctrl+Enter steers a running Turn. | Composer. |
| `f1f259b67` | #5629 | Opt-in next-prompt suggestions. | Product feature. |
| `acaa29e40` | #5638 | The user's signed-in Chrome through opencli-mcp. | Bundles a dependency. |
| `512605fd1` | #5316 | Managed HTML artifact preview endpoints. | |
| `fcc8db89e` | #5273 | Open supported Skill directories. | |
| `124921d8d` | n/a | Reference another Session's bounded snapshot from the composer. | Main side only; UI ours. |
| `26df0fc33` | #5440 | Side chats survive a Session switch. | If our renderer keeps side chats. |
| `0d09c5f0f`, `1c217a5c5` | #5070, #5073 | MCP `tools/call` progress; OAuth DCR client identity. | Clean. #5073 names Apache; use our own identity. |
| `4d1e35898`, `276faf1c9` | #5667, #5679 | ScheduledTask reports the Host clock and time zone. | Small. |
| `0d4a6ba5f` | #5243 | Diff line counting without building display rows. | Clean; perf. |
| `bf6e94229` | #5261 | Background task process and endpoint health tool. | A new tool; weigh against the reference tool list. |
| `a4b17ad14` | #4626 | Sandbox graph wake reconciliation. | If the agent graph stays. |
| `842667676`, `042b41c3d`, `0052f1cfd` | #5308, #5240, #5552 | External imports go through the Host; large Claude Code transcripts stream; imported Sessions bind to the chosen workspace. | #5308 is the base the import fixes build on. |
| `7678545cd` | #5296 | Window presentation mode resolved at startup. | Small. |
| `df12b31a9`, `e6db75689` | #5323, #5579 | Windows ACL startup tolerance; managed-Host failure diagnostics. | Only if we ship Windows or the managed Host. |
| `5e58c206a` | n/a | Bot onboarding retry health. | Main and core only. |

Cleanups that follow upstream (product decisions):

| Commit | PR | What | Our state |
|---|---|---|---|
| `b48ae6c21` | #5554 | Retire the Deep Research workflow. | We still carry about 30 files. |
| `8dfc68d23` | #5544 | Retire the built-in OpenCode Free provider. This also makes #5185 moot. | 7 files; touches the model line. |
| `730713131` | #5300 | Remove the obsolete permission-mode compatibility path. | Check against our Codex-style model. |
| `d05436cc0` | #5295 | Close the legacy archive read path. | Small. |

### Model line

These go to the model-thinking catalog redesign:

| Commit | PR | What |
|---|---|---|
| `c299cc17a` | #5684 | **Breaking.** One custom connection with per-model protocols. |
| `642858b1d` | #5533 | ApplyPatch editing configured per model. |
| `64f5e83de` | #5530 | Per-model thinking defaults (the non-WorkHub part). |
| `4410c3a2d` | #5376 | Unified model-discovery catalog validation. |
| `de16a6459` | #5437 | Wire-invalid token limits stay out of model metadata. |
| `cb4747171` | #5297 | Codex OAuth input-limit metadata is isolated. |
| `53b01a404` | #5633 | GPT-6 Sol and Luna metadata. |
| `0ab069c2a` | #5643 | models.dev provider split; deepseek-flash gets ApplyPatch. |
| `dc27be6e6` | #5678 | models.dev snapshot refresh, written in Biome format. |
| `1bdbefa3c` | #5326 | Moonshot Global provider. |
| `e98c2f4cf` | #5428 | Responses reasoning is replayed by the declared provider contract. Matters for relays on the openai adapter. |
| `3924c6557` | #5504 | Provider usage body is kept. Found on Command Code GO; check whether it is generic. |

### Diverged

| Commit | PR | Why not |
|---|---|---|
| `331b24df1` | #5431 | New Sessions default to bypass. Our permission model is Codex-style. |
| `87ff2799a` | #5468 | Removes Regenerate in favour of edit and resend. We keep Retry, as claude.ai does. |
| `06823c96e` | #5336 | Approved Plan steps. Plan mode is being removed. |
| `4cd71eaed`, `b37eb9639`, `a3ba6da59` | #5247, #5246, #5396 | Read/pruning, Grep/Glob errors, file-tool descriptions. Ours follow the reference report; #5676 is the part we take. |
| `9982e86b1` | #5365 | The transcript advances per committed event (the running timer reset). Our renderer has its own live projection; only check whether we show the symptom. |
| `846f4fbaa` | #5366 | Whole-transcript load and renderer virtualization. Our renderer pages its own way. |
| `0a5b9dc95` | #5675 | Steering placed by its durable event. We fixed ordering with arrival stamps; the Host-side echo removal would change what we receive. |
| `6adda8cff` | #5666 | tool_search naming in Code Mode. We do not rename tool_search. |
| `fe79d00ec` | #4971 | Internal refactor of tool-call argument views. |
| `9ce2032c2` | #5090 | Persistence verification for WorkHub. |
| `ea990cab7` | #5263 | Long-term memory search batching. Our memory is file-based. |
| `6bff26b42`, `db11413df` | #5174, #5185 | Superseded by #5672 and #5544. |
| `c34bbd6c1`, `f9d3efd4c`, `cf31b16a2`, `e73a884e7`, `bd39677ec` | #5395, #5442, #5484, #5489, #5545 | Command Code GO was added and removed again; nothing to port. |

### Skip

- **WorkHub**: `fa25b3d01` `4409c2896` `3dcf5a125` `dd15b63c6` `0d9ea7576` `aaabbbe36` `728450080` `c87651e23` `30163ede4` `39235e99c` `811e45fc5` `c7d205a42` `bc0786ee6` `e6e35aefe` `4528e75e5` `6cb8c5808` `063abf42f` `41d625b04` `e13656ef3`
- **Upstream renderer and Astryx UI**: `d2e6c1f27` `906c3c907` `85521b122` `34a6245ae` `c22768c3b` `2bc8a548e` `e589b1db2` `99098aafb` `3f297e9aa` `05d4d8ec4` `f875dc8f3` `2c49a9986` `27add3049` `f12d30535` `a2194e239` `9f706efb9` `cd93f13da` `6b652940b` `3abdf3fd7` `97000ba53` `5b9db1ce8` `eccd85032` `ebeb96139` `6c5255309` `d0dd3edf2` `0117d76c5` `d3292393c` `0dc1142aa` `aa86f9549` `8c3e0e8ff` `4dc6a47f9` `d9c670423` `3ff84c589` `205a06efb` `8060ec055` `3c6306839` `1a89a8434` `2afc791b4` `8bde344b1` `dc7958ec1` `8be311535` `c5eacae37` `2334c0661` `5263fb78a` `54135dce5` `b004473ed` `9082cf144` `bd8661f3a` `0d34f324f` `d8d296f9e` `c945c17d8` `31b7cd627` `e66bc8837` `36116ef5a` `bbeb58c68` `167cb9191` `695c9fc6b`
- **Eval**: `a753fa6f8` `5f4614bfd` `bb5b2b32a` `c9c8fb4a4` `6105ae726` `72cd8b1f5` `173aed934`
- **CLI and ACP**: `ec59d42f6` `672d82731` `852a9748d` `420c22186` `edb4a3ded`
- **Plugins and executors**: `f32cf2b48` `de06760bb` `9a91e3655` `0cb4fc32b`
- **CI, release, website, dependencies and tests**: `fcbaaac32` `76cccd599` `dc8e499b7` `87e1f71b2` `00c249831` `815caaf8b` `7baf8b053` `54542021a` `fef5b937a` `902c18e67` `19971f3f2` `a4700a789` `914242b34` `f874eeb9c` `bc9401d67` `879e0a4bc` `29f13bdb3`
