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

import { JsonArrayPageBudget } from './json-array-page-budget.js';

import { randomUUID } from 'node:crypto';
import { messageContentsEqual } from '@maka/core/events';
import { authorizeConnectionModel } from '@maka/core/llm-connections';
import type { ConnectionCatalogEntry } from '@maka/core/runtime-policy';
import {
  type CreateScheduledTaskInput,
  type ScheduledTask,
  type ScheduledTaskExecutionTemplate,
} from '@maka/core/scheduled-task';
import type { SessionHeader } from '@maka/core/session';
import {
  buildAgentScheduledTaskCreatePayload,
  type ScheduledTaskToolSchedule,
  buildScheduledTaskTools,
  type ScheduledTaskToolAuthority,
} from '@maka/runtime/scheduled-task-tools';
import { type MakaTool } from '@maka/runtime/tool-runtime';
import { stableHash } from '@maka/runtime/request-shape';
import { type SessionManager } from '@maka/runtime/session-manager';
import {
  authenticateInteractiveScheduledTaskStoreWriter,
  type InteractiveScheduledTaskStoreWriter,
  type ScheduledTaskFireClaim,
  type ScheduledTaskFireExecution,
  ScheduledTaskStoreError,
} from '@maka/storage/scheduled-task-store';
import {
  isSessionNotFoundError,
  type ExecutionSessionWriter,
  type RootTurnAdmission,
} from '@maka/storage/execution-stores';
import type { RuntimePolicyStoresWriter } from '@maka/storage/runtime-policy-stores';
import {
  SCHEDULED_TASK_CATALOG_MAX_ITEMS,
  SCHEDULED_TASK_PAGE_MAX_ITEMS,
  SCHEDULED_TASK_RESULT_MAX_BYTES,
  type OperationOutcome,
  type ScheduledTaskChangedReason,
  type ScheduledTaskMutateInput,
  type ScheduledTaskQueryInput,
} from '../protocol/index.js';
import type { ScheduledTaskOperationHandlerMap } from './operation-dispatcher.js';
import type { RuntimeHostResidency } from './host-kernel.js';
import type { HostResidencyKind } from './host-residency-registry.js';
import type { HostedExecutionAuthority } from './hosted-execution-authority.js';
import type { SessionCreateInput } from '../protocol/session-catalog.js';
import { DEFAULT_TOOL_MODE, type ToolMode } from '@maka/core/tool-mode';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const SCHEDULED_AGENT_RUN_IDENTITY_REQUIRED =
  'ScheduledTask Agent runs require an immutable model connection identity';

type ScheduledTaskSessions = Pick<ExecutionSessionWriter, 'readHeaderSnapshot'>;
type ScheduledTaskRuntime = Pick<SessionManager, 'sendMessage'>;
type ScheduledTaskRoot = Pick<HostedExecutionAuthority, 'admit'>;
type HostScheduledTaskChangeServiceLike = HostScheduledTaskCoordinatorInput['changes'];

export interface HostScheduledTaskCoordinatorInput {
  readonly store: InteractiveScheduledTaskStoreWriter;
  readonly sessions: ScheduledTaskSessions;
  readonly runtime: ScheduledTaskRuntime;
  readonly root: ScheduledTaskRoot;
  readonly runtimePolicy: RuntimePolicyStoresWriter;
  readonly createSession: (input: SessionCreateInput, toolMode: ToolMode) => Promise<void>;
  readonly changes: {
    publish(revision: number, reason: ScheduledTaskChangedReason, taskId: string): void;
  };
  readonly acquireResidency: (kind?: HostResidencyKind) => RuntimeHostResidency;
  readonly requestDrain: () => void;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (timer: unknown) => void;
}

export class HostScheduledTaskSessionBusyError extends Error {
  readonly name = 'HostScheduledTaskSessionBusyError';
}

/** Stable Agent ScheduledTask target identity used by root-admission retries. */
export function scheduledTaskExecutionFingerprint(
  execution: ScheduledTaskExecutionTemplate,
): `sha256:${string}` | undefined {
  // A task that follows the owner's default model has no stable target to
  // fingerprint — the model it runs on is decided at each fire, so a retry is
  // allowed to land on a different one.
  if (execution.model.kind !== 'pinned') return undefined;
  return stableHash([
    'scheduled-task-agent-run.v1',
    execution.model.llmConnectionId,
    execution.model.llmConnectionSlug,
    execution.model.model,
  ]);
}

