import { INITIAL_REVIEW_DELAY_MS } from './review';
import { DAY_MS, fsrsIntervalMs, fsrsReview } from './fsrs';
import type { FsrsCard, FsrsRating } from './fsrs';
import { compareReviewQuestionDifficulty } from './reviewDifficulty';
import type { ReviewQuestionDifficulty } from './reviewDifficulty';
import { readCombineLength } from './combineLength';

export const REVIEW_PASS_RATIO = 0.8;
export const REVIEW_MASK_INTERVAL_MS = 8 * 86400000;
export interface PracticeQuestion extends Partial<ReviewQuestionDifficulty> {
  id: string; logId: string; level: number; priority: number; blankStart?: number;
  /** 연결하려는 두 값의 중요도 합(작을수록 중요). 같은 우선순위 안에서 먼저 낼 순서를 정한다. */
  importance?: number;
}
export const MAX_REVIEW_LEVEL = 3;

/**
 * 문제를 푼 뒤 사용자가 고르는 체감 난이도. FSRS의 평가 4단계(Again 1 · Hard 2 · Good 3 · Easy 4)와 같은 자리라서,
 * 나중에 FSRS-6로 복습 간격을 정할 때 이 값을 그대로 평가 값으로 넘길 수 있다.
 */
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';
export const REVIEW_GRADE_FSRS: Record<ReviewGrade, 1 | 2 | 3 | 4> = { again: 1, hard: 2, good: 3, easy: 4 };
export const normalizeReviewGrade = (result: ReviewGrade | boolean): ReviewGrade => (
  typeof result === 'boolean' ? (result ? 'good' : 'again') : result
);

export interface ReviewPractice {
  queue: string[];
  roundWrong: string[];
  completed: string[];
  wrongCounts: Record<string, number>;
  attempts: Record<string, number>;
  firstCorrect: Record<string, boolean>;
  /** 노트별로 사용자가 고른 난도(이 단계까지 출제, 저장되는 값). 문제를 풀어도 저절로 올라가지 않는다. */
  unlocked: Record<string, number>;
  grades: Record<string, ReviewGrade[]>;
  answered: string[];
  retryPool: string[] | null;
  level: number;
  priority: number;
  round: number;
  roundSize: number;
  roundAnswered: number;
  /** 있으면 한 번에 나오는 문제들(같은 중요도 묶음)의 순서를 이 값으로 섞는다(29일 요청: 기본은 랜덤). 풀이 중에는 같은 순서로 유지된다 */
  seed?: number;
}

/** 같은 우선순위 안의 순서: 중요도(작을수록 먼저) → 난도 → 처음 순서. */
const compareOrder = (a: { q: PracticeQuestion; index: number }, b: { q: PracticeQuestion; index: number }) => (
  a.q.priority - b.q.priority || (a.q.importance ?? 0) - (b.q.importance ?? 0) || compareReviewQuestionDifficulty(a.q, b.q) || a.index - b.index
);

/** 섞는 순서: seed와 문제 id로 정해지는 값이라 다시 줄 세워도 같은 자리다 */
const shuffleKey = (seed: number, id: string) => {
  let value = (seed ^ 2166136261) >>> 0;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  value ^= value >>> 15; value = Math.imul(value, 2246822507) >>> 0; value ^= value >>> 13;
  return value >>> 0;
};
/** seed가 있으면 같은 중요도 묶음 안에서는 섞은 순서, 없으면 중요도 → 난도 → 처음 순서 */
const orderFor = (state: { seed?: number }) => (a: { q: PracticeQuestion; index: number }, b: { q: PracticeQuestion; index: number }) => (
  state.seed === undefined ? compareOrder(a, b)
    : a.q.priority - b.q.priority || shuffleKey(state.seed, a.q.id) - shuffleKey(state.seed, b.q.id) || a.index - b.index
);

/** 노트에 문제가 이 단계부터만 있어도 하나는 낼 수 있게, 노트가 가진 가장 낮은 단계를 바닥으로 삼는다. */
const levelOf = (state: ReviewPractice, catalog: PracticeQuestion[], logId: string) => {
  const lowest = Math.min(MAX_REVIEW_LEVEL, ...catalog.filter(q => q.logId === logId).map(q => q.level));
  return Math.max(state.unlocked[logId] || 1, lowest);
};
const isAvailable = (state: ReviewPractice, catalog: PracticeQuestion[], q: PracticeQuestion) => q.level <= levelOf(state, catalog, q.logId);

