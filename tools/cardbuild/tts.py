import asyncio
from pathlib import Path
from typing import Awaitable, Callable

import lameenc

from .audio import AudioJob

SAMPLE_RATE = 24000
BITRATE_KBPS = 48
PART_GAP_SECONDS = 0.6

Synth = Callable[[str, str], Awaitable[bytes]]


def make_silence(seconds: float) -> bytes:
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BITRATE_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    pcm = b"\x00\x00" * int(SAMPLE_RATE * seconds)
    return bytes(encoder.encode(pcm) + encoder.flush())


async def edge_synthesize(text: str, voice: str) -> bytes:
    import edge_tts

    data = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            data.extend(chunk["data"])
    if not data:
        raise RuntimeError(f"пустой ответ TTS для '{text}'")
    return bytes(data)


async def _with_retries(make_call: Callable[[], Awaitable[bytes]], retries: int, delay: float) -> bytes:
    for attempt in range(retries):
        try:
            return await make_call()
        except Exception:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(delay * (attempt + 1))
    raise AssertionError("unreachable")


async def render_job(job: AudioJob, synth: Synth, retries: int = 3, delay: float = 1.0) -> bytes:
    gap = make_silence(PART_GAP_SECONDS)
    pieces: list[bytes] = []
    for i, part in enumerate(job.parts):
        if i:
            pieces.append(gap)
        pieces.append(await _with_retries(lambda: synth(part, job.voice), retries, delay))
    return b"".join(pieces)


async def generate_all(jobs: list[AudioJob], audio_dir: Path, synth: Synth,
                       concurrency: int = 4, delay: float = 1.0) -> list[str]:
    audio_dir.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)
    failed: list[str] = []

    async def one(job: AudioJob) -> None:
        async with semaphore:
            try:
                data = await render_job(job, synth, delay=delay)
            except Exception as exc:
                print(f"  FAIL {job.key} {job.parts}: {exc}")
                failed.append(job.key)
                return
            tmp = audio_dir / f"{job.key}.mp3.tmp"
            tmp.write_bytes(data)
            tmp.replace(audio_dir / f"{job.key}.mp3")

    await asyncio.gather(*(one(job) for job in jobs))
    return sorted(failed)
