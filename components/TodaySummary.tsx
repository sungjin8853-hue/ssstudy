import React, { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StudyLog, Subject, ReviewMemoDocument } from '../types';
import { calculateBasicReviewEfficiencyByNumber, calculateRecentTimedPageAverage, calculateReviewSpeedChanges, calculateStats, calculateSubjectReviewAverageTimePerPage, calculateTimeAttackAverage, getReviewEfficiencySamples } from '../utils/math';
import { BASIC_REVIEW_DETAIL_PREFIX, getRepeatedReviewRange, getReviewStartPage } from '../utils/review';
import { getMeasurementRemainingPages, getPomodoroPageTarget, getRemainingPomodoroSessions, POMODORO_MINUTES, PomodoroPlan } from '../utils/measurement';
import {
  getActiveSubjectStage,
  getAllSubjectReviewIds,
  getLocalDateKey,
  getLogStudyDate,
  getSubjectRemainingPageCount,
  normalizeWeekdays,
  parseStudyDate
} from '../utils/schedule';
import { ReviewMemoEditor } from './ReviewMemoEditor';
import { EfficiencyGrowthCell, ReviewSpeedGrowthCell } from './PageGrowth';
import { calculatePageUnitGrowth, hasMeasurementOnDate } from '../utils/pageGrowth';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  detailSubjectId: string;
  onDetailSubjectChange: (subjectId: string) => void;
  taskSelector: React.ReactNode;
  completedStudySubjectIds?: string[];
  pomodoroPlan?: PomodoroPlan | null;
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
  weeklyPages: number;
  weeklyMinutes: number;
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
    recordKey = detailId, baselineTimePerPage?: number) => {
    const summary = groups.get(recordKey) || {
      recordKey, subjectId, detailId, kind, name, pages: 0, minutes: 0, weeklyPages: 0, weeklyMinutes: 0,
      startPage: 0, endPage: 0, latestTimestamp: timestamp, logs: [],
      reviewSpeedChangePercent: null, reviewBaselineMinutes: 0, reviewHasBaseline: true
    };
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

  logs.forEach(log => {
    if (!log.reviewParentSubjectId && (completedIds.has(log.subjectId) || log.pomodoroSession)
      && getLogStudyDate(log) === studyDate && log.pagesRead > 0) {
      add(log.subjectId, 'study', log.subjectId, nameOf(log.subjectId, log), log.pagesRead, log.timeSpentMinutes, log.timestamp, log,
        log.pomodoroSession ? `${log.subjectId}:pomodoro:${log.id}` : log.subjectId);
    }
    if (log.pomodoroSession && log.reviewParentSubjectId && !aggregateReviewIds.has(log.id)
      && getLogStudyDate(log) === studyDate && log.pagesRead > 0) {
      const allocated = reviewRecords.filter(record => record.measurementId === log.id);
      const allocatedPages = allocated.reduce((sum, record) => sum + record.pages, 0);
      const baseline = log.reviewBaselineTimePerPage ?? (allocatedPages > 0
        ? allocated.reduce((sum, record) => sum + record.pages * (record.baselineTimePerPage || 0), 0) / allocatedPages : 0);
      add(log.subjectId, 'review', log.subjectId, `${nameOf(log.subjectId, log)} · 복습`, log.pagesRead,
        log.timeSpentMinutes, log.timestamp, undefined, `${log.subjectId}:${log.id}`, baseline);
    }
    (log.basicReviewTimeRecords || []).forEach(record => {
      if (getLocalDateKey(new Date(record.timestamp)) === studyDate && record.pages > 0) {
        const detailId = `${BASIC_REVIEW_DETAIL_PREFIX}${log.subjectId}`;
        add(log.subjectId, 'review', detailId, `${nameOf(log.subjectId, log)} · 기본 복습`, record.pages, record.minutes, record.timestamp,
          undefined, `${detailId}:${record.timestamp}`);
      }
    });
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (!representedBySessions(record) && (record.completed || pomodoroLogs.has(record.measurementId || ''))
        && getLocalDateKey(new Date(record.timestamp)) === studyDate && record.pages > 0) {
        add(record.subjectId, 'review', record.subjectId, `${nameOf(record.subjectId, log)} · 복습`, record.pages, record.minutes, record.timestamp,
          undefined, `${record.subjectId}:${record.measurementId || record.timestamp}`, record.baselineTimePerPage);
      }
    });
  });

  const addWeekly = (key: string, date: string, pages: number, minutes: number, kind: 'study' | 'review' = 'review') => {
    if (date < weekStartKey || date > studyDate) return;
    groups.forEach(summary => {
      if (summary.detailId !== key || summary.kind !== kind) return;
      summary.weeklyPages += Math.max(0, pages);
      summary.weeklyMinutes += Math.max(0, minutes);
    });
  };
  logs.forEach(log => {
    if (!log.reviewParentSubjectId) {
      addWeekly(log.subjectId, getLogStudyDate(log), log.pagesRead, log.timeSpentMinutes, 'study');
    } else if (log.pomodoroSession && !aggregateReviewIds.has(log.id)) {
      addWeekly(log.subjectId, getLogStudyDate(log), log.pagesRead, log.timeSpentMinutes);
    }
    (log.basicReviewTimeRecords || []).forEach(record => {
      addWeekly(`${BASIC_REVIEW_DETAIL_PREFIX}${log.subjectId}`, getLocalDateKey(new Date(record.timestamp)), record.pages, record.minutes);
    });
    (log.reviewSubjectTimeRecords || []).forEach(record => {
      if (representedBySessions(record)) return;
      addWeekly(record.subjectId, getLocalDateKey(new Date(record.timestamp)),
        record.completed || pomodoroLogs.has(record.measurementId || '') ? record.pages : 0, record.minutes);
    });
  });
  return [...groups.values()].sort((a, b) => b.latestTimestamp.localeCompare(a.latestTimestamp));
};

