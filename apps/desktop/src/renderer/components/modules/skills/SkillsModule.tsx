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

// Skills: what the agent can invoke, where each one came from, which are on.
//
// Three lists, one page, in the order a user meets them: what is installed,
// what the app ships, what has been imported from this machine. The reference
// design's capabilities page is a stack of `SettingsSection`s over rows, which
// is what this is — a skill is a name, a sentence and a switch, and a card
// grid would give three lines of chrome to each.
//
// The failure model is the reason this file is longer than the markup:
// `skills.*` answers with `{ ok: false, reason }` VALUES, not rejections. A
// disabled skill that silently stayed enabled, and one whose state file is
// corrupt, are different problems with different fixes, so every call site
// runs its answer through `report` with the reason spelled out.

import { useCallback, useState } from 'react';
import {
  formatSkillLibraryDescription,
  formatSkillStatusLabel,
  getSkillsCopy,
  skillExceptionalStateLabel,
  skillStatusSemantic,
  useUiLocale,
  type BundledSkillCatalogEntry,
  type ManagedSkillSourceEntry,
  type SkillEntry,
} from '@maka/ui';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { Switch } from '../../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { menuDangerItemClass, menuTriggerButtonClass } from '../../ui/menu-variants.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { SettingsRow, SettingsSection } from '../../settings/settings-row.js';
import { ModuleEmpty, ModuleLead, ModuleListSkeleton, ModulePage } from '../module-page.js';
import { moduleListState } from '../../../lib/module-list-state.js';
import { ExtensionsTabs } from '../ExtensionsTabs.js';
import { cn } from '../../../lib/cn.js';
import { useAsync } from '../../../hooks/use-async.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { toast } from '../../../store/toast-store.js';
import {
  deleteSkill,
  importLocalSkillFile,
  installCatalogSkill,
  installManagedSkill,
  listSkillCatalog,
  listSkillSources,
  listSkills,
  openSkill,
  setSkillEnabled,
  setSkillPinned,
} from '../../../bridge/skills.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';
import { getModulesCopy, type SkillFailureReason } from '../../../locales/modules-copy.js';

