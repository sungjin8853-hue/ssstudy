import React, { useState, useEffect, useMemo } from 'react';
import { StudyLog, Subject } from '../types';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  onReviewAction: (logId: string, action: 'complete' | 'condense') => void;
}

export const ReviewManager: React.FC<Props> = ({ logs, subjects, onReviewAction }) => {
  const [activeReviewLog, setActiveReviewLog] = useState<StudyLog | null>(null);
  const [timer, setTimer] = useState(0);

  // 현재 시각 기준, 복습이 필요한 항목 필터링 (condensed 제외)
  // 정렬: 가장 오래 기다린(Next Review Date가 과거인) 순서 -> Oldest First
  const dueReviews = useMemo(() => {
    const now = new Date().getTime();
    return logs
      .filter(log => !log.isCondensed) // 축약된 것 제외
      .filter(log => {
        // nextReviewDate가 없으면(legacy) 즉시 대상으로 간주
        const nextReview = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
        return nextReview <= now;
      })
      .sort((a, b) => {
        // Next Review Date 오름차순 (가장 과거인 것부터 = 가장 급한 것)
        const dateA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
        const dateB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
        return dateA - dateB;
      });
  }, [logs]);

  // 대기 중인(미래의) 복습 목록
  const upcomingReviews = useMemo(() => {
    const now = new Date().getTime();
    return logs
      .filter(log => !log.isCondensed)
      .filter(log => {
        const nextReview = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
        return nextReview > now;
      })
      .sort((a, b) => {
        const dateA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
        const dateB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
        return dateA - dateB;
      });
  }, [logs]);

  const startReviewSession = (log: StudyLog) => {
    setActiveReviewLog(log);
    setTimer(0);
  };

  const finishReviewSession = () => {
    if (activeReviewLog) {
      onReviewAction(activeReviewLog.id, 'complete');
      setActiveReviewLog(null);
    }
  };

  const handleCondense = (logId: string) => {
      if(window.confirm('이 내용을 "축약(졸업)" 처리하시겠습니까?\n더 이상 복습 목록에 나타나지 않습니다.')) {
          onReviewAction(logId, 'condense');
          setActiveReviewLog(null); // 혹시 열려있다면 닫기
      }
  }

  useEffect(() => {
    let interval: number;
    if (activeReviewLog) {
      interval = window.setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeReviewLog]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getNextIntervalLabel = (step?: number) => {
      const s = step || 0;
      // Step 0(2시간 후 복습)을 수행 중 -> 다음은 1일 후
      if (s === 0) return "1일 후";
      if (s === 1) return "4일 후";
      if (s === 2) return "7일 후";
      if (s === 3) return "14일 후";
      if (s === 4) return "28일 후";
      if (s === 5) return "56일 후";
      return "장기 기억";
  }

  return (
    <div className="space-y-10 relative">
      {/* 복습 세션 오버레이 */}
      {activeReviewLog && (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 flex flex-col items-center justify-center p-4 md:p-10 animate-in fade-in zoom-in duration-300">
          <div className="w-full max-w-4xl flex flex-col h-full gap-6">
            <div className="flex justify-between items-center text-white">
              <div>
                <h4 className="text-2xl font-black">{subjects.find(s => s.id === activeReviewLog.subjectId)?.name} 복습 중</h4>
                <div className="flex items-center gap-3 mt-1">
                   <p className="text-slate-400 text-sm">{new Date(activeReviewLog.timestamp).toLocaleDateString()} 학습분</p>
                   <span className="px-2 py-0.5 bg-indigo-500 rounded text-[10px] font-bold text-white">현재 단계: {activeReviewLog.reviewStep || 0}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">진행 시간</p>
                <p className="text-4xl font-mono font-black text-white">{formatTimer(timer)}</p>
              </div>
            </div>

            <div className="flex-grow bg-slate-800 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl relative group">
              {activeReviewLog.photoBase64 ? (
                <img 
                  src={activeReviewLog.photoBase64} 
                  className="w-full h-full object-contain" 
                  alt="Study Note" 
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                  <span className="text-6xl">📝</span>
                  <p>첨부된 사진이 없습니다. 내용을 회상하며 복습하세요.</p>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button onClick={() => setActiveReviewLog(null)} className="flex-1 py-4 rounded-2xl bg-slate-700 text-white font-bold hover:bg-slate-600 transition-colors">잠시 중단</button>
              <button onClick={() => handleCondense(activeReviewLog.id)} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-900 font-bold hover:bg-white transition-colors">축약 (졸업)</button>
              <button onClick={finishReviewSession} className="flex-[2] py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/20">
                  복습 완료 ({getNextIntervalLabel(activeReviewLog.reviewStep)})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. 오늘 복습해야 할 내용 (Priority Queue) */}
      <section>
        <div className="flex justify-between items-end mb-6 px-2">
          <div>
            <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <span className="p-2 bg-rose-100 text-rose-600 rounded-xl text-lg">⚡</span> 
              오늘의 복습 큐 (Queue)
            </h3>
            <p className="text-xs text-slate-400 mt-2 font-bold">가장 오래 기다린(시급한) 항목부터 순서대로 표시됩니다.</p>
          </div>
          <span className="text-sm font-black text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg">{dueReviews.length}개 대기 중</span>
        </div>
        
        <div className="space-y-4">
          {dueReviews.length > 0 ? dueReviews.map((log, idx) => (
            <div key={log.id} className="bg-white p-6 rounded-[2rem] border-2 border-rose-100 hover:border-rose-300 transition-all shadow-sm flex flex-col md:flex-row md:items-center gap-6 group">
                <div className="flex items-center gap-4 flex-[2]">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center font-black text-xl shadow-inner">
                        {idx + 1}
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold">Step {log.reviewStep || 0}</span>
                            <span className="text-[10px] text-slate-400">{new Date(log.timestamp).toLocaleDateString()} 학습</span>
                        </div>
                        <h4 className="text-xl font-black text-slate-800">{subjects.find(s => s.id === log.subjectId)?.name || '과목 없음'}</h4>
                    </div>
                </div>
                
                <div className="flex items-center gap-3 flex-1 justify-end">
                    <button 
                        onClick={() => handleCondense(log.id)}
                        className="px-5 py-3 rounded-xl bg-slate-100 text-slate-500 font-bold text-xs hover:bg-slate-200 transition-all"
                    >
                        축약 (졸업)
                    </button>
                    <button 
                        onClick={() => startReviewSession(log)}
                        className="flex-1 md:flex-none px-8 py-3 rounded-xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 shadow-lg shadow-rose-200 transition-all active:scale-95"
                    >
                        지금 복습하기
                    </button>
                </div>
            </div>
          )) : (
            <div className="py-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-200">
              <span className="text-4xl block mb-4">🎉</span>
              <h4 className="text-lg font-black text-slate-700">현재 대기 중인 복습이 없습니다!</h4>
              <p className="text-xs text-slate-400 mt-2">모든 복습을 완료했거나, 아직 도래하지 않았습니다.</p>
            </div>
          )}
        </div>
      </section>

      {/* 2. 다가오는 복습 (Upcoming) */}
      <section className="opacity-80 hover:opacity-100 transition-opacity">
        <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center gap-2 px-2 mt-12">
          <span className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg text-sm">⏳</span> 
          다가오는 복습 일정
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcomingReviews.map(log => {
             const timeLeft = log.nextReviewDate 
                ? Math.ceil((new Date(log.nextReviewDate).getTime() - new Date().getTime()) / (1000 * 60 * 60)) 
                : 0;
             const timeLeftStr = timeLeft > 24 ? `${Math.ceil(timeLeft/24)}일 후` : `${timeLeft}시간 후`;

             return (
              <div key={log.id} className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col justify-between h-32 relative overflow-hidden group">
                  <div className="flex justify-between items-start z-10">
                      <div>
                          <p className="text-[10px] font-bold text-slate-400">Step {log.reviewStep || 0}</p>
                          <p className="font-bold text-slate-800 mt-1">{subjects.find(s => s.id === log.subjectId)?.name}</p>
                      </div>
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black">{timeLeftStr}</span>
                  </div>
                  <div className="flex justify-between items-end z-10">
                      <p className="text-[10px] text-slate-400">{new Date(log.timestamp).toLocaleDateString()}</p>
                      <button onClick={() => handleCondense(log.id)} className="text-[10px] text-slate-300 hover:text-rose-500 transition-colors">축약하기</button>
                  </div>
                  {/* Progress Bar Background visual */}
                  <div className="absolute bottom-0 left-0 h-1 bg-indigo-500 w-full opacity-10"></div>
              </div>
             );
          })}
        </div>
        {upcomingReviews.length === 0 && (
            <p className="text-center text-slate-400 text-xs italic py-8">예정된 복습 일정이 없습니다.</p>
        )}
      </section>
    </div>
  );
};
