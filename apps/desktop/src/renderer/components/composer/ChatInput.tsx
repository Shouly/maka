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

// The composer (relx `ChatInput`, over Maka's send pipeline). One component
// serves both surfaces:
//
//   welcome  no `sessionId`; the first send creates the Session, moves the
//            draft to it, applies the settings the welcome row collected
//            (workspace, model, permission, thinking, plan) and selects it;
//   session  `sessionId`; sends go straight to the Session, and while a turn
//            runs they can steer the current answer or wait for the next.
//
// Layout, top to bottom inside the white surface: staged attachments, folder
// references and quotes as chips; the TipTap editor; the control row with
// attach / folder / skills on the left, mode chips in the middle, and stop or
// send on the right. Status and errors sit under the surface.
//
// Everything the user typed is in `composerInputStore` (keyed per Session or
// per new-task target), never in component state, so switching Sessions and
// coming back finds the draft where it was. Quotes are in
// `composerDraftStore`, which the transcript's selection-quote writes into.
//
// Failure model of a send: the draft is never cleared until the Host has
// acknowledged the message, and only what was sent is removed (typing that
// happened meanwhile stays). An `outcome_unknown` keeps the draft and its
// admission id, so retrying cannot deliver the message twice.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useStore } from 'zustand';
import type { Editor } from '@tiptap/core';
import type { PermissionMode } from '@maka/core/permission';
import type { ThinkingLevel } from '@maka/core/model-thinking';
import { attachmentKindFromMimeType, guessMimeFromName } from '@maka/core/attachments';
import { getConversationCopy, useUiLocale, useComposerHistory } from '@maka/ui';
import {
  composerInputStore,
  EMPTY_INPUT,
  type InputDraft,
} from '../../store/composer-input-store.js';
import { composerDraftStore, type PendingQuote } from '../../store/composer-draft-store.js';
import { sessionsStore, turnActionsStore, connectionsStore } from '../../store/index.js';
import { newTaskStore } from '../../store/new-task-store.js';
import { pendingActionsOf } from '../../store/turn-actions-store.js';
import { serializeComposer } from '../../lib/composer-document.js';
import {
  COMPOSER_META_CHIP,
  COMPOSER_META_CHIP_ACTIVE,
  COMPOSER_META_CHIP_IDLE,
  COMPOSER_SHADOW_CLASS,
} from '../../lib/composer-surface.js';
import { preflightAttachmentItems } from '../../lib/ported/attachment-preflight.js';
import {
  toComposerIngestItems,
  retainedAttachmentRefs,
  type PendingAttachment,
} from '../../lib/ported/composer-attachments.js';
import {
  pickAttachmentFiles,
  pickAttachmentDirectory,
  previewAttachmentApproval,
} from '../../bridge/attachments.js';
import { getTaskReadinessSnapshot } from '../../bridge/task-readiness.js';
import { getNewTaskReadiness, type DesktopNewTaskTarget } from '../../bridge/new-tasks.js';
import { removeSession } from '../../bridge/sessions.js';
import { armGoal, getGoal } from '../../bridge/goal.js';
import { getComposerCopy } from '../../locales/composer-copy.js';
import { ComposerSelect } from './ComposerSelect.js';
import { TipTapEditor } from './TipTapEditor.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { WorkspacePicker } from '../welcome/WorkspacePicker.js';
import { ModelPicker } from '../welcome/ModelPicker.js';
import { ContextUsageIndicator } from '../session/notices/ContextUsageIndicator.js';
import { cn } from '../../lib/cn.js';

const NO_QUOTES: readonly PendingQuote[] = [];
const MAX_DIRECTORY_REFERENCES = 4;

/** The welcome composer's draft key: one draft per new-task target. */
export const newComposerKey = (target: DesktopNewTaskTarget | undefined) =>
  `new:${JSON.stringify(target ?? null)}`;

/** relx: 32px ghost icon control, muted until hovered. */
const ICON_CONTROL_CLASS =
  'ui-control-squish ui-control-squish-ghost flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-muted outline-none hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50';

/** relx chip remove button: 24px, muted, hover fill. */
const CHIP_REMOVE_CLASS =
  'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition duration-300 hover:bg-alpha-1 hover:text-text-primary active:scale-95 outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-40';

