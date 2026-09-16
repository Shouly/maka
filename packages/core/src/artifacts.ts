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

export const ARTIFACT_KINDS = ['file', 'diff', 'html', 'image', 'pdf'] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * The scheme the HTML artifact preview is served on.
 *
 * It exists for ONE reason: a document loaded from a local scheme — `srcdoc`,
 * `blob:`, `data:` — inherits the embedder's Content-Security-Policy, and the
 * app's is `script-src 'self'`, which blocks the inline script a single-file
 * artifact is made of. A registered scheme is not a local scheme, so the
 * response's own policy governs, and the preview can run the page without
 * loosening one byte of the app's own policy.
 *
 * The frame is still sandboxed with `allow-scripts` and never
 * `allow-same-origin`: the two together are worth no sandbox at all, since the
 * framed document could reach up and remove the attribute.
 */
export const ARTIFACT_PREVIEW_SCHEME = 'maka-artifact';

/** Both processes build and read this URL through here, never by hand. */
export function artifactPreviewUrl(sessionId: string, artifactId: string): string {
  return `${ARTIFACT_PREVIEW_SCHEME}://preview/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`;
}

export function parseArtifactPreviewUrl(
  url: string,
): { sessionId: string; artifactId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${ARTIFACT_PREVIEW_SCHEME}:`) return null;
  if (parsed.host !== 'preview') return null;
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 2) return null;
  const [sessionId, artifactId] = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return '';
    }
  }) as [string, string];
  if (!sessionId || !artifactId) return null;
  if (!isCanonicalArtifactEntityId(artifactId)) return null;
  return { sessionId, artifactId };
}

/** Maximum encoded image payload admitted to a renderer preview. */
export const ARTIFACT_IMAGE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Maximum PDF admitted to the preview pane.
 *
 * Larger than the image cap because a report with charts passes 2 MB easily and
 * the viewer streams the document rather than holding a decoded bitmap; past
 * this the pane offers the system viewer instead of reading tens of megabytes
 * through the bridge as base64.
 */
export const ARTIFACT_PDF_PREVIEW_MAX_BYTES = 24 * 1024 * 1024;

const ARTIFACT_IMAGE_PREVIEW_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

const ARTIFACT_IMAGE_PREVIEW_MIMES = new Set(
  Object.values(ARTIFACT_IMAGE_PREVIEW_MIME_BY_EXTENSION),
);

export interface ArtifactImagePreviewInput {
  name: string;
  kind: ArtifactKind;
  mimeType?: string;
  sizeBytes?: number;
}

export type ArtifactImagePreviewResolution =
  | { kind: 'image'; reason: 'mime_match' | 'ext_fallback' }
  | {
      kind: 'unsupported';
      reason: 'kind_disallowed' | 'mime_disallowed' | 'no_mime_no_ext' | 'oversize';
    };

/** Normalize the raster MIME admitted to renderer image previews. */
export function normalizeArtifactImagePreviewMime(
  mimeType: string | undefined,
  name?: string,
): string | null {
  if (typeof mimeType === 'string' && mimeType.trim() !== '') {
    const normalized = mimeType.trim().toLowerCase();
    return ARTIFACT_IMAGE_PREVIEW_MIMES.has(normalized) ? normalized : null;
  }
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return ARTIFACT_IMAGE_PREVIEW_MIME_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? null;
}

/**
 * SVG, for the PREVIEW only.
 *
 * It is kept out of `normalizeArtifactImagePreviewMime` on purpose: that one
 * also gates `durable-tool-result-projection`, which decides what becomes a
 * MODEL-facing image part, and no provider accepts `image/svg+xml` — an SVG
 * admitted there would fail on the wire. The renderer draws every preview image
 * in an `<img>`, where an SVG's scripts and external subresources are inert, so
 * the preview can take what the wire cannot.
 */
const ARTIFACT_PREVIEW_SVG_MIME = 'image/svg+xml';

/** Raster mimes plus SVG. Preview surfaces only — never a model-facing shape. */
export function normalizeArtifactPreviewImageMime(mimeType?: string, name?: string): string | null {
  const raster = normalizeArtifactImagePreviewMime(mimeType, name);
  if (raster) return raster;
  if (mimeType) {
    return mimeType.trim().toLowerCase() === ARTIFACT_PREVIEW_SVG_MIME
      ? ARTIFACT_PREVIEW_SVG_MIME
      : null;
  }
  return name?.toLowerCase().endsWith('.svg') ? ARTIFACT_PREVIEW_SVG_MIME : null;
}

/** One metadata policy shared by preview admission and renderer presentation. */
export function resolveArtifactImagePreview(
  input: ArtifactImagePreviewInput,
): ArtifactImagePreviewResolution {
  if (input.kind !== 'image') {
    return { kind: 'unsupported', reason: 'kind_disallowed' };
  }
  if (input.sizeBytes !== undefined && input.sizeBytes > ARTIFACT_IMAGE_PREVIEW_MAX_BYTES) {
    return { kind: 'unsupported', reason: 'oversize' };
  }
  if (input.mimeType) {
    return normalizeArtifactPreviewImageMime(input.mimeType)
      ? { kind: 'image', reason: 'mime_match' }
      : { kind: 'unsupported', reason: 'mime_disallowed' };
  }
  return normalizeArtifactPreviewImageMime(undefined, input.name)
    ? { kind: 'image', reason: 'ext_fallback' }
    : { kind: 'unsupported', reason: 'no_mime_no_ext' };
}

export const ARTIFACT_SOURCES = [
  'tool_result',
  'tool_result_projection',
  'tool_result_archive',
  'subagent_writeback',
  'deep_research',
  'user_upload',
  'user_delivery',
  'session_effect',
] as const;

export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

export const ARTIFACT_ENTITY_ID_MAX_CHARS = 128;
export const ARTIFACT_TURN_KEY_MAX_CHARS = 512;

const ARTIFACT_ENTITY_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${ARTIFACT_ENTITY_ID_MAX_CHARS}}$`);
const ARTIFACT_TURN_KEY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function isCanonicalArtifactEntityId(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ENTITY_ID_PATTERN.test(value);
}

