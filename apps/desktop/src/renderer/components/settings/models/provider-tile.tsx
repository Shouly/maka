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

// A provider's mark on a tile, as a connector's logo is drawn in tables and
// headers: a white tile with a half-pixel ring and the mark inset.
// `sm` is the 24px table/header tile, `md` the 36px directory-card tile.

import type { ProviderType } from '@maka/core/llm-connections';
import { cn } from '../../../lib/cn.js';
import { ProviderBrandMark } from '../../../lib/ported/provider-brand-marks.js';

export function ProviderTile(props: { type: ProviderType; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center bg-surface-3 text-text-secondary shadow-[inset_0_0_0_0.5px_var(--alpha-3)]',
        props.size === 'md'
          ? 'size-9 rounded-lg [&>img]:size-5 [&>svg]:size-5'
          : 'size-6 rounded-[6.5px] [&>img]:size-4 [&>svg]:size-4',
      )}
    >
      <ProviderBrandMark type={props.type} />
    </span>
  );
}
