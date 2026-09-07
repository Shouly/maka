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

// The composer's text surface: a TipTap editor that keeps a plain paragraph
// document plus inline atoms for `@file` and `/skill` references. Nothing
// else from StarterKit is enabled — the wire format is plain text, so bold or
// lists would only be lost on send.
//
// `@` and `/` open a suggestion list under the caret's paragraph. The query
// is read from the text before the caret (no `@tiptap/suggestion` plugin: the
// two triggers share one list and one keyboard model, and the list must also
// answer with desktop slash commands that are not skills). Files come from
// the Session's or the new-task target's workspace search; skills from the
// invocable-skill list. Picking inserts an atom followed by a space.
//
// Keyboard model while the list is open: ↑ ↓ move, ⏎ / Tab pick, Esc closes,
// Space picks an exact skill name. Otherwise ⏎ sends, ⇧⏎ breaks the line, and
// ↑ ↓ are offered to the prompt history. IME composition is left alone.
//
// The list wears the shared menu chrome (`menu-variants.ts`) so it matches
// every other floating menu in the app.

import { useEffect, useId, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Node, mergeAttributes, type JSONContent, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { getConversationCopy, useUiLocale, mentionQueryMatches, skillMentionQuery } from '@maka/ui';
import { searchWorkspaceFiles } from '../../bridge/workspace.js';
import {
  searchNewTaskFiles,
  listNewTaskInvocableSkills,
  type DesktopNewTaskTarget,
} from '../../bridge/new-tasks.js';
import { listInvocableSkills } from '../../bridge/skills.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { menuContentClass, menuItemClass, menuShellClass } from '../ui/menu-variants.js';
import { cn } from '../../lib/cn.js';
import { getComposerCopy } from '../../locales/composer-copy.js';

/**
 * The inline atom for a file or skill reference. `value` is what the wire
 * text carries (relative path, skill id); `label` is what the user sees.
 */
const Reference = Node.create({
  name: 'composerReference',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { kind: { default: 'file' }, value: { default: '' }, label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-composer-reference]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-composer-reference': node.attrs.kind,
        'data-id': node.attrs.value,
        'data-label': node.attrs.label,
        // relx: the token is only accent-coloured text, in the paragraph's
        // own size and weight.
        class: 'text-accent',
      }),
      `${node.attrs.kind === 'file' ? '@' : '/'}${node.attrs.label || node.attrs.value}`,
    ];
  },
  renderText({ node }) {
    return node.attrs.kind === 'file' ? `@${node.attrs.value}` : `/skill:${node.attrs.label}`;
  },
});

interface Suggestion {
  kind: 'file' | 'skill' | 'command';
  value: string;
  label: string;
  description?: string;
}

interface SuggestionQuery {
  kind: '@' | '/';
  text: string;
  /** Document range of the trigger character plus the typed query. */
  from: number;
  to: number;
  /** True when nothing precedes the trigger — where slash COMMANDS are valid. */
  atStart: boolean;
}

const SEARCH_DEBOUNCE_MS = 100;
const SUGGESTION_LIMIT = 20;

