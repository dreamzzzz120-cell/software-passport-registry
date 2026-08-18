import React, { useEffect, useState } from 'react';

type PublicTrust = { score?: number; name?: string; version?: string; security?: number; compliance?: number; reputation?: number };

async function getTrust(baseUrl: string, passportId: string): Promise<PublicTrust> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/public/v1/passports/${encodeURIComponent(passportId)}/trust`);
  if (!response.ok) throw new Error('SPR Passport unavailable');
  return response.json();
}

export function SPRTrustBadge({ passportId, baseUrl = 'https://api.sprtrust.com', href }: { passportId: string; baseUrl?: string; href?: string }) {
  const [data, setData] = useState<PublicTrust | null>(null);
  useEffect(() => { getTrust(baseUrl, passportId).then(setData).catch(() => setData(null)); }, [baseUrl, passportId]);
  const label = data?.score === undefined ? 'SPR Trust' : `SPR Trust ${data.score}`;
  const content = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, background: '#0A1628', color: '#D4AF37', border: '1px solid #D4AF37', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 13, fontWeight: 700 }}>{label}</span>;
  return href ? <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{content}</a> : content;
}

export function SPRTrustScore({ passportId, baseUrl = 'https://api.sprtrust.com' }: { passportId: string; baseUrl?: string }) {
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => { getTrust(baseUrl, passportId).then((d) => setScore(typeof d.score === 'number' ? d.score : null)).catch(() => setScore(null)); }, [baseUrl, passportId]);
  return <strong>{score === null ? '—' : score}</strong>;
}
