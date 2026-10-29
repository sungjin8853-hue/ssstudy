import { formatDoneMinutes } from '../utils/studyReport';
import { registrationBoundaries, reviewCompletionBoundaries } from '../utils/reviewUnits';
import React, { useEffect, useMemo, useState } from 'react';
import { StudyLog, Subject, ReviewMemoDocument } from '../types';
import { calculateBasicReviewEfficiencyByNumber, calculateRecentTimedPageAverage, calculateReviewChangeAmounts, calculateStats, getReviewSpeedSeries, calculateSubjectReviewAverageTimePerPage, calculateTimeAttackAverage, getReviewEfficiencySamples } from '../utils/math';
import { BASIC_REVIEW_DETAIL_PREFIX, carriedReviewState, getRepeatedReviewRange, getReviewStartPage } from '../utils/review';
import { getMeasurementRemainingPages, getPomodoroPageTarget, getRemainingPomodoroSessions, getReviewPomodoro, PomodoroPlan } from '../utils/measurement';
import { PomodoroMinutesStepper } from './PomodoroMinutesStepper';
import { usePomodoroMinutes } from '../utils/pomodoroSetting';
import {
  getActiveSubjectStage,
  getAllSubjectReviewIds,
  getLocalDateKey,
  getLogStudyDate,
  getRecommendedEndPage,
  getStageChapters,
  isSubjectRequiredNow,
  getSubjectStages,
  getSubjectRemainingPageCount,
  normalizeWeekdays,
  parseStudyDate
} from '../utils/schedule';
import { endPageForSolved, getSubjectChapters, pagesBetween } from '../utils/subjectChapters';
import { readSessionMemos, writeSessionMemo } from '../utils/sessionMemo';
import { ReviewMemoEditor } from './ReviewMemoEditor';
import { ReviewSpeedGrowthCell, SpeedGraph, UnitGrowthEfficiency } from './PageGrowth';
import { describeGrowthChange, describeSpeed, getEfficiencyScope, getEfficiencyView, pagesPerReferenceTime, toGrowthChange } from '../utils/pageGrowth';
import { DEFAULT_PAGE_LABEL, getPageLabel, pagePositionLabel, pageWord } from '../utils/pageLabel';
import { getSubjectChain, getSubjectFamily, hasSubjectChain, isFamilyStudyLog, SubjectFamily } from '../utils/subjectChain';
import { estimateSubjectEndDate, formatShortEndDate } from '../utils/completionEstimate';
import { DoneStartButton, HelpPopover, IdleSummaryContext, LaterMembersStrip, MemberChooser, ReviewPlanContext, ReviewScopeStrip, StartButton, TINTED_HELP_BUTTON } from './TodayTasks';
import { NoteSheet } from './NoteSheet';
import { EfficiencyBoxes } from './EfficiencyBoxes';
import { MeasurementTutorial } from './Tutorials';
import { RegisterReviewDialog } from './RegisterReviewDialog';
import { pendingFeedbackOf } from '../utils/subjectFeedback';
import type { SubjectGrade } from '../utils/subjectFeedback';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  detailSubjectId: string;
  onDetailSubjectChange: (subjectId: string) => void;
  taskSelector: React.ReactNode;
  /** 주면 오늘 끝낸 과목 카드의 "추가 학습하기" 위에 "학습 설정 가기" 버튼이 생긴다. 과목 id(복습과목이면 붙어 있는 학습과목)를 넘긴다 */
  onOpenSettings?: (subjectId: string) => void;
  completedStudySubjectIds?: string[];
  pomodoroPlan?: PomodoroPlan | null;
  /** 학습 실행 첫 화면에서만 넘어온다: 요약 칸, 시작 버튼, 복습 순서 */
  idle?: IdleSummaryContext;
  /** 주면 학습 실행 첫 화면 위쪽에 "정리노트" 버튼이 생기고, 누르면 정리노트 시트가 열린다 */
  onUpdateReviewMemo?: (logId: string, memo: string, document?: ReviewMemoDocument) => void;
  onRestoreReviewQuestion?: (logId: string, questionKey: string) => void;
  onSkipEditIntake?: (logIds: string[]) => void;
  /** 주면 복습을 기다리는 기록이 있는 학습과목 위쪽에 "복습에 넣기" 버튼이 생긴다. 누르면 난도를 고르는 창이 뜨고, 난도를 고르면 그 과목의 대기 기록이 모두 그 난도로 복습에 들어간다 */
  onRegisterReview?: (subjectId: string, grade: SubjectGrade) => void;
  activeWeekday: number;
  activeStudyDate: string;
  onAddLog: (log: StudyLog) => void;
  onReplaceLogs: (logIds: string[], replacementLog: StudyLog) => void;
  onDeleteLogs: (logIds: string[]) => void;
}

type ModalMode = 'add' | 'edit';

interface SubjectSummary {
  recordKey: string;
  subjectId: string;
  detailId: string;
  kind: 'study' | 'review';
  name: string;
  pages: number;
  minutes: number;
  /** 이 과목(지금 공부 중인 단계)과 그 단계에 붙은 복습과목을 합친 최근 7일 공부 시간(분). 후행과목은 세지 않는다 */
  relatedWeeklyMinutes: number;
  /** 하루 평균을 낼 날 수: 이 묶음을 처음 공부한 날부터 오늘까지(최대 7일) */
  relatedDays: number;
  /** 이 기록이 속한 단계 id(기록에 남은 값). 하루 평균을 어느 단계 기준으로 낼지 정한다 */
  stageHint?: string;
  startPage: number;
  endPage: number;
  latestTimestamp: string;
  logs: StudyLog[];
  reviewSpeedChangePercent: number | null;
  reviewBaselineMinutes: number;
  reviewHasBaseline: boolean;
}

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
};

/** 단원이 있는 과목의 본 과목 범위 기록은 단원 사이를 건너뛴 만큼 뺀 장수로 센다 */
/**
 * 학습량 추가·고치기 창의 끝 페이지가 들어갈 단계와 그 단계의 단원. 고치는 기록은 그 기록의 단계, 새 기록은 지금 단계를 쓴다.
 * 측정해서 저장할 때와 같이 끝 페이지는 그 단계의 마지막 페이지를 넘을 수 없고, 단원이 있으면 단원 안 페이지여야 한다.
 */
export const editRangeOf = (subject: Subject | undefined, stageId: string | undefined, end: number) => {
  if (!subject) return { chapters: [] as ReturnType<typeof getSubjectChapters>, valid: false };
  const stages = getSubjectStages(subject);
  const stage = stages.find(item => item.id === stageId) || getActiveSubjectStage(subject) || stages[stages.length - 1];
  const chapters = getStageChapters(subject, stage);
  const lastPage = stage?.endPage ?? subject.totalPages;
  const valid = end <= lastPage && (chapters.length === 0 || chapters.some(item => end >= item.startPage && end <= item.endPage));
  return { chapters, valid };
};

const calculateAmountFromEndPage = (start: number, end: number) => {
  const amount = Number.isInteger(start) && Number.isInteger(end)
    ? end - start + 1
    : end - start;
  return Number(amount.toFixed(2));
};

