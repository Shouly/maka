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

// Activity card below the conversation header. Outputs and uploads share the
// catalog, while opening either hands the right column to the file viewer.

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ArtifactDescriptor } from '@maka/core/artifacts';
import type { SessionTask } from '@maka/core/session-task';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { SessionUploadsDialog } from './SessionUploadsDialog.js';
import { cn } from '../../lib/cn.js';
import { openBlockersOf, useTaskProgress } from '../../hooks/use-task-progress.js';
import { useSessionArtifacts } from '../../hooks/use-session-artifacts.js';
import { openWorkbarArtifact } from '../../hooks/use-workbar.js';
import { saveArtifactsAs } from '../../bridge/app.js';
import { toast } from '../../store/toast-store.js';
import {
  deliveryFileExtension,
  deliveryFileGlyph,
  deliveryFileTitle,
} from '../../lib/ported/delivery-file-label.js';
import { getSessionPanelCopy, type SessionPanelCopy } from '../../locales/session-panel-copy.js';

export function SessionPanel({
  sessionId,
  onClose,
  hidden = false,
  peek = false,
  onPointerEnter,
  onPointerLeave,
}: {
  sessionId: string;
  onClose: () => void;
  hidden?: boolean;
  peek?: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const progress = useTaskProgress(sessionId);
  const files = useSessionArtifacts(sessionId);
  const [saving, setSaving] = useState(false);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const downloadAll = async () => {
    if (saving || files.records.length === 0) return;
    setSaving(true);
    try {
      const result = await saveArtifactsAs(
        sessionId,
        files.records.map((file) => file.id),
      );
      if (!result.ok && result.reason !== 'canceled')
        toast({ title: copy.downloadFailed, variant: 'destructive' });
    } catch {
      toast({ title: copy.downloadFailed, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <aside
        id="maka-session-panel"
        aria-label={copy.label}
        data-maka-contract="session-panel"
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        style={{ display: hidden ? 'none' : undefined }}
        className={cn(
          'absolute right-2 top-[calc(var(--h-titlebar)-0.25rem)] z-30 flex w-80 max-w-[calc(100%-1rem)] flex-col',
          peek ? 'max-h-[min(70%,40rem)]' : 'max-h-[calc(100%-var(--h-titlebar)-0.25rem)]',
        )}
      >
        <div className="flex min-h-0 flex-col overflow-y-auto rounded-xl border-[1px] border-hairline bg-surface-3 shadow-xs">
          <div className="relative flex min-h-0 flex-col">
            {!peek && (
              <Button
                variant="ghost"
                size="iconSm"
                onClick={onClose}
                aria-label={copy.close}
                className="absolute right-2 top-2.5 z-10"
              >
                <Anthropicon name="x" size={18} weight={577.75} />
              </Button>
            )}
            <PanelSection title={copy.progress} headerClassName={peek ? undefined : 'pr-11'}>
              {progress.tasks.length === 0 ? (
                <p className="py-1 text-sm leading-5 text-text-muted">
                  {progress.status === 'error'
                    ? copy.unavailable
                    : progress.status === 'loading' || progress.status === 'idle'
                      ? copy.loading
                      : copy.empty}
                </p>
              ) : (
                <ProgressSteps tasks={progress.tasks} copy={copy} />
              )}
            </PanelSection>
            <PanelSection
              title={copy.outputs}
              action={
                files.records.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => void downloadAll()}
                    disabled={saving}
                    aria-label={copy.downloadAll}
                    title={copy.downloadAll}
                  >
                    <Anthropicon name="download" size={16} weight={700} />
                  </Button>
                ) : undefined
              }
            >
              {files.records.length === 0 ? (
                <p className="py-1 text-sm leading-5 text-text-muted">
                  {files.error
                    ? copy.outputsUnavailable
                    : !files.loaded
                      ? copy.loading
                      : copy.outputsEmpty}
                </p>
              ) : (
                files.records.map((record) => (
                  <OutputFileRow
                    key={record.id}
                    record={record}
                    copy={copy}
                    onSelect={() => openWorkbarArtifact(sessionId, record.id)}
                  />
                ))
              )}
            </PanelSection>
            {files.uploads.length > 0 && (
              <PanelSection title={copy.usedInSession} fixed>
                <button
                  type="button"
                  onClick={() => setUploadsOpen(true)}
                  aria-haspopup="dialog"
                  aria-label={`${copy.uploads}: ${files.uploads.map((file) => file.name).join(', ')}`}
                  className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm leading-5 text-text-secondary outline-none hover:bg-sidebar-menu-hover focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                >
                  <span className="flex w-5 shrink-0 justify-center">
                    <Anthropicon name="attach" size={16} />
                  </span>
                  <span>{copy.uploads}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs leading-[1.0625rem] text-text-muted">
                    {files.uploads.map((file) => file.name).join(', ')}
                  </span>
                </button>
              </PanelSection>
            )}
          </div>
        </div>
      </aside>
      {uploadsOpen && (
        <SessionUploadsDialog records={files.uploads} onClose={() => setUploadsOpen(false)} />
      )}
    </>
  );
}

/** Earlier completed work folds as a prefix, preserving the order of live work. */
export function ProgressSteps({
  tasks,
  copy,
}: {
  tasks: readonly SessionTask[];
  copy: SessionPanelCopy;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const earlierId = useId();
  let earlierCount = 0;
  while (earlierCount < tasks.length - 2 && tasks[earlierCount]?.status === 'completed')
    earlierCount++;
  const earlier = tasks.slice(0, earlierCount);
  const recent = tasks.slice(earlierCount);
  return (
    <div className="relative flex flex-col">
      {earlierCount > 0 && (
        <>
          <button
            type="button"
            aria-expanded={showEarlier}
            aria-controls={earlierId}
            onClick={() => setShowEarlier(!showEarlier)}
            className="group/fold relative flex shrink-0 cursor-pointer items-stretch gap-2.5 text-left outline-none"
          >
            <span className="relative w-5 shrink-0" aria-hidden="true">
              <span
                className={cn(
                  'absolute inset-0 transition-opacity motion-reduce:transition-none',
                  showEarlier && 'opacity-0',
                )}
              >
                <span className="absolute bottom-0.5 left-1/2 h-1.5 w-0.5 -translate-x-1/2 bg-alpha-2" />
                <span className="absolute bottom-2.5 left-1/2 h-1 w-0.5 -translate-x-1/2 bg-alpha-2 opacity-70 transition-transform motion-safe:group-hover/fold:-translate-y-px" />
                <span className="absolute bottom-4 left-1/2 h-[3px] w-0.5 -translate-x-1/2 bg-alpha-2 opacity-45 transition-transform motion-safe:group-hover/fold:-translate-y-0.5" />
                <span className="absolute bottom-[21px] left-1/2 h-0.5 w-0.5 -translate-x-1/2 bg-alpha-2 opacity-10 transition-transform motion-safe:group-hover/fold:-translate-y-0.5" />
              </span>
              <span
                className={cn(
                  'absolute bottom-0 left-1/2 top-3 w-0.5 -translate-x-1/2 bg-alpha-2',
                  !showEarlier && 'opacity-0',
                )}
              />
            </span>
            <span className="-mx-1 my-1 flex min-w-0 items-center gap-1 rounded-md px-1 text-xs leading-[1.0625rem] text-text-muted group-hover/fold:text-text-secondary group-focus-visible/fold:shadow-[var(--sidebar-focus-shadow)]">
              {showEarlier ? copy.hideEarlier : copy.earlierSteps(earlierCount)}
              <Anthropicon
                name="caretUp"
                size={12}
                className={cn(
                  'opacity-0 transition-[opacity,rotate] group-hover/fold:opacity-100 group-focus-visible/fold:opacity-100 motion-reduce:transition-none',
                  showEarlier && 'rotate-180',
                )}
              />
            </span>
          </button>
          <div
            id={earlierId}
            aria-hidden={!showEarlier || undefined}
            inert={!showEarlier || undefined}
            className="grid min-h-0 transition-[grid-template-rows] duration-200 motion-reduce:transition-none"
            style={{ gridTemplateRows: showEarlier ? '1fr' : '0fr' }}
          >
            <div className="min-h-0 overflow-hidden">
              {earlier.map((task) => (
                <TaskProgressRow
                  key={task.id}
                  task={task}
                  blockedBy={openBlockersOf(tasks, task)}
                  isFirst={false}
                  isLast={false}
                />
              ))}
            </div>
          </div>
        </>
      )}
      {recent.map((task, index) => (
        <TaskProgressRow
          key={task.id}
          task={task}
          blockedBy={openBlockersOf(tasks, task)}
          isFirst={earlierCount === 0 && index === 0}
          isLast={index === recent.length - 1}
        />
      ))}
    </div>
  );
}

function OutputFileRow({
  record,
  copy,
  onSelect,
}: {
  record: ArtifactDescriptor;
  copy: SessionPanelCopy;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={copy.openFile(record.name)}
      title={record.name}
      data-maka-output-file={record.name}
      className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-text-secondary outline-none hover:bg-sidebar-menu-hover hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
    >
      <Anthropicon
        name={/\.(?:md|markdown)$/iu.test(record.name) ? 'note' : deliveryFileGlyph(record.name)}
        size={20}
        className="shrink-0 text-text-secondary"
      />
      <span className="min-w-0 flex-1 truncate text-sm leading-5">
        {deliveryFileTitle(record.name)}
      </span>
      <span className="shrink-0 text-xs leading-[1.0625rem] text-text-muted">
        {deliveryFileExtension(record.name)}
      </span>
    </button>
  );
}

function PanelSection({
  title,
  children,
  action,
  headerClassName,
  fixed = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  headerClassName?: string;
  fixed?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const bodyId = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [minimumHeight, setMinimumHeight] = useState<number>();
  useLayoutEffect(() => {
    const header = headerRef.current;
    const content = contentRef.current;
    if (!header || !content || fixed) return;
    const measure = () => {
      if (header.getBoundingClientRect().height === 0) return;
      const limit = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 8.25;
      setMinimumHeight(
        Math.min(
          limit,
          header.getBoundingClientRect().height + content.getBoundingClientRect().height,
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(content);
    return () => observer.disconnect();
  }, [fixed]);
  return (
    <section
      style={fixed ? undefined : { minHeight: expanded ? minimumHeight : '3rem' }}
      className={cn(
        'group/panel-section relative flex flex-col overflow-hidden before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-alpha-1 first-of-type:before:hidden',
        fixed && 'shrink-0',
      )}
    >
      <div ref={headerRef} className="relative shrink-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'group/section flex w-full cursor-pointer items-center gap-1 px-4 pt-4 pb-2 text-left text-[0.8125rem] leading-[1.0625rem] font-medium text-text-primary outline-none',
            headerClassName,
            !!action && 'pr-11',
          )}
        >
          <span className="rounded-sm group-focus-visible/section:shadow-[var(--sidebar-focus-shadow)]">
            {title}
          </span>
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Anthropicon
              name="caretRight"
              size={12}
              className={cn(
                'text-text-muted opacity-0 transition-[opacity,rotate] duration-200 ease-[cubic-bezier(0,0,0.2,1)] group-hover/section:opacity-100 group-focus-visible/section:opacity-100 motion-reduce:transition-none',
                expanded && 'rotate-90',
              )}
            />
          </span>
        </button>
        {action && (
          <div className="absolute right-3 top-2.5 opacity-0 transition-opacity duration-150 group-hover/panel-section:opacity-100 group-hover/panel-section:delay-100 group-has-[:focus-visible]/panel-section:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
            {action}
          </div>
        )}
      </div>
      <div
        id={bodyId}
        aria-hidden={!expanded || undefined}
        inert={!expanded || undefined}
        className={cn(
          'grid min-h-0 transition-[grid-template-rows,padding] duration-200 motion-reduce:transition-none',
          !expanded && 'pb-2',
        )}
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 overflow-y-auto">
            {/* Keep first rows inside both clipping layers; spacing belongs to the section. */}
            <div ref={contentRef} className="px-4 pb-2">
              {children}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TaskProgressRow({
  task,
  blockedBy,
  isFirst = true,
  isLast = true,
}: {
  task: SessionTask;
  blockedBy: readonly string[];
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const completed = task.status === 'completed';
  const running = task.status === 'in_progress';
  const showMarker = !completed || isLast;
  return (
    <div
      className="relative flex items-stretch gap-2.5 py-1.5"
      data-maka-task-id={task.id}
      data-maka-task-status={task.status}
    >
      <span className="relative w-5 shrink-0 self-stretch" aria-hidden="true">
        {!(isFirst && isLast) && (
          <span
            data-maka-progress-connector=""
            className={cn(
              'absolute left-1/2 w-0.5 -translate-x-1/2 bg-alpha-2',
              isLast ? '-top-1.5 h-4' : isFirst ? 'top-2.5 -bottom-1.5' : '-top-1.5 -bottom-1.5',
            )}
          />
        )}
        {showMarker && (
          <span className="absolute left-1/2 top-2.5 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3 text-text-secondary shadow-[0_0_0_2px_var(--surface-3)]">
            {completed ? (
              <Anthropicon name="checkCircleFilled" size={16} />
            ) : (
              <span
                className={cn(
                  'size-2 rounded-full',
                  running ? 'bg-fill-brand' : 'border border-text-muted',
                )}
              />
            )}
          </span>
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-sm leading-5',
          running ? 'text-text-primary' : 'text-text-secondary',
        )}
      >
        {running ? (task.activeForm ?? task.subject) : task.subject}
        {blockedBy.length > 0 && (
          <span className="ml-1 text-xs text-text-muted">{copy.blockedBy(blockedBy)}</span>
        )}
      </span>
      {completed && <span className="sr-only">{copy.completed}</span>}
    </div>
  );
}
