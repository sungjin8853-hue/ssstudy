import type { ReviewGrade } from './reviewPractice';

/**
 * 걸린 시간으로 난도 추천하기. 문제를 보고 정답을 확인하기까지 걸린 시간을 "이 문제에 보통 걸리는 시간"과 견줘서
 * 훨씬 빨랐으면 쉬움, 비슷하면 맞음, 훨씬 느렸으면 어려움을 권한다.
 *  - 보통 걸리는 시간: 지난 첫 시도 기록이 2번 이상 있으면 그 가운데 값(median), 없으면 정답 글자 수로 어림한다.
 *  - 오답은 권하지 않는다. 맞았는지는 본인만 알기 때문이다.
 *  - 1.2초도 안 걸렸으면 떠올려 본 시간이 아니라 그냥 넘긴 것이라 권하지 않는다.
 */
export const MIN_THINKING_MS = 1200;
export const EASY_RATIO = 0.5;
export const GOOD_RATIO = 1.3;
const BASE_MS = 2500;
const PER_CHARACTER_MS = 220;
const FLOOR_MS = 3000;
const CEILING_MS = 60000;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface GradeRecommendationInput {
  /** 문제가 보인 뒤 정답을 확인하기까지 걸린 시간(ms) */
  elapsedMs: number;
  /** 이 문제를 지난번까지 첫 시도에 푼 시간들(ms) */
  history?: readonly number[];
  /** 정답으로 떠올려야 하는 글자 수 */
  textLength: number;
}

/** 이 문제에 보통 걸릴 것으로 보는 시간(ms) */
export const expectedResponseMs = (history: readonly number[] | undefined, textLength: number) => {
  const usable = (history || []).filter(value => Number.isFinite(value) && value > 0);
  if (usable.length >= 2) return Math.max(1500, median(usable));
  return Math.min(CEILING_MS, Math.max(FLOOR_MS, BASE_MS + PER_CHARACTER_MS * Math.max(0, textLength)));
};

export const recommendReviewGrade = ({ elapsedMs, history, textLength }: GradeRecommendationInput): ReviewGrade | null => {
  if (!Number.isFinite(elapsedMs) || elapsedMs < MIN_THINKING_MS) return null;
  const ratio = elapsedMs / expectedResponseMs(history, textLength);
  if (ratio <= EASY_RATIO) return 'easy';
  if (ratio <= GOOD_RATIO) return 'good';
  return 'hard';
};

export const formatResponseSeconds = (ms: number) => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 9.95) return `${seconds.toFixed(1)}초`;
  const total = Math.round(seconds);
  if (total < 60) return `${total}초`;
  return `${Math.floor(total / 60)}분 ${total % 60}초`;
};
