import asyncio

import pytest

from cardbuild.audio import AudioJob
from cardbuild.tts import check_mp3, generate_all, make_silence, render_job

HEADER = b"\xff\xf3\x64\xc4"   # MPEG-2 L3, 24 кГц, 48 кбит/с, моно: кадр 144 байта


def frame(tag: bytes = b"") -> bytes:
    """Один кадр нужного формата; tag — метка в теле кадра, чтобы различать части."""
    return HEADER + tag.ljust(140, b"\0")


def run(coro):
    return asyncio.run(coro)


def test_check_mp3_accepts_expected_frames():
    check_mp3(frame(), "x")
    check_mp3(frame(b"a") * 5, "x")


@pytest.mark.parametrize("data", [
    b"",
    b"ID3" + b"\0" * 141,                       # тег ID3 перед кадрами
    b"\xff\xf3\x64\xc4" + b"\0" * 100,          # не кратно 144
    b"\xff\xfb\x90\x64" + b"\0" * 140,          # MPEG-1 128 кбит/с
    b"\xff\xf3\x64\xc4" + b"\0" * 32 + b"Xing" + b"\0" * 104,   # кадр-заголовок Xing
], ids=["empty", "id3", "partial-frame", "mpeg1", "xing"])
def test_check_mp3_rejects_other_formats(data):
    with pytest.raises(ValueError, match="mp3"):
        check_mp3(data, "x")


def test_make_silence_is_mp3_and_scales_with_duration():
    one = make_silence(1)
    three = make_silence(3)
    assert len(one) > 0
    assert one[:3] == b"ID3" or (one[0] == 0xFF and one[1] & 0xE0 == 0xE0)
    assert len(three) > 2 * len(one)


@pytest.mark.parametrize("seconds", [0.6, 1, 3, 5, 8, 10])
def test_make_silence_has_the_stream_format(seconds):
    check_mp3(make_silence(seconds), "silence")


def test_render_job_joins_parts_with_gap():
    calls = []

    async def synth(text, voice):
        calls.append((text, voice))
        return frame(text.encode())

    job = AudioJob("k", "voice", ("a", "b"))
    data = run(render_job(job, synth, delay=0))
    assert calls == [("a", "voice"), ("b", "voice")]
    assert data.startswith(frame(b"a")) and data.endswith(frame(b"b"))
    assert data[144:-144] == make_silence(0.6) and len(data) > 2 * 144


def test_render_job_retries_then_succeeds():
    attempts = {"n": 0}

    async def flaky(text, voice):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError("network")
        return frame(b"ok")

    assert run(render_job(AudioJob("k", "v", ("x",)), flaky, retries=3, delay=0)) == frame(b"ok")
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
        return frame(text.encode())

    jobs = [AudioJob("aaa", "v", ("good",)), AudioJob("bbb", "v", ("bad",))]
    failed = run(generate_all(jobs, tmp_path, synth, delay=0))
    assert failed == ["bbb"]
    assert (tmp_path / "aaa.mp3").read_bytes() == frame(b"good")
    assert not (tmp_path / "bbb.mp3").exists()
    assert not list(tmp_path.glob("*.tmp"))


def test_render_job_rejects_a_part_in_the_wrong_format():
    async def synth(text, voice):
        return b"ID3" + frame()          # например, mp3 с тегом ID3

    with pytest.raises(ValueError, match="mp3"):
        run(render_job(AudioJob("k", "v", ("x",)), synth, retries=2, delay=0))


def test_generate_all_counts_a_wrong_format_as_a_failed_job(tmp_path, capsys):
    async def synth(text, voice):
        return frame(b"x")[:-1] if text == "short" else frame(text.encode())

    jobs = [AudioJob("aaa", "v", ("good",)), AudioJob("bbb", "v", ("short",))]
    failed = run(generate_all(jobs, tmp_path, synth, delay=0))
    assert failed == ["bbb"]
    assert (tmp_path / "aaa.mp3").read_bytes() == frame(b"good")
    assert not (tmp_path / "bbb.mp3").exists()
    assert "mp3" in capsys.readouterr().out
