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
    <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <a href="/" className="text-xs font-semibold text-[#3794ff] hover:underline">&larr; Software Passport Registry</a>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-[#d4d4d4]">{title}</h1>
        <p className="mt-2 text-xs text-[#6f6f6f]">Last updated: {lastUpdated}</p>
        <div className="mt-10 space-y-8 text-sm leading-7 text-[#9d9d9d] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[#d4d4d4] [&_h2]:mb-2 [&_strong]:text-[#d4d4d4] [&_a]:text-[#3794ff] [&_a]:hover:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          {children}
        </div>
        <div className="mt-14 flex flex-wrap gap-4 border-t border-[#3c3c3c] pt-6 text-xs">
          <a href="/terms">Terms of Service</a>
          <span className="text-[#3c3c3c]">·</span>
          <a href="/privacy">Privacy Policy</a>
          <span className="text-[#3c3c3c]">·</span>
          <a href="/">Home</a>
        </div>
      </div>
    </div>
  );
}
