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

// The shape of the action bar under a message. Ported from the reference
// design system's `message-action-bar.ts`; the user and assistant bars share
// it, which is the point.
//
// 24px square, r6, ghost squish fill, muted at rest and primary on hover, with
// a 16px glyph inside. Not 32: a 16px glyph in a 32px box doubles the gap
// between adjacent icons and the whole strip reads as loose.
//
// No `active:scale-95`. The press belongs to the squish layer, which shrinks
// the FILL and leaves the glyph and the hit area still; scaling the button
// shakes the glyph with it.

import { cn } from '../../lib/cn.js';

export const messageActionBaseClass =
  'ui-control-squish ui-control-squish-ghost inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted outline-none transition-colors hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50';

export const messageActionButtonClass = cn(messageActionBaseClass, 'size-6');

/** The revision stepper's two arrows: one notch narrower, so they read as one control. */
export const versionStepButtonClass = cn(messageActionBaseClass, 'h-6 w-5');

/**
 * The bar itself. Three gates, and every one of them is somebody's only way
 * in: hover for the mouse, focus-within for the keyboard (a focus ring drawn
 * on a transparent element is a ring around nothing), and `hover: none` for
 * touch, which has no hover at all.
 */
export const messageActionBarClass = cn(
  'flex select-none items-center opacity-0 pointer-events-none transition-opacity duration-300',
  'group-hover/turn:opacity-100 group-hover/turn:pointer-events-auto',
  'group-focus-within/turn:opacity-100 group-focus-within/turn:pointer-events-auto',
  '[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto',
  'motion-reduce:transition-none',
);
