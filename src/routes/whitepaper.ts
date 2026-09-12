/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';

// Public, server-rendered whitepaper at /whitepaper, from the Markdown that
// ships in the image (data/whitepaper-software-vin.md). A deliberately small
// converter for the subset the document uses: headings, paragraphs, lists,
// emphasis, rules. No client JavaScript; crawlers get the full text.

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';
const SOURCE = path.resolve(process.cwd(), 'data', 'whitepaper-software-vin.md');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s)]+|softwarepassportregistry\.com\/[^\s)]+)/g, (m) => `<a href="${m.startsWith('http') ? m : 'https://www.' + m}">${m}</a>`);
}
export function markdownToHtml(md: string): { title: string; html: string } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let title = 'Whitepaper';
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let listOrdered = false;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${listOrdered ? 'ol' : 'ul'}>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</${listOrdered ? 'ol' : 'ul'}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); const level = h[1].length; const text = h[2].trim(); if (level === 1 && title === 'Whitepaper') title = text; out.push(`<h${level}>${inline(text)}</h${level}>`); continue; }
    if (/^---+$/.test(line.trim())) { flushPara(); flushList(); out.push('<hr>'); continue; }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) { flushPara(); const item = (ul ?? ol)![1]; const ordered = Boolean(ol); if (list && listOrdered !== ordered) flushList(); if (!list) { list = []; listOrdered = ordered; } list.push(item); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return { title, html: out.join('\n') };
}

const STYLE = `:root{--ink:#111A24;--muted:#5C6670;--line:#D9DED9;--bg:#F6F7F4;--surface:#fff;--accent:#1F5F7A}@media(prefers-color-scheme:dark){:root{--ink:#E6EAEE;--muted:#97A2AB;--line:#263038;--bg:#0F1519;--surface:#161E25;--accent:#6FB3D2}}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Georgia,"Times New Roman",serif;padding:32px 16px 72px}main{max-width:720px;margin:0 auto}h1{font:600 32px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0 0 8px;letter-spacing:-.01em}h2{font:600 20px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;margin:32px 0 8px}h3{font:600 17px/1.3 system-ui,sans-serif;margin:16px 0 6px;color:var(--muted)}p{margin:0 0 14px}ul,ol{margin:0 0 14px 22px;padding:0}li{margin:4px 0}hr{border:0;border-top:1px solid var(--line);margin:28px 0}a{color:var(--accent)}code{font:13px ui-monospace,Consolas,monospace;background:var(--surface);border:1px solid var(--line);padding:1px 5px}em{color:var(--muted)}.k{font:12px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}.cta{display:inline-block;margin:6px 8px 0 0;padding:10px 16px;background:var(--accent);color:#fff;text-decoration:none;font:600 14px system-ui,sans-serif}.cta.alt{background:transparent;color:var(--accent);border:1px solid var(--accent)}.foot{margin-top:36px;padding-top:12px;border-top:1px solid var(--line);font:13px/1.5 system-ui,sans-serif;color:var(--muted)}`;

export function createWhitepaperRouter() {
  const router = Router();
  router.get('/', (_req: Request, res: Response, next) => {
    try {
      if (!fs.existsSync(SOURCE)) return res.status(404).send('Whitepaper not available on this deployment.');
      const { title, html } = markdownToHtml(fs.readFileSync(SOURCE, 'utf8'));
      const description = 'Why software needs a persistent identity to which independently observed evidence accumulates — and where SCA scanners stopped short.';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Software Passport Registry</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${PUBLIC_ORIGIN}/whitepaper"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="article"><style>${STYLE}</style></head><body><main><div class="k">Software Passport Registry · whitepaper</div>${html}<p><a class="cta" href="${PUBLIC_ORIGIN}/free-review">Run a free review</a><a class="cta alt" href="${PUBLIC_ORIGIN}/software">Browse observed software</a></p><p class="foot">Software Passport Registry Ltd. · <a href="${PUBLIC_ORIGIN}/terms">Terms</a> · <a href="${PUBLIC_ORIGIN}/privacy">Privacy</a></p></main></body></html>`);
    } catch (error) { return next(error); }
  });
  return router;
}
