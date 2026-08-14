import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Subject, StudyLog, TagDefinition } from '../types';
import { calculateRecentCompletedDayAverage } from '../utils/math';
import { getDiffDays, getLogStudyDate, getSubjectDayTarget, normalizeWeekdays, WEEKDAYS } from '../utils/schedule';

interface Props {
  subjects: Subject[];
  tagDefinitions: TagDefinition[];
  logs: StudyLog[];
  activeWeekday: number;
  activeStudyDate: string;
  onLogSession: (log: StudyLog) => void;
  onReviewAction: (logIds: string[], action: 'complete' | 'condense') => void;
  onUpdateReviewMemo: (logId: string, memo: string) => void;
}

interface SessionTimer {
  id: string;
  name: string;
}

interface StudyOrderItem {
  subject: Subject;
  scopedPages: number;
  remainingDayPages: number;
  averageTimePerPage: number;
  estimatedMinutes: number;
}

interface ReviewQueueGroup {
  subjectId: string;
  subjectName: string;
  subject?: Subject;
  logs: StudyLog[];
  earliestReviewTime: number;
  estimatedMinutes: number;
}

type Step = 'idle' | 'timer' | 'pages';
type TimerMode = 'remainingPages' | 'elapsedTime' | 'sessionMemo';
type PreSessionReviewMode = 'before-study' | 'interrupt';

const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';
const SESSION_MEMO_KEY = 'swp_session_memos';
const SESSION_MEMO_COLLAPSED_KEY = 'swp_session_memo_collapsed';
const getSoundSrc = (path: string) => {
  const basePath = new URL('.', window.location.href).pathname;
  return `${basePath}${path}`;
};
const MARKER_SOUND_SRC = getSoundSrc('sounds/marker.mp3');
const PAGE_TURN_SOUND_SRC = getSoundSrc('sounds/page-turn.mp3');
const UNKNOWN_AVERAGE_MINUTES_PER_PAGE = 10;
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

