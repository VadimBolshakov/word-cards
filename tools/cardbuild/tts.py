import asyncio
from pathlib import Path
from typing import Awaitable, Callable

import lameenc

from .audio import AudioJob

SAMPLE_RATE = 24000
BITRATE_KBPS = 48
PART_GAP_SECONDS = 0.6

Synth = Callable[[str, str], Awaitable[bytes]]

# Приложение склеивает байты файлов в один поток и считает длительность как байты / 6000,
# поэтому каждый файл обязан быть ровно таким: кадры MPEG-2 Layer III, 24 кГц, 48 кбит/с,
# моно, без ID3 и без кадра-заголовка Xing/Info. Кадр — 144 байта, без padding.
FRAME_HEADER = b"\xff\xf3\x64\xc4"
FRAME_BYTES = 144


def check_mp3(data: bytes, what: str) -> None:
    """Бросает ValueError, если data — не поток кадров нужного формата."""
    if not data.startswith(FRAME_HEADER):
        raise ValueError(f"{what}: ожидался mp3 MPEG-2 L3 24 кГц 48 кбит/с моно без ID3 "
                         f"(заголовок {FRAME_HEADER.hex()}), получено {data[:4].hex() or 'пусто'}")
    if len(data) % FRAME_BYTES:
        raise ValueError(f"{what}: длина mp3 {len(data)} не кратна кадру {FRAME_BYTES} байт")
    first = data[:FRAME_BYTES]
    if b"Xing" in first or b"Info" in first:
        raise ValueError(f"{what}: mp3 начинается с кадра-заголовка Xing/Info")


def make_silence(seconds: float) -> bytes:
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BITRATE_KBPS)
    encoder.set_in_sample_rate(SAMPLE_RATE)
    encoder.set_channels(1)
    encoder.set_quality(2)
    pcm = b"\x00\x00" * int(SAMPLE_RATE * seconds)
    data = bytes(encoder.encode(pcm) + encoder.flush())
    check_mp3(data, f"тишина {seconds} с")
    return data


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


async def _synth_checked(synth: Synth, text: str, voice: str) -> bytes:
    # Проверка внутри повторов: неверный формат может оказаться сбоем ответа TTS.
    data = await synth(text, voice)
    check_mp3(data, f"TTS '{text}' ({voice})")
    return data


async def render_job(job: AudioJob, synth: Synth, retries: int = 3, delay: float = 1.0) -> bytes:
    gap = make_silence(PART_GAP_SECONDS)
    pieces: list[bytes] = []
    for i, part in enumerate(job.parts):
        if i:
            pieces.append(gap)
        pieces.append(await _with_retries(lambda: _synth_checked(synth, part, job.voice), retries, delay))
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