export interface HostScheduledTaskSessionRetirement {
  commit(): void;
  rollback(): void;
}

/** Host-owned ScheduledTask catalog, scheduler, fire admission, and tool authority. */
export class HostScheduledTaskCoordinator implements ScheduledTaskToolAuthority {
  readonly handlers: ScheduledTaskOperationHandlerMap = {
    'scheduled-task.query': (input) => this.#query(input),
    'scheduled-task.mutate': (input) => this.#mutate(input),
  };

  readonly modelTools: readonly MakaTool[];
  readonly #store: InteractiveScheduledTaskStoreWriter;
  readonly #sessions: ScheduledTaskSessions;
  readonly #runtime: ScheduledTaskRuntime;
  readonly #root: ScheduledTaskRoot;
  readonly #runtimePolicy: RuntimePolicyStoresWriter;
  readonly #createSession: HostScheduledTaskCoordinatorInput['createSession'];
  readonly #changes: HostScheduledTaskChangeServiceLike;
  readonly #acquireResidency: HostScheduledTaskCoordinatorInput['acquireResidency'];
  readonly #requestDrain: () => void;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimeout: (timer: unknown) => void;

  #lane: Promise<void> = Promise.resolve();
  #revision = 0;
  #timer: unknown;
  #residency: RuntimeHostResidency | undefined;
  #prepared = false;
  #started = false;
  #draining = false;
  #handoffHeld = false;
  #closed = false;
  readonly #retiringSessions = new Set<string>();

