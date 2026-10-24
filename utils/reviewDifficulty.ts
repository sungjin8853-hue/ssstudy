import type { AnswerSpan } from './reviewQuestions';

export interface ReviewQuestionDifficulty {
  recallUnits: number;
  providedUnits: number;
  difficulty: number;
}

export const calculateReviewQuestionDifficulty = (answers: AnswerSpan[], provided: AnswerSpan[]): ReviewQuestionDifficulty => {
  const key = (span: AnswerSpan) => `${span.nodeId}:${span.start}:${span.end}`;
  const hints = new Set(provided.map(key));
  const recall = new Set(answers.map(key).filter(item => !hints.has(item)));
  return { recallUnits: recall.size, providedUnits: hints.size,
    difficulty: recall.size / Math.max(1, recall.size + hints.size) };
};

export const compareReviewQuestionDifficulty = (
  a: Partial<ReviewQuestionDifficulty> & { level?: number; blankStart?: number },
  b: Partial<ReviewQuestionDifficulty> & { level?: number; blankStart?: number }
) => (a.difficulty ?? a.level ?? 1) - (b.difficulty ?? b.level ?? 1)
  || (a.recallUnits || 0) - (b.recallUnits || 0)
  || (b.providedUnits || 0) - (a.providedUnits || 0)
  || (a.blankStart || 0) - (b.blankStart || 0);
