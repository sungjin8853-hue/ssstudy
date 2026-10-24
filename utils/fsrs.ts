/**
 * FSRS-6 (21개 매개변수) 복습 일정. 기억의 두 값 — 안정도(S: 기억이 90%로 떨어지기까지 걸리는 날 수)와 난이도(D: 1~10) — 를 평가(1 다시 · 2 어려움 · 3 좋음 · 4 쉬움)마다 갱신하고,
 * 바라는 기억률(기본 90%)에 맞춰 다음 복습까지의 간격을 낸다. 공식은 open-spaced-repetition의 FSRS-6(ts-fsrs 5.4)과 같은 값을 내도록 맞췄다.
 *  - 기억률 R(t,S) = (1 + F·t/S)^(−w20),  F = 0.9^(−1/w20) − 1   (w20이 곡선의 기울기)
 *  - 간격 I(r,S) = S/F · (r^(−1/w20) − 1)
 */
export const FSRS_DEFAULT_WEIGHTS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
];
export const FSRS_DEFAULT_RETENTION = 0.9;
export const DAY_MS = 86400000;
const S_MIN = 0.001;
const S_MAX = 36500;

export type FsrsRating = 1 | 2 | 3 | 4;

export interface FsrsMemory { stability: number; difficulty: number }
export interface FsrsCard extends FsrsMemory {
  /** 지금까지 복습한 횟수(같은 날 다시 푼 것도 센다) */
  reps: number;
  /** 잊어서(평가 1) 안정도가 떨어진 횟수 */
  lapses: number;
  /** 마지막으로 복습한 때(ms) */
  lastReviewMs: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const curve = (weights: readonly number[]) => {
  const decay = -weights[20];
  const factor = Math.exp(Math.log(0.9) / decay) - 1;
  return { decay, factor };
};

/** t일이 지났을 때 기억이 남아 있을 확률 */
export const fsrsRetrievability = (elapsedDays: number, stability: number, weights: readonly number[] = FSRS_DEFAULT_WEIGHTS) => {
  const { decay, factor } = curve(weights);
  return Math.pow(1 + factor * Math.max(0, elapsedDays) / stability, decay);
};

/** 바라는 기억률에 맞는 다음 복습까지의 날 수 */
export const fsrsIntervalDays = (stability: number, retention = FSRS_DEFAULT_RETENTION, weights: readonly number[] = FSRS_DEFAULT_WEIGHTS) => {
  const { decay, factor } = curve(weights);
  return clamp(stability / factor * (Math.pow(retention, 1 / decay) - 1), S_MIN, S_MAX);
};

const initialStability = (rating: FsrsRating, w: readonly number[]) => Math.max(w[rating - 1], 0.1);
const initialDifficulty = (rating: FsrsRating, w: readonly number[]) => w[4] - Math.exp((rating - 1) * w[5]) + 1;

const nextDifficulty = (difficulty: number, rating: FsrsRating, w: readonly number[]) => {
  const delta = -w[6] * (rating - 3);
  const damped = difficulty + delta * (10 - difficulty) / 9;
  return clamp(w[7] * initialDifficulty(4, w) + (1 - w[7]) * damped, 1, 10);
};

const recallStability = (memory: FsrsMemory, retrievability: number, rating: FsrsRating, w: readonly number[]) => {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus = rating === 4 ? w[16] : 1;
  const gain = Math.exp(w[8]) * (11 - memory.difficulty) * Math.pow(memory.stability, -w[9])
    * (Math.exp((1 - retrievability) * w[10]) - 1) * hardPenalty * easyBonus;
  return clamp(memory.stability * (1 + gain), S_MIN, S_MAX);
};

const forgetStability = (memory: FsrsMemory, retrievability: number, w: readonly number[]) => {
  const afterForget = clamp(
    w[11] * Math.pow(memory.difficulty, -w[12]) * (Math.pow(memory.stability + 1, w[13]) - 1) * Math.exp((1 - retrievability) * w[14]),
    S_MIN, S_MAX);
  // FSRS-6: 잊은 뒤의 안정도는 S / e^(w17·w18)를 넘지 않는다(둘 중 작은 값)
  return clamp(memory.stability / Math.exp(w[17] * w[18]), S_MIN, afterForget);
};

/** 같은 날 다시 푼 경우(하루가 지나기 전)의 안정도 */
const shortTermStability = (stability: number, rating: FsrsRating, w: readonly number[]) => {
  const increase = Math.pow(stability, -w[19]) * Math.exp(w[17] * (rating - 3 + w[18]));
  // 좋음·쉬움만 안정도가 줄지 않게 막는다(FSRS-6). 어려움·다시는 같은 날에도 줄 수 있다
  return clamp(stability * (rating >= 3 ? Math.max(increase, 1) : increase), S_MIN, S_MAX);
};

/**
 * 카드를 한 번 복습한 결과. 처음이면 평가로 안정도·난이도를 정하고, 아니면 지난 시간에 따른 기억률로 갱신한다.
 * 하루가 지나기 전에 다시 푼 것(오답 뒤 다시 풀기)은 FSRS-6의 같은 날 복습 공식을 쓴다.
 */
export const fsrsReview = (card: FsrsCard | null | undefined, rating: FsrsRating, nowMs: number, weights: readonly number[] = FSRS_DEFAULT_WEIGHTS): FsrsCard => {
  if (!card) {
    return { stability: initialStability(rating, weights), difficulty: clamp(initialDifficulty(rating, weights), 1, 10),
      reps: 1, lapses: rating === 1 ? 1 : 0, lastReviewMs: nowMs };
  }
  const elapsedDays = Math.max(0, (nowMs - card.lastReviewMs) / DAY_MS);
  const retrievability = fsrsRetrievability(elapsedDays, card.stability, weights);
  let stability: number;
  if (elapsedDays < 1) stability = shortTermStability(card.stability, rating, weights);
  else if (rating === 1) stability = forgetStability(card, retrievability, weights);
  else stability = recallStability(card, retrievability, rating, weights);
  return {
    stability, difficulty: nextDifficulty(card.difficulty, rating, weights),
    reps: card.reps + 1, lapses: card.lapses + (rating === 1 ? 1 : 0), lastReviewMs: nowMs
  };
};

/** 카드가 다음에 복습될 때까지의 간격(ms). 너무 짧지 않게 1분 아래로는 내리지 않는다. */
export const fsrsIntervalMs = (card: FsrsMemory, retention = FSRS_DEFAULT_RETENTION, weights: readonly number[] = FSRS_DEFAULT_WEIGHTS) => (
  Math.max(60000, Math.round(fsrsIntervalDays(card.stability, retention, weights) * DAY_MS))
);

/** 지금 이 카드를 푼다면 평가마다 다음 복습이 언제가 되는지(버튼에 보여 줄 값) */
export const fsrsPreviewIntervals = (card: FsrsCard | null | undefined, nowMs: number, retention = FSRS_DEFAULT_RETENTION): Record<FsrsRating, number> => ({
  1: fsrsIntervalMs(fsrsReview(card, 1, nowMs), retention),
  2: fsrsIntervalMs(fsrsReview(card, 2, nowMs), retention),
  3: fsrsIntervalMs(fsrsReview(card, 3, nowMs), retention),
  4: fsrsIntervalMs(fsrsReview(card, 4, nowMs), retention)
});
