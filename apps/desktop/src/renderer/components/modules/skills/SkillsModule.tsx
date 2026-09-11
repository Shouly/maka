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
// Two views, after Claude's Customize page. YOURS is what is installed in this
// workspace: one row per skill — icon tile, name, status, a line of meta, the
// switch and the ⋯ menu. DISCOVER is what could be: the skills the app ships,
// then what has been imported from this machine, each row ending in Install.
//
// The toolbar is the second thing this page owes a workspace with more than a
// handful of skills: a search that reads name, id, description and PATH; the
// scope pills (Yours) and category pills (Discover) with their counts; and a
// sort. All three are pure functions over the snapshot in `skill-filters.ts`,
// so what a filter keeps can be asserted without a DOM — and the rules stay
// out of the markup, which is already carrying the failure model.
//
// The failure model is the reason this file is longer than the markup:
// `skills.*` answers with `{ ok: false, reason }` VALUES, not rejections. A
// disabled skill that silently stayed enabled, and one whose state file is
// corrupt, are different problems with different fixes, so every call site
// runs its answer through `report` with the reason spelled out.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSkillsCopy,
  useUiLocale,
  type ManagedSkillCategory,
  type ManagedSkillUpdatePreview,
  type SkillEntry,
} from '@maka/ui';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import {
  ListEmptyState,
  ListFilterMenu,
  ListSearch,
  ListSection,
  ListSortMenu,
  ListStaleNotice,
  ListTabsDivider,
  listToolbarIconButtonClass,
  listToolbarPrimaryButtonClass,
} from '../../ui/list-page.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { ModuleListSkeleton, ModulePage } from '../module-page.js';
import { moduleListState } from '../../../lib/module-list-state.js';
import { ExtensionsTabs, ExtensionsViewTabs, type ExtensionsView } from '../ExtensionsTabs.js';
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
  previewManagedSkillUpdate,
  setSkillEnabled,
  updateManagedSkill,
} from '../../../bridge/skills.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';
import { getModulesCopy, type SkillFailureReason } from '../../../locales/modules-copy.js';
import { getSkillsPageCopy, type SkillsPageCopy } from '../../../locales/skills-page-copy.js';
import { CatalogSkillRow, InstalledSkillRow, SourceSkillRow, skillIcon } from './SkillRows.js';
import { SkillUpdateDialog } from './SkillUpdateDialog.js';
import { startTaskWithSkill } from './use-skill-in-task.js';
import {
  SKILL_ORIGINS,
  catalogEntryMatchesQuery,
  managedUpdateOptions,
  normalizeSkillQuery,
  presentCategories,
  skillMatchesQuery,
  groupSkillsByOrigin,
  skillMatchesOrigin,
  skillOriginCounts,
  sortCatalogRows,
  sortSkills,
  sourceEntryMatchesQuery,
  type SkillCategoryFilter,
  type SkillOriginFilter,
  type SkillSort,
} from './skill-filters.js';

