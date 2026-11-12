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

/** 화면 키보드가 올라와 있으면 그 높이(px), 아니면 0. 9일부터 맨 아래 탭이 키보드 위로 뜨지 않게 하는 데 쓴다. */
export const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!viewport) return undefined;
    // 10일 점검: 두 손가락으로 확대한 동안은 보이는 영역이 줄어도 키보드가 아니다(탭이 사라지지 않게)
    const update = () => setInset(viewport.scale > 1.01 ? 0 : Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    // 12일: 화면을 돌리면 창 높이(innerHeight)가 보이는 영역보다 늦게 바뀌는 브라우저가 있어 창 크기 · 방향이 바뀔 때도 다시 잰다
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  return inset;
};

/** 이 높이(px)보다 크게 화면이 가려지면 화면 키보드가 올라온 것으로 본다 */
export const KEYBOARD_MIN_INSET = 120;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'number', 'tel', 'url', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);
/** 화면 키보드를 띄우는 칸(글 입력칸 · 글 상자 · 직접 고치는 글)에 지금 손이 가 있는가 */
export const isEditableElement = (element: Element | null): boolean => {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'TEXTAREA') return !(element as HTMLTextAreaElement).readOnly;
  if (tag === 'INPUT') {
    const input = element as HTMLInputElement;
    return !input.readOnly && TEXT_INPUT_TYPES.has((input.getAttribute('type') || '').toLowerCase());
  }
  return (element as HTMLElement).isContentEditable === true;
};
/** 키보드가 올라왔다고 볼 때: 글을 쓰는 칸에 손이 가 있고 그만큼 화면이 가려졌을 때만 */
export const keyboardOpenFrom = (inset: number, editing: boolean) => editing && inset >= KEYBOARD_MIN_INSET;

/**
 * 12일 "가로 화면에서 축소를 짝 당겨야 맨 밑 탭이 나온다": 가로 화면에서는 창 높이와 보이는 영역의 차이가 키보드 없이도 크게 잡히는 브라우저가 있어
 * 맨 아래 탭이 키보드 때처럼 숨었다. 이제 글을 쓰는 칸에 손이 가 있을 때만 키보드로 본다.
 */
export const useKeyboardOpen = () => {
  const inset = useKeyboardInset();
  const [editing, setEditing] = useState(() => (typeof document === 'undefined' ? false : isEditableElement(document.activeElement)));
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const update = () => setEditing(isEditableElement(document.activeElement));
    // 칸에서 손을 뗄 때는 다음 칸으로 옮겨 가는 중일 수 있어 한 박자 뒤에 본다
    const later = () => window.setTimeout(update, 0);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return keyboardOpenFrom(inset, editing);
};

export const NoteSymbolBar: React.FC<{ onInsert: (value: string) => void; className?: string }> = ({ onInsert, className = '' }) => {
  // 9일 "키보드 때 안 움직이게": 키보드가 올라와도 막대는 노트 칸 위 제자리에 둔다(전에는 키보드 바로 위로 옮겨 갔다)
  // `=`·`-` 단축어를 끄면 그 둘은 그냥 글자라서 막대에서 뺀다
  const shorthand = useNoteShorthand();
  const symbols = shorthand ? NOTE_SYMBOLS : NOTE_SYMBOLS.filter(symbol => symbol.value !== '=' && symbol.value !== '-');
  // 글 입력칸에서 포커스가 빠지지 않도록 누르는 순간의 기본 동작을 막는다.
  const keepFocus = (event: React.SyntheticEvent) => event.preventDefault();
  return (
    <div role="group" aria-label="기호 입력" data-floating="false"
      className={`flex gap-1.5 border-b border-[#D2D8F5] bg-white px-2 py-2.5 sm:gap-2 sm:px-3 ${className}`}>
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
