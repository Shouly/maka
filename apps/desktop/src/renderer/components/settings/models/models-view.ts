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

// Which of the three faces of Settings › Models is on screen.
//
// A union rather than a set of booleans: "detail" carries the connection it is
// about, and a boolean pair would admit the state where two faces are open and
// neither has a subject. There is no URL behind any of this — the main process
// blocks navigation — so the page owns it as component state and nothing
// outside the page can observe it. Every face's way back is the list.

export type ModelsView =
  | { readonly kind: 'list' }
  /** Keyed by the immutable connection id, never by slug: a rename must not close the page. */
  | { readonly kind: 'detail'; readonly connectionId: string }
  | { readonly kind: 'catalog' };
