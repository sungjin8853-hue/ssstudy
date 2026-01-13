
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
  
  // 시험 데이터 입력 프로세스 상태
  const [entryStep, setEntryStep] = useState<EntryStep>('idle');
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  
  // 타이머 상태
  const [testSeconds, setTestSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 점수 입력 상태 (화살표 UI)
  const [scoreTens, setScoreTens] = useState(0);
  const [scoreOnes, setScoreOnes] = useState(0);

  // 부가 정보 상태
  const [formData, setFormData] = useState({ 
    b: 0,     
    tStudy: 0, 
    tRec: 60  
  });
  
  const [targetH3, setTargetH3] = useState<number>(10);

  const activeCategory = testCategories.find(c => c.id === activeCategoryId);
  const activeSpace = activeCategory?.difficultySpaces.find(s => s.id === activeSpaceId);

  // 타이머 로직
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = window.setInterval(() => {
        setTestSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
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
    setIsTimerRunning(true);
    setEntryStep('timer');
  };

  const handleFinishTimer = () => {
    setIsTimerRunning(false);
    setEntryStep('score');
  };

  const resetEntry = () => {
    setEntryStep('idle');
    setTestSeconds(0);
    setIsTimerRunning(false);
    setScoreTens(0);
    setScoreOnes(0);
    setIsConfirmingCancel(false);
  };

  const handleCancelEntry = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsConfirmingCancel(true);
  };

  // 데이터 분석 가공
  const analytics = useMemo(() => {
    if (!activeSpace || activeSpace.records.length === 0) return null;
    
    const recs = activeSpace.records;
    const last = recs[recs.length - 1];
    const prev = recs.length >= 2 ? recs[recs.length - 2] : null;
    
    const avgScore = recs.reduce((a, b) => a + b.h1, 0) / recs.length;
    
    let avgIncreaseRate: number | null = null;
    if (recs.length >= 2) {
      let totalRate = 0;
      let count = 0;
      for (let i = 1; i < recs.length; i++) {
        const h_delta = recs[i].h1 - recs[i-1].h1;
        if (recs[i].b > 0) {
          totalRate += (h_delta / recs[i].b);
          count++;
        }
      }
      avgIncreaseRate = count > 0 ? totalRate / count : 0;
    }

    return { last, prev, avgScore, avgIncreaseRate, count: recs.length };
  }, [activeSpace]);

  const insights = useMemo(() => {
    if (!analytics || !analytics.prev || !analytics.last) return null;
    
    const h1 = analytics.prev.h1;
    const h2 = analytics.last.h1 - analytics.prev.h1;
    const b = analytics.last.b;
    const h3 = targetH3;

    if (h1 <= 0 || b <= 0) return null;

    const graphData = calculateGraphLengthAnalysis({
        h1, h2, b, 
        tStudy: analytics.last.tStudy,
        tTest: analytics.last.tTest,
        tRec: analytics.last.tRec,
        h3: 0 
    });

    const cubicBData = calculateStudyBurdenV2({ h1, h2, b, h3, tStudy:0, tTest:0, tRec:0 });
    const linearB = h2 > 0 ? (b / h2) * h3 : 0;

    return { h2, b, graphData, linearB, cubicB: cubicBData.total };
  }, [analytics, targetH3]);

  // 공부 로그 자동 연동
  useEffect(() => {
    if (entryStep === 'score' && activeCategory && activeSpace) {
      if (activeCategory.subjectId) {
        const lastRecord = activeSpace.records[activeSpace.records.length - 1];
        const lastTime = lastRecord ? new Date(lastRecord.timestamp).getTime() : 0;
        const relevantLogs = logs.filter(l => l.subjectId === activeCategory.subjectId && new Date(l.timestamp).getTime() > lastTime);
        const totalPages = relevantLogs.reduce((acc, l) => acc + l.pagesRead, 0);
        const totalMinutes = relevantLogs.reduce((acc, l) => acc + l.timeSpentMinutes, 0);
        setFormData(prev => ({ 
            ...prev, 
            b: totalPages, 
            tStudy: parseFloat((totalMinutes / 60).toFixed(2))
        }));
      }
    }
  }, [entryStep, activeCategory, activeSpace, logs]);

  const handleFinalSave = () => {
    if (!activeCategory || !activeSpace) return;
    
    const score = (scoreTens * 10) + scoreOnes;
    const finalRecord: TestRecord = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      h1: score,
      b: formData.b,
      tStudy: formData.tStudy,
      tTest: parseFloat((testSeconds / 60).toFixed(2)), // 소수점 2자리까지 정밀하게 저장
      tRec: formData.tRec
    };

    onAddRecord(activeCategory.id, activeSpace.id, finalRecord);
    resetEntry();
  };

  if (activeCategory && activeSpace) {
    return (
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <div className="flex justify-between items-center mb-6">
          <button onClick={() => { setActiveSpaceId(null); resetEntry(); }} className="text-slate-400 hover:text-indigo-600 font-bold text-sm transition-colors flex items-center gap-1">
            ← {activeCategory.name} 목록
          </button>
          <button onClick={handleStartTest} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-black text-xs hover:bg-indigo-700 shadow-lg transition-all">
            ＋ 테스트 시작하기
          </button>
        </div>

        {/* 단계별 입력 오버레이 */}
        {entryStep !== 'idle' && (
          <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 ${entryStep === 'timer' ? 'bg-slate-950' : 'bg-white'}`} style={{ zIndex: 99998 }}>
            
            {/* 닫기 버튼 */}
            <button 
              type="button"
              onClick={handleCancelEntry}
              className={`fixed top-8 right-8 w-16 h-16 rounded-full flex items-center justify-center shadow-2xl cursor-pointer pointer-events-auto active:scale-90 transition-all z-[99999] ${
                entryStep === 'timer' ? 'bg-white/10 text-white border border-white/20' : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
            >
              <span className="text-3xl font-bold">✕</span>
            </button>

            {/* 취소 확인 모달 */}
            {isConfirmingCancel && (
              <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[100000]">
                <div className="bg-white w-full max-w-sm rounded-[3rem] p-10 text-center shadow-2xl">
                  <div className="text-4xl mb-4">⚠️</div>
                  <h4 className="text-xl font-black text-slate-900 mb-2">입력을 중단할까요?</h4>
                  <p className="text-slate-500 text-sm mb-10 leading-relaxed">지금 중단하면 기록이 저장되지 않습니다.</p>
                  <div className="flex flex-col gap-3">
                    <button onClick={resetEntry} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-sm">네, 취소합니다</button>
                    <button onClick={() => setIsConfirmingCancel(false)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-sm">계속 입력할게요</button>
                  </div>
                </div>
              </div>
            )}

            {/* 단계별 콘텐츠 */}
            <div className="w-full max-w-lg relative" style={{ zIndex: 99998 }}>
              {entryStep === 'timer' && (
                <div className="flex flex-col items-center text-center">
                  <span className="px-4 py-1.5 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest mb-6">
                    {activeSpace.name} 테스트 진행 중
                  </span>
                  <div className="text-7xl md:text-9xl font-mono font-black text-white tracking-tighter mb-16 tabular-nums">
                    {formatTime(testSeconds)}
                  </div>
                  <div className="flex gap-4 w-full px-4">
                    <button 
                      onClick={() => setIsTimerRunning(!isTimerRunning)}
                      className={`flex-[2] py-6 rounded-3xl font-black text-xl transition-all shadow-2xl ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'}`}
                    >
                      {isTimerRunning ? '일시정지' : '다시 시작'}
                    </button>
                    <button onClick={handleFinishTimer} className="flex-1 py-6 bg-green-600 text-white rounded-3xl font-black text-xl shadow-2xl">완료</button>
                  </div>
                </div>
              )}

              {entryStep === 'score' && (
                <div className="flex flex-col items-center">
                  <h3 className="text-4xl font-black text-slate-900 mb-2 text-center">시험 점수 입력</h3>
                  <p className="text-slate-400 font-bold mb-12 text-center">이번 테스트의 득점을 설정하세요.</p>
                  
                  <div className="flex items-center gap-8 md:gap-12 mb-16">
                    <div className="flex flex-col items-center gap-4">
                      <button onClick={() => setScoreTens(t => (t + 1) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▲</button>
                      <div className="text-6xl md:text-8xl font-black text-slate-900 tabular-nums w-20 text-center">{scoreTens}</div>
                      <button onClick={() => setScoreTens(t => (t - 1 + 10) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▼</button>
                      <span className="text-[10px] font-black text-slate-300 tracking-widest">TENS</span>
                    </div>
                    <div className="flex flex-col items-center gap-4">
                      <button onClick={() => setScoreOnes(o => (o + 1) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▲</button>
                      <div className="text-6xl md:text-8xl font-black text-slate-900 tabular-nums w-20 text-center">{scoreOnes}</div>
                      <button onClick={() => setScoreOnes(o => (o - 1 + 10) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▼</button>
                      <span className="text-[10px] font-black text-slate-300 tracking-widest">ONES</span>
                    </div>
                  </div>

                  <div className="w-full p-8 bg-indigo-600 rounded-[2.5rem] text-center shadow-2xl mb-8">
                    <span className="text-white font-black text-2xl md:text-3xl">최종 { (scoreTens * 10) + scoreOnes } 점</span>
                  </div>

                  <button 
                    onClick={() => setEntryStep('details')}
                    className="w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-black text-xl hover:bg-slate-800 transition-all shadow-xl"
                  >
                    다음 (부가 정보 입력)
                  </button>
                </div>
              )}

              {entryStep === 'details' && (
                <div className="flex flex-col items-center">
                  <h3 className="text-4xl font-black text-slate-900 mb-2 text-center">부가 정보 확인</h3>
                  <p className="text-slate-400 font-bold mb-10 text-center">데이터 분석을 위한 세부 수치입니다.</p>

                  <div className="w-full space-y-6 mb-12">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <MiniInput label="투입 공부량 (P)" value={formData.b} onChange={v => setFormData({...formData, b: v})} step={1} />
                      <MiniInput label="투입 공부시간 (h)" value={formData.tStudy} onChange={v => setFormData({...formData, tStudy: v})} step={0.1} />
                    </div>
                    <div className="bg-indigo-50/50 p-6 rounded-[2rem] border border-indigo-100">
                      <MiniInput label="시험 권장 시간 (분)" value={formData.tRec} onChange={v => setFormData({...formData, tRec: v})} highlight step={1} />
                      <p className="text-[10px] text-indigo-400 mt-2 text-center font-bold">
                        권장 시간 대비 실제 소요시간({(testSeconds/60).toFixed(2)}분)을 분석합니다.
                      </p>
                    </div>
                  </div>

                  <button 
                    onClick={handleFinalSave}
                    className="w-full py-6 bg-indigo-600 text-white rounded-[2.5rem] font-black text-xl hover:bg-indigo-700 transition-all shadow-xl"
                  >
                    저장 및 정밀 분석
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {analytics ? (
          <div className="space-y-10 pb-10">
            {/* 상단 통계 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">전체 평균 시험 점수</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-slate-800">{analytics.avgScore.toFixed(1)}</span>
                    <span className="text-sm font-bold text-slate-400">점</span>
                  </div>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">평균 성적 상승률 (공부량 대비)</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-black ${analytics.avgIncreaseRate === null ? 'text-slate-300' : 'text-emerald-600'}`}>
                    {analytics.avgIncreaseRate === null ? '---' : `+${analytics.avgIncreaseRate.toFixed(3)}`}
                  </span>
                  <span className="text-sm font-bold text-slate-400 uppercase">점/P</span>
                </div>
              </div>
            </div>

            {/* 상세 지표 및 적분 모델 분석 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white rounded-[3rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col">
                    <div className="bg-slate-900 px-8 py-5 text-white flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Analysis Bridge</span>
                        <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                          실시간 효율 분석 중
                        </span>
                    </div>
                    
                    <div className="p-10 flex flex-col md:flex-row items-center gap-12 relative flex-grow">
                        <div className={`flex-1 text-center transition-opacity ${!analytics.prev ? 'opacity-30' : 'opacity-100'}`}>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">이전 회차 점수</p>
                            <p className="text-5xl font-black text-slate-300">{analytics.prev ? `${analytics.prev.h1}점` : '없음'}</p>
                        </div>

                        <div className="flex-none flex flex-col items-center">
                            <div className="bg-indigo-50 px-6 py-3 rounded-2xl border border-indigo-100 flex flex-col items-center shadow-sm">
                                <span className="text-[9px] font-black text-indigo-400 uppercase mb-1">투입 공부량</span>
                                <span className="text-2xl font-black text-indigo-600">{analytics.last.b}P</span>
                            </div>
                            <span className="text-[10px] font-black text-slate-300 my-4 tracking-widest">VS</span>
                        </div>

                        <div className="flex-1 text-center">
                            <p className="text-[10px] font-bold text-indigo-500 uppercase mb-2">최근 회차 점수</p>
                            <p className="text-7xl font-black text-indigo-600">{analytics.last.h1}점</p>
                            {analytics.prev && (
                              <div className="mt-4 inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-black">
                                  ▲ {analytics.last.h1 - analytics.prev.h1}점 향상
                              </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-50 p-8 border-t border-slate-100 grid grid-cols-3 gap-4">
                        <div className="text-center">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">분당 득점 효율</p>
                            <p className="text-xl font-black text-slate-800">{(analytics.last.h1 / analytics.last.tTest).toFixed(2)}</p>
                        </div>
                        <div className="text-center border-x border-slate-200">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">시간 절약분</p>
                            <p className={`text-xl font-black ${analytics.last.tRec - analytics.last.tTest >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {analytics.last.tRec - analytics.last.tTest > 0 ? `+${(analytics.last.tRec - analytics.last.tTest).toFixed(1)}` : (analytics.last.tRec - analytics.last.tTest).toFixed(1)}분
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">페이지당 득점</p>
                            <p className="text-xl font-black text-slate-800">{(analytics.last.h1 / analytics.last.b).toFixed(2)}</p>
                        </div>
                    </div>
                </div>

                {/* 그래프 길이 분석 */}
                <div className="bg-indigo-600 rounded-[3rem] p-10 text-white shadow-2xl shadow-indigo-200 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-8">
                            <span className="text-2xl">⚡</span>
                            <h4 className="text-sm font-black uppercase tracking-widest text-indigo-200 leading-tight">시험 점수 · 시간 절약<br/>공부량 분석</h4>
                        </div>
                        {insights?.graphData ? (
                            <div className="space-y-2">
                                <p className="text-7xl font-black tracking-tighter">
                                    {insights.graphData.total.toFixed(4)}
                                </p>
                                <p className="text-xs font-bold text-indigo-200 opacity-70 uppercase">Graph Length PI</p>
                            </div>
                        ) : (
                            <div className="py-12 border-2 border-dashed border-white/20 rounded-3xl text-center px-4">
                              <p className="text-indigo-200 text-sm font-bold leading-relaxed">2회 이상의 테스트 데이터가 입력되면 정밀 분석 수치가 산출됩니다.</p>
                            </div>
                        )}
                    </div>
                    
                    <div className="mt-10 bg-white/10 p-5 rounded-2xl border border-white/10">
                        <p className="text-[10px] text-indigo-100 leading-relaxed font-medium">
                            공식에 따라 점수 변화율과 시간 관리 효율을 통합적으로 미분·적분하여 계산한 고유 성과 지수입니다.
                        </p>
                    </div>
                </div>

                {/* 학습량 예측 섹션 */}
                <div className="lg:col-span-3 bg-white rounded-[3.5rem] p-12 border border-slate-200 shadow-xl mt-4">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
                        <div>
                            <h4 className="text-4xl font-black text-slate-900 tracking-tight">목표 달성 필요 학습량 예측</h4>
                            <p className="text-slate-400 text-sm mt-3 font-medium">현재 효율을 토대로 다음 목표 점수 도달을 위해 필요한 공부량을 모델링합니다.</p>
                        </div>
                        <div className="bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100 flex flex-col items-center min-w-[220px] shadow-inner">
                            <label className="block text-[10px] font-black text-slate-400 uppercase mb-3 tracking-widest">목표 추가 점수(h3)</label>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setTargetH3(Math.max(1, targetH3 - 5))} className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm hover:bg-slate-50 flex items-center justify-center font-bold">－</button>
                                <input 
                                    type="number" 
                                    value={targetH3} 
                                    onChange={e => setTargetH3(Number(e.target.value))}
                                    className="bg-transparent text-slate-900 font-black text-4xl w-24 focus:outline-none text-center"
                                />
                                <button onClick={() => setTargetH3(targetH3 + 5)} className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm hover:bg-slate-50 flex items-center justify-center font-bold">＋</button>
                            </div>
                        </div>
                    </div>

                    {insights ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <div className="bg-slate-50 rounded-[2.5rem] p-10 border border-slate-100 hover:border-indigo-200 transition-all group shadow-sm">
                              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-6">Type A. 선형 예측 (Linear)</p>
                              <div className="flex items-baseline gap-3 mb-6">
                                  <span className="text-7xl font-black text-slate-900 group-hover:text-indigo-600 transition-colors">{insights.linearB.toFixed(1)}</span>
                                  <span className="text-xl font-bold text-slate-400 italic">Pages</span>
                              </div>
                          </div>

                          <div className="bg-emerald-50/30 rounded-[2.5rem] p-10 border border-emerald-100 hover:border-emerald-300 transition-all group shadow-sm">
                              <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest mb-6">Type B. 정밀 예측 (Cubic)</p>
                              <div className="flex items-baseline gap-3 mb-6 text-emerald-700">
                                  <span className="text-7xl font-black group-hover:scale-105 transition-transform origin-left">{insights.cubicB.toFixed(1)}</span>
                                  <span className="text-xl font-bold opacity-60 italic">Pages</span>
                              </div>
                          </div>
                      </div>
                    ) : (
                      <div className="py-20 bg-slate-50 rounded-[2.5rem] text-center border-2 border-dashed border-slate-200">
                        <p className="text-slate-400 font-bold italic">2회 이상의 테스트 기록이 필요합니다.</p>
                      </div>
                    )}
                </div>
            </div>
          </div>
        ) : (
          <div className="py-24 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100 text-slate-400 italic">
            데이터가 부족합니다. 시험 결과를 등록하여 정밀 성과 분석을 시작하세요.
          </div>
        )}
      </div>
    );
  }

  // 계층 이동 UI
  return (
    <div className="space-y-6">
      {!activeCategoryId ? (
        <div className="animate-in fade-in duration-500">
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 p-10 flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
            <div>
              <h3 className="text-3xl font-black text-slate-900">시험 관리 허브</h3>
              <p className="text-sm text-slate-400 mt-2 font-medium">과목별 시험 데이터를 관리하고 성과 지수를 분석하세요.</p>
            </div>
            <button onClick={() => setShowAddCategoryForm(!showAddCategoryForm)} className="w-full md:w-auto bg-slate-900 text-white px-10 py-4 rounded-2xl font-black text-sm hover:bg-slate-800 transition-all shadow-xl shadow-slate-200">
              {showAddCategoryForm ? '취소' : '＋ 새 시험 공간 추가'}
            </button>
          </div>
          {showAddCategoryForm && (
            <div className="flex gap-4 animate-in slide-in-from-top-2 mb-8">
              <input placeholder="공간 명칭..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="flex-grow p-5 border border-slate-200 rounded-[1.5rem] bg-white font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all" />
              <button onClick={() => { onAddCategory(newCategoryName); setNewCategoryName(''); setShowAddCategoryForm(false); }} className="px-12 bg-indigo-600 text-white rounded-[1.5rem] font-black hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all">공간 생성</button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {testCategories.map(cat => (
              <div key={cat.id} onClick={() => setActiveCategoryId(cat.id)} className="bg-white rounded-[2.5rem] p-10 border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all cursor-pointer group flex flex-col justify-between h-64">
                <div>
                  <span className="text-[10px] font-black px-2 py-1 rounded bg-slate-50 text-slate-400 uppercase tracking-widest">Hub</span>
                  <h4 className="text-2xl font-black text-slate-800 mt-4 group-hover:text-indigo-600 transition-colors">{cat.name}</h4>
                </div>
                <div className="flex justify-between items-end">
                    <span className="text-xs font-bold text-slate-400">데이터 공간 {cat.difficultySpaces.length}개</span>
                    <div className="bg-indigo-50 text-indigo-600 p-4 rounded-2xl group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in duration-500">
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 p-10 flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
            <button onClick={() => setActiveCategoryId(null)} className="text-slate-400 hover:text-slate-600 font-black text-sm flex items-center gap-2 transition-colors">← 전체 목록으로</button>
            <button onClick={() => setShowAddSpaceForm(!showAddSpaceForm)} className="w-full md:w-auto bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black text-sm hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all">
              {showAddSpaceForm ? '취소' : '＋ 난이도별 공간 추가'}
            </button>
          </div>
          {showAddSpaceForm && (
            <div className="flex gap-4 animate-in slide-in-from-top-2 mb-8">
              <input placeholder="난이도/분류..." value={newSpaceName} onChange={e => setNewSpaceName(e.target.value)} className="flex-grow p-5 border border-slate-200 rounded-[1.5rem] bg-white font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all" />
              <button onClick={() => { onAddDifficultySpace(activeCategoryId, newSpaceName); setNewSpaceName(''); setShowAddSpaceForm(false); }} className="px-12 bg-indigo-600 text-white rounded-[1.5rem] font-black shadow-lg shadow-indigo-100">공간 추가</button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {activeCategory?.difficultySpaces.map(space => (
              <div key={space.id} onClick={() => setActiveSpaceId(space.id)} className="bg-white rounded-[2.5rem] p-10 border border-slate-200 shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all cursor-pointer group flex flex-col justify-between h-64">
                <div>
                  <span className="text-[10px] font-black px-2 py-1 rounded bg-indigo-50 text-indigo-400 uppercase tracking-widest">Space</span>
                  <h4 className="text-2xl font-black text-slate-800 mt-4 group-hover:text-indigo-600 transition-colors">{space.name}</h4>
                </div>
                <div className="flex justify-between items-end">
                    <span className="text-xs font-bold text-slate-400">데이터 {space.records.length}회 기록</span>
                    <div className="bg-slate-50 text-slate-400 p-4 rounded-2xl group-hover:bg-indigo-600 group-hover:text-white transition-all">
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

const MiniInput: React.FC<{ label: string; value: number; onChange: (v: number) => void; highlight?: boolean; step?: number }> = ({ label, value, onChange, highlight, step = 1 }) => (
  <div className="space-y-2">
    <label className={`block text-[10px] font-black uppercase px-1 tracking-tight ${highlight ? 'text-indigo-600' : 'text-slate-400'}`}>{label}</label>
    <input 
      type="number"
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className={`w-full p-4 border rounded-2xl bg-white text-base font-black focus:ring-4 outline-none text-center transition-all shadow-sm ${highlight ? 'border-indigo-300 focus:ring-indigo-500/10' : 'border-slate-200 focus:ring-slate-500/5'}`}
    />
  </div>
);
