
import React, { useMemo } from 'react';
import { Subject, StudyLog } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
}

export const HistoryCharts: React.FC<Props> = ({ subjects, logs }) => {
  const recentLogsData = useMemo(() => {
    return logs.slice(-20).map(log => ({
      date: new Date(log.timestamp).toLocaleDateString('ko-KR', { day: 'numeric', month: 'short' }),
      efficiency: log.pagesRead > 0 ? (log.timeSpentMinutes / log.pagesRead).toFixed(1) : 0,
      pages: log.pagesRead,
      name: subjects.find(s => s.id === log.subjectId)?.name || '기타'
    }));
  }, [logs, subjects]);

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase">최근 학습 효율 추이</h3>
            <p className="text-[10px] text-slate-400">최근 기록 기준 (낮을수록 효율적)</p>
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
              <div className="h-full flex items-center justify-center text-slate-300 text-sm italic">기록이 부족합니다.</div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase">회차별 학습량</h3>
            <p className="text-[10px] text-slate-400">세션당 읽은 페이지 수</p>
          </div>
          <div className="h-80">
            {recentLogsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={recentLogsData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    cursor={{ fill: '#f8fafc' }}
                  />
                  <Bar name="페이지" dataKey="pages" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-300 text-sm italic">기록이 부족합니다.</div>
            )}
          </div>
        </div>
      </section>
      
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 uppercase mb-4">전체 학습 타임라인</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="pb-3 font-bold text-slate-400 uppercase text-[10px]">날짜</th>
                <th className="pb-3 font-bold text-slate-400 uppercase text-[10px]">과목</th>
                <th className="pb-3 font-bold text-slate-400 uppercase text-[10px]">페이지</th>
                <th className="pb-3 font-bold text-slate-400 uppercase text-[10px]">시간</th>
                <th className="pb-3 font-bold text-slate-400 uppercase text-[10px]">효율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.slice().reverse().map(log => {
                const efficiency = log.pagesRead > 0 ? (log.timeSpentMinutes / log.pagesRead).toFixed(1) : '-';
                return (
                  <tr key={log.id}>
                    <td className="py-3 text-slate-500">{new Date(log.timestamp).toLocaleDateString()}</td>
                    <td className="py-3 font-bold text-slate-800">{subjects.find(s => s.id === log.subjectId)?.name || '삭제된 과목'}</td>
                    <td className="py-3 text-slate-600">{log.pagesRead}P</td>
                    <td className="py-3 text-slate-600">{log.timeSpentMinutes}분</td>
                    <td className="py-3 font-mono text-blue-600">{efficiency}분/P</td>
                  </tr>
                );
              })}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-300 italic">저장된 학습 기록이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
