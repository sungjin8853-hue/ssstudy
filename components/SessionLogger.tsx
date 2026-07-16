import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Subject, StudyLog } from '../types';
import { calculateRecentCompletedDayAverage } from '../utils/math';

interface Props {
  subjects: Subject[];
  logs: StudyLog[];
  onLogSession: (log: StudyLog) => void;
}

interface SessionTimer {
  id: string;
  name: string;
}

interface TimerPageAllocation {
  timerId: string;
  pages: number;
  timeSpentMinutes: number;
}

type Step = 'idle' | 'timer' | 'pages';
type TimerMode = 'remainingPages' | 'elapsedTime' | 'sessionMemo';

const DAY_MS = 1000 * 60 * 60 * 24;
const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';
const SESSION_MEMO_KEY = 'swp_session_memos';
const SESSION_MEMO_COLLAPSED_KEY = 'swp_session_memo_collapsed';
const SESSION_TIMERS_KEY = 'swp_session_timers';
const SESSION_TIMER_SELECTION_KEY = 'swp_session_timer_selection';
const MARKER_SOUND_SRC = '/sounds/marker.mp3';
const PAGE_TURN_SOUND_SRC = '/sounds/page-turn.mp3';

const playSound = (src: string, startAtSeconds = 0) => {
  const audio = new Audio(src);
  audio.volume = 1;

  const play = () => {
    audio.currentTime = startAtSeconds;
    void audio.play().catch(() => undefined);
  };

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    play();
    return;
  }

  audio.addEventListener('loadedmetadata', play, { once: true });
  audio.load();
};

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

