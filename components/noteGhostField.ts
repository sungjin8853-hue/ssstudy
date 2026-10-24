import { createContext, useMemo } from 'react';
import { buildNoteSetIndex, ghostLocationsOf } from '../utils/noteSets';
import type { GhostLocation, NoteSetIndex } from '../utils/noteSets';
import { displayOffset, stripGhosts, storedOffset } from '../utils/noteGhost';

/** 같은 노트 글들(source)로 만든 색인은 글이 바뀔 때 한 번만 만들고 모든 칸이 나눠 쓴다 */
const indexCache = new WeakMap<readonly string[], NoteSetIndex>();
const indexOf = (source: readonly string[]): NoteSetIndex => {
  let index = indexCache.get(source);
  if (!index) { index = buildNoteSetIndex(source); indexCache.set(source, index); }
  return index;
};

/** 이 칸을 감싼 토글 제목들의 집합 이름(바깥 → 안): 이미 제목으로 알려진 위치는 줄마다 되풀이해 보이지 않는다 */
export const NoteEnclosingContext = createContext<readonly string[]>([]);

/**
 * 줄 맨 앞 셀의 위치 `[..B]`(저장하지 않는 보이기용)를 줄마다 계산한다. 위치가 없으면 빈 목록.
 * 같은 과목 노트 글들(source)이 없으면 위치를 알 수 없어 아무것도 끼우지 않는다.
 */
export const useNoteGhostLabels = (text: string, source: readonly string[] | null, enclosing: readonly string[], enabled: boolean): GhostLocation[] => {
  const enclosingKey = enclosing.join('\u0000');
  return useMemo(() => (enabled && source && source.length && text.trim() ? ghostLocationsOf(indexOf(source), text, enclosing) : []), [enabled, text, source, enclosingKey]);
};

/** 입력칸에 지금 끼워져 있는 위치(보이는 글의 줄 → 위치)와 줄마다 펼친 전체 위치 */
export interface GhostView {
  expected: ReadonlyMap<number, string>;
  labels: readonly GhostLocation[];
}
const views = new WeakMap<HTMLTextAreaElement, GhostView>();
export const setGhostView = (field: HTMLTextAreaElement, view: GhostView | null) => {
  if (view && view.labels.length) views.set(field, view);
  else views.delete(field);
};
export const ghostViewOf = (field: HTMLTextAreaElement): GhostView | undefined => views.get(field);

/** 입력칸의 저장하는 글(끼운 위치를 뺀 글)과 그 기준의 선택 자리. 위치를 끼우지 않은 입력칸은 보이는 글이 곧 저장하는 글이다. */
export const readField = (field: HTMLTextAreaElement): { value: string; start: number; end: number } => {
  const view = views.get(field);
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  if (!view) return { value: field.value, start, end };
  return { value: stripGhosts(field.value, view.expected), start: storedOffset(field.value, start, view.expected), end: storedOffset(field.value, end, view.expected) };
};

/** 저장하는 글의 자리 → 입력칸 안의 자리 */
export const displayCaretOf = (field: HTMLTextAreaElement, stored: number): number => {
  const view = views.get(field);
  return view ? displayOffset(field.value, stored, view.expected) : stored;
};
