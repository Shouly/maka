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

// Nothing at this address. The figure is "4 0 4" in the display serif with
// the zero drawn as the brand's eight-petal mark — the ring it already is —
// turning slowly, as the mark does while Maka works (and not at all for
// someone who asked the system for less motion). Under it the serif title,
// one grey line, the address that was asked for, and the way back.
//
// Two sizes: the whole window, for an address the server does not have, and
// the console's content area, for a page or a member or model that is not
// there while the console's own navigation stays in reach.

import { Button } from '@desktop/components/ui/button.js';
import { cn } from '@desktop/lib/cn.js';
import brandSymbol from '../../../../desktop/assets/brand/relx-symbol.svg?url';
import type { ConsoleCopy } from '../copy.js';

const DISPLAY = "font-display font-normal text-text-primary [font-variation-settings:'opsz'_30]";

function Figure(props: { size: 'page' | 'inline' }) {
  const page = props.size === 'page';
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex select-none items-center leading-none',
        page ? 'gap-3 text-[8.5rem]' : 'gap-2 text-[4.5rem]',
        DISPLAY,
      )}
    >
      <span>4</span>
      <span
        className={cn(
          'block shrink-0 bg-fill-brand [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]',
          'animate-[spin_24s_linear_infinite] motion-reduce:animate-none',
          // The digits' figures sit a little above the line's centre.
          page ? 'size-[6.75rem] -translate-y-[0.35rem]' : 'size-[3.5rem] -translate-y-[0.2rem]',
        )}
        style={{
          maskImage: `url(${JSON.stringify(brandSymbol)})`,
          WebkitMaskImage: `url(${JSON.stringify(brandSymbol)})`,
        }}
      />
      <span>4</span>
    </div>
  );
}

/** The whole window: an address the server has nothing at. */
export function NotFoundPage(props: { copy: ConsoleCopy }) {
  const text = props.copy.notFound;
  const canGoBack = window.history.length > 1;
  return (
    <main className="flex h-dvh w-full flex-col items-center overflow-y-auto bg-surface-1 px-6">
      <div className="my-auto flex w-full max-w-[32rem] flex-col items-center py-16 text-center">
        <Figure size="page" />
        <h1 className={cn(DISPLAY, 'mt-12 text-[1.875rem] leading-9')}>{text.title}</h1>
        <p className="mt-3 text-base leading-6 text-text-muted">{text.body}</p>
        <code className="mt-5 max-w-full truncate rounded-md bg-alpha-1 px-2 py-0.5 font-mono text-[0.8125rem] leading-5 text-text-secondary">
          {window.location.pathname}
        </code>
        <div className="mt-10 flex w-full max-w-[22rem] flex-col gap-3">
          <Button asChild size="lg" fullWidth className="md:h-10 text-[0.9375rem]">
            <a href="/admin/">{text.home}</a>
          </Button>
          {canGoBack && (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              className="md:h-10 text-[0.9375rem]"
              onClick={() => window.history.back()}
            >
              {text.back}
            </Button>
          )}
        </div>
      </div>
      <p className="shrink-0 pb-8 text-[0.8125rem] leading-5 text-text-muted">
        {props.copy.product} · {window.location.host}
      </p>
    </main>
  );
}

/** Inside the console: a page, member or model that is not there, with the way back to its list. */
export function NotFoundPanel(props: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-[28rem] flex-col items-center justify-center py-12 text-center">
      <Figure size="inline" />
      <h2 className={cn(DISPLAY, 'mt-8 text-[1.375rem] leading-7')}>{props.title}</h2>
      <p className="mt-2 max-w-[26rem] text-sm leading-5 text-text-muted">{props.body}</p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-6 rounded-[7px] text-sm"
        onClick={props.onAction}
      >
        {props.action}
      </Button>
    </div>
  );
}
