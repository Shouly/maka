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

// What the sidebar list actually shows, as a pure function.
//
// The rail has to answer four questions at once — which rows survive the
// filter, which revision of an edited task represents its family, which bucket
// each row falls into, and which badges it carries — and every one of them
// depends on the others' answers. Deriving them in the component means four
// passes over the catalog on every keystroke and no way to test the result;
// deriving them here means the component renders a list it does not have to
// reason about.
//
// Ordering is total and deterministic (`activity, then id`) so a re-render
// caused by an unrelated event cannot reshuffle rows under the pointer.

import type { SessionSummary } from '@maka/core/session';
import type { SessionSendProjection } from '@maka/core/session-send-projection';
import {
  collapseSessionRevisions,
  revisionFamilySessionIds,
  sessionRevisionFamilyId,
} from '@maka/core/session-revisions';
import { sessionMatchesRail } from '../lib/ported/session-nav-filter.js';
import { deriveStaleSessionIds } from '../lib/ported/stale-sessions.js';
import { deriveBranchBanner } from '../lib/ported/branch-banner.js';
import type { SidebarCopy, SidebarGroupKey } from '../locales/sidebar-copy.js';

export type SessionListGroupMode = 'time' | 'project';

export interface SessionListRow {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly projectId: string | null;
  readonly projectName: string | undefined;
  readonly profileId: string;
  readonly profileName: string;
  readonly runtimeHostId: string;
  readonly activityAt: number;
  readonly status: SessionSummary['status'];
  readonly running: boolean;
  readonly stale: boolean;
  readonly flagged: boolean;
  readonly unread: boolean;
  readonly archived: boolean;
  /** The parent this task was branched from, when that parent is still listed. */
  readonly branchOf: { readonly id: string; readonly name: string } | undefined;
  /** Family size when edit-and-resend produced more than one revision. */
  readonly revisionCount: number;
  /** Every id in this row's revision family, for family-wide removal. */
  readonly familyIds: readonly string[];
}

export interface SessionListGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly SessionListRow[];
  /** Present on project groups so the row menu can act on the project itself. */
  readonly projectId?: string;
}

export interface SessionListModel {
  readonly groups: readonly SessionListGroup[];
  readonly rows: readonly SessionListRow[];
  readonly total: number;
  readonly filtered: boolean;
}

export interface SessionListInput {
  readonly sessions: readonly SessionSummary[];
  readonly activeId: string | undefined;
  readonly filter: string;
  readonly mode: SessionListGroupMode;
  readonly flaggedOnly?: boolean;
  readonly includeArchived?: boolean;
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly sendOutcomes?: Readonly<Record<string, SessionSendProjection>>;
  /** Ids the live event stream says are running right now, beyond `status`. */
  readonly runningIds?: ReadonlySet<string>;
  readonly copy: SidebarCopy;
  readonly now: number;
}

const DAY_MS = 86_400_000;

/** Local midnight of the day `ts` falls in — buckets are calendar days, not 24h windows. */
function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function timeBucketOf(
  activityAt: number,
  now: number,
): Exclude<SidebarGroupKey, 'flagged' | 'none'> {
  const today = startOfDay(now);
  if (activityAt >= today) return 'today';
  if (activityAt >= today - DAY_MS) return 'yesterday';
  if (activityAt >= today - 6 * DAY_MS) return 'week';
  return 'older';
}

/** Case- and whitespace-insensitive substring match over the fields a row shows. */
export function sessionMatchesFilter(
  row: Pick<SessionListRow, 'name' | 'projectName' | 'profileName'>,
  filter: string,
): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.projectName, row.profileName].some(
    (value) => value !== undefined && value.toLowerCase().includes(needle),
  );
}

function activityOf(session: SessionSummary & { activityAt?: number }): number {
  return session.activityAt ?? session.lastMessageAt ?? session.statusUpdatedAt ?? 0;
}

