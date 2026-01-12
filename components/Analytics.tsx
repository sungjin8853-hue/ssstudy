
import React, { useMemo } from 'react';
import { Subject, StudyLog } from '../types';
import { calculateStats } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
}

export const Analytics: React.FC<Props> = ({ subjects, logs }) => {
  // 과목별 상세 통계 계산
  const subjectStats = useMemo(() => {
    return subjects.map(sub => {
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const remaining = sub.totalPages - sub.completedPages;
      const stats = calculateStats(subLogs, remaining);
      
      // 일일 남은 일수 계산
      const today = new Date();
      const target = new Date(sub.targetDate);
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
            <div key={sub.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <span className="font-bold text-slate-800">{sub.name}</span>
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg uppercase">
                  D-{sub.diffDays > 0 ? sub.diffDays : 'Day'}
                </span>
              </div>
              <div className="p-5 space-y-4 flex-grow">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">P당 평균 시간</p>
                    <p className="text-lg font-black text-slate-700">{sub.stats.averageTimePerPage.toFixed(1)}분</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">표준 편차</p>
                    <p className="text-lg font-black text-slate-700">{sub.stats.standardDeviation.toFixed(1)}분</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">남은 페이지</p>
                    <p className="text-lg font-black text-amber-600">{sub.totalPages - sub.completedPages}P</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">전체 예상 시간</p>
                    <p className="text-lg font-black text-slate-700">{(sub.stats.estimatedRemainingTime / 60).toFixed(1)}h</p>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-bold text-indigo-500 uppercase mb-1">하루 권장 학습 시간</p>
                  <p className="text-xl font-black text-indigo-900">{formatTime(sub.dailyTimeNeeded)}</p>
                  <p className="text-[10px] text-slate-400 mt-1">* 목표일 전까지 매일 투자해야 하는 시간</p>
                </div>
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
