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
//
// The reference's session activity panel (measured 2026-09-24): a section
// shows only when it has something in it, and a panel with nothing in any
// section is one empty state — pictogram, "Nothing here yet", one line —
// rather than a stack of headed sections each saying it is empty. Until the
// first reads settle it is a delayed skeleton. The reference's pictogram and
// clay dot are its own artwork; Maka draws an icon and a brand-coloured dot.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ArtifactDescriptor } from '@maka/core/artifacts';
import type { SessionTask } from '@maka/core/session-task';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import { TextShimmer } from '../ui/text-shimmer.js';
import { SessionUploadsDialog } from './SessionUploadsDialog.js';
import { cn } from '../../lib/cn.js';
import { openBlockersOf, useTaskProgress } from '../../hooks/use-task-progress.js';
import { useSessionArtifacts } from '../../hooks/use-session-artifacts.js';
import { openWorkbarArtifact } from '../../hooks/use-workbar.js';
import { useShellLiveTurn } from '../../hooks/use-workspace.js';
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
  onFirstContent,
  onPointerEnter,
  onPointerLeave,
}: {
  sessionId: string;
  onClose: () => void;
  hidden?: boolean;
  peek?: boolean;
  /** The session has tasks, outputs or uploads: the shell may open the panel, once. */
  onFirstContent?: (sessionId: string) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const progress = useTaskProgress(sessionId);
  const files = useSessionArtifacts(sessionId);
  // Whether the running task is being worked on right now: its dot breathes
  // and its name sweeps only while a turn is live. Otherwise it has stopped.
  const live = useShellLiveTurn(sessionId).turnActive;
  const showProgress = progress.tasks.length > 0 || progress.status === 'error';
  const showOutputs = files.records.length > 0 || Boolean(files.error);
  const showUploads = files.uploads.length > 0;
  const settled = progress.status !== 'loading' && progress.status !== 'idle' && files.loaded;
  const nothing = !showProgress && !showOutputs && !showUploads;
  const hasContent =
    progress.tasks.length > 0 || files.records.length > 0 || files.uploads.length > 0;
  useEffect(() => {
    if (hasContent) onFirstContent?.(sessionId);
  }, [hasContent, onFirstContent, sessionId]);
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
            {nothing && !settled && <PanelSkeleton copy={copy} />}
            {nothing && settled && <PanelEmptyState copy={copy} />}
            {showProgress && (
              <PanelSection title={copy.progress} underClose={!peek}>
                {progress.tasks.length === 0 ? (
                  <p className="py-1 text-sm leading-5 text-text-muted">{copy.unavailable}</p>
                ) : (
                  <ProgressSteps tasks={progress.tasks} copy={copy} live={live} />
                )}
              </PanelSection>
            )}
            {showOutputs && (
              <PanelSection
                title={copy.outputs}
                underClose={!peek && !showProgress}
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
                    {copy.outputsUnavailable}
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
            )}
            {showUploads && (
              <PanelSection
                title={copy.usedInSession}
                underClose={!peek && !showProgress && !showOutputs}
                fixed
              >
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

/** Finished tasks at the head of the list fold away, all but the last two. */
const FOLD_KEEP = 2;

function foldedCount(tasks: readonly SessionTask[]): number {
  let done = 0;
  while (done < tasks.length && tasks[done]!.status === 'completed') done++;
  return Math.max(0, done - FOLD_KEEP);
}

/**
 * How much of each step's rail the work has walked: every step up to the last
 * one begun, the running one only as far as its dot, none past it — and none
 * at all once everything is done, when the list is a record, not a race.
 */
type RailWalk = 'whole' | 'toKnob' | 'none';

function railWalks(tasks: readonly SessionTask[]): readonly RailWalk[] {
  let reached = -1;
  if (!tasks.every((task) => task.status === 'completed')) {
    for (let index = tasks.length - 1; index >= 0; index--) {
      if (tasks[index]!.status !== 'pending') {
        reached = index;
        break;
      }
    }
  }
  return tasks.map((task, index) =>
    index > reached
      ? 'none'
      : index === reached && task.status === 'in_progress'
        ? 'toKnob'
        : 'whole',
  );
}

/**
 * The task list — the reference's flat progress list. One rail runs down the
 * left; the only mark on it while work goes on is the running task's dot.
 * Finished steps go quiet, the running one is the darkest line, the rest wait
 * in the middle ink. When all are done the list settles: every line back in
 * the middle ink, a check at the foot.
 */
export function ProgressSteps({
  tasks,
  copy,
  live = true,
}: {
  tasks: readonly SessionTask[];
  copy: SessionPanelCopy;
  /** A turn is running: the running task's dot breathes and its name sweeps. */
  live?: boolean;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const earlierId = useId();
  const earlierCount = foldedCount(tasks);
  const allDone = tasks.every((task) => task.status === 'completed');
  const walks = railWalks(tasks);
  // What the list looked like when it last drew: a task it did not have
  // enters, and a dot that was not running pops in. The first draw has seen
  // everything, so opening the panel replays nothing.
  const drawn = useRef(tasks);
  useEffect(() => {
    drawn.current = tasks;
  }, [tasks]);
  const before = new Map(drawn.current.map((task) => [task.id, task.status]));
  if (earlierCount === 0 && showEarlier) setShowEarlier(false);

  const row = (task: SessionTask, index: number, inFold: boolean) => (
    <TaskProgressRow
      key={task.id}
      task={task}
      blockedBy={openBlockersOf(tasks, task)}
      isFirst={index === 0}
      isLast={index === tasks.length - 1}
      allDone={allDone}
      walked={walks[index] ?? 'none'}
      live={live}
      inFold={inFold}
      enter={!inFold && !before.has(task.id)}
      knobEnter={!inFold && before.get(task.id) !== 'in_progress'}
    />
  );

  return (
    <div className="relative flex flex-col">
      {earlierCount > 0 && (
        <>
          <EarlierSteps
            count={earlierCount}
            expanded={showEarlier}
            walked={!allDone}
            controls={earlierId}
            onToggle={() => setShowEarlier(!showEarlier)}
            copy={copy}
          />
          <div
            id={earlierId}
            inert={!showEarlier || undefined}
            className={cn(
              'relative grid min-h-0 content-end transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
              showEarlier ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div
              className={cn(
                'flex min-h-0 flex-col justify-end overflow-hidden transition-opacity motion-reduce:transition-none',
                showEarlier ? 'duration-200 ease-out' : 'opacity-0 duration-150',
              )}
            >
              {tasks.slice(0, earlierCount).map((task, index) => row(task, index, true))}
            </div>
            {/* The folded steps share one rail rather than drawing one each. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-2.5 w-0.5 -translate-x-1/2 bg-alpha-2"
            >
              {!allDone && <span className="absolute inset-0 bg-alpha-3" />}
            </span>
          </div>
        </>
      )}
      {tasks.slice(earlierCount).map((task, index) => row(task, earlierCount + index, false))}
    </div>
  );
}

/** The fold's dashes, bottom up: the rail thinning out into what came before. */
const FOLD_DASHES = [
  'bottom-0.5 h-1.5',
  'bottom-2.5 h-1 motion-safe:group-hover/fold:-translate-y-px',
  'bottom-4 h-[3px] motion-safe:group-hover/fold:-translate-y-0.5',
  'bottom-[21px] h-0.5 motion-safe:group-hover/fold:-translate-y-0.5',
] as const;
const FOLD_DASH_FADE = ['', 'opacity-70', 'opacity-45', 'opacity-25'] as const;

function EarlierSteps(props: {
  count: number;
  expanded: boolean;
  walked: boolean;
  controls: string;
  onToggle: () => void;
  copy: SessionPanelCopy;
}) {
  const walkedFill = props.walked && <span className="absolute inset-0 bg-alpha-3" />;
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      onClick={props.onToggle}
      className="group/fold relative flex shrink-0 cursor-pointer items-stretch gap-2.5 text-left outline-none"
    >
      <span className="relative w-5 shrink-0" aria-hidden="true">
        <span
          className={cn(
            'absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
            props.expanded && 'opacity-0',
          )}
        >
          {/* One dash per folded step, up to four; past four the last one
              fades further, reading as "and more". */}
          {FOLD_DASHES.slice(0, props.count).map((dash, index) => (
            <span
              key={dash}
              className={cn(
                'absolute left-1/2 w-0.5 -translate-x-1/2 bg-alpha-2 transition-transform duration-150 motion-reduce:transition-none',
                dash,
                props.count > FOLD_DASHES.length && index === FOLD_DASHES.length - 1
                  ? 'opacity-10'
                  : FOLD_DASH_FADE[index],
              )}
            >
              {walkedFill}
            </span>
          ))}
        </span>
        <span
          className={cn(
            'absolute bottom-0 left-1/2 top-3 w-0.5 -translate-x-1/2 bg-alpha-2 transition-opacity duration-200 ease-out motion-reduce:transition-none',
            !props.expanded && 'opacity-0',
          )}
        >
          {walkedFill}
        </span>
      </span>
      <span className="-mx-1 my-1 flex min-w-0 items-center gap-1 rounded-md px-1 text-xs leading-[1.0625rem] text-text-muted transition-colors duration-150 group-hover/fold:text-text-secondary group-focus-visible/fold:text-text-secondary group-focus-visible/fold:shadow-[var(--sidebar-focus-shadow)] motion-reduce:transition-none">
        {props.expanded ? props.copy.hideEarlier : props.copy.earlierSteps(props.count)}
        <Anthropicon
          name="caretUp"
          size={12}
          className={cn(
            'shrink-0 transition-[opacity,rotate] duration-150 motion-reduce:transition-none',
            props.expanded
              ? 'rotate-180'
              : 'opacity-0 group-hover/fold:opacity-100 group-focus-visible/fold:opacity-100',
          )}
        />
      </span>
    </button>
  );
}

/** Nothing in any section yet: one empty state for the whole panel. */
function PanelEmptyState({ copy }: { copy: SessionPanelCopy }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 px-3 py-12 text-center text-sm leading-5 text-balance"
      data-maka-session-panel-empty=""
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-xl bg-alpha-1 text-text-muted"
      >
        <Anthropicon name="tasks" size={24} />
      </span>
      <h3 className="max-w-xs font-medium text-text-secondary">{copy.emptyTitle}</h3>
      <p className="max-w-xs text-[0.8125rem] leading-[1.0625rem] text-text-secondary">
        {copy.emptyBody}
      </p>
    </div>
  );
}

/** The first reads have not settled: three bars, shown only if they take a while. */
function PanelSkeleton({ copy }: { copy: SessionPanelCopy }) {
  return (
    <div aria-busy="true" className="animate-placeholder-reveal flex flex-col">
      <span className="sr-only">{copy.loading}</span>
      {[60, 56, 52].map((width) => (
        <div key={width} aria-hidden="true" className="p-3">
          <Skeleton className="my-[3px] h-3.5" style={{ width }} />
        </div>
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
  underClose = false,
  fixed = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** The first section sits under the close button: its header and action make room for it. */
  underClose?: boolean;
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
            (underClose || !!action) && 'pr-11',
            underClose && !!action && 'pr-[4.5rem]',
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
          <div
            data-maka-section-action=""
            className={cn(
              'absolute top-2.5 opacity-0 transition-opacity duration-150 group-hover/panel-section:opacity-100 group-hover/panel-section:delay-100 group-has-[:focus-visible]/panel-section:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none',
              underClose ? 'right-11' : 'right-3',
            )}
          >
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
  allDone = false,
  walked = 'none',
  live = true,
  inFold = false,
  enter = false,
  knobEnter = false,
}: {
  task: SessionTask;
  blockedBy: readonly string[];
  isFirst?: boolean;
  isLast?: boolean;
  /** Every task in the list is done: finished rows keep the middle ink and the last gets a check. */
  allDone?: boolean;
  walked?: RailWalk;
  live?: boolean;
  /** Folded away under "N earlier steps": the fold draws the rail for it. */
  inFold?: boolean;
  /** New since the list last drew: the words rise in and the rail grows. */
  enter?: boolean;
  /** Its dot was not running when the list last drew: the dot pops in. */
  knobEnter?: boolean;
}) {
  const copy = getSessionPanelCopy(useUiLocale());
  const completed = task.status === 'completed';
  const running = task.status === 'in_progress';
  // Captured when the row mounts, so a row animates once, as it arrives.
  const [entered] = useState(enter);
  const label = running ? (task.activeForm ?? task.subject) : task.subject;
  return (
    <div
      className="relative flex items-stretch gap-2.5 py-1.5"
      data-maka-task-id={task.id}
      data-maka-task-status={task.status}
    >
      {inFold ? (
        <span aria-hidden="true" className="w-5 shrink-0" />
      ) : (
        <TaskRail
          current={running}
          walked={walked}
          isFirst={isFirst}
          isLast={isLast}
          finished={allDone && isLast}
          live={live}
          enter={enter}
          knobEnter={knobEnter}
        />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 text-sm leading-5 transition-colors duration-200 ease-out motion-reduce:transition-none',
          entered && 'animate-progress-step-in',
          completed && !allDone
            ? 'text-text-muted'
            : running
              ? 'text-[var(--progress-current-text)]'
              : 'text-text-secondary',
        )}
      >
        {running && live ? (
          <TextShimmer className="block [--base-color:var(--progress-current-text)]">
            {label}
          </TextShimmer>
        ) : (
          label
        )}
        {blockedBy.length > 0 && (
          <span className="ml-1 text-xs text-text-muted">{copy.blockedBy(blockedBy)}</span>
        )}
      </span>
      <span className="sr-only">
        {', '}
        {completed
          ? copy.taskState.completed
          : running
            ? live
              ? copy.taskState.running
              : copy.taskState.stopped
            : copy.taskState.pending}
      </span>
    </div>
  );
}

/**
 * A step's stretch of the rail. It starts at the first step's words and ends
 * at the last step's; a finished list stops it at the check instead. The
 * walked part is drawn darker over it.
 */
function TaskRail(props: {
  current: boolean;
  walked: RailWalk;
  isFirst: boolean;
  isLast: boolean;
  finished: boolean;
  live: boolean;
  enter: boolean;
  knobEnter: boolean;
}) {
  const [grow] = useState(props.enter);
  return (
    <span aria-hidden="true" className="relative w-5 shrink-0 self-stretch">
      <span
        data-maka-progress-rail=""
        className={cn(
          'absolute left-1/2 w-0.5 -translate-x-1/2 bg-alpha-2',
          grow && 'origin-top animate-progress-rail-grow',
          props.isFirst ? 'top-0' : '-top-1.5',
          props.finished
            ? props.isFirst
              ? 'h-2.5'
              : 'h-4'
            : props.isLast
              ? 'bottom-0'
              : '-bottom-1.5',
        )}
      >
        {props.walked === 'whole' && <span className="absolute inset-0 bg-alpha-3" />}
        {props.walked === 'toKnob' && (
          <span
            className={cn('absolute inset-x-0 top-0 bg-alpha-3', props.isFirst ? 'h-2.5' : 'h-4')}
          />
        )}
      </span>
      {props.current && <TaskKnob live={props.live} enter={props.knobEnter} />}
      {props.finished && (
        <span className="absolute left-1/2 top-2.5 flex -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface-3 text-text-secondary shadow-[0_0_0_2px_var(--surface-3)]">
          <Anthropicon name="checkCircleFilled" size={16} />
        </span>
      )}
    </span>
  );
}

/**
 * The running task's dot: a brand-coloured dot, breathing, while a turn works
 * on it; a small muted dot once the turn has ended with it unfinished.
 */
function TaskKnob(props: { live: boolean; enter: boolean }) {
  const [pop] = useState(props.enter);
  const place =
    'absolute left-1/2 top-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_var(--surface-3)]';
  return props.live ? (
    <span
      data-maka-progress-knob="live"
      className={cn(place, 'bg-surface-3', pop && 'animate-progress-knob-in')}
    >
      <span className="animate-progress-dot-breathe block size-2 rounded-full bg-fill-brand" />
    </span>
  ) : (
    <span
      data-maka-progress-knob="stopped"
      className={cn(
        place,
        'size-[7px] bg-current text-text-muted',
        pop && 'animate-progress-knob-in',
      )}
    />
  );
}
