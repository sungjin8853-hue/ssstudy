
import React, { useMemo } from 'react';
import { StudyLog, Subject } from '../types';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
}

export const TodaySummary: React.FC<Props> = ({ logs, subjects }) => {
  const todayLogs = useMemo(() => {
    const today = new Date().toLocaleDateString();
    return logs.filter(log => new Date(log.timestamp).toLocaleDateString() === today);
  }, [logs]);

  const totals = useMemo(() => {
    const time = todayLogs.reduce((acc, log) => acc + log.timeSpentMinutes, 0);
    const pages = todayLogs.reduce((acc, log) => acc + log.pagesRead, 0);
    const avgEfficiency = pages > 0 ? (time / pages).toFixed(1) : '0';
    return { time, pages, avgEfficiency };
  }, [todayLogs]);

  if (todayLogs.length === 0) return null;

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-center mb-4 px-1">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className="p-1.5 bg-green-100 text-green-600 rounded-lg text-sm">📅</span> 
          오늘의 실시간 기록
        </h3>
        <div className="flex gap-3">
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase">총 학습</p>
            <p className="text-sm font-black text-slate-700">{totals.time}분 / {totals.pages}P</p>
          </div>
          <div className="text-right border-l pl-3 border-slate-200">
            <p className="text-[10px] font-bold text-slate-400 uppercase">평균 효율</p>
            <p className="text-sm font-black text-indigo-600">{totals.avgEfficiency}분/P</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {todayLogs.slice().reverse().map((log) => {
          const subject = subjects.find(s => s.id === log.subjectId);
          const efficiency = log.pagesRead > 0 ? (log.timeSpentMinutes / log.pagesRead).toFixed(1) : '0';
          
          return (
            <div key={log.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 group hover:border-indigo-200 transition-colors">
              <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-lg border border-slate-100 group-hover:bg-indigo-50 transition-colors">
                {log.photoBase64 ? '📸' : '📝'}
              </div>
              <div className="flex-grow min-w-0">
                <p className="text-xs font-bold text-slate-400 truncate">{subject?.name || '기타'}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-black text-slate-800">{log.pagesRead}P</span>
                  <span className="text-xs text-slate-500">({log.timeSpentMinutes}분 소요)</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-indigo-400 uppercase">효율</p>
                <p className="text-sm font-mono font-bold text-indigo-600">{efficiency} <span className="text-[10px] font-normal opacity-70">m/p</span></p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
