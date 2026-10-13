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

import { parseAttachmentResourceRef } from './attachments.js';
import { isShellRunId } from './shell-run.js';
import type { StorageRef, ToolResultContent } from './events.js';

const TASK_OUTPUT_PREFIX = 'maka://runtime/task-outputs/';

/** A mutable Session-scoped output view. A branch freezes its own view to a file snapshot. */
export function taskOutputResourceRef(shellRunId: string): string {
  if (!isShellRunId(shellRunId)) throw new Error('Invalid task output identity');
  return `${TASK_OUTPUT_PREFIX}${shellRunId}`;
}

export function parseTaskOutputResourceRef(ref: string): { shellRunId: string } | null {
  if (!ref.startsWith(TASK_OUTPUT_PREFIX)) return null;
  const shellRunId = ref.slice(TASK_OUTPUT_PREFIX.length);
  return isShellRunId(shellRunId) ? { shellRunId } : null;
}

/** The single inventory of structured file dependencies; never scrape model-visible text. */
export function toolResultStorageRefs(
  content: ToolResultContent,
  sessionId: string,
): readonly StorageRef[] {
  const file = (id: string): StorageRef => ({
    kind: 'session_file',
    sessionId,
    relativePath: id,
  });
  switch (content.kind) {
    case 'image':
      return [content.ref];
    case 'terminal': {
      const saved = content.savedOutput && parseAttachmentResourceRef(content.savedOutput.ref);
      return saved ? [file(saved.artifactId)] : [];
    }
    case 'text':
    case 'json':
      return (content.fileRefs ?? []).map((ref) => {
        const parsed = parseAttachmentResourceRef(ref);
        if (!parsed) throw new Error('Invalid saved file dependency');
        return file(parsed.artifactId);
      });
    case 'user_file_delivery':
      return content.files.map((item) => file(item.artifactId));
    // Hand-back commits ownership to the receipt holder before publication.
    // The child identity is provenance/control metadata, not a file read grant.
    case 'subagent':
      return content.artifactIds.map(file);
    case 'agent_swarm':
      return content.items.flatMap((item) => item.artifactIds.map(file));
    default:
      return [];
  }
}
