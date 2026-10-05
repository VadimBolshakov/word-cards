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
