import { todayISO } from '../../domain/dates';
import { selectDue } from '../../domain/selection';
import { ProgressBar } from '../components/ProgressBar';
import { useApp } from '../App';

export function TopicsScreen() {
  const app = useApp();
  const all = [...app.cardsByTopic.values()].flat();
  const due = selectDue(all, app.progress, todayISO()).length;

  return (
    <main class="stack">
      <div class="topbar">
        <h1>Привет, {app.profile.name}!</h1>
        <button class="icon" aria-label="Настройки" onClick={() => app.go({ name: 'settings' })}>⚙</button>
      </div>

      <button class="primary" disabled={due === 0} onClick={() => app.go({ name: 'due' })}>
        📅 Повторение на сегодня{due ? ` (${due})` : ' — пока нечего'}
      </button>

      {app.index.topics.map(topic => {
        const cards = app.cardsByTopic.get(topic.id) ?? [];
        return (
          <section key={topic.id}>
            <h2>{topic.title}</h2>
            {topic.description && <p class="muted" style={{ marginTop: 0 }}>{topic.description}</p>}
            <div class="chips">
              {topic.sets.map(set => (
                <button key={set.n} class="chip"
                  onClick={() => app.go({ name: 'set', topicId: topic.id, setN: set.n })}>
                  Набор {set.n} <span class="muted">· {set.count}</span>
                  <ProgressBar cards={cards.filter(c => c.set === set.n)} progress={app.progress} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
