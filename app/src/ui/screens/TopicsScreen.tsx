import { useApp } from '../App';

export function TopicsScreen() {
  const app = useApp();
  return (
    <main>
      <div class="topbar"><h1>Темы</h1><button class="icon" onClick={() => app.go({ name: 'settings' })}>⚙</button></div>
      <p class="muted">Экран тем — Task 14. Тем: {app.index.topics.length}</p>
    </main>
  );
}
