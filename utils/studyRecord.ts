import type { StudyLog, Subject } from '../types';
import { getLocalDateKey, getLogProgressPages, getLogStudyDate, parseStudyDate } from './schedule';
import { INITIAL_REVIEW_DELAY_MS } from './review';
import { registrationBoundaries, unitIndexAt } from './reviewUnits';

/**
 * 12일 "각 과목마다 학습 기록 보기": 날짜마다 그날 한 페이지들과 그 기록이 든 단위, 그리고 그 기록의 복습이
 * 며칠 뒤 오늘 할 일로 나오는지. 복습에 안 들어가 있는 기록은 "복습하기"로 바로 넣는다.
 */
export type RecordReviewState =
  /** 복습에 들어가 있다: 다음 복습이 오늘 할 일에 나오는 때(days ≤ 0이면 이미 나와 있다) */
  | { kind: 'scheduled'; nextAt: number; days: number; stage: 'basic' | 'subject' }
  /** 기본 복습만 뺐다(복습과목은 한다) */
  | { kind: 'basicSkipped'; nextAt: number | null; days: number | null }
  /** "복습에 넣기"를 기다린다 */
  | { kind: 'pending' }
  /** 자동 복습으로 공부 시간을 모으는 중 */
  | { kind: 'waiting' }
  /** 복습 제외로 저장했다 */
  | { kind: 'excluded' }
  /** 복습을 모두 마쳤다 */
  | { kind: 'done' };

export interface StudyRecordRow {
  log: StudyLog;
  /** 진척으로 센 장수 */
  pages: number;
  start?: number;
  end?: number;
  /** 단위 번호(1부터) */
  unit: number;
  /** 아직 복습에 넣지 않은, 지금 채우는 단위 */
  currentUnit: boolean;
  state: RecordReviewState;
}

export interface StudyRecordDay {
  date: string;
  pages: number;
  minutes: number;
  rows: StudyRecordRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 오늘(로컬 날짜)부터 그때(로컬 날짜)까지 며칠 */
export const daysUntil = (atMs: number, nowMs: number) =>
  Math.round((parseStudyDate(getLocalDateKey(new Date(atMs))).getTime() - parseStudyDate(getLocalDateKey(new Date(nowMs))).getTime()) / DAY_MS);

const isStudyRecord = (log: StudyLog) => !log.isRepeatReview && !log.reviewParentSubjectId;

export const recordReviewState = (log: StudyLog, nowMs: number): RecordReviewState => {
  if (log.unitReviewPending) return log.autoReviewWaiting || log.autoReviewQueued ? { kind: 'waiting' } : { kind: 'pending' };
  if (log.reviewEnabled === false || log.isCondensed) return log.isReviewed ? { kind: 'done' } : { kind: 'excluded' };
  const next = log.nextReviewDate ? Date.parse(log.nextReviewDate) : NaN;
  if (log.basicReviewSkipped) return { kind: 'basicSkipped', nextAt: Number.isFinite(next) ? next : null, days: Number.isFinite(next) ? daysUntil(next, nowMs) : null };
  if (!Number.isFinite(next)) return { kind: 'done' };
  // 기본 복습을 마치고 복습과목으로 넘어간 기록(복습과목 차례)
  const stage = log.reviewSubjectId && log.reviewSubjectId !== log.subjectId ? 'subject' : 'basic';
  return { kind: 'scheduled', nextAt: next, days: daysUntil(next, nowMs), stage };
};

/** "복습하기"를 보여 줄 기록: 기본 복습이 들어가 있지 않은 기록 */
export const canAddToReview = (state: RecordReviewState) =>
  state.kind === 'pending' || state.kind === 'waiting' || state.kind === 'excluded' || state.kind === 'basicSkipped';

/**
 * "복습하기": 그 기록을 바로 복습에 넣는다. 처음 복습은 복습에 넣을 때처럼 2시간 뒤다(이미 복습과목 일정이 있는 기본 복습만 뺀 기록은 그 일정 그대로).
 * 단위는 바꾸지 않는다: 넣은 때(reviewRegisteredAt)를 새로 적지 않아 그 기록은 원래 공부한 때의 단위에 남고, 단위 경계도 생기지 않는다.
 */
export const addLogToReview = (log: StudyLog, nowMs: number): StudyLog => {
  const keepSchedule = log.basicReviewSkipped && !log.unitReviewPending && log.reviewEnabled !== false && !log.isCondensed && Boolean(log.nextReviewDate);
  return {
    ...log,
    unitReviewPending: undefined,
    autoReviewWaiting: undefined,
    autoReviewQueued: undefined,
    autoReviewCut: undefined,
    autoReviewAsk: undefined,
    basicReviewSkipped: undefined,
    reviewEnabled: true,
    isCondensed: false,
    isReviewed: false,
    reviewStep: keepSchedule ? log.reviewStep : 0,
    nextReviewDate: keepSchedule ? log.nextReviewDate : new Date(nowMs + INITIAL_REVIEW_DELAY_MS).toISOString()
  };
};

/** 과목의 공부 기록을 날짜별로(최근 날짜부터, 한 날 안에서는 먼저 한 것부터) */
export const buildStudyRecord = (subject: Pick<Subject, 'id'>, logs: readonly StudyLog[], nowMs: number): StudyRecordDay[] => {
  const own = logs.filter(log => log.subjectId === subject.id && isStudyRecord(log));
  const boundaries = registrationBoundaries(own);
  const byDate = new Map<string, StudyRecordRow[]>();
  [...own].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).forEach(log => {
    // 정리노트의 단위와 같은 셈(noteUnits.groupLogsByReviewUnit): 넣은 기록은 넣은 때의 단위, 기다리는 기록은 지금 단위
    const registered = log.reviewRegisteredAt ? Date.parse(log.reviewRegisteredAt) : NaN;
    const index = unitIndexAt(log.unitReviewPending ? Infinity : Number.isFinite(registered) ? registered : Date.parse(log.timestamp), boundaries);
    const row: StudyRecordRow = {
      log,
      pages: getLogProgressPages(log),
      ...(Number.isFinite(log.startPage) ? { start: log.startPage } : {}),
      ...(Number.isFinite(log.endPage) ? { end: log.endPage } : {}),
      unit: index + 1,
      currentUnit: index >= boundaries.length,
      state: recordReviewState(log, nowMs)
    };
    const date = getLogStudyDate(log);
    byDate.set(date, [...(byDate.get(date) ?? []), row]);
  });
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, rows]) => ({
      date,
      rows,
      pages: rows.reduce((sum, row) => sum + row.pages, 0),
      minutes: rows.reduce((sum, row) => sum + (Number(row.log.timeSpentMinutes) || 0), 0)
    }));
};
