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

# Enterprise desktop design

The renderer's design authority is [`globals.css`](apps/desktop/src/renderer/styles/globals.css).
It defines the light/dark palette, font families, semantic Tailwind utilities, focus treatment,
spacing helpers and motion. Reuse the primitives in `apps/desktop/src/renderer/components/ui/`.
The previous Astryx palette and typography contracts do not apply to this renderer.

Use semantic colours (`text-text-primary`, `bg-surface-1`, `border-hairline`); colour literals
belong in the token file, not in feature components. Main's browser message box is served the
same authority: `scripts/build-cursor-overlay.mjs` slices `globals.css`'s custom-property blocks
into `dist/overlay/browser-dialog-design-tokens.css`, so that card moves with the palette. The
cursor and permission overlays still carry colours of their own.

Desktop geometry and scope decisions are in the [rewrite plan](docs/enterprise/frontend-rewrite-plan.md).
The window titlebar is 48px in the implemented shell; preserve the single drag strip, OS control
gutters, and `maka-no-drag` on actionable elements. Settings replaces the content column only.
The sidebar contains menu actions, project disclosures and the twenty most recent tasks.

Every actionable control needs an accessible name, visible keyboard focus, and localized copy.
Animations must respect reduced motion. Validate changes with the [CSS governance guide](docs/frontend-css-governance.md).
Font replacement before external distribution remains on the [release checklist](docs/enterprise/release-checklist.md).
