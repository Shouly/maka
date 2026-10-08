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

import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ArtifactRecord } from '@maka/core/artifacts';
import { encodeCanonicalRuntimeEvent } from '@maka/core/canonical-runtime-event';
import { decodeRuntimeEvent, type RuntimeEvent } from '@maka/core/runtime-event';
import {
  rewriteRuntimeEventSavedOutputPaths,
  SAVED_OUTPUT_FILE_NAME,
  savedOutputPathRewrite,
  TASK_OUTPUTS_DIRECTORY,
  TOOL_RESULTS_DIRECTORY,
} from '@maka/core/saved-output-paths';
import { decodeArtifactRecordJsons } from './artifact-metadata-codec.js';
import {
  withArtifactWriterLock,
  withLeaseBoundArtifactWriterLock,
} from './artifact-writer-lock.js';
import { readStableBoundedFile, syncDirectoryChain } from './stable-storage.js';
import { publishImportedSavedOutputFile } from './imported-saved-output-file.js';
import {
  prepareArtifactWriterLockAuthorityForLease,
  type StorageRootLease,
} from './root-authority.js';

/**
 * Holds the Artifact writer lock for the root the caller is authorised over.
 *
 * Without a lease the root is named by a path, and the lock is derived from
 * that path again after the authority was checked. A lease says which root the
 * authority covers, so deriving the lock from the lease keeps the two from
 * drifting: an alias or a replaced directory between the two steps would
 * otherwise bind the operation to one root while the lease names another --
 * including an unmarked one, which takes no lock at all.
 */
async function withBundleArtifactWriterLock<T>(
  stateRoot: string,
  lease: StorageRootLease<'interactive', 'write'> | undefined,
  operation: (canonicalStateRoot: string) => Promise<T>,
): Promise<T> {
  if (!lease) return withArtifactWriterLock(stateRoot, operation);
  const authority = await prepareArtifactWriterLockAuthorityForLease(lease, 'interactive');
  return withLeaseBoundArtifactWriterLock(authority, () => operation(lease.canonicalPath));
}
import { runWithContextValueMutation } from './context-value-mutation-gate.js';
import {
  withOfflineContextSnapshot,
  copyContextSnapshot,
  validateContextSnapshot,
  planContextSnapshotFiles,
} from './context-offload-snapshot.js';
import {
  CONTEXT_OFFLOAD_DATABASE_NAME,
  CONTEXT_OFFLOAD_VALUES_DIRECTORY_NAME,
} from './sqlite-context-offload-store.js';
import {
  acquireOperationalStateDatabase,
  inspectOperationalStateSchema,
  OPERATIONAL_STATE_DATABASE_NAME,
  OperationalStateMigrationBlockedError,
  type OperationalStateDatabaseLease,
} from './operational-state-store.js';
import { TERMINAL_RUNTIME_EVENT_SQL } from './runtime-transcript-query.js';
import { isSafeStorageId } from './storage-id.js';

export const SESSION_BUNDLE_STATE_ENTRIES = [
  'artifacts',
  OPERATIONAL_STATE_DATABASE_NAME,
  CONTEXT_OFFLOAD_DATABASE_NAME,
  CONTEXT_OFFLOAD_VALUES_DIRECTORY_NAME,
  TOOL_RESULTS_DIRECTORY,
  TASK_OUTPUTS_DIRECTORY,
] as const;

/**
 * The state root folders a Session's saved output lives in, one folder per
 * Session under each: tool results too long to show, and background task
 * output. A bundle carries the exported Sessions' folders, because their
 * records name the files in them.
 */
const SAVED_OUTPUT_DIRECTORIES = [TOOL_RESULTS_DIRECTORY, TASK_OUTPUTS_DIRECTORY] as const;

export const SESSION_BUNDLE_PROTECTED_ENTRIES = [] as const;

export type SessionBundleExportErrorCode =
  | 'invalid_root'
  | 'overlapping_roots'
  | 'symlink'
  | 'path_escape'
  | 'unknown_entry'
  | 'unsupported_entry'
  | 'destination_not_empty'
  /** The source database registers a schema this build does not read. */
  /** A planned entry names a file the state root does not have. */
  | 'missing_entry'
  | 'schema_unsupported'
  /** The Session, or one of its descendants, is mid-turn. */
  | 'session_active';

export class SessionBundleExportError extends Error {
  constructor(
    readonly code: SessionBundleExportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SessionBundleExportError';
  }
}

export interface SessionBundleRootLayoutInput {
  stateRoot: string;
  configRoot: string;
  allowShared?: boolean;
}

export interface SessionBundleExportPlanEntry {
  relativePath: string;
  kind: 'file' | 'directory';
  source: 'copy' | 'filtered_runtime_sqlite' | 'context_snapshot';
}

export interface SessionBundleExportPlan {
  stateRoot: string;
  configRoot: string;
  destinationRoot: string;
  sessionId: string;
  /**
   * The exported Session and its subagent descendants, root first.
   *
   * A child Session holds the result of a tool call its parent made, so a
   * bundle carrying only the named Session is a conversation with a hole where
   * that result should be.
   */
  sessionIds: string[];
  /** Schema versions the SOURCE database registers, not this build's constants. */
  sourceSchema: Record<string, number>;
  /**
   * How the exported Session reaches a provider, by name only.
   *
   * An importer resolves the slug against its own catalog. No key is carried:
   * a bundle is shared, and this is the one failure here that cannot be undone.
   */
  connection: { llmConnectionSlug: string; model: string };
  includedEntries: string[];
  excludedEntries: string[];
  entries: SessionBundleExportPlanEntry[];
}

export interface SessionBundleExportInput extends SessionBundleRootLayoutInput {
  destinationRoot: string;
  sessionId: string;
  /**
   * The database to plan against. `exportSessionBundleState` passes the private
   * copy it has already taken, so the plan and the database that ships describe
   * the same moment. Defaults to the live file for a plan-only caller.
   */
  databasePath?: string;
  /**
   * Refuse a Session that is mid-turn.
   *
   * A bundle meant to be carried elsewhere cannot hold half a turn, but a
   * backup of a running Session is exactly what a backup is for.
   */
  requireQuiescent?: boolean;
  /**
   * Carry the subagent Sessions spawned under this one.
   *
   * A child holds the result of a tool call its parent made, so a portable
   * bundle needs the subtree. A snapshot of one Session does not, and adding
   * children to it would silently change what that snapshot contains.
   */
  includeSubtree?: boolean;
  /**
   * Drop the operational rows that describe a request rather than the
   * conversation.
   *
   * They are the large majority of `core_agent_run_events` and none of them
   * reach the model, so a bundle meant for another machine can leave them.
   * A snapshot or backup keeps them: incompleteness is not a property anyone
   * asks a backup for.
   */
  omitDiagnostics?: boolean;
  /**
   * Authority the caller already holds, instead of electing it here.
   *
   * The Runtime Host owns the Storage Root for its whole lifetime and the
   * owner lock is an election that refuses a second hold -- from any process,
   * its own included. Lending the lease is the only way the Host can run this
   * while it is up, which is the only way a user can reach it from the app.
   * Omitted, the authority is elected exactly as before.
   */
  lease?: StorageRootLease<'interactive', 'write'>;

  // Every option above defaults to the behaviour this function had before it
  // learned to make portable bundles, so its existing callers are unchanged.
}

export async function assertSessionBundleRootLayout(
  input: SessionBundleRootLayoutInput,
): Promise<void> {
  const stateRoot = await canonicalRoot(input.stateRoot, 'state');
  const configRoot = await canonicalRoot(input.configRoot, 'config', true);
  assertRootsSeparate(stateRoot, configRoot, input.allowShared === true);
}

