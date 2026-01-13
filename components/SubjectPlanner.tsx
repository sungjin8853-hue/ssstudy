
import React, { useState } from 'react';
import { Subject, StudyLog } from '../types';
import { calculateStats } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  onAddSubject: (s: Subject) => void;
  onUpdateSubject: (s: Subject) => void;
  onDeleteSubject: (id: string) => void;
}

export const SubjectPlanner: React.FC<Props> = ({ subjects, logs, onAddSubject, onUpdateSubject, onDeleteSubject }) => {
  const [name, setName] = useState('');
  const [pages, setPages] = useState(100);
  const [date, setDate] = useState('');
  
  // 편집 중인 과목 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPages, setEditPages] = useState(0);
  const [editDate, setEditDate] = useState('');
  const [editDailyTime, setEditDailyTime] = useState(60);

  const handleAdd = () => {
    if (!name || !date) return;
    onAddSubject({
      id: Math.random().toString(36).substr(2, 9),
      name,
      totalPages: pages,
      completedPages: 0,
      targetDate: date,
    });
    setName('');
    setDate('');
  };

  const startEditing = (sub: Subject) => {
    setEditingId(sub.id);
    setEditName(sub.name);
    setEditPages(sub.totalPages);
    setEditDate(sub.targetDate);
    
    // 현재 페이스 계산
    const subLogs = logs.filter(l => l.subjectId === sub.id);
    const stats = calculateStats(subLogs, sub.totalPages - sub.completedPages);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(sub.targetDate);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    setEditDailyTime(diffDays > 0 ? Math.round(stats.estimatedRemainingTime / diffDays) : 60);
  };

  const handleDailyTimeChange = (minutes: number, subId: string) => {
    setEditDailyTime(minutes);
    if (minutes > 0) {
      const sub = subjects.find(s => s.id === subId);
      if (!sub) return;
      
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const stats = calculateStats(subLogs, editPages - sub.completedPages);
      
      if (stats.averageTimePerPage > 0) {
        const remainingPages = editPages - sub.completedPages;
        const daysNeeded = Math.ceil((stats.averageTimePerPage * remainingPages) / minutes);
        
        const newDate = new Date();
        newDate.setDate(newDate.getDate() + daysNeeded);
        setEditDate(newDate.toISOString().split('T')[0]);
      }
    }
  };

  const handleDateChange = (newDateStr: string, subId: string) => {
    setEditDate(newDateStr);
    const sub = subjects.find(s => s.id === subId);
    if (!sub) return;

    const subLogs = logs.filter(l => l.subjectId === sub.id);
    const stats = calculateStats(subLogs, editPages - sub.completedPages);

    if (stats.averageTimePerPage > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(newDateStr);
      target.setHours(0, 0, 0, 0);
      
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 0) {
        const remainingPages = editPages - sub.completedPages;
        const totalMinutesNeeded = stats.averageTimePerPage * remainingPages;
        setEditDailyTime(Math.round(totalMinutesNeeded / diffDays));
      } else {
        setEditDailyTime(Math.round(stats.estimatedRemainingTime));
      }
    }
  };

  const handleUpdate = (sub: Subject) => {
    onUpdateSubject({
      ...sub,
      name: editName,
      totalPages: editPages,
      targetDate: editDate,
    });
    setEditingId(null);
  };

  const getRecommendedDaily = (subject: Subject) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const target = new Date(subject.targetDate);
    target.setHours(0,0,0,0);
    
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const remainingPages = Math.max(0, subject.totalPages - subject.completedPages);
    
    if (diffDays <= 0) return remainingPages;
    return Math.ceil(remainingPages / diffDays);
  };

  return (
    <div className="bg-white p-8 rounded-[3.5rem] shadow-sm border border-slate-200">
      <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-8">
        <span className="w-2 h-5 bg-indigo-600 rounded-full"></span>
        학습 계획 플래너
      </h2>
      
      {/* 새 과목 추가 섹션 */}
      <div className="space-y-4 mb-10 bg-slate-50 p-6 rounded-3xl border border-slate-100">
        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase ml-1">과목 명칭</label>
            <input 
              placeholder="예: 선형대수학, 토익 900"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">목표 페이지</label>
              <input 
                type="number"
                value={pages}
                onChange={e => setPages(Number(e.target.value))}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">목표 날짜</label>
              <input 
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
          </div>
        </div>
        <button 
          onClick={handleAdd}
          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all mt-2"
        >
          새로운 목표 추가하기
        </button>
      </div>

      {/* 과목 리스트 섹션 */}
      <div className="space-y-4">
        {subjects.map(sub => {
          const subLogs = logs.filter(l => l.subjectId === sub.id);
          const stats = calculateStats(subLogs, sub.totalPages - sub.completedPages);
          const hasData = stats.averageTimePerPage > 0;

          return (
            <div key={sub.id} className={`p-6 border rounded-[2rem] transition-all ${editingId === sub.id ? 'bg-indigo-50 border-indigo-200 ring-2 ring-indigo-500/10' : 'bg-white border-slate-100'}`}>
              {editingId === sub.id ? (
                /* 편집 모드 UI */
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">계획 수정 모드</span>
                    <button onClick={() => setEditingId(null)} className="text-slate-400 text-xs font-bold hover:text-slate-600">취소</button>
                  </div>
                  <div className="space-y-3">
                    <input 
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full p-3 border border-indigo-200 rounded-xl bg-white font-bold text-sm"
                      placeholder="과목명"
                    />
                    
                    {hasData ? (
                      <div className="bg-indigo-600 p-4 rounded-2xl text-white">
                        <label className="text-[9px] font-black uppercase tracking-widest opacity-70 mb-1 block">원하는 하루 학습 시간 (분)</label>
                        <div className="flex items-center gap-3">
                          <input 
                            type="number"
                            value={editDailyTime}
                            onChange={e => handleDailyTimeChange(Number(e.target.value), sub.id)}
                            className="bg-white/10 border border-white/20 rounded-lg p-2 w-full text-xl font-black focus:outline-none focus:bg-white/20"
                          />
                          <span className="font-bold text-xs opacity-80 whitespace-nowrap">분 / 일</span>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-100 rounded-xl text-center border border-dashed border-slate-200">
                        <p className="text-[9px] text-slate-400 font-bold italic">학습 기록이 1개 이상 쌓이면 시간 기반 마감일 계산이 활성화됩니다.</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 px-1 uppercase">목표량(P)</label>
                        <input 
                          type="number"
                          value={editPages}
                          onChange={e => setEditPages(Number(e.target.value))}
                          className="w-full p-3 border border-indigo-200 rounded-xl bg-white font-bold text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 px-1 uppercase">목표 기한</label>
                        <input 
                          type="date"
                          value={editDate}
                          onChange={e => handleDateChange(e.target.value, sub.id)}
                          className="w-full p-3 border border-indigo-200 rounded-xl bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/10"
                        />
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleUpdate(sub)}
                    className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black text-xs hover:bg-indigo-700"
                  >
                    수정 사항 저장
                  </button>
                </div>
              ) : (
                /* 일반 모드 UI */
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-grow">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-black text-slate-800 text-lg leading-tight truncate max-w-[200px]">{sub.name}</h3>
                      <button onClick={() => startEditing(sub)} className="p-1.5 text-slate-300 hover:text-indigo-500 transition-colors">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 font-medium">전체 {sub.totalPages}P</span>
                      <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                      <span className="text-xs text-slate-400 font-medium">{new Date(sub.targetDate).toLocaleDateString()} 까지</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div className="text-right border-r border-slate-100 pr-6">
                      <p className="text-[9px] font-black text-indigo-400 uppercase tracking-wider mb-1">일일 권장량</p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-black text-indigo-600">{getRecommendedDaily(sub)}</span>
                        <span className="text-[10px] font-bold text-slate-400">P/일</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => onDeleteSubject(sub.id)}
                      className="w-10 h-10 rounded-full bg-rose-50 text-rose-400 hover:bg-rose-500 hover:text-white flex items-center justify-center transition-all"
                    >
                      <span className="text-lg font-bold">✕</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {subjects.length === 0 && (
          <div className="py-12 text-center bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-100">
             <p className="text-slate-400 font-bold italic text-sm">등록된 학습 계획이 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
};
