import React, { useMemo, useState } from 'react';
import { Subject, StudyLog, TagDefinition, TestCategory, TestRecord } from '../types';
import { calculateStats, calculateRequiredReviewCount, calculateMentalBurden, calculateStudyBurdenV2 } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  testCategories: TestCategory[];
  tagDefinitions: TagDefinition[];
  onUpdateSubject?: (updated: Subject) => void;
  onDeleteSubject?: (id: string) => void;
  onUpdateTags?: (tags: TagDefinition[]) => void;
  onDeleteFolder?: (folderId: string) => void;
}

const COLORS = [
  '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#EC4899', 
  '#8B5CF6', '#06B6D4', '#64748B'
];

export const Analytics: React.FC<Props> = ({ 
  subjects, 
  logs, 
  testCategories,
  tagDefinitions,
  onUpdateSubject, 
  onDeleteSubject,
  onUpdateTags,
  onDeleteFolder
}) => {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set(['root']));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movingItemId, setMovingItemId] = useState<string | null>(null);
  
  // 수정 폼 상태 확장 (이름, 총페이지, 목표날짜)
  const [editForm, setEditForm] = useState<{name: string, totalPages: number, targetDate: string} | null>(null);

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolderIds(next);
  };

  const allSubjectStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const getFormulaInsights = (subId: string) => {
      const allRecords: TestRecord[] = [];
      testCategories.forEach(cat => cat.difficultySpaces.forEach(space => {
        if (space.subjectIds?.includes(subId)) allRecords.push(...space.records);
      }));
      
      if (allRecords.length === 0) return { impact: 0, predicted: 0, reviewCount: 0 };
      
      const sorted = [...allRecords].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const last = sorted[sorted.length - 1];
      const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
      
      let impact = 0, predicted = 0;
      let reviewCount = calculateRequiredReviewCount(last.tTest, last.tRec);

      if (prev) {
        impact = calculateMentalBurden(prev.h1, Math.max(0.1, last.h1 - prev.h1), last.b, last.tStudy, last.tTest, last.tRec).total;
        predicted = calculateStudyBurdenV2({ h1: prev.h1, h2: Math.max(0.1, last.h1 - prev.h1), b: last.b, h3: 10, tStudy: 0, tTest: 0, tRec: 0 }).total;
      }
      
      return { impact, predicted, reviewCount };
    };

    return subjects.map(sub => {
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const remaining = Math.max(0, sub.totalPages - sub.completedPages);
      const stats = calculateStats(subLogs, remaining);
      const target = new Date(sub.targetDate);
      const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const formula = getFormulaInsights(sub.id);

      return {
        ...sub,
        stats,
        diffDays,
        remainingPages: remaining,
        recommendedDailyPages: diffDays > 0 ? Math.ceil(remaining / diffDays) : remaining,
        dailyTimeNeeded: (diffDays > 0 ? Math.ceil(remaining / diffDays) : remaining) * stats.averageTimePerPage,
        totalTimeSpent: stats.totalTimeSpent,
        formula
      };
    });
  }, [subjects, logs, testCategories]);

  const getRecursiveData = (folderId: string) => {
    const findSubjIds = (fid: string): string[] => {
      const childFolders = tagDefinitions.filter(t => t.parentId === fid);
      let subjs = allSubjectStats.filter(s => s.tagIds?.includes(fid));
      childFolders.forEach(cf => {
        subjs = [...subjs, ...allSubjectStats.filter(s => s.tagIds?.includes(cf.id))];
        const deeper = (id: string): any[] => {
          const c = tagDefinitions.filter(t => t.parentId === id);
          let r = allSubjectStats.filter(s => s.tagIds?.includes(id));
          c.forEach(cc => r = [...r, ...deeper(cc.id)]);
          return r;
        };
        subjs = [...subjs, ...deeper(cf.id)];
      });
      return Array.from(new Set(subjs.map(s => s.id)));
    };

    const relatedSubjIds = findSubjIds(folderId);
    const uniqueSubjs = allSubjectStats.filter(s => relatedSubjIds.includes(s.id));
    const count = uniqueSubjs.length;

    return {
      count,
      totalPages: uniqueSubjs.reduce((acc, cur) => acc + cur.totalPages, 0),
      completedPages: uniqueSubjs.reduce((acc, cur) => acc + cur.completedPages, 0),
      sumImp: uniqueSubjs.reduce((acc, cur) => acc + cur.formula.impact, 0),
      sumPred: uniqueSubjs.reduce((acc, cur) => acc + cur.formula.predicted, 0),
      avgRev: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.formula.reviewCount, 0) / count : 0,
      avgEff: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.stats.averageTimePerPage, 0) / count : 0,
      avgStd: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.stats.standardDeviation, 0) / count : 0,
      dailyTime: uniqueSubjs.reduce((acc, cur) => acc + cur.dailyTimeNeeded, 0),
      dailyPages: uniqueSubjs.reduce((acc, cur) => acc + cur.recommendedDailyPages, 0),
      remaining: uniqueSubjs.reduce((acc, cur) => acc + cur.remainingPages, 0),
    };
  };

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const RenderTree = ({ parentId, depth = 0 }: { parentId?: string, depth?: number }) => {
    const folders = tagDefinitions.filter(f => f.parentId === parentId);
    const subjs = allSubjectStats.filter(s => 
      parentId ? s.tagIds?.includes(parentId) : (!s.tagIds || s.tagIds.length === 0)
    );

    return (
      <div className={`space-y-10 ${depth > 0 ? 'ml-6 md:ml-12 pl-6 border-l-4 border-slate-200' : ''}`}>
        {folders.map(folder => {
          const stats = getRecursiveData(folder.id);
          const isExpanded = expandedFolderIds.has(folder.id);
          const isMoving = movingItemId === folder.id;
          const progressPercent = stats.totalPages > 0 ? Math.round((stats.completedPages / stats.totalPages) * 100) : 0;

          return (
            <div key={folder.id} className="relative group/folder">
              <div className={`flex flex-col gap-6 p-10 rounded-[3.5rem] transition-all border shadow-xl ${isExpanded ? 'bg-indigo-950 border-indigo-800 text-white' : 'bg-white border-slate-200 hover:border-indigo-400'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <button onClick={() => toggleFolder(folder.id)} className={`w-14 h-14 flex items-center justify-center rounded-2xl transition-all ${isExpanded ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <span className={`text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                    <span className="text-5xl">📂</span>
                    <div>
                      {editingId === folder.id ? (
                        <input autoFocus defaultValue={folder.name} onBlur={(e) => { onUpdateTags?.(tagDefinitions.map(t => t.id === folder.id ? {...t, name: e.target.value} : t)); setEditingId(null); }} className="bg-slate-800 text-white text-2xl font-black outline-none px-4 py-2 rounded-xl border border-indigo-500" />
                      ) : (
                        <h4 onClick={() => toggleFolder(folder.id)} className="text-3xl font-black cursor-pointer hover:underline">{folder.name}</h4>
                      )}
                      <p className={`text-[10px] font-black uppercase mt-2 tracking-[0.2em] ${isExpanded ? 'text-indigo-300' : 'text-slate-400'}`}>{stats.count}개 분석 통합 리포트</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 relative z-30">
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMovingItemId(isMoving ? null : folder.id); }} onMouseDown={e => e.stopPropagation()} className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all cursor-pointer ${isMoving ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-300 hover:text-indigo-600'}`}>🔄</button>
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingId(folder.id); }} onMouseDown={e => e.stopPropagation()} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-300 hover:text-emerald-600 transition-all cursor-pointer">✎</button>
                    <button 
                        onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation();
                            if (onDeleteFolder) onDeleteFolder(folder.id);
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                    >
                        ✕
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                   <StatBox label="예측(b)" value={stats.sumPred.toFixed(1)} unit="P" color="text-indigo-400" highlight isDark={isExpanded} />
                   <StatBox label="부하(L)" value={stats.sumImp.toFixed(2)} unit="" color="text-rose-400" highlight isDark={isExpanded} />
                   <StatBox label="평균 효율" value={stats.avgEff.toFixed(1)} unit="m/p" color="text-emerald-400" isDark={isExpanded} />
                   <StatBox label="표준편차(σ)" value={stats.avgStd.toFixed(1)} unit="" color="text-blue-400" isDark={isExpanded} />
                   <StatBox label="잔여(P)" value={stats.remaining.toString()} unit="P" color="text-amber-400" isDark={isExpanded} />
                   <StatBox label="일일 권장" value={stats.dailyPages.toString()} unit="P" color="text-slate-300" isDark={isExpanded} />
                   <StatBox label="필요 시간" value={formatTime(stats.dailyTime)} unit="" color="text-indigo-300" isDark={isExpanded} />
                </div>

                <div className="space-y-4">
                   <div className="flex justify-between items-end">
                      <p className={`text-[10px] font-black uppercase tracking-widest ${isExpanded ? 'text-indigo-300' : 'text-slate-400'}`}>전체 진행률 ({progressPercent}%)</p>
                      <p className={`text-xs font-bold ${isExpanded ? 'text-white/40' : 'text-slate-300'}`}>{stats.completedPages} / {stats.totalPages} P</p>
                   </div>
                   <div className={`w-full h-3 rounded-full overflow-hidden ${isExpanded ? 'bg-white/10' : 'bg-slate-100'}`}>
                      <div className="h-full bg-indigo-500 transition-all duration-1000 shadow-xl" style={{ width: `${progressPercent}%` }}></div>
                   </div>
                </div>

                {isMoving && (
                  <div className="mt-4 bg-white/5 p-6 rounded-[2.5rem] border border-white/10 animate-fade-in relative z-30">
                    <p className="text-[10px] font-black text-indigo-400 uppercase mb-4 px-2">📂 이 폴더를 어디로 이동할까요?</p>
                    <div className="flex flex-wrap gap-3">
                       <button onClick={(e) => { e.stopPropagation(); onUpdateTags?.(tagDefinitions.map(t => t.id === folder.id ? {...t, parentId: undefined} : t)); setMovingItemId(null); }} className="px-6 py-3 bg-white text-slate-900 rounded-2xl font-black text-xs shadow-sm hover:bg-indigo-600 hover:text-white transition-all">최상위(Root)</button>
                       {tagDefinitions.filter(t => t.id !== folder.id).map(t => (
                         <button key={t.id} onClick={(e) => { e.stopPropagation(); onUpdateTags?.(tagDefinitions.map(tg => tg.id === folder.id ? {...tg, parentId: t.id} : tg)); setMovingItemId(null); }} className="px-6 py-3 bg-white text-slate-900 rounded-2xl font-black text-xs shadow-sm hover:bg-indigo-600 hover:text-white transition-all">📂 {t.name}</button>
                       ))}
                    </div>
                  </div>
                )}
              </div>
              {isExpanded && <RenderTree parentId={folder.id} depth={depth + 1} />}
            </div>
          );
        })}

        {subjs.map(sub => {
          const isMoving = movingItemId === sub.id;
          const isEditing = editingId === sub.id;
          const progressPercent = sub.totalPages > 0 ? Math.round((sub.completedPages / sub.totalPages) * 100) : 0;

          return (
            <div key={sub.id} className="flex flex-col gap-8 p-12 bg-white border-2 border-slate-100 rounded-[4rem] hover:shadow-2xl hover:border-indigo-400 transition-all group/subj relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6 flex-grow">
                  <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center group-hover/subj:bg-indigo-600 group-hover/subj:text-white transition-all shadow-sm flex-shrink-0">
                    <span className="text-4xl">📄</span>
                  </div>
                  <div className="w-full">
                    {isEditing ? (
                       <input 
                           value={editForm?.name || ''} 
                           onChange={e => setEditForm(prev => prev ? {...prev, name: e.target.value} : null)}
                           className="text-2xl md:text-3xl font-black text-slate-900 bg-slate-50 border-b-2 border-indigo-500 outline-none w-full py-1"
                           autoFocus
                           placeholder="과목명"
                       />
                    ) : (
                       <h4 className="text-2xl md:text-3xl font-black text-slate-900">{sub.name}</h4>
                    )}
                    {isEditing ? (
                       <div className="mt-2 flex items-center gap-2">
                           <span className="text-xs font-bold text-indigo-400">목표일:</span>
                           <input
                               type="date"
                               value={editForm?.targetDate || ''}
                               onChange={e => setEditForm(prev => prev ? {...prev, targetDate: e.target.value} : null)}
                               className="bg-slate-100 border-b-2 border-indigo-300 text-slate-800 font-bold text-sm py-1 px-2 outline-none rounded-lg"
                           />
                       </div>
                    ) : (
                        <div className="flex items-center gap-4 mt-3">
                          <span className={`text-[10px] font-black px-4 py-1.5 rounded-full ${sub.diffDays > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>D-{sub.diffDays > 0 ? sub.diffDays : '0'}</span>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:inline">실시간 학습 데이터 정밀 분석</span>
                        </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 relative z-30 flex-shrink-0">
                  {isEditing ? (
                     <button 
                        onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation(); 
                            if (onUpdateSubject && editForm) {
                                onUpdateSubject({ 
                                    ...sub, 
                                    name: editForm.name, 
                                    totalPages: Number(editForm.totalPages),
                                    targetDate: editForm.targetDate
                                });
                            }
                            setEditingId(null);
                            setEditForm(null);
                        }} 
                        className="w-12 h-12 flex items-center justify-center rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700 transition-all cursor-pointer shadow-lg active:scale-95"
                     >
                        ✓
                     </button>
                  ) : (
                    <>
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMovingItemId(isMoving ? null : sub.id); }} onMouseDown={e => e.stopPropagation()} className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all cursor-pointer ${isMoving ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-300 hover:text-indigo-600'}`}>🔄</button>
                      <button 
                          onClick={(e) => { 
                            e.preventDefault(); 
                            e.stopPropagation(); 
                            setEditingId(sub.id);
                            setEditForm({ name: sub.name, totalPages: sub.totalPages, targetDate: sub.targetDate });
                          }} 
                          onMouseDown={e => e.stopPropagation()}
                          className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-300 hover:text-emerald-600 transition-all cursor-pointer"
                      >
                          ✎
                      </button>
                      <button 
                          onClick={(e) => { 
                            e.preventDefault(); 
                            e.stopPropagation(); 
                            if (onDeleteSubject) onDeleteSubject(sub.id); 
                          }} 
                          onMouseDown={e => e.stopPropagation()}
                          className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                      >
                          ✕
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 p-8 bg-slate-50 rounded-[3rem] border border-slate-100">
                 <StatBox label="예측(b)" value={sub.formula.predicted.toFixed(1)} unit="P" color="text-indigo-600" highlight />
                 <StatBox label="부하(L)" value={sub.formula.impact.toFixed(2)} unit="" color="text-rose-600" highlight />
                 <StatBox label="복습량" value={sub.formula.reviewCount.toFixed(1)} unit="회" color="text-emerald-600" highlight />
                 <StatBox label="효율(m/p)" value={sub.stats.averageTimePerPage.toFixed(1)} unit="" color="text-indigo-400" />
                 <StatBox label="편차(σ)" value={sub.stats.standardDeviation.toFixed(1)} unit="" color="text-blue-400" />
                 <StatBox label="잔여(P)" value={sub.remainingPages.toString()} unit="P" color="text-amber-500" />
                 <StatBox label="일일 권장" value={sub.recommendedDailyPages.toString()} unit="P" color="text-slate-800" />
                 <StatBox label="필요 시간" value={formatTime(sub.dailyTimeNeeded)} unit="" color="text-slate-900" />
              </div>

              <div className="space-y-4 px-2">
                 <div className="flex justify-between items-end">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">학습 진척도 ({progressPercent}%)</p>
                    {isEditing ? (
                        <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-xl">
                            <span className="text-xs font-bold text-indigo-400">목표 P 수정:</span>
                            <input 
                                type="number"
                                value={editForm?.totalPages || 0}
                                onChange={e => setEditForm(prev => prev ? {...prev, totalPages: Number(e.target.value)} : null)}
                                className="w-20 text-right text-lg font-black text-indigo-900 bg-transparent border-b-2 border-indigo-300 outline-none"
                            />
                            <span className="text-xs font-black text-indigo-400">Page</span>
                        </div>
                    ) : (
                        <p className="text-xl font-black text-slate-900">{sub.completedPages} / {sub.totalPages} <span className="text-xs text-slate-400 font-bold ml-1">P</span></p>
                    )}
                 </div>
                 <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div className="h-full bg-indigo-500 transition-all duration-1000 shadow-xl" style={{ width: `${progressPercent}%` }}></div>
                 </div>
              </div>

              {isMoving && (
                <div className="mt-4 bg-slate-900 p-8 rounded-[3rem] border border-slate-800 animate-in slide-in-from-top-4 relative z-30">
                  <p className="text-[10px] font-black text-slate-500 uppercase mb-6 px-2">📄 이 과목을 어느 폴더로 옮길까요?</p>
                  <div className="flex flex-wrap gap-4">
                     <button onClick={(e) => { e.stopPropagation(); onUpdateSubject?.({...sub, tagIds: []}); setMovingItemId(null); }} className="px-8 py-4 bg-slate-800 hover:bg-indigo-600 text-white rounded-2xl font-black text-xs shadow-lg transition-all border border-slate-700">홈(Home/Root)</button>
                     {tagDefinitions.map(t => (
                       <button key={t.id} onClick={(e) => { e.stopPropagation(); onUpdateSubject?.({...sub, tagIds: [t.id]}); setMovingItemId(null); }} className="px-8 py-4 bg-slate-800 hover:bg-indigo-600 text-white rounded-2xl font-black text-xs shadow-lg transition-all border border-slate-700">📂 {t.name}</button>
                     ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-12 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm gap-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none text-slate-200"><span className="text-[14rem] font-black">CORE</span></div>
        <div className="relative z-10">
          <h3 className="text-5xl font-black text-slate-900 flex items-center gap-6">
            <span className="w-5 h-14 bg-indigo-600 rounded-full"></span>
            학습 탐색기
          </h3>
          <p className="text-sm font-black text-slate-400 mt-4 uppercase tracking-[0.3em]">수치 적분 모델 및 통계 지표 기반 통합 분석 엔진</p>
        </div>
        <button 
          onClick={() => {
            const newId = Math.random().toString(36).substr(2, 9);
            onUpdateTags?.([...tagDefinitions, { id: newId, name: '새 폴더', color: COLORS[tagDefinitions.length % COLORS.length], isVisible: true }]);
            setEditingId(newId);
          }}
          className="relative z-10 bg-slate-900 text-white px-16 py-7 rounded-[2.5rem] font-black text-sm hover:bg-indigo-600 transition-all shadow-2xl active:scale-95"
        >
          ＋ 새 분석 그룹 추가
        </button>
      </div>

      <div className="bg-slate-200/30 p-6 md:p-12 rounded-[5rem] border-4 border-dashed border-slate-300/50 min-h-[900px]">
        <RenderTree />
        
        {subjects.length === 0 && tagDefinitions.length === 0 && (
          <div className="py-72 text-center opacity-10 grayscale scale-150">
            <p className="text-[100px] mb-8">🔍</p>
            <p className="text-xl font-black uppercase tracking-widest">데이터 없음</p>
          </div>
        )}
      </div>
    </div>
  );
};

const StatBox = ({ label, value, unit, color, isDark, highlight }: { label: string, value: string, unit: string, color: string, isDark?: boolean, highlight?: boolean }) => (
  <div className={`flex flex-col p-4 rounded-2xl transition-all ${highlight ? (isDark ? 'bg-white/10' : 'bg-white shadow-md border border-slate-100 scale-105 z-10') : 'opacity-90'}`}>
    <p className={`text-[8px] md:text-[9px] font-black uppercase mb-1.5 tracking-tighter ${isDark ? 'text-indigo-400' : 'text-slate-400'}`}>{label}</p>
    <p className={`text-xl md:text-2xl font-black truncate leading-none ${isDark && !highlight ? 'text-white' : color}`}>
      {value}<span className="text-[10px] font-bold ml-1 opacity-40">{unit}</span>
    </p>
  </div>
);
