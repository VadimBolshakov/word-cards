# Word Cards PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Личное PWA для изучения английского по карточкам с озвучкой EN/RU, ручным режимом, автопоказом и режимом «в кармане» (экран выключен), с прогрессом по Лейтнеру на телефоне.

**Architecture:** Контент — CSV в `content/`. Python-скрипт `tools/build_content.py` валидирует CSV, генерирует mp3 через `edge-tts` (только новые) и пишет JSON в `app/public/content/`. PWA (Vite + Preact + TS) загружает JSON, хранит профили/настройки/прогресс в IndexedDB, проигрывает «сценарий» шагов через один `<audio>`. Деплой — GitHub Actions → GitHub Pages.

**Tech Stack:** Python 3.13, edge-tts, lameenc, pytest · Node 24, Vite, TypeScript, Preact, vite-plugin-pwa, idb, Vitest, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-10-05-word-cards-design.md`

## Global Constraints

- Основная платформа: iPhone, iOS 17+, PWA установлено на главный экран через Safari.
- CSV: UTF-8 (BOM допускается), разделитель `;`, первая строка — заголовок.
- `topics.csv`: колонки `id;title;description;order;en_voice;ru_voice`.
- `<topic-id>.csv`: колонки `id;set;en;ru;en_ex;ru_ex`. `id` карточки уникален глобально.
- Голоса по умолчанию: `en-US-AriaNeural`, `ru-RU-SvetlanaNeural`.
- Аудио: mp3, моно, 24 кГц, 48 кбит/с. Имя — первые 12 hex-символов sha1 → `audio/<hash>.mp3`. Пауза между словом и примером внутри файла — 0.6 с.
- Файлы тишины: `audio/silence_{1,3,5,8,10}s.mp3`.
- Лейтнер: box 0–5, интервалы (дни) по box: 1→1, 2→3, 3→7, 4→14, 5→30. «Знаю»: `box=min(box+1,5)`. «Повторить»/⭐: `box=1`, `nextDue=завтра`. Новые=box 0, учу=1–4, выучено=5.
- Настройки: пауза 3/5/8/10 с; направление `en-ru`/`ru-en`; порядок `seq`/`shuffle`; повтор английского 1/2; скорость 0.8/1/1.2; повтор набора по кругу (да/нет).
- Воспроизведение стартует только по нажатию пользователя.
- Все тексты интерфейса — на русском.
- Команды в плане — для Git Bash на Windows; Python из venv: `.venv/Scripts/python`.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

```
.gitignore
content/
  topics.csv                      список тем
  <topic-id>.csv                  карточки темы
tools/
  requirements.txt
  build_content.py                CLI: тонкая обёртка над cardbuild.build
  cardbuild/
    __init__.py
    model.py                      Topic, Card, голоса по умолчанию
    csvload.py                    чтение + валидация CSV → ContentError
    audio.py                      ключи аудио, задания, план генерации/удаления
    tts.py                        edge-tts синтез, тишина (lameenc), ретраи, параллельная генерация
    output.py                     формирование JSON (index + темы)
    build.py                      run_build(): весь конвейер
  tests/
    test_csvload.py  test_audio.py  test_tts.py  test_build.py
app/
  package.json  tsconfig.json  vite.config.ts  index.html
  public/content/                 генерируется скриптом (коммитится)
  public/icon-192.png  public/icon-512.png
  src/
    main.tsx  styles.css
    types.ts                      общие типы: контент, прогресс, настройки, профиль
    domain/
      dates.ts                    todayISO, addDays
      leitner.ts                  applyAnswer, markStarred, isDue, bucket
      selection.ts                selectForSet, selectDue, orderCards
      sequence.ts                 buildSequence, cardStartStep
    data/
      content.ts                  loadIndex, loadTopic, audio URL
      db.ts                       IndexedDB: профили, настройки, прогресс, экспорт/импорт
      offline.ts                  кэш аудио: resolveAudio, downloadUrls, isDownloaded
    player/
      AudioEngine.ts              проигрывание сценария, Media Session, ретраи
    ui/
      App.tsx                     навигация между экранами, текущий профиль
      screens/ProfilesScreen.tsx TopicsScreen.tsx SetScreen.tsx CardScreen.tsx PlayerScreen.tsx SettingsScreen.tsx
      components/ProgressBar.tsx
  tests/ (рядом с кодом: *.test.ts)
.github/workflows/deploy.yml
docs/iphone-checklist.md
```

## Порядок работ

1. Задачи 1–4: конвейер контента (Python) + стартовая тема.
2. Задачи 5–9: каркас приложения, доменная логика, аудиодвижок.
3. Задача 10–11: загрузка контента/офлайн, прототип плеера, деплой → **контрольная точка на iPhone** (фоновое аудио — главный риск).
4. Задачи 12–16: база данных и все экраны.
5. Задачи 17–18: наполнение тем, финальная проверка на iPhone.

---

### Task 1: Python-окружение, модель и валидация CSV

**Files:**
- Create: `.gitignore`, `tools/requirements.txt`, `tools/cardbuild/__init__.py`, `tools/cardbuild/model.py`, `tools/cardbuild/csvload.py`
- Test: `tools/tests/test_csvload.py`

**Interfaces:**
- Produces: `Topic(id, title, description, order, en_voice, ru_voice)`, `Card(id, topic_id, set, en, ru, en_ex, ru_ex)` (frozen dataclasses); `DEFAULT_EN_VOICE`, `DEFAULT_RU_VOICE`; `ContentError(errors: list[str])` с полем `.errors`; `load_content(content_dir: Path) -> tuple[list[Topic], dict[str, list[Card]]]` (темы отсортированы по `order`).

- [ ] **Step 1: Окружение**

`.gitignore`:
```
.venv/
__pycache__/
.pytest_cache/
node_modules/
app/dist/
*.tmp
```

`tools/requirements.txt`:
```
edge-tts>=7.0
lameenc>=1.7
pytest>=8.0
```

`tools/cardbuild/__init__.py` — пустой файл.

Run:
```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r tools/requirements.txt
```
Expected: `Successfully installed ... edge-tts ... lameenc ... pytest ...`

- [ ] **Step 2: Модель**

`tools/cardbuild/model.py`:
```python
from dataclasses import dataclass

DEFAULT_EN_VOICE = "en-US-AriaNeural"
DEFAULT_RU_VOICE = "ru-RU-SvetlanaNeural"


@dataclass(frozen=True)
class Topic:
    id: str
    title: str
    description: str
    order: int
    en_voice: str = DEFAULT_EN_VOICE
    ru_voice: str = DEFAULT_RU_VOICE


@dataclass(frozen=True)
class Card:
    id: str
    topic_id: str
    set: int
    en: str
    ru: str
    en_ex: str = ""
    ru_ex: str = ""
```

- [ ] **Step 3: Написать падающие тесты**

`tools/tests/test_csvload.py`:
```python
from pathlib import Path

import pytest

from cardbuild.csvload import ContentError, load_content
from cardbuild.model import DEFAULT_EN_VOICE, DEFAULT_RU_VOICE

TOPICS_HEADER = "id;title;description;order;en_voice;ru_voice\n"
CARDS_HEADER = "id;set;en;ru;en_ex;ru_ex\n"


def write(d: Path, name: str, text: str, encoding: str = "utf-8") -> None:
    (d / name).write_text(text, encoding=encoding)


def make_valid(d: Path) -> None:
    write(d, "topics.csv", TOPICS_HEADER
          + "verbs;Глаголы;Описание;2;;\n"
          + "words;Слова;;1;en-GB-SoniaNeural;\n")
    write(d, "verbs.csv", CARDS_HEADER + "v1;1;get up;вставать;I get up at seven.;Я встаю в семь.\n")
    write(d, "words.csv", CARDS_HEADER + "w1;1;cat;кошка;;\n\n" + "w2;2;dog;собака;;\n")


def errors_of(d: Path) -> list[str]:
    with pytest.raises(ContentError) as exc:
        load_content(d)
    return exc.value.errors


def test_loads_valid_content_sorted_by_order(tmp_path):
    make_valid(tmp_path)
    topics, cards = load_content(tmp_path)
    assert [t.id for t in topics] == ["words", "verbs"]
    assert topics[0].en_voice == "en-GB-SoniaNeural"
    assert topics[0].ru_voice == DEFAULT_RU_VOICE
    assert topics[1].en_voice == DEFAULT_EN_VOICE
    assert [c.id for c in cards["words"]] == ["w1", "w2"]
    v1 = cards["verbs"][0]
    assert (v1.topic_id, v1.set, v1.en, v1.ru, v1.en_ex, v1.ru_ex) == (
        "verbs", 1, "get up", "вставать", "I get up at seven.", "Я встаю в семь.")


def test_accepts_utf8_bom(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "w1;1;cat;кошка;;\n", encoding="utf-8-sig")
    _, cards = load_content(tmp_path)
    assert cards["words"][0].ru == "кошка"


def test_rejects_non_utf8(tmp_path):
    make_valid(tmp_path)
    (tmp_path / "words.csv").write_bytes((CARDS_HEADER + "w1;1;cat;кошка;;\n").encode("cp1251"))
    assert any("words.csv" in e and "UTF-8" in e for e in errors_of(tmp_path))


