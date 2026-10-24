import type { ReviewMemoOldLine, ReviewRemovedQuestion, StudyLog } from '../types';
import { memoEditEffects } from './noteLogicMarks';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from './review';
import { gradeSubjectCard, previewSubjectIntervals, SUBJECT_GRADES, subjectDueMs } from './subjectFeedback';
import type { SubjectGrade } from './subjectFeedback';
import { getReviewMemoPlainText } from './reviewMemo';
import type { ReviewMemoDocument } from '../types';
import { resolveReviewMemoDocument } from './reviewMemoDocument';
import { planRestoreRemoved } from './reviewRemoval';
import { buildReviewQuestions } from './reviewQuestions';
import { isReviewGroupClose, isReviewGroupOpen } from './reviewFieldOverride';
import type { NoteQuestion } from './reviewQuestions';
import { calculateQuestionPerformance, type ReviewGrade } from './reviewPractice';
import { isConvertUnitKey } from './abilityConvert';
import { withLogShorthand } from './noteShorthand';

/** 첫 인자인 기록의 과목 설정(`=`·`-` 단축어)으로 노트를 읽게 감싼다: 여러 과목의 기록을 한꺼번에 다뤄도 과목마다 제 규칙으로 읽는다 */
const inLogSubject = <A extends [{ subjectId?: string }, ...any[]], R>(run: (...args: A) => R) => (...args: A): R => withLogShorthand(args[0], () => run(...args));

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
    if (isReviewGroupOpen(character)) bracketDepth += 1;
    if (isReviewGroupClose(character)) bracketDepth = Math.max(0, bracketDepth - 1);
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

export const getReviewQuestionSchedules = inLogSubject((log: StudyLog): NonNullable<StudyLog['reviewQuestionSchedules']> => {
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
});

/**
 * 복습에서 뺀 문제인가. "중요도가 낮아서"는 기록만으로 뺀다. "논리적 관계에 안 맞아서"는 노트의 그 줄에 `[!]`를 붙여 문제가 만들어지지 않게 하므로
 * 줄을 붙이지 못한 경우(markedLines가 없음)에만 기록으로 뺀다. 줄이 고쳐져 `[!]`가 빠지면 문제는 다시 나온다.
 */
export const isReviewQuestionRemoved = (log: Pick<StudyLog, 'reviewRemoved'>, key: string): boolean => {
  const record = log.reviewRemoved?.[key];
  if (!record) return false;
  return record.reason === 'low' || !record.markedLines?.length;
};

export const getReviewGateRetryKeys = inLogSubject((log: StudyLog): string[] => {
  const current = buildReviewQuestions(log.reviewMemo || '').questions;
  const legacy = parseLegacyReviewGateMemo(log.reviewMemo || '').questions;
  return (log.reviewGateRetry?.questionKeys || []).flatMap(key => {
    if (isReviewQuestionRemoved(log, key)) return [];
    if (current.some(question => question.key === key)) return [key];
    if (log.reviewQuestionFormat === 2) return [];
    const old = legacy.find(question => question.key === key);
    const match = old && current.find(question => question.prompt === old.prompt && question.answer === old.answer && question.direction === old.direction);
    return match ? [match.key] : [];
  });
});

export interface ReviewGateOutcome {
  logId: string;
  passed: boolean;
  wrongQuestionKeys: string[];
  completedQuestionKeys?: string[];
  /**
   * 문제별 결과. grades(푼 순서대로의 등급)가 있으면 FSRS-6로 일정을 정하고, 없으면 예전 방식(두 배씩)으로 정한다.
   * responseMs는 첫 시도에서 정답을 확인하기까지 걸린 시간이다(난이도 추천에 쓴다).
   */
  questionResults?: Record<string, { wrongCount: number; attempts: number; grades?: ReviewGrade[]; responseMs?: number }>;
  unlockedLevel?: number;
}

export const getReviewGateQuestionKeys = (memo: string): string[] => {
  return buildReviewQuestions(memo).questions.map(question => question.key);
};

export const getCurrentReviewIntervalMs = (reviewStep = 0) => (
  reviewStep > 0 ? getNextReviewIntervalMs(reviewStep - 1) : INITIAL_REVIEW_DELAY_MS
);

export const getDueReviewGateQuestionKeys = inLogSubject((log: StudyLog, nowMs: number, includeLocked = false): string[] => {
  const schedules = getReviewQuestionSchedules(log);
  return buildReviewQuestions(log.reviewMemo || '').questions.filter(question => {
    if (isReviewQuestionRemoved(log, question.key)) return false;
    if (!includeLocked && question.level > (log.reviewGateLevel || 1)) return false;
    const date = schedules[question.key]?.nextReviewDate || log.nextReviewDate;
    return !date || Date.parse(date) <= nowMs;
  }).map(question => question.key);
});