export async function planSessionBundleExport(
  input: SessionBundleExportInput,
): Promise<SessionBundleExportPlan> {
  assertSafeSessionId(input.sessionId);
  const stateRoot = await canonicalRoot(input.stateRoot, 'state');
  const configRoot = await canonicalRoot(input.configRoot, 'config', true);
  const destinationRoot = resolve(input.destinationRoot);
  assertRootsSeparate(stateRoot, configRoot, input.allowShared === true);
  assertRootsSeparate(stateRoot, destinationRoot, false);
  assertRootsSeparate(configRoot, destinationRoot, false);

  // Everything below is derived from `input.databasePath` -- the private copy
  // the caller has already taken -- and never from the live database. The
  // artifact and context locks do not fence ordinary Session and runtime
  // writers, so a subtree, an artifact list and a manifest read from the live
  // file would describe a different moment than the database that ships.
  const databasePath = input.databasePath ?? resolve(stateRoot, OPERATIONAL_STATE_DATABASE_NAME);
  await assertRegularFile(databasePath, OPERATIONAL_STATE_DATABASE_NAME);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let artifacts: ArtifactRecord[];
  let sessionIds: string[];
  let sourceSchema: Record<string, number>;
  let connection: { llmConnectionSlug: string; model: string };
  try {
    const session = database
      .prepare('SELECT 1 AS present FROM session_metadata WHERE session_id = ?')
      .get(input.sessionId);
    if (!session) {
      throw new SessionBundleExportError(
        'invalid_root',
        `Session bundle session does not exist: ${input.sessionId}`,
      );
    }
    sourceSchema = assertPortableSourceSchema(database);
    sessionIds =
      input.includeSubtree === true
        ? collectSubagentSessionTree(database, input.sessionId)
        : [input.sessionId];

    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = database
      .prepare(
        `SELECT record_json FROM artifact_records WHERE session_id IN (${placeholders}) ORDER BY created_at, artifact_id`,
      )
      .all(...sessionIds) as Array<{ record_json?: unknown }>;
    artifacts = decodeArtifactRecordJsons(rows.map((row) => row.record_json));
    const route = database
      .prepare('SELECT llm_connection_slug, model FROM session_metadata WHERE session_id = ?')
      .get(input.sessionId) as { llm_connection_slug?: unknown; model?: unknown };
    connection = {
      llmConnectionSlug: String(route?.llm_connection_slug ?? ''),
      model: String(route?.model ?? ''),
    };
  } finally {
    database.close();
  }

  const entries: SessionBundleExportPlanEntry[] = [
    {
      relativePath: OPERATIONAL_STATE_DATABASE_NAME,
      kind: 'file',
      source: 'filtered_runtime_sqlite',
    },
  ];
  const includedEntries = [OPERATIONAL_STATE_DATABASE_NAME];
  if (artifacts.length > 0) {
    entries.push({ relativePath: 'artifacts', kind: 'directory', source: 'copy' });
    for (const artifact of artifacts) {
      if (!sessionIds.some((id) => isArtifactPathForSession(artifact.relativePath, id))) {
        throw new SessionBundleExportError(
          'path_escape',
          `Artifact path does not belong to the exported subtree: ${artifact.relativePath}`,
        );
      }
      const relativePath = `artifacts/${artifact.relativePath}`;
      // A record naming bytes the workspace does not have would produce a
      // bundle whose own metadata points at nothing. Reported apart from a
      // missing state root, which is a different mistake entirely.
      await assertRegularFile(resolve(stateRoot, relativePath), relativePath).catch(
        (error: unknown) => {
          if (error instanceof SessionBundleExportError && error.code === 'invalid_root') {
            throw new SessionBundleExportError('missing_entry', error.message, { cause: error });
          }
          throw error;
        },
      );
      entries.push({ relativePath, kind: 'file', source: 'copy' });
    }
    includedEntries.push('artifacts');
  }
  for (const directory of SAVED_OUTPUT_DIRECTORIES) {
    const files = await planSavedOutputFiles(stateRoot, directory, sessionIds);
    if (files.length === 0) continue;
    entries.push({ relativePath: directory, kind: 'directory', source: 'copy' });
    for (const relativePath of files) entries.push({ relativePath, kind: 'file', source: 'copy' });
    includedEntries.push(directory);
  }
  const contextFiles = await planContextSnapshotFiles(stateRoot, sessionIds);
  for (const relativePath of contextFiles) {
    entries.push({ relativePath, kind: 'file', source: 'context_snapshot' });
  }
  if (contextFiles.length > 0) includedEntries.push(CONTEXT_OFFLOAD_DATABASE_NAME);
  if (contextFiles.length > 1) includedEntries.push(CONTEXT_OFFLOAD_VALUES_DIRECTORY_NAME);
  const allowed = new Set<string>([...SESSION_BUNDLE_STATE_ENTRIES]);
  const excludedEntries = (await readdir(stateRoot)).filter((entry) => !allowed.has(entry)).sort();
  return {
    stateRoot,
    configRoot,
    destinationRoot,
    sessionId: input.sessionId,
    sessionIds,
    sourceSchema,
    connection,
    includedEntries,
    excludedEntries,
    entries,
  };
}

