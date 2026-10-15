import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Subject, StudyLog, ReviewMemoDocument, ReviewMeasurement } from '../types';
import {
  calculateBasicReviewGroupTiming,
  calculateRecentCompletedDayAverage,
  calculateTimeAttackAverage,
  calculateReviewSubjectTiming
} from '../utils/math';
import { createRepeatedSubjectReview, getRepeatedReviewRange, getReviewDetailKey, getReviewStartPage } from '../utils/review';
import { createPageMeasurement, getAutoSolvedPageCount, getLogProgressPages, getMeasurementGoalEndPage, getMeasurementRemainingPages, getPomodoroPageTarget, getPomodoroRemainingPages, getSessionTimes, isPomodoroGoalExceeded, POMODORO_MINUTES, PomodoroPlan } from '../utils/measurement';
import { getDueReviewGateRetries, getDueReviewGateQuestionKeys, getReviewGateRetryKeys, getReviewQuestionSchedules, parseReviewGateMemo, ReviewGateOutcome } from '../utils/reviewGate';
import { calculateQuestionPerformance, gradeReviewPractice, startReviewPractice, ReviewPractice } from '../utils/reviewPractice';
import { ReviewQuestionContent } from './ReviewQuestionContent';
import { ReviewNoteSummary } from './ReviewNoteSummary';
import { adjustSubjectProgress, calculateFreshWeekdayPagePlan, getActiveSubjectStage, getAllSubjectReviewIds, getDiffDays, getLocalDateKey, getLogStudyDate, getPastCarryoverPages, getPlanningDayCount, getSubjectDayRemainingPages, getSubjectDayTarget, getSubjectRemainingPageCount, getSubjectStageReviewSubjectIds, getSubjectStages, normalizeWeekdays, WEEKDAYS } from '../utils/schedule';
import { ReviewMemoEditor } from './ReviewMemoEditor';
import { MemoColorTextarea } from './MemoColorTextarea';
import { createSessionMemoRecord, readSessionMemos, writeSessionMemo } from '../utils/sessionMemo';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  activeWeekday: number;
  activeStudyDate: string;
  detailSubjectId: string;
  onDetailSubjectChange: (subjectId: string) => void;
  renderSummary: (taskSelector: React.ReactNode, onSelectSubject: (subjectId: string) => void, completedStudySubjectIds: string[], pomodoroPlan: PomodoroPlan | null) => React.ReactNode;
  onLogSession: (log: StudyLog) => void;
  onUpdateSubjects?: (subjects: Subject[]) => void;
  onReviewAction: (logIds: string[], action: 'complete' | 'condense', reviewTimeSpentMinutes?: number) => void;
  onAdvanceReviewSubject: (logIds: string[], completedReviewSubjectId: string, nextReviewSubjectId: string | null, reviewTimeSpentMinutes: number, measurement: ReviewMeasurement) => void;
  onRecordReviewSubjectTime: (logIds: string[], completedReviewSubjectId: string, reviewTimeSpentMinutes: number, measurement: ReviewMeasurement) => void;
  onUpdateReviewMemo: (logId: string, memo: string, document?: ReviewMemoDocument) => void;
  onFinishReviewGate: (outcomes: ReviewGateOutcome[], isRetry: boolean) => void;
  onClearReviewGateRetries: (logIds: string[]) => void;
  sessionMemoOverrides?: Record<string, string>;
}

interface SessionTimer {
  id: string;
  name: string;
}

interface StudyOrderItem {
  subject: Subject;
  scopedPages: number;
  carryoverPages: number;
  remainingDayPages: number;
  averageTimePerPage: number;
  speedChangePercent: number | null;
  estimatedMinutes: number;
}

interface ReviewQueueGroup {
  id: string;
  parentSubjectId: string;
  parentSubjectName: string;
  subjectId: string;
  subjectName: string;
  subject?: Subject;
  reviewType: 'basic' | 'subject';
  isGateRetry?: boolean;
  reviewSubjectIds: string[];
  logs: StudyLog[];
  earliestReviewTime: number;
  averageTimePerPage: number;
  estimatedMinutes: number;
}

type StudyRunQueueItem =
  | {
      kind: 'review';
      key: string;
      reviewGroup: ReviewQueueGroup;
      isRequired: boolean;
      estimatedMinutes: number;
      name: string;
    }
  | {
      kind: 'study';
      key: string;
      studyItem: StudyOrderItem;
      isRequired: boolean;
      estimatedMinutes: number;
      name: string;
    };

export const getSelectedRunQueueItem = (items: StudyRunQueueItem[], selectedKey: string) => (
  items.find(item => item.key === selectedKey) || items[0]
);

type Step = 'idle' | 'timer' | 'organize' | 'pages';

const formatTime = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const MeasurementProgress: React.FC<{ pages: number; target: number | null; elapsed: string }> = ({ pages, target, elapsed }) => {
  const exceeded = isPomodoroGoalExceeded(pages, target);
  const labelClass = `mb-2 text-xs font-black ${exceeded ? 'text-yellow-300' : 'text-slate-400'}`;
  return <>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={labelClass}>이번 측정</span>
      <span className={`whitespace-nowrap font-mono text-3xl font-black tabular-nums ${exceeded ? 'text-yellow-300' : 'text-indigo-200'}`}>
        {formatPageNumber(pages)} / {target !== null ? formatPageNumber(target) : '-'}P
      </span>
    </span>
    <span className="flex shrink-0 flex-col border-l border-white/10 pl-4">
      <span className={labelClass}>경과 시간</span>
      <span className={`font-mono text-3xl font-black tabular-nums ${exceeded ? 'text-yellow-300' : 'text-white'}`}>{elapsed}</span>
    </span>
  </>;
};

export const PageTimeAttack: React.FC<{ remainingSeconds: number; targetSeconds: number; remainingPages: number | null }> = ({ remainingSeconds, targetSeconds, remainingPages }) => (
  <>
    <p className="mb-2 text-xs font-black text-slate-400">타임어택</p>
    <div className={`font-mono font-black text-white tabular-nums ${targetSeconds > 0 ? 'text-5xl' : 'text-2xl'}`}>
      {targetSeconds > 0 ? formatTime(remainingSeconds) : '측정 필요'}
    </div>
    <p className="mt-2 text-xs font-bold text-indigo-200">
      뽀모도로 {POMODORO_MINUTES}분 · 남은 장수 {remainingPages !== null ? `${formatPageNumber(remainingPages)}P` : '-'}
    </p>
  </>
);

export const OrganizationTimer: React.FC<{ seconds: number; running: boolean; onToggle: () => void; onComplete: () => void }> = ({ seconds, running, onToggle, onComplete }) => (
  <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-5">
    <div className="min-w-0 flex-1">
      <h3 className="text-xl font-black text-white">막힌 부분 정리</h3>
      <p className="mt-2 text-xs font-bold text-slate-400">경과 시간</p>
      <p className="mt-1 font-mono text-4xl font-black tabular-nums text-white">{formatTime(seconds)}</p>
    </div>
    <button type="button" onClick={onToggle} className="rounded-2xl bg-indigo-600 px-5 py-4 text-sm font-black text-white">
      {running ? '일시정지' : '다시 시작'}
    </button>
    <button type="button" onClick={onComplete} className="rounded-2xl bg-rose-100 px-5 py-4 text-sm font-black text-rose-700">완료</button>
  </div>
);

const getRunQueueDetailKey = (item: StudyRunQueueItem) => item.kind === 'review'
  ? getReviewDetailKey(item.reviewGroup.reviewType, item.reviewGroup.parentSubjectId, item.reviewGroup.subjectId)
  : item.studyItem.subject.id;
type TimerMode = 'remainingPages' | 'elapsedTime' | 'sessionMemo';
type PreSessionReviewMode = 'before-study' | 'after-study' | 'interrupt';

interface ActiveReviewRun {
  logIds: string[];
  parentSubjectId: string;
  reviewSubjectIds: string[];
  currentIndex: number;
  sourceName: string;
  startPage?: number;
  stageId?: string;
}

interface GateReviewQuestion {
  id: string;
  questionKey: string;
  logId: string;
  range: string;
  level: number;
  priority: number;
  recallUnits: number;
  providedUnits: number;
  difficulty: number;
}

type GateReviewResult = 'correct' | 'wrong';

const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';
const SESSION_MEMO_COLLAPSED_KEY = 'swp_session_memo_collapsed';
const getSoundSrc = (path: string) => {
  const basePath = new URL('.', window.location.href).pathname;
  return `${basePath}${path}`;
};
const MARKER_SOUND_SRC = getSoundSrc('sounds/marker.mp3');
const PAGE_TURN_SOUND_SRC = getSoundSrc('sounds/page-turn.mp3');
const DEFAULT_SESSION_TIMER: SessionTimer = {
  id: 'none',
  name: '중간 타이머'
};

const soundCache = new Map<string, HTMLAudioElement>();

const getSound = (src: string) => {
  const cached = soundCache.get(src);
  if (cached) return cached;

  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.volume = 1;
  soundCache.set(src, audio);
  return audio;
};

const unlockSound = async (src: string) => {
  const audio = getSound(src);
  try {
    audio.muted = true;
    audio.currentTime = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // iOS Safari may still reject until a direct tap; the normal play call will retry later.
  } finally {
    audio.muted = false;
  }
};

const unlockSounds = () => {
  void (async () => {
    await unlockSound(MARKER_SOUND_SRC);
    await unlockSound(PAGE_TURN_SOUND_SRC);
  })();
};

const playSound = (src: string, startAtSeconds = 0, durationSeconds?: number) => {
  const audio = getSound(src);
  audio.volume = 1;
  audio.muted = false;

  const play = () => {
    audio.pause();
    audio.currentTime = startAtSeconds;
    void audio.play().catch(() => undefined);
    if (durationSeconds) {
      window.setTimeout(() => {
        audio.pause();
        audio.currentTime = startAtSeconds;
      }, durationSeconds * 1000);
    }
  };

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    play();
    return;
  }

  audio.addEventListener('loadedmetadata', play, { once: true });
  audio.load();
};

const playHalfwayPenSound = () => playSound(MARKER_SOUND_SRC, 0.5, 0.2);
const playMarkerSound = () => playSound(MARKER_SOUND_SRC, 0.5);
const playPageTurnSound = () => playSound(PAGE_TURN_SOUND_SRC);

const formatPageNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
};

const calculateEndPageValue = (start: number, amount: number) => {
  const endPage = Number.isInteger(start) && Number.isInteger(amount)
    ? start + amount - 1
    : start + amount;
  return Number(endPage.toFixed(2));
};

const calculateSpeedChangePercent = (logs: StudyLog[]) => {
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

  if (dailySamples.length < 2) return null;

  const firstDay = dailySamples[0];
  const recentFourDays = dailySamples.slice(-4);
  const recentPages = recentFourDays.reduce((sum, day) => sum + day.pages, 0);
  const recentMinutes = recentFourDays.reduce((sum, day) => sum + day.minutes, 0);
  const firstTimePerPage = firstDay.pages > 0 ? firstDay.minutes / firstDay.pages : 0;
  const recentTimePerPage = recentPages > 0 ? recentMinutes / recentPages : 0;

  return firstTimePerPage > 0 && recentTimePerPage > 0
    ? ((firstTimePerPage / recentTimePerPage) - 1) * 100
    : null;
};

const formatReviewRange = (log: StudyLog) => {
  if (typeof log.startPage === 'number' && typeof log.endPage === 'number') {
    return `${formatPageNumber(log.startPage)}~${formatPageNumber(log.endPage)}`;
  }
  return `${formatPageNumber(log.pagesRead)}P`;
};

const getReviewRange = (log: StudyLog) => {
  if (typeof log.startPage === 'number' && typeof log.endPage === 'number') {
    return {
      start: Math.min(log.startPage, log.endPage),
      end: Math.max(log.startPage, log.endPage)
    };
  }
  if (typeof log.endPage === 'number' && log.pagesRead > 0) {
    return {
      start: Math.max(1, log.endPage - log.pagesRead + 1),
      end: log.endPage
    };
  }
  return null;
};

const getAvailableReviewSubjectIds = (reviewSubjectIds: string[], parentSubject: Subject | undefined, sourceSubjects: Subject[]) => (
  Array.from(new Set(reviewSubjectIds))
    .filter(id => id !== parentSubject?.id && sourceSubjects.some(subject => (
      subject.id === id && (getSubjectRemainingPageCount(subject) > 0 || Boolean(subject.reviewStartPage))
    )))
);

const findReviewSubjectOwner = (reviewSubjectId: string, sourceSubjects: Subject[]) => {
  for (const subject of sourceSubjects) {
    if ((subject.reviewSubjectIds || []).includes(reviewSubjectId)) {
      return { subject, stageId: subject.id };
    }

    const followUp = (subject.followUpSubjects || []).find(stage => (
      (stage.reviewSubjectIds || []).includes(reviewSubjectId)
    ));
    if (followUp) return { subject, stageId: followUp.id };
  }

  return null;
};

