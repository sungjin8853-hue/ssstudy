import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { ReviewMemoBlock, serializeReviewMemoBlocks } from '../utils/reviewMemo';
import type { ReviewMemoDocument } from '../types';
import { canMoveReviewMemoNode, getReviewMemoChildren, getReviewMemoSubdocument, moveReviewMemoNode, newReviewMemoNodeId, resolveReviewMemoDocument, reviewMemoDocumentToText, withReviewMemoLogicalOperators } from '../utils/reviewMemoDocument';
import { MemoColorTextarea } from './MemoColorTextarea';
import { getReviewMemoDoubleSpaceEdit } from '../utils/reviewMemoInput';
import { getReviewFieldOverrides } from '../utils/reviewFieldOverride';

interface Props {
  value: string;
  onChange: (value: string, document: ReviewMemoDocument) => void;
  document?: ReviewMemoDocument;
  placeholder?: string;
  theme?: 'light' | 'dark';
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  nested?: boolean;
  onExit?: () => void;
  colorColons?: boolean;
  fieldOverrides?: ReadonlyMap<number, string>;
}

interface ToggleDrag {
  source: string | null;
  target: string | null;
  canDrop: (id: string) => boolean;
  start: (id: string) => void;
  hover: (id: string | null) => void;
  drop: (id: string) => void;
  finish: () => void;
}
const ToggleDragContext = createContext<ToggleDrag | null>(null);
const TOGGLE_DRAG_TYPE = 'application/x-studywise-toggle';
type Block = ReviewMemoBlock & { id: string; childDocument?: ReviewMemoDocument };
const makeBlock = (block: ReviewMemoBlock): Block => ({ ...block, id: newReviewMemoNodeId() });
const readBlocks = (value: string, stored?: ReviewMemoDocument): Block[] => {
  const document = resolveReviewMemoDocument(value, stored);
  const blocks: Block[] = getReviewMemoChildren(document).map(node => node.type === 'text'
    ? { id: node.id, type: 'text', text: node.text }
    : { id: node.id, type: 'toggle', title: node.text, text: reviewMemoDocumentToText(document, node.id), childDocument: getReviewMemoSubdocument(document, node.id) });
  return blocks.length ? blocks : [makeBlock({ type: 'text', text: '' })];
};
const blocksToDocument = (blocks: Block[]): ReviewMemoDocument => withReviewMemoLogicalOperators({
  version: 1,
  nodes: blocks.flatMap((block, order) => {
    const node = { id: block.id, parentId: null, type: block.type, text: block.type === 'toggle' ? block.title : block.text, order };
    if (block.type === 'text') return [node];
    const children = resolveReviewMemoDocument(block.text, block.childDocument);
    return [node, ...children.nodes.map(child => ({ ...child, parentId: child.parentId ?? block.id }))];
  })
});
const GrowingTextarea = ({ value, inputRef, colorColons, dark, fieldOverrides, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputRef: (element: HTMLTextAreaElement | null) => void;
  colorColons: boolean;
  dark: boolean;
  fieldOverrides?: ReadonlyMap<number, string>;
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = '0px';
    ref.current.style.height = `${Math.max(32, ref.current.scrollHeight)}px`;
  }, [value]);
  return <MemoColorTextarea {...props} rows={1} value={value} colorColons={colorColons} dark={dark} fieldOverrides={fieldOverrides}
    ref={element => {
    ref.current = element;
    inputRef(element);
  }} />;
};

