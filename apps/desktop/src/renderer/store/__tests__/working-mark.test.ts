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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkingMarkPlayer } from '../../lib/working-mark-player.js';
import type { WorkingMarkActivity } from '../../lib/working-mark-sheets.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const animations: ReturnType<typeof makeAnimation>[] = [];
  function makeAnimation() {
    const completion = deferred();
    return {
      finished: completion.promise,
      playState: 'running',
      cancelled: false,
      finish() {
        this.playState = 'finished';
        completion.resolve();
      },
      pause() {
        this.playState = 'paused';
      },
      play() {
        this.playState = 'running';
      },
      cancel() {
        this.cancelled = true;
        this.playState = 'idle';
        completion.reject(new Error('cancelled'));
      },
    };
  }
  const strip = {
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    parentElement: { dataset: {} as Record<string, string> },
    animate() {
      const animation = makeAnimation();
      animations.push(animation);
      return animation;
    },
  };
  return {
    strip,
    animations,
    player(load: (activity: WorkingMarkActivity) => Promise<void> = async () => {}) {
      return new WorkingMarkPlayer(strip as unknown as HTMLSpanElement, 20, load);
    },
    async finish() {
      animations.at(-1)!.finish();
      await Promise.resolve();
    },
  };
}

test('late image decoding cannot replace a newer activity; transitions finish before changing strips', async () => {
  const f = fixture();
  const thinking = deferred(),
    coding = deferred();
  const player = f.player((activity) =>
    activity === 'think'
      ? thinking.promise
      : activity === 'code'
        ? coding.promise
        : Promise.resolve(),
  );
  await player.setActivity('default');
  const first = player.setActivity('think');
  const latest = player.setActivity('code');
  coding.resolve();
  await latest;
  thinking.resolve();
  await first;
  assert.equal(f.strip.dataset.activity, 'default');
  await f.finish();
  assert.equal(f.strip.dataset.phase, 'out');
  await f.finish();
  assert.equal(f.strip.dataset.activity, 'code');
  assert.equal(f.strip.dataset.phase, 'in');
  player.destroy();
});

test('frozen motion selects a static frame and cancellation prevents a finished segment restarting playback', async () => {
  const f = fixture();
  const player = f.player();
  player.setMotionEnabled(false);
  await player.setActivity('code');
  assert.equal(f.animations.length, 0);
  assert.equal(f.strip.style.transform, 'translateY(-1480px)');
  player.setMotionEnabled(true);
  player.setPaused(true);
  assert.equal(f.animations.at(-1)?.playState, 'paused');
  player.setPaused(false);
  assert.equal(f.animations.at(-1)?.playState, 'running');
  f.animations.at(-1)!.finish();
  player.setMotionEnabled(false);
  await Promise.resolve();
  assert.equal(f.animations.length, 1, 'the cancelled generation cannot append its next segment');
  assert.equal(f.animations[0]?.cancelled, true);
  player.destroy();
});

test('unmount fences pending image loads and releases the animation', async () => {
  const f = fixture();
  const load = deferred();
  const player = f.player(() => load.promise);
  const pending = player.setActivity('read');
  player.destroy();
  load.resolve();
  await pending;
  assert.deepEqual(f.strip.style, {});
  assert.equal(f.animations.length, 0);
});

test('an image failure preserves the current icon and a later request can recover', async () => {
  const f = fixture();
  let fail = true;
  const player = f.player(async (activity) => {
    if (activity === 'search' && fail) throw new Error('decode');
  });
  player.setMotionEnabled(false);
  await player.setActivity('default');
  const previous = f.strip.style.backgroundImage;
  await player.setActivity('search');
  assert.equal(f.strip.style.backgroundImage, previous);
  fail = false;
  await player.setActivity('search');
  assert.equal(f.strip.dataset.activity, 'search');
  assert.equal(f.animations.length, 0);
  player.destroy();
});