export function TipTapEditor(props: {
  scopeKey: string;
  sessionId?: string;
  target?: DesktopNewTaskTarget;
  document: JSONContent;
  onChange: (doc: JSONContent) => void;
  onSubmit: () => void;
  onCommand: (command: string) => void;
  onEditor: (editor: Editor | null) => void;
  onArrow: (event: KeyboardEvent) => boolean;
  label: string;
  placeholder: string;
  disabled?: boolean;
  running?: boolean;
}) {
  const locale = useUiLocale();
  const copy = getConversationCopy(locale).mentions;
  const local = getComposerCopy(locale);
  const menuId = useId();
  const [query, setQuery] = useState<SuggestionQuery>();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // The editor is created once per scope; its callbacks read the latest
  // props through this ref instead of the closure they were created in.
  const live = useRef(props);
  live.current = props;
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const updateQuery = (editor: Editor) => {
    const { selection } = editor.state;
    if (!selection.empty) {
      setQuery(undefined);
      return;
    }
    const prefix = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '', ' ');
    const match = /(?:^|\s)([@/])([^\s]*)$/.exec(prefix);
    if (!match) {
      setQuery(undefined);
      return;
    }
    const text = match[2]!;
    const from = selection.from - text.length - 1;
    setQuery({
      kind: match[1] as '@' | '/',
      text,
      from,
      to: selection.from,
      atStart: editor.state.doc.textBetween(0, from, '\n', ' ').trim() === '',
    });
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          codeBlock: false,
          horizontalRule: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
          link: false,
        }),
        Reference,
        Placeholder.configure({
          placeholder: () => live.current.placeholder,
          // Show the hint whether or not the editor is focused (relx).
          showOnlyCurrent: false,
          showOnlyWhenEditable: false,
        }),
      ],
      content: props.document,
      editable: !props.disabled,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-autocomplete': 'list',
          'aria-label': props.label,
          'aria-controls': menuId,
          'aria-expanded': 'false',
          'data-maka-contract': 'composer-input',
          // py-[5px]: 22px line + 10px = one 32px control height (relx).
          class:
            'min-h-8 max-h-64 overflow-y-auto whitespace-pre-wrap break-words px-2 py-[5px] outline-none text-text-primary',
        },
        handleKeyDown: (_view, event) => keyHandler.current(event),
      },
      onUpdate: ({ editor }) => {
        live.current.onChange(editor.getJSON());
        updateQuery(editor);
      },
      onSelectionUpdate: ({ editor }) => updateQuery(editor),
      onBlur: () => setQuery(undefined),
    },
    [props.scopeKey],
  );

  useEffect(() => {
    props.onEditor(editor);
    return () => props.onEditor(null);
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!props.disabled, false);
  }, [editor, props.disabled]);

  // External document changes (draft restore, history recall, send clearing)
  // replace the content; the caret goes to the end when the editor is the
  // active element, so a recalled prompt can be edited straight away.
  useEffect(() => {
    if (!editor) return;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(props.document)) return;
    editor.commands.setContent(props.document, { emitUpdate: false });
    if (editor.isFocused) editor.commands.focus('end');
  }, [editor, props.document]);

  // The listbox relationship lives on the contenteditable's attributes, which
  // TipTap only writes at creation — so mirror the open state and the active
  // option by hand.
  useEffect(() => {
    if (!editor) return;
    const open = Boolean(query);
    const active = open && items.length > 0 ? `${menuId}-${selected}` : undefined;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...(editor.options.editorProps.attributes as Record<string, string>),
          'aria-label': props.label,
          'aria-expanded': String(open),
          ...(active ? { 'aria-activedescendant': active } : {}),
        },
      },
    });
    if (!active) editor.view.dom.removeAttribute('aria-activedescendant');
  }, [editor, props.label, query, selected, items.length, menuId]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected, items]);

  // Search follows the query with a short debounce; a result that arrives
  // after the query moved on is dropped.
  useEffect(() => {
    let current = true;
    setItems([]);
    setSelected(0);
    if (!query) return;
    setSearching(true);
    const search = async (): Promise<Suggestion[]> => {
      if (query.kind === '@') {
        const result = props.sessionId
          ? await searchWorkspaceFiles(query.text, {
              sessionId: props.sessionId,
              limit: SUGGESTION_LIMIT,
            })
          : props.target
            ? await searchNewTaskFiles(props.target, query.text, { limit: SUGGESTION_LIMIT })
            : undefined;
        return result?.ok
          ? result.files.map((file) => ({
              kind: 'file',
              value: file.relativePath,
              label: file.relativePath,
            }))
          : [];
      }
      const skills = props.sessionId
        ? await listInvocableSkills(props.sessionId)
        : props.target
          ? await listNewTaskInvocableSkills(props.target)
          : [];
      const matches: Suggestion[] = skills
        .filter((skill) =>
          mentionQueryMatches(
            skillMentionQuery(query.text),
            `${skill.name} ${skill.description ?? ''}`,
          ),
        )
        .slice(0, SUGGESTION_LIMIT)
        .map((skill) => ({
          kind: 'skill',
          value: skill.id,
          label: skill.name,
          description: skill.description,
        }));
      // `/compact` is a desktop command, offered only as the whole message
      // and only when a turn can accept it.
      if (
        query.atStart &&
        props.sessionId &&
        !props.running &&
        'compact'.startsWith(query.text.toLowerCase())
      ) {
        matches.unshift({ kind: 'command', value: 'compact', ...local.slash.command.compact });
      }
      return matches;
    };
    const timer = setTimeout(() => {
      void search()
        .then((results) => {
          if (current) setItems(results);
        })
        .catch(() => {})
        .finally(() => {
          if (current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query?.kind, query?.text, props.scopeKey, locale, props.running]);

  const choose = (item: Suggestion) => {
    if (!query || !editor) return;
    const range = { from: query.from, to: query.to };
    setQuery(undefined);
    if (item.kind === 'command') {
      editor.chain().focus().deleteRange(range).run();
      props.onCommand(item.value);
      return;
    }
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        {
          type: 'composerReference',
          attrs: { kind: item.kind, value: item.value, label: item.label },
        },
        { type: 'text', text: ' ' },
      ])
      .run();
  };

  keyHandler.current = (event) => {
    if (event.isComposing || editor?.view.composing || event.key === 'Process') return false;
    if (query) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setQuery(undefined);
        return true;
      }
      if (items.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelected((index) => (index + step + items.length) % items.length);
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && items.length) {
        event.preventDefault();
        choose(items[selected] ?? items[0]!);
        return true;
      }
      if (event.key === 'Enter' && searching) {
        // Do not send half a query while the list is still loading.
        event.preventDefault();
        return true;
      }
      if (event.key === ' ' && query.kind === '/') {
        const exact = items.find(
          (item) =>
            item.kind !== 'command' && item.label.toLowerCase() === query.text.toLowerCase(),
        );
        if (exact) {
          event.preventDefault();
          choose(exact);
          return true;
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      props.onSubmit();
      return true;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return props.onArrow(event);
    return false;
  };

  const emptyText = searching
    ? copy.loading
    : query?.kind === '@'
      ? copy.noFiles
      : copy.noCommandsOrSkills;

  return (
    <div className="relative min-w-0" data-maka-file-drop-target="true">
      {query && (
        <div
          id={menuId}
          role="listbox"
          aria-label={query.kind === '@' ? copy.filesAriaLabel : copy.commandsAndSkillsAriaLabel}
          className={cn(
            menuContentClass,
            menuShellClass,
            'absolute bottom-full left-0 mb-2 min-w-60 max-w-[min(32rem,100%)] max-h-[min(24rem,40vh)]',
          )}
        >
          {items.length === 0 ? (
            <div className="px-2.5 py-2 text-center text-[13px] leading-[18px] text-menu-text-muted">
              {emptyText}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto scroll-fade-y p-1">
              {items.map((item, index) => {
                const isSelected = selected === index;
                return (
                  <button
                    key={`${item.kind}:${item.value}`}
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    id={`${menuId}-${index}`}
                    aria-selected={isSelected}
                    className={cn(
                      menuItemClass,
                      'w-full justify-start text-left',
                      isSelected && 'bg-menu-hover',
                    )}
                    // Keep the editor focused: a mousedown would blur it and
                    // close the list before the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => choose(item)}
                    title={item.description}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center opacity-50">
                      <Anthropicon
                        name={
                          item.kind === 'file'
                            ? 'file'
                            : item.kind === 'skill'
                              ? 'scroll'
                              : 'terminal'
                        }
                        size={16}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="shrink-0 whitespace-nowrap">{item.label}</span>
                      {item.description && (
                        <>
                          <span className="shrink-0 text-xs text-menu-text-muted/50">·</span>
                          <span className="min-w-0 truncate text-xs text-menu-text-muted">
                            {item.description}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
