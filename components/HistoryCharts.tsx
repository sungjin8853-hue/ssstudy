import React, { useMemo, useState } from 'react';
import { Subject, StudyLog } from '../types';
import { formatSignedTenth, getUnitSpeedTrend } from '../utils/pageGrowth';
import { registrationBoundaries, reviewCompletionBoundaries } from '../utils/reviewUnits';
import { buildSpeedSeries, SpeedSeries, TREND_WINDOW_MINUTES } from '../utils/speedGrowth';
import { getPageLabel } from '../utils/pageLabel';
import {
  buildCumulativeStudy,
  buildPlanCheck,
  buildReviewRoundEfficiency,
  buildStudyCalendar,
  buildSubjectCumulative,
  buildSubjectWeeklyMinutes,
  buildWeekdayPattern,
  buildWeeklyStudy,
  calculateStudyStreak,
  withReviewTimeLogs,
  CalendarDay,
  formatMinutesShort,
  PlanCheck,
  PlanStatus,
  SubjectCumulativePoint,
  SubjectCumulativeSeries,
  summarizeReview,
  summarizeTimeSplit
} from '../utils/studyReport';
import {
  getAllSubjectReviewIds,
  getDiffDays,
  getSubjectStages,
  getSubjectCompletedPageCount,
  getSubjectTotalPageCount
} from '../utils/schedule';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
}

interface Summary {
  id: string;
  name: string;
  totalPages: number;
  totalMinutes: number;
  averageEfficiency: number;
  sessionCount: number;
  latestTimestamp: number;
}

interface FolderGroup {
  id: string;
  name: string;
  summary: Summary;
  subjects: Summary[];
}

type TableRange = 'month' | 'all';

/** 속도 추이에서 고르는 한 줄: 과목 하나의 한 단계(과목 자신 또는 후행과목) */
interface TrendItem {
  id: string;
  label: string;
  /** 복습과목이면 단위가 복습 한 번, 아니면 "복습에 넣기" 사이 */
  isReview: boolean;
  pageLabel: string;
  /** 페이지 단위를 채울 때마다 한 점(첫 단위 대비 %) */
  unitPoints: Array<{ timestamp: number; date: string; speedIncrease: number; efficiency: number; complete: boolean }>;
  /** 공부한 시간 1시간마다 한 점(P/h) */
  speed: SpeedSeries;
  latest: number;
}

const signed = (value: number, digits = 0) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

const INDIGO = '#4f46e5';
const INDIGO_SOFT = '#a5b4fc';
const SOLVE_COLOR = '#6366f1';
const ORGANIZE_COLOR = '#fbbf24';

/** 분 눈금: 최대값에 맞춰 눈금이 5개 안팎이 되는 간격(30분·1시간·2시간 …)으로 */
const minuteTicks = (maxMinutes: number) => {
  const step = [30, 60, 120, 180, 300, 600, 1200, 3000].find(candidate => maxMinutes / candidate <= 4) ?? 6000;
  return Array.from({ length: Math.ceil(Math.max(maxMinutes, step) / step) + 1 }, (_, index) => index * step);
};

const formatMinuteTick = (value: number) => (
  value === 0 ? '0' : value % 60 === 0 ? `${value / 60}h` : value > 60 ? `${Math.floor(value / 60)}h30` : `${value}m`
);

/** 과목별 색: 쌓인 시간이 많은 순서대로 고정(과목이 바뀌어도 순서가 곧 색). "기타"는 회색. */
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const;
const seriesColor = (item: SubjectCumulativeSeries, index: number) => (item.id === '__other' ? '#cbd5e1' : SERIES_COLORS[index % SERIES_COLORS.length]);

const CALENDAR_LEVEL_CLASS = ['bg-slate-100', 'bg-indigo-200', 'bg-indigo-400', 'bg-indigo-600', 'bg-indigo-800'] as const;