export function SkillsModule(props: {
  host?: DesktopRuntimeHostRef;
  /** Switches to the other Extensions face; the shell's own navigation call. */
  onSelectModule?: (module: 'skills' | 'mcp') => void;
}) {
  const locale = useUiLocale();
  const extensions = getModulesCopy(locale).extensions;
  const skillsCopy = getSkillsCopy(locale);
  const copy = getModulesCopy(locale).skills;
  const report = useSettingsErrorReporter();
  const host = props.host;
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillEntry | null>(null);

  const installed = useAsync(() => listSkills(host), [host?.profileId, host?.hostId]);
  const catalog = useAsync(() => listSkillCatalog(host), [host?.profileId, host?.hostId]);
  const sources = useAsync(() => listSkillSources(host), [host?.profileId, host?.hostId]);

  const reloadAll = useCallback(() => {
    installed.reload();
    catalog.reload();
    sources.reload();
  }, [installed.reload, catalog.reload, sources.reload]);

  /**
   * Run one `{ ok, reason }` call and say what happened.
   *
   * The reason is a closed union, so it is rendered from the table rather than
   * from whatever the Host happened to put in a message field. A rejection is
   * still possible (the bridge itself can be gone) and lands on the same
   * reporter, which is why both paths are here rather than at each call site.
   *
   * `cancelled` is the exception: pressing Escape in the native file picker is
   * an answer, not a failure, and it has not earned a red toast.
   */
  const run = useCallback(
    async (
      key: string,
      failureTitle: string,
      operation: () => Promise<{ ok: true } | { ok: false; reason: string }>,
    ) => {
      setBusy(key);
      try {
        const result = await operation();
        if (result.ok) {
          reloadAll();
          return true;
        }
        if (result.reason === 'cancelled') return false;
        toast({
          title: failureTitle,
          description: copy.reasons[result.reason as SkillFailureReason] ?? failureTitle,
          variant: 'destructive',
        });
        return false;
      } catch (error) {
        report(failureTitle, error);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [copy.reasons, reloadAll, report],
  );

  const rows = installed.data ?? [];
  const catalogRows = catalog.data ?? [];
  const sourceRows = sources.data ?? [];

  // One rule for all three lists: what is shown follows the SNAPSHOT, and a
  // read that failed says so instead of reporting an empty workspace. The
  // catalog and the source library used to branch on length alone, so a
  // rejected read read as "this build ships no skills" / "your library is
  // empty" — a statement about the user's workspace, made because we could not
  // reach it.
  const installedFace = moduleListState({
    loading: installed.loading,
    error: installed.error,
    loaded: installed.data !== undefined,
    count: rows.length,
  });
  const catalogFace = moduleListState({
    loading: catalog.loading,
    error: catalog.error,
    loaded: catalog.data !== undefined,
    count: catalogRows.length,
  });
  const sourcesFace = moduleListState({
    loading: sources.loading,
    error: sources.error,
    loaded: sources.data !== undefined,
    count: sourceRows.length,
  });

  return (
    <ModulePage
      title={extensions.title}
      icon="tool"
      tabs={<ExtensionsTabs current="skills" onSelect={(face) => props.onSelectModule?.(face)} />}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              void run('import', copy.importFailed, () => importLocalSkillFile(host));
            }}
          >
            {busy === 'import' ? copy.importing : copy.importSkill}
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={skillsCopy.page.refresh}
            disabled={busy !== null}
            onClick={reloadAll}
          >
            <Anthropicon name="arrowClockwise" size={16} />
          </Button>
        </>
      }
    >
      <ModuleLead>{copy.description}</ModuleLead>

      <SettingsSection title={copy.installedTitle} description={copy.installedDescription}>
        {installedFace.face === 'loading' ? (
          <div className="py-3">
            <ModuleListSkeleton />
          </div>
        ) : installedFace.face === 'failed' ? (
          <div className="py-3">
            <ModuleEmpty
              title={copy.loadFailed}
              action={
                <Button variant="outline" size="sm" onClick={installed.reload}>
                  {skillsCopy.page.refresh}
                </Button>
              }
            />
          </div>
        ) : installedFace.face === 'empty' ? (
          <div className="py-3">
            <ModuleEmpty
              title={skillsCopy.installed.emptyTitle}
              body={`${skillsCopy.installed.emptyBodyBeforeCode} SKILL.md ${skillsCopy.installed.emptyBodyAfterCode}`}
            />
          </div>
        ) : (
          rows.map((skill) => (
            <InstalledSkillRow
              key={skill.ref ?? skill.id}
              skill={skill}
              busy={busy !== null}
              copy={copy}
              skillsCopy={skillsCopy}
              onToggle={(enabled) =>
                void run(`enable:${skill.id}`, copy.enableFailed, () =>
                  setSkillEnabled(skill.id, enabled, host),
                )
              }
              onPin={(pinned) =>
                void run(`pin:${skill.id}`, copy.pinFailed, () =>
                  setSkillPinned(skill.ref ?? skill.id, pinned, host),
                )
              }
              onOpen={(target) =>
                void run(`open:${skill.id}`, copy.openFailed, () =>
                  openSkill(skill.id, target, host),
                )
              }
              onDelete={() => setPendingDelete(skill)}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={copy.catalogTitle} description={copy.catalogDescription}>
        {catalogFace.face === 'loading' ? (
          <div className="py-3">
            <ModuleListSkeleton rows={2} />
          </div>
        ) : catalogFace.face === 'failed' ? (
          <div className="py-3">
            <ModuleEmpty
              title={copy.loadFailed}
              action={
                <Button variant="outline" size="sm" onClick={catalog.reload}>
                  {skillsCopy.page.refresh}
                </Button>
              }
            />
          </div>
        ) : catalogFace.face === 'empty' ? (
          <div className="py-3">
            <ModuleEmpty title={copy.catalogEmpty} />
          </div>
        ) : (
          catalogRows.map((entry) => (
            <CatalogSkillRow
              key={entry.id}
              entry={entry}
              busy={busy !== null}
              pending={busy === `install:${entry.id}`}
              copy={copy}
              onInstall={() =>
                void run(`install:${entry.id}`, copy.installFailed, () =>
                  installCatalogSkill(entry.id, host),
                )
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={copy.sourcesTitle} description={copy.sourcesDescription}>
        {sourcesFace.face === 'loading' ? (
          <div className="py-3">
            <ModuleListSkeleton rows={2} />
          </div>
        ) : sourcesFace.face === 'failed' ? (
          <div className="py-3">
            <ModuleEmpty
              title={copy.loadFailed}
              action={
                <Button variant="outline" size="sm" onClick={sources.reload}>
                  {skillsCopy.page.refresh}
                </Button>
              }
            />
          </div>
        ) : sourcesFace.face === 'empty' ? (
          <div className="py-3">
            <ModuleEmpty title={copy.sourcesEmpty} />
          </div>
        ) : (
          sourceRows.map((entry) => (
            <SourceSkillRow
              key={entry.id}
              entry={entry}
              installed={rows.some((skill) => skill.id === entry.id)}
              busy={busy !== null}
              pending={busy === `source:${entry.id}`}
              copy={copy}
              onInstall={() =>
                void run(`source:${entry.id}`, copy.installFailed, () =>
                  installManagedSkill(entry.id, host),
                )
              }
            />
          ))
        )}
      </SettingsSection>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? copy.deleteTitle(pendingDelete.name) : ''}
        description={skillsCopy.row.deleteDescription}
        confirmText={skillsCopy.row.delete}
        cancelText={skillsCopy.row.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingDelete;
          if (!target) return;
          await run(`delete:${target.id}`, copy.deleteFailed, () =>
            deleteSkill(target.ref ?? target.id, host),
          );
          setPendingDelete(null);
        }}
      />
    </ModulePage>
  );
}

type SkillsCopy = ReturnType<typeof getSkillsCopy>;
type ModuleSkillsCopy = ReturnType<typeof getModulesCopy>['skills'];

function InstalledSkillRow(props: {
  skill: SkillEntry;
  busy: boolean;
  copy: ModuleSkillsCopy;
  skillsCopy: SkillsCopy;
  onToggle: (enabled: boolean) => void;
  onPin: (pinned: boolean) => void;
  onOpen: (target: 'file' | 'directory') => void;
  onDelete: () => void;
}) {
  const { skill, copy, skillsCopy } = props;
  // A discovery diagnostic is not a skill: it is the loader telling the user
  // why a folder produced nothing. It gets the row and none of the controls,
  // because there is nothing here to enable, pin or delete.
  if (skill.kind === 'discovery_diagnostic') {
    const reason = skill.discoveryDiagnosticReason;
    return (
      <SettingsRow
        title={<span className="truncate">{skill.name}</span>}
        description={reason ? skillsCopy.context.discoveryDiagnostic[reason] : skill.description}
        control={
          <span className={cn(statusChipClass, statusChipToneClass('attention'))}>
            {skillsCopy.context.needsReview}
          </span>
        }
      />
    );
  }

  const exceptional = skillExceptionalStateLabel(skill, skillsCopy);
  const description = formatSkillLibraryDescription(skill, skillsCopy);
  const scope = skill.scope ? skillsCopy.context.scope[skill.scope] : undefined;

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{skill.name}</span>
          <span className={cn(statusChipClass, statusChipToneClass(skillStatusSemantic(skill)))}>
            {exceptional ?? formatSkillStatusLabel(skill, skillsCopy)}
          </span>
          {skill.pinned && (
            <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
              {skillsCopy.detail.pinned}
            </span>
          )}
        </span>
      }
      description={
        <span className="flex flex-col gap-0.5">
          {description && <span>{description}</span>}
          <span className="text-text-muted">
            {[
              scope,
              skill.declaredTools?.length
                ? copy.declaredTools(skill.declaredTools.length)
                : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      }
      control={
        <span className="flex items-center gap-2">
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
              <DropdownMenuItem onSelect={() => props.onPin(!skill.pinned)}>
                {skill.pinned ? copy.unpin : copy.pin}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onOpen('file')}>
                {copy.openFile}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onOpen('directory')}>
                {copy.openDirectory}
              </DropdownMenuItem>
              {/* `manageable === false` is the Host saying this entry is not the
                  user's to remove (a bundled skill outside the workspace). */}
              {skill.manageable !== false && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onDelete}>
                    {skillsCopy.row.delete}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      }
    />
  );
}

function CatalogSkillRow(props: {
  entry: BundledSkillCatalogEntry;
  busy: boolean;
  pending: boolean;
  copy: ModuleSkillsCopy;
  onInstall: () => void;
}) {
  const { entry, copy } = props;
  return (
    <SettingsRow
      title={<span className="truncate">{entry.name}</span>}
      description={
        <span className="flex flex-col gap-0.5">
          <span>{entry.description}</span>
          {entry.declaredTools.length > 0 && (
            <span className="text-text-muted">
              {copy.declaredTools(entry.declaredTools.length)}
            </span>
          )}
        </span>
      }
      control={
        entry.installed ? (
          <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
            {copy.installed}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={props.busy}
            aria-busy={props.pending || undefined}
            onClick={props.onInstall}
          >
            {props.pending ? copy.installing : copy.install}
          </Button>
        )
      }
    />
  );
}

function SourceSkillRow(props: {
  entry: ManagedSkillSourceEntry;
  installed: boolean;
  busy: boolean;
  pending: boolean;
  copy: ModuleSkillsCopy;
  onInstall: () => void;
}) {
  const { entry, copy } = props;
  return (
    <SettingsRow
      title={<span className="truncate">{entry.name}</span>}
      description={entry.description}
      control={
        props.installed ? (
          <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
            {copy.installed}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={props.busy}
            aria-busy={props.pending || undefined}
            onClick={props.onInstall}
          >
            {props.pending ? copy.installing : copy.install}
          </Button>
        )
      }
    />
  );
}