// Commit the gate's individual schedules only after the linked subjects finish.
export const completeRegularReviewSchedule = inLogSubject((log: StudyLog, nowMs: number): Partial<StudyLog> => {
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
  const unlockedKeys = new Set(buildReviewQuestions(log.reviewMemo || '').questions.filter(q => q.level <= (log.reviewGateLevel || 1) && !isReviewQuestionRemoved(log, q.key)).map(q => q.key));
  const dates = Object.entries(schedules).filter(([key]) => unlockedKeys.has(key)).map(([, item]) => Date.parse(item.nextReviewDate)).filter(Number.isFinite);
  // 과목 난도 피드백(FSRS-6)이 정한 다음 복습도 함께 본다: 문제가 모두 멀어도 과목 복습 때가 되면 열린다.
  // 이미 지난 날짜(방금 마친 복습의 옛 예정일)는 넣지 않는다. 넣으면 복습을 마치자마자 다시 복습할 때가 된다.
  const subjectDue = subjectDueMs(log);
  if (Number.isFinite(subjectDue) && subjectDue > nowMs) dates.push(subjectDue);
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
});

/**
 * 복습과목을 마칠 때 난도마다 실제로 다음 복습이 언제 열리는가(ms 뒤). 복습을 마치면 다음 복습은 "풀린 문제들의 다음 복습"과
 * "과목 난도가 정한 다음 복습" 중 이른 쪽이라(completeRegularReviewSchedule), 난도 버튼에 과목 간격만 보이면 실제와 다르다(21:50 점검:
 * "보통 · 다음 복습 12일 뒤"를 골랐는데 이틀 뒤 다시 열림). 기록이 없으면 과목 간격 그대로.
 */
export const previewReviewCompletionIntervals = (log: StudyLog | null, nowMs: number): Record<SubjectGrade, number> => {
  const subjectOnly = previewSubjectIntervals(log, nowMs);
  if (!log || log.isRepeatReview) return subjectOnly;
  return Object.fromEntries(SUBJECT_GRADES.map(grade => {
    const done = completeRegularReviewSchedule({ ...log, reviewFsrs: gradeSubjectCard(log, grade, nowMs) }, nowMs);
    const at = done.nextReviewDate ? Date.parse(done.nextReviewDate) : NaN;
    return [grade, Number.isFinite(at) ? Math.max(0, at - nowMs) : subjectOnly[grade]];
  })) as Record<SubjectGrade, number>;
};

export interface ReviewMemoEditOptions {
  /** 노트를 고쳐 새로 생긴 문제를 바로 복습으로 들인다(끌 수 있다). 주지 않으면 들이지 않는다. */
  intake?: boolean;
  nowMs?: number;
}

const OLD_LINES_LIMIT = 80;

/** 두 글의 닮은 정도(0~1): 글자 2-그램 겹침(다이스 계수). 공백은 뺀다. */
const textSimilarity = (a: string, b: string): number => {
  const x = a.replace(/\s+/g, '');
  const y = b.replace(/\s+/g, '');
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (text: string) => { const map = new Map<string, number>(); for (let i = 0; i < text.length - 1; i += 1) { const g = text.slice(i, i + 2); map.set(g, (map.get(g) ?? 0) + 1); } return map; };
  const gx = grams(x);
  const gy = grams(y);
  let shared = 0;
  gx.forEach((count, gram) => { shared += Math.min(count, gy.get(gram) ?? 0); });
  return (2 * shared) / (x.length - 1 + y.length - 1);
};

/**
 * 오류를 고친 것으로 보고(‘고친 부분을 복습에 넣기’를 끈 상태) 바뀐 문제의 일정을 이어받는다(P6):
 * 고친 뒤 새로 생긴 문제마다, 고치며 사라진 문제 중 가장 닮은 것(같은 종류 · 같은 조건 · 문제와 정답 글이 닮음, 0.5 이상)의 일정을 그대로 쓴다.
 * 사라진 문제 하나는 한 번만 물려준다.
 */
