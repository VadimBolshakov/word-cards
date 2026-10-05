import { useEffect, useMemo, useState } from 'preact/hooks';
import { audioUrlsFor } from '../../data/content';
import { audioStore, OfflineError } from '../../data/offline';
import { orderCards, selectForSet, type SetMode } from '../../domain/selection';
import type { Card } from '../../types';
import { countBuckets, ProgressBar } from '../components/ProgressBar';
import { useApp } from '../App';

type Download = { state: 'checking' | 'no' | 'yes' } | { state: 'loading'; done: number; total: number }
  | { state: 'error'; message: string };

export function SetScreen({ title, cards, allowModeChoice }: { title: string; cards: Card[]; allowModeChoice: boolean }) {
  const app = useApp();
  const [mode, setMode] = useState<SetMode>('all');
  const [download, setDownload] = useState<Download>({ state: 'checking' });
  // `cards` может быть новым массивом на каждый рендер, поэтому зависим от ключа из URL.
  const urlKey = audioUrlsFor(cards).join('|');
  const urls = useMemo(() => urlKey.split('|'), [urlKey]);

  useEffect(() => {
    audioStore.isDownloaded(urls).then(ok => setDownload({ state: ok ? 'yes' : 'no' }))
      .catch(() => setDownload({ state: 'no' }));
  }, [urlKey]);

  const selected = allowModeChoice && cards.length > 0
    ? selectForSet(cards, cards[0].set, mode, app.progress)
    : cards;
  const counts = countBuckets(cards, app.progress);

  function start(kind: 'card' | 'auto' | 'pocket') {
    const ordered = orderCards(selected, app.settings.order);
    if (kind === 'card') app.go({ name: 'card', title, cards: ordered });
    else app.go({ name: 'player', title, cards: ordered, mode: kind });
  }

  async function doDownload() {
    setDownload({ state: 'loading', done: 0, total: urls.length });
    try {
      await audioStore.download(urls, (done, total) => setDownload({ state: 'loading', done, total }));
      setDownload({ state: 'yes' });
    } catch (e) {
      setDownload({ state: 'error', message: e instanceof OfflineError ? e.message : String(e) });
    }
  }

  return (
    <main class="stack">
      <div class="topbar"><button class="icon" onClick={app.back}>←</button><h1>{title}</h1></div>

      <div>
        <span class="muted">Карточек: {cards.length} · выучено {counts.learned} · учу {counts.learning} · новых {counts.new}</span>
        <ProgressBar cards={cards} progress={app.progress} />
      </div>

      {allowModeChoice && (
        <div class="segmented">
          <button class={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>Весь набор</button>
          <button class={mode === 'newAndHard' ? 'on' : ''} onClick={() => setMode('newAndHard')}>Новые и трудные</button>
        </div>
      )}

      {selected.length === 0 ? (
        <p class="muted">Здесь нечего повторять — выберите «Весь набор».</p>
      ) : (
        <>
          <button class="primary" onClick={() => start('card')}>🃏 Карточки ({selected.length})</button>
          <button onClick={() => start('auto')}>▶ Автопоказ</button>
          <button onClick={() => start('pocket')}>🎧 В кармане</button>
        </>
      )}

      {download.state === 'yes' && <p class="muted">✓ Набор скачан — работает без интернета</p>}
      {download.state === 'no' && <button onClick={doDownload}>⬇ Скачать для офлайна</button>}
      {download.state === 'loading' && <p class="muted">Скачивание… {download.done} / {download.total}</p>}
      {download.state === 'error' && (
        <><p class="error">{download.message}</p><button onClick={doDownload}>Повторить</button></>
      )}
    </main>
  );
}
