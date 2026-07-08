import React, { useMemo, useState } from 'react';
import { Subject, StudyLog, TagDefinition } from '../types';
import { calculateStats } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
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
  const [editForm, setEditForm] = useState<{name: string, totalPages: number, targetDate: string, habitBadKeyword?: string, habitGoodKeyword?: string} | null>(null);

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolderIds(next);
  };

  const allSubjectStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return subjects.map(sub => {
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const remaining = Math.max(0, sub.totalPages - sub.completedPages);
      const target = new Date(sub.targetDate);
      const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const recommendedDailyPages = diffDays > 0 ? Math.ceil(remaining / diffDays) : remaining;
      const stats = calculateStats(subLogs, remaining, recommendedDailyPages);

      return {
        ...sub,
        stats,
        diffDays,
        remainingPages: remaining,
        recommendedDailyPages,
        dailyTimeNeeded: recommendedDailyPages * stats.averageTimePerPage,
        totalTimeSpent: stats.totalTimeSpent
      };
    });
  }, [subjects, logs]);

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
      avgEff: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.stats.averageTimePerPage, 0) / count : 0,
      avgStd: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.stats.standardDeviation, 0) / count : 0,
      dailyTime: uniqueSubjs.reduce((acc, cur) => acc + cur.dailyTimeNeeded, 0),
      dailyPages: uniqueSubjs.reduce((acc, cur) => acc + cur.recommendedDailyPages, 0),
      remaining: uniqueSubjs.reduce((acc, cur) => acc + cur.remainingPages, 0),
    };
  };

  const totalFolderDailyTime = useMemo(() => {
    const rootFolders = tagDefinitions.filter(folder => !folder.parentId);
    return rootFolders.reduce((sum, folder) => sum + getRecursiveData(folder.id).dailyTime, 0);
  }, [tagDefinitions, allSubjectStats]);

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const completeHabit = (subject: Subject) => {
    if (!subject.habit || subject.habit.completed || !onUpdateSubject) return;
    onUpdateSubject({
      ...subject,
      habit: {
        ...subject.habit,
        completed: true,
        updatedAt: new Date().toISOString()
      }
    });
  };

  const addHabit = (subject: Subject) => {
    if (!onUpdateSubject) return;
    const now = new Date().toISOString();
    onUpdateSubject({
      ...subject,
      habit: {
        id: Math.random().toString(36).substr(2, 9),
        badKeyword: '새로 고칠 습관',
        goodKeyword: subject.habit?.goodKeyword || '좋은 습관',
        goodCount: 0,
        totalChecks: 0,
        createdAt: now,
        updatedAt: now
      }
    });
    setEditingId(subject.id);
    setEditForm({
      name: subject.name,
      totalPages: subject.totalPages,
      targetDate: subject.targetDate,
      habitBadKeyword: '새로 고칠 습관',
      habitGoodKeyword: subject.habit?.goodKeyword || '좋은 습관'
    });
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

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
            <div key={sub.id} className="flex flex-col gap-5 p-6 md:p-8 bg-white border-2 border-slate-100 rounded-[2.5rem] hover:shadow-2xl hover:border-indigo-400 transition-all group/subj relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-grow">
                  <div className="w-12 h-12 md:w-14 md:h-14 bg-slate-50 rounded-2xl flex items-center justify-center group-hover/subj:bg-indigo-600 group-hover/subj:text-white transition-all shadow-sm flex-shrink-0">
                    <span className="text-2xl md:text-3xl">📄</span>
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
                       <h4 className="text-xl md:text-2xl font-black text-slate-900">{sub.name}</h4>
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
                         <div className="flex flex-wrap items-center gap-3 mt-2">
                          <span className={`text-[9px] font-black px-3 py-1 rounded-full ${sub.diffDays > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>D-{sub.diffDays > 0 ? sub.diffDays : '0'}</span>
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
                                const nextHabit = sub.habit
                                  ? {
                                      ...sub.habit,
                                      badKeyword: editForm.habitBadKeyword ?? sub.habit.badKeyword,
                                      goodKeyword: editForm.habitGoodKeyword ?? sub.habit.goodKeyword,
                                      updatedAt: new Date().toISOString()
                                    }
                                  : undefined;
                                onUpdateSubject({ 
                                    ...sub,
                                    name: editForm.name, 
                                    totalPages: Number(editForm.totalPages),
                                    targetDate: editForm.targetDate,
                                    habit: nextHabit
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
                            setEditForm({
                              name: sub.name,
                              totalPages: sub.totalPages,
                              targetDate: sub.targetDate,
                              habitBadKeyword: sub.habit?.badKeyword,
                              habitGoodKeyword: sub.habit?.goodKeyword
                            });
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

              <div className="grid grid-cols-3 gap-1.5 md:gap-2 p-2 md:p-3 bg-slate-50 rounded-2xl border border-slate-100 [&>*:nth-child(2)]:hidden [&>*:nth-child(3)]:hidden">
                 <StatBox label="효율(m/p)" value={sub.stats.averageTimePerPage.toFixed(1)} unit="" color="text-indigo-400" />
                 <StatBox label="편차(σ)" value={sub.stats.standardDeviation.toFixed(1)} unit="" color="text-blue-400" />
                 <StatBox label="잔여(P)" value={sub.remainingPages.toString()} unit="P" color="text-amber-500" />
                 <StatBox label="일일 권장" value={sub.recommendedDailyPages.toString()} unit="P" color="text-slate-800" />
                 <StatBox label="필요 시간" value={formatTime(sub.dailyTimeNeeded)} unit="" color="text-slate-900" />
              </div>

              <div className="space-y-2 px-1">
                 <div className="flex justify-between items-end">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">학습 진척도 ({progressPercent}%)</p>
                    {isEditing ? (
                        <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1 rounded-xl">
                            <span className="text-xs font-bold text-indigo-400">목표 P 수정:</span>
                            <input 
                                type="number"
                                step="1"
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
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div className="h-full bg-indigo-500 transition-all duration-1000 shadow-xl" style={{ width: `${progressPercent}%` }}></div>
                 </div>
              </div>

              {(sub.habit || isEditing) && (
                <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-4">
                  {sub.habit && !sub.habit.completed ? (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">습관 교정</p>
                        <p className="hidden">
                          좋은 체크 {sub.habit.goodCount} / 전체 {sub.habit.totalChecks}
                        </p>
                        <p className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black text-emerald-600">
                          좋은 습관 {sub.habit.goodCount}회
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                        <div className="rounded-2xl bg-white p-4 border border-rose-100">
                          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-rose-400">고칠 습관</p>
                          {isEditing ? (
                            <input
                              value={editForm?.habitBadKeyword || ''}
                              onChange={e => setEditForm(prev => prev ? {...prev, habitBadKeyword: e.target.value} : null)}
                              className="w-full bg-transparent text-base font-black text-rose-700 outline-none"
                            />
                          ) : (
                            <p className="font-black text-rose-700">{sub.habit.badKeyword}</p>
                          )}
                        </div>
                        <div className="hidden text-center text-slate-300 md:block">→</div>
                        <div className="rounded-2xl bg-white p-4 border border-emerald-100">
                          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-emerald-500">좋은 습관</p>
                          {isEditing ? (
                            <input
                              value={editForm?.habitGoodKeyword || ''}
                              onChange={e => setEditForm(prev => prev ? {...prev, habitGoodKeyword: e.target.value} : null)}
                              className="w-full bg-transparent text-base text-emerald-700 outline-none"
                              style={{ fontWeight: Math.min(900, 650 + Math.min(sub.habit.goodCount, 5) * 50) }}
                            />
                          ) : (
                            <p className="text-emerald-700" style={{ fontWeight: Math.min(900, 650 + Math.min(sub.habit.goodCount, 5) * 50) }}>{sub.habit.goodKeyword}</p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => completeHabit(sub)}
                        className="mt-3 w-full rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-lg shadow-emerald-100 transition-all hover:bg-emerald-700"
                      >
                        완료: 좋은 습관만 남기기
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">정착된 좋은 습관</p>
                        <p className="mt-1 text-lg font-black text-emerald-700">{sub.habit?.goodKeyword || '아직 없음'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addHabit(sub)}
                        className="rounded-2xl bg-slate-900 px-6 py-3 text-xs font-black text-white transition-all hover:bg-indigo-600"
                      >
                        + 새 고칠 습관 추가
                      </button>
                    </div>
                  )}
                </div>
              )}

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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="rounded-2xl border border-indigo-100 bg-white px-5 py-3 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">폴더 필요시간 총합</p>
          <p className="mt-1 text-2xl font-black text-indigo-600">{formatTime(totalFolderDailyTime)}</p>
        </div>
        <div className="hidden">
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
          className="bg-slate-900 text-white px-5 py-3 rounded-2xl font-black text-xs hover:bg-indigo-600 transition-all shadow-lg active:scale-95"
        >
          ＋ 새 분석 그룹 추가
        </button>
      </div>

      <div className="bg-slate-200/30 p-5 md:p-8 rounded-[3rem] border-4 border-dashed border-slate-300/50">
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
  <div className={`flex flex-col min-w-0 px-2 py-2.5 md:px-3 rounded-xl transition-all ${highlight ? (isDark ? 'bg-white/10' : 'bg-white shadow-sm border border-slate-100 z-10') : 'opacity-90'}`}>
    <p className={`text-[7px] md:text-[8px] font-black uppercase mb-1 tracking-tight truncate ${isDark ? 'text-indigo-400' : 'text-slate-400'}`}>{label}</p>
    <p className={`text-base md:text-lg font-black truncate leading-none ${isDark && !highlight ? 'text-white' : color}`}>
      {value}<span className="text-[8px] font-bold ml-0.5 opacity-40">{unit}</span>
    </p>
  </div>
);
