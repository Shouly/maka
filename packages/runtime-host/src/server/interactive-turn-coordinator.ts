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

import { messageContentDigest, normalizeMessageContent } from '@maka/core/events';
import { type SessionManager } from '@maka/runtime/session-manager';
import type { OperationOutcome, TurnRegenerateInput, TurnStartInput } from '../protocol/index.js';
import type { ConnectionContext, TurnOperationHandlerMap } from './operation-dispatcher.js';
import type { RootTurnCoordinator, TurnStartOutcome } from './root-turn-coordinator.js';

type InteractiveTurnExecutionPort = Pick<RootTurnCoordinator, 'startInteractiveRootMessage'>;
type InteractiveTurnRuntime = Pick<SessionManager, 'prepareRegenerateTurn'>;

export interface HostInteractiveTurnCoordinatorOptions {
  readonly executions: InteractiveTurnExecutionPort;
  readonly runtime: InteractiveTurnRuntime;
}

/** Owns Interactive Turn start and regenerate wire semantics. */
export class HostInteractiveTurnCoordinator {
  readonly handlers: Pick<TurnOperationHandlerMap, 'turn.start' | 'turn.regenerate'> = {
    'turn.start': (input, context) => this.#start(input, context),
    'turn.regenerate': (input, context) => this.#regenerate(input, context),
  };

  readonly #executions: InteractiveTurnExecutionPort;
  readonly #runtime: InteractiveTurnRuntime;

  constructor(options: HostInteractiveTurnCoordinatorOptions) {
    this.#executions = options.executions;
    this.#runtime = options.runtime;
  }

  /**
   * A `/<name>` in the text is not resolved here: it reaches the model as
   * written, and the model loads the skill with the Skill tool. The Host does
   * mark it as a transcript chip, so the admitted content can differ from the
   * content sent; the digest of what was sent is what a retry must match.
   */
  async #start(input: TurnStartInput, context: ConnectionContext): Promise<TurnStartOutcome> {
    const content = normalizeMessageContent(input.content);
    const outcome = await this.#executions.startInteractiveRootMessage(
      {
        sessionId: input.sessionId,
        turnId: input.turnId,
        execution: {
          kind: 'external_message',
          inputDigest: messageContentDigest(content),
          ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
        },
        ...(input.turnOrchestration ? { turnOrchestration: { ...input.turnOrchestration } } : {}),
        archivedMessage: 'Cannot start a new Turn in an archived Session',
        content,
      },
      context,
    );
    return outcome.ok ? { ok: true, result: { kind: 'started', turn: outcome.result } } : outcome;
  }

  #regenerate(
    input: TurnRegenerateInput,
    context: ConnectionContext,
  ): Promise<OperationOutcome<'turn.regenerate'>> {
    if (input.sourceTurnId === input.turnId) {
      return Promise.resolve(
        operationConflict('Regenerate source and target Turn identities must differ'),
      );
    }
    return this.#executions.startInteractiveRootMessage(
      {
        sessionId: input.sessionId,
        turnId: input.turnId,
        execution: { kind: 'regenerate', sourceTurnId: input.sourceTurnId },
        archivedMessage: 'Cannot regenerate a Turn in an archived Session',
        prepareContent: async () =>
          (await this.#runtime.prepareRegenerateTurn(input.sessionId, input.sourceTurnId)).content,
      },
      context,
    );
  }
}

function operationConflict(message: string) {
  return { ok: false, error: { code: 'operation_conflict', message } } as const;
}
