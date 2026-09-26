---
doc_id: skill-catalog-policy
title: "Skill catalog policy"
language: en
source_language: en
implementation_status: current
document_status: current
translation_status: source-only
last_verified: 2026-09-04
owners:
  - maka-backend
---
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

# Skill catalog policy

Maka keeps skill bodies out of the always-on system prompt. The prompt contains
only a bounded catalog; the read-only `Skill` tool loads full instructions when
a task matches a skill.

Discovery produces both a complete inventory and a winner catalog. Every valid
copy has a scope-aware `ref` (for example `project:maka:writer` or
`user:agents:writer`). Duplicate ids remain in the inventory for inspection,
but only the highest-precedence copy is eligible for the runtime catalog.

The catalog is selected deterministically in this order:

1. Discover skill directories in source precedence order. Project-level paths
   precede workspace compatibility paths, which precede user-level paths.
   Duplicate ids use first-found wins. Skills within one directory are ordered
   by display name.
2. Exclude disabled skills.
3. When the host supplies capabilities, exclude skills whose explicit
   `required-tools` or `required-capabilities` are unavailable. `allowed-tools`
   remains informational and never grants permission.
4. Put user-pinned skills first, then preserve source precedence and stable
   display-name/ref ordering.
5. Add catalog entries in the resulting order until the selected model's
   catalog budget is reached. The budget is 2% of its context window, clamped
   to 4,000–8,000 estimated tokens and converted at four characters per token.
   If the context window is unavailable, use the backward-compatible
   `MAX_SKILLS_PROMPT_CHARS = 18000` character budget.

The lower bound keeps useful catalogs available on small-context models. The
upper bound prevents large-context models from turning the catalog into an
unbounded always-on cost. Because changing models can change the selected
catalog, the model context window is an explicit prompt input rather than an
implicit provider lookup inside the skill scanner.

When the budget omits entries, the prompt contains only a constant-size count,
not an unbounded list of ids. Omission affects only catalog advertisement: an
enabled, host-compatible omitted skill remains discoverable through the deferred,
metadata-only `SearchSkills` tool — which also reports disabled skills and the
bundled or imported ones not installed, as `enabled: false` — and loadable by
exact ref, id, or name through the `Skill` tool. Skill instructions remain subject to their separate lazy-load
body limit.

`selectSkillsForContext` returns a `SkillSelectionReport` alongside the selected
catalog. It records one decision for every inventory item (`advertised`,
`budget`, `disabled`, `invalid`, `host_incompatible`, or `shadowed`) and the
advertised rank. Desktop caches the last prompt-build report per project for
its Context Inspector; before a prompt has been built, it displays a
deterministic preview.

Runtime preferences use `.maka/skills-state.json` schema v2:

```json
{
  "schemaVersion": 2,
  "skills": {
    "workspace:legacy:writer": {
      "enabled": true,
      "pinned": true,
      "updatedAt": "2026-07-22T00:00:00.000Z"
    }
  }
}
```

The reader remains compatible with schema v1 id keys. Desktop migrates an id
automatically only when it resolves to one inventory entry. If the id exists in
multiple scopes, schema v2 preserves the legacy default under
`migration.needsReview` until the user makes explicit ref-level choices; it
never guesses which copy the old preference meant. The Skills Context Inspector
shows every affected copy as `Needs review`; toggling or pinning acts on its
exact ref, and the marker clears only after every ambiguous copy has an explicit
preference.

Bundled provenance is not an execution authority over local workspace content.
Removing an entry from `BUNDLED_SKILL_CATALOG` stops Maka from distributing or
installing that source and makes an older bundled lock fail validation with
`metadata_error`. An upgrade does not delete, rewrite, or silently disable the
already-installed `skills/<id>` directory. If that local copy is otherwise
valid and enabled, Runtime continues to treat it as user-provided content and it
remains invocable under the ordinary permission and host-capability rules. The
user can disable or delete the local copy explicitly.

Configured discovery roots are also part of the diagnostic contract. A missing
optional root is normal and produces no warning. A symlink/non-directory root,
containment escape, or unreadable root produces a bounded
`SkillDiscoveryDiagnostic` (`blocked_path` or `read_failed`) and appears in the
Desktop inventory. It must not be collapsed into an indistinguishable empty
catalog.

## Naming a skill in a message

A user names a skill as `/<name>` — the grammar is `SKILL_INVOCATION_TOKEN_SOURCE`
in `@maka/core/skill-invocation-token`: a token starts the text or follows
whitespace and ends at whitespace, so paths and URLs never form one. Desktop
chips and TUI completion write `/<id>`, and Desktop keeps a chip one space
apart from whatever touches it. A built-in command with the same name wins at
the start of typed text: the TUI does not offer such a skill there, while a
Desktop chip the user picked stays a skill.

Nothing is resolved when the message is sent. The text reaches the model as
written, and the model loads the skill with the `Skill` tool, whose description
says a `/<name>` from the user is a request to invoke it — the one loading path,
so the base directory, the re-invocation note and the archive exemption apply to
every load. No message is refused over a skill. The Host only marks the tokens
that name an enabled, non-shadowed skill (id first, then display name) as
`skill` inline references, so the transcript draws them as chips; a
token that names nothing — a path, a typo, a disabled skill — stays text, and a
client-sent skill reference the Host does not confirm is dropped.

`Skill` tool loads produce a bounded receipt projected into run-trace data with
`invocation: model_tool`; these projections are durable AgentRun trace events.
Failed trace projections retain only request length, not the requested text,
and receipts contain no user prompt, search query, or Skill instructions.

Prompt construction, `SearchSkills`, and `Skill` emit diagnostic run-trace
events. Search telemetry stores counts — keywords, results, matches and
candidates — rather than the keywords themselves. The shadow evaluator retains at most the top 20 refs for the current turn;
when a searched skill is subsequently loaded, the load event records its rank
and Top-1/Top-5/Top-20 hit flags. This measures ranking quality without
collecting skill instructions or user query content.

## Governance closeout boundary

This policy closes the local Skill governance work when Runtime, Desktop, and
CLI contract tests cover duplicate/shadowed ids, invalid metadata, disabled and
host-incompatible skills, prompt-budget omission, `/<name>` chips that name
only a loadable skill, migration review, and discovery-source diagnostics.

Remote marketplaces and automatic updates, self-modifying/evolving Skills, a
full-screen TUI manager, embedding-based ranking, and analytics dashboards are
separate product initiatives. They are not prerequisites for a safe,
deterministic local Skill lifecycle.
