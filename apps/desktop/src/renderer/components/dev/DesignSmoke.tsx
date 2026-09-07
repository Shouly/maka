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

// TEMPORARY. Phase 2 replaces this page with the real shell.
//
// It exists so design parity with the reference system can be checked by
// looking rather than by reading diffs: every token family, every ported
// primitive and the markdown pipeline on one scrollable page, in both themes.
// It is also the only surface in the tree allowed to hold English string
// literals — every other user-visible string goes through a `UiCatalog`
// (plan §7). When this file goes, that exemption goes with it.

import { useState } from 'react';
import type { ToolActivityItem, TurnViewModel } from '@maka/ui';
import { TranscriptTurn } from '../session/TranscriptTurn';
import { deriveTurnPresentation } from '../../hooks/use-turn-presentation';
import { Anthropicon, type AnthropiconName } from '../icons';
import { Avatar } from '../ui/avatar';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { menuDangerItemClass } from '../ui/menu-variants';
import { Label } from '../ui/label';
import Markdown from '../ui/Markdown';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { SegmentedControl } from '../ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import SplitButton from '../ui/split-button';
import { Switch } from '../ui/switch';
import { TextShimmer } from '../ui/text-shimmer';
import { Textarea } from '../ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { UserAvatar } from '../ui/user-avatar';
import { useToast } from '../../store/toast-store';
import { applyTheme } from '../../lib/theme';

const SURFACES: ReadonlyArray<readonly [string, string]> = [
  ['surface-0', 'bg-surface-0'],
  ['surface-1', 'bg-surface-1'],
  ['surface-2', 'bg-surface-2'],
  ['surface-3', 'bg-surface-3'],
];

const ROLES: ReadonlyArray<{
  readonly name: string;
  readonly text: string;
  readonly fill: string;
  readonly line: string;
  readonly subtle: string;
  readonly on: string;
}> = [
  {
    name: 'accent',
    text: 'text-accent',
    fill: 'bg-accent-fill',
    line: 'border-accent-line',
    subtle: 'bg-accent-subtle',
    on: 'text-on-accent',
  },
  {
    name: 'danger',
    text: 'text-danger',
    fill: 'bg-danger-fill',
    line: 'border-danger-line',
    subtle: 'bg-danger-subtle',
    on: 'text-on-danger',
  },
  {
    name: 'warning',
    text: 'text-warning',
    fill: 'bg-warning-fill',
    line: 'border-warning-line',
    subtle: 'bg-warning-subtle',
    on: 'text-on-warning',
  },
  {
    name: 'success',
    text: 'text-success',
    fill: 'bg-success-fill',
    line: 'border-success-line',
    subtle: 'bg-success-subtle',
    on: 'text-on-success',
  },
];

const ICONS: readonly AnthropiconName[] = [
  'add',
  'agent',
  'archive',
  'artifacts',
  'attach',
  'book',
  'chat',
  'check',
  'clock',
  'code',
  'copy',
  'edit',
  'file',
  'folder',
  'globe',
  'lightning',
  'lock',
  'memory',
  'search',
  'settings',
  'sidebar',
  'terminal',
  'trash',
  'warning',
];

const MARKDOWN_SAMPLE = `# Markdown pipeline

A paragraph with **bold**, *italic*, \`inline code\`, a colour swatch \`#d97757\`,
and an [external link](https://example.com) that hands the URL to the host.

## List and table

- remark-gfm tables and task lists
- remark-math + rehype-katex for formulas
- Prism for fenced code

| Stage | Owner | Status |
| --- | --- | --- |
| Tokens | globals.css | done |
| Primitives | components/ui | done |
| Shell | Phase 2 | pending |

### Code

\`\`\`ts
export function greet(name: string): string {
  return \`hello, \${name}\`;
}
\`\`\`

### Math

The Gaussian integral is $\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$.

$$
\\mathcal{L}(\\theta) = \\prod_{i=1}^{n} p(x_i \\mid \\theta)
$$

> A blockquote, for the quiet tier of text.
`;