  constructor(input: HostScheduledTaskCoordinatorInput) {
    this.#store = authenticateInteractiveScheduledTaskStoreWriter(input.store);
    this.#sessions = input.sessions;
    this.#runtime = input.runtime;
    this.#root = input.root;
    this.#runtimePolicy = input.runtimePolicy;
    this.#createSession = input.createSession;
    this.#changes = input.changes;
    this.#acquireResidency = input.acquireResidency;
    this.#requestDrain = input.requestDrain;
    this.#now = input.now ?? Date.now;
    this.#newId = input.newId ?? randomUUID;
    this.#setTimeout = input.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimeout = input.clearTimeout ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
    this.modelTools = buildScheduledTaskTools({ authority: this, now: () => this.#now() });
  }

  async prepareRecovery(): Promise<void> {
    if (this.#prepared) return;
    await this.#store.ready();
    this.#prepared = true;
    await this.#refreshResidency();
  }

  async assertRecoveryAdmission(
    admission: RootTurnAdmission,
    state: 'pending_fire_required' | 'run_recorded',
  ): Promise<void> {
    if (!this.#prepared) {
      throw new Error('ScheduledTask recovery admission was inspected before Store recovery');
    }
    if (admission.execution.kind !== 'scheduled_task') return;
    const scheduledTaskId = admission.execution.scheduledTaskId;
    const claims = await this.#store.listPendingFires();
    const claim = claims.find(
      (candidate) =>
        candidate.task.id === scheduledTaskId &&
        candidate.execution?.sessionId === admission.sessionId &&
        candidate.execution.turnId === admission.turnId,
    );
    const execution = claim?.execution;
    const fingerprintMatches =
      claim?.task.effect.kind !== 'agent_run' ||
      admission.execution.executionFingerprint ===
        scheduledTaskExecutionFingerprint(claim.task.effect.execution);
    if (!claim && state === 'run_recorded') return;
    if (
      !claim ||
      !execution ||
      execution.sessionId !== admission.sessionId ||
      execution.turnId !== admission.turnId ||
      execution.runId !== admission.runId ||
      execution.userMessageId !== admission.userMessageId ||
      !fingerprintMatches ||
      admission.normalizedInput === null ||
      !messageContentsEqual({ text: claim.task.intent.body }, admission.normalizedInput)
    ) {
      throw new Error(`ScheduledTask admission ${admission.turnId} has no matching pending fire`);
    }
  }

  async recover(): Promise<void> {
    if (!this.#prepared) throw new Error('ScheduledTask recovery was not prepared');
    for (const claim of await this.#store.listPendingFires()) {
      if (this.#draining) return;
      if (!claim.execution) {
        await this.#settleFailure(
          claim,
          'The previous fire stopped before a durable Agent execution was admitted.',
        );
        continue;
      }
      await this.#fulfill(claim);
    }
  }

  start(): void {
    if (!this.#prepared) throw new Error('ScheduledTask scheduler started before recovery');
    if (this.#draining || this.#started) return;
    this.#started = true;
    void this.#refresh().catch((error: unknown) => this.#fatal(error));
  }

  holdForHandoff():
    | {
        settled(): Promise<void>;
        residencies(): readonly RuntimeHostResidency[];
        release(): void;
      }
    | undefined {
    if (this.#draining || this.#handoffHeld) return undefined;
    this.#handoffHeld = true;
    this.#stopTimer();
    let released = false;
    return {
      settled: async () => {
        // An admitted native effect or Agent fire finishes normally. No new
        // fire may start while the handoff waits for this lane.
        for (;;) {
          const lane = this.#lane;
          await lane;
          if (lane === this.#lane) return;
        }
      },
      residencies: () => (this.#residency ? [this.#residency] : []),
      release: () => {
        if (released) return;
        released = true;
        this.#handoffHeld = false;
        if (!this.#draining) void this.#refresh().catch((error: unknown) => this.#fatal(error));
      },
    };
  }

  beginDrain(): void {
    if (this.#draining) return;
    this.#draining = true;
    this.#stopTimer();
    this.#releaseResidency();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.beginDrain();
    await this.#lane;
    this.#closed = true;
  }

  async create(input: {
    title: string;
    intentBody: string;
    schedule: ScheduledTaskToolSchedule;
    effect: 'session_resume' | 'agent_run';
    sessionId: string;
    maxFires?: number;
    permissionMode?: 'ask';
  }): Promise<ScheduledTask | { error: string }> {
    let execution: ScheduledTaskExecutionTemplate | undefined;
    try {
      const header = await this.#readResumableSession(input.sessionId);
      if (input.effect === 'agent_run') {
        execution = executionTemplateFromHeader(header);
        // The one thing the tool may override on the frozen template: a task
        // the caller was told to make careful stops for approval even though
        // the conversation that built it does not.
        if (input.permissionMode)
          execution = { ...execution, permissionMode: input.permissionMode };
      }
    } catch (error) {
      if (isSessionNotFoundError(error)) return { error: 'Session was not found' };
      return { error: errorMessage(error) };
    }
    const payload = buildAgentScheduledTaskCreatePayload({
      ...input,
      ...(execution ? { execution } : {}),
      now: this.#now(),
    });
    if ('error' in payload) return payload;
    try {
      return await this.#commitCreate(payload);
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  /**
   * Fire once, outside the schedule (the tool's ScheduledTaskRun, and the
   * page's Run now).
   *
   * `text` rides along in memory only. It is deliberately not written onto the
   * claim: it belongs to this one run, and a claim replayed after a crash
   * should send the task's own instructions rather than context from a request
   * nobody remembers making.
   */
  async run(id: string, text?: string): Promise<ScheduledTask | { error: string }> {
    try {
      return await this.#fireNow(id, text);
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  /** One firing, outside the schedule. The tool and the page both land here. */
  async #fireNow(id: string, text?: string): Promise<ScheduledTask> {
    return this.#exclusive(async () => {
      const claim = await this.#store.claimNow(id, this.#now());
      await this.#refreshResidency();
      const task = await this.#fulfill(claim, text);
      if (!task) throw new Error('ScheduledTask fire did not settle');
      return task;
    });
  }

  list(): Promise<readonly ScheduledTask[]> {
    return this.#exclusive(() => this.#store.list());
  }

  beginSessionRetirement(
    sessionIds: readonly string[],
  ): Promise<HostScheduledTaskSessionRetirement> {
    const unique = [...new Set(sessionIds)];
    return this.#exclusive(async () => {
      const targets = new Set(unique);
      const [tasks, claims] = await Promise.all([
        this.#store.list(),
        this.#store.listPendingFires(),
      ]);
      const blocked =
        tasks.some(
          (task) => task.effect.kind === 'session_resume' && targets.has(task.effect.sessionId),
        ) || claims.some((claim) => targets.has(claim.execution?.sessionId ?? ''));
      if (blocked) {
        throw new HostScheduledTaskSessionBusyError(
          'Session retirement requires session-bound ScheduledTasks to be removed first',
        );
      }
      for (const sessionId of unique) this.#retiringSessions.add(sessionId);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        for (const sessionId of unique) this.#retiringSessions.delete(sessionId);
      };
      return Object.freeze({ commit: finish, rollback: finish });
    });
  }

  async pause(id: string): Promise<ScheduledTask | { error: string }> {
    return this.#toolMutation(() =>
      this.#commitTask('updated', async () => {
        await this.#store.cancelWaitingNativeFire(id);
        return this.#store.pause(id);
      }),
    );
  }

  async resume(id: string): Promise<ScheduledTask | { error: string }> {
    return this.#toolMutation(() => this.#commitTask('updated', () => this.#store.resume(id)));
  }

  /**
   * Change a task in place, keeping its identity and its run history.
   *
   * The alternative the tool surface used to force — delete and recreate — is
   * destructive in three ways at once: the runs are gone, the id the person
   * may be holding stops resolving, and the delete has no confirmation. A
   * schedule change cancels a fire already waiting on the native scheduler,
   * because the store is about to compute a new one.
   */
  async update(
    id: string,
    patch: {
      title?: string;
      intentBody?: string;
      schedule?: ScheduledTaskToolSchedule;
      maxFires?: number | null;
    },
  ): Promise<ScheduledTask | { error: string }> {
    // A cron schedule the tool sends carries no `startAt`; the store needs one,
    // and "from now" is what a caller who just changed the cadence means.
    const schedule =
      patch.schedule?.kind === 'cron'
        ? { kind: 'cron' as const, expression: patch.schedule.expression, startAt: this.#now() }
        : patch.schedule;
    return this.#toolMutation(() =>
      this.#commitTask('updated', async () => {
        if (patch.schedule !== undefined) await this.#store.cancelWaitingNativeFire(id);
        return this.#store.update(id, { ...patch, ...(schedule ? { schedule } : {}) });
      }),
    );
  }

  async remove(id: string): Promise<{ ok: true } | { error: string }> {
    try {
      await this.#exclusive(async () => {
        await this.#store.cancelWaitingNativeFire(id);
        await this.#store.remove(id);
        this.#publish('deleted', id);
        await this.#refreshSchedule();
      });
      return { ok: true };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  async #query(input: ScheduledTaskQueryInput): Promise<OperationOutcome<'scheduled-task.query'>> {
    if (!this.#prepared) return queryFailure('host_not_ready', 'ScheduledTask is not ready');
    if (this.#draining) return queryFailure('host_draining', 'Runtime Host is draining');
    try {
      return await this.#exclusive(async () => {
        if (input.kind === 'get') {
          return {
            ok: true,
            result: { kind: 'task', task: (await this.#store.get(input.taskId)) ?? null },
          } as const;
        }
        const tasks = await this.#store.list();
        if (input.expectedRevision !== undefined && input.expectedRevision !== this.#revision) {
          return {
            ok: true,
            result: {
              kind: 'revision_changed',
              expected: input.expectedRevision,
              actual: this.#revision,
            },
          } as const;
        }
        const offset = input.cursor === undefined ? 0 : Number(input.cursor);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > tasks.length ||
          (input.cursor !== undefined && offset === tasks.length)
        ) {
          return queryFailure('invalid_request', 'ScheduledTask cursor is invalid');
        }
        return {
          ok: true,
          result: createScheduledTaskPage(tasks, this.#revision, offset),
        } as const;
      });
    } catch {
      return queryFailure('persistence_failed', 'ScheduledTask catalog is unavailable');
    }
  }

  async #mutate(
    input: ScheduledTaskMutateInput,
  ): Promise<OperationOutcome<'scheduled-task.mutate'>> {
    if (!this.#prepared) return mutateFailure('host_not_ready', 'ScheduledTask is not ready');
    if (this.#draining) return mutateFailure('host_draining', 'Runtime Host is draining');
    try {
      if (input.kind === 'create') {
        return taskSuccess(
          await this.#commitCreate({ ...input.input, createdBy: { kind: 'user' } }),
        );
      }
      if (input.kind === 'delete') {
        await this.#exclusive(async () => {
          await this.#store.cancelWaitingNativeFire(input.taskId);
          await this.#store.remove(input.taskId);
          this.#publish('deleted', input.taskId);
          await this.#refreshSchedule();
        });
        return { ok: true, result: { kind: 'deleted', taskId: input.taskId } };
      }
      if (input.kind === 'trigger_now') {
        return taskSuccess(await this.#fireNow(input.taskId));
      }
      const task = await this.#commitTask('updated', () => {
        if (input.kind === 'update') {
          return this.#cancelWaitingNativeFireThen(input.taskId, () =>
            this.#store.update(input.taskId, input.patch, this.#now()),
          );
        }
        if (input.kind === 'pause') {
          return this.#cancelWaitingNativeFireThen(input.taskId, () =>
            this.#store.pause(input.taskId, this.#now()),
          );
        }
        if (input.kind === 'resume') return this.#store.resume(input.taskId, this.#now());
        if (input.kind === 'snooze') {
          return this.#cancelWaitingNativeFireThen(input.taskId, () =>
            this.#store.snooze(input.taskId, input.delayMs, this.#now()),
          );
        }
        return this.#store.clearRunHistory(input.taskId, this.#now());
      });
      return taskSuccess(task);
    } catch (error) {
      if (error instanceof ScheduledTaskStoreError) {
        return mutateFailure(
          error.code === 'not_found'
            ? 'not_found'
            : error.code === 'invalid_input'
              ? 'invalid_request'
              : 'operation_conflict',
          error.message,
        );
      }
      if (error instanceof ScheduledTaskMutationError) {
        return mutateFailure(error.code, error.message);
      }
      this.#requestDrain();
      return mutateFailure('persistence_failed', 'ScheduledTask mutation failed');
    }
  }

