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

// One attachment as a 120×120 card, and the row that lays cards out. Ported
// from the reference design system's `AttachmentPreview`: an image shows
// itself (contain, not cover — the thumbnail is the proof that the right file
// was picked, and cropping the edges defeats that); anything else shows its
// name over an extension badge. The same card stands in a sent message and in
// the composer; only the composer gets the remove button, a sibling of the
// card so it is never a button inside a button.

import type { ReactNode } from 'react';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js';
import { cn } from '../../lib/cn.js';

// `border-border-strong`: the token is `--color-border-strong`, so the utility
// really is spelled with two `border`s. `border-strong` matches nothing and
// silently falls back to currentColor.
const SURFACE =
  'rounded-lg border border-border-strong bg-surface-3 shadow-[var(--card-shadow)] transition-all hover:border-border-stronger';
// The focus ring is written together with the card shadow: box-shadow is one
// property, and a ring alone would drop the resting shadow on focus.
const FOCUS =
  'focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow),var(--card-shadow)]';
// Three reveal conditions, none optional: hover for the pointer, focus-within
// for the keyboard, and always on touch, which has no hover at all.
const REMOVE =
  'absolute -left-2 -top-2 z-20 flex size-5 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-surface-3/90 text-text-muted backdrop-blur-sm transition-all hover:bg-surface-3/50 hover:text-text-secondary opacity-0 group-hover/thumbnail:opacity-100 group-focus-within/thumbnail:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]';

/** The badge text: the name's extension, else the MIME subtype, else nothing. */
export function attachmentExtensionLabel(name: string, mimeType?: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  const subtype = mimeType?.split('/')[1];
  return subtype ? subtype.replace(/^x-/, '').toUpperCase() : '';
}

export function AttachmentCard(props: {
  name: string;
  mimeType?: string;
  /** A decoded image to show in place of the name; absent for any other file. */
  imageSrc?: string;
  /** Opens the attachment; absent, the card is a label and nothing more. */
  onOpen?: () => void;
  openLabel: string;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const extension = attachmentExtensionLabel(props.name, props.mimeType);
  return (
    <div className="group/thumbnail relative shrink-0" data-maka-attachment-card={props.name}>
      <button
        type="button"
        disabled={!props.onOpen}
        onClick={props.onOpen}
        aria-label={props.openLabel}
        className={cn(
          'block size-[120px] min-w-[120px] overflow-hidden text-left',
          SURFACE,
          FOCUS,
          props.onOpen ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        {props.imageSrc ? (
          <img src={props.imageSrc} alt={props.name} className="size-full object-contain" />
        ) : (
          <div className="flex size-full select-none flex-col justify-between gap-2.5 px-2.5 py-2">
            <p
              className="line-clamp-4 break-words text-[0.75rem] leading-tight text-text-primary"
              title={props.name}
            >
              {props.name}
            </p>
            {/* In flow, not absolute: an absolute badge needs reserved
                padding, and a long name runs into it. */}
            {extension && (
              <span className="flex h-[18px] w-fit min-w-0 items-center rounded-[4px] border border-border-strong bg-surface-3/70 px-1 shadow-[var(--card-shadow)] backdrop-blur-sm">
                <span className="truncate text-[0.6875rem] font-medium uppercase leading-[0.8125rem] text-text-secondary">
                  {extension}
                </span>
              </span>
            )}
          </div>
        )}
      </button>
      {props.onRemove && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={props.removeLabel ?? props.openLabel}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onRemove?.();
              }}
              className={REMOVE}
            >
              <Anthropicon name="x" size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{props.removeLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Cards in a row that scrolls sideways. `p-2 -m-2` gives the remove button,
 * which sits outside its card, room not to be clipped, at no cost to the
 * layout around the row.
 */
export function AttachmentCardRow(props: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={props.className} aria-label={props.label} role="group">
      <div className="-m-2 flex flex-row items-start gap-3 overflow-x-auto p-2">
        {props.children}
      </div>
    </div>
  );
}
