import React, { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StudyLog, Subject, TagDefinition } from '../types';
import { calculateBasicReviewEfficiencyByNumber, calculateRecentTimedPageAverage, calculateStats } from '../utils/math';
import { BASIC_REVIEW_DETAIL_PREFIX } from '../utils/review';
import {
  getActiveSubjectStage,
  calculateWeeklyRequiredPages,
  getDiffDays,
  getLocalDateKey,
  getLogStudyDate,
  getSubjectRemainingPageCount,
  normalizeWeekdays,
  parseStudyDate,
  WEEKDAYS
} from '../utils/schedule';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  tagDefinitions: TagDefinition[];
  detailSubjectId: string;
  onDetailSubjectChange: (subjectId: string) => void;
  activeWeekday: number;
  activeStudyDate: string;
  onAddLog: (log: StudyLog) => void;
  onReplaceLogs: (logIds: string[], replacementLog: StudyLog) => void;
  onDeleteLogs: (logIds: string[]) => void;
}

type ModalMode = 'add' | 'edit';

interface SubjectSummary {
  subjectId: string;
  name: string;
  pages: number;
  minutes: number;
  startPage: number;
  endPage: number;
  latestTimestamp: string;
  logs: StudyLog[];
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

export const TodaySummary: React.FC<Props> = ({ logs, subjects, tagDefinitions, detailSubjectId, onDetailSubjectChange, activeWeekday, activeStudyDate, onAddLog, onReplaceLogs, onDeleteLogs }) => {
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editingSummary, setEditingSummary] = useState<SubjectSummary | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [editEndPage, setEditEndPage] = useState(0);
  const [editMinutes, setEditMinutes] = useState('');
  const [editStartPage, setEditStartPage] = useState(1);
  const isBasicReviewDetail = detailSubjectId.startsWith(BASIC_REVIEW_DETAIL_PREFIX);
  const resolvedDetailSubjectId = isBasicReviewDetail
    ? detailSubjectId.slice(BASIC_REVIEW_DETAIL_PREFIX.length)
    : detailSubjectId;

  const activeWeekdayLabel = WEEKDAYS.find(day => day.id === activeWeekday)?.label || '';
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

  const scopedLogs = useMemo(() => (
    logs.filter(log => getLogStudyDate(log) === activeStudyDate)
  ), [activeStudyDate, logs]);

  const totals = useMemo(() => {
    const time = scopedLogs.reduce((acc, log) => acc + log.timeSpentMinutes, 0);
    const pages = scopedLogs.reduce((acc, log) => acc + log.pagesRead, 0);
    const timedPages = scopedLogs
      .filter(log => log.timeSpentMinutes > 0)
      .reduce((acc, log) => acc + log.pagesRead, 0);
    const avgEfficiency = timedPages > 0 ? (time / timedPages).toFixed(1) : '-';
    return { time, pages, avgEfficiency };
  }, [scopedLogs]);

