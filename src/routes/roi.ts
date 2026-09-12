/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { buildCatalog } from './billing.ts';

// Public MSP ROI calculator at /roi. SPR's own cost is read from the live
// Stripe-backed catalog (the same prices checkout charges); everything on the
// revenue side is typed in by the visitor and labelled as their assumption.
// The page never ships a pre-filled profit figure: an ROI "result" that SPR
// invented would be exactly the kind of number this product refuses to show.

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';
const pageLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const STYLE = `:root{--ink:#111A24;--muted:#5C6670;--line:#D9DED9;--bg:#F6F7F4;--surface:#fff;--accent:#1F5F7A;--ok:#2E7D4F;--warn:#B7791F}@media(prefers-color-scheme:dark){:root{--ink:#E6EAEE;--muted:#97A2AB;--line:#263038;--bg:#0F1519;--surface:#161E25;--accent:#6FB3D2;--ok:#6CC594;--warn:#E0B25C}}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px 72px}main{max-width:900px;margin:0 auto}h1{font-size:28px;margin:0 0 6px}h2{font-size:17px;margin:24px 0 8px}p{margin:0 0 8px}.k{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card{background:var(--surface);border:1px solid var(--line);padding:16px}label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}input,select{width:100%;box-sizing:border-box;font:15px system-ui,sans-serif;padding:8px 10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);font-variant-numeric:tabular-nums;margin-top:12px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-size:14px}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}td.n{text-align:right;font-family:ui-monospace,Consolas,monospace}.note{border:1px solid var(--line);background:var(--surface);padding:12px 14px;font-size:13px;color:var(--muted);margin-top:16px}.big{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums}.pill{display:inline-block;font-size:11px;letter-spacing:.04em;padding:2px 8px;border-radius:999px;background:var(--bg);border:1px solid var(--line);color:var(--muted)}.cta{display:inline-block;margin-top:14px;padding:9px 14px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:14px}`;

export function createRoiRouter() {
  const router = Router();
  router.get('/', pageLimiter, async (_req: Request, res: Response, next) => {
    try {
      const catalog = await buildCatalog();
      // Only recurring USD prices can be placed on a per-month line. Anything
      // else (a one-time product, a non-USD price) is left off rather than
      // converted by a rule the visitor cannot see.
      const monthly = (e: { unitAmount: number | null; currency: string | null; interval: string | null }) =>
        e.unitAmount == null || e.currency !== 'usd' ? null : e.interval === 'month' ? e.unitAmount / 100 : e.interval === 'year' ? e.unitAmount / 100 / 12 : null;
      const plans = catalog.plans.filter((p) => p.checkoutAvailable && monthly(p) !== null).map((p) => ({ id: p.id, label: p.label, monthlyUsd: monthly(p) as number, billed: p.interval as string, clientLimit: p.clientLimit }));
      const addons = catalog.addons.filter((a) => a.checkoutAvailable && monthly(a) !== null).map((a) => ({ id: a.id, label: a.label, monthlyUsd: monthly(a) as number, billed: a.interval as string }));
      const data = JSON.stringify({ plans, addons, fetchedAt: new Date().toISOString() });
      const planOptions = plans.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)} — $${p.monthlyUsd.toLocaleString('en-US')}/month${p.billed === 'year' ? ' (billed yearly)' : ''}, up to ${p.clientLimit === null ? 'unlimited' : p.clientLimit} clients</option>`).join('');
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MSP ROI Calculator — Software Passport Registry</title><meta name="description" content="Model your own software-assurance service on top of SPR. SPR's cost is read live from its price list; every revenue figure is your assumption."><link rel="canonical" href="${PUBLIC_ORIGIN}/roi"><style>${STYLE}</style></head><body><main>
<p class="k">Software Passport Registry · for MSPs</p>
<h1>What would a software-assurance service cost you, and what would you charge?</h1>
<p>SPR's side of this page is real: the plan prices below are read live from the price list checkout charges against. Your side — how many clients, what you charge them — is yours to type. The page shows arithmetic on your numbers; it does not suggest what you will earn.</p>
<div class="grid">
  <div class="card">
    <span class="k">SPR cost (live price list)</span>
    <label for="plan">SPR plan</label>
    <select id="plan">${planOptions}</select>
    <label for="addons">Add-ons (optional)</label>
    <div id="addons">${addons.map((a) => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" class="addon" value="${escapeHtml(a.id)}" style="width:auto"> ${escapeHtml(a.label)} — $${a.monthlyUsd.toLocaleString('en-US')}/month${a.billed === 'year' ? ' (billed yearly)' : ''}</label>`).join('')}</div>
    <p class="note" style="margin-top:10px">Prices fetched ${escapeHtml(new Date().toISOString().slice(0, 16))}Z from SPR's catalog. If a plan's client limit is below your client count, the page says so rather than pretending.</p>
  </div>
  <div class="card">
    <span class="k">Your assumptions</span>
    <label for="clients">Clients you would offer this to</label>
    <input id="clients" type="number" min="0" step="1" value="">
    <label for="price">What you would charge each client per month (USD)</label>
    <input id="price" type="number" min="0" step="1" value="">
    <label for="hours">Engineer hours per client per month you would spend without SPR (optional)</label>
    <input id="hours" type="number" min="0" step="0.5" value="">
    <label for="rate">Loaded hourly cost of that engineer (USD, optional)</label>
    <input id="rate" type="number" min="0" step="1" value="">
  </div>
