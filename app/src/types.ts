export interface SetMeta { n: number; count: number }
export interface TopicMeta {
  id: string; title: string; description: string; order: number;
  cardCount: number; sets: SetMeta[];
}
export interface ContentIndex { contentVersion: string; topics: TopicMeta[] }
export interface Card {
  id: string; set: number; en: string; ru: string; enEx: string; ruEx: string;
  enAudio: string; ruAudio: string;
}
export interface TopicContent { id: string; cards: Card[] }
export interface Progress {
  profileId: string; cardId: string; box: number;
  nextDue: string | null; lastSeen: string | null; starred: boolean;
}
export type PauseSec = 3 | 5 | 8 | 10;
export type Direction = 'en-ru' | 'ru-en';
export type CardOrder = 'seq' | 'shuffle';
export type Rate = 0.8 | 1 | 1.2;
export interface Settings {
  pauseSec: PauseSec; direction: Direction; order: CardOrder;
  enRepeat: 1 | 2; rate: Rate; loop: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  pauseSec: 5, direction: 'en-ru', order: 'seq', enRepeat: 1, rate: 1, loop: false,
};
export interface Profile { id: string; name: string; createdAt: string }
