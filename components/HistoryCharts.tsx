import React, { useMemo, useState } from 'react';
import { Subject, StudyLog } from '../types';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

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

export const HistoryCharts: React.FC<Props> = ({ subjects, logs }) => {
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(new Set());

  const recentLogsData = useMemo(() => {
    return logs
      .filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(log => ({
        date: new Date(log.timestamp).toLocaleDateString('ko-KR', { day: 'numeric', month: 'short' }),
        efficiency: Number((log.timeSpentMinutes / log.pagesRead).toFixed(2)),
        name: subjects.find(subject => subject.id === log.subjectId)?.name || log.subjectNameSnapshot || '삭제된 과목'
      }));
  }, [logs, subjects]);

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

  return (
    <div className="space-y-8">
      <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-slate-800 uppercase">최근 학습 효율 추이</h3>
          <p className="text-[10px] text-slate-400">최근 기록 기준, 낮을수록 효율적입니다.</p>
        </div>
        <div className="h-80">
          {recentLogsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={recentLogsData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  labelClassName="font-bold text-slate-800"
                />
                <Line name="분/P" type="monotone" dataKey="efficiency" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-300 text-sm italic">학습 기록이 없습니다.</div>
          )}
        </div>
      </section>

      <SummarySection
        title="최근 한 달 학습 현황"
        description="최근 30일 동안의 폴더 및 과목별 학습 총합입니다."
        sectionKey="monthly"
        data={monthlyData}
        expandedFolderKeys={expandedFolderKeys}
        onToggleFolder={toggleFolder}
      />

      <SummarySection
        title="전체 누적 학습 현황"
        description="과목이나 폴더를 삭제해도 지금까지의 학습 기록은 유지됩니다."
        sectionKey="all"
        data={allTimeData}
        expandedFolderKeys={expandedFolderKeys}
        onToggleFolder={toggleFolder}
        showLatest
      />
    </div>
  );
};

const SummarySection = ({
  title,
  description,
  sectionKey,
  data,
  expandedFolderKeys,
  onToggleFolder,
  showLatest = false
}: {
  title: string;
  description: string;
  sectionKey: string;
  data: { folderGroups: FolderGroup[]; rootSubjects: Summary[] };
  expandedFolderKeys: Set<string>;
  onToggleFolder: (key: string) => void;
  showLatest?: boolean;
}) => (
  <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
    <div className="mb-5">
      <h3 className="text-sm font-bold text-slate-800 uppercase">{title}</h3>
      <p className="mt-1 text-[10px] text-slate-400">{description}</p>
    </div>

    <div className="overflow-x-auto">
      <div className={showLatest ? 'w-[760px]' : 'w-[650px]'}>
        <div className={`grid items-center gap-2 border-b border-slate-200 px-3 pb-3 text-[10px] font-black uppercase tracking-wider text-slate-400 ${showLatest ? 'grid-cols-[220px_90px_110px_100px_80px_120px]' : 'grid-cols-[220px_90px_110px_100px_80px]'}`}>
          <span>과목 / 폴더</span>
          <span>총 페이지</span>
          <span>총 시간</span>
          <span>평균 효율</span>
          <span>학습 횟수</span>
          {showLatest && <span>최근 학습</span>}
        </div>

        <div className="mt-3 space-y-2">
          {data.folderGroups.map(group => {
            const key = `${sectionKey}:${group.id}`;
            const expanded = expandedFolderKeys.has(key);
            return (
              <div key={group.id} className="overflow-hidden rounded-2xl border border-slate-200">
                <button
                  onClick={() => onToggleFolder(key)}
                  className={`grid w-full items-center gap-2 bg-slate-50 px-3 py-4 text-left hover:bg-slate-100 ${showLatest ? 'grid-cols-[220px_90px_110px_100px_80px_120px]' : 'grid-cols-[220px_90px_110px_100px_80px]'}`}
                >
                  <span className="flex items-center gap-3 font-black text-slate-800">
                    <span className={`text-xs text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                    📂 {group.name}
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
                      <SummaryRow key={subject.id} summary={subject} showLatest={showLatest} nested />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {data.rootSubjects.map(subject => (
            <div key={subject.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <SummaryRow summary={subject} showLatest={showLatest} />
            </div>
          ))}

          {data.folderGroups.length === 0 && data.rootSubjects.length === 0 && (
            <div className="py-10 text-center text-slate-300 italic">저장된 학습 기록이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  </section>
);

const SummaryRow = ({ summary, showLatest, nested = false }: { summary: Summary; showLatest: boolean; nested?: boolean }) => (
  <div className={`grid items-center gap-2 px-3 py-4 ${showLatest ? 'grid-cols-[220px_90px_110px_100px_80px_120px]' : 'grid-cols-[220px_90px_110px_100px_80px]'}`}>
    <span className={`font-black text-slate-700 ${nested ? 'pl-9' : ''}`}>{nested ? '↳ ' : ''}{summary.name}</span>
    <Metric value={`${summary.totalPages}P`} />
    <Metric value={formatTotalTime(summary.totalMinutes)} />
    <Metric value={`${summary.averageEfficiency.toFixed(2)}분/P`} />
    <Metric value={`${summary.sessionCount}회`} />
    {showLatest && <Metric value={summary.latestTimestamp ? new Date(summary.latestTimestamp).toLocaleDateString('ko-KR') : '-'} />}
  </div>
);

const Metric = ({ value }: { value: string }) => (
  <span className="text-sm font-bold text-slate-500">{value}</span>
);

const formatTotalTime = (minutes: number) => {
  if (minutes < 60) return `${minutes.toFixed(1)}분`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  return `${hours}시간 ${remainingMinutes}분`;
};
