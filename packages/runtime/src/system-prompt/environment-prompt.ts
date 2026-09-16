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
 * The environment block: what is true about this session's machine and
 * workspace that the model would otherwise have to discover with tools. It is
 * session-level — nothing here changes between turns — so it belongs to the
 * cached system prompt, after the static layer. Anything that changes per turn
 * (the date, the serving model, the permission mode) is delivered with the
 * turn instead, so this block never churns the provider prefix.
 */

export interface EnvironmentPromptInput {
  readonly cwd: string;
  /** `process.platform` of the machine the tools run on. */
  readonly platform: NodeJS.Platform | string;
  /** The shell Bash commands run in, when the host resolved one. */
  readonly shell?: string;
  readonly gitRepository: boolean;
  /** The checked-out branch, when the workspace is a git repository. */
  readonly branch?: string;
  /** IANA zone of the machine the tools run on. */
  readonly timeZone?: string;
  /** The user's interface locale (BCP 47), when the host knows it. */
  readonly locale?: string;
  /** The operating system's temporary directory, for scratch files. */
  readonly tmpDir?: string;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

export function renderEnvironmentPromptFragment(input: EnvironmentPromptInput): string {
  const lines = [
    `Primary working directory: ${input.cwd}`,
    `Is a git repository: ${input.gitRepository ? (input.branch ? `yes (branch ${input.branch})` : 'yes') : 'no'}`,
    `Platform: ${PLATFORM_LABELS[input.platform] ?? input.platform}`,
  ];
  if (input.shell) lines.push(`Shell: ${input.shell}`);
  if (input.tmpDir) lines.push(`Temporary directory for scratch files: ${input.tmpDir}`);
  if (input.timeZone) lines.push(`Time zone: ${input.timeZone}`);
  if (input.locale) lines.push(`User interface language: ${input.locale}`);
  return ['<env>', ...lines, '</env>'].join('\n');
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
