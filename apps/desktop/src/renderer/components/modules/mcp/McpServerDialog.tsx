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

// Add or edit one MCP server.
//
// Two transports behind one segmented control, because a server is either a
// process this machine starts or a URL it calls, and nothing about the form is
// shared past the id. The command line is ONE field rather than a command plus
// an argument list: that is how every MCP server is documented, and
// `mcp-server-command-line.ts` is the exact inverse pair that lets it round
// trip into `command` + `args[]` without a shell.
//
// The dialog validates but does not decide: `mcp-server-draft.ts` owns both
// what is wrong and what the config looks like, so the same rules apply to a
// server added here and one edited later.
//
// Advanced settings are collapsed by default. Working directory, environment,
// headers and the protocol preference each matter to a minority of servers,
// and a first-run form that opens with seven fields is how someone decides the
// feature is not for them.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import type { McpServerConfig } from '@maka/core/mcp';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { SegmentedControl } from '../../ui/segmented-control.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Textarea } from '../../ui/textarea.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import {
  createEmptyMcpDraft,
  mcpConfigFromDraft,
  mcpDraftHasErrors,
  mcpDraftProtocolPreference,
  validateMcpServerDraft,
  type McpDraftError,
  type McpDraftErrors,
  type McpServerDraft,
} from '../../../lib/ported/mcp-server-draft.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import { getMcpCopy, type McpCopy } from '../../../locales/mcp-copy.js';
import { getConnectorsPageCopy } from '../../../locales/connectors-page-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';

/** A new connector starts on the remote transport, the first segment and Claude's only one. */
function newDraft(): McpServerDraft {
  return { ...createEmptyMcpDraft(), kind: 'remote' };
}

