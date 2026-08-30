import React, { useMemo, useState } from 'react';
import { FollowUpSubject, Subject, StudyLog, TagDefinition } from '../types';
import { calculateStats, calculateSubjectReviewAverageTimePerPage } from '../utils/math';
import {
  calculateFreshWeekdayPagePlan,
  calculateWeeklyRequiredPages,
  distributePagesByWeekdayWeights,
  getDiffDays,
  getLocalDateKey,
  getPastCarryoverPages,
  getWeekdayPagePlan,
  getLogStudyDate,
  getActiveSubjectStage,
  getSubjectCompletedPageCount,
  getSubjectRemainingPageCount,
  getSubjectStartPage,
  getSubjectTotalPageCount,
  normalizeWeekdayWeights,
  normalizeWeekdays,
  parseStudyDate,
  WEEKDAYS
} from '../utils/schedule';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  tagDefinitions: TagDefinition[];
  activeWeekday: number;
  activeStudyDate: string;
  onActiveWeekdayChange: (weekday: number) => void;
  onAddSubject?: (subject: Subject) => void;
  onUpdateSubject?: (updated: Subject) => void;
  onUpdateSubjects?: (updated: Subject[]) => void;
  onDeleteSubject?: (id: string) => void;
  onUpdateTags?: (tags: TagDefinition[]) => void;
  onDeleteFolder?: (folderId: string) => void;
  onOpenReview?: () => void;
}

const COLORS = [
  '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#EC4899', 
  '#8B5CF6', '#06B6D4', '#64748B'
];

const formatPageValue = (value: number) => (
  Number.isInteger(value) ? value.toString() : value.toFixed(1).replace(/\.0$/, '')
);