const EMPTY_SUBJECT_IDS: string[] = [];

export const PomodoroSummary: React.FC<{ pages: number | null; efficiency?: number; attackEfficiency?: number; remainingTaskPages?: number; growth?: React.ReactNode }> = ({ pages, efficiency, attackEfficiency, remainingTaskPages, growth }) => {
  const sessions = remainingTaskPages === undefined ? null : getRemainingPomodoroSessions(remainingTaskPages, pages);
  return <div data-testid="pomodoro-growth-strip" className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 lg:flex-row lg:flex-wrap lg:items-start lg:gap-4">
    <div className="flex max-w-full shrink-0 flex-wrap items-start gap-x-4 gap-y-2">
      <div><p className="text-xs font-bold text-slate-500">뽀모도로</p>
        <p className="mt-1 whitespace-nowrap text-3xl font-black leading-9 tabular-nums text-slate-900">{POMODORO_MINUTES}분</p></div>
      {[{ label: '전체 효율', value: efficiency, testId: 'current-overall-efficiency' },
        { label: '타임어택 효율', value: attackEfficiency, testId: 'current-attack-efficiency' }].map(item => (
        <div key={item.testId} data-testid={item.testId} className="border-l border-slate-200 pl-4">
          <p className="text-xs font-bold text-slate-500">{item.label}</p>
          <p className="mt-1 whitespace-nowrap font-black leading-9 tabular-nums text-emerald-700">
            {item.value && item.value > 0 ? <><span className="text-2xl">{item.value.toFixed(1)}</span><span className="ml-1 text-sm">분/P</span></> : <span className="text-base">측정 필요</span>}
          </p>
        </div>
      ))}
      {sessions !== null && <div className="border-l border-slate-200 pl-4">
        <p className="text-xs font-bold text-slate-500">필요 횟수</p>
        <p className="mt-1 whitespace-nowrap text-2xl font-black leading-9 tabular-nums text-slate-900">{sessions}회</p>
      </div>}
    </div>
    {growth}
  </div>;
};