export const SessionLogger: React.FC<Props> = ({ subjects, logs, onLogSession }) => {
  const measurableSubjects = subjects.filter(subject => subject.completedPages < subject.totalPages);
  const [step, setStep] = useState<Step>('idle');
  const [subjectId, setSubjectId] = useState(measurableSubjects[0]?.id || '');
  const selectedSubject = subjects.find(subject => subject.id === subjectId);
  const isSubjectReviewDisabled = selectedSubject?.reviewEnabled === false;

  const [startPage, setStartPage] = useState('');
  const [readAmount, setReadAmount] = useState('');
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
  const [sessionTimerIds, setSessionTimerIds] = useState<string[]>([]);
  const [sessionTimerSeconds, setSessionTimerSeconds] = useState<Record<string, number>>({});
  const [timerPageDrafts, setTimerPageDrafts] = useState<Record<string, string>>({});
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef(0);
  const lastAttackSecondRef = useRef(0);
  const activeTimerSecondsRef = useRef<Record<string, number>>({});
  const markerSoundPagesRef = useRef<Set<number>>(new Set());
  const pageTurnSoundPagesRef = useRef<Set<number>>(new Set());

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

  const averageTimePerPage = selectedSessionTimerId === 'none' ? overallAverage : selectedTimerAverage;
  const selectedTimerNeedsRecords = selectedSessionTimerId !== 'none' && selectedTimerAverage === 0;

  const averageSecondsPerPage = averageTimePerPage > 0 ? averageTimePerPage * 60 : 0;
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
  const currentTimePerPage = currentReadAmount > 0 ? minutes / currentReadAmount : 0;
  const speedDeltaMinutes = currentTimePerPage > 0 && averageTimePerPage > 0
    ? currentTimePerPage - averageTimePerPage
    : 0;
  const previousExpectedPages = averageTimePerPage > 0 ? minutes / averageTimePerPage : 0;
  const actualPages = currentReadAmount;
  const speedRatioPercent = previousExpectedPages > 0 && actualPages > 0
    ? (actualPages / previousExpectedPages) * 100
    : 0;
  const pageAttackRemainingSeconds = averageSecondsPerPage > 0
    ? Math.max(0, Math.ceil(averageSecondsPerPage - pageElapsedSeconds))
    : 0;
  const hasSessionMemo = false;
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

    if (selectedSessionTimerId !== 'none') {
      activeTimerSecondsRef.current[selectedSessionTimerId] =
        (activeTimerSecondsRef.current[selectedSessionTimerId] || 0) + delta;
    }

    if (averageSecondsPerPage <= 0) return;

    setPageElapsedSeconds(prev => {
      let nextElapsed = prev + delta;
      let completed = 0;

      while (nextElapsed >= averageSecondsPerPage) {
        nextElapsed -= averageSecondsPerPage;
        completed += 1;
      }

      if (completed > 0) {
        setAttackCompletedPages(current => current + completed);
      }

      return nextElapsed;
    });
  }, [averageSecondsPerPage, seconds, selectedSessionTimerId, step]);

  useEffect(() => {
    if (!isTimerRunning || step !== 'timer' || timerMode !== 'remainingPages' || averageSecondsPerPage <= 0) return;

    const currentPageIndex = attackCompletedPages;
    const remainingInPage = pageAttackRemainingSeconds;

    if (averageSecondsPerPage > 60 && remainingInPage <= 60 && !markerSoundPagesRef.current.has(currentPageIndex)) {
      markerSoundPagesRef.current.add(currentPageIndex);
      playMarkerSound();
    }

    if (remainingInPage <= 2 && !pageTurnSoundPagesRef.current.has(currentPageIndex)) {
      pageTurnSoundPagesRef.current.add(currentPageIndex);
      playPageTurnSound();
    }
  }, [attackCompletedPages, averageSecondsPerPage, isTimerRunning, pageAttackRemainingSeconds, step, timerMode]);

  useEffect(() => {
    if (!subjectId) return;
    const savedPreference = readReviewSessionPreferences()[subjectId];
    setSkipReview(savedPreference ?? isSubjectReviewDisabled);
  }, [subjectId, isSubjectReviewDisabled]);

  useEffect(() => {
    setPlannedPageCount(Math.max(1, recommendedDailyPages));
  }, [subjectId, recommendedDailyPages]);

  useEffect(() => {
    if (step === 'timer' && timerMode === 'remainingPages' && selectedTimerNeedsRecords) {
      setTimerMode('elapsedTime');
    }
  }, [selectedTimerNeedsRecords, step, timerMode]);

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
    if (!measurableSubjects.some(subject => subject.id === subjectId)) {
      setSubjectId(measurableSubjects[0]?.id || '');
    }
  }, [subjects, subjectId]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const resetAll = () => {
    setStep('idle');
    setSeconds(0);
    setAttackCompletedPages(0);
    setPageElapsedSeconds(0);
    setSessionTimerIds([]);
    setSessionTimerSeconds({});
    setTimerPageDrafts({});
    accumulatedSecondsRef.current = 0;
    lastAttackSecondRef.current = 0;
    activeTimerSecondsRef.current = {};
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setStartPage('');
    setReadAmount('');
    setReviewMemo('');
    setIsConfirmingCancel(false);
    setTimerMode('remainingPages');
    markerSoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
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
    setSelectedSessionTimerId(timerId);
    writeSessionTimerSelection(subjectId, timerId);
    setTimerMode('remainingPages');
    if (step === 'timer') {
      setPageElapsedSeconds(0);
      markerSoundPagesRef.current.delete(attackCompletedPages);
      pageTurnSoundPagesRef.current.delete(attackCompletedPages);
    }
    if (step === 'timer' && timerId !== 'none') {
      setSessionTimerIds(prev => prev.includes(timerId) ? prev : [...prev, timerId]);
    }
  };

  const addSessionTimer = () => {
    const elapsedSecondsSoFar = step === 'timer'
      ? accumulatedSecondsRef.current + (startTimeRef.current !== null ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0)
      : 0;

    setSessionTimers(prev => {
      const nextTimer = {
        id: Math.random().toString(36).substr(2, 9),
        name: `타이머 ${prev.length + 1}`
      };
      const nextTimers = [...prev, nextTimer];
      writeSessionTimers(subjectId, nextTimers);
      setSelectedSessionTimerId(nextTimer.id);
      writeSessionTimerSelection(subjectId, nextTimer.id);
      setTimerMode('remainingPages');
      if (step === 'timer') {
        activeTimerSecondsRef.current = elapsedSecondsSoFar > 0 ? { [nextTimer.id]: elapsedSecondsSoFar } : {};
        setPageElapsedSeconds(0);
        markerSoundPagesRef.current.delete(attackCompletedPages);
        pageTurnSoundPagesRef.current.delete(attackCompletedPages);
        setSessionTimerIds([nextTimer.id]);
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

  const usedSessionTimerIds = Array.from(new Set([
    ...sessionTimerIds,
    ...Object.keys(sessionTimerSeconds).filter(timerId => (sessionTimerSeconds[timerId] || 0) > 0)
  ]));
  const usedSessionTimers = usedSessionTimerIds
    .map(timerId => sessionTimers.find(timer => timer.id === timerId))
    .filter((timer): timer is SessionTimer => Boolean(timer));

  const getTimerAverageTimePerPage = (timerId: string) => {
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

  const getTimerExpectedPages = (timerId: string) => {
    const timerSeconds = sessionTimerSeconds[timerId] || 0;
    const timerAverage = getTimerAverageTimePerPage(timerId);
    if (timerSeconds <= 0 || timerAverage <= 0) return 0;
    return Math.max(0, Math.round((timerSeconds / 60) / timerAverage));
  };

  const calculateTimerPageAllocations = (totalPages: number): TimerPageAllocation[] => {
    if (usedSessionTimers.length === 0 || totalPages <= 0) return [];

    const roundedTotalPages = Math.max(0, Math.round(totalPages));
    const manualEntries = usedSessionTimers
      .map(timer => ({
        timer,
        value: timerPageDrafts[timer.id]?.trim() === '' || timerPageDrafts[timer.id] === undefined
          ? null
          : Math.max(0, Math.round(Number(timerPageDrafts[timer.id]))),
        hasMeasuredTime: (sessionTimerSeconds[timer.id] || 0) > 0
      }));
    const manualSum = manualEntries.reduce((sum, entry) => sum + (entry.value && entry.value > 0 ? entry.value : 0), 0);
    const autoPages = new Map<string, number>();
    const blankEntries = manualEntries.filter(entry => entry.value === null || Number.isNaN(entry.value));
    const measuredBlankEntries = blankEntries.filter(entry => entry.hasMeasuredTime && getTimerExpectedPages(entry.timer.id) > 0);
    const unmeasuredBlankEntries = blankEntries.filter(entry => !autoPages.has(entry.timer.id) && !measuredBlankEntries.includes(entry));
    const measuredAutoTotal = measuredBlankEntries.reduce((sum, entry) => {
      const value = getTimerExpectedPages(entry.timer.id);
      autoPages.set(entry.timer.id, value);
      return sum + value;
    }, 0);

    const remainingPagesForUnmeasured = Math.max(0, roundedTotalPages - manualSum - measuredAutoTotal);

    if (unmeasuredBlankEntries.length > 0) {
      const denominator = remainingPagesForUnmeasured % unmeasuredBlankEntries.length === 0
        ? unmeasuredBlankEntries.length
        : Math.max(1, unmeasuredBlankEntries.length - 1);
      const base = Math.floor(remainingPagesForUnmeasured / denominator);
      let used = 0;

      unmeasuredBlankEntries.forEach((entry, index) => {
        const isLast = index === unmeasuredBlankEntries.length - 1;
        const value = isLast ? Math.max(0, remainingPagesForUnmeasured - used) : base;
        used += value;
        autoPages.set(entry.timer.id, value);
      });
    }

    return manualEntries.map(entry => {
      const pages = entry.value !== null && !Number.isNaN(entry.value)
        ? Math.max(0, entry.value)
        : autoPages.get(entry.timer.id) || 0;

      return {
        timerId: entry.timer.id,
        pages,
        timeSpentMinutes: Number(((sessionTimerSeconds[entry.timer.id] || 0) / 60).toFixed(2))
      };
    }).filter(entry => entry.pages > 0 && entry.timeSpentMinutes > 0);
  };

  const handleStartMeasurement = () => {
    if (!subjectId) {
      alert('과목을 먼저 선택해주세요.');
      return;
    }
    markerSoundPagesRef.current.clear();
    pageTurnSoundPagesRef.current.clear();
    setAttackCompletedPages(0);
    setPageElapsedSeconds(0);
    setSessionTimerIds(selectedSessionTimerId !== 'none' ? [selectedSessionTimerId] : []);
    setSessionTimerSeconds({});
    setTimerPageDrafts({});
    activeTimerSecondsRef.current = {};
    lastAttackSecondRef.current = 0;
    setStep('timer');
    setIsTimerRunning(true);
  };

  const handleTimerComplete = () => {
    if (startTimeRef.current !== null) {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const nextTotalSeconds = accumulatedSecondsRef.current + currentElapsed;
      const missingTimerSeconds = Math.max(0, nextTotalSeconds - seconds);
      accumulatedSecondsRef.current = nextTotalSeconds;
      if (selectedSessionTimerId !== 'none' && missingTimerSeconds > 0) {
        activeTimerSecondsRef.current[selectedSessionTimerId] =
          (activeTimerSecondsRef.current[selectedSessionTimerId] || 0) + missingTimerSeconds;
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
    setSessionTimerSeconds(completedTimerSeconds);
    setSessionTimerIds(prev => {
      const measuredIds = Object.keys(completedTimerSeconds).filter(timerId => completedTimerSeconds[timerId] > 0);
      return Array.from(new Set([...prev, ...measuredIds]));
    });
    if (selectedSubject) {
      const nextStartPage = selectedSubject.completedPages + 1;
      setStartPage(formatPageNumber(nextStartPage));
      if (expectedReadAmount > 0) {
        setReadAmount(formatPageNumber(calculateEndPageValue(nextStartPage, expectedReadAmount)));
      }
      else {
        setReadAmount(formatPageNumber(nextStartPage));
      }
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

  if (step === 'idle') {
    return (
      <div className="animate-fade-in">
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-8">
          <span className="w-2 h-5 bg-indigo-500 rounded-full"></span>
          학습 세션 시작
        </h2>
        <div className="space-y-6 max-w-md mx-auto">
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest px-1">측정할 과목 선택</label>
            <select
              className="w-full p-4 border border-slate-200 rounded-2xl bg-white font-bold appearance-none cursor-pointer focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none"
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
            disabled={measurableSubjects.length === 0}
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
                <button
                  type="button"
                  onClick={addSessionTimer}
                  className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-black text-white shadow-lg shadow-indigo-950/20"
                  title="타이머 추가"
                >
                  +
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectSessionTimer('none')}
                  className={`rounded-2xl px-4 py-2 text-xs font-black transition-all ${selectedSessionTimerId === 'none' ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-400 hover:text-white'}`}
                >
                  없음
                </button>
                {sessionTimers.map(timer => (
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
                          {timer.name}
                        </button>
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
                      </>
                    )}
                  </div>
                ))}
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
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">타임어택</p>
                  <div className="font-mono text-7xl md:text-8xl font-black text-white tabular-nums">
                    {averageTimePerPage > 0 ? formatTime(pageAttackRemainingSeconds) : '--:--'}
                  </div>
                </div>
                <p className="mt-5 text-xs font-bold text-slate-500">
                  {averageTimePerPage > 0
                    ? `${formatPageNumber(plannedPageCount)}장 목표 · 현재 시간 기준 ${formatPageNumber(timeTargetPages)}장 진행`
                    : selectedSessionTimerId !== 'none'
                      ? '선택한 타이머로 저장된 최근 기록이 필요합니다.'
                      : '최근 5일 안에 하루치 학습량을 끝낸 기록이 필요합니다.'}
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
              <div className="space-y-2">
                <label className="text-[10px] font-black text-indigo-500 uppercase ml-2 tracking-widest">완료된 끝 페이지</label>
                <input
                  type="number"
                  step="1"
                  value={readAmount}
                  onChange={e => setReadAmount(e.target.value)}
                  placeholder="0"
                  autoFocus
                  className="w-full p-4 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-2xl font-black text-3xl text-center outline-none transition-all shadow-sm text-indigo-900"
                />
                <p className="px-2 text-center text-[10px] font-bold text-slate-400">
                  시작 p.{formatPageNumber(parseFloat(startPage) || 0)} · 학습량 {currentReadAmount > 0 ? formatPageNumber(currentReadAmount) : '0'}P
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">이전 속도</p>
                  <p className="mt-1 text-lg font-black text-slate-700">
                    {averageTimePerPage > 0 ? `${averageTimePerPage.toFixed(2)}분/P` : '기록 필요'}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">이번 속도</p>
                  <p className="mt-1 text-lg font-black text-indigo-600">
                    {currentTimePerPage > 0 ? `${currentTimePerPage.toFixed(2)}분/P` : '-'}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-3 text-center border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">속도 변화</p>
                  <p className={`mt-1 text-lg font-black ${speedRatioPercent > 100 ? 'text-emerald-600' : speedRatioPercent > 0 && speedRatioPercent < 100 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {currentTimePerPage > 0 && averageTimePerPage > 0
                      ? speedRatioPercent > 100
                        ? `${speedRatioPercent.toFixed(0)}% 속도`
                        : speedRatioPercent < 100
                          ? `${Math.abs(speedDeltaMinutes).toFixed(2)}분/P 느림`
                          : '변화 없음'
                      : '-'}
                  </p>
                </div>
              </div>
              {usedSessionTimers.length > 0 && currentReadAmount > 0 && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-indigo-500">타이머별 학습량</label>
                    <span className="text-[10px] font-bold text-indigo-300">비워두면 자동 분배</span>
                  </div>
                  <div className="space-y-2">
                    {usedSessionTimers.map(timer => {
                      const autoAllocation = calculateTimerPageAllocations(currentReadAmount)
                        .find(entry => entry.timerId === timer.id);
                      return (
                        <div key={timer.id} className="grid grid-cols-[1fr_110px] items-center gap-2 rounded-xl bg-white p-2">
                          <div>
                            <p className="text-sm font-black text-slate-800">{timer.name}</p>
                            <p className="text-[10px] font-bold text-slate-400">
                              측정 시간 {formatTime(sessionTimerSeconds[timer.id] || 0)}
                              {timerPageDrafts[timer.id]?.trim() ? '' : ` · 예상 ${formatPageNumber(autoAllocation?.pages || 0)}P`}
                            </p>
                          </div>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            value={timerPageDrafts[timer.id] || ''}
                            onChange={e => setTimerPageDrafts(prev => ({
                              ...prev,
                              [timer.id]: e.target.value === '' ? '' : String(Math.max(0, Math.round(Number(e.target.value) || 0)))
                            }))}
                            placeholder={formatPageNumber(autoAllocation?.pages || 0)}
                            className="w-full rounded-xl border border-indigo-100 bg-indigo-50 p-2 text-center text-lg font-black text-indigo-900 outline-none focus:border-indigo-500"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
