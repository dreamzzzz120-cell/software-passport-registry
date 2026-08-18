(() => {
  const script = document.currentScript;
  const root = script?.src ? new URL(script.src).origin : '';
  const apiBase = script?.dataset?.sprApi || root;
  document.querySelectorAll('[data-spr-passport]').forEach(async (el) => {
    const id = el.getAttribute('data-spr-passport');
    if (!id) return;
    const type = el.getAttribute('data-spr-widget') || 'badge';
    const destination = el.getAttribute('data-spr-href') || `${apiBase}/passport/${encodeURIComponent(id)}`;
    try {
      const response = await fetch(`${apiBase}/api/public/v1/passports/${encodeURIComponent(id)}/trust`);
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (type === 'score') {
        el.textContent = typeof data.score === 'number' ? String(data.score) : '—';
        return;
      }
      el.innerHTML = `<a href="${destination}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#0A1628;color:#D4AF37;border:1px solid #D4AF37;font:700 13px Inter,system-ui,sans-serif;text-decoration:none"><span>SPR</span><span>${typeof data.score === 'number' ? `Trust ${data.score}` : 'Trust Record'}</span></a>`;
    } catch {
      el.textContent = 'SPR Trust';
    }
  });
})();
