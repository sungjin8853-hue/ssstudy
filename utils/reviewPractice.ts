import { INITIAL_REVIEW_DELAY_MS } from './review';
import { compareReviewQuestionDifficulty } from './reviewDifficulty';
import type { ReviewQuestionDifficulty } from './reviewDifficulty';

export const REVIEW_PASS_RATIO = 0.8;
export const REVIEW_MASK_INTERVAL_MS = 8 * 86400000;
export interface PracticeQuestion extends Partial<ReviewQuestionDifficulty> { id: string; logId: string; level: number; priority: number }
export interface ReviewPractice {
  queue: string[];
  roundWrong: string[];
  completed: string[];
  wrongCounts: Record<string, number>;
  attempts: Record<string, number>;
  firstCorrect: Record<string, boolean>;
  unlocked: Record<string, number>;
  level: number;
  priority: number;
  round: number;
  roundSize: number;
  roundAnswered: number;
}
const nextBatch = (state: ReviewPractice, catalog: PracticeQuestion[]): ReviewPractice => {
  const available = catalog.filter(q => q.level <= (state.unlocked[q.logId] || 1) && !state.completed.includes(q.id));
  const priority = Math.min(...available.map(q => q.priority));
  const important = available.filter(q => q.priority === priority);
  const level = Math.min(...important.map(q => q.level));
  const queue = important.filter(q => q.level === level).sort(compareReviewQuestionDifficulty).map(q => q.id);
  return { ...state, level: Number.isFinite(level) ? level : state.level,
    priority: Number.isFinite(priority) ? priority : state.priority, queue, round: 1, roundWrong: [], roundSize: queue.length, roundAnswered: 0 };
};
export const startReviewPractice = (catalog: PracticeQuestion[], unlocked: Record<string, number> = {}): ReviewPractice => nextBatch({
  queue: [], roundWrong: [], completed: [], wrongCounts: {}, attempts: {}, firstCorrect: {}, unlocked: { ...unlocked }, level: 1, priority: 1, round: 1, roundSize: 0, roundAnswered: 0
}, catalog);

export const gradeReviewPractice = (previous: ReviewPractice, catalog: PracticeQuestion[], correct: boolean): ReviewPractice => {
  const id = previous.queue[0];
  if (!id) return previous;
  const state: ReviewPractice = {
    ...previous, queue: previous.queue.slice(1),
    attempts: { ...previous.attempts, [id]: (previous.attempts[id] || 0) + 1 },
    firstCorrect: id in previous.firstCorrect ? previous.firstCorrect : { ...previous.firstCorrect, [id]: correct },
    wrongCounts: { ...previous.wrongCounts, [id]: (previous.wrongCounts[id] || 0) + (correct ? 0 : 1) },
    completed: correct ? [...previous.completed, id] : previous.completed,
    roundWrong: correct ? previous.roundWrong : [...previous.roundWrong, id],
    roundAnswered: previous.roundAnswered + 1,
    unlocked: { ...previous.unlocked }
  };
  if (state.queue.length) return state;
  if (state.roundWrong.length) return { ...state, queue: state.roundWrong, roundWrong: [], round: state.round + 1,
    roundSize: state.roundWrong.length, roundAnswered: 0 };

  // Score first encounters, not the eventually-correct retries, independently per note.
  for (const logId of new Set(catalog.map(q => q.logId))) {
    const graded = catalog.filter(q => q.logId === logId && q.priority === state.priority && q.level === state.level && q.id in state.firstCorrect);
    const ratio = graded.filter(q => state.firstCorrect[q.id]).length / graded.length;
    const nextLevel = Math.min(...catalog.filter(q => q.logId === logId && q.priority === state.priority && q.level > state.level).map(q => q.level));
    if (ratio >= REVIEW_PASS_RATIO && Number.isFinite(nextLevel)) state.unlocked[logId] = Math.max(state.unlocked[logId] || 1, nextLevel);
  }
  return nextBatch(state, catalog);
};

export interface QuestionPerformance {
  reviewStep: number;
  wrongCount: number;
  attempts: number;
  intervalMs: number;
  masked?: boolean;
}
export const calculateQuestionPerformance = (
  previous: Partial<QuestionPerformance> | undefined,
  wrongCount: number,
  attempts: number,
  options: { baseIntervalMs?: number; initialIntervalMs?: number; minimumIntervalMs?: number } = {}
): QuestionPerformance => {
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