const calculateAmountFromEndPage = (start: number, end: number) => {
  const amount = Number.isInteger(start) && Number.isInteger(end)
    ? end - start + 1
    : end - start;
  return Number(amount.toFixed(2));
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

const readSessionMemos = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_MEMO_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeSessionMemo = (subjectId: string, memo: string) => {
  const memos = readSessionMemos();
  memos[subjectId || 'global'] = memo;
  localStorage.setItem(SESSION_MEMO_KEY, JSON.stringify(memos));
};

const readSessionMemoCollapsed = () => {
  return localStorage.getItem(SESSION_MEMO_COLLAPSED_KEY) === 'true';
};

const writeSessionMemoCollapsed = (collapsed: boolean) => {
  localStorage.setItem(SESSION_MEMO_COLLAPSED_KEY, String(collapsed));
};

const getMemoTextSize = (text: string) => {
  if (text.length > 220) return 'text-sm';
  if (text.length > 120) return 'text-base';
  return 'text-lg';
};

const getSubjectStudyPlanForDate = (
  subject: Subject,
  logs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string,
  today = new Date()
) => {
  const remainingPages = Math.max(0, subject.totalPages - subject.completedPages);
  const scopedPages = logs
    .filter(log => log.subjectId === subject.id && getLogStudyDate(log) === targetStudyDate)
    .reduce((sum, log) => sum + log.pagesRead, 0);
  const remainingBeforeStudyDate = remainingPages + scopedPages;
  const diffDays = getDiffDays(subject.targetDate, today);
  const dayTarget = getSubjectDayTarget(subject, remainingBeforeStudyDate, diffDays, targetWeekday);
  const remainingDayPages = Math.min(remainingPages, Math.max(0, dayTarget - scopedPages));
  const subjectLogs = logs.filter(log => (
    log.subjectId === subject.id
    && log.pagesRead > 0
    && log.timeSpentMinutes > 0
  ));
  const averageTimePerPage = calculateRecentCompletedDayAverage(subjectLogs, remainingDayPages).averageTimePerPage;
  const estimatedMinutes = remainingDayPages * (
    averageTimePerPage > 0 ? averageTimePerPage : UNKNOWN_AVERAGE_MINUTES_PER_PAGE
  );

  return {
    scopedPages,
    remainingDayPages,
    averageTimePerPage,
    estimatedMinutes
  };
};

const buildStudyOrderForDate = (
  sourceSubjects: Subject[],
  sourceLogs: StudyLog[],
  targetWeekday: number,
  targetStudyDate: string
): StudyOrderItem[] => {
  const today = new Date();
  return sourceSubjects
    .filter(subject => subject.completedPages < subject.totalPages)
    .filter(subject => normalizeWeekdays(subject.scheduledWeekdays).includes(targetWeekday))
    .map(subject => ({
      subject,
      ...getSubjectStudyPlanForDate(subject, sourceLogs, targetWeekday, targetStudyDate, today)
    }))
    .filter(item => item.remainingDayPages > 0)
    .sort((a, b) => {
      const requiredDiff = Number(Boolean(b.subject.isRequired)) - Number(Boolean(a.subject.isRequired));
      if (requiredDiff !== 0) return requiredDiff;

      const timeDiff = a.estimatedMinutes - b.estimatedMinutes;
      if (timeDiff !== 0) return timeDiff;

      const pagesDiff = a.remainingDayPages - b.remainingDayPages;
      if (pagesDiff !== 0) return pagesDiff;

      return a.subject.name.localeCompare(b.subject.name, 'ko');
    });
};

const getReviewGroupSignature = (logs: StudyLog[]) => (
  logs.map(log => log.id).sort().join('|')
);

const buildDueReviewGroups = (
  sourceLogs: StudyLog[],
  sourceSubjects: Subject[],
  nowMs: number
): ReviewQueueGroup[] => {
  const groups = new Map<string, ReviewQueueGroup>();

  sourceLogs
    .filter(log => {
      const nextReviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : NaN;
      return log.reviewEnabled !== false
        && !log.isCondensed
        && Number.isFinite(nextReviewTime)
        && nextReviewTime <= nowMs;
    })
    .sort((a, b) => {
      const timeA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
      const timeB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
      return timeA - timeB;
    })
    .forEach(log => {
      const subject = sourceSubjects.find(item => item.id === log.subjectId);
      const subjectName = subject?.name || log.subjectNameSnapshot || '삭제된 과목';
      const reviewTime = log.nextReviewDate ? new Date(log.nextReviewDate).getTime() : nowMs;
      const group = groups.get(log.subjectId) || {
        subjectId: log.subjectId,
        subjectName,
        subject,
        logs: [],
        earliestReviewTime: reviewTime,
        estimatedMinutes: 0
      };

      group.logs.push(log);
      group.earliestReviewTime = Math.min(group.earliestReviewTime, reviewTime);
      groups.set(log.subjectId, group);
    });

  return Array.from(groups.values())
    .map(group => {
      const timedLogs = sourceLogs.filter(log => (
        log.subjectId === group.subjectId
        && log.pagesRead > 0
        && log.timeSpentMinutes > 0
      ));
      const reviewPages = group.logs.reduce((sum, log) => sum + log.pagesRead, 0);
      const averageTimePerPage = calculateRecentCompletedDayAverage(timedLogs, reviewPages).averageTimePerPage
        || UNKNOWN_AVERAGE_MINUTES_PER_PAGE;

      return {
        ...group,
        estimatedMinutes: reviewPages * averageTimePerPage
      };
    })
    .sort((a, b) => {
      const requiredDiff = Number(Boolean(b.subject?.isRequired)) - Number(Boolean(a.subject?.isRequired));
      if (requiredDiff !== 0) return requiredDiff;

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

export const SessionLogger: React.FC<Props> = ({ subjects, tagDefinitions, logs, activeWeekday, activeStudyDate, onLogSession, onReviewAction, onUpdateReviewMemo }) => {
  const measurableSubjects = subjects.filter(subject => subject.completedPages < subject.totalPages);
  const [step, setStep] = useState<Step>('idle');
  const [subjectId, setSubjectId] = useState('');
  const [folderPathIds, setFolderPathIds] = useState<string[]>([]);
  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const isSubjectReviewDisabled = selectedSubject?.reviewEnabled === false;

  const [startPage, setStartPage] = useState('');
  const [readAmount, setReadAmount] = useState('');
  const [initialReadAmount, setInitialReadAmount] = useState('');
  const [skipReview, setSkipReview] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [plannedPageCount, setPlannedPageCount] = useState(0);
  const [timerMode, setTimerMode] = useState<TimerMode>('remainingPages');
  const [seconds, setSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [sessionMemo, setSessionMemo] = useState('');
  const [reviewMemo, setReviewMemo] = useState('');
  const [isMemoCollapsed, setIsMemoCollapsed] = useState(readSessionMemoCollapsed);
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
  const [isPreSessionReviewRunning, setIsPreSessionReviewRunning] = useState(false);
  const [preSessionReviewSubjectName, setPreSessionReviewSubjectName] = useState('');
  const [preSessionReviewMode, setPreSessionReviewMode] = useState<PreSessionReviewMode>('before-study');
  const [resumeStudyTimerAfterReview, setResumeStudyTimerAfterReview] = useState(false);
  const [dismissedReviewSignature, setDismissedReviewSignature] = useState('');
  const [postSaveNextSubjectId, setPostSaveNextSubjectId] = useState<string | null>(null);
  const [pendingImmediateStartSubjectId, setPendingImmediateStartSubjectId] = useState<string | null>(null);
  const [selectedReviewSubjectId, setSelectedReviewSubjectId] = useState('');
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
  const halfwaySoundPagesRef = useRef<Set<number>>(new Set());
  const markerSoundPagesRef = useRef<Set<number>>(new Set());
  const pageTurnSoundPagesRef = useRef<Set<number>>(new Set());

  const todayStudyOrder = useMemo(
    () => buildStudyOrderForDate(subjects, logs, activeWeekday, activeStudyDate),
    [activeStudyDate, activeWeekday, logs, subjects]
  );

  const activeWeekdayLabel = WEEKDAYS.find(day => day.id === activeWeekday)?.label || '';
  const dayPlanTotalMinutes = useMemo(
    () => todayStudyOrder.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    [todayStudyOrder]
  );

  const dueReviewGroups = useMemo(
    () => buildDueReviewGroups(logs, subjects, nowMs),
    [logs, nowMs, subjects]
  );

  const selectedReviewGroup = selectedReviewSubjectId
    ? dueReviewGroups.find(group => group.subjectId === selectedReviewSubjectId)
    : undefined;

  const todayStudyRankMap = useMemo(() => (
    new Map(todayStudyOrder.map((item, index) => [item.subject.id, index]))
  ), [todayStudyOrder]);

  const todayStudyPlanMap = useMemo(() => (
    new Map(todayStudyOrder.map(item => [item.subject.id, item]))
  ), [todayStudyOrder]);

  const orderedMeasurableSubjects = useMemo(() => {
    const activeWeekdaySubjects = measurableSubjects.filter(subject => (
      normalizeWeekdays(subject.scheduledWeekdays).includes(activeWeekday)
    ));

    return [...activeWeekdaySubjects].sort((a, b) => {
      const rankA = todayStudyRankMap.get(a.id);
      const rankB = todayStudyRankMap.get(b.id);
      const hasRankA = rankA !== undefined;
      const hasRankB = rankB !== undefined;

      if (hasRankA && hasRankB) return rankA - rankB;
      if (hasRankA) return -1;
      if (hasRankB) return 1;

      return a.name.localeCompare(b.name, 'ko');
    });
  }, [activeWeekday, measurableSubjects, todayStudyRankMap]);

  const recommendedTodayStudy = todayStudyOrder[0] || null;
  const postSaveNextSubject = postSaveNextSubjectId
    ? subjects.find(subject => subject.id === postSaveNextSubjectId)
    : undefined;

  const getFolderPathForSubject = (subject: Subject) => {
    const firstTagId = subject.tagIds?.[0];
    const path: string[] = [];
    const visited = new Set<string>();
    let currentFolder = firstTagId
      ? tagDefinitions.find(folder => folder.id === firstTagId)
      : undefined;

    while (currentFolder && !visited.has(currentFolder.id)) {
      visited.add(currentFolder.id);
      path.unshift(currentFolder.id);
      currentFolder = currentFolder.parentId
        ? tagDefinitions.find(folder => folder.id === currentFolder?.parentId)
        : undefined;
    }

    return path;
  };

  const selectSubjectForMeasurement = (subject: Subject) => {
    setSelectedReviewSubjectId('');
    setFolderPathIds(getFolderPathForSubject(subject));
    setSubjectId(subject.id);
  };

  const selectedSubjectLogs = useMemo(
    () => logs.filter(log => log.subjectId === subjectId && log.pagesRead > 0 && log.timeSpentMinutes > 0),
    [logs, subjectId]
  );

  const remainingSubjectPages = selectedSubject
    ? Math.max(0, selectedSubject.totalPages - selectedSubject.completedPages)
    : 0;

  const activeDaySubjectPages = useMemo(
    () => logs
      .filter(log => log.subjectId === subjectId && getLogStudyDate(log) === activeStudyDate)
      .reduce((sum, log) => sum + log.pagesRead, 0),
    [activeStudyDate, logs, subjectId]
  );

  const recommendedDailyPages = useMemo(() => {
    if (!selectedSubject) return 0;
    const today = new Date();
    const remainingBeforeActiveDay = remainingSubjectPages + activeDaySubjectPages;
    const diffDays = getDiffDays(selectedSubject.targetDate, today);
    const dayTarget = getSubjectDayTarget(selectedSubject, remainingBeforeActiveDay, diffDays, activeWeekday);
    return Math.min(remainingSubjectPages, Math.max(0, dayTarget - activeDaySubjectPages));
  }, [activeDaySubjectPages, activeWeekday, selectedSubject, remainingSubjectPages]);

  const overallAverage = useMemo(
    () => calculateRecentCompletedDayAverage(selectedSubjectLogs, recommendedDailyPages).averageTimePerPage,
    [selectedSubjectLogs, recommendedDailyPages]
  );

  const dueReviewLogsForSelectedSubject = useMemo(() => {
    if (!subjectId || isSubjectReviewDisabled) return [];
    const now = Date.now();
    return logs
      .filter(log => {
        if (log.subjectId !== subjectId || log.isCondensed || log.reviewEnabled === false || !log.nextReviewDate) return false;
        const reviewTime = new Date(log.nextReviewDate).getTime();
        return Number.isFinite(reviewTime) && reviewTime <= now;
      })
      .sort((a, b) => {
        const timeA = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : 0;
        const timeB = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : 0;
        return timeA - timeB;
      });
  }, [logs, subjectId, isSubjectReviewDisabled]);

  const averageTimePerPage = overallAverage;

  const averageSecondsPerPage = averageTimePerPage > 0 ? Math.max(1, Math.round(averageTimePerPage * 60)) : 0;
  const plannedPages = Math.max(1, plannedPageCount);
  const timeTargetPages = attackCompletedPages;
  const progressBasePages = (selectedSubject?.completedPages || 0) + 1;
  const progressCurrentPages = progressBasePages + timeTargetPages;
  const progressTargetPages = progressBasePages + plannedPages;
  const expectedReadAmount = averageTimePerPage > 0
    ? Math.min(remainingSubjectPages, Math.max(1, timeTargetPages))
    : Math.min(remainingSubjectPages, plannedPages);
  const currentReadAmount = startPage && readAmount
    ? calculateAmountFromEndPage(parseFloat(startPage), parseFloat(readAmount))
    : 0;
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
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    selectedSessionTimerIdRef.current = selectedSessionTimerId;
  }, [selectedSessionTimerId]);

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
  }, [isTimerRunning]);

  useEffect(() => {
    setMinutes(parseFloat((seconds / 60).toFixed(2)));
  }, [seconds]);

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
    if (!isPreSessionReviewRunning || preSessionReviewLogs.length === 0) return;

    const interval = window.setInterval(() => {
      setPreSessionReviewSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isPreSessionReviewRunning, preSessionReviewLogs.length]);

  useEffect(() => {
    if (!subjectId) return;
    const savedPreference = readReviewSessionPreferences()[subjectId];
    setSkipReview(savedPreference ?? isSubjectReviewDisabled);
  }, [subjectId, isSubjectReviewDisabled]);

  useEffect(() => {
    setPlannedPageCount(Math.max(1, recommendedDailyPages));
  }, [subjectId, recommendedDailyPages]);

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
    if (subjectId && !orderedMeasurableSubjects.some(subject => subject.id === subjectId)) {
      setSubjectId('');
    }
  }, [orderedMeasurableSubjects, subjectId]);

  useEffect(() => {
    if (step !== 'idle') return;

    if (dueReviewGroups.length === 0) {
      if (selectedReviewSubjectId) setSelectedReviewSubjectId('');
      return;
    }

    if (subjectId || pendingImmediateStartSubjectId) return;

    if (!selectedReviewSubjectId || !dueReviewGroups.some(group => group.subjectId === selectedReviewSubjectId)) {
      setSelectedReviewSubjectId(dueReviewGroups[0].subjectId);
      setFolderPathIds([]);
      setSubjectId('');
    }
  }, [dueReviewGroups, pendingImmediateStartSubjectId, selectedReviewSubjectId, step, subjectId]);

  useEffect(() => {
    if (step !== 'idle' || !subjectId) return;

    const stillHasScheduledWork = todayStudyOrder.some(item => item.subject.id === subjectId);
    if (stillHasScheduledWork) return;

    const nextStudy = todayStudyOrder[0];
    if (nextStudy) {
      selectSubjectForMeasurement(nextStudy.subject);
      return;
    }

    setFolderPathIds([]);
    setSubjectId('');
  }, [step, subjectId, todayStudyOrder, tagDefinitions]);

  useEffect(() => {
    if (step !== 'idle') return;
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setIsPreSessionReviewRunning(false);
    setPreSessionReviewSubjectName('');
    setResumeStudyTimerAfterReview(false);
    setDismissedReviewSignature('');
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(null);
    setSelectedReviewSubjectId('');
    setFolderPathIds([]);
    setSubjectId('');
    setPendingAutoAdvanceLogId(null);
  }, [activeStudyDate, activeWeekday]);

  useEffect(() => {
    if (step !== 'idle' || subjectId || dueReviewGroups.length > 0) return;

    const isWaitingForSavedLog = pendingAutoAdvanceLogId
      ? !logs.some(log => log.id === pendingAutoAdvanceLogId)
      : false;

    if (isWaitingForSavedLog) return;

    if (!recommendedTodayStudy) {
      if (pendingAutoAdvanceLogId) setPendingAutoAdvanceLogId(null);
      return;
    }

    if (pendingAutoAdvanceLogId) setPendingAutoAdvanceLogId(null);
    selectSubjectForMeasurement(recommendedTodayStudy.subject);
  }, [dueReviewGroups.length, logs, pendingAutoAdvanceLogId, recommendedTodayStudy, step, subjectId, tagDefinitions]);

  useEffect(() => {
    if (folderPathIds.some(folderId => !tagDefinitions.some(folder => folder.id === folderId))) {
      setFolderPathIds([]);
      setSubjectId('');
    }
  }, [folderPathIds, tagDefinitions]);

  const hasMeasurableSubjectInFolder = (folderId: string): boolean => {
    const childFolderIds = tagDefinitions
      .filter(folder => folder.parentId === folderId)
      .map(folder => folder.id);

    return orderedMeasurableSubjects.some(subject => subject.tagIds?.includes(folderId))
      || childFolderIds.some(hasMeasurableSubjectInFolder);
  };

  const getSelectableFolders = (parentId?: string) => tagDefinitions
    .filter(folder => folder.parentId === parentId)
    .filter(folder => hasMeasurableSubjectInFolder(folder.id));

  const getSelectableSubjects = (parentId?: string) => orderedMeasurableSubjects.filter(subject => (
    parentId
      ? subject.tagIds?.includes(parentId)
      : !subject.tagIds || subject.tagIds.length === 0
  ));

  const selectionLevels = Array.from({ length: folderPathIds.length + 1 }, (_, index) => {
    const parentId = index === 0 ? undefined : folderPathIds[index - 1];
    return {
      index,
      parentId,
      folders: getSelectableFolders(parentId),
      subjects: getSelectableSubjects(parentId)
    };
  }).filter(level => level.index === 0 || level.folders.length > 0 || level.subjects.length > 0);

  const handleFolderSelectionChange = (levelIndex: number, value: string) => {
    const basePath = folderPathIds.slice(0, levelIndex);
    setSubjectId('');
    setSelectedReviewSubjectId('');

    if (!value) {
      setFolderPathIds(basePath);
      return;
    }

    const [kind, id] = value.split(':');
    if (kind === 'review') {
      setFolderPathIds([]);
      setSubjectId('');
      setSelectedReviewSubjectId(id);
      return;
    }

    if (kind === 'folder') {
      setFolderPathIds([...basePath, id]);
      return;
    }

    setFolderPathIds(basePath);
    setSubjectId(id);
  };

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
    setInitialReadAmount('');
    setReviewMemo('');
    setIsConfirmingCancel(false);
    setTimerMode('remainingPages');
    halfwaySoundPagesRef.current.clear();
    markerSoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
    selectedSessionTimerIdRef.current = 'none';
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
  };

  const startMeasurementNow = () => {
    unlockSounds();
    markerSoundPagesRef.current.clear();
    halfwaySoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
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
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setIsPreSessionReviewRunning(false);
    setPreSessionReviewSubjectName('');
    setResumeStudyTimerAfterReview(false);
  };

  const openPreSessionReview = (group: ReviewQueueGroup, mode: PreSessionReviewMode) => {
    setPreSessionReviewDrafts(
      group.logs.reduce<Record<string, string>>((drafts, log) => {
        drafts[log.id] = log.reviewMemo || '';
        return drafts;
      }, {})
    );
    setPreSessionReviewLogs(group.logs);
    setPreSessionReviewSubjectName(group.subjectName);
    setPreSessionReviewMode(mode);
    setPreSessionReviewSeconds(0);
    setIsPreSessionReviewRunning(true);
  };

  const handleStartMeasurement = () => {
    if (selectedReviewGroup) {
      openPreSessionReview(selectedReviewGroup, 'before-study');
      return;
    }

    if (!subjectId) {
      alert('과목을 먼저 선택해주세요.');
      return;
    }

    if (dueReviewGroups.length > 0) {
      openPreSessionReview(dueReviewGroups[0], 'before-study');
      return;
    }

    startMeasurementNow();
  };

  const handlePreSessionReviewMemoChange = (logId: string, memo: string) => {
    setPreSessionReviewDrafts(prev => ({ ...prev, [logId]: memo }));
    onUpdateReviewMemo(logId, memo);
  };

  const finishPreSessionReview = () => {
    if (preSessionReviewLogs.length === 0) return;
    const finishedIds = new Set(preSessionReviewLogs.map(log => log.id));
    const nextReviewGroup = dueReviewGroups.find(group => (
      group.logs.every(log => !finishedIds.has(log.id))
    ));
    const shouldStartStudyAfterReview = preSessionReviewMode === 'before-study' && subjectId;
    const shouldResumeTimer = preSessionReviewMode === 'interrupt' && resumeStudyTimerAfterReview;

    onReviewAction(preSessionReviewLogs.map(log => log.id), 'complete');
    clearPreSessionReview();

    if (nextReviewGroup) {
      setSelectedReviewSubjectId(nextReviewGroup.subjectId);
      setSubjectId('');
      setFolderPathIds([]);
      openPreSessionReview(nextReviewGroup, preSessionReviewMode);
      return;
    }

    if (shouldStartStudyAfterReview) {
      startMeasurementNow();
      return;
    }

    setSelectedReviewSubjectId('');
    setFolderPathIds([]);
    setSubjectId('');
    if (shouldResumeTimer) setIsTimerRunning(true);
  };

  const condenseFirstPreSessionReview = () => {
    if (preSessionReviewLogs.length === 0) return;
    const [firstLog, ...remainingLogs] = preSessionReviewLogs;
    onReviewAction([firstLog.id], 'condense');
    setPreSessionReviewLogs(remainingLogs);
    setPreSessionReviewDrafts(prev => {
      const next = { ...prev };
      delete next[firstLog.id];
      return next;
    });
    if (remainingLogs.length === 0) {
      const condensedIds = new Set([firstLog.id]);
      const nextReviewGroup = dueReviewGroups.find(group => (
        group.logs.every(log => !condensedIds.has(log.id))
      ));

      if (nextReviewGroup) {
        openPreSessionReview(nextReviewGroup, preSessionReviewMode);
        return;
      }

      clearPreSessionReview();
    }
  };

  const closePreSessionReview = () => {
    const signature = getReviewGroupSignature(preSessionReviewLogs);
    if (signature) setDismissedReviewSignature(signature);
    const shouldResumeTimer = preSessionReviewMode === 'interrupt' && resumeStudyTimerAfterReview;
    clearPreSessionReview();
    if (shouldResumeTimer) setIsTimerRunning(true);
  };

  const handleStartNextRecommended = () => {
    if (!postSaveNextSubject) return;
    const nextPlan = todayStudyPlanMap.get(postSaveNextSubject.id);
    selectSubjectForMeasurement(postSaveNextSubject);
    setPlannedPageCount(Math.max(1, nextPlan?.remainingDayPages || 1));
    setPostSaveNextSubjectId(null);
    setPendingImmediateStartSubjectId(postSaveNextSubject.id);
  };

  useEffect(() => {
    if (step !== 'timer' || preSessionReviewLogs.length > 0 || dueReviewGroups.length === 0) return;

    const nextReviewGroup = dueReviewGroups[0];
    const signature = getReviewGroupSignature(nextReviewGroup.logs);
    if (signature && signature === dismissedReviewSignature) return;

    setResumeStudyTimerAfterReview(isTimerRunning);
    setIsTimerRunning(false);
    openPreSessionReview(nextReviewGroup, 'interrupt');
  }, [dismissedReviewSignature, dueReviewGroups, isTimerRunning, preSessionReviewLogs.length, step]);

  useEffect(() => {
    if (step !== 'idle' || !pendingImmediateStartSubjectId || subjectId !== pendingImmediateStartSubjectId) return;

    setPendingImmediateStartSubjectId(null);
    if (dueReviewGroups.length > 0) {
      openPreSessionReview(dueReviewGroups[0], 'before-study');
      return;
    }

    startMeasurementNow();
  }, [dueReviewGroups, pendingImmediateStartSubjectId, step, subjectId]);

  const handleTimerComplete = () => {
    if (startTimeRef.current !== null) {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const nextTotalSeconds = accumulatedSecondsRef.current + currentElapsed;
      const missingTimerSeconds = Math.max(0, nextTotalSeconds - seconds);
      accumulatedSecondsRef.current = nextTotalSeconds;
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
    if (selectedSubject) {
      const nextStartPage = selectedSubject.completedPages + 1;
      setStartPage(formatPageNumber(nextStartPage));
      const nextReadAmount = expectedReadAmount > 0
        ? formatPageNumber(calculateEndPageValue(nextStartPage, expectedReadAmount))
        : formatPageNumber(nextStartPage);
      setReadAmount(nextReadAmount);
      setInitialReadAmount(nextReadAmount);
    }
    setStep('pages');
  };

  const handleFinalSave = () => {
    const sPage = parseFloat(startPage);
    const endPage = parseFloat(readAmount);
    const amount = calculateAmountFromEndPage(sPage, endPage);
    const shouldSkipReview = skipReview && reviewMemo.trim().length === 0;

    if (isNaN(sPage) || isNaN(endPage) || isNaN(amount) || amount <= 0) {
      alert('완료된 끝 페이지를 정확히 입력해주세요.');
      return;
    }

    if (amount > remainingSubjectPages) {
      alert(`현재 과목의 남은 학습량은 ${formatPageNumber(remainingSubjectPages)}페이지입니다.`);
      return;
    }

    const nextLog: StudyLog = {
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: amount,
      startPage: sPage,
      endPage,
      timeSpentMinutes: minutes,
      timestamp: new Date().toISOString(),
      studyDate: activeStudyDate,
      studyWeekday: activeWeekday,
      isReviewed: false,
      isCondensed: shouldSkipReview,
      reviewMemo: !shouldSkipReview ? reviewMemo.trim() : undefined
    };

    const nextLogs = [...logs, nextLog];
    const nextSubjects = subjects.map(subject => (
      subject.id === subjectId
        ? { ...subject, completedPages: Math.min(subject.totalPages, subject.completedPages + amount) }
        : subject
    ));
    const nextRecommendedStudy = buildStudyOrderForDate(
      nextSubjects,
      nextLogs,
      activeWeekday,
      activeStudyDate
    )[0];

    setPendingAutoAdvanceLogId(null);
    onLogSession(nextLog);
    resetAll();
    if (nextRecommendedStudy) {
      selectSubjectForMeasurement(nextRecommendedStudy.subject);
      setPostSaveNextSubjectId(nextRecommendedStudy.subject.id);
    } else {
      setFolderPathIds([]);
      setSubjectId('');
      setPostSaveNextSubjectId(null);
    }
  };

  const renderPreSessionReviewOverlay = () => preSessionReviewLogs.length > 0 ? (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/90 p-4 md:p-8">
      <div className="mx-auto max-w-3xl rounded-3xl border border-rose-100 bg-white p-4 shadow-2xl md:p-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">복습 우선</p>
            <h3 className="mt-1 text-2xl font-black text-slate-900">
              {preSessionReviewSubjectName || selectedSubject?.name || '복습'} 먼저 복습
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">
              {preSessionReviewLogs.length}개 복습
            </span>
            <span className="rounded-2xl bg-slate-900 px-3 py-2 font-mono text-lg font-black text-white">
              {formatTime(preSessionReviewSeconds)}
            </span>
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

        <div className="space-y-2">
          {preSessionReviewLogs.map(log => (
            <div key={log.id} className="rounded-2xl border border-rose-100 bg-rose-50/70 p-2">
              <p className="mb-1 text-xs font-black text-rose-500">{formatReviewRange(log)}</p>
              <textarea
                value={preSessionReviewDrafts[log.id] ?? log.reviewMemo ?? ''}
                onChange={e => handlePreSessionReviewMemoChange(log.id, e.target.value)}
                placeholder="복습 핵심어를 확인하거나 수정하세요."
                className="h-24 w-full resize-none rounded-xl border border-rose-100 bg-white p-3 text-lg font-bold leading-snug text-slate-800 outline-none focus:border-rose-500"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => setIsPreSessionReviewRunning(prev => !prev)}
            className="flex-1 rounded-2xl bg-slate-100 py-4 text-sm font-black text-slate-500"
          >
            {isPreSessionReviewRunning ? '잠시 중단' : '계속 복습'}
          </button>
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
            className="flex-[2] rounded-2xl bg-indigo-600 py-4 text-base font-black text-white shadow-lg shadow-indigo-100"
          >
            {preSessionReviewMode === 'interrupt'
              ? '복습 완료 후 계속'
              : subjectId
                ? '복습 완료 후 학습 시작'
                : '복습 완료'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (step === 'idle') {
    return (
      <div className="animate-fade-in">
        {renderPreSessionReviewOverlay()}
        <h2 className="mb-5 flex items-center gap-2 text-xl font-black text-slate-800">
          <span className="h-5 w-2 rounded-full bg-indigo-500"></span>
          학습 세션 시작
        </h2>
        <div className="mx-auto max-w-2xl space-y-4">
          {postSaveNextSubject && (
            <div className="rounded-[1.75rem] border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">저장 완료</p>
                  <h3 className="mt-1 truncate text-lg font-black text-slate-900">다음 추천: {postSaveNextSubject.name}</h3>
                  <p className="mt-1 text-xs font-bold text-emerald-600">
                    {formatPageNumber(todayStudyPlanMap.get(postSaveNextSubject.id)?.remainingDayPages || 0)}P · {formatPlanMinutes(todayStudyPlanMap.get(postSaveNextSubject.id)?.estimatedMinutes || 0)}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleStartNextRecommended}
                  className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-100"
                >
                  바로 시작
                </button>
                <button
                  type="button"
                  onClick={() => setPostSaveNextSubjectId(null)}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-400"
                >
                  취소
                </button>
              </div>
            </div>
          )}
          <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-5">
            <label className="mb-3 block px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">측정할 과목 선택</label>
            <div className="rounded-3xl border border-slate-200 bg-white p-3">
              <div className="space-y-3">
                {selectionLevels.map(level => {
                  const selectedFolder = folderPathIds[level.index];
                  const parentMatchesSelectedSubject = selectedSubject && (
                    level.parentId
                      ? selectedSubject.tagIds?.includes(level.parentId)
                      : !selectedSubject.tagIds || selectedSubject.tagIds.length === 0
                  );
                  const value = selectedFolder
                    ? `folder:${selectedFolder}`
                    : level.index === 0 && selectedReviewGroup
                      ? `review:${selectedReviewGroup.subjectId}`
                      : parentMatchesSelectedSubject
                      ? `subject:${selectedSubject.id}`
                      : '';

                  return (
                    <select
                      key={`${level.parentId || 'root'}-${level.index}`}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-lg font-black text-slate-800 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
                      value={value}
                      onChange={e => handleFolderSelectionChange(level.index, e.target.value)}
                    >
                      <option value="">{level.index === 0 ? '최상위 선택' : '하위 항목 선택'}</option>
                      {level.index === 0 && dueReviewGroups.map(group => (
                        <option key={`review:${group.subjectId}`} value={`review:${group.subjectId}`}>
                          복습 · {group.subjectName} · {group.logs.length}개 · {formatMergedReviewRanges(group.logs)}
                        </option>
                      ))}
                      {level.index === 0 && dueReviewGroups.length > 0 && (level.folders.length > 0 || level.subjects.length > 0) && (
                        <option disabled value="review-divider">──────── 학습 과목 ────────</option>
                      )}
                      {level.folders.map(folder => (
                        <option key={folder.id} value={`folder:${folder.id}`}>폴더 {folder.name}</option>
                      ))}
                      {level.subjects.map(subject => (
                        <option key={subject.id} value={`subject:${subject.id}`}>
                          {subject.isRequired ? '필수 · ' : ''}{subject.name} · 권장 {formatPageNumber(todayStudyPlanMap.get(subject.id)?.remainingDayPages || 0)}P · 남은 {formatPageNumber(Math.max(0, subject.totalPages - subject.completedPages))}P
                        </option>
                      ))}
                    </select>
                  );
                })}
                {selectionLevels.length === 0 && (
                <div className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-xs font-bold text-slate-400">측정할 과목이 없어요.</div>
              )}
              </div>
            </div>
            <select
              className="hidden"
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
            >
              <option value="">과목을 선택하세요...</option>
              {orderedMeasurableSubjects.map(subject => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            {!selectedReviewGroup && (
              <>
                <div className="mt-5 border-t border-slate-200 pt-5">
                  <label className="mb-3 block px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">권장 장수</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={plannedPageCount}
                    onChange={e => setPlannedPageCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-center text-2xl font-black text-indigo-900 outline-none transition-all focus:ring-4 focus:ring-indigo-500/10"
                  />
                  <p className="mt-3 px-1 text-[10px] font-bold leading-relaxed text-slate-400">
                    선택한 탭 기준으로 자동 입력됩니다. 필요하면 직접 바꿀 수 있어요.
                  </p>
                </div>
                <div className="mt-5 border-t border-slate-200 pt-5">
                  <div className="mb-3 flex items-center justify-between">
                    <label className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">세션 메모</label>
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
                      <textarea
                        value={sessionMemo}
                        onChange={e => handleMemoChange(e.target.value)}
                        placeholder="이번 과목에서 기억할 것, 풀이 전략, 다음에 볼 내용..."
                        className={`h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 font-bold text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 ${getMemoTextSize(sessionMemo)}`}
                      />
                      <p className="mt-2 px-1 text-[10px] font-bold text-slate-400">과목별로 자동 저장됩니다.</p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleStartMeasurement}
            disabled={!selectedReviewGroup && !subjectId}
            className="w-full py-5 bg-indigo-600 disabled:bg-slate-300 disabled:shadow-none text-white rounded-2xl font-black text-lg hover:bg-indigo-700 disabled:hover:bg-slate-300 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 group"
          >
            <span className="text-2xl group-hover:rotate-12 transition-transform">⏱️</span>
            {selectedReviewGroup ? '복습 시작' : subjectId ? '측정 엔진 가동' : '과목 없음'}
          </button>
          <div className="rounded-[2rem] border border-indigo-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">{activeWeekdayLabel}요일 계획</p>
                <h3 className="text-base font-black text-slate-900">과목별 권장량</h3>
              </div>
              <div className="rounded-2xl bg-indigo-50 px-3 py-2 text-right">
                <p className="text-[9px] font-black uppercase tracking-widest text-indigo-300">총</p>
                <p className="text-lg font-black text-indigo-600">{formatPlanMinutes(dayPlanTotalMinutes)}</p>
              </div>
            </div>

            <div className="grid max-h-44 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {todayStudyOrder.length > 0 ? todayStudyOrder.map((item, index) => (
                <button
                  key={item.subject.id}
                  type="button"
                  onClick={() => selectSubjectForMeasurement(item.subject)}
                  className={`rounded-2xl border px-3 py-2 text-left transition-all ${
                    subjectId === item.subject.id
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-slate-100 bg-slate-50 hover:border-indigo-100 hover:bg-indigo-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-black text-slate-800">
                      {index + 1}. {item.subject.isRequired ? '필수 · ' : ''}{item.subject.name}
                    </span>
                    <span className="shrink-0 rounded-xl bg-white px-2 py-1 text-xs font-black text-indigo-600">
                      {formatPageNumber(item.remainingDayPages)}P
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-400">
                    <span>{formatPlanMinutes(item.estimatedMinutes)}</span>
                    <span>완료 {formatPageNumber(item.scopedPages)}P</span>
                  </div>
                </button>
              )) : (
                <div className="rounded-2xl bg-slate-50 px-4 py-4 text-center text-xs font-bold text-slate-400 sm:col-span-2">
                  이 요일에 남은 권장 학습이 없습니다.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isDark = step === 'timer';

  return (
    <div className={`fixed inset-0 flex flex-col items-center justify-center p-4 ${isDark ? 'bg-slate-950' : 'bg-white'}`} style={{ zIndex: 9999 }}>
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

      <div className="w-full max-w-3xl">
        {step === 'timer' && (
          <div className="flex flex-col items-center">
            <div className="mb-4 flex items-center gap-3">
              <span className="px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-black uppercase">측정 중</span>
              <p className="text-xs font-black text-slate-500">{selectedSubject?.name}</p>
            </div>
            <div className="mb-4 w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">기본 타임어택</p>
                <span className="rounded-2xl bg-indigo-500 px-4 py-2 text-xs font-black text-white">
                  중간 타이머
                </span>
              </div>
            </div>
            <div className="mb-4 grid w-full max-w-lg grid-cols-3 gap-2 rounded-2xl bg-white/5 p-1.5">
              <button
                onClick={() => setTimerMode('remainingPages')}
                className={`py-3 rounded-2xl text-xs font-black transition-all ${timerMode === 'remainingPages' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}
              >
                학습 진척도
              </button>
              <button
                onClick={() => setTimerMode('elapsedTime')}
                className={`py-3 rounded-2xl text-xs font-black transition-all ${timerMode === 'elapsedTime' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}
              >
                경과 시간
              </button>
              <button
                onClick={() => setTimerMode('sessionMemo')}
                className={`py-3 rounded-2xl text-xs font-black transition-all ${timerMode === 'sessionMemo' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-white'}`}
              >
                세션 메모
              </button>
            </div>

            {timerMode === 'remainingPages' ? (
              <div className="mb-8 text-center">
                <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">학습 진척도</p>
                <div className="text-4xl md:text-5xl font-mono font-black text-white tabular-nums">
                  {averageTimePerPage > 0
                    ? `${formatPageNumber(progressCurrentPages)} / ${formatPageNumber(progressTargetPages)}P`
                    : '-'}
                </div>
                <div className="mt-4 rounded-2xl bg-white/5 px-6 py-4">
                  <div className="mb-2 flex items-center justify-center gap-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">타임어택</p>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black text-indigo-200">
                      중간
                    </span>
                  </div>
                  <div className="font-mono text-7xl md:text-8xl font-black text-white tabular-nums">
                    {averageTimePerPage > 0 ? formatTime(pageAttackRemainingSeconds) : '--:--'}
                  </div>
                </div>
                <p className="mt-5 text-xs font-bold text-slate-500">
                  {averageTimePerPage > 0
                    ? `${formatPageNumber(plannedPageCount)}장 목표 · 현재 시간 기준 ${formatPageNumber(timeTargetPages)}장 진행`
                    : '최근 학습 시간 15시간 안에 시간과 페이지가 있는 기록이 필요합니다.'}
                </p>
              </div>
            ) : timerMode === 'elapsedTime' ? (
              <div className="text-7xl md:text-8xl font-mono font-black text-white tabular-nums mb-8">{formatTime(seconds)}</div>
            ) : (
              <div className="mb-8 w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-4">
                <label className="mb-3 block text-[10px] font-black uppercase tracking-widest text-indigo-300">세션 메모</label>
                <textarea
                  value={sessionMemo}
                  onChange={e => handleMemoChange(e.target.value)}
                  placeholder="세션 메모"
                  className={`h-56 w-full resize-none rounded-2xl border border-white/10 bg-black/10 p-4 font-bold text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500 ${getMemoTextSize(sessionMemo)}`}
                />
                <p className="mt-2 text-center text-[10px] font-bold text-slate-500">과목별로 자동 저장됩니다.</p>
              </div>
            )}

            {!skipReview && (
              <div className="mb-4 w-full max-w-lg rounded-3xl border border-rose-400/30 bg-rose-500/10 p-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-rose-200">복습 핵심 키워드</label>
                <textarea
                  value={reviewMemo}
                  onChange={e => setReviewMemo(e.target.value)}
                  placeholder="복습 때 바로 떠올릴 핵심어를 적어주세요."
                  className={`mt-3 h-24 w-full resize-none rounded-2xl border border-rose-300/30 bg-black/20 p-4 font-bold text-rose-50 outline-none placeholder:text-rose-200/40 focus:border-rose-300 ${getMemoTextSize(reviewMemo)}`}
                />
              </div>
            )}

            <div className="flex gap-2 w-full max-w-lg">
              <button
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className={`flex-[2] py-4 rounded-2xl font-black text-base shadow-lg ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'}`}
              >
                {isTimerRunning ? '일시정지' : '다시 시작'}
              </button>
              <button
                onClick={handleToggleSkipReview}
                className={`w-24 py-3 rounded-2xl font-black text-xs shadow-sm transition-all flex flex-col items-center justify-center gap-1 ${
                  skipReview
                    ? 'bg-rose-100 text-rose-500 border-2 border-rose-500'
                    : 'bg-emerald-100 text-emerald-600 border-2 border-emerald-500'
                }`}
              >
                <span className="text-xl">{skipReview ? '🚫' : '✅'}</span>
                <span>{skipReview ? '복습 제외' : '복습 포함'}</span>
              </button>
              <button onClick={handleTimerComplete} className="flex-1 py-4 bg-green-600 text-white rounded-2xl font-black text-base shadow-lg">완료</button>
            </div>
          </div>
        )}

        {step === 'pages' && (
          <div className="flex flex-col items-center">
            <h3 className="text-2xl font-black text-slate-900 mb-4">학습량 입력</h3>
            <div className="flex flex-col gap-4 mb-4 w-full bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-indigo-500 uppercase ml-2 tracking-widest">완료된 끝 페이지</label>
                <input
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
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">현재 페이지</p>
                  <p className="mt-1 text-xl font-black text-indigo-600">
                    {currentReadAmount > 0 ? `${formatPageNumber(currentReadAmount)}P` : '0P'}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">현재 시간</p>
                  <p className="mt-1 text-xl font-black text-slate-700">
                    {formatTime(seconds)}
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
                    <textarea
                      value={sessionMemo}
                      onChange={e => handleMemoChange(e.target.value)}
                      placeholder="다음 세션에서 이어볼 내용..."
                      className={`mt-3 h-28 w-full resize-none rounded-xl border border-indigo-100 bg-white p-4 font-bold text-slate-700 outline-none focus:border-indigo-500 ${getMemoTextSize(sessionMemo)}`}
                    />
                    <p className="mt-2 text-center text-[10px] font-bold text-slate-400">과목별로 자동 저장됩니다.</p>
                  </>
                )}
              </div>
              {!skipReview && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-rose-500">복습 핵심 키워드</label>
                  <textarea
                    value={reviewMemo}
                    onChange={e => setReviewMemo(e.target.value)}
                    placeholder="나중에 복습할 때 바로 떠올릴 핵심어를 적어주세요. 예: 공식 조건, 자주 틀린 포인트, 암기 단서"
                    className={`mt-3 h-28 w-full resize-none rounded-xl border border-rose-100 bg-white p-4 font-bold text-slate-700 outline-none focus:border-rose-500 ${getMemoTextSize(reviewMemo)}`}
                  />
                  <p className="mt-2 text-center text-[10px] font-bold text-rose-300">복습 큐에서 같은 과목이 묶이면 이 내용도 함께 합쳐집니다.</p>
                </div>
              )}
            </div>

            <button onClick={handleFinalSave} className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-lg shadow-lg">
              저장 완료
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