</div>
<div class="card" style="margin-top:14px">
  <span class="k">Arithmetic on your numbers</span>
  <table><tbody id="out"><tr><td colspan="2">Enter a client count and a price to see the arithmetic.</td></tr></tbody></table>
  <p class="note">Every revenue figure here comes from what you typed. SPR does not know your market, your clients or your margins, and does not present a projection as a fact. Whether clients will pay your price is your judgement, not this page's.</p>
  <a class="cta" href="${PUBLIC_ORIGIN}/pricing">See plans</a>
</div>
<script>
(function(){
  var D=${data};
  var $=function(id){return document.getElementById(id)};
  var fmt=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
  function calc(){
    var plan=D.plans.find(function(p){return p.id===$('plan').value})||D.plans[0];
    var clients=Number($('clients').value)||0, price=Number($('price').value)||0, hours=Number($('hours').value)||0, rate=Number($('rate').value)||0;
    var addonCost=Array.prototype.slice.call(document.querySelectorAll('.addon:checked')).reduce(function(s,el){var a=D.addons.find(function(x){return x.id===el.value});return s+(a?a.monthlyUsd:0)},0);
    var rows=[];
    if(!plan){rows.push(['No plan is available for checkout right now.','']);}
    else{
      var sprCost=plan.monthlyUsd+addonCost;
      var revenue=clients*price;
      rows.push(['SPR plan: '+plan.label, fmt(plan.monthlyUsd)+' / month']);
      if(addonCost>0) rows.push(['SPR add-ons', fmt(addonCost)+' / month']);
      if(plan.clientLimit!==null && clients>plan.clientLimit) rows.push(['Plan client limit', 'This plan covers up to '+plan.clientLimit+' clients; you entered '+clients+'. Choose a larger plan.']);
      if(clients>0 && price>0){
        rows.push(['Your revenue (your price × your clients)', fmt(revenue)+' / month']);
        rows.push(['Your revenue minus SPR cost', fmt(revenue-sprCost)+' / month']);
        rows.push(['Same, annualised', fmt((revenue-sprCost)*12)+' / year']);
        if(hours>0 && rate>0) rows.push(['Engineer time you said you would otherwise spend', fmt(hours*rate*clients)+' / month ('+(hours*clients)+' h)']);
      } else rows.push(['Your revenue','Enter a client count and a price.']);
    }
    $('out').innerHTML=rows.map(function(r){return '<tr><td>'+r[0]+'</td><td class="n">'+r[1]+'</td></tr>'}).join('');
  }
  ['plan','clients','price','hours','rate'].forEach(function(id){$(id).addEventListener('input',calc);$(id).addEventListener('change',calc)});
  Array.prototype.forEach.call(document.querySelectorAll('.addon'),function(el){el.addEventListener('change',calc)});
  calc();
})();
</script>
<p class="note" style="margin-top:28px">Software Passport Registry Ltd. · <a href="${PUBLIC_ORIGIN}/terms">Terms</a> · <a href="${PUBLIC_ORIGIN}/privacy">Privacy</a></p>
</main></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(html);
    } catch (error) { return next(error); }
  });
  return router;
}
