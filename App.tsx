import React, { useState, useEffect, useMemo } from 'react';
import { Subject, StudyLog, TagDefinition, ReviewMemoDocument, ReviewMeasurement } from './types';
import { dedupeIdenticalQuestions } from './utils/reviewDuplicates';
import { withReviewMemoDocument } from './utils/reviewMemoDocument';
import { SessionLogger } from './components/SessionLogger';
import { Analytics } from './components/Analytics';
import { HistoryCharts } from './components/HistoryCharts';
import { TodaySummary } from './components/TodaySummary';
import { GoogleGenAI } from '@google/genai';
import { breakFolderCycles } from './utils/listOrder';
import { adjustSubjectProgress, calculateFreshWeekdayPagePlan, getActiveSubjectStage, getAllSubjectReviewIds, getDiffDays, getLocalDateKey, getStudyDateForWeekday, getSubjectRemainingPageCount, getSubjectStageReviewSubjectIds } from './utils/schedule';
import { INITIAL_REVIEW_DELAY_MS, IS_FAST_REVIEW_TEST_MODE, recordReviewMeasurement, applyReviewPageCursor, applySessionEndPage, applyUnitReviewRegistration, registerPendingReviews, completeRepeatedSubjectReview } from './utils/review';
import { normalizePageGrowthSettings } from './utils/pageGrowth';
import { resizeSessionTimes } from './utils/measurement';
import { getLogProgressPages } from './utils/measurement';
import { fsrsIntervalMs } from './utils/fsrs';
import { gradePendingReviews, gradeSubjectCard } from './utils/subjectFeedback';
import type { SubjectGrade } from './utils/subjectFeedback';
import { applyReviewGateOutcomes, applyReviewRemoval, clearReviewGateRetries, completeRegularReviewSchedule, getCurrentReviewIntervalMs, restoreReviewRemoval, ReviewGateOutcome, skipEditIntake, updateReviewGateMemo } from './utils/reviewGate';
import { readEditIntake } from './utils/reviewEditIntake';
import { useSubjectShorthandSync } from './utils/useNoteShorthand';
import { normalizeChapters } from './utils/subjectChapters';
import type { RemovalUpdate } from './utils/reviewRemoval';

const getFolderSnapshots = (tagIds: string[], tags: TagDefinition[]) => {
  const snapshots = new Map<string, { id: string; name: string; parentId?: string }>();

  const addWithParents = (id: string) => {
    const tag = tags.find(item => item.id === id);
    if (!tag || snapshots.has(tag.id)) return;
    snapshots.set(tag.id, { id: tag.id, name: tag.name, parentId: tag.parentId });
    if (tag.parentId) addWithParents(tag.parentId);
  };

  tagIds.forEach(addWithParents);
  return Array.from(snapshots.values());
};

const TEST_REVIEW_DELAY_THRESHOLD_MS = 10 * 60 * 1000;
const REVIEW_INTERVAL_POLICY_KEY = 'swp_review_interval_policy';
const REVIEW_INTERVAL_POLICY_VERSION = 'power-of-two-v1';

const getLegacyReviewIntervalMs = (reviewStep: number) => {
  const dayMs = 24 * 60 * 60 * 1000;
  if (reviewStep <= 0) return INITIAL_REVIEW_DELAY_MS;
  if (reviewStep === 1) return dayMs;
  if (reviewStep === 2) return 4 * dayMs;
  if (reviewStep === 3) return 7 * dayMs;
  if (reviewStep === 4) return 14 * dayMs;
  if (reviewStep === 5) return 28 * dayMs;
  return 28 * dayMs * Math.pow(2, reviewStep - 5);
};

const migrateReviewDateToPowerOfTwo = (date: string, reviewStep: number) => {
  const dueAt = Date.parse(date);
  if (!Number.isFinite(dueAt)) return date;
  const oldInterval = getLegacyReviewIntervalMs(reviewStep);
  const nextInterval = getCurrentReviewIntervalMs(reviewStep);
  return new Date(dueAt - oldInterval + nextInterval).toISOString();
};

const inheritReviewSubjectTargetDates = (sourceSubjects: Subject[]) => sourceSubjects.map(subject => {
  const owner = sourceSubjects.find(candidate => getAllSubjectReviewIds(candidate).includes(subject.id));
  if (!owner || subject.targetDate === owner.targetDate) return subject;

  const inheritedSubject = {
    ...subject,
    targetDate: owner.targetDate,
    scheduledWeekdayPages: undefined,
  };

  return {
    ...inheritedSubject,
    scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
      inheritedSubject,
      getSubjectRemainingPageCount(inheritedSubject),
      getDiffDays(owner.targetDate),
    ),
  };
});

const repairTestReviewDate = (log: StudyLog) => {
  if (IS_FAST_REVIEW_TEST_MODE) {
    const reviewAt = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : NaN;
    const testDueAt = Date.now() + INITIAL_REVIEW_DELAY_MS;
    const canShorten = (log.reviewStep ?? 0) <= 3
      && !log.isCondensed
      && log.reviewEnabled !== false
      && Number.isFinite(reviewAt)
      && reviewAt > testDueAt;
    return canShorten ? new Date(testDueAt).toISOString() : log.nextReviewDate ?? log.timestamp;
  }

  const currentStep = log.reviewStep ?? 0;
  if (log.isCondensed || log.reviewEnabled === false || !log.nextReviewDate) {
    return log.nextReviewDate ?? log.timestamp;
  }

  const studiedAt = new Date(log.timestamp).getTime();
  const reviewAt = new Date(log.nextReviewDate).getTime();
  const wasTestDelay = Number.isFinite(studiedAt)
    && Number.isFinite(reviewAt)
    && reviewAt >= studiedAt
    && reviewAt - studiedAt < TEST_REVIEW_DELAY_THRESHOLD_MS;

  return wasTestDelay
    ? new Date(Date.now() + getCurrentReviewIntervalMs(currentStep)).toISOString()
    : log.nextReviewDate;
};

