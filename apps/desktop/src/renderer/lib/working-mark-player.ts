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

import {
  WORKING_MARK_SHEETS,
  type WorkingMarkActivity,
  type WorkingMarkPhase,
  type WorkingMarkSheet,
} from './working-mark-sheets.js';

const decoded = new Map<string, Promise<void>>();

async function decodeSheet(sheet: WorkingMarkSheet): Promise<void> {
  let promise = decoded.get(sheet.src);
  if (!promise) {
    const image = new Image();
    image.src = sheet.src;
    promise = image.decode().then(() => {
      if (image.naturalHeight !== image.naturalWidth * sheet.frames) {
        throw new Error('Invalid working mark sprite dimensions');
      }
    });
    decoded.set(sheet.src, promise);
    void promise.catch(() => decoded.delete(sheet.src));
  }
  return promise;
}

export async function loadWorkingMark(activity: WorkingMarkActivity): Promise<void> {
  await Promise.all(
    (['in', 'loop', 'out'] as const).map((phase) =>
      decodeSheet(WORKING_MARK_SHEETS[`${activity}.${phase}`]),
    ),
  );
}

/** Plays complete in/loop/out segments; only the latest decoded request may take over. */
export class WorkingMarkPlayer {
  private activity: WorkingMarkActivity = 'default';
  private requested: WorkingMarkActivity = 'default';
  private phase: WorkingMarkPhase = 'in';
  private animation: Animation | undefined;
  private requestRevision = 0;
  private playbackRevision = 0;
  private loaded = false;
  private destroyed = false;
  private motionEnabled = true;
  private paused = false;

  constructor(
    private readonly strip: HTMLSpanElement,
    private readonly size: number,
    private readonly load: (activity: WorkingMarkActivity) => Promise<void> = loadWorkingMark,
  ) {}

  async setActivity(activity: WorkingMarkActivity): Promise<void> {
    const revision = ++this.requestRevision;
    try {
      await this.load(activity);
    } catch {
      // Keep the last decoded sequence, or the initial static fallback.
      return;
    }
    if (this.destroyed || revision !== this.requestRevision) return;
    this.requested = activity;
    if (!this.loaded || !this.shouldAnimate) {
      this.loaded = true;
      this.restart();
    }
  }

  setMotionEnabled(enabled: boolean): void {
    if (this.motionEnabled === enabled) return;
    this.motionEnabled = enabled;
    this.restart();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.animation) return;
    if (paused) this.animation.pause();
    else if (this.animation.playState === 'paused') this.animation.play();
  }

  private get shouldAnimate(): boolean {
    return this.motionEnabled && typeof this.strip.animate === 'function';
  }

  private display(sheet: WorkingMarkSheet, frame = 0): void {
    Object.assign(this.strip.style, {
      width: `${this.size}px`,
      height: `${this.size * sheet.frames}px`,
      backgroundImage: `url("${sheet.src}")`,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      transform: `translateY(${-frame * this.size}px)`,
      visibility: 'visible',
    });
    this.strip.dataset.activity = this.activity;
    this.strip.dataset.phase = this.phase;
    if (this.strip.parentElement) this.strip.parentElement.dataset.ready = 'true';
  }

  private restart(): void {
    const revision = ++this.playbackRevision;
    this.animation?.cancel();
    this.animation = undefined;
    if (this.destroyed || !this.loaded) return;
    this.activity = this.requested;
    if (!this.shouldAnimate) {
      this.phase = 'loop';
      const sheet = WORKING_MARK_SHEETS[`${this.activity}.loop`];
      this.display(sheet, sheet.rest ?? 0);
      return;
    }
    this.phase = 'in';
    this.playStage(revision);
  }

  private playStage(revision: number): void {
    if (this.destroyed || revision !== this.playbackRevision) return;
    const sheet = WORKING_MARK_SHEETS[`${this.activity}.${this.phase}`];
    this.display(sheet);
    const animation = this.strip.animate(
      Array.from({ length: sheet.frames }, (_, frame) => ({
        transform: `translateY(${-frame * this.size}px)`,
      })),
      {
        duration: sheet.frames * sheet.frameMs,
        iterations: 1,
        easing: `steps(${sheet.frames}, jump-none)`,
        fill: 'forwards',
      },
    );
    this.animation = animation;
    if (this.paused) animation.pause();
    void animation.finished
      .then(() => {
        if (this.destroyed || revision !== this.playbackRevision) return;
        animation.cancel();
        if (this.phase === 'out') {
          this.activity = this.requested;
          this.phase = 'in';
        } else if (this.requested !== this.activity) {
          this.phase = 'out';
        } else {
          this.phase = 'loop';
        }
        this.playStage(revision);
      })
      .catch(() => {
        // Cancelling an Animation rejects finished; the newer revision owns it.
      });
  }

  destroy(): void {
    this.destroyed = true;
    this.requestRevision++;
    this.playbackRevision++;
    this.animation?.cancel();
    this.animation = undefined;
  }
}
