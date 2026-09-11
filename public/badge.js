/**
 * Software Passport Registry — Embeddable Badge
 *
 * Usage (the signed URL is generated for the MSP in-app; it is not guessable
 * and it is not derived from a slug):
 *
 *   <script src="https://www.softwarepassportregistry.com/badge.js"
 *           data-passport-url="https://www.softwarepassportregistry.com/badge/v1/<id>/<token>"></script>
 *
 * Renders inline at the exact point the <script> tag sits in the page.
 * No dependencies, no cookies, no tracking beyond the single GET below.
 */
(function () {
  // Resolved from this script's own src below, so the badge always calls back
  // to whatever host served it -- a custom MSP domain, a CDN alias or staging
  // all work without a rebuild. This constant is only the fallback for the
  // case where the script element carries no usable src.
  // www, not the apex: the apex 308-redirects to www, and a cross-origin
  // fetch that has to follow a redirect needs CORS on both hops. Embeds
  // should name the same host in both attributes.
  var DEFAULT_ORIGIN = 'https://www.softwarepassportregistry.com';
  var API_ORIGIN = DEFAULT_ORIGIN;
  var selfOrigin = null;
  var FETCH_TIMEOUT_MS = 8000;

  /**
   * Status vocabulary. These are the five VerificationState values from
   * src/lib/verification/verificationPolicy.ts — the single authoritative
   * evaluator that publicTrustResponse() defers to, so the badge can never
   * claim a stronger state than the Trust Room or the share link shows.
   * Compared case-insensitively so a change of case on either side cannot
   * silently turn every badge red.
   *
   * An unrecognised status must NOT fall through to "Unverified" — that is an
   * affirmative negative claim about someone's software, and we would be
   * making it because of client/server version skew rather than because of
   * evidence. Unknown values render neutrally instead.
   */
  var STATUS_COPY = {
    verified: { label: 'Verified', color: '#107c10' },
    partial: { label: 'Partially verified', color: '#797420' },
    investigate: { label: 'Open findings', color: '#797420' },
    avoid: { label: 'Critical findings', color: '#d13438' },
    unknown: { label: 'Insufficient evidence', color: '#616161' }
  };

  var STATUS_INDETERMINATE = { label: 'Status unavailable', color: '#616161' };

  function resolveStatus(raw) {
    if (typeof raw !== 'string') return STATUS_INDETERMINATE;
    return STATUS_COPY[raw.trim().toLowerCase()] || STATUS_INDETERMINATE;
  }

  function el(tag, styles) {
    var e = document.createElement(tag);
    if (styles) for (var k in styles) e.style[k] = styles[k];
    return e;
  }

  /**
   * This script runs on domains we do not control, and the URL it is pointed
   * at comes out of a client's own HTML. Only ever fetch an https URL on the
   * registry's origin, so a mistyped or tampered embed cannot be used to
   * make the badge issue requests to somewhere else on the visitor's behalf.
   */
  function safeRegistryUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      var url = new URL(value, API_ORIGIN);
      if (url.origin !== API_ORIGIN) return null;
      // The registry is https in every deployed environment. http is tolerated
      // only when the script itself was served over http, which in practice
      // means a developer running the app on localhost.
      if (url.protocol !== 'https:' && url.origin !== selfOrigin) return null;
      return url.href;
    } catch (e) {
      return null;
    }
  }

  var markSerial = 0;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /**
   * SPR mark, drawn inline so the badge carries its own artwork onto any host
   * page: a gradient-filled shield with a white outline, a blue outline offset
   * over it and clipped to its right half, and a bold T. Every id is
   * per-render so several badges on one page cannot share (and break) a
   * gradient or clip.
   */
  function sprMark(size) {
    var n = ++markSerial;
    var clipId = 'spr-clip-' + n, gradId = 'spr-grad-' + n, glowId = 'spr-glow-' + n;
    var svg = svgEl('svg', { viewBox: '0 0 28 28', width: String(size), height: String(size), 'aria-hidden': 'true' });
    svg.style.flexShrink = '0';
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    var defs = svgEl('defs');
    var grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#1d4ed8' }));
    grad.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#0b1a3a' }));
    defs.appendChild(grad);
    var clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('rect', { x: '14', y: '-3', width: '20', height: '34' }));
    defs.appendChild(clip);
    var glow = svgEl('filter', { id: glowId, x: '-30%', y: '-30%', width: '160%', height: '160%' });
    glow.appendChild(svgEl('feGaussianBlur', { stdDeviation: '0.6' }));
    defs.appendChild(glow);
    svg.appendChild(defs);

    var shieldD = 'M14 2 4.5 5.6v7.1c0 6.1 3.95 11.8 9.5 13.3 5.55-1.5 9.5-7.2 9.5-13.3V5.6L14 2z';

    // Filled body, then the white outline on top of it.
    svg.appendChild(svgEl('path', { d: shieldD, fill: 'url(#' + gradId + ')' }));
    svg.appendChild(svgEl('path', { d: shieldD, fill: 'none', stroke: '#ffffff', 'stroke-width': '1.8', 'stroke-linejoin': 'round' }));

    // Blue echo: same outline, offset, right half only.
    svg.appendChild(svgEl('path', { d: shieldD, transform: 'translate(3 3)', fill: 'none', stroke: '#60a5fa', 'stroke-width': '1.8', 'stroke-linejoin': 'round', 'clip-path': 'url(#' + clipId + ')' }));

    // The T: a soft glow underneath, crisp letter on top.
    var tAttrs = { x: '14', y: '19.2', 'text-anchor': 'middle', 'font-family': FONT, 'font-size': '15', 'font-weight': '800', fill: '#ffffff' };
    var tGlow = svgEl('text', tAttrs); tGlow.setAttribute('filter', 'url(#' + glowId + ')'); tGlow.setAttribute('opacity', '0.55'); tGlow.textContent = 'T';
    var t = svgEl('text', tAttrs); t.textContent = 'T';
    svg.appendChild(tGlow);
    svg.appendChild(t);
    return svg;
  }

  /**
   * Status glyph for the state chip. One small path per state; anything not
   * listed falls back to a neutral dash so an unknown status never borrows a
   * stronger state's symbol.
   */
  function statusGlyph(key, color) {
    var svg = svgEl('svg', { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': 'true' });
    svg.style.display = 'block';
    var stroke = { fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    var d;
    if (key === 'verified') d = 'M3.5 8.5 6.5 11.5 12.5 4.5';
    else if (key === 'partial') { svg.appendChild(svgEl('circle', { cx: '8', cy: '8', r: '5.5', fill: 'none', stroke: color, 'stroke-width': '2' })); svg.appendChild(svgEl('path', { d: 'M8 2.5A5.5 5.5 0 0 1 8 13.5z', fill: color })); return svg; }
    else if (key === 'investigate') d = 'M8 3.5v5.5M8 12.2v.3';
    else if (key === 'avoid') d = 'M4.5 4.5l7 7M11.5 4.5l-7 7';
    else if (key === 'unknown') d = 'M5.8 6.2a2.2 2.2 0 1 1 3.1 2c-.7.4-.9.8-.9 1.6M8 12.3v.2';
    else d = 'M4.5 8h7';
    var p = svgEl('path', stroke); p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  }

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function renderBadge(container, data) {
    var key = typeof (data && data.status) === 'string' ? data.status.trim().toLowerCase() : '';
    var status = resolveStatus(data && data.status);
    if (!STATUS_COPY[key]) key = 'indeterminate';

    // Rendered as a span, not an anchor: there is no public human-readable
    // Passport page to link to yet. When one exists, the endpoint can start
    // returning passportUrl and this becomes an <a> — until then the badge
    // must not look clickable while doing nothing.
    //
    // Two-segment seal: a fixed registry mark on the left, the evidence
    // state on the right. The mark never changes colour with the status, so
    // the brand and the verdict read as two separate facts.
    var wrap = el('span', {
      display: 'inline-flex',
      alignItems: 'stretch',
      fontFamily: FONT,
      lineHeight: '1.2',
      border: '1px solid #cbd3dc',
      borderRadius: '9px',
      overflow: 'hidden',
      background: '#ffffff',
      color: '#1f2328',
      boxShadow: '0 1px 2px rgba(15,23,42,0.08), 0 4px 14px rgba(15,23,42,0.06)',
      verticalAlign: 'middle'
    });

    var name = data && typeof data.name === 'string' && data.name ? data.name : null;
    wrap.setAttribute(
      'aria-label',
      'Software Passport Registry' + (name ? ' for ' + name : '') + ': ' + status.label
    );

    // Left segment: the registry mark on a deep navy gradient with a hairline
    // top highlight, so it reads as a physical plate rather than a flat fill.
    var mark = el('span', {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      padding: '8px 14px 8px 11px',
      background: 'linear-gradient(180deg, #16213d 0%, #0b1226 100%)',
      color: '#ffffff'
    });
    var sheen = el('span', { position: 'absolute', left: '0', right: '0', top: '0', height: '1px', background: 'rgba(255,255,255,0.14)' });
    sheen.setAttribute('aria-hidden', 'true');
    mark.appendChild(sheen);
    mark.appendChild(sprMark(30));
    var markText = el('span', { display: 'inline-flex', flexDirection: 'column', gap: '2px' });
    var markTop = el('span', { fontSize: '16px', fontWeight: '800', letterSpacing: '0.08em', lineHeight: '1', whiteSpace: 'nowrap' });
    markTop.textContent = 'SPR';
    var markBottom = el('span', { fontSize: '8.5px', fontWeight: '600', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8fa3c7', whiteSpace: 'nowrap' });
    markBottom.textContent = 'Software Passport Registry';
    markText.appendChild(markTop);
    markText.appendChild(markBottom);
    mark.appendChild(markText);

    // Right segment: a tinted state chip with a glyph, the label beside it,
    // provenance beneath. The tint is the status colour at low alpha so the
    // segment stays legible on any host background.
    var state = el('span', {
      display: 'inline-flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '3px',
      padding: '8px 14px 8px 12px',
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      whiteSpace: 'nowrap'
    });
    var stateRow = el('span', { display: 'inline-flex', alignItems: 'center', gap: '8px' });
    var chip = el('span', {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '22px',
      height: '22px',
      borderRadius: '6px',
      background: hexToRgba(status.color, 0.12),
      border: '1px solid ' + hexToRgba(status.color, 0.35),
      flexShrink: '0'
    });
    chip.setAttribute('aria-hidden', 'true');
    chip.appendChild(statusGlyph(key, status.color));
    var strong = el('strong', { fontSize: '14px', fontWeight: '700', color: status.color, letterSpacing: '0.01em' });
    // No score is rendered. The registry does not publish an authoritative
    // score (scoreStatus is 'not_authoritatively_scored'), and a number here
    // would read as one.
    strong.textContent = status.label;
    stateRow.appendChild(chip);
    stateRow.appendChild(strong);
    state.appendChild(stateRow);

    // Provenance, not a rating: how many independent sources the state rests
    // on. Omitted rather than shown as "0 sources" when the count is absent,
    // so a payload from an older server never renders a false negative.
    var sources = data && typeof data.independentSources === 'number' && data.independentSources >= 0 ? data.independentSources : null;
    var sub = el('span', { fontSize: '11px', color: '#57606a', paddingLeft: '30px' });
    if (sources !== null) {
      sub.textContent = sources + ' independent source' + (sources === 1 ? '' : 's');
    } else if (name) {
      sub.textContent = name;
    }
    if (sub.textContent) state.appendChild(sub);

    wrap.appendChild(mark);
    wrap.appendChild(state);
    container.appendChild(wrap);
  }

  function renderFallback(container) {
    var span = el('span', {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '12px',
      color: '#616161'
    });
    span.textContent = 'Software Passport Registry unavailable';
    container.appendChild(span);
  }

  function fetchBadge(url) {
    // Without a timeout a hung request leaves the badge slot permanently
    // empty, with neither the badge nor the fallback ever rendering.
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS)
      : null;

    return fetch(url, controller ? { signal: controller.signal, credentials: 'omit' } : { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('bad response');
        return r.json();
      })
      .then(function (data) {
        if (!data || typeof data !== 'object') throw new Error('bad payload');
        return data;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /**
   * The script element must be captured NOW, during synchronous execution.
   *
   * Reading scripts[scripts.length - 1] from inside a DOMContentLoaded
   * handler resolves to the last <script> in the whole document rather than
   * this one, so the badge renders in the wrong place or throws.
   * document.currentScript is the correct answer and is defer-safe; the
   * querySelector fallback covers module scripts, where it is null.
   */
  var thisScript =
    document.currentScript ||
    (function () {
      var tagged = document.querySelectorAll('script[data-passport-url]');
      return tagged.length ? tagged[tagged.length - 1] : null;
    })();

  if (!thisScript || !thisScript.parentNode) return;

  // Call back to whichever host served this script.
  try {
    if (thisScript.src) {
      selfOrigin = new URL(thisScript.src, document.baseURI).origin;
      API_ORIGIN = selfOrigin;
    }
  } catch (e) {
    /* keep DEFAULT_ORIGIN */
  }

  var badgeUrl = safeRegistryUrl(thisScript.getAttribute('data-passport-url'));
  if (!badgeUrl) return;

  // Insert the placeholder synchronously so the badge lands at the script's
  // own position in the document, whatever the DOM does afterwards.
  var container = document.createElement('span');
  thisScript.parentNode.insertBefore(container, thisScript.nextSibling);

  fetchBadge(badgeUrl)
    .then(function (data) { renderBadge(container, data); })
    .catch(function () { renderFallback(container); });
})();
