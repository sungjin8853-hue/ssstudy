import type { StudyLog } from '../types';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from './review';
import { getReviewMemoPlainText } from './reviewMemo';
import type { ReviewMemoDocument } from '../types';
import { resolveReviewMemoDocument } from './reviewMemoDocument';
import { buildReviewQuestions } from './reviewQuestions';
import type { NoteQuestion } from './reviewQuestions';
import { calculateQuestionPerformance } from './reviewPractice';

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

export type ReviewGateQuestion = NoteQuestion;

export interface ParsedReviewGateMemo {
  parts: ReviewGatePart[];
  topics: string[];
  prompts: string[];
  answers: string[];
  questions: ReviewGateQuestion[];
}

const parseLegacyReviewGateMemo = (memo: string) => {
  memo = getReviewMemoPlainText(memo);
  const parts: ReviewGatePart[] = [];
  const topics = Array.from(memo.matchAll(/\[([^\[\]]+)\]/g))
    .map(match => match[1].trim())
    .filter(Boolean);
  const prompts: string[] = [];
  const answers: string[] = [];
  const questions: Array<{ key: string; prompt: string; answer: string; direction: string }> = [];
  const reverseQuestions: typeof questions = [];
  let cursor = 0;
  let fieldStart = 0;
  let bracketDepth = 0;
  let fields: Array<{ text: string; start: number; end: number }> = [];
  let operators: string[] = [];
  const finishClause = () => {
    fields.forEach((field, index) => {
      if (index === 0) return;
      const prompt = fields[index - 1].text.trim();
      const answer = field.text.trim();
      if (!prompt || !answer) return;
      const questionIndex = answers.length;
      if (field.start > cursor) parts.push({ type: 'text', text: memo.slice(cursor, field.start) });
      parts.push({ type: 'answer', text: field.text, questionIndex });
      prompts.push(prompt);
      answers.push(answer);
      questions.push({ key: `answer:${questionIndex}`, prompt, answer, direction: 'forward' });
      if (operators[index - 1] === ':') {
        reverseQuestions.push({ key: `reverse:${questionIndex}`, prompt: answer, answer: prompt, direction: 'reverse' });
      }
      cursor = field.end;
    });
    fields = [];
    operators = [];
  };
  for (let index = 0; index <= memo.length; index += 1) {
    const character = memo[index];
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    const clauseEnd = index === memo.length || character === '\n' || (character === ',' && bracketDepth === 0);
    const separator = (character === ':' || character === ';') && bracketDepth === 0;
    if (!clauseEnd && !separator) continue;
    fields.push({ text: memo.slice(fieldStart, index), start: fieldStart, end: index });
    if (separator) operators.push(character);
    else {
      finishClause();
      bracketDepth = 0;
    }
    fieldStart = index + 1;
  }

  if (cursor < memo.length) {
    parts.push({ type: 'text', text: memo.slice(cursor) });
  }

  if (parts.length === 0 && memo) {
    parts.push({ type: 'text', text: memo });
  }

  return { parts, topics, prompts, answers, questions: [...questions, ...reverseQuestions] };
};

export const parseReviewGateMemo = (memo: string): ParsedReviewGateMemo => {
  const { questions } = buildReviewQuestions(memo);
  const direct = questions.filter(question => question.kind === 'direct');
  return { questions, topics: [], prompts: direct.map(question => question.prompt), answers: direct.map(question => question.answer),
    parts: [{ type: 'text', text: getReviewMemoPlainText(memo) }] };
};

export const getReviewQuestionSchedules = (log: StudyLog): NonNullable<StudyLog['reviewQuestionSchedules']> => {
  if (log.reviewQuestionFormat === 2) return log.reviewQuestionSchedules || {};
  const schedules = { ...log.reviewQuestionSchedules };
  const current = buildReviewQuestions(log.reviewMemo || '').questions;
  // Old positional keys are matched by meaning once, never by their new position.
  for (const legacy of parseLegacyReviewGateMemo(log.reviewMemo || '').questions) {
    const schedule = schedules[legacy.key];
    const match = current.find(question => question.prompt === legacy.prompt && question.answer === legacy.answer && question.direction === legacy.direction);
    if (schedule && match) schedules[match.key] = schedule;
  }
  return schedules;
};

export const getReviewGateRetryKeys = (log: StudyLog): string[] => {
  const current = buildReviewQuestions(log.reviewMemo || '').questions;
  const legacy = parseLegacyReviewGateMemo(log.reviewMemo || '').questions;
  return (log.reviewGateRetry?.questionKeys || []).flatMap(key => {
    if (current.some(question => question.key === key)) return [key];
    if (log.reviewQuestionFormat === 2) return [];
    const old = legacy.find(question => question.key === key);
    const match = old && current.find(question => question.prompt === old.prompt && question.answer === old.answer && question.direction === old.direction);
    return match ? [match.key] : [];
  });
};

