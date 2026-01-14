
import React, { useMemo, useState, useEffect } from 'react';
import { Subject, StudyLog, TagDefinition } from '../types';
import { calculateStats } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  tagDefinitions: TagDefinition[];
  onUpdateSubject?: (updated: Subject) => void;
  onDeleteSubject?: (id: string) => void;
  onUpdateTags?: (tags: TagDefinition[]) => void;
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
  onUpdateTags
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  
  // 수정용 상태
  const [editPages, setEditPages] = useState<number>(0);
  const [editDate, setEditDate] = useState<string>('');
  const [editDailyGoal, setEditDailyGoal] = useState<number>(0);
  
  const [isTagAssignMode, setIsTagAssignMode] = useState(false);
  const [tagIdBeingRenamed, setTagIdBeingRenamed] = useState<string | null>(null);

  // 과목별 상세 통계 계산
  const subjectStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return subjects.map(sub => {
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const remaining = Math.max(0, sub.totalPages - sub.completedPages);
      const stats = calculateStats(subLogs, remaining);
      
      const target = new Date(sub.targetDate);
      target.setHours(0, 0, 0, 0);
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      const dailyTimeNeeded = diffDays > 0 ? stats.estimatedRemainingTime / diffDays : stats.estimatedRemainingTime;
      const recommendedDailyPages = diffDays > 0 ? Math.ceil(remaining / diffDays) : remaining;

      return {
        ...sub,
        stats,
        diffDays,
        dailyTimeNeeded,
        recommendedDailyPages,
        remainingPages: remaining
      };
    });
  }, [subjects, logs]);

  const filteredSubjects = useMemo(() => {
    return subjectStats.filter(sub => {
      const subTagIds = sub.tagIds || [];
      const isAnyTagHidden = tagDefinitions.some(tag => 
        subTagIds.includes(tag.id) && !tag.isVisible
      );
      return !isAnyTagHidden;
    });
  }, [subjectStats, tagDefinitions]);

  // 수정 시작 핸들러
  const startEditing = (sub: any) => {
    setEditingId(sub.id);
    setEditPages(sub.totalPages);
    setEditDate(sub.targetDate);
    setEditDailyGoal(sub.recommendedDailyPages);
    setConfirmDeleteId(null);
  };

  // 총 페이지 수정 시 로직
  const handleEditPagesChange = (val: number, sub: any) => {
    setEditPages(val);
    const remaining = Math.max(0, val - sub.completedPages);
    if (editDailyGoal > 0) {
      const daysNeeded = Math.ceil(remaining / editDailyGoal);
      const newDate = new Date();
      newDate.setDate(newDate.getDate() + daysNeeded);
      setEditDate(newDate.toISOString().split('T')[0]);
    }
  };

  // 목표 날짜 수정 시 로직 (하루 목표량 자동 계산)
  const handleEditDateChange = (dateStr: string, sub: any) => {
    setEditDate(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    
    const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const remaining = Math.max(0, editPages - sub.completedPages);
    
    if (diffDays > 0) {
      setEditDailyGoal(Math.ceil(remaining / diffDays));
    } else {
      setEditDailyGoal(remaining);
    }
  };

  // 하루 목표량 수정 시 로직 (목표 날짜 자동 계산)
  const handleEditDailyGoalChange = (val: number, sub: any) => {
    setEditDailyGoal(val);
    const remaining = Math.max(0, editPages - sub.completedPages);
    if (val > 0) {
      const daysNeeded = Math.ceil(remaining / val);
      const newDate = new Date();
      newDate.setDate(newDate.getDate() + daysNeeded);
      setEditDate(newDate.toISOString().split('T')[0]);
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

  const handleUpdateTagDef = (id: string, updates: Partial<TagDefinition>) => {
    const newTags = tagDefinitions.map(t => t.id === id ? { ...t, ...updates } : t);
    if (onUpdateTags) onUpdateTags(newTags);
  };

  const handleDeleteTagDef = (id: string) => {
    const newTags = tagDefinitions.filter(t => t.id !== id);
    if (onUpdateTags) onUpdateTags(newTags);
    subjects.forEach(sub => {
      if (sub.tagIds?.includes(id)) {
        if (onUpdateSubject) {
          onUpdateSubject({
            ...sub,
            tagIds: sub.tagIds.filter(tid => tid !== id)
          });
        }
      }
    });
  };

  const toggleSubjectTag = (sub: Subject, tagId: string) => {
    const currentTagIds = sub.tagIds || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter(id => id !== tagId)
      : [...currentTagIds, tagId];
    if (onUpdateSubject) {
      onUpdateSubject({ ...sub, tagIds: newTagIds });
    }
  };

  const formatTime = (minutes: number) => {
    if (minutes <= 0) return "0분";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };

  return (
    <div className="space-y-8">
      {/* 1. 태그 라이브러리 */}
      <section className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-6 px-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-5 bg-indigo-600 rounded-full"></span>
            <h3 className="text-base font-black text-slate-800 uppercase tracking-tight">태그 라이브러리</h3>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsTagAssignMode(!isTagAssignMode)}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all border-2 ${
                isTagAssignMode 
                  ? 'bg-indigo-600 text-white border-indigo-600' 
                  : 'bg-white text-slate-400 border-slate-100 shadow-sm'
              }`}
            >
              <span className={`text-sm font-black transition-transform ${isTagAssignMode ? 'rotate-90' : 'rotate-0'}`}>❯</span>
            </button>
            <button 
              onClick={() => {
                const newId = Math.random().toString(36).substr(2, 9);
                const newTag: TagDefinition = { id: newId, name: '', color: COLORS[tagDefinitions.length % COLORS.length], isVisible: true };
                if (onUpdateTags) onUpdateTags([...tagDefinitions, newTag]);
                setTagIdBeingRenamed(newId);
                setIsTagAssignMode(true);
              }}
              className="text-xs font-black text-indigo-600 bg-indigo-50 px-4 py-2.5 rounded-xl hover:bg-indigo-100 transition-all border border-indigo-100"
            >
              ＋ 태그 추가
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {tagDefinitions.map(tag => {
            const isEditingName = tagIdBeingRenamed === tag.id;
            return (
              <div 
                key={tag.id} 
                onClick={() => !isEditingName && handleUpdateTagDef(tag.id, { isVisible: !tag.isVisible })}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 cursor-pointer transition-all select-none ${
                  tag.isVisible ? 'bg-white shadow-sm' : 'bg-slate-100 opacity-40 border-slate-200 grayscale'
                }`}
                style={{ borderColor: tag.isVisible ? tag.color : undefined }}
              >
                {isEditingName ? (
                  <input 
                    autoFocus
                    value={tag.name}
                    onChange={e => handleUpdateTagDef(tag.id, { name: e.target.value })}
                    onBlur={() => setTagIdBeingRenamed(null)}
                    onKeyDown={e => e.key === 'Enter' && setTagIdBeingRenamed(null)}
                    onClick={e => e.stopPropagation()}
                    className="text-xs font-black outline-none bg-slate-50 px-2 py-1 rounded-md w-24 border border-indigo-200"
                  />
                ) : (
                  <span className="text-xs font-black text-slate-700">{tag.name || '이름 없음'}</span>
                )}
                <div className="flex items-center gap-1 border-l pl-2 border-slate-100">
                  <button onClick={(e) => { e.stopPropagation(); setTagIdBeingRenamed(isEditingName ? null : tag.id); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-indigo-600">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteTagDef(tag.id); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500"><span className="text-xs font-bold">✕</span></button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. 과목 카드 섹션 */}
      <section>
        <h3 className="text-lg font-bold text-slate-800 mb-6 px-1 flex items-center gap-2">
          <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
          과목별 상세 분석 및 관리
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredSubjects.map(sub => {
            const mainTag = tagDefinitions.find(t => sub.tagIds?.includes(t.id));
            const borderColor = mainTag ? mainTag.color : '#e2e8f0';

            return (
              <div 
                key={sub.id} 
                className={`bg-white rounded-[2.5rem] border-4 transition-all flex flex-col overflow-hidden hover:shadow-xl ${
                  editingId === sub.id ? 'shadow-2xl scale-[1.02]' : 'shadow-sm'
                }`}
                style={{ borderColor: borderColor }}
              >
                {/* 카드 헤더 */}
                <div className={`p-6 border-b flex flex-col gap-4 ${editingId === sub.id ? 'bg-indigo-50/50' : 'bg-slate-50/30'}`}>
                  {confirmDeleteId === sub.id ? (
                    <div className="flex items-center justify-between w-full animate-in slide-in-from-right-2">
                      <span className="text-xs font-black text-rose-600">과목 삭제 확인</span>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-500">취소</button>
                        <button onClick={() => onDeleteSubject && onDeleteSubject(sub.id)} className="px-3 py-1.5 bg-rose-600 rounded-xl text-[10px] font-bold text-white">삭제</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <h4 className="text-lg font-black text-slate-800">{sub.name}</h4>
                          <button onClick={() => startEditing(sub)} className="text-slate-300 hover:text-indigo-600 transition-colors">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${sub.diffDays > 0 ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'}`}>D-{sub.diffDays > 0 ? sub.diffDays : 'Day'}</span>
                          <button onClick={() => setConfirmDeleteId(sub.id)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-rose-500 hover:text-white transition-all text-xs font-bold">✕</button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 min-h-[26px]">
                        {isTagAssignMode ? (
                          tagDefinitions.map(tagDef => {
                            const isSelected = sub.tagIds?.includes(tagDef.id);
                            return (
                              <button key={tagDef.id} onClick={() => toggleSubjectTag(sub, tagDef.id)} className={`text-[9px] font-black px-2.5 py-1 rounded-full border transition-all ${isSelected ? 'bg-white shadow-sm border-slate-200' : 'bg-transparent border-dashed border-slate-200 text-slate-300'}`} style={{ color: isSelected ? tagDef.color : undefined }}>{tagDef.name || '무제'}</button>
                            );
                          })
                        ) : (
                          tagDefinitions.filter(t => sub.tagIds?.includes(t.id)).map(tag => (
                            <span key={tag.id} className="text-[9px] font-black px-2 py-0.5 rounded-md border border-slate-100 bg-white shadow-sm" style={{ color: tag.color }}># {tag.name || '무제'}</span>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 카드 본문 (수정/통계) */}
                <div className="p-8 space-y-6 flex-grow">
                  {editingId === sub.id ? (
                    <div className="space-y-5 animate-in fade-in duration-200">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">총 페이지</label>
                          <input type="number" value={editPages} onChange={e => handleEditPagesChange(Number(e.target.value), sub)} className="w-full p-4 bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl font-black outline-none transition-all" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 text-indigo-500">하루 목표량 (P)</label>
                          <input type="number" value={editDailyGoal} onChange={e => handleEditDailyGoalChange(Number(e.target.value), sub)} className="w-full p-4 bg-indigo-50/50 border-2 border-transparent focus:border-indigo-500 rounded-2xl font-black outline-none transition-all text-indigo-700" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">목표 완료 날짜</label>
                        <input type="date" value={editDate} onChange={e => handleEditDateChange(e.target.value, sub)} className="w-full p-4 bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl font-black outline-none transition-all" />
                      </div>
                      <p className="text-[10px] text-slate-400 text-center font-bold px-1">
                        💡 하루 목표량을 바꾸면 날짜가, 날짜를 바꾸면 목표량이 자동으로 계산됩니다.
                      </p>
                      <div className="flex gap-2 pt-2">
                        <button onClick={() => setEditingId(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-500">취소</button>
                        <button onClick={() => handleSave(sub)} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg">저장</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        <div className="space-y-0.5"><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">평균 효율</p><p className="text-lg font-black text-slate-800 leading-tight">{sub.stats.averageTimePerPage > 0 ? `${sub.stats.averageTimePerPage.toFixed(1)}m/p` : '-'}</p></div>
                        <div className="space-y-0.5"><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight text-blue-500">표준 편차</p><p className="text-lg font-black text-blue-600 leading-tight">{sub.stats.standardDeviation > 0 ? `±${sub.stats.standardDeviation.toFixed(1)}` : '-'}</p></div>
                        <div className="space-y-0.5"><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight text-amber-500">잔여 분량</p><p className="text-lg font-black text-amber-600 leading-tight">{sub.remainingPages}P</p></div>
                        <div className="space-y-0.5"><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tight text-indigo-500">일일 권장량</p><p className="text-lg font-black text-indigo-600 leading-tight">{sub.recommendedDailyPages}P/일</p></div>
                      </div>
                      <div className="p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100 mt-2">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">하루 권장 학습 시간</p>
                        <div className="flex justify-between items-end">
                           <p className="text-2xl font-black text-indigo-900">{sub.stats.averageTimePerPage > 0 ? formatTime(sub.dailyTimeNeeded) : '데이터 부족'}</p>
                           <p className="text-[10px] font-bold text-indigo-400 pb-1 italic">D-{sub.diffDays} 기준</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
