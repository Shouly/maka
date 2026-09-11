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

// What the user said, exactly as they said it.
//
// The bubble is the reference design system's `UserMessage`: right-aligned,
// `alpha-1` ground, 15/20 type, a 200px clip with a mask past which one
// control opens it. What is Maka's is everything hanging off it — attachments,
// quoted excerpts, directory and file references, skill tokens — because those
// are things the Host accepted with the message and the transcript is the only
// place they are shown back.
//
// The text is rendered VERBATIM, not as markdown. What the user typed is not a
// document the model wrote; turning their backticks into code blocks would
// show them something they did not write.

import { memo, useEffect, useId, useRef, useState } from 'react';
import type {
  AttachmentRef,
  DirectoryReference,
  InlineReference,
  QuoteRef,
} from '@maka/core/events';
import { getConversationCopy, useAttachmentImageSource, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { AttachmentCard, AttachmentCardRow } from '../ui/attachment-card.js';
import { Button } from '../ui/button.js';
import { Textarea } from '../ui/textarea.js';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/cn.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { messageActionBarClass, messageActionButtonClass } from './message-action-bar.js';

/** Past this height the bubble clips and offers to open. */
const CLIP_HEIGHT_PX = 200;

const chipClass =
  'inline-flex max-w-full items-center gap-1 rounded-md bg-alpha-1 px-1.5 py-0.5 text-[0.6875rem] leading-4 text-text-muted';

function Chip(props: {
  icon: Parameters<typeof Anthropicon>[0]['name'];
  label: string;
  title?: string;
}) {
  return (
    <span className={chipClass} title={props.title ?? props.label}>
      <Anthropicon name={props.icon} size={12} className="shrink-0" />
      <span className="truncate">{props.label}</span>
    </span>
  );
}

/**
 * One sent attachment as a card. An image whose bytes resolve opens the
 * lightbox; everything else (and an image whose source is not a session file)
 * opens the right pane's Files face on it, when the row was given a way to.
 */
function SentAttachmentCard(props: {
  attachment: AttachmentRef;
  onOpenImage: (src: string) => void;
  onOpenFile?: (attachment: AttachmentRef) => void;
}) {
  const copy = getTranscriptCopy(useUiLocale()).turn;
  const attachment = props.attachment;
  const src = useAttachmentImageSource(
    attachment.kind === 'image' && attachment.ref.kind === 'session_file'
      ? { sessionId: attachment.ref.sessionId, artifactId: attachment.ref.relativePath }
      : undefined,
  );
  const onOpenFile = props.onOpenFile;
  const onOpen = src
    ? () => props.onOpenImage(src)
    : onOpenFile
      ? () => onOpenFile(attachment)
      : undefined;
  return (
    <AttachmentCard
      name={attachment.name}
      mimeType={attachment.mimeType}
      {...(src ? { imageSrc: src } : {})}
      {...(onOpen ? { onOpen } : {})}
      openLabel={copy.openAttachment(attachment.name)}
    />
  );
}

export interface UserMessageRowProps {
  messageId: string;
  text: string;
  ts?: number;
  attachments?: readonly AttachmentRef[];
  quotes?: readonly QuoteRef[];
  directoryReferences?: readonly DirectoryReference[];
  inlineReferences?: readonly InlineReference[];
  /** True when the Host authored this message (a schedule, a goal, a graph). */
  hostOrigin?: boolean;
  /** Opens a non-image attachment (the right pane's Files face); absent, such cards are labels. */
  onOpenAttachment?: (attachment: AttachmentRef) => void;
  /** Absent when this message cannot be edited (see `revisionRefusalFor`). */
  onEdit?: () => void;
  /** Why editing is unavailable, for the disabled button's tooltip. */
  editDisabledReason?: string;
  editing?: boolean;
  editText?: string;
  onEditTextChange?: (text: string) => void;
  onEditSubmit?: () => void;
  onEditCancel?: () => void;
  editPending?: boolean;
  editCancelDisabled?: boolean;
}

export const UserMessageRow = memo(function UserMessageRow(props: UserMessageRowProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const messages = getConversationCopy(locale).messages;
  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | undefined>(undefined);
  const bodyId = useId();

  useEffect(() => {
    const element = bodyRef.current;
    if (!element || props.editing) return;
    const frame = window.requestAnimationFrame(() =>
      setClipped(element.scrollHeight > CLIP_HEIGHT_PX),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [props.text, props.editing]);

  // The editor grows with its content: a fixed-height box for a message that
  // was five lines long hides four of them behind a scrollbar.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element || !props.editing) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [props.editText, props.editing]);

  const skills = (props.inlineReferences ?? []).filter((row) => row.kind === 'skill');
  const files = (props.inlineReferences ?? []).filter((row) => row.kind === 'workspace_file');
  const attachments = props.attachments ?? [];
  const collapsed = clipped && !expanded;

  if (props.editing) {
    return (
      <div className="mb-1 mt-6 flex w-full flex-col gap-2" data-role="user">
        <div className="chat-user-bubble flex flex-col gap-2 rounded-xl bg-alpha-1 px-4 py-2.5">
          <Textarea
            ref={textareaRef}
            readOnly={props.editPending || props.editCancelDisabled}
            value={props.editText ?? ''}
            aria-label={copy.turn.editTitle}
            onChange={(event) => props.onEditTextChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                props.onEditSubmit?.();
              }
              if (event.key === 'Escape' && !props.editCancelDisabled) props.onEditCancel?.();
            }}
            autoFocus
            rows={2}
            className="resize-none overflow-hidden whitespace-pre-wrap py-3 text-[0.9375rem] leading-5"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="flex flex-1 items-center gap-2 text-xs leading-4 text-text-muted">
              <Anthropicon name="info" size={16} className="shrink-0" />
              <span>{copy.turn.editHint}</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                disabled={props.editCancelDisabled}
                onClick={() => props.onEditCancel?.()}
              >
                {copy.turn.cancel}
              </Button>
              <Button
                onClick={() => props.onEditSubmit?.()}
                disabled={
                  props.editPending ||
                  !props.editText?.trim() ||
                  props.editText.trim() === props.text.trim()
                }
              >
                {copy.turn.save}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-1 mt-6 flex flex-col items-end gap-1"
      data-role="user"
      data-has-attachments={(props.attachments?.length ?? 0) > 0}
    >
      {attachments.length > 0 && (
        <AttachmentCardRow label={copy.turn.attachmentsLabel} className="max-w-[85%]">
          {attachments.map((attachment) => (
            <SentAttachmentCard
              key={`${attachment.name}-${attachment.bytes}`}
              attachment={attachment}
              onOpenImage={setLightbox}
              {...(props.onOpenAttachment ? { onOpenFile: props.onOpenAttachment } : {})}
            />
          ))}
        </AttachmentCardRow>
      )}

      <div className="chat-user-bubble inline-flex max-w-[85%] flex-col rounded-xl bg-alpha-1 px-4 py-2.5">
        <div
          id={bodyId}
          ref={bodyRef}
          className={cn(
            'relative py-0.5',
            collapsed &&
              'overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]',
          )}
          style={{ maxHeight: collapsed ? `${CLIP_HEIGHT_PX}px` : undefined }}
        >
          <div
            inert={collapsed}
            className="chat-user-content min-w-0 max-w-full whitespace-pre-wrap text-base leading-[1.4] text-text-primary [word-break:break-word]"
          >
            {props.text}
          </div>
        </div>
        {collapsed && <span className="sr-only">{copy.turn.collapsed}</span>}
        {clipped && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((open) => !open)}
            className="ui-control-squish ui-control-squish-ghost -ml-2 flex h-6 w-fit cursor-pointer items-center self-start rounded-md px-2 text-[0.8125rem] font-normal leading-[1.1875rem] text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          >
            {expanded ? copy.turn.showLess : copy.turn.showMore}
          </button>
        )}
      </div>

      {(props.quotes?.length ||
        props.directoryReferences?.length ||
        skills.length ||
        files.length ||
        props.hostOrigin) && (
        <div className="flex max-w-[85%] flex-wrap items-center justify-end gap-1.5">
          {props.hostOrigin && <Chip icon="agent" label={copy.turn.hostOrigin} />}
          {skills.map((row) => (
            <Chip key={`skill-${row.start}`} icon="shapes" label={row.label} />
          ))}
          {files.map((row) => (
            <Chip key={`file-${row.start}`} icon="file" label={row.label} />
          ))}
          {(props.directoryReferences ?? []).map((row) => (
            <Chip
              key={`dir-${row.hostId}-${row.path}`}
              icon="folderOpen"
              label={row.path}
              title={`${copy.turn.directoryReferences}: ${row.path}`}
            />
          ))}
          {(props.quotes ?? []).map((row, index) => (
            <Chip
              key={`quote-${index}`}
              icon="reply"
              label={row.label ?? row.text}
              title={row.text}
            />
          ))}
        </div>
      )}

      <div
        role="toolbar"
        aria-label={copy.turn.actionsLabel}
        className={cn(messageActionBarClass, 'mt-0.5')}
      >
        {props.ts !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <time
                dateTime={new Date(props.ts).toISOString()}
                className="mr-2 inline-flex h-6 cursor-default items-center text-xs text-text-muted"
              >
                {new Intl.DateTimeFormat(locale, {
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(props.ts)}
              </time>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(
                props.ts,
              )}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={copied ? messages.copied : messages.copy}
              onClick={() => {
                void navigator.clipboard
                  .writeText(props.text)
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(() => undefined);
              }}
              className={messageActionButtonClass}
            >
              <Anthropicon name={copied ? 'check' : 'copy'} size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{copied ? messages.copied : messages.copy}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={copy.turn.editTitle}
              disabled={!props.onEdit}
              onClick={() => props.onEdit?.()}
              className={messageActionButtonClass}
            >
              <Anthropicon name="edit" size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {props.onEdit ? copy.turn.editTitle : (props.editDisabledReason ?? copy.turn.editTitle)}
          </TooltipContent>
        </Tooltip>
      </div>

      <Dialog
        open={lightbox !== undefined}
        onOpenChange={(open) => !open && setLightbox(undefined)}
      >
        <DialogContent className="md:max-w-3xl">
          <DialogTitle className="sr-only">{copy.turn.attachmentsLabel}</DialogTitle>
          {lightbox && (
            <img
              src={lightbox}
              alt={copy.turn.attachmentsLabel}
              className="max-h-[70dvh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