export function SkillsModule(props: {
  host?: DesktopRuntimeHostRef;
  /** Switches to the other Customize face; the shell's own navigation call. */
  onSelectModule?: (module: 'skills' | 'mcp') => void;
}) {
  const locale = useUiLocale();
  const modules = getModulesCopy(locale);
  const extensions = modules.extensions;
  const skillsCopy = getSkillsCopy(locale);
  const copy = getModulesCopy(locale).skills;
  const page = getSkillsPageCopy(locale);
  const report = useSettingsErrorReporter();
  const host = props.host;
  const [view, setView] = useState<ExtensionsView>('yours');
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillEntry | null>(null);
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<SkillOriginFilter>('all');
  const [category, setCategory] = useState<SkillCategoryFilter>('all');
  const [sort, setSort] = useState<SkillSort>('source');
  const [preview, setPreview] = useState<ManagedSkillUpdatePreview | null>(null);

  const installed = useAsync(() => listSkills(host), [host?.profileId, host?.hostId]);
  const catalog = useAsync(() => listSkillCatalog(host), [host?.profileId, host?.hostId]);
  const sources = useAsync(() => listSkillSources(host), [host?.profileId, host?.hostId]);

  const reloadAll = useCallback(() => {
    installed.reload();
    catalog.reload();
    sources.reload();
  }, [installed.reload, catalog.reload, sources.reload]);
  // No change feed exists for skills (unlike servers and scheduled tasks), so
  // a SKILL.md edited on disk would otherwise stay stale until the page is
  // reopened. Coming back to the window is the moment the user expects the
  // list to reflect what they just did elsewhere.
  useEffect(() => {
    window.addEventListener('focus', reloadAll);
    return () => window.removeEventListener('focus', reloadAll);
  }, [reloadAll]);

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
          description:
            copy.reasons[result.reason as SkillFailureReason] ??
            // `read_failed` exists on previewUpdate and nowhere else in the
            // namespace, so it is not in the shared table.
            (result.reason === 'read_failed' ? page.update.readFailed : failureTitle),
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
    [copy.reasons, page.update.readFailed, reloadAll, report],
  );

  /**
   * Review, then apply. Never the other way round: the workspace copy may
   * hold edits that exist nowhere else, and `updateManaged` replaces it.
   */
  const reviewUpdate = useCallback(
    async (skill: SkillEntry) => {
      setBusy(`preview:${skill.id}`);
      try {
        const result = await previewManagedSkillUpdate(skill.id, host);
        if (result.ok) {
          setPreview(result.preview);
          return;
        }
        toast({
          title: page.update.reviewFailed,
          description:
            copy.reasons[result.reason as SkillFailureReason] ??
            (result.reason === 'read_failed' ? page.update.readFailed : page.update.reviewFailed),
          variant: 'destructive',
        });
      } catch (error) {
        report(page.update.reviewFailed, error);
      } finally {
        setBusy(null);
      }
    },
    [copy.reasons, host, page.update, report],
  );

  const applyUpdate = useCallback(
    async (reviewed: ManagedSkillUpdatePreview) => {
      const applied = await run(`update:${reviewed.skill.id}`, page.update.failed, () =>
        updateManagedSkill(reviewed.skill.id, managedUpdateOptions(reviewed), host),
      );
      if (!applied) return;
      setPreview(null);
      toast({ title: page.update.updated(reviewed.skill.name), variant: 'success' });
    },
    [host, page.update, run],
  );

  const allRows = installed.data ?? [];
  const allCatalogRows = catalog.data ?? [];
  const allSourceRows = sources.data ?? [];
  const normalized = normalizeSkillQuery(query);

  // Search first, then the filter: the counts in the filter menu describe
  // what the search left, so a scope whose only match was typed away reads 0
  // instead of promising rows the option cannot show.
  const searchedSkills = useMemo(
    () => allRows.filter((skill) => skillMatchesQuery(skill, normalized)),
    [allRows, normalized],
  );
  const originCounts = useMemo(() => skillOriginCounts(searchedSkills), [searchedSkills]);
  const rows = useMemo(
    () =>
      sortSkills(
        searchedSkills.filter((skill) => skillMatchesOrigin(skill, origin)),
        sort,
      ),
    [searchedSkills, origin, sort],
  );
  // Sorted once, then cut into one section per origin: the order holds inside
  // every section, and a narrowed filter simply leaves one section standing.
  const groups = useMemo(() => groupSkillsByOrigin(rows), [rows]);

  // Only the origins this workspace actually has, plus whichever one is
  // selected (a search can empty the origin the user is standing in, and an
  // option that vanished under them would strand the filter with no way back).
  const originOptions = useMemo(
    () => SKILL_ORIGINS.filter((value) => originCounts[value] > 0 || origin === value),
    [originCounts, origin],
  );

  const categories = useMemo(
    () => presentCategories(allCatalogRows, allSourceRows),
    [allCatalogRows, allSourceRows],
  );
  const inCategory = useCallback(
    (entry: { category: ManagedSkillCategory }) =>
      category === 'all' || entry.category === category,
    [category],
  );
  const catalogRows = useMemo(
    () =>
      sortCatalogRows(
        allCatalogRows.filter(
          (entry) => inCategory(entry) && catalogEntryMatchesQuery(entry, normalized),
        ),
        sort,
      ),
    [allCatalogRows, inCategory, normalized, sort],
  );
  const sourceRows = useMemo(
    () =>
      sortCatalogRows(
        allSourceRows.filter(
          (entry) => inCategory(entry) && sourceEntryMatchesQuery(entry, normalized),
        ),
        sort,
      ),
    [allSourceRows, inCategory, normalized, sort],
  );

  // One rule for all three lists: what is shown follows the SNAPSHOT, and a
  // read that failed says so instead of reporting an empty workspace. The
  // count is the UNFILTERED one — a search that matched nothing is not an
  // empty workspace, and it gets its own empty state below.
  const installedFace = moduleListState({
    loading: installed.loading,
    error: installed.error,
    loaded: installed.data !== undefined,
    count: allRows.length,
  });
  const catalogFace = moduleListState({
    loading: catalog.loading,
    error: catalog.error,
    loaded: catalog.data !== undefined,
    count: allCatalogRows.length,
  });
  const sourcesFace = moduleListState({
    loading: sources.loading,
    error: sources.error,
    loaded: sources.data !== undefined,
    count: allSourceRows.length,
  });

  const retry = (reload: () => void) => (
    <Button variant="outline" size="sm" onClick={reload}>
      {skillsCopy.page.refresh}
    </Button>
  );
  const clearSearch = (
    <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
      {skillsCopy.market.clearSearch}
    </Button>
  );
  const clearFilters = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        setQuery('');
        setOrigin('all');
        setCategory('all');
      }}
    >
      {skillsCopy.market.clearFilters}
    </Button>
  );
  const filtering = normalized.length > 0 || origin !== 'all' || category !== 'all';

  return (
    <ModulePage
      title={extensions.title}
      tabs={
        <>
          <ExtensionsTabs current="skills" onSelect={(face) => props.onSelectModule?.(face)} />
          <ListTabsDivider />
          <ExtensionsViewTabs current={view} onSelect={setView} />
        </>
      }
      actions={
        <>
          <ListSearch value={query} onChange={setQuery} label={skillsCopy.page.search} />
          <ListFilterMenu
            label={page.filters.trigger}
            heading={page.filters.heading}
            groups={
              view === 'yours'
                ? [
                    {
                      id: 'origin',
                      label: page.filters.origin,
                      value: origin,
                      options: [
                        { value: 'all', label: page.filters.all, count: originCounts.all },
                        ...originOptions.map((value) => ({
                          value,
                          label: page.origins[value],
                          count: originCounts[value],
                        })),
                      ],
                      onChange: (value: SkillOriginFilter) => setOrigin(value),
                    },
                  ]
                : [
                    {
                      id: 'category',
                      label: page.filters.category,
                      value: category,
                      options: [
                        { value: 'all', label: page.filters.all },
                        ...categories.map((value) => ({
                          value,
                          label: skillsCopy.categories[value],
                        })),
                      ],
                      onChange: (value: SkillCategoryFilter) => setCategory(value),
                    },
                  ]
            }
          />
          <ListSortMenu<SkillSort>
            label={page.sort.trigger}
            value={sort}
            onChange={setSort}
            options={[
              { value: 'source', label: page.sort.source },
              { value: 'name', label: page.sort.name },
              ...(view === 'yours'
                ? [{ value: 'updates' as const, label: page.sort.updates }]
                : []),
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy !== null}
                className={cn(listToolbarPrimaryButtonClass, 'pr-2.5')}
              >
                {busy === 'import' ? copy.importing : page.add.label}
                <Anthropicon name="caretDown" size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem
                onSelect={() => {
                  void run('import', copy.importFailed, () => importLocalSkillFile(host));
                }}
              >
                <DropdownMenuItemIcon>
                  <Anthropicon name="upload" size={20} />
                </DropdownMenuItemIcon>
                <span>{page.add.importFile}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setView('discover')}>
                <DropdownMenuItemIcon>
                  <Anthropicon name="library" size={20} />
                </DropdownMenuItemIcon>
                <span>{page.add.browse}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {view === 'yours' ? (
        <>
          {installedFace.staleNotice && (
            <ListStaleNotice title={modules.refreshFailed} action={retry(installed.reload)} />
          )}
          {installedFace.face === 'loading' ? (
            <ModuleListSkeleton />
          ) : installedFace.face === 'failed' ? (
            <ListEmptyState
              icon={skillIcon}
              title={copy.loadFailed}
              action={retry(installed.reload)}
            />
          ) : installedFace.face === 'empty' ? (
            <ListEmptyState
              icon={skillIcon}
              title={skillsCopy.installed.emptyTitle}
              description={`${skillsCopy.installed.emptyBodyBeforeCode} SKILL.md ${skillsCopy.installed.emptyBodyAfterCode}`}
              action={
                <Button variant="secondary" size="sm" onClick={() => setView('discover')}>
                  {extensions.discover}
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <ListEmptyState
              icon={<Anthropicon name="search" size={20} />}
              title={skillsCopy.installed.emptySearchTitle}
              description={
                normalized
                  ? skillsCopy.installed.emptySearchBody
                  : skillsCopy.market.emptyFilterBody
              }
              action={normalized && origin === 'all' ? clearSearch : clearFilters}
            />
          ) : (
            groups.map((group) => (
              <ListSection
                key={group.origin}
                id={`skills-origin-${group.origin}`}
                label={page.origins[group.origin]}
                count={group.skills.length}
              >
                {group.skills.map((skill) => (
                  <InstalledSkillRow
                    key={skill.ref ?? skill.id}
                    skill={skill}
                    busy={busy !== null}
                    copy={copy}
                    skillsCopy={skillsCopy}
                    page={page}
                    onToggle={(enabled) =>
                      void run(`enable:${skill.id}`, copy.enableFailed, () =>
                        setSkillEnabled(skill.id, enabled, host),
                      )
                    }
                    onOpen={(target) =>
                      void run(`open:${skill.id}`, copy.openFailed, () =>
                        openSkill(skill.id, target, host),
                      )
                    }
                    onUse={() => startTaskWithSkill(skill)}
                    onReviewUpdate={() => void reviewUpdate(skill)}
                    onDelete={() => setPendingDelete(skill)}
                  />
                ))}
              </ListSection>
            ))
          )}
        </>
      ) : (
        <>
          {(catalogFace.staleNotice || sourcesFace.staleNotice) && (
            <ListStaleNotice title={modules.refreshFailed} action={retry(reloadAll)} />
          )}
          {catalogFace.face === 'loading' ? (
            <ModuleListSkeleton rows={2} />
          ) : catalogFace.face === 'failed' ? (
            <ListEmptyState
              icon={skillIcon}
              title={copy.loadFailed}
              action={retry(catalog.reload)}
            />
          ) : catalogFace.face === 'empty' ? (
            <ListEmptyState icon={skillIcon} title={copy.catalogEmpty} />
          ) : catalogRows.length === 0 ? (
            <ListEmptyState
              icon={<Anthropicon name="search" size={20} />}
              title={skillsCopy.builtin.noMatchTitle}
              description={skillsCopy.builtin.noMatchBody}
              action={filtering ? clearFilters : undefined}
            />
          ) : (
            <ListSection id="skills-catalog" label={copy.catalogTitle} count={catalogRows.length}>
              {catalogRows.map((entry) => (
                <CatalogSkillRow
                  key={entry.id}
                  entry={entry}
                  busy={busy !== null}
                  pending={busy === `install:${entry.id}`}
                  copy={copy}
                  skillsCopy={skillsCopy}
                  page={page}
                  onInstall={() =>
                    void run(`install:${entry.id}`, copy.installFailed, () =>
                      installCatalogSkill(entry.id, host),
                    )
                  }
                />
              ))}
            </ListSection>
          )}
          {sourcesFace.face === 'loading' ? (
            <ModuleListSkeleton rows={2} />
          ) : sourcesFace.face === 'failed' ? (
            <div className="pt-6">
              <ListEmptyState
                icon={skillIcon}
                title={copy.loadFailed}
                action={retry(sources.reload)}
              />
            </div>
          ) : sourcesFace.face === 'empty' ? (
            <ListSection id="skills-sources" label={copy.sourcesTitle} count={0}>
              <p className="py-2 text-sm leading-5 text-text-muted">{copy.sourcesEmpty}</p>
            </ListSection>
          ) : sourceRows.length === 0 ? (
            <ListSection id="skills-sources" label={copy.sourcesTitle} count={0}>
              <p className="py-2 text-sm leading-5 text-text-muted">
                {skillsCopy.market.emptyFilterBody}
              </p>
            </ListSection>
          ) : (
            <ListSection id="skills-sources" label={copy.sourcesTitle} count={sourceRows.length}>
              {sourceRows.map((entry) => (
                <SourceSkillRow
                  key={entry.id}
                  entry={entry}
                  installed={allRows.some((skill) => skill.id === entry.id)}
                  busy={busy !== null}
                  pending={busy === `source:${entry.id}`}
                  copy={copy}
                  skillsCopy={skillsCopy}
                  onInstall={() =>
                    void run(`source:${entry.id}`, copy.installFailed, () =>
                      installManagedSkill(entry.id, host),
                    )
                  }
                />
              ))}
            </ListSection>
          )}
        </>
      )}

      <SkillUpdateDialog
        preview={preview}
        applying={busy?.startsWith('update:') ?? false}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onApply={() => {
          if (preview) void applyUpdate(preview);
        }}
      />

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

/**
 * The sort menu. Three orders, and the default is the Host's own: discovery
 * order is the order the skills are offered to the model, so it is the one
 * order that means something outside this page.
 *
 * "Needs attention first" is offered only on Yours, because it reads the
 * status ladder and the catalogs have no status to read. Nothing here is
 * "recently updated": no entry the Host sends carries a timestamp.
 */
