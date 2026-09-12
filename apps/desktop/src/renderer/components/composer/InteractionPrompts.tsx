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

// The interaction the running turn is waiting on, pinned above the composer
// (relx `AskUserPanel` placement: it never scrolls away with the transcript,
// and the composer stays under it — Stop lives there, and a plain send while
// a question is open is the free-text answer to the question on show).
// Four kinds share one card:
//
//   sandbox_boundary_request   allow/deny a filesystem or network expansion
//   client_capability_request  allow/deny a browser / MCP / computer-use grant
//   user_question_request      the ask-user wizard, one question at a time
//   form_request               a typed form from a tool
//
// Every answer goes through `turnActionsStore` so the pending-action lock and
// the error path are the same as any other turn action. The card stays
// mounted, with what the user typed, when the response fails; it goes away
// only when the Host removes the request from the active-interaction list.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useStore } from 'zustand';
import { AnimatePresence, motion } from 'motion/react';
import {
  getConversationCopy,
  useUiLocale,
  createInteractionFormDrafts,
  buildInteractionFormResponse,
  interactionFormFieldDraftIsValid,
  createQuestionDrafts,
  canLeaveQuestion,
  buildUserQuestionResponse,
  type InteractionFormFieldDraft,
  type QuestionAnswerDraft,
} from '@maka/ui';
import type {
  ActiveInteractionRequestEvent,
  FormRequestEvent,
  UserQuestionRequestEvent,
} from '@maka/core/events';
import { activeSessionStore, turnActionsStore } from '../../store/index.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { checkboxBoxClass, CHECKBOX_TICK_SIZE } from '../ui/checkbox-box.js';
import { cn } from '../../lib/cn.js';
import { getComposerCopy } from '../../locales/composer-copy.js';
import { userQuestionPanelStore } from '../../store/user-question-panel-store.js';
import { answerUserQuestion, rememberUserQuestionRequest } from '../../lib/ask-user-question.js';

/** relx AskUserPanel card: surface-3, 16px radius, panel shadow + hairline ring. */
const PANEL_CLASS =
  'relative z-10 overflow-hidden rounded-2xl bg-surface-3 shadow-[0_0.25rem_1.25rem_var(--panel-shadow-color),0_0_0_0.5px_var(--panel-ring-color)]';

const ICON_BUTTON_CLASS =
  'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition duration-300 hover:bg-alpha-1 hover:text-text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-40';

export function InteractionPrompts({
  sessionId,
  onError,
}: {
  sessionId: string;
  /** The shell's reporter, as every other surface in this stack uses. */
  onError: (title: string, error: unknown) => void;
}) {
  const request = useStore(activeSessionStore, (s) => s.interactions[sessionId]?.[0]);
  if (!request) return null;
  return (
    <InteractionPrompt
      key={`${sessionId}:${request.requestId}`}
      sessionId={sessionId}
      request={request}
      onError={onError}
    />
  );
}

