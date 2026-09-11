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
// Layout is relx's `ChatInput`, the controls are upstream's composer footer:
//
//   lead (bottom-left)   the ＋ menu — add files, add folder, the Skills
//                        submenu, set a goal, and below a divider the Plan
//                        mode switch.
//   trail (bottom-right) welcome: the model chip (its menu carries the
//                        thinking level as an effort submenu) and the brand
//                        Send; session: the context ring and one Send/Stop
//                        slot — Stop while a turn runs and the draft is
//                        empty, Send (queued mid-turn) as soon as there is
//                        something to send.
//   meta row (under)     left: the project (a picker for a new task, a
//                        readout for a Session), the permission mode chip
//                        (Auto / full access), and the Plan chip while it is
//                        on, which is also the way out. Right: a Session's
//                        model chip with its effort.
//
// Above the editor, staged attachments, folder references and quotes as
// chips. A short session draft shares its line with the controls; the
// welcome surface always stacks them under two reserved lines.
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
import type { ChatModelChoice } from '@maka/core/chat-model-choice';
import { attachmentKindFromMimeType, guessMimeFromName } from '@maka/core/attachments';
import { getConversationCopy, useUiLocale, useComposerHistory } from '@maka/ui';
import {
  composerInputStore,
  EMPTY_INPUT,
  type InputDraft,
} from '../../store/composer-input-store.js';
import { composerDraftStore, type PendingQuote } from '../../store/composer-draft-store.js';
import {
  activeSessionStore,
  sessionsStore,
  turnActionsStore,
  connectionsStore,
  settingsStore,
  uiStore,
} from '../../store/index.js';
import { newTaskStore, newTaskTargetAvailable } from '../../store/new-task-store.js';
import { useComposerInlineRow } from '../../hooks/use-composer-inline-row.js';
import { pendingActionsOf } from '../../store/turn-actions-store.js';
import { parseDesktopSlashCommand } from '../../lib/ported/desktop-slash-command.js';
import { documentWithSkillTokens, serializeComposer } from '../../lib/composer-document.js';
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
import {
  getNewTaskReadiness,
  listNewTaskInvocableSkills,
  type DesktopNewTaskTarget,
} from '../../bridge/new-tasks.js';
import { listInvocableSkills } from '../../bridge/skills.js';
import { listLocalMessages } from '../../bridge/session-local.js';
import { getSessionLocalCopy } from '../../locales/session-local-copy.js';
import { removeSession } from '../../bridge/sessions.js';
import { armGoal, getGoal } from '../../bridge/goal.js';
import { getComposerCopy } from '../../locales/composer-copy.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import { getShellCopy, localizedShellErrorMessage } from '../../locales/shell-copy.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import {
  chatModelChoiceLabel,
  chatModelWriteCommitted,
} from '../../lib/ported/shell-chat-model-selection.js';
import {
  showSkillInvocationFeedback,
  skillInvocationDisplayText,
} from '../../lib/ported/skill-invocation-feedback.js';
import {
  isSessionWorkspaceUnavailableError,
  showSessionWorkspaceUnavailableToast,
} from '../../lib/ported/session-workspace-errors.js';
import { toastApi } from '../../store/toast-api.js';
import { COMPOSER_ICON_CONTROL_CLASS, PermissionModeMenu } from './PermissionModeMenu.js';
import { TipTapEditor } from './TipTapEditor.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { AttachmentCard, AttachmentCardRow } from '../ui/attachment-card.js';
import { WorkspacePicker } from '../welcome/WorkspacePicker.js';
import { ModelMenu } from './ModelMenu.js';
import { SkillSubMenu, type SkillMenuEntry } from './SkillSubMenu.js';
import { ContextUsageIndicator } from '../session/notices/ContextUsageIndicator.js';
import { cn } from '../../lib/cn.js';

const NO_QUOTES: readonly PendingQuote[] = [];
const MAX_DIRECTORY_REFERENCES = 4;