export const buildCompletedSubjectSummaries = (
  logs: StudyLog[], subjects: Subject[], completedStudySubjectIds: string[], studyDate: string
): SubjectSummary[] => {
  const completedIds = new Set(completedStudySubjectIds);
  const weekStart = parseStudyDate(studyDate);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartKey = getLocalDateKey(weekStart);
  const groups = new Map<string, SubjectSummary>();
  const pomodoroLogs = new Map(logs.filter(log => log.pomodoroSession).map(log => [log.id, log]));
  const reviewRecords = logs.flatMap(log => log.reviewSubjectTimeRecords || []);
  const representedBySessions = (record: typeof reviewRecords[number]) => (
    (record.includedMeasurementIds || [record.measurementId || '']).every(id => pomodoroLogs.has(id))
  );
  const aggregateReviewIds = new Set(reviewRecords.filter(record => !representedBySessions(record))
    .flatMap(record => record.includedMeasurementIds || [record.measurementId || '']));
  const add = (subjectId: string, kind: 'study' | 'review', detailId: string, name: string,
    pages: number, minutes: number, timestamp: string, log?: StudyLog,
    recordKey = detailId, baselineTimePerPage?: number, stageHint?: string) => {
    const summary = groups.get(recordKey) || {
      recordKey, subjectId, detailId, kind, name, pages: 0, minutes: 0, relatedWeeklyMinutes: 0, relatedDays: 7,
      startPage: 0, endPage: 0, latestTimestamp: timestamp, logs: [],
      reviewSpeedChangePercent: null, reviewBaselineMinutes: 0, reviewHasBaseline: true, stageHint
    };
    if (stageHint && timestamp >= summary.latestTimestamp) summary.stageHint = stageHint;
    // 같은 날 본 과목을 끝내고 후행과목을 이어 했으면 가장 나중에 한 단계의 이름으로 부른다
    if (kind === 'study' && timestamp >= summary.latestTimestamp) summary.name = name;
    summary.pages += pages;
    summary.minutes += minutes;
    if (kind === 'review') {
      summary.reviewBaselineMinutes += pages * (baselineTimePerPage || 0);
      summary.reviewHasBaseline &&= (baselineTimePerPage || 0) > 0;
      summary.reviewSpeedChangePercent = summary.reviewHasBaseline && summary.minutes > 0
        ? (summary.reviewBaselineMinutes / summary.minutes - 1) * 100 : null;
    }
    if (log) {
      summary.startPage = Math.min(summary.startPage || log.startPage || 0, log.startPage || summary.startPage);
      summary.endPage = Math.max(summary.endPage, log.endPage || 0);
      summary.logs.push(log);
    }
    if (timestamp > summary.latestTimestamp) summary.latestTimestamp = timestamp;
    groups.set(recordKey, summary);
  };
  const nameOf = (id: string, log: StudyLog) => subjects.find(subject => subject.id === id)?.name
    || log.subjectNameSnapshot || '삭제된 과목';
  /** 공부 기록의 이름: 후행과목 단계에서 한 공부면 그 후행과목 이름 */
  const studyNameOf = (log: StudyLog) => {
    if (log.subjectStageId && log.subjectStageId !== log.subjectId) {
      const stage = subjects.find(subject => subject.id === log.subjectId)?.followUpSubjects?.find(item => item.id === log.subjectStageId);
      if (stage?.name || log.subjectStageNameSnapshot) return stage?.name || log.subjectStageNameSnapshot!;
    }
    return nameOf(log.subjectId, log);
  };

  logs.forEach(log => {
    // 직접 넣은 기록(manualEntry)은 과목을 다 끝내지 않았어도 보인다(28일 버그: 학습량 변경으로 추가한 기록이 창에 안 보이던 것)
    if (!log.reviewParentSubjectId && (completedIds.has(log.subjectId) || log.pomodoroSession || log.manualEntry)
      && getLogStudyDate(log) === studyDate && log.pagesRead > 0) {
      add(log.subjectId, 'study', log.subjectId, studyNameOf(log), log.pagesRead, log.timeSpentMinutes, log.timestamp, log,
        log.pomodoroSession ? `${log.subjectId}:pomodoro:${log.id}` : completedIds.has(log.subjectId) ? log.subjectId : `${log.subjectId}:manual:${log.id}`,
        undefined, log.subjectStageId || log.subjectId);
    }
    if (log.pomodoroSession && log.reviewParentSubjectId && !aggregateReviewIds.has(log.id)
      && getLogStudyDate(log) === studyDate && log.pagesRead > 0) {
      const allocated = reviewRecords.filter(record => record.measurementId === log.id);
      const allocatedPages = allocated.reduce((sum, record) => sum + record.pages, 0);
      const baseline = log.reviewBaselineTimePerPage ?? (allocatedPages > 0
        ? allocated.reduce((sum, record) => sum + record.pages * (record.baselineTimePerPage || 0), 0) / allocatedPages : 0);
      add(log.subjectId, 'review', log.subjectId, `${nameOf(log.subjectId, log)} · 복습`, log.pagesRead,
        log.timeSpentMinutes, log.timestamp, undefined, `${log.subjectId}:${log.id}`, baseline, log.subjectStageId);
    }
    (log.basicReviewTimeRecords || []).forEach(record => {
      if (getLocalDateKey(new Date(record.timestamp)) === studyDate && record.pages > 0) {
        const detailId = `${BASIC_REVIEW_DETAIL_PREFIX}${log.subjectId}`;
        add(log.subjectId, 'review', detailId, `${nameOf(log.subjectId, log)} · 기본 복습`, record.pages, record.minutes, record.timestamp,
          undefined, `${detailId}:${record.timestamp}`, undefined, log.subjectStageId || log.subjectId);
      }
    });
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (!representedBySessions(record) && (record.completed || pomodoroLogs.has(record.measurementId || ''))
        && getLocalDateKey(new Date(record.timestamp)) === studyDate && record.pages > 0) {
        add(record.subjectId, 'review', record.subjectId, `${nameOf(record.subjectId, log)} · 복습`, record.pages, record.minutes, record.timestamp,
          undefined, `${record.subjectId}:${record.measurementId || record.timestamp}`, record.baselineTimePerPage, log.subjectStageId);
      }
    });
  });

  // 최근 7일(오늘 포함) 공부 시간: 지금 공부 중인 단계(과목 자신)와 그 단계에 붙은 복습과목(기본 복습 포함)만 합친다.
  // 후행과목은 앞 단계를 모두 끝낸 다음날부터 시작하므로 같이 세지 않는다.
  const inWindow = (date: string) => date >= weekStartKey && date <= studyDate;
  // 처음 공부한 날도 함께 찾는다: 7일이 차지 않았으면 그날부터 오늘까지의 날 수로 나눈다
  const relatedWeeklyMinutesOf = (family: SubjectFamily) => {
    let total = 0;
    let firstDate = studyDate;
    const count = (date: string, minutes: number) => {
      if (date <= studyDate && date < firstDate) firstDate = date;
      if (inWindow(date)) total += Math.max(0, minutes);
    };
    logs.forEach(log => {
      if (!log.reviewParentSubjectId) {
        if (isFamilyStudyLog(family, log)) count(getLogStudyDate(log), log.timeSpentMinutes);
      } else if (log.pomodoroSession && !aggregateReviewIds.has(log.id)) {
        if (family.reviewIds.has(log.subjectId)) count(getLogStudyDate(log), log.timeSpentMinutes);
      }
      (log.basicReviewTimeRecords || []).forEach(record => {
        if (isFamilyStudyLog(family, log)) count(getLocalDateKey(new Date(record.timestamp)), record.minutes);
      });
      (log.reviewSubjectTimeRecords || []).forEach(record => {
        if (representedBySessions(record)) return;
        if (family.reviewIds.has(record.subjectId)) count(getLocalDateKey(new Date(record.timestamp)), record.minutes);
      });
    });
    const days = firstDate >= weekStartKey
      ? Math.round((parseStudyDate(studyDate).getTime() - parseStudyDate(firstDate).getTime()) / 86400000) + 1 : 7;
    return { total, days: Math.min(7, Math.max(1, days)) };
  };
  const familyMinutes = new Map<string, { total: number; days: number }>();
  groups.forEach(summary => {
    const family = getSubjectFamily(subjects, summary.subjectId, summary.stageHint);
    const key = `${family.ownerId}:${family.stageId}`;
    if (!familyMinutes.has(key)) familyMinutes.set(key, relatedWeeklyMinutesOf(family));
    summary.relatedWeeklyMinutes = familyMinutes.get(key)?.total || 0;
    summary.relatedDays = familyMinutes.get(key)?.days || 7;
  });
  return [...groups.values()].sort((a, b) => b.latestTimestamp.localeCompare(a.latestTimestamp));
};

export interface CompletedDetailRow {
  detailId: string;
  kind: 'study' | 'review';
  kindLabel: string;
  title: string;
  pages: number;
  minutes: number;
  latestTimestamp: string;
  /** 오늘 끝낸 만큼의 한 줄 요약. 예: "10P · 42분 · 4.2분/P" */
  summary: string;
  /** 작은 셀에 쓰는 더 짧은 요약. 예: "10P · 42분" */
  short: string;
  /** 복습에서만: "이번 복습 속도 +x%" 또는 "페이지 단위 공부량 +x%" 같은 한 줄. 없으면 null */
  growth: string | null;
  /** 이 과목(지금 공부 중인 단계)과 그 복습과목을 합친 하루 평균 공부 시간(분): 최근 7일 합계 ÷ 7(처음 공부한 지 7일이 안 됐으면 그날부터의 날 수). 후행과목은 뺀다 */
  dailyAverageMinutes: number;
  /** 이 과목이 "페이지"를 부르는 글자(기본 P) */
  pageLabel: string;
}

/**
 * 오늘 끝낸 기록을 과목(상세 키)별로 한 줄씩 합친다. 같은 과목을 여러 번 했으면 합계로 보여준다.
 * 복습의 증가율(이번 복습·페이지 단위)은 속도가 오르면 "속도 +x%", 내리면 "공부량 +x%"로 보여준다.
 */
export const buildCompletedDetailRows = (
  logs: StudyLog[], subjects: Subject[], completedStudySubjectIds: string[], studyDate: string
): CompletedDetailRow[] => {
  const summaries = buildCompletedSubjectSummaries(logs, subjects, completedStudySubjectIds, studyDate);
  const owners = new Map<string, Subject>();
  subjects.forEach(subject => getAllSubjectReviewIds(subject).forEach(id => { if (!owners.has(id)) owners.set(id, subject); }));
  const byDetail = new Map<string, SubjectSummary[]>();
  summaries.forEach(summary => byDetail.set(summary.detailId, [...(byDetail.get(summary.detailId) || []), summary]));
  return Array.from(byDetail.entries()).map(([detailId, group]) => {
    const latest = group.reduce((a, b) => (b.latestTimestamp > a.latestTimestamp ? b : a));
    const pages = group.reduce((sum, item) => sum + item.pages, 0);
    const minutes = group.reduce((sum, item) => sum + item.minutes, 0);
    const kind = latest.kind;
    const isBasic = detailId.startsWith(BASIC_REVIEW_DETAIL_PREFIX);
    const title = latest.name.replace(/ · (기본 )?복습$/, '');
    let growth: string | null = null;
    const subject = subjects.find(item => item.id === latest.subjectId);
    const label = getPageLabel(subject);
    if (kind === 'review' && !isBasic) {
      // 복습과목도 기본은 단위(복습 한 번) 비교다. '이번 복습' 비율은 직접 고른 과목만
      if (subject?.reviewGrowthDisplay !== 'review') {
        const owner = owners.get(latest.subjectId);
        const growthLogs = owner
          ? getReviewEfficiencySamples(logs, owner.id, latest.subjectId).map((sample, index) => ({ ...sample, id: `completed-growth-${index}`, subjectId: latest.subjectId }))
          : logs;
        // 복습과목의 단위는 복습 한 번(그 복습과목을 마친 때까지)
        const scope = getEfficiencyScope(growthLogs.filter(log => log.timestamp <= latest.latestTimestamp),
          owner ? reviewCompletionBoundaries(logs, owner.id, latest.subjectId) : []);
        const described = describeGrowthChange(getEfficiencyView(scope, { kind: 'unit', n: 1 }).overall, false, label);
        growth = described ? `이전 단위 대비 ${described}` : null;
      } else if (latest.reviewSpeedChangePercent !== null) {
        // 기준 장당 시간(합계 ÷ 장수)과 이번 장당 시간으로 속도·공부량의 차이를 정수로 보여준다.
        const described = describeGrowthChange(latest.pages > 0 && latest.minutes > 0
          ? toGrowthChange(latest.reviewBaselineMinutes / latest.pages, latest.minutes / latest.pages) : null, false, label);
        growth = described ? `이번 복습 ${described}` : null;
      }
    }
    return {
      detailId, kind,
      kindLabel: kind === 'study' ? '학습' : isBasic ? '기본 복습' : '과목 복습',
      title, pages, minutes, latestTimestamp: latest.latestTimestamp,
      short: `${formatNumber(pages)}${label} · ${formatDoneMinutes(minutes)}`,
      summary: `${formatNumber(pages)}${label} · ${formatDoneMinutes(minutes)}${pages > 0 && minutes > 0 ? ` · ${formatNumber(Number((minutes / pages).toFixed(1)))}분/${label}` : ''}`,
      growth,
      // 같은 과목의 기록은 모두 같은 묶음 합계를 들고 있으므로 가장 큰 값을 쓴다. 공부하지 않은 날도 하루로 센다(÷ 7).
      // 처음 공부한 지 7일이 안 됐으면 그날부터 오늘까지의 날 수로 나눈다(오늘 처음이면 ÷ 1)
      dailyAverageMinutes: Number((Math.max(...group.map(item => item.relatedWeeklyMinutes))
        / Math.max(1, Math.min(...group.map(item => item.relatedDays)))).toFixed(1)),
      pageLabel: label
    };
  }).sort((a, b) => b.latestTimestamp.localeCompare(a.latestTimestamp));
};

const EMPTY_SUBJECT_IDS: string[] = [];

