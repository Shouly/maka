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

// Row enter/exit for the task list. Ported verbatim from the reference design
// system's `sidebar-row-motion.ts`.
//
// Spread as props onto the row's root `motion.div`. What `AnimatePresence
// mode="popLayout"` actually needs of its direct child is a key and a `ref`
// that reaches the root DOM node (it measures the node to pop it out of the
// flow on exit); the exit animation itself may live on any motion element
// inside. So a row component is a fine direct child as long as it forwards
// `ref` to this element — see `SessionRow` and `ProjectRow`.

import type { MotionProps } from 'motion/react';

export const sidebarRowFadeProps: MotionProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: 'easeIn' } },
};
