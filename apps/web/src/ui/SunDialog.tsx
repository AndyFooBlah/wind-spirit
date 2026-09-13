import { useEffect, useRef, useState } from 'react';
import { useGame, openSun, askSunSpirit, sunQuestionsLeft, tickLabel, SUN_QUESTIONS_A_YEAR } from '../store/game.ts';

/** The sun spirit: three questions a year to a voice that sees everything. The game does not pause; the answer is about the moment you asked. */
export function SunDialog() {
  const sun = useGame(s => s.sun); const left = useGame(sunQuestionsLeft);
  const [text, setText] = useState(''); const ref = useRef<HTMLTextAreaElement>(null); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sun.open) ref.current?.focus(); }, [sun.open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [sun.turns.length, sun.asking?.streaming]);
  if (!sun.open) return null;
  const go = () => { if (!text.trim() || sun.asking || left <= 0) return; askSunSpirit(text); setText(''); };
  return (
    <div className="modal-back" onClick={() => openSun(false)}>
      <div className="modal dream sun" onClick={e => e.stopPropagation()}>
        <div className="panel-head"><div><h3>The sun spirit</h3><div className="small muted">It sees every village, every store and every recipe, and the past. Ask why. {left} of {SUN_QUESTIONS_A_YEAR} questions left this year; the world keeps moving while it answers.</div></div>
          <button className="ghost" onClick={() => openSun(false)}>Close</button></div>
        <div className="turns">
          {!sun.turns.length && !sun.asking && <div className="muted">Nothing asked yet. Try: why is one village so much smaller than another, or why a chief does not trust you.</div>}
          {sun.turns.map((t, i) => <div key={i}><div className="turn spirit"><div className="who">You · {tickLabel(t.tick)}</div><div>{t.question}</div></div><div className="turn chief"><div className="who">The sun spirit</div><div className="prose">{t.answer}</div></div></div>)}
          {sun.asking && <div><div className="turn spirit"><div className="who">You</div><div>{sun.asking.question}</div></div><div className="turn chief"><div className="who">The sun spirit</div><div className="prose">{sun.asking.streaming || <span className="muted">listening to the world…</span>}</div></div></div>}
          <div ref={end} />
        </div>
        <div className="compose">
          <textarea ref={ref} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } if (e.key === 'Escape') openSun(false); }} placeholder={left > 0 ? 'Ask the sun spirit… (Enter to ask)' : 'No questions left this year; the new year brings three more.'} rows={2} disabled={left <= 0 || !!sun.asking} />
          <button className="primary" onClick={go} disabled={!!sun.asking || left <= 0 || !text.trim()}>Ask</button>
        </div>
      </div>
    </div>
  );
}