export const TodaySummary: React.FC<Props> = ({ logs, subjects, detailSubjectId, onDetailSubjectChange, taskSelector, completedStudySubjectIds = EMPTY_SUBJECT_IDS, pomodoroPlan, activeWeekday, activeStudyDate, onAddLog, onReplaceLogs, onDeleteLogs }) => {
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editingSummary, setEditingSummary] = useState<SubjectSummary | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [editEndPage, setEditEndPage] = useState(0);
  const [editMinutes, setEditMinutes] = useState('');
  const [editStartPage, setEditStartPage] = useState(1);
  const [includeReview, setIncludeReview] = useState(true);
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

  const totals = useMemo(() => {
    const time = subjectSummaries.reduce((acc, summary) => acc + summary.minutes, 0);
    const pages = subjectSummaries.reduce((acc, summary) => acc + summary.pages, 0);
    return { time, pages };
  }, [subjectSummaries]);

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
    const activeStagePageCount = activeStage
      ? Math.max(0, activeStage.endPage - activeStage.startPage + 1)
      : 0;
    const activeStageCompletedPages = activeStage
      ? Math.min(
          activeStagePageCount,
          Math.max(0, activeStage.completedPage - activeStage.startPage + 1)
        )
      : 0;
    const activeStageProgress = activeStagePageCount > 0
      ? Math.round((activeStageCompletedPages / activeStagePageCount) * 100)
      : 100;
    const remainingPages = getSubjectRemainingPageCount(subject);
    const efficiency = owner
      ? calculateSubjectReviewAverageTimePerPage(logs, owner.id, subject.id, subject.growthPageUnit)
      : calculateStats(subjectLogs, remainingPages, 0, subject.initialAverageTimePerPage, subject.growthPageUnit).averageTimePerPage;

    const basicReviewTrend = isBasicReviewDetail
      ? calculateBasicReviewEfficiencyByNumber(logs, subject.id)
      : [];


    return {
      subject,
      owner,
      isBasicReviewDetail,
      activeStage,
      activeStagePageCount,
      activeStageCompletedPages,
      activeStageProgress,
      efficiency,
      attackEfficiency: calculateTimeAttackAverage(growthLogs, subject.growthPageUnit),
      reviewStartPage: owner ? dueRepeat ? getRepeatedReviewRange(dueRepeat, subject).startPage : getReviewStartPage(subject) : null,
      pageGrowth: calculatePageUnitGrowth(growthLogs, subject.id, subject.growthPageUnit),
      measuredToday: hasMeasurementOnDate(growthLogs, activeStudyDate),
      reviewSpeedChanges: owner ? calculateReviewSpeedChanges(logs, owner.id, subject.id, activeStudyDate) : null,
      basicReviewTrend,
    };
  }, [activeStudyDate, isBasicReviewDetail, logs, resolvedDetailSubjectId, reviewSubjectOwnerMap, subjects]);

  const openAddModal = () => {
    const firstSubject = selectableSubjects[0];
    setModalMode('add');
    setEditingSummary(null);
    setSubjectId(firstSubject?.id || '');
    setEditMinutes('');
    const start = firstSubject ? (getActiveSubjectStage(firstSubject)?.currentPage || firstSubject.totalPages) : 1;
    setEditStartPage(start);
    setEditEndPage(start);
    setIncludeReview(firstSubject?.reviewEnabled !== false);
    setReviewMemo('');
    setReviewMemoDocument(undefined);
  };

  const openEditModal = (summary: SubjectSummary) => {
    const reviewLogs = summary.logs.filter(log => log.reviewEnabled !== false && !log.isCondensed);
    const savedMemos = Array.from(new Set(
      reviewLogs.map(log => (log.reviewMemo || '').trim()).filter(Boolean)
    ));
    setModalMode('edit');
    setEditingSummary(summary);
    setSubjectId(summary.subjectId);
    setEditMinutes(summary.minutes > 0 ? String(summary.minutes) : '');
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

  const saveLog = () => {
    const pages = calculateAmountFromEndPage(editStartPage, editEndPage);
    const targetSubject = subjects.find(subject => subject.id === subjectId);
    const existingTimedSamples = logs.filter(log => log.subjectId === subjectId);
    const measuredAverage = calculateRecentTimedPageAverage(existingTimedSamples, targetSubject?.growthPageUnit).averageTimePerPage;
    const existingAverage = measuredAverage || Math.max(0, targetSubject?.initialAverageTimePerPage || 0);
    const minutes = editMinutes.trim() === ''
      ? Number((pages * existingAverage).toFixed(2))
      : Number(editMinutes);

    if (!subjectId || pages <= 0 || Number.isNaN(minutes) || minutes < 0) {
      alert('과목, 완료된 끝 페이지, 시간을 확인해주세요.');
      return;
    }

    const retainedReviewLog = editingSummary?.logs
      .filter(log => log.reviewEnabled !== false && !log.isCondensed)
      .sort((a, b) => new Date(a.nextReviewDate || a.timestamp).getTime() - new Date(b.nextReviewDate || b.timestamp).getTime())[0];
    const basicReviewTimeRecords = editingSummary?.logs.flatMap(log => log.basicReviewTimeRecords || []);
    const reviewSubjectTimeRecords = editingSummary?.logs.flatMap(log => log.reviewSubjectTimeRecords || []);

    const replacementLog: StudyLog = {
      id: editingSummary?.logs[0]?.id || Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: pages,
      timeSpentMinutes: minutes,
      startPage: editStartPage,
      endPage: editEndPage,
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
        reviewSubjectTimeRecords
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
    ? pomodoroPlan.pages : getPomodoroPageTarget(detailData.efficiency, getMeasurementRemainingPages(detailData.subject)) : null;
  const calculatedPages = editEndPage > 0 ? calculateAmountFromEndPage(editStartPage, editEndPage) : 0;

  return (
    <section className="animate-fade-in">
      <div className="mb-4">{taskSelector}</div>
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h3 className="flex items-center gap-2 text-base font-black text-slate-800">
          완료된 기록
          <button
            onClick={openAddModal}
            disabled={selectableSubjects.length === 0}
            className="h-7 w-7 rounded-lg bg-indigo-600 text-sm font-black text-white disabled:bg-slate-300"
            title="기록 추가"
          >
            +
          </button>
        </h3>
        <p className="shrink-0 text-sm font-black text-slate-500">
          {formatNumber(totals.pages)}P · {formatNumber(totals.time)}분
        </p>
      </div>

      {subjectSummaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-center text-xs font-bold text-slate-400">
          오늘 완료된 기록이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {subjectSummaries.map(summary => {
            const summarySubject = subjects.find(subject => subject.id === summary.subjectId);
            const showUnitGrowth = summary.kind === 'review' && summarySubject?.reviewGrowthDisplay === 'unit';
            const summaryOwner = reviewSubjectOwnerMap.get(summary.subjectId);
            const unitGrowthLogs = showUnitGrowth && summaryOwner
              ? getReviewEfficiencySamples(logs, summaryOwner.id, summary.subjectId)
                .map((sample, index) => ({ ...sample, id: `completed-growth-${index}`, subjectId: summary.subjectId }))
              : logs;
            const unitGrowth = showUnitGrowth ? calculatePageUnitGrowth(unitGrowthLogs.filter(log => log.timestamp <= summary.latestTimestamp),
              summary.subjectId, summarySubject?.growthPageUnit, summarySubject?.growthComparisonUnits) : null;
            const growthPercent = showUnitGrowth ? unitGrowth?.speedChangePercent : summary.reviewSpeedChangePercent;
            return (
              <div
                key={summary.recordKey}
                role="button"
                tabIndex={0}
                onClick={() => onDetailSubjectChange(summary.detailId)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onDetailSubjectChange(summary.detailId);
                  }
                }}
                className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 transition-all ${
                  detailSubjectId === summary.detailId
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-800">{summary.name}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">최근 7일 <span className="text-slate-700">{formatNumber(summary.weeklyMinutes)}분 · {formatNumber(summary.weeklyPages)}P</span></p>
                  {summary.kind === 'review' && <p className="mt-1 text-xs font-black text-rose-600">
                    {showUnitGrowth ? '페이지 단위 성장' : '이번 복습 증가율'} {growthPercent !== null && growthPercent !== undefined
                      ? `${growthPercent >= 0 ? '+' : ''}${growthPercent.toFixed(1)}%`
                      : '측정 필요'}
                  </p>}
                </div>
                <p className="shrink-0 text-sm font-black text-indigo-600">{formatNumber(summary.pages)}P</p>
                <p className="w-20 shrink-0 text-right text-sm font-black text-slate-600">{formatNumber(summary.minutes)}분</p>
                {summary.kind === 'study' && <div className="flex shrink-0 gap-0.5">
                    <button
                      onClick={event => {
                        event.stopPropagation();
                        openEditModal(summary);
                      }}
                      title="합산 기록 수정"
                      className="p-1 text-slate-300 transition-colors hover:text-indigo-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button
                      onClick={event => {
                        event.stopPropagation();
                        onDeleteLogs(summary.logs.map(log => log.id));
                      }}
                      title="합산 기록 삭제"
                      className="p-1 text-slate-300 transition-colors hover:text-rose-600"
                    >
                      ×
                    </button>
                </div>}
              </div>
            );
          })}
        </div>
      )}

      {detailData && (
        <div id="subject-live-detail" className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
          <div className={`flex flex-wrap items-center justify-between gap-2 ${detailData.isBasicReviewDetail ? 'mb-2' : 'mb-4'}`}>
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-slate-900">
                {detailData.subject.name}{detailData.isBasicReviewDetail ? ' · 기본 복습' : ''}
              </p>
              {detailData.owner && (
                <p className="mt-1 text-[10px] font-black text-rose-500">{detailData.owner.name} 복습과목</p>
              )}
            </div>
          </div>
          {detailData.owner && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-4 py-3">
            <span className="text-sm font-bold text-slate-600">{detailData.reviewStartPage !== null ? `다음 시작 p.${detailData.reviewStartPage}` : '전체 완료'}</span>
          </div>}

          {detailData.isBasicReviewDetail ? (
            <BasicReviewEfficiencyTrend points={detailData.basicReviewTrend} />
          ) : (
            <>
              <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-500">학습 진척도</p>
                    <p className="mt-1 text-base font-black text-slate-900">
                      {detailData.activeStage
                        ? `${detailData.activeStage.name} · p.${formatNumber(detailData.activeStage.startPage)}~${formatNumber(detailData.activeStage.endPage)}`
                        : '전체 완료'}
                    </p>
                  </div>
                  <p className="text-lg font-black text-indigo-600">
                    {detailData.activeStage
                      ? `${formatNumber(detailData.activeStageCompletedPages)} / ${formatNumber(detailData.activeStagePageCount)}P · ${detailData.activeStageProgress}%`
                      : '100%'}
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${detailData.activeStageProgress}%` }}
                  />
                </div>
              </div>
              <PomodoroSummary pages={detailPomodoroPages} efficiency={detailData.efficiency} attackEfficiency={detailData.attackEfficiency} remainingTaskPages={pomodoroPlan?.subjectId === detailData.subject.id
                ? pomodoroPlan.remainingTaskPages : undefined}
                growth={detailData.owner && detailData.subject.reviewGrowthDisplay !== 'unit'
                  ? <ReviewSpeedGrowthCell changes={detailData.reviewSpeedChanges!} measuredToday={detailData.measuredToday} />
                  : <EfficiencyGrowthCell key={detailData.subject.id} growth={detailData.pageGrowth} measuredToday={detailData.measuredToday} />} />

            </>
          )}
        </div>
      )}

      {modalMode && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-[10000]">
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-[2.5rem] bg-white p-8 shadow-2xl animate-fade-in md:p-10">
            <h4 className="text-xl font-black mb-8">{modalMode === 'edit' ? '합산 기록 수정' : '기록 추가'}</h4>
            <div className="space-y-5 mb-10">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">과목</label>
                <select
                  value={subjectId}
                  onChange={e => {
                    const nextSubject = subjects.find(subject => subject.id === e.target.value);
                    setSubjectId(e.target.value);
                    if (modalMode === 'add' && nextSubject) {
                      const start = getActiveSubjectStage(nextSubject)?.currentPage || nextSubject.totalPages;
                      setEditStartPage(start);
                      setEditEndPage(start);
                      setIncludeReview(nextSubject.reviewEnabled !== false);
                      setReviewMemo('');
                      setReviewMemoDocument(undefined);
                    }
                  }}
                  className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg outline-none"
                >
                  <option value="">과목 선택</option>
                  {modalSubjects.map(subject => (
                    <option key={subject.id} value={subject.id}>{subject.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">완료된 끝 페이지</label>
                <input type="number" step="1" value={editEndPage} onChange={e => setEditEndPage(Number(e.target.value))} className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg" />
                <p className="px-1 text-[10px] font-bold text-slate-400">
                  시작 p.{formatNumber(editStartPage)} · 학습량 {calculatedPages > 0 ? formatNumber(calculatedPages) : '0'}P
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">소요 시간(분)</label>
                <input
                  type="number"
                  value={editMinutes}
                  onChange={e => setEditMinutes(e.target.value)}
                  placeholder="비워두면 기존 효율로 자동 계산"
                  className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg"
                />
                <p className="px-1 text-[10px] font-bold text-slate-400">공백이면 해당 과목의 기존 효율로 시간을 계산합니다.</p>
              </div>
              <div className="space-y-2">
                <label className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">복습</label>
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
            <div className="flex gap-3">
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


const BasicReviewEfficiencyTrend = ({ points }: {
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
    speedIncrease: baselineEfficiency > 0 && point.averageTimePerPage > 0
      ? Number((((baselineEfficiency / point.averageTimePerPage) - 1) * 100).toFixed(1))
      : 0,
    pages: point.totalPages,
    samples: point.sampleCount
  }));

  return (
    <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-rose-600">기본 복습 회차별 평균 효율</p>
        <span className="text-[9px] font-black text-rose-400">그래프는 1회 대비 속도 상승</span>
      </div>
      {chartData.length === 0 ? (
        <div className="flex h-36 items-center justify-center text-sm font-black text-rose-200">복습 기록 없음</div>
      ) : (
        <>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {chartData.map(point => (
              <div key={point.review} className="shrink-0 rounded-xl border border-rose-100 bg-white px-3 py-2">
                <p className="text-[9px] font-black text-rose-400">{point.review} 복습</p>
                <p className="mt-0.5 text-base font-black text-rose-600">{formatNumber(point.efficiency)}분/P</p>
              </div>
            ))}
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#fecdd3" />
                <XAxis dataKey="review" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={value => `${value}%`} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(15,23,42,0.12)' }}
                  formatter={(value: number, name: string) => (
                    name === 'speedIncrease'
                      ? [`${Number(value) >= 0 ? '+' : ''}${formatNumber(Number(value))}%`, '속도 상승']
                      : [value, name]
                  )}
                />
                <Line
                  name="속도 상승"
                  type="monotone"
                  dataKey="speedIncrease"
                  stroke="#e11d48"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#e11d48', strokeWidth: 0 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
};