export async function exportSessionBundleState(
  input: SessionBundleExportInput,
): Promise<SessionBundleExportPlan> {
  return withOfflineContextSnapshot(
    input.stateRoot,
    (contextLocked) =>
      withBundleArtifactWriterLock(input.stateRoot, input.lease, async (stateRoot) => {
        const destinationRoot = resolve(input.destinationRoot);
        await assertDestinationMissing(destinationRoot);
        const stagingRoot = `${destinationRoot}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
          // Take the private copy BEFORE anything is read. `lease.backup()` is
          // what freezes the content; every decision after this -- schema, the
          // subtree, the artifact list, quiescence, the manifest -- is made
          // against this one file, so the bundle cannot describe two moments.
          const databasePath = resolveInside(stagingRoot, OPERATIONAL_STATE_DATABASE_NAME);
          await backupOperationalState(stateRoot, databasePath);
          const plan = await planSessionBundleExport({ ...input, stateRoot, databasePath });
          for (const entry of plan.entries) {
            if (entry.source === 'context_snapshot' || entry.source === 'filtered_runtime_sqlite') {
              continue;
            }
            const destination = resolveInside(stagingRoot, entry.relativePath);
            if (entry.kind === 'directory') {
              await mkdir(destination, { recursive: true });
              continue;
            }
            await mkdir(dirname(destination), { recursive: true });
            await copyArtifactFile(plan.stateRoot, entry.relativePath, destination);
          }
          await filterBackedUpDatabase(databasePath, plan.sessionIds, {
            omitDiagnostics: input.omitDiagnostics === true,
            requireQuiescent: input.requireQuiescent === true,
          });
          await copyContextSnapshot(stateRoot, stagingRoot, contextLocked, plan.sessionIds);
          await validateContextSnapshot(stagingRoot);
          await mkdir(dirname(plan.destinationRoot), { recursive: true });
          await rename(stagingRoot, plan.destinationRoot);
          return plan;
        } catch (error) {
          await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
      }),
    input.lease ? { lease: input.lease } : {},
  );
}

/**
 * The saved output of the exported Sessions, as `<directory>/<sessionId>/<file>`.
 * A Session that saved nothing has no folder and no entry. Only a regular
 * file with a saved output's own name is carried; the copy then refuses a
 * link anywhere on the way, as it does for an artifact.
 */
async function planSavedOutputFiles(
  stateRoot: string,
  directory: string,
  sessionIds: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const sessionId of sessionIds) {
    const folder = resolveInside(stateRoot, `${directory}/${sessionId}`);
    const metadata = await lstat(folder).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!metadata) continue;
    if (!metadata.isDirectory()) {
      throw new SessionBundleExportError(
        metadata.isSymbolicLink() ? 'symlink' : 'unsupported_entry',
        `${directory}/${sessionId} is not a directory`,
      );
    }
    const names = (await readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && SAVED_OUTPUT_FILE_NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) files.push(`${directory}/${sessionId}/${name}`);
  }
  return files;
}

/**
 * Take the private copy the whole export is derived from.
 *
 * `require_current` because an export must not migrate what it reads: opening
 * the live database the ordinary way upgrades it in place, which turns a
 * read-only operation into a write to someone else's workspace and leaves the
 * manifest describing a version the source no longer has.
 */
/**
 * Copy one artifact without leaving the state root.
 *
 * Checking the final component is not enough: `artifacts/<sessionId>` can
 * itself be a symlink, and `copyFile` follows ancestors — an artifact record
 * that decodes perfectly can then pull in a file from outside the workspace.
 * Every segment is checked, the final open refuses to follow a link, and the
 * bytes are read from that descriptor rather than from the name.
 *
 * Node has no `openat`, so a segment swapped between its check and the open is
 * not closed here. That window is narrowed, not eliminated; closing it needs a
 * directory-relative open this runtime does not expose.
 */
async function copyArtifactFile(
  stateRoot: string,
  relativePath: string,
  destination: string,
): Promise<void> {
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);
  let walked = stateRoot;
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new SessionBundleExportError('path_escape', `Artifact path segment is not safe`);
    }
    walked = resolveInside(walked, segment);
    const metadata = await lstat(walked).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!metadata) {
      throw new SessionBundleExportError('missing_entry', `Missing ${relativePath}`);
    }
    if (metadata.isSymbolicLink()) {
      throw new SessionBundleExportError(
        'symlink',
        `Artifact path crosses a symlink at ${segment}`,
      );
    }
  }

  const handle = await open(walked, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new SessionBundleExportError(
        'unsupported_entry',
        `${relativePath} is not a regular file`,
      );
    }
    await writeFile(destination, handle.createReadStream());
  } finally {
    await handle.close().catch(() => {});
  }
}

async function backupOperationalState(stateRoot: string, destinationPath: string): Promise<void> {
  // A directory with no state database is not a workspace, which is a different
  // mistake from a workspace whose schema this build cannot read.
  await assertRegularFile(
    resolveInside(stateRoot, OPERATIONAL_STATE_DATABASE_NAME),
    OPERATIONAL_STATE_DATABASE_NAME,
  );
  let lease: ReturnType<typeof acquireOperationalStateDatabase>;
  try {
    lease = acquireOperationalStateDatabase(stateRoot, { schemaMigration: 'require_current' });
  } catch (error) {
    // Only a blocked migration means "this build cannot read that schema".
    // A permission, busy or I/O failure is the environment talking, and the
    // operational store preserves it deliberately -- flattening those into a
    // schema verdict tells the caller to upgrade when the real answer is that
    // the file could not be opened.
    if (error instanceof OperationalStateMigrationBlockedError) {
      throw new SessionBundleExportError(
        'schema_unsupported',
        'Session bundle source is not at the current schema',
        { cause: error },
      );
    }
    throw error;
  }
  try {
    await lease.backup(destinationPath);
  } finally {
    lease.close();
  }
}

async function filterBackedUpDatabase(
  destinationPath: string,
  sessionIds: readonly string[],
  options: { omitDiagnostics: boolean; requireQuiescent: boolean },
): Promise<void> {
  const database = new DatabaseSync(destinationPath);
  try {
    // Quiescence is asserted here, on the copy, not on the live database.
    // `lease.backup()` is what freezes the content; a check made before it
    // describes a state the bundle may no longer carry, and the artifact and
    // context locks held around this do not keep a turn from starting. This is
    // the only place where "what was checked" and "what ships" are the same
    // bytes.
    if (options.requireQuiescent) {
      for (const sessionId of sessionIds) assertSessionQuiescent(database, sessionId);
    }
    database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name?: unknown }>;
    for (const row of tables) {
      if (typeof row.name !== 'string' || PORTABLE_GLOBAL_TABLES.has(row.name)) continue;
      const columns = database
        .prepare(`PRAGMA table_info(${quoteIdentifier(row.name)})`)
        .all() as Array<{ name?: unknown }>;
      const names = new Set(
        columns
          .map((column) => column.name)
          .filter((name): name is string => typeof name === 'string'),
      );
      const sessionColumns = names.has(SESSION_ROW_OWNER_COLUMN)
        ? [SESSION_ROW_OWNER_COLUMN]
        : SESSION_LINK_COLUMNS.filter((name) => names.has(name));
      if (sessionColumns.length > 0) {
        // Delete what the subtree does not own, keeping the original
        // predicate's shape: a row survives only when EVERY session column it
        // has names an exported Session. A link table row with one end outside
        // the bundle would otherwise arrive pointing at a Session that is not
        // there -- the reference is what makes it a link.
        const placeholders = sessionIds.map(() => '?').join(', ');
        const predicate = sessionColumns
          .map((name) =>
            name === SESSION_ROW_OWNER_COLUMN
              ? // An owner that is NULL owns nothing. Such a row cannot be
                // attributed to any Session, so it is not this bundle's to
                // carry -- keeping it shipped an unattributed usage row.
                `(${quoteIdentifier(name)} IS NULL OR ${quoteIdentifier(name)} NOT IN (${placeholders}))`
              : // A link endpoint that is NULL names no counterpart, which is
                // not the same as naming one outside the bundle.
                `(${quoteIdentifier(name)} IS NOT NULL AND ${quoteIdentifier(name)} NOT IN (${placeholders}))`,
          )
          .join(' OR ');
        database
          .prepare(`DELETE FROM ${quoteIdentifier(row.name)} WHERE ${predicate}`)
          .run(...sessionColumns.flatMap(() => sessionIds));
      } else if (!PORTABLE_DERIVED_TABLES.has(row.name)) {
        database.exec(`DELETE FROM ${quoteIdentifier(row.name)}`);
      }
    }
    // Operational rows that describe a REQUEST rather than the conversation.
    // None of them reach the model, and in a real Session they are the large
    // majority of this table. history_compact_checkpoint_recorded, which does
    // decide what the model reads, is deliberately not here.
    if (options.omitDiagnostics) {
      database
        .prepare(`
        DELETE FROM core_agent_run_events
        WHERE event_type IN (${SESSION_BUNDLE_OMITTED_EVENT_TYPES.map(() => '?').join(', ')})
      `)
        .run(...SESSION_BUNDLE_OMITTED_EVENT_TYPES);
    }
    database
      .prepare(`
      DELETE FROM tool_journal_events
      WHERE NOT EXISTS (
        SELECT 1 FROM runtime_events
        WHERE runtime_events.invocation_id = tool_journal_events.invocation_id
      )
    `)
      .run();
    database
      .prepare(`
      DELETE FROM runtime_partial_segments
      WHERE NOT EXISTS (
        SELECT 1 FROM runtime_partial_snapshots
        WHERE runtime_partial_snapshots.stream_key = runtime_partial_segments.stream_key
      )
    `)
      .run();
    database
      .prepare(`
      DELETE FROM tool_operations
      WHERE NOT EXISTS (
        SELECT 1 FROM runtime_events
        WHERE runtime_events.invocation_id = tool_operations.invocation_id
      )
    `)
      .run();
    database
      .prepare(`
      DELETE FROM core_interaction_outcomes
      WHERE NOT EXISTS (
        SELECT 1 FROM core_interaction_requests
        WHERE core_interaction_requests.request_id = core_interaction_outcomes.request_id
      )
    `)
      .run();
    database.exec('COMMIT');
    const foreignKeyViolation = database.prepare('PRAGMA foreign_key_check').get();
    if (foreignKeyViolation) throw new Error('Filtered session database has dangling references');
    // DELETE frees pages, it does not erase them. Without this the bundle ships
    // a file whose freelist still holds the excluded Sessions' bytes -- readable
    // by anyone who opens it with something other than SQL.
    database.exec('VACUUM');
    for (const sessionId of sessionIds) {
      const session = database
        .prepare('SELECT 1 AS present FROM session_metadata WHERE session_id = ?')
        .get(sessionId);
      if (!session) throw new Error(`Filtered session is missing: ${sessionId}`);
    }
    database.exec('PRAGMA journal_mode = DELETE');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    database.close();
  }
}

/**
 * `core_agent_run_events` types the bundle drops.
 *
 * They record how a request was shaped and how a stream behaved -- diagnostics
 * for the machine that produced them, not the conversation. Any type absent
 * from this list is carried, including one a later build introduces: an export
 * moves rows, it does not interpret them.
 */
export const SESSION_BUNDLE_OMITTED_EVENT_TYPES = [
  'provider_request_attempt_recorded',
  'provider_request_captured',
  'model_call_attempt_recorded',
  'model_stream_started',
  'model_stream_completed',
  'model_stream_failed',
  'send_diagnostics_recorded',
  'plan_context_resolved',
  'skill_catalog_built',
  'skill_searched',
  'skill_loaded',
  'skill_load_failed',
  'tool_searched',
  'request_composition_resolved',
  'trace_write_failed',
] as const;

/**
 * Ownership, which is not the same thing as naming a Session.
 *
 * `session_id` says whose row this is. Everything else in this list is a
 * Session column only on tables that have no `session_id` -- link tables, whose
 * whole content is the pair they join, and which are meaningless when one end
 * is outside the bundle.
 *
 * Keeping the two apart matters. `session_metadata.parent_session_id` is a
 * lineage POINTER, not ownership: treating it as ownership deleted the very
 * Session being exported whenever its branch source lay outside the subtree.
 * And a link table whose columns are spelled `parent_session_id` /
 * `child_session_id` -- `subagent_spawns`, the record of which tool call
 * spawned each child -- looked Session-less and was emptied wholesale.
 *
 * Nullable columns count only when set, so a row that names no counterpart is
 * not deleted for failing to name one.
 */
const SESSION_ROW_OWNER_COLUMN = 'session_id';
const SESSION_LINK_COLUMNS = [
  'source_session_id',
  'target_session_id',
  'parent_session_id',
  'child_session_id',
  'root_session_id',
] as const;

/**
 * Tables the target writes for itself.
 *
 * `session_metadata` carries triggers that maintain the catalog projection, so
 * inserting the bundle's copy of it and then the Session row makes the trigger
 * collide with what was just inserted. The projection is derived; letting the
 * target derive it is both simpler and the only way it stays correct when the
 * derivation changes.
 */
const TRIGGER_MAINTAINED_TABLES = new Set(['session_catalog_projection']);

const PORTABLE_GLOBAL_TABLES = new Set([
  'operational_schema_migrations',
  'session_metadata_schema',
  'runtime_capabilities',
  'session_catalog_state',
]);

const PORTABLE_DERIVED_TABLES = new Set([
  'tool_journal_events',
  'tool_operations',
  'runtime_partial_segments',
  'core_interaction_outcomes',
]);

/**
 * The Session and its subagent descendants, root first, siblings by id.
 *
 * `subagent_parent_session_id` is an ordinary column, not a constrained tree:
 * nothing stops a row naming itself or an ancestor. Membership is tracked
 * rather than assumed, so a cycle ends the walk instead of hanging it, and a
 * Session reachable twice is exported once.
 */
/**
 * Refuse a source whose schema this build does not read.
 *
 * The filter runs `DELETE` over whatever tables the database happens to have,
 * so a schema this build cannot read produces a bundle whose shape will not
 * match what its manifest claims. The operational store is the authority on
 * what "current" means -- a private list here went stale the moment a scope was
 * added, and reported versions the source did not have.
 */
function assertPortableSourceSchema(database: DatabaseSync): Record<string, number> {
  // The inspector validates every scope and says whether a migration is owed.
  // It reports only some of them, so the manifest's numbers come from the
  // registry the database keeps -- validated by the authority, reported from
  // the source, and neither of them this build's constants.
  const inspection = inspectOperationalStateSchema(database);
  if (inspection.status !== 'current') {
    throw new SessionBundleExportError(
      'schema_unsupported',
      'Session bundle source schema is not current',
    );
  }
  const registered: Record<string, number> = {};
  for (const row of database
    .prepare('SELECT scope, version FROM operational_schema_migrations ORDER BY scope')
    .all() as Array<{ scope?: unknown; version?: unknown }>) {
    if (typeof row.scope === 'string' && typeof row.version === 'number') {
      registered[row.scope] = row.version;
    }
  }
  return registered;
}

/**
 * Refuse a Session that is mid-turn.
 *
 * The writer locks around this export keep other writers out from here on, but
 * they say nothing about work that was already in flight when it started. A
 * partial stream snapshot, a tool dispatched without a settled result, or an
 * invocation that never reached a terminal event each mean the bundle would
 * carry half of something -- and half a turn is not a Session.
 */
function assertSessionQuiescent(database: DatabaseSync, sessionId: string): void {
  const partials = database
    .prepare('SELECT COUNT(*) AS count FROM runtime_partial_snapshots WHERE session_id = ?')
    .get(sessionId) as { count?: unknown };
  if (Number(partials.count ?? 0) > 0) {
    throw new SessionBundleExportError(
      'session_active',
      `Session has a partial stream snapshot: ${sessionId}`,
    );
  }
  // A tool that crossed the dispatch boundary and never settled. Its
  // invocation can carry a terminal event -- the run failed -- while the
  // operation itself is still prepared, so an invocation check does not see it.
  // Same predicate the runtime store uses, so "unsettled" means one thing.
  const unsettledOperations = database
    .prepare(`
      SELECT COUNT(*) AS count FROM tool_operations
      WHERE current_state = 'prepared'
        AND result_event_id IS NULL
        AND dispatch_event_id IS NOT NULL
        AND call_event_id IN (SELECT event_id FROM runtime_events WHERE session_id = ?)
    `)
    .get(sessionId) as { count?: unknown };
  if (Number(unsettledOperations.count ?? 0) > 0) {
    throw new SessionBundleExportError(
      'session_active',
      `Session has an unsettled tool operation: ${sessionId}`,
    );
  }
  const openInvocations = database
    .prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT DISTINCT invocation_id FROM runtime_events AS invocations
        WHERE session_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM runtime_events AS terminal
            WHERE terminal.invocation_id = invocations.invocation_id
              AND ${TERMINAL_RUNTIME_EVENT_SQL}
          )
      )
    `)
    .get(sessionId) as { count?: unknown };
  if (Number(openInvocations.count ?? 0) > 0) {
    throw new SessionBundleExportError(
      'session_active',
      `Session has an invocation with no terminal event: ${sessionId}`,
    );
  }
}

function collectSubagentSessionTree(database: DatabaseSync, rootSessionId: string): string[] {
  const ordered: string[] = [];
  const seen = new Set([rootSessionId]);
  const queue = [rootSessionId];
  const children = database.prepare(
    'SELECT session_id FROM session_metadata WHERE subagent_parent_session_id = ? ORDER BY session_id',
  );
  while (queue.length > 0) {
    const sessionId = queue.shift() as string;
    ordered.push(sessionId);
    for (const row of children.all(sessionId) as Array<{ session_id?: unknown }>) {
      const childId = row.session_id;
      if (typeof childId !== 'string' || seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId);
    }
  }
  return ordered;
}

export function isArtifactPathForSession(relativePath: string, sessionId: string): boolean {
  const parts = relativePath.split(/[\\/]+/);
  return (
    parts.length >= 2 &&
    parts[0] === sessionId &&
    parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

async function canonicalRoot(path: string, role: string, allowMissing = false): Promise<string> {
  const requested = resolve(path);
  try {
    const metadata = await lstat(requested);
    if (metadata.isSymbolicLink()) {
      throw new SessionBundleExportError('symlink', `${role} root cannot be a symlink`);
    }
    if (!metadata.isDirectory()) {
      throw new SessionBundleExportError('invalid_root', `${role} root is not a directory`);
    }
    return realpath(requested);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return requested;
    if (error instanceof SessionBundleExportError) throw error;
    throw new SessionBundleExportError('invalid_root', `${role} root does not exist`, {
      cause: error,
    });
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const metadata = await lstat(path).catch((error) => {
    throw new SessionBundleExportError('invalid_root', `Missing ${label}`, { cause: error });
  });
  if (metadata.isSymbolicLink()) {
    throw new SessionBundleExportError('symlink', `${label} cannot be a symlink`);
  }
  if (!metadata.isFile()) {
    throw new SessionBundleExportError('unsupported_entry', `${label} is not a regular file`);
  }
}

async function assertDestinationMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new SessionBundleExportError(
    'destination_not_empty',
    `Session bundle destination already exists: ${path}`,
  );
}

function resolveInside(root: string, path: string): string {
  const candidate = resolve(root, path);
  const rel = relative(root, candidate);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SessionBundleExportError('path_escape', `Path escapes bundle root: ${path}`);
  }
  return candidate;
}

function assertRootsSeparate(left: string, right: string, allowSame: boolean): void {
  if (left === right) {
    if (allowSame) return;
    throw new SessionBundleExportError('overlapping_roots', 'Session bundle roots overlap');
  }
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  if (
    (!leftToRight.startsWith('..') && !isAbsolute(leftToRight)) ||
    (!rightToLeft.startsWith('..') && !isAbsolute(rightToLeft))
  ) {
    throw new SessionBundleExportError('overlapping_roots', 'Session bundle roots overlap');
  }
}

function assertSafeSessionId(sessionId: string): void {
  if (!isSafeStorageId(sessionId)) {
    throw new SessionBundleExportError('invalid_root', `Invalid session id: ${sessionId}`);
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export type SessionBundleImportErrorCode =
  | 'invalid_root'
  | 'schema_unsupported'
  | 'session_exists'
  | 'conflict'
  | 'io_failed';

export class SessionBundleImportError extends Error {
  constructor(
    readonly code: SessionBundleImportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SessionBundleImportError';
  }
}

export interface SessionBundleImportInput {
  /** The workspace receiving the Sessions. */
  stateRoot: string;
  /** A hydrated bundle's state tree: the filtered database, artifacts, context. */
  bundleStateRoot: string;
  /**
   * The state root the bundle was exported from. The records name a saved
   * tool output or task output by its absolute path under that root; given,
   * those paths are moved to the same place under `stateRoot`, where the
   * import puts the files. Omitted, the paths are left as they are.
   */
  sourceStateRoot?: string;
  /**
   * Authority the caller already holds, instead of electing it here.
   *
   * The Runtime Host owns the Storage Root for its whole lifetime and the
   * owner lock is an election that refuses a second hold -- from any process,
   * its own included. Lending the lease is the only way the Host can run this
   * while it is up, which is the only way a user can reach it from the app.
   * Omitted, the authority is elected exactly as before.
   */
  lease?: StorageRootLease<'interactive', 'write'>;
}

export interface SessionBundleImportResult {
  sessionIds: string[];
  artifactFiles: number;
  contextRefs: number;
}

/**
 * Merge a hydrated bundle into a workspace.
 *
 * The mirror of the export, and the asymmetry is the whole design: the export
 * owns a private copy and can DELETE what is not the subtree, while the import
 * writes into a live workspace holding other people's Sessions and can only
 * ADD. What keeps that from needing a table list is that the bundle's database
 * already contains nothing else -- so this copies every table it has, and a
 * table added to the schema later travels in both directions without anyone
 * updating a list.
 *
 * Write order is the safety argument. Artifact bytes land first and the
 * database transaction commits last, so a failure between them leaves files
 * nothing points at -- reclaimable -- rather than rows pointing at files that
 * are not there.
 */
export async function importSessionBundleState(
  input: SessionBundleImportInput,
): Promise<SessionBundleImportResult> {
  const bundleStateRoot = await canonicalRoot(input.bundleStateRoot, 'bundle state');
  const bundleDatabasePath = resolveInside(bundleStateRoot, OPERATIONAL_STATE_DATABASE_NAME);
  await assertRegularFile(bundleDatabasePath, OPERATIONAL_STATE_DATABASE_NAME);

  // The authority is decided by what is being written, not by what the target
  // already has. A bundle carrying context needs it even for a fresh workspace
  // with no context store yet -- which is exactly the case that would otherwise
  // run unprotected, and the common one.
  const bundleCarriesContext = await pathExists(
    resolveInside(bundleStateRoot, CONTEXT_OFFLOAD_DATABASE_NAME),
  );

  return withOfflineContextSnapshot(
    input.stateRoot,
    (contextLocked) =>
      withBundleArtifactWriterLock(input.stateRoot, input.lease, async (stateRoot) => {
        const sessionIds = readBundleSessionIds(bundleDatabasePath);
        if (sessionIds.length === 0) {
          throw new SessionBundleImportError('invalid_root', 'Bundle carries no Session');
        }

        // The export refuses to migrate its source because it only reads. An
        // import is a write the user asked for, and the target is often a
        // workspace with no database yet -- moving to a new machine is the whole
        // point -- so this opens the ordinary way and lets it be initialised.
        let lease: OperationalStateDatabaseLease;
        try {
          lease = acquireOperationalStateDatabase(stateRoot);
        } catch (error) {
          // A target this build cannot open is a schema verdict, not an IO one;
          // everything else the operational store raises is the environment.
          if (error instanceof OperationalStateMigrationBlockedError) {
            throw new SessionBundleImportError(
              'schema_unsupported',
              'Workspace schema cannot be opened by this build',
              { cause: error },
            );
          }
          throw error;
        }
        try {
          assertBundleSchemaMatches(lease.database, bundleDatabasePath);
          assertImportableInto(lease.database, sessionIds);
          // Everything the Session will reference lands first; the Session rows
          // are the last thing written. A failure before that leaves artifacts
          // and context nothing points at, which the store reclaims, rather than
          // a Session already visible whose bytes never arrived -- and which a
          // retry could not fix, because the ids are now taken.
          const artifacts = await copyBundleArtifacts(bundleStateRoot, stateRoot);
          const savedOutputs: string[] = [];
          try {
            const savedOutputSessionIds = await copyBundleSavedOutputs(
              bundleStateRoot,
              stateRoot,
              sessionIds,
              savedOutputs,
            );
            const contextRefs = await mergeBundleContext(
              bundleStateRoot,
              stateRoot,
              contextLocked,
              sessionIds,
            );
            const inserted = mergeBundleDatabase(
              lease,
              bundleDatabasePath,
              input.sourceStateRoot !== undefined && input.sourceStateRoot !== stateRoot
                ? { from: input.sourceStateRoot, to: stateRoot, sessionIds, savedOutputSessionIds }
                : undefined,
            );
            return { sessionIds: inserted, artifactFiles: artifacts.copied, contextRefs };
          } catch (error) {
            // Take back only what this attempt created. Anything already there
            // belongs to someone else, or to an earlier attempt that the next
            // one will recognise.
            for (const path of [...artifacts.created, ...savedOutputs]) {
              await rm(path, { force: true }).catch(() => {});
            }
            throw error;
          }
        } finally {
          lease.close();
        }
      }),
    {
      requireAuthority: bundleCarriesContext,
      ...(input.lease ? { lease: input.lease } : {}),
    },
  );
}

/**
 * Refuse a bundle written against a different schema.
 *
 * The merge copies rows with `INSERT ... SELECT *`, which maps by position. A
 * bundle whose tables have a different column ORDER but the same count would
 * be inserted silently transposed -- rows that read as data and are not. The
 * export only ever writes a bundle at its own current schema, so any mismatch
 * here means the two builds disagree, and the honest answer is to say so
 * rather than to guess a mapping.
 */
function assertBundleSchemaMatches(target: DatabaseSync, bundleDatabasePath: string): void {
  const bundle = new DatabaseSync(bundleDatabasePath, { readOnly: true });
  try {
    const bundleVersions = readSchemaRegistry(bundle);
    const targetVersions = readSchemaRegistry(target);
    for (const [scope, version] of Object.entries(bundleVersions)) {
      if (targetVersions[scope] !== version) {
        throw new SessionBundleImportError(
          'schema_unsupported',
          `Bundle schema ${scope} is ${version}; this workspace is ${
            targetVersions[scope] ?? 'absent'
          }`,
        );
      }
    }
    const bundleUserVersion = readUserVersionPragma(bundle);
    const targetUserVersion = readUserVersionPragma(target);
    if (bundleUserVersion !== targetUserVersion) {
      throw new SessionBundleImportError(
        'schema_unsupported',
        `Bundle runtime schema is ${bundleUserVersion}; this workspace is ${targetUserVersion}`,
      );
    }
  } finally {
    bundle.close();
  }
}

function readSchemaRegistry(database: DatabaseSync): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const row of database
    .prepare('SELECT scope, version FROM operational_schema_migrations')
    .all() as Array<{ scope?: unknown; version?: unknown }>) {
    if (typeof row.scope === 'string' && typeof row.version === 'number') {
      versions[row.scope] = row.version;
    }
  }
  return versions;
}

function readUserVersionPragma(database: DatabaseSync): number {
  const row = (database.prepare('PRAGMA user_version').get() ?? {}) as Record<string, unknown>;
  return Number(Object.values(row)[0] ?? -1);
}

/** The same question the export asks before deleting a table wholesale. */
function describesASession(target: DatabaseSync, table: string): boolean {
  if (PORTABLE_DERIVED_TABLES.has(table)) return true;
  const columns = new Set(
    (
      target.prepare(`PRAGMA bundle.table_info(${quoteIdentifier(table)})`).all() as Array<{
        name?: unknown;
      }>
    )
      .map((column) => column.name)
      .filter((name): name is string => typeof name === 'string'),
  );
  if (columns.has(SESSION_ROW_OWNER_COLUMN)) return true;
  return SESSION_LINK_COLUMNS.some((column) => columns.has(column));
}

function readBundleSessionIds(bundleDatabasePath: string): string[] {
  const database = new DatabaseSync(bundleDatabasePath, { readOnly: true });
  try {
    return (
      database
        .prepare('SELECT session_id FROM session_metadata ORDER BY session_id')
        .all() as Array<{
        session_id?: unknown;
      }>
    ).map((row) => String(row.session_id));
  } finally {
    database.close();
  }
}

/**
 * Refuse before writing anything.
 *
 * Session ids are generated, not chosen, so one already present means this
 * Session is already here -- not that two of them collided. Importing over it
 * would merge two histories that share ids and agree about nothing else.
 */
function assertImportableInto(target: DatabaseSync, sessionIds: readonly string[]): void {
  const existing = target.prepare('SELECT 1 FROM session_metadata WHERE session_id = ?');
  const present = sessionIds.filter((sessionId) => existing.get(sessionId) !== undefined);
  if (present.length > 0) {
    throw new SessionBundleImportError(
      'session_exists',
      `Session already present in this workspace: ${present.join(', ')}`,
    );
  }
}

/**
 * Stage the bundle's artifact bytes, and be able to take them back.
 *
 * Publishing the Session last stops a broken Session from becoming visible, but
 * it does not by itself make the import retryable: bytes written before a later
 * failure stay behind, and a second attempt then trips over its own leftovers.
 *
 * Two rules make a retry work without overwriting anything. A destination that
 * is byte-identical to what the bundle carries is this import's own leftover,
 * or the same content by another route, and is accepted. A destination holding
 * something else is a real conflict. Files this attempt actually created are
 * remembered, so a failure can remove exactly those and nothing else.
 */
async function copyBundleArtifacts(
  bundleStateRoot: string,
  stateRoot: string,
): Promise<{ copied: number; created: string[] }> {
  const source = resolveInside(bundleStateRoot, 'artifacts');
  const created: string[] = [];
  if (!(await pathExists(source))) return { copied: 0, created };
  let copied = 0;
  const walk = async (relative: string): Promise<void> => {
    const absolute = relative ? resolveInside(source, relative) : source;
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(next);
        continue;
      }
      if (!entry.isFile()) {
        throw new SessionBundleImportError(
          'io_failed',
          `Bundle artifact is not a regular file: ${next}`,
        );
      }
      const from = resolveInside(source, next);
      const destination = resolveInside(resolveInside(stateRoot, 'artifacts'), next);
      await mkdir(dirname(destination), { recursive: true });
      try {
        await copyFile(from, destination, constants.COPYFILE_EXCL);
        created.push(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await sameFileContent(from, destination))) {
          throw new SessionBundleImportError('conflict', `Artifact already present: ${next}`);
        }
      }
      copied += 1;
    }
  };
  await walk('');
  return { copied, created };
}

