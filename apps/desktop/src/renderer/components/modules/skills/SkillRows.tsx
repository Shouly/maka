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

// One row per skill, on the shared list grammar: icon tile, name, chips, one
// muted line of meta, the switch and the ⋯ menu.
//
// Two things the row used to swallow are on it now, because both are how a
// user tells two skills apart:
//
//   - the declared tools BY NAME. "3 tools" answered a question nobody asks;
//     whether one of them is Bash is the question people actually have.
//   - where the file lives. Three scopes can hold a skill with the same name,
//     and the path is the only thing that says which row is which — it rides
//     the name's tooltip rather than the meta line, which already has a job.
//
// The capability chip is a separate rung: when the Host cannot satisfy what a
// skill requires, the ladder in `skill-status.ts` already puts "Host
// incompatible" on the chip, and the tooltip is what turns that verdict into
// something the user can act on.

import {
  formatSkillLibraryDescription,
  formatSkillStatusLabel,
  skillContextStatus,
  skillExceptionalStateLabel,
  skillStatusSemantic,
  type BundledSkillCatalogEntry,
  type ManagedSkillSourceEntry,
  type SkillEntry,
  type SkillsCopy,
} from '@maka/ui';
import { Button } from '../../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { ListRow } from '../../ui/list-page.js';
import { Switch } from '../../ui/switch.js';
import {
  STATUS_CHIP_ICON_SIZE,
  statusChipClass,
  statusChipIconSlotClass,
  statusChipToneClass,
} from '../../ui/status-chip.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';
import { menuDangerItemClass, menuTriggerButtonClass } from '../../ui/menu-variants.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import type { ModulesCopy } from '../../../locales/modules-copy.js';
import type { SkillsPageCopy } from '../../../locales/skills-page-copy.js';
import {
  skillHostIncompatible,
  skillUpdateReviewable,
  summarizeDeclaredTools,
} from './skill-filters.js';

export type ModuleSkillsCopy = ModulesCopy['skills'];

/** Names on the row; the rest go to the tooltip, which has room for all of them. */
const META_TOOL_LIMIT = 3;

export const skillIcon = <Anthropicon name="scroll" size={20} />;

