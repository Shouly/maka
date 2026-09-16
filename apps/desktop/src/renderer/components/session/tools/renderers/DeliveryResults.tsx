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
// The cards are the reference design system's `AttachmentPreview` geometry —
// 120×120, name over an extension badge — which Maka already ports as
// `AttachmentCard`, so a file the model sends and a file the user sent look
// the same, because they are the same kind of thing.

import { memo } from 'react';
import { formatBytes, useAttachmentImageSource, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../../icons/Anthropicon.js';
import Markdown from '../../../ui/Markdown.js';
import { AttachmentCard, AttachmentCardRow } from '../../../ui/attachment-card.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import type {
  UserFileDeliveryContent,
  UserFileDeliveryFile,
  UserMessageContent,
} from '../../../../lib/tool-delivery-results.js';

/**
 * One card.
 *
 * The thumbnail read is per-card rather than hoisted, because the attachment
 * authority's reader is already de-duplicated per (session, artifact) — and
 * because a delivery of ten files should not block its first card's paint on
 * the tenth file's bytes.
 *
 * `display: 'attach'` means the model asked for the files to travel, not to be
 * shown, so an image under it keeps its name card: rendering it anyway would
 * overrule the call.
 */
const DeliveryCard = memo(function DeliveryCard(props: {
  file: UserFileDeliveryFile;
  render: boolean;
  onOpen?: (file: UserFileDeliveryFile) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).delivery;
  const showImage = props.render && props.file.kind === 'image';
  const source = useAttachmentImageSource(
    showImage ? { artifactId: props.file.artifactId } : undefined,
  );
  const onOpen = props.onOpen;
  return (
    <AttachmentCard
      name={props.file.name}
      {...(props.file.mimeType ? { mimeType: props.file.mimeType } : {})}
      {...(source ? { imageSrc: source } : {})}
      {...(props.file.sizeBytes > 0 ? { meta: formatBytes(props.file.sizeBytes) } : {})}
      {...(onOpen ? { onOpen: () => onOpen(props.file) } : {})}
      openLabel={copy.openFile(props.file.name)}
    />
  );
});

export const UserFileDeliveryResult = memo(function UserFileDeliveryResult(props: {
  result: UserFileDeliveryContent;
  /** Selects the artifact in the right pane's Files face, by id. */
  onOpenArtifact?: (artifactId: string) => void;
  /** The path route, for a pane that can only resolve a workspace path. */
  onOpenFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).delivery;
  const onOpenArtifact = props.onOpenArtifact;
  const onOpenFile = props.onOpenFile;
  // The id is the exact handle; the path is the fallback the Files face
  // resolves against its catalog. A card with neither is a label, not a
  // button — `AttachmentCard` already draws that state.
  const open = onOpenArtifact
    ? (file: UserFileDeliveryFile) => onOpenArtifact(file.artifactId)
    : onOpenFile
      ? (file: UserFileDeliveryFile) => onOpenFile(file.path)
      : undefined;

  if (props.result.files.length === 0) {
    return <p className="my-3 text-[0.8125rem] leading-[1.125rem] text-text-muted">{copy.empty}</p>;
  }
  return (
    <div className="my-3 flex min-w-0 flex-col gap-2" data-maka-file-delivery={props.result.status}>
      {props.result.status === 'proactive' && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-alpha-1 px-2 py-0.5 text-[0.6875rem] leading-4 text-text-muted">
          <Anthropicon name="bullhorn" size={12} className="shrink-0" />
          {copy.proactive}
        </span>
      )}
      <AttachmentCardRow label={copy.filesLabel}>
        {props.result.files.map((file) => (
          <DeliveryCard
            key={file.artifactId}
            file={file}
            render={props.result.display === 'render'}
            {...(open ? { onOpen: open } : {})}
          />
        ))}
      </AttachmentCardRow>
      {props.result.caption && (
        <p className="min-w-0 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
          {props.result.caption}
        </p>
      )}
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
