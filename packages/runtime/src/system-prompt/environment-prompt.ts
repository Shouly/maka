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

/**
 * The environment block, the design's `# Environment`: what is true about
 * this session's machine, workspace and model that the model would otherwise
 * have to discover with tools. It is delivered into the conversation after
 * the user's text, ahead of the held tools, and recorded again only when any
 * of it changes — another folder, another model.
 */

import { formatUtcOffset, resolveZone } from '../injection/user-message-injections.js';
import { formatKnowledgeCutoff } from './knowledge-cutoff-prompt.js';

export interface EnvironmentContextInput {
  readonly cwd: string;
  readonly gitRepository: boolean;
  /** `process.platform` of the machine the tools run on. */
  readonly platform: NodeJS.Platform | string;
  /** The shell Bash commands run in, when the host resolved one. */
  readonly shell?: string;
  /** Kernel name and release, e.g. `Darwin 25.0.0`. */
  readonly osVersion?: string;
  /** The operating system's temporary directory, for scratch files. */
  readonly tmpDir?: string;
  /** IANA zone of the machine the tools run on. */
  readonly timeZone?: string;
  /** The moment the zone's offset is read at; now when absent. */
  readonly now?: Date;
  /** The serving model, as the connection names it. */
  readonly model?: { readonly id: string; readonly displayName?: string };
  /** The serving model's reliable knowledge cutoff (`YYYY-MM` or `YYYY-MM-DD`). */
  readonly knowledgeCutoff?: string;
}

export function renderEnvironmentContext(input: EnvironmentContextInput): string {
  const now = input.now ?? new Date();
  const zone = input.timeZone ? resolveZone(input.timeZone, now) : undefined;
  const lines = [
    '# Environment',
    'You have been invoked in the following environment:',
    ` - Primary working directory: ${input.cwd}`,
    ` - Is a git repository: ${input.gitRepository}`,
    ` - Platform: ${input.platform}`,
    ` - Shell: ${input.shell ?? 'unknown'}`,
    ...(input.osVersion ? [` - OS Version: ${input.osVersion}`] : []),
    ...(input.tmpDir ? [` - Temporary directory for scratch files: ${input.tmpDir}`] : []),
    ...(zone ? [` - Time zone: ${zone} (${formatUtcOffset(now, zone)})`] : []),
  ];
  const model = renderModelLine(input.model, input.knowledgeCutoff);
  return model ? [...lines, '', model].join('\n') : lines.join('\n');
}

function renderModelLine(
  model: EnvironmentContextInput['model'],
  cutoff: string | undefined,
): string | undefined {
  const sentences: string[] = [];
  if (model) {
    const name = model.displayName?.trim();
    sentences.push(
      name && name !== model.id
        ? `You are powered by the model named ${name}. The exact model ID is ${model.id}.`
        : `You are powered by the model ${model.id}.`,
    );
  }
  if (cutoff?.trim()) {
    sentences.push(`Assistant knowledge cutoff is ${formatKnowledgeCutoff(cutoff)}.`);
  }
  return sentences.length > 0 ? sentences.join(' ') : undefined;
}

/** The host machine's IANA zone, or undefined when the runtime cannot say. */
export function hostTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone !== 'UTC' ? zone : zone || undefined;
  } catch {
    return undefined;
  }
}
