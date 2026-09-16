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

import { SETTINGS_SECTIONS, type SettingsSection } from '@maka/core/settings';

const ALLOWED_SETTINGS_SECTIONS = new Set<SettingsSection>(SETTINGS_SECTIONS);
const RAW_HREF_MAX_LENGTH = 4096;
const COMPOSE_TEXT_MAX_LENGTH = 4096;
const FILE_PATH_MAX_LENGTH = 1024;
const COMPUTER_URI_PREFIX = 'computer://';

/** Closed internal navigation surface; it never executes actions. */
export type MakaUriDest =
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'compose'; text: string };

/**
 * Parse an exact lowercase internal URI. Unsupported namespaces and malformed
 * inputs return null; callers must never pass them to external navigation.
 */
export function parseMakaUri(href: string): MakaUriDest | null {
  if (typeof href !== 'string') return null;
  if (href.length === 0 || href.length > RAW_HREF_MAX_LENGTH) return null;
  if (!href.startsWith('maka:')) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'maka:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  if (url.hash !== '') return null;

  switch (url.hostname) {
    case 'settings': {
      if (url.search !== '') return null;
      const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
      if (segments.length !== 1) return null;
      const section = segments[0]!;
      if (!isSettingsSection(section)) return null;
      return { kind: 'settings', section };
    }
    case 'compose': {
      if (url.pathname !== '' && url.pathname !== '/') return null;
      const text = url.searchParams.get('text');
      if (text === null || text.length === 0 || text.length > COMPOSE_TEXT_MAX_LENGTH) return null;
      return { kind: 'compose', text };
    }
    default:
      return null;
  }
}

/**
 * A `computer://` link's path, or null.
 *
 * The reference defines this scheme for exactly this job — citing a file that
 * lives on the person's own machine so the interface renders it as a local-file
 * reference rather than dead text. It needs the scheme because it runs in the
 * cloud and reaches the machine over a bridge; Maka is already on the machine,
 * and keeps the spelling so the citation rule reads the same on both.
 *
 * The path is workspace-relative and validated against the RAW text, not a
 * parsed URL: `new URL` resolves `..` and collapses `//` before anything here
 * runs, so checking its output would approve a traversal by silently
 * rewriting it — `computer://../../etc/passwd` would arrive looking clean. A
 * link that was not already canonical is refused rather than repaired into a
 * different file than it named.
 *
 * What survives is resolved by the viewer against the session's own file list,
 * so a path that session never touched opens nothing.
 */
export function parseComputerFileUri(href: string): string | null {
  if (typeof href !== 'string') return null;
  if (href.length === 0 || href.length > FILE_PATH_MAX_LENGTH) return null;
  if (!href.startsWith(COMPUTER_URI_PREFIX)) return null;
  const raw = href.slice(COMPUTER_URI_PREFIX.length);
  if (raw.includes('?') || raw.includes('#')) return null;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (path.length === 0) return null;
  // Workspace-relative only: no root, no drive letter.
  if (path.startsWith('/') || /^[a-zA-Z]:/u.test(path)) return null;
  // One leading `./` is stripped rather than refused: it is how people write a
  // relative path, and unlike `..` it cannot change WHICH file is named.
  if (path.startsWith('./')) path = path.slice(2);
  if (path.length === 0) return null;
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  // A control character never belongs in a path, and is how a display string
  // gets truncated somewhere downstream.
  if (/[\u0000-\u001f\u007f]/u.test(path)) return null;
  return path;
}

/**
 * Case-insensitive probe used to keep internal-looking links out of the
 * external navigation path. Parsing remains lowercase-only.
 */
export function isMakaUriCandidate(href: string): boolean {
  return typeof href === 'string' && /^maka:/i.test(href);
}

/** External links are restricted to browser and mail destinations. */
export function isSafeExternalScheme(href: string): boolean {
  if (typeof href !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
}

function isSettingsSection(value: string): value is SettingsSection {
  return ALLOWED_SETTINGS_SECTIONS.has(value as SettingsSection);
}
