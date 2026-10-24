/**
 * 복습 문제를 보이는 모양: 줄글(문제집처럼 문장) 또는 플래시 카드(앞면에 문제 조건을 크게, 뒷면에 정답).
 * 한 번 고르면 모든 복습 문제(기본 복습 · 정리노트 문제 풀기)에 적용되고 이 기기에 저장된다. 기본은 줄글이다.
 */
export type ReviewStyle = 'prose' | 'flash';
export const REVIEW_STYLE_KEY = 'swp_review_style';

const readStored = (): ReviewStyle => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(REVIEW_STYLE_KEY) === 'flash' ? 'flash' : 'prose'; } catch { return 'prose'; }
};

let current = readStored();
const listeners = new Set<() => void>();

export const getReviewStyle = (): ReviewStyle => current;

export const setReviewStyle = (next: ReviewStyle) => {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(REVIEW_STYLE_KEY, next); } catch { /* 저장이 막혀도 이번 화면에서는 적용한다 */ }
  listeners.forEach(listener => listener());
};

/** 모양이 바뀔 때 알려 받는다(화면 훅이 쓴다). 돌려주는 함수를 부르면 구독이 끝난다. */
export const subscribeReviewStyle = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