  async #commitCreate(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    return this.#exclusive(async () => {
      const incognito = (await this.#runtimePolicy.runtimePolicy.getSnapshot()).policy.privacy
        .incognitoActive;
      if (incognito) {
        throw new ScheduledTaskMutationError(
          'operation_conflict',
          'SCHEDULED_TASK_INCOGNITO_ACTIVE',
        );
      }
      if ((await this.#store.list()).length >= SCHEDULED_TASK_CATALOG_MAX_ITEMS) {
        throw new ScheduledTaskMutationError(
          'operation_conflict',
          'ScheduledTask catalog limit reached',
        );
      }
      const task = await this.#store.create(input, this.#now());
      this.#publish('created', task.id);
      await this.#refreshSchedule();
      return task;
    });
  }

  #commitTask(
    reason: ScheduledTaskChangedReason,
    mutate: () => Promise<ScheduledTask>,
  ): Promise<ScheduledTask> {
    return this.#exclusive(async () => {
      const task = await mutate();
      this.#publish(reason, task.id);
      await this.#refreshSchedule();
      return task;
    });
  }

  async #cancelWaitingNativeFireThen<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    await this.#store.cancelWaitingNativeFire(taskId);
    return operation();
  }

  async #toolMutation(
    operation: () => Promise<ScheduledTask>,
  ): Promise<ScheduledTask | { error: string }> {
    try {
      return await operation();
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  async #refresh(): Promise<void> {
    if (this.#handoffHeld || this.#draining) return;
    // Cover claim admission, native delivery, and persistence, while an idle
    // schedule or a read-only catalog query does not claim active work.
    const residency = this.#acquireResidency();
    try {
      await this.#exclusive(async () => {
        if (this.#handoffHeld || this.#draining) return;
        while (!this.#draining && !this.#handoffHeld) {
          const scan = await this.#store.claimNextDue(this.#now());
          for (const expired of scan.expired) this.#publish('updated', expired.id);
          const claim = scan.claim;
          if (!claim) break;
          await this.#refreshResidency();
          await this.#fulfill(claim);
        }
        await this.#refreshSchedule();
      });
    } finally {
      residency.release();
    }
  }

  async #fulfill(
    claim: ScheduledTaskFireClaim,
    extraText?: string,
  ): Promise<ScheduledTask | undefined> {
    const incognito = (await this.#runtimePolicy.runtimePolicy.getSnapshot()).policy.privacy
      .incognitoActive;
    if (incognito) {
      return this.#settle(claim, 'blocked', '隐私模式已开启，定时任务没有触发。', 'blocked');
    }
    const task = claim.task;

    let execution = claim.execution;
    if (!execution) {
      execution = {
        sessionId: task.effect.kind === 'session_resume' ? task.effect.sessionId : this.#newId(),
        turnId: this.#newId(),
        runId: this.#newId(),
        userMessageId: this.#newId(),
      };
      claim = await this.#store.bindFireExecution(claim.id, execution);
    }
    try {
      await this.#ensureAgentSession(task, execution);
      await this.#admitAgentRun(task, execution, extraText);
      return this.#settle(
        claim,
        'ok',
        task.effect.kind === 'session_resume'
          ? '已在原任务中继续执行。'
          : '已启动 Agent 任务执行。',
        'fired',
        execution,
      );
    } catch (error) {
      return this.#settleFailure(claim, errorMessage(error));
    }
  }

  async #ensureAgentSession(
    task: ScheduledTask,
    identity: ScheduledTaskFireExecution,
  ): Promise<void> {
    if (task.effect.kind === 'session_resume') {
      if (identity.sessionId !== task.effect.sessionId) {
        throw new Error('ScheduledTask Session identity changed');
      }
      await this.#readResumableSession(identity.sessionId);
      return;
    }
    const execution = task.effect.execution;
    const pinned = execution.model.kind === 'pinned' ? execution.model : null;
    const connection = pinned ? await this.#resolveAgentRunConnection(execution) : null;
    try {
      const existing = await this.#sessions.readHeaderSnapshot(identity.sessionId);
      // Only a PINNED task can find its Session drifted: a task that follows
      // the owner's default asked for whatever the default was when the
      // Session was made, so whatever it says now is what it asked for.
      if (
        pinned &&
        (existing.llmConnectionId !== pinned.llmConnectionId ||
          existing.llmConnectionSlug !== pinned.llmConnectionSlug ||
          existing.model !== pinned.model)
      ) {
        throw new Error('ScheduledTask Session model identity changed');
      }
      return;
    } catch (error) {
      if (!isSessionNotFoundError(error) && !isMissingRecord(error)) throw error;
    }
    await this.#createSession(
      {
        sessionId: identity.sessionId,
        workspace:
          execution.projectId != null && execution.projectId !== ''
            ? { kind: 'project', projectId: execution.projectId }
            : { kind: 'host_path', path: execution.cwd },
        name: task.title,
        labels: ['scheduled-task'],
        modelTarget:
          pinned && connection
            ? {
                kind: 'explicit',
                connectionId: connection.connectionId,
                connectionSlug: pinned.llmConnectionSlug,
                model: pinned.model,
              }
            : // The Session catalog resolves the owner's current default, which
              // is the whole point of this choice: change the default and every
              // task that follows it moves with it.
              { kind: 'default' },
        ...(execution.thinkingLevel === undefined
          ? {}
          : { thinkingLevel: execution.thinkingLevel }),
        permissionMode: execution.permissionMode,
        collaborationMode: execution.collaborationMode,
        orchestrationMode: execution.orchestrationMode,
      },
      execution.toolMode ?? DEFAULT_TOOL_MODE,
    );
  }

  async #resolveAgentRunConnection(
    execution: ScheduledTaskExecutionTemplate,
  ): Promise<ConnectionCatalogEntry> {
    if (execution.model.kind !== 'pinned') {
      throw new Error(SCHEDULED_AGENT_RUN_IDENTITY_REQUIRED);
    }
    const pinned = execution.model;
    // A persisted row is decoded, not re-validated, so a record whose id has
    // gone missing arrives here as a pinned choice with nothing to pin to. Fail
    // closed: the slug beside it is reusable, and resolving THAT would hand the
    // task to whichever Connection holds the slug now.
    if (!pinned.llmConnectionId) {
      throw new Error(SCHEDULED_AGENT_RUN_IDENTITY_REQUIRED);
    }
    const resolved = await this.#runtimePolicy.operations.resolveExecutionConnection({
      kind: 'bound',
      connectionId: pinned.llmConnectionId,
      connectionSlug: pinned.llmConnectionSlug,
    });
    if (resolved.kind !== 'ready') {
      throw new Error(
        resolved.kind === 'identity_mismatch' || resolved.kind === 'not_found'
          ? 'ScheduledTask model connection identity changed'
          : resolved.kind === 'disabled'
            ? 'ScheduledTask model connection is disabled'
            : resolved.kind === 'credential_not_configured'
              ? 'ScheduledTask model connection is not ready'
              : resolved.kind === 'provider_retired'
                ? 'ScheduledTask model connection uses a retired provider'
                : 'ScheduledTask model connection is unavailable',
      );
    }
    if (!authorizeConnectionModel(resolved.connection, pinned.model)) {
      throw new Error('ScheduledTask model is no longer enabled');
    }
    return resolved.connection;
  }

  async #admitAgentRun(
    task: ScheduledTask,
    identity: ScheduledTaskFireExecution,
    extraText?: string,
  ): Promise<void> {
    if (task.effect.kind === 'agent_run' && task.effect.execution.model.kind === 'pinned') {
      // Re-read the bound Connection immediately before admission. The
      // Session/Connection stores have independent write lanes, so this
      // second check closes the delete-and-recreate-same-slug window between
      // Session creation and AgentRun admission. A task that follows the
      // default has no bound Connection to re-check.
      await this.#resolveAgentRunConnection(task.effect.execution);
    }
    // The reference delivers run-specific context as a SECOND user turn after
    // the task's own instructions; one admission carries one message here, so
    // it is appended to the first instead. Same words in the same order, one
    // turn rather than two.
    const content = {
      text: extraText ? `${task.intent.body}\n\n${extraText}` : task.intent.body,
    };
    // A task that follows the owner's default model has no fingerprint, and the
    // key must then be ABSENT rather than present-and-undefined: the admission
    // record is compared to what the Store reads back, and the Store's codec
    // drops an undefined key. Spreading `{ executionFingerprint: undefined }`
    // here made every default-model fire fail its own identity check.
    const executionFingerprint =
      task.effect.kind === 'agent_run'
        ? scheduledTaskExecutionFingerprint(task.effect.execution)
        : undefined;
    await this.#root.admit({
      ...identity,
      execution: {
        kind: 'scheduled_task',
        scheduledTaskId: task.id,
        ...(executionFingerprint === undefined ? {} : { executionFingerprint }),
      },
      content,
      start: ({ runId, userMessageId, onRunStarted }) => {
        if (runId !== identity.runId || userMessageId !== identity.userMessageId) {
          throw new Error('Runtime Host changed the ScheduledTask execution identity');
        }
        return this.#runtime.sendMessage(
          identity.sessionId,
          {
            turnId: identity.turnId,
            ...content,
            origin: { kind: 'scheduled_task', scheduledTaskId: task.id },
          },
          {
            runId: identity.runId,
            userMessageId: identity.userMessageId,
            durability: 'required',
            onRunStarted: async (startedRunId) => {
              if (startedRunId !== identity.runId) {
                throw new Error('Runtime started a different ScheduledTask AgentRun identity');
              }
              await onRunStarted();
            },
          },
        );
      },
    });
  }

  async #readResumableSession(sessionId: string): Promise<SessionHeader> {
    if (this.#retiringSessions.has(sessionId)) {
      throw new Error('Session lifecycle is changing');
    }
    const header = await this.#sessions.readHeaderSnapshot(sessionId);
    if (header.isArchived) {
      throw new Error('Archived Sessions cannot own session-bound ScheduledTasks');
    }
    return header;
  }

  async #settleFailure(claim: ScheduledTaskFireClaim, message: string): Promise<ScheduledTask> {
    return this.#settle(claim, 'failed', message, 'failed', claim.execution);
  }

  async #settle(
    claim: ScheduledTaskFireClaim,
    outcome: 'ok' | 'failed' | 'blocked',
    message: string,
    reason: ScheduledTaskChangedReason,
    execution?: ScheduledTaskFireExecution,
  ): Promise<ScheduledTask> {
    const task = await this.#store.settleFire(claim.id, {
      at: this.#now(),
      outcome,
      message,
      ...(execution ? { sessionId: execution.sessionId, runId: execution.runId } : {}),
    });
    this.#publish(reason, task.id);
    await this.#refreshSchedule();
    return task;
  }

  async #refreshSchedule(): Promise<void> {
    this.#stopTimer();
    await this.#refreshResidency();
    if (!this.#started || this.#draining || this.#handoffHeld) return;
    const [tasks, claims] = await Promise.all([this.#store.list(), this.#store.listPendingFires()]);
    const next = tasks
      .filter((task) => task.status === 'active' && task.nextFireAt !== null)
      .reduce<number | null>((earliest, task) => {
        const deadline = Math.min(task.nextFireAt!, task.expiresAt ?? task.nextFireAt!);
        return earliest === null || deadline < earliest ? deadline : earliest;
      }, null);
    if (this.#draining || this.#handoffHeld) return;
    if (next === null) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, next - this.#now()));
    this.#timer = this.#setTimeout(() => {
      this.#timer = undefined;
      void this.#refresh().catch((error: unknown) => this.#fatal(error));
    }, delay);
  }

  async #refreshResidency(): Promise<void> {
    const [tasks, claims] = await Promise.all([this.#store.list(), this.#store.listPendingFires()]);
    const shouldHold =
      !this.#draining &&
      (claims.length > 0 ||
        tasks.some((task) => task.status === 'active' && task.nextFireAt !== null));
    if (shouldHold && !this.#residency) this.#residency = this.#acquireResidency('idle');
    if (!shouldHold) this.#releaseResidency();
  }

  #releaseResidency(): void {
    this.#residency?.release();
    this.#residency = undefined;
  }

  #publish(reason: ScheduledTaskChangedReason, taskId: string): void {
    this.#revision += 1;
    this.#changes.publish(this.#revision, reason, taskId);
  }

  #stopTimer(): void {
    if (this.#timer === undefined) return;
    this.#clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.#lane.then(operation, operation);
    this.#lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #fatal(_error: unknown): void {
    this.#requestDrain();
  }
}