const CHIP_CLASS =
  'flex max-w-72 items-center gap-1.5 rounded-lg bg-alpha-1 py-1 pl-2 pr-1 text-xs text-text-secondary';

export function ChatInput(props: {
  label?: string;
  sessionId?: string;
  running?: boolean;
  onError?: (title: string, error: unknown) => void;
  onOpenSettings?: () => void;
}) {
  const target = useStore(newTaskStore, (s) => s.target);
  const key = props.sessionId ?? newComposerKey(target);
  // Re-key on scope change so no state leaks from one draft to the next.
  return <OwnedChatInput key={key} {...props} scopeKey={key} target={target} />;
}

function OwnedChatInput(props: {
  label?: string;
  scopeKey: string;
  sessionId?: string;
  target?: DesktopNewTaskTarget;
  running?: boolean;
  onError?: (title: string, error: unknown) => void;
  onOpenSettings?: () => void;
}) {
  const { scopeKey, sessionId } = props;
  const locale = useUiLocale();
  const copy = getComposerCopy(locale);
  const common = getConversationCopy(locale);

  const draft = useStore(composerInputStore, (s) => s.drafts[scopeKey] ?? EMPTY_INPUT);
  const quotes = useStore(composerDraftStore, (s) => s.quotes[scopeKey] ?? NO_QUOTES);
  const session = useStore(sessionsStore, (s) => s.sessions.find((row) => row.id === sessionId));
  const newTask = useStore(newTaskStore);
  const connections = useStore(connectionsStore, (s) => s.data);
  const pending = useStore(turnActionsStore, (s) => pendingActionsOf(s, sessionId));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string }>();
  const [placement, setPlacement] = useState<'current_turn' | 'next_turn'>('current_turn');

  const editor = useRef<Editor | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Readiness is checked up front so the blocked hint appears before the
  // user types, and again at send time because it can change meanwhile.
  const [ready, setReady] = useState<boolean>();
  useEffect(() => {
    let current = true;
    setReady(undefined);
    const read = sessionId
      ? getTaskReadinessSnapshot(undefined, sessionId)
      : props.target
        ? getNewTaskReadiness(props.target, {
            connectionSlug: newTask.model?.llmConnectionSlug,
            model: newTask.model?.model,
          })
        : Promise.resolve(undefined);
    void read
      .then((snapshot) => {
        if (current) setReady(snapshot?.state === 'ready');
      })
      .catch(() => {
        if (current) setReady(false);
      });
    return () => {
      current = false;
    };
  }, [sessionId, session?.revision, newTask.model?.llmConnectionSlug, newTask.model?.model]);

  const wire = serializeComposer(draft.document);
  const patch = (update: Partial<InputDraft>) => composerInputStore.patch(scopeKey, update);

  const history = useComposerHistory({
    text: {
      getValue: () => serializeComposer(composerInputStore.read(scopeKey).document).text,
      setValue: (value) => composerInputStore.setText(scopeKey, value),
    },
    // The input store persists on its own; nothing extra to save here.
    saveCurrentDraft: () => {},
  });

  const report = (cause: unknown, title = copy.send.failedTitle) => {
    if (!mounted.current) return;
    setError(cause instanceof Error ? cause.message : String(cause));
    props.onError?.(title, cause);
  };

  // Settings shown in the control row: the Session's own once it exists,
  // the draft's until then.
  const mode = session?.permissionMode ?? draft.permission;
  const plan = session ? session.collaborationMode === 'plan' : draft.plan;
  const activeChoice = (session ? connections : newTask.connections)?.chatModelChoices.find(
    (choice) =>
      choice.connectionSlug === (session?.llmConnectionSlug ?? newTask.model?.llmConnectionSlug) &&
      choice.model === (session?.model ?? newTask.model?.model),
  );
  const thinkingLevels = activeChoice?.thinkingLevels ?? [];

  const disabled = busy || pending.includes('send');
  const hasContent = Boolean(wire.text) || draft.attachments.length > 0;
  const blocked =
    !sessionId && !props.target
      ? copy.send.blockedNoWorkspace
      : !sessionId && !newTask.model
        ? copy.send.blockedNoModel
        : ready === false
          ? copy.send.blockedReadiness
          : undefined;
  const canSend = !disabled && !blocked && hasContent;

  // -------------------------------------------------------------------------
  // Send

  async function submit() {
    if (lock.current || blocked || !hasContent) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    setPreview(undefined);

    // Snapshot what is being sent; the store may change while we await.
    const sent = composerInputStore.read(scopeKey);
    const serialized = serializeComposer(sent.document);
    const sentQuotes = [...quotes];
    let owner = sessionId;
    try {
      preflightAttachmentItems(sent.attachments, locale);

      if (serialized.text === '/compact') {
        if (!owner || props.running) throw new Error(copy.slash.notYet);
        await turnActionsStore.compact(owner);
        composerInputStore.acknowledge(scopeKey, sent);
        return;
      }
      if (/^\/(?:side|graph|swarm)(?:\s|$)/.test(serialized.text)) {
        throw new Error(copy.slash.notYet);
      }

      const readiness = owner
        ? await getTaskReadinessSnapshot(undefined, owner)
        : await getNewTaskReadiness(props.target!, {
            connectionSlug: newTask.model?.llmConnectionSlug,
            model: newTask.model?.model,
          });
      if (!mounted.current) return;
      if (readiness.state !== 'ready') throw new Error(copy.send.blockedReadiness);

      const messageId = composerInputStore.reserveIntent(scopeKey, sent.revision);

      if (!owner) {
        const created = await newTaskStore.create();
        if (!mounted.current) {
          // The user left the welcome surface mid-creation; do not leave an
          // empty Session behind.
          await removeSession(created.id);
          return;
        }
        owner = created.id;
        sessionsStore.upsert(created);
        // The draft and its quotes now belong to the Session.
        composerInputStore.transfer(scopeKey, owner);
        composerDraftStore.transferQuotes(scopeKey, owner);
        if (sent.permission !== created.permissionMode) {
          await turnActionsStore.setPermission(owner, sent.permission);
        }
        if (sent.thinking) await turnActionsStore.setThinking(owner, sent.thinking);
        if (sent.plan) await turnActionsStore.setCollaboration(owner, 'plan');
        sessionsStore.select(owner);
      }

      const result = await turnActionsStore.submit(
        owner,
        props.running ? placement : 'current_turn',
        {
          text: serialized.text,
          skillIds: serialized.skillIds,
          workspaceFileReferences: serialized.workspaceFileReferences,
          attachmentItems: toComposerIngestItems(sent.attachments),
          retainedAttachments: retainedAttachmentRefs(sent.attachments),
          directoryReferences: [...sent.directories],
          quotes: sentQuotes.map(({ id: _id, ...quote }) => quote),
          messageId,
        },
      );
      // After a transfer the draft lives under the new Session's key.
      const draftOwner = sessionId ? scopeKey : owner;
      if (!result.ok) {
        throw new Error(
          result.reason === 'outcome_unknown'
            ? copy.send.outcomeUnknownDescription
            : copy.send.skillFailedFallback,
        );
      }
      composerInputStore.acknowledge(draftOwner, sent);
      for (const quote of sentQuotes) composerDraftStore.removeQuote(draftOwner, quote.id);
      history.rememberSentEntry(serialized.text);
      if (mounted.current && result.disposition === 'steering') {
        setStatus(copy.send.steeredTitle);
      }
    } catch (cause) {
      // A failed first send still leaves a real, selected Session with the
      // draft in it — never an invisible lost message.
      if (!sessionId && owner && mounted.current) sessionsStore.select(owner);
      composerInputStore.patch(owner && !sessionId ? owner : scopeKey, {
        error: cause instanceof Error ? cause.message : copy.send.failedFallback,
      });
      report(cause);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Attachments, folders, quotes

  const appendAttachments = (items: PendingAttachment[]) => {
    const all = [...composerInputStore.read(scopeKey).attachments, ...items];
    try {
      preflightAttachmentItems(all, locale);
      patch({ attachments: all });
    } catch (cause) {
      for (const item of items) {
        if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      }
      throw cause;
    }
  };

  /** Files from a drop or a paste. */
  const stageFiles = (files: readonly File[]) => {
    if (disabled || props.running) {
      report(new Error(copy.drop.rejectedWhileRunning), copy.attachments.pickFailedTitle);
      return;
    }
    try {
      const items = files.map((file) => {
        const mimeType = file.type || guessMimeFromName(file.name);
        return {
          stagingKey: crypto.randomUUID(),
          displayName: file.name,
          mimeType,
          size: file.size,
          kind: attachmentKindFromMimeType(mimeType),
          source: { type: 'file' as const, file },
        };
      });
      preflightAttachmentItems([...draft.attachments, ...items], locale);
      appendAttachments(
        items.map((item) => ({
          ...item,
          ...(item.kind === 'image' ? { previewUrl: URL.createObjectURL(item.source.file) } : {}),
        })),
      );
      setStatus(copy.drop.announceDrop(files.length));
    } catch (cause) {
      report(cause, copy.attachments.pickFailedTitle);
    }
  };

  /** Files from the native picker: main hands back approval ids, not bytes. */
  async function pickFiles() {
    try {
      const result = await pickAttachmentFiles();
      if (!mounted.current || !result.ok) return;
      appendAttachments(
        result.files.map((file) => ({
          stagingKey: crypto.randomUUID(),
          displayName: file.name,
          mimeType: file.mimeType,
          size: file.size,
          kind: attachmentKindFromMimeType(file.mimeType ?? guessMimeFromName(file.name)),
          source: { type: 'approval', approvalId: file.approvalId, name: file.name },
        })),
      );
    } catch (cause) {
      report(cause, copy.attachments.pickFailedTitle);
    }
  }

  async function openPreview(item: PendingAttachment) {
    try {
      if (item.previewUrl) {
        setPreview({ name: item.displayName, url: item.previewUrl });
        return;
      }
      if (item.source.type === 'approval') {
        const result = await previewAttachmentApproval(item.source.approvalId);
        if (!mounted.current) return;
        if (result.ok && result.mimeType.startsWith('image/')) {
          setPreview({
            name: item.displayName,
            url: `data:${result.mimeType};base64,${result.base64}`,
          });
          return;
        }
      }
      throw new Error(copy.attachments.previewUnavailable);
    } catch (cause) {
      report(cause);
    }
  }

  async function pickDirectory() {
    try {
      const result = await pickAttachmentDirectory();
      if (!mounted.current || !result.ok) return;
      const current = composerInputStore.read(scopeKey).directories;
      const duplicate = current.some(
        (d) => d.hostId === result.reference.hostId && d.path === result.reference.path,
      );
      if (duplicate) return;
      if (current.length >= MAX_DIRECTORY_REFERENCES) {
        throw new Error(copy.directories.limitReached);
      }
      patch({ directories: [...current, result.reference] });
    } catch (cause) {
      report(cause, copy.directories.pickFailedTitle);
    }
  }

  // -------------------------------------------------------------------------
  // Mode controls

  const setMode = async (permission: PermissionMode) => {
    try {
      if (sessionId) await turnActionsStore.setPermission(sessionId, permission);
      else patch({ permission });
    } catch (cause) {
      report(cause, copy.permission.changeFailedTitle);
      throw cause;
    }
  };

  const setThinking = (level: ThinkingLevel | undefined) => {
    if (sessionId) void turnActionsStore.setThinking(sessionId, level).catch(report);
    else patch({ thinking: level });
  };

  const togglePlan = () => {
    if (sessionId) {
      void turnActionsStore.setCollaboration(sessionId, plan ? 'agent' : 'plan').catch(report);
    } else {
      patch({ plan: !plan });
    }
  };

  const hasChips =
    draft.attachments.length > 0 || draft.directories.length > 0 || quotes.length > 0;

  return (
    <div
      className="relative flex flex-col gap-2"
      aria-label={copy.surfaceLabel}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDropCapture={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        stageFiles(Array.from(event.dataTransfer.files));
      }}
      onPasteCapture={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length === 0) return;
        event.preventDefault();
        stageFiles(files);
      }}
    >
      <TooltipProvider delayDuration={300}>
        <div
          className={cn(
            'chat-composer-surface relative z-10 flex w-full flex-col gap-2 transition-shadow duration-200 ease-out',
            dragging ? 'shadow-[var(--composer-shadow-drag)]' : COMPOSER_SHADOW_CLASS,
          )}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--chat-composer-radius)] border border-dashed border-accent-fill bg-accent-fill/30 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-accent">
                <Anthropicon name="upload" size={20} />
                <p>{copy.drop.overlay}</p>
              </div>
            </div>
          )}

          {hasChips && (
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              {draft.attachments.length > 0 && (
                <ul aria-label={copy.attachments.regionLabel} className="contents">
                  {draft.attachments.map((item) => (
                    <li key={item.stagingKey} className={CHIP_CLASS}>
                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt=""
                          className="size-6 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <Anthropicon
                          name={item.kind === 'image' ? 'image' : 'file'}
                          size={16}
                          className="shrink-0 text-text-muted"
                        />
                      )}
                      <button
                        type="button"
                        disabled={item.kind !== 'image'}
                        aria-label={copy.attachments.open(item.displayName)}
                        onClick={() => void openPreview(item)}
                        className="min-w-0 truncate text-left outline-none enabled:cursor-pointer enabled:hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                      >
                        {item.displayName}
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={copy.attachments.remove(item.displayName)}
                        onClick={() =>
                          composerInputStore.removeAttachment(scopeKey, item.stagingKey)
                        }
                        className={CHIP_REMOVE_CLASS}
                      >
                        <Anthropicon name="x" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {draft.directories.length > 0 && (
                <ul aria-label={copy.directories.regionLabel} className="contents">
                  {draft.directories.map((directory) => (
                    <li key={`${directory.hostId}:${directory.path}`} className={CHIP_CLASS}>
                      <Anthropicon name="folder" size={16} className="shrink-0 text-text-muted" />
                      <span className="min-w-0 truncate" title={directory.path}>
                        {directory.path}
                      </span>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={copy.directories.remove(directory.path)}
                        onClick={() =>
                          patch({ directories: draft.directories.filter((d) => d !== directory) })
                        }
                        className={CHIP_REMOVE_CLASS}
                      >
                        <Anthropicon name="x" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {quotes.length > 0 && (
                <ul aria-label={copy.quotes.regionLabel} className="contents">
                  {quotes.map((quote) => (
                    <li key={quote.id} className={CHIP_CLASS}>
                      <Anthropicon name="reply" size={16} className="shrink-0 text-text-muted" />
                      <span className="min-w-0 truncate" title={quote.text}>
                        {quote.text}
                      </span>
                      <button
                        type="button"
                        aria-label={copy.quotes.remove(quote.text)}
                        onClick={() => composerDraftStore.removeQuote(scopeKey, quote.id)}
                        className={CHIP_REMOVE_CLASS}
                      >
                        <Anthropicon name="x" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <TipTapEditor
            scopeKey={scopeKey}
            sessionId={sessionId}
            target={props.target}
            document={draft.document}
            onChange={(document) => {
              patch({ document, error: undefined });
              setError('');
              history.resetNavigation();
            }}
            onEditor={(value) => {
              editor.current = value;
            }}
            onSubmit={() => void submit()}
            onCommand={(command) => {
              if (command === 'compact' && sessionId) {
                void turnActionsStore.compact(sessionId).catch(report);
              }
            }}
            onArrow={(event) =>
              history.handleArrowKey(event as unknown as ReactKeyboardEvent<Element>)
            }
            disabled={disabled}
            running={props.running}
            label={props.label ?? common.composer.textareaAriaLabel}
            placeholder={common.composer.placeholder}
          />

          <div className="flex flex-wrap items-center gap-1">
            <IconControl
              icon="attach"
              label={common.composer.addFileOrDirectory}
              disabled={disabled || props.running}
              onClick={() => void pickFiles()}
            />
            <IconControl
              icon="folder"
              label={common.composer.referenceFolder}
              disabled={disabled || props.running}
              onClick={() => void pickDirectory()}
            />
            <IconControl
              icon="shapes"
              label={common.composer.chooseSkill}
              disabled={disabled}
              onClick={() => editor.current?.chain().focus().insertContent('/').run()}
            />

            {!sessionId && (
              <>
                <WorkspacePicker />
                <ModelPicker onOpenSettings={props.onOpenSettings ?? (() => {})} />
              </>
            )}

            <ComposerSelect
              label={common.permissions.modeAriaLabel(common.permissions.mode[mode].label)}
              value={mode}
              disabled={disabled || props.running || pending.includes('permission')}
              onChange={(value) => {
                const next = value as PermissionMode;
                // Full access is confirmed first; the dialog applies it.
                if (next === 'bypass') setBypassOpen(true);
                else void setMode(next).catch(() => {});
              }}
              options={(['explore', 'ask', 'bypass'] as const).map((value) => ({
                value,
                label: common.permissions.mode[value].label,
              }))}
            />
            {thinkingLevels.length > 0 && (
              <ComposerSelect
                label={common.model.thinkingLevel}
                value={session?.thinkingLevel ?? draft.thinking ?? ''}
                disabled={disabled || props.running || pending.includes('thinking')}
                onChange={(value) => setThinking((value || undefined) as ThinkingLevel | undefined)}
                options={[
                  { value: '', label: common.model.defaultLevel },
                  ...thinkingLevels.map((level) => ({
                    value: level,
                    label: common.model.level[level],
                  })),
                ]}
              />
            )}
            <button
              type="button"
              aria-pressed={plan}
              disabled={disabled || props.running}
              onClick={togglePlan}
              className={cn(
                COMPOSER_META_CHIP,
                plan ? COMPOSER_META_CHIP_ACTIVE : COMPOSER_META_CHIP_IDLE,
              )}
            >
              {common.composer.planModeLabel}
            </button>
            <GoalControl
              sessionId={sessionId}
              disabled={disabled || props.running || Boolean(blocked)}
              busy={busy}
              onBusy={(value) => {
                lock.current = value;
                setBusy(value);
              }}
              onStatus={setStatus}
              onError={report}
            />
            {sessionId && <ContextUsageIndicator sessionId={sessionId} />}

            <span className="ml-auto flex items-center gap-1">
              {props.running && (
                <>
                  <ComposerSelect
                    label={common.composer.queuedMessagesAriaLabel(1)}
                    value={placement}
                    onChange={(value) => setPlacement(value as typeof placement)}
                    options={[
                      { value: 'current_turn', label: copy.send.currentTurn },
                      { value: 'next_turn', label: copy.send.nextTurn },
                    ]}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={common.composer.stopLabel}
                        disabled={pending.includes('stop')}
                        onClick={() => {
                          if (!sessionId) return;
                          void turnActionsStore
                            .stop(sessionId, { source: 'stop_button' })
                            .catch(report);
                        }}
                        className="ui-control-squish ui-control-squish-flat flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-70"
                      >
                        <Anthropicon name="stopCircle" size={20} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{common.composer.stopLabel}</TooltipContent>
                  </Tooltip>
                </>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={common.composer.sendLabel}
                    disabled={!canSend}
                    onClick={() => void submit()}
                    className="ui-control-squish ui-control-squish-accent-fill flex size-8 cursor-pointer items-center justify-center rounded-lg text-on-accent outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Anthropicon
                      name={disabled ? 'spinner' : 'arrowUp'}
                      size={20}
                      className={disabled ? 'animate-spin' : undefined}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{common.composer.sendLabel}</TooltipContent>
              </Tooltip>
            </span>
          </div>
        </div>
      </TooltipProvider>

      {(blocked || status) && (
        <p role="status" className="px-2 text-xs leading-4 text-text-muted">
          {blocked || status}
        </p>
      )}
      {(error || draft.error) && (
        <p role="alert" className="px-2 text-sm text-danger">
          {error || draft.error}
        </p>
      )}

      <ConfirmDialog
        open={bypassOpen}
        onOpenChange={setBypassOpen}
        title={copy.permission.bypassTitle}
        description={copy.permission.bypassDescription}
        confirmText={copy.permission.bypassConfirm}
        cancelText={copy.permission.bypassCancel}
        closeLabel={copy.attachments.close}
        waitForConfirm
        onConfirm={() => setMode('bypass')}
      />

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader closeLabel={copy.attachments.close}>
            <DialogTitle>
              {preview
                ? copy.attachments.lightboxLabel(preview.name)
                : copy.attachments.previewUnavailable}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[70vh] max-w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IconControl(props: {
  icon: AnthropiconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
          className={ICON_CONTROL_CLASS}
        >
          <Anthropicon name={props.icon} size={20} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Goal
//
// The goal button opens a small dialog; arming a goal on the welcome surface
// creates the Session first (a goal belongs to a Session). The dialog keeps
// its own field state; validation mirrors the Host's bounds.

const GOAL_MAX_ITERATIONS = 100;

function GoalControl(props: {
  sessionId?: string;
  disabled: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onStatus: (status: string) => void;
  onError: (cause: unknown, title?: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getComposerCopy(locale).goal;
  const common = getConversationCopy(locale).composer;
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState('');
  const [iterations, setIterations] = useState('20');
  const [budget, setBudget] = useState('');
  const [fieldError, setFieldError] = useState('');
  const conditionId = `goal-condition-${props.sessionId ?? 'new'}`;
  const iterationsId = `goal-iterations-${props.sessionId ?? 'new'}`;
  const budgetId = `goal-budget-${props.sessionId ?? 'new'}`;

  async function openDialog() {
    try {
      if (props.sessionId) {
        const goal = await getGoal(props.sessionId);
        if (goal && ['active', 'waiting', 'paused'].includes(goal.status)) {
          throw new Error(common.goalAlreadySet);
        }
      }
      setFieldError('');
      setOpen(true);
    } catch (cause) {
      props.onError(cause, copy.failedTitle);
    }
  }

  async function arm() {
    if (!condition.trim()) {
      setFieldError(copy.conditionRequired);
      return;
    }
    const maxIterations = Number(iterations);
    const tokenBudget = budget.trim() ? Number(budget) : undefined;
    if (
      !Number.isInteger(maxIterations) ||
      maxIterations < 1 ||
      maxIterations > GOAL_MAX_ITERATIONS
    ) {
      setFieldError(copy.iterationsInvalid);
      return;
    }
    if (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) {
      setFieldError(copy.budgetInvalid);
      return;
    }
    if (props.busy) return;
    props.onBusy(true);
    setFieldError('');
    try {
      let id = props.sessionId;
      if (!id) {
        const created = await newTaskStore.create();
        id = created.id;
        sessionsStore.upsert(created);
        sessionsStore.select(id);
      }
      const result = await armGoal(id, {
        condition: condition.trim(),
        maxIterations,
        ...(tokenBudget ? { tokenBudget } : {}),
      });
      if (
        result.kind === 'reconciliation_unavailable' ||
        (result.kind === 'reconciled' && !result.matchesRequestedState)
      ) {
        throw new Error(getComposerCopy(locale).send.outcomeUnknownDescription);
      }
      setOpen(false);
      props.onStatus(copy.armedTitle);
    } catch (cause) {
      setFieldError(cause instanceof Error ? cause.message : String(cause));
      props.onError(cause, copy.failedTitle);
    } finally {
      props.onBusy(false);
    }
  }

  return (
    <>
      <IconControl
        icon="agent"
        label={common.setGoal}
        disabled={props.disabled}
        onClick={() => void openDialog()}
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!props.busy) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader closeLabel={copy.cancel}>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={conditionId}>{copy.conditionLabel}</Label>
              <Input
                id={conditionId}
                disabled={props.busy}
                value={condition}
                placeholder={copy.conditionPlaceholder}
                onChange={(event) => setCondition(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={iterationsId}>{copy.iterationsLabel}</Label>
                <Input
                  id={iterationsId}
                  type="number"
                  min={1}
                  max={GOAL_MAX_ITERATIONS}
                  disabled={props.busy}
                  value={iterations}
                  onChange={(event) => setIterations(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={budgetId}>{copy.budgetLabel}</Label>
                <Input
                  id={budgetId}
                  type="number"
                  min={1}
                  disabled={props.busy}
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                />
                <p className="text-xs text-text-muted">{copy.budgetHint}</p>
              </div>
            </div>
            {fieldError && (
              <p role="alert" className="text-sm text-danger">
                {fieldError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={props.busy} onClick={() => setOpen(false)}>
                {copy.cancel}
              </Button>
              <Button disabled={props.busy} onClick={() => void arm()}>
                {copy.submit}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