/**
 * Place the bundle's saved output under this workspace's state root: each
 * `<directory>/<sessionId>/<file>` at the same place, private to the user.
 * Only the folders of the Sessions the bundle carries, and only files with a
 * saved output's name. A retry accepts an identical file it left before, as
 * the artifact copy does; each file this attempt made is added to `created`.
 */
async function copyBundleSavedOutputs(
  bundleStateRoot: string,
  stateRoot: string,
  sessionIds: readonly string[],
  created: string[],
): Promise<ReadonlySet<string>> {
  const sessions = new Set(sessionIds);
  const copiedSessions = new Set<string>();
  for (const directory of SAVED_OUTPUT_DIRECTORIES) {
    const source = resolveInside(bundleStateRoot, directory);
    if (!(await pathExists(source))) continue;
    const destinationRoot = resolveInside(stateRoot, directory);
    await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
    await assertManagedDestinationDirectory(destinationRoot, stateRoot);
    for (const folder of await readdir(source, { withFileTypes: true })) {
      if (!folder.isDirectory() || !sessions.has(folder.name)) {
        throw new SessionBundleImportError(
          'invalid_root',
          `Bundle ${directory} entry belongs to no Session it carries: ${folder.name}`,
        );
      }
      const destinationFolder = resolveInside(stateRoot, `${directory}/${folder.name}`);
      await mkdir(destinationFolder, { recursive: true, mode: 0o700 });
      await assertManagedDestinationDirectory(destinationFolder, stateRoot);
      for (const file of await readdir(resolveInside(source, folder.name), {
        withFileTypes: true,
      })) {
        const name = `${directory}/${folder.name}/${file.name}`;
        if (!file.isFile() || !SAVED_OUTPUT_FILE_NAME.test(file.name)) {
          throw new SessionBundleImportError(
            'io_failed',
            `Bundle entry is not saved output: ${name}`,
          );
        }
        const from = resolveInside(source, `${folder.name}/${file.name}`);
        const destination = resolveInside(destinationFolder, file.name);
        await publishImportedSavedOutputFile({
          from,
          to: destination,
          stateRoot,
          onCreated: (path) => created.push(path),
          onExisting: async () => {
            if (!(await sameFileContent(from, destination))) {
              throw new SessionBundleImportError(
                'conflict',
                `Saved output already present: ${name}`,
              );
            }
          },
        });
        copiedSessions.add(folder.name);
      }
    }
  }
  return copiedSessions;
}

