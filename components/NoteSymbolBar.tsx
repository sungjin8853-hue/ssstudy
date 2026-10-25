import React, { useEffect, useState } from 'react';
import { useNoteShorthand } from '../utils/useNoteShorthand';

/** 정리노트에서 쓰는 기호를 한 번에 누를 수 있는 막대. 글자를 넣는 일은 편집기가 한다. */

export interface NoteSymbol {
  /** 편집기에 넘기는 값. '( )'는 괄호 한 쌍(묶음), '>'는 토글 만들기. `[ ]`는 분류 기준이라 막대에 두지 않고 직접 쓴다. */
  value: string;
  label: string;
  aria: string;
  tone: 'indigo' | 'amber' | 'teal' | 'slate' | 'toggle';
  flex?: number;
}

export const NOTE_SYMBOLS: NoteSymbol[] = [
  { value: ':', label: ':', aria: '콜론 (양방향)', tone: 'indigo' },
  { value: ';', label: ';', aria: '세미콜론 (앞으로만 →)', tone: 'amber' },
  { value: '<', label: '<', aria: '작다 기호 (거꾸로만 ←)', tone: 'amber' },
  { value: ',', label: ',', aria: '쉼표 (그리고)', tone: 'teal' },
  { value: '=', label: '=', aria: '등호 (한 칸 안에서 같다)', tone: 'teal' },
  { value: '-', label: '-', aria: '하이픈 (순서)', tone: 'teal' },
  { value: '( )', label: '( )', aria: '괄호 (묶음)', tone: 'teal', flex: 1.3 },
  { value: '//', label: '//', aria: '슬래시 두 번 (같은 줄 구분)', tone: 'slate' },
  { value: '>', label: '>', aria: '토글 만들기', tone: 'toggle', flex: 1.3 }
];

const TONES: Record<NoteSymbol['tone'], string> = {
  indigo: 'border-[#C9CCF7] bg-white text-indigo-600',
  amber: 'border-[#F0D9A0] bg-white text-amber-700',
  teal: 'border-[#A6DDD3] bg-white text-teal-700',
  slate: 'border-[#CBD2E1] bg-white text-slate-700',
  toggle: 'border-[#C9CCF7] bg-[#ECEBFD] text-[#2B2480]'
};

/** 화면 키보드가 올라와 있으면 그 높이(px), 아니면 0. 키보드 바로 위에 막대를 붙이기 위해 쓴다. */
export const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!viewport) return undefined;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
};

const KEYBOARD_MIN_INSET = 120;

export const NoteSymbolBar: React.FC<{ onInsert: (value: string) => void; className?: string }> = ({ onInsert, className = '' }) => {
  const inset = useKeyboardInset();
  const floating = inset >= KEYBOARD_MIN_INSET;
  // `=`·`-` 단축어를 끄면 그 둘은 그냥 글자라서 막대에서 뺀다
  const shorthand = useNoteShorthand();
  const symbols = shorthand ? NOTE_SYMBOLS : NOTE_SYMBOLS.filter(symbol => symbol.value !== '=' && symbol.value !== '-');
  // 글 입력칸에서 포커스가 빠지지 않도록 누르는 순간의 기본 동작을 막는다.
  const keepFocus = (event: React.SyntheticEvent) => event.preventDefault();
  return (
    <div role="group" aria-label="기호 입력" data-floating={floating ? 'true' : 'false'}
      style={floating ? { bottom: inset } : undefined}
      className={`flex gap-1.5 border-[#D2D8F5] bg-white px-2 py-2.5 sm:gap-2 sm:px-3 ${floating ? 'fixed inset-x-0 z-40 border-t shadow-[0_-4px_16px_rgba(30,40,90,0.12)]' : 'border-b'} ${className}`}>
      {symbols.map(symbol => (
        <button key={symbol.value} type="button" aria-label={symbol.aria}
          onMouseDown={keepFocus} onPointerDown={keepFocus}
          onClick={() => onInsert(symbol.value)}
          style={{ flex: symbol.flex ?? 1 }}
          className={`h-14 min-w-0 whitespace-nowrap rounded-xl border-2 font-mono text-[22px] font-bold transition-transform sm:text-[26px] active:scale-95 ${TONES[symbol.tone]}`}>
          {symbol.label}
        </button>
      ))}
    </div>
  );
};
