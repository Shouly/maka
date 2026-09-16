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

import type { SessionTask, SessionTaskDocument } from '@maka/core/session-task';
import {
  authenticateInteractiveSessionTaskWriter,
  type InteractiveSessionTaskWriter,
} from '@maka/storage/session-task-authority';
import type { OperationOutcome, SessionTaskQueryResult } from '../protocol/index.js';
import type { SessionTaskOperationHandlerMap } from './operation-dispatcher.js';
import { SessionAdmissionGate } from './session-admission-gate.js';
import type { SessionPresenceReader } from './session-presence.js';

export interface SessionTaskPort {
  read(sessionId: string): Promise<SessionTaskDocument>;
  list(sessionId: string): Promise<SessionTaskDocument>;
  create(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; task: SessionTask }>;
  update(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; changed: readonly string[]; deleted: boolean }>;
}

/** Host-owned admission and publication boundary for the SessionTask document. */
export class HostSessionTaskCoordinator implements SessionTaskPort {
  readonly handlers: SessionTaskOperationHandlerMap = {
    'session.task.query': (input) => this.#query(input.sessionId),
  };

  readonly #writer: InteractiveSessionTaskWriter;

  constructor(
    writer: InteractiveSessionTaskWriter,
    private readonly sessionAdmission: SessionAdmissionGate,
    private readonly sessions: SessionPresenceReader,
    private readonly onChanged: (sessionId: string) => void,
    private readonly requestDrain: () => void,
  ) {
    this.#writer = authenticateInteractiveSessionTaskWriter(writer);
  }

  read(sessionId: string): Promise<SessionTaskDocument> {
    return this.sessionAdmission.run(sessionId, async () => {
      await this.#requirePresent(sessionId);
      return this.#writer.readOrBootstrap(sessionId);
    });
  }

  /** The tool surface reads the whole document; TaskList and TaskGet share it. */
  list(sessionId: string): Promise<SessionTaskDocument> {
    return this.read(sessionId);
  }

  create(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; task: SessionTask }> {
    return this.#mutate(sessionId, () => this.#writer.createTask(sessionId, input));
  }

  update(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; changed: readonly string[]; deleted: boolean }> {
    return this.#mutate(sessionId, () => this.#writer.updateTask(sessionId, input));
  }

  #mutate<T extends { document: SessionTaskDocument }>(
    sessionId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    return this.sessionAdmission.run(sessionId, async () => {
      await this.#requirePresent(sessionId);
      const outcome = await write();
      try {
        this.onChanged(sessionId);
      } catch {
        // The document is already committed. A projection failure drains the
        // Host but must never turn a successful write into an ambiguous retry
        // that could overwrite a later writer.
        this.requestDrain();
      }
      return outcome;
    });
  }

  async #query(sessionId: string): Promise<OperationOutcome<'session.task.query'>> {
    try {
      const snapshot = await this.read(sessionId);
      const result: SessionTaskQueryResult = {
        sessionId,
        nextId: snapshot.nextId,
        items: snapshot.items,
      };
      return { ok: true, result };
    } catch (error) {
      if ((await this.sessions.probeSessionRemoval(sessionId)).kind !== 'present') {
        return { ok: false, error: { code: 'not_found', message: 'Session was not found' } };
      }
      throw error;
    }
  }

  async #requirePresent(sessionId: string): Promise<void> {
    if ((await this.sessions.probeSessionRemoval(sessionId)).kind !== 'present') {
      throw new Error(`Session was not found: ${sessionId}`);
    }
  }
}