/**
 * Compares two files without following a symlink at either path.
 *
 * A payload path is content-addressed, so `EEXIST` there is normally the same
 * bytes arriving twice. A symlink planted at that exact path pointing at
 * matching content compares equal through an ordinary read, and the import
 * accepts a payload tree the Context Store will later reject as corrupt --
 * it refuses to read through a link. Opened no-follow, the planted link is a
 * different content instead of the same content.
 */
async function sameFileContent(left: string, right: string): Promise<boolean> {
  const expected = await readFile(left);
  try {
    // The repository's reader rather than an open of our own: it is
    // non-blocking, so a FIFO planted at the path cannot hang the import, and
    // it compares the opened file against `lstat` of the path, so a path that
    // stops naming the same file mid-read reads as different content.
    //
    // On POSIX that also refuses a symlink, because the open carries
    // `O_NOFOLLOW`. On Windows the flag is absent and `lstat` does not reliably
    // report a file symlink as one, so the symlink refusal there rests on what
    // the platform makes visible -- less than this reader gives on POSIX. Only
    // `left` is trusted: it is a bundle entry, and the walk that reaches it
    // admits `isFile()` directory entries, never a link.
    const actual = await readStableBoundedFile({
      path: right,
      maxBytes: expected.length,
      invalidFile: () => new NotTheSamePayloadError(),
    });
    return actual.equals(expected);
  } catch (error) {
    if (error instanceof NotTheSamePayloadError) return false;
    throw error;
  }
}

