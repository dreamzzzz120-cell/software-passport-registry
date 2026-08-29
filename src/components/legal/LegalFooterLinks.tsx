/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Small, reused link row for the public-facing pages that have no existing
// shared footer component (CoverPage, MspLandingView, MspPricingView,
// LoginView). Plain anchors are used deliberately -- /terms and /privacy are
// ordinary public routes served by the same catch-all as every other page,
// so a full navigation works correctly without threading the app's internal
// navigate() callback into every consumer.
export default function LegalFooterLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-4 text-xs text-[#6f6f6f] ${className}`}>
      <a href="/terms" className="hover:text-[#3794ff] hover:underline">Terms of Service</a>
      <a href="/privacy" className="hover:text-[#3794ff] hover:underline">Privacy Policy</a>
    </div>
  );
}
