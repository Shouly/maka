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

// What the user has said while the model was still answering.
//
// The Host owns the queue: it decides whether a message steers the current
// turn or starts the next one, and it holds a revision so two clients cannot
// edit the same entry from stale readings. Every action here therefore names
// the entry AND the revision it was read at, and a rejected edit is the Host
// telling this view it is behind — which is why the edit box closes and the
// row re-reads rather than retrying.
//
// Reordering is expressed as the full id list rather than a move, because that
// is what `reorderQueueEntries` takes: a move is ambiguous once the queue has
// changed underneath, an explicit order is not.
//
// Two things follow from the Host owning the order, and both are easy to get
// wrong. The list it takes is the FOLLOW-UP order: a steering entry belongs to
// the turn already running and is not a position in it. And a drag has to name
// the entry it started on, not the row index it started at — this plate is on
// screen only while a turn runs, which is exactly when `queue_update`
// re-publishes and re-indexes the queue, so an index resolved at drop time can
// address a different message than the one under the pointer.

import { memo, useState } from 'react';
import { useStore } from 'zustand';
import { AnimatePresence, motion } from 'motion/react';
import type { MessageQueueEntryProjection } from '@maka/core/events';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/cn.js';
import { activeSessionStore, turnActionsStore } from '../../store/index.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { messageActionButtonClass } from './message-action-bar.js';

/**
 * Move one entry within the order, as the id list the Host expects.
 *
 * Pure, and exported, because "what does dragging row 3 above row 1 mean" is
 * the part of drag-and-drop worth testing; the pointer handling is not.
 * Out-of-range indices return the list unchanged rather than clamping, so a
 * drop past the end is a no-op instead of a silent move to the last position.
 */
export function reorderQueue(ids: readonly string[], from: number, to: number): readonly string[] {
  if (from === to) return ids;
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
}

/**
 * The follow-up order to send after dragging one entry onto another, or
 * `undefined` when the move asks for nothing.
 *
 * Everything the drop has to decide lives here, where it can be tested: which
 * entries are positions at all (steering entries belong to the running turn),
 * whether both ends are still in the queue — a `queue_update` between drag and
 * drop can retire either — and whether the order actually changed.
 */
export function queueOrderAfterMove(
  entries: readonly MessageQueueEntryProjection[],
  fromId: string,
  toId: string,
): readonly string[] | undefined {
  const followupIds = followupOrder(entries);
  const next = reorderQueue(followupIds, followupIds.indexOf(fromId), followupIds.indexOf(toId));
  return next === followupIds ? undefined : next;
}

/** The entries the Host will accept an order for, in their current order. */
export function followupOrder(entries: readonly MessageQueueEntryProjection[]): readonly string[] {
  return entries.filter((entry) => entry.placement === 'next_turn').map((entry) => entry.entryId);
}

function entryText(entry: MessageQueueEntryProjection): string {
  return entry.content.displayText ?? entry.content.text;
}