export function buildSessionListModel(input: SessionListInput): SessionListModel {
  const projectNames = new Map(input.projects.map((project) => [project.id, project.name]));
  const listed = input.sessions.filter(
    (session) => input.includeArchived === true || sessionMatchesRail(session),
  );
  // Collapse first: a family's older revisions must not each claim a row, and
  // the representative is the one the catalog says is current.
  const representatives = collapseSessionRevisions(listed, input.activeId);
  const staleIds = deriveStaleSessionIds({
    sessions: representatives,
    sendOutcomes: input.sendOutcomes ?? {},
  });
  const rows: SessionListRow[] = [];
  for (const session of representatives) {
    if (input.flaggedOnly === true && !session.isFlagged) continue;
    const projectId = session.projectId ?? null;
    const projectName = projectId ? projectNames.get(projectId) : undefined;
    const summary = session as SessionSummary & {
      activityAt?: number;
      profileId?: string;
      profileName?: string;
      runtimeHostId?: string;
    };
    const familyIds = revisionFamilySessionIds(listed, session.id);
    const banner = deriveBranchBanner(session, listed);
    const row: SessionListRow = {
      id: session.id,
      name: session.name,
      displayName: session.name.trim() || input.copy.untitled,
      projectId,
      projectName,
      profileId: summary.profileId ?? '',
      profileName: summary.profileName ?? '',
      runtimeHostId: summary.runtimeHostId ?? '',
      activityAt: activityOf(summary),
      status: session.status,
      running:
        input.runningIds?.has(session.id) === true ||
        (session.runningTurnIds?.length ?? 0) > 0 ||
        session.status === 'running',
      stale: staleIds.has(session.id),
      flagged: session.isFlagged,
      unread: session.hasUnread,
      archived: session.isArchived,
      branchOf: banner ? { id: banner.parentSessionId, name: banner.parentSessionName } : undefined,
      revisionCount: new Set(
        listed
          .filter(
            (candidate) => sessionRevisionFamilyId(candidate) === sessionRevisionFamilyId(session),
          )
          .map((candidate) => candidate.id),
      ).size,
      familyIds,
    };
    if (!sessionMatchesFilter(row, input.filter)) continue;
    rows.push(row);
  }
  // Persisted flags represent pins; pinning changes order within each section.
  rows.sort(
    (left, right) =>
      Number(right.flagged) - Number(left.flagged) ||
      right.activityAt - left.activityAt ||
      left.id.localeCompare(right.id),
  );

  return {
    groups: input.mode === 'project' ? groupByProject(rows, input) : groupByTime(rows, input),
    rows,
    total: rows.length,
    filtered: input.filter.trim().length > 0,
  };
}

function groupByTime(rows: readonly SessionListRow[], input: SessionListInput): SessionListGroup[] {
  const order: SidebarGroupKey[] = ['flagged', 'today', 'yesterday', 'week', 'older'];
  const buckets = new Map<SidebarGroupKey, SessionListRow[]>();
  for (const row of rows) {
    const key: SidebarGroupKey = row.flagged ? 'flagged' : timeBucketOf(row.activityAt, input.now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  return order
    .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
    .map((key) => ({ key, label: input.copy.groups[key], rows: buckets.get(key) ?? [] }));
}

function groupByProject(
  rows: readonly SessionListRow[],
  input: SessionListInput,
): SessionListGroup[] {
  const byProject = new Map<string, SessionListRow[]>();
  for (const row of rows) {
    const key = row.projectId ?? '';
    const bucket = byProject.get(key);
    if (bucket) bucket.push(row);
    else byProject.set(key, [row]);
  }
  const groups: SessionListGroup[] = [];
  // Projects the catalog knows come first, in its own order, so the sidebar
  // and the workspace picker agree on what "the projects" are.
  for (const project of input.projects) {
    const bucket = byProject.get(project.id);
    if (!bucket) continue;
    groups.push({
      key: `project:${project.id}`,
      label: project.name,
      rows: bucket,
      projectId: project.id,
    });
    byProject.delete(project.id);
  }
  // A task can name a project the current Host does not list (another Host's,
  // or one archived since). It still has to appear somewhere.
  for (const [projectId, bucket] of byProject) {
    if (projectId === '') continue;
    groups.push({
      key: `project:${projectId}`,
      label: bucket[0]?.projectName ?? projectId,
      rows: bucket,
      projectId,
    });
  }
  const loose = byProject.get('');
  if (loose && loose.length > 0) {
    groups.push({ key: 'project:none', label: input.copy.noProject, rows: loose });
  }
  return groups;
}
