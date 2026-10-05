from dataclasses import dataclass

DEFAULT_EN_VOICE = "en-US-AriaNeural"
DEFAULT_RU_VOICE = "ru-RU-SvetlanaNeural"


@dataclass(frozen=True)
class Topic:
    id: str
    title: str
    description: str
    order: int
    en_voice: str = DEFAULT_EN_VOICE
    ru_voice: str = DEFAULT_RU_VOICE


@dataclass(frozen=True)
class Card:
    id: str
    topic_id: str
    set: int
    en: str
    ru: str
    en_ex: str = ""
    ru_ex: str = ""
