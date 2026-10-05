import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { buildSequence, cardStartStep, sideText, silenceUrl } from './sequence';

const card = (id: string): Card => ({
  id, set: 1, en: `${id}-en`, ru: `${id}-ru`, enEx: `${id}-enex`, ruEx: '',
  enAudio: `audio/${id}-en.mp3`, ruAudio: `audio/${id}-ru.mp3`,
});
const urls = (steps: ReturnType<typeof buildSequence>) => steps.map(s => s.url);

describe('sequence', () => {
  it('silence url', () => {
    expect(silenceUrl(5)).toBe('audio/silence_5s.mp3');
  });

  it('en-ru single repeat', () => {
    const steps = buildSequence([card('a'), card('b')], { pauseSec: 5, direction: 'en-ru', enRepeat: 1 });
    expect(urls(steps)).toEqual([
      'audio/a-en.mp3', 'audio/silence_5s.mp3', 'audio/a-ru.mp3', 'audio/silence_5s.mp3',
      'audio/b-en.mp3', 'audio/silence_5s.mp3', 'audio/b-ru.mp3', 'audio/silence_5s.mp3',
    ]);
    expect(steps.map(s => s.cardIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(steps[0]).toEqual({ kind: 'audio', url: 'audio/a-en.mp3', cardIndex: 0, side: 'front' });
    expect(steps[1]).toEqual({ kind: 'silence', url: 'audio/silence_5s.mp3', cardIndex: 0, seconds: 5 });
  });

  it('en repeated twice on front for en-ru', () => {
    const steps = buildSequence([card('a')], { pauseSec: 3, direction: 'en-ru', enRepeat: 2 });
    expect(urls(steps)).toEqual([
      'audio/a-en.mp3', 'audio/silence_1s.mp3', 'audio/a-en.mp3', 'audio/silence_3s.mp3',
      'audio/a-ru.mp3', 'audio/silence_3s.mp3',
    ]);
  });

  it('ru-en puts russian first and repeats english on back', () => {
    const steps = buildSequence([card('a')], { pauseSec: 8, direction: 'ru-en', enRepeat: 2 });
    expect(urls(steps)).toEqual([
      'audio/a-ru.mp3', 'audio/silence_8s.mp3',
      'audio/a-en.mp3', 'audio/silence_1s.mp3', 'audio/a-en.mp3', 'audio/silence_8s.mp3',
    ]);
    expect(steps[0]).toMatchObject({ side: 'front' });
    expect(steps[2]).toMatchObject({ side: 'back' });
  });

  it('cardStartStep', () => {
    const steps = buildSequence([card('a'), card('b')], { pauseSec: 5, direction: 'en-ru', enRepeat: 1 });
    expect(cardStartStep(steps, 0)).toBe(0);
    expect(cardStartStep(steps, 1)).toBe(4);
    expect(cardStartStep(steps, 2)).toBe(-1);
  });

  it('sideText follows direction', () => {
    const c = card('a');
    expect(sideText(c, 'front', 'en-ru')).toEqual({ main: 'a-en', example: 'a-enex', lang: 'en' });
    expect(sideText(c, 'front', 'ru-en')).toEqual({ main: 'a-ru', example: '', lang: 'ru' });
    expect(sideText(c, 'back', 'ru-en').lang).toBe('en');
  });
});
