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

// The window, while this deployment requires a company sign-in and there is
// none. Drawn after the Claude desktop's first run, two steps:
//
// - Welcome: the brand mark, "Maka *for* Mac" in the serif, one grey line,
//   and a wide solid "Get started" held to the foot of the window.
// - Sign In: a serif "Sign In" over one card, the Google button (outlined,
//   with its "G") above an "OR" and the company SSO as the solid primary
//   below it. While the browser is out the chosen button turns into a spinner
//   and nothing else is said; pressing a button again starts over (a closed
//   browser tab is not a dead end) — the spinning one only after a moment, so
//   a double click is one sign-in. Why the last attempt failed sits in the
//   card's foot, where the reference keeps its fine print. The buttons are the
//   same elements in every state, so keyboard focus survives a sign-in
//   starting or failing.
//
// Sizes are the reference's, measured from screenshots. Each column centres
// in the whole window, titlebar included.
//
// It replaces the whole shell, so it draws the titlebar strip itself — an
// empty `.maka-window-titlebar` row, the window's drag surface and the
// clearance for the traffic lights / caption buttons.
//
// Pure: the gate (`OrgAccountGate`) owns the store and hands the state in, so
// every state here can be rendered from a plain value.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/index.js';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import type { OrgAccountState, OrgIdentityProvider } from '../../bridge/org-account.js';
import type { MakaPlatform } from '../../lib/platform.js';
import { GoogleSignInMark } from '../../lib/ported/provider-brand-marks.js';
import { signInOptions, signInOutcomeTone } from '../../lib/org-account-view.js';
import type { OrgAccountAction } from '../../store/org-account-store.js';
import { getOrgAccountCopy, orgAccountErrorMessage } from '../../locales/org-account-copy.js';

const brandSymbol = new URL('../../../../assets/brand/relx-symbol.svg', import.meta.url).href;

/** The reference's 40px control with 15px type; Button `lg` is 36px on desktop. */
const SIGN_IN_BUTTON = 'md:h-10 text-[0.9375rem]';
const FOOT_LINE = 'text-center text-[0.8125rem] leading-5';
const DISPLAY_TITLE =
  "text-center font-display text-[1.875rem] font-normal leading-9 text-text-primary [font-variation-settings:'opsz'_30]";

/**
 * The frame every gated state shares: the titlebar strip over a centred
 * column, and optionally a foot held to the bottom of the window. The main
 * area pads its foot by the titlebar's height — and its head by the foot's
 * height beyond that — so the column centres in the whole window.
 */
export function LoginSurface(props: { busy?: boolean; children?: ReactNode; foot?: ReactNode }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-surface-1"
      data-maka-contract="login-surface"
      aria-busy={props.busy || undefined}
    >
      <div className="maka-window-titlebar" role="presentation" />
      <main
        className={`flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 ${
          props.foot ? 'pt-10' : 'pb-[var(--h-titlebar)]'
        }`}
      >
        {/* `my-auto`, not `justify-center`: a window too short for the
            column scrolls from its top instead of clipping it. */}
        <div className="my-auto flex w-full flex-col items-center py-6">{props.children}</div>
      </main>
      {props.foot && <div className="flex shrink-0 justify-center px-6 pb-12">{props.foot}</div>}
    </div>
  );
}

/** The first run's front page; "Get started" leads to the sign-in. */
export function WelcomeScreen(props: { platform: MakaPlatform; onGetStarted: () => void }) {
  const copy = getOrgAccountCopy(useUiLocale()).welcome;
  return (
    <LoginSurface
      foot={
        <Button
          size="lg"
          fullWidth
          className={`${SIGN_IN_BUTTON} max-w-[27.5rem]`}
          onClick={props.onGetStarted}
        >
          {copy.getStarted}
        </Button>
      }
    >
      <span
        aria-hidden="true"
        data-maka-contract="welcome-brand"
        className="block size-20 bg-fill-brand [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
        style={{
          maskImage: `url(${JSON.stringify(brandSymbol)})`,
          WebkitMaskImage: `url(${JSON.stringify(brandSymbol)})`,
        }}
      />
      <h1 className={`${DISPLAY_TITLE} mt-[2.875rem]`}>
        {copy.product} <em className="italic">{copy.joiner}</em> {copy.platforms[props.platform]}
      </h1>
      <p className="mt-4 text-center text-base leading-6 text-text-muted">{copy.tagline}</p>
    </LoginSurface>
  );
}

export function LoginScreen(props: {
  account: Exclude<OrgAccountState, { status: 'signed_in' }>;
  knownProviders: readonly OrgIdentityProvider[];
  pending: OrgAccountAction | null;
  onSignIn: (provider?: string) => void;
  onRefresh: () => void;
}) {
  const copy = getOrgAccountCopy(useUiLocale());
  const heading = useRef<HTMLHeadingElement>(null);
  // Arriving here (from Welcome, or a sign-out) starts reading at the title.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  return (
    <LoginSurface>
      <div className="flex w-full max-w-[27.875rem] flex-col items-center gap-16">
        <h1 ref={heading} tabIndex={-1} className={`${DISPLAY_TITLE} outline-none`}>
          {copy.login.title}
        </h1>
        <div className="flex w-full flex-col gap-3 rounded-[2rem] border border-hairline bg-surface-1 p-7 shadow-[0_4px_24px_0_var(--shadow-near)]">
          <SignInCard {...props} />
        </div>
      </div>
    </LoginSurface>
  );
}