/** The welcome composer's draft key: one draft per new-task target. */
export const newComposerKey = (target: DesktopNewTaskTarget | undefined) =>
  `new:${JSON.stringify(target ?? null)}`;

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
  const localPending = session?.localState === 'pending';
  const hostSessionId = localPending ? undefined : sessionId;
  const localTarget =
    localPending && session
      ? {
          profileId: session.profileId,
          hostId: session.runtimeHostId,
          projectId: session.projectId ?? null,
        }
      : undefined;
  const scopedDefaults = useStore(settingsStore.host, (state) => state.data?.chatDefaults);
  const newTask = useStore(newTaskStore);
  const connections = useStore(connectionsStore, (s) => s.data);
  const readinessRevision = useStore(connectionsStore, (state) => state.revision);
  const pending = useStore(turnActionsStore, (s) => pendingActionsOf(s, sessionId));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string }>();

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
    const read = hostSessionId
      ? getTaskReadinessSnapshot(undefined, hostSessionId)
      : (localTarget ?? props.target)
        ? getNewTaskReadiness((localTarget ?? props.target)!, {
            connectionSlug: session?.llmConnectionSlug ?? newTask.model?.llmConnectionSlug,
            model: session?.model ?? newTask.model?.model,
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
  }, [
    sessionId,
    session?.revision,
    localPending,
    newTask.model?.llmConnectionSlug,
    newTask.model?.model,
    readinessRevision,
    newTask.connections,
  ]);

  const wire = serializeComposer(draft.document);
  const patch = (update: Partial<InputDraft>) => composerInputStore.patch(scopeKey, update);

  const history = useComposerHistory({
    text: {
      getValue: () => serializeComposer(composerInputStore.read(scopeKey).document).text,
      setValue: (value) => applyRecalledText(value),
    },
    // The input store persists on its own; nothing extra to save here.
    saveCurrentDraft: () => {},
  });

  // Expected failures travel as stable tokens (upstream #4457: the attachment
  // preflight throws `attachment_ingest:<code>`), so every message shown here
  // goes through the shell's localizer rather than the raw `Error.message`.
  const errorText = (cause: unknown, fallback = copy.send.failedFallback) =>
    localizedShellErrorMessage(cause, fallback, locale);
  const report = (cause: unknown, title = copy.send.failedTitle) => {
    if (!mounted.current) return;
    setError(errorText(cause));
    props.onError?.(title, cause);
  };

  // Settings shown in the control row: the Session's own once it exists,
  // the draft's until then.
  const selectedProfile = newTask.catalog?.hosts.find(
    (host) => host.profile.id === props.target?.profileId,
  )?.profile;
  const directoryHostId = sessionId
    ? session?.profileKind === 'local'
      ? session.runtimeHostId
      : undefined
    : selectedProfile?.kind === 'local'
      ? props.target?.hostId
      : undefined;
  const canStageContext = Boolean(sessionId || props.target);
  const mode =
    (localPending ? scopedDefaults?.permissionMode : session?.permissionMode) ??
    (draft.permissionChosen
      ? draft.permission
      : (newTask.defaults?.permissionMode ?? draft.permission));
  const plan = session ? session.collaborationMode === 'plan' : draft.plan;
  const activeChoice = (session ? connections : newTask.connections)?.chatModelChoices.find(
    (choice) =>
      choice.connectionSlug === (session?.llmConnectionSlug ?? newTask.model?.llmConnectionSlug) &&
      choice.model === (session?.model ?? newTask.model?.model),
  );
  const thinkingLevels = activeChoice?.thinkingLevels ?? [];

  const disabled = busy || pending.includes('send');
  // The Stop button and Escape share one path; a stop that is already in
  // flight is not asked for twice.
  const stopTurn = () => {
    if (!sessionId || pending.includes('stop')) return;
    void turnActionsStore
      .stop(sessionId, { source: 'stop_button' })
      .catch((cause: unknown) =>
        report(cause, getDesktopConversationCopy(locale).actions.stopFailedTitle),
      );
  };
  const hasContent = Boolean(wire.text) || draft.attachments.length > 0;
  const blocked =
    !sessionId && !newTaskTargetAvailable(newTask.catalog, props.target)
      ? copy.send.blockedNoWorkspace
      : !sessionId && newTask.connections && !newTask.model
        ? copy.send.blockedNoModel
        : ready === false
          ? copy.send.blockedReadiness
          : undefined;
  // A target whose connection catalog has not answered yet is neither
  // blocked nor sendable: the hint would be a lie, the send a guess.
  const targetSettled = Boolean(sessionId || newTask.connections);
  const canSend = !disabled && !blocked && hasContent && targetSettled;

  // -------------------------------------------------------------------------
  // Send

  async function submit(mode?: 'steer') {
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
    const capturedNewTask = { target: props.target, model: newTask.model };
    let owner = sessionId;
    const consumeDraft = (id: string) => {
      const draftOwner = sessionId ? scopeKey : id;
      composerInputStore.acknowledge(draftOwner, sent);
      for (const quote of sentQuotes) composerDraftStore.removeQuote(draftOwner, quote.id);
      history.rememberSentEntry(serialized.text);
    };
    // The optimistic copy to withdraw if the send never reaches the Host.
    let optimisticId: string | undefined;
    try {
      preflightAttachmentItems(sent.attachments);

      if (parseDesktopSlashCommand(serialized.text)?.kind === 'compact') {
        if (!owner || props.running) throw new Error(copy.slash.notYet);
        await turnActionsStore.compact(owner);
        composerInputStore.acknowledge(scopeKey, sent);
        return;
      }
      if (/^\/(?:side|graph|swarm)(?:\s|$)/.test(serialized.text)) {
        throw new Error(copy.slash.notYet);
      }

      const readiness =
        owner && !localPending
          ? await getTaskReadinessSnapshot(undefined, owner)
          : await getNewTaskReadiness((localTarget ?? props.target)!, {
              connectionSlug: session?.llmConnectionSlug ?? newTask.model?.llmConnectionSlug,
              model: session?.model ?? newTask.model?.model,
            });
      if (!mounted.current) return;
      if (readiness.state !== 'ready') throw new Error(copy.send.blockedReadiness);

      const messageId = composerInputStore.reserveIntent(scopeKey, sent.revision);

      if (!owner) {
        // Everything the draft chose travels with the create: the Host's
        // configured permission default stands unless the user picked one.
        const created = await newTaskStore.create(
          {
            ...(sent.permissionChosen ? { permissionMode: sent.permission } : {}),
            ...(sent.thinking && thinkingLevels.includes(sent.thinking)
              ? { thinkingLevel: sent.thinking }
              : {}),
            collaborationMode: sent.plan ? 'plan' : 'agent',
            orchestrationMode: 'default',
          },
          capturedNewTask,
        );
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
      }

      // The message is on screen before the Host has it (upstream
      // `showTransientUserMessage`); the durable copy retires it by id.
      // Mid-turn a plain send queues for the next turn; steering the running
      // answer is the explicit Shift+Enter (upstream's convention), so a
      // habitual Enter never interrupts the answer in progress.
      const transientPlacement = props.running
        ? mode === 'steer'
          ? 'current_turn'
          : 'next_turn'
        : 'current_turn';
      activeSessionStore.showTransientUserMessage(owner, {
        id: messageId,
        ts: Date.now(),
        text: serialized.text,
        attachments: retainedAttachmentRefs(sent.attachments),
        directoryReferences: [...sent.directories],
        quotes: sentQuotes.map(({ id: _id, ...quote }) => quote),
        inlineReferences: [],
        transientPlacement,
      });
      if (!sessionId) sessionsStore.select(owner);
      optimisticId = messageId;
      const result = await turnActionsStore.submit(owner, transientPlacement, {
        text: serialized.text,
        skillIds: serialized.skillIds,
        workspaceFileReferences: serialized.workspaceFileReferences,
        attachmentItems: toComposerIngestItems(sent.attachments),
        retainedAttachments: retainedAttachmentRefs(sent.attachments),
        directoryReferences: [...sent.directories],
        quotes: sentQuotes.map(({ id: _id, ...quote }) => quote),
        messageId,
      });
      // After a transfer the draft lives under the new Session's key.
      if (!result.ok) {
        // `outcome_unknown` may still have been admitted; only a refusal is
        // certain not to appear, so only that withdraws the optimistic copy.
        if (result.reason === 'outcome_unknown') {
          optimisticId = undefined;
          // Upstream treats this as an unresolved submission, not an editable
          // unsent draft. Keep its row/id, but do not invite a new send on reload.
          consumeDraft(owner);
          activeSessionStore.updateTransientMessage(owner, {
            id: messageId,
            ts: Date.now(),
            text: serialized.text,
            inlineReferences: [],
            attachments: retainedAttachmentRefs(sent.attachments),
            directoryReferences: [...sent.directories],
            quotes: sentQuotes.map(({ id: _id, ...quote }) => quote),
            transientPlacement,
            deliveryStatus: getSessionLocalCopy(locale).unknown,
          });
          return;
        }
        // The Host blocked every `/skill:x` in the message: the toast names
        // each one and why, the composer keeps the draft with a short reason.
        activeSessionStore.removeTransientMessage(owner, messageId);
        optimisticId = undefined;
        showSkillInvocationFeedback(locale, toastApi, result.skillInvocation, owner);
        composerInputStore.patch(sessionId ? scopeKey : owner, {
          error: copy.send.skillFailedFallback,
          intent: undefined,
        });
        if (
          !sessionId &&
          sessionsStore.getState().activeId === owner &&
          composerDraftStore.quotesFor(scopeKey).length === 0 &&
          composerInputStore.restoreTransfer(owner, scopeKey)
        ) {
          composerDraftStore.transferQuotes(owner, scopeKey);
          sessionsStore.select(undefined);
          await removeSession(owner).catch(() => undefined);
          void sessionsStore.refresh();
        }
        return;
      }
      // A skill that loaded beside one that did not is a partial success the
      // user should hear about, without the message being held back.
      showSkillInvocationFeedback(locale, toastApi, result.skillInvocation, owner);
      optimisticId = undefined;
      // What the Host made of it: the Turn it landed in, the attachments it
      // resolved, the inline references it kept. `locally_saved` answered
      // nothing about a Turn, so the first projection stands as it is.
      if (result.disposition !== 'locally_saved') {
        activeSessionStore.updateTransientMessage(owner, {
          id: messageId,
          ts: Date.now(),
          text: skillInvocationDisplayText(serialized.text, result.skillInvocation),
          attachments: result.attachments,
          directoryReferences: [...sent.directories],
          quotes: sentQuotes.map(({ id: _id, ...quote }) => quote),
          inlineReferences: result.inlineReferences,
          transientPlacement,
          ...(result.turnId ? { hostTurnId: result.turnId } : {}),
        });
      }
      consumeDraft(owner);
      if (mounted.current && result.disposition === 'steering') {
        setStatus(copy.send.steeredTitle);
      }
    } catch (cause) {
      if (owner && optimisticId) {
        const observed = activeSessionStore.getState();
        const committed =
          observed.sessionId === owner &&
          observed.messages.some((message) => message.id === optimisticId);
        const saved =
          committed ||
          (await listLocalMessages(owner)
            .then((messages) => messages.some((message) => message.messageId === optimisticId))
            .catch(() => false));
        if (saved) {
          consumeDraft(owner);
          return;
        }
        activeSessionStore.removeTransientMessage(owner, optimisticId);
      }
      // A failed first send still leaves a real, selected Session with the
      // draft in it — never an invisible lost message.
      if (!sessionId && owner && mounted.current) sessionsStore.select(owner);
      if (isSessionWorkspaceUnavailableError(cause)) {
        // One typed code, one sentence: the directory is gone, not the send.
        showSessionWorkspaceUnavailableToast(
          toastApi,
          locale,
          owner ? { sessionId: owner } : undefined,
        );
        composerInputStore.patch(owner && !sessionId ? owner : scopeKey, {
          error: getShellCopy(locale).errors.workspaceUnavailableTitle,
        });
        return;
      }
      composerInputStore.patch(owner && !sessionId ? owner : scopeKey, {
        error: errorText(cause),
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
      preflightAttachmentItems(all);
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
    if (!canStageContext) {
      report(new Error(copy.send.blockedNoWorkspace));
      return;
    }
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
      preflightAttachmentItems([...draft.attachments, ...items]);
      appendAttachments(
        items.map((item) => ({
          ...item,
          ...(item.kind === 'image' ? { previewUrl: URL.createObjectURL(item.source.file) } : {}),
        })),
      );
      // No "N files attached" line under the composer: the cards that just
      // appeared are the feedback (owner decision 2026-09-11).
    } catch (cause) {
      report(cause, copy.attachments.pickFailedTitle);
    }
  };

  /** Files from the native picker: main hands back approval ids, not bytes. */
  async function pickFiles() {
    if (!canStageContext) return;
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
    if (!directoryHostId) return;
    try {
      const result = await pickAttachmentDirectory();
      if (!mounted.current || !result.ok) return;
      if (result.reference.hostId !== directoryHostId)
        throw new Error(copy.directories.pickFailedTitle);
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
      else patch({ permission, permissionChosen: true });
    } catch (cause) {
      report(cause, copy.permission.changeFailedTitle);
      throw cause;
    }
  };

  const setThinking = (level: ThinkingLevel | undefined) => {
    if (sessionId) {
      void turnActionsStore
        .setThinking(sessionId, level ?? null)
        .then((row) => sessionsStore.upsert(row))
        .catch((cause: unknown) =>
          report(cause, getTranscriptCopy(locale).model.changeFailedTitle),
        );
    } else patch({ thinking: level });
  };

  const togglePlan = () => {
    if (sessionId) {
      void turnActionsStore.setCollaboration(sessionId, plan ? 'agent' : 'plan').catch(report);
    } else {
      patch({ plan: !plan });
    }
  };

  async function openGoal() {
    try {
      if (sessionId) {
        const goal = await getGoal(sessionId);
        if (goal && ['active', 'waiting', 'paused'].includes(goal.status)) {
          throw new Error(common.composer.goalAlreadySet);
        }
      }
      if (mounted.current) setGoalOpen(true);
    } catch (cause) {
      report(cause, copy.goal.failedTitle);
    }
  }

  // -------------------------------------------------------------------------
  // Layout
  //
  // relx `ChatInput` geometry: the surface holds only the editor, the lead
  // controls pinned bottom-left and the send-side controls pinned
  // bottom-right; see the file header for what goes in each group.

  const welcome = !sessionId;
  const hasChips =
    draft.attachments.length > 0 || draft.directories.length > 0 || quotes.length > 0;
  const inlineRow = useComposerInlineRow({
    enabled: !welcome,
    empty: !wire.text,
    forceStacked: hasChips,
  });
  const [goalOpen, setGoalOpen] = useState(false);
  // The Skills submenu reads the catalog when the ＋ menu opens, so the list
  // is the Host's answer for THIS target and mode, the same one `/` offers.
  const [skills, setSkills] = useState<readonly SkillMenuEntry[] | undefined>();
  // The last catalog this composer read. History recall needs it synchronously
  // to put Skill atoms back into a recalled prompt, and the ＋ menu is not
  // necessarily what filled it.
  const skillsRef = useRef<readonly SkillMenuEntry[]>([]);
  // Read through a ref: `useComposerHistory` captures its text port on the
  // first render, and the catalog a new task asks for depends on picks made
  // after it.
  const skillContext = useRef({
    hostSessionId,
    target: localTarget ?? props.target,
    newTask,
    plan,
    mode,
  });
  skillContext.current = {
    hostSessionId,
    target: localTarget ?? props.target,
    newTask,
    plan,
    mode,
  };

  const readSkills = async (): Promise<readonly SkillMenuEntry[]> => {
    const live = skillContext.current;
    const list = live.hostSessionId
      ? await listInvocableSkills(live.hostSessionId)
      : live.target
        ? await listNewTaskInvocableSkills(live.target, {
            llmConnectionSlug: live.newTask.model?.llmConnectionSlug,
            model: live.newTask.model?.model,
            collaborationMode: live.plan ? 'plan' : 'agent',
            permissionMode: live.mode === 'explore' ? undefined : live.mode,
          })
        : [];
    const entries = list.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
    }));
    skillsRef.current = entries;
    return entries;
  };

  const loadSkills = async () => {
    setSkills(undefined);
    try {
      const entries = await readSkills();
      if (mounted.current) setSkills(entries);
    } catch {
      if (mounted.current) setSkills([]);
    }
  };

  /**
   * A recalled prompt arrives as a string, and the Skill ids live in atoms the
   * string does not carry. Put them back, so sending a recalled prompt runs
   * what the original ran instead of sending its wire text as prose.
   *
   * With a catalog already in hand this is one synchronous swap. Without one,
   * the text lands immediately — never make the arrow key wait on an IPC — and
   * the atoms follow, unless the draft has moved on by then.
   */
  const applyRecalledText = (value: string) => {
    const known = skillsRef.current;
    if (known.length > 0) {
      composerInputStore.patch(scopeKey, { document: documentWithSkillTokens(value, known) });
      return;
    }
    composerInputStore.setText(scopeKey, value);
    if (!value.includes('/skill:')) return;
    void readSkills()
      .then((entries) => {
        if (!mounted.current || entries.length === 0) return;
        const current = serializeComposer(composerInputStore.read(scopeKey).document).text;
        if (current !== value) return;
        composerInputStore.patch(scopeKey, { document: documentWithSkillTokens(value, entries) });
      })
      .catch(() => {});
  };
  const insertSkill = (skill: SkillMenuEntry) =>
    focusEditor((instance) =>
      instance
        .chain()
        .focus('end')
        .insertContent([
          {
            type: 'composerReference',
            attrs: { kind: 'skill', value: skill.id, label: skill.name },
          },
          { type: 'text', text: ' ' },
        ])
        .run(),
    );
  // The model chip: the Session's own configuration once it exists, the
  // new-task draft until then. Changing the model resets the level (the
  // Host does the same), so the readout never shows a level the new model
  // does not offer.
  const modelChoices = (session ? connections : newTask.connections)?.chatModelChoices ?? [];
  const pickModel = (choice: ChatModelChoice) => {
    const target = {
      llmConnectionId: choice.connectionId,
      llmConnectionSlug: choice.connectionSlug,
      model: choice.model,
    };
    if (sessionId) {
      void turnActionsStore
        .setModel(sessionId, { ...target, thinkingLevel: null })
        .then((row) => {
          sessionsStore.upsert(row);
          // The chip means one thing wherever it is pressed: the model you
          // chose last is the model the NEXT task starts on. Choosing inside a
          // task used to change that task alone, so the same control was
          // remembered on the welcome surface and forgotten here, with nothing
          // on screen to say which one this was.
          //
          // Only what the Host confirms, and only for THIS task's own model —
          // every other open task keeps the model it was given.
          if (chatModelWriteCommitted(target, row)) newTaskStore.selectModel(target);
        })
        .catch((cause: unknown) =>
          report(cause, getTranscriptCopy(locale).model.changeFailedTitle),
        );
      return;
    }
    newTaskStore.selectModel(target);
    patch({ thinking: undefined });
  };
  // A menu entry that hands focus to the editor must stop Radix from
  // returning it to the trigger when the menu closes.
  const keepEditorFocus = useRef(false);
  const focusEditor = (act: (instance: Editor) => void) => {
    keepEditorFocus.current = true;
    const instance = editor.current;
    if (instance) act(instance);
  };
  const menuSide = welcome ? 'bottom' : 'top';

  // The session send key is the return glyph (`reply`), ghost like the other
  // in-row controls: Enter already sends. Welcome keeps the brand arrow: that
  // one starts a task.
  const sendButtonClass = welcome
    ? 'ui-control-squish ui-control-squish-brand flex size-8 cursor-pointer items-center justify-center rounded-lg text-on-accent outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50'
    : 'ui-control-squish ui-control-squish-ghost flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50';
  // One slot, two states (upstream's send/stop toggle): Stop while a turn
  // runs and there is nothing to send; Send, which queues mid-turn, as soon
  // as there is. Nothing to send and nothing running: no button at all (relx),
  // rather than a dimmed one taking width from the text line.
  const stopShown = props.running === true && !hasContent;
  const modeLocked = disabled || props.running || localPending;
  const currentThinking = session
    ? (session.thinkingLevel ?? undefined)
    : (draft.thinking ??
      (newTask.defaults?.thinkingLevel && thinkingLevels.includes(newTask.defaults.thinkingLevel)
        ? newTask.defaults.thinkingLevel
        : undefined));

  const modelMenu = (dense: boolean) => (
    <ModelMenu
      dense={dense}
      choices={modelChoices}
      current={
        session
          ? { connectionSlug: session.llmConnectionSlug, model: session.model }
          : newTask.model
            ? { connectionSlug: newTask.model.llmConnectionSlug, model: newTask.model.model }
            : undefined
      }
      fallbackLabel={
        session
          ? chatModelChoiceLabel(
              modelChoices,
              session.llmConnectionId,
              session.llmConnectionSlug,
              session.model,
            )
          : undefined
      }
      thinking={{ current: currentThinking, onChange: setThinking }}
      onPick={pickModel}
      onOpenSettings={props.onOpenSettings ?? (() => {})}
      disabled={localPending || pending.includes('model') || pending.includes('thinking')}
    />
  );
  return (
    <div
      className={cn('relative flex w-full flex-col', welcome && 'mx-auto max-w-[40rem]')}
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
            'chat-composer-surface relative z-10 w-full transition-shadow duration-200 ease-out',
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

          {/* Staged files are the same 120px cards a sent message shows, with
              the remove button on each (reference `AttachmentPreview`). The
              row keeps the reference's inset so a card starts where the text
              does. Directories and quotes stay chips below. */}
          {draft.attachments.length > 0 && (
            <AttachmentCardRow label={copy.attachments.regionLabel} className="px-3 pb-2 pt-3">
              {draft.attachments.map((item) => (
                <AttachmentCard
                  key={item.stagingKey}
                  name={item.displayName}
                  {...(item.mimeType ? { mimeType: item.mimeType } : {})}
                  {...(item.previewUrl ? { imageSrc: item.previewUrl } : {})}
                  {...(item.kind === 'image' ? { onOpen: () => void openPreview(item) } : {})}
                  openLabel={copy.attachments.open(item.displayName)}
                  {...(disabled
                    ? {}
                    : {
                        onRemove: () =>
                          composerInputStore.removeAttachment(scopeKey, item.stagingKey),
                        removeLabel: copy.attachments.remove(item.displayName),
                      })}
                />
              ))}
            </AttachmentCardRow>
          )}
          {(draft.directories.length > 0 || quotes.length > 0) && (
            <div className="flex flex-wrap gap-2 px-1 pb-3 pt-1">
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

          {/* The text block: switching forms only moves its padding (see
              useComposerInlineRow). The editor's own px-2 is part of the
              lead gap, hence the -8px. The transition waits for `settled`:
              the first commit can only be stacked and the jump to the real
              form must not animate. */}
          <div ref={inlineRow.hostRef} className="relative w-full min-w-0">
            <div
              style={inlineRow.vars}
              className={cn(
                'w-full min-w-0',
                inlineRow.settled &&
                  'motion-safe:transition-[padding-left,padding-bottom] motion-safe:duration-200',
                inlineRow.inline
                  ? 'pb-0 pl-[calc(var(--cmp-lead-w)-8px)]'
                  : 'pb-[calc(32px+0.5rem)] pl-0',
              )}
            >
              {/* ::before is the trail group's float: as wide as the group,
                  as tall as the text, and shape-outside keeps only its
                  bottom control-height, so only the LAST line yields. */}
              <div
                ref={inlineRow.editorRef}
                className={cn(
                  'relative w-full transition-opacity duration-200',
                  welcome ? 'min-h-[54px]' : 'min-h-8',
                  inlineRow.inline &&
                    "[&_.tiptap.ProseMirror]:before:float-right [&_.tiptap.ProseMirror]:before:content-[''] [&_.tiptap.ProseMirror]:before:h-[var(--cmp-wrap-h)] [&_.tiptap.ProseMirror]:before:w-[calc(var(--cmp-trail-w)-8px)] [&_.tiptap.ProseMirror]:before:[shape-outside:inset(calc(100%-var(--cmp-row-h))_0_0_0)]",
                  disabled && 'opacity-60',
                )}
              >
                <TipTapEditor
                  scopeKey={scopeKey}
                  sessionId={hostSessionId}
                  target={localTarget ?? props.target}
                  document={draft.document}
                  onChange={(document) => {
                    patch({ document, error: undefined });
                    setError('');
                    history.resetNavigation();
                  }}
                  onEditor={(value) => {
                    editor.current = value;
                  }}
                  onSubmit={(mode) => void submit(mode)}
                  onStop={stopTurn}
                  skillContext={{
                    llmConnectionSlug: newTask.model?.llmConnectionSlug,
                    model: newTask.model?.model,
                    collaborationMode: plan ? 'plan' : 'agent',
                    permissionMode: mode === 'explore' ? undefined : mode,
                  }}
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
              </div>
            </div>

            {/* Resting order (upstream): ＋ leftmost, then the permission
                icon, then the mode readout. A mode turning on or off adds or
                removes the last slot only, so nothing to its left moves. */}
            <div
              ref={inlineRow.leadRef}
              className="absolute bottom-0 left-0 flex min-h-8 shrink-0 items-center gap-1 pr-2"
            >
              <DropdownMenu
                onOpenChange={(open) => {
                  if (open) void loadSkills();
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={common.composer.addContext}
                        disabled={disabled}
                        className={COMPOSER_ICON_CONTROL_CLASS}
                      >
                        <Anthropicon name="add" size={20} weight={433.25} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side={menuSide}>{common.composer.addContext}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align="start"
                  side={menuSide}
                  sideOffset={4}
                  alignOffset={-8}
                  onCloseAutoFocus={(event) => {
                    if (!keepEditorFocus.current) return;
                    keepEditorFocus.current = false;
                    event.preventDefault();
                  }}
                >
                  <DropdownMenuItem
                    disabled={props.running || !canStageContext}
                    onSelect={() => void pickFiles()}
                  >
                    <div className="flex flex-1 items-center gap-2 truncate">
                      <DropdownMenuItemIcon>
                        <Anthropicon name="attach" size={20} />
                      </DropdownMenuItemIcon>
                      <span className="truncate">{copy.menu.addFiles}</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={props.running || !directoryHostId}
                    onSelect={() => void pickDirectory()}
                  >
                    <div className="flex flex-1 items-center gap-2 truncate">
                      <DropdownMenuItemIcon>
                        <Anthropicon name="folder" size={20} />
                      </DropdownMenuItemIcon>
                      <span className="truncate">{copy.menu.addFolder}</span>
                    </div>
                  </DropdownMenuItem>
                  {/* Two groups, as the reference panel has them: above the
                      divider what goes INTO the message, below it how this
                      task runs, led by its submenu. Plan is a Session field
                      of its own and an independent switch, so the menu stays
                      open on the toggle and the row itself shows the change. */}
                  <DropdownMenuSeparator />
                  <SkillSubMenu
                    skills={skills}
                    disabled={!canStageContext}
                    onPick={insertSkill}
                    onManage={() => {
                      uiStore.closeSettings();
                      uiStore.navigate({ section: 'extensions', module: 'skills' });
                    }}
                  />
                  <DropdownMenuItem
                    disabled={props.running || localPending || Boolean(blocked)}
                    onSelect={() => void openGoal()}
                  >
                    <div className="flex flex-1 items-center gap-2 truncate">
                      <DropdownMenuItemIcon>
                        <Anthropicon name="flag" size={20} />
                      </DropdownMenuItemIcon>
                      <span className="truncate">{common.composer.setGoal}</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuCheckboxItem
                    checked={plan}
                    disabled={modeLocked}
                    aria-description={
                      plan ? common.composer.disablePlanMode : common.composer.enablePlanMode
                    }
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => togglePlan()}
                  >
                    <DropdownMenuItemIcon>
                      <Anthropicon name="tasks" size={20} />
                    </DropdownMenuItemIcon>
                    <span className="truncate">{common.composer.planModeLabel}</span>
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div
              ref={inlineRow.trailRef}
              className="absolute bottom-0 right-0 flex min-h-8 shrink-0 items-center gap-1 pl-2"
            >
              {/* The model chip lives IN the surface only on the welcome
                  page; a Session's sits on the meta row under it. */}
              {welcome && modelMenu(false)}
              {/* The context ring sits beside Send: the moment to look at it
                  is right before pressing it. */}
              {hostSessionId && <ContextUsageIndicator sessionId={hostSessionId} />}
              {stopShown ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={
                        pending.includes('stop')
                          ? common.composer.stopping
                          : common.composer.stopLabel
                      }
                      aria-busy={pending.includes('stop') ? 'true' : undefined}
                      disabled={pending.includes('stop')}
                      onClick={stopTurn}
                      className="ui-control-squish ui-control-squish-flat flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-70"
                    >
                      <Anthropicon
                        name={pending.includes('stop') ? 'spinner' : 'stopCircle'}
                        size={20}
                        className={pending.includes('stop') ? 'animate-spin' : undefined}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {pending.includes('stop')
                      ? common.composer.stopping
                      : common.composer.stopLabel}
                  </TooltipContent>
                </Tooltip>
              ) : (
                (canSend || busy) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={common.composer.sendLabel}
                        aria-busy={busy ? 'true' : undefined}
                        disabled={!canSend}
                        onClick={() => void submit()}
                        className={sendButtonClass}
                      >
                        <Anthropicon
                          name={busy ? 'spinner' : welcome ? 'arrowUp' : 'reply'}
                          size={20}
                          className={busy ? 'animate-spin' : undefined}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{common.composer.sendLabel}</TooltipContent>
                  </Tooltip>
                )
              )}
            </div>
          </div>
        </div>

        {/* Workspace selection is welcome-only; session project details live in the header. */}
        <div className="mt-[6px] flex h-6 w-full items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-1">
            {welcome && <WorkspacePicker dense side={menuSide} />}
            <PermissionModeMenu
              activeMode={mode}
              side={menuSide}
              disabled={modeLocked || pending.includes('permission')}
              onSelect={(next) => {
                // Full access is confirmed first; the dialog applies it.
                if (next === 'bypass') setBypassOpen(true);
                else void setMode(next).catch(() => {});
              }}
            />
            {plan && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-mode="plan"
                    aria-description={common.composer.disablePlanMode}
                    disabled={modeLocked}
                    onClick={() => {
                      togglePlan();
                      window.requestAnimationFrame(() => editor.current?.commands.focus('end'));
                    }}
                    className={cn(COMPOSER_META_CHIP, COMPOSER_META_CHIP_ACTIVE)}
                  >
                    {common.composer.planModeLabel}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={menuSide}>{common.composer.planModeOnTitle}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">{!welcome && modelMenu(true)}</div>
        </div>
      </TooltipProvider>

      {(blocked || status) && (
        <p role="status" className="mt-1 px-3 text-xs leading-4 text-text-muted">
          {blocked || status}
        </p>
      )}
      {(error || draft.error) && (
        <p role="alert" className="mt-1 px-3 text-sm text-danger">
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

      <GoalDialog
        sessionId={sessionId}
        open={goalOpen}
        onOpenChange={setGoalOpen}
        busy={busy}
        onBusy={(value) => {
          lock.current = value;
          setBusy(value);
        }}
        onStatus={setStatus}
        onError={report}
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

// ---------------------------------------------------------------------------
// Goal
//
// The "+" menu's goal entry opens this dialog; arming a goal on the welcome
// surface creates the Session first (a goal belongs to a Session). The dialog
// keeps its own field state; validation mirrors the Host's bounds.

const GOAL_MAX_ITERATIONS = 100;

function GoalDialog(props: {
  sessionId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onStatus: (status: string) => void;
  onError: (cause: unknown, title?: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getComposerCopy(locale).goal;
  const [condition, setCondition] = useState('');
  const [iterations, setIterations] = useState('20');
  const [budget, setBudget] = useState('');
  const [fieldError, setFieldError] = useState('');
  const conditionId = `goal-condition-${props.sessionId ?? 'new'}`;
  const iterationsId = `goal-iterations-${props.sessionId ?? 'new'}`;
  const budgetId = `goal-budget-${props.sessionId ?? 'new'}`;

  useEffect(() => {
    if (props.open) setFieldError('');
  }, [props.open]);

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
      props.onOpenChange(false);
      props.onStatus(copy.armedTitle);
    } catch (cause) {
      setFieldError(cause instanceof Error ? cause.message : String(cause));
      props.onError(cause, copy.failedTitle);
    } finally {
      props.onBusy(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!props.busy) props.onOpenChange(next);
      }}
    >
      <DialogContent className="md:max-w-[480px]">
        <DialogHeader closeLabel={copy.cancel}>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void arm();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={conditionId}>{copy.conditionLabel}</Label>
            <Input
              id={conditionId}
              autoFocus
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
                placeholder={copy.budgetHint}
                onChange={(event) => setBudget(event.target.value)}
              />
            </div>
          </div>
          {fieldError && (
            <p role="alert" className="text-sm text-danger">
              {fieldError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            {copy.cancel}
          </Button>
          <Button type="button" disabled={props.busy} onClick={() => void arm()}>
            {props.busy ? (
              <Anthropicon name="spinner" size={16} className="animate-spin" />
            ) : (
              copy.submit
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
