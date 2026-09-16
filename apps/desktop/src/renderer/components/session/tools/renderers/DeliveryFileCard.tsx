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

// One delivered file, as relx's `SandboxFilesDisplay` draws it.
//
// NOT the attachment card. The pane used to reuse `AttachmentCard` — the
// 120×120 square a user's own attachment gets — on the reasoning that a file
// the model sends and a file the user sends are the same kind of thing. They
// are not. An attachment is a thing the reader already knows, shown back to
// them; a delivery is a thing being HANDED OVER, and what the reader needs off
// it is the name, what kind of file it is, and somewhere to put it. None of
// those fit in a square with a filename under it, and twelve of them (which
// one call really can send) scrolled sideways out of the answer.
//
// The frame is still the Cowork reference's geometry — 520 wide, one click
// target, the name as a SENTENCE over a kind line, cards stacked at 8px. The
// PAGE on the left is relx's and is a different idea entirely; `SheetIcon`
// says how.

import { memo } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon, type AnthropiconName } from '../../../icons/Anthropicon.js';
import { Button } from '../../../ui/button.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import { detectPlatform } from '../../../../lib/platform.js';
import {
  deliveryFileExtension,
  deliveryFileGlyph,
  deliveryFileKind,
  deliveryFileTitle,
} from '../../../../lib/ported/delivery-file-label.js';
import type { UserFileDeliveryFile } from '../../../../lib/tool-delivery-results.js';

/**
 * The page, as relx draws it.
 *
 * Not the reference's pair of flat stacked sheets: one page, tilted six
 * degrees, with only its top corners rounded, pushed down so the card's own
 * `overflow-hidden` cuts its foot. Its fill is a vertical gradient that fades
 * to nothing rather than a flat colour, which is what keeps the cut edge from
 * reading as a hard line.
 *
 * Hover straightens it to four degrees and grows it a little — the page picks
 * itself up rather than sliding.
 */
function SheetIcon(props: { glyph: AnthropiconName }) {
  return (
    <div
      // `self-end` with the card's bottom padding cancelled: the page hangs
      // off the true bottom edge, not off the inside of the padding.
      className="pointer-events-none relative -mb-2 h-16 w-[60px] shrink-0 self-end"
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex translate-y-[15%] rotate-[-6deg] scale-[1] items-center justify-center overflow-hidden rounded-t-lg border border-border-strong bg-gradient-to-b from-surface-2 to-transparent transition-transform duration-300 ease-out group-hover/delivery:rotate-[-4deg] group-hover/delivery:scale-[1.035] group-hover/delivery:duration-[400ms]">
        <Anthropicon name={props.glyph} size={24} className="text-text-muted" />
      </div>
    </div>
  );
}

export const DeliveryFileCard = memo(function DeliveryFileCard(props: {
  file: UserFileDeliveryFile;
  onOpen?: () => void;
  /** Reveals the delivered file itself in the platform's file manager. */
  onShowInFolder?: () => void;
}) {
  const copy = getTranscriptCopy(useUiLocale()).delivery;
  const title = deliveryFileTitle(props.file.name);
  const kind = deliveryFileKind(props.file.name);
  const extension = deliveryFileExtension(props.file.name);
  // `Document · MD`. A skill shows its word alone — its extension IS the word,
  // so printing both would say the same thing twice.
  const kindLine =
    kind === 'skill' || extension === undefined
      ? copy.kind[kind]
      : `${copy.kind[kind]} · ${extension}`;
  const onOpen = props.onOpen;
  const onShowInFolder = props.onShowInFolder;
  return (
    <div className="group/delivery relative isolate flex w-full max-w-[520px] items-center gap-5 overflow-hidden rounded-xl border-[0.5px] border-alpha-3 bg-surface-2 pb-2 pl-5 pr-4 pt-1.5 transition-colors hover:border-alpha-4">
      {/* The whole card is the target, and it is a SIBLING of the action rather
          than its parent: a button inside a button is not a thing. The action
          is positioned, so it paints and takes clicks above this one. */}
      {onOpen && (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer rounded-[inherit] outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          aria-label={copy.openFile(props.file.name)}
          onClick={onOpen}
        />
      )}
      <SheetIcon glyph={deliveryFileGlyph(props.file.name)} />
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        <span className="truncate text-[0.9375rem] leading-5 text-text-primary">{title}</span>
        <span className="truncate text-[0.8125rem] leading-[1.0625rem] text-text-muted">
          {kindLine}
        </span>
      </div>
      {onShowInFolder && (
        // ONE action, and the design system's own button rather than a
        // hand-rolled one. The reference lists every application that can open
        // the file because its own file lives in a cloud sandbox where the
        // user's file manager cannot see it — it has to rebuild the chooser.
        // This file is in the user's project, so the platform's "Open With" is
        // one right-click away and better than any list this card could build.
        <Button variant="secondary" className="relative" onClick={onShowInFolder}>
          <Anthropicon name="folderOpen" size={16} className="shrink-0" />
          {copy.showIn[detectPlatform()]}
        </Button>
      )}
    </div>
  );
});
