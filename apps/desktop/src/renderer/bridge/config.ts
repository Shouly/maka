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

// The `config` namespace of the preload bridge, wrapped.
//
// Settings › Data: export/import of the categories the user chooses. Both open
// a native file dialog in main, so `cancelled` is a value, not an error.

import type { ConfigCategory } from '@maka/storage/config-transfer';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

type Config = MakaBridge['config'];

export type ConfigExportResult = Awaited<ReturnType<Config['export']>>;
export type ConfigImportResult = Awaited<ReturnType<Config['import']>>;
export type { ConfigCategory };

export function exportConfig(
  input: { categories: ConfigCategory[] },
  host?: DesktopRuntimeHostRef,
): Promise<ConfigExportResult> {
  return requireNamespace('config').export(input, host);
}

export function importConfig(
  input: { strategy: 'skip' | 'overwrite' },
  host?: DesktopRuntimeHostRef,
): Promise<ConfigImportResult> {
  return requireNamespace('config').import(input, host);
}
