import { useRef, useState } from 'preact/hooks';
import { ImportError } from '../../data/db';
import { todayISO } from '../../domain/dates';
import type { Settings } from '../../types';
import { useApp } from '../App';

function Segmented<T extends string | number | boolean>(
  { value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void },
) {
  return (
    <div class="segmented">
      {options.map(([v, label]) => (
        <button key={String(v)} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function SettingsScreen() {
  const app = useApp();
  const s = app.settings;
  const [message, setMessage] = useState('');
  // Каждое изменение строим от последних настроек (ref), чтобы два быстрых нажатия не затёрли друг друга.
  const latest = useRef(s);
  latest.current = s;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    latest.current = { ...latest.current, [key]: value };
    app.saveSettings(latest.current).catch(err => setMessage(`Не удалось сохранить настройки: ${err}`));
  };

  async function exportProgress() {
    try {
      const json = await app.store.exportProfile(app.profile.id);
      const name = `word-cards-${app.profile.name}-${todayISO()}.json`;
      const file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Резервная копия карточек' });
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
        }
        return;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setMessage(`Не удалось сохранить файл: ${err}`);
    }
  }

  async function importProgress(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let profile;
    try {
      profile = await app.store.importProfile(await file.text());
    } catch (err) {
      setMessage(err instanceof ImportError ? err.message : `Ошибка импорта: ${err}`);
      return;
    }
    setMessage(`Восстановлен профиль «${profile.name}»`);
    if (profile.id === app.profile.id) {
      try {
        await app.reloadProfile();
      } catch (err) {
        setMessage(`Восстановлен профиль «${profile.name}», но обновить экран не удалось (${err}). Перезапустите приложение.`);
      }
    }
  }

  async function deleteProfile() {
    if (!confirm(`Удалить профиль «${app.profile.name}» и весь его прогресс?`)) return;
    try {
      await app.store.deleteProfile(app.profile.id);
      app.switchProfile();
    } catch (err) {
      setMessage(`Не удалось удалить профиль: ${err}`);
    }
  }

  return (
    <main class="stack">
      <div class="topbar"><button class="icon" onClick={app.back}>←</button><h1>Настройки</h1></div>

      <h2>Пауза между этапами</h2>
      <Segmented<Settings['pauseSec']> value={s.pauseSec} onChange={v => set('pauseSec', v)}
        options={[[3, '3 с'], [5, '5 с'], [8, '8 с'], [10, '10 с']]} />

      <h2>Направление</h2>
      <Segmented<Settings['direction']> value={s.direction} onChange={v => set('direction', v)}
        options={[['en-ru', 'EN → RU'], ['ru-en', 'RU → EN']]} />

      <h2>Порядок карточек</h2>
      <Segmented<Settings['order']> value={s.order} onChange={v => set('order', v)}
        options={[['seq', 'Подряд'], ['shuffle', 'Вперемешку']]} />

      <h2>Повтор английского</h2>
      <Segmented<Settings['enRepeat']> value={s.enRepeat} onChange={v => set('enRepeat', v)} options={[[1, '1 раз'], [2, '2 раза']]} />

      <h2>Скорость речи</h2>
      <Segmented<Settings['rate']> value={s.rate} onChange={v => set('rate', v)} options={[[0.8, '0.8×'], [1, '1×'], [1.2, '1.2×']]} />

      <h2>Когда набор закончился</h2>
      <Segmented<Settings['loop']> value={s.loop} onChange={v => set('loop', v)} options={[[false, 'Стоп'], [true, 'По кругу']]} />

      <h2>Профиль: {app.profile.name}</h2>
      <button onClick={exportProgress}>Сохранить прогресс в файл</button>
      <label class="btn" style={{ textAlign: 'center' }}>
        Восстановить из файла
        <input type="file" accept="application/json,.json" hidden onChange={importProgress} />
      </label>
      {message && <p class="muted">{message}</p>}
      <button onClick={app.switchProfile}>Сменить профиль</button>
      <button onClick={deleteProfile} style={{ color: 'var(--bad)' }}>Удалить профиль</button>
    </main>
  );
}
