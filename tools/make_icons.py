"""Генерирует простые PNG-иконки: индиго-фон и белая «карточка»."""
import struct
import zlib
from pathlib import Path

BG = (99, 102, 241)
FG = (249, 250, 251)
OUT = Path(__file__).resolve().parent.parent / "app" / "public"


def png(size: int) -> bytes:
    rows = []
    lo, hi = int(size * 0.22), int(size * 0.78)
    top, bottom = int(size * 0.3), int(size * 0.7)
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(FG if lo <= x < hi and top <= y < bottom else BG)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


for s in (192, 512):
    (OUT / f"icon-{s}.png").write_bytes(png(s))
    print(f"icon-{s}.png")
