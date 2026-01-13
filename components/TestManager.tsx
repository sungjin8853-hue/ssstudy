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
  const [targetH3, setTargetH3] = useState<number>(10); // 목표 추가 점수 (h3)

  const activeCategory = useMemo(() => testCategories.find(c => c.id === activeCategoryId), [testCategories, activeCategoryId]);
  const activeSpace = useMemo(() => activeCategory?.difficultySpaces.find(s => s.id === activeSpaceId), [activeCategory, activeSpaceId]);

  // 타이머 로직
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

  // [핵심 자동화] 마지막 시험 이후의 학습 로그를 합산하여 폼에 자동 입력
  useEffect(() => {
    if (entryStep === 'details' && activeCategory && activeSpace) {
      const lastRec = activeSpace.records.length > 0 
        ? activeSpace.records[activeSpace.records.length - 1] 
        : null;
      
      const lastTime = lastRec ? new Date(lastRec.timestamp).getTime() : 0;
      
      // 해당 과목의 로그 중 마지막 시험 이후에 작성된 것들만 필터링
      const filteredLogs = logs.filter(l => 
        l.subjectId === activeCategory.subjectId && 
        new Date(l.timestamp).getTime() > lastTime
      );

      const sumB = filteredLogs.reduce((acc, cur) => acc + cur.pagesRead, 0);
      const sumT = parseFloat((filteredLogs.reduce((acc, cur) => acc + cur.timeSpentMinutes, 0) / 60).toFixed(2));

      setFormData(prev => ({
        ...prev,
        b: sumB,
        tStudy: sumT
      }));
    }
  }, [entryStep, activeCategory, activeSpace, logs]);

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
    const h2 = Math.max(0.1, analytics.last.h1 - analytics.prev.h1);
    const b = analytics.last.b;
    if (h1 <= 0 || b <= 0) return null;
    
    const graphData = calculateGraphLengthAnalysis({ 
      h1, h2, b, 
      tStudy: analytics.last.tStudy, 
      tTest: analytics.last.tTest, 
      tRec: analytics.last.tRec, 
      h3: 0 
    });

    const cubicBData = calculateStudyBurdenV2({ 
      h1, h2, b, 
      h3: targetH3, 
      tStudy: 0, tTest: 0, tRec: 0 
    });

    return { graphData, cubicB: cubicBData.total };
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
      <div className="animate-fade-in space-y-8">
        <div className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm">
          <button onClick={() => { setActiveSpaceId(null); resetEntry(); }} className="text-slate-400 font-bold text-sm hover:text-indigo-600 transition-colors">← 공간 목록</button>
          <div className="flex gap-3">
             <button onClick={() => onDeleteDifficultySpace(activeCategory.id, activeSpace.id)} className="text-rose-500 font-bold text-xs px-4 py-2 hover:bg-rose-50 rounded-xl transition-all">삭제</button>
             <button onClick={handleStartTest} className="bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">＋ 새 테스트 기록</button>
          </div>
        </div>

        {analytics ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start mb-10">
                    <div>
                        <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest bg-indigo-50 px-3 py-1.5 rounded-full">Precision Predictor</span>
                        <h4 className="text-2xl font-black text-slate-800 mt-4">학습량 정밀 예측</h4>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">현재 페이스</p>
                        <p className="text-xl font-black text-slate-900">{analytics.last.h1}점 <span className="text-xs font-normal text-slate-400">/ {analytics.last.b}P</span></p>
                    </div>
                </div>

                {insights ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                      <div className="space-y-6">
                          <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 shadow-inner">
                              <div className="flex justify-between items-center mb-4">
                                  <label className="text-xs font-black text-slate-500">목표 추가 점수 (h3)</label>
                                  <span className="text-indigo-600 font-black">+{targetH3}점</span>
                              </div>
                              <input 
                                  type="range" min="1" max="50" step="1" 
                                  value={targetH3} 
                                  onChange={e => setTargetH3(Number(e.target.value))}
                                  className="w-full h-2 bg-indigo-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                              />
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                              * 성적 변화와 누적 학습량을 <span className="text-indigo-500 font-bold">Cubic Burden 수식</span>으로 정밀 분석한 결과입니다.
                          </p>
                      </div>

                      <div className="bg-indigo-600 p-10 rounded-[2.5rem] text-white shadow-2xl shadow-indigo-100 flex flex-col items-center justify-center text-center group">
                          <p className="text-xs font-black uppercase tracking-widest opacity-60 mb-4">예측 필요 학습량</p>
                          <div className="flex items-baseline transition-transform group-hover:scale-110 duration-500">
                              <span className="text-7xl font-black tabular-nums">{insights.cubicB.toFixed(1)}</span>
                              <span className="text-2xl font-bold ml-2 opacity-50">P</span>
                          </div>
                          <div className="mt-6 w-full h-1 bg-white/20 rounded-full overflow-hidden">
                              <div className="h-full bg-white animate-pulse" style={{ width: '70%' }}></div>
                          </div>
                      </div>
                  </div>
                ) : (
                  <div className="p-10 bg-slate-50 rounded-[2rem] border border-dashed border-slate-200 text-center">
                    <p className="text-slate-400 font-bold">분석을 위해 최소 2회의 시험 기록이 필요합니다.</p>
                  </div>
                )}
            </div>

            <div className="bg-slate-900 p-10 rounded-[3rem] text-white flex flex-col justify-between shadow-2xl relative overflow-hidden group">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl transition-all"></div>
                <div>
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-400/10 px-3 py-1.5 rounded-full">Efficiency Index</span>
                    <h4 className="text-2xl font-black mt-4">시간 절약 분석</h4>
                    <p className="text-xs text-slate-400 mt-2 font-medium leading-relaxed">시험 시간 대비 공부 시간의 <br/>적분 그래프 분석 결과</p>
                </div>
                <div className="py-10">
                    <span className="text-6xl font-black text-emerald-400 tabular-nums">
                      {insights ? insights.graphData.total.toFixed(4) : (analytics.last.tTest / analytics.last.tRec).toFixed(4)}
                    </span>
                    <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 transition-all duration-1000" style={{ width: `${Math.min(100, ((insights?.graphData.total || 0.5) * 10))}%` }}></div>
                    </div>
                </div>
            </div>
          </div>
        ) : (
          <div className="py-32 text-center bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 shadow-inner animate-fade-in">
             <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6"><span className="text-4xl">🧪</span></div>
             <h4 className="text-xl font-black text-slate-800 mb-2">데이터 분석 대기 중</h4>
             <p className="text-slate-400 font-medium">첫 번째 시험 결과를 등록하세요.</p>
          </div>
        )}

        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
            <h4 className="text-lg font-black text-slate-800 mb-8 px-2">최근 시험 히스토리</h4>
            <div className="space-y-4">
                {activeSpace.records.slice().reverse().map((rec, i) => (
                    <div key={rec.id} className="flex items-center justify-between p-6 bg-slate-50 rounded-[2rem] hover:bg-white hover:shadow-xl hover:-translate-y-1 transition-all border border-transparent hover:border-slate-100 group">
                        <div className="flex items-center gap-6">
                            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center font-black text-slate-400 shadow-sm group-hover:bg-indigo-600 group-hover:text-white">
                                {activeSpace.records.length - i}
                            </div>
                            <div>
                                <p className="text-xl font-black text-slate-800">{rec.h1}점</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{new Date(rec.timestamp).toLocaleDateString()} · {rec.b}P 학습</p>
                            </div>
                        </div>
                        <button onClick={() => onDeleteRecord(activeCategory.id, activeSpace.id, rec.id)} className="p-3 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                ))}
            </div>
        </div>

        {entryStep !== 'idle' && (
          <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 z-[9999] ${entryStep === 'timer' ? 'bg-slate-950' : 'bg-slate-900/60 backdrop-blur-xl'}`}>
             <button onClick={() => setIsConfirmingCancel(true)} className="fixed top-10 right-10 w-14 h-14 bg-white/10 text-white rounded-full flex items-center justify-center text-2xl font-black">✕</button>
             
             <div className="w-full max-w-lg animate-fade-in">
                {entryStep === 'timer' && (
                  <div className="text-center">
                    <span className="px-5 py-2 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-black uppercase mb-10 inline-block tracking-widest">실시간 시험 시간 계측</span>
                    <div className="text-[120px] font-mono font-black text-white mb-20 leading-none tabular-nums animate-pulse">{formatTime(testSeconds)}</div>
                    <div className="flex gap-4">
                      <button onClick={() => setIsTimerRunning(!isTimerRunning)} className={`flex-[2] py-8 rounded-[2.5rem] font-black text-2xl shadow-2xl ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'}`}>{isTimerRunning ? '일시정지' : '다시 시작'}</button>
                      <button onClick={() => { setIsTimerRunning(false); setEntryStep('score'); }} className="flex-1 py-8 bg-emerald-600 text-white rounded-[2.5rem] font-black text-2xl shadow-2xl">종료</button>
                    </div>
                  </div>
                )}

                {entryStep === 'score' && (
                  <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl text-center border border-slate-100">
                    <h3 className="text-3xl font-black mb-12 text-slate-800">시험 점수 입력</h3>
                    <div className="flex justify-center gap-10 mb-16">
                      {[scoreTens, scoreOnes].map((v, i) => (
                        <div key={i} className="flex flex-col items-center gap-4">
                           <button onClick={() => i === 0 ? setScoreTens(prev => (prev + 1) % 10) : setScoreOnes(prev => (prev + 1) % 10)} className="w-16 h-16 bg-slate-50 rounded-2xl text-2xl font-bold active:scale-90">▲</button>
                           <span className="text-[100px] font-black text-slate-900 leading-none tabular-nums">{v}</span>
                           <button onClick={() => i === 0 ? setScoreTens(prev => (prev - 1 + 10) % 10) : setScoreOnes(prev => (prev - 1 + 10) % 10)} className="w-16 h-16 bg-slate-50 rounded-2xl text-2xl font-bold active:scale-90">▼</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => setEntryStep('timer')} className="flex-1 py-6 bg-slate-100 rounded-2xl font-black text-slate-400">뒤로</button>
                      <button onClick={() => setEntryStep('details')} className="flex-[2] py-6 bg-slate-900 text-white rounded-2xl font-black text-xl">다음 단계</button>
                    </div>
                  </div>
                )}

                {entryStep === 'details' && (
                  <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100">
                    <h3 className="text-3xl font-black text-center mb-4 text-slate-800">투입 데이터 정밀 분석</h3>
                    <p className="text-center text-xs text-indigo-500 font-bold mb-8">마지막 시험 이후의 학습 로그를 자동 합산했습니다.</p>
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 flex justify-between items-center">
                                  공부량 (P) <span className="text-[8px] bg-indigo-50 text-indigo-500 px-1 rounded">자동 계산</span>
                                </label>
                                <input type="number" value={formData.b} onChange={e => setFormData({...formData, b: Number(e.target.value)})} className="w-full p-5 bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl font-black text-xl outline-none transition-all shadow-inner" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2 flex justify-between items-center">
                                  공부 시간 (h) <span className="text-[8px] bg-indigo-50 text-indigo-500 px-1 rounded">자동 계산</span>
                                </label>
                                <input type="number" step="0.1" value={formData.tStudy} onChange={e => setFormData({...formData, tStudy: Number(e.target.value)})} className="w-full p-5 bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl font-black text-xl outline-none transition-all shadow-inner" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-indigo-500 uppercase tracking-widest px-2">권장 시험 시간 (분)</label>
                            <input type="number" value={formData.tRec} onChange={e => setFormData({...formData, tRec: Number(e.target.value)})} className="w-full p-5 bg-indigo-50 border-2 border-indigo-100 focus:border-indigo-500 rounded-2xl font-black text-xl outline-none text-indigo-900 text-center" />
                        </div>
                    </div>
                    <div className="flex gap-4 mt-12">
                      <button onClick={() => setEntryStep('score')} className="flex-1 py-6 bg-slate-100 rounded-2xl font-black text-slate-400">뒤로</button>
                      <button onClick={handleFinalSave} className="flex-[2] py-6 bg-indigo-600 text-white rounded-2xl font-black text-xl shadow-xl active:scale-95 transition-all">분석 완료 및 저장</button>
                    </div>
                  </div>
                )}
             </div>

             {isConfirmingCancel && (
                <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[10000]">
                    <div className="bg-white w-full max-w-sm rounded-[3rem] p-10 text-center shadow-2xl">
                        <h4 className="text-xl font-black text-slate-900 mb-2">입력을 중단할까요?</h4>
                        <p className="text-slate-500 text-sm mb-10">지금 취소하면 데이터가 저장되지 않습니다.</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={resetEntry} className="w-full py-5 bg-rose-600 text-white rounded-2xl font-black active:scale-95 transition-all">네, 취소합니다</button>
                            <button onClick={() => setIsConfirmingCancel(false)} className="w-full py-5 bg-slate-100 text-slate-600 rounded-2xl font-black">계속할게요</button>
                        </div>
                    </div>
                </div>
             )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-fade-in">
       {!activeCategoryId ? (
         <div className="space-y-10">
            <div className="bg-white p-10 rounded-[3rem] flex flex-col md:flex-row justify-between items-center border border-slate-200 shadow-sm gap-6">
                <div>
                    <h3 className="text-3xl font-black text-slate-900">시험 관리 허브</h3>
                    <p className="text-sm text-slate-400 font-medium mt-1">과목별 독립 분석 공간을 생성하고 성적 변화를 정밀 추적하세요.</p>
                </div>
                <button onClick={() => setShowAddCategoryForm(!showAddCategoryForm)} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-2xl hover:bg-slate-800 transition-all">
                    {showAddCategoryForm ? '취소' : '＋ 새로운 시험 허브'}
                </button>
            </div>
            
            {showAddCategoryForm && (
                <div className="flex gap-4 animate-fade-in">
                    <input placeholder="허브 명칭 (예: 2025 1학기 기말고사)" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="flex-grow p-6 border-2 border-slate-100 rounded-3xl bg-white font-black text-xl outline-none focus:border-indigo-500 transition-all shadow-sm" />
                    <button onClick={() => { if(newCategoryName){ onAddCategory(newCategoryName); setNewCategoryName(''); setShowAddCategoryForm(false); } }} className="px-12 bg-indigo-600 text-white rounded-3xl font-black shadow-xl hover:bg-indigo-700 transition-all">생성</button>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {testCategories.map(cat => (
                    <div key={cat.id} className="group bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between h-72">
                        <div onClick={() => setActiveCategoryId(cat.id)}>
                            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-slate-50 text-slate-400 uppercase tracking-widest">Analytics Hub</span>
                            <h4 className="text-3xl font-black text-slate-800 mt-6 group-hover:text-indigo-600 transition-colors leading-tight">{cat.name}</h4>
                            <p className="text-xs font-bold text-slate-400 mt-2">{cat.difficultySpaces.length}개의 세부 공간 관리 중</p>
                        </div>
                        <div className="flex justify-between items-center">
                            <button onClick={(e) => { e.stopPropagation(); onDeleteCategory(cat.id); }} className="text-[10px] font-black text-rose-300 hover:text-rose-600 transition-colors uppercase tracking-widest px-2 py-1">Hub 삭제</button>
                            <div onClick={() => setActiveCategoryId(cat.id)} className="bg-indigo-50 text-indigo-600 p-5 rounded-3xl group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
         </div>
       ) : (
         <div className="space-y-10 animate-fade-in">
            <div className="bg-white p-10 rounded-[3rem] flex flex-col md:flex-row justify-between items-center border border-slate-200 shadow-sm gap-6">
                <button onClick={() => setActiveCategoryId(null)} className="text-slate-400 font-black text-sm hover:text-slate-600 flex items-center gap-2 transition-colors">← 전체 허브 목록</button>
                <div className="flex items-center gap-6 w-full md:w-auto">
                    <h3 className="text-2xl font-black text-slate-800 hidden md:block">{activeCategory?.name}</h3>
                    <button onClick={() => setShowAddSpaceForm(!showAddSpaceForm)} className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-2xl hover:bg-indigo-700 transition-all w-full md:w-auto">
                        {showAddSpaceForm ? '취소' : '＋ 난이도 공간 추가'}
                    </button>
                </div>
            </div>

            {showAddSpaceForm && (
                <div className="flex gap-4 animate-fade-in">
                    <input placeholder="난이도 또는 분류 (예: 기본 정독, 고난도 N제)" value={newSpaceName} onChange={e => setNewSpaceName(e.target.value)} className="flex-grow p-6 border-2 border-slate-100 rounded-3xl bg-white font-black text-xl outline-none focus:border-indigo-500 transition-all shadow-sm" />
                    <button onClick={() => { if(newSpaceName){ onAddDifficultySpace(activeCategory!.id, newSpaceName); setNewSpaceName(''); setShowAddSpaceForm(false); } }} className="px-12 bg-indigo-600 text-white rounded-3xl font-black shadow-xl hover:bg-indigo-700 transition-all">추가</button>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {activeCategory?.difficultySpaces.map(space => (
                    <div key={space.id} onClick={() => setActiveSpaceId(space.id)} className="group bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all cursor-pointer flex flex-col justify-between h-72">
                        <div>
                            <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-400 uppercase tracking-widest">Detail Space</span>
                            <h4 className="text-3xl font-black text-slate-800 mt-6 group-hover:text-indigo-600 transition-colors leading-tight">{space.name}</h4>
                            <p className="text-xs font-bold text-slate-400 mt-2">{space.records.length}회의 분석 데이터 축적됨</p>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-full group-hover:bg-indigo-600 group-hover:text-white transition-all">정밀 분석 입장</span>
                            <div className="bg-slate-50 text-slate-400 p-5 rounded-3xl group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
         </div>
       )}
    </div>
  );
};
