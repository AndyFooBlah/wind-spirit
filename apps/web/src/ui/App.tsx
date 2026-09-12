import { useEffect } from 'react';
import { useGame, dismissToast, focusVillage, installGlobalHandlers } from '../store/game.ts';
import { MapCanvas } from '../map/MapCanvas.tsx';
import { Gallery } from './Gallery.tsx';
import { TopBar, HistoryBar } from './TopBar.tsx';
import { VillagePanel } from './VillagePanel.tsx';
import { SpiritDialog } from './SpiritDialog.tsx';

export function App() {
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
      <Toasts />
      <SpiritDialog />
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
        </div>
      ))}
    </div>
  );
}