const getReviewSubjectIdsForLog = (log: StudyLog, parentSubject: Subject | undefined, sourceSubjects: Subject[]) => {
  if (log.isRepeatReview) return sourceSubjects.some(subject => subject.id === log.subjectId) ? [log.subjectId] : [];
  const configuredIds = Array.isArray(log.reviewSubjectIdsSnapshot) && log.reviewSubjectIdsSnapshot.length > 0
    ? log.reviewSubjectIdsSnapshot
    : parentSubject
      ? getSubjectStageReviewSubjectIds(parentSubject, log.subjectStageId || parentSubject.id)
      : [];

  return getAvailableReviewSubjectIds(configuredIds, parentSubject, sourceSubjects);
};

const getEffectiveReviewSubjectId = (log: StudyLog, sourceSubjects: Subject[]) => {
  if (log.isRepeatReview) return log.subjectId;
  const ownerByLogSubject = findReviewSubjectOwner(log.subjectId, sourceSubjects);
  const parentSubject = sourceSubjects.find(subject => subject.id === log.subjectId)
    || ownerByLogSubject?.subject;
  const availableReviewSubjectIds = getReviewSubjectIdsForLog(log, parentSubject, sourceSubjects);

  if (log.reviewSubjectId) {
    if (availableReviewSubjectIds.includes(log.reviewSubjectId)) return log.reviewSubjectId;
    return availableReviewSubjectIds[0] || parentSubject?.id || log.subjectId;
  }

  if (ownerByLogSubject) return log.subjectId;

  return availableReviewSubjectIds[0] || log.subjectId;
};

const getReviewParentSubject = (log: StudyLog, reviewSubjectId: string, sourceSubjects: Subject[]) => {
  if (log.isRepeatReview) return sourceSubjects.find(subject => subject.id === log.reviewParentSubjectId);
  const directSubject = sourceSubjects.find(subject => subject.id === log.subjectId);
  if (directSubject) return directSubject;

  const ownerByLogSubject = findReviewSubjectOwner(log.subjectId, sourceSubjects);
  if (ownerByLogSubject) return ownerByLogSubject.subject;

  return findReviewSubjectOwner(reviewSubjectId, sourceSubjects)?.subject;
};

const compareReviewLogsByRange = (a: StudyLog, b: StudyLog) => {
  const rangeA = getReviewRange(a);
  const rangeB = getReviewRange(b);

  if (rangeA && rangeB) {
    return rangeA.start - rangeB.start || rangeA.end - rangeB.end;
  }
  if (rangeA) return -1;
  if (rangeB) return 1;

  return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
};

const sortReviewLogsByRange = (logs: StudyLog[]) => [...logs].sort(compareReviewLogsByRange);

const formatMergedReviewRanges = (logs: StudyLog[]) => {
  const merged = logs
    .map(getReviewRange)
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<Array<{ start: number; end: number }>>((ranges, range) => {
      const previous = ranges[ranges.length - 1];
      if (previous && range.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, range.end);
        return ranges;
      }
      ranges.push({ ...range });
      return ranges;
    }, []);

  if (merged.length === 0) return logs.map(formatReviewRange).join(', ');
  return merged.map(range => `${formatPageNumber(range.start)}~${formatPageNumber(range.end)}`).join(', ');
};

const readReviewSessionPreferences = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_SESSION_PREF_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeReviewSessionPreference = (subjectId: string, skipReview: boolean) => {
  const preferences = readReviewSessionPreferences();
  preferences[subjectId] = skipReview;
  localStorage.setItem(REVIEW_SESSION_PREF_KEY, JSON.stringify(preferences));
};

const readSessionMemoCollapsed = () => {
  return localStorage.getItem(SESSION_MEMO_COLLAPSED_KEY) === 'true';
};

const writeSessionMemoCollapsed = (collapsed: boolean) => {
  localStorage.setItem(SESSION_MEMO_COLLAPSED_KEY, String(collapsed));
};

const getMemoTextSize = (_text: string) => 'text-lg';

const AutoResizeTextarea = ({
  minHeight = 64,
  maxHeight,
  value,
  className = '',
  style,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number; maxHeight?: number }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const hasContent = String(value ?? '').trim().length > 0;
    textarea.style.height = '0px';
    const contentHeight = Math.max(minHeight + (hasContent ? 24 : 0), textarea.scrollHeight);
    const nextHeight = maxHeight ? Math.min(maxHeight, contentHeight) : contentHeight;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = maxHeight && contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight, minHeight, value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      className={`${className} resize-none`}
      style={{ ...style, minHeight, maxHeight }}
    />
  );
};

const getSubjectStudyPlanForDate = (
  subject: Subject,
  logs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string,
  today = new Date()
) => {
  const { scopedPages, remainingDayPages, carryoverPages } = getSubjectDayRemainingPages(
    subject,
    logs,
    targetWeekday,
    targetStudyDate,
    today
  );
  const subjectLogs = logs.filter(log => (
    log.subjectId === subject.id
    && log.pagesRead > 0
    && log.timeSpentMinutes > 0
  ));
  const measuredAverage = calculateRecentCompletedDayAverage(subjectLogs, remainingDayPages, subject.growthPageUnit).averageTimePerPage;
  const averageTimePerPage = measuredAverage > 0
    ? measuredAverage
    : Math.max(0, subject.initialAverageTimePerPage || 0);
  const estimatedMinutes = remainingDayPages * averageTimePerPage;

  return {
    scopedPages,
    carryoverPages,
    remainingDayPages,
    averageTimePerPage,
    speedChangePercent: calculateSpeedChangePercent(subjectLogs),
    estimatedMinutes
  };
};

export const buildStudyOrderForDate = (
  sourceSubjects: Subject[],
  sourceLogs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string,
  today = new Date()
): StudyOrderItem[] => {
  const todayDateKey = getLocalDateKey(today);
  return sourceSubjects
    .filter(subject => getSubjectRemainingPageCount(subject) > 0)
    .map(subject => {
      const basePlan = getSubjectStudyPlanForDate(subject, sourceLogs, targetWeekday, targetStudyDate, today);
      if (getPlanningDayCount(getDiffDays(subject.targetDate, today)) < 7) {
        return { subject, ...basePlan };
      }
      const rawCarryoverPages = getPastCarryoverPages(subject, sourceLogs, targetStudyDate, todayDateKey);
      const remainingSubjectPages = getSubjectRemainingPageCount(subject);
      const remainingBeforeStudyDate = remainingSubjectPages + basePlan.scopedPages;
      const dayTarget = getSubjectDayTarget(
        subject,
        remainingBeforeStudyDate,
        getDiffDays(subject.targetDate, today),
        targetWeekday,
        today
      );
      const carryoverPaidPages = Math.min(rawCarryoverPages, basePlan.scopedPages);
      const carryoverPages = Math.min(
        remainingSubjectPages,
        Math.max(0, rawCarryoverPages - carryoverPaidPages)
      );
      const activeDayPagesAfterCarryover = Math.max(0, basePlan.scopedPages - carryoverPaidPages);
      const currentDayRemainingPages = Math.max(0, dayTarget - activeDayPagesAfterCarryover);
      const remainingDayPages = Math.min(
        remainingSubjectPages,
        Math.max(0, carryoverPages + currentDayRemainingPages)
      );
      const estimatedMinutes = remainingDayPages * basePlan.averageTimePerPage;

      return {
        subject,
        ...basePlan,
        carryoverPages,
        remainingDayPages,
        estimatedMinutes
      };
    })
    .filter(item => item.remainingDayPages > 0)
    .sort((a, b) => {
      const requiredDiff = Number(Boolean(b.subject.isRequired)) - Number(Boolean(a.subject.isRequired));
      if (requiredDiff !== 0) return requiredDiff;

      const timeDiff = a.estimatedMinutes - b.estimatedMinutes;
      const knownTimeDiff = Number(a.averageTimePerPage <= 0) - Number(b.averageTimePerPage <= 0);
      if (knownTimeDiff !== 0) return knownTimeDiff;
      if (timeDiff !== 0) return timeDiff;

      const pagesDiff = a.remainingDayPages - b.remainingDayPages;
      if (pagesDiff !== 0) return pagesDiff;

      return a.subject.name.localeCompare(b.subject.name, 'ko');
    });
};

export const buildCompletedStudySubjectIds = (
  sourceSubjects: Subject[], sourceLogs: StudyLog[], targetWeekday: number, targetStudyDate: string, today = new Date()
) => {
  const recordedPages = new Map<string, number>();
  sourceLogs.filter(log => getLogStudyDate(log) === targetStudyDate && log.pagesRead > 0).forEach(log => {
    recordedPages.set(log.subjectId, (recordedPages.get(log.subjectId) || 0) + getLogProgressPages(log));
  });
  const subjectsBeforeToday = sourceSubjects.map(subject => adjustSubjectProgress(subject, -(recordedPages.get(subject.id) || 0)));
  const logsBeforeToday = sourceLogs.filter(log => getLogStudyDate(log) !== targetStudyDate);
  const plannedIds = new Set(buildStudyOrderForDate(subjectsBeforeToday, logsBeforeToday, targetWeekday, targetStudyDate, today).map(item => item.subject.id));
  const pendingIds = new Set(buildStudyOrderForDate(sourceSubjects, sourceLogs, targetWeekday, targetStudyDate, today).map(item => item.subject.id));
  return sourceSubjects.filter(subject => recordedPages.has(subject.id) && plannedIds.has(subject.id) && !pendingIds.has(subject.id)).map(subject => subject.id);
};

const getReviewGroupSignature = (logs: StudyLog[]) => (
  logs.map(log => log.id).sort().join('|')
);

export const buildDueReviewGroups = (
  sourceLogs: StudyLog[],
  sourceSubjects: Subject[],
  nowMs: number,
  handledRegularIds: Set<string> = new Set()
): ReviewQueueGroup[] => {
  const groups = new Map<string, ReviewQueueGroup>();

  const seenLogIds = new Set<string>();

  sourceLogs
    .filter(log => {
      const nextReviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : NaN;
      const isDue = log.reviewEnabled !== false
        && !log.isCondensed
        && Number.isFinite(nextReviewTime)
        && nextReviewTime <= nowMs;

      if (!isDue || seenLogIds.has(log.id) || handledRegularIds.has(log.id)) return false;
      seenLogIds.add(log.id);
      return true;
    })
    .sort((a, b) => {
      const timeA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
      const timeB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
      return timeA - timeB;
    })
    .forEach(log => {
      const reviewSubjectId = getEffectiveReviewSubjectId(log, sourceSubjects);
      const parentSubject = getReviewParentSubject(log, reviewSubjectId, sourceSubjects);
      const parentSubjectId = parentSubject?.id || log.subjectId;
      const subject = sourceSubjects.find(item => item.id === reviewSubjectId);
      const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
      const parentSubjectName = parentSubject?.name || log.subjectNameSnapshot || subjectName;
      const reviewType = reviewSubjectId === parentSubjectId ? 'basic' : 'subject';
      const reviewSubjectIds = getReviewSubjectIdsForLog(log, parentSubject, sourceSubjects);
      const reviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : nowMs;
      const reviewSequenceKey = reviewSubjectIds.join('>') || 'basic';
      const gateCompleted = log.reviewGatePendingSteps !== undefined || log.reviewGatePendingResult !== undefined || Boolean(log.reviewSubjectId);
      const groupId = `${parentSubjectId}:${reviewSubjectId}:${reviewSequenceKey}:${gateCompleted ? 'subjects' : 'gate'}${log.isRepeatReview ? `:repeat:${log.id}` : ''}`;
      const group = groups.get(groupId) || {
        id: groupId,
        parentSubjectId,
        parentSubjectName,
        subjectId: reviewSubjectId,
        subjectName,
        subject,
        reviewType,
        reviewSubjectIds,
        logs: [],
        earliestReviewTime: reviewTime,
        averageTimePerPage: 0,
        estimatedMinutes: 0
      };

      group.logs.push(log);
      group.reviewSubjectIds = Array.from(new Set([...group.reviewSubjectIds, ...reviewSubjectIds]));
      group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
      groups.set(groupId, group);
    });

  getDueReviewGateRetries(sourceLogs, nowMs).forEach(log => {
    const subject = sourceSubjects.find(item => item.id === log.subjectId);
    const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
    const groupId = `gate-retry:${log.subjectId}`;
    const retry = log.reviewGateRetry!;
    const reviewTime = Date.parse(retry.dueAt);
    const group: ReviewQueueGroup = groups.get(groupId) || {
      id: groupId,
      parentSubjectId: log.subjectId,
      parentSubjectName: subjectName,
      subjectId: log.subjectId,
      subjectName,
      subject,
      reviewType: 'basic',
      isGateRetry: true,
      reviewSubjectIds: [],
      logs: [],
      earliestReviewTime: reviewTime,
      averageTimePerPage: 0,
      estimatedMinutes: 0
    };
    group.logs.push({ ...log, reviewStep: retry.reviewStep });
    group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
    groups.set(groupId, group);
  });

  const rangeScopedGroups = Array.from(groups.values()).flatMap(group => {
    if (group.isGateRetry || group.reviewType !== 'subject') return [group];

    const clusters = sortReviewLogsByRange(group.logs).reduce<StudyLog[][]>((result, log) => {
      const range = getReviewRange(log);
      const currentCluster = result[result.length - 1];
      const previousRange = currentCluster?.length
        ? getReviewRange(currentCluster[currentCluster.length - 1])
        : null;

      if (currentCluster && range && previousRange && range.start <= previousRange.end + 1) {
        currentCluster.push(log);
      } else {
        result.push([log]);
      }
      return result;
    }, []);

    return clusters.map((clusterLogs, index) => ({
      ...group,
      id: `${group.id}:range-${index}`,
      logs: clusterLogs,
      earliestReviewTime: Math.min(...clusterLogs.map(log => (
        log.nextReviewDate ? Date.parse(log.nextReviewDate) : group.earliestReviewTime
      )))
    }));
  });

  return rangeScopedGroups
    .map(group => {
      const subjectReviewTiming = group.reviewType === 'subject'
        ? calculateReviewSubjectTiming(
          sourceLogs,
          group.parentSubjectId,
          group.subjectId,
          sourceSubjects,
          group.logs,
          group.reviewSubjectIds
        )
        : null;
      const basicReviewTiming = group.reviewType === 'basic'
        ? calculateBasicReviewGroupTiming(
          sourceLogs,
          group.parentSubjectId,
          sourceSubjects,
          group.logs
        )
        : null;
      const estimatedMinutes = basicReviewTiming?.estimatedMinutes
        ?? subjectReviewTiming?.estimatedMinutes ?? 0;
      const averageTimePerPage = basicReviewTiming?.averageTimePerPage
        ?? subjectReviewTiming?.averageTimePerPage ?? 0;

      return {
        ...group,
        logs: sortReviewLogsByRange(group.logs),
        averageTimePerPage,
        estimatedMinutes
      };
    })
    .sort((a, b) => {
      const requiredDiff = Number(Boolean(b.subject?.isRequired)) - Number(Boolean(a.subject?.isRequired));
      if (requiredDiff !== 0) return requiredDiff;

      const knownTimeDiff = Number(a.averageTimePerPage <= 0) - Number(b.averageTimePerPage <= 0);
      if (knownTimeDiff !== 0) return knownTimeDiff;

      const timeDiff = a.estimatedMinutes - b.estimatedMinutes;
      if (timeDiff !== 0) return timeDiff;

      const reviewTimeDiff = a.earliestReviewTime - b.earliestReviewTime;
      if (reviewTimeDiff !== 0) return reviewTimeDiff;

      return a.subjectName.localeCompare(b.subjectName, 'ko');
    });
};

const formatPlanMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0분';
  if (minutes < 60) return `${Math.ceil(minutes)}분`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.ceil(minutes % 60);
  return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

export const buildStudyRunQueue = (reviewGroups: ReviewQueueGroup[], studyOrder: StudyOrderItem[]): StudyRunQueueItem[] => {
  const reviewItems: StudyRunQueueItem[] = reviewGroups.map(group => ({
    kind: 'review', key: `review-${group.id}`, reviewGroup: group,
    isRequired: Boolean(group.subject?.isRequired), estimatedMinutes: group.estimatedMinutes, name: group.subjectName
  }));
  const studyItems: StudyRunQueueItem[] = studyOrder.map(item => ({
    kind: 'study', key: `study-${item.subject.id}`, studyItem: item,
    isRequired: Boolean(item.subject.isRequired), estimatedMinutes: item.estimatedMinutes, name: item.subject.name
  }));
  return [...reviewItems, ...studyItems].sort((a, b) => (
    Number(a.kind !== 'review') - Number(b.kind !== 'review')
    || Number(b.isRequired) - Number(a.isRequired)
    || Number(a.estimatedMinutes <= 0) - Number(b.estimatedMinutes <= 0)
    || a.estimatedMinutes - b.estimatedMinutes
    || a.name.localeCompare(b.name, 'ko')
  ));
};

