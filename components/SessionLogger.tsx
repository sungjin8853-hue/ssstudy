import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Subject, StudyLog, TagDefinition } from '../types';
import { calculateRecentCompletedDayAverage } from '../utils/math';

interface Props {
  subjects: Subject[];
  tagDefinitions: TagDefinition[];
  logs: StudyLog[];
  onLogSession: (log: StudyLog) => void;
  onReviewAction: (logIds: string[], action: 'complete' | 'condense') => void;
  onUpdateReviewMemo: (logId: string, memo: string) => void;
}

type TimerDifficulty = 'easy' | 'medium' | 'hard';

interface SessionTimer {
  id: string;
  name: string;
  difficulty?: TimerDifficulty;
}

interface TimerPageAllocation {
  timerId: string;
  timerDifficulty?: TimerDifficulty;
  pages: number;
  timeSpentMinutes: number;
}

interface TimerEndPageRow {
  timer: SessionTimer;
  pages: number;
  endPage: number;
}

type Step = 'idle' | 'timer' | 'pages';
type TimerMode = 'remainingPages' | 'elapsedTime' | 'sessionMemo';

const DAY_MS = 1000 * 60 * 60 * 24;
const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';
const SESSION_MEMO_KEY = 'swp_session_memos';
const SESSION_MEMO_COLLAPSED_KEY = 'swp_session_memo_collapsed';
const SESSION_TIMERS_KEY = 'swp_session_timers';
const SESSION_TIMER_SELECTION_KEY = 'swp_session_timer_selection';
const getSoundSrc = (path: string) => {
  const basePath = new URL('.', window.location.href).pathname;
  return `${basePath}${path}`;
};
const MARKER_SOUND_SRC = getSoundSrc('sounds/marker.mp3');
const PAGE_TURN_SOUND_SRC = getSoundSrc('sounds/page-turn.mp3');
const FIRST_TIMER_ATTACK_SECONDS = 10 * 60;
const DEFAULT_SESSION_TIMER: SessionTimer = {
  id: 'none',
  name: '중간 타이머',
  difficulty: 'medium'
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

const difficultyLabels: Record<TimerDifficulty, string> = {
  easy: '쉬움',
  medium: '중간',
  hard: '어려움',
};

const getTimerDifficulty = (timer?: SessionTimer): TimerDifficulty => timer?.difficulty || 'medium';

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

const readSessionTimers = (): Record<string, SessionTimer[]> => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_TIMERS_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeSessionTimers = (subjectId: string, timers: SessionTimer[]) => {
  const allTimers = readSessionTimers();
  allTimers[subjectId || 'global'] = timers;
  localStorage.setItem(SESSION_TIMERS_KEY, JSON.stringify(allTimers));
};

const readSessionTimerSelections = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_TIMER_SELECTION_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeSessionTimerSelection = (subjectId: string, timerId: string) => {
  const selections = readSessionTimerSelections();
  selections[subjectId || 'global'] = timerId;
  localStorage.setItem(SESSION_TIMER_SELECTION_KEY, JSON.stringify(selections));
};

const getMemoTextSize = (text: string) => {
  if (text.length > 220) return 'text-sm';
  if (text.length > 120) return 'text-base';
  return 'text-lg';
};

const isToday = (timestamp: string) => {
  const date = new Date(timestamp);
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
};

export const SessionLogger: React.FC<Props> = ({ subjects, tagDefinitions, logs, onLogSession, onReviewAction, onUpdateReviewMemo }) => {
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
  const [sessionTimers, setSessionTimers] = useState<SessionTimer[]>([]);
  const [selectedSessionTimerId, setSelectedSessionTimerId] = useState('none');
  const [attackCompletedPages, setAttackCompletedPages] = useState(0);
  const [pageElapsedSeconds, setPageElapsedSeconds] = useState(0);
  const [pageAttackTargetSeconds, setPageAttackTargetSeconds] = useState(0);
  const [sessionTimerIds, setSessionTimerIds] = useState<string[]>([]);
  const [sessionTimerSeconds, setSessionTimerSeconds] = useState<Record<string, number>>({});
  const [sessionTimerCompletedSeconds, setSessionTimerCompletedSeconds] = useState<Record<string, number>>({});
  const [sessionTimerPages, setSessionTimerPages] = useState<Record<string, number>>({});
  const [sessionTimerPageSeconds, setSessionTimerPageSeconds] = useState<Record<string, number[]>>({});
  const [timerPageDrafts, setTimerPageDrafts] = useState<Record<string, string>>({});
  const [hiddenTimerPageRows, setHiddenTimerPageRows] = useState<Record<string, boolean>>({});
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null);
  const [isEditingTimers, setIsEditingTimers] = useState(false);
  const [preSessionReviewLogs, setPreSessionReviewLogs] = useState<StudyLog[]>([]);
  const [preSessionReviewDrafts, setPreSessionReviewDrafts] = useState<Record<string, string>>({});
  const [preSessionReviewSeconds, setPreSessionReviewSeconds] = useState(0);
  const [isPreSessionReviewRunning, setIsPreSessionReviewRunning] = useState(false);

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

  const rememberCompletedTimer = (timerId: string) => {
    setSessionTimerIds(prev => prev.includes(timerId) ? prev : [...prev, timerId]);
  };

  const selectedSubjectLogs = useMemo(
    () => logs.filter(log => log.subjectId === subjectId && log.pagesRead > 0 && log.timeSpentMinutes > 0),
    [logs, subjectId]
  );

  const timerBasisLogs = useMemo(() => {
    if (selectedSessionTimerId === 'none') return selectedSubjectLogs;

    return selectedSubjectLogs.flatMap(log => {
      const breakdownLogs = (log.timerBreakdown || [])
        .filter(item => item.timerId === selectedSessionTimerId)
        .map(item => ({
          ...log,
          pagesRead: item.pages,
          timeSpentMinutes: item.timeSpentMinutes,
          sessionTimerId: item.timerId
        }));

      if (breakdownLogs.length > 0) return breakdownLogs;
      return log.sessionTimerId === selectedSessionTimerId ? [log] : [];
    });
  }, [selectedSessionTimerId, selectedSubjectLogs]);

  const remainingSubjectPages = selectedSubject
    ? Math.max(0, selectedSubject.totalPages - selectedSubject.completedPages)
    : 0;

  const todaySubjectPages = useMemo(
    () => logs
      .filter(log => log.subjectId === subjectId && isToday(log.timestamp))
      .reduce((sum, log) => sum + log.pagesRead, 0),
    [logs, subjectId]
  );

  const recommendedDailyPages = useMemo(() => {
    if (!selectedSubject) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(selectedSubject.targetDate);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / DAY_MS);
    const remainingBeforeToday = remainingSubjectPages + todaySubjectPages;
    const dailyTarget = diffDays > 0 ? Math.ceil(remainingBeforeToday / diffDays) : remainingBeforeToday;
    return Math.min(remainingSubjectPages, Math.max(0, dailyTarget - todaySubjectPages));
  }, [selectedSubject, remainingSubjectPages, todaySubjectPages]);

  const selectedTimerAverage = useMemo(
    () => calculateRecentCompletedDayAverage(timerBasisLogs, recommendedDailyPages).averageTimePerPage,
    [timerBasisLogs, recommendedDailyPages]
  );

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

  const selectedTimerSessionPages = selectedSessionTimerId !== 'none' ? sessionTimerPages[selectedSessionTimerId] || 0 : 0;
  const selectedTimerSessionMinutes = selectedSessionTimerId !== 'none' ? (sessionTimerCompletedSeconds[selectedSessionTimerId] || 0) / 60 : 0;
  const selectedTimerPageSeconds = selectedSessionTimerId !== 'none' ? sessionTimerPageSeconds[selectedSessionTimerId] || [] : [];
  const liveSelectedTimerAverage = selectedSessionTimerId !== 'none' && selectedTimerPageSeconds.length > 0
    ? (selectedTimerPageSeconds.reduce((sum, value) => sum + value, 0) / selectedTimerPageSeconds.length) / 60
    : selectedSessionTimerId !== 'none' && selectedTimerSessionPages > 0
      ? (selectedTimerAverage * Math.max(0, timerBasisLogs.reduce((sum, log) => sum + log.pagesRead, 0)) + selectedTimerSessionMinutes)
        / Math.max(1, timerBasisLogs.reduce((sum, log) => sum + log.pagesRead, 0) + selectedTimerSessionPages)
      : selectedTimerAverage;

  const hasSavedSelectedTimerRecord = selectedSessionTimerId !== 'none' && timerBasisLogs.length > 0;
  const isFirstSelectedTimerMeasurement = selectedSessionTimerId !== 'none' && !hasSavedSelectedTimerRecord;
  const firstTimerFallbackAverage = isFirstSelectedTimerMeasurement ? FIRST_TIMER_ATTACK_SECONDS / 60 : 0;
  const averageTimePerPage = selectedSessionTimerId === 'none'
    ? overallAverage
    : liveSelectedTimerAverage || overallAverage || firstTimerFallbackAverage;
  const isUsingOverallAverageForTimer = selectedSessionTimerId !== 'none' && liveSelectedTimerAverage === 0 && overallAverage > 0;
  const isUsingFirstTimerFallback = selectedSessionTimerId !== 'none' && liveSelectedTimerAverage === 0 && overallAverage === 0 && firstTimerFallbackAverage > 0;

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
  const canUseFirstTimerAttackControls = selectedSessionTimerId !== 'none'
    && step === 'timer'
    && !hasSavedSelectedTimerRecord;
  const hasSessionMemo = false;
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
        rememberCompletedTimer(completedTimerId);
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
      setSessionTimers(readSessionTimers().global || []);
      setSelectedSessionTimerId(readSessionTimerSelections().global || 'none');
      return;
    }
    setSessionMemo(readSessionMemos()[subjectId] || '');
    const timers = readSessionTimers()[subjectId] || [];
    const savedSelection = readSessionTimerSelections()[subjectId] || 'none';
    setSessionTimers(timers);
    setSelectedSessionTimerId(savedSelection !== 'none' && timers.some(timer => timer.id === savedSelection) ? savedSelection : 'none');
  }, [subjectId]);

  useEffect(() => {
    if (subjectId && !measurableSubjects.some(subject => subject.id === subjectId)) {
      setSubjectId('');
    }
  }, [subjects, subjectId]);

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

    return measurableSubjects.some(subject => subject.tagIds?.includes(folderId))
      || childFolderIds.some(hasMeasurableSubjectInFolder);
  };

  const getSelectableFolders = (parentId?: string) => tagDefinitions
    .filter(folder => folder.parentId === parentId)
    .filter(folder => hasMeasurableSubjectInFolder(folder.id));

  const getSelectableSubjects = (parentId?: string) => measurableSubjects.filter(subject => (
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

    if (!value) {
      setFolderPathIds(basePath);
      return;
    }

    const [kind, id] = value.split(':');
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
    setSessionTimerIds([]);
    setSessionTimerSeconds({});
    setSessionTimerCompletedSeconds({});
    setSessionTimerPages({});
    setSessionTimerPageSeconds({});
    setTimerPageDrafts({});
    setHiddenTimerPageRows({});
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
    setIsEditingTimers(false);
    setEditingTimerId(null);
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

  const selectSessionTimer = (timerId: string) => {
    lockElapsedTimeToCurrentTimer();
    selectedSessionTimerIdRef.current = timerId;
    setSelectedSessionTimerId(timerId);
    writeSessionTimerSelection(subjectId, timerId);
    setTimerMode('remainingPages');
    if (step === 'timer') {
      resetPageAttackTimer(0);
    }
  };

  const addSessionTimer = (difficulty: TimerDifficulty = 'medium') => {
    lockElapsedTimeToCurrentTimer();

    setSessionTimers(prev => {
      const sameDifficultyCount = prev.filter(timer => getTimerDifficulty(timer) === difficulty).length;
      const nextTimer = {
        id: Math.random().toString(36).substr(2, 9),
        name: `${difficultyLabels[difficulty]} ${sameDifficultyCount + 1}`,
        difficulty
      };
      const nextTimers = [...prev, nextTimer];
      writeSessionTimers(subjectId, nextTimers);
      selectedSessionTimerIdRef.current = nextTimer.id;
      setSelectedSessionTimerId(nextTimer.id);
      writeSessionTimerSelection(subjectId, nextTimer.id);
      setTimerMode('remainingPages');
      if (step === 'timer') {
        resetPageAttackTimer(0);
      }
      return nextTimers;
    });
  };

  const renameSessionTimer = (timerId: string, name: string) => {
    const trimmedName = name.trim() || '타이머';
    setSessionTimers(prev => {
      const nextTimers = prev.map(timer => timer.id === timerId ? { ...timer, name: trimmedName } : timer);
      writeSessionTimers(subjectId, nextTimers);
      return nextTimers;
    });
    setEditingTimerId(null);
  };

  const deleteSessionTimer = (timerId: string) => {
    const nextSelection = selectedSessionTimerId === timerId ? 'none' : selectedSessionTimerId;

    setSessionTimers(prev => {
      const nextTimers = prev.filter(timer => timer.id !== timerId);
      writeSessionTimers(subjectId, nextTimers);
      return nextTimers;
    });
    selectedSessionTimerIdRef.current = nextSelection;
    setSelectedSessionTimerId(nextSelection);
    writeSessionTimerSelection(subjectId, nextSelection);
    setSessionTimerIds(prev => prev.filter(id => id !== timerId));
    setSessionTimerSeconds(prev => {
      const next = { ...prev };
      delete next[timerId];
      return next;
    });
    setSessionTimerCompletedSeconds(prev => {
      const next = { ...prev };
      delete next[timerId];
      return next;
    });
    setSessionTimerPages(prev => {
      const next = { ...prev };
      delete next[timerId];
      return next;
    });
    setSessionTimerPageSeconds(prev => {
      const next = { ...prev };
      delete next[timerId];
      return next;
    });
    setTimerPageDrafts(prev => {
      const next = { ...prev };
      delete next[timerId];
      return next;
    });
    delete activeTimerSecondsRef.current[timerId];
    delete activeTimerCompletedSecondsRef.current[timerId];
    delete activeTimerPagesRef.current[timerId];
    delete activeTimerPageSecondsRef.current[timerId];
    if (editingTimerId === timerId) setEditingTimerId(null);
    if (step === 'timer' && selectedSessionTimerId === timerId) {
      setTimerMode('remainingPages');
      setPageElapsedSeconds(0);
      currentPageMeasuredSecondsRef.current = 0;
      markerSoundPagesRef.current.delete(attackCompletedPages);
      pageTurnSoundPagesRef.current.delete(attackCompletedPages);
    }
  };

  const addTwoMinutesToAttack = () => {
    if (step !== 'timer') return;
    setPageAttackTargetSeconds(prev => (prev > 0 ? prev : averageSecondsPerPage) + 120);
    halfwaySoundPagesRef.current.delete(attackCompletedPages);
    markerSoundPagesRef.current.delete(attackCompletedPages);
    pageTurnSoundPagesRef.current.delete(attackCompletedPages);
  };

  const moveToNextAttackPage = () => {
    if (step !== 'timer') return;

    lockElapsedTimeToCurrentTimer();
    const timerId = selectedSessionTimerIdRef.current;
    const completedSeconds = Math.max(1, currentPageMeasuredSecondsRef.current);
    activeTimerPagesRef.current[timerId] =
      (activeTimerPagesRef.current[timerId] || 0) + 1;
    activeTimerCompletedSecondsRef.current[timerId] =
      (activeTimerCompletedSecondsRef.current[timerId] || 0) + completedSeconds;
    activeTimerPageSecondsRef.current[timerId] = [
      ...(activeTimerPageSecondsRef.current[timerId] || []),
      completedSeconds
    ];
    currentPageMeasuredSecondsRef.current = 0;
    setSessionTimerPages(prev => ({
      ...prev,
      [timerId]: activeTimerPagesRef.current[timerId] || 0
    }));
    setSessionTimerCompletedSeconds(prev => ({
      ...prev,
      [timerId]: activeTimerCompletedSecondsRef.current[timerId] || 0
    }));
    setSessionTimerPageSeconds(prev => ({
      ...prev,
      [timerId]: activeTimerPageSecondsRef.current[timerId] || []
    }));
    rememberCompletedTimer(timerId);

    setAttackCompletedPages(current => current + 1);
    const hasSavedTimerRecord = timerBasisLogs.length > 0;
    const nextTargetSeconds = timerId !== DEFAULT_SESSION_TIMER.id && !hasSavedTimerRecord
      ? Math.max(1, Math.round(
        activeTimerPageSecondsRef.current[timerId].reduce((sum, value) => sum + value, 0)
        / activeTimerPageSecondsRef.current[timerId].length
      ))
      : averageSecondsPerPage;
    setPageAttackTargetSeconds(nextTargetSeconds);
    setPageElapsedSeconds(0);
    halfwaySoundPagesRef.current.delete(attackCompletedPages + 1);
    markerSoundPagesRef.current.delete(attackCompletedPages + 1);
    pageTurnSoundPagesRef.current.delete(attackCompletedPages + 1);
  };

  const usedSessionTimerIds = Array.from(new Set([
    ...sessionTimerIds.filter(timerId => (sessionTimerPages[timerId] || 0) > 0),
    ...Object.keys(sessionTimerPageSeconds).filter(timerId => (sessionTimerPageSeconds[timerId] || []).length > 0),
    ...Object.keys(sessionTimerSeconds).filter(timerId => (sessionTimerSeconds[timerId] || 0) > 0),
    ...(step === 'timer' || step === 'pages' ? [selectedSessionTimerId] : [])
  ]));
  const usedSessionTimers = usedSessionTimerIds
    .map(timerId => timerId === DEFAULT_SESSION_TIMER.id ? DEFAULT_SESSION_TIMER : sessionTimers.find(timer => timer.id === timerId))
    .filter((timer): timer is SessionTimer => Boolean(timer));
  const pageInputSessionTimers = Array.from(new Map(usedSessionTimers
    .filter(timer => (
      timer.id === DEFAULT_SESSION_TIMER.id
        ? (sessionTimerSeconds[timer.id] || 0) > 0 || (sessionTimerPages[timer.id] || 0) > 0 || selectedSessionTimerId === timer.id
        : (sessionTimerSeconds[timer.id] || 0) > 0 || (sessionTimerPages[timer.id] || 0) > 0
    ))
    .map(timer => [timer.id, timer])
  ).values());

  const getTimerAverageTimePerPage = (timerId: string) => {
    if (timerId === DEFAULT_SESSION_TIMER.id) return overallAverage;

    const timerLogs = selectedSubjectLogs.flatMap(log => {
      const breakdownLogs = (log.timerBreakdown || [])
        .filter(item => item.timerId === timerId)
        .map(item => ({
          ...log,
          pagesRead: item.pages,
          timeSpentMinutes: item.timeSpentMinutes,
          sessionTimerId: item.timerId
        }));

      if (breakdownLogs.length > 0) return breakdownLogs;
      return log.sessionTimerId === timerId ? [log] : [];
    });

    return calculateRecentCompletedDayAverage(timerLogs, recommendedDailyPages).averageTimePerPage;
  };

  const renderSessionTimerButton = (timer: SessionTimer) => (
    <div
      key={timer.id}
      className={`flex items-center gap-1 rounded-2xl px-2 py-1 transition-all ${selectedSessionTimerId === timer.id ? 'bg-indigo-500 text-white' : 'bg-white/10 text-slate-400 hover:text-white'}`}
    >
      {editingTimerId === timer.id ? (
        <input
          autoFocus
          defaultValue={timer.name}
          onBlur={e => renameSessionTimer(timer.id, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') renameSessionTimer(timer.id, e.currentTarget.value);
            if (e.key === 'Escape') setEditingTimerId(null);
          }}
          className="w-24 rounded-xl bg-white px-2 py-1 text-xs font-black text-slate-900 outline-none"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => selectSessionTimer(timer.id)}
            className="px-2 py-1 text-xs font-black"
          >
            <span className="mr-1 opacity-70">{difficultyLabels[getTimerDifficulty(timer)]}</span>
            {timer.name}
          </button>
          {isEditingTimers && (
            <>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setEditingTimerId(timer.id);
                }}
                className="rounded-xl px-2 py-1 text-[10px] font-black opacity-70 hover:bg-white/20 hover:opacity-100"
                title="이름 수정"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  deleteSessionTimer(timer.id);
                }}
                className="rounded-xl px-2 py-1 text-[10px] font-black opacity-70 hover:bg-red-500/30 hover:text-red-100 hover:opacity-100"
                title="삭제"
              >
                삭제
              </button>
            </>
          )}
        </>
      )}
    </div>
  );

  const getTimerExpectedPages = (timerId: string) => {
    const timerSeconds = sessionTimerSeconds[timerId] || 0;
    const timerAverage = getTimerAverageTimePerPage(timerId);
    if (timerSeconds <= 0 || timerAverage <= 0) return 0;
    return Math.max(0, Math.round((timerSeconds / 60) / timerAverage));
  };

  const getTimerSpeedChange = (timerId: string, pages: number) => {
    const previousAverage = getTimerAverageTimePerPage(timerId);
    const measuredPageSeconds = sessionTimerPageSeconds[timerId] || [];
    const measuredPageAverage = measuredPageSeconds.length > 0
      ? (measuredPageSeconds.reduce((sum, value) => sum + value, 0) / measuredPageSeconds.length) / 60
      : 0;
    const completedPages = sessionTimerPages[timerId] || 0;
    const completedSeconds = sessionTimerCompletedSeconds[timerId] || 0;
    const totalSeconds = sessionTimerSeconds[timerId] || 0;
    const currentAverage = pages > 0 && totalSeconds > 0
      ? (totalSeconds / 60) / pages
      : measuredPageAverage > 0
        ? measuredPageAverage
        : completedPages > 0 && completedSeconds > 0
        ? (completedSeconds / 60) / completedPages
        : 0;
    const secondsBasis = currentAverage > 0 && pages > 0 ? currentAverage * pages * 60 : totalSeconds;
    const previousExpectedPages = previousAverage > 0 && secondsBasis > 0 ? (secondsBasis / 60) / previousAverage : 0;
    const ratioPercent = previousAverage > 0 && currentAverage > 0 ? (previousAverage / currentAverage) * 100 : 0;
    const deltaMinutes = currentAverage > 0 && previousAverage > 0 ? currentAverage - previousAverage : 0;

    return {
      previousAverage,
      currentAverage,
      previousExpectedPages,
      ratioPercent,
      deltaMinutes
    };
  };

  const calculateAutoTimerPageAllocations = (totalPages: number): TimerPageAllocation[] => {
    if (pageInputSessionTimers.length === 0 || totalPages <= 0) return [];

    const roundedTotalPages = Math.max(0, Math.round(totalPages));
    const manualEntries = pageInputSessionTimers
      .map(timer => ({
        timer,
        recordedPages: Math.max(0, Math.round(sessionTimerPages[timer.id] || 0)),
        hasMeasuredTime: (sessionTimerSeconds[timer.id] || 0) > 0
      }));
    const recordedTotal = manualEntries.reduce((sum, entry) => sum + entry.recordedPages, 0);
    const autoPages = new Map<string, number>();
    const measuredEntries = manualEntries.filter(entry => entry.recordedPages === 0 && entry.hasMeasuredTime && getTimerExpectedPages(entry.timer.id) > 0);
    const unmeasuredEntries = manualEntries.filter(entry => entry.recordedPages === 0 && !measuredEntries.includes(entry));
    const measuredAutoTotal = measuredEntries.reduce((sum, entry) => {
      const value = getTimerExpectedPages(entry.timer.id);
      autoPages.set(entry.timer.id, value);
      return sum + value;
    }, 0);

    const remainingPagesForUnmeasured = Math.max(0, roundedTotalPages - recordedTotal - measuredAutoTotal);

    if (unmeasuredEntries.length > 0) {
      const denominator = remainingPagesForUnmeasured % unmeasuredEntries.length === 0
        ? unmeasuredEntries.length
        : Math.max(1, unmeasuredEntries.length - 1);
      const base = Math.floor(remainingPagesForUnmeasured / denominator);
      let used = 0;

      unmeasuredEntries.forEach((entry, index) => {
        const isLast = index === unmeasuredEntries.length - 1;
        const value = isLast ? Math.max(0, remainingPagesForUnmeasured - used) : base;
        used += value;
        autoPages.set(entry.timer.id, value);
      });
    }

    return manualEntries.map(entry => {
      const pages = entry.recordedPages + (autoPages.get(entry.timer.id) || 0);

      return {
        timerId: entry.timer.id,
        timerDifficulty: getTimerDifficulty(entry.timer),
        pages,
        timeSpentMinutes: Number(((sessionTimerSeconds[entry.timer.id] || 0) / 60).toFixed(2))
      };
    }).filter(entry => entry.pages > 0);
  };

  const getTimerEndPageRows = (totalPages: number): TimerEndPageRow[] => {
    if (pageInputSessionTimers.length === 0) return [];

    const autoAllocations = calculateAutoTimerPageAllocations(totalPages);
    const autoByTimer = new Map(autoAllocations.map(entry => [entry.timerId, entry]));
    const hasEndPageDraft = pageInputSessionTimers.some(timer => timerPageDrafts[timer.id]?.trim());
    let previousEndPage = Math.round(parseFloat(startPage) || 0) - 1;

    return pageInputSessionTimers.map(timer => {
      const draft = timerPageDrafts[timer.id]?.trim();
      const autoPages = autoByTimer.get(timer.id)?.pages || 0;
      const autoEndPage = previousEndPage + autoPages;
      const endPage = hasEndPageDraft && draft
        ? Math.max(previousEndPage, Math.round(Number(draft) || previousEndPage))
        : autoEndPage;
      const pages = Math.max(0, endPage - previousEndPage);
      previousEndPage = endPage;

      return {
        timer,
        pages,
        endPage
      };
    }).filter(row => !hiddenTimerPageRows[row.timer.id] && (
      row.pages > 0
      || sessionTimerIds.includes(row.timer.id)
      || Boolean(timerPageDrafts[row.timer.id]?.trim())
    ));
  };

  const calculateTimerPageAllocations = (totalPages: number): TimerPageAllocation[] => {
    if (!pageInputSessionTimers.some(timer => timerPageDrafts[timer.id]?.trim())) {
      return calculateAutoTimerPageAllocations(totalPages)
        .filter(entry => entry.pages > 0 && entry.timeSpentMinutes > 0);
    }

    return getTimerEndPageRows(totalPages).map(row => ({
      timerId: row.timer.id,
      timerDifficulty: getTimerDifficulty(row.timer),
      pages: row.pages,
      timeSpentMinutes: Number(((sessionTimerSeconds[row.timer.id] || 0) / 60).toFixed(2))
    })).filter(entry => entry.pages > 0 && entry.timeSpentMinutes > 0);
  };

  const handleTimerEndPageChange = (timerId: string, value: string, shouldSyncTotalEndPage = true) => {
    if (value.trim() === '') {
      setTimerPageDrafts(prev => ({
        ...prev,
        [timerId]: ''
      }));
      return;
    }

    const rows = getTimerEndPageRows(currentReadAmount);
    const changedIndex = rows.findIndex(row => row.timer.id === timerId);
    if (changedIndex === -1) return;

    const oldEndPage = rows[changedIndex].endPage;
    const previousEndPage = changedIndex === 0
      ? Math.round(parseFloat(startPage) || 0) - 1
      : rows[changedIndex - 1].endPage;
    const nextEndPage = Math.max(previousEndPage, Math.round(Number(value) || previousEndPage));
    const delta = nextEndPage - oldEndPage;
    let rollingPreviousEndPage = previousEndPage;
    const nextDrafts: Record<string, string> = {};

    rows.forEach((row, index) => {
      const shiftedEndPage = index < changedIndex
        ? row.endPage
        : Math.max(rollingPreviousEndPage, row.endPage + delta);
      nextDrafts[row.timer.id] = String(shiftedEndPage);
      rollingPreviousEndPage = shiftedEndPage;
    });

    setTimerPageDrafts(prev => ({
      ...prev,
      ...nextDrafts
    }));

    const lastEndPage = Number(nextDrafts[rows[rows.length - 1].timer.id]);
    if (shouldSyncTotalEndPage && Number.isFinite(lastEndPage)) {
      setReadAmount(formatPageNumber(lastEndPage));
    }
  };

  const handleReadAmountChange = (value: string) => {
    setReadAmount(value);

    if (value.trim() === '') {
      setTimerPageDrafts({});
      setHiddenTimerPageRows({});
      return;
    }

    const nextEndPage = Math.round(Number(value));
    if (!Number.isFinite(nextEndPage) || currentReadAmount <= 0) return;

    const rows = getTimerEndPageRows(currentReadAmount);
    if (rows.length === 0) return;

    const lastRow = rows[rows.length - 1];
    handleTimerEndPageChange(lastRow.timer.id, String(nextEndPage), false);
  };

  const startMeasurementNow = () => {
    unlockSounds();
    markerSoundPagesRef.current.clear();
    halfwaySoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
    setAttackCompletedPages(0);
    setPageAttackTargetSeconds(averageSecondsPerPage);
    setPageElapsedSeconds(0);
    selectedSessionTimerIdRef.current = selectedSessionTimerId;
    setSessionTimerIds([]);
    setSessionTimerSeconds({});
    setSessionTimerCompletedSeconds({});
    setSessionTimerPages({});
    setTimerPageDrafts({});
    setHiddenTimerPageRows({});
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

  const handleStartMeasurement = () => {
    if (!subjectId) {
      alert('과목을 먼저 선택해주세요.');
      return;
    }

    if (dueReviewLogsForSelectedSubject.length > 0) {
      setPreSessionReviewDrafts(
        dueReviewLogsForSelectedSubject.reduce<Record<string, string>>((drafts, log) => {
          drafts[log.id] = log.reviewMemo || '';
          return drafts;
        }, {})
      );
      setPreSessionReviewLogs(dueReviewLogsForSelectedSubject);
      setPreSessionReviewSeconds(0);
      setIsPreSessionReviewRunning(true);
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
    onReviewAction(preSessionReviewLogs.map(log => log.id), 'complete');
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setIsPreSessionReviewRunning(false);
    startMeasurementNow();
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
      setIsPreSessionReviewRunning(false);
      setPreSessionReviewSeconds(0);
    }
  };

  const closePreSessionReview = () => {
    setPreSessionReviewLogs([]);
    setPreSessionReviewDrafts({});
    setPreSessionReviewSeconds(0);
    setIsPreSessionReviewRunning(false);
  };

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
    setSessionTimerIds(prev => {
      const measuredIds = Array.from(new Set([
        ...Object.keys(completedTimerSeconds).filter(timerId => completedTimerSeconds[timerId] > 0),
        ...Object.keys(completedTimerPages).filter(timerId => completedTimerPages[timerId] > 0)
      ]));
      return Array.from(new Set([...prev, ...measuredIds]));
    });
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

    const timerBreakdown = calculateTimerPageAllocations(amount);

    onLogSession({
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: amount,
      startPage: sPage,
      endPage,
      timeSpentMinutes: minutes,
      timestamp: new Date().toISOString(),
      isReviewed: false,
      isCondensed: shouldSkipReview,
      reviewMemo: !shouldSkipReview ? reviewMemo.trim() : undefined,
      sessionTimerId: selectedSessionTimerId !== 'none' ? selectedSessionTimerId : undefined,
      timerBreakdown: timerBreakdown.length > 0 ? timerBreakdown : undefined
    });

    resetAll();
  };

  const timerEndPageRows = step === 'pages' ? getTimerEndPageRows(Math.max(0, currentReadAmount)) : [];
  const hasTimerEndPageRows = timerEndPageRows.length > 0;
  const renderTimerPageRows = () => (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="text-[10px] font-black uppercase tracking-widest text-indigo-500">타이머별 학습량</label>
        <span className="text-[10px] font-bold text-indigo-300">끝 페이지 수정 가능</span>
      </div>
      <div className="space-y-2">
        {timerEndPageRows.map(row => {
          const timerSpeedChange = getTimerSpeedChange(row.timer.id, row.pages);
          return (
            <div key={row.timer.id} className="grid grid-cols-[1fr_120px_48px] items-center gap-2 rounded-xl bg-white p-2">
              <div>
                <p className="text-sm font-black text-slate-800">{row.timer.name}</p>
                <p className="mt-1 text-xs font-black text-indigo-500">
                  {formatPageNumber(row.pages)}P · 끝 p.{formatPageNumber(row.endPage)}
                </p>
                {timerSpeedChange.currentAverage > 0 && timerSpeedChange.previousAverage > 0 && (
                  <p className={`mt-1 text-base font-black ${timerSpeedChange.ratioPercent > 100 ? 'text-emerald-600' : timerSpeedChange.ratioPercent < 100 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {timerSpeedChange.ratioPercent > 100
                      ? `+${(timerSpeedChange.ratioPercent - 100).toFixed(0)}% · ${timerSpeedChange.previousAverage.toFixed(2)}분/P → ${timerSpeedChange.currentAverage.toFixed(2)}분/P`
                      : timerSpeedChange.ratioPercent < 100
                        ? `-${(100 - timerSpeedChange.ratioPercent).toFixed(0)}% · ${timerSpeedChange.previousAverage.toFixed(2)}분/P → ${timerSpeedChange.currentAverage.toFixed(2)}분/P`
                        : '변화 없음'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-xl border border-indigo-100 bg-indigo-50 px-2">
                <span className="text-[10px] font-black text-indigo-400">끝 p.</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={timerPageDrafts[row.timer.id] || formatPageNumber(row.endPage)}
                  onChange={e => handleTimerEndPageChange(row.timer.id, e.target.value)}
                  className="w-full bg-transparent p-2 text-center text-lg font-black text-indigo-900 outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setHiddenTimerPageRows(prev => ({ ...prev, [row.timer.id]: true }))}
                className="rounded-xl bg-rose-50 px-2 py-3 text-xs font-black text-rose-500 transition-all hover:bg-rose-100"
              >
                삭제
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (step === 'idle') {
    return (
      <div className="animate-fade-in">
        {preSessionReviewLogs.length > 0 && (
          <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950/90 p-4 md:p-8">
            <div className="mx-auto max-w-3xl rounded-3xl border border-rose-100 bg-white p-4 shadow-2xl md:p-6">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">먼저 복습</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-900">{selectedSubject?.name} 복습 후 학습 시작</h3>
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
                  복습 완료 후 학습 시작
                </button>
              </div>
            </div>
          </div>
        )}
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-8">
          <span className="w-2 h-5 bg-indigo-500 rounded-full"></span>
          학습 세션 시작
        </h2>
        <div className="space-y-6 max-w-md mx-auto">
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest px-1">측정할 과목 선택</label>
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
                      {level.folders.map(folder => (
                        <option key={folder.id} value={`folder:${folder.id}`}>폴더 {folder.name}</option>
                      ))}
                      {level.subjects.map(subject => (
                        <option key={subject.id} value={`subject:${subject.id}`}>
                          {subject.name} · {formatPageNumber(Math.max(0, subject.totalPages - subject.completedPages))}P 남음
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
              {measurableSubjects.map(subject => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <div className="mt-5 pt-5 border-t border-slate-200">
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest px-1">오늘 공부할 장수</label>
              <input
                type="number"
                step="1"
                min="1"
                value={plannedPageCount}
                onChange={e => setPlannedPageCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-black text-center text-2xl text-indigo-900 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
              />
              <p className="mt-3 px-1 text-[10px] font-bold text-slate-400 leading-relaxed">
                하루 권장 장수를 자동으로 채웁니다. 필요하면 직접 바꿀 수 있어요.
              </p>
            </div>
            <div className="mt-5 pt-5 border-t border-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">세션 메모</label>
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
          </div>
          <button
            onClick={handleStartMeasurement}
            disabled={measurableSubjects.length === 0 || !subjectId}
            className="w-full py-5 bg-indigo-600 disabled:bg-slate-300 disabled:shadow-none text-white rounded-2xl font-black text-lg hover:bg-indigo-700 disabled:hover:bg-slate-300 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 group"
          >
            <span className="text-2xl group-hover:rotate-12 transition-transform">⏱️</span>
            {measurableSubjects.length > 0 ? '측정 엔진 가동' : '모든 과목 목표 완료'}
          </button>
        </div>
      </div>
    );
  }

  const isDark = step === 'timer';

  return (
    <div className={`fixed inset-0 flex flex-col items-center justify-center p-4 ${isDark ? 'bg-slate-950' : 'bg-white'}`} style={{ zIndex: 9999 }}>
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">학습 측정 타이머</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingTimers(prev => !prev)}
                    className={`rounded-2xl px-3 py-2 text-xs font-black transition-all ${isEditingTimers ? 'bg-white text-slate-950' : 'bg-white/10 text-indigo-200 hover:bg-white/20'}`}
                  >
                    편집
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => addSessionTimer('easy')}
                  className="rounded-2xl bg-emerald-500/20 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-500/30"
                  title="쉬운 난도 소환"
                >
                  + 쉬움
                </button>
                {sessionTimers.filter(timer => getTimerDifficulty(timer) === 'easy').map(renderSessionTimerButton)}
                <button
                  type="button"
                  onClick={() => selectSessionTimer('none')}
                  className={`rounded-2xl px-4 py-2 text-xs font-black transition-all ${selectedSessionTimerId === 'none' ? 'bg-indigo-500 text-white' : 'bg-white/10 text-slate-400 hover:text-white'}`}
                >
                  중간 타이머
                </button>
                {sessionTimers.filter(timer => getTimerDifficulty(timer) === 'medium').map(renderSessionTimerButton)}
                {sessionTimers.filter(timer => getTimerDifficulty(timer) === 'hard').map(renderSessionTimerButton)}
                <button
                  type="button"
                  onClick={() => addSessionTimer('hard')}
                  className="rounded-2xl bg-rose-500/20 px-3 py-2 text-xs font-black text-rose-200 hover:bg-rose-500/30"
                  title="어려운 난도 소환"
                >
                  + 어려움
                </button>
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
                      {selectedSessionTimerId === 'none'
                        ? '중간'
                        : difficultyLabels[getTimerDifficulty(sessionTimers.find(timer => timer.id === selectedSessionTimerId))]}
                    </span>
                  </div>
                  <div className="font-mono text-7xl md:text-8xl font-black text-white tabular-nums">
                    {averageTimePerPage > 0 ? formatTime(pageAttackRemainingSeconds) : '--:--'}
                  </div>
                  {canUseFirstTimerAttackControls && (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={addTwoMinutesToAttack}
                        disabled={averageTimePerPage <= 0}
                        className="rounded-2xl bg-white/10 px-4 py-3 text-xs font-black text-white transition-all hover:bg-white/20 disabled:opacity-30"
                      >
                        2분 추가
                      </button>
                      <button
                        type="button"
                        onClick={moveToNextAttackPage}
                        disabled={averageTimePerPage <= 0}
                        className="rounded-2xl bg-indigo-600 px-4 py-3 text-xs font-black text-white shadow-lg shadow-indigo-950/20 transition-all hover:bg-indigo-500 disabled:opacity-30"
                      >
                        다음장으로
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-5 text-xs font-bold text-slate-500">
                  {averageTimePerPage > 0
                    ? `${formatPageNumber(plannedPageCount)}장 목표 · 현재 시간 기준 ${formatPageNumber(timeTargetPages)}장 진행${isUsingOverallAverageForTimer ? ' · 전체 평균 기준' : ''}${isUsingFirstTimerFallback ? ' · 첫 측정 10분 기준' : ''}`
                    : selectedSessionTimerId !== 'none'
                      ? '저장된 평균이 없어 전체 학습 기록이 필요합니다.'
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
              {hasTimerEndPageRows ? (
                renderTimerPageRows()
              ) : (
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
              )}
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