export function McpServerDialog(props: {
  open: boolean;
  /** Absent for the add path; the draft to edit otherwise. */
  seed?: McpServerDraft;
  /** Ids already in mcp.json, minus the one being edited. */
  takenIds: readonly string[];
  saving: boolean;
  /** True while a pasted `mcp.json` is being imported. */
  importing: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (serverId: string, config: McpServerConfig) => void;
  /** The dialog's second mode: paste an `mcp.json` and import every server in it. */
  onImport: (source: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getMcpCopy(locale);
  const connectors = getConnectorsPageCopy(locale);
  const modules = getModulesCopy(locale).mcp;
  const shared = getSettingsSharedCopy(locale);
  const editing = props.seed !== undefined;
  const [draft, setDraft] = useState<McpServerDraft>(() => props.seed ?? newDraft());
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Errors are shown only after a submit attempt: an empty form is invalid by
  // definition, and marking every field red before the user has typed reads as
  // a scolding rather than as help.
  const [submitted, setSubmitted] = useState(false);

  // Re-seed on each open rather than remounting from the caller: the caller
  // would have to key the element on a value it does not otherwise need.
  useEffect(() => {
    if (!props.open) return;
    setDraft(props.seed ?? newDraft());
    setShowAdvanced(false);
    setSubmitted(false);
    setMode('manual');
    setSource('');
  }, [props.open, props.seed]);
  // Manual form, or a pasted `mcp.json` (upstream's two modes of the same
  // dialog). Editing an existing server is always the form.
  const [mode, setMode] = useState<'manual' | 'import'>('manual');
  const [source, setSource] = useState('');
  const importing = !editing && mode === 'import';

  const errors = useMemo(
    () => validateMcpServerDraft(draft, props.takenIds),
    [draft, props.takenIds],
  );
  const shown: McpDraftErrors = submitted ? errors : {};
  const patch = (next: Partial<McpServerDraft>) => setDraft((current) => ({ ...current, ...next }));

  const submit = () => {
    setSubmitted(true);
    if (mcpDraftHasErrors(errors)) return;
    const config = mcpConfigFromDraft(draft);
    if (!config) return;
    props.onSubmit(draft.id.trim(), config);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="md:max-w-[33.5rem]">
        <DialogHeader closeLabel={shared.close}>
          <DialogTitle>
            {editing && props.seed ? copy.editor.editTitle(props.seed.id) : copy.editor.addTitle}
          </DialogTitle>
        </DialogHeader>

        {/* One control for the three ways in — a process, a URL, or pasted
            JSON — where there used to be two stacked rows. Editing keeps the
            transport pair only: the JSON path adds servers, it does not edit
            one. */}
        <SegmentedControl<'stdio' | 'remote' | 'import'>
          value={importing ? 'import' : draft.kind}
          ariaLabel={copy.editor.modeAria}
          onChange={(next) => {
            if (next === 'import') {
              setMode('import');
              return;
            }
            setMode('manual');
            patch({ kind: next });
          }}
          options={[
            { value: 'remote', label: copy.editor.remoteUrl },
            { value: 'stdio', label: copy.editor.localStdio },
            ...(editing ? [] : [{ value: 'import' as const, label: copy.editor.importTitle }]),
          ]}
        />

        {importing ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="mcp-import-json" className="sr-only">
              {copy.editor.jsonConfig}
            </Label>
            <Textarea
              id="mcp-import-json"
              rows={10}
              spellCheck={false}
              value={source}
              placeholder={connectors.import.placeholder}
              onChange={(event) => setSource(event.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[0.8125rem] leading-[1.125rem] text-text-muted">
              {copy.editor.jsonHelp}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Claude's form: the field says what it is in its placeholder and
                the line under it says what it is for; the label is for
                assistive tech. */}
            <Field
              label={copy.editor.serverId}
              hideLabel
              htmlFor="mcp-server-id"
              help={copy.editor.serverIdHelp}
              error={fieldMessage(shown.id, copy, modules.duplicateId)}
            >
              <Input
                id="mcp-server-id"
                placeholder={copy.editor.serverId}
                value={draft.id}
                // The id keys mcp.json and binds stored credentials to the
                // endpoint; renaming one is a delete plus an add, not an edit.
                disabled={editing}
                onChange={(event) => patch({ id: event.target.value })}
              />
            </Field>

            {draft.kind === 'stdio' ? (
              <Field
                label={copy.editor.command}
                hideLabel
                htmlFor="mcp-command"
                help={copy.editor.commandHelp}
                error={fieldMessage(shown.commandLine, copy, modules.duplicateId)}
              >
                <Input
                  id="mcp-command"
                  value={draft.commandLine}
                  placeholder={copy.editor.commandPlaceholder}
                  onChange={(event) => patch({ commandLine: event.target.value })}
                />
              </Field>
            ) : (
              <Field
                label={copy.editor.url}
                hideLabel
                htmlFor="mcp-url"
                help={copy.editor.urlHelp}
                error={fieldMessage(shown.url, copy, modules.duplicateId)}
              >
                <Input
                  id="mcp-url"
                  placeholder={copy.editor.url}
                  value={draft.url}
                  onChange={(event) => patch({ url: event.target.value })}
                />
              </Field>
            )}

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((open) => !open)}
                className="flex cursor-pointer items-center gap-2 text-sm leading-5 text-text-secondary transition-colors hover:text-text-primary"
              >
                <Anthropicon
                  name="caretRight"
                  size={16}
                  className={cn('transition-transform', showAdvanced && 'rotate-90')}
                />
                {showAdvanced ? copy.editor.collapseAdvanced : copy.editor.expandAdvanced}
              </button>

              {showAdvanced && (
                <div className="flex flex-col gap-4 pt-4">
                  {draft.kind === 'stdio' ? (
                    <>
                      <Field label={copy.editor.workingDirectory} htmlFor="mcp-cwd">
                        <Input
                          id="mcp-cwd"
                          value={draft.cwd}
                          placeholder={copy.editor.workingDirectoryPlaceholder}
                          onChange={(event) => patch({ cwd: event.target.value })}
                        />
                      </Field>
                      <Field
                        label={copy.editor.environment}
                        htmlFor="mcp-env"
                        help={copy.editor.environmentHelp}
                        error={fieldMessage(shown.env, copy, modules.duplicateId)}
                      >
                        <Textarea
                          id="mcp-env"
                          rows={3}
                          value={draft.env}
                          onChange={(event) => patch({ env: event.target.value })}
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label={copy.editor.transportLabel} htmlFor="mcp-transport-kind">
                        <Select
                          value={draft.transport}
                          onValueChange={(transport) =>
                            patch({ transport: transport as McpServerDraft['transport'] })
                          }
                        >
                          <SelectTrigger
                            id="mcp-transport-kind"
                            aria-label={copy.editor.transportLabel}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">{copy.editor.transportAuto}</SelectItem>
                            <SelectItem value="streamable-http">
                              {copy.editor.transportStreamableHttp}
                            </SelectItem>
                            <SelectItem value="sse">{copy.editor.transportLegacySse}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field
                        label={copy.editor.headers}
                        htmlFor="mcp-headers"
                        help={copy.editor.headersHelp}
                        error={fieldMessage(shown.headers, copy, modules.duplicateId)}
                      >
                        <Textarea
                          id="mcp-headers"
                          rows={3}
                          value={draft.headers}
                          onChange={(event) => patch({ headers: event.target.value })}
                        />
                      </Field>
                    </>
                  )}

                  <Field
                    label={copy.editor.protocolLabel}
                    htmlFor="mcp-protocol"
                    help={
                      draft.kind === 'stdio'
                        ? copy.editor.stdioProtocolHelp
                        : draft.transport === 'sse'
                          ? copy.editor.sseProtocolHelp
                          : copy.editor.protocolHelp
                    }
                  >
                    <Select
                      // Legacy SSE has no modern era to negotiate; the field
                      // states the fact rather than offering a choice that the
                      // draft would override anyway.
                      disabled={draft.kind === 'remote' && draft.transport === 'sse'}
                      value={mcpDraftProtocolPreference(draft)}
                      onValueChange={(protocol) =>
                        patch({ protocol: protocol as McpServerDraft['protocol'] })
                      }
                    >
                      <SelectTrigger id="mcp-protocol" aria-label={copy.editor.protocolLabel}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="legacy">{copy.editor.protocolLegacy}</SelectItem>
                        <SelectItem value="auto">{copy.editor.protocolAuto}</SelectItem>
                        <SelectItem value="2026-07-28">{copy.editor.protocolModern}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => props.onOpenChange(false)}>
            {copy.editor.cancel}
          </Button>
          {importing ? (
            <Button
              disabled={props.importing || source.trim().length === 0}
              aria-busy={props.importing || undefined}
              onClick={() => props.onImport(source)}
            >
              {props.importing ? connectors.import.importing : copy.editor.importConnect}
            </Button>
          ) : (
            <Button onClick={submit} disabled={props.saving} aria-busy={props.saving || undefined}>
              {copy.editor.saveConnect}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field(props: {
  label: string;
  /** Omitted where the control is not a labelable element (a radiogroup, or
   *  a read-only value): a `<label for>` pointing at a `<p>` names nothing. */
  htmlFor?: string;
  /** The control's placeholder carries the name; the label is for assistive tech. */
  hideLabel?: boolean;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {props.htmlFor ? (
        <Label
          htmlFor={props.htmlFor}
          className={props.hideLabel ? 'sr-only' : 'text-sm leading-5 text-text-primary'}
        >
          {props.label}
        </Label>
      ) : (
        <span className="text-sm leading-5 text-text-primary">{props.label}</span>
      )}
      {props.children}
      {props.error ? (
        <p className="text-[0.8125rem] leading-[1.125rem] text-danger" role="alert">
          {props.error}
        </p>
      ) : props.help ? (
        <p className="text-[0.8125rem] leading-[1.125rem] text-text-muted">{props.help}</p>
      ) : null}
    </div>
  );
}

function fieldMessage(
  error: McpDraftError | undefined,
  copy: McpCopy,
  duplicateId: string,
): string | undefined {
  if (!error) return undefined;
  switch (error.issue) {
    case 'required':
      return copy.editor.required;
    case 'invalid-url':
      return copy.editor.invalidUrl;
    case 'unbalanced-quote':
      return copy.editor.unbalancedQuote;
    case 'duplicate-id':
      return duplicateId;
    case 'invalid-map':
      return copy.errors.mapLine(error.line ?? 1);
  }
}