export const SessionLogger: React.FC<Props> = ({ subjects, logs, activeWeekday, activeStudyDate, detailSubjectId, onDetailSubjectChange, renderSummary, onLogSession, onUpdateSubjects, onReviewAction, onAdvanceReviewSubject, onRecordReviewSubjectTime, onUpdateReviewMemo, onFinishReviewGate, onClearReviewGateRetries, sessionMemoOverrides }) => {
  const reviewSubjectIdSet = useMemo(() => (
    new Set(subjects.flatMap(getAllSubjectReviewIds))
  ), [subjects]);
  const followUpSourceSubjectIdSet = useMemo(() => (
    new Set(subjects.flatMap(subject => (
      (subject.followUpSubjects || []).flatMap(stage => stage.sourceSubjectId ? [stage.sourceSubjectId] : [])
    )))
  ), [subjects]);
  const ordinarySubjects = useMemo(
    () => subjects.filter(subject => (
      !reviewSubjectIdSet.has(subject.id) && !followUpSourceSubjectIdSet.has(subject.id)
    )),
    [followUpSourceSubjectIdSet, reviewSubjectIdSet, subjects]
  );
  const [step, setStep] = useState<Step>('idle');
  const [subjectId, setSubjectId] = useState('');
  const [activeReviewRun, setActiveReviewRun] = useState<ActiveReviewRun | null>(null);
  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const isSubjectReviewDisabled = selectedSubject?.reviewEnabled === false;
  const activeReviewRunLogs = activeReviewRun
    ? logs.filter(log => activeReviewRun.logIds.includes(log.id))
    : [];
  const activeReviewRunMemoItems = sortReviewLogsByRange(activeReviewRunLogs)
    .map(log => ({
      id: log.id,
      range: formatReviewRange(log),
      memo: log.reviewMemo || '',
      document: log.reviewMemoDocument
    }))
    .filter(item => item.memo.trim().length > 0);
  const nextReviewRunSubjectId = activeReviewRun
    ? activeReviewRun.reviewSubjectIds[activeReviewRun.currentIndex + 1] || null
    : null;
  const nextReviewRunSubject = nextReviewRunSubjectId
    ? subjects.find(subject => subject.id === nextReviewRunSubjectId)
    : undefined;

  const [startPage, setStartPage] = useState('');
  const [readAmount, setReadAmount] = useState('');
  const [solvedPageCount, setSolvedPageCount] = useState('');
  const [initialReadAmount, setInitialReadAmount] = useState('');
  const [skipReview, setSkipReview] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [timerMode, setTimerMode] = useState<TimerMode>('remainingPages');
  const [seconds, setSeconds] = useState(0);
  const [studySeconds, setStudySeconds] = useState(0);
  const [organizationSeconds, setOrganizationSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [sessionMemo, setSessionMemo] = useState('');
  const [reviewMemo, setReviewMemo] = useState('');
  const [reviewMemoDocument, setReviewMemoDocument] = useState<ReviewMemoDocument>();
  const [colorMemoColons, setColorMemoColons] = useState(() => localStorage.getItem('swp_memo_colon_colors') !== 'false');
  const [isReviewNotePanelOpen, setIsReviewNotePanelOpen] = useState(false);
  const [isReviewCondensePanelOpen, setIsReviewCondensePanelOpen] = useState(false);
  const [isMemoCollapsed, setIsMemoCollapsed] = useState(readSessionMemoCollapsed);
  const [selectedTaskKey, setSelectedTaskKey] = useState('');
  const [inspectedRecordDetailId, setInspectedRecordDetailId] = useState('');
  const [selectedSessionTimerId, setSelectedSessionTimerId] = useState('none');
  const [attackCompletedPages, setAttackCompletedPages] = useState(0);
  const [pageElapsedSeconds, setPageElapsedSeconds] = useState(0);
  const [pageAttackTargetSeconds, setPageAttackTargetSeconds] = useState(0);
  const [sessionTimerSeconds, setSessionTimerSeconds] = useState<Record<string, number>>({});
  const [sessionTimerCompletedSeconds, setSessionTimerCompletedSeconds] = useState<Record<string, number>>({});
  const [sessionTimerPages, setSessionTimerPages] = useState<Record<string, number>>({});
  const [sessionTimerPageSeconds, setSessionTimerPageSeconds] = useState<Record<string, number[]>>({});
  const [preSessionReviewLogs, setPreSessionReviewLogs] = useState<StudyLog[]>([]);
  const [preSessionReviewDrafts, setPreSessionReviewDrafts] = useState<Record<string, string>>({});
  const [preSessionReviewSeconds, setPreSessionReviewSeconds] = useState(0);
  const [preSessionReviewTargetSeconds, setPreSessionReviewTargetSeconds] = useState(0);
  const [preSessionReviewParentSubjectId, setPreSessionReviewParentSubjectId] = useState('');
  const [preSessionReviewGroup, setPreSessionReviewGroup] = useState<ReviewQueueGroup | null>(null);
  const [isPreSessionReviewRunning, setIsPreSessionReviewRunning] = useState(false);
  const [preSessionReviewSubjectName, setPreSessionReviewSubjectName] = useState('');
  const [preSessionReviewMode, setPreSessionReviewMode] = useState<PreSessionReviewMode>('before-study');
  const [gatePractice, setGatePractice] = useState<ReviewPractice | null>(null);
  const gateQuestionQueue = gatePractice?.queue || [];
  const gateRoundQuestionCount = gatePractice?.roundSize || 0;
  const gateRoundAnsweredCount = gatePractice?.roundAnswered || 0;
  const gateRoundNumber = gatePractice?.round || 1;
  const gateStartedAtRef = useRef(0);
  const [isGateAnswerRevealed, setIsGateAnswerRevealed] = useState(false);
  const [resumeStudyTimerAfterReview, setResumeStudyTimerAfterReview] = useState(false);
  const [dismissedReviewSignature, setDismissedReviewSignature] = useState('');
  const [handledReviewLogIds, setHandledReviewLogIds] = useState<string[]>([]);
  const [, setPostSaveNextSubjectId] = useState<string | null>(null);
  const [pendingImmediateStartSubjectId, setPendingImmediateStartSubjectId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingAutoAdvanceLogId, setPendingAutoAdvanceLogId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef(0);
  const lastAttackSecondRef = useRef(0);
  const activeTimerSecondsRef = useRef<Record<string, number>>({});
  const activeTimerCompletedSecondsRef = useRef<Record<string, number>>({});
  const activeTimerPagesRef = useRef<Record<string, number>>({});
  const activeTimerPageSecondsRef = useRef<Record<string, number[]>>({});
  const currentPageMeasuredSecondsRef = useRef(0);
  const selectedSessionTimerIdRef = useRef('none');
  const gateQuestionCardRef = useRef<HTMLDivElement | null>(null);
  const halfwaySoundPagesRef = useRef<Set<number>>(new Set());
  const markerSoundPagesRef = useRef<Set<number>>(new Set());
  const pageTurnSoundPagesRef = useRef<Set<number>>(new Set());

  const preSessionGateMemoItems = useMemo(() => (
    sortReviewLogsByRange(preSessionReviewLogs).map(log => {
      const memo = preSessionReviewDrafts[log.id] ?? log.reviewMemo ?? '';
      return {
        log,
        memo,
        range: formatReviewRange(log),
        parsed: parseReviewGateMemo(memo),
        criterion: createSessionMemoRecord(sessionMemoOverrides?.[log.subjectId] ?? readSessionMemos()[log.subjectId] ?? '').classificationCriterion
      };
    }).filter(item => item.memo.trim().length > 0)
  ), [preSessionReviewDrafts, preSessionReviewLogs, sessionMemoOverrides, sessionMemo]);

  const gateReviewQuestions = useMemo<GateReviewQuestion[]>(() => (
    preSessionGateMemoItems.flatMap((item): GateReviewQuestion[] => {
      const questionKeys = item.parsed.questions.map(question => question.key);
      const pendingRetryKeys = preSessionReviewGroup?.isGateRetry
        ? new Set(getReviewGateRetryKeys(item.log))
        : new Set(getDueReviewGateQuestionKeys(item.log, gateStartedAtRef.current, true));
      return questionKeys
        .filter(questionKey => !pendingRetryKeys || pendingRetryKeys.has(questionKey))
        .map(questionKey => {
          const question = item.parsed.questions.find(question => question.key === questionKey)!;
          return {
            id: `${item.log.id}:${questionKey}`,
            questionKey,
            logId: item.log.id,
            range: item.range,
            level: question.level,
            priority: question.priority,
            recallUnits: question.recallUnits,
            providedUnits: question.providedUnits,
            difficulty: question.difficulty
          };
        });
    })
  ), [preSessionGateMemoItems, preSessionReviewGroup?.isGateRetry]);

  const gateReviewQuestionSignature = gateReviewQuestions.map(question => question.id).join('|');
  const currentGateQuestion = gateReviewQuestions.find(question => question.id === gateQuestionQueue[0]);
  const isGateReviewComplete = gatePractice !== null && gateQuestionQueue.length === 0;
  const gateWrongCount = Object.values(gatePractice?.wrongCounts || {}).filter(count => count > 0).length;
  const currentGateMemoItem = currentGateQuestion
    ? preSessionGateMemoItems.find(item => item.log.id === currentGateQuestion.logId)
    : undefined;

  const todayStudyOrder = useMemo(
    () => buildStudyOrderForDate(ordinarySubjects, logs, activeWeekday, activeStudyDate),
    [activeStudyDate, activeWeekday, logs, ordinarySubjects]
  );

  const rawDueReviewGroups = useMemo(
    () => buildDueReviewGroups(logs, subjects, nowMs),
    [logs, nowMs, subjects]
  );

  const dueReviewGroups = useMemo(() => {
    const handledIds = new Set(handledReviewLogIds);
    return buildDueReviewGroups(
      logs,
      subjects,
      nowMs,
      handledIds
    );
  }, [handledReviewLogIds, logs, nowMs, subjects]);

  const todayStudyPlanMap = useMemo(() => (
    new Map(todayStudyOrder.map(item => [item.subject.id, item]))
  ), [todayStudyOrder]);

  const runQueueItems = useMemo(
    () => buildStudyRunQueue(dueReviewGroups, todayStudyOrder),
    [dueReviewGroups, todayStudyOrder]
  );
  const selectedRunQueueItem = getSelectedRunQueueItem(runQueueItems, selectedTaskKey);
  const idlePomodoroPlan: PomodoroPlan | null = selectedRunQueueItem ? (() => {
    const taskSubject = selectedRunQueueItem.kind === 'study' ? selectedRunQueueItem.studyItem.subject : selectedRunQueueItem.reviewGroup.subject;
    if (!taskSubject) return null;
    const repeatLog = selectedRunQueueItem.kind === 'review' ? selectedRunQueueItem.reviewGroup.logs.find(log => log.isRepeatReview) : undefined;
    return { subjectId: taskSubject.id, minutes: POMODORO_MINUTES,
      remainingTaskPages: selectedRunQueueItem.kind === 'study' ? selectedRunQueueItem.studyItem.remainingDayPages
        : selectedRunQueueItem.reviewGroup.averageTimePerPage > 0
          ? selectedRunQueueItem.reviewGroup.estimatedMinutes / selectedRunQueueItem.reviewGroup.averageTimePerPage
          : selectedRunQueueItem.reviewGroup.logs.reduce((sum, log) => sum + log.pagesRead, 0),
      pages: getPomodoroPageTarget(selectedRunQueueItem.kind === 'study'
        ? selectedRunQueueItem.studyItem.averageTimePerPage : selectedRunQueueItem.reviewGroup.averageTimePerPage,
        repeatLog ? getRepeatedReviewRange(repeatLog, taskSubject).remainingPages : getMeasurementRemainingPages(taskSubject)) };
  })() : null;
  const completedStudySubjectIds = useMemo(() => buildCompletedStudySubjectIds(
    ordinarySubjects, logs, activeWeekday, activeStudyDate
  ), [ordinarySubjects, logs, activeWeekday, activeStudyDate]);

  const selectSubjectForMeasurement = (subject: Subject) => {
    setSubjectId(subject.id);
  };

  const selectedSubjectLogs = useMemo(
    () => logs.filter(log => log.subjectId === subjectId && log.pagesRead > 0 && log.timeSpentMinutes > 0),
    [logs, subjectId]
  );

  const activeSubjectStage = selectedSubject ? (activeReviewRun?.stageId
    ? getSubjectStages(selectedSubject).find(stage => stage.id === activeReviewRun.stageId) || getActiveSubjectStage(selectedSubject)
    : getActiveSubjectStage(selectedSubject)) : null;
  const aggregateRemainingSubjectPages = selectedSubject ? getSubjectRemainingPageCount(selectedSubject) : 0;
  const reviewStartPage = activeReviewRun?.startPage ?? (selectedSubject ? getReviewStartPage(selectedSubject) || 1 : 1);
  const remainingSubjectPages = activeReviewRun
    ? Math.max(0, (activeSubjectStage?.endPage || selectedSubject?.totalPages || 0) - reviewStartPage + 1)
    : activeSubjectStage?.remainingPages || 0;
  const activeDaySubjectPages = useMemo(
    () => logs
      .filter(log => log.subjectId === subjectId && getLogStudyDate(log) === activeStudyDate)
      .reduce((sum, log) => sum + log.pagesRead, 0),
    [activeStudyDate, logs, subjectId]
  );

  const recommendedDailyPages = useMemo(() => {
    if (!selectedSubject) return 0;
    const selectedPlan = todayStudyPlanMap.get(selectedSubject.id);
    if (selectedPlan) return Math.min(aggregateRemainingSubjectPages, selectedPlan.remainingDayPages);

    const today = new Date();
    const remainingBeforeActiveDay = aggregateRemainingSubjectPages + activeDaySubjectPages;
    const diffDays = getDiffDays(selectedSubject.targetDate, today);
    const dayTarget = getSubjectDayTarget(selectedSubject, remainingBeforeActiveDay, diffDays, activeWeekday, today);
    return Math.min(aggregateRemainingSubjectPages, Math.max(0, dayTarget - activeDaySubjectPages));
  }, [activeDaySubjectPages, activeWeekday, aggregateRemainingSubjectPages, selectedSubject, todayStudyPlanMap]);

  const overallAverage = useMemo(() => {
    const measuredAverage = calculateRecentCompletedDayAverage(
      selectedSubjectLogs,
      recommendedDailyPages, selectedSubject?.growthPageUnit
    ).averageTimePerPage;
    return measuredAverage > 0
      ? measuredAverage
      : Math.max(0, selectedSubject?.initialAverageTimePerPage || 0);
  }, [selectedSubject, selectedSubjectLogs, recommendedDailyPages]);

  const activeReviewTiming = useMemo(() => {
    if (!activeReviewRun || !selectedSubject) return null;
    return calculateReviewSubjectTiming(
      logs,
      activeReviewRun.parentSubjectId,
      selectedSubject.id,
      subjects,
      logs.filter(log => activeReviewRun.logIds.includes(log.id)),
      activeReviewRun.reviewSubjectIds
    );
  }, [activeReviewRun, logs, selectedSubject, subjects]);

  const averageTimePerPage = activeReviewRun ? activeReviewTiming?.averageTimePerPage || 0 : overallAverage;
  const activeReviewAttackTiming = useMemo(() => activeReviewRun && selectedSubject
    ? calculateReviewSubjectTiming(logs, activeReviewRun.parentSubjectId, selectedSubject.id, subjects,
      logs.filter(log => activeReviewRun.logIds.includes(log.id)), activeReviewRun.reviewSubjectIds, true)
    : null, [activeReviewRun, logs, selectedSubject, subjects]);
  const timeAttackAverage = useMemo(() => activeReviewRun ? activeReviewAttackTiming?.averageTimePerPage || 0
    : selectedSubjectLogs.length > 0 ? calculateTimeAttackAverage(selectedSubjectLogs, selectedSubject?.growthPageUnit)
      : Math.max(0, selectedSubject?.initialAverageTimePerPage || 0), [activeReviewRun, activeReviewAttackTiming, selectedSubjectLogs, selectedSubject]);
  const averageSecondsPerPage = timeAttackAverage > 0 ? Math.max(1, Math.round(timeAttackAverage * 60)) : 0;
  const pomodoroPageTarget = getPomodoroPageTarget(averageTimePerPage, remainingSubjectPages);
  const timeTargetPages = attackCompletedPages;
  const progressBasePages = activeReviewRun ? reviewStartPage : activeSubjectStage?.currentPage || 1;
  const progressCurrentPages = activeSubjectStage
    ? Math.min(activeSubjectStage.endPage, progressBasePages + timeTargetPages)
    : progressBasePages + timeTargetPages;
  const goalEndPage = getMeasurementGoalEndPage(progressBasePages, pomodoroPageTarget) || progressBasePages;
  const progressTargetPages = activeSubjectStage ? Math.min(activeSubjectStage.endPage, goalEndPage) : goalEndPage;
  const expectedReadAmount = Math.min(remainingSubjectPages, Math.max(1, timeTargetPages));
  const currentReadAmount = Number(solvedPageCount) || 0;
  const hasPageProgress = currentReadAmount > 0;
  const hasChangedEndPage = readAmount.trim() !== ''
    && initialReadAmount.trim() !== ''
    && Number(readAmount) !== Number(initialReadAmount);
  const currentTimePerPage = currentReadAmount > 0 ? minutes / currentReadAmount : 0;
  const speedDeltaMinutes = currentTimePerPage > 0 && averageTimePerPage > 0
    ? currentTimePerPage - averageTimePerPage
    : 0;
  const previousExpectedPages = averageTimePerPage > 0 ? minutes / averageTimePerPage : 0;
  const actualPages = currentReadAmount;
  const speedRatioPercent = previousExpectedPages > 0 && actualPages > 0
    ? (actualPages / previousExpectedPages) * 100
    : 0;
  const activePageAttackTargetSeconds = pageAttackTargetSeconds > 0 ? pageAttackTargetSeconds : averageSecondsPerPage;
  const pageAttackRemainingSeconds = activePageAttackTargetSeconds > 0
    ? Math.max(0, activePageAttackTargetSeconds - pageElapsedSeconds)
    : 0;
  const hasSessionMemo = false;

  useEffect(() => {
    const refreshNow = () => setNowMs(Date.now());
    const currentTime = Date.now();
    const futureReviewTimes = logs.flatMap(log => {
      const times = [
        log.nextReviewDate ? Date.parse(log.nextReviewDate) : NaN,
        log.reviewGateRetry ? Date.parse(log.reviewGateRetry.dueAt) : NaN
      ];
      return times.filter(time => Number.isFinite(time) && time > currentTime);
    });
    const nextReviewTime = futureReviewTimes.length > 0 ? Math.min(...futureReviewTimes) : null;
    const dueTimer = nextReviewTime === null
      ? null
      : window.setTimeout(refreshNow, Math.max(0, nextReviewTime - currentTime + 50));
    const interval = window.setInterval(refreshNow, 1000);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshNow();
    };

    refreshNow();
    window.addEventListener('focus', refreshNow);
    window.addEventListener('pageshow', refreshNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (dueTimer !== null) window.clearTimeout(dueTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshNow);
      window.removeEventListener('pageshow', refreshNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [logs]);

  useEffect(() => {
    if (handledReviewLogIds.length === 0) return;

    const stillDueIds = new Set(rawDueReviewGroups
      .filter(group => !group.isGateRetry)
      .flatMap(group => group.logs.map(log => log.id)));
    const nextHandledIds = handledReviewLogIds.filter(id => stillDueIds.has(id));

    if (nextHandledIds.length !== handledReviewLogIds.length) {
      setHandledReviewLogIds(nextHandledIds);
    }
  }, [handledReviewLogIds, rawDueReviewGroups]);

  useEffect(() => {
    selectedSessionTimerIdRef.current = selectedSessionTimerId;
  }, [selectedSessionTimerId]);

  useEffect(() => {
    if (!activeReviewRun) {
      setIsReviewNotePanelOpen(false);
      setIsReviewCondensePanelOpen(false);
    }
  }, [activeReviewRun]);

  useEffect(() => {
    if (isTimerRunning) {
      startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        if (startTimeRef.current !== null) {
          const now = Date.now();
          const currentElapsed = Math.floor((now - startTimeRef.current) / 1000);
          setSeconds(accumulatedSecondsRef.current + currentElapsed);
        }
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        if (startTimeRef.current !== null) {
          accumulatedSecondsRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
        }
      }
      startTimeRef.current = null;
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, step]);

  useEffect(() => {
    const times = step === 'organize' ? getSessionTimes(studySeconds, seconds)
      : step === 'pages' ? getSessionTimes(studySeconds, organizationSeconds)
      : getSessionTimes(seconds, organizationSeconds);
    setMinutes(times.timeSpentMinutes);
  }, [seconds, step, studySeconds, organizationSeconds]);

  useEffect(() => {
    if (step !== 'timer') {
      lastAttackSecondRef.current = seconds;
      return;
    }

    const delta = seconds - lastAttackSecondRef.current;
    if (delta <= 0) return;
    lastAttackSecondRef.current = seconds;

    const timerId = selectedSessionTimerIdRef.current;
    activeTimerSecondsRef.current[timerId] =
      (activeTimerSecondsRef.current[timerId] || 0) + delta;
    currentPageMeasuredSecondsRef.current += delta;
    setSessionTimerSeconds(prev => ({
      ...prev,
      [timerId]: activeTimerSecondsRef.current[timerId] || 0
    }));

    if (averageSecondsPerPage <= 0) return;

    setPageElapsedSeconds(prev => {
      let nextElapsed = prev + delta;
      let completed = 0;
      const targetSeconds = activePageAttackTargetSeconds || averageSecondsPerPage;

      while (nextElapsed >= targetSeconds) {
        nextElapsed -= targetSeconds;
        completed += 1;
      }

      if (completed > 0) {
        const completedTimerId = selectedSessionTimerIdRef.current;
        setAttackCompletedPages(current => current + completed);
        setPageAttackTargetSeconds(averageSecondsPerPage);
        const completedSeconds = Math.max(1, currentPageMeasuredSecondsRef.current - nextElapsed);
        activeTimerPagesRef.current[completedTimerId] =
          (activeTimerPagesRef.current[completedTimerId] || 0) + completed;
        activeTimerCompletedSecondsRef.current[completedTimerId] =
          (activeTimerCompletedSecondsRef.current[completedTimerId] || 0) + completedSeconds;
        activeTimerPageSecondsRef.current[completedTimerId] = [
          ...(activeTimerPageSecondsRef.current[completedTimerId] || []),
          completedSeconds
        ];
        currentPageMeasuredSecondsRef.current = Math.max(0, nextElapsed);
        setSessionTimerPages(prev => ({
          ...prev,
          [completedTimerId]: activeTimerPagesRef.current[completedTimerId] || 0
        }));
        setSessionTimerCompletedSeconds(prev => ({
          ...prev,
          [completedTimerId]: activeTimerCompletedSecondsRef.current[completedTimerId] || 0
        }));
        setSessionTimerPageSeconds(prev => ({
          ...prev,
          [completedTimerId]: activeTimerPageSecondsRef.current[completedTimerId] || []
        }));
      }

      return nextElapsed;
    });
  }, [activePageAttackTargetSeconds, averageSecondsPerPage, seconds, selectedSessionTimerId, step]);

  useEffect(() => {
    if (!isTimerRunning || step !== 'timer' || timerMode !== 'remainingPages' || activePageAttackTargetSeconds <= 0) return;

    const currentPageIndex = attackCompletedPages;
    const remainingInPage = pageAttackRemainingSeconds;

    if (remainingInPage <= activePageAttackTargetSeconds / 2 && !halfwaySoundPagesRef.current.has(currentPageIndex)) {
      halfwaySoundPagesRef.current.add(currentPageIndex);
      playHalfwayPenSound();
    }

    if (activePageAttackTargetSeconds > 60 && remainingInPage <= 60 && !markerSoundPagesRef.current.has(currentPageIndex)) {
      markerSoundPagesRef.current.add(currentPageIndex);
      playMarkerSound();
    }

    if (remainingInPage <= 2 && !pageTurnSoundPagesRef.current.has(currentPageIndex)) {
      pageTurnSoundPagesRef.current.add(currentPageIndex);
      playPageTurnSound();
    }
  }, [activePageAttackTargetSeconds, attackCompletedPages, isTimerRunning, pageAttackRemainingSeconds, step, timerMode]);

  useEffect(() => {
    if (!isPreSessionReviewRunning || preSessionReviewLogs.length === 0 || isGateReviewComplete) return;

    const interval = window.setInterval(() => {
      setPreSessionReviewSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isPreSessionReviewRunning, preSessionReviewLogs.length, isGateReviewComplete]);

  useEffect(() => {
    if (!currentGateQuestion || !gateQuestionCardRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      gateQuestionCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentGateQuestion?.id]);

  useEffect(() => {
    if (preSessionReviewLogs.length === 0 || gatePractice) return;
    const unlocked = Object.fromEntries(preSessionReviewLogs.map(log => [log.id,
      preSessionReviewGroup?.isGateRetry
        ? Math.max(log.reviewGateLevel || 1, ...gateReviewQuestions.filter(question => question.logId === log.id).map(question => question.level))
        : log.reviewGateLevel || 1
    ]));
    setGatePractice(startReviewPractice(gateReviewQuestions, unlocked));
  }, [gateReviewQuestionSignature, gateReviewQuestions, gatePractice, preSessionReviewLogs, preSessionReviewGroup?.isGateRetry]);

  useEffect(() => {
    if (!subjectId) return;
    const savedPreference = readReviewSessionPreferences()[subjectId];
    const isLinkedReviewSubject = reviewSubjectIdSet.has(subjectId);
    setSkipReview(savedPreference ?? (isSubjectReviewDisabled || isLinkedReviewSubject));
  }, [subjectId, isSubjectReviewDisabled, reviewSubjectIdSet]);

  useEffect(() => {
    if (!subjectId) {
      setSessionMemo(readSessionMemos().global || '');
      setSelectedSessionTimerId('none');
      selectedSessionTimerIdRef.current = 'none';
      return;
    }
    setSessionMemo(readSessionMemos()[subjectId] || '');
    setSelectedSessionTimerId('none');
    selectedSessionTimerIdRef.current = 'none';
  }, [subjectId]);

  useEffect(() => {
    if (step !== 'idle') return;
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setPreSessionReviewTargetSeconds(0);
    setPreSessionReviewParentSubjectId('');
    setIsPreSessionReviewRunning(false);
    setPreSessionReviewSubjectName('');
    setResumeStudyTimerAfterReview(false);
    setDismissedReviewSignature('');
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(null);
    setSelectedTaskKey('');
    setInspectedRecordDetailId('');
    setSubjectId('');
    setHandledReviewLogIds([]);
    setPendingAutoAdvanceLogId(null);
  }, [activeStudyDate, activeWeekday]);

  useEffect(() => {
    if (step !== 'idle' || pendingImmediateStartSubjectId || preSessionReviewLogs.length > 0) return;
    if (pendingAutoAdvanceLogId && !logs.some(log => log.id === pendingAutoAdvanceLogId)) return;
    if (pendingAutoAdvanceLogId) setPendingAutoAdvanceLogId(null);

    const nextDetailKey = selectedRunQueueItem ? getRunQueueDetailKey(selectedRunQueueItem) : '';
    if (selectedRunQueueItem && selectedTaskKey !== selectedRunQueueItem.key) {
      setSelectedTaskKey(selectedRunQueueItem.key);
    }
    const hasCompletedRecord = logs.some(log => (
      ((completedStudySubjectIds.includes(detailSubjectId) || log.pomodoroSession) && log.subjectId === detailSubjectId && getLogStudyDate(log) === activeStudyDate && log.pagesRead > 0)
      || (detailSubjectId === `basic-review:${log.subjectId}` && log.basicReviewTimeRecords?.some(record => getLocalDateKey(new Date(record.timestamp)) === activeStudyDate))
      || log.reviewSubjectTimeRecords?.some(record => record.subjectId === detailSubjectId && record.completed && getLocalDateKey(new Date(record.timestamp)) === activeStudyDate)
    ));
    if (hasCompletedRecord && inspectedRecordDetailId === detailSubjectId) return;
    if (detailSubjectId !== nextDetailKey) onDetailSubjectChange(nextDetailKey);
  }, [detailSubjectId, logs, onDetailSubjectChange, pendingAutoAdvanceLogId, pendingImmediateStartSubjectId,
      preSessionReviewLogs.length, selectedRunQueueItem, selectedTaskKey, completedStudySubjectIds, activeStudyDate, inspectedRecordDetailId, step]);

  const resetPageAttackTimer = (targetSeconds = 0) => {
    setPageAttackTargetSeconds(targetSeconds > 0 ? targetSeconds : 0);
    setPageElapsedSeconds(0);
    currentPageMeasuredSecondsRef.current = 0;
    halfwaySoundPagesRef.current.delete(attackCompletedPages);
    markerSoundPagesRef.current.delete(attackCompletedPages);
    pageTurnSoundPagesRef.current.delete(attackCompletedPages);
  };

  const getCurrentElapsedSeconds = () => (
    accumulatedSecondsRef.current + (
      startTimeRef.current !== null
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : 0
    )
  );

  const lockElapsedTimeToCurrentTimer = () => {
    if (step !== 'timer') return;
    const currentElapsed = getCurrentElapsedSeconds();
    const delta = currentElapsed - lastAttackSecondRef.current;
    if (delta <= 0) return;

    const timerId = selectedSessionTimerIdRef.current;
    activeTimerSecondsRef.current[timerId] =
      (activeTimerSecondsRef.current[timerId] || 0) + delta;
    currentPageMeasuredSecondsRef.current += delta;
    lastAttackSecondRef.current = currentElapsed;
    setSeconds(currentElapsed);
    setSessionTimerSeconds(prev => ({
      ...prev,
      [timerId]: activeTimerSecondsRef.current[timerId] || 0
    }));
  };

  const resetAll = () => {
    setStep('idle');
    setSeconds(0);
    setStudySeconds(0);
    setOrganizationSeconds(0);
    setAttackCompletedPages(0);
    setPageElapsedSeconds(0);
    setPageAttackTargetSeconds(0);
    setSessionTimerSeconds({});
    setSessionTimerCompletedSeconds({});
    setSessionTimerPages({});
    setSessionTimerPageSeconds({});
    accumulatedSecondsRef.current = 0;
    lastAttackSecondRef.current = 0;
    activeTimerSecondsRef.current = {};
    activeTimerCompletedSecondsRef.current = {};
    activeTimerPagesRef.current = {};
    activeTimerPageSecondsRef.current = {};
    currentPageMeasuredSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setStartPage('');
    setReadAmount('');
    setSolvedPageCount('');
    setInitialReadAmount('');
    setReviewMemo('');
    setReviewMemoDocument(undefined);
    setIsConfirmingCancel(false);
    setTimerMode('remainingPages');
    halfwaySoundPagesRef.current.clear();
    markerSoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
    selectedSessionTimerIdRef.current = 'none';
    setIsReviewNotePanelOpen(false);
    setIsReviewCondensePanelOpen(false);
    setActiveReviewRun(null);
  };

  const handleToggleSkipReview = () => {
    if (!subjectId) return;
    const nextSkipReview = !skipReview;
    setSkipReview(nextSkipReview);
    writeReviewSessionPreference(subjectId, nextSkipReview);
  };

  const handleMemoChange = (memo: string) => {
    setSessionMemo(memo);
    writeSessionMemo(subjectId, memo);
  };

  const toggleMemoCollapsed = () => {
    const next = !isMemoCollapsed;
    setIsMemoCollapsed(next);
    writeSessionMemoCollapsed(next);
  };

  const handleReadAmountChange = (value: string) => {
    setReadAmount(value);
    const amount = value.trim() && startPage.trim() ? getAutoSolvedPageCount(Number(startPage), Number(value)) : null;
    setSolvedPageCount(amount !== null ? String(amount) : '');
  };

  const startMeasurementNow = () => {
    unlockSounds();
    markerSoundPagesRef.current.clear();
    halfwaySoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
    setStudySeconds(0);
    setOrganizationSeconds(0);
    setAttackCompletedPages(0);
    setPageAttackTargetSeconds(averageSecondsPerPage);
    setPageElapsedSeconds(0);
    selectedSessionTimerIdRef.current = 'none';
    setSelectedSessionTimerId('none');
    setSessionTimerSeconds({});
    setSessionTimerCompletedSeconds({});
    setSessionTimerPages({});
    activeTimerSecondsRef.current = {};
    activeTimerCompletedSecondsRef.current = {};
    activeTimerPagesRef.current = {};
    activeTimerPageSecondsRef.current = {};
    setSessionTimerPageSeconds({});
    currentPageMeasuredSecondsRef.current = 0;
    lastAttackSecondRef.current = 0;
    setStep('timer');
    setIsTimerRunning(true);
  };

  const clearPreSessionReview = () => {
    setGatePractice(null);
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setPreSessionReviewTargetSeconds(0);
    setPreSessionReviewParentSubjectId('');
    setPreSessionReviewGroup(null);
    setIsPreSessionReviewRunning(false);
    setPreSessionReviewSubjectName('');
    setResumeStudyTimerAfterReview(false);
    setIsGateAnswerRevealed(false);
  };

  const openPreSessionReview = (group: ReviewQueueGroup, mode: PreSessionReviewMode) => {
    gateStartedAtRef.current = Date.now();
    setGatePractice(null);
    setPreSessionReviewDrafts(
      group.logs.reduce<Record<string, string>>((drafts, log) => {
        drafts[log.id] = log.reviewMemo || '';
        return drafts;
      }, {})
    );
    setPreSessionReviewLogs(group.logs);
    setPreSessionReviewGroup(group);
    setPreSessionReviewSubjectName(group.parentSubjectName || group.subjectName);
    setPreSessionReviewMode(mode);
    setPreSessionReviewSeconds(0);
    setPreSessionReviewTargetSeconds(
      group.estimatedMinutes > 0
        ? Math.max(1, Math.round(group.estimatedMinutes * 60))
        : 0
    );
    setPreSessionReviewParentSubjectId(group.parentSubjectId);
    setIsPreSessionReviewRunning(true);
    setIsGateAnswerRevealed(false);
  };

  const startStudyOrderItem = (item: StudyOrderItem) => {
    selectSubjectForMeasurement(item.subject);
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(item.subject.id);
  };

  const startReviewSubjectMeasurementRun = (group: ReviewQueueGroup) => {
    const parentSubjectId = group.parentSubjectId || group.logs[0]?.subjectId || group.subjectId;
    const parentSubject = subjects.find(subject => subject.id === parentSubjectId);
    const repeatedLog = group.logs.find(log => log.isRepeatReview);
    const reviewSubjectIds = repeatedLog ? [repeatedLog.subjectId] : getAvailableReviewSubjectIds(group.reviewSubjectIds, parentSubject, subjects);

    if (reviewSubjectIds.length === 0) {
      return;
    }

    const currentIndex = Math.max(0, reviewSubjectIds.indexOf(group.subjectId));
    const currentReviewSubject = subjects.find(subject => subject.id === reviewSubjectIds[currentIndex]);
    if (!currentReviewSubject) {
      return;
    }

    setActiveReviewRun({
      logIds: group.logs.map(log => log.id),
      parentSubjectId,
      reviewSubjectIds,
      currentIndex,
      sourceName: parentSubject?.name || group.subjectName,
      startPage: repeatedLog ? getRepeatedReviewRange(repeatedLog, currentReviewSubject).startPage : undefined,
      stageId: repeatedLog ? getRepeatedReviewRange(repeatedLog, currentReviewSubject).stageId : undefined
    });
    selectSubjectForMeasurement(currentReviewSubject);
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(currentReviewSubject.id);
  };

  const startReviewMeasurementRun = (group: ReviewQueueGroup) => {
    if (!group.isGateRetry && group.reviewType === 'subject' && group.logs.every(log => (
      log.reviewGatePendingSteps !== undefined || log.reviewGatePendingResult !== undefined || Boolean(log.reviewSubjectId)
    ))) {
      startReviewSubjectMeasurementRun(group);
      return;
    }
    openPreSessionReview(group, 'before-study');
  };

  const startReviewGroup = (group: ReviewQueueGroup) => {
    setSubjectId('');
    setPostSaveNextSubjectId(null);
    startReviewMeasurementRun(group);
  };

  const handleRefreshStudyPlans = () => {
    if (!onUpdateSubjects) return;

    const resetDateKey = getLocalDateKey();
    const updatedSubjects = subjects.map(subject => ({
      ...subject,
      planResetDate: resetDateKey,
      scheduledWeekdayPages: calculateFreshWeekdayPagePlan(
        subject,
        getSubjectRemainingPageCount(subject),
        getDiffDays(subject.targetDate)
      )
    }));

    onUpdateSubjects(updatedSubjects);
  };

  const handleGateReviewResult = (result: GateReviewResult) => {
    if (!currentGateQuestion || !isGateAnswerRevealed) return;
    setGatePractice(previous => previous ? gradeReviewPractice(previous, gateReviewQuestions, result === 'correct') : previous);
    setIsGateAnswerRevealed(false);
  };

  const renderCurrentGatePrompt = () => {
    if (!currentGateQuestion || !currentGateMemoItem) return null;

    const question = currentGateMemoItem.parsed.questions.find(item => item.key === currentGateQuestion.questionKey);
    return question ? <ReviewQuestionContent question={question} criterion={currentGateMemoItem.criterion}
      revealed={isGateAnswerRevealed} memo={currentGateMemoItem.memo} /> : null;
  };

  const handleCondenseActiveReviewLog = (logId: string) => {
    if (!activeReviewRun) return;

    const nextLogIds = activeReviewRun.logIds.filter(id => id !== logId);
    onReviewAction([logId], 'condense');
    setHandledReviewLogIds(prev => Array.from(new Set([...prev, logId])));

    if (nextLogIds.length === 0) {
      resetAll();
      setSubjectId('');
      setPostSaveNextSubjectId(null);
      return;
    }

    setActiveReviewRun({ ...activeReviewRun, logIds: nextLogIds });
  };

  const finishPreSessionReview = () => {
    if (preSessionReviewLogs.length === 0) return;
    if (!isGateReviewComplete) return;

    const outcomes: ReviewGateOutcome[] = preSessionGateMemoItems.flatMap(item => {
      const itemQuestions = gateReviewQuestions.filter(question => question.logId === item.log.id && gatePractice?.completed.includes(question.id));
      if (itemQuestions.length === 0) return [];
      const wrongQuestionKeys = itemQuestions
        .filter(question => (gatePractice?.wrongCounts[question.id] || 0) > 0)
        .map(question => question.questionKey);
      return [{
        logId: item.log.id,
        passed: wrongQuestionKeys.length === 0,
        wrongQuestionKeys,
        completedQuestionKeys: itemQuestions.map(question => question.questionKey),
        questionResults: Object.fromEntries(itemQuestions.map(question => [question.questionKey, {
          wrongCount: gatePractice?.wrongCounts[question.id] || 0,
          attempts: gatePractice?.attempts[question.id] || 0
        }])),
        unlockedLevel: gatePractice?.unlocked[item.log.id] || 1
      }];
    });
    onFinishReviewGate(outcomes, Boolean(preSessionReviewGroup?.isGateRetry));

    if (preSessionReviewGroup?.isGateRetry) {
      clearPreSessionReview();
      setSelectedTaskKey('');
      setInspectedRecordDetailId('');
      return;
    }

    const finishedLogIds = preSessionReviewLogs.map(log => log.id);
    const reviewGroup = preSessionReviewGroup;
    const parentSubject = reviewGroup
      ? subjects.find(subject => subject.id === reviewGroup.parentSubjectId)
      : undefined;
    const reviewSubjectIds = reviewGroup
      ? getAvailableReviewSubjectIds(reviewGroup.reviewSubjectIds, parentSubject, subjects)
      : [];
    const shouldStartStudyAfterReview = preSessionReviewMode === 'before-study' && subjectId;
    const shouldResumeTimer = preSessionReviewMode === 'interrupt' && resumeStudyTimerAfterReview;

    if (reviewGroup && reviewSubjectIds.length > 0) {
      clearPreSessionReview();
      startReviewSubjectMeasurementRun(reviewGroup);
      return;
    }

    setHandledReviewLogIds(prev => Array.from(new Set([...prev, ...finishedLogIds])));
    onReviewAction(finishedLogIds, 'complete', preSessionReviewSeconds / 60);
    clearPreSessionReview();
    setSelectedTaskKey('');
    setInspectedRecordDetailId('');

    if (shouldStartStudyAfterReview) {
      startMeasurementNow();
      return;
    }

    if (shouldResumeTimer) {
      setIsTimerRunning(true);
      return;
    }

    setSubjectId('');
  };

  const condenseFirstPreSessionReview = () => {
    if (preSessionReviewLogs.length === 0) return;
    const [firstLog, ...remainingLogs] = preSessionReviewLogs;
    if (preSessionReviewGroup?.isGateRetry) {
      onClearReviewGateRetries([firstLog.id]);
    } else {
      setHandledReviewLogIds(prev => Array.from(new Set([...prev, firstLog.id])));
      onReviewAction([firstLog.id], 'condense');
    }
    setPreSessionReviewLogs(remainingLogs);
    setPreSessionReviewGroup(prev => prev ? {
      ...prev,
      logs: prev.logs.filter(log => log.id !== firstLog.id)
    } : prev);
    setGatePractice(null);
    setIsGateAnswerRevealed(false);
    setPreSessionReviewDrafts(prev => {
      const next = { ...prev };
      delete next[firstLog.id];
      return next;
    });
    if (remainingLogs.length === 0) {
      clearPreSessionReview();
    } else {
      const timing = calculateBasicReviewGroupTiming(
        logs,
        preSessionReviewParentSubjectId || firstLog.subjectId,
        subjects,
        remainingLogs
      );
      setPreSessionReviewTargetSeconds(
        timing.estimatedMinutes > 0
          ? Math.max(1, Math.round(timing.estimatedMinutes * 60))
          : 0
      );
    }
  };

  const closePreSessionReview = () => {
    const signature = getReviewGroupSignature(preSessionReviewLogs);
    if (signature) setDismissedReviewSignature(signature);
    const shouldResumeTimer = preSessionReviewMode === 'interrupt' && resumeStudyTimerAfterReview;
    clearPreSessionReview();
    if (shouldResumeTimer) setIsTimerRunning(true);
  };

  useEffect(() => {
    if (step !== 'idle' || !pendingImmediateStartSubjectId || subjectId !== pendingImmediateStartSubjectId) return;

    setPendingImmediateStartSubjectId(null);
    startMeasurementNow();
  }, [pendingImmediateStartSubjectId, step, subjectId]);

  const handleTimerComplete = () => {
    let elapsedSeconds = accumulatedSecondsRef.current;
    if (startTimeRef.current !== null) {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const nextTotalSeconds = accumulatedSecondsRef.current + currentElapsed;
      const missingTimerSeconds = Math.max(0, nextTotalSeconds - seconds);
      accumulatedSecondsRef.current = nextTotalSeconds;
      elapsedSeconds = nextTotalSeconds;
      if (missingTimerSeconds > 0) {
        const timerId = selectedSessionTimerIdRef.current;
        activeTimerSecondsRef.current[timerId] =
          (activeTimerSecondsRef.current[timerId] || 0) + missingTimerSeconds;
      }
      setSeconds(accumulatedSecondsRef.current);
      startTimeRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsTimerRunning(false);
    const completedTimerSeconds = { ...activeTimerSecondsRef.current };
    const completedTimerPageSeconds = { ...activeTimerCompletedSecondsRef.current };
    const completedTimerPages = { ...activeTimerPagesRef.current };
    setSessionTimerSeconds(completedTimerSeconds);
    setSessionTimerCompletedSeconds(completedTimerPageSeconds);
    setSessionTimerPages(completedTimerPages);
    setSessionTimerPageSeconds({ ...activeTimerPageSecondsRef.current });
    if (step === 'timer' && selectedSubject) {
      const nextStartPage = activeReviewRun ? reviewStartPage : activeSubjectStage?.currentPage || selectedSubject.completedPages + 1;
      setStartPage(formatPageNumber(nextStartPage));
      const nextReadAmount = expectedReadAmount > 0
        ? formatPageNumber(calculateEndPageValue(nextStartPage, expectedReadAmount))
        : formatPageNumber(nextStartPage);
      setReadAmount(nextReadAmount);
      setInitialReadAmount(nextReadAmount);
      setSolvedPageCount(formatPageNumber(expectedReadAmount > 0 ? expectedReadAmount : 1));
    }
    if (step === 'timer') {
      setStudySeconds(elapsedSeconds);
      accumulatedSecondsRef.current = organizationSeconds;
      setSeconds(organizationSeconds);
      setStep('organize');
      setIsTimerRunning(true);
    } else {
      setOrganizationSeconds(elapsedSeconds);
      setMinutes(getSessionTimes(studySeconds, elapsedSeconds).timeSpentMinutes);
      setStep('pages');
    }
  };

  const handleReturnToMeasurement = () => {
    if (Number(solvedPageCount) !== attackCompletedPages) {
      setAttackCompletedPages(Math.max(0, Number(solvedPageCount) || 0));
      resetPageAttackTimer(averageSecondsPerPage);
    }
    accumulatedSecondsRef.current = studySeconds;
    lastAttackSecondRef.current = studySeconds;
    setSeconds(studySeconds);
    setStep('timer');
    setIsTimerRunning(true);
  };

  const createCurrentSessionLog = () => {
    const sPage = parseFloat(startPage);
    const endPage = parseFloat(readAmount);
    const measurement = createPageMeasurement(sPage, endPage, Number(solvedPageCount), remainingSubjectPages);
    const shouldSkipReview = skipReview;

    if (measurement === null) {
      alert('끝 페이지와 푼 장수를 확인해주세요.');
      return null;
    }

    return {
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      ...(activeReviewRun ? { reviewParentSubjectId: activeReviewRun.parentSubjectId, reviewPageRangeBased: true } : {}),
      reviewBaselineTimePerPage: activeReviewTiming?.baselineTimePerPage,
      ...measurement,
      pomodoroSession: true,
      ...getSessionTimes(studySeconds, organizationSeconds),
      timestamp: new Date().toISOString(),
      studyDate: activeStudyDate,
      studyWeekday: activeWeekday,
      isReviewed: false,
      isCondensed: shouldSkipReview,
      reviewMemo: reviewMemo || undefined,
      reviewMemoDocument,
      reviewEnabled: !shouldSkipReview
    };
  };

  const getReviewMeasurement = (log: StudyLog): ReviewMeasurement => ({
    pagesRead: log.pagesRead,
    baselineTimePerPage: activeReviewTiming?.baselineTimePerPage || 0,
    timeAttackMinutes: log.timeAttackMinutes,
    baselineTimeAttackPerPage: activeReviewAttackTiming?.baselineTimePerPage || 0,
    lastEndPage: log.endPage!,
    measurementId: log.id
  });

  const handleFinalSave = () => {
    const nextLog = createCurrentSessionLog();
    if (!nextLog) return;

    setPendingAutoAdvanceLogId(null);
    onLogSession(nextLog);
    if (activeReviewRun) onRecordReviewSubjectTime(activeReviewRun.logIds, subjectId, nextLog.timeSpentMinutes, getReviewMeasurement(nextLog));
    resetAll();
    setSubjectId('');
    setPostSaveNextSubjectId(null);
  };

  const handleSwitchToNextReviewSubject = (repeat = false) => {
    if (!activeReviewRun || !selectedSubject) return;

    const completedReviewSubjectId = selectedSubject.id;
    const nextLog = createCurrentSessionLog();
    if (!nextLog) return;

    const savedLog = repeat ? createRepeatedSubjectReview(nextLog, activeReviewRun.parentSubjectId,
      Math.max(0, ...logs.filter(log => activeReviewRun.logIds.includes(log.id)).map(log => log.reviewStep || 0))) : nextLog;
    onLogSession(savedLog);

    const nextId = nextReviewRunSubject ? nextReviewRunSubjectId : null;
    onAdvanceReviewSubject(activeReviewRun.logIds, completedReviewSubjectId, nextId, nextLog.timeSpentMinutes, getReviewMeasurement(nextLog));
    if (nextId === null) {
      setHandledReviewLogIds(prev => Array.from(new Set([...prev, ...activeReviewRun.logIds])));
    }
    resetAll();
    setSelectedTaskKey('');
    setInspectedRecordDetailId('');
    setPendingAutoAdvanceLogId(nextLog.id);
    setSubjectId('');
    setPostSaveNextSubjectId(null);
  };

  const renderPreSessionReviewOverlay = () => preSessionReviewLogs.length > 0 ? (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/90 p-4 md:p-8">
      <div className="mx-auto max-w-3xl rounded-3xl border border-rose-100 bg-white p-4 shadow-2xl md:p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">
              기본 복습{preSessionReviewGroup?.isGateRetry ? ' · 오답' : ''}
            </p>
            <h3 className="mt-1 text-2xl font-black text-slate-900">
              {preSessionReviewSubjectName || selectedSubject?.name || '복습'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {preSessionGateMemoItems.length > 0 && (
              <span className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">
                {isGateReviewComplete ? '모두 완료' : gateReviewQuestions.length > 0
                  ? `${gateRoundAnsweredCount} / ${gateRoundQuestionCount}`
                  : `노트 ${preSessionGateMemoItems.length}개`}
              </span>
            )}
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-right">
              <p className="text-[9px] font-black text-slate-400">경과시간</p>
              <p className="font-mono text-lg font-black text-slate-700">{formatTime(preSessionReviewSeconds)}</p>
            </div>
            <div className="rounded-2xl bg-slate-900 px-3 py-2 text-right">
              <p className="text-[9px] font-black text-rose-300">타임어택</p>
              <p className="font-mono text-lg font-black text-white">
                {preSessionReviewTargetSeconds > 0
                  ? formatTime(Math.max(0, preSessionReviewTargetSeconds - preSessionReviewSeconds))
                  : '--:--'}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-col gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-white md:flex-row md:items-center md:justify-between">
          <div>
            <span className="mr-2 text-[10px] font-black text-indigo-300">복습 범위</span>
            <span className="text-sm font-black">
              {formatMergedReviewRanges(preSessionReviewLogs)}
            </span>
          </div>
          <button
            type="button"
            onClick={condenseFirstPreSessionReview}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-slate-200 transition-all hover:bg-rose-500 hover:text-white"
          >
            앞부분 축약
          </button>
        </div>

        {gateReviewQuestions.length > 0 && !isGateReviewComplete && (
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between text-xs font-black">
              <span className="text-rose-500">
                {gatePractice?.level || 1}단계 · {gateRoundNumber === 1 ? '전체 문제' : `오답 ${gateRoundNumber - 1}회차`}
              </span>
              <span className="text-slate-400">남은 문제 {gateQuestionQueue.length}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-rose-50">
              <div
                className="h-full rounded-full bg-rose-500 transition-all duration-300"
                style={{ width: `${gateRoundQuestionCount > 0 ? (gateRoundAnsweredCount / gateRoundQuestionCount) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="space-y-3">
          {currentGateQuestion && currentGateMemoItem && (
            <div ref={gateQuestionCardRef} className="relative flex min-h-[18rem] scroll-mt-6 flex-col rounded-[2rem] border-2 border-rose-400 bg-white p-5 shadow-xl shadow-rose-100/70 transition-all md:p-7">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-500">
                  {currentGateQuestion.range}
                </span>
              </div>

              <div className="flex flex-1 items-center justify-center py-8">
                <div className="whitespace-pre-wrap text-center text-xl font-black leading-relaxed text-slate-800 md:text-2xl">
                  {renderCurrentGatePrompt()}
                </div>
              </div>

              {!isGateAnswerRevealed ? (
                <button
                  type="button"
                  onClick={() => setIsGateAnswerRevealed(true)}
                  className="mx-auto w-full max-w-sm rounded-2xl bg-slate-900 py-4 text-base font-black text-white shadow-lg"
                >
                  정답 확인
                </button>
              ) : (
                <div className="mx-auto grid w-full max-w-sm grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleGateReviewResult('wrong')}
                    className="rounded-2xl bg-rose-100 py-4 text-base font-black text-rose-600"
                  >
                    오답
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGateReviewResult('correct')}
                    className="rounded-2xl bg-emerald-500 py-4 text-base font-black text-white shadow-lg shadow-emerald-100"
                  >
                    맞음
                  </button>
                </div>
              )}
            </div>
          )}

          {isGateReviewComplete && gateReviewQuestions.length > 0 && (
            <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 px-5 py-6 text-center">
              <p className="text-lg font-black text-emerald-700">기본 복습 완료</p>
              <div className="mt-2 flex justify-center gap-2 text-xs font-black">
                <span className="rounded-full bg-white px-3 py-1.5 text-emerald-600">
                  첫 시도 정답 {(gatePractice?.completed.length || 0) - gateWrongCount}
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 text-rose-500">오답 {gateWrongCount}</span>
              </div>
            </div>
          )}

          {isGateReviewComplete && preSessionGateMemoItems.map(item => {
            const schedules = getReviewQuestionSchedules(item.log);
            const maskedKeys = item.parsed.questions.filter(question => {
              const id = `${item.log.id}:${question.key}`;
              const previous = schedules[question.key];
              return previous?.masked || (previous?.intervalMs || 0) >= 8 * 86400000
                || (gatePractice?.completed.includes(id) && calculateQuestionPerformance(previous,
                  gatePractice.wrongCounts[id] || 0, gatePractice.attempts[id] || 0).masked);
            }).map(question => question.key);
            return <section key={item.log.id} className="space-y-2">
              <h4 className="text-sm font-bold text-slate-500">{item.range} · 정리노트</h4>
              <ReviewNoteSummary memo={item.memo} maskedKeys={maskedKeys} />
            </section>;
          })}

        </div>

        <div className="mt-5 flex gap-3">
          {!isGateReviewComplete && <button
            type="button"
            onClick={() => setIsPreSessionReviewRunning(prev => !prev)}
            className="flex-1 rounded-2xl bg-slate-100 py-4 text-sm font-black text-slate-500"
          >
            {isPreSessionReviewRunning ? '잠시 중단' : '계속 복습'}
          </button>}
          <button
            type="button"
            onClick={closePreSessionReview}
            className="flex-1 rounded-2xl bg-slate-100 py-4 text-sm font-black text-slate-400"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={finishPreSessionReview}
            disabled={!isGateReviewComplete}
            className="flex-[2] rounded-2xl bg-indigo-600 py-4 text-base font-black text-white shadow-lg shadow-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {!isGateReviewComplete
              ? `남은 문제 ${gateQuestionQueue.length}`
              : preSessionReviewGroup && getAvailableReviewSubjectIds(
                preSessionReviewGroup.reviewSubjectIds,
                subjects.find(subject => subject.id === preSessionReviewGroup.parentSubjectId),
                subjects
              ).length > 0
                ? '복습과목 시작'
              : preSessionReviewMode === 'interrupt'
              ? '복습 완료 후 계속'
              : preSessionReviewMode === 'after-study'
                ? '기본 복습 완료'
              : subjectId
                ? '복습 완료 후 학습 시작'
                : '복습 완료'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const taskSelector = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="today-task-select" className="text-sm font-black text-slate-800">오늘 할 일</label>
        <button type="button" onClick={handleRefreshStudyPlans}
          className="text-[10px] font-bold text-slate-400 hover:text-amber-600">
          계획 갱신
        </button>
      </div>
      <select
        id="today-task-select"
        value={selectedRunQueueItem?.key || ''}
        disabled={runQueueItems.length === 0}
        onChange={event => {
          setInspectedRecordDetailId('');
          setSelectedTaskKey(event.target.value);
          const task = runQueueItems.find(item => item.key === event.target.value);
          if (task) onDetailSubjectChange(getRunQueueDetailKey(task));
        }}
        className={`w-full rounded-2xl border bg-slate-100 px-4 py-3 text-base font-black text-slate-800 outline-none transition-all focus:bg-white focus:ring-4 disabled:text-slate-400 ${selectedRunQueueItem?.kind === 'review' ? 'border-rose-200 focus:border-rose-400 focus:ring-rose-500/10' : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-500/10'}`}
      >
        {runQueueItems.length === 0 && <option value="">오늘 할 일이 없습니다.</option>}
        {runQueueItems.map((item, index) => (
          <option key={item.key} value={item.key}>
            {index + 1}. {item.kind === 'review'
              ? `${item.reviewGroup.isGateRetry ? '오답 복습' : item.reviewGroup.reviewType === 'basic' ? '기본 복습' : '과목 복습'} · ${item.name}${item.reviewGroup.parentSubjectName !== item.name ? ` · ${item.reviewGroup.parentSubjectName}` : ''} · ${formatMergedReviewRanges(item.reviewGroup.logs)}`
              : `학습 · ${item.name}${item.isRequired ? ' · 필수' : ''}`}
          </option>
        ))}
      </select>
      {selectedRunQueueItem && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm font-bold text-slate-600">
          {selectedRunQueueItem.kind === 'study' ? (
            <>
              <span>시작 <b className="text-slate-900">p.{formatPageNumber(getActiveSubjectStage(selectedRunQueueItem.studyItem.subject)?.currentPage || selectedRunQueueItem.studyItem.subject.completedPages + 1)}</b></span>
              <span>권장 <b className="text-indigo-600">{formatPageNumber(selectedRunQueueItem.studyItem.remainingDayPages)}P</b></span>
            </>
          ) : (
            <span>범위 <b className="text-rose-600">{formatMergedReviewRanges(selectedRunQueueItem.reviewGroup.logs)}</b></span>
          )}
          <span>필요 <b className="text-slate-900">{selectedRunQueueItem.estimatedMinutes > 0 ? formatPlanMinutes(selectedRunQueueItem.estimatedMinutes) : '측정 필요'}</b></span>
        </div>
      )}
    </div>
  );

  if (step === 'idle') {
    return (
      <div className="animate-fade-in">
        {renderPreSessionReviewOverlay()}
        {renderSummary(taskSelector, nextSubjectId => {
          const matchingTask = runQueueItems.find(item => getRunQueueDetailKey(item) === nextSubjectId);
          setInspectedRecordDetailId(matchingTask ? '' : nextSubjectId);
          if (matchingTask) setSelectedTaskKey(matchingTask.key);
          onDetailSubjectChange(nextSubjectId);
        }, completedStudySubjectIds, idlePomodoroPlan)}
        {selectedRunQueueItem && (
          <button
            type="button"
            onClick={() => selectedRunQueueItem.kind === 'review'
              ? startReviewGroup(selectedRunQueueItem.reviewGroup)
              : startStudyOrderItem(selectedRunQueueItem.studyItem)}
            className={`mt-1 w-full rounded-2xl py-4 text-base font-black text-white transition-all ${selectedRunQueueItem.kind === 'review' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {selectedRunQueueItem.kind === 'review' ? '복습 시작' : '학습 시작'}
          </button>
        )}
      </div>
    );
  }

  const isDark = step === 'timer' || step === 'organize';

  return (
    <div className={`fixed inset-0 flex flex-col items-center overflow-y-auto p-4 ${isDark ? 'bg-slate-950 pt-20 lg:p-8' : 'justify-center bg-white'}`} style={{ zIndex: 9999 }}>
      {renderPreSessionReviewOverlay()}
      <button
        onClick={() => setIsConfirmingCancel(true)}
        className={`fixed top-5 right-5 w-10 h-10 rounded-full flex items-center justify-center shadow-sm active:scale-90 transition-all ${
          isDark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <span className="text-2xl font-bold">×</span>
      </button>

      {isConfirmingCancel && (
        <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[10000]">
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 text-center shadow-xl">
            <h4 className="text-xl font-black text-slate-900 mb-2">학습 측정을 중단할까요?</h4>
            <p className="text-slate-500 text-sm mb-6">기록은 저장되지 않고 사라집니다.</p>
            <div className="flex flex-col gap-3">
              <button onClick={resetAll} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black">네, 취소합니다</button>
              <button onClick={() => setIsConfirmingCancel(false)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">계속 공부할게요</button>
            </div>
          </div>
        </div>
      )}

      <div className={`w-full ${isDark ? 'my-auto max-w-[1440px]' : 'max-w-3xl'}`}>
        {(step === 'timer' || step === 'organize') && (
          <div className="flex w-full flex-col gap-4">
            <main className="order-2 w-full min-w-0" aria-label="학습 노트">
              <div className="w-full space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <button
                    type="button"
                    onClick={toggleMemoCollapsed}
                    aria-expanded={!isMemoCollapsed}
                    className="flex w-full items-center justify-between text-xs font-black text-indigo-200"
                  >
                    <span>세션 메모</span>
                    <span className={`text-lg transition-transform ${isMemoCollapsed ? '' : 'rotate-90'}`}>›</span>
                  </button>
                  {!isMemoCollapsed && (
                    <MemoColorTextarea
                      colorColons={colorMemoColons}
                      dark
                      wrapperClassName="mt-2"
                      value={sessionMemo}
                      onChange={e => handleMemoChange(e.target.value)}
                      placeholder="세션 메모"
                      aria-label="세션 메모"
                      className="h-16 w-full resize-none rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-base font-bold text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500"
                    />
                  )}
                </div>
                {(!skipReview || step === 'organize') && (
                  <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <label className="text-sm font-black text-rose-200">정리노트</label>
                      <button type="button" aria-label="정리노트 색깔 구분" aria-pressed={colorMemoColons}
                        onClick={() => {
                          const next = !colorMemoColons;
                          setColorMemoColons(next);
                          localStorage.setItem('swp_memo_colon_colors', String(next));
                        }}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-bold transition-colors ${colorMemoColons ? 'border-rose-300/30 bg-rose-400/15 text-rose-100' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}>
                        색 {colorMemoColons ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    <ReviewMemoEditor
                      value={reviewMemo}
                      document={reviewMemoDocument}
                      colorColons={colorMemoColons}
                      onChange={(memo, document) => { setReviewMemo(memo); setReviewMemoDocument(document); }}
                      minHeight={320}
                      maxHeight={560}
                      placeholder="정리노트"
                      theme="dark"
                    />
                  </div>
                )}
                {activeReviewRun && activeReviewRunMemoItems.length > 0 && isReviewCondensePanelOpen && timerMode !== 'sessionMemo' && (
                  <div className="rounded-3xl border border-slate-700 bg-white/5 p-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-300">축약</label>
                    <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
                      {activeReviewRunMemoItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleCondenseActiveReviewLog(item.id)}
                          className="rounded-xl border border-slate-600 bg-black/20 px-3 py-2 text-xs font-black text-slate-100 transition-all hover:border-rose-300 hover:bg-rose-500 hover:text-white"
                        >
                          {item.range}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {activeReviewRun && activeReviewRunMemoItems.length > 0 && isReviewNotePanelOpen && timerMode !== 'sessionMemo' && (
                  <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-rose-200">복습 노트</label>
                    <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-rose-300/20 bg-black/20 p-3 pr-2">
                      <div className="space-y-3">
                        {activeReviewRunMemoItems.map(item => (
                          <div key={item.id}>
                            <div className="mb-1 inline-flex rounded-lg bg-rose-400/20 px-2 py-1 text-[10px] font-black text-rose-100">
                              {item.range}
                            </div>
                            <ReviewMemoEditor
                              value={item.memo}
                              document={item.document}
                              colorColons={colorMemoColons}
                              onChange={(memo, document) => onUpdateReviewMemo(item.id, memo, document)}
                              minHeight={64}
                              maxHeight={220}
                              theme="dark"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>
            <aside className="order-1 w-full" aria-label="학습 시간 측정">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${
                activeReviewRun ? 'bg-rose-500/10 text-rose-300' : 'bg-indigo-500/10 text-indigo-400'
              }`}>
                {activeReviewRun ? '과목 복습 측정 중' : '측정 중'}
              </span>
              {activeReviewRun ? (
                <div className="min-w-0 text-xs font-black">
                  <p className="truncate text-sm text-rose-200">{activeReviewRun.sourceName} 복습</p>
                  <p className="truncate text-xl text-white md:text-2xl">{selectedSubject?.name}</p>
                </div>
              ) : (
                <p className="text-xl font-black text-white md:text-2xl">{selectedSubject?.name}</p>
              )}
                {activeReviewRun && (
                  <div className="ml-auto flex gap-2">
                    {activeReviewRunMemoItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsReviewNotePanelOpen(prev => !prev)}
                        className={`rounded-2xl px-4 py-2 text-xs font-black transition-all ${
                          isReviewNotePanelOpen
                            ? 'bg-rose-500 text-white'
                            : 'bg-white/10 text-rose-100 hover:bg-rose-500 hover:text-white'
                        }`}
                      >
                        {isReviewNotePanelOpen ? '노트 닫기' : '노트 보기'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsReviewCondensePanelOpen(prev => !prev)}
                      className={`rounded-2xl px-4 py-2 text-xs font-black transition-all ${
                        isReviewCondensePanelOpen
                          ? 'bg-slate-100 text-slate-900'
                          : 'bg-white/10 text-slate-200 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      축약
                    </button>
                  </div>
                )}
            </div>
            {step === 'organize' ? <OrganizationTimer seconds={seconds} running={isTimerRunning}
              onToggle={() => setIsTimerRunning(current => !current)} onComplete={handleTimerComplete} /> : (
            <div className="flex flex-wrap items-stretch gap-3 rounded-3xl border border-white/10 bg-white/5 p-3">
                <button
                  type="button"
                  onClick={() => setTimerMode('remainingPages')}
                  aria-pressed={timerMode === 'remainingPages'}
                  className={`flex min-w-[13rem] flex-1 flex-col justify-center rounded-2xl border px-4 py-3 text-left transition-colors ${timerMode === 'remainingPages' ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-transparent bg-black/10 hover:bg-white/5'}`}
                >
                  <PageTimeAttack remainingSeconds={pageAttackRemainingSeconds} targetSeconds={activePageAttackTargetSeconds}
                    remainingPages={getPomodoroRemainingPages(pomodoroPageTarget, timeTargetPages)} />
                </button>
                <button
                  type="button"
                  onClick={() => setTimerMode('elapsedTime')}
                  aria-pressed={timerMode === 'elapsedTime'}
                  className={`flex min-w-[22rem] flex-1 items-center gap-4 rounded-2xl border px-4 py-3 text-left transition-colors ${timerMode === 'elapsedTime' ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-transparent bg-black/10 hover:bg-white/5'}`}
                >
                  <MeasurementProgress pages={timeTargetPages} target={pomodoroPageTarget} elapsed={formatTime(seconds)} />
                </button>
              <div className="flex min-w-[12rem] flex-1 items-center rounded-2xl bg-black/10 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-xs font-black text-slate-400">학습 진척도</p>
                  {!activeReviewRun && activeSubjectStage && (
                    <p className="mb-2 text-xs font-black text-indigo-200">
                      p.{formatPageNumber(activeSubjectStage.startPage)}~{formatPageNumber(activeSubjectStage.endPage)}
                    </p>
                  )}
                  <div className="whitespace-nowrap font-mono text-3xl font-black text-white tabular-nums">
                    {averageTimePerPage > 0
                      ? activeReviewRun
                        ? `${formatPageNumber(progressCurrentPages)}P`
                        : `${formatPageNumber(progressCurrentPages)} / ${formatPageNumber(progressTargetPages)}P`
                      : '-'}
                  </div>
                  <button type="button" disabled={timeTargetPages >= remainingSubjectPages} onClick={() => {
                    lockElapsedTimeToCurrentTimer();
                    setAttackCompletedPages(current => current + 1);
                    resetPageAttackTimer(averageSecondsPerPage);
                  }} className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-black text-indigo-200 hover:bg-white/20 disabled:opacity-40">
                    다음 장
                  </button>
                </div>
              </div>
            <div className="flex min-w-[18rem] flex-1 items-center gap-2">
              <button
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className={`flex-1 rounded-2xl px-3 py-4 text-sm font-black shadow-lg ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'}`}
              >
                {isTimerRunning ? '일시정지' : '다시 시작'}
              </button>
              <button
                onClick={handleToggleSkipReview}
                className={`shrink-0 rounded-2xl border-2 px-3 py-4 text-xs font-black shadow-sm transition-all ${
                  skipReview
                    ? 'bg-rose-100 text-rose-500 border-2 border-rose-500'
                    : 'bg-emerald-100 text-emerald-600 border-2 border-emerald-500'
                }`}
              >
                <span>{skipReview ? '복습 제외' : '복습 포함'}</span>
              </button>
              <button onClick={handleTimerComplete} className="flex-1 rounded-2xl bg-rose-100 px-3 py-4 text-sm font-black text-rose-700 shadow-lg transition-colors hover:bg-rose-200">완료</button>
            </div>
            </div>
            )}

            </aside>
          </div>
        )}

        {step === 'pages' && (
          <div className="flex flex-col items-center">
            <div className="mb-4 flex w-full items-center justify-between gap-3">
              <h3 className="text-2xl font-black text-slate-900">학습량 입력</h3>
              <button
                type="button"
                onClick={handleReturnToMeasurement}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 shadow-sm transition-colors hover:border-indigo-300 hover:text-indigo-600"
              >
                ← 측정으로 돌아가기
              </button>
            </div>
            {activeReviewRun && (
              <div className="mb-4 w-full rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-center">
                <p className="text-xs font-black text-rose-500">
                  {activeReviewRun.sourceName} 복습 · {selectedSubject?.name}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-4 mb-4 w-full bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <div className="space-y-2">
                <label htmlFor="session-end-page" className="text-[10px] font-black text-indigo-500 uppercase ml-2 tracking-widest">완료된 끝 페이지</label>
                <input
                  id="session-end-page"
                  type="number"
                  step="1"
                  value={readAmount}
                  onChange={e => handleReadAmountChange(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-full p-4 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-2xl font-black text-3xl text-center outline-none transition-all shadow-sm text-indigo-900"
                />
                <p className="px-2 text-center text-[10px] font-bold text-slate-400">
                  시작 p.{formatPageNumber(parseFloat(startPage) || 0)} · 학습량 {currentReadAmount > 0 ? formatPageNumber(currentReadAmount) : '0'}P
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="session-solved-pages" className="ml-2 text-xs font-black text-indigo-500">푼 장수</label>
                <input id="session-solved-pages" type="number" min="1" step="1" value={solvedPageCount}
                  onChange={e => setSolvedPageCount(e.target.value)}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white p-4 text-center text-3xl font-black text-indigo-900 outline-none focus:border-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{activeReviewRun ? '이번 학습량' : '현재 페이지'}</p>
                  <p className="mt-1 text-xl font-black text-indigo-600">
                    {currentReadAmount > 0 ? `${formatPageNumber(currentReadAmount)}P` : '0P'}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">현재 시간</p>
                  <p className="mt-1 text-xl font-black text-slate-700">
                    {formatTime(studySeconds + organizationSeconds)}
                  </p>
                  <p className="mt-1 text-[10px] font-bold text-slate-400">
                    풀이 {formatTime(studySeconds)} · 정리 {formatTime(organizationSeconds)}
                  </p>
                </div>
              </div>
              <div className="hidden">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-indigo-500">세션 메모</label>
                  <button
                    type="button"
                    onClick={toggleMemoCollapsed}
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-lg font-black text-indigo-500 shadow-sm transition-transform"
                    title={isMemoCollapsed ? '메모 열기' : '메모 닫기'}
                  >
                    <span className={`transition-transform ${isMemoCollapsed ? '' : 'rotate-90'}`}>›</span>
                  </button>
                </div>
                {!isMemoCollapsed && (
                  <>
                    <MemoColorTextarea
                      colorColons={colorMemoColons}
                      wrapperClassName="mt-3"
                      value={sessionMemo}
                      onChange={e => handleMemoChange(e.target.value)}
                      placeholder="다음 세션에서 이어볼 내용..."
                      className={`h-28 w-full resize-none rounded-xl border border-indigo-100 bg-white p-4 font-bold text-slate-700 outline-none focus:border-indigo-500 ${getMemoTextSize(sessionMemo)}`}
                    />
                    <p className="mt-2 text-center text-[10px] font-bold text-slate-400">과목별로 자동 저장됩니다.</p>
                  </>
                )}
              </div>
            </div>

            <div className={activeReviewRun ? 'grid w-full gap-3 sm:grid-cols-3' : 'w-full'}>
              <button onClick={handleFinalSave} className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-lg shadow-lg">
                저장 완료
              </button>
              {activeReviewRun && (
                <button onClick={() => handleSwitchToNextReviewSubject()} className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-rose-100">
                  복습 완료
                </button>
              )}
              {activeReviewRun && <button onClick={() => handleSwitchToNextReviewSubject(true)}
                className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 py-4 text-lg font-black text-indigo-700 shadow-sm">
                완료 후 다시 예약
              </button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