export const HistoryCharts: React.FC<Props> = ({ subjects, logs }) => {
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(new Set());
  const [tableRange, setTableRange] = useState<TableRange>('month');
  const [pickedSubjectId, setPickedSubjectId] = useState<string | null>(null);
  const [pickedDayKey, setPickedDayKey] = useState<string | null>(null);


  const now = useMemo(() => new Date(), [logs]);
  // 시간 그래프에는 기록 안에만 남는 기본 복습 · 복습과목 시간도 그날의 공부로 넣는다(오늘 할 일의 "오늘 완료"와 같게)
  const timeLogs = useMemo(() => withReviewTimeLogs(logs), [logs]);
  const streak = useMemo(() => calculateStudyStreak(timeLogs, now), [timeLogs, now]);
  const split = useMemo(() => summarizeTimeSplit(timeLogs, 30, now), [timeLogs, now]);
  const review = useMemo(() => summarizeReview(logs, 30, now), [logs, now]);
  const cumulative = useMemo(() => buildCumulativeStudy(timeLogs, now, 26), [timeLogs, now]);
  // 주별 그래프는 처음 기록부터(최소 8주, 최대 26주)
  const weekly = useMemo(() => buildWeeklyStudy(timeLogs, Math.min(26, Math.max(8, cumulative.points.length)), now), [timeLogs, now, cumulative.points.length]);
  const calendar = useMemo(() => buildStudyCalendar(timeLogs, 13, now), [timeLogs, now]);
  const weekdayPattern = useMemo(() => buildWeekdayPattern(timeLogs, 12, now), [timeLogs, now]);
  const reviewRounds = useMemo(() => buildReviewRoundEfficiency(logs), [logs]);
  const subjectCumulative = useMemo(() => buildSubjectCumulative(timeLogs,
    (id, log) => subjects.find(item => item.id === id)?.name || log.subjectNameSnapshot || '삭제된 과목', now, 26, 5), [timeLogs, subjects, now]);
  const subjectWeekly = useMemo(() => buildSubjectWeeklyMinutes(timeLogs, 12, now), [timeLogs, now]);

  const weeklyMax = weekly.points.reduce((max, point) => Math.max(max, point.minutes), 0);
  const weeklyTicks = minuteTicks(weeklyMax);
  // 네 주 이동 평균: 끝난 주 네 개의 평균(이번 주는 아직 끝나지 않아 뺀다)
  const weeklyData = weekly.points.map((point, index, list) => ({
    ...point,
    average: index >= 3 && !point.isCurrent ? Math.round(list.slice(index - 3, index + 1).reduce((sum, item) => sum + item.minutes, 0) / 4) : null
  }));
  const bestWeekday = weekdayPattern.reduce((best, point) => (point.averageMinutes > best.averageMinutes ? point : best), weekdayPattern[0]);
  const weekdayMax = Math.max(1, ...weekdayPattern.map(point => point.averageMinutes));


  // 속도 추이: 과목마다, 후행과목이 있으면 단계마다 따로(앞 단계의 기록과 섞이면 첫 단위·첫 1시간 대비가 뜻을 잃는다)
  const trendItems = useMemo<TrendItem[]>(() => {
    const groups = new Map<string, { subjectId: string; stageId: string; logs: StudyLog[] }>();
    logs.forEach(log => {
      const subject = subjects.find(item => item.id === log.subjectId);
      const isFollowUpStage = Boolean(log.subjectStageId && subject?.followUpSubjects?.some(stage => stage.id === log.subjectStageId));
      const stageId = isFollowUpStage ? log.subjectStageId! : log.subjectId;
      const key = `${log.subjectId}::${stageId}`;
      const group = groups.get(key) || { subjectId: log.subjectId, stageId, logs: [] };
      group.logs.push(log);
      groups.set(key, group);
    });
    return Array.from(groups.entries()).map(([key, group]) => {
      const subject = subjects.find(item => item.id === group.subjectId);
      const subjectName = subject?.name || group.logs.find(log => log.subjectNameSnapshot)?.subjectNameSnapshot || '삭제된 과목';
      const stageName = group.stageId !== group.subjectId
        ? subject?.followUpSubjects?.find(stage => stage.id === group.stageId)?.name
          || group.logs.find(log => log.subjectStageNameSnapshot)?.subjectStageNameSnapshot || '후행과목'
        : null;
      // 단위: 학습과목은 "복습에 넣기" 사이, 복습과목(복습 세션 기록)은 복습 한 번
      const parentId = group.logs.find(log => log.reviewParentSubjectId)?.reviewParentSubjectId;
      const boundaries = parentId ? reviewCompletionBoundaries(logs, parentId, group.subjectId)
        : registrationBoundaries(logs.filter(log => log.subjectId === group.subjectId));
      const unitPoints = getUnitSpeedTrend(group.logs, boundaries).map(point => {
        const time = Date.parse(point.timestamp);
        return {
          timestamp: time,
          date: new Date(time).toLocaleDateString('ko-KR', { day: 'numeric', month: 'short' }),
          speedIncrease: Number(point.speedIncrease.toFixed(1)),
          efficiency: Number(point.unit.averageTimePerPage.toFixed(2)),
          complete: point.unit.complete
        };
      });
      const speed = buildSpeedSeries(group.logs, { timeAttack: true, windowMinutes: TREND_WINDOW_MINUTES });
      const latest = group.logs.reduce((max, log) => Math.max(max, Date.parse(log.timestamp) || 0), 0);
      return {
        id: key, label: stageName ? `${subjectName} · ${stageName}` : subjectName, isReview: Boolean(parentId),
        pageLabel: getPageLabel(subject), unitPoints, speed, latest
      };
    }).filter(item => item.unitPoints.length > 0 || item.speed.points.length > 0)
      .sort((a, b) => (b.speed.points.length + b.unitPoints.length) - (a.speed.points.length + a.unitPoints.length) || b.latest - a.latest);
  }, [logs, subjects]);

  const selectedTrend = trendItems.find(item => item.id === pickedSubjectId) || trendItems[0] || null;
  const unitPoints = selectedTrend ? selectedTrend.unitPoints.slice(-24) : [];
  const unitLast = unitPoints[unitPoints.length - 1];
  const unitFirst = unitPoints[0];
  const unitBest = unitPoints.reduce((best, point) => Math.max(best, point.speedIncrease), -Infinity);
  const speedPoints = selectedTrend ? selectedTrend.speed.points : [];
  const speedFit = useMemo(() => {
    const slope = selectedTrend?.speed.acceleration ?? null;
    if (slope === null || speedPoints.length < 2) return null;
    const meanX = speedPoints.reduce((sum, point) => sum + point.hours, 0) / speedPoints.length;
    const meanY = speedPoints.reduce((sum, point) => sum + point.speed, 0) / speedPoints.length;
    return (hours: number) => meanY + slope * (hours - meanX);
  }, [selectedTrend, speedPoints]);
  const speedData = speedPoints.map(point => ({ hours: Number(point.hours.toFixed(2)), speed: Number(point.speed.toFixed(2)), fit: speedFit ? Number(speedFit(point.hours).toFixed(2)) : null, date: point.dateKey }));
  const speedFirst = speedPoints[0];


  // 계획 점검: 과목마다 최근 4주 페이스를 이어가면 목표일에 맞는지 (복습 과목·후행 과목 원본은 제외). 고쳐야 할 과목이 위로 온다.
  const planRows = useMemo(() => {
    const reviewIds = new Set(subjects.flatMap(getAllSubjectReviewIds));
    const followUpSources = new Set(subjects.flatMap(subject => (subject.followUpSubjects || [])
      .map(stage => stage.sourceSubjectId).filter((id): id is string => Boolean(id))));
    const minutesBySubject = new Map<string, number>();
    timeLogs.forEach(log => minutesBySubject.set(log.subjectId, (minutesBySubject.get(log.subjectId) || 0) + (Number.isFinite(log.timeSpentMinutes) ? Math.max(0, log.timeSpentMinutes) : 0)));
    const totalMinutes = Array.from(minutesBySubject.values()).reduce((sum, value) => sum + value, 0);
    return subjects
      .filter(subject => !reviewIds.has(subject.id) && !followUpSources.has(subject.id))
      .map(subject => {
        const total = getSubjectTotalPageCount(subject);
        const done = getSubjectCompletedPageCount(subject);
        const stages = getSubjectStages(subject).map(stage => {
          // 단원이 있는 단계는 단원 사이 빈 페이지를 세지 않는다
          if (stage.chapter) return { id: stage.id, name: stage.name, pages: stage.pageCount, done: stage.completedCount, status: stage.status, isFollowUp: stage.isFollowUp };
          const pages = Math.max(0, stage.endPage - stage.startPage + 1);
          return { id: stage.id, name: stage.name, pages, done: Math.min(pages, Math.max(0, stage.completedPage - stage.startPage + 1)), status: stage.status, isFollowUp: stage.isFollowUp };
        }).filter(stage => stage.pages > 0);
        const diffDays = subject.targetDate ? getDiffDays(subject.targetDate, now) : null;
        const check = buildPlanCheck({ logs: logs.filter(log => log.subjectId === subject.id), remainingPages: total - done, diffDays, now });
        const minutes = minutesBySubject.get(subject.id) || 0;
        return {
          id: subject.id, name: subject.name, pageLabel: getPageLabel(subject), total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0,
          diffDays, stages, check, minutes, minutesPercent: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
          weekly: subjectWeekly.get(subject.id) || Array(12).fill(0) as number[]
        };
      })
      .filter(row => row.total > 0)
      .sort((a, b) => PLAN_ORDER[a.check.status] - PLAN_ORDER[b.check.status]
        || (b.check.gapDays ?? 0) - (a.check.gapDays ?? 0) || (a.diffDays ?? 9999) - (b.diffDays ?? 9999) || a.name.localeCompare(b.name));
  }, [subjects, logs, timeLogs, now, subjectWeekly]);
  const planCounts = useMemo(() => {
    const counts: Record<PlanStatus, number> = { late: 0, idle: 0, ontrack: 0, ahead: 0, nodate: 0, done: 0 };
    planRows.forEach(row => { counts[row.check.status] += 1; });
    return counts;
  }, [planRows]);

  const buildSummary = (items: StudyLog[], id: string, name: string): Summary => {
    const totalPages = items.reduce((sum, log) => sum + log.pagesRead, 0);
    const totalMinutes = items.reduce((sum, log) => sum + log.timeSpentMinutes, 0);
    const timedItems = items.filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0);
    const timedPages = timedItems.reduce((sum, log) => sum + log.pagesRead, 0);
    const timedMinutes = timedItems.reduce((sum, log) => sum + log.timeSpentMinutes, 0);
    const latestTimestamp = items.reduce(
      (latest, log) => Math.max(latest, new Date(log.timestamp).getTime()),
      0
    );

    return {
      id,
      name,
      totalPages,
      totalMinutes,
      averageEfficiency: timedPages > 0 ? timedMinutes / timedPages : 0,
      sessionCount: items.length,
      latestTimestamp
    };
  };

  const sortByVolume = (a: Summary, b: Summary) =>
    b.totalMinutes - a.totalMinutes || a.name.localeCompare(b.name);

  const sortByLatest = (a: Summary, b: Summary) =>
    b.latestTimestamp - a.latestTimestamp || a.name.localeCompare(b.name);

  const buildGroupedData = (startTimestamp?: number, orderByLatest = false) => {
    const scopedLogs = startTimestamp
      ? logs.filter(log => new Date(log.timestamp).getTime() >= startTimestamp)
      : logs;

    const folderMap = new Map<string, { id: string; name: string }>();
    scopedLogs.forEach(log => {
      (log.folderSnapshots || []).forEach(folder => {
        if (!folderMap.has(folder.id)) folderMap.set(folder.id, { id: folder.id, name: folder.name });
      });
    });

    const folderGroups: FolderGroup[] = Array.from(folderMap.values()).map(folder => {
      const folderLogs = scopedLogs.filter(log =>
        (log.folderSnapshots || []).some(snapshot => snapshot.id === folder.id)
      );
      const subjectIds = new Set(folderLogs.map(log => log.subjectId));

      const subjectRows = Array.from(subjectIds).map(subjectId => {
        const subject = subjects.find(item => item.id === subjectId);
        const subjectLogs = folderLogs.filter(log => log.subjectId === subjectId);
        const name = subject?.name || subjectLogs[0]?.subjectNameSnapshot || '삭제된 과목';
        return buildSummary(subjectLogs, subjectId, name);
      }).sort(orderByLatest ? sortByLatest : sortByVolume);

      return {
        id: folder.id,
        name: folder.name,
        summary: buildSummary(folderLogs, folder.id, folder.name),
        subjects: subjectRows
      };
    }).filter(group => group.subjects.length > 0)
      .sort((a, b) => orderByLatest
        ? sortByLatest(a.summary, b.summary)
        : sortByVolume(a.summary, b.summary)
      );

    const rootLogIds = scopedLogs
      .filter(log => !log.folderSnapshots || log.folderSnapshots.length === 0)
      .map(log => log.subjectId);
    const rootSubjectIds = new Set(rootLogIds);

    const rootSubjects = Array.from(rootSubjectIds).map(subjectId => {
      const subject = subjects.find(item => item.id === subjectId);
      const subjectLogs = scopedLogs.filter(log =>
        log.subjectId === subjectId && (!log.folderSnapshots || log.folderSnapshots.length === 0)
      );
      const name = subject?.name || subjectLogs[0]?.subjectNameSnapshot || '삭제된 과목';
      return buildSummary(subjectLogs, subjectId, name);
    }).sort(orderByLatest ? sortByLatest : sortByVolume);

    return { folderGroups, rootSubjects };
  };

  const monthlyData = useMemo(() => {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - 29);
    return buildGroupedData(startDate.getTime());
  }, [logs, subjects]);

  const allTimeData = useMemo(
    () => buildGroupedData(undefined, true),
    [logs, subjects]
  );

  const toggleFolder = (key: string) => {
    setExpandedFolderKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickedDay = pickedDayKey ? calendar.columns.flat().find(day => day.key === pickedDayKey) || null : null;

  return (
    <div className="space-y-8" data-report="history">
      {/* 1. 계획 점검: 지금 페이스로 목표일에 맞는지 (고쳐야 할 과목이 위로) */}
      <section aria-label="계획 점검" className="space-y-3">
        <SectionLabel index={1} title="계획 점검" hint="최근 4주 페이스로 목표일에 맞는지" />
        <ReportCard title="과목별 계획 점검" testId="plan-card" aside={<PlanSummary counts={planCounts} />}>
          {planRows.length > 0 ? (
            <div>
              <div className={`hidden gap-x-6 border-b border-slate-200 px-1 pb-2 text-[13px] font-bold text-slate-500 md:grid ${PLAN_COLUMNS}`}>
                <span>과목</span><span>진행</span><span>쌓인 시간</span><span>주당 페이스</span>
              </div>
              <ul className="divide-y divide-slate-100" aria-label="과목별 계획 점검">
                {planRows.map(row => <PlanRowView key={row.id} row={row} />)}
              </ul>
            </div>
          ) : <EmptyNote>과목을 등록하면 계획 점검이 나타납니다.</EmptyNote>}
        </ReportCard>
      </section>

      {/* 2. 쌓인 시간: 과목별로 어디에 시간이 쌓였는지 */}
      <section aria-label="쌓인 시간" className="space-y-3">
        <SectionLabel index={2} title="쌓인 시간" hint="어느 과목에 시간이 쌓였는지" />
        <ReportCard title="과목별 쌓인 시간" testId="cumulative-card"
          aside={cumulative.firstDateKey ? <span className="text-[13px] font-bold text-slate-500">{cumulative.firstDateKey.replace(/-/g, '.')}부터</span> : undefined}>
          {subjectCumulative.series.length > 0 ? (
            <>
              <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <BigStat label="누적 학습 시간" value={formatMinutesShort(cumulative.totalMinutes)} accent="text-indigo-600" />
                <BigStat label="누적 페이지" value={String(Math.round(cumulative.totalPages * 10) / 10)} unit="P" accent="text-emerald-500" />
                <BigStat label="학습한 날" value={String(cumulative.studyDays)} unit="일" accent="text-amber-500" />
                <BigStat label="공부한 날 평균" value={formatMinutesShort(cumulative.studyDays > 0 ? cumulative.totalMinutes / cumulative.studyDays : 0)} accent="text-sky-600" />
              </div>
              <div className="grid gap-x-8 gap-y-5 lg:grid-cols-12">
                <div className="h-64 min-w-0 lg:col-span-7">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={subjectCumulative.points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf4" />
                      <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" minTickGap={18} />
                      <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" tickFormatter={value => `${Math.round(Number(value))}h`} width={48} domain={[0, 'auto']} />
                      <Tooltip content={<ChartTip render={(point: SubjectCumulativePoint) => ({
                        title: `${point.label} 주까지`,
                        rows: [
                          ...[...subjectCumulative.series].reverse().map(item => ({
                            color: seriesColor(item, subjectCumulative.series.indexOf(item)), label: item.name, value: formatMinutesShort(Number(point[item.key]) * 60)
                          })),
                          { color: '#475569', label: '합계', value: formatMinutesShort(subjectCumulative.series.reduce((sum, item) => sum + Number(point[item.key]), 0) * 60) }
                        ]
                      })} />} />
                      {subjectCumulative.series.map((item, index) => (
                        <Area key={item.key} type="monotone" dataKey={item.key} stackId="subjects" stroke="#ffffff" strokeWidth={1.5}
                          fill={seriesColor(item, index)} fillOpacity={0.92} isAnimationActive={false} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-0 space-y-3.5 lg:col-span-5" aria-label="과목별 학습 시간">
                  {subjectCumulative.series.map((item, index) => {
                    const change = item.recentMinutes - item.previousMinutes;
                    return (
                      <li key={item.key} data-testid="share-row" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
                        <i className="h-3 w-3 rounded-full" style={{ background: seriesColor(item, index) }} aria-hidden="true" />
                        <span className="truncate text-[15px] font-black text-slate-700" title={item.name}>{item.name}</span>
                        <span className="whitespace-nowrap text-right text-[15px] font-bold text-slate-600"><b className="font-black text-slate-900">{item.percent}%</b> · {formatMinutesShort(item.totalMinutes)}</span>
                        <span />
                        <span className="col-span-2 text-[13px] font-bold text-slate-400">
                          최근 4주 {formatMinutesShort(item.recentMinutes)}
                          {change !== 0 && <b className={`ml-1.5 font-black ${change > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{change > 0 ? '▲' : '▼'} {formatMinutesShort(Math.abs(change))}</b>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : <EmptyNote>학습을 기록하면 쌓인 시간이 그려져요.</EmptyNote>}
        </ReportCard>
      </section>

      {/* 3. 학습 리듬: 주별 · 달력 · 요일 */}
      <section aria-label="학습 리듬" className="space-y-3">
        <SectionLabel index={3} title="학습 리듬" hint="언제, 얼마나 꾸준했는지" />
        <div className="grid gap-5 lg:grid-cols-12">
          <ReportCard title="주별 학습 시간" className="lg:col-span-7" testId="weekly-card"
            aside={<span className="text-[13px] font-bold text-slate-500">최근 {weekly.points.length}주 · 주 평균 <b className="text-lg font-black text-indigo-600">{formatMinutesShort(weekly.averageMinutes)}</b></span>}>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-bold text-slate-500">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: SOLVE_COLOR }} />풀이</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: ORGANIZE_COLOR }} />정리</span>
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 rounded bg-slate-700" />4주 평균</span>
              {split.solveShare !== null && <span className="ml-auto text-slate-400">최근 30일 풀이 <b className="text-slate-700">{Math.round(split.solveShare)}%</b> · 정리 <b className="text-slate-700">{Math.round(100 - split.solveShare)}%</b></span>}
            </div>
            <div className="h-[19rem]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weeklyData} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf4" />
                  <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" interval="preserveStartEnd" minTickGap={14} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" ticks={weeklyTicks} domain={[0, weeklyTicks[weeklyTicks.length - 1]]} tickFormatter={formatMinuteTick} width={52} />
                  <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }} content={<ChartTip render={(point: typeof weeklyData[number]) => ({
                    title: `${point.label} 주${point.isCurrent ? ' (이번 주)' : ''}`,
                    rows: [{ color: SOLVE_COLOR, label: '풀이', value: formatMinutesShort(point.solveMinutes) }, { color: ORGANIZE_COLOR, label: '정리', value: formatMinutesShort(point.organizeMinutes) },
                      { color: '#475569', label: '합계', value: `${formatMinutesShort(point.minutes)} · ${Math.round(point.pages * 10) / 10}P` },
                      ...(point.average !== null ? [{ color: '#334155', label: '4주 평균', value: formatMinutesShort(point.average) }] : [])]
                  })} />} />
                  <Bar dataKey="solveMinutes" stackId="week" fill={SOLVE_COLOR} stroke="#ffffff" strokeWidth={1.5} isAnimationActive={false} />
                  <Bar dataKey="organizeMinutes" stackId="week" fill={ORGANIZE_COLOR} stroke="#ffffff" strokeWidth={1.5} radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  <Line type="monotone" dataKey="average" stroke="#334155" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ReportCard>

          <ReportCard title="학습 달력" className="lg:col-span-5" testId="calendar-card"
            aside={<span className="text-[13px] font-bold text-slate-500">연속 <b className="text-indigo-600">{streak.current}일</b> · 최장 {streak.best}일</span>}>
            <CalendarHeat calendar={calendar} pickedKey={pickedDayKey} onPick={key => setPickedDayKey(current => (current === key ? null : key))} />
            <div className="mt-3 flex min-h-[2.25rem] flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p data-testid="calendar-readout" className="text-sm font-bold text-slate-600">
                {pickedDay ? <>
                  <span className="text-slate-900">{pickedDay.label} ({pickedDay.weekday})</span>
                  {' · '}{pickedDay.minutes > 0 ? <>{formatMinutesShort(pickedDay.minutes)} · {Math.round(pickedDay.pages * 10) / 10}P</> : '기록 없음'}
                </> : <>최근 {calendar.columns.length}주 <b className="text-slate-900">{calendar.studiedDays}일</b> 공부 · 평균 <b className="text-slate-900">{formatMinutesShort(calendar.studiedDays > 0 ? calendar.totalMinutes / calendar.studiedDays : 0)}</b></>}
              </p>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400" aria-hidden="true">
                적게
                {CALENDAR_LEVEL_CLASS.map(cls => <i key={cls} className={`h-3.5 w-3.5 rounded-[4px] ${cls}`} />)}
                많이
              </div>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4" data-testid="weekday-card">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
                <h4 className="text-[15px] font-black text-slate-700">요일별 학습 시간</h4>
                <span className="text-[13px] font-bold text-slate-500">최근 12주 평균{bestWeekday && bestWeekday.averageMinutes > 0 ? <> · <b className="text-indigo-600">{bestWeekday.label}요일</b>이 가장 많아요</> : null}</span>
              </div>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayPattern} margin={{ top: 22, right: 8, bottom: 0, left: 8 }}>
                    <XAxis dataKey="label" fontSize={14} fontWeight={700} tickLine={false} axisLine={false} stroke="#475569" />
                    <YAxis hide domain={[0, weekdayMax * 1.05]} />
                    <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }} content={<ChartTip render={(point: typeof weekdayPattern[number]) => ({
                      title: `${point.label}요일`,
                      rows: [{ color: INDIGO, label: '평균', value: formatMinutesShort(point.averageMinutes) }, { color: INDIGO_SOFT, label: '12주 합계', value: formatMinutesShort(point.totalMinutes) }]
                    })} />} />
                    <Bar dataKey="averageMinutes" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                      {weekdayPattern.map(point => <Cell key={point.weekday} fill={bestWeekday && point.weekday === bestWeekday.weekday && point.averageMinutes > 0 ? INDIGO : INDIGO_SOFT} />)}
                      <LabelList dataKey="averageMinutes" position="top" fontSize={12} fontWeight={700} fill="#475569"
                        formatter={(value: number) => (value > 0 ? formatMinutesShort(value) : '')} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </ReportCard>
        </div>
      </section>

      {/* 4. 속도와 복습 */}
      <section aria-label="속도와 복습" className="space-y-3">
        <SectionLabel index={4} title="속도와 복습" hint="같은 시간에 얼마나 더 푸는지" />
          {/* 4. 속도 추이: 공부한 시간 1시간마다의 속도(P/h)와 가속도, 그리고 단위별 속도 상승 */}
        <ReportCard title="속도 추이" testId="speed-card"
          aside={trendItems.length > 1 ? (
            <div role="tablist" aria-label="추이 과목" className="flex flex-wrap justify-end gap-1.5">
              {trendItems.slice(0, 8).map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={selectedTrend?.id === item.id}
                  onClick={() => setPickedSubjectId(item.id)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ${selectedTrend?.id === item.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                  {item.label}
                </button>
              ))}
            </div>
          ) : selectedTrend ? <span className="rounded-full bg-slate-100 px-3.5 py-1.5 text-[13px] font-bold text-slate-500">{selectedTrend.label}</span> : null}>
          {selectedTrend ? (
            <div className="grid gap-x-8 gap-y-6 lg:grid-cols-5">
              <div className="min-w-0 lg:col-span-3" data-testid="speed-25">
                <p className="mb-2 text-[15px] font-black text-slate-700">공부 1시간마다의 속도</p>
                {speedPoints.length > 0 ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-end gap-x-7 gap-y-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-500">지금 속도</p>
                        <p className="text-4xl font-black tabular-nums leading-none text-indigo-600" data-trend="speed">{selectedTrend.speed.latestSpeed!.toFixed(1)}<span className="ml-1 text-base font-bold opacity-60">{selectedTrend.pageLabel}/h</span></p>
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-slate-500">최근 증가</p>
                        <p className={`text-2xl font-black tabular-nums leading-none ${(selectedTrend.speed.latestGrowth ?? 0) >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {selectedTrend.speed.latestGrowth === null ? '-' : formatSignedTenth(selectedTrend.speed.latestGrowth)}<span className="ml-0.5 text-sm font-bold opacity-60">{selectedTrend.pageLabel}/h</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-slate-500">공부 1시간마다</p>
                        <p className={`text-2xl font-black tabular-nums leading-none ${(selectedTrend.speed.acceleration ?? 0) >= 0 ? 'text-emerald-600' : 'text-amber-600'}`} data-trend="acceleration">
                          {selectedTrend.speed.acceleration === null ? '-' : formatSignedTenth(selectedTrend.speed.acceleration)}<span className="ml-0.5 text-sm font-bold opacity-60">{selectedTrend.pageLabel}/h²</span>
                        </p>
                      </div>
                      <p className="pb-0.5 text-[13px] font-bold text-slate-400">{speedPoints.length}시간{speedFirst && speedPoints.length > 1 ? ` · 첫 1시간 ${speedFirst.speed.toFixed(1)}` : ''}</p>
                    </div>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={speedData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf4" />
                          <XAxis dataKey="hours" type="number" domain={[0, Math.max(1, Math.ceil(speedPoints[speedPoints.length - 1]?.hours ?? 1))]} allowDecimals={false} fontSize={12} tickLine={false} axisLine={false} stroke="#64748b"
                            tickFormatter={value => `${Math.round(Number(value))}h`} />
                          <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" width={44} domain={['auto', 'auto']} tickFormatter={value => `${Math.round(Number(value) * 10) / 10}`} />
                          <Tooltip content={<ChartTip render={(point: typeof speedData[number]) => ({
                            title: `공부 ${point.hours}시간째 · ${point.date}`,
                            rows: [{ color: INDIGO, label: '속도', value: `${point.speed.toFixed(1)} ${selectedTrend.pageLabel}/h` }]
                          })} />} />
                          <Line type="linear" dataKey="speed" stroke={INDIGO} strokeWidth={2.5} dot={{ r: 3.5, fill: INDIGO, stroke: '#ffffff', strokeWidth: 1.5 }} activeDot={{ r: 6 }} isAnimationActive={false} />
                          {speedFit && <Line type="linear" dataKey="fit" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} />}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-[13px] font-bold text-slate-500">
                      <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 rounded" style={{ background: INDIGO }} />1시간 속도</span>
                      {speedFit && <span className="flex items-center gap-1.5"><i className="h-0 w-5 border-t-2 border-dashed border-amber-500" />가속도 직선</span>}
                    </div>
                  </>
                ) : <EmptyNote>공부 1시간을 채운 기록이 생기면 속도가 나타나요.</EmptyNote>}
              </div>

              <div className="min-w-0 border-slate-200 lg:col-span-2 lg:border-l lg:pl-8" data-testid="speed-unit">
                <p className="mb-2 text-[15px] font-black text-slate-700">단위별 속도 상승</p>
                {unitLast ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2">
                      <div>
                        <p className="text-[13px] font-bold text-slate-500">현재</p>
                        <p className={`text-4xl font-black leading-none ${unitLast.speedIncrease >= 0 ? 'text-indigo-600' : 'text-amber-500'}`} data-trend="current">
                          {signed(unitLast.speedIncrease, 1)}<span className="ml-0.5 text-lg">%</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-slate-500">최고</p>
                        <p className="text-2xl font-black leading-none text-slate-700">{signed(unitBest, 1)}<span className="ml-0.5 text-base">%</span></p>
                      </div>
                    </div>
                    <p className="mb-2 text-[13px] font-bold text-slate-400">
                      효율 {unitFirst.efficiency.toFixed(1)} → {unitLast.efficiency.toFixed(1)} 분/{selectedTrend.pageLabel} · {selectedTrend.isReview ? '복습 한 번' : '복습에 넣기 사이'} 단위 {unitPoints.length}개
                    </p>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={unitPoints} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                          <defs>
                            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={INDIGO} stopOpacity={0.28} />
                              <stop offset="100%" stopColor={INDIGO} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ecf4" />
                          <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" minTickGap={24} />
                          <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="#64748b" tickFormatter={value => `${value}%`} width={48} />
                          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                          <Tooltip
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', fontSize: 14 }}
                            labelClassName="font-bold text-slate-800"
                            formatter={(value: number) => [`${signed(value, 1)}%`, '속도 상승']}
                          />
                          <Area name="속도 상승" type="monotone" dataKey="speedIncrease" stroke={INDIGO} strokeWidth={3} fill="url(#trend-fill)"
                            dot={{ r: 3.5, fill: INDIGO, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : <EmptyNote>페이지 단위를 한 번이라도 채우면 나타납니다.</EmptyNote>}
              </div>
            </div>
          ) : (
            <EmptyNote>공부 기록이 생기면 속도 추이가 나타납니다.</EmptyNote>
          )}
        </ReportCard>

        <ReportCard title="복습 현황" testId="review-card">
          {review.questions > 0 || review.reviewMinutes > 0 || reviewRounds.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="정답률" value={review.accuracy === null ? '-' : String(Math.round(review.accuracy))} unit={review.accuracy === null ? '' : '%'}
                  sub={`${review.attempts}번 중 오답 ${review.wrong}번`} accent="text-emerald-500" />
                <MiniStat label="외운 문제" value={String(review.mastered)} unit="개"
                  sub={`전체 ${review.questions}개 · 간격 8일+`} accent="text-indigo-600" />
                <MiniStat label="복습 시간 (30일)" value={formatMinutesShort(review.reviewMinutes)} unit=""
                  sub="기본·과목 복습 합계" accent="text-sky-600" />
              </div>
              {reviewRounds.length > 0 && (
                <div className="mt-4" data-testid="review-rounds">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
                    <p className="text-[15px] font-black text-slate-700">복습 회차별 속도</p>
                    <p className="text-[13px] font-bold text-slate-400">
                      {reviewRounds.length > 1
                        ? <>{reviewRounds[0].round}회 {reviewRounds[0].speed.toFixed(1)} → {reviewRounds[reviewRounds.length - 1].round}회 <b className={reviewRounds[reviewRounds.length - 1].speed >= reviewRounds[0].speed ? 'text-emerald-600' : 'text-amber-600'}>{reviewRounds[reviewRounds.length - 1].speed.toFixed(1)}</b> P/h</>
                        : <>{reviewRounds[0].round}회 복습 {reviewRounds[0].speed.toFixed(1)} P/h</>}
                    </p>
                  </div>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reviewRounds.map(point => ({ ...point, name: `${point.round}회`, speed: Number(point.speed.toFixed(1)) }))} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
                        <XAxis dataKey="name" fontSize={13} fontWeight={700} tickLine={false} axisLine={false} stroke="#475569" />
                        <YAxis hide domain={[0, 'dataMax']} />
                        <Tooltip cursor={{ fill: 'rgba(99,102,241,0.08)' }} content={<ChartTip render={(point: ReturnType<typeof buildReviewRoundEfficiency>[number] & { name: string }) => ({
                          title: `${point.name} 복습`,
                          rows: [{ color: INDIGO, label: '속도', value: `${point.speed.toFixed(1)} P/h` }, { color: INDIGO_SOFT, label: '장당', value: `${point.minutesPerPage.toFixed(1)}분` }, { color: '#475569', label: '합계', value: `${Math.round(point.pages * 10) / 10}P · ${formatMinutesShort(point.minutes)}` }]
                        })} />} />
                        <Bar dataKey="speed" radius={[6, 6, 0, 0]} maxBarSize={48}>
                          {reviewRounds.map((point, index) => <Cell key={point.round} fill={index === reviewRounds.length - 1 ? INDIGO : INDIGO_SOFT} />)}
                          <LabelList dataKey="speed" position="top" fontSize={12} fontWeight={700} fill="#475569" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          ) : <EmptyNote>복습 문제를 풀면 정답률과 외운 문제 수가 나타납니다.</EmptyNote>}
        </ReportCard>
      </section>

      {/* 5. 원자료: 폴더·과목별 합계 */}
      <section aria-label="원자료" className="space-y-3">
        <SectionLabel index={5} title="원자료" hint="폴더·과목별 합계" />
        <SummarySection
          range={tableRange}
          onRangeChange={setTableRange}
          data={tableRange === 'month' ? monthlyData : allTimeData}
          expandedFolderKeys={expandedFolderKeys}
          onToggleFolder={toggleFolder}
        />
      </section>
    </div>
  );
};

const PLAN_COLUMNS = 'md:grid-cols-[minmax(0,1.25fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.5fr)]';
/** 고쳐야 할 과목이 위로: 늦음 → 최근 기록 없음 → 맞음 → 여유 → 목표일 없음 → 완료 */
const PLAN_ORDER: Record<PlanStatus, number> = { late: 0, idle: 1, ontrack: 2, ahead: 3, nodate: 4, done: 5 };
const PLAN_TONES: Record<PlanStatus, string> = {
  late: 'bg-rose-100 text-rose-700',
  idle: 'bg-amber-100 text-amber-700',
  ontrack: 'bg-indigo-100 text-indigo-700',
  ahead: 'bg-emerald-100 text-emerald-700',
  nodate: 'bg-slate-100 text-slate-500',
  done: 'bg-emerald-100 text-emerald-700'
};
const PLAN_NAMES: Record<PlanStatus, string> = { late: '늦음', idle: '기록 없음', ontrack: '맞음', ahead: '여유', nodate: '목표일 없음', done: '완료' };

const planLabel = (check: PlanCheck) => {
  if (check.status === 'late') return `${check.gapDays}일 늦음`;
  if (check.status === 'ahead') return `${Math.abs(check.gapDays ?? 0)}일 빠름`;
  if (check.status === 'ontrack') return '목표일에 맞음';
  if (check.status === 'idle') return '최근 4주 기록 없음';
  return PLAN_NAMES[check.status];
};

const SectionLabel = ({ index, title, hint }: { index: number; title: string; hint: string }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-black text-white" aria-hidden="true">{index}</span>
    <h2 className="text-xl font-black text-slate-900">{title}</h2>
    <p className="text-[13px] font-bold text-slate-400">{hint}</p>
  </div>
);

const PlanSummary = ({ counts }: { counts: Record<PlanStatus, number> }) => (
  <div className="flex flex-wrap justify-end gap-1.5" aria-label="점검 결과 요약">
    {(['late', 'idle', 'ontrack', 'ahead', 'nodate', 'done'] as const).filter(status => counts[status] > 0).map(status => (
      <span key={status} className={`rounded-full px-3 py-1 text-[13px] font-black ${PLAN_TONES[status]}`}>{PLAN_NAMES[status]} {counts[status]}</span>
    ))}
  </div>
);

/** 주별 학습 시간을 작은 막대 열두 개로. 맨 끝(진한 막대)이 이번 주. */
const Sparkline = ({ values, label }: { values: number[]; label: string }) => {
  const max = Math.max(1, ...values);
  const width = 7;
  return (
    <svg viewBox={`0 0 ${values.length * width} 26`} className="h-8 w-full max-w-[10rem]" role="img" aria-label={label}>
      {values.map((value, index) => {
        const height = value > 0 ? Math.max(2.5, (value / max) * 26) : 1;
        return <rect key={index} x={index * width + 0.75} y={26 - height} width={width - 1.5} height={height} rx={1.2}
          fill={value <= 0 ? '#e2e8f0' : index === values.length - 1 ? INDIGO : INDIGO_SOFT} />;
      })}
    </svg>
  );
};

const PaceBar = ({ label, value, scale, tone, text }: { label: string; value: number; scale: number; tone: string; text: string }) => (
  <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2">
    <span className="text-[13px] font-bold text-slate-500">{label}</span>
    <span className="block h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(value > 0 ? 3 : 0, (value / scale) * 100))}%` }} />
    </span>
    <span className="min-w-[4.5rem] text-right text-[14px] font-black tabular-nums text-slate-700">{text}</span>
  </div>
);

interface PlanRowData {
  id: string;
  name: string;
  pageLabel: string;
  total: number;
  done: number;
  percent: number;
  diffDays: number | null;
  stages: Array<{ id: string; name: string; pages: number; done: number; isFollowUp: boolean }>;
  check: PlanCheck;
  minutes: number;
  minutesPercent: number;
  weekly: number[];
}

const PlanRowView = ({ row }: { row: PlanRowData }) => {
  const { check } = row;
  const pace = Math.round(check.weeklyPages * 10) / 10;
  const need = check.requiredWeeklyPages === null ? null : Math.round(check.requiredWeeklyPages * 10) / 10;
  const scale = Math.max(check.weeklyPages, check.requiredWeeklyPages ?? 0, 0.1);
  const extra = check.extraWeeklyPages === null ? null : Math.ceil(check.extraWeeklyPages * 10) / 10;
  const faster = check.firstEfficiency !== null && check.recentEfficiency !== null ? check.recentEfficiency <= check.firstEfficiency : null;
  return (
    <li data-testid="progress-row" data-plan-status={check.status} className={`grid gap-x-6 gap-y-3 px-1 py-4 ${PLAN_COLUMNS}`}>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-base font-black text-slate-800" title={row.name}>{row.name}</p>
          {row.diffDays !== null && (
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-black ${row.diffDays > 0 ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-600'}`}>
              {row.diffDays > 0 ? `D-${row.diffDays}` : row.diffDays === 0 ? 'D-day' : `D+${-row.diffDays}`}
            </span>
          )}
        </div>
        <span data-testid="plan-status" className={`mt-1.5 inline-block rounded-full px-3 py-1 text-[13px] font-black ${PLAN_TONES[check.status]}`}>{planLabel(check)}</span>
        {extra !== null && extra > 0 && <p className="mt-1.5 text-[13px] font-bold text-rose-600">주 +{extra}{row.pageLabel} 더 필요</p>}
      </div>

      <div className="min-w-0">
        <div className="flex items-end justify-between gap-2">
          <p className="text-3xl font-black leading-none text-slate-900">{row.percent}<span className="ml-0.5 text-base text-slate-400">%</span></p>
          <p className="text-sm font-bold text-slate-500">{row.done} / {row.total} {row.pageLabel}</p>
        </div>
        {row.stages.length > 1 ? (
          <>
            <div className="mt-2.5 flex h-2.5 gap-1" data-testid="stage-bar" role="img" aria-label={row.stages.map(stage => `${stage.name} ${stage.done}/${stage.pages}`).join(', ')}>
              {row.stages.map(stage => (
                <span key={stage.id} className="block h-full overflow-hidden rounded-full bg-slate-200" style={{ flexGrow: stage.pages, flexBasis: 0 }}>
                  <span className={`block h-full rounded-full ${stage.isFollowUp ? 'bg-indigo-300' : 'bg-indigo-500'}`} style={{ width: `${stage.pages > 0 ? (stage.done / stage.pages) * 100 : 0}%` }} />
                </span>
              ))}
            </div>
            <p className="mt-2 truncate text-[13px] font-bold text-slate-500">{row.stages.map(stage => stage.name).join(' → ')}</p>
          </>
        ) : (
          <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${row.percent}%` }} />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-2xl font-black leading-none text-slate-900">{row.minutes > 0 ? formatMinutesShort(row.minutes) : '-'}
          {row.minutes > 0 && <span className="ml-2 text-[13px] font-bold text-slate-400">전체의 {row.minutesPercent}%</span>}</p>
        <div className="mt-2"><Sparkline values={row.weekly} label={`${row.name} 최근 12주 학습 시간`} /></div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <PaceBar label="지금" value={check.weeklyPages} scale={scale} tone="bg-indigo-500" text={check.status === 'done' ? '-' : `${pace}${row.pageLabel}/주`} />
        <PaceBar label="필요" value={check.requiredWeeklyPages ?? 0} scale={scale}
          tone={check.requiredWeeklyPages !== null && check.requiredWeeklyPages > check.weeklyPages ? 'bg-amber-400' : 'bg-slate-300'}
          text={check.status === 'done' || need === null ? '-' : `${need}${row.pageLabel}/주`} />
        {check.firstEfficiency !== null && check.recentEfficiency !== null && (
          <p className="pt-0.5 text-[13px] font-bold text-slate-500">
            효율 {check.firstEfficiency.toFixed(1)} → <b className={faster ? 'text-emerald-600' : 'text-amber-600'}>{check.recentEfficiency.toFixed(1)}</b> 분/{row.pageLabel}
          </p>
        )}
      </div>
    </li>
  );
};

const BigStat = ({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent: string }) => (
  <div className="min-w-0">
    <p className="text-[13px] font-bold text-slate-500">{label}</p>
    <p className={`mt-1 whitespace-nowrap text-3xl font-black leading-none ${accent}`}>{value}{unit && <span className="ml-0.5 text-base font-bold opacity-60">{unit}</span>}</p>
  </div>
);

const MiniStat = ({ label, value, unit, sub, accent }: { label: string; value: string; unit: string; sub: string; accent: string }) => (
  <div className="min-w-0 rounded-2xl bg-slate-50 p-4">
    <p className="text-[13px] font-bold text-slate-500">{label}</p>
    <p className={`mt-1.5 text-3xl font-black leading-none ${accent}`}>{value}<span className="ml-0.5 text-base font-bold opacity-60">{unit}</span></p>
    <p className="mt-2 text-xs font-bold leading-snug text-slate-400 [word-break:keep-all]">{sub}</p>
  </div>
);

const ReportCard = ({ title, aside, className = '', testId, center = false, children }: { title: string; aside?: React.ReactNode; className?: string; testId?: string; center?: boolean; children: React.ReactNode }) => (
  <section data-testid={testId} className={`flex min-w-0 flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-lg font-black text-slate-800">{title}</h3>
      {aside}
    </div>
    {center ? <div className="flex flex-1 flex-col justify-center pb-2">{children}</div> : children}
  </section>
);

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-32 items-center justify-center rounded-2xl bg-slate-50 px-4 text-center text-sm font-bold text-slate-400">{children}</div>
);

interface TipRow { color: string; label: string; value: string }

/** 차트 위에 뜨는 설명 상자. render가 점의 값을 제목과 줄들로 바꾼다. */
const ChartTip = <T,>({ active, payload, render }: { active?: boolean; payload?: Array<{ payload: T }>; render: (point: T) => { title: string; rows: TipRow[] } }) => {
  if (!active || !payload || payload.length === 0) return null;
  const { title, rows } = render(payload[0].payload);
  return (
    <div className="rounded-xl bg-white px-3.5 py-2.5 text-sm shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
      <p className="mb-1 font-black text-slate-800">{title}</p>
      {rows.map(row => (
        <p key={row.label} className="flex items-center gap-2 font-bold text-slate-600">
          <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />{row.label}
          <span className="ml-auto pl-3 text-slate-900">{row.value}</span>
        </p>
      ))}
    </div>
  );
};

/** 학습 달력: 주(열) × 요일(행) 칸. 칸을 누르면(또는 키보드로 고르면) 그 날의 시간과 페이지가 아래에 나온다. */
const CalendarHeat = ({ calendar, pickedKey, onPick }: { calendar: ReturnType<typeof buildStudyCalendar>; pickedKey: string | null; onPick: (key: string) => void }) => {
  const weekdayLabels = ['월', '화', '수', '목', '금', '토', '일'];
  const cell = (day: CalendarDay) => (
    <button key={day.key} type="button" disabled={day.isFuture} data-testid="calendar-cell" data-level={day.level}
      aria-label={`${day.label} ${day.weekday}요일 ${day.minutes > 0 ? `${formatMinutesShort(day.minutes)} ${Math.round(day.pages * 10) / 10}페이지` : '기록 없음'}`}
      aria-pressed={pickedKey === day.key} title={`${day.label} (${day.weekday}) ${day.minutes > 0 ? formatMinutesShort(day.minutes) : '기록 없음'}`}
      onClick={() => onPick(day.key)}
      className={`aspect-square w-full rounded-[5px] ${day.isFuture ? 'border border-dashed border-slate-200 bg-transparent' : CALENDAR_LEVEL_CLASS[day.level]} ${day.isToday ? 'ring-2 ring-inset ring-amber-400' : ''} ${pickedKey === day.key ? 'outline outline-2 outline-offset-1 outline-slate-700' : ''}`} />
  );
  return (
    <div className="mx-auto w-full max-w-[34rem]" role="group" aria-label="학습 달력">
      <div className="grid gap-x-[3px] gap-y-[3px]" style={{ gridTemplateColumns: `1.25rem repeat(${calendar.columns.length}, minmax(0, 1fr))` }}>
        <span />
        {calendar.columns.map((_, column) => {
          const month = calendar.months.find(item => item.column === column);
          return <span key={column} className="relative h-4">{month && <span className="absolute left-0 top-0 whitespace-nowrap text-[11px] font-bold text-slate-400">{month.label}</span>}</span>;
        })}
        {weekdayLabels.map((label, row) => (
          <React.Fragment key={label}>
            <span className="flex items-center text-[11px] font-bold text-slate-400">{row % 2 === 0 ? label : ''}</span>
            {calendar.columns.map(column => cell(column[row]))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const SummarySection = ({
  range,
  onRangeChange,
  data,
  expandedFolderKeys,
  onToggleFolder
}: {
  range: TableRange;
  onRangeChange: (range: TableRange) => void;
  data: { folderGroups: FolderGroup[]; rootSubjects: Summary[] };
  expandedFolderKeys: Set<string>;
  onToggleFolder: (key: string) => void;
}) => {
  const showLatest = range === 'all';
  const columns = showLatest
    ? 'grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))]'
    : 'grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))]';
  return (
    <ReportCard
      title="학습 현황"
      aside={(
        <div role="tablist" aria-label="집계 기간" className="flex rounded-2xl bg-slate-100 p-1">
          {([['month', '최근 30일'], ['all', '전체 누적']] as const).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={range === value} onClick={() => onRangeChange(value)}
              className={`rounded-xl px-4 py-2 text-sm font-black transition-colors ${range === value ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
    >
      <p className="-mt-2 mb-4 text-[13px] font-bold text-slate-400">
        {range === 'month' ? '최근 30일 동안의 폴더 및 과목별 학습 총합입니다.' : '과목이나 폴더를 삭제해도 지금까지의 학습 기록은 유지됩니다.'}
      </p>
      <div className={`grid items-center gap-2 border-b border-slate-200 px-4 pb-3 text-[13px] font-bold text-slate-500 ${columns}`}>
        <span>과목 / 폴더</span>
        <span>총 페이지</span>
        <span>총 시간</span>
        <span>평균 효율</span>
        <span>학습 횟수</span>
        {showLatest && <span>최근 학습</span>}
      </div>

      <div className="mt-3 space-y-2">
        {data.folderGroups.map(group => {
          const expanded = expandedFolderKeys.has(group.id);
          return (
            <div key={group.id} className="overflow-hidden rounded-2xl border border-slate-200">
              <button
                onClick={() => onToggleFolder(group.id)}
                className={`grid min-h-[3.5rem] w-full items-center gap-2 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 ${columns}`}
              >
                <span className="flex min-w-0 items-center gap-3 text-base font-black text-slate-800">
                  <span className={`text-xs text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="truncate">📂 {group.name}</span>
                </span>
                <Metric value={`${group.summary.totalPages}P`} />
                <Metric value={formatTotalTime(group.summary.totalMinutes)} />
                <Metric value={`${group.summary.averageEfficiency.toFixed(2)}분/P`} />
                <Metric value={`${group.summary.sessionCount}회`} />
                {showLatest && <Metric value={group.summary.latestTimestamp ? new Date(group.summary.latestTimestamp).toLocaleDateString('ko-KR') : '-'} />}
              </button>
              {expanded && (
                <div className="divide-y divide-slate-100 bg-white">
                  {group.subjects.map(subject => (
                    <SummaryRow key={subject.id} summary={subject} columns={columns} showLatest={showLatest} nested />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {data.rootSubjects.map(subject => (
          <div key={subject.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <SummaryRow summary={subject} columns={columns} showLatest={showLatest} />
          </div>
        ))}

        {data.folderGroups.length === 0 && data.rootSubjects.length === 0 && (
          <div className="py-10 text-center text-sm font-bold text-slate-300">저장된 학습 기록이 없습니다.</div>
        )}
      </div>
    </ReportCard>
  );
};

const SummaryRow = ({ summary, columns, showLatest, nested = false }: { summary: Summary; columns: string; showLatest: boolean; nested?: boolean }) => (
  <div className={`grid min-h-[3.5rem] items-center gap-2 px-4 py-3 ${columns}`}>
    <span className={`min-w-0 truncate text-base font-black text-slate-700 ${nested ? 'pl-8' : ''}`}>{nested ? '↳ ' : ''}{summary.name}</span>
    <Metric value={`${summary.totalPages}P`} />
    <Metric value={formatTotalTime(summary.totalMinutes)} />
    <Metric value={`${summary.averageEfficiency.toFixed(2)}분/P`} />
    <Metric value={`${summary.sessionCount}회`} />
    {showLatest && <Metric value={summary.latestTimestamp ? new Date(summary.latestTimestamp).toLocaleDateString('ko-KR') : '-'} />}
  </div>
);

const Metric = ({ value }: { value: string }) => (
  <span className="text-[15px] font-bold text-slate-600">{value}</span>
);

const formatTotalTime = (minutes: number) => {
  if (minutes < 59.95) return `${minutes.toFixed(1)}분`;
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  return `${hours}시간 ${remainingMinutes}분`;
};

