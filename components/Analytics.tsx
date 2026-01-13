import React, { useMemo, useState } from 'react';
import { Subject, StudyLog } from '../types';
import { calculateStats } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  onUpdateSubject?: (updated: Subject) => void;
}

export const Analytics: React.FC<Props> = ({ subjects, logs, onUpdateSubject }) => {
  // 편집 상태 관리
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPages, setEditPages] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editDailyTime, setEditDailyTime] = useState<number>(0);

  // 과목별 상세 통계 계산
  const subjectStats = useMemo(() => {
    return subjects.map(sub => {
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const remaining = sub.totalPages - sub.completedPages;
      const stats = calculateStats(subLogs, remaining);
      
      // 일일 남은 일수 계산
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(sub.targetDate);
      target.setHours(0, 0, 0, 0);
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // 하루당 예상 소요 시간
      const dailyTimeNeeded = diffDays > 0 ? stats.estimatedRemainingTime / diffDays : stats.estimatedRemainingTime;

      return {
        ...sub,
        stats,
        diffDays,
        dailyTimeNeeded
      };
    });
  }, [subjects, logs]);

  const startEditing = (sub: any) => {
    setEditingId(sub.id);
    setEditPages(sub.totalPages);
    setEditDate(sub.targetDate);
    setEditDailyTime(Math.round(sub.dailyTimeNeeded));
  };

  const handleDailyTimeChange = (minutes: number, sub: any) => {
    setEditDailyTime(minutes);
    if (minutes > 0 && sub.stats.averageTimePerPage > 0) {
      const avgTime = sub.stats.averageTimePerPage;
      const remainingPages = editPages - sub.completedPages;
      const totalMinutesNeeded = avgTime * remainingPages;
      const daysNeeded = Math.ceil(totalMinutesNeeded / minutes);
      
      const newDate = new Date();
      newDate.setDate(newDate.getDate() + daysNeeded);
      setEditDate(newDate.toISOString().split('T')[0]);
    }
  };

  const handleDateChange = (newDateStr: string, sub: any) => {
    setEditDate(newDateStr);
    if (sub.stats.averageTimePerPage > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(newDateStr);
      target.setHours(0, 0, 0, 0);
      
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 0) {
        const remainingPages = editPages - sub.completedPages;
        const totalMinutesNeeded = sub.stats.averageTimePerPage * remainingPages;
        setEditDailyTime(Math.round(totalMinutesNeeded / diffDays));
      } else {
        setEditDailyTime(Math.round(sub.stats.estimatedRemainingTime));
      }
    }
  };

  const handleSave = (sub: any) => {
    if (onUpdateSubject) {
      onUpdateSubject({
        ...sub,
        totalPages: editPages,
        targetDate: editDate,
      });
    }
    setEditingId(null);
  };

  const formatTime = (minutes: number) => {
    if (minutes <= 0) return "0분";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-lg font-bold text-slate-800 mb-4 px-1 flex items-center gap-2">
          <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
          과목별 상세 분석
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {subjectStats.map(sub => (
            <div key={sub.id} className={`bg-white rounded-2xl border transition-all overflow-hidden flex flex-col hover:shadow-md ${editingId === sub.id ? 'border-indigo-500 ring-2 ring-indigo-500/10 shadow-lg' : 'border-slate-200 shadow-sm'}`}>
              <div className={`p-4 border-b flex justify-between items-center ${editingId === sub.id ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50/50 border-slate-100'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 truncate max-w-[120px]">{sub.name}</span>
                  {!editingId && (
                    <button 
                      onClick={() => startEditing(sub)}
                      className="p-1 text-slate-300 hover:text-indigo-500 transition-colors"
                      title="계획 수정"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                  )}
                </div>
                {editingId === sub.id ? (
                  <div className="flex gap-2">
                    <button onClick={() => setEditingId(null)} className="text-[10px] font-black text-slate-400 uppercase hover:text-slate-600">취소</button>
                    <button onClick={() => handleSave(sub)} className="text-[10px] font-black text-indigo-600 uppercase hover:text-indigo-800">저장</button>
                  </div>
                ) : (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg uppercase ${sub.diffDays > 0 ? 'text-blue-600 bg-blue-50' : 'text-rose-600 bg-rose-50'}`}>
                    D-{sub.diffDays > 0 ? sub.diffDays : 'Day'}
                  </span>
                )}
              </div>
              
              <div className="p-5 space-y-4 flex-grow">
                {editingId === sub.id ? (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">목표 페이지 (P)</label>
                      <input 
                        type="number"
                        value={editPages}
                        onChange={e => setEditPages(Number(e.target.value))}
                        className="w-full p-2 border border-indigo-200 rounded-xl bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                    </div>
                    
                    {sub.stats.averageTimePerPage > 0 ? (
                      <>
                        <div className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg">
                          <label className="text-[9px] font-black uppercase tracking-widest opacity-70 mb-1 block">원하는 하루 학습 시간 (분)</label>
                          <div className="flex items-center gap-3">
                            <input 
                              type="number"
                              value={editDailyTime}
                              onChange={e => handleDailyTimeChange(Number(e.target.value), sub)}
                              className="bg-white/10 border border-white/20 rounded-lg p-2 w-full text-xl font-black focus:outline-none focus:bg-white/20"
                            />
                            <span className="font-bold text-xs opacity-80 whitespace-nowrap">분 / 일</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">목표 기한 (직접 수정 가능)</label>
                          <input 
                            type="date"
                            value={editDate}
                            onChange={e => handleDateChange(e.target.value, sub)}
                            className="w-full p-2 border border-indigo-200 rounded-xl bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/10"
                          />
                          <p className="text-[9px] text-indigo-500 font-bold mt-1 px-1 flex justify-between">
                            <span>실제 학습 데이터(P당 {sub.stats.averageTimePerPage.toFixed(1)}분) 기반</span>
                            <span className="opacity-60 italic">날짜 변경 시 필요 시간 자동 계산</span>
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-4">
                        <div className="p-4 bg-slate-100 rounded-2xl text-center border border-dashed border-slate-300">
                          <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                            학습 데이터가 부족하여<br/>페이스 자동 조절 기능을 사용할 수 없습니다.<br/>
                            <span className="text-indigo-500">기록을 1개 이상 등록해 주세요.</span>
                          </p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-tighter ml-1">목표 기한</label>
                          <input 
                            type="date"
                            value={editDate}
                            onChange={e => setEditDate(e.target.value)}
                            className="w-full p-2 border border-slate-200 rounded-xl bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500/10"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">P당 평균 시간</p>
                        <p className="text-lg font-black text-slate-700">{sub.stats.averageTimePerPage > 0 ? `${sub.stats.averageTimePerPage.toFixed(1)}분` : '-'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">표준 편차</p>
                        <p className="text-lg font-black text-slate-700">{sub.stats.standardDeviation > 0 ? `${sub.stats.standardDeviation.toFixed(1)}분` : '-'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">남은 페이지</p>
                        <p className="text-lg font-black text-amber-600">{sub.totalPages - sub.completedPages}P</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">전체 예상 시간</p>
                        <p className="text-lg font-black text-slate-700">{sub.stats.averageTimePerPage > 0 ? `${(sub.stats.estimatedRemainingTime / 60).toFixed(1)}h` : '-'}</p>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-slate-100">
                      <p className="text-[11px] font-bold text-indigo-500 uppercase mb-1">하루 권장 학습 시간</p>
                      <p className="text-xl font-black text-indigo-900">{sub.stats.averageTimePerPage > 0 ? formatTime(sub.dailyTimeNeeded) : '데이터 부족'}</p>
                      <p className="text-[10px] text-slate-400 mt-1">* 기한 내 완수를 위한 목표 페이스</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          {subjects.length === 0 && (
            <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-dashed border-slate-300 text-slate-400 italic">
              분석할 과목 데이터가 없습니다. 학습 계획을 먼저 추가해 주세요.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