const shouldSkipReviewForLog = (log: StudyLog, subject?: Subject) => {
  if (typeof log.reviewEnabled === 'boolean') return !log.reviewEnabled;
  return log.isCondensed === true || subject?.reviewEnabled === false;
};

const STORED_DATA_KEYS = ['swp_subjects', 'swp_logs', 'swp_tags'];

const backupStoredValue = (key: string, raw: string, stamp = new Date().toISOString()) => {
  try { localStorage.setItem(`${key}_backup_${stamp}`, raw); } catch { /* 백업할 자리가 없으면 그대로 둔다 */ }
};

/** 저장된 목록 하나를 읽는다. 깨져서 못 읽으면 원본을 백업 키로 옮겨 두고 빈 목록으로 시작한다(다른 목록은 그대로 읽는다) */
const parseStoredList = <T,>(key: string, raw: string | null): T[] => {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return value;
    if (value === null) return [];
  } catch { /* 아래에서 백업 */ }
  console.error(`Failed to read ${key} from localStorage`);
  backupStoredValue(key, raw);
  return [];
};

const App: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  // 과목마다의 `=`·`-` 단축어 설정을 노트 읽기에 알려 둔다
  useSubjectShorthandSync(subjects);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'history'>('dashboard');
  const [activeStudyWeekday, setActiveStudyWeekday] = useState<number>(new Date().getDay());
  const [dashboardDetailSubjectId, setDashboardDetailSubjectId] = useState('');
  /** 학습 실행의 "학습 설정 가기"로 열 때 설정 화면이 먼저 보여줄 과목(그 과목이 든 폴더를 펼치고 카드로 스크롤) */
  const [settingsFocusSubjectId, setSettingsFocusSubjectId] = useState('');
  const openSettingsFor = (subjectId: string) => { setSettingsFocusSubjectId(subjectId); setActiveTab('settings'); };
  useEffect(() => { if (activeTab !== 'settings') setSettingsFocusSubjectId(''); }, [activeTab]);
  const [dashboardDate, setDashboardDate] = useState(() => getLocalDateKey());
  const [aiTip, setAiTip] = useState<string>('목표를 향한 오늘의 첫걸음을 응원합니다.');

  // 커스텀 확인 모달 상태
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    message: string;
    subMessage?: string;
    onConfirm: () => void;
  }>({ isOpen: false, message: '', onConfirm: () => {} });

  const todayStr = useMemo(() => {
    const d = new Date(`${dashboardDate}T12:00:00`);
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    return d.toLocaleDateString('ko-KR', options);
  }, [dashboardDate]);

  const activeStudyDate = useMemo(
    () => getStudyDateForWeekday(activeStudyWeekday),
    [activeStudyWeekday]
  );

  useEffect(() => {
    const refreshDate = () => setDashboardDate(getLocalDateKey());
    const interval = window.setInterval(refreshDate, 60000);
    window.addEventListener('focus', refreshDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshDate);
    };
  }, []);
  const dashboardWeekday = new Date(`${dashboardDate}T12:00:00`).getDay();

  // Persistence (Safe Load)
  useEffect(() => {
    try {
      const savedSubs = localStorage.getItem('swp_subjects');
      const savedLogs = localStorage.getItem('swp_logs');
      const savedTags = localStorage.getItem('swp_tags');
      const loadedSubjects: Array<Subject & {
        procedures?: Array<{ totalPages: number; completedPages: number }>;
      }> = parseStoredList('swp_subjects', savedSubs);
      const loadedLogs: StudyLog[] = parseStoredList('swp_logs', savedLogs);
      const loadedTags: TagDefinition[] = parseStoredList('swp_tags', savedTags);
      const shouldMigrateReviewIntervals = localStorage.getItem(REVIEW_INTERVAL_POLICY_KEY) !== REVIEW_INTERVAL_POLICY_VERSION;
      
      if (savedSubs) {
        const migratedSubjects = loadedSubjects.map(subject => {
          // 단원이 있으면 시작·끝 페이지는 첫 단원 시작과 마지막 단원 끝이다
          const savedChapters = normalizeChapters(subject.chapters);
          const startPage = savedChapters.length > 0 ? savedChapters[0].startPage : Math.max(1, Number(subject.startPage) || 1);
          const totalPages = savedChapters.length > 0
            ? savedChapters[savedChapters.length - 1].endPage
            : Math.max(startPage, subject.procedures?.[0]?.totalPages ?? subject.totalPages);
          const rawCompletedPages = subject.procedures?.length
            ? subject.procedures.reduce((sum, procedure) => sum + procedure.completedPages, 0)
            : subject.completedPages;
          const completedPages = Math.min(totalPages, Math.max(startPage - 1, rawCompletedPages));
          const hadCustomWeekdayAllocation = Boolean(
            subject.scheduledWeekdayRemainderDay !== undefined
            || (subject.scheduledWeekdayWeights && Object.keys(subject.scheduledWeekdayWeights).length > 0)
          );
          const migratedSubject: Subject = {
            ...normalizePageGrowthSettings(subject),
            id: subject.id,
            name: subject.name,
            materialType: subject.materialType ?? 'problem',
            createdAt: subject.createdAt ?? (
              loadedLogs
                .filter(log => log.subjectId === subject.id)
                .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0]?.timestamp
              ?? new Date().toISOString()
            ),
            planResetDate: subject.planResetDate,
            startPage,
            totalPages,
            completedPages,
            targetDate: subject.targetDate,
            initialAverageTimePerPage: subject.initialAverageTimePerPage,
            reviewStartPage: subject.reviewStartPage,
            ...(savedChapters.length > 0 ? { chapters: savedChapters } : {}),
            tagIds: subject.tagIds,
            reviewEnabled: subject.reviewEnabled ?? true,
            reviewSubjectIds: Array.isArray(subject.reviewSubjectIds)
              ? subject.reviewSubjectIds.filter(id => id !== subject.id)
              : [],
            isRequired: subject.isRequired ?? false,
            scheduledWeekdays: subject.scheduledWeekdays ?? [1, 2, 3, 4, 5, 6, 0],
            followUpSubjects: Array.isArray(subject.followUpSubjects)
              ? subject.followUpSubjects.map(followUp => ({
                  id: followUp.id || Math.random().toString(36).slice(2, 11),
                  sourceSubjectId: followUp.sourceSubjectId,
                  name: followUp.name || '후행과목',
                  startPage: Math.max(1, Number(followUp.startPage) || 1),
                  endPage: Math.max(Number(followUp.startPage) || 1, Number(followUp.endPage) || Number(followUp.startPage) || 1),
                  completedPage: Number.isFinite(Number(followUp.completedPage))
                    ? Number(followUp.completedPage)
                    : Math.max(0, (Number(followUp.startPage) || 1) - 1),
                  reviewSubjectIds: Array.isArray(followUp.reviewSubjectIds)
                    ? followUp.reviewSubjectIds.filter(id => id !== subject.id)
                    : (loadedSubjects.find(item => item.id === followUp.sourceSubjectId)?.reviewSubjectIds || [])
                      .filter(id => id !== subject.id)
                }))
              : []
          };

          return {
            ...migratedSubject,
            scheduledWeekdayPages: !hadCustomWeekdayAllocation && subject.scheduledWeekdayPages
              ? subject.scheduledWeekdayPages
              : calculateFreshWeekdayPagePlan(
                  migratedSubject,
                  getSubjectRemainingPageCount(migratedSubject),
                  getDiffDays(subject.targetDate)
                )
          };
        });
        const linkedReviewSubjectIds = new Set(
          migratedSubjects.flatMap(subject => getAllSubjectReviewIds(subject))
        );
        const subjectsWithoutNestedReviews = migratedSubjects.map(subject => (
          linkedReviewSubjectIds.has(subject.id)
            ? {
                ...subject,
                reviewSubjectIds: [],
                followUpSubjects: (subject.followUpSubjects || []).map(stage => ({
                  ...stage,
                  reviewSubjectIds: []
                }))
              }
            : subject
        ));
        setSubjects(inheritReviewSubjectTargetDates(subjectsWithoutNestedReviews));
      }
      if (savedLogs) {
        if (loadedLogs.some(log => log.reviewMemo !== undefined && !log.reviewMemoDocument)
          && !localStorage.getItem('swp_logs_before_note_blocks_v1')) {
          localStorage.setItem('swp_logs_before_note_blocks_v1', savedLogs);
        }
        // 레거시 데이터 마이그레이션: nextReviewDate가 없으면 timestamp로 초기화
        const migratedLogs = loadedLogs.map(log => {
          const subject = loadedSubjects.find(item => item.id === log.subjectId);
          const folderSnapshots = getFolderSnapshots(subject?.tagIds || [], loadedTags);
          const timestampDate = new Date(log.timestamp);
          const restoredRetryInterval = log.reviewGateRetry
            ? getCurrentReviewIntervalMs(log.reviewGateRetry.reviewStep)
            : 0;
          const reviewGateRetry = log.reviewGateRetry
            ? {
                ...log.reviewGateRetry,
                intervalMs: restoredRetryInterval,
                dueAt: log.reviewGateRetry.intervalMs < TEST_REVIEW_DELAY_THRESHOLD_MS
                  ? new Date(Date.now() + restoredRetryInterval).toISOString()
                  : shouldMigrateReviewIntervals
                    ? migrateReviewDateToPowerOfTwo(log.reviewGateRetry.dueAt, log.reviewGateRetry.reviewStep)
                    : log.reviewGateRetry.dueAt
              }
            : undefined;
          const repairedNextReviewDate = repairTestReviewDate({
            ...log,
            reviewStep: log.reviewStep ?? 0,
            nextReviewDate: log.nextReviewDate ?? log.timestamp,
            isCondensed: log.isCondensed ?? false
          });
          const nextReviewDate = shouldMigrateReviewIntervals
              ? migrateReviewDateToPowerOfTwo(repairedNextReviewDate, log.reviewStep ?? 0)
              : repairedNextReviewDate;

          return withReviewMemoDocument({
            ...log,
            reviewGateRetry,
            subjectNameSnapshot: log.subjectNameSnapshot || subject?.name || '삭제된 과목',
            folderSnapshots: log.folderSnapshots || folderSnapshots,
            studyDate: log.studyDate || getLocalDateKey(timestampDate),
            studyWeekday: log.studyWeekday ?? timestampDate.getDay(),
            reviewStep: log.reviewStep ?? 0,
            nextReviewDate,
            isCondensed: log.isCondensed ?? false
          });
        });
        setLogs(migratedLogs);
        localStorage.setItem(REVIEW_INTERVAL_POLICY_KEY, REVIEW_INTERVAL_POLICY_VERSION);
      }
      if (savedTags) setTagDefinitions(breakFolderCycles(loadedTags));
    } catch (e) {
      console.error("Failed to load data from localStorage", e);
      // 불러오다 실패하면 빈 화면이 저장된 기록을 덮어쓰지 않도록, 저장돼 있던 원본을 따로 남겨 둔다
      const stamp = new Date().toISOString();
      STORED_DATA_KEYS.forEach(key => {
        const raw = localStorage.getItem(key);
        if (raw !== null) backupStoredValue(key, raw, stamp);
      });
    }
    setStorageLoaded(true);
  }, []);

  useEffect(() => {
    // 불러오기가 끝나기 전의 빈 상태는 저장하지 않는다
    if (!storageLoaded) return;
    localStorage.setItem('swp_subjects', JSON.stringify(subjects));
    localStorage.setItem('swp_logs', JSON.stringify(logs));
    localStorage.setItem('swp_tags', JSON.stringify(tagDefinitions));
  }, [storageLoaded, subjects, logs, tagDefinitions]);

  // 같은 문제(글 · 정답 · 조건이 모두 같은 것)가 한 과목의 여러 노트에 생기면 복습 주기가 가장 짧은 하나만 복습에 남긴다.
  useEffect(() => {
    const next = dedupeIdenticalQuestions(logs);
    if (next !== logs) setLogs(next);
  }, [logs]);

  // AI 팁 로직
  useEffect(() => {
    const fetchAiTip = async () => {
      if (!process.env.API_KEY) return;
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: "과학적 학습 방법론에 기반한 짧고 동기부여가 되는 학습 팁 하나를 한국어로 제공해줘. (20자 이내)",
          config: { temperature: 0.8 }
        });
        if (response.text) setAiTip(response.text.replace(/\"/g, ''));
      } catch (e) {
        // AI fetch 실패 시 무시
      }
    };
    fetchAiTip();
  }, []);

  // 확인 모달 열기 함수
  const openConfirm = (message: string, subMessage: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      message,
      subMessage,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleAddSubject = (s: Subject) => {
    setSubjects(prev => [...prev, s]);
  };

  const handleUpdateSubject = (updatedSubject: Subject) => {
    setSubjects(prev => inheritReviewSubjectTargetDates(
      prev.map(s => s.id === updatedSubject.id ? updatedSubject : s)
    ));
    setLogs(prev => prev.map(log => {
      if (log.subjectId !== updatedSubject.id) return log;
      return {
        ...log,
        subjectNameSnapshot: updatedSubject.name
      };
    }));
  };

  const handleUpdateSubjects = (updatedSubjects: Subject[]) => {
    const updatedMap = new Map(updatedSubjects.map(subject => [subject.id, subject]));
    setSubjects(prev => inheritReviewSubjectTargetDates(
      prev.map(subject => updatedMap.get(subject.id) || subject)
    ));
    setLogs(prev => prev.map(log => {
      const updatedSubject = updatedMap.get(log.subjectId);
      if (!updatedSubject) return log;
      return {
        ...log,
        subjectNameSnapshot: updatedSubject.name
      };
    }));
  };

  const handleDeleteSubject = (id: string) => {
    openConfirm(
      '과목을 삭제하시겠습니까?',
      '과목은 목록에서 삭제되지만 기존 학습 기록과 누적 통계는 유지됩니다.',
      () => {
        setSubjects(prev => prev.filter(s => s.id !== id));
        setSubjects(prev => prev.map(subject => ({
          ...subject,
          reviewSubjectIds: (subject.reviewSubjectIds || []).filter(reviewSubjectId => reviewSubjectId !== id),
          followUpSubjects: (subject.followUpSubjects || []).map(followUp => ({
            ...followUp,
            reviewSubjectIds: (followUp.reviewSubjectIds || []).filter(reviewSubjectId => reviewSubjectId !== id)
          }))
        })));
      }
    );
  };

  const handleUpdateTags = (tags: TagDefinition[]) => {
    setTagDefinitions(tags);
    setLogs(prev => prev.map(log => ({
      ...log,
      folderSnapshots: (log.folderSnapshots || []).map(snapshot => {
        const updated = tags.find(tag => tag.id === snapshot.id);
        return updated
          ? { id: updated.id, name: updated.name, parentId: snapshot.parentId }
          : snapshot;
      })
    })));
  };

  const handleDeleteFolder = (folderId: string) => {
    openConfirm(
      '폴더를 삭제하시겠습니까?',
      '폴더 안의 과목들은 삭제되지 않고 최상위 목록(Root)으로 이동합니다.',
      () => {
        const getTargetFolderIds = (rootId: string, allTags: TagDefinition[], seen = new Set<string>()): string[] => {
            if (seen.has(rootId)) return [];
            seen.add(rootId);
            const children = allTags.filter(t => t.parentId === rootId);
            const childIds = children.flatMap(c => getTargetFolderIds(c.id, allTags, seen));
            return [rootId, ...childIds];
        };
        const foldersToRemove = getTargetFolderIds(folderId, tagDefinitions);
        setTagDefinitions(prev => [...prev.filter(t => !foldersToRemove.includes(t.id))]);
        setSubjects(prev => prev.map(sub => {
            if (!sub.tagIds || sub.tagIds.length === 0) return sub;
            const newTagIds = sub.tagIds.filter(tid => !foldersToRemove.includes(tid));
            return { ...sub, tagIds: newTagIds };
        }));
      }
    );
  };

  const handleLogSession = (log: StudyLog) => {
    const subject = subjects.find(item => item.id === log.subjectId);
    const skipReview = shouldSkipReviewForLog(log, subject);
    const folderSnapshots = getFolderSnapshots(subject?.tagIds || [], tagDefinitions);
    const activeStage = subject ? getActiveSubjectStage(subject) : null;
    const subjectStageId = log.subjectStageId || activeStage?.id || subject?.id;
    const reviewSubjectIdsSnapshot = log.reviewSubjectIdsSnapshot
      || (subject ? getSubjectStageReviewSubjectIds(subject, subjectStageId) : []);
    const newLog: StudyLog = {
        ...withReviewMemoDocument(log),
        subjectNameSnapshot: subject?.name || '삭제된 과목',
        subjectStageId,
        subjectStageNameSnapshot: log.subjectStageNameSnapshot || activeStage?.name || subject?.name,
        reviewSubjectIdsSnapshot,
        folderSnapshots,
        studyDate: log.studyDate || getLocalDateKey(new Date(log.timestamp)),
        studyWeekday: log.studyWeekday ?? new Date(log.timestamp).getDay(),
        reviewStep: log.isRepeatReview ? log.reviewStep || 0 : 0,
        nextReviewDate: !skipReview
          ? log.isRepeatReview ? log.nextReviewDate
            // 난도 피드백(FSRS-6)이 있으면 그 평가가 정한 때에, 없으면 2시간 뒤에 첫 복습이 열린다
            : new Date(log.reviewFsrs ? log.reviewFsrs.lastReviewMs + fsrsIntervalMs(log.reviewFsrs) : Date.now() + INITIAL_REVIEW_DELAY_MS).toISOString()
          : undefined,
        isCondensed: skipReview,
        reviewEnabled: !skipReview
    };
    // 페이지 단위가 있는 과목은 세션마다 복습을 등록하지 않고, 단위 끝 페이지까지 풀었을 때 그 단위 범위를 등록한다.
    setLogs(prev => {
      const result = applyUnitReviewRegistration(subject, prev, newLog);
      return [...result.logs, result.incoming];
    });
    setSubjects(prev => prev.map(sub => {
      if (sub.id === log.subjectId) {
        return log.pageCountIsExplicit ? applySessionEndPage(sub, log)
          : log.reviewParentSubjectId ? applyReviewPageCursor(sub, log) : adjustSubjectProgress(sub, log.pagesRead);
      }
      return sub;
    }));
  };

  const handleUpdateLog = (updatedLog: StudyLog) => {
    const oldLog = logs.find(l => l.id === updatedLog.id);
    if (!oldLog) return;

    const subject = subjects.find(item => item.id === updatedLog.subjectId);
    const activeStage = subject ? getActiveSubjectStage(subject) : null;
    const subjectStageId = oldLog.subjectId === updatedLog.subjectId
      ? updatedLog.subjectStageId || oldLog.subjectStageId || activeStage?.id || subject?.id
      : activeStage?.id || subject?.id;
    const enrichedLog: StudyLog = {
      ...withReviewMemoDocument({ ...updatedLog, reviewMemoDocument: updatedLog.reviewMemoDocument
        || (updatedLog.reviewMemo !== undefined ? oldLog.reviewMemoDocument : undefined) }),
      pageCountIsExplicit: updatedLog.pageCountIsExplicit ?? oldLog.pageCountIsExplicit,
      subjectNameSnapshot: subject?.name || updatedLog.subjectNameSnapshot || '삭제된 과목',
      subjectStageId,
      subjectStageNameSnapshot: oldLog.subjectId === updatedLog.subjectId
        ? updatedLog.subjectStageNameSnapshot || oldLog.subjectStageNameSnapshot || activeStage?.name || subject?.name
        : activeStage?.name || subject?.name,
      reviewSubjectIdsSnapshot: oldLog.subjectId === updatedLog.subjectId
        ? updatedLog.reviewSubjectIdsSnapshot || oldLog.reviewSubjectIdsSnapshot
        : subject ? getSubjectStageReviewSubjectIds(subject, subjectStageId) : [],
      folderSnapshots: getFolderSnapshots(subject?.tagIds || [], tagDefinitions),
      studyDate: updatedLog.studyDate || getLocalDateKey(new Date(updatedLog.timestamp)),
      studyWeekday: updatedLog.studyWeekday ?? new Date(updatedLog.timestamp).getDay()
    };

    setLogs(prev => prev.map(l => l.id === updatedLog.id ? enrichedLog : l));
    setSubjects(prev => prev.map(sub => {
      if (oldLog.subjectId === updatedLog.subjectId && sub.id === updatedLog.subjectId) {
        if (oldLog.reviewParentSubjectId && !oldLog.reviewPageRangeBased) return applyReviewPageCursor(sub, enrichedLog);
        const pageDiff = getLogProgressPages(enrichedLog) - getLogProgressPages(oldLog);
        return adjustSubjectProgress(sub, pageDiff);
      }

      if (oldLog.subjectId !== updatedLog.subjectId && sub.id === oldLog.subjectId) {
        if (oldLog.reviewParentSubjectId && !oldLog.reviewPageRangeBased) return sub;
        return adjustSubjectProgress(sub, -getLogProgressPages(oldLog));
      }

      if (oldLog.subjectId !== updatedLog.subjectId && sub.id === updatedLog.subjectId) {
        if (updatedLog.pageCountIsExplicit) return applySessionEndPage(sub, updatedLog);
        if (updatedLog.reviewParentSubjectId) return applyReviewPageCursor(sub, updatedLog);
        return adjustSubjectProgress(sub, updatedLog.pagesRead);
      }

      return sub;
    }));
  };

  const handleDeleteLog = (logId: string) => {
    const logToDelete = logs.find(log => log.id === logId);
    if (!logToDelete) return;

    openConfirm('학습 기록을 삭제할까요?', '해당 기록의 학습량도 과목 누적 페이지에서 빠집니다.', () => {
      setLogs(prev => {
        const nextLogs = prev.filter(log => log.id !== logId);
        localStorage.setItem('swp_logs', JSON.stringify(nextLogs));
        return nextLogs;
      });
      setSubjects(prev => prev.map(subject => {
        if (subject.id !== logToDelete.subjectId) return subject;
        if (logToDelete.reviewParentSubjectId && !logToDelete.reviewPageRangeBased) return subject;
        return adjustSubjectProgress(subject, -getLogProgressPages(logToDelete));
      }));
    });
  };

  const handleReplaceLogs = (logIds: string[], replacementLog: StudyLog) => {
    const logsToReplace = logs.filter(log => logIds.includes(log.id));
    if (logsToReplace.length === 0) return;

    const subject = subjects.find(item => item.id === replacementLog.subjectId);
    const skipReview = shouldSkipReviewForLog(replacementLog, subject);
    const retainedLog = logsToReplace.find(log => log.subjectId === replacementLog.subjectId);
    const activeStage = subject ? getActiveSubjectStage(subject) : null;
    const subjectStageId = replacementLog.subjectStageId
      || retainedLog?.subjectStageId
      || activeStage?.id
      || subject?.id;
    const enrichedLog: StudyLog = {
      ...withReviewMemoDocument(replacementLog),
      ...(retainedLog && replacementLog.timeAttackMinutes === undefined
        ? resizeSessionTimes(replacementLog.timeSpentMinutes, retainedLog) : {}),
      pageCountIsExplicit: replacementLog.pageCountIsExplicit ?? retainedLog?.pageCountIsExplicit,
      pomodoroSession: replacementLog.pomodoroSession ?? retainedLog?.pomodoroSession,
      subjectNameSnapshot: subject?.name || replacementLog.subjectNameSnapshot || '삭제된 과목',
      subjectStageId,
      subjectStageNameSnapshot: replacementLog.subjectStageNameSnapshot
        || retainedLog?.subjectStageNameSnapshot
        || activeStage?.name
        || subject?.name,
      reviewSubjectIdsSnapshot: replacementLog.reviewSubjectIdsSnapshot
        || retainedLog?.reviewSubjectIdsSnapshot
        || (subject ? getSubjectStageReviewSubjectIds(subject, subjectStageId) : []),
      folderSnapshots: getFolderSnapshots(subject?.tagIds || [], tagDefinitions),
      studyDate: replacementLog.studyDate || getLocalDateKey(new Date(replacementLog.timestamp)),
      studyWeekday: replacementLog.studyWeekday ?? new Date(replacementLog.timestamp).getDay(),
      reviewStep: replacementLog.reviewStep ?? 0,
      nextReviewDate: !skipReview
        ? replacementLog.nextReviewDate ?? new Date(Date.now() + INITIAL_REVIEW_DELAY_MS).toISOString()
        : undefined,
      isCondensed: skipReview,
      reviewEnabled: !skipReview
    };

    // 단위 복습 대기였던 기록을 고쳐 저장하면 대기를 그대로 유지한다(이미 복습에 등록된 기록의 일정은 건드리지 않는다)
    const keepsUnitReviewPending = logsToReplace.some(log => log.unitReviewPending);
    setLogs(prev => {
      const rest = prev.filter(log => !logIds.includes(log.id));
      if (!keepsUnitReviewPending) return [...rest, enrichedLog];
      const result = applyUnitReviewRegistration(subject, rest, enrichedLog);
      return [...result.logs, result.incoming];
    });
    setSubjects(prev => prev.map(subjectItem => {
      const removedPages = logsToReplace
        .filter(log => log.subjectId === subjectItem.id && (!log.reviewParentSubjectId || log.reviewPageRangeBased))
        .reduce((sum, log) => sum + getLogProgressPages(log), 0);
      const addedPages = subjectItem.id === replacementLog.subjectId ? getLogProgressPages(enrichedLog) : 0;

      if (removedPages === 0 && addedPages === 0) return subjectItem;

      return adjustSubjectProgress(subjectItem, -removedPages + addedPages);
    }));
  };

  const handleDeleteLogs = (logIds: string[]) => {
    const logsToDelete = logs.filter(log => logIds.includes(log.id));
    if (logsToDelete.length === 0) return;

    openConfirm('학습 기록을 삭제할까요?', '해당 합산 기록의 학습량도 과목 누적 페이지에서 빠집니다.', () => {
      const idsToDelete = new Set(logIds);
      setLogs(prev => {
        const nextLogs = prev.filter(log => !idsToDelete.has(log.id));
        localStorage.setItem('swp_logs', JSON.stringify(nextLogs));
        return nextLogs;
      });
      setSubjects(prev => prev.map(subjectItem => {
        const removedPages = logsToDelete
          .filter(log => log.subjectId === subjectItem.id && (!log.reviewParentSubjectId || log.reviewPageRangeBased))
          .reduce((sum, log) => sum + getLogProgressPages(log), 0);

        if (removedPages === 0) return subjectItem;

        return adjustSubjectProgress(subjectItem, -removedPages);
      }));
    });
  };

  // 복습 액션 처리 (완료 또는 축약)
  const handleReviewAction = (logIds: string | string[], action: 'complete' | 'condense', reviewTimeSpentMinutes = 0, feedbackGrade?: SubjectGrade) => {
    const targetIds = new Set(Array.isArray(logIds) ? logIds : [logIds]);
    setLogs(prev => {
      const targetLogs = prev.filter(log => targetIds.has(log.id));
      const totalReviewPages = targetLogs.reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0);
      const shouldRecordReviewTime = action === 'complete' && reviewTimeSpentMinutes > 0 && totalReviewPages > 0;
      const completedAt = new Date().toISOString();

      return prev.map(log => {
        if (!targetIds.has(log.id)) return log;

        if (action === 'condense') {
            return { ...log, isCondensed: true };
        }

        // 복습 완료 시 다음 주기 계산. 기본 복습을 마칠 때 고른 난도가 있으면 먼저 그 기록의 과목 단위 기억(FSRS-6)을 갱신한다
        const currentStep = log.reviewStep || 0;
        const nowMs = Date.now();
        const reviewFsrs = feedbackGrade ? gradeSubjectCard(log, feedbackGrade, nowMs) : log.reviewFsrs;
        const schedule = completeRegularReviewSchedule({ ...log, reviewFsrs }, nowMs);
        const reviewTimeShare = shouldRecordReviewTime
          ? reviewTimeSpentMinutes * (Math.max(0, log.pagesRead) / totalReviewPages)
          : 0;

        return {
            ...log,
            isReviewed: true, // 레거시 호환용
            ...(reviewFsrs ? { reviewFsrs } : {}),
            ...schedule,
            reviewTimeSpentMinutes: (log.reviewTimeSpentMinutes || 0) + reviewTimeShare,
            reviewCompletedPages: (log.reviewCompletedPages || 0) + (shouldRecordReviewTime ? Math.max(0, log.pagesRead) : 0),
            basicReviewTimeRecords: shouldRecordReviewTime
              ? [
                ...(log.basicReviewTimeRecords || (
                  (log.reviewTimeSpentMinutes || 0) > 0 && (log.reviewCompletedPages || 0) > 0
                    ? [{
                      minutes: log.reviewTimeSpentMinutes || 0,
                      pages: log.reviewCompletedPages || 0,
                      timestamp: log.timestamp,
                      reviewNumber: Math.max(1, currentStep)
                    }]
                    : []
                )),
                {
                  minutes: reviewTimeShare,
                  pages: Math.max(0, log.pagesRead),
                  timestamp: completedAt,
                  reviewNumber: currentStep + 1
                }
              ]
              : log.basicReviewTimeRecords
        };
      });
    });
  };

  // 학습을 끝내고 "복습에 넣기"를 누르면: 이 과목에서 쌓인 대기 기록(노트 포함)이 한꺼번에 복습으로 들어간다. 누르지 않으면 계속 대기한다.
  const handleRegisterReview = (subjectId: string, grade: SubjectGrade) => {
    // 난도는 이때 고른다: 대기 기록 모두에 그 난도를 매기고(첫 복습 날짜는 FSRS-6가 정한다) 한꺼번에 복습에 넣는다
    setLogs(prev => {
      const now = Date.now();
      return registerPendingReviews(subjectId, gradePendingReviews(prev, subjectId, grade, now), now).logs;
    });
  };

  const handleUpdateReviewMemo = (logId: string, memo: string, document?: ReviewMemoDocument) => {
    setLogs(prev => prev.map(log => log.id === logId
      ? updateReviewGateMemo(log, memo, document, { intake: readEditIntake() })
      : log
    ));
  };

  // 복습에서 뺀 문제: 노트 글은 그대로 두고(논리 이유는 그 줄에 [!]만 붙인다) 기록만 더한다. 되돌리면 [!]를 빼고 기록을 지운다.
  const handleRemoveReviewQuestions = (updates: RemovalUpdate[]) => {
    setLogs(prev => prev.map(log => {
      const update = updates.find(item => item.logId === log.id);
      return update ? applyReviewRemoval(log, update) : log;
    }));
  };

  // 노트 화면의 "복습에 넣지 않기": 고쳐서 복습에 들어간 문제를 빼고, 오류를 고친 것처럼 다시 계산한다
  const handleSkipEditIntake = (logIds: string[]) => {
    const ids = new Set(logIds);
    setLogs(prev => prev.map(log => (ids.has(log.id) ? skipEditIntake(log) : log)));
  };

  const handleRestoreReviewQuestion = (logId: string, key: string) => {
    setLogs(prev => prev.map(log => (log.id === logId ? restoreReviewRemoval(log, key) : log)));
  };

  const handleFinishReviewGate = (outcomes: ReviewGateOutcome[], isRetry: boolean) => {
    const completedAt = Date.now();
    setLogs(prev => applyReviewGateOutcomes(prev, outcomes, isRetry, completedAt));
  };

  const handleClearReviewGateRetries = (logIds: string[]) => {
    setLogs(prev => clearReviewGateRetries(prev, logIds));
  };

  const handleAdvanceReviewSubject = (
    logIds: string[],
    completedReviewSubjectId: string,
    nextReviewSubjectId: string | null,
    reviewTimeSpentMinutes: number,
    measurement: ReviewMeasurement,
    feedbackGrade?: SubjectGrade
  ) => {
    const targetIds = new Set(logIds);
    setLogs(prev => {
      const completedAt = new Date().toISOString();
      const nowMs = Date.now();
      const recorded = recordReviewMeasurement(prev, logIds, completedReviewSubjectId, reviewTimeSpentMinutes, true, completedAt, measurement);
      return recorded.map(source => {
        if (!targetIds.has(source.id)) return source;
        // 한 번의 복습은 한 번만 평가한다: 복습과목이 여러 개면 마지막 복습과목의 난도로 이 기록의 과목 단위 기억(FSRS-6)을 갱신한다
        const log: StudyLog = feedbackGrade && !nextReviewSubjectId ? { ...source, reviewFsrs: gradeSubjectCard(source, feedbackGrade, nowMs) } : source;

        if (nextReviewSubjectId) {
          return {
            ...log,
            reviewSubjectId: nextReviewSubjectId
          };
        }

        return {
          ...log,
          isReviewed: true,
          ...(log.isRepeatReview ? completeRepeatedSubjectReview(log) : completeRegularReviewSchedule(log, nowMs))
        };
      });
    });
  };

  const handleRecordReviewSubjectTime = (
    logIds: string[],
    completedReviewSubjectId: string,
    reviewTimeSpentMinutes: number,
    measurement: ReviewMeasurement
  ) => {
    setLogs(prev => recordReviewMeasurement(prev, logIds, completedReviewSubjectId,
      reviewTimeSpentMinutes, false, new Date().toISOString(), measurement));
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* 커스텀 확인 모달 */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-2xl font-black text-slate-900 mb-4 leading-tight">{confirmModal.message}</h3>
            {confirmModal.subMessage && <p className="text-slate-500 font-medium mb-8 leading-relaxed">{confirmModal.subMessage}</p>}
            <div className="flex gap-4">
              <button 
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} 
                className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black transition-colors"
              >
                취소
              </button>
              <button 
                onClick={confirmModal.onConfirm} 
                className="flex-1 py-4 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black shadow-lg shadow-rose-200 transition-colors"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}

      <nav aria-label="주 메뉴" data-testid="bottom-nav" className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-stretch justify-around gap-2 px-3 py-2">
          {([
            { tab: 'dashboard', icon: '⏱️', label: '학습 실행' },
            { tab: 'settings', icon: '⚙️', label: '학습 설정' },
            { tab: 'history', icon: '📈', label: '추이 분석' }
          ] as const).map(item => (
            <button
              key={item.tab}
              type="button"
              onClick={() => setActiveTab(item.tab)}
              aria-current={activeTab === item.tab ? 'page' : undefined}
              className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[13px] font-bold transition-colors ${activeTab === item.tab ? 'bg-indigo-100 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl p-4 md:px-8 md:py-6 xl:p-10">
        <header className="mb-4 flex flex-col md:flex-row md:items-end justify-between gap-4 xl:mb-8">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 xl:block">
            <h2 className="text-2xl font-black text-slate-900 md:text-[28px] xl:text-3xl">
              {activeTab === 'dashboard' ? '학습 실행' :
               activeTab === 'settings' ? '학습 설정' : '학습 추이 및 리포트'}
            </h2>
            <p className="text-sm font-bold text-slate-600 xl:mt-3 xl:text-2xl xl:font-black xl:tracking-wide xl:text-indigo-500">{todayStr}</p>
            <p data-testid="ai-tip" className="hidden text-sm font-medium text-indigo-700 xl:mt-2 xl:block">"{aiTip}"</p>
          </div>
        </header>

        <div className="transition-all duration-300">
          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-fade-in">
              <div className="mx-auto max-w-5xl">
                <div className="space-y-8">
                  <SessionLogger
                    subjects={subjects}
                    logs={logs}
                    activeWeekday={dashboardWeekday}
                    activeStudyDate={dashboardDate}
                    detailSubjectId={dashboardDetailSubjectId}
                    onDetailSubjectChange={setDashboardDetailSubjectId}
                    renderSummary={(taskSelector, onSelectSubject, completedStudySubjectIds, pomodoroPlan, idle) => (
                      <TodaySummary
                        logs={logs}
                        subjects={subjects}
                        detailSubjectId={dashboardDetailSubjectId}
                        onDetailSubjectChange={onSelectSubject}
                        taskSelector={taskSelector}
                        onOpenSettings={openSettingsFor}
                        completedStudySubjectIds={completedStudySubjectIds}
                        pomodoroPlan={pomodoroPlan}
                        idle={idle}
                        onUpdateReviewMemo={handleUpdateReviewMemo}
                        onRestoreReviewQuestion={handleRestoreReviewQuestion}
                        onSkipEditIntake={handleSkipEditIntake}
                        onRegisterReview={handleRegisterReview}
                        activeWeekday={dashboardWeekday}
                        activeStudyDate={dashboardDate}
                        onAddLog={handleLogSession}
                        onReplaceLogs={handleReplaceLogs}
                        onDeleteLogs={handleDeleteLogs}
                      />
                    )}
                    onLogSession={handleLogSession}
                    onUpdateSubjects={handleUpdateSubjects}
                    onReviewAction={handleReviewAction}
                    onAdvanceReviewSubject={handleAdvanceReviewSubject}
                    onRecordReviewSubjectTime={handleRecordReviewSubjectTime}
                    onUpdateReviewMemo={handleUpdateReviewMemo}
                    onRemoveReviewQuestions={handleRemoveReviewQuestions}
                    onRestoreReviewQuestion={handleRestoreReviewQuestion}
                    onFinishReviewGate={handleFinishReviewGate}
                    onClearReviewGateRetries={handleClearReviewGateRetries}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            // 학습 설정: 폴더·과목을 보고 다루는 한 화면. 새 학습 계획과 새 분석 그룹은 항목 사이(맨 앞·맨 뒤 포함)의 띠를 눌러서 그 자리에 추가한다.
            <div className="space-y-8 animate-fade-in">
              <Analytics
                subjects={subjects}
                logs={logs}
                tagDefinitions={tagDefinitions}
                activeWeekday={activeStudyWeekday}
                activeStudyDate={activeStudyDate}
                onActiveWeekdayChange={setActiveStudyWeekday}
                onUpdateSubject={handleUpdateSubject}
                onUpdateSubjects={handleUpdateSubjects}
                onDeleteSubject={handleDeleteSubject}
                onUpdateTags={handleUpdateTags}
                onAddSubject={handleAddSubject}
                onDeleteFolder={handleDeleteFolder}
                onOpenReview={() => setActiveTab('dashboard')}
                focusSubjectId={settingsFocusSubjectId}
              />
            </div>
          )}

          {activeTab === 'history' && <HistoryCharts subjects={subjects} logs={logs} />}
        </div>
      </main>
    </div>
  );
};

export default App;
