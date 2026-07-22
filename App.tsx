import React, { useState, useEffect, useMemo } from 'react';
import { Subject, StudyLog, TestCategory, TestDifficultySpace, TestRecord, TagDefinition } from './types';
import { SubjectPlanner } from './components/SubjectPlanner';
import { SessionLogger } from './components/SessionLogger';
import { Analytics } from './components/Analytics';
import { ReviewManager } from './components/ReviewManager';
import { HistoryCharts } from './components/HistoryCharts';
import { TodaySummary } from './components/TodaySummary';
import { GoogleGenAI } from '@google/genai';

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

const SIDEBAR_COLLAPSED_KEY = 'swp_sidebar_collapsed';
const INITIAL_REVIEW_DELAY_MS = 2 * 60 * 60 * 1000;
const TEST_REVIEW_DELAY_THRESHOLD_MS = 10 * 60 * 1000;

const readSidebarCollapsed = () => {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
};

const writeSidebarCollapsed = (collapsed: boolean) => {
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
};

const repairTestReviewDate = (log: StudyLog) => {
  const currentStep = log.reviewStep ?? 0;
  if (currentStep !== 0 || log.isCondensed || log.reviewEnabled === false || !log.nextReviewDate) {
    return log.nextReviewDate ?? log.timestamp;
  }

  const studiedAt = new Date(log.timestamp).getTime();
  const reviewAt = new Date(log.nextReviewDate).getTime();
  const wasTestDelay = Number.isFinite(studiedAt)
    && Number.isFinite(reviewAt)
    && reviewAt >= studiedAt
    && reviewAt - studiedAt < TEST_REVIEW_DELAY_THRESHOLD_MS;

  return wasTestDelay
    ? new Date(Date.now() + INITIAL_REVIEW_DELAY_MS).toISOString()
    : log.nextReviewDate;
};

const REVIEW_SESSION_PREF_KEY = 'swp_session_review_preferences';

const readReviewSessionPreferences = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_SESSION_PREF_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const shouldSkipReviewForLog = (log: StudyLog, subject?: Subject) => {
  const sessionReviewPreference = readReviewSessionPreferences()[log.subjectId];
  if (sessionReviewPreference !== undefined) {
    return sessionReviewPreference === true;
  }
  return log.isCondensed === true || subject?.reviewEnabled === false;
};

