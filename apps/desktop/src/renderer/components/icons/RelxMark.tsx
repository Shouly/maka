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

// The product's eight-petal mark, drawn from the brand source
// (`assets/brand/relx-symbol.svg`, the same geometry the app icon is rendered
// from). One `<path>` per petal so the petals can breathe one after another
// while a turn runs — the reference design system does the same with its own
// mark. Colour is `currentColor`; the caller picks it (`text-fill-brand`).

import { cn } from '../../lib/cn.js';

// Verbatim from the brand file, one subpath per petal in the file's order:
// top, bottom, right, left, top-right, bottom-left, bottom-right, top-left.
const SYMBOL =
  'M211.5 154.6a30 30 0 0 0 57 0l15.5-46.7a46.4 46.4 0 1 0-88 0l15.5 46.7ZM268.5 325.4a30 30 0 0 0-57 0L196 372.1a46.4 46.4 0 1 0 88 0l-15.5-46.7ZM372.1 196l-46.7 15.5a30 30 0 0 0 0 57l46.7 15.5c29.8 10 60.9-12 61.1-43.3v-1.3a46.4 46.4 0 0 0-61-43.4ZM107.9 284l46.7-15.5a30 30 0 0 0 0-57L107.9 196a46.4 46.4 0 1 0 0 88.1ZM320.5 199.7l44-22a46.4 46.4 0 0 0 12.6-73.9l-.9-.9a46.4 46.4 0 0 0-74 12.5l-22 44a30 30 0 0 0 40.3 40.3ZM159.5 280.3l-44 22a46.4 46.4 0 0 0-12.5 74l.8.8a46.4 46.4 0 0 0 74-12.6l22-44a30 30 0 0 0-40.3-40.2ZM364.6 302.3l-44-22a30 30 0 0 0-40.3 40.2l22 44a46.4 46.4 0 0 0 73.9 12.6l.8-.9a46.4 46.4 0 0 0-12.4-74ZM115.4 177.7l44 22a30 30 0 0 0 40.3-40.2l-22-44a46.4 46.4 0 1 0-62.2 62.2Z';
const PETALS = SYMBOL.split(/(?=M)/);
/** The file's petal order, walked clockwise from the top. */
const CLOCKWISE = [0, 4, 2, 6, 1, 5, 3, 7];
const BREATHE_CYCLE_MS = 1200;

export function RelxMark(props: { size?: number; animated?: boolean; className?: string }) {
  const size = props.size ?? 32;
  return (
    // The brand file's canvas is 480 with the mark on the middle ~386 (its
    // axis petals reach 46.8 and 433.2). Framed on the mark, not the canvas:
    // `size` is then the mark's own size, as it is for the reference's mark.
    <svg
      viewBox="40 40 400 400"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={cn('shrink-0', props.className)}
      data-maka-relx-mark={props.animated ? 'breathing' : 'still'}
    >
      {PETALS.map((d, index) => (
        <path
          key={d}
          d={d}
          className={cn(props.animated && 'relx-mark-petal')}
          style={
            props.animated
              ? {
                  animationDelay: `${(CLOCKWISE.indexOf(index) * BREATHE_CYCLE_MS) / CLOCKWISE.length}ms`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
