<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# Frontend CSS governance — enterprise renderer

The current design authority is [globals.css](../apps/desktop/src/renderer/styles/globals.css),
with shared primitives in `components/ui/`. The previous Astryx-specific contracts, two-size
text rule and Storybook workflow have been retired for the enterprise branch.

- Use semantic token utilities; place any new colour in the token file. The architecture gate
  rejects arbitrary colour values in feature components and inline styles.
- Reuse the existing Radix primitives and class variants for menus, dialogs, controls and rows.
  Keep layout in the owning component; add global CSS only for shared behavior or native seams.
- Keep `.dark` and automatic theme behavior consistent. Test both themes and reduced motion.
- All icon-only actions need localized accessible names and visible keyboard focus. Use the
  Electron AX audit for controls crossing native or preload boundaries.
- Preserve titlebar drag/no-drag boundaries, modal layering, native browser viewport hiding,
  and the bounded transcript's scrolling authority. Avoid `transition-all` on long lists.
- Biome now formats the enterprise renderer. Run `npm run format:check` as well as lint,
  renderer architecture, locale hygiene and `git diff --check`.

For a UI change, record affected surfaces, light/dark screenshots where appearance changed,
and the relevant test result. Pure state decisions belong in renderer state tests; IPC,
restart persistence, native input and PTY lifecycle belong in the budgeted Electron E2E suite.
Storybook is not installed in this branch.

Generated `renderer-architecture.json` and third-party notices must be regenerated through
their scripts. Native overlay/browser-dialog styles retain separate consumers; do not delete
them merely because the React renderer does not import them.

See the [rewrite plan](enterprise/frontend-rewrite-plan.md) and
[release checklist](enterprise/release-checklist.md) for scope and deferred work.
