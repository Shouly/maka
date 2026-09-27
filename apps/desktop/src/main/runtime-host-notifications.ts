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

import { isWorkHubCoordinationSessionId } from '@maka/core/session';
import type { DesktopRuntimeHostClient } from './runtime-host-client.js';
import type { RunNotificationEvent } from './notifications-policy.js';

/**
 * Hands every attention a Host attaches to its Session catalog changes to
 * `notify`, named after its Session. The catalog feed already carries every
 * Session this connection may read, so nothing here depends on which
 * conversation the window shows or subscribes to. A Guest connection reads
 * its one shared Session; the WorkHub coordination Session has no
 * conversation to open, so it never notifies.
 */
export function observeRuntimeHostNotifications(
  client: Pick<
    DesktopRuntimeHostClient,
    'hostEpoch' | 'subscribeSessionCatalogChanges' | 'getSession' | 'getSharedSession'
  >,
  notify: (input: RunNotificationEvent) => Promise<void>,
  onError: (error: unknown) => void,
  shared = false,
): () => void {
  let closed = false;
  const unsubscribe = client.subscribeSessionCatalogChanges((frame) => {
    const attention = frame.attention;
    if (!attention || closed || isWorkHubCoordinationSessionId(frame.sessionId)) return;
    const hostEpoch = client.hostEpoch;
    // A failed name read still notifies, with the generic copy.
    void (shared ? client.getSharedSession() : client.getSession(frame.sessionId))
      .catch(() => null)
      .then((session) => {
        if (closed) return;
        return notify({
          hostEpoch,
          sessionId: frame.sessionId,
          eventId: attention.eventId,
          kind: attention.kind,
          title: session?.name,
          body: attention.body ?? session?.lastMessagePreview,
        });
      })
      .catch(onError);
  });
  return () => {
    closed = true;
    unsubscribe();
  };
}
