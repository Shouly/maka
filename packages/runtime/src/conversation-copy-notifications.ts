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

import { isCanonicalArtifactEntityId } from '@maka/core/artifacts';
import type { RuntimeEvent } from '@maka/core/runtime-event';

export interface ConversationCopyChildNotification {
  readonly childSessionId: string;
  readonly toolCallId: string;
  readonly artifactIds: readonly string[];
  readonly ts: number;
}

// The producer escapes angle brackets in every external value. Only its own
// envelope can contain these tags; ordinary user text is never admitted here.
const BLOCK = /<task-notification>\n[\s\S]*?\n<\/task-notification>/gu;
const ARTIFACTS = /\n<artifacts>([^<>\n]*)<\/artifacts>\n/u;

function readBlock(block: string): Omit<ConversationCopyChildNotification, 'ts'> | undefined {
  const head =
    /^<task-notification>\n<task-id>([^<>\n]+)<\/task-id>\n<tool-use-id>([^<>\n]+)<\/tool-use-id>\n<status>(?:completed|failed|killed)<\/status>\n<summary>Agent /u.exec(
      block,
    );
  const ids = ARTIFACTS.exec(block)?.[1];
  if (!head || !ids || !isCanonicalArtifactEntityId(head[1]!)) return undefined;
  const artifactIds = [...new Set(ids.split(' ').filter(Boolean))];
  if (!artifactIds.every(isCanonicalArtifactEntityId)) return undefined;
  return { childSessionId: head[1]!, toolCallId: head[2]!, artifactIds };
}

/** Reads both individual steering notifications and batched idle wake notifications. */
export function collectConversationCopyChildNotifications(
  events: readonly RuntimeEvent[],
): readonly ConversationCopyChildNotification[] {
  return events.flatMap((event) => {
    if (
      event.partial ||
      event.role !== 'user' ||
      event.content?.kind !== 'text' ||
      event.content.origin?.kind !== 'background_task'
    )
      return [];
    return [...event.content.text.matchAll(BLOCK)].flatMap(([block]) => {
      const notification = readBlock(block);
      return notification ? [{ ...notification, ts: event.ts }] : [];
    });
  });
}

/** Called only on a host-authored background-task message, after ownership validation. */
export function rewriteConversationCopyNotificationArtifacts(
  text: string,
  artifactIds: ReadonlyMap<string, string>,
): string {
  return text.replace(BLOCK, (block) => {
    const notification = readBlock(block);
    if (!notification) return block;
    return block.replace(
      ARTIFACTS,
      (_match, ids: string) =>
        `\n<artifacts>${ids
          .split(' ')
          .map((id) => artifactIds.get(id) ?? id)
          .join(' ')}</artifacts>\n`,
    );
  });
}