def test_rejects_bad_header(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", "id;en;ru\nw1;cat;кошка\n")
    assert any(e.startswith("words.csv:1:") for e in errors_of(tmp_path))


def test_rejects_wrong_column_count(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "w1;1;cat;кошка\n")
    assert any(e.startswith("words.csv:2:") for e in errors_of(tmp_path))


def test_rejects_duplicate_card_id_across_topics(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "v1;1;cat;кошка;;\n")
    errs = errors_of(tmp_path)
    assert any("words.csv:2:" in e and "v1" in e for e in errs)


def test_rejects_non_integer_set(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "w1;one;cat;кошка;;\n")
    assert any("words.csv:2:" in e and "set" in e for e in errors_of(tmp_path))


def test_rejects_zero_set(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "w1;0;cat;кошка;;\n")
    assert any("words.csv:2:" in e for e in errors_of(tmp_path))


def test_rejects_empty_en_or_ru(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "w1;1;;кошка;;\nw2;1;dog;;;\n")
    errs = errors_of(tmp_path)
    assert any("words.csv:2:" in e for e in errs)
    assert any("words.csv:3:" in e for e in errs)


def test_rejects_bad_card_id(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER + "w 1;1;cat;кошка;;\n")
    assert any("words.csv:2:" in e and "id" in e for e in errors_of(tmp_path))


def test_rejects_missing_topic_file(tmp_path):
    make_valid(tmp_path)
    (tmp_path / "verbs.csv").unlink()
    assert any("verbs.csv" in e for e in errors_of(tmp_path))


def test_rejects_orphan_csv(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "extra.csv", CARDS_HEADER + "x1;1;a;б;;\n")
    assert any(e.startswith("extra.csv:") for e in errors_of(tmp_path))


def test_rejects_empty_topic(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "words.csv", CARDS_HEADER)
    assert any("words.csv" in e and "нет карточек" in e for e in errors_of(tmp_path))


def test_rejects_bad_topic_rows(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "topics.csv", TOPICS_HEADER
          + "words;Слова;;x;;\n"
          + "words;Слова;;1;;\n"
          + "verbs;;;2;;\n")
    errs = errors_of(tmp_path)
    assert any(e.startswith("topics.csv:2:") and "order" in e for e in errs)
    assert any(e.startswith("topics.csv:4:") and "title" in e for e in errs)


def test_rejects_duplicate_topic_id(tmp_path):
    make_valid(tmp_path)
    write(tmp_path, "topics.csv", TOPICS_HEADER
          + "words;Слова;;1;;\nwords;Ещё;;2;;\nverbs;Глаголы;;3;;\n")
    assert any(e.startswith("topics.csv:3:") for e in errors_of(tmp_path))


def test_missing_topics_csv(tmp_path):
    assert any("topics.csv" in e for e in errors_of(tmp_path))
```

- [ ] **Step 4: Убедиться, что тесты падают**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_csvload.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardbuild.csvload'`

- [ ] **Step 5: Реализация**

`tools/cardbuild/csvload.py`:
```python
import csv
import re
from pathlib import Path

from .model import DEFAULT_EN_VOICE, DEFAULT_RU_VOICE, Card, Topic

TOPIC_COLUMNS = ["id", "title", "description", "order", "en_voice", "ru_voice"]
CARD_COLUMNS = ["id", "set", "en", "ru", "en_ex", "ru_ex"]
ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class ContentError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = list(errors)


def _read_rows(path: Path, columns: list[str], errors: list[str]) -> list[tuple[int, dict[str, str]]]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        errors.append(f"{path.name}: файл не в кодировке UTF-8")
        return []
    rows = list(csv.reader(text.splitlines(), delimiter=";"))
    if not rows or [c.strip() for c in rows[0]] != columns:
        errors.append(f"{path.name}:1: ожидается заголовок {';'.join(columns)}")
        return []
    result = []
    for lineno, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        if len(row) != len(columns):
            errors.append(f"{path.name}:{lineno}: ожидается {len(columns)} колонок, найдено {len(row)}")
            continue
        result.append((lineno, dict(zip(columns, (c.strip() for c in row)))))
    return result


def _load_topics(path: Path, errors: list[str]) -> list[Topic]:
    topics: list[Topic] = []
    seen: set[str] = set()
    for lineno, r in _read_rows(path, TOPIC_COLUMNS, errors):
        where = f"topics.csv:{lineno}"
        if not ID_RE.match(r["id"]):
            errors.append(f"{where}: некорректный id темы '{r['id']}'")
            continue
        if r["id"] in seen:
            errors.append(f"{where}: повторяющийся id темы '{r['id']}'")
            continue
        if not r["title"]:
            errors.append(f"{where}: пустой title")
            continue
        try:
            order = int(r["order"])
        except ValueError:
            errors.append(f"{where}: order должен быть целым числом")
            continue
        seen.add(r["id"])
        topics.append(Topic(
            id=r["id"], title=r["title"], description=r["description"], order=order,
            en_voice=r["en_voice"] or DEFAULT_EN_VOICE,
            ru_voice=r["ru_voice"] or DEFAULT_RU_VOICE,
        ))
    return topics


def _load_cards(path: Path, topic_id: str, seen: dict[str, str], errors: list[str]) -> list[Card]:
    cards: list[Card] = []
    for lineno, r in _read_rows(path, CARD_COLUMNS, errors):
        where = f"{path.name}:{lineno}"
        if not ID_RE.match(r["id"]):
            errors.append(f"{where}: некорректный id карточки '{r['id']}'")
            continue
        if r["id"] in seen:
            errors.append(f"{where}: id '{r['id']}' уже используется в {seen[r['id']]}")
            continue
        try:
            set_no = int(r["set"])
        except ValueError:
            set_no = 0
        if set_no < 1:
            errors.append(f"{where}: set должен быть целым числом ≥ 1")
            continue
        if not r["en"] or not r["ru"]:
            errors.append(f"{where}: колонки en и ru обязательны")
            continue
        seen[r["id"]] = where
        cards.append(Card(id=r["id"], topic_id=topic_id, set=set_no, en=r["en"], ru=r["ru"],
                          en_ex=r["en_ex"], ru_ex=r["ru_ex"]))
    return cards


def load_content(content_dir: Path) -> tuple[list[Topic], dict[str, list[Card]]]:
    topics_path = content_dir / "topics.csv"
    if not topics_path.exists():
        raise ContentError([f"нет файла {topics_path}"])
    errors: list[str] = []
    topics = _load_topics(topics_path, errors)
    topic_ids = {t.id for t in topics}
    seen_cards: dict[str, str] = {}
    cards_by_topic: dict[str, list[Card]] = {}
    for topic in topics:
        path = content_dir / f"{topic.id}.csv"
        if not path.exists():
            errors.append(f"topics.csv: для темы '{topic.id}' нет файла {topic.id}.csv")
            continue
        before = len(errors)
        cards = _load_cards(path, topic.id, seen_cards, errors)
        if not cards and len(errors) == before:
            errors.append(f"{path.name}: нет карточек")
        cards_by_topic[topic.id] = cards
    for path in sorted(content_dir.glob("*.csv")):
        if path.name != "topics.csv" and path.stem not in topic_ids:
            errors.append(f"{path.name}: тема отсутствует в topics.csv")
    if errors:
        raise ContentError(errors)
    topics.sort(key=lambda t: t.order)
    return topics, cards_by_topic
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_csvload.py -q`
Expected: `16 passed`

- [ ] **Step 7: Commit**

```bash
git add .gitignore tools/requirements.txt tools/cardbuild tools/tests
git commit -m "feat(tools): load and validate content CSV

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Ключи аудио и план генерации

**Files:**
- Create: `tools/cardbuild/audio.py`
- Test: `tools/tests/test_audio.py`

**Interfaces:**
- Consumes: `Topic`, `Card` (Task 1).
- Produces: `AudioJob(key: str, voice: str, parts: tuple[str, ...])`; `side_parts(card, side) -> tuple[str, ...]` (`side` ∈ `"en"`, `"ru"`); `audio_key(voice, parts) -> str` (12 hex); `make_job(card, topic, side) -> AudioJob`; `collect_jobs(topics, cards_by_topic) -> dict[str, AudioJob]`; `SILENCE_SECONDS = (1, 3, 5, 8, 10)`; `silence_name(seconds) -> str`; `plan_audio(jobs, existing: set[str]) -> tuple[list[AudioJob], list[str]]` (что генерировать, какие имена файлов удалить).

- [ ] **Step 1: Написать падающие тесты**

`tools/tests/test_audio.py`:
```python
from cardbuild.audio import (
    AudioJob, audio_key, collect_jobs, make_job, plan_audio, side_parts, silence_name,
)
from cardbuild.model import Card, Topic

TOPIC = Topic("t", "T", "", 1)
CARD = Card("c1", "t", 1, "get up", "вставать", "I get up at seven.", "Я встаю в семь.")
PHRASE = Card("c2", "t", 1, "Thank you!", "Спасибо!")


def test_side_parts_with_and_without_example():
    assert side_parts(CARD, "en") == ("get up", "I get up at seven.")
    assert side_parts(CARD, "ru") == ("вставать", "Я встаю в семь.")
    assert side_parts(PHRASE, "en") == ("Thank you!",)


def test_audio_key_is_stable_12_hex_and_depends_on_voice_and_text():
    k = audio_key("v1", ("a", "b"))
    assert k == audio_key("v1", ("a", "b"))
    assert len(k) == 12 and all(ch in "0123456789abcdef" for ch in k)
    assert k != audio_key("v2", ("a", "b"))
    assert k != audio_key("v1", ("a b",))
    assert k != audio_key("v1", ("a", "c"))


def test_make_job_uses_topic_voice_per_side():
    en = make_job(CARD, TOPIC, "en")
    ru = make_job(CARD, TOPIC, "ru")
    assert en.voice == TOPIC.en_voice and ru.voice == TOPIC.ru_voice
    assert en.key == audio_key(TOPIC.en_voice, en.parts)


def test_collect_jobs_deduplicates_identical_sides():
    twin = Card("c3", "t", 2, "Thank you!", "Спасибо!")
    jobs = collect_jobs([TOPIC], {"t": [CARD, PHRASE, twin]})
    assert len(jobs) == 4
    assert all(isinstance(j, AudioJob) and k == j.key for k, j in jobs.items())


def test_plan_audio_generates_missing_and_deletes_stale_but_keeps_silence():
    jobs = collect_jobs([TOPIC], {"t": [CARD]})
    en_key = make_job(CARD, TOPIC, "en").key
    ru_key = make_job(CARD, TOPIC, "ru").key
    existing = {f"{en_key}.mp3", "deadbeef0000.mp3", silence_name(5)}
    to_generate, to_delete = plan_audio(jobs, existing)
    assert [j.key for j in to_generate] == [ru_key]
    assert to_delete == ["deadbeef0000.mp3"]


def test_silence_name():
    assert silence_name(3) == "silence_3s.mp3"
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_audio.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardbuild.audio'`

- [ ] **Step 3: Реализация**

`tools/cardbuild/audio.py`:
```python
import hashlib
from dataclasses import dataclass

from .model import Card, Topic

# Меняйте при изменении формата аудио (паузы, битрейт) — все файлы перегенерируются.
AUDIO_FORMAT_VERSION = "v1"
SILENCE_SECONDS = (1, 3, 5, 8, 10)


@dataclass(frozen=True)
class AudioJob:
    key: str
    voice: str
    parts: tuple[str, ...]


def side_parts(card: Card, side: str) -> tuple[str, ...]:
    main, example = (card.en, card.en_ex) if side == "en" else (card.ru, card.ru_ex)
    return tuple(p for p in (main, example) if p)


def audio_key(voice: str, parts: tuple[str, ...]) -> str:
    raw = "\x1f".join((AUDIO_FORMAT_VERSION, voice, *parts))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def make_job(card: Card, topic: Topic, side: str) -> AudioJob:
    voice = topic.en_voice if side == "en" else topic.ru_voice
    parts = side_parts(card, side)
    return AudioJob(audio_key(voice, parts), voice, parts)


def collect_jobs(topics: list[Topic], cards_by_topic: dict[str, list[Card]]) -> dict[str, AudioJob]:
    jobs: dict[str, AudioJob] = {}
    for topic in topics:
        for card in cards_by_topic[topic.id]:
            for side in ("en", "ru"):
                job = make_job(card, topic, side)
                jobs[job.key] = job
    return jobs


def silence_name(seconds: int) -> str:
    return f"silence_{seconds}s.mp3"


def plan_audio(jobs: dict[str, AudioJob], existing: set[str]) -> tuple[list[AudioJob], list[str]]:
    to_generate = [job for key, job in sorted(jobs.items()) if f"{key}.mp3" not in existing]
    keep = {f"{key}.mp3" for key in jobs} | {silence_name(s) for s in SILENCE_SECONDS}
    to_delete = sorted(name for name in existing if name not in keep)
    return to_generate, to_delete
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_audio.py -q`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add tools/cardbuild/audio.py tools/tests/test_audio.py
git commit -m "feat(tools): audio keys and generation plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Синтез речи, тишина, ретраи

**Files:**
- Create: `tools/cardbuild/tts.py`
- Test: `tools/tests/test_tts.py`

**Interfaces:**
- Consumes: `AudioJob` (Task 2).
- Produces: `Synth = Callable[[str, str], Awaitable[bytes]]` (text, voice → mp3); `edge_synthesize(text, voice) -> bytes` (async, реальный TTS); `make_silence(seconds: float) -> bytes`; `render_job(job, synth, retries=3, delay=1.0) -> bytes` (async); `generate_all(jobs, audio_dir: Path, synth, concurrency=4, delay=1.0) -> list[str]` (async, возвращает отсортированные ключи неудачных заданий).

Почему склейка байтов допустима: edge-tts по умолчанию отдаёт `audio-24khz-48kbitrate-mono-mp3`, а `make_silence` кодирует тишину в тот же формат через `lameenc`. MP3 — поток независимых фреймов, поэтому конкатенация файлов одного формата воспроизводится корректно.

- [ ] **Step 1: Написать падающие тесты**

`tools/tests/test_tts.py`:
```python
import asyncio

import pytest

from cardbuild.audio import AudioJob
from cardbuild.tts import generate_all, make_silence, render_job


def run(coro):
    return asyncio.run(coro)


def test_make_silence_is_mp3_and_scales_with_duration():
    one = make_silence(1)
    three = make_silence(3)
    assert len(one) > 0
    assert one[:3] == b"ID3" or (one[0] == 0xFF and one[1] & 0xE0 == 0xE0)
    assert len(three) > 2 * len(one)


def test_render_job_joins_parts_with_gap():
    calls = []

    async def synth(text, voice):
        calls.append((text, voice))
        return text.encode()

    job = AudioJob("k", "voice", ("a", "b"))
    data = run(render_job(job, synth, delay=0))
    assert calls == [("a", "voice"), ("b", "voice")]
    assert data.startswith(b"a") and data.endswith(b"b") and len(data) > 2


def test_render_job_retries_then_succeeds():
    attempts = {"n": 0}

    async def flaky(text, voice):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError("network")
        return b"ok"

    assert run(render_job(AudioJob("k", "v", ("x",)), flaky, retries=3, delay=0)) == b"ok"
    assert attempts["n"] == 3


def test_render_job_raises_after_retries():
    async def broken(text, voice):
        raise RuntimeError("down")

    with pytest.raises(RuntimeError):
        run(render_job(AudioJob("k", "v", ("x",)), broken, retries=2, delay=0))


def test_generate_all_writes_files_and_reports_failures(tmp_path):
    async def synth(text, voice):
        if text == "bad":
            raise RuntimeError("fail")
        return text.encode()

    jobs = [AudioJob("aaa", "v", ("good",)), AudioJob("bbb", "v", ("bad",))]
    failed = run(generate_all(jobs, tmp_path, synth, delay=0))
    assert failed == ["bbb"]
    assert (tmp_path / "aaa.mp3").read_bytes() == b"good"
    assert not (tmp_path / "bbb.mp3").exists()
    assert not list(tmp_path.glob("*.tmp"))
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_tts.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardbuild.tts'`

- [ ] **Step 3: Реализация**

`tools/cardbuild/tts.py`:
```python
import asyncio
from pathlib import Path
from typing import Awaitable, Callable

import lameenc

from .audio import AudioJob

SAMPLE_RATE = 24000
BITRATE_KBPS = 48
PART_GAP_SECONDS = 0.6

Synth = Callable[[str, str], Awaitable[bytes]]


def make_silence(seconds: float) -> bytes:
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BITRATE_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    pcm = b"\x00\x00" * int(SAMPLE_RATE * seconds)
    return bytes(encoder.encode(pcm) + encoder.flush())


async def edge_synthesize(text: str, voice: str) -> bytes:
    import edge_tts

    data = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            data.extend(chunk["data"])
    if not data:
        raise RuntimeError(f"пустой ответ TTS для '{text}'")
    return bytes(data)


async def _with_retries(make_call: Callable[[], Awaitable[bytes]], retries: int, delay: float) -> bytes:
    for attempt in range(retries):
        try:
            return await make_call()
        except Exception:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(delay * (attempt + 1))
    raise AssertionError("unreachable")


async def render_job(job: AudioJob, synth: Synth, retries: int = 3, delay: float = 1.0) -> bytes:
    gap = make_silence(PART_GAP_SECONDS)
    pieces: list[bytes] = []
    for i, part in enumerate(job.parts):
        if i:
            pieces.append(gap)
        pieces.append(await _with_retries(lambda: synth(part, job.voice), retries, delay))
    return b"".join(pieces)


async def generate_all(jobs: list[AudioJob], audio_dir: Path, synth: Synth,
                       concurrency: int = 4, delay: float = 1.0) -> list[str]:
    audio_dir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)
    failed: list[str] = []

    async def one(job: AudioJob) -> None:
        async with semaphore:
            try:
                data = await render_job(job, synth, delay=delay)
            except Exception as exc:
                print(f"  FAIL {job.key} {job.parts}: {exc}")
                failed.append(job.key)
                return
            tmp = audio_dir / f"{job.key}.mp3.tmp"
            tmp.write_bytes(data)
            tmp.replace(audio_dir / f"{job.key}.mp3")

    await asyncio.gather(*(one(job) for job in jobs))
    return sorted(failed)
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_tts.py -q`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add tools/cardbuild/tts.py tools/tests/test_tts.py
git commit -m "feat(tools): speech synthesis with retries and silence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: JSON-вывод, конвейер сборки, CLI и стартовая тема

**Files:**
- Create: `tools/cardbuild/output.py`, `tools/cardbuild/build.py`, `tools/build_content.py`, `content/topics.csv`, `content/greetings.csv`
- Test: `tools/tests/test_build.py`
- Generated (коммитится): `app/public/content/index.json`, `app/public/content/topics/greetings.json`, `app/public/content/audio/*.mp3`

**Interfaces:**
- Consumes: `load_content`, `ContentError` (Task 1); `make_job`, `collect_jobs`, `plan_audio`, `SILENCE_SECONDS`, `silence_name` (Task 2); `generate_all`, `make_silence`, `edge_synthesize`, `Synth` (Task 3).
- Produces: `run_build(content_dir: Path, out_dir: Path, synth: Synth, dry_run=False) -> int` (код выхода 0/1). Формат JSON, который читает приложение (Task 5 `types.ts`):

`index.json`:
```json
{
  "contentVersion": "a1b2c3d4e5f6",
  "topics": [
    {"id": "greetings", "title": "Приветствия", "description": "...", "order": 1,
     "cardCount": 8, "sets": [{"n": 1, "count": 8}]}
  ]
}
```
`topics/<id>.json`:
```json
{"id": "greetings", "cards": [
  {"id": "gr001", "set": 1, "en": "Hello!", "ru": "Привет!", "enEx": "", "ruEx": "",
   "enAudio": "audio/0123456789ab.mp3", "ruAudio": "audio/ba9876543210.mp3"}
]}
```
Пути аудио — относительно папки `content/`.

- [ ] **Step 1: Написать падающие тесты**

`tools/tests/test_build.py`:
```python
import json
from pathlib import Path

from cardbuild.build import run_build

TOPICS = "id;title;description;order;en_voice;ru_voice\nwords;Слова;Описание;1;;\n"
CARDS = "id;set;en;ru;en_ex;ru_ex\nw1;1;cat;кошка;I have a cat.;У меня есть кошка.\nw2;2;dog;собака;;\n"


class FakeSynth:
    def __init__(self):
        self.calls = []

    async def __call__(self, text, voice):
        self.calls.append(text)
        return f"{voice}:{text}".encode()


def setup(tmp_path: Path, cards: str = CARDS) -> tuple[Path, Path]:
    content = tmp_path / "content"
    content.mkdir(exist_ok=True)
    (content / "topics.csv").write_text(TOPICS, encoding="utf-8")
    (content / "words.csv").write_text(cards, encoding="utf-8")
    return content, tmp_path / "out"


def test_build_writes_index_topic_and_audio(tmp_path):
    content, out = setup(tmp_path)
    assert run_build(content, out, FakeSynth()) == 0

    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert len(index["contentVersion"]) == 12
    [topic] = index["topics"]
    assert topic == {"id": "words", "title": "Слова", "description": "Описание", "order": 1,
                     "cardCount": 2, "sets": [{"n": 1, "count": 1}, {"n": 2, "count": 1}]}

    doc = json.loads((out / "topics" / "words.json").read_text(encoding="utf-8"))
    w1 = doc["cards"][0]
    assert doc["id"] == "words"
    assert (w1["id"], w1["set"], w1["en"], w1["ru"], w1["enEx"], w1["ruEx"]) == (
        "w1", 1, "cat", "кошка", "I have a cat.", "У меня есть кошка.")
    for card in doc["cards"]:
        for key in ("enAudio", "ruAudio"):
            assert card[key].startswith("audio/") and (out / card[key]).exists()
    for seconds in (1, 3, 5, 8, 10):
        assert (out / "audio" / f"silence_{seconds}s.mp3").exists()


def test_second_build_generates_nothing_and_keeps_version(tmp_path):
    content, out = setup(tmp_path)
    run_build(content, out, FakeSynth())
    version = json.loads((out / "index.json").read_text(encoding="utf-8"))["contentVersion"]
    synth = FakeSynth()
    assert run_build(content, out, synth) == 0
    assert synth.calls == []
    assert json.loads((out / "index.json").read_text(encoding="utf-8"))["contentVersion"] == version


def test_text_change_regenerates_and_removes_stale_audio(tmp_path):
    content, out = setup(tmp_path)
    run_build(content, out, FakeSynth())
    before = {p.name for p in (out / "audio").iterdir()}
    setup(tmp_path, CARDS.replace("dog;собака", "dog;пёс"))
    synth = FakeSynth()
    run_build(content, out, synth)
    after = {p.name for p in (out / "audio").iterdir()}
    assert synth.calls == ["пёс"]
    assert len(before - after) == 1 and len(after - before) == 1


def test_removed_topic_json_is_deleted(tmp_path):
    content, out = setup(tmp_path)
    run_build(content, out, FakeSynth())
    (out / "topics" / "old.json").write_text("{}", encoding="utf-8")
    run_build(content, out, FakeSynth())
    assert not (out / "topics" / "old.json").exists()


def test_invalid_content_returns_1_and_writes_nothing(tmp_path):
    content, out = setup(tmp_path, "id;set;en;ru;en_ex;ru_ex\nw1;x;cat;кошка;;\n")
    assert run_build(content, out, FakeSynth()) == 1
    assert not out.exists()


def test_tts_failure_returns_1_and_keeps_old_index(tmp_path):
    content, out = setup(tmp_path)

    async def broken(text, voice):
        raise RuntimeError("offline")

    assert run_build(content, out, broken, retry_delay=0) == 1
    assert not (out / "index.json").exists()


def test_dry_run_writes_nothing(tmp_path):
    content, out = setup(tmp_path)
    synth = FakeSynth()
    assert run_build(content, out, synth, dry_run=True) == 0
    assert synth.calls == [] and not out.exists()
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd tools && ../.venv/Scripts/python -m pytest tests/test_build.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardbuild.build'`

- [ ] **Step 3: Реализация `output.py`**

`tools/cardbuild/output.py`:
```python
import hashlib
import json
from collections import Counter
from pathlib import Path

from .audio import make_job
from .model import Card, Topic


def card_json(card: Card, topic: Topic) -> dict:
    return {
        "id": card.id, "set": card.set, "en": card.en, "ru": card.ru,
        "enEx": card.en_ex, "ruEx": card.ru_ex,
        "enAudio": f"audio/{make_job(card, topic, 'en').key}.mp3",
        "ruAudio": f"audio/{make_job(card, topic, 'ru').key}.mp3",
    }


def topic_json(topic: Topic, cards: list[Card]) -> dict:
    return {"id": topic.id, "cards": [card_json(c, topic) for c in cards]}


def _dumps(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True)


def index_json(topics: list[Topic], cards_by_topic: dict[str, list[Card]], topic_docs: list[dict]) -> dict:
    digest = hashlib.sha1()
    for topic, doc in zip(topics, topic_docs):
        digest.update(_dumps({"topic": topic.__dict__, "doc": doc}).encode("utf-8"))
    entries = []
    for topic in topics:
        counts = Counter(c.set for c in cards_by_topic[topic.id])
        entries.append({
            "id": topic.id, "title": topic.title, "description": topic.description,
            "order": topic.order, "cardCount": len(cards_by_topic[topic.id]),
            "sets": [{"n": n, "count": counts[n]} for n in sorted(counts)],
        })
    return {"contentVersion": digest.hexdigest()[:12], "topics": entries}


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_dumps(data) + "\n", encoding="utf-8")
```

- [ ] **Step 4: Реализация `build.py`**

`tools/cardbuild/build.py`:
```python
import asyncio
from pathlib import Path

from .audio import SILENCE_SECONDS, collect_jobs, plan_audio, silence_name
from .csvload import ContentError, load_content
from .output import index_json, topic_json, write_json
from .tts import Synth, generate_all, make_silence


def run_build(content_dir: Path, out_dir: Path, synth: Synth,
              dry_run: bool = False, retry_delay: float = 1.0) -> int:
    try:
        topics, cards_by_topic = load_content(content_dir)
    except ContentError as exc:
        print("Ошибки в контенте:")
        for err in exc.errors:
            print(f"  {err}")
        return 1

    audio_dir = out_dir / "audio"
    existing = {p.name for p in audio_dir.glob("*.mp3")} if audio_dir.exists() else set()
    jobs = collect_jobs(topics, cards_by_topic)
    to_generate, to_delete = plan_audio(jobs, existing)
    total_cards = sum(len(c) for c in cards_by_topic.values())
    print(f"Тем: {len(topics)}, карточек: {total_cards}, аудио: {len(jobs)}")
    print(f"Сгенерировать: {len(to_generate)}, удалить: {len(to_delete)}")
    if dry_run:
        return 0

    audio_dir.mkdir(parents=True, exist_ok=True)
    for seconds in SILENCE_SECONDS:
        path = audio_dir / silence_name(seconds)
        if not path.exists():
            path.write_bytes(make_silence(seconds))

    failed = asyncio.run(generate_all(to_generate, audio_dir, synth, delay=retry_delay))
    if failed:
        print(f"Не удалось озвучить {len(failed)} файлов. Запустите сборку ещё раз.")
        return 1

    for name in to_delete:
        (audio_dir / name).unlink()

    topics_dir = out_dir / "topics"
    docs = [topic_json(t, cards_by_topic[t.id]) for t in topics]
    for doc in docs:
        write_json(topics_dir / f"{doc['id']}.json", doc)
    keep = {f"{t.id}.json" for t in topics}
    for path in topics_dir.glob("*.json"):
        if path.name not in keep:
            path.unlink()
    write_json(out_dir / "index.json", index_json(topics, cards_by_topic, docs))
    print("Готово.")
    return 0
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd tools && ../.venv/Scripts/python -m pytest -q`
Expected: `34 passed` (все тесты Python)

- [ ] **Step 6: CLI**

`tools/build_content.py`:
```python
"""Сборка контента: python tools/build_content.py [--dry-run]"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cardbuild.build import run_build  # noqa: E402
from cardbuild.tts import edge_synthesize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Проверка CSV, озвучка, генерация JSON")
    parser.add_argument("--content", type=Path, default=ROOT / "content")
    parser.add_argument("--out", type=Path, default=ROOT / "app" / "public" / "content")
    parser.add_argument("--dry-run", action="store_true", help="только проверить и показать план")
    args = parser.parse_args()
    return run_build(args.content, args.out, edge_synthesize, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Стартовая тема**

`content/topics.csv`:
```
id;title;description;order;en_voice;ru_voice
greetings;Приветствия и вежливость;Самые первые фразы для любого разговора;1;;
```

`content/greetings.csv`:
```
id;set;en;ru;en_ex;ru_ex
gr001;1;Hello!;Привет!;;
gr002;1;Good morning!;Доброе утро!;;
gr003;1;How are you?;Как дела?;;
gr004;1;I'm fine, thank you.;У меня всё хорошо, спасибо.;;
gr005;1;Nice to meet you.;Приятно познакомиться.;;
gr006;1;See you later!;Увидимся!;;
gr007;1;Excuse me.;Извините.;;
gr008;1;Thank you very much!;Большое спасибо!;;
```

- [ ] **Step 8: Реальный прогон (нужен интернет)**

Run: `.venv/Scripts/python tools/build_content.py --dry-run`
Expected:
```
Тем: 1, карточек: 8, аудио: 16
Сгенерировать: 16, удалить: 0
```

Run: `.venv/Scripts/python tools/build_content.py`
Expected: `Готово.`; в `app/public/content/audio/` 21 mp3 (16 + 5 тишины). Открыть любой mp3 двойным щелчком — звучит фраза, файл тишины — тишина нужной длины.

Повторный запуск: `Сгенерировать: 0, удалить: 0`.

- [ ] **Step 9: Commit**

```bash
git add tools content app/public/content
git commit -m "feat(tools): build pipeline, CLI and greetings topic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Каркас приложения, общие типы и даты

**Files:**
- Create: `app/package.json` (через npm), `app/tsconfig.json`, `app/vite.config.ts`, `app/index.html`, `app/src/main.tsx`, `app/src/styles.css`, `app/src/types.ts`, `app/src/domain/dates.ts`
- Test: `app/src/domain/dates.test.ts`

**Interfaces:**
- Produces (`app/src/types.ts`) — используется всеми последующими задачами:

```ts
export interface SetMeta { n: number; count: number }
export interface TopicMeta {
  id: string; title: string; description: string; order: number;
  cardCount: number; sets: SetMeta[];
}
export interface ContentIndex { contentVersion: string; topics: TopicMeta[] }
export interface Card {
  id: string; set: number; en: string; ru: string; enEx: string; ruEx: string;
  enAudio: string; ruAudio: string;
}
export interface TopicContent { id: string; cards: Card[] }
export interface Progress {
  profileId: string; cardId: string; box: number;
  nextDue: string | null; lastSeen: string | null; starred: boolean;
}
export type PauseSec = 3 | 5 | 8 | 10;
export type Direction = 'en-ru' | 'ru-en';
export type CardOrder = 'seq' | 'shuffle';
export type Rate = 0.8 | 1 | 1.2;
export interface Settings {
  pauseSec: PauseSec; direction: Direction; order: CardOrder;
  enRepeat: 1 | 2; rate: Rate; loop: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  pauseSec: 5, direction: 'en-ru', order: 'seq', enRepeat: 1, rate: 1, loop: false,
};
export interface Profile { id: string; name: string; createdAt: string }
```

- Produces (`app/src/domain/dates.ts`): `todayISO(d?: Date): string` (локальная дата `YYYY-MM-DD`), `addDays(iso: string, n: number): string`.

- [ ] **Step 1: Создать проект и поставить зависимости**

```bash
mkdir app && cd app && npm init -y
npm install preact idb
npm install -D vite @preact/preset-vite typescript vitest vite-plugin-pwa fake-indexeddb
```
Expected: `added N packages`, без ошибок.

В `app/package.json` заменить блок `"scripts"` и добавить `"type"`:
```json
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --host",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 2: Конфигурация**

`app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`app/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact()],
  test: { environment: 'node' },
});
```

`app/index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#111827" />
    <link rel="apple-touch-icon" href="icon-192.png" />
    <title>Карточки слов</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`app/src/styles.css`:
```css
:root {
  --bg: #111827; --panel: #1f2937; --text: #f9fafb; --muted: #9ca3af;
  --accent: #6366f1; --good: #22c55e; --warn: #f59e0b; --bad: #ef4444;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font-family: -apple-system, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
#app { min-height: 100%; padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom); }
```

`app/src/main.tsx`:
```tsx
import { render } from 'preact';
import './styles.css';

render(<h1>Карточки слов</h1>, document.getElementById('app')!);
```

`app/src/types.ts` — код из блока Interfaces выше.

- [ ] **Step 3: Написать падающий тест дат**

`app/src/domain/dates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addDays, todayISO } from './dates';

describe('dates', () => {
  it('formats local date', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('adds days across month, year and leap day', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-10', 0)).toBe('2026-03-10');
  });
});
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `cd app && npx vitest run src/domain/dates.test.ts`
Expected: FAIL — `Failed to resolve import "./dates"`

- [ ] **Step 5: Реализация**

`app/src/domain/dates.ts`:
```ts
export function todayISO(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
```

- [ ] **Step 6: Проверить тесты и сборку**

Run: `cd app && npm test && npm run build`
Expected: `2 passed`; сборка `✓ built in ...`. `npm run dev` → http://localhost:5173 показывает «Карточки слов».

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/tsconfig.json app/vite.config.ts app/index.html app/src
git commit -m "feat(app): scaffold Vite + Preact app with shared types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Лейтнер

**Files:**
- Create: `app/src/domain/leitner.ts`
- Test: `app/src/domain/leitner.test.ts`

**Interfaces:**
- Consumes: `Progress` (types.ts), `addDays` (dates.ts).
- Produces: `INTERVALS: readonly number[]` (`[0,1,3,7,14,30]`); `type Answer = 'know' | 'again'`; `type Bucket = 'new' | 'learning' | 'learned'`; `newProgress(profileId, cardId): Progress`; `applyAnswer(p: Progress, answer: Answer, today: string): Progress`; `markStarred(p: Progress, today: string): Progress`; `markSeen(p: Progress, today: string): Progress`; `isDue(p: Progress | undefined, today: string): boolean`; `bucket(p: Progress | undefined): Bucket`. Все функции чистые, возвращают новый объект.

- [ ] **Step 1: Написать падающие тесты**

`app/src/domain/leitner.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyAnswer, bucket, isDue, markSeen, markStarred, newProgress } from './leitner';

const T = '2026-10-05';

describe('leitner', () => {
  it('creates new progress in box 0', () => {
    expect(newProgress('p', 'c')).toEqual({
      profileId: 'p', cardId: 'c', box: 0, nextDue: null, lastSeen: null, starred: false,
    });
  });

  it('know moves up a box with matching interval', () => {
    let p = newProgress('p', 'c');
    const expected = [[1, '2026-10-06'], [2, '2026-10-08'], [3, '2026-10-12'],
      [4, '2026-10-19'], [5, '2026-11-04'], [5, '2026-11-04']] as const;
    for (const [box, due] of expected) {
      p = applyAnswer(p, 'know', T);
      expect([p.box, p.nextDue, p.lastSeen]).toEqual([box, due, T]);
    }
  });

  it('again resets to box 1 due tomorrow', () => {
    const p = applyAnswer({ ...newProgress('p', 'c'), box: 4 }, 'again', T);
    expect([p.box, p.nextDue]).toEqual([1, '2026-10-06']);
  });

  it('star behaves like again and sets starred; know clears it', () => {
    const s = markStarred({ ...newProgress('p', 'c'), box: 3 }, T);
    expect([s.box, s.nextDue, s.starred]).toEqual([1, '2026-10-06', true]);
    expect(applyAnswer(s, 'know', T).starred).toBe(false);
  });

  it('markSeen only updates lastSeen', () => {
    const p = { ...newProgress('p', 'c'), box: 2, nextDue: '2026-10-07' };
    expect(markSeen(p, T)).toEqual({ ...p, lastSeen: T });
  });

  it('does not mutate input', () => {
    const p = newProgress('p', 'c');
    applyAnswer(p, 'know', T);
    expect(p.box).toBe(0);
  });

  it('isDue only for boxes 1-5 with nextDue <= today', () => {
    expect(isDue(undefined, T)).toBe(false);
    expect(isDue(newProgress('p', 'c'), T)).toBe(false);
    expect(isDue({ ...newProgress('p', 'c'), box: 1, nextDue: T }, T)).toBe(true);
    expect(isDue({ ...newProgress('p', 'c'), box: 2, nextDue: '2026-10-04' }, T)).toBe(true);
    expect(isDue({ ...newProgress('p', 'c'), box: 2, nextDue: '2026-10-06' }, T)).toBe(false);
  });

  it('bucket', () => {
    expect(bucket(undefined)).toBe('new');
    expect(bucket({ ...newProgress('p', 'c'), box: 0 })).toBe('new');
    expect(bucket({ ...newProgress('p', 'c'), box: 1 })).toBe('learning');
    expect(bucket({ ...newProgress('p', 'c'), box: 4 })).toBe('learning');
    expect(bucket({ ...newProgress('p', 'c'), box: 5 })).toBe('learned');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd app && npx vitest run src/domain/leitner.test.ts`
Expected: FAIL — `Failed to resolve import "./leitner"`

- [ ] **Step 3: Реализация**

`app/src/domain/leitner.ts`:
```ts
import type { Progress } from '../types';
import { addDays } from './dates';

export const INTERVALS: readonly number[] = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = 5;

export type Answer = 'know' | 'again';
export type Bucket = 'new' | 'learning' | 'learned';

export function newProgress(profileId: string, cardId: string): Progress {
  return { profileId, cardId, box: 0, nextDue: null, lastSeen: null, starred: false };
}

export function applyAnswer(p: Progress, answer: Answer, today: string): Progress {
  if (answer === 'again') {
    return { ...p, box: 1, nextDue: addDays(today, INTERVALS[1]), lastSeen: today };
  }
  const box = Math.min(p.box + 1, MAX_BOX);
  return { ...p, box, nextDue: addDays(today, INTERVALS[box]), lastSeen: today, starred: false };
}

export function markStarred(p: Progress, today: string): Progress {
  return { ...applyAnswer(p, 'again', today), starred: true };
}

export function markSeen(p: Progress, today: string): Progress {
  return { ...p, lastSeen: today };
}

export function isDue(p: Progress | undefined, today: string): boolean {
  return !!p && p.box >= 1 && p.nextDue !== null && p.nextDue <= today;
}

export function bucket(p: Progress | undefined): Bucket {
  if (!p || p.box === 0) return 'new';
  return p.box >= MAX_BOX ? 'learned' : 'learning';
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd app && npx vitest run src/domain/leitner.test.ts`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/leitner.ts app/src/domain/leitner.test.ts
git commit -m "feat(app): Leitner box logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Выбор и порядок карточек

**Files:**
- Create: `app/src/domain/selection.ts`
- Test: `app/src/domain/selection.test.ts`

**Interfaces:**
- Consumes: `Card`, `Progress`, `CardOrder` (types.ts); `isDue` (leitner.ts).
- Produces: `type SetMode = 'all' | 'newAndHard'`; `type ProgressMap = Map<string, Progress>` (ключ — `cardId`); `selectForSet(cards: Card[], setN: number, mode: SetMode, progress: ProgressMap): Card[]`; `selectDue(cards: Card[], progress: ProgressMap, today: string): Card[]`; `orderCards(cards: Card[], order: CardOrder, random?: () => number): Card[]` (возвращает новый массив).

- [ ] **Step 1: Написать падающие тесты**

`app/src/domain/selection.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Card, Progress } from '../types';
import { orderCards, selectDue, selectForSet, type ProgressMap } from './selection';

const card = (id: string, set = 1): Card =>
  ({ id, set, en: id, ru: id, enEx: '', ruEx: '', enAudio: `audio/${id}e.mp3`, ruAudio: `audio/${id}r.mp3` });
const prog = (cardId: string, box: number, nextDue: string | null = null): Progress =>
  ({ profileId: 'p', cardId, box, nextDue, lastSeen: null, starred: false });

const cards = [card('a'), card('b'), card('c'), card('d'), card('e', 2)];
const progress: ProgressMap = new Map([
  ['b', prog('b', 2, '2026-10-01')],
  ['c', prog('c', 3, '2026-10-05')],
  ['d', prog('d', 5, '2026-11-01')],
]);

describe('selection', () => {
  it('all cards of a set in original order', () => {
    expect(selectForSet(cards, 1, 'all', progress).map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('new and hard = boxes 0-2', () => {
    expect(selectForSet(cards, 1, 'newAndHard', progress).map(c => c.id)).toEqual(['a', 'b']);
  });

  it('due across all cards', () => {
    expect(selectDue(cards, progress, '2026-10-05').map(c => c.id)).toEqual(['b', 'c']);
  });

  it('seq keeps order, shuffle permutes deterministically with injected random', () => {
    expect(orderCards(cards, 'seq')).toEqual(cards);
    expect(orderCards(cards, 'seq')).not.toBe(cards);
    const shuffled = orderCards(cards, 'shuffle', () => 0);
    expect(shuffled.map(c => c.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shuffled.map(c => c.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(cards.map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd app && npx vitest run src/domain/selection.test.ts`
Expected: FAIL — `Failed to resolve import "./selection"`

- [ ] **Step 3: Реализация**

`app/src/domain/selection.ts`:
```ts
import type { Card, CardOrder, Progress } from '../types';
import { isDue } from './leitner';

export type SetMode = 'all' | 'newAndHard';
export type ProgressMap = Map<string, Progress>;

export function selectForSet(cards: Card[], setN: number, mode: SetMode, progress: ProgressMap): Card[] {
  const inSet = cards.filter(c => c.set === setN);
  if (mode === 'all') return inSet;
  return inSet.filter(c => (progress.get(c.id)?.box ?? 0) <= 2);
}

export function selectDue(cards: Card[], progress: ProgressMap, today: string): Card[] {
  return cards.filter(c => isDue(progress.get(c.id), today));
}

export function orderCards(cards: Card[], order: CardOrder, random: () => number = Math.random): Card[] {
  const result = [...cards];
  if (order === 'seq') return result;
  // Fisher–Yates
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
```

Проверка ожидаемого порядка при `random = () => 0`: на каждом шаге `j = 0`, элемент `i` меняется с первым: `abcde → ebcda → dbcea → cbdea → bcdea`. Совпадает с тестом `['b','c','d','e','a']`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd app && npx vitest run src/domain/selection.test.ts`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/selection.ts app/src/domain/selection.test.ts
git commit -m "feat(app): card selection and ordering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Сценарий воспроизведения

**Files:**
- Create: `app/src/domain/sequence.ts`
- Test: `app/src/domain/sequence.test.ts`

**Interfaces:**
- Consumes: `Card`, `Settings`, `Direction` (types.ts).
- Produces:

```ts
export type Side = 'front' | 'back';
export type Step =
  | { kind: 'audio'; url: string; cardIndex: number; side: Side }
  | { kind: 'silence'; url: string; cardIndex: number; seconds: number };
export function silenceUrl(seconds: number): string;          // 'audio/silence_5s.mp3'
export function sideText(card: Card, side: Side, direction: Direction): { main: string; example: string; lang: 'en' | 'ru' };
export function buildSequence(cards: Card[], s: Pick<Settings, 'pauseSec' | 'direction' | 'enRepeat'>): Step[];
export function cardStartStep(steps: Step[], cardIndex: number): number; // -1 если нет
```

Сценарий одной карточки: `front` → (если front английский и `enRepeat=2`: тишина 1 с, `front`) → тишина `pauseSec` → `back` → (если back английский и `enRepeat=2`: тишина 1 с, `back`) → тишина `pauseSec`. URL — относительно папки `content/`.

- [ ] **Step 1: Написать падающие тесты**

`app/src/domain/sequence.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { buildSequence, cardStartStep, sideText, silenceUrl } from './sequence';

const card = (id: string): Card => ({
  id, set: 1, en: `${id}-en`, ru: `${id}-ru`, enEx: `${id}-enex`, ruEx: '',
  enAudio: `audio/${id}-en.mp3`, ruAudio: `audio/${id}-ru.mp3`,
});
const urls = (steps: ReturnType<typeof buildSequence>) => steps.map(s => s.url);

describe('sequence', () => {
  it('silence url', () => {
    expect(silenceUrl(5)).toBe('audio/silence_5s.mp3');
  });

  it('en-ru single repeat', () => {
    const steps = buildSequence([card('a'), card('b')], { pauseSec: 5, direction: 'en-ru', enRepeat: 1 });
    expect(urls(steps)).toEqual([
      'audio/a-en.mp3', 'audio/silence_5s.mp3', 'audio/a-ru.mp3', 'audio/silence_5s.mp3',
      'audio/b-en.mp3', 'audio/silence_5s.mp3', 'audio/b-ru.mp3', 'audio/silence_5s.mp3',
    ]);
    expect(steps.map(s => s.cardIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(steps[0]).toEqual({ kind: 'audio', url: 'audio/a-en.mp3', cardIndex: 0, side: 'front' });
    expect(steps[1]).toEqual({ kind: 'silence', url: 'audio/silence_5s.mp3', cardIndex: 0, seconds: 5 });
  });

  it('en repeated twice on front for en-ru', () => {
    const steps = buildSequence([card('a')], { pauseSec: 3, direction: 'en-ru', enRepeat: 2 });
    expect(urls(steps)).toEqual([
      'audio/a-en.mp3', 'audio/silence_1s.mp3', 'audio/a-en.mp3', 'audio/silence_3s.mp3',
      'audio/a-ru.mp3', 'audio/silence_3s.mp3',
    ]);
  });

  it('ru-en puts russian first and repeats english on back', () => {
    const steps = buildSequence([card('a')], { pauseSec: 8, direction: 'ru-en', enRepeat: 2 });
    expect(urls(steps)).toEqual([
      'audio/a-ru.mp3', 'audio/silence_8s.mp3',
      'audio/a-en.mp3', 'audio/silence_1s.mp3', 'audio/a-en.mp3', 'audio/silence_8s.mp3',
    ]);
    expect(steps[0]).toMatchObject({ side: 'front' });
    expect(steps[2]).toMatchObject({ side: 'back' });
  });

  it('cardStartStep', () => {
    const steps = buildSequence([card('a'), card('b')], { pauseSec: 5, direction: 'en-ru', enRepeat: 1 });
    expect(cardStartStep(steps, 0)).toBe(0);
    expect(cardStartStep(steps, 1)).toBe(4);
    expect(cardStartStep(steps, 2)).toBe(-1);
  });

  it('sideText follows direction', () => {
    const c = card('a');
    expect(sideText(c, 'front', 'en-ru')).toEqual({ main: 'a-en', example: 'a-enex', lang: 'en' });
    expect(sideText(c, 'front', 'ru-en')).toEqual({ main: 'a-ru', example: '', lang: 'ru' });
    expect(sideText(c, 'back', 'ru-en').lang).toBe('en');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd app && npx vitest run src/domain/sequence.test.ts`
Expected: FAIL — `Failed to resolve import "./sequence"`

- [ ] **Step 3: Реализация**

`app/src/domain/sequence.ts`:
```ts
import type { Card, Direction, Settings } from '../types';

export type Side = 'front' | 'back';
export type Step =
  | { kind: 'audio'; url: string; cardIndex: number; side: Side }
  | { kind: 'silence'; url: string; cardIndex: number; seconds: number };

const REPEAT_GAP_SECONDS = 1;

export function silenceUrl(seconds: number): string {
  return `audio/silence_${seconds}s.mp3`;
}

function sideLang(side: Side, direction: Direction): 'en' | 'ru' {
  const frontLang = direction === 'en-ru' ? 'en' : 'ru';
  if (side === 'front') return frontLang;
  return frontLang === 'en' ? 'ru' : 'en';
}

export function sideText(card: Card, side: Side, direction: Direction) {
  const lang = sideLang(side, direction);
  return lang === 'en'
    ? { main: card.en, example: card.enEx, lang }
    : { main: card.ru, example: card.ruEx, lang };
}

export function buildSequence(
  cards: Card[],
  s: Pick<Settings, 'pauseSec' | 'direction' | 'enRepeat'>,
): Step[] {
  const steps: Step[] = [];
  const silence = (cardIndex: number, seconds: number) =>
    steps.push({ kind: 'silence', url: silenceUrl(seconds), cardIndex, seconds });

  cards.forEach((card, cardIndex) => {
    for (const side of ['front', 'back'] as const) {
      const lang = sideLang(side, s.direction);
      const url = lang === 'en' ? card.enAudio : card.ruAudio;
      steps.push({ kind: 'audio', url, cardIndex, side });
      if (lang === 'en' && s.enRepeat === 2) {
        silence(cardIndex, REPEAT_GAP_SECONDS);
        steps.push({ kind: 'audio', url, cardIndex, side });
      }
      silence(cardIndex, s.pauseSec);
    }
  });
  return steps;
}

export function cardStartStep(steps: Step[], cardIndex: number): number {
  return steps.findIndex(step => step.cardIndex === cardIndex);
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd app && npx vitest run src/domain/sequence.test.ts`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/sequence.ts app/src/domain/sequence.test.ts
git commit -m "feat(app): playback sequence builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Аудиодвижок

**Files:**
- Create: `app/src/player/AudioEngine.ts`
- Test: `app/src/player/AudioEngine.test.ts`

**Interfaces:**
- Consumes: `Step`, `cardStartStep` (sequence.ts).
- Produces:

```ts
export interface AudioLike {
  src: string; playbackRate: number;
  play(): Promise<void>; pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: 'play' | 'pause' | 'nexttrack' | 'previoustrack', handler: (() => void) | null): void;
}
export interface EngineState {
  stepIndex: number; cardIndex: number; side: Side | null;
  playing: boolean; finished: boolean;
}
export interface EngineOptions {
  resolve: (url: string) => Promise<string>;           // относительный URL → URL для <audio> (blob:)
  audio?: AudioLike;                                   // по умолчанию new Audio()
  mediaSession?: MediaSessionLike | null;              // по умолчанию navigator.mediaSession
  describeCard?: (cardIndex: number) => { title: string; artist: string };
  onError?: (message: string) => void;
}
export class AudioEngine {
  constructor(opts: EngineOptions);
  load(steps: Step[], opts: { loop: boolean; rate: number }): void;  // стоп, позиция 0
  subscribe(fn: (s: EngineState) => void): () => void;              // сразу вызывает fn с текущим состоянием
  getState(): EngineState;
  play(): Promise<void>;
  pause(): void;
  nextCard(): void;
  prevCard(): void;
  setRate(rate: number): void;
  setLoop(loop: boolean): void;
  destroy(): void;
}
```

Правила:
- Шаги играются по событию `ended`. Тишина играется со скоростью 1, речь — с `rate`.
- После старта шага заранее вызывается `resolve` для следующего шага (прогрев кэша; ошибки игнорируются).
- Ошибка шага (`error` у audio, отказ `play()` или `resolve`): один повтор того же шага; повторная ошибка → `onError('Нет звука для карточки — скачайте набор для офлайна')` и переход к началу следующей карточки.
- Конец сценария: при `loop` — с начала, иначе `playing=false, finished=true`.
- `play()` после `finished` начинает с начала. `play()` после `pause()` продолжает текущий шаг без перезагрузки `src`.
- Media Session: при смене карточки — `metadata` из `describeCard` (через `MediaMetadata`, если он есть, иначе простой объект); `playbackState` следует за `playing`; обработчики play/pause/nexttrack/previoustrack.
- Устаревшие асинхронные операции (переключение во время `resolve`) отбрасываются по счётчику `token`.

- [ ] **Step 1: Написать падающие тесты**

`app/src/player/AudioEngine.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { Step } from '../domain/sequence';
import { AudioEngine, type AudioLike, type MediaSessionLike } from './AudioEngine';

class FakeAudio implements AudioLike {
  src = '';
  playbackRate = 1;
  played: { src: string; rate: number }[] = [];
  failing = new Set<string>();
  private listeners: Record<string, (() => void)[]> = { ended: [], error: [] };
  async play() {
    this.played.push({ src: this.src, rate: this.playbackRate });
    if (this.failing.has(this.src)) queueMicrotask(() => this.fire('error'));
  }
  pause() {}
  addEventListener(type: 'ended' | 'error', fn: () => void) { this.listeners[type].push(fn); }
  fire(type: 'ended' | 'error') { this.listeners[type].forEach(fn => fn()); }
}

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState: 'none' | 'paused' | 'playing' = 'none';
  handlers: Record<string, (() => void) | null> = {};
  setActionHandler(action: string, handler: (() => void) | null) { this.handlers[action] = handler; }
}

const flush = () => new Promise(r => setTimeout(r, 0));
const a = (url: string, cardIndex: number, side: 'front' | 'back' = 'front'): Step =>
  ({ kind: 'audio', url, cardIndex, side });
const s = (cardIndex: number): Step => ({ kind: 'silence', url: 'sil', cardIndex, seconds: 1 });
const STEPS: Step[] = [a('a1', 0), s(0), a('a2', 0, 'back'), s(0), a('b1', 1), s(1), a('b2', 1, 'back'), s(1)];

function setup(opts: { loop?: boolean; rate?: number } = {}) {
  const audio = new FakeAudio();
  const session = new FakeSession();
  const onError = vi.fn();
  const engine = new AudioEngine({
    audio, mediaSession: session, onError,
    resolve: async url => `blob:${url}`,
    describeCard: i => ({ title: `card ${i}`, artist: 'topic' }),
  });
  engine.load(STEPS, { loop: opts.loop ?? false, rate: opts.rate ?? 1 });
  return { audio, session, onError, engine };
}

async function playThrough(audio: FakeAudio, count: number) {
  for (let i = 0; i < count; i++) { audio.fire('ended'); await flush(); }
}

describe('AudioEngine', () => {
  it('plays all steps in order and finishes', async () => {
    const { audio, engine } = setup();
    await engine.play(); await flush();
    await playThrough(audio, STEPS.length);
    expect(audio.played.map(p => p.src)).toEqual(STEPS.map(st => `blob:${st.url}`));
    expect(engine.getState()).toMatchObject({ playing: false, finished: true });
  });

  it('loops to the start when loop is on', async () => {
    const { audio, engine } = setup({ loop: true });
    await engine.play(); await flush();
    await playThrough(audio, STEPS.length);
    expect(audio.played.at(-1)?.src).toBe('blob:a1');
    expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 0 });
  });

  it('pause and resume continue the same step', async () => {
    const { audio, engine } = setup();
    await engine.play(); await flush();
    await playThrough(audio, 2);
    engine.pause();
    expect(engine.getState().playing).toBe(false);
    audio.fire('ended'); await flush();               // ended после паузы игнорируется
    expect(engine.getState().stepIndex).toBe(2);
    await engine.play(); await flush();
    expect(audio.played.at(-1)?.src).toBe('blob:a2');
    expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 2, side: 'back' });
  });

  it('applies rate to speech and 1 to silence', async () => {
    const { audio, engine } = setup({ rate: 1.2 });
    await engine.play(); await flush();
    await playThrough(audio, 1);
    expect(audio.played.map(p => p.rate)).toEqual([1.2, 1]);
  });

  it('nextCard and prevCard jump to card starts', async () => {
    const { audio, engine } = setup();
    await engine.play(); await flush();
    engine.nextCard(); await flush();
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4 });
    expect(audio.played.at(-1)?.src).toBe('blob:b1');
    engine.prevCard(); await flush();
    expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0 });
  });

  it('retries a failing step once, then skips to next card and reports', async () => {
    const { audio, engine, onError } = setup();
    audio.failing.add('blob:a2');
    await engine.play(); await flush();
    await playThrough(audio, 2); await flush(); await flush();
    expect(audio.played.filter(p => p.src === 'blob:a2')).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: true });
  });

  it('updates media session and handles remote commands', async () => {
    const { session, engine } = setup();
    await engine.play(); await flush();
    expect(session.metadata).toMatchObject({ title: 'card 0', artist: 'topic' });
    expect(session.playbackState).toBe('playing');
    session.handlers.nexttrack!(); await flush();
    expect(session.metadata).toMatchObject({ title: 'card 1' });
    session.handlers.pause!();
    expect(session.playbackState).toBe('paused');
  });

  it('subscribe emits current and subsequent states', async () => {
    const { engine } = setup();
    const seen: number[] = [];
    const off = engine.subscribe(st => seen.push(st.stepIndex));
    await engine.play(); await flush();
    off();
    engine.nextCard(); await flush();
    expect(seen[0]).toBe(0);
    expect(seen).not.toContain(4);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd app && npx vitest run src/player/AudioEngine.test.ts`
Expected: FAIL — `Failed to resolve import "./AudioEngine"`

- [ ] **Step 3: Реализация**

`app/src/player/AudioEngine.ts`:
```ts
import { cardStartStep, type Side, type Step } from '../domain/sequence';

export interface AudioLike {
  src: string;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(
    action: 'play' | 'pause' | 'nexttrack' | 'previoustrack',
    handler: (() => void) | null,
  ): void;
}

export interface EngineState {
  stepIndex: number;
  cardIndex: number;
  side: Side | null;
  playing: boolean;
  finished: boolean;
}

export interface EngineOptions {
  resolve: (url: string) => Promise<string>;
  audio?: AudioLike;
  mediaSession?: MediaSessionLike | null;
  describeCard?: (cardIndex: number) => { title: string; artist: string };
  onError?: (message: string) => void;
}

export const NO_AUDIO_MESSAGE = 'Нет звука для карточки — скачайте набор для офлайна';

export class AudioEngine {
  private steps: Step[] = [];
  private index = 0;
  private loadedIndex = -1;
  private playing = false;
  private finished = false;
  private loop = false;
  private rate = 1;
  private retried = false;
  private token = 0;
  private lastCard = -1;
  private listeners = new Set<(s: EngineState) => void>();
  private readonly audio: AudioLike;
  private readonly session: MediaSessionLike | null;

  constructor(private readonly opts: EngineOptions) {
    this.audio = opts.audio ?? new Audio();
    this.session = opts.mediaSession !== undefined
      ? opts.mediaSession
      : (typeof navigator !== 'undefined' && 'mediaSession' in navigator
        ? (navigator.mediaSession as unknown as MediaSessionLike) : null);
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('error', () => this.onStepError(this.token));
    this.session?.setActionHandler('play', () => void this.play());
    this.session?.setActionHandler('pause', () => this.pause());
    this.session?.setActionHandler('nexttrack', () => this.nextCard());
    this.session?.setActionHandler('previoustrack', () => this.prevCard());
  }

  load(steps: Step[], opts: { loop: boolean; rate: number }): void {
    this.audio.pause();
    this.token++;
    this.steps = steps;
    this.loop = opts.loop;
    this.rate = opts.rate;
    this.index = 0;
    this.loadedIndex = -1;
    this.playing = false;
    this.finished = false;
    this.retried = false;
    this.lastCard = -1;
    this.emit();
  }

  subscribe(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  getState(): EngineState {
    const step = this.steps[this.index];
    return {
      stepIndex: this.index,
      cardIndex: step?.cardIndex ?? 0,
      side: step?.kind === 'audio' ? step.side : null,
      playing: this.playing,
      finished: this.finished,
    };
  }

  async play(): Promise<void> {
    if (this.steps.length === 0) return;
    if (this.finished) {
      this.finished = false;
      this.index = 0;
      this.loadedIndex = -1;
    }
    this.playing = true;
    if (this.loadedIndex === this.index) {
      this.emit();
      try {
        await this.audio.play();
      } catch {
        this.onStepError(this.token);
      }
      return;
    }
    await this.playStep(this.index);
  }

  pause(): void {
    this.playing = false;
    this.audio.pause();
    this.emit();
  }

  nextCard(): void {
    this.goToCard(this.getState().cardIndex + 1);
  }

  prevCard(): void {
    this.goToCard(Math.max(this.getState().cardIndex - 1, 0));
  }

  setRate(rate: number): void {
    this.rate = rate;
    const step = this.steps[this.loadedIndex];
    if (step?.kind === 'audio') this.audio.playbackRate = rate;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  destroy(): void {
    this.token++;
    this.playing = false;
    this.audio.pause();
    this.listeners.clear();
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) {
      this.session?.setActionHandler(action, null);
    }
    if (this.session) this.session.playbackState = 'none';
  }

  private goToCard(cardIndex: number): void {
    let start = cardStartStep(this.steps, cardIndex);
    if (start === -1) {
      if (!this.loop) {
        this.finish();
        return;
      }
      start = 0;
    }
    this.retried = false;
    if (this.playing) {
      void this.playStep(start);
    } else {
      this.token++;
      this.index = start;
      this.loadedIndex = -1;
      this.finished = false;
      this.emit();
    }
  }

  private async playStep(i: number): Promise<void> {
    if (i >= this.steps.length) {
      if (!this.loop) {
        this.finish();
        return;
      }
      i = 0;
    }
    const token = ++this.token;
    this.index = i;
    this.emit();
    const step = this.steps[i];
    try {
      const src = await this.opts.resolve(step.url);
      if (token !== this.token) return;
      this.audio.src = src;
      this.audio.playbackRate = step.kind === 'audio' ? this.rate : 1;
      this.loadedIndex = i;
      await this.audio.play();
    } catch {
      this.onStepError(token);
      return;
    }
    const next = this.steps[i + 1];
    if (next) this.opts.resolve(next.url).catch(() => {});
  }

  private onEnded(): void {
    if (!this.playing) return;
    this.retried = false;
    void this.playStep(this.index + 1);
  }

  private onStepError(token: number): void {
    if (token !== this.token || !this.playing) return;
    if (!this.retried) {
      this.retried = true;
      void this.playStep(this.index);
      return;
    }
    this.retried = false;
    this.opts.onError?.(NO_AUDIO_MESSAGE);
    const nextStart = cardStartStep(this.steps, this.getState().cardIndex + 1);
    void this.playStep(nextStart === -1 ? this.steps.length : nextStart);
  }

  private finish(): void {
    this.token++;
    this.playing = false;
    this.finished = true;
    this.loadedIndex = -1;
    this.audio.pause();
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    if (this.session) {
      this.session.playbackState = state.playing ? 'playing' : 'paused';
      if (state.cardIndex !== this.lastCard && this.opts.describeCard && this.steps.length > 0) {
        this.lastCard = state.cardIndex;
        const info = this.opts.describeCard(state.cardIndex);
        const Meta = (globalThis as { MediaMetadata?: new (i: object) => unknown }).MediaMetadata;
        this.session.metadata = Meta ? new Meta(info) : info;
      }
    }
    this.listeners.forEach(fn => fn(state));
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd app && npx vitest run src/player/AudioEngine.test.ts`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add app/src/player
git commit -m "feat(app): audio engine with retries and media session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Загрузка контента и офлайн-хранилище аудио

**Files:**
- Create: `app/src/data/content.ts`, `app/src/data/offline.ts`
- Test: `app/src/data/content.test.ts`, `app/src/data/offline.test.ts`

**Interfaces:**
- Consumes: `ContentIndex`, `TopicContent`, `Card` (types.ts); `silenceUrl` (sequence.ts).
- Produces (`content.ts`): `contentUrl(rel: string): string` (`${import.meta.env.BASE_URL}content/${rel}`); `loadIndex(fetcher?): Promise<ContentIndex>`; `loadTopic(id: string, fetcher?): Promise<TopicContent>`; `loadAllCards(index: ContentIndex, fetcher?): Promise<Card[]>`; `audioUrlsFor(cards: Card[]): string[]` (уникальные относительные URL речи + всех файлов тишины `1,3,5,8,10`).
- Produces (`offline.ts`): `AUDIO_CACHE = 'audio-v1'`; `class OfflineError extends Error { reason: 'quota' | 'network' }`; `interface CacheLike { match(url): Promise<Response | undefined>; put(url, res): Promise<void>; delete(url): Promise<boolean> }`; `class AudioStore` с методами `resolve(rel): Promise<string>`, `download(rels, onProgress?: (done, total) => void): Promise<void>`, `isDownloaded(rels): Promise<boolean>`; синглтон `audioStore`.

`resolve` отдаёт `blob:` URL: на iOS это надёжнее, чем отдавать mp3 из service worker (Safari запрашивает аудио по диапазонам байт). Последние 30 blob-URL держатся в памяти, более старые освобождаются.

- [ ] **Step 1: Написать падающие тесты**

`app/src/data/content.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Card, ContentIndex } from '../types';
import { audioUrlsFor, contentUrl, loadAllCards, loadIndex } from './content';

const json = (data: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(data), { status }));

describe('content', () => {
  it('builds urls from base', () => {
    expect(contentUrl('index.json')).toBe('/content/index.json');
  });

  it('loads index and throws on http error', async () => {
    const index: ContentIndex = { contentVersion: 'v', topics: [] };
    await expect(loadIndex(() => json(index))).resolves.toEqual(index);
    await expect(loadIndex(() => json({}, 404))).rejects.toThrow('404');
  });

  it('loads cards of all topics', async () => {
    const index = { contentVersion: 'v', topics: [{ id: 'a' }, { id: 'b' }] } as ContentIndex;
    const fetcher = (url: RequestInfo | URL) =>
      json({ id: String(url).includes('/a.json') ? 'a' : 'b', cards: [{ id: String(url).slice(-6, -5) }] });
    const cards = await loadAllCards(index, fetcher as typeof fetch);
    expect(cards.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('collects unique audio urls plus silence', () => {
    const c = (id: string, en: string): Card =>
      ({ id, set: 1, en: id, ru: id, enEx: '', ruEx: '', enAudio: en, ruAudio: `audio/${id}r.mp3` });
    const urls = audioUrlsFor([c('x', 'audio/same.mp3'), c('y', 'audio/same.mp3')]);
    expect(urls).toEqual([
      'audio/same.mp3', 'audio/xr.mp3', 'audio/yr.mp3',
      'audio/silence_1s.mp3', 'audio/silence_3s.mp3', 'audio/silence_5s.mp3',
      'audio/silence_8s.mp3', 'audio/silence_10s.mp3',
    ]);
  });
});
```

`app/src/data/offline.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { AudioStore, OfflineError, type CacheLike } from './offline';

class MapCache implements CacheLike {
  store = new Map<string, Response>();
  failPutAfter = Infinity;
  async match(url: string) { return this.store.get(url)?.clone(); }
  async put(url: string, res: Response) {
    if (this.store.size >= this.failPutAfter) throw new DOMException('full', 'QuotaExceededError');
    this.store.set(url, res);
  }
  async delete(url: string) { return this.store.delete(url); }
}

function setup(failNetwork = false) {
  const cache = new MapCache();
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    failNetwork ? new Response('', { status: 503 }) : new Response(`data:${url}`));
  let n = 0;
  const store = new AudioStore(async () => cache, fetcher as typeof fetch, () => `blob:${++n}`, () => {});
  return { cache, fetcher, store };
}

describe('AudioStore', () => {
  it('resolve fetches from network and memoizes blob url', async () => {
    const { store, fetcher } = setup();
    const u1 = await store.resolve('audio/a.mp3');
    const u2 = await store.resolve('audio/a.mp3');
    expect(u1).toBe('blob:1');
    expect(u2).toBe(u1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/content/audio/a.mp3');
  });

  it('resolve prefers cache', async () => {
    const { store, cache, fetcher } = setup();
    await cache.put('/content/audio/a.mp3', new Response('cached'));
    await store.resolve('audio/a.mp3');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('resolve throws when network fails and not cached', async () => {
    const { store } = setup(true);
    await expect(store.resolve('audio/a.mp3')).rejects.toThrow();
  });

  it('download caches all and reports progress; isDownloaded', async () => {
    const { store } = setup();
    const progress: number[] = [];
    expect(await store.isDownloaded(['audio/a.mp3', 'audio/b.mp3'])).toBe(false);
    await store.download(['audio/a.mp3', 'audio/b.mp3'], done => progress.push(done));
    expect(progress).toEqual([1, 2]);
    expect(await store.isDownloaded(['audio/a.mp3', 'audio/b.mp3'])).toBe(true);
  });

  it('download on quota error removes what it added and throws quota', async () => {
    const { store, cache } = setup();
    await cache.put('/content/audio/old.mp3', new Response('x'));
    cache.failPutAfter = 2;
    const err = await store.download(['audio/a.mp3', 'audio/b.mp3']).catch(e => e);
    expect(err).toBeInstanceOf(OfflineError);
    expect(err.reason).toBe('quota');
    expect([...cache.store.keys()]).toEqual(['/content/audio/old.mp3']);
  });

  it('download on network error throws network', async () => {
    const { store } = setup(true);
    const err = await store.download(['audio/a.mp3']).catch(e => e);
    expect(err.reason).toBe('network');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd app && npx vitest run src/data`
Expected: FAIL — `Failed to resolve import "./content"` и `"./offline"`

- [ ] **Step 3: Реализация `content.ts`**

`app/src/data/content.ts`:
```ts
import { silenceUrl } from '../domain/sequence';
import type { Card, ContentIndex, TopicContent } from '../types';

const SILENCE_SECONDS = [1, 3, 5, 8, 10];

export function contentUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}content/${rel}`;
}

async function getJson<T>(rel: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(contentUrl(rel), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Не удалось загрузить ${rel}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function loadIndex(fetcher: typeof fetch = fetch): Promise<ContentIndex> {
  return getJson<ContentIndex>('index.json', fetcher);
}

export function loadTopic(id: string, fetcher: typeof fetch = fetch): Promise<TopicContent> {
  return getJson<TopicContent>(`topics/${id}.json`, fetcher);
}

export async function loadAllCards(index: ContentIndex, fetcher: typeof fetch = fetch): Promise<Card[]> {
  const topics = await Promise.all(index.topics.map(t => loadTopic(t.id, fetcher)));
  return topics.flatMap(t => t.cards);
}

export function audioUrlsFor(cards: Card[]): string[] {
  const urls = new Set<string>();
  for (const c of cards) {
    urls.add(c.enAudio);
    urls.add(c.ruAudio);
  }
  SILENCE_SECONDS.forEach(s => urls.add(silenceUrl(s)));
  return [...urls];
}
```

Порядок `audioUrlsFor` в тесте: `same` (en x), `xr` (ru x), `same` повтор пропускается, `yr`, затем тишина — совпадает.

- [ ] **Step 4: Реализация `offline.ts`**

`app/src/data/offline.ts`:
```ts
import { contentUrl } from './content';

export const AUDIO_CACHE = 'audio-v1';
const MAX_BLOB_URLS = 30;

export class OfflineError extends Error {
  constructor(public readonly reason: 'quota' | 'network') {
    super(reason === 'quota'
      ? 'Не хватает места на телефоне для скачивания набора'
      : 'Не удалось скачать набор — проверьте интернет');
  }
}

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export class AudioStore {
  private blobUrls = new Map<string, string>();

  constructor(
    private readonly openCache: () => Promise<CacheLike>,
    private readonly fetcher: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args),
    private readonly makeUrl: (b: Blob) => string = b => URL.createObjectURL(b),
    private readonly revoke: (u: string) => void = u => URL.revokeObjectURL(u),
  ) {}

  async resolve(rel: string): Promise<string> {
    const known = this.blobUrls.get(rel);
    if (known) return known;
    const abs = contentUrl(rel);
    const cache = await this.openCache();
    let res = await cache.match(abs);
    if (!res) {
      res = await this.fetcher(abs);
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${rel}`);
    }
    const url = this.makeUrl(await res.blob());
    this.blobUrls.set(rel, url);
    if (this.blobUrls.size > MAX_BLOB_URLS) {
      const [oldestKey, oldestUrl] = this.blobUrls.entries().next().value!;
      this.blobUrls.delete(oldestKey);
      this.revoke(oldestUrl);
    }
    return url;
  }

  async download(rels: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const cache = await this.openCache();
    const added: string[] = [];
    let done = 0;
    try {
      for (const rel of rels) {
        const abs = contentUrl(rel);
        if (!(await cache.match(abs))) {
          let res: Response;
          try {
            res = await this.fetcher(abs);
          } catch {
            throw new OfflineError('network');
          }
          if (!res.ok) throw new OfflineError('network');
          await cache.put(abs, res);
          added.push(abs);
        }
        onProgress?.(++done, rels.length);
      }
    } catch (e) {
      if (e instanceof OfflineError && e.reason === 'network') throw e;
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        await Promise.all(added.map(a => cache.delete(a)));
        throw new OfflineError('quota');
      }
      throw e;
    }
  }

  async isDownloaded(rels: string[]): Promise<boolean> {
    const cache = await this.openCache();
    for (const rel of rels) {
      if (!(await cache.match(contentUrl(rel)))) return false;
    }
    return true;
  }
}

export const audioStore = new AudioStore(() => caches.open(AUDIO_CACHE));
```

Примечание: `audioStore` создаётся при импорте, но `caches.open` вызывается лениво — в тестах (Node) синглтон не используется.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `cd app && npx vitest run src/data`
Expected: `10 passed`

- [ ] **Step 6: Commit**

```bash
git add app/src/data/content.ts app/src/data/offline.ts app/src/data/content.test.ts app/src/data/offline.test.ts
git commit -m "feat(app): content loading and offline audio store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: PWA, прототип плеера, деплой и контрольная точка на iPhone

Цель — как можно раньше проверить главный риск: продолжает ли PWA на iPhone играть при выключенном экране. Прототип временный и будет удалён в Task 13.

**Files:**
- Create: `tools/make_icons.py`, `app/public/icon-192.png`, `app/public/icon-512.png`, `app/src/ui/Prototype.tsx`, `.github/workflows/deploy.yml`
- Modify: `app/vite.config.ts`, `app/tsconfig.json`, `app/src/main.tsx`

**Interfaces:**
- Consumes: `loadIndex`, `loadTopic` (content.ts); `audioStore` (offline.ts); `buildSequence`, `sideText` (sequence.ts); `AudioEngine`, `EngineState` (AudioEngine.ts); `DEFAULT_SETTINGS` (types.ts).
- Produces: рабочий деплой на `https://<user>.github.io/<repo>/`.

- [ ] **Step 1: Иконки**

`tools/make_icons.py` (только стандартная библиотека):
```python
"""Генерирует простые PNG-иконки: индиго-фон и белая «карточка»."""
import struct
import zlib
from pathlib import Path

BG = (99, 102, 241)
FG = (249, 250, 251)
OUT = Path(__file__).resolve().parent.parent / "app" / "public"


def png(size: int) -> bytes:
    rows = []
    lo, hi = int(size * 0.22), int(size * 0.78)
    top, bottom = int(size * 0.3), int(size * 0.7)
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(FG if lo <= x < hi and top <= y < bottom else BG)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


for s in (192, 512):
    (OUT / f"icon-{s}.png").write_bytes(png(s))
    print(f"icon-{s}.png")
```

Run: `.venv/Scripts/python tools/make_icons.py`
Expected: `icon-192.png`, `icon-512.png`; файлы открываются как картинки.

- [ ] **Step 2: Подключить PWA**

`app/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Карточки слов',
        short_name: 'Карточки',
        lang: 'ru',
        display: 'standalone',
        start_url: '.',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        globIgnores: ['content/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/content/') && url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'content-json', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
});
```

В `app/tsconfig.json` заменить `"types": ["vite/client"]` на:
```json
    "types": ["vite/client", "vite-plugin-pwa/client"]
```

Mp3 не попадают в precache и не обслуживаются service worker: их кэширует `AudioStore` (Task 10).

- [ ] **Step 3: Прототип плеера**

`app/src/ui/Prototype.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import { audioStore } from '../data/offline';
import { loadIndex, loadTopic } from '../data/content';
import { buildSequence, sideText } from '../domain/sequence';
import { AudioEngine, type EngineState } from '../player/AudioEngine';
import { DEFAULT_SETTINGS, type Card } from '../types';

// Временный экран для проверки фонового аудио на iPhone. Удаляется в Task 13.
export function Prototype() {
  const [cards, setCards] = useState<Card[]>([]);
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState('');
  const engine = useMemo(() => new AudioEngine({
    resolve: url => audioStore.resolve(url),
    describeCard: i => ({ title: `${cards[i]?.en ?? ''} — ${cards[i]?.ru ?? ''}`, artist: 'Карточки слов' }),
    onError: setError,
  }), [cards]);

  useEffect(() => {
    loadIndex()
      .then(index => loadTopic(index.topics[0].id))
      .then(topic => setCards(topic.cards))
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    engine.load(buildSequence(cards, DEFAULT_SETTINGS), { loop: true, rate: 1 });
    const off = engine.subscribe(setState);
    return () => { off(); engine.destroy(); };
  }, [engine]);

  const card = state ? cards[state.cardIndex] : undefined;
  return (
    <main style={{ padding: '24px 0' }}>
      <h1>Прототип плеера</h1>
      {card && state && (
        <div style={{ fontSize: 28, margin: '24px 0' }}>
          <div>{sideText(card, 'front', 'en-ru').main}</div>
          <div style={{ color: 'var(--muted)' }}>{state.side === 'back' ? card.ru : '…'}</div>
        </div>
      )}
      <button onClick={() => (state?.playing ? engine.pause() : engine.play())} style={{ fontSize: 24 }}>
        {state?.playing ? '⏸ Пауза' : '▶ Играть'}
      </button>{' '}
      <button onClick={() => engine.nextCard()} style={{ fontSize: 24 }}>⏭</button>
      <p>Карточек: {cards.length}. Шаг: {state?.stepIndex ?? '-'}</p>
      {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
    </main>
  );
}
```

`app/src/main.tsx`:
```tsx
import { render } from 'preact';
import './styles.css';
import { Prototype } from './ui/Prototype';

render(<Prototype />, document.getElementById('app')!);
```

- [ ] **Step 4: Локальная проверка**

Run: `cd app && npm test && npm run build && npm run preview`
Expected: тесты зелёные, сборка создаёт `dist/sw.js` и `dist/manifest.webmanifest`. На http://localhost:4173 «▶ Играть» проигрывает карточки «Приветствия» с паузами; «⏭» переключает карточку.

- [ ] **Step 5: Workflow деплоя**

`.github/workflows/deploy.yml`:
```yaml
name: Test and deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  test-tools:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.13'
      - run: pip install -r tools/requirements.txt
      - run: python -m pytest -q
        working-directory: tools

  build:
    needs: test-tools
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          BASE_PATH: /${{ github.event.repository.name }}/
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: Commit**

```bash
git add tools/make_icons.py app/public/icon-192.png app/public/icon-512.png app/vite.config.ts app/tsconfig.json app/src .github
git commit -m "feat(app): PWA setup, player prototype, Pages deploy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: ДЕЙСТВИЕ ПОЛЬЗОВАТЕЛЯ — репозиторий на GitHub**

Исполнитель останавливается и просит пользователя:
1. На github.com создать **пустой** репозиторий (например, `word-cards`), без README.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Сообщить URL репозитория.

После этого (с разрешения пользователя на push):
```bash
git remote add origin https://github.com/<user>/word-cards.git
git push -u origin main
```
Expected: во вкладке Actions зелёный прогон «Test and deploy»; сайт открывается по `https://<user>.github.io/word-cards/`.

- [ ] **Step 8: КОНТРОЛЬНАЯ ТОЧКА — iPhone**

Пользователь на iPhone:
1. Safari → открыть URL → «Поделиться» → «На экран „Домой“» → открыть с иконки.
2. «▶ Играть» → дослушать 2 карточки при включённом экране.
3. Заблокировать телефон → звук идёт ещё минимум 3 карточки (с паузами).
4. На экране блокировки виден текст карточки; кнопка «вперёд» переключает карточку; пауза/продолжение работают. Повторить с наушниками (двойное нажатие = следующая).

Если пункт 3 или 4 не работает — **не продолжать** к Task 12. Зафиксировать поведение (на какой карточке/паузе замолкает) и разбирать через superpowers:systematic-debugging. Первые гипотезы: (а) задержка `resolve` между шагами — проверить, что следующий шаг уже прогрет; (б) смена `src` в фоне — вариант с двумя чередующимися `<audio>`; (в) склейка набора в один длинный blob на клиенте.

---

### Task 12: База данных (IndexedDB)

**Files:**
- Create: `app/src/data/db.ts`
- Test: `app/src/data/db.test.ts`

**Interfaces:**
- Consumes: `Profile`, `Settings`, `Progress`, `DEFAULT_SETTINGS` (types.ts); `ProgressMap` (selection.ts).
- Produces:

```ts
export class ImportError extends Error {}
export class Store {
  static open(name?: string): Promise<Store>;            // по умолчанию 'word-cards'
  listProfiles(): Promise<Profile[]>;                     // по createdAt
  addProfile(name: string): Promise<Profile>;             // name обрезается; пустое → Error
  deleteProfile(id: string): Promise<void>;               // вместе с настройками и прогрессом
  getSettings(profileId: string): Promise<Settings>;      // DEFAULT_SETTINGS + сохранённое
  saveSettings(profileId: string, s: Settings): Promise<void>;
  getProgressMap(profileId: string): Promise<ProgressMap>;
  putProgress(p: Progress): Promise<void>;
  exportProfile(profileId: string): Promise<string>;      // JSON
  importProfile(json: string): Promise<Profile>;          // заменяет профиль с тем же id; ошибка → ImportError, данные не меняются
}
```

Формат экспорта:
```json
{"app": "word-cards", "version": 1, "profile": {...}, "settings": {...}, "progress": [...]}
```

- [ ] **Step 1: Написать падающие тесты**

`app/src/data/db.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Progress } from '../types';
import { ImportError, Store } from './db';

let n = 0;
const open = () => Store.open(`test-${++n}`);
const prog = (profileId: string, cardId: string, box: number): Progress =>
  ({ profileId, cardId, box, nextDue: '2026-10-06', lastSeen: '2026-10-05', starred: false });

describe('Store', () => {
  it('adds and lists profiles in creation order', async () => {
    const db = await open();
    const a = await db.addProfile('  Вадим ');
    const b = await db.addProfile('Аня');
    expect(a.name).toBe('Вадим');
    expect((await db.listProfiles()).map(p => p.id)).toEqual([a.id, b.id]);
    await expect(db.addProfile('   ')).rejects.toThrow();
  });

  it('settings default and save', async () => {
    const db = await open();
    const p = await db.addProfile('A');
    expect(await db.getSettings(p.id)).toEqual(DEFAULT_SETTINGS);
    const s = { ...DEFAULT_SETTINGS, pauseSec: 8 as const };
    await db.saveSettings(p.id, s);
    expect(await db.getSettings(p.id)).toEqual(s);
  });

  it('progress is per profile', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    const b = await db.addProfile('B');
    await db.putProgress(prog(a.id, 'c1', 2));
    await db.putProgress(prog(b.id, 'c1', 4));
    await db.putProgress(prog(a.id, 'c1', 3));
    const map = await db.getProgressMap(a.id);
    expect(map.size).toBe(1);
    expect(map.get('c1')?.box).toBe(3);
  });

  it('deleteProfile removes settings and progress', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    await db.saveSettings(a.id, { ...DEFAULT_SETTINGS, loop: true });
    await db.putProgress(prog(a.id, 'c1', 2));
    await db.deleteProfile(a.id);
    expect(await db.listProfiles()).toEqual([]);
    expect((await db.getProgressMap(a.id)).size).toBe(0);
    expect(await db.getSettings(a.id)).toEqual(DEFAULT_SETTINGS);
  });

  it('export then import into a fresh database restores everything', async () => {
    const src = await open();
    const a = await src.addProfile('A');
    await src.saveSettings(a.id, { ...DEFAULT_SETTINGS, rate: 1.2 });
    await src.putProgress(prog(a.id, 'c1', 5));
    const json = await src.exportProfile(a.id);

    const dst = await open();
    const imported = await dst.importProfile(json);
    expect(imported).toEqual(a);
    expect((await dst.getSettings(a.id)).rate).toBe(1.2);
    expect((await dst.getProgressMap(a.id)).get('c1')?.box).toBe(5);
  });

  it('import replaces progress of an existing profile', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    await db.putProgress(prog(a.id, 'c1', 1));
    const json = await db.exportProfile(a.id);
    await db.putProgress(prog(a.id, 'c2', 3));
    await db.importProfile(json);
    expect([...(await db.getProgressMap(a.id)).keys()]).toEqual(['c1']);
  });

  it('rejects broken import without changes', async () => {
    const db = await open();
    await expect(db.importProfile('not json')).rejects.toBeInstanceOf(ImportError);
    await expect(db.importProfile('{"app":"other","version":1}')).rejects.toBeInstanceOf(ImportError);
    const bad = JSON.stringify({ app: 'word-cards', version: 1,
      profile: { id: 'x', name: 'X', createdAt: '2026-01-01' }, settings: DEFAULT_SETTINGS,
      progress: [{ profileId: 'x', cardId: 'c', box: 9 }] });
    await expect(db.importProfile(bad)).rejects.toBeInstanceOf(ImportError);
    expect(await db.listProfiles()).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `cd app && npx vitest run src/data/db.test.ts`
Expected: FAIL — `Failed to resolve import "./db"`

- [ ] **Step 3: Реализация**

`app/src/data/db.ts`:
```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProgressMap } from '../domain/selection';
import { DEFAULT_SETTINGS, type Profile, type Progress, type Settings } from '../types';

interface CardsDB extends DBSchema {
  profiles: { key: string; value: Profile };
  settings: { key: string; value: { profileId: string; settings: Settings } };
  progress: { key: [string, string]; value: Progress; indexes: { byProfile: string } };
}

interface ExportFile {
  app: 'word-cards';
  version: 1;
  profile: Profile;
  settings: Settings;
  progress: Progress[];
}

export class ImportError extends Error {
  constructor() {
    super('Файл повреждён или не является резервной копией карточек');
  }
}

// Строго возрастающие метки времени: два профиля, созданные в одну миллисекунду, сохраняют порядок.
let lastStamp = 0;
function nextStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

function isValidExport(d: unknown): d is ExportFile {
  if (typeof d !== 'object' || d === null) return false;
  const f = d as Partial<ExportFile>;
  const p = f.profile;
  return f.app === 'word-cards' && f.version === 1
    && !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.createdAt === 'string'
    && typeof f.settings === 'object' && f.settings !== null
    && Array.isArray(f.progress)
    && f.progress.every(x => typeof x?.cardId === 'string' && Number.isInteger(x.box) && x.box >= 0 && x.box <= 5);
}

export class Store {
  private constructor(private readonly db: IDBPDatabase<CardsDB>) {}

  static async open(name = 'word-cards'): Promise<Store> {
    const db = await openDB<CardsDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore('profiles', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'profileId' });
        const progress = db.createObjectStore('progress', { keyPath: ['profileId', 'cardId'] });
        progress.createIndex('byProfile', 'profileId');
      },
    });
    return new Store(db);
  }

  async listProfiles(): Promise<Profile[]> {
    const all = await this.db.getAll('profiles');
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addProfile(name: string): Promise<Profile> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Введите имя');
    const profile: Profile = { id: crypto.randomUUID(), name: trimmed, createdAt: nextStamp() };
    await this.db.put('profiles', profile);
    return profile;
  }

  async deleteProfile(id: string): Promise<void> {
    const tx = this.db.transaction(['profiles', 'settings', 'progress'], 'readwrite');
    await tx.objectStore('profiles').delete(id);
    await tx.objectStore('settings').delete(id);
    const keys = await tx.objectStore('progress').index('byProfile').getAllKeys(id);
    await Promise.all(keys.map(k => tx.objectStore('progress').delete(k)));
    await tx.done;
  }

  async getSettings(profileId: string): Promise<Settings> {
    const row = await this.db.get('settings', profileId);
    return { ...DEFAULT_SETTINGS, ...row?.settings };
  }

  async saveSettings(profileId: string, settings: Settings): Promise<void> {
    await this.db.put('settings', { profileId, settings });
  }

  async getProgressMap(profileId: string): Promise<ProgressMap> {
    const rows = await this.db.getAllFromIndex('progress', 'byProfile', profileId);
    return new Map(rows.map(p => [p.cardId, p]));
  }

  async putProgress(p: Progress): Promise<void> {
    await this.db.put('progress', p);
  }

  async exportProfile(profileId: string): Promise<string> {
    const profile = await this.db.get('profiles', profileId);
    if (!profile) throw new Error('Профиль не найден');
    const file: ExportFile = {
      app: 'word-cards', version: 1, profile,
      settings: await this.getSettings(profileId),
      progress: [...(await this.getProgressMap(profileId)).values()],
    };
    return JSON.stringify(file);
  }

  async importProfile(json: string): Promise<Profile> {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new ImportError();
    }
    if (!isValidExport(data)) throw new ImportError();
    const { profile, settings, progress } = data;
    const tx = this.db.transaction(['profiles', 'settings', 'progress'], 'readwrite');
    const progressStore = tx.objectStore('progress');
    const oldKeys = await progressStore.index('byProfile').getAllKeys(profile.id);
    await Promise.all(oldKeys.map(k => progressStore.delete(k)));
    await tx.objectStore('profiles').put(profile);
    await tx.objectStore('settings').put({ profileId: profile.id, settings: { ...DEFAULT_SETTINGS, ...settings } });
    await Promise.all(progress.map(p => progressStore.put({ ...p, profileId: profile.id })));
    await tx.done;
    return profile;
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `cd app && npx vitest run src/data/db.test.ts`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add app/src/data/db.ts app/src/data/db.test.ts
git commit -m "feat(app): IndexedDB store for profiles, settings, progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Оболочка приложения, профили, настройки

**Files:**
- Create: `app/src/ui/App.tsx`, `app/src/ui/screens/ProfilesScreen.tsx`, `app/src/ui/screens/SettingsScreen.tsx`
- Modify: `app/src/main.tsx`, `app/src/styles.css`
- Delete: `app/src/ui/Prototype.tsx`

**Interfaces:**
- Consumes: `Store`, `ImportError` (db.ts); `loadIndex`, `loadAllCards`/`loadTopic` (content.ts); типы из types.ts; `ProgressMap` (selection.ts).
- Produces (`App.tsx`) — используется экранами Task 14–16:

```ts
export type Route =
  | { name: 'profiles' }
  | { name: 'topics' }
  | { name: 'set'; topicId: string; setN: number }
  | { name: 'due' }
  | { name: 'card'; title: string; cards: Card[] }
  | { name: 'player'; title: string; cards: Card[]; mode: 'auto' | 'pocket' }
  | { name: 'settings' };

export interface AppCtx {
  store: Store;
  index: ContentIndex;
  cardsByTopic: Map<string, Card[]>;
  profile: Profile;
  settings: Settings;
  progress: ProgressMap;
  go(route: Route): void;       // добавляет экран в стек
  back(): void;                 // возвращает на предыдущий
  home(): void;                 // стек = [topics]
  saveSettings(s: Settings): Promise<void>;
  saveProgress(p: Progress): Promise<void>;
  switchProfile(): void;        // на экран профилей
  reloadProfile(): Promise<void>;
}
export function useApp(): AppCtx;
```

UI-экраны проверяются вручную в браузере (логика уже покрыта тестами доменных модулей); в каждой задаче обязательны `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 1: Стили**

`app/src/styles.css` (полностью заменить):
```css
:root {
  --bg: #111827; --panel: #1f2937; --panel-2: #374151; --text: #f9fafb; --muted: #9ca3af;
  --accent: #6366f1; --good: #22c55e; --warn: #f59e0b; --bad: #ef4444;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font-family: -apple-system, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
#app { min-height: 100%; max-width: 640px; margin: 0 auto;
  padding: calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 16px); }
h1 { font-size: 24px; margin: 8px 0 16px; }
h2 { font-size: 18px; margin: 20px 0 8px; }
p { line-height: 1.4; }
.muted { color: var(--muted); }
.error { color: var(--bad); }
.topbar { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.topbar h1 { flex: 1; margin: 0; font-size: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button, .btn { font: inherit; color: var(--text); background: var(--panel); border: 0; border-radius: 12px;
  padding: 12px 16px; min-height: 44px; cursor: pointer; }
button:active { opacity: .7; }
button:disabled { opacity: .4; }
.primary { background: var(--accent); }
.good { background: var(--good); color: #052e16; }
.warn { background: var(--warn); color: #451a03; }
.icon { background: transparent; font-size: 22px; padding: 8px 10px; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 10px; }
.row > * { flex: 1; }
.list-item { display: block; width: 100%; text-align: left; background: var(--panel); border-radius: 12px; padding: 14px 16px; }
.list-item small { display: block; color: var(--muted); margin-top: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { flex: 0 0 auto; padding: 10px 14px; min-width: 96px; text-align: left; }
.segmented { display: flex; background: var(--panel); border-radius: 12px; padding: 4px; gap: 4px; }
.segmented button { flex: 1; padding: 8px 4px; min-height: 36px; background: transparent; }
.segmented button.on { background: var(--accent); }
.progress { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--panel-2); margin-top: 6px; }
.progress .learning { background: var(--warn); }
.progress .learned { background: var(--good); }
.card { background: var(--panel); border-radius: 20px; min-height: 46vh; padding: 24px; display: flex;
  flex-direction: column; justify-content: center; gap: 16px; text-align: center; user-select: none; }
.card .main { font-size: 32px; font-weight: 600; }
.card .example { font-size: 20px; color: var(--muted); }
.card .divider { height: 1px; background: var(--panel-2); margin: 4px 0; }
.toast { position: fixed; left: 16px; right: 16px; bottom: calc(env(safe-area-inset-bottom) + 16px);
  background: var(--panel-2); border-radius: 12px; padding: 12px 16px; text-align: center; }
input[type=text] { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--panel-2);
  border-radius: 12px; padding: 12px; min-height: 44px; width: 100%; }
```

- [ ] **Step 2: Оболочка `App.tsx`**

`app/src/ui/App.tsx`:
```tsx
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { loadIndex, loadTopic } from '../data/content';
import { Store } from '../data/db';
import { selectDue, type ProgressMap } from '../domain/selection';
import { todayISO } from '../domain/dates';
import type { Card, ContentIndex, Profile, Progress, Settings } from '../types';
import { CardScreen } from './screens/CardScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { ProfilesScreen } from './screens/ProfilesScreen';
import { SetScreen } from './screens/SetScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TopicsScreen } from './screens/TopicsScreen';

export type Route =
  | { name: 'profiles' }
  | { name: 'topics' }
  | { name: 'set'; topicId: string; setN: number }
  | { name: 'due' }
  | { name: 'card'; title: string; cards: Card[] }
  | { name: 'player'; title: string; cards: Card[]; mode: 'auto' | 'pocket' }
  | { name: 'settings' };

export interface AppCtx {
  store: Store;
  index: ContentIndex;
  cardsByTopic: Map<string, Card[]>;
  profile: Profile;
  settings: Settings;
  progress: ProgressMap;
  go(route: Route): void;
  back(): void;
  home(): void;
  saveSettings(s: Settings): Promise<void>;
  saveProgress(p: Progress): Promise<void>;
  switchProfile(): void;
  reloadProfile(): Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp вне App');
  return ctx;
}

const LAST_PROFILE_KEY = 'word-cards:lastProfile';

function readLastProfile(): string | null {
  try { return localStorage.getItem(LAST_PROFILE_KEY); } catch { return null; }
}
function writeLastProfile(id: string): void {
  try { localStorage.setItem(LAST_PROFILE_KEY, id); } catch { /* приватный режим */ }
}

interface Loaded {
  store: Store;
  index: ContentIndex;
  cardsByTopic: Map<string, Card[]>;
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<ProgressMap>(new Map());
  const [stack, setStack] = useState<Route[]>([{ name: 'profiles' }]);

  useEffect(() => {
    (async () => {
      const store = await Store.open();
      const index = await loadIndex();
      const topics = await Promise.all(index.topics.map(t => loadTopic(t.id)));
      const cardsByTopic = new Map(topics.map(t => [t.id, t.cards]));
      setLoaded({ store, index, cardsByTopic });
      const profiles = await store.listProfiles();
      const last = profiles.find(p => p.id === readLastProfile()) ?? (profiles.length === 1 ? profiles[0] : null);
      if (last) await selectProfile(store, last);
    })().catch(e => setLoadError(
      `Не удалось загрузить данные. Откройте приложение с интернетом хотя бы один раз. (${e})`));
  }, []);

  async function selectProfile(store: Store, p: Profile) {
    writeLastProfile(p.id);
    setSettings(await store.getSettings(p.id));
    setProgress(await store.getProgressMap(p.id));
    setProfile(p);
    setStack([{ name: 'topics' }]);
  }

  if (loadError) return <p class="error">{loadError}</p>;
  if (!loaded) return <p class="muted">Загрузка…</p>;

  const route = stack[stack.length - 1];
  if (route.name === 'profiles' || !profile || !settings) {
    return <ProfilesScreen store={loaded.store} onSelect={p => selectProfile(loaded.store, p)} />;
  }

  const ctx: AppCtx = {
    ...loaded, profile, settings, progress,
    go: r => setStack(s => [...s, r]),
    back: () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)),
    home: () => setStack([{ name: 'topics' }]),
    saveSettings: async s => {
      await loaded.store.saveSettings(profile.id, s);
      setSettings(s);
    },
    saveProgress: async p => {
      await loaded.store.putProgress(p);
      setProgress(prev => new Map(prev).set(p.cardId, p));
    },
    switchProfile: () => setStack([{ name: 'profiles' }]),
    reloadProfile: async () => {
      const fresh = (await loaded.store.listProfiles()).find(p => p.id === profile.id);
      if (fresh) await selectProfile(loaded.store, fresh);
      else setStack([{ name: 'profiles' }]);
    },
  };

  return <Ctx.Provider value={ctx}>{renderRoute(route, ctx)}</Ctx.Provider>;
}

function renderRoute(route: Route, ctx: AppCtx) {
  switch (route.name) {
    case 'topics':
      return <TopicsScreen />;
    case 'set': {
      const topic = ctx.index.topics.find(t => t.id === route.topicId)!;
      const cards = (ctx.cardsByTopic.get(route.topicId) ?? []).filter(c => c.set === route.setN);
      return <SetScreen key={`${route.topicId}-${route.setN}`} title={`${topic.title} · набор ${route.setN}`}
        cards={cards} allowModeChoice />;
    }
    case 'due': {
      const all = [...ctx.cardsByTopic.values()].flat();
      return <SetScreen key="due" title="Повторение на сегодня"
        cards={selectDue(all, ctx.progress, todayISO())} allowModeChoice={false} />;
    }
    case 'card':
      return <CardScreen title={route.title} cards={route.cards} />;
    case 'player':
      return <PlayerScreen title={route.title} cards={route.cards} mode={route.mode} />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return null;
  }
}
```

Замечание по `due`: список «на сегодня» пересчитывается при каждом рендере; это нормально — ответы в ручном режиме сдвигают `nextDue` и карточка исчезает из списка после возврата.

- [ ] **Step 3: Экран профилей**

`app/src/ui/screens/ProfilesScreen.tsx`:
```tsx
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
```

- [ ] **Step 4: Экран настроек**

`app/src/ui/screens/SettingsScreen.tsx`:
```tsx
import { useState } from 'preact/hooks';
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
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => app.saveSettings({ ...s, [key]: value });

  async function exportProgress() {
    const json = await app.store.exportProfile(app.profile.id);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `word-cards-${app.profile.name}-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function importProgress(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const profile = await app.store.importProfile(await file.text());
      setMessage(`Восстановлен профиль «${profile.name}»`);
      if (profile.id === app.profile.id) await app.reloadProfile();
    } catch (err) {
      setMessage(err instanceof ImportError ? err.message : `Ошибка импорта: ${err}`);
    }
  }

  async function deleteProfile() {
    if (!confirm(`Удалить профиль «${app.profile.name}» и весь его прогресс?`)) return;
    await app.store.deleteProfile(app.profile.id);
    app.switchProfile();
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
```

- [ ] **Step 5: Заглушки для экранов Task 14–16 и точка входа**

Чтобы проект собирался, создать минимальные файлы (будут полностью заменены в следующих задачах):

`app/src/ui/screens/TopicsScreen.tsx`:
```tsx
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
```

`app/src/ui/screens/SetScreen.tsx`:
```tsx
import type { Card } from '../../types';

export function SetScreen(_: { title: string; cards: Card[]; allowModeChoice: boolean }) {
  return <p class="muted">Экран набора — Task 14</p>;
}
```

`app/src/ui/screens/CardScreen.tsx`:
```tsx
import type { Card } from '../../types';

export function CardScreen(_: { title: string; cards: Card[] }) {
  return <p class="muted">Карточки — Task 15</p>;
}
```

`app/src/ui/screens/PlayerScreen.tsx`:
```tsx
import type { Card } from '../../types';

export function PlayerScreen(_: { title: string; cards: Card[]; mode: 'auto' | 'pocket' }) {
  return <p class="muted">Плеер — Task 16</p>;
}
```

`app/src/main.tsx`:
```tsx
import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
```

Run: `git rm app/src/ui/Prototype.tsx`

- [ ] **Step 6: Проверка**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: все тесты зелёные, без ошибок типов, сборка успешна.

Ручная проверка (`npm run dev`, http://localhost:5173, DevTools в режиме iPhone):
- первый запуск → «Как вас зовут?» → ввести имя → экран «Темы»;
- перезагрузка страницы → сразу «Темы» (профиль запомнен);
- ⚙ → переключатели меняют подсветку и сохраняются после перезагрузки;
- «Сохранить прогресс в файл» скачивает JSON; «Восстановить из файла» с этим файлом → «Восстановлен профиль …»; с произвольным файлом → сообщение об ошибке;
- «Сменить профиль» → список; добавить второй профиль; «Удалить профиль» → подтверждение → список профилей.

- [ ] **Step 7: Commit**

```bash
git add app/src
git commit -m "feat(app): app shell, profiles and settings screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Экран тем и экран набора

**Files:**
- Create: `app/src/ui/components/ProgressBar.tsx`
- Modify (полностью заменить): `app/src/ui/screens/TopicsScreen.tsx`, `app/src/ui/screens/SetScreen.tsx`

**Interfaces:**
- Consumes: `useApp`, `Route` (App.tsx); `bucket` (leitner.ts); `selectForSet`, `selectDue`, `orderCards`, `SetMode` (selection.ts); `audioUrlsFor` (content.ts); `audioStore`, `OfflineError` (offline.ts); `todayISO`.
Упрощение относительно спеки (раздел 5, «Публикация»): если в уже скачанном наборе изменились карточки, набор не докачивается сам — экран набора снова покажет «⬇ Скачать для офлайна», и докачаются только новые файлы.

- Produces: `ProgressBar({ cards, progress })`; `SetScreen({ title, cards, allowModeChoice })` запускает `{ name: 'card' }` или `{ name: 'player', mode }` с уже отобранными и упорядоченными карточками.

- [ ] **Step 1: Полоска прогресса**

`app/src/ui/components/ProgressBar.tsx`:
```tsx
import { bucket } from '../../domain/leitner';
import type { ProgressMap } from '../../domain/selection';
import type { Card } from '../../types';

export function countBuckets(cards: Card[], progress: ProgressMap) {
  const counts = { new: 0, learning: 0, learned: 0 };
  for (const c of cards) counts[bucket(progress.get(c.id))]++;
  return counts;
}

export function ProgressBar({ cards, progress }: { cards: Card[]; progress: ProgressMap }) {
  const total = Math.max(cards.length, 1);
  const c = countBuckets(cards, progress);
  return (
    <div class="progress" title={`выучено ${c.learned}, учу ${c.learning}, новых ${c.new}`}>
      <div class="learned" style={{ width: `${(c.learned / total) * 100}%` }} />
      <div class="learning" style={{ width: `${(c.learning / total) * 100}%` }} />
    </div>
  );
}
```

- [ ] **Step 2: Экран тем**

`app/src/ui/screens/TopicsScreen.tsx`:
```tsx
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
```

- [ ] **Step 3: Экран набора**

`app/src/ui/screens/SetScreen.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
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
  const urls = audioUrlsFor(cards);

  useEffect(() => {
    audioStore.isDownloaded(urls).then(ok => setDownload({ state: ok ? 'yes' : 'no' }))
      .catch(() => setDownload({ state: 'no' }));
  }, [cards]);

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
```

- [ ] **Step 4: Проверка**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: всё зелёное.

Ручная проверка (`npm run dev`):
- «Темы»: тема «Приветствия», чип «Набор 1 · 8», полоска пустая; кнопка «Повторение на сегодня — пока нечего» неактивна;
- чип → экран набора: «Карточек: 8 … новых 8», три кнопки запуска, «⬇ Скачать для офлайна»;
- «Скачать» → счётчик до конца → «✓ Набор скачан»; DevTools → Application → Cache Storage → `audio-v1` содержит 21 файл (16 + 5 тишины);
- после перезагрузки статус «скачан» сохраняется.

- [ ] **Step 5: Commit**

```bash
git add app/src/ui
git commit -m "feat(app): topics and set screens with offline download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Ручной режим (карточка)

**Files:**
- Modify (полностью заменить): `app/src/ui/screens/CardScreen.tsx`

**Interfaces:**
- Consumes: `useApp` (App.tsx); `audioStore` (offline.ts); `applyAnswer`, `newProgress`, `Answer` (leitner.ts); `sideText`, `Side` (sequence.ts); `NO_AUDIO_MESSAGE` (AudioEngine.ts); `todayISO`.
- Produces: `CardScreen({ title, cards })`.

Поведение: показ лицевой стороны и её звук → тап по карточке = переворот + звук обратной стороны → «Знаю»/«Повторить» сохраняют прогресс и ведут к следующей → свайп влево или «Пропустить» = следующая без оценки → в конце итог. Если iOS запретил автозвук первой карточки (нет жеста пользователя, `NotAllowedError`), ошибка не показывается — работает кнопка 🔊.

- [ ] **Step 1: Реализация**

`app/src/ui/screens/CardScreen.tsx`:
```tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import { audioStore } from '../../data/offline';
import { todayISO } from '../../domain/dates';
import { applyAnswer, newProgress, type Answer } from '../../domain/leitner';
import { sideText, type Side } from '../../domain/sequence';
import { NO_AUDIO_MESSAGE } from '../../player/AudioEngine';
import type { Card } from '../../types';
import { useApp } from '../App';

let sharedAudio: HTMLAudioElement | null = null;
const audioEl = () => (sharedAudio ??= new Audio());
const SWIPE_PX = 60;

export function CardScreen({ title, cards }: { title: string; cards: Card[] }) {
  const app = useApp();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState<Record<Answer, number>>({ know: 0, again: 0 });
  const [error, setError] = useState('');
  const touchX = useRef<number | null>(null);
  const card = cards[i];
  const dir = app.settings.direction;

  const audioFor = (c: Card, side: Side) => (sideText(c, side, dir).lang === 'en' ? c.enAudio : c.ruAudio);

  async function play(rel: string) {
    try {
      const a = audioEl();
      a.src = await audioStore.resolve(rel);
      a.playbackRate = app.settings.rate;
      await a.play();
      setError('');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      setError(NO_AUDIO_MESSAGE);
    }
  }

  useEffect(() => {
    if (card) void play(audioFor(card, 'front'));
  }, [i]);
  useEffect(() => () => audioEl().pause(), []);

  function next() {
    setFlipped(false);
    setI(n => n + 1);
  }

  function flip() {
    if (flipped) return;
    setFlipped(true);
    void play(audioFor(card, 'back'));
  }

  async function answer(a: Answer) {
    const p = app.progress.get(card.id) ?? newProgress(app.profile.id, card.id);
    await app.saveProgress(applyAnswer(p, a, todayISO()));
    setStats(s => ({ ...s, [a]: s[a] + 1 }));
    next();
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchX.current;
    touchX.current = null;
    if (start !== null && e.changedTouches[0].clientX - start < -SWIPE_PX) next();
  }

  const topbar = (
    <div class="topbar">
      <button class="icon" onClick={app.back}>←</button>
      <h1>{title}</h1>
      <span class="muted">{Math.min(i + 1, cards.length)}/{cards.length}</span>
    </div>
  );

  if (!card) {
    return (
      <main class="stack">
        {topbar}
        <h2>Набор пройден 🎉</h2>
        <p>Знаю: {stats.know} · Повторить: {stats.again}</p>
        <button class="primary" onClick={() => { setI(0); setStats({ know: 0, again: 0 }); }}>Ещё раз</button>
        <button onClick={app.home}>К темам</button>
      </main>
    );
  }

  const front = sideText(card, 'front', dir);
  const back = sideText(card, 'back', dir);
  return (
    <main class="stack">
      {topbar}
      <div class="card" onClick={flip}
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }} onTouchEnd={onTouchEnd}>
        <div class="main">{front.main}</div>
        {front.example && <div class="example">{front.example}</div>}
        {flipped ? (
          <>
            <div class="divider" />
            <div class="main">{back.main}</div>
            {back.example && <div class="example">{back.example}</div>}
          </>
        ) : (
          <div class="muted">Нажмите, чтобы увидеть перевод</div>
        )}
      </div>
      <div class="row">
        <button onClick={() => play(audioFor(card, flipped ? 'back' : 'front'))}>🔊 Ещё раз</button>
        <button onClick={next}>Пропустить →</button>
      </div>
      {flipped && (
        <div class="row">
          <button class="warn" onClick={() => answer('again')}>Повторить</button>
          <button class="good" onClick={() => answer('know')}>Знаю</button>
        </div>
      )}
      {error && <p class="error">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 2: Проверка**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: всё зелёное.

Ручная проверка (`npm run dev`, режим iPhone в DevTools):
- набор → «🃏 Карточки»: «Hello!», звучит английский; тап → «Привет!» + русский звук; «Знаю» → следующая карточка, счётчик 2/8;
- свайп влево (эмуляция касаний) и «Пропустить» листают без оценки;
- после последней — «Набор пройден», итоги совпадают с нажатиями;
- вернуться в «Темы»: полоска набора окрасилась (учу/выучено); в настройках RU → EN — лицевая сторона русская;
- DevTools → Network → Offline на нескачанном наборе → «Нет звука для карточки — скачайте набор для офлайна».

- [ ] **Step 3: Commit**

```bash
git add app/src/ui/screens/CardScreen.tsx
git commit -m "feat(app): manual card mode with answers and swipe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Автопоказ и режим «в кармане»

**Files:**
- Modify (полностью заменить): `app/src/ui/screens/PlayerScreen.tsx`

**Interfaces:**
- Consumes: `useApp`; `audioStore`; `buildSequence`, `sideText`; `AudioEngine`, `EngineState`; `newProgress`, `markSeen`, `markStarred`; `todayISO`.
- Produces: `PlayerScreen({ title, cards, mode })`.

Поведение: настройки фиксируются при открытии экрана. Старт — только по ▶. Автопоказ: крупная карточка, перевод появляется, когда звучит обратная сторона; экран не гаснет, пока идёт воспроизведение (Wake Lock, при возврате во вкладку — запрашивается заново). «В кармане»: минимальный экран с подсказкой заблокировать телефон. В обоих режимах: ⏮ ⏸/▶ ⏭, «☆ Трудная» (`markStarred`), отметка `lastSeen` при смене карточки, всплывающее сообщение об ошибке звука (4 с), в конце — «Сначала»/«К темам».

- [ ] **Step 1: Реализация**

`app/src/ui/screens/PlayerScreen.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'preact/hooks';
import { audioStore } from '../../data/offline';
import { todayISO } from '../../domain/dates';
import { markSeen, markStarred, newProgress } from '../../domain/leitner';
import { buildSequence, sideText } from '../../domain/sequence';
import { AudioEngine, type EngineState } from '../../player/AudioEngine';
import type { Card } from '../../types';
import { useApp } from '../App';

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => navigator.wakeLock.request('screen')
      .then(l => { if (cancelled) void l.release(); else lock = l; })
      .catch(() => { /* не поддерживается или отказано — просто без блокировки */ });
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export function PlayerScreen({ title, cards, mode }: { title: string; cards: Card[]; mode: 'auto' | 'pocket' }) {
  const app = useApp();
  const [settings] = useState(app.settings);
  const [state, setState] = useState<EngineState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [toast, setToast] = useState('');

  const engine = useMemo(() => new AudioEngine({
    resolve: url => audioStore.resolve(url),
    describeCard: i => ({ title: `${cards[i].en} — ${cards[i].ru}`, artist: title }),
    onError: setToast,
  }), []);

  useEffect(() => {
    engine.load(buildSequence(cards, settings), { loop: settings.loop, rate: settings.rate });
    const off = engine.subscribe(setState);
    return () => { off(); engine.destroy(); };
  }, []);

  const cardIndex = state?.cardIndex ?? 0;
  const playing = state?.playing ?? false;
  const card = cards[cardIndex];

  useEffect(() => setRevealed(false), [cardIndex]);
  useEffect(() => { if (state?.side === 'back') setRevealed(true); }, [state?.side, cardIndex]);

  useEffect(() => {
    if (!playing || !card) return;
    const today = todayISO();
    const p = app.progress.get(card.id) ?? newProgress(app.profile.id, card.id);
    if (p.lastSeen !== today) void app.saveProgress(markSeen(p, today));
  }, [cardIndex, playing]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useWakeLock(mode === 'auto' && playing);

  if (!card) return <p class="muted">Нет карточек</p>;

  const starred = app.progress.get(card.id)?.starred ?? false;
  const star = () => {
    const p = app.progress.get(card.id) ?? newProgress(app.profile.id, card.id);
    void app.saveProgress(markStarred(p, todayISO()));
  };
  const front = sideText(card, 'front', settings.direction);
  const back = sideText(card, 'back', settings.direction);

  return (
    <main class="stack">
      <div class="topbar">
        <button class="icon" onClick={app.back}>←</button>
        <h1>{title}</h1>
        <span class="muted">{cardIndex + 1}/{cards.length}</span>
      </div>

      {mode === 'auto' ? (
        <div class="card">
          <div class="main">{front.main}</div>
          {front.example && <div class="example">{front.example}</div>}
          <div class="divider" />
          {revealed ? (
            <>
              <div class="main">{back.main}</div>
              {back.example && <div class="example">{back.example}</div>}
            </>
          ) : <div class="muted">…</div>}
        </div>
      ) : (
        <div class="card" style={{ minHeight: '30vh' }}>
          <div style={{ fontSize: 48 }}>🎧</div>
          <p>Нажмите ▶ и заблокируйте экран — занятие продолжится.<br />
            Управление — на экране блокировки и кнопками наушников.</p>
          <div class="muted">{card.en} — {card.ru}</div>
        </div>
      )}

      {state?.finished ? (
        <div class="stack">
          <p>Набор закончился.</p>
          <button class="primary" onClick={() => void engine.play()}>Сначала</button>
          <button onClick={app.home}>К темам</button>
        </div>
      ) : (
        <div class="row">
          <button onClick={() => engine.prevCard()}>⏮</button>
          <button class="primary" onClick={() => (playing ? engine.pause() : void engine.play())}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => engine.nextCard()}>⏭</button>
        </div>
      )}

      <button onClick={star} disabled={starred}>{starred ? '★ Отмечена как трудная' : '☆ Трудная'}</button>
      <p class="muted">
        Пауза {settings.pauseSec} с · {settings.direction === 'en-ru' ? 'EN → RU' : 'RU → EN'} · {settings.rate}×
        {settings.loop ? ' · по кругу' : ''}
      </p>
      {toast && <div class="toast">{toast}</div>}
    </main>
  );
}
```

- [ ] **Step 2: Проверка**

Run: `cd app && npm test && npm run typecheck && npm run build`
Expected: всё зелёное.

Ручная проверка (`npm run dev`):
- «▶ Автопоказ» → ▶: английский текст и звук → пауза 5 с → появляется перевод и звучит → пауза → следующая карточка;
- ⏸ останавливает, ▶ продолжает с того же места; ⏭/⏮ переключают карточки;
- «☆ Трудная» → кнопка становится «★ Отмечена как трудная»; в DevTools → Application → IndexedDB → word-cards → progress у карточки `box: 1`, `starred: true`, `nextDue` = завтра;
- в настройках «По кругу» → после последней карточки набор начинается снова; «Стоп» → «Набор закончился» и «Сначала»;
- «🎧 В кармане» → тот же звук, минимальный экран.

- [ ] **Step 3: Commit и деплой**

```bash
git add app/src/ui/screens/PlayerScreen.tsx
git commit -m "feat(app): auto-show and pocket player modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
Expected: Actions зелёные; на iPhone приложение обновляется после перезапуска (autoUpdate service worker; иногда нужно закрыть и открыть приложение дважды).

---

### Task 17: Наполнение тем

**Files:**
- Modify: `content/topics.csv`
- Create: `content/top-500-words.csv`, `content/daily-phrases.csv`, `content/phrasal-verbs.csv`, `content/adverbs-linkers.csv`, `content/irregular-verbs.csv`
- Generated: `app/public/content/**`

Это контентная, а не программная задача: тексты карточек пишет исполнитель по правилам ниже, пользователь проверяет. Каждую тему — отдельным коммитом, чтобы пользователь мог проверять по частям.

**Правила для всех тем:**
- Английский — американский вариант, нейтральный разговорный стиль. Пример — короткое предложение (до 8 слов) уровня A1–B1, в котором слово употреблено в самом частом значении.
- Русский — естественный перевод, а не дословный; для слов — 1–2 основных значения через запятую.
- В тексте нет символа `;` (разделитель CSV) и двойных кавычек.
- `id` — префикс темы + трёхзначный номер подряд (`w001`…); после публикации id не меняются и не переиспользуются.
- Наборы: 20–50 карточек, нумерация с 1.

**Строки `content/topics.csv`** (добавить к существующей `greetings`):
```
top-500-words;500 частых слов;Самые употребимые слова с примерами;2;;
daily-phrases;100 бытовых фраз;Магазин, кафе, транспорт, отель, у врача;3;;
phrasal-verbs;Фразовые глаголы;get up, give up, find out и другие;4;;
adverbs-linkers;Наречия и связки;already, still, however, although…;5;;
irregular-verbs;Неправильные глаголы;Три формы и пример;6;;
```

| Тема | Префикс id | Карточек | Наборы | Формат |
|---|---|---|---|---|
| top-500-words | `w` | 500 | 10 × 50, по частотности (служебные слова — артикли, местоимения — включать только с полезным примером) | `en`=слово, `ru`=перевод, `en_ex`/`ru_ex`=пример |
| daily-phrases | `dp` | 100 | 5 × 20 по ситуациям: магазин, кафе, транспорт, отель, у врача | `en`/`ru` — фраза, примеры пустые |
| phrasal-verbs | `pv` | 100 | 4 × 25, самые частые | глагол + пример |
| adverbs-linkers | `al` | 60 | 3 × 20 | слово + пример |
| irregular-verbs | `iv` | 100 | 4 × 25 по частотности | `en`=`go – went – gone`, `ru`=`идти`, пример в прошедшем времени |

Пример строк каждого формата:
```
w001;1;time;время;What time is it?;Который час?
dp001;1;How much is this?;Сколько это стоит?;;
pv001;1;get up;вставать;I get up at seven.;Я встаю в семь.
al001;1;already;уже;I have already eaten.;Я уже поел.
iv001;1;go – went – gone;идти, ехать;We went to the beach yesterday.;Вчера мы ходили на пляж.
```

Для каждой темы:

- [ ] **Step 1: Написать CSV темы** по правилам выше.

- [ ] **Step 2: Проверить без озвучки**

Run: `.venv/Scripts/python tools/build_content.py --dry-run`
Expected: без ошибок валидации; число карточек совпадает с таблицей.

- [ ] **Step 3: Озвучить и собрать**

Run: `.venv/Scripts/python tools/build_content.py`
Expected: `Готово.` При `Не удалось озвучить N файлов` — просто запустить ещё раз (сгенерируется только недостающее).

- [ ] **Step 4: Выборочно прослушать** 3–5 mp3 новой темы: и английский, и русский, с примером — пауза между словом и примером слышна.

- [ ] **Step 5: Commit**

```bash
git add content app/public/content
git commit -m "content: add <topic-id> topic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

После всех тем — `git push` (с разрешения пользователя) и попросить пользователя просмотреть CSV на предмет неудачных переводов.

---

### Task 18: Чек-лист iPhone и финальная проверка

**Files:**
- Create: `docs/iphone-checklist.md`, `README.md`

- [ ] **Step 1: Чек-лист**

`docs/iphone-checklist.md`:
```markdown
# Проверка на iPhone

Приложение установлено на экран «Домой» (Safari → Поделиться → На экран «Домой»).

## Установка и обновление
- [ ] Иконка и название «Карточки» на экране «Домой»; открывается без адресной строки
- [ ] После деплоя новой версии и перезапуска приложения появляется новая тема

## Ручной режим
- [ ] Звук лицевой стороны (или 🔊, если первый звук не сыграл), переворот тапом, звук перевода
- [ ] «Знаю»/«Повторить», свайп влево, итог набора
- [ ] Прогресс сохраняется после закрытия приложения из переключателя задач

## Автопоказ
- [ ] Цикл EN → пауза → RU → пауза; экран не гаснет минимум 2 минуты
- [ ] ⏸/▶, ⏮/⏭, ☆ Трудная

## В кармане
- [ ] Заблокировать экран — воспроизведение продолжается 5+ минут
- [ ] Экран блокировки: текст карточки, пауза/продолжить, «вперёд»/«назад»
- [ ] Наушники: пауза и следующая карточка
- [ ] Входящее уведомление/звонок не ломает воспроизведение после возврата (▶ продолжает)

## Офлайн
- [ ] Скачать набор → авиарежим → закрыть и открыть приложение → набор играет во всех режимах
- [ ] Нескачанный набор в авиарежиме → понятное сообщение «Нет звука…»

## Резервная копия
- [ ] «Сохранить прогресс в файл» → файл в «Файлах»
- [ ] Удалить профиль → создать заново → «Восстановить из файла» → прогресс вернулся
```

- [ ] **Step 2: README**

`README.md`:
```markdown
# Карточки слов

Личное PWA для изучения английского по карточкам с озвучкой.
Спецификация: `docs/superpowers/specs/2026-10-05-word-cards-design.md`.

## Добавить или изменить тему
1. Отредактировать `content/topics.csv` и `content/<topic-id>.csv` (UTF-8, разделитель `;`).
2. `.venv/Scripts/python tools/build_content.py` — проверка, озвучка новых карточек, JSON.
3. `git add content app/public/content && git commit && git push` — GitHub Actions опубликует.

Первый запуск: `python -m venv .venv && .venv/Scripts/python -m pip install -r tools/requirements.txt`.

## Разработка приложения
    cd app
    npm install
    npm run dev        # http://localhost:5173
    npm test           # Vitest
    npm run build

Тесты Python: `cd tools && ../.venv/Scripts/python -m pytest -q`.
Проверка на телефоне: `docs/iphone-checklist.md`.
```

- [ ] **Step 3: Полная проверка**

Run:
```bash
cd tools && ../.venv/Scripts/python -m pytest -q && cd ../app && npm test && npm run typecheck && npm run build
```
Expected: `34 passed` (Python), все Vitest-тесты зелёные, сборка успешна.

- [ ] **Step 4: Commit и деплой**

```bash
git add README.md docs/iphone-checklist.md
git commit -m "docs: README and iPhone checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 5: Пользователь проходит `docs/iphone-checklist.md`** на iPhone. Найденные проблемы — отдельными задачами через superpowers:systematic-debugging.
