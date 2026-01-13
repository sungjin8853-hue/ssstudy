import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TestCategory, TestDifficultySpace, TestRecord, StudyLog } from '../types';
import { calculateGraphLengthAnalysis, calculateStudyBurdenV2 } from '../utils/math';

interface Props {
  testCategories: TestCategory[];
  logs: StudyLog[];
  onAddCategory: (name: string, subjectId?: string) => void;
  onDeleteCategory: (id: string) => void;
  onAddDifficultySpace: (categoryId: string, name: string) => void;
  onDeleteDifficultySpace: (categoryId: string, spaceId: string) => void;
  onAddRecord: (categoryId: string, spaceId: string, record: TestRecord) => void;
  onDeleteRecord: (categoryId: string, spaceId: string, recordId: string) => void;
}

type EntryStep = 'idle' | 'timer' | 'score' | 'details';

export const TestManager: React.FC<Props> = ({ 
  testCategories, 
  logs,
  onAddCategory, 
  onDeleteCategory, 
  onAddDifficultySpace,
  onDeleteDifficultySpace,
  onAddRecord,
  onDeleteRecord 
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [showAddCategoryForm, setShowAddCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showAddSpaceForm, setShowAddSpaceForm] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  
  const [entryStep, setEntryStep] = useState<EntryStep>('idle');
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  
  const [testSeconds, setTestSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef<number>(0);

  const [scoreTens, setScoreTens] = useState(0);
  const [scoreOnes, setScoreOnes] = useState(0);

  const [formData, setFormData] = useState({ b: 0, tStudy: 0, tRec: 60 });
  const [targetH3, setTargetH3] = useState<number>(10);

  const activeCategory = testCategories.find(c => c.id === activeCategoryId);
  const activeSpace = activeCategory?.difficultySpaces.find(s => s.id === activeSpaceId);

  useEffect(() => {
    if (isTimerRunning) {
      startTimeRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        if (startTimeRef.current !== null) {
          const now = Date.now();
          const currentElapsed = Math.floor((now - startTimeRef.current) / 1000);
          setTestSeconds(accumulatedSecondsRef.current + currentElapsed);
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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTimerRunning]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartTest = () => {
    setTestSeconds(0);
    accumulatedSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(true);
    setEntryStep('timer');
  };

  const resetEntry = () => {
    setEntryStep('idle');
    setTestSeconds(0);
    accumulatedSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setScoreTens(0);
    setScoreOnes(0);
    setIsConfirmingCancel(false);
  };

  const analytics = useMemo(() => {
    if (!activeSpace || activeSpace.records.length === 0) return null;
    const recs = activeSpace.records;
    const last = recs[recs.length - 1];
    const prev = recs.length >= 2 ? recs[recs.length - 2] : null;
    const avgScore = recs.reduce((a, b) => a + b.h1, 0) / recs.length;
    return { last, prev, avgScore, count: recs.length };
  }, [activeSpace]);

  const insights = useMemo(() => {
    if (!analytics || !analytics.prev || !analytics.last) return null;
    const h1 = analytics.prev.h1;
    const h2 = analytics.last.h1 - analytics.prev.h1;
    const b = analytics.last.b;
    if (h1 <= 0 || b <= 0) return null;
    const graphData = calculateGraphLengthAnalysis({ h1, h2, b, tStudy: analytics.last.tStudy, tTest: analytics.last.tTest, tRec: analytics.last.tRec, h3: 0 });
    const cubicBData = calculateStudyBurdenV2({ h1, h2, b, h3: targetH3, tStudy: 0, tTest: 0, tRec: 0 });
    const linearB = h2 > 0 ? (b / h2) * targetH3 : 0;
    return { graphData, linearB, cubicB: cubicBData.total };
  }, [analytics, targetH3]);

  const handleFinalSave = () => {
    if (!activeCategory || !activeSpace) return;
    const score = (scoreTens * 10) + scoreOnes;
    onAddRecord(activeCategory.id, activeSpace.id, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      h1: score,
      b: formData.b,
      tStudy: formData.tStudy,
      tTest: parseFloat((testSeconds / 60).toFixed(2)),
      tRec: formData.tRec
    });
    resetEntry();
  };

  if (activeCategory && activeSpace) {
    return (
      <div className="animate-fade-in">
        <div className="flex justify-between items-center mb-6">
          <button onClick={() => { setActiveSpaceId(null); resetEntry(); }} className="text-slate-400 font-bold text-sm">← 공간 목록</button>
          <button onClick={handleStartTest} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-black text-xs">＋ 테스트 시작</button>
        </div>

        {entryStep !== 'idle' && (
          <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 ${entryStep === 'timer' ? 'bg-slate-950' : 'bg-white'}`} style={{ zIndex: 9999 }}>
             <button onClick={() => setIsConfirmingCancel(true)} className="fixed top-8 right-8 w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold">✕</button>
             
             <div className="w-full max-w-lg">
                {entryStep === 'timer' && (
                  <div className="text-center">
                    <div className="text-8xl md:text-9xl font-mono font-black text-white mb-16">{formatTime(testSeconds)}</div>
                    <div className="flex gap-4">
                      <button onClick={() => setIsTimerRunning(!isTimerRunning)} className="flex-[2] py-6 bg-indigo-600 text-white rounded-3xl font-black text-xl">{isTimerRunning ? '일시정지' : '다시시작'}</button>
                      <button onClick={() => { setIsTimerRunning(false); setEntryStep('score'); }} className="flex-1 py-6 bg-green-600 text-white rounded-3xl font-black text-xl">완료</button>
                    </div>
                  </div>
                )}

                {entryStep === 'score' && (
                  <div className="text-center">
                    <h3 className="text-3xl font-black mb-12">시험 점수</h3>
                    <div className="flex justify-center gap-8 mb-16">
                      {[scoreTens, scoreOnes].map((v, i) => (
                        <div key={i} className="flex flex-col items-center gap-2">
                           {/* Fix: Using functional state update to resolve 't' and 'o' being undefined */}
                           <button onClick={() => i === 0 ? setScoreTens(prev => (prev + 1) % 10) : setScoreOnes(prev => (prev + 1) % 10)} className="w-12 h-12 bg-slate-50 rounded-xl">▲</button>
                           <span className="text-6xl font-black">{v}</span>
                           {/* Fix: Using functional state update to resolve 't' and 'o' being undefined */}
                           <button onClick={() => i === 0 ? setScoreTens(prev => (prev - 1 + 10) % 10) : setScoreOnes(prev => (prev - 1 + 10) % 10)} className="w-12 h-12 bg-slate-50 rounded-xl">▼</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => setEntryStep('timer')} className="flex-1 py-5 bg-slate-100 rounded-2xl font-bold">뒤로</button>
                      <button onClick={() => setEntryStep('details')} className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-bold">다음</button>
                    </div>
                  </div>
                )}

                {entryStep === 'details' && (
                  <div className="space-y-6">
                    <h3 className="text-3xl font-black text-center mb-8">세부 정보</h3>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-400 uppercase">공부량 (P)</label>
                         <input type="number" value={formData.b} onChange={e => setFormData({...formData, b: Number(e.target.value)})} className="w-full p-4 bg-slate-50 rounded-xl font-bold" />
                       </div>
                       <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-400 uppercase">공부시간 (h)</label>
                         <input type="number" step="0.1" value={formData.tStudy} onChange={e => setFormData({...formData, tStudy: Number(e.target.value)})} className="w-full p-4 bg-slate-50 rounded-xl font-bold" />
                       </div>
                    </div>
                    <div className="flex gap-4 pt-8">
                      <button onClick={() => setEntryStep('score')} className="flex-1 py-5 bg-slate-100 rounded-2xl font-bold">뒤로</button>
                      <button onClick={handleFinalSave} className="flex-[2] py-5 bg-indigo-600 text-white rounded-2xl font-bold">분석 완료</button>
                    </div>
                  </div>
                )}
             </div>
          </div>
        )}

        {analytics ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="md:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-200">
                <div className="flex justify-between items-center mb-8">
                  <span className="text-2xl font-black text-indigo-600">{analytics.last.h1}점</span>
                  <span className="text-xs font-bold text-slate-400">{new Date(analytics.last.timestamp).toLocaleDateString()}</span>
                </div>
                {insights && (
                   <div className="space-y-2">
                     <p className="text-[10px] font-black text-slate-400 uppercase">성과 지수 (PI)</p>
                     <p className="text-5xl font-black text-slate-900">{insights.graphData.total.toFixed(4)}</p>
                   </div>
                )}
             </div>
             <div className="bg-indigo-600 p-8 rounded-[2.5rem] text-white flex flex-col justify-center">
                <p className="text-[10px] font-bold uppercase opacity-60 mb-2">예측 필요 학습량</p>
                <p className="text-4xl font-black">{insights?.cubicB.toFixed(1) || '---'}P</p>
             </div>
          </div>
        ) : (
          <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100 text-slate-300">데이터를 등록해 주세요.</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
       <div className="bg-white p-8 rounded-[2.5rem] flex justify-between items-center border border-slate-200">
         <h3 className="text-2xl font-black">시험 관리 허브</h3>
         <button onClick={() => setShowAddCategoryForm(!showAddCategoryForm)} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold">＋ 공간 추가</button>
       </div>
       
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {testCategories.map(cat => (
           <div key={cat.id} onClick={() => setActiveCategoryId(cat.id)} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl cursor-pointer transition-all">
             <h4 className="text-xl font-black text-slate-800">{cat.name}</h4>
             <p className="text-xs text-slate-400 mt-4">{cat.difficultySpaces.length}개의 난이도 공간</p>
           </div>
         ))}
       </div>
    </div>
  );
};
