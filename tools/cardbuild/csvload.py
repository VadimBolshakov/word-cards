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