/** The spinner's key for the one generic button (a server that names no provider). */
const GENERIC = '';
/** How long the spinning button ignores presses: a double click is one sign-in. */
const RESTART_GRACE_MS = 1500;

function SignInCard(props: Parameters<typeof LoginScreen>[0]) {
  const copy = getOrgAccountCopy(useUiLocale());
  const { account } = props;
  const signingIn = account.status === 'signing_in';
  const options = account.status === 'signed_out' ? signInOptions(account) : undefined;

  if (options?.kind === 'loading') {
    return (
      <div className="flex flex-col gap-3" role="status">
        <span className="sr-only">{copy.loadingOptions}</span>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="mx-auto h-4 w-6 rounded" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (options?.kind === 'retry') {
    return (
      <>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          className={SIGN_IN_BUTTON}
          disabled={props.pending !== null}
          onClick={props.onRefresh}
        >
          {copy.tryAgain}
        </Button>
        <p role="alert" className={`${FOOT_LINE} text-danger`}>
          {orgAccountErrorMessage(options.error, copy)}
        </p>
      </>
    );
  }

  const providers =
    account.status === 'signing_in'
      ? (account.providers ?? props.knownProviders)
      : options?.kind === 'choose'
        ? options.providers
        : [];
  const error = options?.kind === 'choose' ? options.error : undefined;
  return (
    <>
      <SignInButtons
        providers={providers}
        {...(account.status === 'signing_in' ? { spinning: account.provider ?? GENERIC } : {})}
        disabled={options?.kind === 'no_server'}
        // Until main answers a press with `signing_in`, a second press would
        // only open a second browser tab.
        waiting={!signingIn && props.pending !== null}
        onSignIn={props.onSignIn}
      />
      {error !== undefined &&
        (signInOutcomeTone(error) === 'note' ? (
          <p role="status" className={`${FOOT_LINE} text-text-secondary`}>
            {orgAccountErrorMessage(error, copy)}
          </p>
        ) : (
          <p role="alert" className={`${FOOT_LINE} text-danger`}>
            {orgAccountErrorMessage(error, copy)}
          </p>
        ))}
    </>
  );
}

/**
 * Google above the "OR", outlined and carrying its mark; every other provider
 * below it as the solid primary. A server with no Google gets no "OR"; one
 * that names no provider gets the one generic button. A press that cannot act
 * right now is ignored rather than the button disabled, so it keeps focus.
 */
function SignInButtons(props: {
  providers: readonly OrgIdentityProvider[];
  /** The provider whose sign-in is out in the browser; its button spins. */
  spinning?: string;
  disabled: boolean;
  waiting: boolean;
  onSignIn: (provider?: string) => void;
}) {
  const copy = getOrgAccountCopy(useUiLocale());
  const [restartable, setRestartable] = useState(false);
  useEffect(() => {
    setRestartable(false);
    if (props.spinning === undefined) return;
    const timer = setTimeout(() => setRestartable(true), RESTART_GRACE_MS);
    return () => clearTimeout(timer);
  }, [props.spinning]);
  const google = props.providers.find((provider) => provider.id === 'google');
  const others = props.providers.filter((provider) => provider !== google);
  const spinner = <Anthropicon name="spinner" size={16} className="animate-spin" />;
  const button = (provider: OrgIdentityProvider | undefined, outlined: boolean) => {
    const label = provider ? copy.continueWith(provider.displayName) : copy.signIn;
    const spinning = props.spinning === (provider?.id ?? GENERIC);
    const held = props.waiting || (spinning && !restartable);
    return (
      <Button
        key={provider?.id ?? GENERIC}
        {...(outlined ? { variant: 'secondary' as const } : {})}
        size="lg"
        fullWidth
        className={SIGN_IN_BUTTON}
        data-provider={provider?.id}
        disabled={props.disabled}
        aria-disabled={held || undefined}
        aria-busy={spinning || undefined}
        aria-label={spinning ? label : undefined}
        onClick={() => {
          if (!held) props.onSignIn(provider?.id);
        }}
      >
        {spinning ? (
          spinner
        ) : (
          <>
            {provider?.id === 'google' && <GoogleSignInMark className="size-4 shrink-0" />}
            {label}
          </>
        )}
      </Button>
    );
  };
  if (props.providers.length === 0) return button(undefined, false);
  return (
    <>
      {google && button(google, true)}
      {google && others.length > 0 && (
        <p className="text-center text-xs leading-4 text-text-secondary">{copy.or}</p>
      )}
      {others.map((provider) => button(provider, false))}
    </>
  );
}