/** 공부 시작 칸의 "풀이 절차". 복습과목은 먼저 정리노트 문제로 기억을 확인하고(복습 관문), 이어서 학습과 같은 측정 단계를 밟는다. */
const STUDY_STEP_LABELS = ['타임어택 풀이', '막힌 부분 정리', '기록 저장'];
const REVIEW_STEP_LABELS = ['노트 확인', '복습 풀이', '막힌 부분 정리', '기록 저장'];

const PomodoroStat: React.FC<{ label: string; value: string; unit: string; adjust?: React.ReactNode }> = ({ label, value, unit, adjust }) => (
  <div className="flex min-w-0 flex-[1_1_auto] flex-col border-l border-slate-200 pl-4 first:border-l-0 first:pl-0">
    <span className="text-[15px] font-bold text-slate-600">{label}</span>
    <span className="flex items-center gap-2">
      <span className="whitespace-nowrap font-mono text-[34px] font-black leading-[1.15] tabular-nums text-slate-900 sm:text-[40px] md:text-[44px]">
        {value}<span className="ml-1 text-xl font-semibold text-slate-500">{unit}</span>
      </span>
      {adjust}
    </span>
  </div>
);

/**
 * 오늘 할 양을 모두 끝낸 과목의 "성장" 칸 오른쪽에 들어가는 세 가지:
 * 한 일(학습량·걸린 시간·페이지당) · 최근 하루 평균 공부 시간 · "추가 학습하기"(맨 아래).
 * bottom을 주면 그 자리에 그것을 놓는다(추가 학습을 못 하는 줄은 눌러지지 않는 "오늘 학습 완료").
 */
export const DoneSummary: React.FC<{
  row: CompletedDetailRow;
  onExtraStudy?: () => void;
  bottom?: React.ReactNode;
  /** 주면 "추가 학습하기" 바로 위에 학습 설정으로 가는 버튼이 생긴다 */
  onOpenSettings?: () => void;
}> = ({ row, onExtraStudy, bottom, onOpenSettings }) => {
  const perPage = row.pages > 0 && row.minutes > 0 ? formatNumber(Number((row.minutes / row.pages).toFixed(1))) : '-';
  // 하루 평균 = 이 과목과 이어진 과목(후행·복습)을 모두 합친 최근 7일 ÷ 7. 합계 글자는 따로 보여주지 않는다.
  const dailyAverage = formatNumber(row.dailyAverageMinutes);
  const isReview = row.kind === 'review';
  const label = row.pageLabel ?? DEFAULT_PAGE_LABEL;
  return (
    <div data-testid="done-summary" className="flex h-full flex-col divide-y divide-green-300 [&>*]:py-3 [&>*:first-child]:pt-1">
      <div className="flex">
        <DoneStat label={isReview ? '복습량' : '학습량'} value={formatNumber(row.pages)} unit={label} />
        {/* 1분이 안 되면 "1분 미만", 그 밖은 정수 분(초에서 온 소수를 버린다) */}
        <DoneStat label="걸린 시간" value={row.minutes > 0 && row.minutes < 1 ? '1분 미만' : String(Math.round(Math.max(0, row.minutes)))} unit={row.minutes > 0 && row.minutes < 1 ? '' : '분'} />
        <DoneStat label={`${pageWord(label)}당`} value={perPage} unit={`분/${label}`} />
      </div>
      <div data-testid="daily-average" className="flex flex-col">
        <span className="text-base font-black text-slate-800">최근 하루 평균 공부 시간</span>
        <span className="whitespace-nowrap font-mono text-[40px] font-black leading-[1.15] tabular-nums text-slate-900">
          {dailyAverage}<span className="ml-1 text-xl font-semibold text-slate-500">분</span>
        </span>
      </div>
      <div className="mt-auto flex flex-col gap-2.5 !border-t-0 !pt-4">
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} data-testid="open-settings"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-indigo-400 bg-indigo-100 text-base font-black text-indigo-900 transition-colors hover:bg-indigo-200">
            <span aria-hidden="true">⚙️</span>학습 설정 가기<span aria-hidden="true" className="text-lg leading-none">›</span>
          </button>
        )}
        {bottom ?? (onExtraStudy ? (
          <button type="button" onClick={onExtraStudy} data-testid="extra-study"
            className={`flex h-[68px] w-full items-center justify-center gap-2 rounded-2xl border-2 text-xl font-black shadow-sm transition-colors ${isReview
              ? 'border-amber-800 bg-amber-700 text-white hover:bg-amber-800' : 'border-indigo-700 bg-indigo-600 text-white hover:bg-indigo-700'}`}>
            <span aria-hidden="true" className="text-2xl leading-none">+</span>추가 학습하기
          </button>
        ) : isReview ? (
          // 복습은 버튼이 늘 있다. 앞당겨 할 다음 복습이 없을 때만 눌러지지 않고 이유를 적어 둔다.
          <div className="flex flex-col gap-1.5">
            <button type="button" disabled data-testid="extra-study"
              className="flex h-[68px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-slate-100 text-xl font-black text-slate-500">
              <span aria-hidden="true" className="text-2xl leading-none">+</span>추가 학습하기
            </button>
            <p className="text-center text-sm font-bold text-slate-600">앞당겨 할 복습이 없어요</p>
          </div>
        ) : null)}
      </div>
    </div>
  );
};

const DoneStat: React.FC<{ label: string; value: string; unit: string }> = ({ label, value, unit }) => (
  <div className="flex min-w-0 flex-1 flex-col border-l border-green-300 pl-3 first:border-l-0 first:pl-0">
    <span className="text-[13px] font-bold text-slate-600">{label}</span>
    <span className="whitespace-nowrap font-mono text-[30px] font-black leading-[1.15] tabular-nums text-slate-900">
      {value}<span className="ml-0.5 text-base font-semibold text-slate-500">{unit}</span>
    </span>
  </div>
);

/** 두 큰 칸의 제목 줄: "공부 시작" / "성장" */
const CellTitle: React.FC<{ children: React.ReactNode; endLabel?: string | null; nextChapterLabel?: string | null; badges?: React.ReactNode }> = ({ children, endLabel, nextChapterLabel, badges }) => (
  <h3 data-testid="cell-title" className="mb-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[22px] font-black leading-tight text-slate-900">
    {children}
    {badges && <span data-testid="cell-badges" className="flex items-center gap-1.5 self-center">{badges}</span>}
    {endLabel && <span data-testid="end-date" title="이 과목이 끝날 것으로 예상되는 날" className="font-mono text-lg font-bold tabular-nums text-slate-600">{endLabel}</span>}
    {nextChapterLabel && <span data-testid="next-chapter-page" title="다음 단원이 시작하는 페이지" className="font-mono text-lg font-bold tabular-nums text-amber-700">{nextChapterLabel}</span>}
  </h3>
);

/**
 * 오른쪽 "성장" 칸: 학습 진척도(growthTop) · 전체 효율 · 타임어택 효율 · 다음 단위까지(efficiencySlot) · 복습 증가율(growth).
 * 오늘 할 양을 끝낸 과목(done)에서는 이 칸 하나가 가로로 넓어져 왼쪽에 위 내용이, 오른쪽에 DoneSummary가 들어가고,
 * 칸 전체가 연한 초록으로 바뀐다. main을 주면 위 내용 대신 그것을 놓는다(기본 복습 차트).
 */