function InteractionPrompt({
  sessionId,
  request,
  onError,
}: {
  sessionId: string;
  request: ActiveInteractionRequestEvent;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getConversationCopy(locale);
  const local = getComposerCopy(locale);
  const [pending, setPending] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState('');
  const busy = pending || answered;

  // Runs one response. The request may have been withdrawn by the Host in
  // the meantime (turn stopped, timed out); answering a gone request is a
  // no-op rather than an error the user cannot act on.
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setPending(true);
    setError('');
    try {
      const live = activeSessionStore
        .getState()
        .interactions[sessionId]?.some((r) => r.requestId === request.requestId);
      if (!live) return;
      await action();
      setAnswered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : local.send.failedFallback);
    } finally {
      setPending(false);
    }
  };

  if (request.type === 'user_question_request') {
    return (
      <QuestionWizard
        sessionId={sessionId}
        request={request}
        busy={busy}
        answered={answered}
        error={error}
        run={run}
        onError={onError}
      />
    );
  }

  const title =
    request.type === 'sandbox_boundary_request'
      ? copy.sandboxBoundary.title
      : request.type === 'client_capability_request'
        ? copy.clientCapability.title
        : copy.forms.requester(request.requester.name);

  return (
    <section
      className={cn(PANEL_CLASS, 'mb-2 p-4')}
      aria-label={title}
      data-maka-contract="interaction-prompt"
      data-interaction-kind={request.type}
    >
      <h2 className="mb-3 text-sm font-medium leading-5 text-text-primary">{title}</h2>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {request.type === 'sandbox_boundary_request' && (
          <>
            <p className="whitespace-pre-wrap text-sm text-text-secondary">
              {request.justification}
            </p>
            <ul className="space-y-1 text-sm text-text-secondary">
              {request.expansion.filesystem?.entries.map((entry, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span>{copy.sandboxBoundary.access[entry.access]}</span>
                  <span className="text-text-muted">·</span>
                  <span>{copy.sandboxBoundary.scope[entry.scope]}</span>
                  <code className="break-all font-mono text-[0.8125rem] text-text-primary">
                    {entry.path}
                  </code>
                </li>
              ))}
              {request.expansion.network?.enabled && (
                <li>
                  {copy.sandboxBoundary.network}
                  <span className="text-text-muted"> · </span>
                  {copy.sandboxBoundary.enabled}
                </li>
              )}
            </ul>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    turnActionsStore.respondSandbox(sessionId, {
                      requestId: request.requestId,
                      decision: 'deny',
                    }),
                  )
                }
              >
                {copy.sandboxBoundary.reject}
              </Button>
              <Button
                onClick={() =>
                  void run(() =>
                    turnActionsStore.respondSandbox(sessionId, {
                      requestId: request.requestId,
                      decision: 'allow',
                    }),
                  )
                }
              >
                {copy.sandboxBoundary.allowSession}
              </Button>
            </div>
          </>
        )}
        {request.type === 'client_capability_request' && (
          <>
            <p className="break-words text-sm text-text-secondary">
              {request.scope.kind === 'browser_origin'
                ? copy.clientCapability.browser(request.scope.origin)
                : request.scope.kind === 'mcp_tool'
                  ? copy.clientCapability.desktopMcp(request.scope.serverId, request.scope.toolName)
                  : copy.clientCapability.computerUse}
            </p>
            <p className="text-xs text-text-muted">{copy.clientCapability.sessionNotice}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    turnActionsStore.respondCapability(sessionId, {
                      requestId: request.requestId,
                      decision: 'deny',
                    }),
                  )
                }
              >
                {copy.clientCapability.reject}
              </Button>
              <Button
                onClick={() =>
                  void run(() =>
                    turnActionsStore.respondCapability(sessionId, {
                      requestId: request.requestId,
                      decision: 'allow',
                    }),
                  )
                }
              >
                {copy.clientCapability.allowSession}
              </Button>
            </div>
          </>
        )}
        {request.type === 'form_request' && (
          <FormPrompt sessionId={sessionId} request={request} run={run} />
        )}
      </fieldset>
      <PromptStatus pending={pending} error={error} />
    </section>
  );
}

