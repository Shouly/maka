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

// What every page reads: the reader's language and the signed-in
// administrator.

import { createContext, useContext } from 'react';
import type { ConsoleSession } from '../../src/admin-console/types.js';
import type { ConsoleCopy, ConsoleLocale } from './copy.js';

export interface ConsoleContextValue {
  readonly locale: ConsoleLocale;
  readonly copy: ConsoleCopy;
  readonly session: ConsoleSession;
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function useConsole(): ConsoleContextValue {
  const value = useContext(ConsoleContext);
  if (!value) throw new Error('useConsole must be used inside the console');
  return value;
}
