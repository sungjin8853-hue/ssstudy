import React, { useMemo, useState } from 'react';
import { Subject, StudyLog, TagDefinition } from '../types';
import { calculateStats } from '../utils/math';
import {
  calculateWeeklyRequiredPages,
  distributePagesByWeekdayWeights,
  getDiffDays,
  getWeekdayPagePlan,
  getLogStudyDate,
  normalizeWeekdayWeights,
  normalizeWeekdays,
  WEEKDAYS
} from '../utils/schedule';
import { buildSequenceDisplaySubjects, getSequenceRootSubject, getSubjectSequence } from '../utils/subjectSequences';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  tagDefinitions: TagDefinition[];
  activeWeekday: number;
  activeStudyDate: string;
  onActiveWeekdayChange: (weekday: number) => void;
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

const UNKNOWN_AVERAGE_MINUTES_PER_PAGE = 10;
const DETACH_SUBJECT_VALUE = '__detach_subject__';

const calculateFourDaySpeedChange = (logs: StudyLog[]) => {
  const dailySamples = Array.from(
    logs
      .filter(log => log.pagesRead > 0 && log.timeSpentMinutes > 0)
      .reduce((map, log) => {
        const key = getLogStudyDate(log);
        const current = map.get(key) || { date: key, pages: 0, minutes: 0 };
        current.pages += log.pagesRead;
        current.minutes += log.timeSpentMinutes;
        map.set(key, current);
        return map;
      }, new Map<string, { date: string; pages: number; minutes: number }>())
      .values()
  ).sort((a, b) => a.date.localeCompare(b.date));

  if (dailySamples.length < 2) {
    return {
      firstTimePerPage: 0,
      recentFourDayTimePerPage: 0,
      speedChangePercent: null as number | null
    };
  }

  const firstDay = dailySamples[0];
  const recentFourDays = dailySamples.slice(-4);
  const recentPages = recentFourDays.reduce((sum, day) => sum + day.pages, 0);
  const recentMinutes = recentFourDays.reduce((sum, day) => sum + day.minutes, 0);
  const firstTimePerPage = firstDay.pages > 0 ? firstDay.minutes / firstDay.pages : 0;
  const recentFourDayTimePerPage = recentPages > 0 ? recentMinutes / recentPages : 0;
  const speedChangePercent = firstTimePerPage > 0 && recentFourDayTimePerPage > 0
    ? ((firstTimePerPage / recentFourDayTimePerPage) - 1) * 100
    : null;

  return {
    firstTimePerPage,
    recentFourDayTimePerPage,
    speedChangePercent
  };
};

