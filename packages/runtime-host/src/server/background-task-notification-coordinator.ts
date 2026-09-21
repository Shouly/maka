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

// A background task finished and its session is idle: nobody is at a step
// boundary to hear about it, so the Host opens a turn whose user message is
// the notification. A busy session is left alone — its running turn announces
// the task itself — and looked at again once it goes idle, in case the turn
// ended before it could.

import { randomUUID } from 'node:crypto';
import type { TaskNotificationLease } from '@maka/core/backend-types';
import type { ShellRunRecord } from '@maka/core/shell-run';
import { renderNotificationWake, renderTaskNotification } from '@maka/runtime/injection';
import type { ChildAgentFinishedRecord, SessionManager } from '@maka/runtime/session-manager';
import type { ShellRunProcessManager } from '@maka/runtime/shell-run-manager';
import type { HostedExecutionAuthority } from './hosted-execution-authority.js';

type NotificationExecutions = Pick<HostedExecutionAuthority, 'prepare'>;
type NotificationRuntime = Pick<SessionManager, 'sendMessage'>;
type NotificationShellRuns = Pick<
  ShellRunProcessManager,
  'pendingTaskNotifications' | 'markTaskNotified'
>;
type NotificationChildAgents = Pick<
  SessionManager,
  'pendingChildAgentNotificationLeases' | 'markChildAgentNotifiedByRef'
>;

export interface HostBackgroundTaskNotificationCoordinatorOptions {
  readonly executions: NotificationExecutions;
  readonly runtime: NotificationRuntime;
  readonly shellRuns: NotificationShellRuns;
  /** Child agents of a Session; omitted in compositions without child agents. */
  readonly childAgents?: NotificationChildAgents;
  readonly newId?: () => string;
  /** A delivery attempt failed; what is owed stays owed in the store. */
  readonly onError?: (sessionId: string, error: unknown) => void;
}

export class HostBackgroundTaskNotificationCoordinator {
  readonly #executions: NotificationExecutions;
  readonly #runtime: NotificationRuntime;
  readonly #shellRuns: NotificationShellRuns;
  readonly #childAgents: NotificationChildAgents | undefined;
  readonly #newId: () => string;
  readonly #onError: HostBackgroundTaskNotificationCoordinatorOptions['onError'];
  readonly #flushing = new Map<string, Promise<void>>();
  readonly #again = new Set<string>();
  #draining = false;

  constructor(options: HostBackgroundTaskNotificationCoordinatorOptions) {
    this.#executions = options.executions;
    this.#runtime = options.runtime;
    this.#shellRuns = options.shellRuns;
    this.#childAgents = options.childAgents;
    this.#newId = options.newId ?? randomUUID;
    this.#onError = options.onError;
  }

  /** The manager's word that a task of this session ended with a notification owed. */
  taskFinished(record: ShellRunRecord): void {
    if (this.#draining) return;
    this.#schedule(record.sessionId);
  }

  /** The same, for a child agent that stopped. */
  childAgentFinished(record: ChildAgentFinishedRecord): void {
    if (this.#draining) return;
    this.#schedule(record.parentSessionId);
  }

  /** Delivery in flight for the session, if any — tests join it. */
  settled(sessionId: string): Promise<void> {
    return this.#flushing.get(sessionId) ?? Promise.resolve();
  }

  beginDrain(): void {
    this.#draining = true;
  }

  #schedule(sessionId: string): void {
    if (this.#flushing.has(sessionId)) {
      this.#again.add(sessionId);
      return;
    }
    const run = this.#flush(sessionId)
      .catch((error) => {
        this.#onError?.(sessionId, error);
      })
      .then(() => {
        this.#flushing.delete(sessionId);
        if (this.#again.delete(sessionId)) this.#schedule(sessionId);
      });
    this.#flushing.set(sessionId, run);
  }

  /** Everything this Session owes the model, whatever kind of task produced it. */
  async #pending(sessionId: string): Promise<TaskNotificationLease[]> {
    const runs = await this.#shellRuns.pendingTaskNotifications(sessionId);
    const agents = this.#childAgents
      ? await this.#childAgents.pendingChildAgentNotificationLeases(sessionId)
      : [];
    return [
      ...runs.map((record) => ({
        id: record.shellRunId,
        kind: 'command' as const,
        toolUseId: record.sourceToolCallId,
        text: renderTaskNotification(record),
      })),
      ...agents,
    ];
  }

  /** The model has been told about this one; it will not be announced again. */
  async #settle(sessionId: string, lease: TaskNotificationLease): Promise<void> {
    if (lease.kind === 'command') {
      await this.#shellRuns.markTaskNotified(sessionId, lease.id);
      return;
    }
    await this.#childAgents?.markChildAgentNotifiedByRef(lease.id);
  }

  async #flush(sessionId: string): Promise<void> {
    while (!this.#draining) {
      const pending = await this.#pending(sessionId);
      if (pending.length === 0) return;
      const preparation = this.#executions.prepare(sessionId);
      if (preparation.kind === 'unavailable') return;
      if (preparation.kind === 'busy') {
        // The running turn drains what is owed at its next boundary; when it
        // ends, whatever it did not reach is still in the store. How that
        // turn ended is not this loop's business, and a turn that failed is
        // exactly the one whose boundary drain never got to announce
        // anything, so its rejection must not carry the notification away
        // with it.
        await preparation.whenIdle.catch(() => undefined);
        continue;
      }
      await this.#wake(sessionId, pending, preparation.admission);
      return;
    }
  }

  async #wake(
    sessionId: string,
    pending: readonly TaskNotificationLease[],
    prepared: Extract<
      ReturnType<NotificationExecutions['prepare']>,
      { kind: 'prepared' }
    >['admission'],
  ): Promise<void> {
    const first = pending[0]!;
    const origin = {
      kind: 'background_task' as const,
      ref: first.id,
      toolUseId: first.toolUseId,
    };
    const execution = { sessionId, turnId: this.#newId(), runId: this.#newId() };
    const userMessageId = this.#newId();
    const text = renderNotificationWake(pending.map((lease) => lease.text));
    try {
      const initial = await prepared.admit({
        ...execution,
        userMessageId,
        execution: origin,
        content: { text },
        admitExecution: async () => (this.#draining ? 'cancelled' : 'executing'),
        start: ({ runId, userMessageId: admittedMessageId, onRunStarted }) => {
          if (runId !== execution.runId || admittedMessageId !== userMessageId) {
            throw new Error('Hosted Execution changed the task notification identity');
          }
          const settle = (session: string, lease: TaskNotificationLease) =>
            this.#settle(session, lease);
          const runtime = this.#runtime;
          return runtime.sendMessage(
            sessionId,
            { turnId: execution.turnId, text, origin },
            {
              runId,
              userMessageId,
              durability: 'required',
              onRunStarted: async (startedRunId) => {
                if (startedRunId !== runId) {
                  throw new Error('Runtime changed the task notification Run identity');
                }
                // Settled here and not before: the Run has started, so the
                // message carrying these notifications is in the ledger. A
                // send that failed earlier would have settled them against a
                // conversation that never received them — owed for ever, with
                // the ledger saying they had been delivered. This still runs
                // before the woken turn reaches its own first boundary, so it
                // cannot announce them a second time.
                for (const lease of pending) {
                  await settle(sessionId, lease);
                }
                await onRunStarted();
              },
            },
          );
        },
      });
      await initial.settled;
    } catch (error) {
      prepared.release();
      throw error;
    }
  }
}