export const inheritEditedSchedules = (before: string, after: string, schedules: StudyLog['reviewQuestionSchedules']): StudyLog['reviewQuestionSchedules'] => {
  if (!schedules || !Object.keys(schedules).length) return schedules;
  const oldQuestions = buildReviewQuestions(before).questions;
  const newQuestions = buildReviewQuestions(after).questions;
  const newKeys = new Set(newQuestions.map(question => question.key));
  const oldKeys = new Set(oldQuestions.map(question => question.key));
  const gone = oldQuestions.filter(question => !newKeys.has(question.key) && schedules[question.key]);
  const fresh = newQuestions.filter(question => !oldKeys.has(question.key) && !schedules[question.key]);
  if (!gone.length || !fresh.length) return schedules;
  const pairs: Array<{ from: NoteQuestion; to: NoteQuestion; score: number }> = [];
  fresh.forEach(to => gone.forEach(from => {
    if (from.kind !== to.kind || (from.form ?? '') !== (to.form ?? '')) return;
    const sameConditions = from.conditions.join('\u0000') === to.conditions.join('\u0000');
    const score = (textSimilarity(from.prompt, to.prompt) + textSimilarity(from.answer, to.answer)) / 2 + (sameConditions ? 0.1 : 0);
    if (score >= 0.5) pairs.push({ from, to, score });
  }));
  pairs.sort((a, b) => b.score - a.score);
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  const written = { ...schedules };
  pairs.forEach(({ from, to }) => {
    if (usedFrom.has(from.key) || usedTo.has(to.key)) return;
    usedFrom.add(from.key);
    usedTo.add(to.key);
    written[to.key] = { ...schedules[from.key]! };
  });
  return usedTo.size ? written : schedules;
};

/** 고친 줄을 "이전 값"으로 쌓는다(같은 줄이 이미 있으면 새로 쌓지 않는다) */
const stackOldLines = (previous: ReviewMemoOldLine[] | undefined, lines: Array<Omit<ReviewMemoOldLine, 'at'>>, at: string): ReviewMemoOldLine[] | undefined => {
  if (!lines.length) return previous;
  const fresh = lines.filter(line => !(previous || []).some(item => item.text === line.text && item.replacedBy === line.replacedBy))
    .map(line => ({ ...line, at }));
  return [...fresh, ...(previous || [])].slice(0, OLD_LINES_LIMIT);
};

/** 줄이 고쳐져 지금 노트에 남아 있지 않은 `[!]` 기록은 푼다(문제는 다시 나온다) */
const pruneReleasedRemovals = (removed: StudyLog['reviewRemoved'], memo: string): StudyLog['reviewRemoved'] => {
  if (!removed) return removed;
  const lines = new Set(memo.split('\n'));
  const entries = Object.entries(removed).filter(([, record]) => record.reason !== 'logic' || !record.markedLines?.length || record.markedLines.some(line => lines.has(line)));
  if (entries.length === Object.keys(removed).length) return removed;
  return entries.length ? Object.fromEntries(entries) : undefined;
};

export const updateReviewGateMemo = inLogSubject((log: StudyLog, memo: string, document?: ReviewMemoDocument, options: ReviewMemoEditOptions = {}): StudyLog => {
  if (log.reviewMemo === memo && (!document || document === log.reviewMemoDocument)) return log;
  const before = log.reviewMemo || '';
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  // 노트를 직접 고친 줄이 `[!]`에 걸려 있었다면 그 줄은 `!`에서 풀리고, 고치기 전의 줄은 이전 값으로 남는다.
  const effects = before === memo ? { memo, oldLines: [], released: 0 } : memoEditEffects(before, memo);
  const nextMemo = effects.memo;
  const validKeys = new Set(getReviewGateQuestionKeys(nextMemo));
  const pendingQuestionKeys = log.reviewGateRetry?.questionKeys?.filter(key => validKeys.has(key)) || [];
  let schedules = log.reviewQuestionSchedules;
  let nextReviewDate = log.nextReviewDate;
  // ‘고친 부분을 복습에 넣기’를 끈 채 고친 것은 오류를 바로잡은 것으로 본다: 바뀐 문제는 가장 닮은 옛 문제의 일정을 이어받는다
  if (options.intake === false && before.trim() && before !== nextMemo) schedules = inheritEditedSchedules(before, nextMemo, schedules);
  if (options.intake && before.trim() && log.reviewEnabled !== false && !log.isCondensed && nextReviewDate && Number.isFinite(Date.parse(nextReviewDate))) {
    const oldKeys = new Set(getReviewGateQuestionKeys(before));
    const fresh = [...validKeys].filter(key => !oldKeys.has(key) && !isReviewQuestionRemoved(log, key));
    if (fresh.length) {
      const written = { ...schedules };
      // 아직 복습 날짜가 없던 기존 문제는 지금 날짜를 그대로 지키고(복습 때가 앞당겨지지 않게), 고친 부분만 지금 복습에 든다.
      if (Date.parse(nextReviewDate) > nowMs) {
        validKeys.forEach(key => {
          if (!oldKeys.has(key) || written[key]) return;
          written[key] = { reviewStep: log.reviewStep ?? 0, nextReviewDate: nextReviewDate! };
        });
        nextReviewDate = nowIso;
      }
      fresh.forEach(key => { written[key] = { reviewStep: 0, nextReviewDate: nowIso }; });
      schedules = written;
    }
  }
  return {
    ...log,
    reviewMemo: nextMemo,
    reviewMemoDocument: resolveReviewMemoDocument(nextMemo, effects.released ? undefined : (document || log.reviewMemoDocument)),
    reviewGateRetry: log.reviewGateRetry && pendingQuestionKeys.length > 0
      ? { ...log.reviewGateRetry, questionKeys: pendingQuestionKeys }
      : undefined,
    ...(schedules !== log.reviewQuestionSchedules ? { reviewQuestionSchedules: schedules } : {}),
    ...(nextReviewDate !== log.nextReviewDate ? { nextReviewDate } : {}),
    reviewRemoved: pruneReleasedRemovals(log.reviewRemoved, nextMemo),
    reviewMemoOldLines: stackOldLines(log.reviewMemoOldLines, effects.oldLines, nowIso)
  };
});

