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
