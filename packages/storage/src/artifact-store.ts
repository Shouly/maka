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

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, link, lstat, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import {
  ARTIFACT_KINDS,
  ArtifactSourceUnavailableError,
  ARTIFACT_SOURCES,
  canUserDeleteArtifact,
  isArtifactChildResultOutput,
  isArtifactTurnKey,
  isCanonicalArtifactEntityId,
  type ArtifactBinaryReadResult,
  type ArtifactKind,
  type ArtifactRecord,
  type ArtifactSource,
  type ArtifactTextReadResult,
} from '@maka/core/artifacts';
import {
  isDeepResearchArtifactRole,
  type DeepResearchArtifactRole,
} from '@maka/core/deep-research-run';
import { sniffAttachmentMimeType } from '@maka/core/attachments';
import { isSafeRelativeArtifactPath } from './artifact-metadata-codec.js';
import {
  withArtifactWriterLock,
  withLeaseBoundArtifactWriterLock,
} from './artifact-writer-lock.js';
import type { ArtifactWriterLockAuthority } from './root-authority.js';
import { syncDirectory, syncDirectoryChain } from './stable-storage.js';
import { createSqliteArtifactMetadataRepository } from './sqlite-artifact-metadata.js';

export { isSafeRelativeArtifactPath } from './artifact-metadata-codec.js';
export const ARTIFACT_TEXT_PREVIEW_LIMIT_BYTES = 10 * 1024 * 1024;
export const ARTIFACT_BINARY_PREVIEW_LIMIT_BYTES = 50 * 1024 * 1024;

type ArtifactReadFailure = {
  readonly ok: false;
  readonly reason: 'not_found' | 'too_large' | 'read_failed' | 'not_allowed';
};
interface PreparedArtifactRead {
  readonly ok: true;
  readonly path: string;
  readonly record: ArtifactRecord;
  readonly maxBytes: number;
}
type ArtifactRecordDraft = Omit<ArtifactRecord, 'sizeBytes' | 'relativePath'>;

export interface CreateArtifactInput {
  sessionId: string;
  turnId: string;
  name: string;
  kind: ArtifactKind;
  content: string | Uint8Array;
  mimeType?: string;
  source: ArtifactSource;
  summary?: string;
  deepResearchRole?: DeepResearchArtifactRole;
  now?: number;
  id?: string;
  /** Atomically freeze this Session's view of a live task output. */
  taskOutputSnapshotOf?: string;
}

/** Source reads must not re-enter the store; owned resources use reuseArtifactId instead. */
export type CreateArtifactBatchInput = Omit<CreateArtifactInput, 'content'> & {
  maxBytes?: number;
} & (
    | { readContent(): Promise<string | Uint8Array>; reuseArtifactId?: never }
    | { reuseArtifactId: string; readContent?: never }
  );
export type ArtifactListRevision = `sha256:${string}`;
export interface ArtifactListPage {
  readonly revision: ArtifactListRevision;
  readonly records: readonly ArtifactRecord[];
  readonly total: number;
}
export interface ArtifactSessionEntry {
  readonly revision: ArtifactListRevision;
  readonly record: ArtifactRecord | null;
}
export type ArtifactChunkReadResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly offset: number;
      readonly totalBytes: number;
      readonly nextOffset: number | null;
    }
  | ArtifactReadFailure
  | { readonly ok: false; readonly reason: 'out_of_range' };
export interface ConversationArtifactCopyInput {
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly turnIds: readonly string[];
  /** Typed dependencies, including uploads and detached child results. Deleted resources stay absent. */
  readonly includeArtifactIds?: readonly string[];
  readonly taskOutputIds?: readonly string[];
}
export interface ConversationArtifactCopyResult {
  readonly artifactIds: ReadonlySet<string>;
}
export interface ChildArtifactHandoffInput {
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly artifactIds: readonly string[];
}
export type DurableArtifactBinaryReadResult =
  | ArtifactBinaryReadResult
  | { ok: false; reason: 'session_mismatch' };
export type DurableArtifactSizeResult =
  | { ok: true; sizeBytes: number }
  | { ok: false; reason: 'not_found' | 'too_large' | 'session_mismatch' };
