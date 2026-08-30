/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';

interface Props {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

// Shared shell for public legal documents (/terms, /privacy). Matches the
// dark public-page theme used by CoverPage/MspLandingView/MspPricingView
// rather than the authenticated CommandCenter shell, since these pages must
// render for signed-out visitors too.
export default function LegalPageLayout({ title, lastUpdated, children }: Props) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] text-[var(--spr-text)]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <a href="/" className="text-xs font-semibold text-[var(--spr-highlight)] hover:underline">&larr; Software Passport Registry</a>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-[var(--spr-text)]">{title}</h1>
        <p className="mt-2 text-xs text-[var(--spr-text-faint)]">Last updated: {lastUpdated}</p>
        <div className="mt-10 space-y-8 text-sm leading-7 text-[var(--spr-text-muted)] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--spr-text)] [&_h2]:mb-2 [&_strong]:text-[var(--spr-text)] [&_a]:text-[var(--spr-highlight)] [&_a]:hover:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          {children}
        </div>
        <div className="mt-14 flex flex-wrap gap-4 border-t border-[var(--spr-border)] pt-6 text-xs">
          <a href="/terms">Terms of Service</a>
          <span className="text-[var(--spr-border)]">·</span>
          <a href="/privacy">Privacy Policy</a>
          <span className="text-[var(--spr-border)]">·</span>
          <a href="/">Home</a>
        </div>
      </div>
    </div>
  );
}