/** 지금 고른 난도까지 열린(이미 푼 것 포함) 문제들을 중요한 것부터 돌려준다. */
export const getPracticeBatch = (state: ReviewPractice, catalog: PracticeQuestion[]) => (
  catalog.map((q, index) => ({ q, index })).filter(item => isAvailable(state, catalog, item.q)).sort(orderFor(state)).map(item => item.q)
);

const settle = (input: ReviewPractice, catalog: PracticeQuestion[]): ReviewPractice => {
  const byId = new Map(catalog.map((q, index) => [q.id, { q, index }]));
  let state = input;
  const open = (current: ReviewPractice) => {
    const pool = (current.retryPool
      ? current.retryPool.map(id => byId.get(id)?.q).filter((q): q is PracticeQuestion => !!q)
      : catalog.filter(q => !current.completed.includes(q.id))).filter(q => isAvailable(current, catalog, q));
    // 중요도가 먼저다: 아직 못 맞힌 문제 중 가장 중요한 묶음을 다 풀기 전에는 덜 중요한 문제로 넘어가지 않는다(난도가 낮아도).
    const important = Math.min(...pool.filter(q => !current.completed.includes(q.id)).map(q => q.priority));
    return pool.filter(q => q.priority === important && !current.answered.includes(q.id))
      .map(q => byId.get(q.id)!).sort(orderFor(current)).map(item => item.q);
  };
  for (let guard = 0; guard < 8; guard += 1) {
    const queue = open(state);
    if (queue.length) {
      return { ...state, queue: queue.map(q => q.id), level: queue[0].level, priority: queue[0].priority,
        roundSize: queue.length + state.answered.length, roundAnswered: state.answered.length };
    }
    if (state.roundWrong.length) {
      state = { ...state, retryPool: state.roundWrong, roundWrong: [], answered: [], round: state.round + 1 };
    } else if (state.retryPool || state.answered.length) {
      state = { ...state, retryPool: null, answered: [], round: 1 };
    } else break;
  }
  return { ...state, queue: [], roundSize: state.answered.length, roundAnswered: state.answered.length };
};

/**
 * 문제 목록(카탈로그)이 바뀌었을 때 맞춘다: 목록에서 사라진 문제(복습에서 뺀 것)는 풀이 기록에서 모두 지우고, 다시 생긴 문제는 다시 줄 세운다.
 * 바뀐 것이 없으면 같은 상태를 그대로 돌려준다.
 */
export const reconcileReviewPractice = (previous: ReviewPractice, catalog: PracticeQuestion[]): ReviewPractice => {
  const known = new Set(catalog.map(q => q.id));
  const keep = (ids: string[]) => ids.filter(id => known.has(id));
  const pick = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id))) as Record<string, T>;
  const next: ReviewPractice = {
    ...previous,
    queue: keep(previous.queue), roundWrong: keep(previous.roundWrong), completed: keep(previous.completed), answered: keep(previous.answered),
    retryPool: previous.retryPool ? keep(previous.retryPool) : null,
    wrongCounts: pick(previous.wrongCounts), attempts: pick(previous.attempts), firstCorrect: pick(previous.firstCorrect), grades: pick(previous.grades)
  };
  return settle(next, catalog);
};

/** 난도는 사용자가 직접 고른다. unlocked는 노트별로 처음 고른(저장돼 있던) 단계다. */
export const startReviewPractice = (catalog: PracticeQuestion[], unlocked: Record<string, number> = {}, seed?: number): ReviewPractice => (
  settle({
    ...(seed !== undefined ? { seed } : {}),
    queue: [], roundWrong: [], completed: [], wrongCounts: {}, attempts: {}, firstCorrect: {}, unlocked: { ...unlocked },
    grades: {}, answered: [], retryPool: null,
    level: 1, priority: 1, round: 1, roundSize: 0, roundAnswered: 0
  }, catalog)
);

/** 모든 노트의 난도를 한 번에 바꾼다(1~3단계까지 출제). 푼 문제는 그대로 두고, 새로 열리거나 닫힌 문제만 줄 세운다. */
export const setReviewPracticeLevel = (previous: ReviewPractice, catalog: PracticeQuestion[], level: number): ReviewPractice => {
  const next = Math.min(MAX_REVIEW_LEVEL, Math.max(1, Math.round(level) || 1));
  const unlocked = Object.fromEntries([...new Set(catalog.map(q => q.logId)), ...Object.keys(previous.unlocked)].map(logId => [logId, next]));
  return settle({ ...previous, unlocked }, catalog);
};

