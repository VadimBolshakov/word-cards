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
        # Один кадр формата потока (MPEG-2 L3, 24 кГц, 48 кбит/с, моно) с меткой текста.
        return b"\xff\xf3\x64\xc4" + f"{voice}:{text}".encode().ljust(140, b"\0")


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
