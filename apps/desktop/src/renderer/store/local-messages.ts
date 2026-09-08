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

import type { TransientUserMessageProjection } from '@maka/ui';
import type { UiLocale } from '@maka/core/ui-locale';
import { redactSecrets } from '@maka/core/display-redaction';
import * as api from '../bridge/session-local.js';
import { getSessionLocalCopy } from '../locales/session-local-copy.js';

/** Main owns delivery. A read from an old session can never update its successor. */
export function observeLocalMessages(options: {
  sessionId: string;
  locale: UiLocale;
  api?: typeof api;
  publish(message: TransientUserMessageProjection): void;
  retire(messageId: string): void;
  snapshot(messages: readonly api.DesktopLocalMessage[]): void;
  reportError(message: string): void;
}) {
  const bridge = options.api ?? api;
  const copy = getSessionLocalCopy(options.locale);
  let closed = false;
  let revision = 0;
  let known = new Set<string>();
  const refresh = async () => {
    const request = ++revision;
    try {
      const messages = await bridge.listLocalMessages(options.sessionId);
      if (closed || request !== revision) return;
      const next = new Set(messages.map((message) => message.messageId));
      for (const id of known) if (!next.has(id)) options.retire(id);
      known = next;
      for (const message of messages) {
        const action = (operation: () => Promise<void>) => async () => {
          if (closed) return;
          try {
            await operation();
            if (!closed) await refresh();
          } catch {
            if (!closed) options.reportError(copy.updateError);
          }
        };
        options.publish({
          id: message.messageId,
          text: message.text,
          ts: message.createdAt,
          transientPlacement: message.placement,
          attachments: message.attachments,
          directoryReferences: message.directoryReferences,
          quotes: message.quotes,
          inlineReferences: message.inlineReferences,
          hostTurnId: message.turnId,
          // An accepted intent is the Host's now; its durable row retires this
          // one when the transcript catches up, and until then the bubble
          // reads as sent rather than announcing the handshake.
          deliveryStatus: message.state === 'accepted' ? undefined : copy[message.state],
          deliveryDetail: message.error ? redactSecrets(message.error) : undefined,
          deliveryActions: message.canCancel
            ? [
                {
                  label: copy.remove,
                  onClick: action(async () => {
                    await bridge.cancelLocalMessage(options.sessionId, message.messageId);
                    if (!closed) {
                      revision++;
                      known.delete(message.messageId);
                      options.retire(message.messageId);
                    }
                  }),
                },
              ]
            : message.state === 'unknown'
              ? [
                  {
                    label: copy.check,
                    onClick: action(() =>
                      bridge.reconcileLocalMessage(options.sessionId, message.messageId),
                    ),
                  },
                ]
              : [],
        });
      }
      options.snapshot(messages);
    } catch {
      /* A failed local read is not proof that a pending intent disappeared. */
    }
  };
  const off = bridge.subscribeLocalMessageChanges((id) => {
    if (id === options.sessionId) void refresh();
  });
  void refresh();
  return () => {
    closed = true;
    revision++;
    off();
  };
}
