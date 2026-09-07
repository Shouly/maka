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

import { setTitlebarModalDimmed } from '../theme.js';

const MODAL_SELECTOR = 'dialog:modal, [data-app-dialog-overlay][data-state="open"]';
const MODAL_NODE_SELECTOR = 'dialog, [data-app-dialog-overlay]';

function subtreeTouchesModal(nodes: NodeList): boolean {
  return Array.from(nodes).some(
    (node) =>
      node instanceof HTMLElement &&
      (node.matches(MODAL_NODE_SELECTOR) || node.querySelector(MODAL_NODE_SELECTOR) !== null),
  );
}

/** Radix overlays exist only for modal Dialogs; Popovers and nonmodal Dialogs do not dim chrome. */
export function startTitlebarModalSync(): () => void {
  const sync = () => setTitlebarModalDimmed(document.querySelector(MODAL_SELECTOR) !== null);
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some((mutation) =>
        mutation.type === 'attributes'
          ? (mutation.target as HTMLElement).matches(MODAL_NODE_SELECTOR)
          : subtreeTouchesModal(mutation.addedNodes) || subtreeTouchesModal(mutation.removedNodes),
      )
    )
      sync();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'data-state'],
  });
  sync();
  return () => {
    observer.disconnect();
    setTitlebarModalDimmed(false);
  };
}
