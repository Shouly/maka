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

// A select that sits in the composer's control row as a meta chip (relx
// `COMPOSER_META_CHIP`): 24px tall, no field surface, caret on the right.
// The empty value is a real option ("default"), so it is mapped to a
// sentinel because Radix Select reserves the empty string for "no value".

import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select.js';
import { COMPOSER_META_CHIP, COMPOSER_META_CHIP_IDLE } from '../../lib/composer-surface.js';
import { cn } from '../../lib/cn.js';

const DEFAULT_SENTINEL = '__default__';

export function ComposerSelect(props: {
  label: string;
  value: string;
  disabled?: boolean;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={props.value || DEFAULT_SENTINEL}
      onValueChange={(value) => props.onChange(value === DEFAULT_SENTINEL ? '' : value)}
      disabled={props.disabled}
    >
      <SelectTrigger
        aria-label={props.label}
        className={cn(
          COMPOSER_META_CHIP,
          COMPOSER_META_CHIP_IDLE,
          'h-6 w-auto max-w-40 shadow-none hover:shadow-none data-[state=open]:shadow-none',
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option.value || DEFAULT_SENTINEL} value={option.value || DEFAULT_SENTINEL}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