export const Analytics: React.FC<Props> = ({ 
  subjects, 
  logs, 
  tagDefinitions,
  activeWeekday,
  activeStudyDate,
  onActiveWeekdayChange,
  onAddSubject,
  onUpdateSubject, 
  onUpdateSubjects,
  onDeleteSubject,
  onUpdateTags,
  onDeleteFolder,
  onOpenReview
}) => {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set(['root']));
  const [expandedSubjectReviewIds, setExpandedSubjectReviewIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [speedCopySourceId, setSpeedCopySourceId] = useState<string | null>(null);
  const [speedCopyForm, setSpeedCopyForm] = useState<{
    name: string;
    startPage: number;
    totalPages: number;
    targetDate: string;
    tagIds: string[];
    isRequired: boolean;
    scheduledWeekdays: number[];
  } | null>(null);
  const [movingItemId, setMovingItemId] = useState<string | null>(null);
  const weekdayIds = WEEKDAYS.map(day => day.id);
  const [folderEditForm, setFolderEditForm] = useState<{
    id: string;
    name: string;
    scheduledWeekdays: number[];
  } | null>(null);
  
  // 수정 폼 상태 확장 (이름, 총페이지, 목표날짜)
  const [editForm, setEditForm] = useState<{
    name: string;
    startPage: number;
    totalPages: number;
    targetDate: string;
    tagIds: string[];
    isRequired: boolean;
    scheduledWeekdays: number[];
    scheduledWeekdayWeights: Record<string, number>;
    scheduledWeekdayRemainderDay?: number;
    reviewSubjectIds: string[];
    followUpSubjects: FollowUpSubject[];
  } | null>(null);
  const reviewSubjectIdSet = useMemo(() => (
    new Set(subjects.flatMap(subject => subject.reviewSubjectIds || []))
  ), [subjects]);
  const reviewSubjectOwnerMap = useMemo(() => {
    const next = new Map<string, string>();
    subjects.forEach(subject => {
      (subject.reviewSubjectIds || []).forEach(reviewSubjectId => {
        if (!next.has(reviewSubjectId)) next.set(reviewSubjectId, subject.id);
      });
    });
    return next;
  }, [subjects]);

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolderIds(next);
  };

  const toggleSubjectReviewList = (id: string) => {
    const next = new Set(expandedSubjectReviewIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedSubjectReviewIds(next);
  };

  const toggleEditReviewSubject = (subject: Subject, reviewSubjectId: string) => {
    if (!editForm) return;

    const exists = editForm.reviewSubjectIds.includes(reviewSubjectId);
    const ownerId = reviewSubjectOwnerMap.get(reviewSubjectId);
    if (!exists && ownerId && ownerId !== editingId) return;

    const nextReviewSubjectIds = exists
      ? editForm.reviewSubjectIds.filter(id => id !== reviewSubjectId)
      : [...editForm.reviewSubjectIds, reviewSubjectId];

    setEditForm({ ...editForm, reviewSubjectIds: nextReviewSubjectIds });
    onUpdateSubject?.({ ...subject, reviewSubjectIds: nextReviewSubjectIds });
  };

  const toggleEditWeekday = (dayId: number) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const nextDays = prev.scheduledWeekdays.includes(dayId)
        ? prev.scheduledWeekdays.filter(id => id !== dayId)
        : [...prev.scheduledWeekdays, dayId];
      if (nextDays.length === 0) return prev;
      const normalizedDays = normalizeWeekdays(nextDays);
      const nextWeights = {
        ...prev.scheduledWeekdayWeights,
        [dayId]: nextDays.includes(dayId) ? (prev.scheduledWeekdayWeights[dayId] || 1) : 0
      };
      return {
        ...prev,
        scheduledWeekdays: normalizedDays,
        scheduledWeekdayWeights: normalizeWeekdayWeights(nextWeights, normalizedDays),
        scheduledWeekdayRemainderDay: normalizedDays.includes(prev.scheduledWeekdayRemainderDay ?? -1)
          ? prev.scheduledWeekdayRemainderDay
          : normalizedDays[normalizedDays.length - 1]
      };
    });
  };

  const orderWeekdays = (days: number[]) => weekdayIds.filter(dayId => days.includes(dayId));

  const toggleFolderEditWeekday = (dayId: number) => {
    setFolderEditForm(prev => {
      if (!prev) return prev;
      const nextDays = prev.scheduledWeekdays.includes(dayId)
        ? prev.scheduledWeekdays.filter(id => id !== dayId)
        : [...prev.scheduledWeekdays, dayId];

      if (nextDays.length === 0) return prev;
      return {
        ...prev,
        scheduledWeekdays: orderWeekdays(nextDays)
      };
    });
  };

  const getDescendantFolderIds = (folderId: string): string[] => {
    const childIds = tagDefinitions
      .filter(tag => tag.parentId === folderId)
      .map(tag => tag.id);

    return [
      folderId,
      ...childIds.flatMap(childId => getDescendantFolderIds(childId))
    ];
  };

  const getSubjectsInFolder = (folderId: string) => {
    const folderIds = new Set(getDescendantFolderIds(folderId));
    return subjects.filter(subject => (
      !reviewSubjectIdSet.has(subject.id)
      && subject.tagIds?.some(tagId => folderIds.has(tagId))
    ));
  };

  const getFolderWeekdaySelection = (folderId: string) => {
    const folderSubjects = getSubjectsInFolder(folderId);
    if (folderSubjects.length === 0) return weekdayIds;

    const union = Array.from(new Set(
      folderSubjects.flatMap(subject => normalizeWeekdays(subject.scheduledWeekdays))
    ));
    return orderWeekdays(union);
  };

  const applyFolderWeekdays = (folderId: string, days: number[]) => {
    if ((!onUpdateSubject && !onUpdateSubjects) || days.length === 0) return;

    const scheduledWeekdays = orderWeekdays(days);
    const scheduledWeekdayWeights = normalizeWeekdayWeights(undefined, scheduledWeekdays);
    const scheduledWeekdayRemainderDay = scheduledWeekdays[scheduledWeekdays.length - 1];

    const updatedSubjects = getSubjectsInFolder(folderId).map(subject => {
      const nextSubject = {
        ...subject,
        scheduledWeekdays,
        scheduledWeekdayWeights,
        scheduledWeekdayRemainderDay,
        scheduledWeekdayPages: undefined
      };

      return {
        ...nextSubject,
        scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
          nextSubject,
          getSubjectRemainingPageCount(nextSubject),
          getDiffDays(nextSubject.targetDate)
        )
      };
    });

    if (onUpdateSubjects) {
      onUpdateSubjects(updatedSubjects);
      return;
    }

    updatedSubjects.forEach(subject => onUpdateSubject?.(subject));
  };

  const startEditingFolder = (folder: TagDefinition) => {
    setMovingItemId(null);
    setEditForm(null);
    setEditingId(folder.id);
    setFolderEditForm({
      id: folder.id,
      name: folder.name,
      scheduledWeekdays: getFolderWeekdaySelection(folder.id)
    });
  };

  const saveFolderEdit = (folder: TagDefinition) => {
    const nextForm = folderEditForm?.id === folder.id
      ? folderEditForm
      : {
        id: folder.id,
        name: folder.name,
        scheduledWeekdays: getFolderWeekdaySelection(folder.id)
      };
    const nextName = nextForm.name.trim() || folder.name;

    onUpdateTags?.(tagDefinitions.map(tag => (
      tag.id === folder.id ? { ...tag, name: nextName } : tag
    )));
    setEditingId(null);
    setFolderEditForm(null);
  };

  const allSubjectStats = useMemo(() => {
    const todayDateKey = getLocalDateKey();
    const weekStartDate = parseStudyDate(todayDateKey);
    weekStartDate.setDate(weekStartDate.getDate() - 6);
    const weekStartDateKey = getLocalDateKey(weekStartDate);
    const recentDayKeys = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + index);
      return getLocalDateKey(date);
    });

    return subjects.map(sub => {
      const subLogs = logs.filter(l => l.subjectId === sub.id);
      const weeklyLogs = subLogs.filter(log => {
        const studyDate = getLogStudyDate(log);
        return studyDate >= weekStartDateKey && studyDate <= todayDateKey;
      });
      const remaining = getSubjectRemainingPageCount(sub);
      const diffDays = getDiffDays(sub.targetDate);
      const activeDayCompletedPages = subLogs
        .filter(log => getLogStudyDate(log) === activeStudyDate)
        .reduce((sum, log) => sum + log.pagesRead, 0);
      const planningRemaining = remaining + activeDayCompletedPages;
      const scheduledWeekdays = normalizeWeekdays(sub.scheduledWeekdays);
      const weeklyRequiredPages = calculateWeeklyRequiredPages(planningRemaining, diffDays);
      const weekdayPagePlan = getWeekdayPagePlan(sub, planningRemaining, diffDays);
      const rawCarryoverPages = getPastCarryoverPages(sub, logs, activeStudyDate, todayDateKey);
      const carryoverPaidPages = Math.min(rawCarryoverPages, activeDayCompletedPages);
      const carryoverPages = Math.min(remaining, Math.max(0, rawCarryoverPages - carryoverPaidPages));
      const activeDayPagesAfterCarryover = Math.max(0, activeDayCompletedPages - carryoverPaidPages);
      const recommendedDailyPages = Math.min(
        remaining,
        Math.max(0, (weekdayPagePlan[activeWeekday] || 0) - activeDayPagesAfterCarryover)
        + carryoverPages
      );
      const stats = calculateStats(
        subLogs,
        remaining,
        recommendedDailyPages,
        sub.initialAverageTimePerPage
      );
      const weeklyPages = weeklyLogs.reduce((sum, log) => sum + log.pagesRead, 0);
      const weeklyMinutes = weeklyLogs.reduce((sum, log) => sum + log.timeSpentMinutes, 0);
      const efficiencyTrend = recentDayKeys.map(date => {
        const dayLogs = weeklyLogs.filter(log => (
          getLogStudyDate(log) === date && log.pagesRead > 0 && log.timeSpentMinutes > 0
        ));
        const pages = dayLogs.reduce((sum, log) => sum + log.pagesRead, 0);
        const minutes = dayLogs.reduce((sum, log) => sum + log.timeSpentMinutes, 0);
        return {
          date,
          label: date.slice(5).replace('-', '/'),
          value: pages > 0 ? minutes / pages : null
        };
      });

      return {
        ...sub,
        stats,
        diffDays,
        remainingPages: remaining,
        weeklyRequiredPages,
        weekdayPagePlan,
        carryoverPages,
        recommendedDailyPages,
        dailyTimeNeeded: recommendedDailyPages * stats.averageTimePerPage,
        totalTimeSpent: stats.totalTimeSpent,
        weeklyPages,
        weeklyMinutes,
        efficiencyTrend,
        scheduledWeekdays
      };
    });
  }, [subjects, logs, activeWeekday, activeStudyDate]);

  const openSpeedCopyForm = (source: Subject) => {
    setEditingId(null);
    setEditForm(null);
    setFolderEditForm(null);
    setSpeedCopySourceId(source.id);
    setSpeedCopyForm({
      name: '',
      startPage: 1,
      totalPages: 100,
      targetDate: '',
      tagIds: source.tagIds || [],
      isRequired: false,
      scheduledWeekdays: WEEKDAYS.map(day => day.id)
    });
  };

  const createSpeedCopySubject = (source: Subject) => {
    if (!onAddSubject || !speedCopyForm?.name.trim() || !speedCopyForm.targetDate) return;

    const startPage = Math.max(1, speedCopyForm.startPage || 1);
    const totalPages = Math.max(startPage, speedCopyForm.totalPages || startPage);
    const completedPages = Math.max(0, startPage - 1);
    const sourceStats = allSubjectStats.find(subject => subject.id === source.id)?.stats;
    const nextSubject: Subject = {
      id: Math.random().toString(36).substr(2, 9),
      name: speedCopyForm.name.trim(),
      createdAt: new Date().toISOString(),
      planResetDate: getLocalDateKey(),
      startPage,
      totalPages,
      completedPages,
      targetDate: speedCopyForm.targetDate,
      initialAverageTimePerPage: Math.max(0, sourceStats?.averageTimePerPage || 0),
      tagIds: speedCopyForm.tagIds,
      reviewEnabled: true,
      reviewSubjectIds: [],
      isRequired: speedCopyForm.isRequired,
      scheduledWeekdays: WEEKDAYS.map(day => day.id)
    };

    onAddSubject({
      ...nextSubject,
      scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
        nextSubject,
        getSubjectRemainingPageCount(nextSubject),
        getDiffDays(nextSubject.targetDate)
      )
    });
    setSpeedCopySourceId(null);
    setSpeedCopyForm(null);
  };

  const visibleSubjectStats = useMemo(
    () => allSubjectStats.filter(subject => !reviewSubjectIdSet.has(subject.id)),
    [allSubjectStats, reviewSubjectIdSet]
  );

  const subjectMatchesWeekdayView = (_subject?: unknown) => true;

  const getDisplayRecommendedPages = (subject: { recommendedDailyPages: number }) => subject.recommendedDailyPages;

  const getDisplayNeededMinutes = (subject: { stats: { averageTimePerPage: number }; weeklyRequiredPages: number; recommendedDailyPages: number }) => (
    getDisplayRecommendedPages(subject) * subject.stats.averageTimePerPage
  );

  const getReviewMinutesPerPage = (reviewSubjectId: string) => {
    const parentSubjectId = reviewSubjectOwnerMap.get(reviewSubjectId);
    return parentSubjectId
      ? calculateSubjectReviewAverageTimePerPage(logs, parentSubjectId, reviewSubjectId)
      : 0;
  };

  const getRecursiveData = (folderId: string) => {
    const findSubjIds = (fid: string): string[] => {
      const childFolders = tagDefinitions.filter(t => t.parentId === fid);
      let subjs = visibleSubjectStats.filter(s => s.tagIds?.includes(fid));
      childFolders.forEach(cf => {
        subjs = [...subjs, ...visibleSubjectStats.filter(s => s.tagIds?.includes(cf.id))];
        const deeper = (id: string): any[] => {
          const c = tagDefinitions.filter(t => t.parentId === id);
          let r = visibleSubjectStats.filter(s => s.tagIds?.includes(id));
          c.forEach(cc => r = [...r, ...deeper(cc.id)]);
          return r;
        };
        subjs = [...subjs, ...deeper(cf.id)];
      });
      return Array.from(new Set(subjs.map(s => s.id)));
    };

    const relatedSubjIds = findSubjIds(folderId);
    const uniqueSubjs = visibleSubjectStats.filter(s => (
      relatedSubjIds.includes(s.id)
      && subjectMatchesWeekdayView(s)
    ));
    const count = uniqueSubjs.length;

    return {
      count,
      totalPages: uniqueSubjs.reduce((acc, cur) => acc + getSubjectTotalPageCount(cur), 0),
      completedPages: uniqueSubjs.reduce((acc, cur) => acc + getSubjectCompletedPageCount(cur), 0),
      avgEff: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.stats.averageTimePerPage, 0) / count : 0,
      avgStd: count > 0 ? uniqueSubjs.reduce((acc, cur) => acc + cur.stats.standardDeviation, 0) / count : 0,
      dailyTime: uniqueSubjs.reduce((acc, cur) => acc + getDisplayNeededMinutes(cur), 0),
      dailyPages: uniqueSubjs.reduce((acc, cur) => acc + getDisplayRecommendedPages(cur), 0),
      remaining: uniqueSubjs.reduce((acc, cur) => acc + cur.remainingPages, 0),
    };
  };

  const weekdaySubjects = useMemo(() => (
    visibleSubjectStats
      .filter(subject => normalizeWeekdays(subject.scheduledWeekdays).includes(activeWeekday))
      .sort((a, b) => getDisplayNeededMinutes(b) - getDisplayNeededMinutes(a))
  ), [activeWeekday, visibleSubjectStats]);

  const weekdayTotalTime = weekdaySubjects.reduce((sum, subject) => sum + getDisplayNeededMinutes(subject), 0);

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const RenderTree = ({ parentId, depth = 0 }: { parentId?: string, depth?: number }) => {
    const folderHasWeekdaySubjects = (folderId: string): boolean => {
      if (editingId === folderId || movingItemId === folderId) return true;

      const childFolderIds = tagDefinitions
        .filter(folder => folder.parentId === folderId)
        .map(folder => folder.id);

      return visibleSubjectStats.some(subject => (
        subject.tagIds?.includes(folderId)
        && subjectMatchesWeekdayView(subject)
      )) || childFolderIds.some(folderHasWeekdaySubjects);
    };

    const folders = tagDefinitions
      .filter(f => f.parentId === parentId)
      .filter(folder => folderHasWeekdaySubjects(folder.id));
    const subjs = visibleSubjectStats.filter(s =>
      subjectMatchesWeekdayView(s)
      && (parentId ? s.tagIds?.includes(parentId) : (!s.tagIds || s.tagIds.length === 0))
    );

    return (
      <div className={`space-y-4 ${depth > 0 ? 'ml-3 md:ml-6 pl-3 border-l-2 border-slate-200' : ''}`}>
        {folders.map(folder => {
          const stats = getRecursiveData(folder.id);
          const isExpanded = expandedFolderIds.has(folder.id);
          const isMoving = movingItemId === folder.id;
          const progressPercent = stats.totalPages > 0 ? Math.round((stats.completedPages / stats.totalPages) * 100) : 0;
          const folderWeekdays = getFolderWeekdaySelection(folder.id);
          const activeFolderEdit = folderEditForm?.id === folder.id
            ? folderEditForm
            : { id: folder.id, name: folder.name, scheduledWeekdays: folderWeekdays };

          return (
            <div key={folder.id} className="relative group/folder">
              <div className={`flex flex-col gap-4 p-4 md:p-5 rounded-2xl transition-all border shadow-sm ${isExpanded ? 'bg-indigo-950 border-indigo-800 text-white' : 'bg-white border-slate-200 hover:border-indigo-400'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <button onClick={() => toggleFolder(folder.id)} className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all ${isExpanded ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <span className={`text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                    <span className="text-2xl">📂</span>
                    <div className="min-w-0">
                      {editingId === folder.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={activeFolderEdit.name}
                            onChange={(e) => setFolderEditForm(prev => (
                              prev?.id === folder.id
                                ? { ...prev, name: e.target.value }
                                : { id: folder.id, name: e.target.value, scheduledWeekdays: folderWeekdays }
                            ))}
                            className="bg-slate-800 text-white text-lg font-black outline-none px-3 py-1 rounded-lg border border-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              saveFolderEdit(folder);
                            }}
                            className={`rounded-lg px-3 py-2 text-[10px] font-black transition-all ${
                              isExpanded ? 'bg-white text-indigo-700' : 'bg-slate-900 text-white'
                            }`}
                          >
                            완료
                          </button>
                        </div>
                      ) : (
                        <h4 onClick={() => toggleFolder(folder.id)} className="truncate text-xl font-black cursor-pointer hover:underline">{folder.name}</h4>
                      )}
                      <p className={`text-[10px] font-black uppercase mt-1 tracking-widest ${isExpanded ? 'text-indigo-300' : 'text-slate-400'}`}>{stats.count}개 과목</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 relative z-30">
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMovingItemId(isMoving ? null : folder.id); }} onMouseDown={e => e.stopPropagation()} className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer ${isMoving ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-300 hover:text-indigo-600'}`}>🔄</button>
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditingFolder(folder); }} onMouseDown={e => e.stopPropagation()} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-300 hover:text-emerald-600 transition-all cursor-pointer">✎</button>
                    <button 
                        onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation();
                            if (onDeleteFolder) onDeleteFolder(folder.id);
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                    >
                        ✕
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                   <StatBox label="평균 효율" value={stats.avgEff.toFixed(1)} unit="m/p" color="text-emerald-400" isDark={isExpanded} />
                   <StatBox label="표준편차(σ)" value={stats.avgStd.toFixed(1)} unit="" color="text-blue-400" isDark={isExpanded} />
                   <StatBox label="잔여(P)" value={stats.remaining.toString()} unit="P" color="text-amber-400" isDark={isExpanded} />
                   <StatBox label="권장" value={stats.dailyPages.toString()} unit="P" color="text-slate-300" isDark={isExpanded} />
                   <StatBox label="필요 시간" value={formatTime(stats.dailyTime)} unit="" color="text-indigo-300" isDark={isExpanded} large />
                </div>

                <div className="space-y-2">
                   <div className="flex justify-between items-end">
                      <p className={`text-[10px] font-black uppercase tracking-widest ${isExpanded ? 'text-indigo-300' : 'text-slate-400'}`}>전체 진행률 ({progressPercent}%)</p>
                      <p className={`text-xs font-bold ${isExpanded ? 'text-white/40' : 'text-slate-300'}`}>{stats.completedPages} / {stats.totalPages} P</p>
                   </div>
                   <div className={`w-full h-2 rounded-full overflow-hidden ${isExpanded ? 'bg-white/10' : 'bg-slate-100'}`}>
                      <div className="h-full bg-indigo-500 transition-all duration-1000 shadow-xl" style={{ width: `${progressPercent}%` }}></div>
                   </div>
                </div>

                {isMoving && (
                  <div className="mt-2 bg-white/5 p-3 rounded-2xl border border-white/10 animate-fade-in relative z-30">
                    <p className="text-[10px] font-black text-indigo-400 uppercase mb-2 px-1">📂 이동할 폴더</p>
                    <div className="flex flex-wrap gap-2">
                       <button onClick={(e) => { e.stopPropagation(); onUpdateTags?.(tagDefinitions.map(t => t.id === folder.id ? {...t, parentId: undefined} : t)); setMovingItemId(null); }} className="px-4 py-2 bg-white text-slate-900 rounded-xl font-black text-xs shadow-sm hover:bg-indigo-600 hover:text-white transition-all">최상위</button>
                       {tagDefinitions.filter(t => t.id !== folder.id).map(t => (
                         <button key={t.id} onClick={(e) => { e.stopPropagation(); onUpdateTags?.(tagDefinitions.map(tg => tg.id === folder.id ? {...tg, parentId: t.id} : tg)); setMovingItemId(null); }} className="px-4 py-2 bg-white text-slate-900 rounded-xl font-black text-xs shadow-sm hover:bg-indigo-600 hover:text-white transition-all">📂 {t.name}</button>
                       ))}
                    </div>
                  </div>
                )}
              </div>
              {isExpanded && RenderTree({ parentId: folder.id, depth: depth + 1 })}
            </div>
          );
        })}

        {subjs.map(sub => {
          const isEditing = editingId === sub.id;
          const isSpeedCopying = speedCopySourceId === sub.id;
          const combinedTotalPages = getSubjectTotalPageCount(sub);
          const combinedCompletedPages = getSubjectCompletedPageCount(sub);
          const activeStage = getActiveSubjectStage(sub);
          const activeStagePageCount = activeStage
            ? Math.max(0, activeStage.endPage - activeStage.startPage + 1)
            : combinedTotalPages;
          const activeStageCompletedPages = activeStage
            ? Math.min(
                activeStagePageCount,
                Math.max(0, activeStage.completedPage - activeStage.startPage + 1)
              )
            : combinedCompletedPages;
          const progressPercent = activeStagePageCount > 0
            ? Math.round((activeStageCompletedPages / activeStagePageCount) * 100)
            : 0;
          const reviewSubjects = (sub.reviewSubjectIds || [])
            .map(id => allSubjectStats.find(subject => subject.id === id))
            .filter((subject): subject is typeof allSubjectStats[number] => Boolean(subject));
          const isReviewListExpanded = expandedSubjectReviewIds.has(sub.id);
          return (
            <div key={sub.id} className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 transition-all group/subj relative overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3 flex-grow">
                  {reviewSubjects.length > 0 && !isEditing && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSubjectReviewList(sub.id);
                      }}
                      className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-all ${
                        isReviewListExpanded
                          ? 'bg-rose-500 text-white'
                          : 'bg-rose-50 text-rose-400 hover:bg-rose-100'
                      }`}
                    >
                      <span className={`text-sm transition-transform ${isReviewListExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                  )}
                  <div className="w-9 h-9 bg-slate-50 rounded-xl flex items-center justify-center group-hover/subj:bg-indigo-600 group-hover/subj:text-white transition-all flex-shrink-0">
                    <span className="text-xl">📄</span>
                  </div>
                  <div className="w-full min-w-0">
                    {isEditing ? (
                       <input 
                           value={editForm?.name || ''} 
                           onChange={e => setEditForm(prev => prev ? {...prev, name: e.target.value} : null)}
                           className="text-lg md:text-xl font-black text-slate-900 bg-slate-50 border-b-2 border-indigo-500 outline-none w-full py-1"
                           autoFocus
                           placeholder="과목명"
                       />
                    ) : (
                       <h4 className="truncate text-lg md:text-xl font-black text-slate-900">{sub.name}</h4>
                    )}
                    {isEditing ? (
                       <>
                       <div className="mt-2 flex flex-wrap items-center gap-2">
                           <span className="text-xs font-bold text-indigo-400">목표일:</span>
                           <input
                               type="date"
                               value={editForm?.targetDate || ''}
                               onChange={e => setEditForm(prev => prev ? {...prev, targetDate: e.target.value} : null)}
                               className="bg-slate-100 border-b-2 border-indigo-300 text-slate-800 font-bold text-sm py-1 px-2 outline-none rounded-lg"
                           />
                           <div className="flex rounded-xl bg-slate-100 p-1">
                             <button
                               type="button"
                               onClick={e => {
                                 e.preventDefault();
                                 e.stopPropagation();
                                 setEditForm(prev => prev ? { ...prev, isRequired: true } : null);
                               }}
                               className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition-all ${
                                 editForm?.isRequired ? 'bg-rose-600 text-white' : 'text-slate-400'
                               }`}
                             >
                               필수
                             </button>
                             <button
                               type="button"
                               onClick={e => {
                                 e.preventDefault();
                                 e.stopPropagation();
                                 setEditForm(prev => prev ? { ...prev, isRequired: false } : null);
                               }}
                               className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition-all ${
                                 !editForm?.isRequired ? 'bg-indigo-600 text-white' : 'text-slate-400'
                               }`}
                             >
                               미필수
                             </button>
                           </div>
                       </div>
                       </>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {sub.isRequired && (
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-rose-100 text-rose-600">필수</span>
                          )}
                          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${sub.diffDays > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>D-{sub.diffDays > 0 ? sub.diffDays : '0'}</span>
                          {sub.carryoverPages > 0 && (
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-600">이월 {sub.carryoverPages}P</span>
                          )}
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">실시간 학습 데이터</span>
                        </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 relative z-30 flex-shrink-0">
                  {isEditing ? (
                     <button 
                        onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation(); 
                            if (onUpdateSubject && editForm) {
                                const normalizedStartPage = Math.max(1, Number(editForm.startPage) || 1);
                                const normalizedTotalPages = Math.max(normalizedStartPage, Number(editForm.totalPages) || normalizedStartPage);
                                const updatedSubject: Subject = {
                                    ...sub,
                                    name: editForm.name, 
                                    startPage: normalizedStartPage,
                                    totalPages: normalizedTotalPages,
                                    completedPages: Math.min(
                                      normalizedTotalPages,
                                      Math.max(normalizedStartPage - 1, sub.completedPages)
                                    ),
                                    targetDate: editForm.targetDate,
                                    tagIds: editForm.tagIds,
                                    reviewSubjectIds: editForm.reviewSubjectIds.filter(reviewSubjectId => (
                                      reviewSubjectId !== sub.id && subjects.some(subject => subject.id === reviewSubjectId)
                                    )),
                                    isRequired: editForm.isRequired,
                                    scheduledWeekdays: normalizeWeekdays(editForm.scheduledWeekdays),
                                    scheduledWeekdayWeights: normalizeWeekdayWeights(editForm.scheduledWeekdayWeights, editForm.scheduledWeekdays),
                                    scheduledWeekdayRemainderDay: editForm.scheduledWeekdayRemainderDay,
                                    scheduledWeekdayPages: undefined,
                                    followUpSubjects: editForm.followUpSubjects.map(followUp => {
                                      const startPage = Math.max(1, Math.round(followUp.startPage));
                                      const endPage = Math.max(startPage, Math.round(followUp.endPage));
                                      return {
                                        ...followUp,
                                        name: followUp.name.trim() || '후행과목',
                                        startPage,
                                        endPage,
                                        completedPage: Math.min(endPage, Math.max(startPage - 1, followUp.completedPage))
                                      };
                                    })
                                };
                                onUpdateSubject({
                                    ...updatedSubject,
                                    scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
                                        updatedSubject,
                                        getSubjectRemainingPageCount(updatedSubject),
                                        getDiffDays(updatedSubject.targetDate)
                                    )
                                });
                            }
                            setEditingId(null);
                            setEditForm(null);
                        }} 
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-all cursor-pointer active:scale-95"
                     >
                        ✓
                     </button>
                  ) : (
                    <>
                      <button
                          type="button"
                          title="같은 속도로 새 과목 추가"
                          aria-label={`${sub.name} 같은 속도로 새 과목 추가`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isSpeedCopying) {
                              setSpeedCopySourceId(null);
                              setSpeedCopyForm(null);
                            } else {
                              openSpeedCopyForm(sub);
                            }
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all cursor-pointer ${
                            isSpeedCopying
                              ? 'bg-cyan-600 text-white'
                              : 'bg-slate-50 text-slate-300 hover:bg-cyan-50 hover:text-cyan-600'
                          }`}
                      >
                          ＋
                      </button>
                      <button 
                          onClick={(e) => { 
                            e.preventDefault(); 
                            e.stopPropagation(); 
                            setSpeedCopySourceId(null);
                            setSpeedCopyForm(null);
                            setEditingId(sub.id);
                            setFolderEditForm(null);
                            setEditForm({
                              name: sub.name,
                              startPage: getSubjectStartPage(sub),
                              totalPages: sub.totalPages,
                              targetDate: sub.targetDate,
                              tagIds: sub.tagIds || [],
                              isRequired: sub.isRequired ?? false,
                              scheduledWeekdays: normalizeWeekdays(sub.scheduledWeekdays),
                              scheduledWeekdayWeights: normalizeWeekdayWeights(sub.scheduledWeekdayWeights, sub.scheduledWeekdays),
                              scheduledWeekdayRemainderDay: sub.scheduledWeekdayRemainderDay,
                              reviewSubjectIds: (sub.reviewSubjectIds || []).filter(reviewSubjectId => (
                                reviewSubjectId !== sub.id && subjects.some(subject => subject.id === reviewSubjectId)
                              )),
                              followUpSubjects: (sub.followUpSubjects || []).map(followUp => ({ ...followUp }))
                            });
                          }} 
                          onMouseDown={e => e.stopPropagation()}
                          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-300 hover:text-emerald-600 transition-all cursor-pointer"
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
                          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                      >
                          ✕
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-100 sm:grid-cols-4">
                 <StatBox label="누적 시간" value={formatTime(sub.totalTimeSpent)} unit="" color="text-slate-900" />
                 <StatBox label="하루 평균 시간" value={formatTime(getDisplayNeededMinutes(sub))} unit="" color="text-indigo-600" />
                 <StatBox label="하루 평균 페이지" value={formatPageValue(getDisplayRecommendedPages(sub))} unit="P" color="text-amber-500" />
                 <StatBox label="효율" value={sub.stats.averageTimePerPage > 0 ? sub.stats.averageTimePerPage.toFixed(1) : '-'} unit={sub.stats.averageTimePerPage > 0 ? 'm/p' : ''} color="text-emerald-500" />
              </div>

              <div className="space-y-1 px-1">
                 <div className="flex justify-between items-end">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {activeStage
                        ? `학습 진척도 · ${activeStage.name} (p.${activeStage.startPage}~${activeStage.endPage}) · ${progressPercent}%`
                        : `학습 진척도 · 전체 완료 · ${progressPercent}%`}
                    </p>
                    {isEditing ? (
                        <div className="flex flex-wrap items-center justify-end gap-2 bg-indigo-50 px-3 py-1 rounded-xl">
                            <span className="text-xs font-bold text-indigo-400">시작 P</span>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={editForm?.startPage || 1}
                                onChange={e => setEditForm(prev => prev ? {...prev, startPage: Number(e.target.value)} : null)}
                                className="w-16 text-right text-lg font-black text-indigo-900 bg-transparent border-b-2 border-indigo-300 outline-none"
                            />
                            <span className="text-xs font-bold text-indigo-400">끝 P</span>
                            <input 
                                type="number"
                                min={editForm?.startPage || 1}
                                step="1"
                                value={editForm?.totalPages || 0}
                                onChange={e => setEditForm(prev => prev ? {...prev, totalPages: Number(e.target.value)} : null)}
                                className="w-20 text-right text-lg font-black text-indigo-900 bg-transparent border-b-2 border-indigo-300 outline-none"
                            />
                        </div>
                    ) : (
                        <p className="text-base font-black text-slate-900">{activeStageCompletedPages} / {activeStagePageCount} <span className="text-xs text-slate-400 font-bold ml-1">P</span></p>
                    )}
                 </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
                 </div>
              </div>

              {isEditing && (
                <div className="mt-2 bg-slate-900 p-4 rounded-2xl border border-slate-800 animate-in slide-in-from-top-4 relative z-30">
                  <p className="text-[10px] font-black text-slate-500 uppercase mb-3 px-1">폴더 이동</p>
                  <div className="flex flex-wrap gap-2">
                     <button
                       type="button"
                       onClick={(e) => {
                         e.preventDefault();
                         e.stopPropagation();
                         setEditForm(prev => prev ? { ...prev, tagIds: [] } : prev);
                       }}
                       className={`px-4 py-2 rounded-xl font-black text-xs transition-all border ${(!editForm?.tagIds || editForm.tagIds.length === 0) ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 hover:bg-indigo-600 text-white border-slate-700'}`}
                     >
                       홈
                     </button>
                     {tagDefinitions.map(t => (
                       <button
                         key={t.id}
                         type="button"
                         onClick={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           setEditForm(prev => prev ? { ...prev, tagIds: [t.id] } : prev);
                         }}
                         className={`px-4 py-2 rounded-xl font-black text-xs transition-all border ${editForm?.tagIds?.[0] === t.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 hover:bg-indigo-600 text-white border-slate-700'}`}
                       >
                         📂 {t.name}
                       </button>
                     ))}
                  </div>
                  <div className="mt-4 border-t border-slate-800 pt-4">
                    <p className="mb-3 px-1 text-[10px] font-black uppercase text-slate-500">학습 요일</p>
                    <div className="grid grid-cols-7 gap-1.5">
                      {WEEKDAYS.map(day => {
                        const selected = editForm?.scheduledWeekdays.includes(day.id) ?? false;
                        return (
                          <button
                            key={day.id}
                            type="button"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleEditWeekday(day.id);
                            }}
                            className={`rounded-lg py-2 text-xs font-black transition-all ${
                              selected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 space-y-2 rounded-2xl bg-slate-950 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-indigo-500/15 px-2.5 py-1 text-[10px] font-black text-indigo-300">
                          주간 필요 {sub.weeklyRequiredPages}P
                        </span>
                        <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[10px] font-black text-emerald-300">
                          비율 {editForm ? editForm.scheduledWeekdays.map(dayId => editForm.scheduledWeekdayWeights[dayId] || 1).join(':') : '-'}
                        </span>
                      </div>
                      <div className="grid grid-cols-7 gap-1.5">
                        {WEEKDAYS.map(day => {
                          const selected = editForm?.scheduledWeekdays.includes(day.id) ?? false;
                          const previewPlan = editForm
                            ? distributePagesByWeekdayWeights(
                              sub.weeklyRequiredPages,
                              editForm.scheduledWeekdays,
                              editForm.scheduledWeekdayWeights,
                              editForm.scheduledWeekdayRemainderDay
                            )
                            : {};
                        return (
                          <div
                            key={day.id}
                            className={`rounded-xl border p-1.5 ${
                              selected
                                ? 'border-indigo-500/40 bg-slate-900'
                                : 'border-slate-800 bg-slate-900/40 opacity-45'
                            }`}
                          >
                            <p className={`mb-1 text-center text-[10px] font-black ${selected ? 'text-indigo-300' : 'text-slate-600'}`}>
                              {day.label}
                            </p>
                            <p className={`mb-1 text-center text-sm font-black ${selected ? 'text-white' : 'text-slate-600'}`}>
                              {previewPlan[day.id] || 0}P
                            </p>
                            <input
                              type="number"
                              step="1"
                              min="1"
                              disabled={!selected}
                              value={editForm?.scheduledWeekdayWeights[day.id] ?? 1}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setEditForm(prev => prev ? {
                                  ...prev,
                                  scheduledWeekdayWeights: normalizeWeekdayWeights({
                                    ...prev.scheduledWeekdayWeights,
                                    [day.id]: Math.max(1, Number(e.target.value) || 1)
                                  }, prev.scheduledWeekdays),
                                  scheduledWeekdayRemainderDay: day.id
                                } : prev)}
                              className="w-full rounded-lg bg-slate-800 px-1 py-1 text-center text-xs font-black text-white outline-none disabled:text-slate-600"
                            />
                            <p className="mt-1 text-center text-[9px] font-black text-slate-500">비율</p>
                          </div>
                        );
                      })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 border-t border-slate-800 pt-4">
                    <div className="mb-3 flex items-center justify-between gap-3 px-1">
                      <p className="text-[10px] font-black uppercase text-slate-500">후행과목</p>
                      <button
                        type="button"
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditForm(prev => prev ? {
                            ...prev,
                            followUpSubjects: [...prev.followUpSubjects, {
                              id: Math.random().toString(36).slice(2, 11),
                              name: '',
                              startPage: 1,
                              endPage: 100,
                              completedPage: 0
                            }]
                          } : prev);
                        }}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-black text-white"
                      >
                        + 추가
                      </button>
                    </div>
                    {editForm?.followUpSubjects.length ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-[minmax(0,1fr)_68px_68px_32px] gap-2 px-2 text-center text-[9px] font-black text-slate-600">
                          <span className="text-left">과목명</span><span>시작</span><span>완료</span><span />
                        </div>
                        {editForm.followUpSubjects.map((followUp, index) => (
                          <div key={followUp.id} className="grid grid-cols-[minmax(0,1fr)_68px_68px_32px] gap-2 rounded-xl bg-slate-950 p-2">
                            <input
                              value={followUp.name}
                              onChange={e => setEditForm(prev => prev ? {
                                ...prev,
                                followUpSubjects: prev.followUpSubjects.map(item => item.id === followUp.id ? { ...item, name: e.target.value } : item)
                              } : prev)}
                              placeholder={`${index + 1}번째 후행과목`}
                              className="min-w-0 rounded-lg bg-slate-900 px-2 text-xs font-black text-white outline-none"
                            />
                            <input
                              type="number"
                              min="1"
                              value={followUp.startPage}
                              title="시작 페이지"
                              onChange={e => setEditForm(prev => prev ? {
                                ...prev,
                                followUpSubjects: prev.followUpSubjects.map(item => item.id === followUp.id ? { ...item, startPage: Number(e.target.value) } : item)
                              } : prev)}
                              className="rounded-lg bg-slate-900 px-1 text-center text-xs font-black text-indigo-300 outline-none"
                            />
                            <input
                              type="number"
                              min={followUp.startPage}
                              value={followUp.endPage}
                              title="완료 페이지"
                              onChange={e => setEditForm(prev => prev ? {
                                ...prev,
                                followUpSubjects: prev.followUpSubjects.map(item => item.id === followUp.id ? { ...item, endPage: Number(e.target.value) } : item)
                              } : prev)}
                              className="rounded-lg bg-slate-900 px-1 text-center text-xs font-black text-emerald-300 outline-none"
                            />
                            <button
                              type="button"
                              onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditForm(prev => prev ? { ...prev, followUpSubjects: prev.followUpSubjects.filter(item => item.id !== followUp.id) } : prev);
                              }}
                              className="rounded-lg bg-rose-950 text-sm font-black text-rose-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-4 border-t border-slate-800 pt-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-3 px-1">복습 과목</p>
                    <div className="max-h-40 overflow-y-auto rounded-2xl bg-slate-950 p-2">
                      <div className="flex flex-wrap gap-2">
                        {subjects
                          .filter(candidate => {
                            if (candidate.id === sub.id) return false;
                            const ownerId = reviewSubjectOwnerMap.get(candidate.id);
                            const selectedHere = editForm?.reviewSubjectIds.includes(candidate.id) ?? false;
                            return !ownerId || ownerId === sub.id || selectedHere;
                          })
                              .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
                          .map(candidate => {
                          const selectedIndex = editForm?.reviewSubjectIds.indexOf(candidate.id) ?? -1;
                          return (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleEditReviewSubject(sub, candidate.id);
                              }}
                              className={`rounded-xl border px-3 py-2 text-xs font-black transition-all ${
                                selectedIndex >= 0
                                  ? 'border-rose-400 bg-rose-500 text-white'
                                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-rose-400 hover:text-white'
                              }`}
                            >
                              {selectedIndex >= 0 ? `${selectedIndex + 1}. ` : ''}{candidate.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!isEditing && (sub.followUpSubjects || []).length > 0 && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                  <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-indigo-400">후행과목</p>
                  <div className="flex flex-wrap gap-2">
                    {(sub.followUpSubjects || []).map((followUp, index) => (
                      <span key={followUp.id} className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-black text-slate-700">
                        {index + 1}. {followUp.name} · p.{followUp.startPage}~{followUp.endPage}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {isSpeedCopying && speedCopyForm && (
                <div className="mt-2 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 relative z-30">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-900">새 과목</p>
                    <span className="rounded-xl bg-white px-3 py-1.5 text-xs font-black text-cyan-700">
                      {sub.stats.averageTimePerPage > 0 ? `${sub.stats.averageTimePerPage.toFixed(2)}분/P` : '측정 필요'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input
                      value={speedCopyForm.name}
                      onChange={e => setSpeedCopyForm(prev => prev ? { ...prev, name: e.target.value } : prev)}
                      placeholder="과목명"
                      className="rounded-xl border border-cyan-100 bg-white px-4 py-3 font-bold text-slate-900 outline-none focus:border-cyan-400"
                      autoFocus
                    />
                    <input
                      type="date"
                      value={speedCopyForm.targetDate}
                      onChange={e => setSpeedCopyForm(prev => prev ? { ...prev, targetDate: e.target.value } : prev)}
                      className="rounded-xl border border-cyan-100 bg-white px-4 py-3 font-bold text-slate-900 outline-none focus:border-cyan-400"
                    />
                    <label className="rounded-xl border border-cyan-100 bg-white px-4 py-2">
                      <span className="block text-[9px] font-black text-slate-400">시작 페이지</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={speedCopyForm.startPage}
                        onChange={e => setSpeedCopyForm(prev => prev ? { ...prev, startPage: Number(e.target.value) } : prev)}
                        className="mt-1 w-full bg-transparent text-lg font-black text-slate-900 outline-none"
                      />
                    </label>
                    <label className="rounded-xl border border-cyan-100 bg-white px-4 py-2">
                      <span className="block text-[9px] font-black text-slate-400">끝 페이지</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={speedCopyForm.totalPages}
                        onChange={e => setSpeedCopyForm(prev => prev ? { ...prev, totalPages: Number(e.target.value) } : prev)}
                        className="mt-1 w-full bg-transparent text-lg font-black text-slate-900 outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSpeedCopyForm(prev => prev ? { ...prev, isRequired: true } : prev)}
                      className={`rounded-xl py-2.5 text-xs font-black ${speedCopyForm.isRequired ? 'bg-rose-600 text-white' : 'bg-white text-slate-400'}`}
                    >
                      필수
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeedCopyForm(prev => prev ? { ...prev, isRequired: false } : prev)}
                      className={`rounded-xl py-2.5 text-xs font-black ${!speedCopyForm.isRequired ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400'}`}
                    >
                      미필수
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-slate-900 p-2">
                    <button
                      type="button"
                      onClick={() => setSpeedCopyForm(prev => prev ? { ...prev, tagIds: [] } : prev)}
                      className={`rounded-lg px-3 py-2 text-xs font-black ${speedCopyForm.tagIds.length === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                    >
                      홈
                    </button>
                    {tagDefinitions.map(folder => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setSpeedCopyForm(prev => prev ? { ...prev, tagIds: [folder.id] } : prev)}
                        className={`rounded-lg px-3 py-2 text-xs font-black ${speedCopyForm.tagIds[0] === folder.id ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                      >
                        📂 {folder.name}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSpeedCopySourceId(null);
                        setSpeedCopyForm(null);
                      }}
                      className="rounded-xl bg-white py-3 text-sm font-black text-slate-500"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => createSpeedCopySubject(sub)}
                      className="rounded-xl bg-cyan-600 py-3 text-sm font-black text-white"
                    >
                      생성
                    </button>
                  </div>
                </div>
              )}

              {reviewSubjects.length > 0 && isReviewListExpanded && !isEditing && (
                <div className="space-y-4 md:ml-12 md:border-l-2 md:border-rose-100 md:pl-4">
                  <div className="space-y-3">
                    {reviewSubjects.map(reviewSubject => {
                      const reviewActiveStage = getActiveSubjectStage(reviewSubject);
                      const reviewStagePageCount = reviewActiveStage
                        ? Math.max(0, reviewActiveStage.endPage - reviewActiveStage.startPage + 1)
                        : getSubjectTotalPageCount(reviewSubject);
                      const reviewStageCompletedPages = reviewActiveStage
                        ? Math.min(
                            reviewStagePageCount,
                            Math.max(0, reviewActiveStage.completedPage - reviewActiveStage.startPage + 1)
                          )
                        : getSubjectCompletedPageCount(reviewSubject);
                      const reviewProgress = reviewStagePageCount > 0
                        ? Math.round((reviewStageCompletedPages / reviewStagePageCount) * 100)
                        : 0;
                      const reviewMinutesPerPage = getReviewMinutesPerPage(reviewSubject.id);
                      return (
                        <div key={reviewSubject.id} className="flex flex-col gap-3 rounded-2xl border-2 border-rose-200 bg-white p-4 shadow-sm transition-all hover:border-rose-300">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3 flex-grow">
                              <div className="w-9 h-9 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">
                                <span className="text-xl">📄</span>
                              </div>
                              <div className="w-full min-w-0">
                                <h4 className="truncate text-lg md:text-xl font-black text-slate-900">{reviewSubject.name}</h4>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                  <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-rose-100 text-rose-600">복습 과목</span>
                                  <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${reviewSubject.diffDays > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>D-{reviewSubject.diffDays > 0 ? reviewSubject.diffDays : '0'}</span>
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">실시간 학습 데이터</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-100 sm:grid-cols-4">
                            <StatBox label="누적 시간" value={formatTime(reviewSubject.totalTimeSpent)} unit="" color="text-slate-900" />
                            <StatBox label="하루 평균 시간" value={formatTime(getDisplayNeededMinutes(reviewSubject))} unit="" color="text-indigo-600" />
                            <StatBox label="하루 평균 페이지" value={formatPageValue(getDisplayRecommendedPages(reviewSubject))} unit="P" color="text-amber-500" />
                            <StatBox
                              label="효율"
                              value={(reviewMinutesPerPage || reviewSubject.stats.averageTimePerPage) > 0 ? (reviewMinutesPerPage || reviewSubject.stats.averageTimePerPage).toFixed(1) : '-'}
                              unit={(reviewMinutesPerPage || reviewSubject.stats.averageTimePerPage) > 0 ? 'm/p' : ''}
                              color="text-rose-500"
                            />
                          </div>

                          <div className="space-y-1 px-1">
                            <div className="flex items-end justify-between">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                {reviewActiveStage
                                  ? `학습 진척도 · ${reviewActiveStage.name} (p.${reviewActiveStage.startPage}~${reviewActiveStage.endPage}) · ${reviewProgress}%`
                                  : `학습 진척도 · 전체 완료 · ${reviewProgress}%`}
                              </p>
                              <p className="text-base font-black text-slate-900">{reviewStageCompletedPages} / {reviewStagePageCount} <span className="text-xs text-slate-400 font-bold ml-1">P</span></p>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-rose-500 transition-all duration-1000" style={{ width: `${reviewProgress}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="rounded-xl border border-indigo-100 bg-white px-4 py-2 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">하루 평균 필요시간</p>
          <p className="mt-0.5 text-3xl font-black leading-none text-indigo-600">{formatTime(weekdayTotalTime)}</p>
        </div>
        <button 
          onClick={() => {
            const newId = Math.random().toString(36).substr(2, 9);
            const newFolder = { id: newId, name: '새 폴더', color: COLORS[tagDefinitions.length % COLORS.length], isVisible: true };
            onUpdateTags?.([...tagDefinitions, newFolder]);
            setEditingId(newId);
            setFolderEditForm({
              id: newId,
              name: newFolder.name,
              scheduledWeekdays: weekdayIds
            });
          }}
          className="bg-slate-900 text-white px-4 py-2 rounded-xl font-black text-xs hover:bg-indigo-600 transition-all shadow-sm active:scale-95"
        >
          ＋ 새 분석 그룹 추가
        </button>
      </div>

      <div className="bg-slate-100/70 p-3 md:p-4 rounded-2xl border border-slate-200">
        {RenderTree({})}
        
        {subjects.length === 0 && tagDefinitions.length === 0 && (
          <div className="py-32 text-center opacity-10 grayscale">
            <p className="text-6xl mb-4">🔍</p>
            <p className="text-xl font-black uppercase tracking-widest">데이터 없음</p>
          </div>
        )}
      </div>
    </div>
  );
};

const StatBox = ({ label, value, unit, color, isDark, highlight, large }: { label: string, value: string, unit: string, color: string, isDark?: boolean, highlight?: boolean, large?: boolean }) => (
  <div className={`flex flex-col min-w-0 px-2.5 py-2.5 rounded-lg transition-all ${highlight ? (isDark ? 'bg-white/10' : 'bg-white shadow-sm border border-slate-100 z-10') : 'opacity-90'}`}>
    <p className={`text-[8px] md:text-[9px] font-black uppercase mb-1 tracking-tight truncate ${isDark ? 'text-indigo-400' : 'text-slate-400'}`}>{label}</p>
    <p className={`${large ? 'text-2xl md:text-3xl' : 'text-xl md:text-2xl'} font-black truncate leading-none ${isDark && !highlight ? 'text-white' : color}`}>
      {value}<span className="text-[10px] md:text-xs font-bold ml-1 opacity-40">{unit}</span>
    </p>
  </div>
);
