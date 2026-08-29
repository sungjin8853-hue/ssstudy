import React, { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StudyLog, Subject, TagDefinition } from '../types';
import { calculateRecentTimedPageAverage, calculateStats } from '../utils/math';
import {
  calculateWeeklyRequiredPages,
  getDiffDays,
  getLocalDateKey,
  getLogStudyDate,
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

  const activeWeekdayLabel = WEEKDAYS.find(day => day.id === activeWeekday)?.label || '';
  const selectableSubjects = useMemo(() => (
    subjects.filter(subject => (
      subject.completedPages < subject.totalPages
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
    const subject = subjects.find(item => item.id === detailSubjectId);
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
    const remainingPages = Math.max(0, subject.totalPages - subject.completedPages);
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
    const efficiencyTrend = dayKeys.map(date => {
      const daySamples = weeklySamples.filter(sample => (
        sample.studyDate === date && sample.pagesRead > 0 && sample.timeSpentMinutes > 0
      ));
      const pages = daySamples.reduce((sum, sample) => sum + sample.pagesRead, 0);
      const minutes = daySamples.reduce((sum, sample) => sum + sample.timeSpentMinutes, 0);
      return {
        date,
        label: date.slice(5).replace('-', '/'),
        value: pages > 0 ? minutes / pages : null
      };
    });

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
      const candidateRemaining = Math.max(0, candidate.totalPages - candidate.completedPages);
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
      dailyAveragePages,
      dailyAverageMinutes,
      efficiency,
      weeklyPages,
      weeklyMinutes,
      efficiencyTrend,
      folderName: folder?.name || '미분류',
      folderDailyMinutes
    };
  }, [detailSubjectId, logs, reviewSubjectIdSet, reviewSubjectOwnerMap, subjects, tagDefinitions]);

  const openAddModal = () => {
    const firstSubject = selectableSubjects[0];
    setModalMode('add');
    setEditingSummary(null);
    setSubjectId(firstSubject?.id || '');
    setEditMinutes('');
    const start = firstSubject ? firstSubject.completedPages + 1 : 1;
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-slate-900">{detailData.subject.name}</p>
              {detailData.owner && (
                <p className="mt-1 text-[10px] font-black text-rose-500">{detailData.owner.name} 복습과목</p>
              )}
            </div>
            <p className="text-sm font-black text-emerald-600">
              효율 {detailData.efficiency > 0 ? `${detailData.efficiency.toFixed(1)}분/P` : '-'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <SubjectDataBox label="하루 평균 공부량" value={`${formatNumber(detailData.dailyAveragePages)}P`} color="text-indigo-600" />
            <SubjectDataBox label="하루 평균 공부시간" value={`${formatNumber(detailData.dailyAverageMinutes)}분`} color="text-violet-600" />
            <SubjectDataBox label="최근 7일" value={`${formatNumber(detailData.weeklyMinutes)}분 · ${formatNumber(detailData.weeklyPages)}P`} color="text-slate-900" />
            <SubjectDataBox label={`${detailData.folderName} 하루 평균`} value={`${formatNumber(detailData.folderDailyMinutes)}분`} color="text-amber-600" />
          </div>

          <SubjectEfficiencyTrend points={detailData.efficiencyTrend} />
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
                      const start = nextSubject.completedPages + 1;
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

const SubjectEfficiencyTrend = ({ points }: { points: { date: string; label: string; value: number | null }[] }) => {
  const measuredValues = points.flatMap(point => point.value === null ? [] : [point.value]);
  const averageValue = measuredValues.length > 0
    ? measuredValues.reduce((sum, value) => sum + value, 0) / measuredValues.length
    : 0;
  const chartData = points.map(point => ({
    date: point.label,
    efficiency: point.value === null ? undefined : Number(point.value.toFixed(2)),
    average: measuredValues.length > 0 ? Number(averageValue.toFixed(2)) : undefined
  }));

  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">효율 추이</p>
        <div className="flex items-center gap-3 text-[9px] font-black">
          <span className="flex items-center gap-1 text-blue-600"><i className="h-2 w-2 rounded-full bg-blue-500" />실제 효율</span>
          <span className="flex items-center gap-1 text-rose-500"><i className="h-2 w-2 rounded-full bg-rose-500" />최근 평균</span>
        </div>
      </div>
      {measuredValues.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm font-black text-slate-300">기록 없음</div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" fontSize={9} tickLine={false} axisLine={false} />
              <YAxis fontSize={9} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(15,23,42,0.12)' }}
                formatter={(value: number, name: string) => [`${Number(value).toFixed(2)}분/P`, name === 'efficiency' ? '실제 효율' : '최근 평균']}
              />
              <Line
                name="실제 효율"
                type="monotone"
                dataKey="efficiency"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
              <Line
                name="최근 평균"
                type="monotone"
                dataKey="average"
                stroke="#f43f5e"
                strokeWidth={2.5}
                strokeDasharray="7 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