export function isArtifactTurnKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= ARTIFACT_TURN_KEY_MAX_CHARS &&
    !ARTIFACT_TURN_KEY_CONTROL_CHARACTERS.test(value)
  );
}

export interface ArtifactDescriptor {
  id: string;
  sessionId: string;
  /** Opaque, bounded Runtime turn key. It is a reference, not a filesystem path component. */
  turnId: string;
  createdAt: number;
  name: string;
  kind: ArtifactKind;
  sizeBytes: number;
  mimeType?: string;
  source: ArtifactSource;
  summary?: string;
}

export interface ArtifactRecord extends ArtifactDescriptor {
  /**
   * Artifact-root-relative path. Never absolute and never exposed as a
   * filesystem path to renderer code.
   */
  relativePath: string;
  /** Durable role for artifacts owned by a Deep Research workspace. */
  deepResearchRole?: import('./deep-research-run.js').DeepResearchArtifactRole;
}

interface ArtifactSourcePolicy {
  readonly userDeletable: boolean;
  readonly userVisible: boolean;
  readonly sharedReadable: boolean;
}

const ARTIFACT_SOURCE_POLICIES = {
  tool_result: { userDeletable: true, userVisible: false, sharedReadable: true },
  tool_result_projection: { userDeletable: false, userVisible: false, sharedReadable: true },
  tool_result_archive: { userDeletable: false, userVisible: false, sharedReadable: false },
  subagent_writeback: { userDeletable: false, userVisible: true, sharedReadable: false },
  deep_research: { userDeletable: false, userVisible: true, sharedReadable: false },
  user_upload: { userDeletable: true, userVisible: false, sharedReadable: true },
  // A file the model deliberately handed to the user (SendUserFile). It is a
  // deliverable, not evidence: it belongs in the Files face, travels with a
  // shared session, and the user who received it may delete it again.
  user_delivery: { userDeletable: true, userVisible: true, sharedReadable: true },
  session_effect: { userDeletable: false, userVisible: false, sharedReadable: false },
} as const satisfies Record<ArtifactSource, ArtifactSourcePolicy>;

const CHILD_RESULT_OUTPUT_SOURCES = new Set<ArtifactSource>([
  'tool_result',
  'tool_result_projection',
  'subagent_writeback',
  'deep_research',
]);

export function isArtifactUserVisible(
  record: Pick<ArtifactRecord, 'source'> & Partial<Pick<ArtifactRecord, 'kind'>>,
): boolean {
  // A directly written HTML file is an intentional user-facing deliverable:
  // the Artifact Pane must be able to preview and open it without requiring a
  // child-workspace writeback. Other tool results remain internal to avoid
  // flooding the Generated Files tab with command output and diffs.
  if (record.source === 'tool_result' && record.kind === 'html') return true;
  return ARTIFACT_SOURCE_POLICIES[record.source].userVisible;
}

/** Visibility does not grant permission to destroy evidence owned by a runtime workflow. */
export function canUserDeleteArtifact(record: Pick<ArtifactRecord, 'source'>): boolean {
  return ARTIFACT_SOURCE_POLICIES[record.source].userDeletable;
}

export function isArtifactSharedSessionReadable(record: Pick<ArtifactRecord, 'source'>): boolean {
  return ARTIFACT_SOURCE_POLICIES[record.source].sharedReadable;
}

export function isArtifactChildResultOutput(record: Pick<ArtifactRecord, 'source'>): boolean {
  return CHILD_RESULT_OUTPUT_SOURCES.has(record.source);
}

export type ArtifactReadFailureReason = 'not_found' | 'too_large' | 'read_failed' | 'not_allowed';

export type ArtifactBinaryReadFailureReason = ArtifactReadFailureReason | 'unsupported_mime';

export type ArtifactTextReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: ArtifactReadFailureReason };

export type ArtifactBinaryReadResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; reason: ArtifactBinaryReadFailureReason };

export type ArtifactSaveFailureReason =
  | 'canceled'
  | 'not_found'
  | 'not_allowed'
  | 'write_failed'
  | 'deleted'
  | 'source_failed'
  | 'size_mismatch'
  | 'target_write_failed'
  | 'replace_failed';

export type ArtifactSaveResult =
  | { ok: true; saved: string }
  | { ok: false; reason: ArtifactSaveFailureReason };