const App: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [testCategories, setTestCategories] = useState<TestCategory[]>([]);
  const [logs, setLogs] = useState<StudyLog[]>([]);
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'review'>('dashboard');
  const [dashboardActionTab, setDashboardActionTab] = useState<'logger' | 'planner'>('logger');
  const [aiTip, setAiTip] = useState<string>('목표를 향한 오늘의 첫걸음을 응원합니다.');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsed);

  // 커스텀 확인 모달 상태
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    message: string;
    subMessage?: string;
    onConfirm: () => void;
  }>({ isOpen: false, message: '', onConfirm: () => {} });

  const todayStr = useMemo(() => {
    const d = new Date();
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    return d.toLocaleDateString('ko-KR', options);
  }, []);

  // Persistence (Safe Load)
  useEffect(() => {
    try {
      const savedSubs = localStorage.getItem('swp_subjects');
      const savedTests = localStorage.getItem('swp_tests_categories_v3');
      const savedLogs = localStorage.getItem('swp_logs');
      const savedTags = localStorage.getItem('swp_tags');
      const loadedSubjects: Array<Subject & {
        procedures?: Array<{ totalPages: number; completedPages: number }>;
      }> = savedSubs ? JSON.parse(savedSubs) || [] : [];
      const loadedTags: TagDefinition[] = savedTags ? JSON.parse(savedTags) || [] : [];
      
      if (savedSubs) {
        setSubjects(loadedSubjects.map(subject => ({
          id: subject.id,
          name: subject.name,
          totalPages: subject.procedures?.[0]?.totalPages ?? subject.totalPages,
          completedPages: subject.procedures?.length
            ? subject.procedures.reduce((sum, procedure) => sum + procedure.completedPages, 0)
            : subject.completedPages,
          targetDate: subject.targetDate,
          tagIds: subject.tagIds,
          reviewEnabled: subject.reviewEnabled ?? true
        })));
      }
      if (savedTests) setTestCategories(JSON.parse(savedTests) || []);
      if (savedLogs) {
        // 레거시 데이터 마이그레이션: nextReviewDate가 없으면 timestamp로 초기화
        const loadedLogs: StudyLog[] = JSON.parse(savedLogs) || [];
        const migratedLogs = loadedLogs.map(log => {
          const subject = loadedSubjects.find(item => item.id === log.subjectId);
          const folderSnapshots = getFolderSnapshots(subject?.tagIds || [], loadedTags);

          return {
            ...log,
            subjectNameSnapshot: log.subjectNameSnapshot || subject?.name || '삭제된 과목',
            folderSnapshots: log.folderSnapshots || folderSnapshots,
            reviewStep: log.reviewStep ?? 0,
            nextReviewDate: repairTestReviewDate({
              ...log,
              reviewStep: log.reviewStep ?? 0,
              nextReviewDate: log.nextReviewDate ?? log.timestamp,
              isCondensed: log.isCondensed ?? false
            }),
            isCondensed: log.isCondensed ?? false
          };
        });
        setLogs(migratedLogs);
      }
      if (savedTags) setTagDefinitions(loadedTags);
    } catch (e) {
      console.error("Failed to load data from localStorage", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('swp_subjects', JSON.stringify(subjects));
    localStorage.setItem('swp_tests_categories_v3', JSON.stringify(testCategories));
    localStorage.setItem('swp_logs', JSON.stringify(logs));
    localStorage.setItem('swp_tags', JSON.stringify(tagDefinitions));
  }, [subjects, testCategories, logs, tagDefinitions]);

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
    setDashboardActionTab('logger');
  };

  const handleUpdateSubject = (updatedSubject: Subject) => {
    setSubjects(prev => prev.map(s => s.id === updatedSubject.id ? updatedSubject : s));
    setLogs(prev => prev.map(log => {
      if (log.subjectId !== updatedSubject.id) return log;
      return {
        ...log,
        subjectNameSnapshot: updatedSubject.name
      };
    }));
  };

  const toggleSidebar = () => {
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    writeSidebarCollapsed(next);
  };

  const handleDeleteSubject = (id: string) => {
    openConfirm(
      '과목을 삭제하시겠습니까?',
      '과목은 목록에서 삭제되지만 기존 학습 기록과 누적 통계는 유지됩니다.',
      () => {
        setSubjects(prev => prev.filter(s => s.id !== id));
        setTestCategories(prev => prev.filter(c => c.subjectId !== id));
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
        const getTargetFolderIds = (rootId: string, allTags: TagDefinition[]): string[] => {
            const children = allTags.filter(t => t.parentId === rootId);
            const childIds = children.flatMap(c => getTargetFolderIds(c.id, allTags));
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

  const handleAddCategory = (name: string, subjectId?: string) => {
    const newCat: TestCategory = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      subjectId,
      difficultySpaces: []
    };
    setTestCategories(prev => [...prev, newCat]);
  };

  const handleDeleteCategory = (id: string) => {
    openConfirm('시험 공간을 삭제하시겠습니까?', '내부의 모든 테스트 기록이 함께 삭제됩니다.', () => {
      setTestCategories(prev => prev.filter(c => c.id !== id));
    });
  };

  const handleAddDifficultySpace = (categoryId: string, name: string, subjectIds: string[]) => {
    setTestCategories(prev => prev.map(cat => {
      if (cat.id === categoryId) {
        const newSpace: TestDifficultySpace = {
          id: Math.random().toString(36).substr(2, 9),
          name,
          records: [],
          subjectIds: subjectIds
        };
        return { ...cat, difficultySpaces: [...cat.difficultySpaces, newSpace] };
      }
      return cat;
    }));
  };

  const handleDeleteDifficultySpace = (categoryId: string, spaceId: string) => {
    openConfirm('난이도 공간을 삭제하시겠습니까?', '해당 공간의 모든 기록이 사라집니다.', () => {
      setTestCategories(prev => prev.map(cat => {
        if (cat.id === categoryId) {
          return { ...cat, difficultySpaces: cat.difficultySpaces.filter(s => s.id !== spaceId) };
        }
        return cat;
      }));
    });
  };

  const handleAddRecord = (categoryId: string, spaceId: string, record: TestRecord) => {
    setTestCategories(prev => prev.map(cat => {
      if (cat.id === categoryId) {
        const targetSubIds = record.subjectIds || [];
        if (targetSubIds.length > 0) {
          setSubjects(sPrev => sPrev.map(s => 
            targetSubIds.includes(s.id) ? { ...s, completedPages: s.completedPages + record.b } : s
          ));
        }
        
        const newSpaces = cat.difficultySpaces.map(space => {
          if (space.id === spaceId) {
            return { ...space, records: [...space.records, record] };
          }
          return space;
        });
        return { ...cat, difficultySpaces: newSpaces };
      }
      return cat;
    }));
  };

  const handleDeleteRecord = (categoryId: string, spaceId: string, recordId: string) => {
    setTestCategories(prev => prev.map(cat => {
      if (cat.id === categoryId) {
        const space = cat.difficultySpaces.find(s => s.id === spaceId);
        const recordToDelete = space?.records.find(r => r.id === recordId);
        
        const targetSubIds = recordToDelete?.subjectIds || [];
        if (targetSubIds.length > 0 && recordToDelete) {
          setSubjects(sPrev => sPrev.map(s => 
            targetSubIds.includes(s.id) ? { ...s, completedPages: Math.max(0, s.completedPages - recordToDelete.b) } : s
          ));
        }

        const newSpaces = cat.difficultySpaces.map(s => {
          if (s.id === spaceId) {
            return { ...s, records: s.records.filter(r => r.id !== recordId) };
          }
          return s;
        });
        return { ...cat, difficultySpaces: newSpaces };
      }
      return cat;
    }));
  };
  
  const handleLogSession = (log: StudyLog) => {
    const subject = subjects.find(item => item.id === log.subjectId);
    const skipReview = shouldSkipReviewForLog(log, subject);
    const folderSnapshots = getFolderSnapshots(subject?.tagIds || [], tagDefinitions);
    const newLog: StudyLog = {
        ...log,
        subjectNameSnapshot: subject?.name || '삭제된 과목',
        folderSnapshots,
        reviewStep: 0,
        nextReviewDate: !skipReview
          ? new Date(Date.now() + INITIAL_REVIEW_DELAY_MS).toISOString()
          : undefined,
        isCondensed: skipReview,
        reviewEnabled: !skipReview
    };
    setLogs(prev => [...prev, newLog]);
    setSubjects(prev => prev.map(sub => {
      if (sub.id === log.subjectId) {
        return {
          ...sub,
          completedPages: Math.min(sub.totalPages, sub.completedPages + log.pagesRead)
        };
      }
      return sub;
    }));
  };

  const handleUpdateLog = (updatedLog: StudyLog) => {
    const oldLog = logs.find(l => l.id === updatedLog.id);
    if (!oldLog) return;

    const subject = subjects.find(item => item.id === updatedLog.subjectId);
    const enrichedLog: StudyLog = {
      ...updatedLog,
      subjectNameSnapshot: subject?.name || updatedLog.subjectNameSnapshot || '삭제된 과목',
      folderSnapshots: getFolderSnapshots(subject?.tagIds || [], tagDefinitions)
    };

    setLogs(prev => prev.map(l => l.id === updatedLog.id ? enrichedLog : l));
    setSubjects(prev => prev.map(sub => {
      if (oldLog.subjectId === updatedLog.subjectId && sub.id === updatedLog.subjectId) {
        const pageDiff = updatedLog.pagesRead - oldLog.pagesRead;
        return {
          ...sub,
          completedPages: Math.min(sub.totalPages, Math.max(0, sub.completedPages + pageDiff))
        };
      }

      if (oldLog.subjectId !== updatedLog.subjectId && sub.id === oldLog.subjectId) {
        return {
          ...sub,
          completedPages: Math.max(0, sub.completedPages - oldLog.pagesRead)
        };
      }

      if (oldLog.subjectId !== updatedLog.subjectId && sub.id === updatedLog.subjectId) {
        return {
          ...sub,
          completedPages: Math.min(sub.totalPages, sub.completedPages + updatedLog.pagesRead)
        };
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
        return {
          ...subject,
          completedPages: Math.max(0, subject.completedPages - logToDelete.pagesRead)
        };
      }));
    });
  };

  const handleReplaceLogs = (logIds: string[], replacementLog: StudyLog) => {
    const logsToReplace = logs.filter(log => logIds.includes(log.id));
    if (logsToReplace.length === 0) return;

    const subject = subjects.find(item => item.id === replacementLog.subjectId);
    const skipReview = shouldSkipReviewForLog(replacementLog, subject);
    const enrichedLog: StudyLog = {
      ...replacementLog,
      subjectNameSnapshot: subject?.name || replacementLog.subjectNameSnapshot || '삭제된 과목',
      folderSnapshots: getFolderSnapshots(subject?.tagIds || [], tagDefinitions),
      reviewStep: replacementLog.reviewStep ?? 0,
      nextReviewDate: !skipReview
        ? replacementLog.nextReviewDate ?? new Date(Date.now() + INITIAL_REVIEW_DELAY_MS).toISOString()
        : undefined,
      isCondensed: skipReview,
      reviewEnabled: !skipReview
    };

    setLogs(prev => [...prev.filter(log => !logIds.includes(log.id)), enrichedLog]);
    setSubjects(prev => prev.map(subjectItem => {
      const removedPages = logsToReplace
        .filter(log => log.subjectId === subjectItem.id)
        .reduce((sum, log) => sum + log.pagesRead, 0);
      const addedPages = subjectItem.id === replacementLog.subjectId ? replacementLog.pagesRead : 0;

      if (removedPages === 0 && addedPages === 0) return subjectItem;

      return {
        ...subjectItem,
        completedPages: Math.min(subjectItem.totalPages, Math.max(0, subjectItem.completedPages - removedPages + addedPages))
      };
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
          .filter(log => log.subjectId === subjectItem.id)
          .reduce((sum, log) => sum + log.pagesRead, 0);

        if (removedPages === 0) return subjectItem;

        return {
          ...subjectItem,
          completedPages: Math.max(0, subjectItem.completedPages - removedPages)
        };
      }));
    });
  };

  // 복습 액션 처리 (완료 또는 축약)
  const handleReviewAction = (logIds: string | string[], action: 'complete' | 'condense') => {
    const targetIds = new Set(Array.isArray(logIds) ? logIds : [logIds]);
    setLogs(prev => prev.map(log => {
        if (!targetIds.has(log.id)) return log;

        if (action === 'condense') {
            return { ...log, isCondensed: true };
        }

        // 복습 완료 시 다음 주기 계산
        // 주기: 2시간(초기) -> 1일 -> 4일 -> 7일 -> 14일 -> 28일 -> (이후 2배씩)
        const currentStep = log.reviewStep || 0;
        let nextInterval = 0;

        // currentStep은 "현재 완료한 단계"가 아니라 "도래한 단계"
        // 즉, Step 0은 "2시간 후" 복습을 의미함.
        // Step 0을 완료하면 다음은 "1일 후"여야 함.
        
        if (currentStep === 0) nextInterval = 1 * 24 * 60 * 60 * 1000; // 1일
        else if (currentStep === 1) nextInterval = 4 * 24 * 60 * 60 * 1000; // 4일
        else if (currentStep === 2) nextInterval = 7 * 24 * 60 * 60 * 1000; // 7일
        else if (currentStep === 3) nextInterval = 14 * 24 * 60 * 60 * 1000; // 14일
        else if (currentStep === 4) nextInterval = 28 * 24 * 60 * 60 * 1000; // 28일
        else {
            // Step 5 완료 시 (28일 지난 시점) -> 다음은 56일
            // 28 * 2^(step-4)
            const multiplier = Math.pow(2, currentStep - 4);
            nextInterval = 28 * 24 * 60 * 60 * 1000 * multiplier;
        }

        const nextDate = new Date(Date.now() + nextInterval);

        return {
            ...log,
            isReviewed: true, // 레거시 호환용
            reviewStep: currentStep + 1,
            nextReviewDate: nextDate.toISOString()
        };
    }));
  };

  const handleUpdateReviewMemo = (logId: string, memo: string) => {
    setLogs(prev => prev.map(log => log.id === logId ? { ...log, reviewMemo: memo } : log));
  };

  return (
    <div className={`min-h-screen pb-20 md:pb-0 bg-slate-50 transition-all ${isSidebarCollapsed ? 'md:pl-20' : 'md:pl-64'}`}>
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

      <nav className={`hidden md:flex flex-col bg-white h-screen border-r border-slate-200 fixed left-0 top-0 z-40 transition-all ${isSidebarCollapsed ? 'w-20 p-4' : 'w-64 p-6'}`}>
        <div className={`mb-10 flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xl font-bold">W</div>
          {!isSidebarCollapsed && <h1 className="text-xl font-black text-slate-800 tracking-tight">StudyWise</h1>}
        </div>
        
        <div className="space-y-2 flex-grow">
          <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon="📊" label="학습 현황" collapsed={isSidebarCollapsed} />
          <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon="📈" label="추이 분석" collapsed={isSidebarCollapsed} />
          <NavButton active={activeTab === 'review'} onClick={() => setActiveTab('review')} icon="🔄" label="복습 관리" collapsed={isSidebarCollapsed} />
        </div>

        {!isSidebarCollapsed && <div className="mt-auto p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
          <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">오늘의 AI 팁</p>
          <p className="text-sm text-indigo-800 font-medium leading-tight">"{aiTip}"</p>
        </div>}

        <button
          type="button"
          onClick={toggleSidebar}
          className="mt-4 rounded-xl bg-slate-100 px-3 py-3 text-xs font-black text-slate-500 transition-all hover:bg-indigo-50 hover:text-indigo-600"
        >
          {isSidebarCollapsed ? '열기' : '접기'}
        </button>
      </nav>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-3 z-50 shadow-lg">
        <button onClick={() => setActiveTab('dashboard')} className={`p-2 rounded-xl ${activeTab === 'dashboard' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}>📊</button>
        <button onClick={() => setActiveTab('history')} className={`p-2 rounded-xl ${activeTab === 'history' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}>📈</button>
        <button onClick={() => setActiveTab('review')} className={`p-2 rounded-xl ${activeTab === 'review' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}>🔄</button>
      </nav>

      <main className="p-4 md:p-10 max-w-6xl mx-auto">
        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-indigo-500 uppercase tracking-widest">{todayStr}</p>
            <h2 className="text-3xl font-black text-slate-900 mt-1">
              {activeTab === 'dashboard' ? '학습 데이터 분석' : 
               activeTab === 'history' ? '학습 추이 및 리포트' : '에빙하우스 복습 관리'}
            </h2>
          </div>
        </header>

        <div className="transition-all duration-300">
          {activeTab === 'dashboard' && (
            <div className="space-y-10 animate-fade-in">
              <Analytics 
                subjects={subjects} 
                logs={logs} 
                tagDefinitions={tagDefinitions}
                onUpdateSubject={handleUpdateSubject} 
                onDeleteSubject={handleDeleteSubject} 
                onUpdateTags={handleUpdateTags}
                onDeleteFolder={handleDeleteFolder}
                onOpenReview={() => setActiveTab('review')}
              />
              <TodaySummary
                logs={logs}
                subjects={subjects}
                onAddLog={handleLogSession}
                onReplaceLogs={handleReplaceLogs}
                onDeleteLogs={handleDeleteLogs}
              />
              
              <div className="bg-white rounded-[3.5rem] shadow-sm border border-slate-200 overflow-hidden animate-fade-in">
                <div className="flex bg-slate-50 p-3 m-4 rounded-[2rem] border border-slate-100">
                  <button 
                    onClick={() => setDashboardActionTab('logger')}
                    className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-sm transition-all ${
                      dashboardActionTab === 'logger' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <span>⏱️</span> 학습 기록 측정
                  </button>
                  <button 
                    onClick={() => setDashboardActionTab('planner')}
                    className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-sm transition-all ${
                      dashboardActionTab === 'planner' ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <span>📅</span> 새 학습 계획 추가
                  </button>
                </div>
                
                <div className="p-8 md:p-12">
                  {dashboardActionTab === 'logger' ? (
                    <SessionLogger
                      subjects={subjects}
                      tagDefinitions={tagDefinitions}
                      logs={logs}
                      onLogSession={handleLogSession}
                    />
                  ) : (
                    <SubjectPlanner onAddSubject={handleAddSubject} />
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && <HistoryCharts subjects={subjects} logs={logs} />}
          {activeTab === 'review' && (
            <ReviewManager
              logs={logs}
              subjects={subjects}
              onReviewAction={handleReviewAction}
              onUpdateReviewMemo={handleUpdateReviewMemo}
            />
          )}
        </div>
      </main>
    </div>
  );
};

const NavButton: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string; collapsed?: boolean }> = ({ active, onClick, icon, label, collapsed }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-4'} py-3 rounded-xl transition-all ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-600 hover:bg-slate-100'}`}
  >
    <span className="text-xl">{icon}</span>
    {!collapsed && <span className="font-bold text-sm">{label}</span>}
  </button>
);

export default App;
