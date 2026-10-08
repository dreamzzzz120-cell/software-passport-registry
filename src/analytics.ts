const STORAGE_KEY = 'spr-analytics-session';
const ATTRIBUTION_KEY = 'spr-growth-attribution-v1';
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_RE = /^[A-Za-z0-9_-]{16,80}$/;

function sessionId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && SESSION_RE.test(existing)) return existing;
    const value = `${crypto.randomUUID().replaceAll('-', '')}${Date.now().toString(36)}`.slice(0, 48);
    window.localStorage.setItem(STORAGE_KEY, value);
    return value;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32).padEnd(16, '0');
  }
}

function deviceType(): 'mobile' | 'tablet' | 'desktop' | 'unknown' {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

type Attribution = { source: string | null; medium: string | null; campaign: string | null; referralCode: string | null; capturedAt: number };

function readCurrentAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const source = params.get('utm_source') || params.get('src');
  const medium = params.get('utm_medium');
  const campaign = params.get('utm_campaign');
  const referralCode = params.get('ref');
  return {
    source: source?.slice(0,120) || null,
    medium: medium?.slice(0,120) || null,
    campaign: campaign?.slice(0,160) || null,
    referralCode: referralCode?.slice(0,80) || null,
    capturedAt: Date.now(),
  };
}

function attribution() {
  const current = readCurrentAttribution();
  const hasCurrent = Boolean(current.source || current.medium || current.campaign || current.referralCode);
  try {
    if (hasCurrent) {
      window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(current));
      return current;
    }
    const raw = window.localStorage.getItem(ATTRIBUTION_KEY);
    if (!raw) return current;
    const saved = JSON.parse(raw) as Partial<Attribution>;
    if (typeof saved.capturedAt !== 'number' || Date.now() - saved.capturedAt > ATTRIBUTION_TTL_MS) {
      window.localStorage.removeItem(ATTRIBUTION_KEY);
      return current;
    }
    return {
      source: typeof saved.source === 'string' ? saved.source.slice(0,120) : null,
      medium: typeof saved.medium === 'string' ? saved.medium.slice(0,120) : null,
      campaign: typeof saved.campaign === 'string' ? saved.campaign.slice(0,160) : null,
      referralCode: typeof saved.referralCode === 'string' ? saved.referralCode.slice(0,80) : null,
      capturedAt: saved.capturedAt,
    };
  } catch {
    return current;
  }
}

function sendEvent(eventName: string, path: string) {
  if (!path || path.length > 500) return;
  const payload = JSON.stringify({ sessionId: sessionId(), path, referrer: document.referrer || null, deviceType: deviceType(), eventName, ...attribution() });
  // Use fetch so HTTP failures are observable. sendBeacon returning true only
  // means the browser queued the request; it does not mean the API stored it.
  // keepalive lets the request continue during navigation without a blind retry
  // that might double-count events accepted before a network error.
  void fetch('/api/traffic/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: true,
  }).then((response) => {
    if (!response.ok) {
      console.warn('[SPR traffic] Event not accepted by API', response.status);
    }
  }).catch(() => {
    console.warn('[SPR traffic] Event delivery could not be confirmed');
  });
}

export function trackPageView(path = `${window.location.pathname}${window.location.search}`) {
  sendEvent('page_view', path);
}

export function trackGrowthEvent(eventName: 'free_review_started'|'free_review_completed'|'lead_captured'|'pricing_view'|'signup_started'|'signup_completed'|'pilot_started'|'customer_created'|'registry_claim_clicked'|'registry_share_clicked'|'referral_visit'|'report_viewed'|'upgrade_clicked'|'checkout_started'|'checkout_failed', path = `${window.location.pathname}${window.location.search}`) {
  sendEvent(eventName, path);
}

export function installPageViewTracking() {
  trackPageView();
  const params = new URLSearchParams(window.location.search);
  if (params.get('src') === 'registry-claim') trackGrowthEvent('registry_claim_clicked');
  if (params.get('ref')) trackGrowthEvent('referral_visit');
  let last = window.location.href;
  const check = () => {
    if (window.location.href !== last) {
      last = window.location.href;
      trackPageView();
    }
  };
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function (...args) { const result = originalPush.apply(this, args); check(); return result; };
  history.replaceState = function (...args) { const result = originalReplace.apply(this, args); check(); return result; };
  window.addEventListener('popstate', check);
}
