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

  /**
   * SPR mark, drawn inline so the badge carries its own artwork onto any host
   * page: a white shield outline, a blue shield outline offset over it and
   * clipped to its right half, and a bold T. Each render gets its own clipPath
   * id so several badges on one page cannot share (and break) a clip.
   */
  function sprMark() {
    var svgNS = 'http://www.w3.org/2000/svg';
    var id = 'spr-mark-clip-' + (++markSerial);
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 26 26');
    svg.setAttribute('width', '26');
    svg.setAttribute('height', '26');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.flexShrink = '0';
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    var defs = document.createElementNS(svgNS, 'defs');
    var clip = document.createElementNS(svgNS, 'clipPath');
    clip.setAttribute('id', id);
    var rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', '13'); rect.setAttribute('y', '-2'); rect.setAttribute('width', '16'); rect.setAttribute('height', '30');
    clip.appendChild(rect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    var shieldD = 'M12 1.5 3.5 4.75v6.5c0 5.6 3.6 10.8 8.5 12.1 4.9-1.3 8.5-6.5 8.5-12.1v-6.5L12 1.5z';

    var white = document.createElementNS(svgNS, 'path');
    white.setAttribute('d', shieldD);
    white.setAttribute('fill', 'none');
    white.setAttribute('stroke', '#ffffff');
    white.setAttribute('stroke-width', '1.7');
    white.setAttribute('stroke-linejoin', 'round');

    var blue = document.createElementNS(svgNS, 'path');
    blue.setAttribute('d', shieldD);
    blue.setAttribute('transform', 'translate(2.5 2.5)');
    blue.setAttribute('fill', 'none');
    blue.setAttribute('stroke', '#3b82f6');
    blue.setAttribute('stroke-width', '1.7');
    blue.setAttribute('stroke-linejoin', 'round');
    blue.setAttribute('clip-path', 'url(#' + id + ')');

    var t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', '12');
    t.setAttribute('y', '16.2');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif');
    t.setAttribute('font-size', '12.5');
    t.setAttribute('font-weight', '800');
    t.setAttribute('fill', '#ffffff');
    t.textContent = 'T';

    svg.appendChild(white);
    svg.appendChild(blue);
    svg.appendChild(t);
    return svg;
  }

  function renderBadge(container, data) {
    var status = resolveStatus(data && data.status);
    var font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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
      fontFamily: font,
      lineHeight: '1.2',
      border: '1px solid #d0d7de',
      borderRadius: '6px',
      overflow: 'hidden',
      background: '#ffffff',
      color: '#1f2328',
      boxShadow: '0 1px 0 rgba(31,35,40,0.04)',
      verticalAlign: 'middle'
    });

    var name = data && typeof data.name === 'string' && data.name ? data.name : null;
    wrap.setAttribute(
      'aria-label',
      'Software Passport Registry' + (name ? ' for ' + name : '') + ': ' + status.label
    );

    // Left segment: the registry mark.
    var mark = el('span', {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '9px',
      padding: '6px 12px 6px 9px',
      background: '#0f172a',
      color: '#ffffff'
    });
    mark.appendChild(sprMark());
    var markText = el('span', { display: 'inline-flex', flexDirection: 'column', gap: '1px' });
    var markTop = el('span', {
      fontSize: '15px',
      fontWeight: '800',
      letterSpacing: '0.06em',
      lineHeight: '1',
      whiteSpace: 'nowrap'
    });
    markTop.textContent = 'SPR';
    var markBottom = el('span', {
      fontSize: '8.5px',
      fontWeight: '600',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: '#94a3b8',
      whiteSpace: 'nowrap'
    });
    markBottom.textContent = 'Software Passport Registry';
    markText.appendChild(markTop);
    markText.appendChild(markBottom);
    mark.appendChild(markText);

    // Right segment: the evidence state, with the status colour on the
    // leading edge so it reads even when the label is not.
    var state = el('span', {
      display: 'inline-flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '2px',
      padding: '7px 12px 7px 11px',
      borderLeft: '3px solid ' + status.color,
      whiteSpace: 'nowrap'
    });
    var stateRow = el('span', { display: 'inline-flex', alignItems: 'center', gap: '6px' });
    var dot = el('span', {
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: status.color,
      flexShrink: '0'
    });
    dot.setAttribute('aria-hidden', 'true');
    var strong = el('strong', { fontSize: '13px', fontWeight: '700', color: status.color, letterSpacing: '0.01em' });
    // No score is rendered. The registry does not publish an authoritative
    // score (scoreStatus is 'not_authoritatively_scored'), and a number here
    // would read as one.
    strong.textContent = status.label;
    stateRow.appendChild(dot);
    stateRow.appendChild(strong);
    state.appendChild(stateRow);

    // Provenance, not a rating: how many independent sources the state rests
    // on. Omitted rather than shown as "0 sources" when the count is absent,
    // so a payload from an older server never renders a false negative.
    var sources = data && typeof data.independentSources === 'number' && data.independentSources >= 0 ? data.independentSources : null;
    var sub = el('span', { fontSize: '11px', color: '#57606a' });
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
