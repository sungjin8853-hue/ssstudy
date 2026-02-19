import React, { useState, useRef, useEffect } from 'react';
import { Subject, StudyLog } from '../types';

interface Props {
  subjects: Subject[];
  onLogSession: (log: StudyLog) => void;
}

type Step = 'idle' | 'timer' | 'pages' | 'photo';

export const SessionLogger: React.FC<Props> = ({ subjects, onLogSession }) => {
  const [step, setStep] = useState<Step>('idle');
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '');
  
  // 페이지 범위 입력 상태
  const [startPage, setStartPage] = useState<string>('');
  const [readAmount, setReadAmount] = useState<string>(''); // 학습한 페이지 수(양)
  
  // 복습 제외 여부 상태
  const [skipReview, setSkipReview] = useState(false);

  const [minutes, setMinutes] = useState(0);
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [seconds, setSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedSecondsRef = useRef<number>(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

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
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTimerRunning]);

  useEffect(() => {
    if (seconds >= 0) {
      setMinutes(parseFloat((seconds / 60).toFixed(2)));
    }
  }, [seconds]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const resetAll = () => {
    setStep('idle');
    setSeconds(0);
    accumulatedSecondsRef.current = 0;
    startTimeRef.current = null;
    setIsTimerRunning(false);
    setStartPage('');
    setReadAmount('');
    setPhoto(undefined);
    setIsCameraOpen(false);
    setIsConfirmingCancel(false);
    setSkipReview(false);
  };

  const handleStartMeasurement = () => {
    if (!subjectId) {
      alert("과목을 먼저 선택해주세요!");
      return;
    }
    setStep('timer');
    setIsTimerRunning(true);
  };
  
  const handleTimerComplete = () => {
      const subj = subjects.find(s => s.id === subjectId);
      if (subj) {
          // 시작 페이지 자동 설정 (기존 완료 페이지 + 1)
          setStartPage((subj.completedPages + 1).toString());
      }
      setStep('pages');
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraOpen(true);
      }
    } catch (err) {
      alert("카메라 접근 권한이 없거나 지원하지 않는 기기입니다.");
    }
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        setPhoto(canvasRef.current.toDataURL('image/png'));
        stopCamera();
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setIsCameraOpen(false);
    }
  };

  const handleFinalSave = () => {
    const sPage = parseInt(startPage);
    const amount = parseInt(readAmount);

    if (isNaN(sPage) || isNaN(amount) || amount <= 0) {
      alert("학습량(페이지 수)을 정확히 입력해주세요.");
      return;
    }

    const ePage = sPage + amount - 1;

    onLogSession({
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: amount,
      startPage: sPage,
      endPage: ePage,
      timeSpentMinutes: minutes,
      timestamp: new Date().toISOString(),
      photoBase64: photo,
      isReviewed: false,
      isCondensed: skipReview // 사용자가 선택한 복습 제외 여부 전달
    });

    resetAll();
  };
  
  // 현재 입력값에 따른 예상 종료 페이지 계산
  const calculatedEndPage = (startPage && readAmount) 
    ? parseInt(startPage) + parseInt(readAmount) - 1 
    : null;

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
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button 
            onClick={handleStartMeasurement}
            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 group"
          >
            <span className="text-2xl group-hover:rotate-12 transition-transform">⏱️</span> 측정 엔진 가동
          </button>
        </div>
      </div>
    );
  }

  const isDark = step === 'timer';

  return (
    <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 ${isDark ? 'bg-slate-950' : 'bg-white'}`} style={{ zIndex: 9999 }}>
      <button 
        onClick={() => setIsConfirmingCancel(true)}
        className={`fixed top-8 right-8 w-14 h-14 rounded-full flex items-center justify-center shadow-xl active:scale-90 transition-all ${
          isDark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        <span className="text-2xl font-bold">✕</span>
      </button>

      {isConfirmingCancel && (
        <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[10000]">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-10 text-center shadow-2xl">
            <h4 className="text-xl font-black text-slate-900 mb-2">학습 측정을 중단할까요?</h4>
            <p className="text-slate-500 text-sm mb-10">기록이 저장되지 않고 사라집니다.</p>
            <div className="flex flex-col gap-3">
              <button onClick={resetAll} className="w-full py-4 bg-red-600 text-white rounded-2xl font-black">네, 취소합니다</button>
              <button onClick={() => setIsConfirmingCancel(false)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">계속 공부할게요</button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-lg">
        {step === 'timer' && (
          <div className="flex flex-col items-center">
            <span className="px-4 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-black uppercase mb-8">측정 진행 중</span>
            <div className="text-8xl md:text-9xl font-mono font-black text-white tabular-nums mb-16">{formatTime(seconds)}</div>
            <div className="flex gap-4 w-full">
              <button 
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className={`flex-[2] py-6 rounded-3xl font-black text-xl shadow-2xl ${isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'}`}
              >
                {isTimerRunning ? '일시정지' : '다시 시작'}
              </button>
              
              <button 
                onClick={() => setSkipReview(!skipReview)}
                className={`w-24 py-4 rounded-3xl font-black text-xs shadow-xl transition-all flex flex-col items-center justify-center gap-1 ${
                  skipReview 
                    ? 'bg-rose-100 text-rose-500 border-2 border-rose-500' 
                    : 'bg-white text-slate-400 border-2 border-transparent'
                }`}
              >
                <span className="text-xl">{skipReview ? '🚫' : '📥'}</span>
                <span>{skipReview ? '복습 제외' : '복습 담기'}</span>
              </button>
              
              <button onClick={handleTimerComplete} className="flex-1 py-6 bg-green-600 text-white rounded-3xl font-black text-xl shadow-2xl">완료</button>
            </div>
          </div>
        )}

        {step === 'pages' && (
          <div className="flex flex-col items-center">
            <h3 className="text-3xl font-black text-slate-900 mb-8">학습량 입력</h3>
            
            <div className="flex flex-col gap-6 mb-8 w-full bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-500 uppercase ml-2 tracking-widest">오늘 학습한 페이지 수 (양)</label>
                    <input 
                        type="number" 
                        value={readAmount} 
                        onChange={e => setReadAmount(e.target.value)} 
                        placeholder="0"
                        autoFocus
                        className="w-full p-6 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-3xl font-black text-4xl text-center outline-none transition-all shadow-sm text-indigo-900"
                    />
                </div>

                <div className="w-full h-px bg-slate-200"></div>

                <div className="flex items-center gap-4">
                    <div className="flex-1 space-y-2 opacity-60">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-2">시작 페이지</label>
                        <input 
                            type="number" 
                            value={startPage} 
                            onChange={e => setStartPage(e.target.value)} 
                            placeholder="0"
                            className="w-full p-4 bg-slate-100 border-none rounded-2xl font-black text-xl text-center outline-none"
                        />
                    </div>
                    <div className="text-slate-300 text-xl font-black mt-6">➜</div>
                    <div className="flex-1 space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-2">종료 페이지 (자동)</label>
                        <div className="w-full p-4 bg-indigo-50 border border-indigo-100 rounded-2xl font-black text-xl text-center text-indigo-600">
                            {calculatedEndPage ? `p.${calculatedEndPage}` : '-'}
                        </div>
                    </div>
                </div>
            </div>

            <div className="w-full p-6 bg-indigo-600 rounded-[2.5rem] text-white text-center mb-8 shadow-xl">
              <p className="text-[10px] font-black text-indigo-300 uppercase mb-2">CALCULATED RANGE</p>
              {startPage && calculatedEndPage ? (
                  <p className="font-black text-2xl">p.{startPage} ~ p.{calculatedEndPage}</p>
              ) : (
                  <p className="font-black text-2xl opacity-50">범위 자동 계산 중...</p>
              )}
            </div>

            <div className="flex gap-4 w-full">
              <button onClick={() => setStep('timer')} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black">뒤로</button>
              <button 
                onClick={() => setStep('photo')} 
                disabled={!readAmount || Number(readAmount) <= 0}
                className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-black disabled:opacity-50 disabled:cursor-not-allowed"
              >
                다음 단계
              </button>
            </div>
          </div>
        )}

        {step === 'photo' && (
          <div className="flex flex-col items-center">
            <h3 className="text-4xl font-black text-slate-900 mb-10">인증샷 (선택)</h3>
            <div className="w-full aspect-square max-w-[360px] bg-slate-50 rounded-[3rem] border-2 border-dashed border-slate-200 overflow-hidden relative mb-12 flex items-center justify-center">
              {isCameraOpen ? (
                <div className="w-full h-full relative">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <button onClick={takePhoto} className="absolute bottom-6 left-1/2 -translate-x-1/2 w-16 h-16 bg-white rounded-full border-4 border-indigo-600"></button>
                </div>
              ) : photo ? (
                <img src={photo} className="w-full h-full object-cover" alt="Log" />
              ) : (
                <button onClick={startCamera} className="text-slate-400 font-bold">📷 카메라 켜기</button>
              )}
            </div>
            <div className="flex gap-4 w-full">
              <button onClick={() => setStep('pages')} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-2xl font-black">뒤로</button>
              <button onClick={handleFinalSave} className="flex-[2] py-5 bg-indigo-600 text-white rounded-2xl font-black shadow-lg">저장 완료</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
