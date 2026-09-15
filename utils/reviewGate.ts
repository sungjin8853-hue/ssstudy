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
  completedQuestionKeys?: string[];
}

export const getReviewGateQuestionKeys = (memo: string): string[] => {
  const parsed = parseReviewGateMemo(memo);
  if (parsed.answers.length === 0) return memo.trim() ? ['note'] : [];
  return parsed.answers.map((_, index) => `answer:${index}`);
};

export const getCurrentReviewIntervalMs = (reviewStep = 0) => (
  reviewStep > 0 ? getNextReviewIntervalMs(reviewStep - 1) : INITIAL_REVIEW_DELAY_MS
);

export const getDueReviewGateQuestionKeys = (log: StudyLog, nowMs: number): string[] => (
  getReviewGateQuestionKeys(log.reviewMemo || '').filter(key => {
    const date = log.reviewQuestionSchedules?.[key]?.nextReviewDate || log.nextReviewDate;
    return !date || Date.parse(date) <= nowMs;
  })
);

// Commit the gate's individual schedules only after the linked subjects finish.
export const completeRegularReviewSchedule = (log: StudyLog, nowMs: number): Partial<StudyLog> => {
  const nextStep = (log.reviewStep || 0) + 1;
  const schedules = { ...log.reviewQuestionSchedules };
  const validKeys = new Set(getReviewGateQuestionKeys(log.reviewMemo || ''));
  for (const key of Object.keys(schedules)) {
    if (!validKeys.has(key)) delete schedules[key];
  }
  for (const [key, reviewStep] of Object.entries(log.reviewGatePendingSteps || {})) {
    if (!validKeys.has(key)) continue;
    schedules[key] = {
      reviewStep,
      nextReviewDate: new Date(nowMs + getCurrentReviewIntervalMs(reviewStep)).toISOString()
    };
  }
  const dates = Object.values(schedules).map(item => Date.parse(item.nextReviewDate)).filter(Number.isFinite);
  return {
    reviewStep: nextStep,
    nextReviewDate: new Date(dates.length ? Math.min(...dates) : nowMs + getCurrentReviewIntervalMs(nextStep)).toISOString(),
    reviewQuestionSchedules: schedules,
    reviewGatePendingSteps: undefined,
    reviewGatePendingResult: undefined,
    reviewSubjectId: undefined
  };
};

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

    if (!isRetry) {
      const validKeys = new Set(getReviewGateQuestionKeys(log.reviewMemo || ''));
      const answeredKeys = outcome.completedQuestionKeys || getDueReviewGateQuestionKeys(log, nowMs);
      const wrongKeys = new Set(outcome.wrongQuestionKeys.filter(key => validKeys.has(key)));
      const pendingSteps = { ...log.reviewGatePendingSteps };
      for (const key of answeredKeys) {
        if (!validKeys.has(key)) continue;
        const step = log.reviewQuestionSchedules?.[key]?.reviewStep ?? log.reviewStep ?? 0;
        pendingSteps[key] = wrongKeys.has(key) ? Math.max(0, step - 1) : step + 1;
      }
      // Immediate rounds have cleared these errors; do not schedule them again.
      if (outcome.completedQuestionKeys) {
        const completed = new Set(outcome.completedQuestionKeys);
        const remaining = log.reviewGateRetry?.questionKeys.filter(key => !completed.has(key)) || [];
        return {
          ...log,
          reviewGatePendingSteps: pendingSteps,
          reviewGatePendingResult: wrongKeys.size ? 'wrong' : 'correct',
          reviewGateRetry: log.reviewGateRetry && remaining.length
            ? { ...log.reviewGateRetry, questionKeys: remaining }
            : undefined
        };
      }
      // Compatibility for an interrupted attempt saved before in-session rounds.
      if (!outcome.passed && log.reviewGateRetry) return log;
      if (!outcome.passed && wrongKeys.size === 0) return log;
      const step = Math.max(0, (log.reviewStep || 0) - 1);
      const intervalMs = getCurrentReviewIntervalMs(step);
      return {
        ...log,
        reviewGatePendingSteps: pendingSteps,
        reviewGatePendingResult: outcome.passed ? 'correct' : 'wrong',
        reviewGateRetry: outcome.passed ? undefined : {
          dueAt: new Date(nowMs + intervalMs).toISOString(),
          intervalMs,
          reviewStep: step,
          questionKeys: [...wrongKeys]
        }
      };
    }

    const currentStep = isRetry
      ? log.reviewGateRetry!.reviewStep
      : (log.reviewStep || 0);
    const nextStep = outcome.passed
      ? currentStep + 1
      : Math.max(0, currentStep - 1);

    if (outcome.passed || outcome.completedQuestionKeys) {
      return {
        ...log,
        reviewGateRetry: undefined,
      };
    }

    const validQuestionKeys = new Set(getReviewGateQuestionKeys(log.reviewMemo || ''));
    const wrongQuestionKeys = Array.from(new Set(outcome.wrongQuestionKeys))
      .filter(key => validQuestionKeys.has(key));
    if (wrongQuestionKeys.length === 0) return log;
    // Keep one pending retry per note, separate from the regular review schedule.
    if (!isRetry && log.reviewGateRetry) return log;
    const intervalMs = getCurrentReviewIntervalMs(nextStep);
    const dueAt = new Date(nowMs + intervalMs).toISOString();
    return {
      ...log,
      reviewGatePendingResult: isRetry ? log.reviewGatePendingResult : 'wrong',
      reviewGateRetry: {
        dueAt,
        intervalMs,
        reviewStep: nextStep,
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
