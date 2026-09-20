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

import { useState } from 'react';
import type { ArtifactDescriptor } from '@maka/core/artifacts';
import { useUiLocale } from '@maka/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { Button } from '../ui/button.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { ArtifactPreview } from '../workbar/ArtifactPreview.js';
import { cn } from '../../lib/cn.js';
import {
  deliveryFileExtension,
  deliveryFileGlyph,
  deliveryFileTitle,
} from '../../lib/ported/delivery-file-label.js';
import { getSessionPanelCopy } from '../../locales/session-panel-copy.js';

/** One shared upload browser; previewing input files does not replace Activity. */
export function SessionUploadsDialog({
  records,
  onClose,
}: {
  records: readonly ArtifactDescriptor[];
  onClose: () => void;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const [selectedId, setSelectedId] = useState<string | undefined>(records[0]?.id);
  const selected = records.find((record) => record.id === selectedId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        data-maka-contract="session-uploads-dialog"
        className={cn(
          'w-[calc(100vw-2rem)] h-[min(80dvh,760px)] transition-[max-width] duration-200 motion-reduce:transition-none',
          selected ? 'md:max-w-[1152px]' : 'md:max-w-[720px]',
        )}
      >
        <div className="flex min-h-0 flex-1 gap-6">
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-col',
              selected ? 'w-96 max-w-[45%] shrink-0' : 'flex-1',
            )}
          >
            <DialogHeader hideCloseButton>
              <DialogTitle>{copy.uploads}</DialogTitle>
            </DialogHeader>
            <div className="-mx-3 mt-6 min-h-0 overflow-y-auto px-3">
              {records.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  aria-label={record.name}
                  aria-current={record.id === selectedId ? 'page' : undefined}
                  onClick={() => setSelectedId(record.id)}
                  className={cn(
                    '-mx-3 flex min-h-11 w-[calc(100%+1.5rem)] cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-left outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                    record.id === selectedId ? 'bg-sidebar-selected' : 'hover:bg-sidebar-hover',
                  )}
                >
                  <span className="flex w-6 shrink-0 justify-center text-text-secondary">
                    <Anthropicon
                      name={
                        /\.(?:md|markdown)$/iu.test(record.name)
                          ? 'note'
                          : deliveryFileGlyph(record.name)
                      }
                      size={20}
                    />
                  </span>
                  <span className="min-w-0 truncate text-sm leading-5 text-text-primary">
                    {deliveryFileTitle(record.name)}
                  </span>
                  <span className="shrink-0 text-xs leading-[1.0625rem] text-text-muted">
                    {deliveryFileExtension(record.name)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {selected && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline">
              <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                  {deliveryFileTitle(selected.name)}
                </span>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={copy.closePreview}
                  onClick={() => setSelectedId(undefined)}
                >
                  <Anthropicon name="x" size={18} weight={577.75} />
                </Button>
              </div>
              <div
                className={cn('min-h-0 flex-1 overflow-auto', selected.kind === 'file' && 'p-4')}
              >
                <ArtifactPreview key={selected.id} record={selected} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
