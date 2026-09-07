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

import { cn } from '../../lib/cn'
import { listToolbarButtonClass } from './list-toolbar'
import { Anthropicon } from '../icons/Anthropicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

export interface SortOption<T extends string = string> {
  value: T
  label: string
  shortLabel?: string
}

interface SortSelectProps<T extends string = string> {
  options: SortOption<T>[]
  value: T
  onChange: (value: T) => void
  label?: string
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function SortSelect<T extends string = string>({
  options,
  value,
  onChange,
  label = 'Sort by',
  align = 'end',
  className,
}: SortSelectProps<T>) {
  const currentOption = options.find(opt => opt.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${currentOption?.label ?? ''}`}
          className={cn(
            listToolbarButtonClass,
            'flex items-center gap-1.5',
            className
          )}
        >
          {label && <span className="hidden text-text-muted sm:inline">{label}</span>}
          {currentOption?.shortLabel || currentOption?.label}
          <Anthropicon name="caretDown" size={16} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onChange(nextValue as T)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