/** 지금 고른 난도(노트마다 다르게 시작했다면 가장 높은 값). */
export const getReviewPracticeLevel = (state: ReviewPractice) => Math.max(1, ...Object.values(state.unlocked));

export const gradeReviewPractice = (previous: ReviewPractice, catalog: PracticeQuestion[], result: ReviewGrade | boolean): ReviewPractice => {
  const id = previous.queue[0];
  const question = catalog.find(q => q.id === id);
  if (!id || !question) return previous;
  const grade = normalizeReviewGrade(result);
  const correct = grade !== 'again';
  return settle({
    ...previous, queue: previous.queue.slice(1),
    attempts: { ...previous.attempts, [id]: (previous.attempts[id] || 0) + 1 },
    firstCorrect: id in previous.firstCorrect ? previous.firstCorrect : { ...previous.firstCorrect, [id]: correct },
    wrongCounts: { ...previous.wrongCounts, [id]: (previous.wrongCounts[id] || 0) + (correct ? 0 : 1) },
    completed: correct ? [...previous.completed, id] : previous.completed,
    roundWrong: correct ? previous.roundWrong : [...previous.roundWrong, id],
    grades: { ...previous.grades, [id]: [...(previous.grades[id] || []), grade] },
    answered: [...previous.answered, id]
  }, catalog);
};

export interface QuestionPerformance {
  reviewStep: number;
  wrongCount: number;
  attempts: number;
  intervalMs: number;
  masked?: boolean;
  fsrs?: FsrsCard;
  freedom?: number;
  responseMs?: number[];
}

/**
 * 쉬움을 FSRS에 "맞음"으로 넘기는 자유도 단계(0~3). 쉬움을 고를 때마다 자유도가 한 단계 오른다.
 * 자유도 자체는 한 문제로 묶는 최대 길이 −1까지 오른다(기본 4 → 3, 최대 10 → 9: 관계쌍을 그만큼 길게 잇는다).
 */
export const MAX_FREEDOM = 3;
export const freedomCap = () => Math.max(MAX_FREEDOM, readCombineLength() - 1);
const RESPONSE_HISTORY = 6;

/** 쉬움을 골랐을 때 FSRS에 넘기는 평가: 자유도가 아직 최대가 아니면 "맞음"(좋음)이고, 최대 자유도를 가진 뒤에야 "쉬움"이다. */
const fsrsRatingFor = (grade: ReviewGrade, freedomBefore: number, unit: boolean): FsrsRating => (
  grade === 'easy' && unit && freedomBefore < MAX_FREEDOM ? 3 : REVIEW_GRADE_FSRS[grade]
);

/** 예전 일정(FSRS 기록이 없는 것)은 그때의 간격을 안정도로 보고 이어 간다. */
const cardFromSchedule = (previous: Partial<QuestionPerformance> & { nextReviewDate?: string } | undefined, nowMs: number): FsrsCard | null => {
  if (previous?.fsrs) return previous.fsrs;
  if (!previous || !(previous.reviewStep || 0) || !previous.intervalMs) return null;
  const due = previous.nextReviewDate ? Date.parse(previous.nextReviewDate) : NaN;
  return { stability: Math.max(0.1, previous.intervalMs / DAY_MS), difficulty: 2.11810397, reps: previous.reviewStep || 1,
    lapses: previous.wrongCount || 0, lastReviewMs: Number.isFinite(due) ? due - previous.intervalMs : nowMs - previous.intervalMs };
};

export interface GradedPerformanceOptions {
  /** 이번에 이 문제를 푼 등급들(처음 푼 것부터). 오답 뒤 다시 푼 것도 순서대로 들어 있다. */
  grades?: ReviewGrade[];
  nowMs?: number;
  /** 능력 변환 문제의 한 단위인가(자유도가 붙는다) */
  unit?: boolean;
  /** 이번 첫 시도에서 정답 확인까지 걸린 시간(ms) */
  responseMs?: number;
}

/**
 * 등급이 기록된 복습: FSRS-6로 안정도·난이도를 갱신하고 다음 간격을 정한다.
 * 오답 뒤 같은 세션에서 다시 푼 것은 같은 날 복습 공식으로 이어 계산한다.
 * 능력 변환 문제 단위는 첫 시도의 등급에 따라 자유도가 달라진다: 쉬움 +1(맞음으로 처리), 오답 −1.
 */