export const GrowthCell: React.FC<{
  efficiency?: number; attackEfficiency?: number;
  growthTop?: React.ReactNode; efficiencySlot?: React.ReactNode; growth?: React.ReactNode;
  main?: React.ReactNode;
  done?: React.ReactNode;
  /** 과목이 "페이지"를 부르는 글자(기본 P) */
  label?: string;
}> = ({ efficiency, attackEfficiency, growthTop, efficiencySlot, growth, main, done, label = DEFAULT_PAGE_LABEL }) => {
  const divide = done ? 'divide-green-300' : 'divide-slate-300';
  return (
    <section aria-label="성장" data-testid={done ? 'done-layout' : undefined} data-done={done ? 'true' : undefined}
      className={`flex min-w-0 flex-col rounded-2xl border-2 ${done
        ? 'border-green-500 bg-[#d0f9de]'
        : 'border-slate-500 bg-white'} px-5 pb-1.5 pt-3.5`}>
      <CellTitle>{done ? <span className="text-green-900">성장</span> : '성장'}</CellTitle>
      <div className={done ? 'grid flex-1 gap-x-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : 'flex flex-1 flex-col'}>
        <div className={`flex min-w-0 flex-1 flex-col divide-y ${divide} [&>*]:py-3 [&>*:first-child]:pt-1`}>
          {main ?? <>
            {growthTop}
            {efficiencySlot ?? <EfficiencyBoxes efficiency={efficiency} attackEfficiency={attackEfficiency} label={label} done={Boolean(done)} />}
            {/* 증가율 방식은 줄이 몇 개 안 되어, 왼쪽 칸이 길어지면 남는 높이의 가운데에 둔다 */}
            {growth && <div className="flex flex-1 flex-col justify-center">{growth}</div>}
          </>}
        </div>
        {done && <div className="min-w-0 border-t border-green-300 pb-3 lg:border-l lg:border-t-0 lg:pl-6">{done}</div>}
      </div>
    </section>
  );
};

/**
 * 선택한 할 일의 상세를 큰 칸 두 개로 나눈다.
 *  - 왼쪽 "공부 시작": 시작 페이지(top) · 뽀모도로 · 풀이 절차(side) · 학습/복습 시작 버튼(start, 맨 아래)
 *  - 오른쪽 "성장": 학습 진척도(growthTop) · 전체 효율 · 타임어택 효율 · 다음 단위까지(efficiencySlot) · 복습 증가율(growth)
 * 칸 안은 상자 대신 가는 선으로 나눠서, 칸 수가 많아 보이지 않고 시선이 두 칸 안에서만 움직이게 한다.
 * 색은 남색 하나(강조)와 회색만 쓰고, 증가율 알약만 좋고 나쁨을 색으로 보여준다.
 */
export const PomodoroSummary: React.FC<{
  pages: number | null; efficiency?: number; attackEfficiency?: number; remainingTaskPages?: number;
  growth?: React.ReactNode; efficiencySlot?: React.ReactNode;
  /** 왼쪽 칸 맨 위: 시작 페이지 */
  top?: React.ReactNode;
  /** 왼쪽 칸 맨 아래: 풀이 절차 */
  side?: React.ReactNode;
  /** 오른쪽 칸 맨 위: 학습 진척도 */
  growthTop?: React.ReactNode;
  /** 왼쪽 칸 맨 아래: 학습 시작 / 복습 시작 버튼 */
  start?: React.ReactNode;
  /** 과목이 "페이지"를 부르는 글자(기본 P) */
  label?: string;
  /** "공부 시작" 제목 옆에 놓는 끝날 날짜. 예: "~10/25" */
  endLabel?: string | null;
  /** 끝날 날짜 옆에 놓는 다음 단원 시작 페이지(단원이 있는 과목만). 예: "다음 단원 p.20" */
  nextChapterLabel?: string | null;
  /** "공부 시작"과 끝날 날짜 사이에 놓는 분류(학습 · 복습과목)와 필수 표시 */
  badges?: React.ReactNode;
}> = ({ pages, efficiency, attackEfficiency, remainingTaskPages, growth, efficiencySlot, top, side, growthTop, start, label = DEFAULT_PAGE_LABEL, endLabel, nextChapterLabel, badges }) => {
  const [pomodoroMinutes] = usePomodoroMinutes();
  const sessions = remainingTaskPages === undefined ? null : getRemainingPomodoroSessions(remainingTaskPages, pages);
  return <div data-testid="pomodoro-growth-strip" className="grid gap-3 lg:grid-cols-2 lg:items-stretch lg:gap-4">
    <section aria-label="공부 시작" className="flex min-w-0 flex-col rounded-2xl border-2 border-slate-500 bg-white px-5 pb-1.5 pt-3.5">
      <CellTitle endLabel={endLabel} nextChapterLabel={nextChapterLabel} badges={badges}>공부 시작</CellTitle>
      <div className="flex flex-1 flex-col divide-y divide-slate-300 [&>*]:py-3 [&>*:first-child]:pt-1">
      {top}
      <div aria-label="뽀모도로" className="relative">
        <div className="flex h-8 items-center justify-between">
          <span className="flex items-center gap-2 text-base font-black text-slate-800">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /></svg>
            뽀모도로
          </span>
          <HelpPopover label="뽀모도로 설명" triggerClassName={TINTED_HELP_BUTTON}>
            <span>{pomodoroMinutes}분은 예측이에요. 끝 페이지까지 걸릴 예상 시간이 {pomodoroMinutes}분 이하가 되도록 장수를 정해요. 공부 중에는 {pomodoroMinutes}분이 지날 때마다 알람이 울려요. 옆의 ▲▼로 5분씩 바꾸면 바로 반영되고 다음 학습에도 그대로 써요.</span>
          </HelpPopover>
        </div>
        <div className="mt-1 flex flex-wrap items-stretch gap-x-4 gap-y-2">
          <PomodoroStat label="한 번에" value={String(pomodoroMinutes)} unit="분" adjust={<PomodoroMinutesStepper />} />
          {pages !== null && pages > 0 && <PomodoroStat label={`풀 ${pageWord(label) === '페이지' ? '장수' : pageWord(label)}`} value={formatNumber(pages)} unit={label} />}
          {sessions !== null && <PomodoroStat label="필요 횟수" value={String(sessions)} unit="회" />}
        </div>
      </div>
      {side}
      {start && <div data-testid="start-in-cell" className="mt-auto !pt-4">{start}</div>}
      </div>
    </section>
    <GrowthCell efficiency={efficiency} attackEfficiency={attackEfficiency} growthTop={growthTop} efficiencySlot={efficiencySlot} growth={growth} label={label} />
  </div>;
};

export const TodaySummary: React.FC<Props> = ({ logs, subjects, detailSubjectId, onDetailSubjectChange, taskSelector, onOpenSettings, completedStudySubjectIds = EMPTY_SUBJECT_IDS, pomodoroPlan, idle, onUpdateReviewMemo, onRestoreReviewQuestion, onSkipEditIntake, onRegisterReview, activeWeekday, activeStudyDate, onAddLog, onReplaceLogs, onDeleteLogs }) => {
  const [pomodoroMinutes] = usePomodoroMinutes();
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editingSummary, setEditingSummary] = useState<SubjectSummary | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [editEndPage, setEditEndPage] = useState(0);
  const [editMinutes, setEditMinutes] = useState('');
  const [editStartPage, setEditStartPage] = useState(1);
  const [includeReview, setIncludeReview] = useState(true);
  const [showFlowTutorial, setShowFlowTutorial] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  /** "추가 학습하기"를 눌러 원래 정보를 다시 연 끝낸 과목의 키 */
  const [reopenedId, setReopenedId] = useState('');
  // 다른 과목으로 넘어가면 다시 완료 카드로 돌아간다.
  useEffect(() => { setReopenedId(previous => (previous === detailSubjectId ? previous : '')); }, [detailSubjectId]);
  const [reviewMemo, setReviewMemo] = useState('');
  const [reviewMemoDocument, setReviewMemoDocument] = useState<ReviewMemoDocument>();
  const isBasicReviewDetail = detailSubjectId.startsWith(BASIC_REVIEW_DETAIL_PREFIX);
  const resolvedDetailSubjectId = isBasicReviewDetail
    ? detailSubjectId.slice(BASIC_REVIEW_DETAIL_PREFIX.length)
    : detailSubjectId;

  const selectableSubjects = useMemo(() => (
    subjects.filter(subject => (
      getSubjectRemainingPageCount(subject) > 0
      && normalizeWeekdays(subject.scheduledWeekdays).includes(activeWeekday)
    ))
  ), [activeWeekday, subjects]);
  const modalSubjects = useMemo(() => {
    if (!editingSummary || selectableSubjects.some(subject => subject.id === editingSummary.subjectId)) {
      return selectableSubjects;
    }

    const editingSubject = subjects.find(subject => subject.id === editingSummary.subjectId);
    return editingSubject ? [editingSubject, ...selectableSubjects] : selectableSubjects;
  }, [editingSummary, selectableSubjects, subjects]);

  const subjectSummaries = useMemo(() => buildCompletedSubjectSummaries(
    logs, subjects, completedStudySubjectIds, activeStudyDate
  ), [logs, subjects, completedStudySubjectIds, activeStudyDate]);

  const reviewSubjectOwnerMap = useMemo(() => {
    const owners = new Map<string, Subject>();
    subjects.forEach(subject => {
      getAllSubjectReviewIds(subject).forEach(reviewSubjectId => {
        if (!owners.has(reviewSubjectId)) owners.set(reviewSubjectId, subject);
      });
    });
    return owners;
  }, [subjects]);

  const detailData = useMemo(() => {
    const archivedLog = isBasicReviewDetail
      ? logs.find(log => log.subjectId === resolvedDetailSubjectId)
      : undefined;
    const subject = subjects.find(item => item.id === resolvedDetailSubjectId) || (archivedLog ? {
      id: resolvedDetailSubjectId,
      name: archivedLog.subjectNameSnapshot || '삭제된 과목',
      totalPages: 0,
      completedPages: 0,
      targetDate: getLocalDateKey()
    } : undefined);
    if (!subject) return null;

    const owner = reviewSubjectOwnerMap.get(subject.id);
    const subjectLogs = logs.filter(log => log.subjectId === subject.id);
    const growthLogs: StudyLog[] = owner ? getReviewEfficiencySamples(logs, owner.id, subject.id)
      .map((sample, index) => ({ ...sample, id: `growth-${index}`, subjectId: subject.id })) : subjectLogs;
    const dueRepeat = subjectLogs.filter(log => log.isRepeatReview && log.nextReviewDate
      && Date.parse(log.nextReviewDate) <= Date.now() && log.reviewEnabled !== false && !log.isCondensed)
      .sort((a, b) => Date.parse(a.nextReviewDate!) - Date.parse(b.nextReviewDate!))[0];
    const activeStage = getActiveSubjectStage(subject);
    // 성장의 학습 진척도는 지금 단원이 아니라 단계 전체 기준이다. 단원이 있으면 단원 사이(공부하지 않는 페이지)는 세지 않는다:
    // 1~10 · 21~30 단원에서 1~10을 끝내면 10/20(50%)이지 10/30(33%)이 아니다(학습 설정의 진척도와 같은 값).
    const activeChapter = activeStage?.chapter ?? null;
    const activeStagePageCount = activeStage ? Math.max(0, activeStage.pageCount) : 0;
    const activeStageCompletedPages = activeStage ? Math.min(activeStagePageCount, Math.max(0, activeStage.completedCount)) : 0;
    const activeStageProgress = activeStagePageCount > 0
      ? Math.round((activeStageCompletedPages / activeStagePageCount) * 100)
      : 100;
    const remainingPages = getSubjectRemainingPageCount(subject);
    const efficiency = owner
      ? calculateSubjectReviewAverageTimePerPage(logs, owner.id, subject.id)
      : calculateStats(subjectLogs, remainingPages, 0, subject.initialAverageTimePerPage).averageTimePerPage;

    const basicReviewTrend = isBasicReviewDetail
      ? calculateBasicReviewEfficiencyByNumber(logs, subject.id)
      : [];


    return {
      subject,
      owner,
      isBasicReviewDetail,
      activeStage,
      activeChapter,
      activeStagePageCount,
      activeStageCompletedPages,
      activeStageProgress,
      efficiency,
      attackEfficiency: calculateTimeAttackAverage(growthLogs),
      reviewStartPage: owner ? dueRepeat ? getRepeatedReviewRange(dueRepeat, subject).startPage : getReviewStartPage(subject) : null,
      // 단위: 학습과목은 "복습에 넣기" 사이(처음은 시작부터 첫 복습에 넣기까지), 복습과목은 복습 한 번
      efficiencyScope: getEfficiencyScope(growthLogs, owner ? reviewCompletionBoundaries(logs, owner.id, subject.id) : registrationBoundaries(subjectLogs)),
      reviewSpeedChanges: owner ? calculateReviewChangeAmounts(logs, owner.id, subject.id, activeStudyDate) : null,
      reviewSpeedSeries: owner ? getReviewSpeedSeries(logs, owner.id, subject.id) : null,
      basicReviewTrend,
    };
  }, [activeStudyDate, isBasicReviewDetail, logs, resolvedDetailSubjectId, reviewSubjectOwnerMap, subjects]);

  /** 지금 보고 있는 과목에 학습량을 직접 더한다. 과목은 고르지 않고 이 과목으로 고정된다. */
  const openAddModal = (targetSubject: Subject) => {
    setModalMode('add');
    setEditingSummary(null);
    setSubjectId(targetSubject.id);
    setEditMinutes('');
    const start = getActiveSubjectStage(targetSubject)?.currentPage || targetSubject.totalPages;
    setEditStartPage(start);
    setEditEndPage(start);
    setIncludeReview(targetSubject.reviewEnabled !== false);
    setReviewMemo('');
    setReviewMemoDocument(undefined);
  };

  const openEditModal = (summary: SubjectSummary) => {
    // 단위 복습 대기 기록은 복습에 넣은 기록이다(단위 끝 페이지까지 풀면 등록된다)
    const reviewLogs = summary.logs.filter(log => (log.reviewEnabled !== false && !log.isCondensed) || log.unitReviewPending);
    const savedMemos = Array.from(new Set(
      reviewLogs.map(log => (log.reviewMemo || '').trim()).filter(Boolean)
    ));
    setModalMode('edit');
    setEditingSummary(summary);
    setSubjectId(summary.subjectId);
    setEditMinutes(summary.minutes > 0 ? String(Number(summary.minutes.toFixed(2))) : '');
    setEditStartPage(summary.startPage || 1);
    setEditEndPage(summary.endPage || summary.startPage || 1);
    setIncludeReview(reviewLogs.length > 0);
    const singleNote = savedMemos.length === 1 ? reviewLogs.find(log => log.reviewMemo?.trim() === savedMemos[0]) : undefined;
    setReviewMemo(singleNote?.reviewMemo ?? savedMemos.join('\n'));
    setReviewMemoDocument(singleNote?.reviewMemoDocument);
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingSummary(null);
  };

  // 고치는 기록의 단계(같은 과목일 때만). 새 기록이나 다른 과목으로 바꾸면 그 과목의 지금 단계
  const editRangeStageId = editingSummary?.subjectId === subjectId ? editingSummary?.logs[0]?.subjectStageId : undefined;

  const saveLog = () => {
    const targetSubject = subjects.find(subject => subject.id === subjectId);
    const range = editRangeOf(targetSubject, editRangeStageId, editEndPage);
    const rangeChapters = range.chapters;
    const pages = !range.valid ? 0 : rangeChapters.length > 0 ? pagesBetween(rangeChapters, editStartPage, editEndPage) : calculateAmountFromEndPage(editStartPage, editEndPage);
    const existingTimedSamples = logs.filter(log => log.subjectId === subjectId);
    const measuredAverage = calculateRecentTimedPageAverage(existingTimedSamples).averageTimePerPage;
    const existingAverage = measuredAverage || Math.max(0, targetSubject?.initialAverageTimePerPage || 0);
    const minutes = editMinutes.trim() === ''
      ? Number((pages * existingAverage).toFixed(2))
      : Number(editMinutes);

    if (!subjectId || pages <= 0 || Number.isNaN(minutes) || minutes < 0) {
      alert('과목, 완료된 끝 페이지, 시간을 확인해주세요.');
      return;
    }

    const retainedReviewLog = editingSummary?.logs
      .filter(log => (log.reviewEnabled !== false && !log.isCondensed) || log.unitReviewPending)
      .sort((a, b) => new Date(a.nextReviewDate || a.timestamp).getTime() - new Date(b.nextReviewDate || b.timestamp).getTime())[0];
    const basicReviewTimeRecords = editingSummary?.logs.flatMap(log => log.basicReviewTimeRecords || []);
    const reviewSubjectTimeRecords = editingSummary?.logs.flatMap(log => log.reviewSubjectTimeRecords || []);

    const replacementLog: StudyLog = {
      id: editingSummary?.logs[0]?.id || Math.random().toString(36).substr(2, 9),
      subjectId,
      // 이 창에서 넣거나 고친 기록: 과목을 다 끝내지 않은 날에도 오늘 한 기록에 남는다
      manualEntry: true,
      pagesRead: pages,
      timeSpentMinutes: minutes,
      startPage: editStartPage,
      endPage: editEndPage,
      ...(rangeChapters.length > 0 ? { progressPages: pages } : {}),
      timestamp: editingSummary?.latestTimestamp || new Date().toISOString(),
      studyDate: activeStudyDate,
      studyWeekday: activeWeekday,
      isReviewed: includeReview ? retainedReviewLog?.isReviewed ?? false : false,
      isCondensed: !includeReview,
      reviewEnabled: includeReview,
      reviewMemo: includeReview && reviewMemo.trim() ? reviewMemo : undefined,
      reviewMemoDocument: includeReview && reviewMemo.trim() ? reviewMemoDocument : undefined,
      ...(includeReview && retainedReviewLog ? {
        reviewStep: retainedReviewLog.reviewStep,
        nextReviewDate: retainedReviewLog.nextReviewDate,
        reviewSubjectId: retainedReviewLog.reviewSubjectId,
        reviewTimeSpentMinutes: editingSummary?.logs.reduce((sum, log) => sum + (log.reviewTimeSpentMinutes || 0), 0),
        reviewCompletedPages: editingSummary?.logs.reduce((sum, log) => sum + (log.reviewCompletedPages || 0), 0),
        basicReviewTimeRecords,
        reviewSubjectTimeRecords,
        // 난도 피드백(FSRS-6 기억)·문제별 일정·뺀 문제는 페이지나 시간을 고쳐도 사라지지 않는다
        ...carriedReviewState(retainedReviewLog)
      } : {})
    };

    if (modalMode === 'edit' && editingSummary) {
      onReplaceLogs(editingSummary.logs.map(log => log.id), replacementLog);
    } else {
      onAddLog(replacementLog);
    }

    closeModal();
  };

  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const detailPomodoroPages = detailData ? pomodoroPlan?.subjectId === detailData.subject.id
    ? pomodoroPlan.pages : getPomodoroPageTarget(detailData.efficiency, getMeasurementRemainingPages(detailData.subject), pomodoroMinutes) : null;
  const calculatedRange = editRangeOf(selectedSubject, editRangeStageId, editEndPage);
  const calculatedRangeChapters = calculatedRange.chapters;
  const calculatedPages = editEndPage > 0 && calculatedRange.valid
    ? calculatedRangeChapters.length > 0 ? pagesBetween(calculatedRangeChapters, editStartPage, editEndPage) : calculateAmountFromEndPage(editStartPage, editEndPage)
    : 0;

  const detailIsReview = Boolean(detailData && (detailData.owner || detailData.isBasicReviewDetail));
  const pageLabel = getPageLabel(detailData?.subject);
  const pagePos = pagePositionLabel(pageLabel);
  const detailMatchesTask = Boolean(idle && detailData && idle.selectedDetailKey === detailSubjectId);
  const detailStartPage = detailData ? detailData.activeStage?.currentPage || detailData.subject.completedPages + 1 : 0;
  const recommendedPages = detailMatchesTask && !detailIsReview ? idle?.recommendedPages ?? null : null;
  const kindChip = detailIsReview ? 'bg-amber-100 text-amber-900' : 'bg-indigo-100 text-indigo-900';

  // 오늘 할 양을 모두 끝낸 과목을 열면 "오늘 완료" 카드만 보인다(시작 페이지·진척도·뽀모도로·효율은 숨김).
  // 더 하고 싶으면 카드의 "추가 학습하기"를 눌러 원래 정보를 보고, 그때 학습 시작이 다시 켜진다.
  // 학습 기록을 고치거나 지우는 줄(✎ ×)은 완료 카드에는 없고, 끝나기 전이나 "추가 학습하기"로 다시 연 화면에 있다.
  const rowOrder = idle?.rowOrder ?? [];
  const rowIndex = rowOrder.indexOf(detailSubjectId);
  const viewingDoneRow = idle?.currentRowDone !== undefined
    ? idle.currentRowDone && idle.doneOnlyKeys.includes(detailSubjectId)
    : Boolean(idle && rowIndex >= 0 && idle.doneOnlyKeys.includes(detailSubjectId));
  const completedRows = useMemo(() => buildCompletedDetailRows(
    logs, subjects, completedStudySubjectIds, activeStudyDate
  ), [logs, subjects, completedStudySubjectIds, activeStudyDate]);
  const doneRow = viewingDoneRow ? completedRows.find(row => row.detailId === detailSubjectId) : undefined;
  // 추가 학습: 학습은 남은 장수가 있을 때, 복습은 앞당겨 할 다음 복습이 남아 있을 때(extraReviewKeys)
  const canExtraStudy = Boolean(doneRow && idle?.onExtraStudy && detailData && (doneRow.kind === 'study'
    ? getSubjectRemainingPageCount(detailData.subject) > 0
    : idle.extraReviewKeys?.includes(detailSubjectId)));
  const reopened = Boolean(doneRow && reopenedId === detailSubjectId);
  const showDoneCard = Boolean(doneRow && !reopened);
  // 시작 버튼 자리: 끝낸 과목을 열어 둔 동안은 눌러지지 않는 "오늘 학습 완료", 추가 학습을 연 뒤에는 그 과목의 "학습 시작".
  const startSlot = idle ? (showDoneCard ? <DoneStartButton />
    : reopened && canExtraStudy && idle.onExtraStudy ? <StartButton kind={doneRow?.kind === 'review' ? 'review' : 'study'} onClick={() => idle.onExtraStudy?.(detailSubjectId)} />
    : idle.startButton ?? (
      <div className="flex h-[68px] items-center justify-center rounded-2xl bg-slate-100 px-3 text-center text-base font-black text-slate-700">오늘 할 일을 모두 마쳤어요</div>
    )) : null;
  // 시작 버튼은 "공부 시작" 칸 맨 아래에 들어간다(PomodoroSummary의 start). 그 칸이 없는 화면(오늘 완료 카드, 기본 복습 차트,
  // 선택한 할 일 없음)에서는 같은 버튼을 상세 칸 맨 아래에 한 줄로 둔다.
  const startRow = idle ? <div data-testid="start-row">{startSlot}</div> : null;
  // 기본 복습 칸의 복습 계획(복습할 장수 · 뽀모도로): 지금 선택한 복습, 또는 끝낸 칸을 "추가 학습하기"로 다시 연 뒤 앞당겨 할 다음 복습
  const basicReviewPlan = detailData?.isBasicReviewDetail && idle
    ? (idle.reviewPlan?.detailKey === detailSubjectId ? idle.reviewPlan : reopened ? idle.extraReviewPlans?.[detailSubjectId] : undefined) ?? null
    : null;
  // "공부 시작" 제목 옆의 끝날 날짜(예: ~10/25). 학습과목은 지금 공부 중인 단계, 복습과목은 복습이 모두 끝나는 날. 알 수 없으면 보이지 않는다.
  const endLabel = useMemo(() => (
    detailData && !detailData.isBasicReviewDetail
      ? formatShortEndDate(estimateSubjectEndDate(subjects, logs, detailData.subject.id)) : null
  ), [detailData, logs, subjects]);
  // 단원이 있는 과목은 "공부 시작" 제목 옆에 다음 단원이 시작하는 페이지도 보인다(마지막 단원이면 없음)
  const nextChapterStartPage = detailData && !detailData.isBasicReviewDetail ? detailData.activeChapter?.nextStartPage ?? null : null;
  const nextChapterLabel = nextChapterStartPage !== null ? `다음 단원 ${pagePos}.${formatNumber(nextChapterStartPage)}` : null;
  const noteSubjectId = detailData ? detailData.owner?.id ?? detailData.subject.id : '';
  const noteSubjectName = detailData ? (detailData.owner ?? detailData.subject).name : '';
  const noteCount = useMemo(() => logs.filter(log => log.subjectId === noteSubjectId && (log.reviewMemo ?? '').trim().length > 0).length, [logs, noteSubjectId]);
  // 복습에 넣기를 기다리는 기록(학습을 저장해도 사용자가 "복습에 넣기"를 눌러 난도를 고를 때까지 복습에 들어가지 않는다)
  const pendingReviewCount = useMemo(() => (detailData && !detailIsReview ? logs.filter(log => log.unitReviewPending && log.subjectId === detailData.subject.id).length : 0), [logs, detailData, detailIsReview]);
  const [choosingReview, setChoosingReview] = useState(false);
  // "학습량 변경" 창: 학습량 추가와 오늘 한 기록(고치기 · 지우기)이 한곳에 모인다
  const [changingAmount, setChangingAmount] = useState(false);
  useEffect(() => { setChangingAmount(false); }, [detailData?.subject.id]);
  // 과목을 옮기거나 대기 기록이 없어지면 난도 창을 닫는다
  useEffect(() => { if (pendingReviewCount === 0) setChoosingReview(false); }, [pendingReviewCount, detailData?.subject.id]);
  // 제목 뒤에 이어 붙이는 과목: 이 과목 → 후행과목, 각 과목에 붙은 복습과목은 대괄호. 예: A-B[C]-D. 이을 것이 없으면 이름만 보인다.
  const chainSegments = detailData && !detailIsReview ? getSubjectChain(detailData.subject, subjects) : [];
  const titleChain = hasSubjectChain(chainSegments) ? chainSegments : null;
  const headerButton = 'flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-indigo-400 bg-indigo-100 px-3.5 text-sm font-black text-indigo-900 transition-colors hover:bg-indigo-200 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400';

  // "추가" 창(29일 요청): 과목을 골라 시간(비우면 기존 전체 효율) · 푼 페이지 · 끝 페이지 · 복습 유무를 넣고,
  // 그 아래 측정 화면과 같은 세션 메모 · 정리노트를 크게 쓴 뒤 "추가 저장". 맨 아래에 오늘 추가한 기록(모든 과목)을 보여 주고 고치거나 지울 수 있다.
  const addableSubjects = subjects.filter(subject => !reviewSubjectOwnerMap.has(subject.id) && getSubjectRemainingPageCount(subject) > 0);
  const addingInline = changingAmount && modalMode === 'add';
  const todayAdded = buildCompletedSubjectSummaries(logs.filter(log => log.manualEntry), subjects, [], activeStudyDate)
    .filter(summary => summary.kind === 'study');
  const [sessionNote, setSessionNote] = useState('');
  useEffect(() => { if (addingInline && subjectId) { try { setSessionNote(readSessionMemos()[subjectId] ?? ''); } catch { setSessionNote(''); } } }, [addingInline, subjectId]);
  const addLabel = getPageLabel(selectedSubject);
  const setSolvedPages = (count: number) => {
    const chapters = calculatedRange.chapters;
    if (!(count > 0)) { setEditEndPage(editStartPage - 1); return; }
    setEditEndPage(chapters.length > 0 ? endPageForSolved(chapters, editStartPage, count) ?? editStartPage : editStartPage + count - 1);
  };
  const addField = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-lg font-black text-slate-900 outline-none focus:border-indigo-500';
  const amountDialog = changingAmount ? (
    <div role="dialog" aria-modal="true" aria-label="학습 기록 추가" data-testid="amount-change-dialog" onClick={() => { setChangingAmount(false); closeModal(); }}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-4">
      <div onClick={event => event.stopPropagation()} className="flex max-h-[94vh] w-full max-w-3xl flex-col rounded-[2rem] bg-white shadow-2xl animate-fade-in">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6">
          <h4 className="text-xl font-black text-slate-900">학습 기록 추가</h4>
          <button type="button" onClick={() => { setChangingAmount(false); closeModal(); }} aria-label="학습 기록 추가 닫기"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl text-slate-600 hover:bg-slate-100">×</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 sm:px-6">
          <section aria-label="과목 고르기" className="flex flex-col gap-2">
            <p className="text-sm font-black text-slate-700">기록을 추가할 과목</p>
            <div className="flex flex-wrap gap-2">
              {addableSubjects.map(subject => (
                <button key={subject.id} type="button" data-testid="amount-subject" aria-pressed={addingInline && subjectId === subject.id}
                  onClick={() => openAddModal(subject)}
                  className={`h-11 rounded-xl border-2 px-4 text-sm font-black ${addingInline && subjectId === subject.id ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                  {subject.name}
                </button>
              ))}
              {addableSubjects.length === 0 && <p className="text-sm font-bold text-slate-600">남은 페이지가 있는 과목이 없어요.</p>}
            </div>
          </section>
          {addingInline && selectedSubject && (
            <section aria-label="추가할 기록" data-testid="amount-add-form" className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-3 sm:p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-slate-600">시간(분) · 비우면 전체 효율로</span>
                  <input data-testid="amount-minutes" type="number" min="0" value={editMinutes} onChange={event => setEditMinutes(event.target.value)} placeholder="비우면 자동" className={addField} /></label>
                <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-slate-600">푼 {pageWord(addLabel)}</span>
                  <input data-testid="amount-pages" type="number" min="0" step="1" value={calculatedPages > 0 ? calculatedPages : ''} onChange={event => setSolvedPages(Number(event.target.value))} className={addField} /></label>
                <label className="flex flex-col gap-1"><span className="text-[13px] font-bold text-slate-600">끝 {pageWord(addLabel)}</span>
                  <input data-testid="amount-end" type="number" step="1" value={editEndPage} onChange={event => setEditEndPage(Number(event.target.value))} className={addField} /></label>
                <div className="flex flex-col gap-1"><span className="text-[13px] font-bold text-slate-600">복습</span>
                  <div className="grid h-[50px] grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                    <button type="button" data-testid="amount-review-off" aria-pressed={!includeReview} onClick={() => setIncludeReview(false)}
                      className={`rounded-lg text-sm font-black ${!includeReview ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>안 함</button>
                    <button type="button" data-testid="amount-review-on" aria-pressed={includeReview} onClick={() => setIncludeReview(true)}
                      className={`rounded-lg text-sm font-black ${includeReview ? 'bg-rose-500 text-white' : 'text-slate-500'}`}>하기</button>
                  </div>
                </div>
              </div>
              <p className="text-[13px] font-bold text-slate-600">시작 {pagePositionLabel(addLabel)}.{formatNumber(editStartPage)} · 학습량 {calculatedPages > 0 ? formatNumber(calculatedPages) : '0'}{addLabel}</p>
              <label className="flex flex-col gap-1"><span className="text-sm font-black text-indigo-700">세션 메모</span>
                <textarea data-testid="amount-session-memo" value={sessionNote} placeholder="세션 메모"
                  onChange={event => { setSessionNote(event.target.value); try { writeSessionMemo(subjectId, event.target.value); } catch { /* 저장 실패는 무시 */ } }}
                  className="h-16 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base font-bold text-slate-800 outline-none focus:border-indigo-500" /></label>
              {includeReview && (
                <div data-testid="amount-note" className="flex flex-col gap-2 rounded-2xl border border-rose-200 p-3">
                  <span className="text-base font-black text-rose-700">정리노트</span>
                  <ReviewMemoEditor value={reviewMemo} document={reviewMemoDocument}
                    onChange={(memo, document) => { setReviewMemo(memo); setReviewMemoDocument(document); }}
                    minHeight={320} maxHeight={560} placeholder="정리노트" theme="light" grid symbolBar />
                </div>
              )}
              <button type="button" data-testid="amount-save" onClick={saveLog} disabled={!(calculatedPages > 0)}
                className="h-12 rounded-xl bg-indigo-600 text-base font-black text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500">추가 저장</button>
            </section>
          )}
          <section aria-label="오늘 추가한 기록" className="flex flex-col gap-1.5 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3">
            <h3 className="text-sm font-black text-slate-800">오늘 추가한 기록 · 모든 과목</h3>
            {todayAdded.length > 0 ? todayAdded.map(summary => {
              const label = getPageLabel(subjects.find(subject => subject.id === summary.subjectId));
              return (
                <div key={summary.recordKey} data-testid="amount-today-row" className="flex min-w-0 items-center gap-1">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-black text-slate-900">
                    <span className="text-slate-600">{summary.name} · </span>
                    {summary.startPage > 0 && summary.endPage > 0 ? `${pagePositionLabel(label)}.${formatNumber(summary.startPage)}~${formatNumber(summary.endPage)} · ` : ''}
                    {formatNumber(summary.pages)}{label} · {formatDoneMinutes(summary.minutes)}
                  </p>
                  <button type="button" onClick={() => { setChangingAmount(false); openEditModal(summary); }} title="합산 기록 수정" aria-label="합산 기록 수정"
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-600 hover:text-indigo-700">✎</button>
                  <button type="button" onClick={() => onDeleteLogs(summary.logs.map(log => log.id))} title="합산 기록 삭제" aria-label="합산 기록 삭제"
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-xl text-slate-600 hover:text-rose-600">×</button>
                </div>
              );
            }) : <p data-testid="amount-empty" className="py-1 text-sm font-bold text-slate-600">오늘 추가한 기록이 없어요.</p>}
          </section>
        </div>
      </div>
    </div>
  ) : null;
  const startBlock = detailData && !detailData.owner ? (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="flex items-baseline gap-2.5 whitespace-nowrap">
        <span className="text-base font-bold text-slate-600">시작</span>
        <span className="font-mono text-[48px] font-black leading-[1.1] tabular-nums text-indigo-900">{pagePos}.{formatNumber(detailStartPage)}</span>
      </div>
      {recommendedPages !== null && recommendedPages > 0 && (
        <div className="flex flex-col items-end gap-0.5 whitespace-nowrap pb-1">
          <span className="text-[15px] font-bold text-slate-600">오늘 권장</span>
          <span className="font-mono text-xl font-bold text-slate-900">{formatNumber(recommendedPages)}{pageLabel} · {pagePos}.{formatNumber(detailStartPage)}~{formatNumber(getRecommendedEndPage(detailData.subject, detailData.activeStage, detailStartPage, recommendedPages))}</span>
        </div>
      )}
    </div>
  ) : null;
  const progressBlock = detailData ? (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-base font-black text-slate-800">
          학습 진척도 · {detailData.activeStage
            ? `${detailData.activeStage.name} · ${pagePos}.${formatNumber(detailData.activeStage.startPage)}~${formatNumber(detailData.activeStage.endPage)}`
            : '전체 완료'}
        </p>
        <p className="font-mono text-base font-bold text-slate-700">
          {detailData.activeStage
            ? `${formatNumber(detailData.activeStageCompletedPages)} / ${formatNumber(detailData.activeStagePageCount)}${pageLabel} · ${detailData.activeStageProgress}%`
            : '100%'}
        </p>
      </div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-500"
          style={{ width: `${detailData.activeStageProgress}%` }}
        />
      </div>
    </div>
  ) : null;
  // 오른쪽 "성장" 칸의 내용. 복습과목은 측정 방식이 둘 중 하나다: 평균·이번 복습 증가율(+속도 그래프, 비슷한 새 문제집 사이의 성장)
  // 또는 전체·타임어택 효율(한 문제집을 계속 복습). 증가율 방식이면 효율 줄은 아예 그리지 않는다.
  const reviewRateMode = Boolean(detailData && detailData.owner && detailData.subject.reviewGrowthDisplay === 'review');
  const growthNode = detailData && reviewRateMode
    ? <ReviewSpeedGrowthCell changes={detailData.reviewSpeedChanges!} series={detailData.reviewSpeedSeries ?? undefined} label={pageLabel} />
    : undefined;
  const efficiencyNode = detailData
    ? (reviewRateMode ? <></>
      : <UnitGrowthEfficiency key={detailData.subject.id} scope={detailData.efficiencyScope} label={pageLabel} unitEnd={detailData.owner ? 'review' : 'register'}
        efficiency={detailData.efficiency} attackEfficiency={detailData.attackEfficiency} done={showDoneCard && Boolean(doneRow)} />)
    : undefined;
  const stepsChips = idle && detailData ? (
    <div aria-label="진행 순서" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-base font-black text-slate-800">풀이 절차</span>
        <button type="button" onClick={() => setShowFlowTutorial(true)}
          className="h-9 px-1 text-sm font-bold text-indigo-800 underline underline-offset-4">자세히</button>
      </div>
      {/* 세 단계는 화살표로 이어 한 줄에, 네 단계(복습과목)는 칸이 좁아 2×2로 놓는다 */}
      {(() => {
        const labels = detailData.owner ? REVIEW_STEP_LABELS : STUDY_STEP_LABELS;
        const chip = (label: string, index: number) => (
          <span key={label} className="flex items-center gap-1.5 whitespace-nowrap text-[15px] font-bold text-slate-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">{index + 1}</span>
            {label}
          </span>
        );
        return labels.length > 3
          ? <div data-testid="steps-grid" className="grid grid-cols-2 gap-x-3 gap-y-2.5">{labels.map(chip)}</div>
          : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              {labels.map((label, index) => (
                <React.Fragment key={label}>
                  {index > 0 && <span aria-hidden="true" className="text-slate-400">›</span>}
                  {chip(label, index)}
                </React.Fragment>
              ))}
            </div>
          );
      })()}
    </div>
  ) : null;

  // 분류(학습 / 기본 복습 / 복습과목)와 필수 표시. "공부 시작" 칸이 있으면 그 칸의 "공부 시작"과 끝날 날짜 사이에,
  // 없으면(오늘 할 양을 끝낸 카드, 기본 복습) 제목 줄 오른쪽에 놓는다.
  const kindBadges = detailData ? (
    <>
      <span data-testid="detail-kind" className={`shrink-0 rounded-md px-2.5 py-0.5 text-[13px] font-black ${kindChip}`}>
        {detailData.owner ? '복습과목' : detailData.isBasicReviewDetail ? '기본 복습' : '학습'}
      </span>
      {!detailIsReview && isSubjectRequiredNow(detailData.subject) && <span className="shrink-0 rounded-md border border-slate-900 px-2 py-0.5 text-[13px] font-black text-slate-900">필수</span>}
      {/* 기본 복습은 제목 옆에 복습할 범위(시작~끝 페이지)를 둔다(21:55 "제목 옆 복습 시작페이지와 끝 페이지") */}
      {detailData.isBasicReviewDetail && basicReviewPlan?.rangeLabel && (
        <span data-testid="basic-review-range" className="shrink-0 font-mono text-[20px] font-black tabular-nums text-slate-800">{pagePos}.{basicReviewPlan.rangeLabel}</span>
      )}
    </>
  ) : null;
  const badgesInStartCell = Boolean(detailData && !(showDoneCard && doneRow) && !detailData.isBasicReviewDetail);

  const detailPanel = detailData ? (
    <section id="subject-live-detail" aria-label="선택한 할 일"
      data-done={showDoneCard && doneRow ? 'true' : undefined}
      className={`relative flex min-w-0 flex-col gap-3 rounded-2xl border-2 ${showDoneCard && doneRow ? 'border-green-200 bg-green-50' : 'border-slate-500 bg-slate-100'} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          {/* 제목 오른쪽에 분류 하나만: 학습 / 기본 복습 / 복습과목 (+필수) */}
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 data-testid="detail-title" className={`text-[22px] font-black leading-tight tracking-tight text-slate-900 ${titleChain ? 'min-w-0 break-keep' : 'truncate'}`}>
              {titleChain ? titleChain.map((segment, index) => (
                <React.Fragment key={segment.id}>
                  {index > 0 && <span aria-hidden="true" className="px-1 font-bold text-slate-400">-</span>}
                  {/* 지금 공부하는 과목만 크고 가장 진하며 밑줄이 있다. 끝난 과목은 가장 옅고, 아직인 과목은 그 사이다. */}
                  <span data-testid={index > 0 ? 'chain-follow-up' : 'chain-first'} data-current={segment.isCurrent ? 'true' : undefined}
                    aria-current={segment.isCurrent ? 'step' : undefined}
                    className={segment.isCurrent
                      ? 'text-[28px] font-black text-slate-950 underline decoration-[3px] decoration-indigo-500 underline-offset-[6px]'
                      : `text-[18px] font-bold ${segment.isCompleted ? 'text-slate-400' : 'text-slate-600'}`}>{segment.name}</span>
                  {segment.reviewNames.length > 0 && (
                    <span data-testid="chain-reviews"
                      className={segment.isCurrent ? 'text-[19px] font-bold text-slate-700' : 'text-[16px] font-bold text-slate-400'}>[{segment.reviewNames.join(', ')}]</span>
                  )}
                </React.Fragment>
              )) : detailData.subject.name}
            </h2>
            {!badgesInStartCell && kindBadges}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {reopened && (
            <button type="button" onClick={() => setReopenedId('')} className={headerButton}>
              <span aria-hidden="true">✓</span>완료 기록 보기
            </button>
          )}
          {onUpdateReviewMemo && (
            <button type="button" onClick={() => setShowNotes(true)} aria-label="정리노트 열기" className={headerButton}>
              <span aria-hidden="true">📒</span>정리노트
              {noteCount > 0 && <span className="rounded-full bg-indigo-600 px-2 text-xs font-black leading-5 text-white">{noteCount}</span>}
            </button>
          )}
          {!detailIsReview && onRegisterReview && pendingReviewCount > 0 && (
            <button type="button" data-testid="register-review" onClick={() => setChoosingReview(true)} aria-label="복습에 넣기" className={headerButton}>
              <span aria-hidden="true">↻</span>복습에 넣기
              <span className="rounded-full bg-indigo-600 px-2 text-xs font-black leading-5 text-white">{pendingReviewCount}</span>
            </button>
          )}
          {!detailIsReview && (
            <button type="button" data-testid="amount-change" onClick={() => { closeModal(); setChangingAmount(true); }} aria-label="학습 기록 추가" className={headerButton}>
              <span aria-hidden="true" className="text-base leading-none">+</span>추가
            </button>
          )}
        </div>
      </div>

      {choosingReview && onRegisterReview && detailData && !detailIsReview && pendingReviewCount > 0 && (
        <RegisterReviewDialog info={pendingFeedbackOf(logs, detailData.subject.id, Date.now())} pageLabel={pageLabel}
          onClose={() => setChoosingReview(false)}
          onChoose={grade => { onRegisterReview(detailData.subject.id, grade); setChoosingReview(false); }} />
      )}

      {/* 기본 복습 화면에서는 뒷순서 할 일 한 줄(이어서 · 학습 범위)을 두지 않는다: 아래 지표와 겹친다(21:55) */}
      {idle?.laterMembers && idle.laterMembers.length > 0 && !detailData.isBasicReviewDetail && <LaterMembersStrip members={idle.laterMembers} />}
      {idle?.memberChoices && idle.memberChoices.length > 1 && idle.onPickMember && (
        <MemberChooser members={idle.memberChoices} currentKey={idle.currentMemberKey ?? ''} onPick={idle.onPickMember} />
      )}
      {idle?.reviewScope && !showDoneCard && (
        <ReviewScopeStrip scope={idle.reviewScope} all={Boolean(idle.memberChoices?.find(member => member.key === idle.currentMemberKey)?.all)} />
      )}

      {showDoneCard && doneRow ? (
        // 오늘 할 양을 끝낸 과목: "공부 시작" 칸은 사라지고 "성장" 칸 하나가 가로로 넓어진다. 칸 전체가 연한 초록이다.
        // 왼쪽에는 평소 성장 내용, 오른쪽에는 한 일 · 최근 하루 평균 공부 시간 · "추가 학습하기"가 있다.
        <GrowthCell efficiency={detailData.efficiency} attackEfficiency={detailData.attackEfficiency}
          growthTop={detailData.isBasicReviewDetail ? undefined : progressBlock}
          efficiencySlot={efficiencyNode} growth={growthNode}
          main={detailData.isBasicReviewDetail ? <BasicReviewEfficiencyTrend points={detailData.basicReviewTrend} bare label={pageLabel} /> : undefined}
          done={<DoneSummary row={doneRow}
            onOpenSettings={onOpenSettings ? () => onOpenSettings(detailData.owner?.id ?? detailData.subject.id) : undefined}
            onExtraStudy={canExtraStudy ? () => setReopenedId(detailSubjectId) : undefined}
            bottom={canExtraStudy || doneRow.kind === 'review' ? undefined : <DoneStartButton />} />} />
      ) : detailData.isBasicReviewDetail ? (
        <>
          {basicReviewPlan && <BasicReviewPlan plan={basicReviewPlan} label={pageLabel} />}
          <BasicReviewEfficiencyTrend points={detailData.basicReviewTrend} label={pageLabel} />
          {startRow}
        </>
      ) : (
        <>
          <PomodoroSummary label={pageLabel} endLabel={endLabel} nextChapterLabel={nextChapterLabel} badges={kindBadges} pages={detailPomodoroPages} efficiency={detailData.efficiency} attackEfficiency={detailData.attackEfficiency} remainingTaskPages={pomodoroPlan?.subjectId === detailData.subject.id
            ? pomodoroPlan.remainingTaskPages : undefined}
            top={<>
              {detailData.owner && <div className="flex items-baseline gap-2.5">
                {detailData.reviewStartPage !== null ? <>
                  <span className="text-base font-bold text-slate-600">다음 시작</span>
                  <span className="font-mono text-[44px] font-black leading-[1.1] tabular-nums text-indigo-900">{pagePos}.{detailData.reviewStartPage}</span>
                </> : <span className="text-xl font-black text-slate-800">전체 완료</span>}
              </div>}
              {startBlock}
            </>}
            growthTop={progressBlock}
            side={stepsChips}
            start={startSlot}
            growth={growthNode}
            efficiencySlot={efficiencyNode} />
        </>
      )}

    </section>
  ) : idle ? (
    <section aria-label="선택한 할 일" className="relative flex min-h-[240px] min-w-0 flex-col gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
      <p className="flex flex-1 items-center justify-center text-sm font-bold text-slate-600">
        {rowOrder.length > 0 ? '오늘 할 일 옆 › 화살표로 오늘 끝낸 과목을 볼 수 있어요.' : '선택한 할 일이 없습니다.'}
      </p>
      {startRow}
    </section>
  ) : null;

  return (
    <section className="animate-fade-in flex flex-col gap-3.5">
      {taskSelector}
      {detailPanel}

      {showFlowTutorial && <MeasurementTutorial onClose={() => setShowFlowTutorial(false)} />}
      {showNotes && onUpdateReviewMemo && (
        <NoteSheet logs={logs} subjects={subjects} subjectId={noteSubjectId} subjectName={noteSubjectName}
          onUpdateReviewMemo={onUpdateReviewMemo} onRestoreReviewQuestion={onRestoreReviewQuestion} onSkipEditIntake={onSkipEditIntake} onClose={() => setShowNotes(false)} />
      )}

      {amountDialog}

      {modalMode && !addingInline && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-[10000]">
          <div className="flex max-h-[92vh] w-full max-w-sm flex-col rounded-[2.5rem] bg-white shadow-2xl animate-fade-in">
            <h4 className="px-8 pb-5 pt-8 text-xl font-black md:px-10 md:pt-10">{modalMode === 'edit' ? '합산 기록 수정' : '학습량 추가'}</h4>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 pb-5 md:px-10">
              {modalMode === 'add' ? (
                <div className="space-y-1">
                  <p className="text-[13px] font-bold text-slate-600 px-1">과목</p>
                  <p data-testid="add-subject" className="w-full rounded-2xl bg-slate-50 p-4 text-center text-lg font-black text-slate-900">{selectedSubject ? (() => {
                    // 후행과목 단계를 공부 중이면 그 단계 이름을 같이 적는다(시작 페이지가 그 단계의 페이지라서)
                    const stage = getActiveSubjectStage(selectedSubject);
                    return stage && stage.isFollowUp ? `${selectedSubject.name} · ${stage.name}` : selectedSubject.name;
                  })() : null}</p>
                </div>
              ) : (
              <div className="space-y-1">
                <label className="text-[13px] font-bold text-slate-600 px-1">과목</label>
                <select
                  value={subjectId}
                  onChange={e => setSubjectId(e.target.value)}
                  className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg outline-none"
                >
                  <option value="">과목 선택</option>
                  {modalSubjects.map(subject => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </div>
              )}
              <div className="space-y-1">
                <label className="text-[13px] font-bold text-slate-600 px-1">완료된 끝 페이지</label>
                <input type="number" step="1" value={editEndPage} onChange={e => setEditEndPage(Number(e.target.value))} className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg" />
                <p className="px-1 text-[13px] font-bold text-slate-600">
                  시작 {pagePositionLabel(getPageLabel(selectedSubject))}.{formatNumber(editStartPage)} · 학습량 {calculatedPages > 0 ? formatNumber(calculatedPages) : '0'}{getPageLabel(selectedSubject)}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[13px] font-bold text-slate-600 px-1">소요 시간(분)</label>
                <input
                  type="number"
                  value={editMinutes}
                  onChange={e => setEditMinutes(e.target.value)}
                  placeholder="비워두면 기존 효율로 자동 계산"
                  className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg"
                />
                <p className="px-1 text-[13px] font-bold text-slate-600">공백이면 해당 과목의 기존 효율로 시간을 계산합니다.</p>
              </div>
              <div className="space-y-2">
                <label className="px-1 text-[13px] font-bold text-slate-600">복습</label>
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-1.5">
                  <button
                    type="button"
                    onClick={() => setIncludeReview(false)}
                    className={`rounded-xl py-3 text-sm font-black transition-all ${
                      !includeReview ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400'
                    }`}
                  >
                    복습 안 함
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeReview(true)}
                    className={`rounded-xl py-3 text-sm font-black transition-all ${
                      includeReview ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-400'
                    }`}
                  >
                    복습 하기
                  </button>
                </div>
                {includeReview && (
                  <ReviewMemoEditor
                    value={reviewMemo}
                    document={reviewMemoDocument}
                    onChange={(memo, document) => { setReviewMemo(memo); setReviewMemoDocument(document); }}
                    placeholder="복습 노트"
                    minHeight={112}
                    maxHeight={260}
                  />
                )}
              </div>
            </div>
            <div className="flex gap-3 px-8 pb-8 pt-3 md:px-10 md:pb-10">
              <button onClick={closeModal} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">취소</button>
              <button onClick={saveLog} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg">
                {modalMode === 'edit' ? '수정 저장' : '추가 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};


/**
 * 기본 복습 칸 맨 위: 지금 복습할 페이지 수(와 범위) · 뽀모도로.
 * 뽀모도로는 학습 칸과 같은 모양(한 번에 25분 · 한 번에 복습할 장수 · 필요 횟수)이고, 복습할 장수와 기본 복습의 장당 시간으로 구한다.
 * 장당 시간을 아직 모르면 한 번에 25분만 보인다.
 */
export const BasicReviewPlan: React.FC<{ plan: ReviewPlanContext; label?: string }> = ({ plan, label = DEFAULT_PAGE_LABEL }) => {
  const [pomodoroMinutes] = usePomodoroMinutes();
  if (!(plan.pages > 0)) return null;
  const pomodoro = getReviewPomodoro(plan.pages, plan.minutesPerPage, pomodoroMinutes);
  const word = pageWord(label) === '페이지' ? '장수' : pageWord(label);
  return (
    <section aria-label="복습 계획" data-testid="basic-review-plan"
      className="grid min-w-0 gap-x-6 gap-y-3 rounded-2xl border-2 border-slate-500 bg-white px-5 py-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
      <div data-testid="review-plan-pages" className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold text-slate-600">복습할 {pageWord(label) === '페이지' ? '페이지' : pageWord(label)}</span>
        <span className="whitespace-nowrap font-mono text-[40px] font-black leading-[1.15] tabular-nums text-indigo-900 md:text-[44px]">
          {formatNumber(plan.pages)}<span className="ml-1 text-xl font-semibold text-slate-500">{label}</span>
        </span>
      </div>
      <div aria-label="뽀모도로" data-testid="review-plan-pomodoro"
        className="min-w-0 border-t border-slate-300 pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <span className="flex h-8 items-center gap-2 text-base font-black text-slate-800">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /></svg>
          뽀모도로
        </span>
        <div className="mt-1 flex flex-wrap items-stretch gap-x-4 gap-y-2">
          <PomodoroStat label="한 번에" value={String(pomodoroMinutes)} unit="분" adjust={<PomodoroMinutesStepper />} />
          {pomodoro.pages !== null && pomodoro.pages > 0 && <PomodoroStat label={`복습 ${word}`} value={formatNumber(pomodoro.pages)} unit={label} />}
          {pomodoro.sessions !== null && pomodoro.pages !== null && pomodoro.pages > 0 && <PomodoroStat label="필요 횟수" value={String(pomodoro.sessions)} unit="회" />}
        </div>
      </div>
    </section>
  );
};

const BasicReviewEfficiencyTrend = ({ points, bare = false, label = DEFAULT_PAGE_LABEL }: {
  /** 완료 화면의 성장 칸 안에 놓을 때: 따로 상자를 두르지 않는다 */
  bare?: boolean;
  /** 과목이 "페이지"를 부르는 글자(기본 P) */
  label?: string;
  points: Array<{
    reviewNumber: number;
    averageTimePerPage: number;
    totalMinutes: number;
    totalPages: number;
    sampleCount: number;
  }>;
}) => {
  const baselineEfficiency = points.find(point => point.averageTimePerPage > 0)?.averageTimePerPage || 0;
  const chartData = points.map(point => ({
    review: `${point.reviewNumber}회`,
    efficiency: Number(point.averageTimePerPage.toFixed(2)),
    // 1회 대비 속도 변화(1시간에 푸는 장수의 차이). 기본 복습은 공부량 없이 속도만, 소수 첫째 자리까지 보여준다.
    change: toGrowthChange(baselineEfficiency, point.averageTimePerPage),
    pages: point.totalPages,
    samples: point.sampleCount
  }));
  // 그래프는 1시간에 푸는 장수. 1회 속도가 세로축의 가운데다.
  const series = chartData.map(point => ({ pagesPerReference: pagesPerReferenceTime(point.efficiency) }));

  return (
    <div data-testid="basic-review-trend" className={bare ? 'flex flex-col gap-3' : 'flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={`text-[15px] font-black ${bare ? 'text-slate-800' : 'text-amber-900'}`}>기본 복습 회차별 평균 효율</p>
        <span className="text-xs font-semibold text-slate-700">1회 대비</span>
      </div>
      {chartData.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl bg-white text-sm font-bold text-slate-600">복습 기록 없음</div>
      ) : (
        <>
          <div className="grid auto-cols-[minmax(120px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1">
            {chartData.map((point, index) => {
              const described = index > 0 && point.change ? describeSpeed(point.change, label) : null;
              return (
                <div key={point.review} className={`min-w-0 rounded-xl border bg-white px-4 py-2.5 ${bare ? 'border-slate-300' : 'border-amber-200'}`}>
                  <p className="text-xs font-black text-slate-700">{point.review} 복습</p>
                  <p className={`mt-0.5 font-mono text-lg font-black tabular-nums lg:text-2xl ${bare ? 'text-slate-900' : 'text-amber-900'}`}>{formatNumber(point.efficiency)}<span className="ml-0.5 text-xs">분/{label}</span></p>
                  {described && <p data-growth-kind="speed" className={`mt-0.5 text-xs font-black ${point.change!.speedPages > 0 ? 'text-green-800' : 'text-slate-700'}`}>
                    {described}
                  </p>}
                </div>
              );
            })}
          </div>
          <SpeedGraph series={series} plain height={192} label={label} />
        </>
      )}
    </div>
  );
};
