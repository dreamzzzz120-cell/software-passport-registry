/**
 * Software Passport Registry — Embeddable Badge
 *
 * Usage (the signed URL is generated for the MSP in-app; it is not guessable
 * and it is not derived from a slug):
 *
 *   <script src="https://softwarepassportregistry.com/badge.js"
 *           data-passport-url="https://softwarepassportregistry.com/badge/v1/<id>/<token>"></script>
 *
 * Renders inline at the exact point the <script> tag sits in the page.
 * No dependencies, no cookies, no tracking beyond the single GET below.
 */
(function () {
  // Resolved from this script's own src below, so the badge always calls back
  // to whatever host served it -- a custom MSP domain, a CDN alias or staging
  // all work without a rebuild. This constant is only the fallback for the
  // case where the script element carries no usable src.
  var DEFAULT_ORIGIN = 'https://softwarepassportregistry.com';
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

  function renderBadge(container, data) {
    var status = resolveStatus(data && data.status);

    // Rendered as a span, not an anchor: there is no public human-readable
    // Passport page to link to yet. When one exists, the endpoint can start
    // returning passportUrl and this becomes an <a> — until then the badge
    // must not look clickable while doing nothing.
    var wrap = el('span', {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: '#ffffff',
      border: '1px solid #e1dfdd',
      borderRadius: '6px',
      padding: '8px 12px',
      color: '#201f1e'
    });

    var name = data && typeof data.name === 'string' && data.name ? data.name : null;
    wrap.setAttribute(
      'aria-label',
      'Software Passport' + (name ? ' for ' + name : '') + ': ' + status.label
    );
    var dot = el('span', {
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: status.color,
      flexShrink: '0'
    });
    dot.setAttribute('aria-hidden', 'true');

    var text = el('span', { fontSize: '13px' });
    var strong = el('strong', { fontWeight: '600' });
    // No score is rendered. The registry does not publish an authoritative
    // score (scoreStatus is 'not_authoritatively_scored'), and a number here
    // would read as one.
    strong.textContent = status.label;
    var small = el('span', { color: '#616161', marginLeft: '6px', fontSize: '12px' });
    small.textContent = 'Software Passport';
    text.appendChild(strong);
    text.appendChild(small);

    wrap.appendChild(dot);
    wrap.appendChild(text);
    container.appendChild(wrap);
  }

  function renderFallback(container) {
    var span = el('span', {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '12px',
      color: '#616161'
    });
    span.textContent = 'Software Passport unavailable';
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