/** 복습에서 빼기를 노트에 적용한다: `[!]`를 붙인 글이 있으면 그 글로 바꾸고(이전 값으로 쌓지 않는다), 기록을 더하며, 대기 중인 오답 다시 풀기에서 뺀다. */
export const applyReviewRemoval = inLogSubject((log: StudyLog, update: { memo?: string; removed: Record<string, ReviewRemovedQuestion> }): StudyLog => {
  const memo = update.memo ?? log.reviewMemo;
  const removedKeys = new Set(Object.keys(update.removed));
  const retryKeys = log.reviewGateRetry?.questionKeys.filter(key => !removedKeys.has(key)) || [];
  return {
    ...log,
    ...(update.memo !== undefined ? { reviewMemo: memo, reviewMemoDocument: resolveReviewMemoDocument(update.memo, undefined) } : {}),
    reviewRemoved: { ...log.reviewRemoved, ...update.removed },
    reviewGateRetry: log.reviewGateRetry && retryKeys.length > 0 ? { ...log.reviewGateRetry, questionKeys: retryKeys } : undefined
  };
});

/** 복습에서 뺀 문제를 되돌린다: `[!]`를 붙였던 줄은 `!`를 빼고 기록을 지운다(문제는 다시 나온다). */
export const restoreReviewRemoval = inLogSubject((log: StudyLog, key: string): StudyLog => {
  const restored = planRestoreRemoved(log, key);
  return {
    ...log,
    ...(restored.memo !== undefined ? { reviewMemo: restored.memo, reviewMemoDocument: resolveReviewMemoDocument(restored.memo, undefined) } : {}),
    reviewRemoved: restored.reviewRemoved
  };
});

export const applyReviewGateOutcomes = (
  logs: StudyLog[],
  outcomes: ReviewGateOutcome[],
  isRetry: boolean,
  nowMs: number
): StudyLog[] => {
  const byId = new Map(outcomes.map(outcome => [outcome.logId, outcome]));
  return logs.map(log => withLogShorthand(log, () => {
    const outcome = byId.get(log.id);
    if (!outcome || (isRetry && !log.reviewGateRetry)) return log;

    if (outcome.questionResults) {
      const validKeys = new Set(getReviewGateQuestionKeys(log.reviewMemo || ''));
      const previous = getReviewQuestionSchedules(log);
      const pending = { ...log.reviewGatePendingSchedules };
      for (const key of outcome.completedQuestionKeys || []) {
        if (!validKeys.has(key) || !outcome.questionResults[key]) continue;
        const result = outcome.questionResults[key];
        const performance = calculateQuestionPerformance(previous[key], result.wrongCount, result.attempts, {
          grades: result.grades, nowMs, unit: isConvertUnitKey(key), responseMs: result.responseMs
        });
        pending[key] = { ...performance, nextReviewDate: new Date(nowMs + performance.intervalMs).toISOString() };
      }
      if (isRetry) return { ...log, reviewGateRetry: undefined };
      return { ...log, reviewQuestionFormat: 2, reviewQuestionSchedules: previous,
        reviewGatePendingSchedules: pending, reviewGatePendingResult: outcome.passed ? 'correct' : 'wrong',
        reviewGateLevel: Math.min(3, Math.max(1, outcome.unlockedLevel ?? log.reviewGateLevel ?? 1)), reviewGateRetry: undefined };
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
  }));
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