const calculateGradedPerformance = (
  previous: Partial<QuestionPerformance> & { nextReviewDate?: string } | undefined,
  wrongCount: number,
  attempts: number,
  grades: ReviewGrade[],
  options: GradedPerformanceOptions
): QuestionPerformance => {
  const nowMs = options.nowMs ?? Date.now();
  const unit = Boolean(options.unit);
  // 자유도는 모든 문제에 쌓는다(관계쌍 묶음이 보통 문제의 자유도로 결합 범위를 정한다). `easy`를 `good`으로 넘기는 것은 능력 변환 단위만이다.
  const cap = freedomCap();
  const freedomBefore = Math.min(cap, Math.max(0, Math.floor(previous?.freedom || 0)));
  let freedom = freedomBefore;
  if (grades[0] === 'easy') freedom = Math.min(cap, freedomBefore + 1);
  if (grades[0] === 'again') freedom = Math.max(0, freedomBefore - 1);
  let card = cardFromSchedule(previous, nowMs);
  grades.forEach(grade => { card = fsrsReview(card, fsrsRatingFor(grade, freedomBefore, unit), nowMs); });
  const mistakes = Math.max(0, Math.floor(wrongCount));
  const previousStep = Math.max(0, Math.floor(previous?.reviewStep || 0));
  const intervalMs = fsrsIntervalMs(card!);
  const responseMs = options.responseMs !== undefined && Number.isFinite(options.responseMs) && options.responseMs > 0
    ? [...(previous?.responseMs || []), Math.round(options.responseMs)].slice(-RESPONSE_HISTORY) : previous?.responseMs;
  return {
    reviewStep: mistakes > 0 ? Math.max(0, previousStep - mistakes) : previousStep + 1,
    wrongCount: Math.max(0, previous?.wrongCount || 0) + mistakes,
    attempts: (previous?.attempts || 0) + attempts,
    intervalMs, masked: Boolean(previous?.masked || intervalMs >= REVIEW_MASK_INTERVAL_MS),
    fsrs: card!, freedom, ...(responseMs ? { responseMs } : {})
  };
};

/** 지금 이 문제를 푼다면 등급마다 다음 복습이 언제가 되는지(첫 시도 기준). 버튼에 보여 줄 값이다. */
export const previewGradeIntervals = (
  previous: Partial<QuestionPerformance> & { nextReviewDate?: string } | undefined,
  nowMs: number,
  unit = false
): Record<ReviewGrade, number> => {
  const result = {} as Record<ReviewGrade, number>;
  (['again', 'hard', 'good', 'easy'] as ReviewGrade[]).forEach(grade => {
    // 오답은 같은 세션에서 다시 풀어 맞히므로, 저장되는 간격은 [오답, 맞음]을 이어 계산한 값이다
    result[grade] = grade === 'again'
      ? calculateGradedPerformance(previous, 1, 2, ['again', 'good'], { nowMs, unit }).intervalMs
      : calculateGradedPerformance(previous, 0, 1, [grade], { nowMs, unit }).intervalMs;
  });
  return result;
};

export const calculateQuestionPerformance = (
  previous: Partial<QuestionPerformance> & { nextReviewDate?: string } | undefined,
  wrongCount: number,
  attempts: number,
  options: { baseIntervalMs?: number; initialIntervalMs?: number; minimumIntervalMs?: number } & GradedPerformanceOptions = {}
): QuestionPerformance => {
  if (options.grades?.length) return calculateGradedPerformance(previous, wrongCount, attempts, options.grades, options);
  const mistakes = Math.max(0, Math.floor(wrongCount));
  const previousStep = Math.max(0, Math.floor(previous?.reviewStep || 0));
  const reviewStep = mistakes > 0 ? Math.max(0, previousStep - mistakes) : previousStep + 1;
  const cumulativeWrong = Math.max(0, previous?.wrongCount || 0) + mistakes;
  const base = options.baseIntervalMs ?? 86400000;
  const intervalMs = Math.max(options.minimumIntervalMs ?? 60000, Math.round(reviewStep === 0
    ? options.initialIntervalMs ?? INITIAL_REVIEW_DELAY_MS
    : base * 2 ** Math.min(20, reviewStep - 1)));
  return { reviewStep, wrongCount: cumulativeWrong, attempts: (previous?.attempts || 0) + attempts, intervalMs,
    masked: Boolean(previous?.masked || intervalMs >= REVIEW_MASK_INTERVAL_MS) };
};
