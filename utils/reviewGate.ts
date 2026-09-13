import type { StudyLog } from '../types';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from './review';

export interface ReviewGateTextPart {
  type: 'text';
  text: string;
}

export interface ReviewGateAnswerPart {
  type: 'answer';
  text: string;
  questionIndex: number;
}

export type ReviewGatePart = ReviewGateTextPart | ReviewGateAnswerPart;

export interface ParsedReviewGateMemo {
  parts: ReviewGatePart[];
  topics: string[];
  prompts: string[];
  answers: string[];
}

export const parseReviewGateMemo = (memo: string): ParsedReviewGateMemo => {
  const parts: ReviewGatePart[] = [];
  const topics = Array.from(memo.matchAll(/\[([^\[\]]+)\]/g))
    .map(match => match[1].trim())
    .filter(Boolean);
  const prompts: string[] = [];
  const answers: string[] = [];
  const pattern = /(^|[,]\s*|\n\s*)([^,:\n]+?)\s*:\s*([^,\n]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(memo)) !== null) {
    const answer = match[3].trim();
    const prompt = match[2].trim();
    if (!answer || !prompt) continue;
    const answerOffset = match[0].lastIndexOf(match[3]);
    const answerStart = match.index + answerOffset;
    if (answerStart > cursor) parts.push({ type: 'text', text: memo.slice(cursor, answerStart) });
    parts.push({ type: 'answer', text: match[3], questionIndex: answers.length });
    prompts.push(prompt);
    answers.push(answer);
    cursor = answerStart + match[3].length;
  }

  if (cursor < memo.length) {
    parts.push({ type: 'text', text: memo.slice(cursor) });
  }

  if (parts.length === 0 && memo) {
    parts.push({ type: 'text', text: memo });
  }

  return { parts, topics, prompts, answers };
};

export interface ReviewGateOutcome {
  logId: string;
  passed: boolean;
  wrongQuestionKeys: string[];
}

export const getReviewGateQuestionKeys = (memo: string): string[] => {
  const parsed = parseReviewGateMemo(memo);
  if (parsed.answers.length === 0) return memo.trim() ? ['note'] : [];
  return parsed.answers.map((_, index) => `answer:${index}`);
};

export const getCurrentReviewIntervalMs = (reviewStep = 0) => (
  reviewStep > 0 ? getNextReviewIntervalMs(reviewStep - 1) : INITIAL_REVIEW_DELAY_MS
);

export const updateReviewGateMemo = (log: StudyLog, memo: string): StudyLog => {
  if (log.reviewMemo === memo) return log;
  const validKeys = new Set(getReviewGateQuestionKeys(memo));
  const pendingQuestionKeys = log.reviewGateRetry?.questionKeys?.filter(key => validKeys.has(key)) || [];
  return {
    ...log,
    reviewMemo: memo,
    reviewGateRetry: log.reviewGateRetry && pendingQuestionKeys.length > 0
      ? { ...log.reviewGateRetry, questionKeys: pendingQuestionKeys }
      : undefined
  };
};

export const applyReviewGateOutcomes = (
  logs: StudyLog[],
  outcomes: ReviewGateOutcome[],
  isRetry: boolean,
  nowMs: number
): StudyLog[] => {
  const byId = new Map(outcomes.map(outcome => [outcome.logId, outcome]));
  return logs.map(log => {
    const outcome = byId.get(log.id);
    if (!outcome || (isRetry && !log.reviewGateRetry)) return log;
    if (outcome.passed) {
      return {
        ...log,
        reviewGateRetry: undefined
      };
    }

    const validQuestionKeys = new Set(getReviewGateQuestionKeys(log.reviewMemo || ''));
    const wrongQuestionKeys = Array.from(new Set(outcome.wrongQuestionKeys))
      .filter(key => validQuestionKeys.has(key));
    if (wrongQuestionKeys.length === 0) return log;
    // Keep one pending retry per note, separate from the regular review schedule.
    if (!isRetry && log.reviewGateRetry) return log;
    const reviewStep = isRetry ? log.reviewGateRetry!.reviewStep : (log.reviewStep || 0);
    const intervalMs = isRetry
      ? log.reviewGateRetry!.intervalMs
      : getCurrentReviewIntervalMs(reviewStep);
    return {
      ...log,
      reviewGateRetry: {
        dueAt: new Date(nowMs + intervalMs).toISOString(),
        intervalMs,
        reviewStep,
        questionKeys: wrongQuestionKeys
      }
    };
  });
};

export const clearReviewGateRetries = (logs: StudyLog[], logIds: string[]): StudyLog[] => {
  const ids = new Set(logIds);
  return logs.map(log => ids.has(log.id) && log.reviewGateRetry
    ? { ...log, reviewGateRetry: undefined }
    : log
  );
};

export const getDueReviewGateRetries = (logs: StudyLog[], nowMs: number): StudyLog[] => {
  const seen = new Set<string>();
  return logs.filter(log => {
    const dueAt = log.reviewGateRetry ? Date.parse(log.reviewGateRetry.dueAt) : NaN;
    if (!Number.isFinite(dueAt) || dueAt > nowMs || seen.has(log.id)
      || getReviewGateQuestionKeys(log.reviewMemo || '').length === 0
      || (Array.isArray(log.reviewGateRetry?.questionKeys) && log.reviewGateRetry.questionKeys.length === 0)) return false;
    seen.add(log.id);
    return true;
  });
};
