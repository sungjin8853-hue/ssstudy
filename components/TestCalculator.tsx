import React, { useEffect, useMemo, useState } from 'react';
import { calculateMentalBurden, calculateStudyBurdenV2 } from '../utils/math';

interface SavedCalculation {
  id: string;
  name: string;
  createdAt: string;
  inputs: {
    h1: number;
    h2: number;
    h3: number;
    b: number;
    tStudy: number;
    tTest: number;
    tRec: number;
  };
  predictedPages: number;
  burden: number;
}

const STORAGE_KEY = 'swp_test_calculations_v1';

export const TestCalculator: React.FC = () => {
  const [name, setName] = useState('');
  const [inputs, setInputs] = useState({
    h1: 0,
    h2: 1,
    h3: 10,
    b: 0,
    tStudy: 0,
    tTest: 0,
    tRec: 60
  });
  const [saved, setSaved] = useState<SavedCalculation[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSaved(JSON.parse(stored) || []);
    } catch (error) {
      console.error('Failed to load test calculations', error);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved]);

  const result = useMemo(() => {
    const predictedPages = calculateStudyBurdenV2(inputs).total;
    const burden = calculateMentalBurden(
      inputs.h1,
      inputs.h2,
      inputs.b,
      inputs.tStudy,
      inputs.tTest,
      inputs.tRec
    ).total;
    return { predictedPages, burden };
  }, [inputs]);

  const updateInput = (key: keyof typeof inputs, value: number) => {
    setInputs(current => ({ ...current, [key]: Number.isFinite(value) ? value : 0 }));
  };

  const saveResult = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSaved(current => [{
      id: Math.random().toString(36).slice(2, 11),
      name: trimmedName,
      createdAt: new Date().toISOString(),
      inputs,
      predictedPages: result.predictedPages,
      burden: result.burden
    }, ...current]);
    setName('');
  };

  const deleteResult = (item: SavedCalculation) => {
    if (!window.confirm(`"${item.name}" 결과를 삭제하시겠습니까?`)) return;
    setSaved(current => current.filter(savedItem => savedItem.id !== item.id));
  };

  return (
    <div className="space-y-10 animate-fade-in">
      <section className="rounded-[3rem] border border-slate-200 bg-white p-5 md:p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-indigo-500">Independent Test Model</p>
          <h3 className="mt-3 text-3xl font-black text-slate-900">시험 예측 및 부하 계산</h3>
          <p className="mt-2 text-sm font-medium text-slate-400">과목 데이터와 분리된 독립 계산 결과를 저장하고 비교합니다.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <NumberField label="현재 점수 h1" value={inputs.h1} onChange={value => updateInput('h1', value)} />
          <NumberField label="점수 향상 h2" value={inputs.h2} onChange={value => updateInput('h2', value)} />
          <NumberField label="목표 향상 h3" value={inputs.h3} onChange={value => updateInput('h3', value)} />
          <NumberField label="공부량 b (P)" value={inputs.b} onChange={value => updateInput('b', value)} />
          <NumberField label="공부 시간 (시간)" value={inputs.tStudy} step={0.1} onChange={value => updateInput('tStudy', value)} />
          <NumberField label="실제 시험 시간 (분)" value={inputs.tTest} onChange={value => updateInput('tTest', value)} />
          <NumberField label="권장 시험 시간 (분)" value={inputs.tRec} onChange={value => updateInput('tRec', value)} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <ResultCard label="예측 P" value={result.predictedPages.toFixed(1)} unit="P" color="indigo" />
          <ResultCard label="부하 L" value={result.burden.toFixed(2)} unit="" color="rose" />
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') saveResult();
            }}
            placeholder="결과 이름 입력 (예: 6월 모의고사)"
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 font-bold outline-none focus:border-indigo-500"
          />
          <button
            onClick={saveResult}
            disabled={!name.trim()}
            className="rounded-2xl bg-slate-900 px-8 py-4 font-black text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-30"
          >
            결과 저장
          </button>
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between px-2">
          <div>
            <h3 className="text-2xl font-black text-slate-900">저장 결과 비교</h3>
            <p className="mt-1 text-xs font-bold text-slate-400">동일한 계산식으로 저장된 결과를 한눈에 비교합니다.</p>
          </div>
          <span className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-600">{saved.length}개</span>
        </div>

        {saved.length === 0 ? (
          <div className="rounded-[2.5rem] border-2 border-dashed border-slate-200 bg-white py-20 text-center">
            <p className="text-lg font-black text-slate-600">저장된 시험 계산 결과가 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[2.5rem] border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[850px] w-full text-left">
              <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-5">이름</th>
                  <th className="px-4 py-5">h1 / h2 / h3</th>
                  <th className="px-4 py-5">공부량</th>
                  <th className="px-4 py-5">시간</th>
                  <th className="px-4 py-5 text-indigo-600">예측 P</th>
                  <th className="px-4 py-5 text-rose-600">부하 L</th>
                  <th className="px-4 py-5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {saved.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-6 py-5">
                      <p className="font-black text-slate-800">{item.name}</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-400">{new Date(item.createdAt).toLocaleString('ko-KR')}</p>
                    </td>
                    <td className="px-4 py-5 font-bold text-slate-500">{item.inputs.h1} / +{item.inputs.h2} / +{item.inputs.h3}</td>
                    <td className="px-4 py-5 font-bold text-slate-500">{item.inputs.b}P</td>
                    <td className="px-4 py-5 text-sm font-bold text-slate-500">{item.inputs.tStudy}h · {item.inputs.tTest}/{item.inputs.tRec}m</td>
                    <td className="px-4 py-5 text-xl font-black text-indigo-600">{item.predictedPages.toFixed(1)}P</td>
                    <td className="px-4 py-5 text-xl font-black text-rose-600">{item.burden.toFixed(2)}</td>
                    <td className="px-4 py-5 text-right">
                      <button
                        onClick={() => deleteResult(item)}
                        className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2 text-xs font-black text-rose-500 transition-colors hover:bg-rose-600 hover:text-white"
                      >
                        결과 삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

const NumberField = ({
  label,
  value,
  step = 1,
  onChange
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) => (
  <label className="space-y-2">
    <span className="ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
    <input
      type="number"
      min="0"
      step={step}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-base font-black text-slate-800 outline-none focus:border-indigo-500"
    />
  </label>
);

const ResultCard = ({
  label,
  value,
  unit,
  color
}: {
  label: string;
  value: string;
  unit: string;
  color: 'indigo' | 'rose';
}) => (
  <div className={`rounded-2xl p-4 md:p-6 text-white shadow-xl ${color === 'indigo' ? 'bg-indigo-600' : 'bg-rose-600'}`}>
    <p className="text-xs font-black uppercase tracking-[0.2em] opacity-70">{label}</p>
    <p className="mt-2 text-3xl md:text-5xl font-black">{value}<span className="ml-1 text-base md:text-xl opacity-60">{unit}</span></p>
  </div>
);
