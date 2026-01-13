
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
  
  // 상태 변수들
  const [tens, setTens] = useState(0);
  const [ones, setOnes] = useState(0);
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

  // 타이머 로직 (화면 꺼짐 대응: 타임스탬프 방식)
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

  // 실시간 분 계산 (소수점 2자리)
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
    setTens(0);
    setOnes(0);
    setPhoto(undefined);
    setIsCameraOpen(false);
    setIsConfirmingCancel(false);
  };

  const handleXClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsConfirmingCancel(true);
  };

  const handleStartMeasurement = () => {
    if (!subjectId) {
      alert("과목을 먼저 선택해주세요!");
      return;
    }
    accumulatedSecondsRef.current = 0;
    setSeconds(0);
    setStep('timer');
    setIsTimerRunning(true);
  };

  const handleFinishTimer = () => {
    setIsTimerRunning(false);
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
      alert("카메라를 켤 수 없습니다.");
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
    const totalPages = (tens * 10) + ones;
    if (totalPages <= 0) {
      alert("학습한 페이지 수를 입력해주세요.");
      return;
    }

    onLogSession({
      id: Math.random().toString(36).substr(2, 9),
      subjectId,
      pagesRead: totalPages,
      timeSpentMinutes: minutes,
      timestamp: new Date().toISOString(),
      photoBase64: photo,
      isReviewed: false
    });

    resetAll();
  };

  if (step === 'idle') {
    return (
      <div className="bg-white p-8 rounded-[3.5rem] shadow-sm border border-slate-200">
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2 mb-8">
            <span className="w-2 h-5 bg-green-500 rounded-full"></span>
            학습 로거
        </h2>
        <div className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest px-1">대상 과목</label>
            <select 
              className="w-full p-4 border-2 border-slate-100 rounded-2xl bg-slate-50 font-bold appearance-none cursor-pointer focus:border-indigo-500 transition-colors"
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
            >
              <option value="">과목을 선택하세요...</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button 
            onClick={handleStartMeasurement}
            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-2"
          >
            <span>⏱️</span> 학습 측정 시작
          </button>
        </div>
      </div>
    );
  }

  const isDark = step === 'timer';
  const bgColor = isDark ? 'bg-slate-950' : 'bg-white';

  return (
    <div className={`fixed inset-0 flex flex-col items-center justify-center p-6 ${bgColor}`} style={{ zIndex: 99998 }}>
      <button 
        type="button"
        onClick={handleXClick}
        className={`fixed top-8 right-8 w-16 h-16 rounded-full flex items-center justify-center shadow-2xl cursor-pointer pointer-events-auto active:scale-90 transition-all z-[99999] ${
          isDark ? 'bg-white/10 text-white border border-white/20' : 'bg-slate-100 text-slate-600 border border-slate-200'
        }`}
      >
        <span className="text-3xl font-bold">✕</span>
      </button>

      {isConfirmingCancel && (
        <div className="fixed inset-0 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm z-[100000]">
          <div className="bg-white w-full max-w-sm rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in duration-200">
            <div className="text-4xl mb-4">⚠️</div>
            <h4 className="text-xl font-black text-slate-900 mb-2">학습 측정을 중단할까요?</h4>
            <p className="text-slate-500 text-sm mb-10 leading-relaxed">지금 중단하면 지금까지의 기록이<br/>모두 사라지고 저장되지 않습니다.</p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={resetAll} 
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-sm hover:bg-red-700 active:scale-95 transition-all"
              >
                네, 측정을 취소합니다
              </button>
              <button 
                onClick={() => setIsConfirmingCancel(false)} 
                className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-sm hover:bg-slate-200 active:scale-95 transition-all"
              >
                아니오, 계속 할게요
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-lg relative" style={{ zIndex: 99998 }}>
        {step === 'timer' && (
          <div className="flex flex-col items-center text-center">
            <span className="px-4 py-1.5 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-black uppercase tracking-widest mb-6">
              {subjects.find(s => s.id === subjectId)?.name} 학습 중
            </span>
            <div className="text-7xl md:text-9xl font-mono font-black text-white tracking-tighter mb-16 tabular-nums">
              {formatTime(seconds)}
            </div>
            <div className="flex gap-4 w-full px-4">
              <button 
                onClick={() => setIsTimerRunning(!isTimerRunning)}
                className={`flex-[2] py-6 rounded-3xl font-black text-xl transition-all shadow-2xl ${
                  isTimerRunning ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white'
                }`}
              >
                {isTimerRunning ? '일시정지' : '다시 시작'}
              </button>
              <button 
                onClick={handleFinishTimer}
                className="flex-1 py-6 bg-green-600 text-white rounded-3xl font-black text-xl shadow-2xl"
              >
                완료
              </button>
            </div>
          </div>
        )}

        {step === 'pages' && (
          <div className="flex flex-col items-center">
            <h3 className="text-4xl font-black text-slate-900 mb-2">학습량 기록</h3>
            <p className="text-slate-400 font-bold mb-12 text-center">공부한 페이지 수를 설정하세요.</p>
            
            <div className="flex items-center gap-8 md:gap-12 mb-16">
              <div className="flex flex-col items-center gap-4">
                <button onClick={() => setTens(t => (t + 1) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▲</button>
                <div className="text-6xl md:text-8xl font-black text-slate-900 tabular-nums w-20 text-center">{tens}</div>
                <button onClick={() => setTens(t => (t - 1 + 10) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▼</button>
                <span className="text-[10px] font-black text-slate-300 tracking-widest">TENS</span>
              </div>
              <div className="flex flex-col items-center gap-4">
                <button onClick={() => setOnes(o => (o + 1) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▲</button>
                <div className="text-6xl md:text-8xl font-black text-slate-900 tabular-nums w-20 text-center">{ones}</div>
                <button onClick={() => setOnes(o => (o - 1 + 10) % 10)} className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-center text-2xl hover:bg-indigo-50 active:scale-90 transition-all">▼</button>
                <span className="text-[10px] font-black text-slate-300 tracking-widest">ONES</span>
              </div>
            </div>

            <div className="w-full p-8 bg-indigo-600 rounded-[2.5rem] text-center shadow-2xl mb-8">
              <span className="text-white font-black text-2xl md:text-3xl">총 {(tens * 10) + ones} 페이지 공부</span>
            </div>

            <button 
              onClick={() => setStep('photo')}
              className="w-full py-6 bg-slate-900 text-white rounded-[2.5rem] font-black text-xl hover:bg-slate-800 transition-all shadow-xl"
            >
              다음 (인증 사진)
            </button>
          </div>
        )}

        {step === 'photo' && (
          <div className="flex flex-col items-center">
            <h3 className="text-4xl font-black text-slate-900 mb-2">인증샷 찍기</h3>
            <p className="text-slate-400 font-bold mb-10 text-center">오늘의 학습 흔적을 남겨보세요.</p>

            <div className="w-full aspect-square max-w-[400px] bg-slate-50 rounded-[3.5rem] border-2 border-dashed border-slate-200 overflow-hidden relative mb-12 flex items-center justify-center shadow-inner">
              {isCameraOpen ? (
                <div className="relative w-full h-full">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                    <button 
                      onClick={takePhoto}
                      className="w-20 h-20 bg-white border-8 border-indigo-600 rounded-full flex items-center justify-center shadow-2xl active:scale-95 transition-transform"
                    >
                      <div className="w-12 h-12 bg-indigo-600 rounded-full"></div>
                    </button>
                  </div>
                </div>
              ) : photo ? (
                <div className="relative w-full h-full">
                  <img src={photo} className="w-full h-full object-cover" alt="Note" />
                  <button 
                    onClick={() => setPhoto(undefined)}
                    className="absolute top-6 right-6 bg-red-600 text-white w-10 h-10 rounded-full shadow-lg font-bold z-[10]"
                  >✕</button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6 p-10">
                  <button 
                    onClick={startCamera}
                    className="w-24 h-24 bg-white text-indigo-600 rounded-full flex items-center justify-center text-4xl shadow-xl hover:scale-105 active:scale-95 transition-all"
                  >
                    📷
                  </button>
                  <p className="text-sm text-slate-400 font-black">탭하여 카메라 시작</p>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            <div className="w-full max-w-[400px]">
              <button 
                onClick={handleFinalSave}
                className={`w-full py-6 rounded-[2.5rem] font-black text-xl transition-all shadow-xl ${
                  photo ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                }`}
              >
                {photo ? '완료 및 저장' : '사진 없이 저장'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
