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

import { AiSdkBackend } from '@maka/runtime/ai-sdk-backend';

import { type SessionManager } from '@maka/runtime/session-manager';

type ChildAgentAuthority = Pick<
  SessionManager,
  | 'spawnChildSession'
  | 'listChildAgents'
  | 'readChildAgentOutput'
  | 'sendChildAgentMessage'
  | 'stopChildAgent'
>;

export type HostChildAgentBackendCapabilities = Pick<
  ConstructorParameters<typeof AiSdkBackend>[0],
  | 'spawnChildSession'
  | 'listChildAgents'
  | 'readChildAgentOutput'
  | 'sendChildAgentMessage'
  | 'stopChildAgent'
>;

/** Binds one root backend to the child authority of its owning Session. */
export function bindHostChildAgentBackend(
  authority: ChildAgentAuthority,
  parentSessionId: string,
): HostChildAgentBackendCapabilities {
  return {
    spawnChildSession: (input) =>
      authority.spawnChildSession(parentSessionId, {
        spawnedBy: {
          parentRunId: input.parentRunId,
          parentTurnId: input.parentTurnId,
          toolCallId: input.toolCallId,
        },
        agentProfile: input.agentProfile,
        ...(input.subagentId ? { subagentId: input.subagentId } : {}),
        prompt: input.prompt,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.swarm ? { swarm: input.swarm } : {}),
        abortSignal: input.abortSignal,
        ...(input.onReady ? { onReady: input.onReady } : {}),
        ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      }),
    listChildAgents: () => authority.listChildAgents(parentSessionId),
    sendChildAgentMessage: (input) =>
      authority.sendChildAgentMessage({
        parentSessionId,
        childSessionId: input.childSessionId,
        text: input.text,
      }),
    stopChildAgent: (input) =>
      authority.stopChildAgent({ parentSessionId, childSessionId: input.childSessionId }),
    readChildAgentOutput: (input) => authority.readChildAgentOutput(parentSessionId, input),
  };
}
