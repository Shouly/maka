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

// The host platform, as a document attribute the stylesheet can read.
//
// The titlebar gutters depend on where the OS paints its window controls:
// macOS puts the traffic lights top-left (`titleBarStyle: hiddenInset`),
// Windows puts caption buttons top-right (`titleBarOverlay`), Linux paints
// neither. `env(titlebar-area-*)` reports that on Windows; on macOS the
// stylesheet needs a floor that clears the traffic lights, which is what
// `html[data-maka-platform="darwin"]` selects.

export type MakaPlatform = 'darwin' | 'win32' | 'linux';

export function detectPlatform(platform: string = globalThis.navigator?.platform ?? ''): MakaPlatform {
  if (/mac|iphone|ipad|ipod/i.test(platform)) return 'darwin';
  if (/win/i.test(platform)) return 'win32';
  return 'linux';
}

export function applyPlatformAttribute(root: HTMLElement = document.documentElement): MakaPlatform {
  const platform = detectPlatform();
  root.setAttribute('data-maka-platform', platform);
  return platform;
}