class ScheduledTaskMutationError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'operation_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'ScheduledTaskMutationError';
  }
}

/**
 * The creating Session's own settings, frozen as the task's execution template.
 *
 * The model is PINNED to what the Session is running rather than left to follow
 * the owner's default: the model asked for this task while working on that
 * Session, so the Session's model is the one it meant. A user who wants the
 * task to track their default says so in the form.
 */
function executionTemplateFromHeader(header: SessionHeader): ScheduledTaskExecutionTemplate {
  if (!header.llmConnectionId) {
    throw new Error(SCHEDULED_AGENT_RUN_IDENTITY_REQUIRED);
  }
  return {
    cwd: header.cwd,
    ...(header.projectId === undefined ? {} : { projectId: header.projectId }),
    model: {
      kind: 'pinned',
      llmConnectionId: header.llmConnectionId,
      llmConnectionSlug: header.llmConnectionSlug,
      model: header.model,
    },
    ...(header.thinkingLevel === undefined ? {} : { thinkingLevel: header.thinkingLevel }),
    permissionMode: header.permissionMode,
    collaborationMode: header.collaborationMode ?? 'agent',
    orchestrationMode: header.orchestrationMode ?? 'default',
    toolMode: header.toolMode ?? DEFAULT_TOOL_MODE,
  };
}

