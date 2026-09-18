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

import { useEffect, useRef } from 'react';
import { isTimeDrivenMotionEnabled } from '@maka/ui';
import { cn } from '../../lib/cn.js';
import { WorkingMarkPlayer } from '../../lib/working-mark-player.js';
import type { WorkingMarkActivity } from '../../lib/working-mark-sheets.js';

export function WorkingMark({
  activity = 'default',
  size = 20,
  className,
}: {
  activity?: WorkingMarkActivity;
  size?: number;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const strip = useRef<HTMLSpanElement>(null);
  const player = useRef<WorkingMarkPlayer | null>(null);

  useEffect(() => {
    if (!root.current || !strip.current) return;
    const element = root.current;
    const instance = new WorkingMarkPlayer(strip.current, size);
    player.current = instance;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    const syncMotion = () => {
      instance.setMotionEnabled(!media.matches && isTimeDrivenMotionEnabled(element));
    };
    const syncVisibility = () => instance.setPaused(document.hidden || !visible);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            syncVisibility();
          });
    observer?.observe(element);
    const frozen = new MutationObserver(syncMotion);
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      frozen.observe(ancestor, {
        attributes: true,
        attributeFilter: ['data-maka-e2e-fixture', 'data-maka-reduced-motion'],
      });
    }
    syncMotion();
    syncVisibility();
    media.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      instance.destroy();
      player.current = null;
      observer?.disconnect();
      frozen.disconnect();
      media.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [size]);

  useEffect(() => {
    void player.current?.setActivity(activity);
  }, [activity, size]);

  return (
    <span
      ref={root}
      aria-hidden="true"
      data-maka-working-mark={activity}
      className={cn(
        'group/working relative inline-block shrink-0 overflow-hidden align-middle',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span className="absolute inset-0 m-auto size-[35%] rounded-full bg-fill-brand group-data-[ready=true]/working:hidden" />
      <span ref={strip} className="block" style={{ visibility: 'hidden' }} />
    </span>
  );
}
