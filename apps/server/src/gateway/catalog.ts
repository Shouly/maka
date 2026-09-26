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

// Which models people may use (design §5.1): every enabled model, for
// everyone signed in; phase 2 layers organization policy on top.

import type { Selectable } from 'kysely';
import type { GatewayProtocol, PlatformModel } from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import type { ModelsTable } from '../db/schema.js';

export type ModelRow = Selectable<ModelsTable>;

export async function visibleModels(ctx: ServerContext): Promise<ModelRow[]> {
  return ctx.db
    .selectFrom('models')
    .selectAll()
    .where('enabled', '=', true)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
}

export async function modelForRequest(
  ctx: ServerContext,
  protocol: GatewayProtocol,
  modelId: string,
): Promise<ModelRow | undefined> {
  const visible = await visibleModels(ctx);
  return visible.find((model) => model.id === modelId && model.protocol === protocol);
}

const numberField = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const stringList = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;

export function toPlatformModel(row: ModelRow): PlatformModel {
  const capabilities = row.capabilities as Record<string, unknown>;
  const contextWindow = numberField(capabilities.contextWindow);
  const maxOutputTokens = numberField(capabilities.maxOutputTokens);
  const thinkingLevels = stringList(capabilities.thinkingLevels);
  const inputModalities = stringList(capabilities.inputModalities);
  return {
    id: row.id,
    protocol: row.protocol,
    displayName: row.display_name,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(thinkingLevels ? { thinkingLevels } : {}),
    ...(typeof capabilities.defaultThinkingLevel === 'string'
      ? { defaultThinkingLevel: capabilities.defaultThinkingLevel }
      : {}),
    ...(inputModalities ? { inputModalities } : {}),
    ...(typeof capabilities.supportsTools === 'boolean'
      ? { supportsTools: capabilities.supportsTools }
      : {}),
    ...(typeof capabilities.referenceModelId === 'string'
      ? { referenceModelId: capabilities.referenceModelId }
      : {}),
  };
}
