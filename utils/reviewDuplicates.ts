import type { ReviewQuestionSchedule, ReviewRemovedQuestion, StudyLog } from '../types';
import { applyReviewRemoval, getCurrentReviewIntervalMs, getReviewQuestionSchedules } from './reviewGate';
import { buildReviewQuestions } from './reviewQuestions';
import type { NoteQuestion } from './reviewQuestions';
import { isNoteShorthandOn, withLogShorthand } from './noteShorthand';

/**
 * 같은 문제 정리. 한 과목의 노트들에 문제 글 · 정답 · 조건까지 모두 같은 문제가 둘 이상 있으면
 * 복습 주기가 가장 짧은 하나만 복습에 남기고 나머지는 복습에서 뺀다(노트 글은 그대로, 이유는 `duplicate`).
 *  - 같은 문제 = 문제 키(종류 · 글 · 정답)와 조건이 모두 같은 것. 조건이 다르면 다른 문제다.
 *  - 복습 주기 = 그 문제의 다음 복습까지의 간격. 같으면 먼저 복습할 때가 오는 쪽, 그래도 같으면 앞선(오래된) 노트.
 *  - 이미 뺀 문제(다른 이유)는 겹침으로 세지 않는다. 남은 쪽의 문제가 사라지거나 더는 겹치지 않으면 뺀 쪽이 다시 나온다.
 */

const QUESTION_CACHE_LIMIT = 300;
const questionCache = new Map<string, NoteQuestion[]>();
const questionsOf = (memo: string): NoteQuestion[] => {
  // 같은 글이라도 `=`·`-` 단축어를 켜고 끄면 문제가 다르다
  const cacheKey = `${isNoteShorthandOn() ? 1 : 0}\u0000${memo}`;
  const cached = questionCache.get(cacheKey);
  if (cached) return cached;
  const built = buildReviewQuestions(memo).questions;
  if (questionCache.size >= QUESTION_CACHE_LIMIT) questionCache.delete(questionCache.keys().next().value as string);
  questionCache.set(cacheKey, built);
  return built;
};

const identityOf = (question: NoteQuestion) => `${question.key}\u0000${JSON.stringify(question.conditions)}`;

const takesPart = (log: StudyLog) => (log.reviewMemo ?? '').trim().length > 0 && log.reviewEnabled !== false && !log.isCondensed;

/** 문제 하나의 복습 주기(ms): 간격이 기록돼 있으면 그것, FSRS 기억 상태가 있으면 마지막 복습부터 다음 복습까지, 아니면 복습 단계의 간격 */
export const questionIntervalMs = (log: Pick<StudyLog, 'reviewStep'>, schedule: ReviewQuestionSchedule | undefined): number => {
  if (!schedule) return getCurrentReviewIntervalMs(log.reviewStep || 0);
  if (Number.isFinite(schedule.intervalMs) && (schedule.intervalMs as number) > 0) return schedule.intervalMs as number;
  const due = Date.parse(schedule.nextReviewDate);
  const last = schedule.fsrs?.lastReviewMs;
  if (last !== undefined && Number.isFinite(last) && Number.isFinite(due) && due > last) return due - last;
  return getCurrentReviewIntervalMs(schedule.reviewStep || 0);
};

interface Entry { log: StudyLog; question: NoteQuestion; interval: number; due: number; order: number; duplicate: boolean }

const shorter = (a: Entry, b: Entry) => (a.interval - b.interval) || (a.due - b.due) || (a.order - b.order);

export const dedupeIdenticalQuestions = (logs: StudyLog[], nowMs: number = Date.now()): StudyLog[] => {
  const bySubject = new Map<string, StudyLog[]>();
  logs.forEach(log => { if (takesPart(log)) bySubject.set(log.subjectId, [...(bySubject.get(log.subjectId) ?? []), log]); });
  const added = new Map<string, Record<string, ReviewRemovedQuestion>>();
  const released = new Map<string, Set<string>>();
  const nowIso = new Date(nowMs).toISOString();
  const addRemoval = (entry: Entry) => {
    const record: ReviewRemovedQuestion = { reason: 'duplicate', at: nowIso, prompt: entry.question.prompt, answer: entry.question.answer };
    added.set(entry.log.id, { ...(added.get(entry.log.id) ?? {}), [entry.question.key]: record });
  };
  const release = (entry: Entry) => released.set(entry.log.id, new Set([...(released.get(entry.log.id) ?? []), entry.question.key]));

  bySubject.forEach(group => {
    const byIdentity = new Map<string, Entry[]>();
    group.forEach((log, order) => {
      const schedules = getReviewQuestionSchedules(log);
      const questions = withLogShorthand(log, () => questionsOf(log.reviewMemo ?? ''));
      const keys = new Set(questions.map(question => question.key));
      // 문제가 노트에서 없어졌으면 그 문제에 붙은 겹침 기록도 푼다
      Object.entries(log.reviewRemoved ?? {}).forEach(([key, record]) => {
        if (record.reason === 'duplicate' && !keys.has(key)) released.set(log.id, new Set([...(released.get(log.id) ?? []), key]));
      });
      questions.forEach(question => {
        const record = log.reviewRemoved?.[question.key];
        if (record && record.reason !== 'duplicate') return;
        const schedule = schedules[question.key];
        const entry: Entry = { log, question, order, duplicate: record?.reason === 'duplicate',
          interval: questionIntervalMs(log, schedule), due: Date.parse(schedule?.nextReviewDate || log.nextReviewDate || '') || 0 };
        const id = identityOf(question);
        byIdentity.set(id, [...(byIdentity.get(id) ?? []), entry]);
      });
    });
    byIdentity.forEach(entries => {
      const active = entries.filter(entry => !entry.duplicate);
      if (active.length >= 2) {
        const keeper = [...active].sort(shorter)[0];
        active.forEach(entry => { if (entry !== keeper) addRemoval(entry); });
      } else if (!active.length) {
        // 남은 쪽이 사라졌다: 뺀 것 가운데 주기가 가장 짧은 하나가 다시 나온다
        release([...entries].sort(shorter)[0]);
      }
    });
  });

  if (!added.size && !released.size) return logs;
  return logs.map(log => {
    let next = log;
    const addition = added.get(log.id);
    if (addition) next = applyReviewRemoval(next, { removed: addition });
    const freed = released.get(log.id);
    if (freed) {
      const rest = { ...next.reviewRemoved };
      let changed = false;
      freed.forEach(key => { if (rest[key]?.reason === 'duplicate' && !(addition && key in addition)) { delete rest[key]; changed = true; } });
      if (changed) next = { ...next, reviewRemoved: Object.keys(rest).length ? rest : undefined };
    }
    return next;
  });
};
