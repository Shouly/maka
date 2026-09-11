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

// The Customize page is one sidebar entry with two faces, Skills and
// Connectors (Claude's word for MCP servers; the internal key stays `mcp`,
// and "Plugins" already means something in the runtime). The faces are the existing module pages; this strip is what
// makes them one page. Selection is the same navigation call the sidebar row
// makes, so the row's active state, the module memory and the palette all
// agree. Internal keys (`section: 'extensions'`) are unchanged; only the
// label moved to "Customize" (owner decision 2026-09-11, after Claude's page).

import { useUiLocale } from '@maka/ui';
import { ListTabs } from '../ui/list-page.js';
import { getModulesCopy } from '../../locales/modules-copy.js';

export type ExtensionsFace = 'skills' | 'mcp';

export function ExtensionsTabs(props: {
  current: ExtensionsFace;
  onSelect: (face: ExtensionsFace) => void;
}) {
  const copy = getModulesCopy(useUiLocale()).extensions;
  return (
    <ListTabs<ExtensionsFace>
      label={copy.tabsLabel}
      value={props.current}
      onChange={props.onSelect}
      options={[
        { value: 'skills', label: copy.skills },
        { value: 'mcp', label: copy.mcp },
      ]}
    />
  );
}

export type ExtensionsView = 'yours' | 'discover';

/** Yours | Discover — what is installed, and what could be. */
export function ExtensionsViewTabs(props: {
  current: ExtensionsView;
  onSelect: (view: ExtensionsView) => void;
}) {
  const copy = getModulesCopy(useUiLocale()).extensions;
  return (
    <ListTabs<ExtensionsView>
      label={copy.viewLabel}
      value={props.current}
      onChange={props.onSelect}
      options={[
        { value: 'yours', label: copy.yours },
        { value: 'discover', label: copy.discover },
      ]}
    />
  );
}
