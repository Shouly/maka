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

// Where the ask-user wizard stands, for the composer's benefit.
//
// The reference design keeps the composer under the question panel and reads
// a plain send as the free-text answer to the question the panel is showing
// (relx `answerWithText`: the typed text lands at `currentIndex`, the other
// selections are kept). The wizard owns its cursor and drafts as component
// state; this store is the one-way copy the composer reads at send time.

import { createStore } from 'zustand/vanilla';
import type { QuestionAnswerDraft } from '@maka/ui';

export interface UserQuestionPanelState {
  readonly requestId: string | undefined;
  readonly index: number;
  readonly drafts: readonly QuestionAnswerDraft[];
}

const initial: UserQuestionPanelState = { requestId: undefined, index: 0, drafts: [] };

const store = createStore<UserQuestionPanelState>(() => initial);

export const userQuestionPanelStore = {
  ...store,
  /** The wizard's current question and every answer so far. */
  publish(requestId: string, index: number, drafts: readonly QuestionAnswerDraft[]): void {
    store.setState({ requestId, index, drafts });
  },
  /** On unmount; a stale cursor must not answer the next request. */
  clear(requestId: string): void {
    if (store.getState().requestId === requestId) store.setState(initial);
  },
};