export const MessageQueue = memo(function MessageQueue(props: {
  sessionId: string;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).queue;
  const composerCopy = getConversationCopy(locale).composer;
  const queue = useStore(activeSessionStore, (state) => state.queues[props.sessionId]);
  const pending = useStore(
    turnActionsStore,
    (state) => state.pending[props.sessionId]?.includes('queue') ?? false,
  );
  const [editing, setEditing] = useState<
    { entryId: string; text: string; revision: number } | undefined
  >(undefined);
  const [dragging, setDragging] = useState<string | undefined>(undefined);

  const entries = queue?.entries ?? [];
  if (entries.length === 0) return null;
  const revision = queue?.queueRevision;
  // The order the Host accepts. Steering entries ride the running turn and are
  // deliberately absent: sending them would ask it to re-place a message that
  // is already part of the answer being written.
  const followupIds = followupOrder(entries);

  const run = (operation: Promise<unknown>) => {
    void operation.catch((error) => props.onError(copy.failedTitle, error));
  };

  /** Move one follow-up entry to another's position, both named by id. */
  const move = (fromId: string, toId: string) => {
    if (pending) return;
    const ids = queueOrderAfterMove(entries, fromId, toId);
    if (!ids) return;
    run(turnActionsStore.reorderQueued(props.sessionId, ids));
  };

  return (
    <section
      aria-label={copy.ariaLabel}
      data-maka-contract="message-queue"
      className="flex flex-col gap-1 rounded-xl border border-hairline bg-surface-2 p-2"
    >
      <p className="flex items-center gap-2 px-1 text-[0.6875rem] leading-4 text-text-muted">
        <span>{copy.title}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} aria-label={composerCopy.queueShortcutsLabel}>
              <Anthropicon name="info" size={12} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="whitespace-pre-line">
            {composerCopy.queueShortcuts}
          </TooltipContent>
        </Tooltip>
      </p>
      <AnimatePresence initial={false}>
        {entries.map((entry, index) => {
          const isEditing = editing?.entryId === entry.entryId;
          // Only a follow-up has a position to move within; the arrows and the
          // grip are therefore its own, and the row's position reads from that
          // list rather than from the rendered index.
          const followupIndex = followupIds.indexOf(entry.entryId);
          const orderable = followupIndex !== -1;
          return (
            <motion.div
              key={entry.entryId}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div
                draggable={!isEditing && orderable}
                onDragStart={() => setDragging(entry.entryId)}
                onDragOver={(event) => {
                  if (orderable) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== undefined && orderable) move(dragging, entry.entryId);
                  setDragging(undefined);
                }}
                onDragEnd={() => setDragging(undefined)}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-2 py-1.5',
                  dragging === entry.entryId ? 'opacity-50' : 'hover:bg-alpha-1',
                )}
              >
                <span
                  className="mt-1 shrink-0 text-text-muted"
                  aria-hidden="true"
                  title={
                    orderable
                      ? copy.position(followupIndex + 1, followupIds.length)
                      : copy.position(index + 1, entries.length)
                  }
                >
                  <Anthropicon name="dotsVertical" size={16} />
                </span>
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Textarea
                      value={editing.text}
                      aria-label={copy.edit}
                      rows={2}
                      autoFocus
                      onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                      className="resize-none text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={pending || revision === undefined || !editing.text.trim()}
                        onClick={() => {
                          if (revision === undefined) return;
                          run(
                            turnActionsStore
                              .editQueued(
                                props.sessionId,
                                entry.entryId,
                                editing.revision,
                                editing.text.trim(),
                              )
                              .then(() => setEditing(undefined)),
                          );
                        }}
                      >
                        {copy.save}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(undefined)}>
                        {copy.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* Which kind of queued message this is: steering joins the
                        answer being written, a follow-up starts the next turn. */}
                    <span className="text-[0.6875rem] leading-4 text-text-muted">
                      {orderable ? composerCopy.followupPending : composerCopy.steeringPending}
                    </span>
                    <p className="whitespace-pre-wrap break-words text-sm leading-5 text-text-secondary">
                      {entryText(entry)}
                    </p>
                  </div>
                )}
                {!isEditing && (
                  <div
                    role="group"
                    aria-label={
                      orderable
                        ? copy.position(followupIndex + 1, followupIds.length)
                        : copy.position(index + 1, entries.length)
                    }
                    className="flex shrink-0 items-center"
                  >
                    {orderable && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={copy.moveUp}
                              disabled={followupIndex === 0 || pending}
                              onClick={() =>
                                move(entry.entryId, followupIds[followupIndex - 1] ?? entry.entryId)
                              }
                              className={messageActionButtonClass}
                            >
                              <Anthropicon name="arrowUp" size={16} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{copy.moveUp}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={copy.moveDown}
                              disabled={followupIndex === followupIds.length - 1 || pending}
                              onClick={() =>
                                move(entry.entryId, followupIds[followupIndex + 1] ?? entry.entryId)
                              }
                              className={messageActionButtonClass}
                            >
                              <Anthropicon name="arrowDown" size={16} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{copy.moveDown}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={copy.promote}
                          disabled={pending}
                          onClick={() =>
                            run(turnActionsStore.promote(props.sessionId, entry.entryId))
                          }
                          className={messageActionButtonClass}
                        >
                          <Anthropicon name="arrowUpCircle" size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{copy.promote}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={copy.edit}
                          disabled={pending || revision === undefined}
                          onClick={() =>
                            revision !== undefined &&
                            setEditing({ entryId: entry.entryId, text: entryText(entry), revision })
                          }
                          className={messageActionButtonClass}
                        >
                          <Anthropicon name="edit" size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{copy.edit}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={copy.delete}
                          disabled={pending}
                          onClick={() =>
                            run(
                              turnActionsStore
                                .retract(props.sessionId, entry.entryId)
                                .then(() =>
                                  activeSessionStore.removeTransientMessage(
                                    props.sessionId,
                                    entry.messageId,
                                  ),
                                ),
                            )
                          }
                          className={messageActionButtonClass}
                        >
                          <Anthropicon name="trash" size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{copy.delete}</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
});