/** One turn holding every timeline shape, so all four renderers are visible. */
const TRANSCRIPT_FIXTURE: TurnViewModel = (() => {
  const diff: ToolActivityItem = {
    toolUseId: 'preview-diff',
    toolName: 'Edit',
    activityKind: 'edit',
    status: 'completed',
    args: { path: 'src/session/transcript.ts' },
    result: {
      kind: 'file_diff',
      paths: ['src/session/transcript.ts'],
      diff: [
        '@@ -12,7 +12,8 @@',
        ' export function project(input: Input) {',
        '-  const rows = input.turns.map(toRow);',
        '+  // Keep the previous object when the value did not move.',
        '+  const rows = reconcile(previous, input.turns.map(toRow));',
        '   return rows;',
        ' }',
      ].join('\n'),
    },
  };
  const terminal: ToolActivityItem = {
    toolUseId: 'preview-terminal',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'completed',
    args: { command: 'npm test -- transcript' },
    result: {
      kind: 'terminal',
      cwd: '/Users/dev/maka',
      cmd: 'npm test -- transcript',
      status: 'completed',
      exitCode: 0,
      output: {
        mode: 'pipes',
        stdout: '# tests 96\n# pass 96\n# fail 0\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    },
  };
  const subagent: ToolActivityItem = {
    toolUseId: 'preview-agent',
    toolName: 'Agent',
    activityKind: 'tool',
    status: 'completed',
    args: { profile: 'reviewer' },
    result: {
      kind: 'subagent',
      childSessionId: 'preview-child',
      agentName: 'reviewer',
      turnId: 'preview-child-turn',
      status: 'completed',
      permissionMode: 'explore',
      summary: 'Reviewed the projection change and found no regressions.',
      artifactIds: [],
      durationMs: 8200,
    },
  };
  return {
    turnId: 'preview-turn',
    status: 'completed',
    partialOutputRetained: false,
    user: {
      id: 'preview-user',
      role: 'user',
      text: 'Keep the transcript from re-rendering every turn on each token.',
      ts: Date.UTC(2026, 8, 7, 9, 30),
    },
    assistant: { id: 'preview-assistant', role: 'assistant', text: 'Done.' },
    tools: [diff, terminal, subagent],
    timeline: [
      {
        kind: 'thinking',
        messageId: 'preview-step-1',
        text: 'The projection already knows which turns moved. If it hands the previous object back for the rest, the memo above it can compare by identity instead of by value.',
      },
      { kind: 'tools', items: [diff, terminal, subagent] },
      {
        kind: 'text',
        messageId: 'preview-step-2',
        complete: true,
        text: 'Reconciled the projection so a turn keeps its object identity unless its value changed. `npm test -- transcript` passes.',
      },
    ],
    notes: [],
    startedAt: Date.UTC(2026, 8, 7, 9, 30),
    modelId: 'claude-sonnet-4-5',
    durationMs: 12_400,
  };
})();

const TRANSCRIPT_FIXTURE_ACTIONS = deriveTurnPresentation([TRANSCRIPT_FIXTURE], {
  activeId: 'preview-session',
  pendingTurnActions: new Set<string>(),
  uiLocale: 'en',
}).footerActionsByTurn['preview-turn'] ?? [];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg leading-6 text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function DesignSmoke({ showThemeControl = true }: { showThemeControl?: boolean } = {}) {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
  const [switched, setSwitched] = useState(true);
  const [segment, setSegment] = useState<'chat' | 'files' | 'terminal'>('chat');
  const [model, setModel] = useState('sonnet');
  const { toast } = useToast();

  const cycleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-3xl leading-9 text-text-primary">
              Enterprise design system
            </h1>
            <p className="text-sm leading-5 text-text-secondary">
              Phase 0b smoke page — tokens, fonts, icons and primitives.
            </p>
          </div>
          {showThemeControl && <Button variant="secondary" onClick={cycleTheme}>
            <Anthropicon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'sunHorizon'} size={16} />
            Theme: {theme}
          </Button>}
        </header>

        <Section title="Surfaces">
          <div className="grid grid-cols-4 gap-3">
            {SURFACES.map(([name, className]) => (
              <div
                key={name}
                className={`flex h-20 items-end rounded-lg border border-hairline p-2 ${className}`}
              >
                <span className="font-mono text-xs text-text-muted">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Text tiers">
          <div className="flex flex-col gap-1">
            <p className="text-base text-text-primary">text-primary — the reading tier</p>
            <p className="text-base text-text-secondary">text-secondary — the supporting tier</p>
            <p className="text-base text-text-muted">text-muted — the quiet tier</p>
            <p className="text-base text-text-disabled">text-disabled — unavailable</p>
            <p className="font-display text-2xl text-text-primary">
              Serif display face — anthropic-serif
            </p>
            <p className="font-mono text-sm text-text-secondary">
              Mono face — anthropic-mono 0123456789 {'{}'} =&gt; !==
            </p>
          </div>
        </Section>

        <Section title="Role quads">
          <div className="grid grid-cols-4 gap-3">
            {ROLES.map((role) => (
              <div key={role.name} className="flex flex-col gap-2">
                <div className={`rounded-md px-2 py-1 text-center text-xs ${role.fill} ${role.on}`}>
                  {role.name}
                </div>
                <div
                  className={`rounded-md border px-2 py-1 text-center text-xs ${role.line} ${role.subtle} ${role.text}`}
                >
                  subtle
                </div>
                <span className={`text-center text-xs ${role.text}`}>text</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add">
              <Anthropicon name="add" size={20} />
            </Button>
            <Button size="iconSm" variant="ghost" aria-label="Settings">
              <Anthropicon name="settings" size={16} />
            </Button>
            <SplitButton
              primaryLabel="Run"
              primaryAction={() => toast({ description: 'Primary action' })}
              actions={[
                { label: 'Run and watch', onClick: () => toast({ description: 'Run and watch' }) },
                { label: 'Dry run', onClick: () => toast({ description: 'Dry run' }) },
              ]}
            />
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smoke-input">Input</Label>
              <Input id="smoke-input" placeholder="A single-line field" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smoke-select">Select</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="smoke-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                  <SelectItem value="haiku">Haiku</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="smoke-textarea">Textarea</Label>
              <Textarea id="smoke-textarea" rows={3} placeholder="A multi-line field" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={switched} onCheckedChange={setSwitched} id="smoke-switch" />
              <Label htmlFor="smoke-switch">Switch</Label>
            </div>
            <SegmentedControl
              ariaLabel="Panel"
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'chat', label: 'Chat', icon: 'chat', showLabel: true },
                { value: 'files', label: 'Files', icon: 'files', showLabel: true },
                { value: 'terminal', label: 'Terminal', icon: 'terminal', showLabel: true },
              ]}
            />
          </div>
        </Section>

        <Section title="Overlays">
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog</DialogTitle>
                  <DialogDescription>
                    Radix dialog on the design system's overlay and shadow tokens.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="secondary">Cancel</Button>
                  <Button>Confirm</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  Menu
                  <Anthropicon name="caretDown" size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={menuDangerItemClass}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Popover</Button>
              </PopoverTrigger>
              <PopoverContent className="p-3">
                <p className="text-sm text-text-secondary">
                  Popovers share the menu surface tokens.
                </p>
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Tooltip">
                  <Anthropicon name="info" size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>A tooltip</TooltipContent>
            </Tooltip>

            <Button
              variant="secondary"
              onClick={() =>
                toast({ variant: 'success', description: 'Toast on the success variant' })
              }
            >
              Toast
            </Button>
          </div>
        </Section>

        <Section title="Avatars, skeletons, shimmer">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar value="maka-design-system" size={40} />
            <UserAvatar user={{ nickname: 'Ada', avatar_seed: 'ada' }} size={40} />
            <UserAvatar user={{ full_name: 'Grace Hopper' }} size={40} />
            <UserAvatar user={{ email: 'self@example.com' }} isSelf size={40} />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <TextShimmer className="text-sm">Thinking…</TextShimmer>
          </div>
        </Section>

        <Section title="Anthropicons">
          {([16, 20, 24] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3 text-text-secondary">
              <span className="w-8 font-mono text-xs text-text-muted">{size}</span>
              {ICONS.map((name) => (
                <Anthropicon key={`${size}-${name}`} name={name} size={size} />
              ))}
            </div>
          ))}
        </Section>

        <Section title="Markdown">
          <div className="rounded-lg border border-hairline bg-surface-2 p-4">
            <Markdown noPadding onOpenExternal={(url) => toast({ description: `Open ${url}` })}>
              {MARKDOWN_SAMPLE}
            </Markdown>
          </div>
        </Section>

        {/* Phase 3a. A whole turn, from a fixture: the ask, reasoning, the tool
            timeline with three different result renderers, the answer and the
            footer. The deterministic test backend emits none of these shapes,
            so this is the only place the diff / terminal / subagent bodies can
            be looked at rather than read about. */}
        <Section title="Transcript">
          <div
            className="chat-area rounded-lg border border-hairline bg-surface-1 p-4"
            data-maka-contract="transcript-preview"
          >
            <TranscriptTurn
              turn={TRANSCRIPT_FIXTURE}
              live={false}
              footerActions={TRANSCRIPT_FIXTURE_ACTIONS}
              toolContext={{ onOpenSession: () => {}, onOpenExternal: () => {} }}
              onFooterAction={() => {}}
              onOpenLineage={() => {}}
              onOpenExternal={() => {}}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
