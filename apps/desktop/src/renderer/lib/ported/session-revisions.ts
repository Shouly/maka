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

// The version switcher under a user message: "‹ 2 / 3 ›".
//
// The reference counts versions per message. Editing a message makes a
// sibling of it, and the message, not the conversation, says which of its
// versions is on screen. Maka makes each edit a Session of its own, which names
// the turn it replaced (`revisionOfTurnId`) and, once its first turn starts,
// the turn it put there (`revisionTurnId`). Those pairs link the versions of
// one message. A copy keeps the ids of the turns it carries, so a message has
// the same versions whichever Session is showing it.

import {
  sessionRevisionFamilyId,
  visibleSessionRevisionMembers,
} from '@maka/core/session-revisions';

import { type SessionSummary } from '@maka/core/session';

/** Where one user message stands among its versions. */
export interface MessageVersions {
  /** 1-based, in the order the versions were written. */
  current: number;
  total: number;
  /** The Session that opens on the version before, absent on the first. */
  previousSessionId?: string;
  /** The Session that opens on the version after, absent on the last. */
  nextSessionId?: string;
}

/**
 * The versions of every edited message in the active Session's family, keyed
 * by the turn id each version has.
 *
 * A version opens the Session that wrote it: an edit's own Session, or for the
 * message as first sent, the Session the first edit of it was made from. The
 * reference reopens the branch where it was last left; a Session carried
 * further by a later edit (of a later message) is not reached this way.
 */
export function deriveMessageVersions(
  sessions: readonly SessionSummary[],
  activeId: string | undefined,
): ReadonlyMap<string, MessageVersions> {
  const versions = new Map<string, MessageVersions>();
  const active = activeId ? sessions.find((session) => session.id === activeId) : undefined;
  if (!active) return versions;
  const root = sessionRevisionFamilyId(active);
  const family = visibleSessionRevisionMembers(
    sessions.filter((session) => sessionRevisionFamilyId(session) === root),
    activeId,
  );
  const members = new Set(family.map((session) => session.id));
  // Written order; an edit's turn is named only once it has started.
  const edits = family
    .flatMap((session) =>
      session.revisionOfTurnId !== undefined && session.revisionTurnId !== undefined
        ? [
            {
              sessionId: session.id,
              parentSessionId: session.revisionParentSessionId,
              replaced: session.revisionOfTurnId,
              written: session.revisionTurnId,
              index: session.revisionIndex ?? 1,
            },
          ]
        : [],
    )
    .sort(
      (left, right) => left.index - right.index || left.sessionId.localeCompare(right.sessionId),
    );
  if (edits.length === 0) return versions;

  const replaces = new Map(edits.map((edit) => [edit.written, edit.replaced]));
  const opensIn = new Map(edits.map((edit) => [edit.written, edit.sessionId]));
  for (const edit of edits) {
    if (!opensIn.has(edit.replaced) && edit.parentSessionId && members.has(edit.parentSessionId)) {
      opensIn.set(edit.replaced, edit.parentSessionId);
    }
  }
  /** The message as first sent, which every version of it goes back to. */
  const original = (turnId: string): string => {
    let turn = turnId;
    // Bounded: each turn replaces at most one, and a turn is written once.
    for (let step = 0; step < edits.length; step++) {
      const previous = replaces.get(turn);
      if (previous === undefined) break;
      turn = previous;
    }
    return turn;
  };

  const messages = new Map<string, string[]>();
  for (const edit of edits) {
    const first = original(edit.written);
    const turns = messages.get(first) ?? [first];
    turns.push(edit.written);
    messages.set(first, turns);
  }
  for (const turns of messages.values()) {
    turns.forEach((turnId, index) => {
      const previous = index > 0 ? opensIn.get(turns[index - 1]!) : undefined;
      const next = opensIn.get(turns[index + 1] ?? '');
      versions.set(turnId, {
        current: index + 1,
        total: turns.length,
        ...(previous ? { previousSessionId: previous } : {}),
        ...(next ? { nextSessionId: next } : {}),
      });
    });
  }
  return versions;
}
