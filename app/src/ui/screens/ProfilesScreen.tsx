import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../../data/db';
import type { Profile } from '../../types';

export function ProfilesScreen({ store, onSelect }: { store: Store; onSelect: (p: Profile) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { store.listProfiles().then(setProfiles); }, [store]);

  async function add(e: Event) {
    e.preventDefault();
    try {
      onSelect(await store.addProfile(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main class="stack">
      <h1>Кто занимается?</h1>
      {profiles.map(p => (
        <button key={p.id} class="list-item" onClick={() => onSelect(p)}>{p.name}</button>
      ))}
      <form class="stack" onSubmit={add}>
        <h2>{profiles.length ? 'Новый профиль' : 'Как вас зовут?'}</h2>
        <input type="text" value={name} placeholder="Имя" maxLength={30}
          onInput={e => setName((e.target as HTMLInputElement).value)} />
        <button class="primary" type="submit">Добавить</button>
        {error && <p class="error">{error}</p>}
      </form>
    </main>
  );
}
