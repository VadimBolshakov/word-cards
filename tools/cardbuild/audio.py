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