/** Internal: the stable reader reports every refusal through one error. */
class NotTheSamePayloadError extends Error {}

/** Saved-output paths to move from the root the bundle left to this one. */
interface SavedOutputRootMove {
  readonly from: string;
  readonly to: string;
  readonly sessionIds: readonly string[];
  readonly savedOutputSessionIds: ReadonlySet<string>;
}

/**
 * Copy every table the bundle has, in one transaction.
 *
 * No allow-list: the bundle's database was already filtered down to its own
 * Sessions, so "everything it has" is exactly what belongs. Only the tables
 * describing the WORKSPACE rather than a Session are skipped -- the target has
 * its own, and they are not the bundle's to bring.
 */
function mergeBundleDatabase(
  lease: OperationalStateDatabaseLease,
  bundleDatabasePath: string,
  move: SavedOutputRootMove | undefined,
): string[] {
  const target = lease.database;
  // Read-only, so a bundle is never written by the act of reading it -- and so
  // a hydrated staging tree cannot pick up a journal beside it.
  const uri = `file:${encodeURI(bundleDatabasePath)}?mode=ro`;
  target.exec(`ATTACH DATABASE '${uri.replaceAll("'", "''")}' AS bundle`);
  try {
    // The lease owns a shared, reference-counted connection with its own
    // transaction depth. Driving BEGIN/COMMIT directly would step around that,
    // and the foreign-key pragma it needs must be put back: leaving it off
    // would silently disarm constraint checking for every later user of this
    // connection.
    const restoreForeignKeys =
      Number(
        Object.values(
          (target.prepare('PRAGMA foreign_keys').get() ?? {}) as Record<string, unknown>,
        )[0] ?? 0,
      ) === 1;
    target.exec('PRAGMA foreign_keys = OFF');
    try {
      return lease.transaction('write', () => {
        const inserted = mergeAttachedBundle(target);
        if (move) moveImportedSavedOutputPaths(target, move);
        return inserted;
      });
    } finally {
      if (restoreForeignKeys) target.exec('PRAGMA foreign_keys = ON');
    }
  } finally {
    target.exec('DETACH DATABASE bundle');
  }
}

