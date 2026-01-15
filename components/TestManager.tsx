
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TestCategory, TestDifficultySpace, TestRecord, StudyLog, Subject } from '../types';
import { calculateRequiredReviewCount, calculateStudyBurdenV2, calculateMentalBurden } from '../utils/math';

interface Props {
  testCategories: TestCategory[];
  logs: StudyLog[];
  subjects: Subject[];
  onAddCategory: (name: string, subjectId?: string) => void;
  onDeleteCategory: (id: string) => void;
  onAddDifficultySpace: (categoryId: string, name: string, subjectIds: string[]) => void;
  onDeleteDifficultySpace: (categoryId: string, spaceId: string) => void;
  onAddRecord: (categoryId: string, spaceId: string, record: TestRecord) => void;
  onDeleteRecord: (categoryId: string, spaceId: string, recordId: string) => void;
}

type EntryStep = 'idle' | 'timer' | 'score' | 'details';

export const TestManager: React.FC<Props> = ({ 
  testCategories, 
  logs,
  subjects,
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
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  
  const [entryStep, setEntryStep] = useState<EntryStep>('idle');
  const [testSeconds, setTestSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef<number>(0);

  const [scoreTens, setScoreTens] = useState(0);
  const [scoreOnes, setScoreOnes] = useState(0);

  const [formData, setFormData] = useState({ b: 0, tStudy: 0, tRec: 60 });
  const [targetH3, setTargetH3] = useState<number>(10);

  const activeCategory = useMemo(() => testCategories.find(c => c.id === activeCategoryId), [testCategories, activeCategoryId]);
  const activeSpace = useMemo(() => activeCategory?.difficultySpaces.find(s => s.id === activeSpaceId), [activeCategory, activeSpaceId]);

  const toggleSubjectSelection = (id: string) => {
    setSelectedSubjectIds(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

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

  const calculateAggregateStudyData = () => {
    if (!activeSpace || !activeSpace.subjectIds || activeSpace.subjectIds.length === 0) {
      return { b: 0, tStudy: 0 };
    }
    let totalB = 0;
    let totalTMinutes = 0;
    activeSpace.subjectIds.forEach(subId => {
      let lastTestTimestamp = 0;
      testCategories.forEach(cat => {
        cat.difficultySpaces.forEach(space => {
          space.records.forEach(rec => {
            if (rec.subjectIds?.includes(subId)) {
              const time = new Date(rec.timestamp).getTime();
              if (time > lastTestTimestamp) lastTestTimestamp = time;
            }
          });
        });
      });
      const subLogs = logs.filter(l => l.subjectId === subId && new Date(l.timestamp).getTime() > lastTestTimestamp);
      totalB += subLogs.reduce((acc, cur) => acc + cur.pagesRead, 0);
      totalTMinutes += subLogs.reduce((acc, cur) => acc + cur.timeSpentMinutes, 0);
    });
    return { b: totalB, tStudy: parseFloat((totalTMinutes / 60).toFixed(2)) };
  };

  const currentAccumulatedStudy = useMemo(() => calculateAggregateStudyData(), [activeSpace, logs, testCategories]);

  useEffect(() => {
    if (entryStep === 'details' && activeSpace) {
      const aggregate = calculateAggregateStudyData();
      setFormData(prev => ({ ...prev, b: aggregate.b, tStudy: aggregate.tStudy }));
    }
  }, [entryStep, activeSpace]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const resetEntry = () => {
    setEntryStep('idle');
    setTestSeconds(0);
    accumulatedSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setScoreTens(0);
    setScoreOnes(0);
    setFormData({ b: 0, tStudy: 0, tRec: 60 });
  };

  const analytics = useMemo(() => {
    if (!activeSpace || activeSpace.records.length === 0) return null;
    const recs = activeSpace.records;
    const last = recs[recs.length - 1];
    const prev = recs.length >= 2 ? recs[recs.length - 2] : null;
    
    let mentalBurden = { total: 0, init: 0, length: 0 };
    let densityC = 0;
    if (prev) {
      mentalBurden = calculateMentalBurden(prev.h1, Math.max(0.1, last.h1 - prev.h1), last.b, last.tStudy, last.tTest, last.tRec);
      // C 계수 역산 (단순화)
      const ratioNumerator = Math.pow(prev.h1 + (last.h1 - prev.h1), 3);
      const ratioDenominator = Math.pow(prev.h1 + (last.h1 - prev.h1), 3) - Math.pow(prev.h1, 3);
      densityC = (ratioNumerator / ratioDenominator) * (last.tStudy / last.b);
    }

    return { last, prev, mentalBurden, densityC, count: recs.length };
  }, [activeSpace]);

  const insights = useMemo(() => {
    if (!analytics || !analytics.last) return null;
    const reviewCount = calculateRequiredReviewCount(analytics.last.tTest, analytics.last.tRec);
    let cubicB = 0;
    if (analytics.prev) {
      const h1 = analytics.prev.h1;
      const h2 = Math.max(0.1, analytics.last.h1 - analytics.prev.h1);
      const b = analytics.last.b;
      const cubicBData = calculateStudyBurdenV2({ 
        h1, h2, b, h3: targetH3, tStudy: 0, tTest: 0, tRec: 0 
      });
      cubicB = cubicBData.total;
    }
    return { reviewCount, cubicB };
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
      tRec: formData.tRec,
      subjectIds: activeSpace.subjectIds || []
    });
    resetEntry();
  };

  if (activeCategory && activeSpace) {
    return (
      <div className="animate-fade-in space-y-8">
        <div className="flex justify-between items-center bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
          <button onClick={() => { setActiveSpaceId(null); resetEntry(); }} className="text-slate-400 font-black text-sm hover:text-indigo-600 transition-colors flex items-center gap-2">
            <span className="text-xl">←</span> 공간 목록
          </button>
          <div className="flex gap-4">
             <button onClick={() => onDeleteDifficultySpace(activeCategory.id, activeSpace.id)} className="text-rose-500 font-bold text-xs px-5 py-3 hover:bg-rose-50 rounded-2xl transition-all">공간 삭제</button>
             <button onClick={() => setEntryStep('timer')} className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">＋ 새 테스트 기록</button>
          </div>
        </div>

        {/* 최상단: 현재 상태 요약 (공부량 b 중심) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           <div className="md:col-span-2 bg-indigo-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5 grayscale rotate-12"><span className="text-9xl font-black">STUDY</span></div>
              <div className="relative z-10">
                 <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest bg-white/10 px-3 py-1.5 rounded-full">Accumulated Resources</span>
                 <h4 className="text-3xl font-black mt-6">다음 기록을 위해 확보된 리소스</h4>
                 <div className="mt-10 flex gap-12 items-end">
                    <div>
                       <p className="text-[10px] font-black text-indigo-400 uppercase mb-3">{'투입 공부량 (변수 b)'}</p>
                       <p className="text-6xl font-black">{currentAccumulatedStudy.b}<span className="text-2xl ml-2 opacity-30">P</span></p>
                    </div>
                    <div className="w-px h-16 bg-white/10"></div>
                    <div>
                       <p className="text-[10px] font-black text-indigo-400 uppercase mb-3">{'투입 시간 (t_study)'}</p>
                       <p className="text-6xl font-black">{currentAccumulatedStudy.tStudy}<span className="text-2xl ml-2 opacity-30">h</span></p>
                    </div>
                 </div>
              </div>
           </div>
           <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-center text-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Space Info</span>
              <h5 className="text-2xl font-black text-slate-800">{activeSpace.name}</h5>
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                 {activeSpace.subjectIds?.map(id => (
                    <span key={id} className="text-[9px] font-black bg-slate-50 text-slate-400 px-3 py-1 rounded-full border border-slate-100"># {subjects.find(s => s.id === id)?.name}</span>
                 ))}
              </div>
           </div>
        </div>

        {/* 중간: 공식 결과 대시보드 */}
        {analytics ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* 1. 핵심: 예측 학습량 (공식 b_predicted) */}
            <div className="lg:col-span-2 bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-xl relative overflow-hidden group">
                <div className="flex justify-between items-start mb-12">
                   <div>
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-4 py-2 rounded-full">Cubic Prediction Model</span>
                      <h4 className="text-3xl font-black text-slate-900 mt-6">목표 점수 도달을 위한 예측 공부량</h4>
                   </div>
                   <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase">Target Boost (h₃)</p>
                      <p className="text-4xl font-black text-indigo-600">+{targetH3}점</p>
                   </div>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-12 bg-slate-50 p-10 rounded-[3rem] border border-slate-100">
                   <div className="flex-1 space-y-8 w-full">
                      <div className="space-y-4">
                         <div className="flex justify-between text-[11px] font-black text-slate-500 uppercase px-1">
                            <span>추가 목표 점수 설정</span>
                            <span className="text-indigo-600">H₃ = {targetH3}</span>
                         </div>
                         <input type="range" min="1" max="50" step="1" value={targetH3} onChange={e => setTargetH3(Number(e.target.value))} className="w-full h-3 bg-indigo-100 rounded-xl appearance-none cursor-pointer accent-indigo-600" />
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-center">
                         <div className="bg-white p-4 rounded-2xl shadow-sm"><p className="text-[9px] font-black text-slate-400">h₁ (직전)</p><p className="font-black text-slate-700">{analytics.prev?.h1 || analytics.last.h1}</p></div>
                         <div className="bg-white p-4 rounded-2xl shadow-sm"><p className="text-[9px] font-black text-slate-400">h₂ (향상)</p><p className="font-black text-indigo-500">+{Math.max(0, analytics.last.h1 - (analytics.prev?.h1 || 0))}</p></div>
                         <div className="bg-white p-4 rounded-2xl shadow-sm"><p className="text-[9px] font-black text-slate-400">b (투입)</p><p className="font-black text-slate-700">{analytics.last.b}P</p></div>
                      </div>
                   </div>
                   <div className="flex flex-col items-center justify-center p-12 bg-indigo-600 rounded-[3rem] text-white shadow-2xl min-w-[240px] group-hover:scale-105 transition-transform">
                      {/* Fixed: Wrapped text in curly braces to avoid interpreting $b_{req}$ as a JavaScript expression */}
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-4">{"필요 총 공부량 ($b_{req}$)"}</p>
                      <div className="flex items-baseline">
                         <span className="text-7xl font-black tabular-nums">{insights?.cubicB.toFixed(1)}</span>
                         <span className="text-2xl font-bold ml-2 opacity-40">P</span>
                      </div>
                      <p className="mt-6 text-[10px] font-bold opacity-50 italic">Cubic Growth Equation Result</p>
                   </div>
                </div>
            </div>

            {/* 2. 상세 지표: 멘탈 부하 및 학습 밀도 */}
            <div className="space-y-8">
               <div className="bg-amber-500 p-10 rounded-[3rem] text-white shadow-xl flex flex-col justify-between h-1/2 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10"><span className="text-8xl">📊</span></div>
                  <div>
                     <span className="text-[10px] font-black text-white/60 uppercase tracking-widest bg-white/20 px-3 py-1.5 rounded-full">Analysis Logic</span>
                     <h4 className="text-2xl font-black mt-4">학습 밀도 지수 (C)</h4>
                     <p className="text-[10px] opacity-70 mt-1">성적 변화량 대비 투입 자원의 효율성</p>
                  </div>
                  <div className="py-6">
                     <div className="flex items-baseline">
                        <span className="text-6xl font-black tabular-nums">{analytics.densityC.toFixed(3)}</span>
                     </div>
                     <p className="text-[9px] font-bold mt-2 opacity-50 leading-tight">투입 공부량 1P당 유효 성적 기여도 계수</p>
                  </div>
               </div>

               <div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl flex flex-col justify-between h-1/2">
                  <div>
                     <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-400/10 px-3 py-1.5 rounded-full">Mental Burden</span>
                     <h4 className="text-2xl font-black mt-4">멘탈 부하 지수 (L)</h4>
                  </div>
                  <div className="py-6">
                     <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">필요 복습 강도 (L_total)</p>
                     <span className="text-6xl font-black text-emerald-400 tabular-nums">{analytics.mentalBurden.total.toFixed(2)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                     <div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, analytics.mentalBurden.total * 5)}%` }}></div>
                  </div>
               </div>
            </div>
          </div>
        ) : (
          <div className="py-32 text-center bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200">
             <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6"><span className="text-4xl">🧪</span></div>
             <h4 className="text-xl font-black text-slate-800 mb-2">데이터 분석 대기 중</h4>
             <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">기록을 2회 이상 추가하면 공식에 따른 예측 결과가 표시됩니다.</p>
          </div>
        )}

        {/* 하단: 히스토리 */}
        <div className="bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-sm">
            <h4 className="text-2xl font-black text-slate-800 mb-10 px-2 flex items-center gap-4">
               <span className="w-3 h-8 bg-indigo-600 rounded-full"></span>
               공식 투입 변수 및 성적 히스토리
            </h4>
            <div className="space-y-6">
                {activeSpace.records.slice().reverse().map((rec, i, arr) => {
                    const prevRec = i < arr.length - 1 ? arr[i + 1] : null;
                    let impact = 0;
                    if (prevRec) {
                      impact = calculateMentalBurden(prevRec.h1, Math.max(0.1, rec.h1 - prevRec.h1), rec.b, rec.tStudy, rec.tTest, rec.tRec).total;
                    }
                    return (
                      <div key={rec.id} className="flex flex-col md:flex-row md:items-center justify-between p-10 bg-slate-50 rounded-[3rem] hover:bg-white hover:shadow-2xl transition-all border border-transparent hover:border-indigo-100 group">
                          <div className="flex items-center gap-10">
                              <div className="w-20 h-20 bg-white rounded-[2rem] flex flex-col items-center justify-center font-black text-slate-300 shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                 <span className="text-[10px] opacity-40 uppercase">REC.</span>
                                 <span className="text-2xl">{activeSpace.records.length - i}</span>
                              </div>
                              <div className="space-y-2">
                                  <div className="flex items-center gap-4">
                                    <p className="text-4xl font-black text-slate-900">{rec.h1}<span className="text-xl ml-1 opacity-20">점</span></p>
                                    {prevRec && (
                                       <span className={`text-xs font-black px-3 py-1 rounded-full ${rec.h1 >= prevRec.h1 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                          {rec.h1 >= prevRec.h1 ? '▲' : '▼'} {Math.abs(rec.h1 - prevRec.h1)}
                                       </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{new Date(rec.timestamp).toLocaleDateString()}</p>
                              </div>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-8 mt-8 md:mt-0">
                             <div className="px-6 py-4 bg-white rounded-2xl shadow-sm border border-slate-100 min-w-[100px] text-center">
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">변수 b (공부량)</p>
                                <p className="text-2xl font-black text-slate-800">{rec.b}P</p>
                             </div>
                             <div className="px-6 py-4 bg-white rounded-2xl shadow-sm border border-slate-100 min-w-[100px] text-center">
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">t_study (시간)</p>
                                <p className="text-2xl font-black text-slate-800">{rec.tStudy}h</p>
                             </div>
                             {impact > 0 && (
                                <div className="px-6 py-4 bg-indigo-50 rounded-2xl border border-indigo-100 min-w-[100px] text-center">
                                   <p className="text-[9px] font-black text-indigo-400 uppercase mb-1">산출 L (부하)</p>
                                   <p className="text-2xl font-black text-indigo-600">{impact.toFixed(2)}</p>
                                </div>
                             )}
                             <button onClick={() => onDeleteRecord(activeCategory.id, activeSpace.id, rec.id)} className="w-14 h-14 flex items-center justify-center text-slate-200 hover:text-rose-500 transition-all rounded-full hover:bg-rose-50">
                                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                             </button>
                          </div>
                      </div>
                    );
                })}
            </div>
        </div>

        {/* 기록 입력 모달 */}
        {entryStep !== 'idle' && (
          <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 z-[9999] ${entryStep === 'timer' ? 'bg-slate-950' : 'bg-slate-900/60 backdrop-blur-xl'}`}>
             <button onClick={resetEntry} className="fixed top-10 right-10 w-16 h-16 bg-white/10 text-white rounded-full flex items-center justify-center text-3xl font-black hover:bg-white/20 transition-all">✕</button>
             <div className="w-full max-w-lg animate-fade-in">
                {entryStep === 'timer' && (
                  <div className="text-center">
                    <span className="px-6 py-2 bg-indigo-500/10 text-indigo-400 rounded-full text-[11px] font-black uppercase mb-12 inline-block tracking-widest">Real-time Test Measurement</span>
                    <div className="text-[120px] font-mono font-black text-white mb-24 leading-none tabular-nums animate-pulse">{formatTime(testSeconds)}</div>
                    <div className="flex gap-6">
                      <button onClick={() => setIsTimerRunning(!isTimerRunning)} className={`flex-[2] py-8 rounded-[2.5rem] font-black text-2xl shadow-2xl transition-all ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white shadow-indigo-500/20'}`}>{isTimerRunning ? '일시정지' : '다시 시작'}</button>
                      <button onClick={() => { setIsTimerRunning(false); setEntryStep('score'); }} className="flex-1 py-8 bg-emerald-600 text-white rounded-[2.5rem] font-black text-2xl shadow-2xl hover:bg-emerald-500 transition-all">종료</button>
                    </div>
                  </div>
                )}
                {entryStep === 'score' && (
                  <div className="bg-white p-12 rounded-[4rem] shadow-2xl text-center border border-slate-100">
                    <h3 className="text-3xl font-black mb-12 text-slate-800 uppercase tracking-tighter">획득 점수 입력 (h)</h3>
                    <div className="flex justify-center gap-10 mb-16">
                      {[scoreTens, scoreOnes].map((v, i) => (
                        <div key={i} className="flex flex-col items-center gap-4">
                           <button onClick={() => i === 0 ? setScoreTens(prev => (prev + 1) % 10) : setScoreOnes(prev => (prev + 1) % 10)} className="w-20 h-20 bg-slate-50 rounded-3xl text-3xl font-bold hover:bg-indigo-50 active:scale-90 transition-all">▲</button>
                           <span className="text-[120px] font-black text-slate-900 leading-none tabular-nums">{v}</span>
                           <button onClick={() => i === 0 ? setScoreTens(prev => (prev - 1 + 10) % 10) : setScoreOnes(prev => (prev - 1 + 10) % 10)} className="w-20 h-20 bg-slate-50 rounded-3xl text-3xl font-bold hover:bg-indigo-50 active:scale-90 transition-all">▼</button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setEntryStep('details')} className="w-full py-8 bg-slate-900 text-white rounded-[2.5rem] font-black text-2xl shadow-xl hover:bg-indigo-600 transition-all">다음 단계</button>
                  </div>
                )}
                {entryStep === 'details' && (
                  <div className="bg-white p-12 rounded-[4rem] shadow-2xl border border-slate-100">
                    <h3 className="text-3xl font-black text-center mb-10 text-slate-800 uppercase tracking-tighter">최종 투입 자원 확인</h3>
                    <div className="space-y-8">
                        <div className="p-8 bg-indigo-50 rounded-[2.5rem] border border-indigo-100 shadow-inner">
                            <p className="text-[11px] font-black text-indigo-500 uppercase mb-4 tracking-widest text-center">공식에 대입될 누계 데이터</p>
                            <div className="flex justify-around items-center">
                                <div className="text-center">
                                   <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">변수 b (페이지)</p>
                                   <p className="text-4xl font-black text-indigo-900">{formData.b}<span className="text-lg ml-1 opacity-30">P</span></p>
                                </div>
                                <div className="h-10 w-px bg-indigo-200"></div>
                                <div className="text-center">
                                   <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">변수 t_study</p>
                                   <p className="text-4xl font-black text-indigo-900">{formData.tStudy}<span className="text-lg ml-1 opacity-30">h</span></p>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">공부량 조정 (b)</label>
                                <input type="number" value={formData.b} onChange={e => setFormData({...formData, b: Number(e.target.value)})} className="w-full p-6 bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-3xl font-black text-2xl outline-none transition-all shadow-inner text-center" />
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">시간 조정 (t)</label>
                                <input type="number" step="0.1" value={formData.tStudy} onChange={e => setFormData({...formData, tStudy: Number(e.target.value)})} className="w-full p-6 bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-3xl font-black text-2xl outline-none transition-all shadow-inner text-center" />
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-6 mt-12">
                      <button onClick={() => setEntryStep('score')} className="flex-1 py-7 bg-slate-100 rounded-3xl font-black text-slate-400 hover:bg-slate-200 transition-all">뒤로</button>
                      <button onClick={handleFinalSave} className="flex-[2] py-7 bg-indigo-600 text-white rounded-3xl font-black text-xl shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">공식 기록 저장</button>
                    </div>
                  </div>
                )}
             </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-fade-in">
       {!activeCategoryId ? (
         <div className="space-y-10">
            <div className="bg-white p-10 rounded-[3.5rem] flex flex-col md:flex-row justify-between items-center border border-slate-200 shadow-sm gap-8">
                <div>
                    <h3 className="text-4xl font-black text-slate-900 flex items-center gap-4">
                       <span className="w-4 h-10 bg-slate-900 rounded-full"></span>
                       시험 관리 허브
                    </h3>
                    <p className="text-sm text-slate-400 font-bold mt-2 uppercase tracking-widest">분석 공식이 적용될 독립된 시험군을 관리하세요.</p>
                </div>
                <button onClick={() => setShowAddCategoryForm(!showAddCategoryForm)} className="bg-slate-900 text-white px-10 py-5 rounded-[2rem] font-black text-sm shadow-2xl hover:bg-indigo-600 transition-all active:scale-95">
                    {showAddCategoryForm ? '취소' : '＋ 새 시험군 생성'}
                </button>
            </div>
            {showAddCategoryForm && (
                <div className="flex gap-4 animate-in slide-in-from-top-4 duration-300">
                    <input placeholder="허브 명칭 (예: 수능, 자격증 실기)" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="flex-grow p-8 border-4 border-white rounded-[2.5rem] bg-white font-black text-2xl outline-none focus:ring-8 focus:ring-indigo-500/5 transition-all shadow-xl" />
                    <button onClick={() => { if(newCategoryName){ onAddCategory(newCategoryName); setNewCategoryName(''); setShowAddCategoryForm(false); } }} className="px-14 bg-indigo-600 text-white rounded-[2.5rem] font-black text-xl shadow-2xl hover:bg-indigo-700 transition-all">생성</button>
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                {testCategories.map(cat => (
                    <div key={cat.id} onClick={() => setActiveCategoryId(cat.id)} className="group bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-3 transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between h-80">
                        <div>
                            <span className="text-[10px] font-black px-4 py-2 rounded-full bg-slate-50 text-slate-400 uppercase tracking-widest">Analysis Hub</span>
                            <h4 className="text-3xl font-black text-slate-800 mt-8 group-hover:text-indigo-600 transition-colors leading-tight">{cat.name}</h4>
                            <p className="text-xs font-bold text-slate-400 mt-2">{cat.difficultySpaces.length}개의 세부 분석 공간</p>
                        </div>
                        <div className="flex justify-between items-center">
                            <button onClick={(e) => { e.stopPropagation(); onDeleteCategory(cat.id); }} className="text-[10px] font-black text-rose-300 hover:text-rose-600 transition-colors uppercase tracking-widest">삭제</button>
                            <div className="bg-indigo-50 text-indigo-600 p-6 rounded-[2rem] group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
         </div>
       ) : (
         <div className="space-y-10 animate-fade-in">
            <div className="bg-white p-10 rounded-[3.5rem] flex flex-col md:flex-row justify-between items-center border border-slate-200 shadow-sm gap-8">
                <button onClick={() => setActiveCategoryId(null)} className="text-slate-400 font-black text-sm hover:text-slate-600 flex items-center gap-3 transition-colors">
                  <span className="text-2xl">←</span> 뒤로
                </button>
                <div className="flex items-center gap-6 w-full md:w-auto">
                    <h3 className="text-3xl font-black text-slate-800 hidden md:block">{activeCategory?.name}</h3>
                    <button onClick={() => { setShowAddSpaceForm(!showAddSpaceForm); setSelectedSubjectIds([]); }} className="bg-indigo-600 text-white px-10 py-5 rounded-[2rem] font-black text-sm shadow-2xl hover:bg-indigo-700 transition-all w-full md:w-auto active:scale-95">
                        {showAddSpaceForm ? '취소' : '＋ 분석 공간 추가'}
                    </button>
                </div>
            </div>
            {showAddSpaceForm && (
                <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-2xl space-y-10 animate-in slide-in-from-top-8 duration-500">
                    <div className="space-y-3">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-4">분석 공간 명칭 (난이도/목표별)</label>
                        <input placeholder="예: 기출 문제 세트 A, 고난도 심화" value={newSpaceName} onChange={e => setNewSpaceName(e.target.value)} className="w-full p-8 border-4 border-slate-50 rounded-[2.5rem] bg-slate-50 font-black text-3xl outline-none focus:bg-white focus:ring-8 focus:ring-indigo-500/5 transition-all" />
                    </div>
                    <div className="space-y-6">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest px-4">데이터를 연동할 학습 과목 선택</label>
                        <div className="flex flex-wrap gap-4">
                            {subjects.map(sub => {
                                const isSelected = selectedSubjectIds.includes(sub.id);
                                return (
                                    <div key={sub.id} onClick={() => toggleSubjectSelection(sub.id)} className={`px-8 py-5 rounded-[2rem] border-4 cursor-pointer transition-all font-black text-base select-none ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl scale-105' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-indigo-200'}`}>
                                        {isSelected && <span className="mr-3">✓</span>} {sub.name}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <button disabled={!newSpaceName || selectedSubjectIds.length === 0} onClick={() => { onAddDifficultySpace(activeCategory!.id, newSpaceName, selectedSubjectIds); setNewSpaceName(''); setSelectedSubjectIds([]); setShowAddSpaceForm(false); }} className="w-full py-8 bg-slate-900 text-white rounded-[2.5rem] font-black text-xl shadow-2xl hover:bg-indigo-600 transition-all disabled:opacity-20">공식 분석 공간 생성</button>
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                {activeCategory?.difficultySpaces.map(space => {
                    const linkedSubjects = space.subjectIds?.map(id => subjects.find(s => s.id === id)).filter(Boolean) as Subject[];
                    const totalP = linkedSubjects.reduce((acc, s) => acc + s.totalPages, 0);
                    const compP = linkedSubjects.reduce((acc, s) => acc + s.completedPages, 0);
                    const progress = totalP > 0 ? Math.round((compP / totalP) * 100) : 0;

                    return (
                      <div key={space.id} onClick={() => setActiveSpaceId(space.id)} className="group bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-3 transition-all cursor-pointer flex flex-col justify-between h-80 relative overflow-hidden">
                          <div>
                              <span className="text-[10px] font-black px-4 py-2 rounded-full bg-indigo-50 text-indigo-400 uppercase tracking-widest">Detail Space</span>
                              <h4 className="text-3xl font-black text-slate-800 mt-8 group-hover:text-indigo-600 transition-colors leading-tight">{space.name}</h4>
                              <p className="text-xs text-slate-400 font-bold mt-2">{space.records.length}개의 분석 데이터 기록됨</p>
                          </div>
                          
                          <div className="space-y-3">
                             <div className="flex justify-between items-end">
                                <span className="text-[10px] font-black text-slate-400 uppercase">연동 과목 전체 진행도</span>
                                <span className="text-sm font-black text-indigo-600">{progress}%</span>
                             </div>
                             <div className="w-full h-2 bg-slate-50 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${progress}%` }}></div>
                             </div>
                          </div>
                      </div>
                    );
                })}
            </div>
         </div>
       )}
    </div>
  );
};