function createScheduledTaskPage(
  tasks: readonly ScheduledTask[],
  revision: number,
  offset: number,
) {
  const page: ScheduledTask[] = [];
  const budget = new JsonArrayPageBudget(SCHEDULED_TASK_RESULT_MAX_BYTES, {
    kind: 'page',
    revision,
    tasks: [],
    nextCursor: null,
  });
  for (let index = offset; index < tasks.length; index += 1) {
    if (page.length >= SCHEDULED_TASK_PAGE_MAX_ITEMS) break;
    const task = tasks[index];
    if (!task) throw new Error('ScheduledTask page index is invalid');
    const nextOffset = offset + page.length + 1;
    if (!budget.tryAppend(task, nextOffset < tasks.length ? String(nextOffset) : null)) {
      break;
    }
    page.push(task);
  }
  if (page.length === 0 && offset < tasks.length) {
    throw new Error('A ScheduledTask exceeds the query byte limit');
  }
  const nextOffset = offset + page.length;
  return {
    kind: 'page' as const,
    revision,
    tasks: page,
    nextCursor: nextOffset < tasks.length ? String(nextOffset) : null,
  };
}

function taskSuccess(task: ScheduledTask): OperationOutcome<'scheduled-task.mutate'> {
  return { ok: true, result: { kind: 'task', task } };
}

function queryFailure(
  code: 'host_not_ready' | 'host_draining' | 'invalid_request' | 'persistence_failed',
  message: string,
): OperationOutcome<'scheduled-task.query'> {
  return { ok: false, error: { code, message } };
}

function mutateFailure(
  code:
    | 'host_not_ready'
    | 'host_draining'
    | 'invalid_request'
    | 'not_found'
    | 'operation_conflict'
    | 'persistence_failed',
  message: string,
): OperationOutcome<'scheduled-task.mutate'> {
  return { ok: false, error: { code, message } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingRecord(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