  const subjectSummaries = useMemo(() => {
    const groups = new Map<string, SubjectSummary>();

    scopedLogs.forEach(log => {
      const subject = subjects.find(item => item.id === log.subjectId);
      const existing = groups.get(log.subjectId);
      const startPage = log.startPage ?? 0;
      const endPage = log.endPage ?? 0;

      if (existing) {
        existing.pages += log.pagesRead;
        existing.minutes += log.timeSpentMinutes;
        existing.startPage = Math.min(existing.startPage || startPage, startPage || existing.startPage);
        existing.endPage = Math.max(existing.endPage || endPage, endPage || existing.endPage);
        existing.logs.push(log);
        if (new Date(log.timestamp).getTime() > new Date(existing.latestTimestamp).getTime()) {
          existing.latestTimestamp = log.timestamp;
        }
        return;
      }

      groups.set(log.subjectId, {
        subjectId: log.subjectId,
        name: subject?.name || log.subjectNameSnapshot || '삭제된 과목',
        pages: log.pagesRead,
        minutes: log.timeSpentMinutes,
        startPage,
        endPage,
        latestTimestamp: log.timestamp,
        logs: [log]
      });
    });

    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime()
    );
  }, [scopedLogs, subjects]);

  const reviewSubjectOwnerMap = useMemo(() => {
    const owners = new Map<string, Subject>();
    subjects.forEach(subject => {
      (subject.reviewSubjectIds || []).forEach(reviewSubjectId => {
        if (!owners.has(reviewSubjectId)) owners.set(reviewSubjectId, subject);
      });
    });
    return owners;
  }, [subjects]);

  const reviewSubjectIdSet = useMemo(
    () => new Set(reviewSubjectOwnerMap.keys()),
    [reviewSubjectOwnerMap]
  );

  const detailSubjects = useMemo(() => (
    [...subjects].sort((a, b) => {
      const reviewDifference = Number(reviewSubjectIdSet.has(a.id)) - Number(reviewSubjectIdSet.has(b.id));
      return reviewDifference || a.name.localeCompare(b.name, 'ko');
    })
  ), [reviewSubjectIdSet, subjects]);

  const detailData = useMemo(() => {
    const subject = subjects.find(item => item.id === resolvedDetailSubjectId);
    if (!subject) return null;

    const owner = reviewSubjectOwnerMap.get(subject.id);
    const subjectLogs = logs.filter(log => log.subjectId === subject.id);
    const reviewSamples = logs.flatMap(log => (log.reviewSubjectTimeRecords || [])
      .filter(record => record.subjectId === subject.id)
      .map(record => ({
        pagesRead: record.pages,
        timeSpentMinutes: record.minutes,
        timestamp: record.timestamp,
        studyDate: getLocalDateKey(new Date(record.timestamp))
      })));
    const samples = [
      ...subjectLogs.map(log => ({
        pagesRead: log.pagesRead,
        timeSpentMinutes: log.timeSpentMinutes,
        timestamp: log.timestamp,
        studyDate: getLogStudyDate(log)
      })),
      ...reviewSamples
    ];
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
    const weeklyRequiredPages = calculateWeeklyRequiredPages(remainingPages, getDiffDays(subject.targetDate));
    const dailyAveragePages = weeklyRequiredPages / 7;
    const measuredEfficiency = calculateRecentTimedPageAverage(samples).averageTimePerPage;
    const normalEfficiency = calculateStats(
      subjectLogs,
      remainingPages,
      dailyAveragePages,
      subject.initialAverageTimePerPage
    ).averageTimePerPage;
    const efficiency = measuredEfficiency || normalEfficiency;
    const dailyAverageMinutes = dailyAveragePages * efficiency;

    const todayKey = getLocalDateKey();
    const weekStart = parseStudyDate(todayKey);
    weekStart.setDate(weekStart.getDate() - 6);
    const dayKeys = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      return getLocalDateKey(date);
    });
    const weekStartKey = dayKeys[0];
    const weeklySamples = samples.filter(sample => sample.studyDate >= weekStartKey && sample.studyDate <= todayKey);
    const weeklyPages = weeklySamples.reduce((sum, sample) => sum + Math.max(0, sample.pagesRead), 0);
    const weeklyMinutes = weeklySamples.reduce((sum, sample) => sum + Math.max(0, sample.timeSpentMinutes), 0);
    const monthStart = parseStudyDate(todayKey);
    monthStart.setDate(monthStart.getDate() - 30);
    const monthStartKey = getLocalDateKey(monthStart);
    const monthlyStudyDates = [...new Set(samples
      .filter(sample => (
        sample.studyDate >= monthStartKey
        && sample.studyDate <= todayKey
        && sample.pagesRead > 0
      ))
      .map(sample => sample.studyDate))]
      .sort();
    const efficiencyTrend = monthlyStudyDates.map(date => {
      const daySamples = samples.filter(sample => sample.studyDate === date && sample.pagesRead > 0);
      const timedSamples = daySamples.filter(sample => sample.timeSpentMinutes > 0);
      const timedPages = timedSamples.reduce((sum, sample) => sum + sample.pagesRead, 0);
      const minutes = timedSamples.reduce((sum, sample) => sum + sample.timeSpentMinutes, 0);
      return {
        date,
        label: date.slice(5).replace('-', '/'),
        efficiency: timedPages > 0 ? minutes / timedPages : null,
        studyMinutes: minutes
      };
    });
    const basicReviewTrend = isBasicReviewDetail
      ? calculateBasicReviewEfficiencyByNumber(logs, subject.id)
      : [];

    const folderIds = subject.tagIds?.length ? subject.tagIds : (owner?.tagIds || []);
    const folderId = folderIds[0];
    const folder = tagDefinitions.find(tag => tag.id === folderId);
    const folderSubjects = subjects.filter(candidate => {
      if (reviewSubjectIdSet.has(candidate.id)) return false;
      return folderId
        ? candidate.tagIds?.includes(folderId)
        : !candidate.tagIds || candidate.tagIds.length === 0;
    });
    const folderDailyMinutes = folderSubjects.reduce((sum, candidate) => {
      const candidateLogs = logs.filter(log => log.subjectId === candidate.id);
      const candidateRemaining = getSubjectRemainingPageCount(candidate);
      const candidateWeeklyPages = calculateWeeklyRequiredPages(candidateRemaining, getDiffDays(candidate.targetDate));
      const candidateEfficiency = calculateStats(
        candidateLogs,
        candidateRemaining,
        candidateWeeklyPages / 7,
        candidate.initialAverageTimePerPage
      ).averageTimePerPage;
      return sum + (candidateWeeklyPages / 7) * candidateEfficiency;
    }, 0);

    return {
      subject,
      owner,
      isBasicReviewDetail,
      activeStage,
      activeStagePageCount,
      activeStageCompletedPages,
      activeStageProgress,
      dailyAveragePages,
      dailyAverageMinutes,
      efficiency,
      weeklyPages,
      weeklyMinutes,
      efficiencyTrend,
      basicReviewTrend,
      folderName: folder?.name || '미분류',
      folderDailyMinutes
    };
  }, [isBasicReviewDetail, logs, resolvedDetailSubjectId, reviewSubjectIdSet, reviewSubjectOwnerMap, subjects, tagDefinitions]);

  const openAddModal = () => {
    const firstSubject = selectableSubjects[0];
    setModalMode('add');
    setEditingSummary(null);
    setSubjectId(firstSubject?.id || '');
    setEditMinutes('');
    const start = firstSubject ? (getActiveSubjectStage(firstSubject)?.currentPage || firstSubject.totalPages) : 1;
    setEditStartPage(start);
    setEditEndPage(start);
  };

  const openEditModal = (summary: SubjectSummary) => {
    setModalMode('edit');
    setEditingSummary(summary);
    setSubjectId(summary.subjectId);
    setEditMinutes(summary.minutes > 0 ? String(summary.minutes) : '');
    setEditStartPage(summary.startPage || 1);
    setEditEndPage(summary.endPage || summary.startPage || 1);
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingSummary(null);
  };

  const saveLog = () => {
    const pages = calculateAmountFromEndPage(editStartPage, editEndPage);
    const minutes = editMinutes.trim() === '' ? 0 : Number(editMinutes);

    if (!subjectId || pages <= 0 || Number.isNaN(minutes) || minutes < 0) {
      alert('과목, 완료된 끝 페이지, 시간을 확인해주세요.');
      return;
    }

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
      isReviewed: false,
      isCondensed: editingSummary?.logs.every(log => log.isCondensed) || false
    };

    if (modalMode === 'edit' && editingSummary) {
      onReplaceLogs(editingSummary.logs.map(log => log.id), replacementLog);
    } else {
      onAddLog(replacementLog);
    }

    closeModal();
  };

  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const calculatedPages = editEndPage > 0 ? calculateAmountFromEndPage(editStartPage, editEndPage) : 0;

  return (
    <section className="animate-fade-in">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h3 className="flex items-center gap-2 text-base font-black text-slate-800">
          실시간 기록
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
          {activeWeekdayLabel}요일 기록이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
          {subjectSummaries.map(summary => {
            return (
              <div
                key={summary.subjectId}
                role="button"
                tabIndex={0}
                onClick={() => onDetailSubjectChange(summary.subjectId)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') onDetailSubjectChange(summary.subjectId);
                }}
                className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 transition-all ${
                  detailSubjectId === summary.subjectId
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <p className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{summary.name}</p>
                <p className="shrink-0 text-sm font-black text-indigo-600">{formatNumber(summary.pages)}P</p>
                <p className="w-20 shrink-0 text-right text-sm font-black text-slate-600">{formatNumber(summary.minutes)}분</p>
                <div className="flex shrink-0 gap-0.5">
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 mb-4">
        <select
          value={detailSubjectId}
          onChange={event => onDetailSubjectChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none transition-all focus:border-indigo-400 sm:max-w-sm"
        >
          <option value="">과목 데이터 선택</option>
          {isBasicReviewDetail && detailData && (
            <option value={detailSubjectId}>{detailData.subject.name} · 기본 복습</option>
          )}
          {detailSubjects.map(subject => {
            const owner = reviewSubjectOwnerMap.get(subject.id);
            return (
              <option key={subject.id} value={subject.id}>
                {owner ? `${subject.name} · ${owner.name} 복습` : subject.name}
              </option>
            );
          })}
        </select>
      </div>

      {detailData && (
        <div id="subject-live-detail" className="mb-5 rounded-3xl border border-indigo-100 bg-white p-4 shadow-sm md:p-5">
          <div className={`flex flex-wrap items-center justify-between gap-2 ${detailData.isBasicReviewDetail ? 'mb-2' : 'mb-4'}`}>
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-slate-900">
                {detailData.subject.name}{detailData.isBasicReviewDetail ? ' · 기본 복습' : ''}
              </p>
              {detailData.owner && (
                <p className="mt-1 text-[10px] font-black text-rose-500">{detailData.owner.name} 복습과목</p>
              )}
            </div>
            {!detailData.isBasicReviewDetail && (
              <p className="text-sm font-black text-emerald-600">
                효율 {detailData.efficiency > 0 ? `${detailData.efficiency.toFixed(1)}분/P` : '-'}
              </p>
            )}
          </div>

          {detailData.isBasicReviewDetail ? (
            <BasicReviewEfficiencyTrend points={detailData.basicReviewTrend} />
          ) : (
            <>
              <div className="mb-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400">학습 진척도</p>
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
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${detailData.activeStageProgress}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <SubjectDataBox label="하루 평균 공부량" value={`${formatNumber(detailData.dailyAveragePages)}P`} color="text-indigo-600" />
                <SubjectDataBox label="하루 평균 공부시간" value={`${formatNumber(detailData.dailyAverageMinutes)}분`} color="text-violet-600" />
                <SubjectDataBox label="최근 7일" value={`${formatNumber(detailData.weeklyMinutes)}분 · ${formatNumber(detailData.weeklyPages)}P`} color="text-slate-900" />
                <SubjectDataBox label={`${detailData.folderName} 하루 평균`} value={`${formatNumber(detailData.folderDailyMinutes)}분`} color="text-amber-600" />
              </div>

              <SubjectEfficiencyTrend points={detailData.efficiencyTrend} />
            </>
          )}
        </div>
      )}

      {modalMode && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-[10000]">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl animate-fade-in">
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
                  placeholder="비워두면 효율 계산 제외"
                  className="w-full p-4 bg-slate-50 rounded-2xl font-black text-center text-lg"
                />
                <p className="px-1 text-[10px] font-bold text-slate-400">공백이면 평균효율과 소모시간에 반영되지 않습니다.</p>
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

const SubjectDataBox = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div className="min-w-0 rounded-2xl bg-slate-50 px-3 py-3">
    <p className="truncate text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-1 truncate text-lg font-black ${color}`}>{value}</p>
  </div>
);

const SubjectEfficiencyTrend = ({ points }: {
  points: { date: string; label: string; efficiency: number | null; studyMinutes: number }[];
}) => {
  const measuredValues = points.flatMap(point => point.efficiency === null ? [] : [point.efficiency]);
  const chartData = points.map(point => ({
    date: point.label,
    efficiency: point.efficiency === null ? undefined : Number(point.efficiency.toFixed(2)),
    studyMinutes: Number(point.studyMinutes.toFixed(2))
  }));

  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">최근 한 달 학습 추이</p>
        <div className="flex items-center gap-3 text-[9px] font-black">
          <span className="flex items-center gap-1 text-blue-600"><i className="h-2 w-2 rounded-full bg-blue-500" />효율</span>
          <span className="flex items-center gap-1 text-red-600"><i className="h-2 w-2 rounded-full bg-red-500" />공부시간</span>
        </div>
      </div>
      {measuredValues.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm font-black text-slate-300">기록 없음</div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 2, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" fontSize={9} tickLine={false} axisLine={false} />
              <YAxis yAxisId="efficiency" fontSize={9} tickLine={false} axisLine={false} tickFormatter={value => `${value}`} />
              <YAxis
                yAxisId="minutes"
                orientation="right"
                width={38}
                fontSize={9}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#dc2626' }}
                tickFormatter={value => `${value}분`}
              />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(15,23,42,0.12)' }}
                formatter={(value: number, name: string) => (
                  name === 'studyMinutes'
                    ? [`${formatNumber(Number(value))}분`, '공부시간']
                    : [`${Number(value).toFixed(2)}분/P`, '효율']
                )}
              />
              <Line
                name="실제 효율"
                type="monotone"
                dataKey="efficiency"
                yAxisId="efficiency"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
              <Line
                name="공부시간"
                type="monotone"
                dataKey="studyMinutes"
                yAxisId="minutes"
                stroke="#dc2626"
                strokeWidth={3}
                dot={{ r: 4, fill: '#dc2626', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
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
  const chartData = points.map(point => ({
    review: `${point.reviewNumber}회`,
    efficiency: Number(point.averageTimePerPage.toFixed(2)),
    pages: point.totalPages,
    samples: point.sampleCount
  }));

  return (
    <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-rose-600">기본 복습 회차별 평균 효율</p>
        <span className="text-[9px] font-black text-rose-400">낮을수록 빠름</span>
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
                <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={value => `${value}`} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(15,23,42,0.12)' }}
                  formatter={(value: number, name: string) => (
                    name === 'efficiency'
                      ? [`${formatNumber(Number(value))}분/P`, '평균 효율']
                      : [value, name]
                  )}
                />
                <Line
                  name="평균 효율"
                  type="monotone"
                  dataKey="efficiency"
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
