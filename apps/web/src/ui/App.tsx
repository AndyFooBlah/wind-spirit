import { useEffect } from 'react';
import { setTechOpen } from '../store/game.ts';
import { useGame, dismissToast, focusVillage, installGlobalHandlers, updateSettings, setSpeed, dismissQuotaNotice } from '../store/game.ts';
import { MapCanvas } from '../map/MapCanvas.tsx';
import { Gallery } from './Gallery.tsx';
import { TopBar, HistoryBar } from './TopBar.tsx';
import { VillagePanel } from './VillagePanel.tsx';
import { SpiritDialog } from './SpiritDialog.tsx';
import { InviteGate } from './InviteGate.tsx';
import { Overview } from './Overview.tsx';
import { SunDialog } from './SunDialog.tsx';
import { TechTree } from './TechTree.tsx';

export function App() {
  return <InviteGate><Game /></InviteGate>;
}

function Game() {
  const techOpen = useGame(s => s.techOpen);
  const screen = useGame(s => s.screen); const loading = useGame(s => s.loading);
  useEffect(() => { installGlobalHandlers(); }, []);
  if (screen === 'gallery') return <Gallery />;
  return (
    <div className="game">
      <TopBar />
      <HistoryBar />
      <div className="main">
        <MapCanvas />
        <VillagePanel />
      </div>
      {loading && <div className="loading">{loading}</div>}
      <QuotaNotice />
      <Toasts />
      <SpiritDialog />
      <Overview />
      <SunDialog />
      {techOpen && <TechTree onClose={() => setTechOpen(false)} />}
    </div>
  );
}

function Toasts() {
  const toasts = useGame(s => s.toasts);
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => { if (t.village !== undefined) focusVillage(t.village); dismissToast(t.id); }}>
          {t.kind === 'attention' && <div className="small strong">Paused</div>}
          <div>{t.text}</div>
          {t.kind === 'attention' && t.event && (
            <button className="ghost small" onClick={e => { e.stopPropagation(); const s = useGame.getState(); updateSettings({ autoPause: { ...s.settings.autoPause, [t.event!]: false } }); dismissToast(t.id); setSpeed(s.resumeSpeed ?? 'normal'); }} title="Turn off pausing for this kind of event (Settings restores it)">Stop pausing for this</button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The day's thinking budget is spent. Chiefs keep going on habit, so say so rather than letting them go quiet. */
function QuotaNotice() {
  const quota = useGame(s => s.quotaSpent);
  if (!quota) return null;
  const when = quota.resetAt ? new Date(quota.resetAt) : undefined;
  return (
    <div className="quota-notice">
      <div><span className="strong">The chiefs are thinking for themselves today.</span> This world has used its day's share of the model, so every chief now acts on habit: the sim runs on, the journals go quiet.{when ? ` It comes back at ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</div>
      <button className="ghost" onClick={dismissQuotaNotice}>Understood</button>
    </div>
  );
}