export interface DurableArtifactAttachmentReader {
  readDurableAttachmentBinary(input: {
    artifactId: string;
    sessionId: string;
    maxBytes?: number;
  }): Promise<DurableArtifactBinaryReadResult>;
  readDurableAttachmentSize(input: {
    artifactId: string;
    sessionId: string;
    maxBytes?: number;
  }): Promise<DurableArtifactSizeResult>;
}
export type ArtifactUserDeleteResult = { readonly kind: 'deleted' | 'protected' | 'not_found' };
export interface ArtifactGarbageCollectionInput {
  readonly after?: string;
  readonly maxPaths: number;
}
export interface ArtifactGarbageCollectionResult {
  readonly nextAfter: string | null;
  readonly processedPaths: number;
  readonly failedPaths: number;
}
export interface ArtifactAuthorityStore extends DurableArtifactAttachmentReader {
  create(input: CreateArtifactInput): Promise<ArtifactRecord>;
  createBatch(inputs: readonly CreateArtifactBatchInput[]): Promise<ArtifactRecord[]>;
  copyConversationArtifacts(
    input: ConversationArtifactCopyInput,
  ): Promise<ConversationArtifactCopyResult>;
  /** Commit a hand-back once per receiver/source/resource; replay respects later deletion. */
  retainChildArtifacts(input: ChildArtifactHandoffInput): Promise<readonly string[]>;
  readTaskOutputSnapshot(sessionId: string, shellRunId: string): Promise<string | null | undefined>;
  readTaskOutputSnapshots(sessionId: string): Promise<ReadonlyMap<string, string | null>>;
  freezeMissingTaskOutput(sessionId: string, shellRunId: string): Promise<void>;
  /** Trusted storage adapter only. The callback runs under the GC/publication lock and must not re-enter. */
  withReadableFile<T>(
    sessionId: string,
    artifactId: string,
    read: (path: string, record: ArtifactRecord) => Promise<T>,
  ): Promise<T>;
  purgeSessionArtifacts(sessionId: string): Promise<void>;
  collectGarbage(input: ArtifactGarbageCollectionInput): Promise<ArtifactGarbageCollectionResult>;
  deleteOwnedArtifactInSession(
    sessionId: string,
    artifactId: string,
    source: ArtifactSource,
  ): Promise<void>;
  deleteUserArtifactInSession(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactUserDeleteResult>;
  listPage(
    sessionId: string,
    options: { offset: number; limit: number },
  ): Promise<ArtifactListPage>;
  listTurnArtifacts(sessionId: string, turnId: string): Promise<ArtifactRecord[]>;
  getInSession(sessionId: string, artifactId: string): Promise<ArtifactSessionEntry>;
  /** Internal reads do not compute a presentation-list revision. */
  getRecordInSession(sessionId: string, artifactId: string): Promise<ArtifactRecord | undefined>;
  scanSessionArtifacts(
    sessionId: string,
    options: { afterArtifactId?: string; limit: number },
  ): Promise<readonly ArtifactRecord[]>;
  readTextInSession(
    sessionId: string,
    artifactId: string,
    opts?: { maxBytes?: number },
  ): Promise<ArtifactTextReadResult>;
  readBinaryInSession(
    sessionId: string,
    artifactId: string,
    opts?: { maxBytes?: number },
  ): Promise<ArtifactBinaryReadResult>;
  readChunkInSession(
    sessionId: string,
    artifactId: string,
    options: { offset: number; maxBytes: number },
  ): Promise<ArtifactChunkReadResult>;
  close(): void;
}
export interface ArtifactStoreWriteAuthority {
  readonly store: ArtifactAuthorityStore;
  close(): void;
}
export function createSqliteArtifactStoreWriteAuthority(
  workspaceRoot: string,
  options: {
    assertAuthority?: () => Promise<void>;
    leaseBoundWriterLockAuthority?: ArtifactWriterLockAuthority;
  } = {},
): ArtifactStoreWriteAuthority {
  const store = new SqliteArtifactStore(
    workspaceRoot,
    createSqliteArtifactMetadataRepository(workspaceRoot),
    options.assertAuthority,
    options.leaseBoundWriterLockAuthority,
  );
  return Object.freeze({ store, close: () => store.close() });
}

class SqliteArtifactStore implements ArtifactAuthorityStore {
  private artifactRoot: string;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private workspaceRoot: string,
    private readonly metadata: ReturnType<typeof createSqliteArtifactMetadataRepository>,
    private readonly assertAuthority?: () => Promise<void>,
    private readonly writerAuthority?: ArtifactWriterLockAuthority,
  ) {
    this.artifactRoot = join(workspaceRoot, 'artifacts');
  }
  close(): void {
    this.metadata.close();
  }

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const accepted = {
      ...input,
      content: typeof input.content === 'string' ? input.content : new Uint8Array(input.content),
    };
    const draft = prepareArtifactDraft(accepted);
    return this.enqueueLocked(async () => {
      const existing = this.metadata.readInSession(accepted.sessionId, draft.id);
      if (existing) return this.replay(existing, accepted, draft);
      const identity = this.metadata.readIdentity(draft.id, accepted.sessionId);
      if (identity) {
        this.assertReplayMetadata(identity, accepted, draft);
        if (basename(identity.relativePath) !== sha256(Buffer.from(accepted.content)))
          throw artifactReplayConflict(draft.id);
      }
      const record = await this.stageArtifactContent(
        identity ?? draft,
        Buffer.from(accepted.content),
      );
      this.metadata.applyChanges({
        upserts: [record],
        taskOutputSnapshots: snapshotBinding(accepted, record.id),
      });
      return record;
    });
  }

  async createBatch(inputs: readonly CreateArtifactBatchInput[]): Promise<ArtifactRecord[]> {
    const accepted = inputs.map((input) => ({
      input: { ...input },
      draft: prepareArtifactDraft(input),
    }));
    if (new Set(accepted.map(({ draft }) => draft.id)).size !== accepted.length)
      throw new Error('Duplicate Artifact identity in batch');
    return this.enqueueLocked(async () => {
      if (accepted.some(({ draft }) => this.metadata.hasIdentity(draft.id)))
        throw new Error('Artifact batch requires new identities');
      const records: ArtifactRecord[] = [];
      for (const { input, draft } of accepted) {
        if (input.reuseArtifactId !== undefined) {
          const source = this.metadata.readInSession(input.sessionId, input.reuseArtifactId);
          if (!source) throw new ArtifactSourceUnavailableError();
          if (input.maxBytes !== undefined && source.sizeBytes > input.maxBytes)
            throw new ArtifactSourceUnavailableError(
              'File resource exceeds the delivery size limit',
            );
          await this.requireAvailable(source);
          records.push({
            ...draft,
            sizeBytes: source.sizeBytes,
            relativePath: source.relativePath,
          });
        } else {
          records.push(
            await this.stageArtifactContent(draft, Buffer.from(await input.readContent())),
          );
        }
      }
      // No membership is visible until every payload has been admitted and made durable.
      this.metadata.applyChanges({
        upserts: records,
        taskOutputSnapshots: records.flatMap((record, index) =>
          snapshotBinding(accepted[index]!.input, record.id),
        ),
      });
      return records;
    });
  }

  async copyConversationArtifacts(
    input: ConversationArtifactCopyInput,
  ): Promise<ConversationArtifactCopyResult> {
    assertEntityId(input.sourceSessionId, 'sessionId');
    assertEntityId(input.targetSessionId, 'sessionId');
    if (input.sourceSessionId === input.targetSessionId)
      throw new Error('Artifact conversation copy requires distinct Sessions');
    const turns = new Set(input.turnIds);
    for (const turn of turns) assertTurnKey(turn);
    const ids = new Set(input.includeArtifactIds ?? []);
    const taskIds = new Set(input.taskOutputIds ?? []);
    return this.enqueueLocked(async () => {
      const snapshots = this.metadata.readTaskOutputSnapshots(input.sourceSessionId);
      for (const id of taskIds) {
        const resource = snapshots.get(id);
        if (resource) ids.add(resource);
      }
      const selected = new Map<string, ArtifactRecord>();
      for (const record of this.metadata.readSession(input.sourceSessionId)) {
        if (turns.has(record.turnId) || ids.has(record.id)) selected.set(record.id, record);
      }
      const memberships: ArtifactRecord[] = [];
      for (const record of selected.values()) {
        await this.requireAvailable(record);
        memberships.push({ ...record, sessionId: input.targetSessionId });
      }
      this.metadata.applyChanges({
        upserts: memberships,
        copyHandoffs: input,
        taskOutputSnapshots: [...taskIds]
          .filter((id) => snapshots.has(id))
          .map((shellRunId) => ({
            sessionId: input.targetSessionId,
            shellRunId,
            artifactId: snapshots.get(shellRunId)!,
          })),
      });
      return { artifactIds: new Set(selected.keys()) };
    });
  }

  retainChildArtifacts(input: ChildArtifactHandoffInput): Promise<readonly string[]> {
    const { sourceSessionId, targetSessionId } = input;
    assertEntityId(sourceSessionId, 'sourceSessionId');
    assertEntityId(targetSessionId, 'targetSessionId');
    if (sourceSessionId === targetSessionId)
      throw new Error('Artifact hand-back requires distinct Sessions');
    const ids = [...new Set(input.artifactIds)];
    for (const id of ids) assertEntityId(id, 'artifactId');
    return this.enqueueLocked(async () => {
      const memberships: ArtifactRecord[] = [];
      const retained: string[] = [];
      for (const id of ids) {
        if (this.metadata.hasHandoff(targetSessionId, sourceSessionId, id)) {
          // The source may already be gone. A receipt records a completed grant,
          // not permission to recreate one that the receiver subsequently removed.
          if (this.metadata.readInSession(targetSessionId, id)) retained.push(id);
          continue;
        }
        const record = this.metadata.readInSession(sourceSessionId, id);
        if (!record || !isArtifactChildResultOutput(record)) continue;
        await this.requireAvailable(record);
        memberships.push({ ...record, sessionId: targetSessionId });
        retained.push(id);
      }
      // Membership and completion evidence are one transaction under the same
      // publication/delete lock. A crash cannot leave only one half committed.
      this.metadata.applyChanges({
        upserts: memberships,
        handoffs: memberships.map((record) => ({
          sessionId: targetSessionId,
          sourceSessionId,
          artifactId: record.id,
        })),
      });
      return retained;
    });
  }

  readTaskOutputSnapshot(
    sessionId: string,
    shellRunId: string,
  ): Promise<string | null | undefined> {
    return this.enqueue(async () => this.metadata.readTaskOutputSnapshot(sessionId, shellRunId));
  }
  readTaskOutputSnapshots(sessionId: string): Promise<ReadonlyMap<string, string | null>> {
    return this.enqueue(async () => this.metadata.readTaskOutputSnapshots(sessionId));
  }
  freezeMissingTaskOutput(sessionId: string, shellRunId: string): Promise<void> {
    assertEntityId(sessionId, 'sessionId');
    assertEntityId(shellRunId, 'shellRunId');
    return this.enqueueLocked(async () =>
      this.metadata.applyChanges({
        taskOutputSnapshots: [{ sessionId, shellRunId, artifactId: null }],
      }),
    );
  }
  withReadableFile<T>(
    sessionId: string,
    artifactId: string,
    read: (path: string, record: ArtifactRecord) => Promise<T>,
  ): Promise<T> {
    return this.enqueueLocked(async () => {
      const prepared = await this.prepareRead(sessionId, artifactId, Number.MAX_SAFE_INTEGER);
      if (!prepared.ok) {
        const message = `File resource is unavailable in this Session: ${prepared.reason}`;
        if (prepared.reason === 'not_found') throw new ArtifactSourceUnavailableError(message);
        throw new Error(message);
      }
      return read(prepared.path, prepared.record);
    });
  }

  private async stageArtifactContent(
    draft: ArtifactRecordDraft,
    bytes: Uint8Array,
  ): Promise<ArtifactRecord> {
    const digest = sha256(bytes);
    const relativePath = `blobs/sha256/${digest.slice(0, 2)}/${digest}`;
    const record = { ...draft, relativePath, sizeBytes: bytes.byteLength };
    const target = join(this.artifactRoot, relativePath);
    const directory = dirname(target);
    const stagingRelative = `blobs/sha256/${digest.slice(0, 2)}/.${randomUUID()}.tmp`;
    const staging = join(this.artifactRoot, stagingRelative);
    await mkdir(this.artifactRoot, { recursive: true, mode: 0o700 });
    await ensureRealDirectory(this.artifactRoot);
    let parent = this.artifactRoot;
    for (const segment of ['blobs', 'sha256', digest.slice(0, 2)]) {
      parent = join(parent, segment);
      await mkdir(parent, { mode: 0o700 }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
      await ensureRealDirectory(parent);
    }
    await syncDirectoryChain(directory, this.workspaceRoot);
    this.metadata.queueUnreferencedPaths([stagingRelative, relativePath]);
    const handle = await open(staging, 'wx', process.platform === 'win32' ? 0o600 : 0o400);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      try {
        await link(staging, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const prepared = await this.prepareRecordRead(record, bytes.byteLength);
        const existing = prepared.ok ? await readPreparedBytes(prepared) : prepared;
        if (!existing.ok || sha256(existing.bytes) !== digest)
          throw new Error('Immutable Artifact blob has different content');
      }
      // Existing names may be leftovers of a publication interrupted before directory sync.
      await syncDirectoryChain(directory, this.workspaceRoot);
    } finally {
      await unlink(staging).catch(() => undefined);
      await syncDirectory(directory);
    }
    return record;
  }

  purgeSessionArtifacts(sessionId: string): Promise<void> {
    assertEntityId(sessionId, 'sessionId');
    return this.enqueueLocked(async () =>
      this.metadata.applyChanges({ deleteSessions: [sessionId] }),
    );
  }

  async collectGarbage(
    input: ArtifactGarbageCollectionInput,
  ): Promise<ArtifactGarbageCollectionResult> {
    if (!Number.isSafeInteger(input.maxPaths) || input.maxPaths < 1 || input.maxPaths > 1024)
      throw new TypeError('Artifact cleanup path limit must be between 1 and 1024');
    const { after = '', maxPaths } = input;
    return this.enqueueLocked(async () => {
      const recorded = this.metadata.readGarbagePaths(after, maxPaths + 1);
      const selected = recorded.slice(0, maxPaths);
      const directories = new Set<string>();
      const discharged: string[] = [];
      let failedPaths = 0;
      for (const path of selected) {
        // Only the content namespace and our staging names can ever be garbage.
        if (
          !/^blobs\/sha256\/[0-9a-f]{2}\/(?:[0-9a-f]{64}|\.[A-Za-z0-9.-]+\.tmp)$/u.test(path) ||
          this.metadata.hasRelativePath(path)
        ) {
          discharged.push(path);
          continue;
        }
        try {
          const parent = dirname(join(this.artifactRoot, path));
          const root = await ensureRealDirectory(this.artifactRoot);
          const canonicalParent = await realpath(parent);
          if (!isInside(root, canonicalParent))
            throw new Error('Artifact garbage path escaped its root');
          // Unlink the entry, never a symlink's destination.
          await unlink(join(canonicalParent, basename(path))).catch((error) => {
            if (!isNotFound(error)) throw error;
          });
          directories.add(canonicalParent);
          discharged.push(path);
        } catch (error) {
          if (isNotFound(error)) discharged.push(path);
          else failedPaths++;
        }
      }
      for (const directory of directories) await syncDirectory(directory);
      this.metadata.forgetGarbagePaths(discharged);
      return {
        nextAfter: recorded.length > selected.length ? selected.at(-1)! : null,
        processedPaths: selected.length,
        failedPaths,
      };
    });
  }

  private assertReplayMetadata(
    existing: ArtifactRecord,
    input: CreateArtifactInput,
    draft: ArtifactRecordDraft,
  ): void {
    const expected = Buffer.from(input.content);
    if (
      existing.turnId !== draft.turnId ||
      existing.name !== draft.name ||
      existing.kind !== draft.kind ||
      existing.sizeBytes !== expected.byteLength ||
      existing.mimeType !== draft.mimeType ||
      existing.source !== draft.source ||
      existing.summary !== draft.summary ||
      existing.deepResearchRole !== draft.deepResearchRole ||
      (input.now !== undefined && existing.createdAt !== input.now)
    )
      throw artifactReplayConflict(existing.id);
  }
  private async replay(
    existing: ArtifactRecord,
    input: CreateArtifactInput,
    draft: ArtifactRecordDraft,
  ): Promise<ArtifactRecord> {
    this.assertReplayMetadata(existing, input, draft);
    const expected = Buffer.from(input.content);
    const prepared = await this.prepareRecordRead(existing, expected.byteLength);
    const actual = prepared.ok ? await readPreparedBytes(prepared) : prepared;
    if (!actual.ok || sha256(actual.bytes) !== sha256(expected))
      throw artifactReplayConflict(existing.id);
    this.metadata.applyChanges({ taskOutputSnapshots: snapshotBinding(input, existing.id) });
    return existing;
  }
  private async requireAvailable(record: ArtifactRecord): Promise<void> {
    const prepared = await this.prepareRecordRead(record, record.sizeBytes);
    if (!prepared.ok || (await stat(prepared.path)).size !== record.sizeBytes)
      throw new Error(`Artifact ${record.id} content is unavailable`);
  }

  listPage(
    sessionId: string,
    options: { offset: number; limit: number },
  ): Promise<ArtifactListPage> {
    assertPageBound(options.offset, true, 'offset');
    assertPageBound(options.limit, false, 'limit');
    const { offset, limit } = options;
    return this.enqueue(async () => this.metadata.readPage(sessionId, offset, limit));
  }
  listTurnArtifacts(sessionId: string, turnId: string): Promise<ArtifactRecord[]> {
    assertEntityId(sessionId, 'sessionId');
    assertTurnKey(turnId);
    return this.enqueue(async () =>
      this.metadata.readSession(sessionId).filter((record) => record.turnId === turnId),
    );
  }
  getInSession(sessionId: string, artifactId: string): Promise<ArtifactSessionEntry> {
    return this.enqueue(async () => this.metadata.readEntry(sessionId, artifactId));
  }
  getRecordInSession(sessionId: string, artifactId: string): Promise<ArtifactRecord | undefined> {
    return this.enqueue(async () => this.metadata.readInSession(sessionId, artifactId));
  }
  scanSessionArtifacts(
    sessionId: string,
    options: { afterArtifactId?: string; limit: number },
  ): Promise<readonly ArtifactRecord[]> {
    assertPageBound(options.limit, false, 'limit');
    const { afterArtifactId = '', limit } = options;
    return this.enqueue(async () => this.metadata.scanSession(sessionId, afterArtifactId, limit));
  }
  readTextInSession(
    sessionId: string,
    artifactId: string,
    opts: { maxBytes?: number } = {},
  ): Promise<ArtifactTextReadResult> {
    const maxBytes = opts.maxBytes ?? ARTIFACT_TEXT_PREVIEW_LIMIT_BYTES;
    return this.enqueueLocked(async () => {
      const prepared = await this.prepareRead(sessionId, artifactId, maxBytes);
      if (!prepared.ok) return prepared;
      const result = await readPreparedBytes(prepared);
      return result.ok ? { ok: true, text: result.bytes.toString('utf8') } : result;
    });
  }
  readBinaryInSession(
    sessionId: string,
    artifactId: string,
    opts: { maxBytes?: number } = {},
  ): Promise<ArtifactBinaryReadResult> {
    const maxBytes = opts.maxBytes ?? ARTIFACT_BINARY_PREVIEW_LIMIT_BYTES;
    return this.enqueueLocked(async () =>
      this.readBinary(await this.prepareRead(sessionId, artifactId, maxBytes)),
    );
  }
  readChunkInSession(
    sessionId: string,
    artifactId: string,
    options: { offset: number; maxBytes: number },
  ): Promise<ArtifactChunkReadResult> {
    const { offset, maxBytes } = options;
    return this.enqueueLocked(async () => {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1
      )
        return { ok: false, reason: 'out_of_range' };
      const prepared = await this.prepareRead(sessionId, artifactId, Number.MAX_SAFE_INTEGER);
      return prepared.ok ? readPreparedChunk(prepared, offset, maxBytes) : prepared;
    });
  }
  readDurableAttachmentBinary(input: {
    artifactId: string;
    sessionId: string;
    maxBytes?: number;
  }): Promise<DurableArtifactBinaryReadResult> {
    return this.enqueueLocked(async () => {
      const record = this.metadata.readInSession(input.sessionId, input.artifactId);
      if (!record)
        return {
          ok: false,
          reason: this.metadata.hasMembership(input.artifactId) ? 'session_mismatch' : 'not_found',
        };
      return this.readBinary(
        await this.prepareRecordRead(record, input.maxBytes ?? ARTIFACT_BINARY_PREVIEW_LIMIT_BYTES),
      );
    });
  }
  readDurableAttachmentSize(input: {
    artifactId: string;
    sessionId: string;
    maxBytes?: number;
  }): Promise<DurableArtifactSizeResult> {
    return this.enqueue(async () => {
      const record = this.metadata.readInSession(input.sessionId, input.artifactId);
      if (!record)
        return {
          ok: false,
          reason: this.metadata.hasMembership(input.artifactId) ? 'session_mismatch' : 'not_found',
        };
      if (record.sizeBytes > (input.maxBytes ?? ARTIFACT_BINARY_PREVIEW_LIMIT_BYTES))
        return { ok: false, reason: 'too_large' };
      return { ok: true, sizeBytes: record.sizeBytes };
    });
  }
  private async readBinary(
    prepared: PreparedArtifactRead | ArtifactReadFailure,
  ): Promise<ArtifactBinaryReadResult> {
    if (!prepared.ok) return prepared;
    const read = await readPreparedBytes(prepared);
    if (!read.ok) return read;
    const mimeType = sniffAllowedBinaryMime(read.bytes);
    return mimeType
      ? { ok: true, base64: read.bytes.toString('base64'), mimeType }
      : { ok: false, reason: 'unsupported_mime' };
  }
  deleteOwnedArtifactInSession(
    sessionId: string,
    artifactId: string,
    source: ArtifactSource,
  ): Promise<void> {
    return this.enqueueLocked(async () => {
      const record = this.metadata.readInSession(sessionId, artifactId);
      if (!record || record.source !== source)
        throw new Error('Artifact does not belong to the expected Session authority');
      this.metadata.applyChanges({ deleteReferences: [{ sessionId, artifactId }] });
    });
  }
  deleteUserArtifactInSession(
    sessionId: string,
    artifactId: string,
  ): Promise<ArtifactUserDeleteResult> {
    return this.enqueueLocked(async () => {
      const record = this.metadata.readInSession(sessionId, artifactId);
      if (!record) return { kind: 'not_found' };
      if (!canUserDeleteArtifact(record)) return { kind: 'protected' };
      this.metadata.applyChanges({ deleteReferences: [{ sessionId, artifactId }] });
      return { kind: 'deleted' };
    });
  }
  private async prepareRead(
    sessionId: string,
    artifactId: string,
    maxBytes: number,
  ): Promise<PreparedArtifactRead | ArtifactReadFailure> {
    const record = this.metadata.readInSession(sessionId, artifactId);
    return record ? this.prepareRecordRead(record, maxBytes) : { ok: false, reason: 'not_found' };
  }
  private async prepareRecordRead(
    record: ArtifactRecord,
    maxBytes: number,
  ): Promise<PreparedArtifactRead | ArtifactReadFailure> {
    let path = this.artifactRoot;
    for (const component of ['', ...record.relativePath.split('/')]) {
      path = join(path, component);
      const entry = await lstat(path).catch(() => undefined);
      if (!entry) return { ok: false, reason: 'not_found' };
      if (entry.isSymbolicLink()) return { ok: false, reason: 'not_allowed' };
    }
    const resolved = await resolveArtifactPath({
      artifactRoot: this.artifactRoot,
      relativePath: record.relativePath,
    });
    return resolved.ok ? { ok: true, path: resolved.path, record, maxBytes } : resolved;
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.assertAuthority?.();
      return operation();
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  private enqueueLocked<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(() =>
      this.writerAuthority
        ? withLeaseBoundArtifactWriterLock(this.writerAuthority, operation)
        : withArtifactWriterLock(this.workspaceRoot, async (canonicalRoot) => {
            this.workspaceRoot = canonicalRoot;
            this.artifactRoot = join(canonicalRoot, 'artifacts');
            return operation();
          }),
    );
  }
}