function mergeAttachedBundle(target: DatabaseSync): string[] {
  {
    {
      const tables = target
        .prepare(
          "SELECT name FROM bundle.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name?: unknown }>;
      for (const row of tables) {
        const name = row.name;
        if (
          typeof name !== 'string' ||
          PORTABLE_GLOBAL_TABLES.has(name) ||
          TRIGGER_MAINTAINED_TABLES.has(name)
        ) {
          continue;
        }
        // Mirror the export's own classification instead of trusting that it
        // ran: a table with no Session column and no referential rule describes
        // the WORKSPACE, and the target has its own. The export empties those,
        // so in practice this inserts nothing -- but an import that depends on
        // the other side having tidied up is one bundle away from writing a
        // workspace singleton into somebody else's workspace.
        if (!describesASession(target, name)) continue;
        const quoted = quoteIdentifier(name);
        target.exec(`INSERT INTO main.${quoted} SELECT * FROM bundle.${quoted}`);
      }
      const violation = target.prepare('PRAGMA foreign_key_check').get();
      if (violation) {
        throw new SessionBundleImportError(
          'conflict',
          'Imported Sessions would leave dangling references',
        );
      }
      return (
        target
          .prepare('SELECT session_id FROM bundle.session_metadata ORDER BY session_id')
          .all() as Array<{ session_id?: unknown }>
      ).map((entry) => String(entry.session_id));
    }
  }
}

/**
 * Point the imported records at the saved output where the import put it.
 *
 * A record names a saved file by its absolute path under the state root it
 * was written on, and the file now sits at the same place under this one.
 * The same places a conversation copy rewrites are rewritten here: a tool
 * result and what the model was shown of it, a text that names the file, and
 * a background task's output file. A tool call's arguments stay as they were
 * made, since their hash authenticates the call, and a row that does not
 * decode is left as it came.
 */
function moveImportedSavedOutputPaths(target: DatabaseSync, move: SavedOutputRootMove): void {
  const sourcePaths = savedOutputSourcePathApi(move.from);
  const folders = new Map<string, string>();
  for (const sessionId of move.sessionIds) {
    for (const directory of SAVED_OUTPUT_DIRECTORIES) {
      folders.set(
        sourcePaths.join(move.from, directory, sessionId),
        join(move.to, directory, sessionId),
      );
    }
  }
  const rewrite = savedOutputPathRewrite([...folders.keys()], (path) => {
    const folder = folders.get(sourcePaths.dirname(path));
    return folder === undefined ? undefined : join(folder, sourcePaths.basename(path));
  });
  // An opaque provider checkpoint cannot reveal whether it mentions one of
  // the relocated files. Relocating a Session's saved files invalidates its
  // old fold too, even when its only visible path was in an immutable call.
  const changedSessions = new Set(move.savedOutputSessionIds);
  // The root as it reads inside a JSON string, to pick out the rows naming it.
  const needle = JSON.stringify(sourcePaths.normalize(move.from)).slice(1, -1);
  if (bundleHasTable(target, 'runtime_events')) {
    const update = target.prepare(
      'UPDATE main.runtime_events SET payload_json = ? WHERE event_id = ?',
    );
    for (const row of target
      .prepare(
        'SELECT session_id, event_id, payload_json FROM bundle.runtime_events WHERE instr(payload_json, ?) > 0',
      )
      .all(needle) as Array<{ session_id?: unknown; event_id?: unknown; payload_json?: unknown }>) {
      let event: RuntimeEvent;
      try {
        event = decodeRuntimeEvent(JSON.parse(String(row.payload_json)));
      } catch {
        continue;
      }
      const moved = rewriteRuntimeEventSavedOutputPaths(event, rewrite);
      if (moved !== event) {
        update.run(encodeCanonicalRuntimeEvent(moved).json, String(row.event_id));
        changedSessions.add(String(row.session_id));
      }
    }
  }
  if (bundleHasTable(target, 'core_shell_runs')) {
    const update = target.prepare(
      'UPDATE main.core_shell_runs SET record_json = ? WHERE session_id = ? AND shell_run_id = ?',
    );
    for (const row of target
      .prepare(
        'SELECT session_id, shell_run_id, record_json FROM bundle.core_shell_runs WHERE instr(record_json, ?) > 0',
      )
      .all(needle) as Array<{
      session_id?: unknown;
      shell_run_id?: unknown;
      record_json?: unknown;
    }>) {
      let record: unknown;
      try {
        record = JSON.parse(String(row.record_json));
      } catch {
        continue;
      }
      if (record === null || typeof record !== 'object') continue;
      const outputFile = (record as { outputFile?: unknown }).outputFile;
      if (typeof outputFile !== 'string') continue;
      const moved = rewrite(outputFile);
      if (moved === outputFile) continue;
      changedSessions.add(String(row.session_id));
      update.run(
        JSON.stringify({ ...record, outputFile: moved }),
        String(row.session_id),
        String(row.shell_run_id),
      );
    }
  }
  if (bundleHasTable(target, 'core_agent_run_events')) {
    // A summary may be the only remaining text that names a saved output.
    // Do not let an otherwise matching checkpoint replay its old path.
    for (const row of target
      .prepare(
        `SELECT session_id, record_json FROM bundle.core_agent_run_events
         WHERE event_type = 'history_compact_checkpoint_recorded' AND instr(record_json, ?) > 0`,
      )
      .all(needle) as Array<{ session_id?: unknown; record_json?: unknown }>) {
      try {
        const record: unknown = JSON.parse(String(row.record_json));
        if (record === null || typeof record !== 'object') continue;
        const summary = (record as { data?: { checkpoint?: { summary?: unknown } } }).data
          ?.checkpoint?.summary;
        if (typeof summary === 'string' && rewrite(summary) !== summary) {
          changedSessions.add(String(row.session_id));
        }
      } catch {
        // As with an undecodable RuntimeEvent, preserve an opaque record.
      }
    }
  }
  // This runs inside the import transaction, before a Session is published.
  // Keep the canonical history and reset only its old compaction chain. The
  // projection and ledger must agree: either one can resurrect a stale fold.
  const removeCheckpoints = target.prepare(
    `DELETE FROM main.core_agent_run_events
     WHERE session_id = ? AND event_type = 'history_compact_checkpoint_recorded'`,
  );
  const clearProjection = target.prepare(
    `INSERT INTO main.core_agent_run_projections(session_id, event_type, event_json)
     VALUES (?, 'history_compact_checkpoint_recorded', NULL)
     ON CONFLICT(session_id, event_type) DO UPDATE SET event_json = NULL`,
  );
  for (const sessionId of move.sessionIds) {
    if (!changedSessions.has(sessionId)) continue;
    removeCheckpoints.run(sessionId);
    clearProjection.run(sessionId);
  }
}

/** Interpret the exported root on its own OS, not on the importing machine. */
function savedOutputSourcePathApi(root: string): typeof posix {
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/u.test(root) && win32.isAbsolute(root)) return win32;
  if (posix.isAbsolute(root)) return posix;
  throw new SessionBundleImportError('invalid_root', 'Saved output source root must be absolute');
}

