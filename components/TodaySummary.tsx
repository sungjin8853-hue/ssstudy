
import React, { useMemo, useState } from 'react';
import { StudyLog, Subject } from '../types';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  onUpdateLog: (log: StudyLog) => void;
}

export const TodaySummary: React.FC<Props> = ({ logs, subjects, onUpdateLog }) => {
  const [editingLog, setEditingLog] = useState<StudyLog | null>(null);
  const [editPages, setEditPages] = useState(0);
  const [editMinutes, setEditMinutes] = useState(0);

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

  const startEdit = (log: StudyLog) => {
    setEditingLog(log);
    setEditPages(log.pagesRead);
    setEditMinutes(log.timeSpentMinutes);
  };

  const handleSaveEdit = () => {
    if (editingLog) {
      onUpdateLog({
        ...editingLog,
        pagesRead: editPages,
        timeSpentMinutes: editMinutes
      });
      setEditingLog(null);
    }
  };

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
            <div key={log.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 group hover:border-indigo-200 transition-colors relative overflow-hidden">
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
              <div className="text-right flex flex-col items-end">
                <p className="text-[9px] font-bold text-indigo-400 uppercase">효율</p>
                <p className="text-sm font-mono font-bold text-indigo-600">{efficiency} <span className="text-[10px] font-normal opacity-70">m/p</span></p>
                <button 
                  onClick={() => startEdit(log)}
                  className="mt-1 p-1 text-slate-300 hover:text-indigo-600 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 수정 모달 */}
      {editingLog && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[1000] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in duration-200">
            <h4 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-2">
              <span className="text-indigo-600">✏️</span> 기록 수정
            </h4>
            <div className="space-y-6 mb-10">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">학습량 (페이지)</label>
                <input 
                  type="number"
                  value={editPages}
                  onChange={e => setEditPages(Number(e.target.value))}
                  className="w-full p-4 border border-slate-200 rounded-2xl font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/10 text-center"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">소요 시간 (분)</label>
                <input 
                  type="number"
                  value={editMinutes}
                  onChange={e => setEditMinutes(Number(e.target.value))}
                  className="w-full p-4 border border-slate-200 rounded-2xl font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/10 text-center"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setEditingLog(null)} 
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-sm hover:bg-slate-200 transition-all"
              >
                취소
              </button>
              <button 
                onClick={handleSaveEdit} 
                className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all"
              >
                변경사항 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
