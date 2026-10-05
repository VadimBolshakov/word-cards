import type { Card, Direction, Settings } from '../types';

export type Side = 'front' | 'back';
export type Step =
  | { kind: 'audio'; url: string; cardIndex: number; side: Side }
  | { kind: 'silence'; url: string; cardIndex: number; seconds: number };

const REPEAT_GAP_SECONDS = 1;

export function silenceUrl(seconds: number): string {
  return `audio/silence_${seconds}s.mp3`;
}

function sideLang(side: Side, direction: Direction): 'en' | 'ru' {
  const frontLang = direction === 'en-ru' ? 'en' : 'ru';
  if (side === 'front') return frontLang;
  return frontLang === 'en' ? 'ru' : 'en';
}

export function sideText(card: Card, side: Side, direction: Direction) {
  const lang = sideLang(side, direction);
  return lang === 'en'
    ? { main: card.en, example: card.enEx, lang }
    : { main: card.ru, example: card.ruEx, lang };
}

export function buildSequence(
  cards: Card[],
  s: Pick<Settings, 'pauseSec' | 'direction' | 'enRepeat'>,
): Step[] {
  const steps: Step[] = [];
  const silence = (cardIndex: number, seconds: number) =>
    steps.push({ kind: 'silence', url: silenceUrl(seconds), cardIndex, seconds });

  cards.forEach((card, cardIndex) => {
    for (const side of ['front', 'back'] as const) {
      const lang = sideLang(side, s.direction);
      const url = lang === 'en' ? card.enAudio : card.ruAudio;
      steps.push({ kind: 'audio', url, cardIndex, side });
      if (lang === 'en' && s.enRepeat === 2) {
        silence(cardIndex, REPEAT_GAP_SECONDS);
        steps.push({ kind: 'audio', url, cardIndex, side });
      }
      silence(cardIndex, s.pauseSec);
    }
  });
  return steps;
}

export function cardStartStep(steps: Step[], cardIndex: number): number {
  return steps.findIndex(step => step.cardIndex === cardIndex);
}
