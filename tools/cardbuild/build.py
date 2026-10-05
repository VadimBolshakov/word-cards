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