function bundleHasTable(target: DatabaseSync, name: string): boolean {
  return (
    target
      .prepare("SELECT 1 FROM bundle.sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path)
    .then(() => true)
    .catch(() => false);
}

/**
 * Merge the bundle's offloaded context into the workspace.
 *
 * Without this an imported Session arrives with its read-image references
 * intact and none of the bytes behind them, which is the same hole the export
 * had before it learned to carry the closure.
 *
 * Blobs are content-addressed, so an id already present is the same bytes and
 * the insert is skipped rather than treated as a conflict.
 */
async function mergeBundleContext(
  bundleStateRoot: string,
  stateRoot: string,
  contextLocked: boolean,
  sessionIds: readonly string[],
): Promise<number> {
  const bundleContext = resolveInside(bundleStateRoot, CONTEXT_OFFLOAD_DATABASE_NAME);
  if (!(await pathExists(bundleContext))) return 0;
  if (!contextLocked) {
    throw new SessionBundleImportError(
      'io_failed',
      'Context import requires an offline Storage Root; stop the Runtime Host first',
    );
  }

  // An archive digest authenticates the archive, not the state inside it: it
  // says the bytes arrived as sent, and nothing about whether a row claiming a
  // hash names a file that hashes to it, or whether the tree describes more
  // than the Sessions it carries. Both are the snapshot's own shape, so one
  // validator states it, against the hydrated copy, before anything reaches
  // the target -- a second, bundle-only check could only ever drift from it.
  await validateContextSnapshot(bundleStateRoot, sessionIds);

  // Everything below is one turn in the Storage Root's context mutation queue,
  // shared with the Context Store's own publication and collection. Those
  // operations read database state, await, and only then act on files --
  // collection decides a payload is unreferenced, awaits, unlinks it -- so an
  // import that commits a reference inside that await leaves the reference
  // pointing at a file that is about to disappear. The re-check collection does
  // cannot see it, because the check and the unlink straddle the await.
  return runWithContextValueMutation(stateRoot, async () => {
    // Managed payloads live at `sha256/<prefix>/<hash>`, so a copy that visited
    // only immediate children saw one directory, skipped it, and reported a
    // successful import whose referenced bytes were all absent.
    await copyDeclaredContextValues(bundleContext, bundleStateRoot, stateRoot);
    return mergeBundleContextDatabase(bundleContext, stateRoot, sessionIds);
  });
}

async function mergeBundleContextDatabase(
  bundleContext: string,
  stateRoot: string,
  sessionIds: readonly string[],
): Promise<number> {
  const targetContext = resolveInside(stateRoot, CONTEXT_OFFLOAD_DATABASE_NAME);
  // One publication path, and the filesystem decides which case this is.
  //
  // Asking first whether the database exists and branching on the answer is a
  // decision that can be stale by the time it is acted on: a Context Store
  // initialising under the same lease creates that file, and an import that
  // already decided "absent" would then REPLACE it. On POSIX the Store keeps
  // writing to the now-unlinked inode while every later open reads the new
  // one, so its writes are invisible and gone at the next restart.
  //
  // `copyFile` also fills its destination progressively, and this destination
  // is the path a Store opens to decide whether the workspace has a store at
  // all. Staged and linked, it is absent or complete, never partly there.
  const staging = `${targetContext}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  try {
    await copyFile(bundleContext, staging, constants.COPYFILE_EXCL);
    // Synced before it is named, and the directory synced after: the Session
    // rows are committed later, and a power loss between the two must not leave
    // a Session whose context database is a name with nothing behind it, or no
    // name at all. Same ordering the managed payloads use.
    const handle = await open(staging, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(staging, targetContext);
    created = true;
    await syncDirectoryChain(dirname(targetContext), stateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await rm(staging, { force: true }).catch(() => {});
  }
  if (created) {
    return countContextRefs(targetContext, sessionIds);
  }
  const database = new DatabaseSync(targetContext);
  try {
    database.exec(`ATTACH DATABASE '${bundleContext.replaceAll("'", "''")}' AS bundle`);
    try {
      database.exec('BEGIN IMMEDIATE');
      try {
        database.exec(
          'INSERT OR IGNORE INTO main.context_blobs SELECT * FROM bundle.context_blobs',
        );
        // A retry re-inserts the same rows. Skipping an identical one is what
        // makes the second attempt work; skipping a DIFFERENT row that happens
        // to share an id would hide a real collision, so the two are separated.
        const colliding = database
          .prepare(`
            SELECT b.ref_id FROM bundle.context_refs b
            JOIN main.context_refs m USING(ref_id)
            WHERE m.session_id <> b.session_id OR m.blob_id <> b.blob_id
          `)
          .all() as Array<{ ref_id?: unknown }>;
        if (colliding.length > 0) {
          throw new SessionBundleImportError(
            'conflict',
            `Context reference already names different content: ${String(colliding[0]?.ref_id)}`,
          );
        }
        database.exec('INSERT OR IGNORE INTO main.context_refs SELECT * FROM bundle.context_refs');
        // A blob the target already held may have been queued for collection
        // while nothing referenced it. It is referenced again now, and leaving
        // the candidate behind makes the next collection fail outright --
        // `Context garbage candidate is still referenced or missing` -- and
        // keep failing. Ordinary insertion in the Store clears it the same way.
        database.exec(`
          DELETE FROM main.context_gc_candidates
          WHERE blob_id IN (SELECT blob_id FROM main.context_refs)
        `);
        // The context store maintains its usage tables explicitly -- no trigger
        // does it. Inserting blobs and refs without them leaves quotas and the
        // cleanup consistency checks reading numbers that describe a store that
        // no longer exists. Recomputed from what is actually there, which is
        // the same thing the export does when it filters.
        database.exec(`
          DELETE FROM context_session_usage;
          INSERT INTO context_session_usage
            SELECT r.session_id, count(*), sum(b.size_bytes)
            FROM context_refs r JOIN context_blobs b USING(blob_id) GROUP BY r.session_id;
          UPDATE context_store_usage SET
            blob_count = (SELECT count(*) FROM context_blobs),
            -- Bytes queued for deletion are still on disk and still charged:
            -- the store drops a blob row before draining its file and subtracts
            -- them when the drain completes. Recomputing from live blobs alone
            -- makes that later subtraction underflow. The export can use the
            -- simpler sum because it empties the queue on its private copy;
            -- a live target keeps it.
            physical_bytes =
              (SELECT coalesce(sum(size_bytes), 0) FROM context_blobs) +
              (SELECT coalesce(sum(size_bytes), 0) FROM context_file_deletions)
          WHERE singleton = 1;
        `);
        database.exec('COMMIT');
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {}
        throw error;
      }
    } finally {
      database.exec('DETACH DATABASE bundle');
    }
  } finally {
    database.close();
  }
  return countContextRefs(targetContext, sessionIds);
}

/**
 * Copy a managed-payload tree, structure and all.
 *
 * Content-addressed names mean an existing file is the same file, so an
 * already-present payload is left alone rather than treated as a conflict.
 */
/**
 * Publishes exactly the payloads the bundle's database declares.
 *
 * Walking the tree and copying every regular file publishes whatever is there,
 * and the validator only ever looks at rows: a hand-built bundle can carry
 * bytes no row names, and those arrive charged to nothing and reachable by
 * nothing -- not by usage, which counts blobs, and not by collection, which
 * starts from a blob whose references were released. The locators are the one
 * list both sides agree on, so they are what gets copied.
 *
 * Reading them raw is safe because the validator has already run: it derives
 * each locator from its blob id and refuses anything that is not exactly
 * `sha256/<first two>/<hash>`, so nothing here can name a path of its own
 * choosing. Moving this before that check would remove that guarantee.
 */
async function copyDeclaredContextValues(
  bundleContext: string,
  bundleStateRoot: string,
  stateRoot: string,
): Promise<void> {
  const locators: string[] = [];
  const database = new DatabaseSync(bundleContext, { readOnly: true });
  try {
    for (const row of database
      .prepare("SELECT payload FROM context_blobs WHERE storage_kind = 'managed_file'")
      .iterate() as Iterable<{ payload?: unknown }>) {
      const payload = row.payload;
      if (!(payload instanceof Uint8Array)) {
        throw new SessionBundleImportError('invalid_root', 'Bundle context locator is unreadable');
      }
      locators.push(Buffer.from(payload).toString('utf8'));
    }
  } finally {
    database.close();
  }

  const sourceRoot = resolveInside(bundleStateRoot, CONTEXT_OFFLOAD_VALUES_DIRECTORY_NAME);
  const destinationRoot = resolveInside(stateRoot, CONTEXT_OFFLOAD_VALUES_DIRECTORY_NAME);
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  await assertManagedDestinationDirectory(destinationRoot, stateRoot);
  for (const locator of locators) {
    const from = resolveInside(sourceRoot, locator);
    const to = resolveInside(destinationRoot, locator);
    const entry = await lstat(from).catch(() => undefined);
    if (!entry?.isFile()) {
      throw new SessionBundleImportError(
        'invalid_root',
        `Bundle context declares a payload it does not carry: ${locator}`,
      );
    }
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await assertManagedDestinationDirectory(dirname(to), stateRoot);
    await publishContextValue(from, to, stateRoot);
  }
}

/**
 * Refuses a destination directory that does not really live inside the Storage
 * Root.
 *
 * `resolveInside` compares strings, which says nothing about what the path
 * resolves to: a `context-offload-values` replaced by a symlink passes it and
 * then receives the payloads somewhere else entirely. The Context Store already
 * holds this invariant over its own managed directories, and a directory it
 * would refuse to publish into is not one an import may publish into either.
 */
async function assertManagedDestinationDirectory(
  directory: string,
  stateRoot: string,
): Promise<void> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  let resolved: string;
  try {
    [entry, resolved] = await Promise.all([lstat(directory), realpath(directory)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new SessionBundleImportError(
        'io_failed',
        `Context payload directory is not a directory: ${directory}`,
      );
    }
    throw error;
  }
  const fromRoot = relative(stateRoot, resolved);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new SessionBundleImportError(
      'io_failed',
      `Context payload directory escapes the Storage Root: ${directory}`,
    );
  }
}

/**
 * Publishes one payload the way the Context Store publishes its own: the bytes
 * are assembled under a staging name and become visible at the final path by a
 * single `link`.
 *
 * `copyFile` fills its destination progressively, so the final path is
 * observable half-written -- measured at 38 distinct intermediate sizes while
 * copying 64 MiB. Payloads are content-addressed, so a bundle and its target
 * routinely name the same path, and that path is one another Session may be
 * reading. It also decides what a retry sees: a copy interrupted midway leaves
 * a truncated file AT the final path, and the previous `EEXIST`-is-fine rule
 * accepted it as already present.
 *
 * The staging name is the Store's with a different suffix. Two imports cannot
 * race -- both need the write authority, and it is exclusive -- but an import
 * and the Store publishing the same blob can, and they must not share a name.
 */
async function publishContextValue(from: string, to: string, stateRoot: string): Promise<void> {
  const staging = join(dirname(to), `.${basename(to)}.import.tmp`);
  await rm(staging, { force: true });
  try {
    await copyFile(from, staging, constants.COPYFILE_EXCL);
    // 'r+' rather than 'r': Windows flushes through the handle and refuses a
    // read-only one, so a read handle would make this fail only on Windows.
    const handle = await open(staging, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(staging, to);
      // The bytes were synced; the directory entry naming them was not. A crash
      // here otherwise keeps the committed reference and loses the name, which
      // reads exactly like a payload that never arrived.
      await syncDirectoryChain(dirname(to), stateRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Reaching the final path now means the payload was already there, not
      // that this import put it there. Content addressing says it should be
      // byte-identical; if it is not, the store holds something this bundle
      // cannot explain and overwriting it would destroy the other Session's
      // payload.
      if (!(await sameFileContent(from, to))) {
        throw new SessionBundleImportError(
          'conflict',
          `Context payload already names different content: ${basename(to)}`,
        );
      }
    }
  } finally {
    await unlink(staging).catch(() => {});
  }
}

function countContextRefs(databasePath: string, sessionIds: readonly string[]): number {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const placeholders = sessionIds.map(() => '?').join(', ');
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM context_refs WHERE session_id IN (${placeholders})`)
      .get(...sessionIds) as { count?: unknown };
    return Number(row.count ?? 0);
  } finally {
    database.close();
  }
}
