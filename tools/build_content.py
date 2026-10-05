"""Сборка контента: python tools/build_content.py [--dry-run]"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cardbuild.build import run_build  # noqa: E402
from cardbuild.tts import edge_synthesize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Проверка CSV, озвучка, генерация JSON")
    parser.add_argument("--content", type=Path, default=ROOT / "content")
    parser.add_argument("--out", type=Path, default=ROOT / "app" / "public" / "content")
    parser.add_argument("--dry-run", action="store_true", help="только проверить и показать план")
    args = parser.parse_args()
    return run_build(args.content, args.out, edge_synthesize, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
