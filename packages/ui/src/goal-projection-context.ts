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

import { createContext, useContext } from 'react';

interface SessionContextGoalBase {
  condition: string;
  iterations: number;
  maxIterations: number;
  /** Epoch ms when the goal was armed; the chip derives wall-clock elapsed. */
  setAt: number;
  tokensSpent?: number;
  /** When present (a budget exists), the chip shows spent / budget. */
  tokenBudget?: number;
  onClear(): void;
}

/**
 * An autonomous goal running in a session, as the transcript chip needs it.
 * Moved here from the deleted `session-context-layer.tsx` in the enterprise
 * renderer rewrite (Phase 0a): the shape is a product model, only its renderer
 * was Astryx.
 */
export type SessionContextGoal =
  | (SessionContextGoalBase & {
      status: 'active' | 'waiting';
      pausedAt?: never;
      /** Present when the goal can be paused (active/waiting). */
      onPause?(): void;
      onResume?: never;
    })
  | (SessionContextGoalBase & {
      status: 'paused';
      /** Epoch ms when the goal was paused; freezes the chip clock while paused. */
      pausedAt: number;
      onPause?: never;
      /** Present when the goal is paused and can be resumed. */
      onResume?(): void;
    });

/** The required transport shape for the optional Goal props on the composer. */
export interface ComposerGoalProjection {
  readonly goalActive: boolean;
  readonly onSetGoal: (() => void | Promise<void>) | undefined;
}

/** The required transport shape for the optional Goal indicator on the chat view. */
export interface ChatViewGoalProjection {
  readonly goalIndicator: SessionContextGoal | undefined;
}

const inactiveComposerGoalProjection: ComposerGoalProjection = {
  goalActive: false,
  onSetGoal: undefined,
};
const inactiveChatViewGoalProjection: ChatViewGoalProjection = {
  goalIndicator: undefined,
};

const ComposerGoalProjectionContext = createContext<ComposerGoalProjection>(
  inactiveComposerGoalProjection,
);
const ChatViewGoalProjectionContext = createContext<ChatViewGoalProjection>(
  inactiveChatViewGoalProjection,
);

export const ComposerGoalProjectionProvider = ComposerGoalProjectionContext.Provider;
export const ChatViewGoalProjectionProvider = ChatViewGoalProjectionContext.Provider;
export const ComposerGoalProjectionConsumer = ComposerGoalProjectionContext.Consumer;
export const ChatViewGoalProjectionConsumer = ChatViewGoalProjectionContext.Consumer;

/** Defaults to an inactive projection for Composer hosts outside Desktop. */
export function useComposerGoalProjection(): ComposerGoalProjection {
  return useContext(ComposerGoalProjectionContext);
}

/** Defaults to no indicator for ChatView hosts outside Desktop. */
export function useChatViewGoalProjection(): ChatViewGoalProjection {
  return useContext(ChatViewGoalProjectionContext);
}
