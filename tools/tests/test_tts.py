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