export const Analytics: React.FC<Props> = ({ 
  subjects, 
  logs, 
  tagDefinitions,
  activeWeekday,
  activeStudyDate,
  onActiveWeekdayChange,
  onUpdateSubject, 
  onUpdateSubjects,
  onDeleteSubject,
  onUpdateTags,
  onDeleteFolder,
  onOpenReview
}) => {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set(['root']));
  const [selectedSequenceStageIds, setSelectedSequenceStageIds] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movingItemId, setMovingItemId] = useState<string | null>(null);
  const [showAllWeekdays, setShowAllWeekdays] = useState(false);
  const weekdayIds = WEEKDAYS.map(day => day.id);
  const [folderEditForm, setFolderEditForm] = useState<{
    id: string;
    name: string;
    scheduledWeekdays: number[];
  } | null>(null);
  
  // 수정 폼 상태 확장 (이름, 총페이지, 목표날짜)
  const [editForm, setEditForm] = useState<{
    name: string;
    totalPages: number;
    targetDate: string;
    tagIds: string[];
    isRequired: boolean;
    sequenceOrderIds: string[];
    mergeTargetId: string;
    scheduledWeekdays: number[];
    scheduledWeekdayWeights: Record<string, number>;
    scheduledWeekdayRemainderDay?: number;
  } | null>(null);

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolderIds(next);
  };

  const removeEditSequenceSubject = (subjectId: string) => {
    setEditForm(prev => {
      if (!prev || prev.sequenceOrderIds.length <= 1) return prev;
      return {
        ...prev,
        sequenceOrderIds: prev.sequenceOrderIds.filter(id => id !== subjectId)
      };
    });
  };

  const moveEditSequenceSubject = (subjectId: string, direction: -1 | 1) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const currentIndex = prev.sequenceOrderIds.indexOf(subjectId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= prev.sequenceOrderIds.length) return prev;

      const nextOrder = [...prev.sequenceOrderIds];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      return {
        ...prev,
        sequenceOrderIds: nextOrder
      };
    });
  };

  const toggleEditWeekday = (dayId: number) => {
    setEditForm(prev => {
      if (!prev) return prev;
      const nextDays = prev.scheduledWeekdays.includes(dayId)
        ? prev.scheduledWeekdays.filter(id => id !== dayId)
        : [...prev.scheduledWeekdays, dayId];
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
    return subjects.filter(subject => subject.tagIds?.some(tagId => folderIds.has(tagId)));
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

    const updatedSubjects = getSubjectsInFolder(folderId).map(subject => ({
        ...subject,
        scheduledWeekdays,
        scheduledWeekdayWeights,
        scheduledWeekdayRemainderDay,
        scheduledWeekdayPages: undefined
      }));

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
    applyFolderWeekdays(folder.id, nextForm.scheduledWeekdays);
    setEditingId(null);
    setFolderEditForm(null);
  };

  const saveSubjectEdit = (subject: Subject) => {
    if (!editForm) return;

    const currentOrderIds = editForm.sequenceOrderIds
      .filter(id => subjects.some(item => item.id === id))
      .filter((id, index, ids) => ids.indexOf(id) === index);
    const detachSubjectId = editForm.mergeTargetId === DETACH_SUBJECT_VALUE
      ? selectedSequenceStageIds[subject.id]
      : undefined;
    const isDetachingSubject = Boolean(detachSubjectId && currentOrderIds.length > 1);
    const mergeTargetSubject = editForm.mergeTargetId
      && editForm.mergeTargetId !== DETACH_SUBJECT_VALUE
      ? subjects.find(item => item.id === editForm.mergeTargetId)
      : undefined;
    const mergeTargetRoot = mergeTargetSubject
      ? getSequenceRootSubject(mergeTargetSubject, subjects)
      : undefined;
    const targetOrderIds = mergeTargetRoot
      ? getSubjectSequence(mergeTargetRoot, subjects).map(item => item.id)
      : [];
    const isMergingIntoTarget = Boolean(mergeTargetRoot);
    const sequenceOrderIds = isDetachingSubject
      ? currentOrderIds.filter(id => id !== detachSubjectId)
      : mergeTargetRoot
      ? [
        ...targetOrderIds,
        ...currentOrderIds.filter(id => !targetOrderIds.includes(id))
      ]
      : currentOrderIds;
    const rootId = sequenceOrderIds[0] || subject.id;
    const linkedSubjectIds = sequenceOrderIds.length > 1 ? sequenceOrderIds.slice(1) : [];
    const scheduledWeekdays = normalizeWeekdays(editForm.scheduledWeekdays);
    const scheduledWeekdayWeights = normalizeWeekdayWeights(editForm.scheduledWeekdayWeights, editForm.scheduledWeekdays);
    const groupScheduledWeekdays = isMergingIntoTarget
      ? orderWeekdays(Array.from(new Set(
        sequenceOrderIds.flatMap(id => {
          const item = subjects.find(subjectItem => subjectItem.id === id);
          return id === subject.id
            ? scheduledWeekdays
            : normalizeWeekdays(item?.scheduledWeekdays);
        })
      )))
      : scheduledWeekdays;
    const groupScheduledWeekdayWeights = isMergingIntoTarget
      ? normalizeWeekdayWeights(undefined, groupScheduledWeekdays)
      : scheduledWeekdayWeights;
    const groupScheduledWeekdayRemainderDay = isMergingIntoTarget
      ? groupScheduledWeekdays[groupScheduledWeekdays.length - 1]
      : editForm.scheduledWeekdayRemainderDay;
    const updatedSubject: Subject = {
      ...subject,
      name: editForm.name,
      totalPages: Number(editForm.totalPages),
      targetDate: editForm.targetDate,
      tagIds: editForm.tagIds,
      isRequired: editForm.isRequired,
      scheduledWeekdays: groupScheduledWeekdays,
      scheduledWeekdayWeights: groupScheduledWeekdayWeights,
      scheduledWeekdayRemainderDay: groupScheduledWeekdayRemainderDay,
      scheduledWeekdayPages: undefined
    };

    if (onUpdateSubjects) {
      const previousSequenceIds = new Set(getSubjectSequence(subject, subjects).map(item => item.id));
      targetOrderIds.forEach(id => previousSequenceIds.add(id));
      const nextSequenceIdSet = new Set(sequenceOrderIds);
      onUpdateSubjects(subjects.map(item => {
        const baseItem = item.id === subject.id ? updatedSubject : item;
        const nextLinkedIds = baseItem.linkedSubjectIds?.filter(id => !nextSequenceIdSet.has(id));

        if (baseItem.id === rootId) {
          return {
            ...baseItem,
            ...(!isMergingIntoTarget ? {
              tagIds: editForm.tagIds,
              isRequired: editForm.isRequired
            } : {}),
            scheduledWeekdays: groupScheduledWeekdays,
            scheduledWeekdayWeights: groupScheduledWeekdayWeights,
            scheduledWeekdayRemainderDay: groupScheduledWeekdayRemainderDay,
            scheduledWeekdayPages: undefined,
            linkedParentId: undefined,
            linkedSubjectIds: linkedSubjectIds.length > 0 ? linkedSubjectIds : undefined
          };
        }

        if (linkedSubjectIds.includes(baseItem.id)) {
          return {
            ...baseItem,
            scheduledWeekdays: groupScheduledWeekdays,
            scheduledWeekdayWeights: groupScheduledWeekdayWeights,
            scheduledWeekdayRemainderDay: groupScheduledWeekdayRemainderDay,
            scheduledWeekdayPages: undefined,
            linkedParentId: rootId,
            linkedSubjectIds: undefined
          };
        }

        if (
          previousSequenceIds.has(baseItem.id)
          || nextSequenceIdSet.has(baseItem.linkedParentId || '')
        ) {
          return {
            ...baseItem,
            linkedParentId: undefined,
            linkedSubjectIds: nextLinkedIds && nextLinkedIds.length > 0 ? nextLinkedIds : undefined
          };
        }

        if (nextLinkedIds && nextLinkedIds.length !== (baseItem.linkedSubjectIds?.length || 0)) {
          return {
            ...baseItem,
            linkedSubjectIds: nextLinkedIds.length > 0 ? nextLinkedIds : undefined
          };
        }

        return baseItem;
      }));
    } else {
      onUpdateSubject?.({
        ...updatedSubject,
        linkedParentId: rootId === subject.id ? undefined : rootId,
        linkedSubjectIds: rootId === subject.id && linkedSubjectIds.length > 0 ? linkedSubjectIds : undefined
      });
    }

    setEditingId(null);
    setEditForm(null);
    setSelectedSequenceStageIds(prev => ({
      ...prev,
      [rootId]: isDetachingSubject ? rootId : subject.id
    }));
  };

  const allSubjectStats = useMemo(() => {
    return buildSequenceDisplaySubjects(subjects).map(sub => {
      const sequenceIds = sub.sequenceSubjectIds || [sub.id];
      const subLogs = logs.filter(l => sequenceIds.includes(l.subjectId));
      const hasTimedLogs = subLogs.some(log => log.pagesRead > 0 && log.timeSpentMinutes > 0);
      const remaining = Math.max(0, sub.totalPages - sub.completedPages);
      const diffDays = getDiffDays(sub.targetDate);
      const activeDayCompletedPages = subLogs
        .filter(log => getLogStudyDate(log) === activeStudyDate)
        .reduce((sum, log) => sum + log.pagesRead, 0);
      const planningRemaining = remaining + activeDayCompletedPages;
      const scheduledWeekdays = normalizeWeekdays(sub.scheduledWeekdays);
      const weeklyRequiredPages = calculateWeeklyRequiredPages(planningRemaining, diffDays);
      const weekdayPagePlan = getWeekdayPagePlan(sub, planningRemaining, diffDays);
      const recommendedDailyPages = Math.min(
        remaining,
        Math.max(0, (weekdayPagePlan[activeWeekday] || 0) - activeDayCompletedPages)
      );
      const stats = calculateStats(subLogs, remaining, recommendedDailyPages);
      const speedChange = calculateFourDaySpeedChange(subLogs);

      return {
        ...sub,
        stats,
        speedChange,
        diffDays,
        remainingPages: remaining,
        weeklyRequiredPages,
        weekdayPagePlan,
        recommendedDailyPages,
        dailyTimeNeeded: recommendedDailyPages * (stats.averageTimePerPage > 0 ? stats.averageTimePerPage : UNKNOWN_AVERAGE_MINUTES_PER_PAGE),
        totalTimeSpent: stats.totalTimeSpent,
        scheduledWeekdays,
        hasTimedLogs
      };
    });
  }, [subjects, logs, activeWeekday, activeStudyDate]);

  const subjectMatchesWeekdayView = (subject: { scheduledWeekdays?: number[] }) => (
    showAllWeekdays || normalizeWeekdays(subject.scheduledWeekdays).includes(activeWeekday)
  );

  const getDisplayRecommendedPages = (subject: { weeklyRequiredPages: number; recommendedDailyPages: number }) => (
    showAllWeekdays ? subject.weeklyRequiredPages : subject.recommendedDailyPages
  );

  const getEffectiveTimePerPage = (averageTimePerPage: number) => (
    averageTimePerPage > 0 ? averageTimePerPage : UNKNOWN_AVERAGE_MINUTES_PER_PAGE
  );

  const formatEfficiency = (averageTimePerPage: number) => (
    averageTimePerPage > 0 ? averageTimePerPage.toFixed(1) : '측정 필요'
  );

  const formatDeviation = (standardDeviation: number, averageTimePerPage: number) => (
    averageTimePerPage > 0 ? standardDeviation.toFixed(1) : '측정 필요'
  );

  const getDisplayNeededMinutes = (subject: { stats: { averageTimePerPage: number }; weeklyRequiredPages: number; recommendedDailyPages: number }) => (
    getDisplayRecommendedPages(subject) * getEffectiveTimePerPage(subject.stats.averageTimePerPage)
  );

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
    const uniqueSubjs = allSubjectStats.filter(s => (
      relatedSubjIds.includes(s.id)
      && subjectMatchesWeekdayView(s)
    ));
    const count = uniqueSubjs.length;
    const measuredSubjs = uniqueSubjs.filter(subject => subject.stats.averageTimePerPage > 0);

    return {
      count,
      totalPages: uniqueSubjs.reduce((acc, cur) => acc + cur.totalPages, 0),
      completedPages: uniqueSubjs.reduce((acc, cur) => acc + cur.completedPages, 0),
      avgEff: measuredSubjs.length > 0 ? measuredSubjs.reduce((acc, cur) => acc + cur.stats.averageTimePerPage, 0) / measuredSubjs.length : null,
      avgStd: measuredSubjs.length > 0 ? measuredSubjs.reduce((acc, cur) => acc + cur.stats.standardDeviation, 0) / measuredSubjs.length : null,
      dailyTime: uniqueSubjs.reduce((acc, cur) => acc + getDisplayNeededMinutes(cur), 0),
      dailyPages: uniqueSubjs.reduce((acc, cur) => acc + getDisplayRecommendedPages(cur), 0),
      remaining: uniqueSubjs.reduce((acc, cur) => acc + cur.remainingPages, 0),
    };
  };

  const dueReviewSummary = useMemo(() => {
    const now = Date.now();
    const dueLogs = logs.filter(log => {
      const nextReview = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : 0;
      return log.reviewEnabled !== false && !log.isCondensed && nextReview <= now;
    });
    return {
      itemCount: dueLogs.length,
      subjectCount: new Set(dueLogs.map(log => log.subjectId)).size
    };
  }, [logs]);

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatPageNumber = (pages: number) => {
    const rounded = Math.round(pages * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const RenderTree = ({ parentId, depth = 0 }: { parentId?: string, depth?: number }) => {
    const folderHasWeekdaySubjects = (folderId: string): boolean => {
      if (editingId === folderId || movingItemId === folderId) return true;

      const childFolderIds = tagDefinitions
        .filter(folder => folder.parentId === folderId)
        .map(folder => folder.id);

      return allSubjectStats.some(subject => (
        subject.tagIds?.includes(folderId)
        && subjectMatchesWeekdayView(subject)
      )) || childFolderIds.some(folderHasWeekdaySubjects);
    };

    const folders = tagDefinitions
      .filter(f => f.parentId === parentId)
      .filter(folder => folderHasWeekdaySubjects(folder.id));
    const subjs = allSubjectStats.filter(s => 
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
          const folderSubjects = getSubjectsInFolder(folder.id);
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
                        <div className="space-y-2">
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
                          <div className="flex flex-wrap gap-1">
                            {WEEKDAYS.map(day => {
                              const selected = activeFolderEdit.scheduledWeekdays.includes(day.id);
                              return (
                                <button
                                  key={day.id}
                                  type="button"
                                  onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleFolderEditWeekday(day.id);
                                  }}
                                  className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition-all ${
                                    selected
                                      ? 'bg-indigo-500 text-white'
                                      : isExpanded
                                        ? 'bg-white/10 text-indigo-200'
                                        : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                saveFolderEdit(folder);
                              }}
                              className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition-all ${
                                isExpanded
                                  ? 'bg-white text-indigo-700'
                                  : 'bg-slate-900 text-white'
                              }`}
                            >
                              완료
                            </button>
                          </div>
                          <p className={`text-[10px] font-bold ${isExpanded ? 'text-indigo-200' : 'text-slate-400'}`}>
                            하위 {folderSubjects.length}개 과목에 같이 적용
                          </p>
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
                   <StatBox label="평균 효율" value={stats.avgEff !== null ? stats.avgEff.toFixed(1) : '측정 필요'} unit={stats.avgEff !== null ? 'm/p' : ''} color="text-emerald-400" isDark={isExpanded} />
                   <StatBox label="표준편차(σ)" value={stats.avgStd !== null ? stats.avgStd.toFixed(1) : '측정 필요'} unit="" color="text-blue-400" isDark={isExpanded} />
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
              {isExpanded && <RenderTree parentId={folder.id} depth={depth + 1} />}
            </div>
          );
        })}

        {subjs.map(sub => {
          const isEditing = editingId === sub.id;
          const baseSubject = subjects.find(subject => subject.id === sub.id) || sub;
          const sequenceSubjects = sub.sequenceSubjects || [baseSubject];
          const hasSequence = sequenceSubjects.length > 1;
          const selectedStageId = selectedSequenceStageIds[sub.id] || sub.sequenceActiveSubjectId || sequenceSubjects[0]?.id;
          const selectedStage = sequenceSubjects.find(subject => subject.id === selectedStageId) || sequenceSubjects[0];
          const progressSubject = hasSequence && selectedStage ? selectedStage : sub;
          const progressPercent = progressSubject.totalPages > 0
            ? Math.round((progressSubject.completedPages / progressSubject.totalPages) * 100)
            : 0;
          const editSequenceOrder = editForm?.sequenceOrderIds || sequenceSubjects.map(subject => subject.id);
          const editSequenceSubjects = editSequenceOrder
            .map(id => subjects.find(subject => subject.id === id))
            .filter(Boolean) as Subject[];
          const selectedEditStage = editSequenceSubjects.find(stage => stage.id === selectedStage?.id) || editSequenceSubjects[0];
          const selectedEditIndex = selectedEditStage
            ? editSequenceSubjects.findIndex(stage => stage.id === selectedEditStage.id)
            : -1;
          const mergeTargetSubjects = buildSequenceDisplaySubjects(subjects)
            .filter(subject => !editSequenceOrder.includes(subject.id));
          return (
            <div key={sub.id} className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 transition-all group/subj relative overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3 flex-grow">
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
                           <div className="flex flex-wrap gap-1">
                             {WEEKDAYS.map(day => {
                               const selected = editForm?.scheduledWeekdays.includes(day.id);
                               return (
                                 <button
                                   key={day.id}
                                   type="button"
                                   onClick={e => {
                                     e.preventDefault();
                                     e.stopPropagation();
                                     toggleEditWeekday(day.id);
                                   }}
                                   className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition-all ${
                                     selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'
                                   }`}
                                 >
                                   {day.label}
                                 </button>
                               );
                             })}
                           </div>
                       </div>
                       <div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3">
                         <div className="flex flex-wrap items-center gap-2">
                           <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[10px] font-black text-indigo-500">
                             주간 필요 {sub.weeklyRequiredPages}P
                           </span>
                            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-600">
                             비율 {editForm ? editForm.scheduledWeekdays.map(dayId => editForm.scheduledWeekdayWeights[dayId] || 1).join(':') : '-'}
                           </span>
                         </div>
                         <div className="grid grid-cols-7 gap-1.5">
                           {WEEKDAYS.map(day => {
                             const selected = editForm?.scheduledWeekdays.includes(day.id);
                             const previewPlan = editForm
                               ? distributePagesByWeekdayWeights(
                                 sub.weeklyRequiredPages,
                                 editForm.scheduledWeekdays,
                                 editForm.scheduledWeekdayWeights,
                                 editForm.scheduledWeekdayRemainderDay
                               )
                               : {};
                             return (
                               <div key={day.id} className={`rounded-xl border p-1.5 ${selected ? 'border-indigo-200 bg-white' : 'border-slate-100 bg-slate-100 opacity-60'}`}>
                                 <p className={`mb-1 text-center text-[10px] font-black ${selected ? 'text-indigo-600' : 'text-slate-400'}`}>{day.label}</p>
                                 <p className="mb-1 text-center text-sm font-black text-slate-900">
                                   {previewPlan[day.id] || 0}P
                                 </p>
                                 <input
                                   type="number"
                                   step="1"
                                   min="1"
                                   disabled={!selected}
                                   value={editForm?.scheduledWeekdayWeights[day.id] ?? 1}
                                   onChange={e => setEditForm(prev => prev ? {
                                     ...prev,
                                     scheduledWeekdayWeights: normalizeWeekdayWeights({
                                       ...prev.scheduledWeekdayWeights,
                                       [day.id]: Math.max(1, Number(e.target.value) || 1)
                                     }, prev.scheduledWeekdays),
                                     scheduledWeekdayRemainderDay: day.id
                                   } : null)}
                                   className="w-full rounded-lg bg-slate-50 px-1 py-1 text-center text-xs font-black text-slate-900 outline-none disabled:text-slate-300"
                                 />
                                 <p className="mt-1 text-center text-[9px] font-black text-slate-400">비율</p>
                               </div>
                             );
                           })}
                         </div>
                       </div>
                       </>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {sub.isRequired && (
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-rose-100 text-rose-600">필수</span>
                          )}
                          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${sub.diffDays > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>D-{sub.diffDays > 0 ? sub.diffDays : '0'}</span>
                          {hasSequence && (
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                              {sub.sequenceStageCount}개 탭 · 현재 {sub.sequenceActiveSubjectName}
                            </span>
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
                            saveSubjectEdit(baseSubject);
                        }} 
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-all cursor-pointer active:scale-95"
                     >
                        ✓
                     </button>
                  ) : (
                    <>
                      <button 
                          onClick={(e) => { 
                            e.preventDefault(); 
                          e.stopPropagation(); 
                            setEditingId(sub.id);
                            setFolderEditForm(null);
                            setSelectedSequenceStageIds(prev => ({ ...prev, [sub.id]: selectedStageId }));
                            setEditForm({
                              name: baseSubject.name,
                              totalPages: baseSubject.totalPages,
                              targetDate: baseSubject.targetDate,
                              tagIds: baseSubject.tagIds || [],
                              isRequired: baseSubject.isRequired ?? false,
                              sequenceOrderIds: sequenceSubjects.map(subject => subject.id),
                              mergeTargetId: '',
                              scheduledWeekdays: normalizeWeekdays(baseSubject.scheduledWeekdays),
                              scheduledWeekdayWeights: normalizeWeekdayWeights(baseSubject.scheduledWeekdayWeights, baseSubject.scheduledWeekdays),
                              scheduledWeekdayRemainderDay: baseSubject.scheduledWeekdayRemainderDay
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

              {hasSequence && !isEditing && selectedStage && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-2">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">과목 탭</p>
                    <p className="text-[9px] font-bold text-slate-300">눌러서 진척도 확인</p>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {sequenceSubjects.map((stage, index) => {
                      const isSelected = stage.id === selectedStage.id;
                      const isActiveStage = stage.id === sub.sequenceActiveSubjectId;
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => setSelectedSequenceStageIds(prev => ({ ...prev, [sub.id]: stage.id }))}
                          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-slate-400 hover:text-indigo-500'
                          }`}
                        >
                          {index + 1}. {stage.name}
                          {isActiveStage && <span className="ml-1 opacity-70">●</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="min-w-0 rounded-xl bg-white px-3 py-2">
                      <p className="truncate text-xs font-black text-slate-800">{selectedStage.name}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-black ${
                        selectedStage.id === sub.sequenceActiveSubjectId
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-slate-100 text-slate-400'
                      }`}>
                        {selectedStage.id === sub.sequenceActiveSubjectId ? '지금 학습 차례' : '정보 보기'}
                      </span>
                    </div>
                    <div className="rounded-xl bg-white px-3 py-2 text-right">
                      <p className="text-sm font-black text-indigo-600">
                        {formatPageNumber(selectedStage.completedPages)} / {formatPageNumber(selectedStage.totalPages)}P
                      </p>
                      <p className="mt-1 text-[10px] font-bold text-slate-400">목표 {selectedStage.targetDate}</p>
                    </div>
                  </div>
                </div>
              )}

              {isEditing && hasSequence && selectedEditStage && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-2">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">묶음 순서</p>
                    <p className="text-[9px] font-bold text-slate-300">탭 선택 후 조정</p>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {editSequenceSubjects.map((stage, index) => {
                      const isSelected = stage.id === selectedEditStage.id;
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => setSelectedSequenceStageIds(prev => ({ ...prev, [sub.id]: stage.id }))}
                          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-slate-400 hover:text-indigo-500'
                          }`}
                        >
                          {index + 1}. {stage.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-col gap-2 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">
                        {selectedEditIndex + 1}. {selectedEditStage.name}
                      </p>
                      <p className="mt-0.5 text-[10px] font-bold text-slate-400">
                        {formatPageNumber(selectedEditStage.completedPages)} / {formatPageNumber(selectedEditStage.totalPages)}P · 목표 {selectedEditStage.targetDate}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={selectedEditIndex <= 0}
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveEditSequenceSubject(selectedEditStage.id, -1);
                        }}
                        className="h-8 rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-500 disabled:opacity-30"
                      >
                        앞으로
                      </button>
                      <button
                        type="button"
                        disabled={selectedEditIndex < 0 || selectedEditIndex === editSequenceSubjects.length - 1}
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveEditSequenceSubject(selectedEditStage.id, 1);
                        }}
                        className="h-8 rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-500 disabled:opacity-30"
                      >
                        뒤로
                      </button>
                      <button
                        type="button"
                        disabled={editSequenceSubjects.length <= 1}
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeEditSequenceSubject(selectedEditStage.id);
                        }}
                        className="h-8 rounded-lg bg-rose-50 px-3 text-xs font-black text-rose-400 disabled:opacity-30"
                      >
                        밖으로
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {isEditing && (hasSequence || mergeTargetSubjects.length > 0) && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="space-y-1">
                    <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      이동 / 분리
                    </label>
                    <select
                      value={editForm?.mergeTargetId || ''}
                      onChange={e => setEditForm(prev => prev ? { ...prev, mergeTargetId: e.target.value } : null)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-700 outline-none"
                    >
                      <option value="">이 과목을 그대로 둠</option>
                      {hasSequence && (
                        <option value={DETACH_SUBJECT_VALUE}>선택한 탭 밖으로 뺌</option>
                      )}
                      {mergeTargetSubjects.map(subject => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name} 쪽으로 이동
                        </option>
                      ))}
                    </select>
                    <p className="px-1 text-[10px] font-bold text-slate-400">
                      선택한 탭을 밖으로 빼거나 다른 과목 쪽으로 이동할 수 있습니다. 합쳐지면 요일은 묶음 전체에 같이 적용됩니다.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-100 sm:grid-cols-4 [&>*:nth-child(2)]:hidden [&>*:nth-child(3)]:hidden">
                 <StatBox label="효율(m/p)" value={formatEfficiency(sub.stats.averageTimePerPage)} unit="" color="text-indigo-400" />
                 <StatBox label="편차(σ)" value={formatDeviation(sub.stats.standardDeviation, sub.stats.averageTimePerPage)} unit="" color="text-blue-400" />
                 <StatBox label="잔여(P)" value={sub.remainingPages.toString()} unit="P" color="text-amber-500" />
                 <StatBox label="권장" value={getDisplayRecommendedPages(sub).toString()} unit="P" color="text-slate-800" />
                 <StatBox label="필요 시간" value={formatTime(getDisplayNeededMinutes(sub))} unit="" color="text-slate-900" large />
                 <StatBox
                   label="4일 속도 변화"
                   value={sub.speedChange.speedChangePercent !== null ? `${sub.speedChange.speedChangePercent >= 0 ? '+' : ''}${sub.speedChange.speedChangePercent.toFixed(0)}%` : '기록 필요'}
                   unit=""
                   color={sub.speedChange.speedChangePercent !== null && sub.speedChange.speedChangePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}
                 />
              </div>

              <div className="space-y-1 px-1">
                 <div className="flex justify-between items-end">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      학습 진척도{hasSequence && selectedStage ? ` · ${selectedStage.name}` : ''} ({progressPercent}%)
                    </p>
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
                        <p className="text-base font-black text-slate-900">
                          {formatPageNumber(progressSubject.completedPages)} / {formatPageNumber(progressSubject.totalPages)}
                          <span className="text-xs text-slate-400 font-bold ml-1">P</span>
                        </p>
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
        <button
          type="button"
          onClick={onOpenReview}
          className="rounded-xl border border-rose-100 bg-white px-4 py-2 text-left shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50"
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">오늘 복습 큐</p>
          <p className="mt-0.5 text-xl font-black text-rose-600">
            {dueReviewSummary.subjectCount}과목
            <span className="ml-2 text-xs font-bold text-rose-300">{dueReviewSummary.itemCount}개</span>
          </p>
        </button>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          <button
            type="button"
            onClick={() => setShowAllWeekdays(true)}
            className={`rounded-xl py-2 text-sm font-black transition-all ${
              showAllWeekdays
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500'
            }`}
          >
            <span>전체</span>
            <span className={`ml-1 text-[9px] ${showAllWeekdays ? 'text-slate-200' : 'text-slate-300'}`}>{allSubjectStats.length}</span>
          </button>
          {WEEKDAYS.map(day => {
            const isActive = !showAllWeekdays && activeWeekday === day.id;
            const count = allSubjectStats.filter(subject => (
              normalizeWeekdays(subject.scheduledWeekdays).includes(day.id)
            )).length;
            return (
              <button
                key={day.id}
                type="button"
                onClick={() => {
                  setShowAllWeekdays(false);
                  onActiveWeekdayChange(day.id);
                }}
                className={`rounded-xl py-2 text-sm font-black transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500'
                }`}
              >
                <span>{day.label}</span>
                <span className={`ml-1 text-[9px] ${isActive ? 'text-indigo-100' : 'text-slate-300'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-100/70 p-3 md:p-4 rounded-2xl border border-slate-200">
        <RenderTree />
        
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

const StatBox = ({ label, value, unit, color, isDark, highlight, large }: { label: string, value: string, unit: string, color: string, isDark?: boolean, highlight?: boolean, large?: boolean }) => {
  const textLength = `${value}${unit}`.length;
  const valueSize = large
    ? 'text-2xl md:text-3xl'
    : textLength >= 6
      ? 'text-sm md:text-base'
      : textLength >= 4
        ? 'text-lg md:text-xl'
        : 'text-xl md:text-2xl';

  return (
    <div className={`flex flex-col min-w-0 px-2.5 py-2.5 rounded-lg transition-all ${highlight ? (isDark ? 'bg-white/10' : 'bg-white shadow-sm border border-slate-100 z-10') : 'opacity-90'}`}>
      <p className={`text-[8px] md:text-[9px] font-black uppercase mb-1 tracking-tight truncate ${isDark ? 'text-indigo-400' : 'text-slate-400'}`}>{label}</p>
      <p className={`${valueSize} font-black truncate leading-none ${isDark && !highlight ? 'text-white' : color}`}>
        {value}<span className="text-[10px] md:text-xs font-bold ml-1 opacity-40">{unit}</span>
      </p>
    </div>
  );
};
