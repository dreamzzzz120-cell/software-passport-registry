const STORAGE_KEY = 'spr-analytics-session';
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

export function trackPageView(path = `${window.location.pathname}${window.location.search}`) {
  if (!path || path.length > 500) return;
  const payload = JSON.stringify({ sessionId: sessionId(), path, referrer: document.referrer || null, deviceType: deviceType() });
  const body = new Blob([payload], { type: 'application/json' });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/traffic/event', body);
    return;
  }
  void fetch('/api/traffic/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}

export function installPageViewTracking() {
  trackPageView();
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
