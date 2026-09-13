import React, { useMemo, useState } from 'react';
import { Subject, StudyLog, TagDefinition } from '../types';
import { calculateStats, calculateSubjectReviewAverageTimePerPage } from '../utils/math';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from '../utils/review';
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
  getAllSubjectReviewIds,
  getSubjectCompletedPageCount,
  getSubjectRemainingPageCount,
  getSubjectStages,
  getSubjectStageReviewSubjectIds,
  getSubjectTotalPageCount,
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

type SubjectStage = ReturnType<typeof getSubjectStages>[number];

interface ProjectedStudyEvent {
  date: Date;
  pages: number;
}

interface StageScheduleEstimate {
  completionDates: Map<string, Date>;
  studyEvents: Map<string, ProjectedStudyEvent[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const formatEstimatedDate = (date?: Date | null) => {
  if (!date || !Number.isFinite(date.getTime())) return '예측 어려움';
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const today = parseStudyDate(getLocalDateKey());
  const diffDays = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (diffDays <= 0) return '오늘';
  if (diffDays === 1) return '내일';
  const dateLabel = target.getFullYear() === today.getFullYear()
    ? `${target.getMonth() + 1}/${target.getDate()}`
    : `${String(target.getFullYear()).slice(2)}.${target.getMonth() + 1}.${target.getDate()}`;
  return `${dateLabel} · ${diffDays}일 후`;
};

const estimateStageSchedule = (subject: Subject): StageScheduleEstimate => {
  const completionDates = new Map<string, Date>();
  const studyEvents = new Map<string, ProjectedStudyEvent[]>();
  const stages = getSubjectStages(subject);
  const totalRemainingPages = getSubjectRemainingPageCount(subject);
  if (totalRemainingPages <= 0) return { completionDates, studyEvents };

  const selectedWeekdays = normalizeWeekdays(subject.scheduledWeekdays);
  const diffDays = Math.max(1, getDiffDays(subject.targetDate));
  let weekdayPlan = getWeekdayPagePlan(subject, totalRemainingPages, diffDays);
  let weeklyCapacity = selectedWeekdays.reduce((sum, weekday) => sum + (weekdayPlan[weekday] || 0), 0);

  if (weeklyCapacity <= 0) {
    weekdayPlan = distributePagesByWeekdayWeights(
      Math.max(1, calculateWeeklyRequiredPages(totalRemainingPages, diffDays)),
      selectedWeekdays
    );
    weeklyCapacity = selectedWeekdays.reduce((sum, weekday) => sum + (weekdayPlan[weekday] || 0), 0);
  }

  if (weeklyCapacity <= 0) return { completionDates, studyEvents };

  const remainingByStage = stages.map(stage => Math.max(0, stage.remainingPages));
  let activeStageIndex = remainingByStage.findIndex(pages => pages > 0);
  const cursor = parseStudyDate(getLocalDateKey());

  for (let dayOffset = 0; dayOffset < 3650 && activeStageIndex >= 0; dayOffset += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + dayOffset);
    let availablePages = Math.max(0, weekdayPlan[date.getDay()] || 0);

    while (availablePages > 0 && activeStageIndex >= 0) {
      const stage = stages[activeStageIndex];
      const pages = Math.min(availablePages, remainingByStage[activeStageIndex]);
      if (pages > 0) {
        const events = studyEvents.get(stage.id) || [];
        events.push({ date: new Date(date), pages });
        studyEvents.set(stage.id, events);
        remainingByStage[activeStageIndex] -= pages;
        availablePages -= pages;
      }

      if (remainingByStage[activeStageIndex] <= 0) {
        completionDates.set(stage.id, new Date(date));
        activeStageIndex = remainingByStage.findIndex((pages, index) => index > activeStageIndex && pages > 0);
      }
    }
  }

  return { completionDates, studyEvents };
};

const estimateReviewSubjectCompletion = (
  parentSubject: Subject,
  stage: SubjectStage,
  reviewSubject: Subject,
  projectedStudyEvents: ProjectedStudyEvent[],
  logs: StudyLog[]
) => {
  const remainingPages = getSubjectRemainingPageCount(reviewSubject);
  if (remainingPages <= 0) return null;

  const now = Date.now();
  const latestSupportedDate = now + (10 * 365 * DAY_MS);
  const events = logs
    .filter(log => {
      if (log.subjectId !== parentSubject.id || log.isCondensed || log.reviewEnabled === false) return false;
      if ((log.subjectStageId || parentSubject.id) !== stage.id) return false;
      const reviewSubjectIds = Array.isArray(log.reviewSubjectIdsSnapshot) && log.reviewSubjectIdsSnapshot.length > 0
        ? log.reviewSubjectIdsSnapshot
        : stage.reviewSubjectIds;
      return reviewSubjectIds.includes(reviewSubject.id);
    })
    .flatMap(log => {
      const pages = Math.max(0, log.pagesRead);
      if (pages <= 0) return [];
      const scheduledAt = log.nextReviewDate
        ? new Date(log.nextReviewDate).getTime()
        : new Date(log.timestamp).getTime() + INITIAL_REVIEW_DELAY_MS;
      if (!Number.isFinite(scheduledAt)) return [];
      return [{ at: scheduledAt, pages, step: Math.max(0, log.reviewStep || 0) }];
    });

  projectedStudyEvents.forEach(event => {
    events.push({
      at: event.date.getTime() + INITIAL_REVIEW_DELAY_MS,
      pages: event.pages,
      step: 0
    });
  });

  if (events.length === 0) return null;

  let completedPages = 0;
  for (let count = 0; count < 5000 && events.length > 0; count += 1) {
    events.sort((a, b) => a.at - b.at);
    const event = events.shift();
    if (!event) break;
    const effectiveAt = Math.max(now, event.at);
    if (effectiveAt > latestSupportedDate) return null;

    completedPages += event.pages;
    if (completedPages >= remainingPages) return new Date(effectiveAt);

    const nextAt = event.at + getNextReviewIntervalMs(event.step);
    if (Number.isFinite(nextAt) && nextAt <= latestSupportedDate) {
      events.push({ ...event, at: nextAt, step: event.step + 1 });
    }
  }

  return null;
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
  const [expandedSubjectReviewIds, setExpandedSubjectReviewIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stageEditForm, setStageEditForm] = useState<{
    subjectId: string;
    stageId: string;
    name: string;
    startPage: number;
    endPage: number;
    reviewSubjectIds: string[];
    isNew: boolean;
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
    stageId: string;
    name: string;
    targetDate: string;
    tagIds: string[];
    isRequired: boolean;
    scheduledWeekdays: number[];
  } | null>(null);
  const reviewSubjectIdSet = useMemo(() => (
    new Set(subjects.flatMap(getAllSubjectReviewIds))
  ), [subjects]);
  const reviewSubjectOwnerMap = useMemo(() => {
    const next = new Map<string, string>();
    subjects.forEach(subject => {
      getAllSubjectReviewIds(subject).forEach(reviewSubjectId => {
        if (!next.has(reviewSubjectId)) next.set(reviewSubjectId, subject.id);
      });
    });
    return next;
  }, [subjects]);
  const reviewSubjectStageOwnerMap = useMemo(() => {
    const next = new Map<string, string>();
    subjects.forEach(subject => {
      getSubjectStages(subject).forEach(stage => {
        stage.reviewSubjectIds.forEach(reviewSubjectId => {
          if (!next.has(reviewSubjectId)) next.set(reviewSubjectId, `${subject.id}:${stage.id}`);
        });
      });
    });
    return next;
  }, [subjects]);
  const followUpSourceOwnerMap = useMemo(() => {
    const next = new Map<string, string>();
    subjects.forEach(subject => {
      (subject.followUpSubjects || []).forEach(followUp => {
        if (followUp.sourceSubjectId && !next.has(followUp.sourceSubjectId)) {
          next.set(followUp.sourceSubjectId, subject.id);
        }
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

  const toggleStageEditReviewSubject = (reviewSubjectId: string) => {
    setStageEditForm(current => {
      if (!current) return current;
      if (reviewSubjectIdSet.has(current.subjectId)) return current;
      const exists = current.reviewSubjectIds.includes(reviewSubjectId);
      const ownerKey = reviewSubjectStageOwnerMap.get(reviewSubjectId);
      const editingKey = `${current.subjectId}:${current.stageId}`;
      if (!exists && ownerKey && ownerKey !== editingKey) return current;

      return {
        ...current,
        reviewSubjectIds: exists
          ? current.reviewSubjectIds.filter(id => id !== reviewSubjectId)
          : [...current.reviewSubjectIds, reviewSubjectId]
      };
    });
  };

  const toggleEditWeekday = (dayId: number) => {
    setEditForm(prev => {
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

    const updatedSubjects = getSubjectsInFolder(folderId).map(subject => {
      const nextSubject = {
        ...subject,
        scheduledWeekdays,
        scheduledWeekdayWeights: undefined,
        scheduledWeekdayRemainderDay: undefined,
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
      const ownerSubjectId = reviewSubjectOwnerMap.get(sub.id);
      const effectiveTargetDate = ownerSubjectId
        ? subjects.find(subject => subject.id === ownerSubjectId)?.targetDate || sub.targetDate
        : sub.targetDate;
      const weeklyLogs = subLogs.filter(log => {
        const studyDate = getLogStudyDate(log);
        return studyDate >= weekStartDateKey && studyDate <= todayDateKey;
      });
      const remaining = getSubjectRemainingPageCount(sub);
      const diffDays = getDiffDays(effectiveTargetDate);
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
        targetDate: effectiveTargetDate,
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

  const withFreshPagePlan = (subject: Subject): Subject => ({
    ...subject,
    scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
      subject,
      getSubjectRemainingPageCount(subject),
      getDiffDays(subject.targetDate)
    )
  });

  const openSubjectSummaryEditor = (subject: Subject, requestedStageId?: string) => {
    const stages = getSubjectStages(subject);
    const stage = stages.find(item => item.id === requestedStageId)
      || stages.find(item => item.status === 'current')
      || stages[stages.length - 1];
    if (!stage) return;

    setStageEditForm(null);
    setFolderEditForm(null);
    setEditingId(subject.id);
    setEditForm({
      stageId: stage.id,
      name: stage.name,
      targetDate: subject.targetDate,
      tagIds: subject.tagIds || [],
      isRequired: subject.isRequired ?? false,
      scheduledWeekdays: normalizeWeekdays(subject.scheduledWeekdays)
    });
  };

  const openInlineStageEditor = (subject: Subject, stage: SubjectStage, isNew = false) => {
    setEditingId(null);
    setEditForm(null);
    setFolderEditForm(null);
    setStageEditForm({
      subjectId: subject.id,
      stageId: stage.id,
      name: stage.name,
      startPage: stage.startPage,
      endPage: stage.endPage,
      reviewSubjectIds: [...stage.reviewSubjectIds],
      isNew
    });
  };

  const saveInlineStageEditor = (subject: Subject) => {
    if (!stageEditForm || stageEditForm.subjectId !== subject.id) return;
    const startPage = Math.max(1, Math.round(Number(stageEditForm.startPage) || 1));
    const endPage = Math.max(startPage, Math.round(Number(stageEditForm.endPage) || startPage));
    const reviewSubjectIds = Array.from(new Set(stageEditForm.reviewSubjectIds.filter(id => (
      id !== subject.id && subjects.some(candidate => (
        candidate.id === id && getAllSubjectReviewIds(candidate).length === 0
      ))
    ))));
    const name = stageEditForm.name.trim() || '과목';
    const updatedSubject = stageEditForm.stageId === subject.id
      ? {
          ...subject,
          name,
          startPage,
          totalPages: endPage,
          completedPages: Math.min(endPage, Math.max(startPage - 1, subject.completedPages)),
          reviewSubjectIds
        }
      : {
          ...subject,
          followUpSubjects: (subject.followUpSubjects || []).map(stage => (
            stage.id === stageEditForm.stageId
              ? {
                  ...stage,
                  name,
                  startPage,
                  endPage,
                  completedPage: Math.min(endPage, Math.max(startPage - 1, stage.completedPage)),
                  reviewSubjectIds
                }
              : stage
          ))
        };

    onUpdateSubject?.(withFreshPagePlan(updatedSubject));
    setStageEditForm(null);
  };

  const cancelInlineStageEditor = (subject: Subject) => {
    if (stageEditForm?.subjectId === subject.id && stageEditForm.isNew) {
      onUpdateSubject?.(withFreshPagePlan({
        ...subject,
        followUpSubjects: (subject.followUpSubjects || []).filter(stage => stage.id !== stageEditForm.stageId)
      }));
    }
    setStageEditForm(null);
  };

  const addFollowUpSubject = (subject: Subject) => {
    const newStage = {
      id: Math.random().toString(36).slice(2, 11),
      name: '새 후행과목',
      startPage: 1,
      endPage: 100,
      completedPage: 0,
      reviewSubjectIds: []
    };
    const updatedSubject = withFreshPagePlan({
      ...subject,
      followUpSubjects: [...(subject.followUpSubjects || []), newStage]
    });

    onUpdateSubject?.(updatedSubject);
    setExpandedSubjectReviewIds(current => new Set(current).add(subject.id));
    openInlineStageEditor(subject, {
      ...newStage,
      currentPage: 1,
      remainingPages: 100,
      isFollowUp: true,
      status: 'upcoming'
    }, true);
  };

  const moveRemainingStage = (subject: Subject, stageId: string, direction: -1 | 1) => {
    const remainingStages = getSubjectStages(subject).filter(stage => stage.status !== 'completed');
    const remainingIndex = remainingStages.findIndex(stage => stage.id === stageId);
    const targetIndex = remainingIndex + direction;
    if (remainingIndex < 0 || targetIndex < 0 || targetIndex >= remainingStages.length) return;

    const currentStage = remainingStages[0];
    const currentStageCompletedPages = currentStage
      ? Math.max(0, currentStage.completedPage - currentStage.startPage + 1)
      : 0;
    if (
      (remainingIndex === 0 || targetIndex === 0)
      && (!currentStage?.isFollowUp || currentStageCompletedPages > 0)
    ) return;

    const targetStageId = remainingStages[targetIndex].id;
    const followUpSubjects = [...(subject.followUpSubjects || [])];
    const sourceIndex = followUpSubjects.findIndex(stage => stage.id === stageId);
    const destinationIndex = followUpSubjects.findIndex(stage => stage.id === targetStageId);
    if (sourceIndex < 0 || destinationIndex < 0) return;

    [followUpSubjects[sourceIndex], followUpSubjects[destinationIndex]] = [
      followUpSubjects[destinationIndex],
      followUpSubjects[sourceIndex]
    ];
    onUpdateSubject?.(withFreshPagePlan({ ...subject, followUpSubjects }));
  };

  const visibleSubjectStats = useMemo(
    () => allSubjectStats.filter(subject => (
      !reviewSubjectIdSet.has(subject.id) && !followUpSourceOwnerMap.has(subject.id)
    )),
    [allSubjectStats, followUpSourceOwnerMap, reviewSubjectIdSet]
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
    const folders = tagDefinitions
      .filter(f => f.parentId === parentId);
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
          const combinedTotalPages = getSubjectTotalPageCount(sub);
          const combinedCompletedPages = getSubjectCompletedPageCount(sub);
          const subjectStages = getSubjectStages(sub);
          const remainingStages = subjectStages.filter(stage => stage.status !== 'completed');
          const activeStage = getActiveSubjectStage(sub);
          const displayStage = activeStage || subjectStages[subjectStages.length - 1];
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
          const isReviewListExpanded = expandedSubjectReviewIds.has(sub.id);
          const stageSchedule = estimateStageSchedule(sub);
          return (
            <div key={sub.id} className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 transition-all group/subj relative overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3 flex-grow">
                  {!isEditing && (
                    <button
                      type="button"
                      aria-label={`${displayStage?.name || sub.name} 전체 과목 순서 ${isReviewListExpanded ? '접기' : '펼치기'}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSubjectReviewList(sub.id);
                      }}
                      className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-all ${
                        isReviewListExpanded
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
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
                       <div className="flex min-w-0 flex-wrap items-center gap-2">
                         <h4 className="truncate text-lg md:text-xl font-black text-slate-900">{displayStage?.name || sub.name}</h4>
                         <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black ${
                           activeStage ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'
                         }`}>
                           {activeStage ? '현재 과목' : '전체 완료'}
                         </span>
                       </div>
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
                     ) : !isEditing ? (
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
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 relative z-30 flex-shrink-0">
                  {isEditing ? (
                     <button 
                        onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation();
                            if (editForm) {
                              const editingBaseStage = editForm.stageId === sub.id;
                              const updatedSubject: Subject = {
                                ...sub,
                                name: editingBaseStage ? editForm.name.trim() || sub.name : sub.name,
                                followUpSubjects: editingBaseStage
                                  ? sub.followUpSubjects
                                  : (sub.followUpSubjects || []).map(stage => (
                                    stage.id === editForm.stageId
                                      ? { ...stage, name: editForm.name.trim() || stage.name }
                                      : stage
                                  )),
                                targetDate: editForm.targetDate,
                                tagIds: editForm.tagIds,
                                isRequired: editForm.isRequired,
                                scheduledWeekdays: normalizeWeekdays(editForm.scheduledWeekdays),
                                scheduledWeekdayWeights: undefined,
                                scheduledWeekdayRemainderDay: undefined,
                                scheduledWeekdayPages: undefined
                              };
                              onUpdateSubject?.(withFreshPagePlan(updatedSubject));
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
                          title="후행과목 추가"
                          aria-label={`${displayStage?.name || sub.name} 후행과목 추가`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            addFollowUpSubject(sub);
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 transition-all cursor-pointer"
                      >
                          ＋
                      </button>
                       <button
                           onClick={(e) => {
                             e.preventDefault();
                             e.stopPropagation();
                             openSubjectSummaryEditor(sub, displayStage?.id);
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
                    <p className="text-base font-black text-slate-900">{activeStageCompletedPages} / {activeStagePageCount} <span className="text-xs text-slate-400 font-bold ml-1">P</span></p>
                 </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
                 </div>
              </div>

              {isEditing && (
                <div className="mt-2 bg-slate-900 p-4 rounded-2xl border border-slate-800 animate-in slide-in-from-top-4 relative z-30">
                  <div>
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
                  <div className="mt-4 border-t border-slate-800 pt-4">
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
                  </div>
                </div>
              )}

              {isReviewListExpanded && !isEditing && (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:ml-12">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">전체 과목</p>
                    <span className="rounded-lg bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">
                      남은 순서 {remainingStages.length}개
                    </span>
                  </div>

                  {subjectStages.map(stage => {
                    const isCurrentStage = stage.status === 'current';
                    const isInlineEditing = stageEditForm?.subjectId === sub.id
                      && stageEditForm.stageId === stage.id;
                    const remainingOrderIndex = remainingStages.findIndex(item => item.id === stage.id);
                    const currentRemainingStage = remainingStages[0];
                    const currentRemainingCompletedPages = currentRemainingStage
                      ? Math.max(0, currentRemainingStage.completedPage - currentRemainingStage.startPage + 1)
                      : 0;
                    const canReplaceCurrentStage = Boolean(
                      currentRemainingStage?.isFollowUp && currentRemainingCompletedPages === 0
                    );
                    const canMoveUp = remainingOrderIndex > 0
                      && (remainingOrderIndex > 1 || canReplaceCurrentStage);
                    const canMoveDown = remainingOrderIndex >= 0
                      && remainingOrderIndex < remainingStages.length - 1
                      && (remainingOrderIndex > 0 || canReplaceCurrentStage);
                    const stagePageCount = Math.max(0, stage.endPage - stage.startPage + 1);
                    const stageCompletedPages = Math.min(
                      stagePageCount,
                      Math.max(0, stage.completedPage - stage.startPage + 1)
                    );
                    const stageProgress = stagePageCount > 0
                      ? Math.round((stageCompletedPages / stagePageCount) * 100)
                      : 0;
                    const linkedReviewSubjects = stage.reviewSubjectIds
                      .map(id => allSubjectStats.find(subject => subject.id === id))
                      .filter((subject): subject is typeof allSubjectStats[number] => Boolean(subject));
                    const statusLabel = stage.status === 'completed'
                      ? '이전 과목'
                      : isCurrentStage
                        ? '현재 과목'
                        : '후행과목';
                    const estimatedCompletionDate = stageSchedule.completionDates.get(stage.id);

                    return (
                      <div
                        key={stage.id}
                        className={`rounded-2xl border-2 p-4 transition-all ${
                          isCurrentStage
                            ? 'border-indigo-500 bg-white shadow-md shadow-indigo-100'
                            : stage.status === 'completed'
                              ? 'border-slate-200 bg-slate-100/70'
                              : 'border-white bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <span className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-2 text-xs font-black ${
                              isCurrentStage ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'
                            }`}>
                              {stage.status === 'completed' ? '완료' : remainingOrderIndex + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              {isInlineEditing && stageEditForm ? (
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      value={stageEditForm.name}
                                      onChange={event => setStageEditForm(current => current ? {
                                        ...current,
                                        name: event.target.value
                                      } : current)}
                                      onClick={event => event.stopPropagation()}
                                      className="min-w-0 flex-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-base font-black text-slate-900 outline-none focus:border-indigo-500"
                                      autoFocus
                                    />
                                    <span className={`rounded-full px-2 py-1 text-[9px] font-black ${
                                      isCurrentStage
                                        ? 'bg-indigo-100 text-indigo-600'
                                        : stage.status === 'completed'
                                          ? 'bg-slate-200 text-slate-500'
                                          : 'bg-amber-100 text-amber-600'
                                    }`}>
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                      <span className="block text-[9px] font-black text-slate-400">시작 페이지</span>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={stageEditForm.startPage}
                                        onClick={event => event.stopPropagation()}
                                        onChange={event => setStageEditForm(current => current ? {
                                          ...current,
                                          startPage: Number(event.target.value)
                                        } : current)}
                                        className="mt-1 w-full bg-transparent text-base font-black text-slate-900 outline-none"
                                      />
                                    </label>
                                    <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                      <span className="block text-[9px] font-black text-slate-400">끝 페이지</span>
                                      <input
                                        type="number"
                                        min={stageEditForm.startPage || 1}
                                        step="1"
                                        value={stageEditForm.endPage}
                                        onClick={event => event.stopPropagation()}
                                        onChange={event => setStageEditForm(current => current ? {
                                          ...current,
                                          endPage: Number(event.target.value)
                                        } : current)}
                                        className="mt-1 w-full bg-transparent text-base font-black text-slate-900 outline-none"
                                      />
                                    </label>
                                  </div>
                                  {stage.status !== 'completed' && (
                                    <div className="flex items-center gap-2">
                                      <span className="mr-auto text-[10px] font-black text-slate-400">
                                        남은 순서 {remainingOrderIndex + 1}
                                      </span>
                                      <button
                                        type="button"
                                        aria-label={`${stage.name} 순서 앞으로`}
                                        disabled={!canMoveUp}
                                        onClick={event => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          moveRemainingStage(sub, stage.id, -1);
                                        }}
                                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 disabled:opacity-25"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`${stage.name} 순서 뒤로`}
                                        disabled={!canMoveDown}
                                        onClick={event => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          moveRemainingStage(sub, stage.id, 1);
                                        }}
                                        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 disabled:opacity-25"
                                      >
                                        ↓
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h5 className="truncate text-base font-black text-slate-900">{stage.name}</h5>
                                    <span className={`rounded-full px-2 py-1 text-[9px] font-black ${
                                      isCurrentStage
                                        ? 'bg-indigo-100 text-indigo-600'
                                        : stage.status === 'completed'
                                          ? 'bg-slate-200 text-slate-500'
                                          : 'bg-amber-100 text-amber-600'
                                    }`}>
                                      {statusLabel}
                                    </span>
                                    {stage.status !== 'completed' && (
                                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-black text-indigo-600">
                                        완료 예상 {formatEstimatedDate(estimatedCompletionDate)}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-xs font-bold text-slate-400">
                                    p.{formatPageValue(stage.startPage)}~{formatPageValue(stage.endPage)} · {stageProgress}%
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {isInlineEditing ? (
                              <>
                                <button
                                  type="button"
                                  aria-label={`${stage.name} 수정 저장`}
                                  onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    saveInlineStageEditor(sub);
                                  }}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  aria-label={`${stage.name} 수정 취소`}
                                  onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    cancelInlineStageEditor(sub);
                                  }}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-sm font-black text-slate-500"
                                >
                                  ×
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                aria-label={`${stage.name} 수정`}
                                onClick={event => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openInlineStageEditor(sub, stage);
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-400 hover:text-indigo-600"
                              >
                                ✎
                              </button>
                            )}
                          </div>
                        </div>

                        {!isInlineEditing && (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                            <div
                              className={`h-full rounded-full ${isCurrentStage ? 'bg-indigo-500' : 'bg-slate-400'}`}
                              style={{ width: `${stageProgress}%` }}
                            />
                          </div>
                        )}

                        {linkedReviewSubjects.length > 0 && !isInlineEditing && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {linkedReviewSubjects.map(reviewSubject => {
                              const reviewActiveStage = getActiveSubjectStage(reviewSubject);
                              const reviewMinutesPerPage = getReviewMinutesPerPage(reviewSubject.id)
                                || reviewSubject.stats.averageTimePerPage;
                              const reviewCompletionDate = estimateReviewSubjectCompletion(
                                sub,
                                stage,
                                reviewSubject,
                                stageSchedule.studyEvents.get(stage.id) || [],
                                logs
                              );
                              return (
                                <div key={reviewSubject.id} className="rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="min-w-0 truncate text-xs font-black text-slate-800">{reviewSubject.name}</p>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <span className="text-[9px] font-black text-rose-500">복습과목</span>
                                      <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-rose-600">
                                        {getSubjectRemainingPageCount(reviewSubject) <= 0
                                          ? '완료'
                                          : `완료 예상 ${formatEstimatedDate(reviewCompletionDate)}`}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="mt-1 text-[10px] font-bold text-slate-400">
                                    {reviewActiveStage
                                      ? `p.${formatPageValue(reviewActiveStage.currentPage)}~${formatPageValue(reviewActiveStage.endPage)}`
                                      : '완료'}
                                    {' · '}
                                    {reviewMinutesPerPage > 0 ? `${reviewMinutesPerPage.toFixed(1)}분/P` : '측정 필요'}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {isInlineEditing && stageEditForm && (
                          <div className="mt-3 rounded-xl bg-slate-900 p-3">
                            <p className="mb-2 text-[10px] font-black text-slate-500">복습과목</p>
                            <div className="max-h-40 overflow-y-auto">
                              <div className="flex flex-wrap gap-2">
                                {subjects
                                  .filter(candidate => {
                                    if (candidate.id === sub.id) return false;
                                    if (getAllSubjectReviewIds(candidate).length > 0) return false;
                                    const selectedHere = stageEditForm.reviewSubjectIds.includes(candidate.id);
                                    const ownerStageKey = reviewSubjectStageOwnerMap.get(candidate.id);
                                    const editingStageKey = `${sub.id}:${stage.id}`;
                                    if (!selectedHere && ownerStageKey && ownerStageKey !== editingStageKey) return false;
                                    if (followUpSourceOwnerMap.has(candidate.id)) return false;
                                    if ((sub.followUpSubjects || []).some(item => item.sourceSubjectId === candidate.id)) return false;
                                    return !getAllSubjectReviewIds(candidate).includes(sub.id);
                                  })
                                  .sort((a, b) => {
                                    const indexA = stageEditForm.reviewSubjectIds.indexOf(a.id);
                                    const indexB = stageEditForm.reviewSubjectIds.indexOf(b.id);
                                    if (indexA >= 0 || indexB >= 0) {
                                      if (indexA < 0) return 1;
                                      if (indexB < 0) return -1;
                                      return indexA - indexB;
                                    }
                                    return a.name.localeCompare(b.name, 'ko');
                                  })
                                  .map(candidate => {
                                    const selectedIndex = stageEditForm.reviewSubjectIds.indexOf(candidate.id);
                                    return (
                                      <button
                                        key={candidate.id}
                                        type="button"
                                        onClick={event => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          toggleStageEditReviewSubject(candidate.id);
                                        }}
                                        className={`rounded-lg border px-3 py-2 text-xs font-black transition-all ${
                                          selectedIndex >= 0
                                            ? 'border-rose-400 bg-rose-500 text-white'
                                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-rose-400'
                                        }`}
                                      >
                                        {selectedIndex >= 0 ? `${selectedIndex + 1}. ` : ''}{candidate.name}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
