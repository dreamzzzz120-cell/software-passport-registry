/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface SPRLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  variant?: 'full' | 'icon' | 'badge';
  className?: string;
  showText?: boolean;
  subtext?: string;
}

export default function SPRLogo({
  size = 'md',
  variant = 'full',
  className = '',
  showText = true,
  subtext = 'GLOBAL TRUST INFRASTRUCTURE'
}: SPRLogoProps) {
  const iconSizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
    xl: 'w-14 h-14',
    '2xl': 'w-20 h-20'
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-xl',
    '2xl': 'text-3xl'
  };

  return (
    <div className={`flex items-center gap-3 select-none ${className}`} id="spr-brand-logo-root">
      {/* SPR Sovereign Hexagonal Trust Shield SVG */}
      <div className={`relative flex items-center justify-center shrink-0 ${iconSizes[size]}`}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_2px_12px_rgba(79,70,229,0.3)]"
        >
          <defs>
            {/* Gradient definitions */}
            <linearGradient id="sprShieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="50%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>

            <linearGradient id="sprGoldAccent" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>

            <linearGradient id="sprEmeraldGlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>

            <filter id="sprGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Outer Hexagonal Sovereign Crest */}
          <polygon
            points="50,4 92,25 92,75 50,96 8,75 8,25"
            fill="url(#sprShieldGrad)"
            stroke="rgba(255, 255, 255, 0.25)"
            strokeWidth="3"
            rx="6"
          />

          {/* Inner Cryptographic Trust Nodes & Lines */}
          <polygon
            points="50,14 82,30 82,70 50,86 18,70 18,30"
            fill="none"
            stroke="url(#sprGoldAccent)"
            strokeWidth="2"
            strokeDasharray="4 2"
          />

          {/* Center Interlocking SPR Sovereign Monogram Shape */}
          <path
            d="M 32,32 L 68,32 C 74,32 74,44 68,44 L 32,44 C 26,44 26,58 32,58 L 68,58"
            stroke="#ffffff"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          <path
            d="M 50,22 L 50,78"
            stroke="url(#sprEmeraldGlow)"
            strokeWidth="3"
            strokeLinecap="round"
            filter="url(#sprGlow)"
          />

          {/* Corner Verification Nodes */}
          <circle cx="50" cy="14" r="3.5" fill="#34d399" />
          <circle cx="82" cy="30" r="3.5" fill="#fbbf24" />
          <circle cx="82" cy="70" r="3.5" fill="#60a5fa" />
          <circle cx="50" cy="86" r="3.5" fill="#34d399" />
          <circle cx="18" cy="70" r="3.5" fill="#fbbf24" />
          <circle cx="18" cy="30" r="3.5" fill="#60a5fa" />
        </svg>

        {/* Live Status Pulse Dot */}
        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-slate-900"></span>
        </span>
      </div>

      {/* Brand Text Typography */}
      {showText && variant !== 'icon' && (
        <div className="flex flex-col leading-none">
          <div className="flex items-center gap-1.5">
            <span className={`font-display font-black tracking-tight text-slate-900 dark:text-white ${textSizes[size]}`}>
              SPR
            </span>
            <span className="bg-indigo-600/10 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase">
              TRUST-OS
            </span>
          </div>
          {subtext && (
            <span className="text-[8px] font-mono font-bold tracking-widest text-slate-500 dark:text-slate-400 uppercase mt-1">
              {subtext}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
