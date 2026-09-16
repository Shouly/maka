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

// What the turn HANDS OVER: SendUserFile's cards and SendUserMessage's words.
//
// Neither is drawn inside a tool result panel, and that is the whole point.
// Every other renderer in this folder is evidence about work that was done —
// it belongs behind a fold, at 13px, in a bordered box the reader opens when
// they want it. A delivery is not evidence; it is the deliverable. It stands
// in the turn beside the prose (`groupTurnTimeline` gives it its own block),
// at the width of the answer, and it is on screen without being asked for.
//
// The cards are `DeliveryFileCard`, which is NOT the attachment card: a file
// handed over and a file shown back are different things, and that file has
// the reasoning.

import { memo, useEffect } from 'react';
import { useUiLocale } from '@maka/ui';
import Markdown from '../../../ui/Markdown.js';
import { DeliveryFileCard } from './DeliveryFileCard.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import {
  readUserFileDelivery,
  type DurableToolResultContent,
  type UserFileDeliveryContent,
  type UserFileDeliveryFile,
  type UserMessageContent,
} from '../../../../lib/tool-delivery-results.js';

/**
 * `display: 'render'` opens the pane on the file, the moment it arrives.
 *
 * The reference's words for that parameter are "the user should see the
 * content inline in the side panel RIGHT NOW", so the card alone is not the
 * whole of it — something has to move the pane.
 *
 * Only while the turn is LIVE. Re-reading an old conversation must not move
 * the pane: history is full of deliveries, and opening one on every session
 * switch would take the pane away from whatever the reader had put there. The
 * FIRST file is the one opened, because it is the card at the top and the same
 * one `display`'s default was decided from.
 */
export function deliveryAutoOpenTarget(input: {
  result: DurableToolResultContent | undefined;
  live: boolean;
}): string | undefined {
  if (!input.live) return undefined;
  const delivery = readUserFileDelivery(input.result);
  if (delivery?.display !== 'render') return undefined;
  return delivery.files[0]?.artifactId;
}

export const DeliveryAutoOpen = memo(function DeliveryAutoOpen(props: {
  result: DurableToolResultContent | undefined;
  live: boolean;
  onOpenArtifact?: ((artifactId: string) => void) | undefined;
}) {
  const target = deliveryAutoOpenTarget(props);
  const onOpenArtifact = props.onOpenArtifact;
  useEffect(() => {
    if (target === undefined || !onOpenArtifact) return;
    onOpenArtifact(target);
  }, [target, onOpenArtifact]);
  return null;
});

export const UserFileDeliveryResult = memo(function UserFileDeliveryResult(props: {
  result: UserFileDeliveryContent;
  /** Selects the artifact in the right pane's Files face, by id. */
  onOpenArtifact?: (artifactId: string) => void;
  /** The path route, for a pane that can only resolve a workspace path. */
  onOpenFile?: (path: string | undefined) => void;
  /** Reveals the delivered file itself — never a copy of it. */
  onShowDeliveredFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).delivery;
  const onOpenArtifact = props.onOpenArtifact;
  const onOpenFile = props.onOpenFile;
  const onShowDeliveredFile = props.onShowDeliveredFile;
  // The id is the exact handle; the path is the fallback the Files face
  // resolves against its catalog. A card with neither is a label, not a
  // button — `DeliveryFileCard` draws that state by omitting the target.
  const open = onOpenArtifact
    ? (file: UserFileDeliveryFile) => () => onOpenArtifact(file.artifactId)
    : onOpenFile
      ? (file: UserFileDeliveryFile) => () => onOpenFile(file.path)
      : undefined;

  if (props.result.files.length === 0) {
    return <p className="my-3 text-[0.8125rem] leading-[1.125rem] text-text-muted">{copy.empty}</p>;
  }
  // Stacked, not a strip: the reference lays one card per row at the answer's
  // width. `status` and `caption` are deliberately NOT drawn — the reference
  // renders neither in the transcript, and a `proactive` pill exposes a tool
  // parameter to a reader who never chose it.
  return (
    <div
      className="flex min-w-0 flex-col gap-2 pb-2 pt-4"
      role="group"
      aria-label={copy.filesLabel}
      data-maka-file-delivery={props.result.status}
    >
      {props.result.files.map((file) => (
        <DeliveryFileCard
          key={file.artifactId}
          file={file}
          {...(open ? { onOpen: open(file) } : {})}
          {...(onShowDeliveredFile ? { onShowInFolder: () => onShowDeliveredFile(file.path) } : {})}
        />
      ))}
    </div>
  );
});

/**
 * A note too big for a row, addressed to the reader.
 *
 * The same `Markdown` the final answer uses, in the same column, at the same
 * size — and with NOTHING above it. In the reference a promoted note is
 * typographically indistinguishable from the turn's own answer; the only mark
 * left on it is the tally in the header of the group it came out of. A label
 * here would re-file it as tool output, which is the one thing it is not.
 */
export const UserMessageResult = memo(function UserMessageResult(props: {
  message: string;
  onOpenExternal?: (url: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div
      className="chat-assistant-response standard-markdown my-3 min-w-0"
      data-maka-user-message=""
      data-maka-contract="markdown"
    >
      <Markdown
        noPadding
        {...(props.onOpenExternal ? { onOpenExternal: props.onOpenExternal } : {})}
        {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
      >
        {props.message}
      </Markdown>
    </div>
  );
});