function PromptStatus({ pending, error }: { pending: boolean; error: string }) {
  const copy = getConversationCopy(useUiLocale());
  return (
    <>
      {pending && (
        <p role="status" className="mt-2 text-xs text-text-muted">
          {copy.questions.submitting}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ask-user wizard
//
// The relx panel, over Maka's answer model (`user-question-prompt-state.ts`):
// one question at a time, numbered option rows, a "something else" input as
// the last row, ← → paging in the header, ✕ = submit whatever is answered
// (unanswered questions go as `null`, which the tool reads as "the user did
// not say"). Picking an option on a non-final question advances; on the final
// question it submits. Skip leaves the current question unanswered and moves
// on.

function QuestionWizard({
  sessionId,
  request,
  busy,
  answered,
  error,
  run,
  onError,
}: {
  sessionId: string;
  request: UserQuestionRequestEvent;
  busy: boolean;
  answered: boolean;
  error: string;
  run: (action: () => Promise<void>) => Promise<void>;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getConversationCopy(locale).questions;
  const local = getComposerCopy(locale).questions;
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<QuestionAnswerDraft[]>(() =>
    createQuestionDrafts(request.questions),
  );
  // The cursor row: options first, then the free-text row at `options.length`.
  const [activeRow, setActiveRow] = useState(0);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  // The timeline tells this call apart from other tools by its id, and the
  // record card reads the questions from here until the transcript has them.
  useEffect(() => rememberUserQuestionRequest(request), [request]);
  // The composer under this panel answers the question on show with what
  // is typed there; it reads the cursor and the drafts from the panel store.
  useEffect(() => {
    userQuestionPanelStore.publish(request.requestId, index, drafts);
  }, [request.requestId, index, drafts]);
  useEffect(() => () => userQuestionPanelStore.clear(request.requestId), [request.requestId]);

  const total = request.questions.length;
  const question = request.questions[index];
  const options = question?.options ?? [];
  const draft = drafts[index] ?? null;
  const isLast = index >= total - 1;
  const custom = draft?.kind === 'other' ? draft.value : '';
  const pickedIndex = draft?.kind === 'option' ? draft.optionIndex : -1;
  const canConfirm = canLeaveQuestion(draft) && draft !== null;

  // Focus follows the question: the listbox owns ↑ ↓ ⏎ for the options.
  useEffect(() => {
    setActiveRow(0);
    listboxRef.current?.focus();
  }, [index]);

  const setDraft = (value: QuestionAnswerDraft) =>
    setDrafts((rows) => rows.map((row, i) => (i === index ? value : row)));

  const submit = useCallback(
    (rows: readonly QuestionAnswerDraft[]) =>
      run(() =>
        answerUserQuestion(request, buildUserQuestionResponse(request, rows), (response) =>
          turnActionsStore.respondQuestion(sessionId, response),
        ),
      ),
    [run, sessionId, request],
  );

  const advance = (rows: readonly QuestionAnswerDraft[]) => {
    if (isLast) void submit(rows);
    else setIndex(index + 1);
  };

  const pick = (optionIndex: number) => {
    if (busy) return;
    const next = drafts.map((row, i) =>
      i === index ? ({ kind: 'option', optionIndex } as const) : row,
    );
    setDrafts(next);
    advance(next);
  };

  const skip = () => {
    if (busy) return;
    const next = drafts.map((row, i) => (i === index ? null : row));
    setDrafts(next);
    advance(next);
  };

  const moveCursor = (next: number) => {
    const clamped = Math.max(0, Math.min(next, options.length));
    setActiveRow(clamped);
    if (clamped === options.length) customInputRef.current?.focus();
    else listboxRef.current?.focus();
  };

  const onListKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveCursor(activeRow + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveCursor(activeRow - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeRow < options.length) pick(activeRow);
      else if (canConfirm) advance(drafts);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Typing while the list has focus means "something else": hand the
      // keystroke to the input without preventing it, so IME composition
      // starts there rather than losing its first letter.
      moveCursor(options.length);
    }
  };

  if (!question) return null;

  return (
    <section
      className={cn(PANEL_CLASS, 'mb-2 pt-3')}
      aria-label={question.question}
      data-maka-contract="interaction-prompt"
      data-interaction-kind={request.type}
    >
      <div className="flex items-center gap-2 pb-1.5 pl-4 pr-3">
        <span className="flex-1 text-sm leading-[1.4] text-text-primary">{question.question}</span>
        {total > 1 && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label={copy.previous}
              disabled={index === 0 || busy}
              onClick={() => setIndex(index - 1)}
              className={ICON_BUTTON_CLASS}
            >
              <Anthropicon name="caretRight" className="rotate-180" size={16} />
            </button>
            <span className="text-sm tabular-nums text-text-muted">
              {local.progress(index + 1, total)}
            </span>
            <button
              type="button"
              aria-label={copy.next}
              disabled={isLast || busy}
              onClick={() => setIndex(index + 1)}
              className={ICON_BUTTON_CLASS}
            >
              <Anthropicon name="caretRight" size={16} />
            </button>
          </div>
        )}
        <button
          type="button"
          aria-label={local.closeWithoutAnswering}
          title={local.closeWithoutAnswering}
          disabled={busy}
          onClick={() => void submit(drafts)}
          className={ICON_BUTTON_CLASS}
        >
          <Anthropicon name="x" size={16} />
        </button>
      </div>

      <div className="p-1.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div
              ref={listboxRef}
              role="listbox"
              tabIndex={0}
              aria-label={question.question}
              aria-activedescendant={
                activeRow < options.length
                  ? `ask-user-option-${request.requestId}-${index}-${activeRow}`
                  : undefined
              }
              onKeyDown={onListKeyDown}
              className="flex flex-col outline-none"
            >
              {options.map((option, i) => {
                const selected = pickedIndex === i;
                const active = activeRow === i;
                const dividerHidden = active || activeRow === i + 1;
                return (
                  <div key={option.label} role="presentation">
                    <button
                      type="button"
                      id={`ask-user-option-${request.requestId}-${index}-${i}`}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      disabled={busy}
                      onClick={() => pick(i)}
                      onMouseEnter={() => setActiveRow(i)}
                      className={cn(
                        'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-transform duration-100 active:scale-[0.99]',
                        active && 'bg-alpha-1',
                      )}
                    >
                      {/* The ordinal is decoration: the option's name is its label. */}
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center"
                      >
                        <span
                          className={cn(
                            'flex size-7 items-center justify-center rounded-lg text-sm',
                            selected
                              ? 'bg-accent-fill text-on-accent'
                              : active
                                ? 'bg-alpha-2 text-text-primary'
                                : 'bg-alpha-1 text-text-secondary',
                          )}
                        >
                          {i + 1}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className={cn(
                            'truncate text-sm',
                            active ? 'text-text-primary' : 'text-text-secondary',
                          )}
                          title={option.label}
                        >
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="truncate text-xs text-text-muted">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {active && (
                        <span aria-hidden className="mr-2 shrink-0 text-sm text-text-muted">
                          ⏎
                        </span>
                      )}
                    </button>
                    {i < options.length - 1 && (
                      <div
                        aria-hidden
                        className={cn(
                          'mx-3 h-[0.5px] bg-alpha-2 transition-opacity duration-150',
                          dividerHidden && 'opacity-0',
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {options.length > 0 && (
          <div
            aria-hidden
            className={cn(
              'mx-3 h-[0.5px] bg-alpha-2 transition-opacity duration-150',
              activeRow >= options.length - 1 && 'opacity-0',
            )}
          />
        )}

        {/* "Something else": the free answer, the last row of the cursor loop. */}
        <div
          className={cn(
            'flex h-11 w-full cursor-text items-center gap-2.5 rounded-xl px-2.5',
            custom.trim() ? 'bg-accent-subtle' : activeRow === options.length ? 'bg-alpha-1' : '',
          )}
          onMouseEnter={() => setActiveRow(options.length)}
          onClick={() => customInputRef.current?.focus()}
        >
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              activeRow === options.length
                ? 'bg-alpha-2 text-text-primary'
                : 'bg-alpha-1 text-text-secondary',
            )}
          >
            <Anthropicon name="edit" size={16} />
          </span>
          <input
            ref={customInputRef}
            type="text"
            placeholder={local.somethingElse}
            aria-label={copy.otherAriaLabel}
            value={custom}
            disabled={busy}
            onChange={(event) =>
              setDraft(event.target.value ? { kind: 'other', value: event.target.value } : null)
            }
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (canConfirm) advance(drafts);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveCursor(options.length - 1);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveCursor(0);
              }
            }}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted focus:outline-none"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-sm"
            disabled={busy}
            onClick={skip}
          >
            {local.skip}
          </Button>
          <button
            type="button"
            aria-label={isLast ? local.confirmSubmit : local.confirmNext}
            disabled={busy || !canConfirm}
            onClick={() => advance(drafts)}
            className={cn(
              'ui-control-squish flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50',
              isLast
                ? 'ui-control-squish-accent-fill text-on-accent'
                : 'ui-control-squish-primary text-on-primary',
            )}
          >
            <Anthropicon name="arrowUp" className={isLast ? undefined : 'rotate-90'} size={20} />
          </button>
        </div>
      </div>
      {(busy || error) && (
        <div className="px-4 pb-3">
          <PromptStatus pending={busy} error={error} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Typed form

function FormPrompt({
  sessionId,
  request,
  run,
}: {
  sessionId: string;
  request: FormRequestEvent;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const copy = getConversationCopy(useUiLocale()).forms;
  const [drafts, setDrafts] = useState(() => createInteractionFormDrafts(request.fields));
  const response = buildInteractionFormResponse(request, drafts);
  return (
    <>
      <p className="whitespace-pre-wrap text-sm text-text-secondary">{request.message}</p>
      {request.requester.source && (
        <p className="text-xs text-text-muted">
          {copy.requesterWithSource(request.requester.name, request.requester.source)}
        </p>
      )}
      <FormFields
        request={request}
        drafts={drafts}
        onChange={(index, draft) =>
          setDrafts((values) => values.map((v, i) => (i === index ? draft : v)))
        }
      />
      <div className="flex justify-end gap-2">
        {(['cancel', 'decline'] as const).map((action) => (
          <Button
            key={action}
            variant="secondary"
            onClick={() =>
              void run(() =>
                turnActionsStore.respondForm(sessionId, { requestId: request.requestId, action }),
              )
            }
          >
            {copy[action]}
          </Button>
        ))}
        <Button
          disabled={!response}
          onClick={() =>
            void run(async () => {
              const built = buildInteractionFormResponse(request, drafts);
              if (built) await turnActionsStore.respondForm(sessionId, built);
            })
          }
        >
          {copy.accept}
        </Button>
      </div>
    </>
  );
}

/** A relx-styled checkbox row: the box from `checkbox-box.ts`, label beside it. */
function CheckRow(props: {
  id?: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  size?: 'default' | 'xs';
  onChange: (checked: boolean) => void;
}) {
  const size = props.size ?? 'xs';
  return (
    <button
      type="button"
      id={props.id}
      role="checkbox"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className="group/cb flex cursor-pointer items-center gap-2 text-left text-sm text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-default disabled:opacity-60"
    >
      <span className={checkboxBoxClass(props.checked, size)} aria-hidden>
        {props.checked && <Anthropicon name="check" size={CHECKBOX_TICK_SIZE[size]} />}
      </span>
      <span>{props.label}</span>
    </button>
  );
}

function FormFields({
  request,
  drafts,
  onChange,
}: {
  request: FormRequestEvent;
  drafts: InteractionFormFieldDraft[];
  onChange: (i: number, draft: InteractionFormFieldDraft) => void;
}) {
  const copy = getConversationCopy(useUiLocale()).forms;
  return (
    <>
      {request.fields.map((field, i) => {
        const draft = drafts[i]!;
        const update = (value: InteractionFormFieldDraft['value']) =>
          onChange(i, { ...draft, value });
        const id = `form-${request.requestId}-${i}`;
        const invalid = draft.included && !interactionFormFieldDraftIsValid(field, draft);
        const constraint =
          field.kind === 'string'
            ? [
                field.minLength !== undefined || field.maxLength !== undefined
                  ? copy.lengthConstraint(field.minLength, field.maxLength)
                  : '',
                field.format ? copy.formatConstraint[field.format] : '',
              ]
                .filter(Boolean)
                .join(copy.constraintSeparator)
            : field.kind === 'number' || field.kind === 'integer'
              ? field.minimum !== undefined || field.maximum !== undefined
                ? copy.numberConstraint(field.minimum, field.maximum)
                : ''
              : field.kind === 'multi_select' &&
                  (field.minItems !== undefined || field.maxItems !== undefined)
                ? copy.itemConstraint(field.minItems, field.maxItems)
                : '';

        return (
          <div key={field.name} className="space-y-1.5">
            <label htmlFor={id} className="block text-sm font-medium text-text-primary">
              {field.label}{' '}
              <span className="text-xs font-normal text-text-muted">
                {field.required ? copy.required : copy.optional}
              </span>
            </label>
            {field.description && (
              <p className="text-xs text-text-secondary">{field.description}</p>
            )}
            {constraint && <p className="text-xs text-text-muted">{constraint}</p>}
            {!field.required && (
              <CheckRow
                checked={draft.included}
                label={copy.include(field.label)}
                onChange={(included) => onChange(i, { ...draft, included })}
              />
            )}
            {field.kind === 'boolean' ? (
              <CheckRow
                id={id}
                checked={draft.value === true}
                disabled={!draft.included}
                label={copy.enabled(field.label)}
                size="default"
                onChange={update}
              />
            ) : field.kind === 'single_select' ? (
              <Select
                value={String(draft.value)}
                disabled={!draft.included}
                onValueChange={(value) => update(value)}
              >
                <SelectTrigger id={id} aria-label={field.label} className="w-full">
                  <SelectValue placeholder={copy.enterValue} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.kind === 'multi_select' ? (
              <fieldset
                id={id}
                aria-label={field.label}
                disabled={!draft.included}
                className="space-y-1.5"
              >
                {field.options.map((option) => {
                  const values = Array.isArray(draft.value) ? draft.value : [];
                  return (
                    <CheckRow
                      key={option.value}
                      checked={values.includes(option.value)}
                      disabled={!draft.included}
                      label={option.label}
                      onChange={(checked) =>
                        update(
                          checked
                            ? [...values, option.value]
                            : values.filter((v) => v !== option.value),
                        )
                      }
                    />
                  );
                })}
              </fieldset>
            ) : (
              <Input
                id={id}
                disabled={!draft.included}
                type={field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'}
                value={String(draft.value)}
                step={field.kind === 'integer' ? 1 : 'any'}
                placeholder={
                  field.kind === 'number' || field.kind === 'integer'
                    ? copy.enterNumber
                    : copy.enterValue
                }
                onChange={(event) => update(event.target.value)}
                aria-invalid={invalid}
              />
            )}
            {invalid && <p className="text-xs text-danger">{copy.invalid}</p>}
          </div>
        );
      })}
    </>
  );
}