export const ReviewMemoEditor: React.FC<Props> = ({
  value, onChange, document, placeholder = '복습 노트', theme = 'light',
  minHeight = 88, maxHeight, className = '', nested = false, onExit, colorColons = false, fieldOverrides
}) => {
  const parentDrag = useContext(ToggleDragContext);
  const [blocks, setBlocks] = useState<Block[]>(() => readBlocks(value, document));
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);
  const documentRef = useRef<ReviewMemoDocument>(blocksToDocument(blocks));
  const emitted = useRef(value);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const childEditors = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<{ key: string; position?: number } | null>(null);
  const dark = theme === 'dark';

  // Keep empty paragraphs and block identities stable during local edits.
  useLayoutEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const next = readBlocks(value, document);
    documentRef.current = blocksToDocument(next);
    setBlocks(next);
    setClosed(new Set());
  }, [value, document]);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const { key, position } = pendingFocus.current;
    const field = fields.current.get(key) || childEditors.current.get(key)?.querySelector('textarea');
    if (!field) return;
    field.focus();
    const caret = position ?? field.value.length;
    field.setSelectionRange(caret, caret);
    pendingFocus.current = null;
  }, [blocks, closed]);

  const commit = (next: Block[]) => {
    const normalized = next.length ? next : [makeBlock({ type: 'text', text: '' })];
    setBlocks(normalized);
    emitted.current = serializeReviewMemoBlocks(normalized);
    documentRef.current = blocksToDocument(normalized);
    onChange(emitted.current, documentRef.current);
  };
  const finishDrag = () => {
    dragSourceRef.current = null;
    setDragSource(null);
    setDragTarget(null);
  };
  const drag: ToggleDrag = parentDrag || {
    source: dragSource,
    target: dragTarget,
    canDrop: id => !!dragSourceRef.current && canMoveReviewMemoNode(documentRef.current, dragSourceRef.current, id),
    start: id => { dragSourceRef.current = id; setDragSource(id); setDragTarget(null); },
    hover: setDragTarget,
    drop: id => {
      const source = dragSourceRef.current;
      if (source) {
        const moved = moveReviewMemoNode(documentRef.current, source, id);
        if (moved !== documentRef.current) {
          setClosed(new Set());
          commit(readBlocks(reviewMemoDocumentToText(moved), moved));
        }
      }
      finishDrag();
    },
    finish: finishDrag
  };
  const update = (index: number, block: Block) => {
    const next = [...blocks];
    next[index] = block;
    commit(next);
  };
  const focus = (id: string, part: 'text' | 'title', position?: number) => {
    pendingFocus.current = { key: `${id}:${part}`, position };
  };
  const register = (id: string, part: 'text' | 'title') => (element: HTMLTextAreaElement | null) => {
    const key = `${id}:${part}`;
    if (element) fields.current.set(key, element);
    else fields.current.delete(key);
  };
  const convertLine = (index: number, caret: number, command = '') => {
    const block = blocks[index];
    if (block.type !== 'text') return;
    const start = caret === 0 ? 0 : block.text.lastIndexOf('\n', caret - 1) + 1;
    const nextBreak = block.text.indexOf('\n', caret);
    const end = nextBreak < 0 ? block.text.length : nextBreak;
    const line = block.text.slice(start, end);
    const toggle = { ...makeBlock({ type: 'toggle', title: command ? line.slice(command.length) : line, text: '' }),
      ...(start === 0 ? { id: block.id } : {}) };
    const replacements: Block[] = [];
    if (start > 0) replacements.push({ ...block, text: block.text.slice(0, start - 1) });
    replacements.push(toggle);
    if (end < block.text.length) replacements.push(makeBlock({ type: 'text', text: block.text.slice(end + 1) }));
    focus(toggle.id, 'title', command ? 0 : undefined);
    commit([...blocks.slice(0, index), ...replacements, ...blocks.slice(index + 1)]);
  };
  const removeEmptyTextBlock = (index: number) => {
    if (blocks.length <= 1) return;
    const previous = blocks[index - 1];
    const following = blocks[index + 1];
    const target = previous || following;
    if (target) {
      const part = target.type === 'toggle' ? 'title' : 'text';
      const position = previous
        ? (target.type === 'toggle' ? target.title.length : target.text.length)
        : 0;
      focus(target.id, part, position);
    }
    commit(blocks.filter((_, blockIndex) => blockIndex !== index));
  };
  const exitToggle = (index: number) => {
    const next = [...blocks];
    next[index] = { ...next[index], text: next[index].text.replace(/\n$/, '') };
    let paragraph = next[index + 1];
    if (!paragraph || paragraph.type !== 'text') {
      paragraph = makeBlock({ type: 'text', text: '' });
      next.splice(index + 1, 0, paragraph);
    }
    focus(paragraph.id, 'text', 0);
    commit(next);
  };
  const textStyle = `block w-full resize-none overflow-hidden bg-transparent py-0.5 text-lg font-medium leading-7 outline-none ${dark ? 'text-rose-50 placeholder:text-rose-200/35' : 'text-slate-800 placeholder:text-slate-300'}`;
  const subtle = `rounded p-1 ${dark ? 'text-slate-400 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`;
  const content = (
    <div className={nested ? className : `${className} rounded-xl border p-3 ${dark ? 'border-rose-300/25 bg-black/20' : 'border-rose-100 bg-white'}`}>
      <div role="group" aria-label={nested ? '토글 내용 편집' : '복습 노트 편집'} className={nested ? '' : 'overflow-y-auto'} style={nested ? undefined : { minHeight, maxHeight }}>
        {blocks.map((block, index) => {
          const isDropTarget = block.type === 'toggle' && drag.target === block.id;
          return (
          <div key={block.id} data-memo-node-id={block.id} className={`group relative rounded-lg ${isDropTarget ? dark ? 'bg-indigo-500/15 ring-2 ring-indigo-400' : 'bg-indigo-50 ring-2 ring-indigo-300' : ''}`}
            onDragOver={event => {
              if (!drag.source || block.type !== 'toggle') return;
              event.stopPropagation();
              if (!drag.canDrop(block.id)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              drag.hover(block.id);
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                if (isDropTarget) drag.hover(null);
              }
            }}
            onDrop={event => {
              if (!drag.source || block.type !== 'toggle') return;
              event.preventDefault();
              event.stopPropagation();
              drag.drop(block.id);
            }}>
            <div className="flex items-start">
              {block.type === 'toggle' && (
                <button type="button" aria-label={closed.has(block.id) ? '토글 펼치기' : '토글 접기'} aria-expanded={!closed.has(block.id)}
                  draggable
                  title="클릭하여 접기·펼치기, 드래그하여 다른 토글 안으로 이동"
                  onDragStart={event => {
                    event.stopPropagation();
                    event.dataTransfer.setData(TOGGLE_DRAG_TYPE, 'move');
                    event.dataTransfer.effectAllowed = 'move';
                    drag.start(block.id);
                  }}
                  onDragEnd={event => { event.stopPropagation(); drag.finish(); }}
                  onClick={() => setClosed(prev => {
                    const next = new Set(prev);
                    if (next.has(block.id)) next.delete(block.id); else next.add(block.id);
                    return next;
                  })}
                  className={`mt-0.5 grid h-7 w-6 shrink-0 cursor-grab place-items-center active:cursor-grabbing ${subtle}`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${closed.has(block.id) ? '' : 'rotate-90'}`}>
                    <path d="M3 2L9 6L3 10Z" fill="currentColor" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <GrowingTextarea inputRef={register(block.id, block.type === 'toggle' ? 'title' : 'text')}
                  colorColons={colorColons} dark={dark} fieldOverrides={fieldOverrides}
                  aria-label={block.type === 'toggle' ? '토글 제목' : nested ? '토글 내용' : '노트 내용'}
                  placeholder={block.type === 'toggle' ? '토글 제목' : blocks.length === 1 ? placeholder : ''}
                  value={block.type === 'toggle' ? block.title : block.text} className={textStyle}
                  onChange={event => update(index, block.type === 'toggle' ? { ...block, title: event.target.value.replace(/\n/g, ' ') } : { ...block, text: event.target.value })}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    const field = event.currentTarget;
                    if (event.key === ' ' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
                      const edit = getReviewMemoDoubleSpaceEdit(field.value, field.selectionStart, field.selectionEnd);
                      if (edit) {
                        event.preventDefault();
                        focus(block.id, block.type === 'toggle' ? 'title' : 'text', edit.caret);
                        update(index, block.type === 'toggle' ? { ...block, title: edit.text } : { ...block, text: edit.text });
                        return;
                      }
                    }
                    if (block.type === 'text') {
                      const caret = field.selectionStart;
                      const start = caret === 0 ? 0 : block.text.lastIndexOf('\n', caret - 1) + 1;
                      const prefix = block.text.slice(start, caret);
                      if (event.key === 'Backspace' && caret === 0 && field.selectionEnd === 0 && !block.text && blocks.length > 1) {
                        event.preventDefault();
                        removeEmptyTextBlock(index);
                      } else if ((event.key === ' ' && prefix === '>') || (event.key === 'Enter' && ['/toggle', '/토글'].includes(prefix))) {
                        event.preventDefault();
                        convertLine(index, caret, prefix);
                      } else if (onExit && index === blocks.length - 1 && event.key === 'Enter' && !event.shiftKey && caret === block.text.length && field.selectionEnd === caret && (!block.text || block.text.endsWith('\n'))) {
                        event.preventDefault();
                        onExit();
                      }
                    } else if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (closed.has(block.id)) {
                        const toggle = makeBlock({ type: 'toggle', title: '', text: '' });
                        focus(toggle.id, 'title', 0);
                        setClosed(prev => new Set(prev).add(toggle.id));
                        commit([...blocks.slice(0, index + 1), toggle, ...blocks.slice(index + 1)]);
                      } else {
                        focus(block.id, 'text', 0);
                        setClosed(prev => { const next = new Set(prev); next.delete(block.id); return next; });
                      }
                    } else if (event.key === 'Backspace' && field.selectionStart === 0 && field.selectionEnd === 0) {
                      event.preventDefault();
                      focus(block.id, 'text', 0);
                      const children = block.text || block.childDocument?.nodes.length ? readBlocks(block.text, block.childDocument) : [];
                      commit([
                        ...blocks.slice(0, index),
                        { type: 'text', text: block.title, id: block.id },
                        ...children,
                        ...blocks.slice(index + 1)
                      ]);
                    }
                  }} />
              </div>
            </div>
            {block.type === 'toggle' && !closed.has(block.id) && (
              <div className="ml-6 pl-2" ref={element => {
                const key = `${block.id}:text`;
                if (element) childEditors.current.set(key, element);
                else childEditors.current.delete(key);
              }}>
                <ReviewMemoEditor nested theme={theme} value={block.text} placeholder="내용"
                  colorColons={colorColons}
                  fieldOverrides={getReviewFieldOverrides(block.title, fieldOverrides)}
                  document={block.childDocument}
                  onChange={(text, childDocument) => update(index, { ...block, text, childDocument })}
                  onExit={() => exitToggle(index)} />
              </div>
            )}
          </div>
        ); })}
      </div>
    </div>
  );
  return nested ? content : <ToggleDragContext.Provider value={drag}>{content}</ToggleDragContext.Provider>;
};