function snapshotBinding(input: Omit<CreateArtifactInput, 'content'>, artifactId: string) {
  return input.taskOutputSnapshotOf
    ? [{ sessionId: input.sessionId, shellRunId: input.taskOutputSnapshotOf, artifactId }]
    : [];
}
function prepareArtifactDraft(input: Omit<CreateArtifactInput, 'content'>): ArtifactRecordDraft {
  const id = input.id ?? randomUUID();
  if (!(ARTIFACT_KINDS as readonly string[]).includes(input.kind))
    throw new Error('Invalid Artifact kind');
  if (!(ARTIFACT_SOURCES as readonly string[]).includes(input.source))
    throw new Error('Invalid Artifact source');
  if (input.deepResearchRole !== undefined && !isDeepResearchArtifactRole(input.deepResearchRole))
    throw new Error('Invalid Artifact deep-research role');
  if (input.now !== undefined && (!Number.isSafeInteger(input.now) || input.now < 0))
    throw new Error('Invalid Artifact creation time');
  assertEntityId(id, 'id');
  assertEntityId(input.sessionId, 'sessionId');
  assertTurnKey(input.turnId);
  if (input.taskOutputSnapshotOf !== undefined)
    assertEntityId(input.taskOutputSnapshotOf, 'shellRunId');
  return {
    id,
    sessionId: input.sessionId,
    turnId: input.turnId,
    createdAt: input.now ?? Date.now(),
    name: sanitizeArtifactName(input.name),
    kind: input.kind,
    source: input.source,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.deepResearchRole ? { deepResearchRole: input.deepResearchRole } : {}),
  };
}
async function openRealTarget(path: string) {
  return open(
    path,
    fsConstants.O_RDONLY |
      (process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK),
  );
}
async function readPreparedBytes(
  prepared: PreparedArtifactRead,
): Promise<{ readonly ok: true; readonly bytes: Buffer } | ArtifactReadFailure> {
  let handle;
  try {
    handle = await openRealTarget(prepared.path);
    const meta = await handle.stat();
    if (!meta.isFile()) return { ok: false, reason: 'not_found' };
    if (meta.size > prepared.maxBytes) return { ok: false, reason: 'too_large' };
    if (meta.size !== prepared.record.sizeBytes) return { ok: false, reason: 'read_failed' };
    const bytes = Buffer.alloc(meta.size + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = await handle.read(bytes, total, bytes.length - total, total);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    return total === meta.size
      ? { ok: true, bytes: bytes.subarray(0, total) }
      : { ok: false, reason: 'read_failed' };
  } catch {
    return { ok: false, reason: 'read_failed' };
  } finally {
    await handle?.close();
  }
}
async function readPreparedChunk(
  prepared: PreparedArtifactRead,
  offset: number,
  maxBytes: number,
): Promise<ArtifactChunkReadResult> {
  let handle;
  try {
    handle = await openRealTarget(prepared.path);
    const meta = await handle.stat();
    if (!meta.isFile()) return { ok: false, reason: 'not_found' };
    if (meta.size !== prepared.record.sizeBytes) return { ok: false, reason: 'read_failed' };
    if (offset > meta.size) return { ok: false, reason: 'out_of_range' };
    const expected = Math.min(maxBytes, meta.size - offset);
    const bytes = Buffer.alloc(expected);
    let total = 0;
    while (total < expected) {
      const read = await handle.read(bytes, total, expected - total, offset + total);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    if (total !== expected) return { ok: false, reason: 'read_failed' };
    const next = offset + total;
    return {
      ok: true,
      bytes,
      offset,
      totalBytes: meta.size,
      nextOffset: next < meta.size ? next : null,
    };
  } catch {
    return { ok: false, reason: 'read_failed' };
  } finally {
    await handle?.close();
  }
}
function artifactReplayConflict(id: string): Error {
  return new Error(`Artifact ${id} already exists with different metadata or content`);
}
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function assertPageBound(value: number, allowZero: boolean, label: string): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Error(`Artifact page ${label} is invalid`);
}
export async function resolveArtifactPath(input: {
  artifactRoot: string;
  relativePath: string;
}): Promise<
  { ok: true; path: string } | { ok: false; reason: 'not_found' | 'not_allowed' | 'read_failed' }
> {
  if (!isSafeRelativeArtifactPath(input.relativePath)) return { ok: false, reason: 'not_allowed' };
  try {
    const root = await realpath(input.artifactRoot);
    const target = await realpath(join(root, input.relativePath));
    return isInside(root, target)
      ? { ok: true, path: target }
      : { ok: false, reason: 'not_allowed' };
  } catch {
    return { ok: false, reason: 'not_found' };
  }
}
export function sanitizeArtifactName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|\0]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[ .-]+/, '')
    .replace(/[ .-]+$/, '');
  let truncated = cleaned.slice(0, 120);
  const last = truncated.charCodeAt(truncated.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) truncated = truncated.slice(0, -1);
  return truncated.replace(/[ .-]+$/, '') || 'artifact';
}
function assertEntityId(value: string, label: string): void {
  if (!isCanonicalArtifactEntityId(value))
    throw new Error(`Artifact ${label} must be a canonical entity ID`);
}
function assertTurnKey(value: string): void {
  if (!isArtifactTurnKey(value))
    throw new Error('Artifact turnId must be a bounded opaque turn key without control characters');
}
async function ensureRealDirectory(path: string): Promise<string> {
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error('Artifact root must be a real directory');
  await access(path, fsConstants.R_OK);
  return realpath(path);
}
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
function sniffAllowedBinaryMime(bytes: Uint8Array): string | null {
  const sniffed = sniffAttachmentMimeType(bytes);
  if (sniffed) return sniffed;
  const leading = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  return /^<svg[\s>]/i.test(leading) || /^<\?xml[\s\S]*<svg[\s>]/i.test(leading)
    ? 'image/svg+xml'
    : null;
}
