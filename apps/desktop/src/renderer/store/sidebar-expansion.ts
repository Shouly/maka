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

export const SIDEBAR_EXPANSION_KEY = 'maka-sidebar-expansion-v1';
export type SidebarExpansion = Readonly<Record<string, boolean>>;
export interface SidebarSelectionLocation {
  section: 'projects' | 'pinned' | 'recents';
  projectKey?: string;
}

export function parseSidebarExpansion(raw: string | null): SidebarExpansion {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, expanded]) =>
          typeof expanded === 'boolean' &&
          (['section:projects', 'section:pinned', 'section:recents'].includes(key) ||
            (key.startsWith('project:') && key.length > 8)),
      ),
    );
  } catch {
    return {};
  }
}

export function revealSidebarSelection(
  current: SidebarExpansion,
  location: SidebarSelectionLocation,
  preserveSaved: boolean,
): SidebarExpansion {
  const keys = [
    `section:${location.section}`,
    ...(location.projectKey ? [location.projectKey] : []),
  ];
  const changes = keys.filter(
    (key) => !current[key] && !(preserveSaved && current[key] !== undefined),
  );
  if (changes.length === 0) return current;
  return { ...current, ...Object.fromEntries(changes.map((key) => [key, true])) };
}
