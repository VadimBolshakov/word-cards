# Карточки слов

Личное PWA для изучения английского по карточкам с озвучкой EN/RU: ручной режим, автопоказ и режим
«в кармане» (экран выключен), прогресс по системе Лейтнера хранится на телефоне.

- Приложение: https://vadimbolshakov.github.io/word-cards/
- Спецификация: `docs/superpowers/specs/2026-10-05-word-cards-design.md`
- План реализации: `docs/superpowers/plans/2026-10-05-word-cards.md`
- Проверка на телефоне: `docs/iphone-checklist.md`

## Как устроено

- `content/*.csv` — темы и карточки (единственный источник контента).
- `tools/build_content.py` — проверяет CSV, озвучивает новые карточки (edge-tts, бесплатно),
  пишет JSON и mp3 в `app/public/content/`.
- `app/` — PWA на Vite + Preact + TypeScript. Плеер склеивает весь набор в один mp3-поток
  (так звук не обрывается при заблокированном экране iPhone).
- GitHub Actions при пуше в `main` прогоняет тесты и публикует сайт на GitHub Pages.

## Добавить или изменить тему

1. Добавить строку в `content/topics.csv` и файл `content/<topic-id>.csv`
   (UTF-8, разделитель `;`, колонки `id;set;en;ru;en_ex;ru_ex`; `id` карточки постоянный и уникальный).
2. Проверить без озвучки: `.venv/Scripts/python tools/build_content.py --dry-run`
3. Озвучить и собрать: `.venv/Scripts/python tools/build_content.py`
   (если часть файлов не озвучилась — запустить ещё раз, догенерируется только недостающее).
4. `git add content app/public/content && git commit && git push` — сайт обновится сам.

Первый запуск на новом компьютере:

    python -m venv .venv
    .venv/Scripts/python -m pip install -r tools/requirements.txt

## Разработка приложения

    cd app
    npm install
    npm run dev        # http://localhost:5173
    npm test           # Vitest
    npm run build

Тесты Python: `cd tools && ../.venv/Scripts/python -m pytest -q`.