export function InstalledSkillRow(props: {
  skill: SkillEntry;
  busy: boolean;
  copy: ModuleSkillsCopy;
  skillsCopy: SkillsCopy;
  page: SkillsPageCopy;
  onToggle: (enabled: boolean) => void;
  onOpen: (target: 'file' | 'directory') => void;
  onUse: () => void;
  onReviewUpdate: () => void;
  onDelete: () => void;
}) {
  const { skill, copy, skillsCopy, page } = props;
  // A discovery diagnostic is not a skill: it is the loader telling the user
  // why a folder produced nothing. It gets the row and none of the controls,
  // because there is nothing here to enable, pin or delete.
  if (skill.kind === 'discovery_diagnostic') {
    const reason = skill.discoveryDiagnosticReason;
    return (
      <ListRow
        icon={<Anthropicon name="warningCircle" size={20} />}
        title={skill.name}
        chips={
          <span className={cn(statusChipClass, statusChipToneClass('attention'))}>
            {skillsCopy.context.needsReview}
          </span>
        }
        meta={reason ? skillsCopy.context.discoveryDiagnostic[reason] : skill.description}
      />
    );
  }

  const exceptional = skillExceptionalStateLabel(skill, skillsCopy);
  const description = formatSkillLibraryDescription(skill, skillsCopy);
  const scope = skill.scope ? skillsCopy.context.scope[skill.scope] : undefined;
  const tools = skill.declaredTools ?? [];
  const toolSummary = summarizeDeclaredTools(tools, META_TOOL_LIMIT, page.detail.moreTools);
  const meta = [scope, description, toolSummary ? page.detail.tools(toolSummary) : undefined]
    .filter(Boolean)
    .join(' · ');
  const incompatible = skillHostIncompatible(skill);
  // The list is sectioned by origin, so "Built in" / "Local" / "Managed" as a
  // chip would only repeat the heading. A chip is for what the heading does
  // not say: an error, something to review, an update, a local edit — or
  // that the switch is off, which the switch alone says only in colour.
  const semantic = skillStatusSemantic(skill);
  const statusLabel =
    exceptional ??
    (semantic === 'error' || semantic === 'attention' || skill.userModified
      ? formatSkillStatusLabel(skill, skillsCopy)
      : skill.enabled
        ? undefined
        : skillsCopy.status.disabled);
  const reviewable = skillUpdateReviewable(skill);
  // Upstream's rule: a skill that is off, or shadowed by a higher-priority
  // copy of itself, would not be the one that runs — so it is not offered.
  const usable = skill.enabled && skillContextStatus(skill) !== 'shadowed';

  return (
    <ListRow
      icon={skillIcon}
      title={
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="min-w-0 truncate outline-none">
              {skill.name}
            </span>
          </TooltipTrigger>
          <TooltipContent variant="description">
            <span className="block break-all">{`${skillsCopy.detail.pathLabel}: ${skill.path}`}</span>
            {tools.length > 0 && (
              <span className="mt-1 block">{page.detail.tools(tools.join(', '))}</span>
            )}
          </TooltipContent>
        </Tooltip>
      }
      chips={
        incompatible ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className={cn(
                  statusChipClass,
                  statusChipToneClass('attention'),
                  'outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                )}
              >
                <span className={statusChipIconSlotClass}>
                  <Anthropicon name="warningCircle" size={STATUS_CHIP_ICON_SIZE} />
                </span>
                {skillsCopy.context.decision.host_incompatible}
              </span>
            </TooltipTrigger>
            <TooltipContent variant="description">
              <span className="block">{page.capability.tooltip}</span>
              {tools.length > 0 && (
                <span className="mt-1 block">{page.detail.tools(tools.join(', '))}</span>
              )}
            </TooltipContent>
          </Tooltip>
        ) : statusLabel ? (
          <span className={cn(statusChipClass, statusChipToneClass(semantic))}>{statusLabel}</span>
        ) : undefined
      }
      meta={meta}
      busy={props.busy}
      trailing={
        <>
          <Switch
            aria-label={copy.enableSkill(skill.name)}
            checked={skill.enabled}
            disabled={props.busy}
            onCheckedChange={props.onToggle}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={menuTriggerButtonClass}
                aria-label={copy.rowActions(skill.name)}
                disabled={props.busy}
              >
                <Anthropicon name="dotsVertical" size={20} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {usable && (
                <DropdownMenuItem onSelect={props.onUse}>
                  <Anthropicon name="chat" size={20} />
                  <span className="flex-1">{page.use.action}</span>
                </DropdownMenuItem>
              )}
              {reviewable && (
                <DropdownMenuItem onSelect={props.onReviewUpdate}>
                  <Anthropicon
                    name={
                      skill.managedUpdateStatus === 'local_modified' ? 'files' : 'arrowUpCircle'
                    }
                    size={20}
                  />
                  <span className="flex-1">
                    {skill.managedUpdateStatus === 'local_modified'
                      ? skillsCopy.row.viewDiff
                      : skillsCopy.row.viewUpdate}
                  </span>
                </DropdownMenuItem>
              )}
              {(usable || reviewable) && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => props.onOpen('file')}>
                <Anthropicon name="file" size={20} />
                <span className="flex-1">{copy.openFile}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onOpen('directory')}>
                <Anthropicon name="folderOpen" size={20} />
                <span className="flex-1">{copy.openDirectory}</span>
              </DropdownMenuItem>
              {/* `manageable === false` is the Host saying this entry is not the
                  user's to remove (a bundled skill outside the workspace). */}
              {skill.manageable !== false && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onDelete}>
                    <Anthropicon name="trash" size={20} />
                    <span className="flex-1">{skillsCopy.row.delete}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}

function InstallControl(props: {
  installed: boolean;
  busy: boolean;
  pending: boolean;
  copy: ModuleSkillsCopy;
  onInstall: () => void;
}) {
  return props.installed ? (
    <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
      {props.copy.installed}
    </span>
  ) : (
    <Button
      variant="secondary"
      size="sm"
      disabled={props.busy}
      aria-busy={props.pending || undefined}
      onClick={props.onInstall}
    >
      {props.pending ? props.copy.installing : props.copy.install}
    </Button>
  );
}

export function CatalogSkillRow(props: {
  entry: BundledSkillCatalogEntry;
  busy: boolean;
  pending: boolean;
  copy: ModuleSkillsCopy;
  skillsCopy: SkillsCopy;
  page: SkillsPageCopy;
  onInstall: () => void;
}) {
  const { entry, skillsCopy, page } = props;
  const tools = summarizeDeclaredTools(entry.declaredTools, META_TOOL_LIMIT, page.detail.moreTools);
  return (
    <ListRow
      icon={skillIcon}
      title={entry.name}
      chips={
        <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
          {skillsCopy.categories[entry.category]}
        </span>
      }
      meta={[entry.description, tools ? page.detail.tools(tools) : undefined]
        .filter(Boolean)
        .join(' · ')}
      trailing={<InstallControl installed={entry.installed} {...props} />}
    />
  );
}

export function SourceSkillRow(props: {
  entry: ManagedSkillSourceEntry;
  installed: boolean;
  busy: boolean;
  pending: boolean;
  copy: ModuleSkillsCopy;
  skillsCopy: SkillsCopy;
  onInstall: () => void;
}) {
  const { entry, skillsCopy } = props;
  return (
    <ListRow
      icon={skillIcon}
      title={entry.name}
      chips={
        <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
          {skillsCopy.categories[entry.category]}
        </span>
      }
      meta={entry.description || skillsCopy.market.sourceFallback}
      trailing={<InstallControl {...props} />}
    />
  );
}
