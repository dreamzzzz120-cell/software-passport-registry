/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global feedback widget: the backend (POST/GET /api/feedback,
 * src/routes/feedback.ts) has existed since the founder-command-center
 * work but had no UI to actually submit from -- this is that UI. Mounted
 * once in CommandCenter so it is available from every authenticated page.
 */
import { useState } from 'react';
import { MessageSquarePlus, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Sentiment = 'like' | 'dislike' | 'neutral';
type Category = 'bug' | 'complaint' | 'suggestion' | 'general';

const CATEGORIES: Array<{ value: Category; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'bug', label: 'Something broken' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'complaint', label: 'Complaint' },
];

export default function FeedbackWidget({ currentPath }: { currentPath: string }) {
  const [open, setOpen] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment>('neutral');
  const [category, setCategory] = useState<Category>('general');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const reset = () => { setSentiment('neutral'); setCategory('general'); setMessage(''); setError(''); setSent(false); };
  const close = () => { setOpen(false); reset(); };

  const submit = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true); setError('');
    try {
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentiment, category, page: currentPath, message: message.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Unable to send feedback.');
      }
      setSent(true);
      setTimeout(close, 1400);
    } catch (cause: any) {
      setError(cause?.message || 'Unable to send feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Send feedback about SPR"
        aria-label="Send feedback"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-2.5 text-xs font-semibold text-[var(--spr-text)] shadow-lg hover:border-[var(--spr-highlight)]/50 hover:text-[var(--spr-highlight)]"
      >
        <MessageSquarePlus className="h-4 w-4" /> Feedback
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={close}>
      <div className="w-full max-w-sm rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.16em] text-[var(--spr-highlight)]"><MessageSquarePlus className="h-3.5 w-3.5" /> Feedback</div>
            <h2 id="feedback-title" className="mt-1 text-sm font-bold text-[var(--spr-text)]">What's on your mind?</h2>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-md p-1 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)]"><X className="h-4 w-4" /></button>
        </div>

        {sent ? (
          <p className="mt-4 text-sm text-[var(--spr-green)]">Sent. Thanks — this goes straight to the team.</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setSentiment(sentiment === 'like' ? 'neutral' : 'like')} aria-pressed={sentiment === 'like'} title="Like" className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold ${sentiment === 'like' ? 'border-[var(--spr-green)] text-[var(--spr-green)] bg-[var(--spr-green)]/10' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}><ThumbsUp className="h-3.5 w-3.5" /> Like</button>
              <button type="button" onClick={() => setSentiment(sentiment === 'dislike' ? 'neutral' : 'dislike')} aria-pressed={sentiment === 'dislike'} title="Dislike" className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold ${sentiment === 'dislike' ? 'border-[var(--spr-red)] text-[var(--spr-red)] bg-[var(--spr-red)]/10' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}><ThumbsDown className="h-3.5 w-3.5" /> Dislike</button>
            </div>

            <select value={category} onChange={(event) => setCategory(event.target.value as Category)} aria-label="Feedback category" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">
              {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>

            <textarea
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Tell us what happened..."
              rows={4}
              maxLength={4000}
              aria-label="Feedback message"
              className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-xs text-[var(--spr-text)] placeholder:text-[var(--spr-text-faint)]"
            />

            {error && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
              <button type="button" onClick={() => void submit()} disabled={!message.trim() || submitting} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40">
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
