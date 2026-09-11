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

// The `skills` namespace of the preload bridge, wrapped.

import type { InvocableSkillEntry } from '@maka/runtime/skill-invocation';
import type {
  BundledSkillCatalogEntry,
  ManagedSkillSourceEntry,
  ManagedSkillUpdatePreview,
  SkillEntry,
} from '@maka/ui';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

type Skills = MakaBridge['skills'];

export type {
  SkillEntry,
  BundledSkillCatalogEntry,
  ManagedSkillSourceEntry,
  ManagedSkillUpdatePreview,
  InvocableSkillEntry,
};
export type SkillInvocableContext = NonNullable<Parameters<Skills['listInvocable']>[1]>;

const skills = (): Skills => requireNamespace('skills');

export function listSkills(host?: DesktopRuntimeHostRef): Promise<SkillEntry[]> {
  return skills().list(host);
}

export function listInvocableSkills(
  sessionId?: string,
  newSessionContext?: SkillInvocableContext,
): Promise<InvocableSkillEntry[]> {
  return skills().listInvocable(sessionId, newSessionContext);
}

export function listSkillCatalog(
  host?: DesktopRuntimeHostRef,
): Promise<BundledSkillCatalogEntry[]> {
  return skills().catalog.list(host);
}

export function installCatalogSkill(
  id: string,
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['catalog']['install']> {
  return skills().catalog.install(id, host);
}

export function listSkillSources(host?: DesktopRuntimeHostRef): Promise<ManagedSkillSourceEntry[]> {
  return skills().sources.list(host);
}

/**
 * Add a Skill file on this machine to the source library.
 *
 * Main owns the file picker, so this takes no file: the renderer cannot hand
 * a `File` across the bridge, and a drop zone here would only be able to read
 * bytes it then had no way to write. `cancelled` is one of the closed reasons
 * rather than a rejection — pressing Escape in a native dialog is an answer.
 */
export function importLocalSkillFile(
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['sources']['importLocalFile']> {
  return skills().sources.importLocalFile(host);
}

/** Install a source-library entry into the current workspace. */
export function installManagedSkill(
  sourceId: string,
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['installManaged']> {
  return skills().installManaged(sourceId, host);
}

/**
 * What a managed skill's update would change, before anything is written.
 *
 * Read-only: the preview carries the two contents and the SHA-256 of each, and
 * `updateManagedSkill` is given those digests back so a source that changed
 * between the review and the apply fails instead of writing a version nobody
 * read. The failures are VALUES here too — `read_failed` is the one reason
 * that exists on this call and nowhere else in the namespace.
 */
export function previewManagedSkillUpdate(
  skillId: string,
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['previewUpdate']> {
  return skills().previewUpdate(skillId, host);
}

/**
 * Apply the reviewed update.
 *
 * `force` is the user's answer to the one question the preview asks: the
 * workspace copy has local changes, and continuing overwrites them. Without
 * it a locally modified skill answers `local_modified` and writes nothing.
 */
export function updateManagedSkill(
  skillId: string,
  options?: { force?: boolean; expectedCurrentSha256?: string; expectedSourceSha256?: string },
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['updateManaged']> {
  return skills().updateManaged(skillId, options, host);
}

export function setSkillEnabled(
  skillId: string,
  enabled: boolean,
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['setEnabled']> {
  return skills().setEnabled(skillId, enabled, host);
}

export function deleteSkill(
  idOrRef: string,
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['delete']> {
  return skills().delete(idOrRef, host);
}

export function openSkill(
  id: string,
  target?: 'file' | 'directory',
  host?: DesktopRuntimeHostRef,
): ReturnType<Skills['open']> {
  return skills().open(id, target, host);
}
