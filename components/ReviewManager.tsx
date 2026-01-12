
import React, { useState, useEffect, useMemo } from 'react';
import { StudyLog, Subject } from '../types';

interface Props {
  logs: StudyLog[];
  subjects: Subject[];
  onToggleReview: (logId: string) => void;
}

export const ReviewManager: React.FC<Props> = ({ logs, subjects, onToggleReview }) => {
  const [activeReviewLog, setActiveReviewLog] = useState<StudyLog | null>(null);
  const [timer, setTimer] = useState(0);

  // 기억도 계산 함수 (단순화된 에빙하우스 모델)
  // R = e^(-t/S) -> t: 경과일, S: 강도(복습 시 증가)
  const calculateRetention = (timestamp: string, isReviewed: boolean) => {
    const hoursSince = (new Date().getTime() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
    const daysSince = hoursSince / 24;
    // 복습을 한 경우 기억 지속 시간(S)을 2배로 가정 (간단한 모델)
    const stability = isReviewed ? 14 : 4; 
    const retention = Math.exp(-daysSince / stability);
    return Math.max(0, Math.min(100, Math.round(retention * 100)));
  };

  // 복습 추천: 임계 주기(1,3,7,14,30일)에 해당하며 '가장 오래된 것'부터 정렬
  const recommendations = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return logs
      .filter(log => {
        const logDate = new Date(log.timestamp);
        logDate.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((today.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
        // 특정 주기에 도달했거나, 기억도가 40% 이하로 떨어진 미복습 항목들
        const retention = calculateRetention(log.timestamp, !!log.isReviewed);
        const isCycleDay = [1, 3, 7, 14, 30].includes(diffDays);
        return (isCycleDay || retention < 40) && !log.isReviewed;
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // 오래된 것 우선
  }, [logs]);

  // 아카이브: 기억도가 낮은(망각이 많이 진행된) 순서로 정렬하여 직관성 제공
  const archiveLogs = useMemo(() => {
    return [...logs].sort((a, b) => {
      const retA = calculateRetention(a.timestamp, !!a.isReviewed);
      const retB = calculateRetention(b.timestamp, !!b.isReviewed);
      return retA - retB; // 기억도 낮은 순(복습이 급한 순)
    }).slice(0, 24);
  }, [logs]);

  const startReviewSession = (log: StudyLog) => {
    setActiveReviewLog(log);
    setTimer(0);
  };

  const finishReviewSession = () => {
    if (activeReviewLog) {
      onToggleReview(activeReviewLog.id);
      setActiveReviewLog(null);
    }
  };

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

  return (
    <div className="space-y-10 relative">
      {/* 복습 세션 오버레이 */}
      {activeReviewLog && (
        <div className="fixed inset-0 z-[100] bg-slate-900/95 flex flex-col items-center justify-center p-4 md:p-10 animate-in fade-in zoom-in duration-300">
          <div className="w-full max-w-4xl flex flex-col h-full gap-6">
            <div className="flex justify-between items-center text-white">
              <div>
                <h4 className="text-2xl font-black">{subjects.find(s => s.id === activeReviewLog.subjectId)?.name} 복습 중</h4>
                <p className="text-slate-400 text-sm">{new Date(activeReviewLog.timestamp).toLocaleDateString()} 학습분</p>
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
              <button onClick={() => setActiveReviewLog(null)} className="flex-1 py-4 rounded-2xl bg-slate-700 text-white font-bold hover:bg-slate-600 transition-colors">중단</button>
              <button onClick={finishReviewSession} className="flex-[2] py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/20">복습 완료</button>
            </div>
          </div>
        </div>
      )}

      {/* 1. 복습 추천 섹션 (오래된 것 중심) */}
      <section>
        <div className="flex justify-between items-end mb-4 px-1">
          <div>
            <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <span className="p-1.5 bg-orange-100 text-orange-600 rounded-lg text-sm">🔥</span> 
              우선 순위 복습 추천
            </h3>
            <p className="text-xs text-slate-400 mt-1">망각이 가장 많이 진행된 오래된 학습부터 보여줍니다.</p>
          </div>
          <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-md">{recommendations.length}개 대기 중</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recommendations.length > 0 ? recommendations.map(log => (
            <ReviewCard 
              key={log.id} 
              log={log} 
              retention={calculateRetention(log.timestamp, !!log.isReviewed)}
              subjectName={subjects.find(s => s.id === log.subjectId)?.name || '과목 없음'} 
              onStartReview={() => startReviewSession(log)}
            />
          )) : (
            <div className="col-span-full py-12 text-center bg-white rounded-2xl border-2 border-dashed border-slate-100 text-slate-400 text-sm">
              <p className="text-2xl mb-2">🎉</p>
              완벽합니다! 지금 당장 급한 복습 항목이 없습니다.
            </div>
          )}
        </div>
      </section>

      {/* 2. 전체 학습 아카이브 (기억도 낮은 순 정렬) */}
      <section>
        <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2 px-1">
          <span className="p-1.5 bg-blue-100 text-blue-600 rounded-lg text-sm">🧠</span> 
          망각 진행도 기반 아카이브
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {archiveLogs.map(log => {
            const retention = calculateRetention(log.timestamp, !!log.isReviewed);
            return (
              <div key={log.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col group hover:shadow-md transition-all">
                <div className="relative h-28 w-full overflow-hidden bg-slate-50">
                  {log.photoBase64 ? (
                    <img src={log.photoBase64} className="w-full h-full object-cover group-hover:scale-105 transition-transform" alt="Note" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 text-[10px]">이미지 없음</div>
                  )}
                  <div className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button onClick={() => startReviewSession(log)} className="bg-white text-slate-900 text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg">복습하기</button>
                  </div>
                  {/* 기억도 뱃지 */}
                  <div className={`absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold text-white shadow-sm ${retention < 40 ? 'bg-red-500' : retention < 70 ? 'bg-orange-500' : 'bg-green-500'}`}>
                    기억도 {retention}%
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex justify-between items-center mb-1">
                    <p className="font-bold text-slate-800 text-xs truncate flex-grow mr-2">{subjects.find(s => s.id === log.subjectId)?.name}</p>
                    <span className="text-[9px] text-slate-400 whitespace-nowrap">{new Date(log.timestamp).toLocaleDateString()}</span>
                  </div>
                  <div className="w-full bg-slate-100 h-1 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full transition-all duration-1000 ${retention < 40 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${retention}%` }}></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

const ReviewCard: React.FC<{ log: StudyLog; subjectName: string; retention: number; onStartReview: () => void }> = ({ log, subjectName, retention, onStartReview }) => {
  const diffDays = Math.floor((new Date().getTime() - new Date(log.timestamp).getTime()) / (1000 * 60 * 60 * 24));
  
  return (
    <div className="bg-white p-5 rounded-2xl border-2 border-slate-100 flex items-center gap-4 shadow-sm hover:border-orange-300 transition-all group relative overflow-hidden">
      {/* 배경 기억도 게이지 (희미하게) */}
      <div className="absolute left-0 bottom-0 top-0 w-1 bg-orange-500 opacity-20 group-hover:opacity-100 transition-opacity" style={{ height: '100%' }}></div>
      
      <div className="flex-grow">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${diffDays > 7 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
            {diffDays}일째 방치 중
          </span>
          <span className="text-[10px] font-bold text-slate-400">학습일: {new Date(log.timestamp).toLocaleDateString()}</span>
        </div>
        <p className="font-black text-slate-800 text-xl mb-1">{subjectName}</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500">예상 기억 유지력:</span>
          <span className={`text-xs font-black ${retention < 30 ? 'text-red-500' : 'text-orange-600'}`}>{retention}%</span>
        </div>
      </div>

      <button 
        onClick={onStartReview}
        className="w-16 h-16 rounded-2xl bg-slate-900 text-white flex flex-col items-center justify-center hover:bg-orange-600 transition-all shadow-lg group-hover:scale-110"
      >
        <span className="text-xl">🚀</span>
        <span className="text-[10px] font-black mt-1">복습</span>
      </button>
    </div>
  );
};
