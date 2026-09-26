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
 * The `/<name>` skill grammar — one string, because every client that reads
 * or writes a draft has to agree on where a token starts and ends: the TUI's
 * highlighter and autocomplete, the Desktop composer's chips, and the Host
 * that turns a sent token into an inline reference for the transcript.
 *
 * A token is only syntax. Whether `/<name>` names a skill is decided against
 * the invocable skills — `/tmp` is a path, not a skill, unless a skill is
 * called `tmp` — and a built-in command with the same name wins. Nothing is
 * loaded when a message is sent: the text reaches the model as written, and
 * the model, reading `/<name>`, loads the skill with the Skill tool.
 *
 * A token starts the text or follows whitespace and ends at whitespace or the
 * end of the text, so paths and URLs (`/usr/bin`, `a/b`, `https://x/y`) never
 * produce one. `<name>` uses the skill id charset.
 *
 * Always construct a fresh `RegExp` from this source at the point of use: a
 * shared instance with the `g` flag carries `lastIndex` between calls.
 */
export const SKILL_INVOCATION_TOKEN_SOURCE = String.raw`(?:^|(?<=\s))\/([A-Za-z0-9._-]+)(?=\s|$)`;
