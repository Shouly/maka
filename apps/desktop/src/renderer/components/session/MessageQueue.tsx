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

import { memo, useState } from 'react';
import { useStore } from 'zustand';
import { AnimatePresence, motion } from 'motion/react';
import type { MessageQueueEntryProjection } from '@maka/core/events';
import { useUiLocale } from '@maka/ui';
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
export function reorderQueue(
  ids: readonly string[],
  from: number,
  to: number,
): readonly string[] {
  if (from === to) return ids;
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
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
  const queue = useStore(activeSessionStore, (state) => state.queues[props.sessionId]);
  const pending = useStore(
    turnActionsStore,
    (state) => state.pending[props.sessionId]?.includes('queue') ?? false,
  );
  const [editing, setEditing] = useState<{ entryId: string; text: string } | undefined>(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);

  const entries = queue?.entries ?? [];
  if (entries.length === 0) return null;
  const revision = queue?.queueRevision;

  const run = (operation: Promise<unknown>) => {
    void operation.catch((error) => props.onError(copy.failedTitle, error));
  };

  const move = (from: number, to: number) => {
    const current = entries.map((entry) => entry.entryId);
    const ids = reorderQueue(current, from, to);
    // `reorderQueue` hands the same array back when nothing moved, which is
    // what makes a no-op drop cost no round trip.
    if (ids === current) return;
    run(turnActionsStore.reorderQueued(props.sessionId, ids));
  };

  return (
    <section
      aria-label={copy.ariaLabel}
      data-maka-contract="message-queue"
      className="flex flex-col gap-1 rounded-xl border border-hairline bg-surface-2 p-2"
    >
      <p className="px-1 text-[0.6875rem] leading-4 text-text-muted">{copy.title}</p>
      <AnimatePresence initial={false}>
        {entries.map((entry, index) => {
          const isEditing = editing?.entryId === entry.entryId;
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
                draggable={!isEditing}
                onDragStart={() => setDragging(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== undefined) move(dragging, index);
                  setDragging(undefined);
                }}
                onDragEnd={() => setDragging(undefined)}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-2 py-1.5',
                  dragging === index ? 'opacity-50' : 'hover:bg-alpha-1',
                )}
              >
                <span
                  className="mt-1 shrink-0 text-text-muted"
                  aria-hidden="true"
                  title={copy.position(index + 1, entries.length)}
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
                      onChange={(event) =>
                        setEditing({ entryId: entry.entryId, text: event.target.value })
                      }
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
                                revision,
                                editing.text.trim(),
                              )
                              .finally(() => setEditing(undefined)),
                          );
                        }}
                      >
                        {copy.save}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(undefined)}
                      >
                        {copy.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-5 text-text-secondary">
                    {entryText(entry)}
                  </p>
                )}
                {!isEditing && (
                  <div
                    role="group"
                    aria-label={copy.position(index + 1, entries.length)}
                    className="flex shrink-0 items-center"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={copy.moveUp}
                          disabled={index === 0 || pending}
                          onClick={() => move(index, index - 1)}
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
                          disabled={index === entries.length - 1 || pending}
                          onClick={() => move(index, index + 1)}
                          className={messageActionButtonClass}
                        >
                          <Anthropicon name="arrowDown" size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{copy.moveDown}</TooltipContent>
                    </Tooltip>
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
                            setEditing({ entryId: entry.entryId, text: entryText(entry) })
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
                            run(turnActionsStore.retract(props.sessionId, entry.entryId))
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
