import { useEffect, useRef, useState } from 'react';
import { btnGhost, btnPrimary, card, cx, STATUS_STYLE } from '../ui/styles';
import type { ChatMessage, ConversationState } from './conversationState';

const EXAMPLES = [
  "We're Northfield Goods. 1080 ceramic mugs at £5 each from Manchester to a warehouse in Frankfurt, 12 per carton, HS code 691200, 0.5kg each, made in the UK. 3 pallets, 620 kg, ready 5th Nov, appointment booked, cheapest please.",
  'I want to ship some tote bags to Paris',
];

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.role === 'user';
  return (
    <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('max-w-[92%] min-w-0 rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[85%]', mine ? 'rounded-br-sm bg-indigo-700 text-white' : 'rounded-bl-sm border border-slate-200 bg-white text-slate-900')}>
        <span className="sr-only">{mine ? 'You said: ' : 'Pre-Flight says: '}</span>
        {m.status && (
          <span className={cx('mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold', STATUS_STYLE[m.status].chip)}>
            <span aria-hidden="true">{STATUS_STYLE[m.status].icon}</span>
            {m.status}
          </span>
        )}
        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
        {m.changes && m.changes.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Changes">
            {m.changes.map((c, i) => (
              <li key={i} className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 font-mono text-xs text-indigo-950">
                <span aria-hidden="true">{c.kind === 'change' ? '⇄ ' : c.kind === 'clear' ? '✕ ' : '＋ '}</span>
                {c.text}
              </li>
            ))}
          </ul>
        )}
        {m.checkChanges && m.checkChanges.length > 0 && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-950">
            <p className="font-semibold">What changed in the checks</p>
            <ul className="list-disc pl-4">
              {m.checkChanges.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {m.summary && (
          <ul className="mt-2 space-y-0.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
            {m.summary.map((l, i) => (
              <li key={i}>• {l}</li>
            ))}
          </ul>
        )}
        {m.notes && m.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs italic text-slate-600">
            {m.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {m.warnings && m.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {m.warnings.map((w, i) => (
              <li key={i} className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950">
                <span aria-hidden="true">⚠ </span>
                {w}
              </li>
            ))}
          </ul>
        )}
        {m.questions && m.questions.length > 0 && (
          <ol className={cx('mt-2 space-y-1', m.questions.length > 1 ? 'list-decimal pl-5' : 'list-none')}>
            {m.questions.map((q, i) => (
              <li key={i} className="font-medium">{q}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function ChatWindow({ state, busy, onSend }: { state: ConversationState; busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'end' });
  }, [state.messages.length, busy]);

  const submit = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    setText('');
    onSend(v);
    boxRef.current?.focus();
  };

  const onlyGreeting = state.messages.length <= 1;
  return (
    <section className={cx(card, 'flex min-h-[26rem] flex-col')} aria-label="Chat">
      <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4" style={{ maxHeight: 'min(34rem, 60vh)' }} role="log" aria-live="polite" aria-relevant="additions">
        {state.messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {busy && (
          <div className="flex items-center gap-1 pl-2 text-slate-500" role="status" aria-label="Pre-Flight is thinking">
            {[0, 1, 2].map((i) => (
              <span key={i} className="pf-dot inline-block h-2 w-2 rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="space-y-2 border-t border-slate-200 p-3">
        {onlyGreeting && (
          <div className="flex flex-wrap gap-2" aria-label="Examples">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className={cx(btnGhost, 'max-w-full whitespace-normal text-left text-xs')} onClick={() => setText(e)}>
                Try: {e.length > 70 ? e.slice(0, 68) + '…' : e}
              </button>
            ))}
          </div>
        )}
        {state.phase === 'confirming' && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => submit('yes')} disabled={busy}>Yes, run the checks</button>
            <button type="button" className={btnGhost} onClick={() => submit('no')} disabled={busy}>No, change something</button>
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">Message Pre-Flight</label>
          <textarea
            id="chat-input"
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(text);
              }
            }}
            rows={2}
            maxLength={1500}
            placeholder={state.phase === 'results' ? 'Change anything: "add a pallet", "change it to Lyon", "undo"…' : 'Describe your shipment or answer the questions…'}
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className={btnPrimary} disabled={busy || !text.trim()}>Send</button>
        </form>
        <p className="text-xs text-slate-500">Say &quot;undo&quot; to revert the last change or &quot;start over&quot; to reset. Enter sends, Shift+Enter adds a line.</p>
      </div>
    </section>
  );
}
