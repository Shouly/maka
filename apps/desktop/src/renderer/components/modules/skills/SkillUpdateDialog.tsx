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

// The update review: what `skills.updateManaged` would write, before it does.
//
// A managed skill is a copy of a file in the source library, and updating it
// REPLACES the workspace copy. Upstream never applied an update without
// showing this first, and the reason is the `local_modified` case: the copy
// being overwritten may be the only place the user's own edits exist. So the
// preview is not decoration — it is the difference between an update and a
// silent loss, which is why the apply button changes its word to "overwrite"
// when that is what it would do.
//
// The two digests the preview carries go back with the apply, so a source
// that changed while this dialog was open fails instead of writing a version
// nobody read.

import {
  getSkillsCopy,
  useUiLocale,
  type ManagedSkillUpdatePreview,
  type SkillsCopy,
} from '@maka/ui';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.js';
import { getSkillsPageCopy } from '../../../locales/skills-page-copy.js';

/** Upstream's clip. A SKILL.md is prose, and the first screen is the review. */
const PREVIEW_MAX_LINES = 80;

function previewText(content: string): string {
  const lines = content.replace(/\r\n/gu, '\n').split('\n');
  const clipped = lines.slice(0, PREVIEW_MAX_LINES).join('\n');
  return lines.length > PREVIEW_MAX_LINES ? `${clipped}\n…` : clipped;
}

function SkillUpdateColumn(props: { label: string; content: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium leading-4 text-text-secondary">{props.label}</span>
      <pre className="max-h-56 min-w-0 overflow-auto rounded-lg border border-hairline bg-surface-2 p-2 text-xs leading-4 text-text-secondary">
        {previewText(props.content)}
      </pre>
    </div>
  );
}

export function SkillUpdateDialog(props: {
  preview: ManagedSkillUpdatePreview | null;
  applying: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}) {
  const locale = useUiLocale();
  const copy: SkillsCopy = getSkillsCopy(locale);
  const page = getSkillsPageCopy(locale);
  const preview = props.preview;
  if (!preview) return null;
  const overwrites = preview.skill.managedUpdateStatus === 'local_modified';
  const facts = [
    preview.skill.managedSourceId
      ? copy.review.source(preview.skill.managedSourceId)
      : copy.review.managedSource,
    preview.skill.hasManagedBaseline ? copy.review.hasBaseline : copy.review.missingBaseline,
    copy.review.lineTransition(preview.summary.currentLineCount, preview.summary.sourceLineCount),
    copy.review.changedLines(preview.summary.changedLineCount),
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.applying) props.onOpenChange(false);
      }}
    >
      <DialogContent className="md:max-w-2xl" aria-label={copy.review.ariaLabel}>
        <DialogHeader>
          <DialogTitle>{copy.review.title}</DialogTitle>
          <DialogDescription>{preview.skill.name}</DialogDescription>
        </DialogHeader>
        <p className="text-xs leading-4 text-text-muted">{facts.join(' · ')}</p>
        {overwrites && (
          <p className="rounded-lg bg-warning-subtle px-3 py-2 text-xs leading-4 text-warning">
            {copy.review.warning}
          </p>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <SkillUpdateColumn label={copy.review.workspace} content={preview.currentContent} />
          <SkillUpdateColumn label={copy.review.sourceVersion} content={preview.sourceContent} />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={props.applying}
            onClick={() => props.onOpenChange(false)}
          >
            {copy.review.cancel}
          </Button>
          <Button
            variant={overwrites ? 'destructive' : 'default'}
            disabled={props.applying}
            aria-busy={props.applying || undefined}
            onClick={props.onApply}
          >
            {props.applying
              ? page.update.applying
              : overwrites
                ? copy.review.overwrite
                : copy.review.update}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
