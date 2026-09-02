/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export default function LegalFooterLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-4 text-xs text-[var(--spr-text-faint)] ${className}`}>
      <a href="/trust/" className="hover:text-[var(--spr-highlight)] hover:underline">Trust Center</a>
      <a href="/about/" className="hover:text-[var(--spr-highlight)] hover:underline">About SPR</a>
      <a href="/methodology/" className="hover:text-[var(--spr-highlight)] hover:underline">Methodology</a>
      <a href="/terms" className="hover:text-[var(--spr-highlight)] hover:underline">Terms of Service</a>
      <a href="/privacy" className="hover:text-[var(--spr-highlight)] hover:underline">Privacy Policy</a>
    </div>
  );
}
