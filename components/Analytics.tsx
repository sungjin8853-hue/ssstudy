import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ListOrder, Subject, StudyLog, TagDefinition } from '../types';
import { calculateStats, calculateSubjectReviewAverageTimePerPage } from '../utils/math';
import { getNextReviewIntervalMs, INITIAL_REVIEW_DELAY_MS } from '../utils/review';
import { ReviewGrowthSettings } from './PageGrowth';
import { describeForecastBasis, describePlanUnit, ForecastList, FolderSpeedChart, GrowthAmount, InsertGap, PlanUnitSummary, ProgressBar, ShareBar, SpeedFacts, SpeedGainChart, WeekdayNeedBar, WeekdayPagesEditor } from './SpeedPanels';
import { createNewStudyPlan, SubjectPlanner } from './SubjectPlanner';
import { insertSiblingOrder, joinWithAnd, orderSiblings, SiblingRef } from '../utils/listOrder';
import { analyzeSubjectSpeed, buildGroupSpeed, describeSpeedGrowth, PlanUnit, SpeedUnit, sumOf, summarizeFolderSpeed, summarizeUnitAmount, summarizeUnitGrowth, unitAmountGrowthOf, unitGrowthOf } from '../utils/speedGrowth';
import { buildPlanReviewCells, buildReviewWeekCells, buildWeekPlan, currentPlanStageId, getWeekdayMinutesPerPage, mergeWeekCells, resolveSavedWeekdayPages, setWeekdayMinutes, stepWeekdayMinutes, stepWeekdayPages, toggleStudyWeekday, WeekCell, withPlanTimes } from '../utils/weekPlan';
import { DEFAULT_PAGE_LABEL, getPageLabel, MAX_PAGE_LABEL_LENGTH, normalizePageLabel, pagePositionLabel } from '../utils/pageLabel';
import { DAY_MS, estimateReviewSubjectCompletion, estimateStageSchedule, formatEstimatedDate, SubjectStage } from '../utils/completionEstimate';
import {
  calculateFreshWeekdayPagePlan,
  calculateWeeklyRequiredPages,
  getDiffDays,
  getLocalDateKey,
  getPastCarryoverPages,
  getPlanningDayCount,
  getSubjectDayRemainingPages,
  getWeekdayPagePlan,
  getWeekdayPageStep,
  getLogStudyDate,
  getActiveSubjectStage,
  getAllSubjectReviewIds,
  getSubjectCompletedPageCount,
  getSubjectRemainingPageCount,
  getSubjectStages,
  getStageChapters,
  getSubjectStageReviewSubjectIds,
  getSubjectTotalPageCount,
  normalizeWeekdays,
  parseStudyDate,
  WEEKDAYS
} from '../utils/schedule';
import { formatChapters, getSubjectChapters, parseChapterText } from '../utils/subjectChapters';

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
  onAddSubject?: (subject: Subject) => void;
  onDeleteFolder?: (folderId: string) => void;
  onOpenReview?: () => void;
  /** 학습 실행의 "학습 설정 가기"로 열었을 때 먼저 보여줄 과목: 들어 있는 폴더를 펼치고 그 카드로 스크롤한다 */
  focusSubjectId?: string;
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
  focusSubjectId,
  onUpdateSubject, 
  onUpdateSubjects,
  onDeleteSubject,
  onUpdateTags,
  onAddSubject,
  onDeleteFolder,
  onOpenReview
}) => {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set(['root']));
  const [expandedSubjectReviewIds, setExpandedSubjectReviewIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  // 맨 위 요약: 고른 단위(하루 · 일주일 · 전체)와, 하루 단위에서 고른 요일(없으면 하루 평균)
  const [planUnit, setPlanUnit] = useState<PlanUnit>('day');
  const [planWeekday, setPlanWeekday] = useState<number | null>(null);
  const [growthEditingSubjectId, setGrowthEditingSubjectId] = useState<string | null>(null);
  const [stageEditForm, setStageEditForm] = useState<{
    subjectId: string;
    stageId: string;
    name: string;
    startPage: number;
    endPage: number;
    /** 단원 범위 글(`1~10, 20~30`). 비우면 단원 없음 */
    chapterText: string;
    reviewSubjectIds: string[];
    isNew: boolean;
    /** 후행과목만: 필수 여부와 "페이지"를 부르는 글자(비우면 본 과목의 글자) */
    isRequired: boolean;
    pageLabel: string;
  } | null>(null);
  // 아직 ✓를 누르지 않은 새 후행과목: 화면을 떠나면(✓·× 없이) 지운다. 최신 과목 목록과 고칠 함수를 ref로 들고 있는다.
  const pendingNewStageRef = useRef<{ subjectId: string; stageId: string } | null>(null);
  const latestRef = useRef({ subjects, onUpdateSubject });
  latestRef.current = { subjects, onUpdateSubject };
  useEffect(() => () => {
    const pending = pendingNewStageRef.current;
    if (!pending) return;
    const owner = latestRef.current.subjects.find(item => item.id === pending.subjectId);
    if (!owner || !(owner.followUpSubjects || []).some(stage => stage.id === pending.stageId)) return;
    latestRef.current.onUpdateSubject?.(withFreshPagePlan({ ...owner, followUpSubjects: (owner.followUpSubjects || []).filter(stage => stage.id !== pending.stageId) }));
  }, []);
  useEffect(() => { pendingNewStageRef.current = stageEditForm?.isNew ? { subjectId: stageEditForm.subjectId, stageId: stageEditForm.stageId } : null; }, [stageEditForm]);
  // 저장된 후행과목 지우기: 한 번 누르면 "정말 삭제", 두 번째에 지운다(브라우저 확인 창은 쓰지 않는다)
  const [confirmDeleteStageId, setConfirmDeleteStageId] = useState<string | null>(null);
  const [movingItemId, setMovingItemId] = useState<string | null>(null);
  // 항목 사이 띠: 어느 띠가 열려 있는지("폴더:자리"), 그리고 그 자리에 새 학습 계획을 쓰는 중인지
  const [openGapKey, setOpenGapKey] = useState<string | null>(null);
  const [gapPlan, setGapPlan] = useState<{ key: string; parentKey: string; index: number; siblings: SiblingRef[]; where: string } | null>(null);
  const [speedOpenFolderIds, setSpeedOpenFolderIds] = useState<Set<string>>(new Set());
  const [speedOpenSubjectIds, setSpeedOpenSubjectIds] = useState<Set<string>>(new Set());
  /** 전체 과목 목록에서 이름 왼쪽 ›를 눌러 그 과목(현재 과목 하나 / 복습과목 하나)의 값만 펼친 줄들 */
  const [valueOpenKeys, setValueOpenKeys] = useState<Set<string>>(new Set());
  const toggleValueRow = (key: string) => setValueOpenKeys(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
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

  useEffect(() => {
    if (!focusSubjectId) return undefined;
    const target = subjects.find(subject => subject.id === focusSubjectId);
    if (!target) return undefined;
    const chain = new Set<string>();
    (target.tagIds || []).forEach(tagId => {
      let current: string | undefined = tagId;
      while (current && !chain.has(current)) {
        chain.add(current);
        current = tagDefinitions.find(tag => tag.id === current)?.parentId;
      }
    });
    if (chain.size > 0) setExpandedFolderIds(previous => new Set([...Array.from(previous), ...Array.from(chain)]));
    const timer = window.setTimeout(() => {
      const card = Array.from(document.querySelectorAll('[data-subject-id]')).find(node => node.getAttribute('data-subject-id') === focusSubjectId);
      card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSubjectId]);

  const toggleSubjectReviewList = (id: string) => {
    const next = new Set(expandedSubjectReviewIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedSubjectReviewIds(next);
  };

  // 단계 연필(✎) 안에서 새 복습과목 만들기: 이름 · 시작/끝 페이지 · 단원 범위 · 단위 이름. 마감일은 그 과목을 따른다(복습과목은 원래 과목의 마감일을 물려받는다).
  const [newReviewForm, setNewReviewForm] = useState<{ name: string; startPage: number; endPage: number; chapterText: string; pageLabel: string } | null>(null);
  const createReviewSubjectInline = (owner: Subject) => {
    if (!newReviewForm || !stageEditForm) return;
    const chapterParse = parseChapterText(newReviewForm.chapterText);
    if (chapterParse.error) return;
    const name = newReviewForm.name.trim() || `${owner.name} 복습`;
    const created = createNewStudyPlan(name, newReviewForm.startPage, newReviewForm.endPage, owner.targetDate, false, [], 0,
      newReviewForm.pageLabel.trim() || DEFAULT_PAGE_LABEL, chapterParse.chapters);
    onAddSubject?.({ ...created, tagIds: owner.tagIds, scheduledWeekdayPages: {} });
    // "만들고 넣기"는 바로 그 단계의 복습과목으로 붙인다(✓를 누르지 않고 닫아도 떠도는 과목이 남지 않게)
    const stageId = stageEditForm.stageId;
    onUpdateSubject?.(stageId === owner.id
      ? { ...owner, reviewSubjectIds: [...(owner.reviewSubjectIds || []), created.id] }
      : { ...owner, followUpSubjects: (owner.followUpSubjects || []).map(item => item.id === stageId ? { ...item, reviewSubjectIds: [...(item.reviewSubjectIds || []), created.id] } : item) });
    setStageEditForm(current => current ? { ...current, reviewSubjectIds: [...current.reviewSubjectIds, created.id] } : current);
    setNewReviewForm(null);
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
      const weekdayPagePlan = getWeekdayPagePlan({ ...sub, targetDate: effectiveTargetDate }, planningRemaining, diffDays);
      const rawCarryoverPages = getPastCarryoverPages(sub, logs, activeStudyDate, todayDateKey);
      const carryoverPaidPages = Math.min(rawCarryoverPages, activeDayCompletedPages);
      const deadlinePlan = getPlanningDayCount(diffDays) < 7
        ? getSubjectDayRemainingPages({ ...sub, targetDate: effectiveTargetDate }, logs, activeWeekday, activeStudyDate)
        : null;
      const carryoverPages = deadlinePlan?.carryoverPages ?? Math.min(remaining, Math.max(0, rawCarryoverPages - carryoverPaidPages));
      const activeDayPagesAfterCarryover = Math.max(0, activeDayCompletedPages - carryoverPaidPages);
      const recommendedDailyPages = deadlinePlan?.remainingDayPages ?? Math.min(
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

  // 후행과목을 넣고 빼고 고치면 계획을 다시 세운다: 단계별 계획 시간(공부 + 복습)을 다시 적고 하루 시간이 고르게 나눈다
  const withFreshPagePlan = (subject: Subject): Subject => {
    const planned = withPlanTimes(subjects, logs, subject);
    return {
      ...planned,
      planStageId: currentPlanStageId(planned),
      scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
        planned,
        getSubjectRemainingPageCount(planned),
        getDiffDays(planned.targetDate)
      )
    };
  };

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
      isRequired: subject.isRequired ?? false
    });
  };

  const openInlineStageEditor = (subject: Subject, stage: SubjectStage, isNew = false) => {
    // 다른 단계를 열면, ✓ 없이 남은 새 후행과목은 지운다
    if (stageEditForm?.isNew && stageEditForm.stageId !== stage.id) {
      const owner = subjects.find(item => item.id === stageEditForm.subjectId);
      if (owner) onUpdateSubject?.(withFreshPagePlan({ ...owner, followUpSubjects: (owner.followUpSubjects || []).filter(item => item.id !== stageEditForm.stageId) }));
    }
    setConfirmDeleteStageId(null);
    setEditingId(null);
    setEditForm(null);
    setFolderEditForm(null);
    setNewReviewForm(null);
    setStageEditForm({
      subjectId: subject.id,
      stageId: stage.id,
      name: stage.name,
      startPage: stage.startPage,
      endPage: stage.endPage,
      chapterText: formatChapters(getStageChapters(subject, stage)),
      reviewSubjectIds: [...stage.reviewSubjectIds],
      isNew,
      isRequired: stage.isFollowUp
        ? ((subject.followUpSubjects || []).find(item => item.id === stage.id)?.isRequired ?? subject.isRequired ?? false)
        : subject.isRequired ?? false,
      pageLabel: stage.isFollowUp ? (subject.followUpSubjects || []).find(item => item.id === stage.id)?.pageLabel ?? '' : ''
    });
  };

  const saveInlineStageEditor = (subject: Subject) => {
    if (!stageEditForm || stageEditForm.subjectId !== subject.id) return;
    const chapterParse = parseChapterText(stageEditForm.chapterText);
    if (chapterParse.error) return;
    const chapters = chapterParse.chapters;
    // 단원을 정했으면 시작·끝 페이지는 첫 단원 시작과 마지막 단원 끝이다
    const startPage = chapters.length > 0 ? chapters[0].startPage : Math.max(1, Math.round(Number(stageEditForm.startPage) || 1));
    const endPage = chapters.length > 0 ? chapters[chapters.length - 1].endPage : Math.max(startPage, Math.round(Number(stageEditForm.endPage) || startPage));
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
          chapters: chapters.length > 0 ? chapters : undefined,
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
                  reviewSubjectIds,
                  chapters: chapters.length > 0 ? chapters : undefined,
                  isRequired: stageEditForm.isRequired,
                  pageLabel: stageEditForm.pageLabel.trim() ? normalizePageLabel(stageEditForm.pageLabel) : undefined
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

  const deleteFollowUpStage = (subject: Subject, stageId: string) => {
    onUpdateSubject?.(withFreshPagePlan({ ...subject, followUpSubjects: (subject.followUpSubjects || []).filter(stage => stage.id !== stageId) }));
    setConfirmDeleteStageId(null);
    setStageEditForm(null);
  };

  const addFollowUpSubject = (subject: Subject) => {
    // ✓를 누르지 않은 새 후행과목이 이미 열려 있으면 하나 더 만들지 않는다(두 번 누르면 두 개가 생기던 일)
    if (stageEditForm?.isNew && stageEditForm.subjectId === subject.id) {
      setExpandedSubjectReviewIds(current => new Set(current).add(subject.id));
      return;
    }
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
      pageCount: 100,
      completedCount: 0,
      chapter: null,
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

  // 과목마다: 속도 증가(25분마다의 속도) · 가속도 · 완료 예측, 그리고 요일별 필요 시간
  const speedBySubject = useMemo(() => {
    const next: Record<string, ReturnType<typeof analyzeSubjectSpeed>> = {};
    visibleSubjectStats.forEach(stat => {
      const original = subjects.find(subject => subject.id === stat.id);
      if (original) next[stat.id] = analyzeSubjectSpeed(subjects, logs, original);
    });
    return next;
  }, [subjects, logs, visibleSubjectStats]);
  // 요일별 필요 시간(과목 카드 · 위쪽 요약이 쓰는 값). 과목 카드는 "현재 단계 + 그 복습과목들"을 한 덩어리로 보므로
  // combined(= weekNeedBySubject)에는 복습과목의 요일별 필요량이 더해져 있다. 복습과목은 현재 단계의 것뿐 아니라,
  // 이미 끝난 단계(이전 과목)에서 아직 남은 것도 포함한다(현재 과목이 끝나도 그 복습은 계속된다).
  // own은 현재 단계만, reviews는 복습과목마다 따로(전체 과목 목록의 › 로 보는 값).
  const weekNeed = useMemo(() => {
    const plan = buildWeekPlan(subjects, logs);
    const todayWeekday = new Date().getDay();
    const toDays = (cells: Record<number, WeekCell>) => WEEKDAYS.map(day => ({ weekday: day.id, label: day.label, minutes: cells[day.id]?.minutes || 0, pages: cells[day.id]?.pages || 0, isToday: day.id === todayWeekday }));
    const combined: Record<string, ReturnType<typeof toDays>> = {};
    const own: Record<string, ReturnType<typeof toDays>> = {};
    const reviews: Record<string, ReturnType<typeof toDays>> = {};
    /** 시간을 나눠 가지는 몫(카드의 "현재 과목 · 복습과목" 비율 막대): 현재 단계, 그리고 복습과목들 */
    const parts: Record<string, Array<{ id: string; name: string; kind: 'current' | 'review' | 'basic'; days: ReturnType<typeof toDays> }>> = {};
    const collectReviewCells = (subject: Subject, parentEfficiency: number, studyCells?: Record<number, WeekCell>) => {
      const working: Array<{ id: string; name: string; cells: Record<number, WeekCell>; basic?: boolean }> = [];
      const stages = getSubjectStages(subject);
      const currentStage = stages.find(stage => stage.status === 'current');
      // 지금 단계의 복습(기본 복습 · 복습과목)은 직접 할당하지 않고 계획한 공부 페이지를 따라온다(31일 요청): 공부 페이지 × 복습 시간
      const derived = studyCells ? buildPlanReviewCells(subjects, logs, subject, studyCells) : null;
      if (derived?.basic) working.push({ id: `${subject.id}:basic`, name: '기본 복습', cells: derived.basic, basic: true });
      // 같은 복습과목이 여러 단계(본 과목 · 후행과목)에 붙어 있어도 그 복습은 하나다: 한 번만 센다
      const counted = new Set<string>();
      stages.forEach(stage => stage.reviewSubjectIds.forEach(reviewId => {
        const review = subjects.find(item => item.id === reviewId);
        if (!review || counted.has(reviewId)) return;
        const finished = stage.status === 'completed';
        if (finished && getSubjectRemainingPageCount(review) <= 0) return;
        // 지금 단계 복습과목은 공부를 따라온 몫, 끝난 단계에서 남은 복습과목은 전처럼 남은 양을 마감까지 나눈 몫
        const cells = (stage.id === currentStage?.id && derived?.reviews.find(item => item.id === reviewId)?.cells)
          || buildReviewWeekCells(logs, subject, review, parentEfficiency);
        reviews[`${subject.id}:${reviewId}`] = toDays(cells);
        if (finished || stage.id === currentStage?.id) { counted.add(reviewId); working.push({ id: reviewId, name: review.name, cells }); }
      }));
      return working;
    };
    const reviewParts = (working: ReturnType<typeof collectReviewCells>) => working.map(item => ({ id: item.id, name: item.name, kind: (item.basic ? 'basic' : 'review') as 'basic' | 'review', days: toDays(item.cells) }));
    plan.rows.forEach(row => {
      const working = collectReviewCells(row.subject, row.efficiency, row.cells);
      const currentStage = getSubjectStages(row.subject).find(stage => stage.status === 'current');
      own[row.subject.id] = toDays(row.cells);
      combined[row.subject.id] = toDays(mergeWeekCells([row.cells, ...working.map(item => item.cells)]));
      parts[row.subject.id] = [{ id: currentStage?.id || row.subject.id, name: currentStage?.name || row.subject.name, kind: 'current', days: own[row.subject.id] }, ...reviewParts(working)];
    });
    // 모든 단계를 끝낸 과목: 남은 복습만 계속 한다
    const planned = new Set(plan.rows.map(row => row.subject.id));
    subjects.filter(subject => !planned.has(subject.id)).forEach(subject => {
      const working = collectReviewCells(subject, subject.initialAverageTimePerPage || 0);
      if (working.length === 0) return;
      own[subject.id] = toDays(mergeWeekCells([]));
      combined[subject.id] = toDays(mergeWeekCells(working.map(item => item.cells)));
      parts[subject.id] = reviewParts(working);
    });
    return { combined, own, reviews, parts };
  }, [subjects, logs]);
  const weekNeedBySubject = weekNeed.combined;
  const averageOf = (days: Array<{ minutes: number; pages: number }>, key: 'minutes' | 'pages') => days.reduce((sum, day) => sum + day[key], 0) / 7;
  // 하루 평균 시간 = 한 주(요일별 필요 시간)를 7로 나눈 값. 오늘이 무슨 요일이어도 같아서 비율이 흔들리지 않는다.
  const dailyAverageMinutes = (subjectId: string) => averageOf(weekNeedBySubject[subjectId] || [], 'minutes');
  const emptyWeek = WEEKDAYS.map(day => ({ weekday: day.id, label: day.label, minutes: 0, pages: 0, isToday: false }));

  /** 전체 과목 목록에서 › 로 펼치는 "그 과목 하나만의 값": 요일별 필요 시간 · 하루 평균 · 전체 효율 · 속도 증가율 · 가속도 · 그래프 (과목 카드와 같은 모양) */
  const renderValueBlock = (key: string, pageLabel: string, days: Array<{ weekday: number; label: string; minutes: number; pages: number; isToday: boolean }>, unit: SpeedUnit | undefined, fallbackEfficiency: number, basicReview?: { subjectName: string; unit: SpeedUnit }) => {
    const efficiency = unit?.efficiency ?? (fallbackEfficiency > 0 ? fallbackEfficiency : null);
    const reviewEfficiency = basicReview?.unit.efficiency ?? null;
    return (
      <div data-testid="row-values" data-row-key={key} className="mt-3 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className={`grid gap-2 ${basicReview ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          <StatBox label="하루 평균 시간" value={formatTime(averageOf(days, 'minutes'))} unit="" color="text-indigo-600" />
          <StatBox label="하루 평균 페이지" value={formatPageValue(Math.round(averageOf(days, 'pages') * 10) / 10)} unit={pageLabel} color="text-amber-500" />
          <StatBox label={basicReview ? '해당 과목 전체 효율' : '전체 효율'} value={efficiency ? efficiency.toFixed(1) : '-'} unit={efficiency ? `m/${pagePositionLabel(pageLabel)}` : ''} color="text-emerald-500" />
          {basicReview && (
            <div data-testid="basic-review-efficiency" className="contents">
              <StatBox label="기본복습 전체 효율" value={reviewEfficiency ? reviewEfficiency.toFixed(1) : '-'} unit={reviewEfficiency ? `m/${pagePositionLabel(pageLabel)}` : ''} color="text-rose-500" />
            </div>
          )}
        </div>
        {unit && <SpeedFacts series={unit.series} label={pageLabel} />}
        {unit && basicReview ? (
          <div data-testid="own-basic-speed" className="flex flex-col gap-2">
            <FolderSpeedChart
              title="속도 증가 합계 · 해당 과목 + 기본복습"
              subjectLabel="해당 과목과 기본복습"
              label={pageLabel}
              total={buildGroupSpeed({ id: `${key}-total`, name: '해당 과목 + 기본복습', isFolder: false }, [unit.series, basicReview.unit.series])}
              items={[
                { ...buildGroupSpeed({ id: `${key}-own`, name: basicReview.subjectName, isFolder: false }, [unit.series]), colorIndex: 0 },
                { ...buildGroupSpeed({ id: `${key}-basic`, name: '기본복습', isFolder: false }, [basicReview.unit.series]), colorIndex: 1 }
              ]}
            />
          </div>
        ) : unit && <SpeedGainChart series={unit.series} label={pageLabel} />}
      </div>
    );
  };

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

  /** 이 폴더와 그 안(아래 단계 모두)의 폴더 id */
  const folderSubtreeIds = (rootId: string) => {
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      tagDefinitions.forEach(tag => {
        if (tag.parentId && ids.has(tag.parentId) && !ids.has(tag.id)) { ids.add(tag.id); grew = true; }
      });
    }
    return ids;
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
      subjectIds: uniqueSubjs.map(subject => subject.id),
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
    // 반올림을 먼저 해야 119.7분이 "1h 60m"이 아니라 "2h 0m"이 된다
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const getSubjectDisplayName = (subject: Subject) => {
    const stages = getSubjectStages(subject);
    return (stages.find(stage => stage.status === 'current') || stages[stages.length - 1])?.name || subject.name;
  };

  // 위쪽 요약에서 고른 단위(하루 · 일주일 · 전체, 하루에서는 요일)는 맨 위 요약과 그 아래 폴더 · 과목 카드에 모두 적용된다.
  //  - 하루: 요일별 필요 시간을 7로 나눈 하루 평균(요일을 고르면 그 요일의 시간)
  //  - 일주일: 요일별 필요 시간의 합
  //  - 전체: 지금 속도와 가속도로 예측한 남은 전체 시간(현재 과목 + 후행과목 + 복습과목)
  const summaryWeekday = planUnit === 'day' ? planWeekday : null;
  const unitWords = describePlanUnit(planUnit, WEEKDAYS.find(day => day.id === summaryWeekday)?.label);
  const subjectShareMinutes = (subjectId: string, weekday: number | null) => (
    weekday === null ? dailyAverageMinutes(subjectId) : (weekNeedBySubject[subjectId] || []).find(day => day.weekday === weekday)?.minutes || 0
  );
  const unitMinutes = (subjectId: string, unit: PlanUnit, weekday: number | null) => {
    if (unit === 'all') return speedBySubject[subjectId]?.totalMinutes || 0;
    if (unit === 'week') return (weekNeedBySubject[subjectId] || []).reduce((sum, day) => sum + day.minutes, 0);
    return subjectShareMinutes(subjectId, weekday);
  };
  /** 과목 하나의 요일별 칸(분 · 페이지)에서 고른 단위의 값. 전체는 예측에서 따로 받는다 */
  const unitDaysValue = (days: Array<{ weekday: number; minutes: number; pages: number }>, key: 'minutes' | 'pages') => (
    planUnit === 'week' ? days.reduce((sum, day) => sum + day[key], 0)
      : summaryWeekday !== null ? days.find(day => day.weekday === summaryWeekday)?.[key] || 0
        : days.reduce((sum, day) => sum + day[key], 0) / 7
  );
  /** 과목 하나의 속도 증가율(고른 단위). 속도를 아직 못 쟀으면 null */
  const unitGrowthOfSubject = (subjectId: string) => {
    const series = speedBySubject[subjectId]?.series;
    return series ? unitGrowthOf(series, planUnit, summaryWeekday) : null;
  };
  /** 같은 단위로 본 과목 하나의 공부량 증가(분/P) */
  const unitAmountOfSubject = (subjectId: string) => {
    const series = speedBySubject[subjectId]?.series;
    return series ? unitAmountGrowthOf(series, planUnit, summaryWeekday) : null;
  };

  // 폴더 안의 폴더·과목이 고른 단위의 시간에서 차지하는 몫. 순서는 화면에 나오는 순서와 같다(항목 순서는 단위와 상관없어 색이 안 바뀐다).
  const getChildShareItems = (folderId: string, unit: PlanUnit = 'day', weekday: number | null = null) => orderSiblings([
    ...tagDefinitions.filter(tag => tag.parentId === folderId).map(tag => ({
      listOrder: tag.listOrder, id: tag.id, name: tag.name, minutes: getRecursiveData(tag.id).subjectIds.reduce((sum, id) => sum + unitMinutes(id, unit, weekday), 0), isFolder: true
    })),
    ...visibleSubjectStats.filter(stat => stat.tagIds?.includes(folderId)).map(stat => ({
      listOrder: stat.listOrder, id: stat.id, name: getSubjectDisplayName(stat), minutes: unitMinutes(stat.id, unit, weekday), isFolder: false
    }))
  ], folderId);

  // 폴더 안의 폴더·과목(바로 아래 것만)마다 페이지 위치에 따른 속도 증가 선 하나. 색은 시간 비율 막대와 같은 순서다.
  // 목록에 나오는 속도 증가율(latestGrowth)은 고른 단위의 값이다: 안에 든 과목들의 단위당 증가율을 더한 것.
  const getChildSpeedGroups = (folderId: string) => getChildShareItems(folderId).map((item, colorIndex) => {
    const memberIds = (item.isFolder ? getRecursiveData(item.id).subjectIds : [item.id]).filter(id => speedBySubject[id]);
    const growths = memberIds.map(unitGrowthOfSubject).filter((value): value is number => value !== null);
    return {
      ...buildGroupSpeed({ id: item.id, name: item.name, isFolder: !!item.isFolder }, memberIds.map(id => speedBySubject[id].series)),
      latestGrowth: growths.length > 0 ? growths.reduce((sum, value) => sum + value, 0) : null,
      latestAmountGrowth: sumOf(memberIds.map(unitAmountOfSubject)),
      colorIndex
    };
  });

  // 맨 위 요약: 고른 단위의 시간 / 속도 증가율 / 맨 위 폴더·과목의 몫
  const topShareItems = orderSiblings([
    ...tagDefinitions.filter(tag => tag.parentId === undefined).map(tag => ({
      listOrder: tag.listOrder, id: tag.id, name: tag.name, isFolder: true,
      minutes: getRecursiveData(tag.id).subjectIds.reduce((sum, id) => sum + unitMinutes(id, planUnit, summaryWeekday), 0)
    })),
    ...visibleSubjectStats.filter(stat => !stat.tagIds || stat.tagIds.length === 0).map(stat => ({
      listOrder: stat.listOrder, id: stat.id, name: getSubjectDisplayName(stat), isFolder: false, minutes: unitMinutes(stat.id, planUnit, summaryWeekday)
    }))
  ], 'root');
  const summaryDays = WEEKDAYS.map(day => ({
    weekday: day.id, label: day.label, isToday: day.id === new Date().getDay(),
    minutes: visibleSubjectStats.reduce((sum, stat) => sum + subjectShareMinutes(stat.id, day.id), 0)
  }));
  const summaryMinutes = visibleSubjectStats.reduce((sum, stat) => sum + unitMinutes(stat.id, planUnit, summaryWeekday), 0);
  const summaryGrowth = summarizeUnitGrowth(
    visibleSubjectStats.map(stat => speedBySubject[stat.id]?.series).filter((series): series is NonNullable<typeof series> => Boolean(series)),
    planUnit, summaryWeekday
  );
  const summaryAmount = summarizeUnitAmount(
    visibleSubjectStats.map(stat => speedBySubject[stat.id]?.series).filter((series): series is NonNullable<typeof series> => Boolean(series)),
    planUnit, summaryWeekday
  );

  const applySiblingOrder = (ordered: Array<SiblingRef & { listOrder: ListOrder }>, extraTags: TagDefinition[] = []) => {
    const orderOf = new Map(ordered.map(item => [item.id, item.listOrder]));
    onUpdateTags?.([
      ...tagDefinitions.map(tag => (orderOf.has(tag.id) ? { ...tag, listOrder: orderOf.get(tag.id) } : tag)),
      ...extraTags.map(tag => ({ ...tag, listOrder: orderOf.get(tag.id) }))
    ]);
    const siblingSubjects = subjects
      .filter(subject => ordered.some(item => item.kind === 'subject' && item.id === subject.id))
      .map(subject => ({ ...subject, listOrder: orderOf.get(subject.id) }));
    if (siblingSubjects.length > 0) {
      if (onUpdateSubjects) onUpdateSubjects(siblingSubjects);
      else siblingSubjects.forEach(subject => onUpdateSubject?.(subject));
    }
  };

  // 두 항목 사이에 새 분석 그룹(폴더)을 만든다
  const addFolderAt = (parentKey: string, siblings: SiblingRef[], index: number) => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newFolder: TagDefinition = {
      id: newId, name: '새 폴더', color: COLORS[tagDefinitions.length % COLORS.length], isVisible: true,
      parentId: parentKey === 'root' ? undefined : parentKey
    };
    applySiblingOrder(insertSiblingOrder(siblings, index, parentKey, { kind: 'folder', id: newId }), [newFolder]);
    setOpenGapKey(null);
    setEditingId(newId);
    setFolderEditForm({ id: newId, name: newFolder.name, scheduledWeekdays: weekdayIds });
  };

  // 두 항목 사이에 새 학습 계획을 만든다(그 자리의 폼에서 등록하면 들어간다)
  const addPlanAt = (subject: Subject) => {
    if (!gapPlan) { onAddSubject?.(subject); return; }
    const ordered = insertSiblingOrder(gapPlan.siblings, gapPlan.index, gapPlan.parentKey, { kind: 'subject', id: subject.id });
    const own = ordered.find(item => item.id === subject.id)!;
    onAddSubject?.({ ...subject, tagIds: gapPlan.parentKey === 'root' ? subject.tagIds : [gapPlan.parentKey], listOrder: own.listOrder });
    applySiblingOrder(ordered.filter(item => item.id !== subject.id));
    setGapPlan(null);
    setOpenGapKey(null);
  };

  const RenderTree = ({ parentId, depth = 0 }: { parentId?: string, depth?: number }) => {
    const folders = tagDefinitions
      .filter(f => f.parentId === parentId);
    const subjs = visibleSubjectStats.filter(s =>
      subjectMatchesWeekdayView(s)
      && (parentId ? s.tagIds?.includes(parentId) : (!s.tagIds || s.tagIds.length === 0))
    );

    const parentKey = parentId || 'root';
    const folderEntries = folders.map(folder => {
          const stats = getRecursiveData(folder.id);
          const isExpanded = expandedFolderIds.has(folder.id);
          const isMoving = movingItemId === folder.id;
          const progressPercent = stats.totalPages > 0 ? Math.round((stats.completedPages / stats.totalPages) * 100) : 0;
          const folderWeekdays = getFolderWeekdaySelection(folder.id);
          const activeFolderEdit = folderEditForm?.id === folder.id
            ? folderEditForm
            : { id: folder.id, name: folder.name, scheduledWeekdays: folderWeekdays };

          return { kind: 'folder' as const, id: folder.id, name: folder.name, listOrder: folder.listOrder, node: (
            <div key={folder.id} className="relative group/folder">
              <div className={`flex flex-col gap-4 p-4 md:p-5 rounded-2xl transition-all border shadow-sm ${isExpanded ? 'bg-indigo-950 border-indigo-800 text-white' : 'bg-white border-slate-200 hover:border-indigo-400'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <button onClick={() => toggleFolder(folder.id)} className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all ${isExpanded ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
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
                            className={`rounded-lg px-3 py-2 text-xs font-black transition-all ${
                              isExpanded ? 'bg-white text-indigo-700' : 'bg-slate-900 text-white'
                            }`}
                          >
                            완료
                          </button>
                        </div>
                      ) : (
                        <h4 onClick={() => toggleFolder(folder.id)} className="truncate text-xl font-black cursor-pointer hover:underline">{folder.name}</h4>
                      )}
                      <p className={`text-sm font-bold mt-1 ${isExpanded ? 'text-indigo-300' : 'text-slate-500'}`}>{stats.count}개 과목</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 relative z-30">
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMovingItemId(isMoving ? null : folder.id); }} onMouseDown={e => e.stopPropagation()} className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all cursor-pointer ${isMoving ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-indigo-600'}`}>🔄</button>
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditingFolder(folder); }} onMouseDown={e => e.stopPropagation()} className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:text-emerald-600 transition-all cursor-pointer">✎</button>
                    <button 
                        onClick={(e) => { 
                            e.preventDefault();
                            e.stopPropagation();
                            if (onDeleteFolder) onDeleteFolder(folder.id);
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                    >
                        ✕
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                   <StatBox label={unitWords.time} value={formatTime(stats.subjectIds.reduce((sum, id) => sum + unitMinutes(id, planUnit, summaryWeekday), 0))} unit="" color="text-indigo-300" isDark={isExpanded} large />
                   <div className="flex min-w-0 flex-col gap-2">
                     <p className={`text-xs xl:text-[13px] font-bold ${isExpanded ? 'text-indigo-300' : 'text-slate-500'}`}>{unitWords.share}</p>
                     <ShareBar items={getChildShareItems(folder.id, planUnit, summaryWeekday)} dark={isExpanded} title={unitWords.share} emptyNote={unitWords.emptyShare} />
                   </div>
                </div>

                {(() => {
                  const groups = getChildSpeedGroups(folder.id);
                  const total = buildGroupSpeed({ id: folder.id, name: `${folder.name} 합계`, isFolder: true }, stats.subjectIds.filter(id => speedBySubject[id]).map(id => speedBySubject[id].series));
                  const summary = summarizeFolderSpeed(groups.map(group => group.latestGrowth));
                  const speedOpen = speedOpenFolderIds.has(folder.id);
                  const label = isExpanded ? 'text-indigo-300' : 'text-slate-500';
                  return (
                    <div data-testid="folder-speed" className={`rounded-xl border ${isExpanded ? 'border-white/15 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
                      <button type="button" aria-expanded={speedOpen} aria-label={`${folder.name} 속도 증가 그래프 ${speedOpen ? '접기' : '펼치기'}`}
                        onClick={() => setSpeedOpenFolderIds(current => { const next = new Set(current); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left">
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                          <div className="min-w-0">
                            <p className={`truncate text-xs xl:text-[13px] font-bold ${label}`}>{`속도 증가율 합계 · ${unitWords.scope}`}</p>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <p data-testid="folder-speed-total" className={`truncate font-mono text-2xl font-black leading-tight tabular-nums ${isExpanded ? 'text-white' : 'text-indigo-700'}`}>
                                {summary.measured > 0 ? describeSpeedGrowth(summary.total) : '측정 필요'}
                              </p>
                              {summary.measured > 0 && <GrowthAmount value={sumOf(groups.map(group => group.latestAmountGrowth))} testId="folder-speed-amount" className={isExpanded ? 'text-indigo-200' : 'text-slate-600'} />}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <p className={`text-xs xl:text-[13px] font-bold ${label}`}>편차 · {summary.measured}개 항목</p>
                            <p data-testid="folder-speed-spread" className={`truncate font-mono text-2xl font-black leading-tight tabular-nums ${isExpanded ? 'text-white' : 'text-slate-800'}`}>
                              {summary.measured > 0 ? `±${summary.spread.toFixed(1)}P/h` : '-'}
                            </p>
                          </div>
                        </div>
                        <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl font-black transition-transform ${speedOpen ? 'rotate-90' : ''} ${isExpanded ? 'bg-indigo-500 text-white' : 'bg-indigo-600 text-white'}`}>›</span>
                      </button>
                      {speedOpen && (
                        <div data-testid="folder-speed-detail" className={`flex flex-col gap-3 border-t px-4 pb-4 pt-3 ${isExpanded ? 'border-white/15' : 'border-slate-200'}`}>
                          <FolderSpeedChart total={total} items={groups} dark={isExpanded} />
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div data-testid="folder-progress" className="space-y-2">
                   <div className="flex justify-between items-end">
                      <p className={`text-sm font-bold ${isExpanded ? 'text-indigo-200' : 'text-slate-500'}`}>전체 진행률</p>
                      <p className={`text-sm font-bold ${isExpanded ? 'text-white/60' : 'text-slate-400'}`}>{stats.completedPages} / {stats.totalPages} P</p>
                   </div>
                   <ProgressBar percent={progressPercent} dark={isExpanded} label={`${folder.name} 전체 진행률`} />
                </div>

                {isMoving && (
                  <div className="mt-2 bg-white/5 p-3 rounded-2xl border border-white/10 animate-fade-in relative z-30">
                    <p className="text-xs font-black text-indigo-400 uppercase mb-2 px-1">📂 이동할 폴더</p>
                    <div className="flex flex-wrap gap-2">
                       <button onClick={(e) => { e.stopPropagation(); onUpdateTags?.(tagDefinitions.map(t => t.id === folder.id ? {...t, parentId: undefined} : t)); setMovingItemId(null); }} className="px-4 py-2 bg-white text-slate-900 rounded-xl font-black text-xs shadow-sm hover:bg-indigo-600 hover:text-white transition-all">최상위</button>
                       {/* 자기 자신과 그 안의 폴더로는 옮길 수 없다(옮기면 서로가 서로를 품어 둘 다 목록에서 사라진다) */}
                       {tagDefinitions.filter(t => !folderSubtreeIds(folder.id).has(t.id)).map(t => (
                         <button key={t.id} onClick={(e) => { e.stopPropagation(); onUpdateTags?.(tagDefinitions.map(tg => tg.id === folder.id ? {...tg, parentId: t.id} : tg)); setMovingItemId(null); }} className="px-4 py-2 bg-white text-slate-900 rounded-xl font-black text-xs shadow-sm hover:bg-indigo-600 hover:text-white transition-all">📂 {t.name}</button>
                       ))}
                    </div>
                  </div>
                )}
              </div>
              {isExpanded && RenderTree({ parentId: folder.id, depth: depth + 1 })}
            </div>
          ) };
        });

    const subjectEntries = subjs.map(sub => {
          const isEditing = editingId === sub.id;
          const combinedTotalPages = getSubjectTotalPageCount(sub);
          const combinedCompletedPages = getSubjectCompletedPageCount(sub);
          const subjectStages = getSubjectStages(sub);
          const remainingStages = subjectStages.filter(stage => stage.status !== 'completed');
          const activeStage = getActiveSubjectStage(sub);
          const displayStage = activeStage || subjectStages[subjectStages.length - 1];
          // 단원이 있으면 진척도는 지금 단원 기준이다(단원을 끝내고 다음 단원으로 넘어가면 값이 바뀐다)
          const activeChapter = activeStage?.chapter ?? null;
          const activeStagePageCount = activeChapter
            ? activeChapter.pageCount
            : activeStage
            ? Math.max(0, activeStage.endPage - activeStage.startPage + 1)
            : combinedTotalPages;
          const activeStageCompletedPages = activeChapter
            ? activeChapter.completedCount
            : activeStage
            ? Math.min(
                activeStagePageCount,
                Math.max(0, activeStage.completedPage - activeStage.startPage + 1)
              )
            : combinedCompletedPages;
          const progressPercent = activeStagePageCount > 0
            ? Math.round((activeStageCompletedPages / activeStagePageCount) * 100)
            : 0;
          const isReviewListExpanded = expandedSubjectReviewIds.has(sub.id);
          const speedOfSubject = speedBySubject[sub.id];
          // 현재 풀고 있는 단계에 붙은 복습과목 이름들(카드 제목에 [+ ...]로 붙는다)
          const titleReviewNames = (activeStage?.reviewSubjectIds || [])
            .map(id => subjects.find(item => item.id === id)?.name)
            .filter((name): name is string => Boolean(name));
          const stageSchedule = estimateStageSchedule(sub);
          return { kind: 'subject' as const, id: sub.id, name: displayStage?.name || sub.name, listOrder: sub.listOrder, node: (
            <div key={sub.id} data-subject-id={sub.id} className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 transition-all group/subj relative overflow-hidden">
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
                      className={`mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-all ${
                        isReviewListExpanded
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
                      }`}
                    >
                      <span className={`text-sm transition-transform ${isReviewListExpanded ? 'rotate-90' : ''}`}>▶</span>
                    </button>
                  )}
                  <div className="w-11 h-11 bg-slate-50 rounded-xl flex items-center justify-center group-hover/subj:bg-indigo-600 group-hover/subj:text-white transition-all flex-shrink-0">
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
                         <h4 data-testid="subject-title" className={`min-w-0 text-lg md:text-xl font-black text-slate-900 ${titleReviewNames.length > 0 ? 'break-keep' : 'truncate'}`}>
                           {displayStage?.name || sub.name}
                           {titleReviewNames.length > 0 && (
                             <span data-testid="subject-title-reviews" className="ml-2 text-base font-black text-rose-500">[+{titleReviewNames.join(', ')}]</span>
                           )}
                         </h4>
                         <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${
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
                               className={`rounded-lg px-3 py-1 text-xs font-black transition-all ${
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
                               className={`rounded-lg px-3 py-1 text-xs font-black transition-all ${
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
                            <span className="text-xs font-black px-3 py-1 rounded-full bg-rose-100 text-rose-600">필수</span>
                          )}
                          <span className={`text-xs font-black px-3 py-1 rounded-full ${sub.diffDays > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>{/* 마감 전 D-n · 마감일 D-day · 지난 마감 D+n(예전에는 지난 뒤에도 D-0) */}{sub.diffDays > 0 ? `D-${sub.diffDays}` : sub.diffDays === 0 ? 'D-day' : `D+${-sub.diffDays}`}</span>
                          {sub.carryoverPages > 0 && (
                            <span className="text-xs font-black px-3 py-1 rounded-full bg-amber-100 text-amber-600">이월 {sub.carryoverPages}{getPageLabel(sub)}</span>
                          )}
                          
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
                                // 날짜 칸을 비우고 저장하면 마감일을 지우지 않고 원래 날짜를 둔다
                                targetDate: editForm.targetDate || sub.targetDate,
                                tagIds: editForm.tagIds,
                                isRequired: editForm.isRequired,
                              };
                              // 학습 요일 · 요일별 페이지는 수정 중에 한 주 필요 시간 밑에 나오는 칸에서 바로 고치므로 여기서는 그대로 둔다(마감일이 바뀌면 그 비율대로 페이지만 다시 나눈다)
                              // 아무것도 고치지 않고 저장하면 아무것도 바꾸지 않는다(30일): 계획 · 계획 시작일 · 저장된 과목 모두 그대로
                              const original = subjects.find(subject => subject.id === sub.id);
                              const unchanged = original && updatedSubject.name === original.name && updatedSubject.targetDate === original.targetDate
                                && Boolean(updatedSubject.isRequired) === Boolean(original.isRequired)
                                && JSON.stringify(updatedSubject.tagIds ?? []) === JSON.stringify(original.tagIds ?? [])
                                && JSON.stringify(updatedSubject.followUpSubjects ?? []) === JSON.stringify(original.followUpSubjects ?? []);
                              if (original && !unchanged) {
                                const { name, followUpSubjects, targetDate, tagIds, isRequired } = updatedSubject;
                                const next: Subject = { ...original, name, followUpSubjects, targetDate, tagIds, isRequired };
                                // 마감일이나 후행과목이 바뀌면 계획을 다시 세우는 것이라 단계별 계획 시간(공부 + 복습)도 새로 적는다
                                const replanned = next.targetDate !== original.targetDate || JSON.stringify(next.followUpSubjects || []) !== JSON.stringify(original.followUpSubjects || [])
                                  ? withPlanTimes(subjects, logs, next) : next;
                                onUpdateSubject?.({ ...replanned, scheduledWeekdayPages: resolveSavedWeekdayPages(original, replanned, null) });
                              }
                            }
                            setEditingId(null);
                            setEditForm(null);
                        }} 
                        className="w-11 h-11 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-all cursor-pointer active:scale-95"
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
                          className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all cursor-pointer"
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
                          className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:text-emerald-600 transition-all cursor-pointer"
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
                          className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                      >
                          ✕
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div data-testid="subject-need" className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                 {(() => {
                   // 하루 평균 시간에서 현재 과목과 복습과목들이 각각 차지하는 비율(복습과목이 없으면 100%라 그리지 않는다)
                   // 고른 단위(하루 평균 · 요일 · 일주일 · 전체 예상)의 시간으로 나눈다
                   const parts = (weekNeed.parts[sub.id] || []).map(part => ({
                     id: part.id, name: part.name,
                     minutes: planUnit === 'all' ? speedOfSubject?.forecast.find(item => item.id === part.id)?.minutes || 0 : unitDaysValue(part.days, 'minutes')
                   }));
                   if (parts.length < 2) return null;
                   return (
                     <div data-testid="subject-share" className="flex flex-col gap-2">
                       <p className="px-1 text-[13px] font-bold text-slate-500">{`현재 과목 · 복습과목 시간 비율 · ${unitWords.scope}`}</p>
                       <ShareBar items={parts} title={`현재 과목과 복습과목 ${unitWords.share}`} emptyNote={unitWords.emptyShare || '공부할 요일이 정해진 과목이 없어 비율이 없어요'} />
                     </div>
                   );
                 })()}
                 <WeekdayNeedBar days={weekNeedBySubject[sub.id] || emptyWeek} scheduledDays={(sub.scheduledWeekdays ?? []).length} />
                 {(() => {
                   // 과목 카드의 "수정"을 눌렀을 때만: 학습 요일을 켜고 끄고, 요일별 페이지를 페이지 값 옆의 작은 ▲▼로 1쪽씩 고친다(누르면 바로 적용)
                   const original = subjects.find(subject => subject.id === sub.id);
                   if (!isEditing || !original || !onUpdateSubject) return null;
                   // 계획은 시간으로 고친다(요일마다 그날 공부할 단계의 효율로 시간 ↔ 페이지). 효율을 모르는 요일만 1쪽씩
                   // 시간은 공부 + 복습(기본 복습 · 복습과목)을 합친 하루 시간이다. 고칠 때 단계별 계획 시간을 새로 적는다
                   const minutesPerPage = getWeekdayMinutesPerPage(subjects, logs, original);
                   const planned = withPlanTimes(subjects, logs, original);
                   return (
                     <WeekdayPagesEditor
                       days={WEEKDAYS} selected={normalizeWeekdays(original.scheduledWeekdays)}
                       pages={getWeekdayPagePlan(original, getSubjectRemainingPageCount(original), getDiffDays(original.targetDate))}
                       pageLabel={getPageLabel(sub)} step={getWeekdayPageStep(original)} minutesPerPage={minutesPerPage}
                       onToggle={dayId => onUpdateSubject(toggleStudyWeekday(planned, dayId))}
                       onStep={(dayId, direction) => onUpdateSubject(minutesPerPage[dayId] > 0
                         ? stepWeekdayMinutes(planned, dayId, direction, minutesPerPage)
                         : stepWeekdayPages(planned, dayId, direction, 1))}
                       onSetMinutes={(dayId, minutes) => onUpdateSubject(setWeekdayMinutes(planned, dayId, minutes, minutesPerPage))}
                     />
                   );
                 })()}
                 <div className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-2">
                    <StatBox label={unitWords.time} value={formatTime(planUnit === 'all' ? speedOfSubject?.totalMinutes || 0 : unitDaysValue(weekNeedBySubject[sub.id] || emptyWeek, 'minutes'))} unit="" color="text-indigo-600" />
                    <StatBox label={unitWords.pages} value={formatPageValue(Math.round((planUnit === 'all' ? (speedOfSubject?.forecast || []).reduce((sum, item) => sum + Math.max(0, item.remainingPages), 0) : unitDaysValue(weekNeedBySubject[sub.id] || emptyWeek, 'pages')) * 10) / 10)} unit={getPageLabel(sub)} color="text-amber-500" />
                    {(() => {
                      // 현재 단계와 복습과목들을 합친 최근 25분의 장당 타임어택 시간. 재 본 기록이 없으면 예전 값(처음 장당 시간)
                      const efficiency = speedOfSubject?.efficiency ?? (sub.stats.averageTimePerPage > 0 ? sub.stats.averageTimePerPage : null);
                      return <StatBox label="전체 효율" value={efficiency ? efficiency.toFixed(1) : '-'} unit={efficiency ? `m/${pagePositionLabel(getPageLabel(sub))}` : ''} color="text-emerald-500" />;
                    })()}
                 </div>
              </div>

              {!isEditing && speedBySubject[sub.id] && (() => {
                const speed = speedBySubject[sub.id];
                const pageLabel = getPageLabel(sub);
                const speedOpen = speedOpenSubjectIds.has(sub.id);
                return (
                  <div data-testid="subject-speed" className="rounded-2xl border border-slate-200 bg-slate-50">
                    <button type="button" aria-expanded={speedOpen} aria-label={`${displayStage?.name || sub.name} 속도 그래프와 예측 ${speedOpen ? '접기' : '펼치기'}`}
                      onClick={() => setSpeedOpenSubjectIds(current => { const next = new Set(current); if (next.has(sub.id)) next.delete(sub.id); else next.add(sub.id); return next; })}
                      className="flex w-full items-stretch gap-2 p-3 text-left">
                      <div className="min-w-0 flex-1"><SpeedFacts series={speed.series} label={pageLabel} growth={unitGrowthOfSubject(sub.id)} amount={unitAmountOfSubject(sub.id)} growthName={`속도 증가율 · ${unitWords.scope}`} /></div>
                      <span aria-hidden="true" className={`flex w-10 shrink-0 items-center justify-center self-stretch rounded-xl bg-indigo-600 text-xl font-black text-white transition-transform`}>
                        <span className={`transition-transform ${speedOpen ? 'rotate-90' : ''}`}>›</span>
                      </span>
                    </button>
                    {speedOpen && (
                      <div data-testid="subject-speed-detail" className="flex flex-col gap-4 border-t border-slate-200 p-3">
                        <SpeedGainChart series={speed.series} label={pageLabel} />
                        {(() => {
                          // 폴더처럼 항목마다 따로: 현재 과목과, 지금 하고 있는 복습과목 하나하나의 속도 증가율(최근 값)
                          const rows = (weekNeed.parts[sub.id] || []).filter(part => part.kind !== 'basic').map(part => ({
                            id: part.id, name: part.name, kind: part.kind,
                            growth: (() => { const series = (part.kind === 'current' ? speed.own : speed.reviews[part.id])?.series; return series ? unitGrowthOf(series, planUnit, summaryWeekday) : null; })(),
                            amount: (() => { const series = (part.kind === 'current' ? speed.own : speed.reviews[part.id])?.series; return series ? unitAmountGrowthOf(series, planUnit, summaryWeekday) : null; })()
                          }));
                          if (rows.length === 0) return null;
                          return (
                            <ul data-testid="subject-growth-list" className="grid gap-1 sm:grid-cols-2">
                              {rows.map(row => (
                                <li key={row.id} data-testid="subject-growth-row" data-kind={row.kind} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-[13px] font-bold text-slate-700">
                                  <span className={`shrink-0 text-[11px] font-black ${row.kind === 'current' ? 'text-indigo-600' : 'text-rose-500'}`}>{row.kind === 'current' ? '현재' : '복습'}</span>
                                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                  <span className={`shrink-0 font-mono tabular-nums ${row.growth === null ? 'opacity-60' : ''}`}>{describeSpeedGrowth(row.growth, pageLabel)}</span>
                                  <GrowthAmount value={row.amount} label={pageLabel} testId="subject-growth-amount" />
                                </li>
                              ))}
                            </ul>
                          );
                        })()}
                        <ForecastList items={speed.forecast} totalMinutes={speed.totalMinutes} label={pageLabel} />
                      </div>
                    )}
                  </div>
                );
              })()}

              <div data-testid="subject-progress" className="space-y-1.5 px-1">
                 <div className="flex justify-between items-end gap-3">
                    <p className="text-[13px] font-bold text-slate-500">
                      {activeStage
                        ? activeChapter
                          ? `학습 진척도 · ${activeStage.name} 단원 ${activeChapter.number}/${activeChapter.total} (${pagePositionLabel(getPageLabel(sub))}.${activeChapter.startPage}~${activeChapter.endPage})`
                          : `학습 진척도 · ${activeStage.name} (${pagePositionLabel(getPageLabel(sub))}.${activeStage.startPage}~${activeStage.endPage})`
                        : '학습 진척도 · 전체 완료'}
                    </p>
                    <p className="shrink-0 text-xl font-black text-slate-900">{activeStageCompletedPages} / {activeStagePageCount} <span className="text-sm text-slate-400 font-bold ml-0.5">{getPageLabel(sub)}</span></p>
                 </div>
                 <ProgressBar percent={progressPercent} label={`${displayStage?.name || sub.name} 학습 진척도`} />
              </div>

              {isEditing && (
                <div className="mt-2 bg-slate-900 p-4 rounded-2xl border border-slate-800 animate-in slide-in-from-top-4 relative z-30">
                  <div>
                  <div>
                    <p className="text-xs font-black text-slate-500 uppercase mb-3 px-1">폴더 이동</p>
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
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">전체 과목</p>
                    <span className="rounded-lg bg-white px-3 py-1 text-xs font-black text-slate-500">
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
                    // 단원이 있는 단계는 단원 사이 빈 페이지를 세지 않는다
                    const stageChapterList = getStageChapters(sub, stage);
                    const stageHasChapters = stageChapterList.length > 0;
                    const stagePageCount = stageHasChapters ? stage.pageCount : Math.max(0, stage.endPage - stage.startPage + 1);
                    const stageCompletedPages = stageHasChapters ? stage.completedCount : Math.min(
                      stagePageCount,
                      Math.max(0, stage.completedPage - stage.startPage + 1)
                    );
                    const stageProgress = stagePageCount > 0
                      ? Math.round((stageCompletedPages / stagePageCount) * 100)
                      : 0;
                    const editChapterParse = isInlineEditing && stageEditForm
                      ? parseChapterText(stageEditForm.chapterText) : null;
                    const editHasChapters = Boolean(editChapterParse && editChapterParse.chapters.length > 0);
                    const linkedReviewSubjects = stage.reviewSubjectIds
                      .map(id => allSubjectStats.find(subject => subject.id === id))
                      .filter((subject): subject is typeof allSubjectStats[number] => Boolean(subject));
                    const statusLabel = stage.status === 'completed'
                      ? '이전 과목'
                      : isCurrentStage
                        ? '현재 과목'
                        : '후행과목';
                    const estimatedCompletionDate = stageSchedule.completionDates.get(stage.id);
                    const stageForecast = speedOfSubject?.forecast.find(item => item.kind !== 'review' && item.id === stage.id);
                    const stageBasisNote = stageForecast && stageForecast.remainingPages > 0 ? describeForecastBasis(stageForecast.basis) : null;
                    const ownValueKey = `${sub.id}:stage:${stage.id}`;
                    const ownValueOpen = valueOpenKeys.has(ownValueKey);

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
                            {isCurrentStage && !isInlineEditing && (
                              <button type="button" data-testid="row-values-toggle" aria-expanded={ownValueOpen}
                                aria-label={`${stage.name} 현재 과목 값만 ${ownValueOpen ? '접기' : '보기'}`}
                                onClick={event => { event.preventDefault(); event.stopPropagation(); toggleValueRow(ownValueKey); }}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-base font-black text-white">
                                <span className={`transition-transform ${ownValueOpen ? 'rotate-90' : ''}`}>›</span>
                              </button>
                            )}
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
                                    <span className={`rounded-full px-2 py-1 text-xs font-black ${
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
                                      <span className="block text-xs font-black text-slate-400">시작 페이지</span>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={editHasChapters ? editChapterParse!.chapters[0].startPage : stageEditForm.startPage}
                                        disabled={editHasChapters}
                                        onClick={event => event.stopPropagation()}
                                        onChange={event => setStageEditForm(current => current ? {
                                          ...current,
                                          startPage: Number(event.target.value)
                                        } : current)}
                                        className="mt-1 w-full bg-transparent text-base font-black text-slate-900 outline-none"
                                      />
                                    </label>
                                    <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                      <span className="block text-xs font-black text-slate-400">끝 페이지</span>
                                      <input
                                        type="number"
                                        min={stageEditForm.startPage || 1}
                                        step="1"
                                        value={editHasChapters ? editChapterParse!.chapters[editChapterParse!.chapters.length - 1].endPage : stageEditForm.endPage}
                                        disabled={editHasChapters}
                                        onClick={event => event.stopPropagation()}
                                        onChange={event => setStageEditForm(current => current ? {
                                          ...current,
                                          endPage: Number(event.target.value)
                                        } : current)}
                                        className="mt-1 w-full bg-transparent text-base font-black text-slate-900 outline-none"
                                      />
                                    </label>
                                  </div>
                                  {editChapterParse && (
                                    <label className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                      <span className="block text-xs font-black text-slate-400">단원 범위</span>
                                      <input
                                        data-testid="stage-chapters-input"
                                        value={stageEditForm.chapterText}
                                        placeholder="1~10, 20~30"
                                        onClick={event => event.stopPropagation()}
                                        onChange={event => setStageEditForm(current => current ? {
                                          ...current,
                                          chapterText: event.target.value
                                        } : current)}
                                        className="mt-1 w-full bg-transparent text-base font-black text-slate-900 outline-none"
                                      />
                                      {editChapterParse.error && <span data-testid="stage-chapters-error" className="mt-1 block text-xs font-bold text-rose-600">{editChapterParse.error}</span>}
                                    </label>
                                  )}
                                  {stage.isFollowUp && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                        <span className="block text-xs font-black text-slate-400">필수 여부</span>
                                        <div role="group" aria-label="후행과목 필수 여부" className="mt-1 flex gap-1">
                                          {[{ value: true, label: '필수' }, { value: false, label: '선택' }].map(option => (
                                            <button key={option.label} type="button" aria-pressed={stageEditForm.isRequired === option.value} data-testid={`follow-up-required-${option.value ? 'yes' : 'no'}`}
                                              onClick={event => { event.preventDefault(); event.stopPropagation(); setStageEditForm(current => current ? { ...current, isRequired: option.value } : current); }}
                                              className={`h-8 flex-1 rounded-lg text-xs font-black ${stageEditForm.isRequired === option.value ? (option.value ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white') : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
                                              {option.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                        <span className="block text-xs font-black text-slate-400">단위 이름</span>
                                        <input
                                          data-testid="follow-up-page-label"
                                          value={stageEditForm.pageLabel}
                                          maxLength={MAX_PAGE_LABEL_LENGTH}
                                          placeholder={getPageLabel({ pageLabel: sub.pageLabel })}
                                          onClick={event => event.stopPropagation()}
                                          onChange={event => setStageEditForm(current => current ? { ...current, pageLabel: event.target.value } : current)}
                                          className="mt-1 w-full bg-transparent text-base font-black text-slate-900 outline-none"
                                        />
                                      </label>
                                    </div>
                                  )}
                                  {stage.status !== 'completed' && (
                                    <div className="flex items-center gap-2">
                                      <span className="mr-auto text-xs font-black text-slate-400">
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
                                    <span className={`rounded-full px-2 py-1 text-xs font-black ${
                                      isCurrentStage
                                        ? 'bg-indigo-100 text-indigo-600'
                                        : stage.status === 'completed'
                                          ? 'bg-slate-200 text-slate-500'
                                          : 'bg-amber-100 text-amber-600'
                                    }`}>
                                      {statusLabel}
                                    </span>
                                    {stage.status !== 'completed' && (
                                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-600">
                                        {stageForecast?.basis === 'none' ? '계획대로면' : '완료 예상'} {formatEstimatedDate(estimatedCompletionDate)}
                                      </span>
                                    )}
                                    {stageBasisNote && <span data-testid="stage-basis" className="text-xs font-black text-amber-700">{stageBasisNote}</span>}
                                  </div>
                                  <p className="mt-1 text-xs font-bold text-slate-400">
                                    {pagePositionLabel(normalizePageLabel((sub.followUpSubjects || []).find(item => item.id === stage.id)?.pageLabel || sub.pageLabel))}.{formatPageValue(stage.startPage)}~{formatPageValue(stage.endPage)}{stageHasChapters ? ` · 단원 ${stageChapterList.length}개` : ''} · {stageProgress}%
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
                                {/* 아직 시작하지 않은 후행과목(다른 과목을 합쳐 만든 것은 빼고)은 지울 수 있다. 공부한 기록이 없어 잃는 것이 없다. */}
                                {stage.isFollowUp && stage.status === 'upcoming' && !stageEditForm?.isNew
                                  && !(sub.followUpSubjects || []).find(item => item.id === stage.id)?.sourceSubjectId && (
                                  <button
                                    type="button"
                                    data-testid="delete-follow-up"
                                    aria-label={confirmDeleteStageId === stage.id ? `${stage.name} 정말 삭제` : `${stage.name} 삭제`}
                                    onClick={event => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      if (confirmDeleteStageId === stage.id) deleteFollowUpStage(sub, stage.id);
                                      else setConfirmDeleteStageId(stage.id);
                                    }}
                                    className={`flex h-8 items-center justify-center rounded-lg px-2 text-xs font-black ${confirmDeleteStageId === stage.id ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-600'}`}
                                  >
                                    {confirmDeleteStageId === stage.id ? '정말 삭제' : '삭제'}
                                  </button>
                                )}
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

                        {isCurrentStage && !isInlineEditing && ownValueOpen && renderValueBlock(
                          ownValueKey, getPageLabel(sub), weekNeed.own[sub.id] || emptyWeek, speedOfSubject?.own, sub.stats.averageTimePerPage,
                          speedOfSubject ? { subjectName: stage.name || sub.name, unit: speedOfSubject.basicReview } : undefined
                        )}

                        {linkedReviewSubjects.length > 0 && !isInlineEditing && (
                          <div data-testid="linked-review-grid" data-single={linkedReviewSubjects.length === 1 ? 'true' : undefined}
                            className={`mt-3 grid gap-2 ${linkedReviewSubjects.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                            {linkedReviewSubjects.map(reviewSubject => {
                              // 복습과목이 하나뿐이면 가로 전체를 쓰고 글자도 키운다(둘 이상이면 두 칸씩)
                              const solo = linkedReviewSubjects.length === 1;
                              const reviewActiveStage = getActiveSubjectStage(reviewSubject);
                              const reviewMinutesPerPage = getReviewMinutesPerPage(reviewSubject.id);
                              // 같은 복습과목을 붙인 단계가 여럿이면(본 과목 · 후행과목) 모두의 기록으로 한 완료일을 낸다
                              const linkedStages = subjectStages.filter(item => item.reviewSubjectIds.includes(reviewSubject.id));
                              const reviewCompletionDate = estimateReviewSubjectCompletion(
                                sub,
                                linkedStages.length ? linkedStages : stage,
                                reviewSubject,
                                (linkedStages.length ? linkedStages : [stage]).flatMap(item => stageSchedule.studyEvents.get(item.id) || []),
                                logs
                              );
                              const reviewForecast = speedOfSubject?.forecast.find(item => item.kind === 'review' && item.id === reviewSubject.id);
                              const reviewBasisNote = reviewForecast && getSubjectRemainingPageCount(reviewSubject) > 0 ? describeForecastBasis(reviewForecast.basis) : null;
                              const reviewValueKey = `${sub.id}:${reviewSubject.id}`;
                              const reviewValueOpen = valueOpenKeys.has(reviewValueKey);
                              return (
                                <div key={reviewSubject.id} className={`rounded-xl border border-rose-100 bg-rose-50/70 ${solo ? 'px-4 py-3.5' : 'px-3 py-2.5'} ${reviewValueOpen && !solo ? 'sm:col-span-2' : ''}`}>
                                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                                    <div className="flex min-w-0 flex-1 basis-36 items-center gap-2">
                                      <button type="button" data-testid="row-values-toggle" aria-expanded={reviewValueOpen}
                                        aria-label={`${reviewSubject.name} 복습과목 값만 ${reviewValueOpen ? '접기' : '보기'}`}
                                        onClick={event => { event.preventDefault(); event.stopPropagation(); toggleValueRow(reviewValueKey); }}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-base font-black text-white">
                                        <span className={`transition-transform ${reviewValueOpen ? 'rotate-90' : ''}`}>›</span>
                                      </button>
                                      <div className="min-w-0">
                                        <p className={`truncate font-black text-slate-800 ${solo ? 'text-base' : 'text-xs'}`}>{reviewSubject.name}</p>
                                        {reviewBasisNote && <p data-testid="review-basis" className="break-keep text-[11px] font-black text-amber-700">{reviewBasisNote}</p>}
                                      </div>
                                    </div>
                                    <div data-testid="review-card-tools" className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <span className="text-xs font-black text-rose-500">복습과목</span>
                                      <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-rose-600">
                                        {getSubjectRemainingPageCount(reviewSubject) <= 0
                                          ? '완료'
                                          : `${reviewForecast?.basis === 'none' ? '계획대로면' : '완료 예상'} ${formatEstimatedDate(reviewCompletionDate)}`}
                                      </span>
                                      <button type="button"
                                        aria-label={`${reviewSubject.name} 성장 표시 ${growthEditingSubjectId === reviewSubject.id ? '닫기' : '수정'}`}
                                        aria-expanded={growthEditingSubjectId === reviewSubject.id}
                                        onClick={event => {
                                          event.stopPropagation();
                                          setGrowthEditingSubjectId(current => current === reviewSubject.id ? null : reviewSubject.id);
                                        }}
                                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-500 hover:text-rose-600">
                                        {growthEditingSubjectId === reviewSubject.id ? '✓' : '✎'}
                                      </button>
                                    </div>
                                  </div>
                                  <p className={`mt-1 font-bold ${solo ? 'text-sm text-slate-500' : 'text-xs text-slate-400'}`}>
                                    {reviewActiveStage
                                      ? `${pagePositionLabel(getPageLabel(reviewSubject))}.${formatPageValue(reviewActiveStage.currentPage)}~${formatPageValue(reviewActiveStage.endPage)}`
                                      : '완료'}
                                    {' · '}
                                    {reviewMinutesPerPage > 0 ? `1${getPageLabel(reviewSubject)}당 ${reviewMinutesPerPage.toFixed(1)}분` : '측정 필요'}
                                  </p>
                                  {growthEditingSubjectId === reviewSubject.id && <ReviewGrowthSettings
                                    value={reviewSubject.reviewGrowthDisplay === 'review' ? 'review' : 'unit'}
                                    onChange={value => {
                                      const original = subjects.find(subject => subject.id === reviewSubject.id);
                                      if (original) onUpdateSubject?.({ ...original, reviewGrowthDisplay: value });
                                    }} />}
                                  {reviewValueOpen && renderValueBlock(
                                    reviewValueKey, getPageLabel(reviewSubject), weekNeed.reviews[reviewValueKey] || emptyWeek, speedOfSubject?.reviews[reviewSubject.id], reviewMinutesPerPage
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {isInlineEditing && stageEditForm && (
                          <div className="mt-3 rounded-xl bg-slate-900 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="text-xs font-black text-slate-500">복습과목</p>
                              {!newReviewForm && !reviewSubjectIdSet.has(sub.id) && (
                                <button type="button" data-testid="new-review-subject-open"
                                  onClick={event => { event.preventDefault(); event.stopPropagation(); setNewReviewForm({ name: '', startPage: 1, endPage: 100, chapterText: '', pageLabel: '' }); }}
                                  className="rounded-lg border border-rose-400 px-3 py-1.5 text-xs font-black text-rose-200 hover:bg-rose-500 hover:text-white">＋ 새 복습과목</button>
                              )}
                            </div>
                            {newReviewForm && (() => {
                              const parsed = parseChapterText(newReviewForm.chapterText);
                              const hasChapters = parsed.chapters.length > 0;
                              const field = 'rounded-lg border border-slate-700 bg-slate-800 px-3 py-2';
                              const input = 'mt-1 w-full bg-transparent text-sm font-black text-white outline-none disabled:text-slate-400';
                              return (
                                <div data-testid="new-review-subject-form" className="mb-3 grid gap-2 rounded-xl border border-rose-400/60 p-2" onClick={event => event.stopPropagation()}>
                                  <label className={field}><span className="block text-[11px] font-black text-slate-400">이름</span>
                                    <input data-testid="new-review-name" value={newReviewForm.name} placeholder={`${sub.name} 복습`} autoFocus
                                      onChange={event => setNewReviewForm(current => current ? { ...current, name: event.target.value } : current)} className={input} /></label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <label className={field}><span className="block text-[11px] font-black text-slate-400">시작 페이지</span>
                                      <input data-testid="new-review-start" type="number" min="1" step="1" disabled={hasChapters}
                                        value={hasChapters ? parsed.chapters[0].startPage : newReviewForm.startPage}
                                        onChange={event => setNewReviewForm(current => current ? { ...current, startPage: Number(event.target.value) } : current)} className={input} /></label>
                                    <label className={field}><span className="block text-[11px] font-black text-slate-400">끝 페이지</span>
                                      <input data-testid="new-review-end" type="number" min="1" step="1" disabled={hasChapters}
                                        value={hasChapters ? parsed.chapters[parsed.chapters.length - 1].endPage : newReviewForm.endPage}
                                        onChange={event => setNewReviewForm(current => current ? { ...current, endPage: Number(event.target.value) } : current)} className={input} /></label>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <label className={field}><span className="block text-[11px] font-black text-slate-400">단원 범위</span>
                                      <input data-testid="new-review-chapters" value={newReviewForm.chapterText} placeholder="1~10, 20~30"
                                        onChange={event => setNewReviewForm(current => current ? { ...current, chapterText: event.target.value } : current)} className={input} />
                                      {parsed.error && <span className="mt-1 block text-[11px] font-bold text-rose-300">{parsed.error}</span>}</label>
                                    <label className={field}><span className="block text-[11px] font-black text-slate-400">단위 이름</span>
                                      <input data-testid="new-review-label" value={newReviewForm.pageLabel} placeholder={DEFAULT_PAGE_LABEL} maxLength={MAX_PAGE_LABEL_LENGTH}
                                        onChange={event => setNewReviewForm(current => current ? { ...current, pageLabel: event.target.value } : current)} className={input} /></label>
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <button type="button" onClick={event => { event.preventDefault(); setNewReviewForm(null); }}
                                      className="h-9 rounded-lg bg-slate-700 px-3 text-xs font-black text-slate-200">취소</button>
                                    <button type="button" data-testid="new-review-create" disabled={Boolean(parsed.error)}
                                      onClick={event => { event.preventDefault(); createReviewSubjectInline(sub); }}
                                      className="h-9 rounded-lg bg-rose-500 px-3 text-xs font-black text-white disabled:opacity-40">만들고 넣기</button>
                                  </div>
                                </div>
                              );
                            })()}
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
          ) };
        });

    const entries = orderSiblings([...folderEntries, ...subjectEntries], parentKey);
    const siblingRefs: SiblingRef[] = entries.map(entry => ({ kind: entry.kind, id: entry.id }));
    // 띠는 항목 사이마다, 그리고 맨 앞과 맨 뒤에 있다(항목이 없으면 하나). before/after는 그 자리 앞뒤 항목의 이름.
    const renderGap = (index: number) => {
      const before = entries[index - 1]?.name;
      const after = entries[index]?.name;
      const gapKey = `${parentKey}:${index}`;
      const where = before && after ? `${joinWithAnd(before, after)} 사이` : before ? `${before} 뒤` : after ? `${after} 앞` : '이 자리';
      return (
        <React.Fragment key={`gap-${index}`}>
          <InsertGap open={openGapKey === gapKey} label={`${where}에 추가`} alwaysOpen={entries.length === 0 && parentKey === 'root'}
            onToggle={() => { setOpenGapKey(current => current === gapKey ? null : gapKey); setGapPlan(null); }}
            onAddFolder={() => addFolderAt(parentKey, siblingRefs, index)}
            onAddPlan={() => setGapPlan({ key: gapKey, parentKey, index, siblings: siblingRefs, where })} />
          {gapPlan?.key === gapKey && (
            <div data-testid="gap-plan-form" className="my-2 rounded-3xl border-2 border-indigo-300 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-900">
                <span className="min-w-0 truncate">{gapPlan.where}에 추가돼요</span>
                <button type="button" onClick={() => setGapPlan(null)} className="shrink-0 rounded-lg bg-white px-3 py-1 text-xs font-black text-indigo-700">닫기</button>
              </div>
              <SubjectPlanner onAddSubject={addPlanAt} />
            </div>
          )}
        </React.Fragment>
      );
    };
    return (
      <div className={depth > 0 ? 'ml-3 md:ml-6 pl-3 pt-2 border-l-2 border-slate-200' : ''}>
        {renderGap(0)}
        {entries.map((entry, index) => (
          <React.Fragment key={entry.id}>
            {entry.node}
            {renderGap(index + 1)}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:justify-between">
        <div className="flex items-center gap-4 rounded-2xl border border-indigo-100 bg-white px-5 py-3.5 shadow-sm">
          <p className="text-sm font-bold text-slate-500">하루 평균<br />필요시간</p>
          <p className="text-4xl font-black leading-none text-indigo-600">{formatTime(weekdayTotalTime)}</p>
        </div>
      </div>

      {visibleSubjectStats.length > 0 && (
        <PlanUnitSummary unit={planUnit} onUnitChange={unit => { setPlanUnit(unit); setPlanWeekday(null); }} weekday={summaryWeekday} onWeekdayChange={setPlanWeekday}
          growth={summaryGrowth} amount={summaryAmount} minutes={summaryMinutes} days={summaryDays} shareItems={topShareItems}
          hasSchedule={subjects.some(subject => (subject.scheduledWeekdays ?? []).length > 0)} />
      )}

      <div className="bg-slate-100/70 p-3 md:p-4 rounded-2xl border border-slate-200">
        {RenderTree({})}
        
        {subjects.length === 0 && tagDefinitions.length === 0 && (
          <div className="py-32 text-center opacity-10 grayscale">
            <p className="text-6xl mb-4">🔍</p>
            <p className="text-xl font-black uppercase tracking-wide">데이터 없음</p>
          </div>
        )}
      </div>
    </div>
  );
};

const StatBox = ({ label, value, unit, color, isDark, highlight, large }: { label: string, value: string, unit: string, color: string, isDark?: boolean, highlight?: boolean, large?: boolean }) => (
  <div className={`flex flex-col min-w-0 px-3 py-3 rounded-lg transition-all ${highlight ? (isDark ? 'bg-white/10' : 'bg-white shadow-sm border border-slate-100 z-10') : 'opacity-90'}`}>
    <p className={`text-xs xl:text-[13px] font-bold mb-1.5 truncate ${isDark ? 'text-indigo-300' : 'text-slate-500'}`}>{label}</p>
    <p className={`${large ? 'text-2xl xl:text-4xl' : 'text-2xl xl:text-3xl'} font-black truncate leading-none ${isDark && !highlight ? 'text-white' : color}`}>
      {value}<span className="text-xs xl:text-sm font-bold ml-1 opacity-50">{unit}</span>
    </p>
  </div>
);
