import { useEffect, useRef, useState } from 'react';
import { useGame, whisper, openWhisper, dreamSend, dreamClose, villageName } from '../store/game.ts';

/** Whisper: one line on the wind, no pause. Dream: a paused conversation with the chief. */
export function SpiritDialog() {
  const whisperFor = useGame(s => s.whisperFor); const dream = useGame(s => s.dream);
  if (dream) return <Dream />;
  if (whisperFor !== undefined) return <Whisper village={whisperFor} />;
  return null;
}

function Whisper({ village }: { village: number }) {
  const [text, setText] = useState(''); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const go = () => { whisper(village, text); setText(''); openWhisper(undefined); };
  return (
    <div className="modal-back" onClick={() => openWhisper(undefined)}>
      <div className="modal whisper" onClick={e => e.stopPropagation()}>
        <h3>Whisper to the chief of {villageName(village)}</h3>
        <p className="small muted">One line, carried on the wind. The chief hears it this week and answers in their own time. The game does not pause.</p>
        <form className="row" onSubmit={e => { e.preventDefault(); go(); }}><input ref={ref} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') openWhisper(undefined); }} placeholder="Rain will come with the summer. Plant now." maxLength={600} /><button type="submit" className="primary" disabled={!text.trim()}>Whisper</button></form>
      </div>
    </div>
  );
}

function Dream() {
  const dream = useGame(s => s.dream)!; const [text, setText] = useState(''); const ref = useRef<HTMLTextAreaElement>(null); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [dream.turns.length, dream.streaming]);
  const go = () => { if (!text.trim() || dream.busy) return; dreamSend(text); setText(''); };
  return (
    <div className="modal-back">
      <div className="modal dream">
        <div className="panel-head"><div><h3>A dream in {villageName(dream.village)}</h3><div className="small muted">Time stands still. What you claim here enters the chronicle; what comes true builds trust, what fails breaks it.</div></div>
          <button className="ghost" onClick={dreamClose} disabled={dream.busy || dream.closing}>{dream.closing ? 'Waking…' : 'End the dream'}</button></div>
        <div className="turns">
          {dream.turns.map((t, i) => <div key={i} className={`turn ${t.role}`}><div className="who">{t.role === 'spirit' ? 'You' : 'The chief'}</div><div>{t.text}</div></div>)}
          {dream.busy && <div className="turn chief"><div className="who">The chief</div><div>{dream.streaming || <span className="muted">…</span>}</div></div>}
          <div ref={end} />
        </div>
        <div className="compose">
          <textarea ref={ref} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } }} placeholder="Speak to the chief… (Enter to send, Shift+Enter for a new line)" rows={2} disabled={dream.busy || dream.closing} />
          <button className="primary" onClick={go} disabled={dream.busy || dream.closing || !text.trim()}>Speak</button>
        </div>
      </div>
    </div>
  );
}