export interface ReviewGateOutcome {
  logId: string;
  passed: boolean;
  wrongQuestionKeys: string[];
  completedQuestionKeys?: string[];
  questionResults?: Record<string, { wrongCount: number; attempts: number }>;
  unlockedLevel?: number;
}

export const getReviewGateQuestionKeys = (memo: string): string[] => {
  return buildReviewQuestions(memo).questions.map(question => question.key);
};

export const getCurrentReviewIntervalMs = (reviewStep = 0) => (
  reviewStep > 0 ? getNextReviewIntervalMs(reviewStep - 1) : INITIAL_REVIEW_DELAY_MS
);

export const getDueReviewGateQuestionKeys = (log: StudyLog, nowMs: number, includeLocked = false): string[] => {
  const schedules = getReviewQuestionSchedules(log);
  return buildReviewQuestions(log.reviewMemo || '').questions.filter(question => {
    if (!includeLocked && question.level > (log.reviewGateLevel || 1)) return false;
    const date = schedules[question.key]?.nextReviewDate || log.nextReviewDate;
    return !date || Date.parse(date) <= nowMs;
  }).map(question => question.key);
};

// Commit the gate's individual schedules only after the linked subjects finish.
export const completeRegularReviewSchedule = (log: StudyLog, nowMs: number): Partial<StudyLog> => {
  const nextStep = (log.reviewStep || 0) + 1;
  const schedules = { ...getReviewQuestionSchedules(log) };
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
  for (const [key, pending] of Object.entries(log.reviewGatePendingSchedules || {})) {
    if (validKeys.has(key)) schedules[key] = { ...pending, nextReviewDate: new Date(nowMs + (pending.intervalMs || getCurrentReviewIntervalMs(pending.reviewStep))).toISOString() };
  }
  const unlockedKeys = new Set(buildReviewQuestions(log.reviewMemo || '').questions.filter(q => q.level <= (log.reviewGateLevel || 1)).map(q => q.key));
  const dates = Object.entries(schedules).filter(([key]) => unlockedKeys.has(key)).map(([, item]) => Date.parse(item.nextReviewDate)).filter(Number.isFinite);
  return {
    reviewStep: nextStep,
    nextReviewDate: new Date(dates.length ? Math.min(...dates) : nowMs + getCurrentReviewIntervalMs(nextStep)).toISOString(),
    reviewQuestionSchedules: schedules,
    reviewQuestionFormat: 2,
    reviewGatePendingSchedules: undefined,
    reviewGatePendingSteps: undefined,
    reviewGatePendingResult: undefined,
    reviewSubjectId: undefined
  };
};

export const updateReviewGateMemo = (log: StudyLog, memo: string, document?: ReviewMemoDocument): StudyLog => {
  if (log.reviewMemo === memo && (!document || document === log.reviewMemoDocument)) return log;
  const validKeys = new Set(getReviewGateQuestionKeys(memo));
  const pendingQuestionKeys = log.reviewGateRetry?.questionKeys?.filter(key => validKeys.has(key)) || [];
  return {
    ...log,
    reviewMemo: memo,
    reviewMemoDocument: resolveReviewMemoDocument(memo, document || log.reviewMemoDocument),
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

    if (outcome.questionResults) {
      const validKeys = new Set(getReviewGateQuestionKeys(log.reviewMemo || ''));
      const previous = getReviewQuestionSchedules(log);
      const pending = { ...log.reviewGatePendingSchedules };
      for (const key of outcome.completedQuestionKeys || []) {
        if (!validKeys.has(key) || !outcome.questionResults[key]) continue;
        const result = outcome.questionResults[key];
        const performance = calculateQuestionPerformance(previous[key], result.wrongCount, result.attempts);
        pending[key] = { ...performance, nextReviewDate: new Date(nowMs + performance.intervalMs).toISOString() };
      }
      if (isRetry) return { ...log, reviewGateRetry: undefined };
      return { ...log, reviewQuestionFormat: 2, reviewQuestionSchedules: previous,
        reviewGatePendingSchedules: pending, reviewGatePendingResult: outcome.passed ? 'correct' : 'wrong',
        reviewGateLevel: Math.min(3, Math.max(log.reviewGateLevel || 1, outcome.unlockedLevel || 1)), reviewGateRetry: undefined };
    }

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
      || getReviewGateRetryKeys(log).length === 0
      || (Array.isArray(log.reviewGateRetry?.questionKeys) && log.reviewGateRetry.questionKeys.length === 0)) return false;
    seen.add(log.id);
    return true;
  });
};
