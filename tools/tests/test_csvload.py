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
