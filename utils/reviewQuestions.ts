import { parseReviewMemoBlocks } from './reviewMemo';
import { isReviewSequenceSeparator } from './reviewMemoLogic';
import { calculateReviewQuestionDifficulty, compareReviewQuestionDifficulty } from './reviewDifficulty';
import type { ReviewQuestionDifficulty } from './reviewDifficulty';
import { getReviewFieldOverrides, readReviewFieldOverride, stripReviewFieldOverrides } from './reviewFieldOverride';

export interface AnswerSpan { nodeId: string; start: number; end: number }
export interface QuestionNoteNode { id: string; parentId: string | null; type: 'text' | 'toggle'; text: string }
type QuestionColumn = number | string;
type Expression =
  | { type: 'text'; text: string; span: AnswerSpan }
  | { type: 'and' | 'or' | 'sequence'; items: Expression[] }
  | { type: 'relation'; fields: Expression[]; separators: string[]; classifications: QuestionColumn[] };

export interface NoteQuestion extends ReviewQuestionDifficulty {
  key: string;
  prompt: string;
  answer: string;
  direction: 'forward' | 'reverse';
  kind: 'direct' | 'reverse' | 'remaining' | 'context' | 'reconstruct' | 'recall' | 'order-next' | 'order-previous' | 'order-reconstruct';
  level: number;
  priority: number;
  conditions: string[];
  columns: { prompt: QuestionColumn[]; answer: QuestionColumn[]; conditions: QuestionColumn[][] };
  answerSpans: AnswerSpan[];
  promptSpans: AnswerSpan[];
  conditionSpans: AnswerSpan[][];
}

interface QuestionCondition { text: string; columns: QuestionColumn[]; spans: AnswerSpan[] }

// Only top-level delimiters split a column. Nested groups restart column numbering.
const splitAt = (text: string, from: number, to: number, delimiters: string) => {
  const cuts: number[] = [];
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    const override = text[i] === ':' || text[i] === ';' ? readReviewFieldOverride(text, i + 1, to) : undefined;
    if (override) {
      if (depth === 0 && delimiters.includes(text[i])) cuts.push(i);
      i = override.end - 1;
      continue;
    }
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && delimiters.includes(text[i])
      && (text[i] !== '-' || isReviewSequenceSeparator(text, i, from, to))) cuts.push(i);
  }
  return cuts;
};
const combine = (type: 'and' | 'or' | 'sequence', items: Expression[]): Expression => (
  items.length === 1 ? items[0] : { type, items }
);
const nonempty = (expression: Expression): boolean => expression.type === 'text'
  ? !!expression.text.trim()
  : expression.type === 'relation' ? expression.fields.some(nonempty) : expression.items.some(nonempty);

function parseExpression(text: string, nodeId: string, from = 0, to = text.length, inherited: ReadonlyMap<number, string> = new Map()): Expression {
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  if (text[from] === '[') {
    let depth = 0;
    let closing = -1;
    for (let i = from; i < to; i += 1) {
      if (text[i] === '[') depth += 1;
      if (text[i] === ']') {
        depth -= 1;
        if (depth === 0) { closing = i; break; }
      }
    }
    if (closing === to - 1) return parseExpression(text, nodeId, from + 1, to - 1, inherited);
  }
  const relationCuts = splitAt(text, from, to, ':;');
  if (relationCuts.length) {
    const boundaries = [from - 1, ...relationCuts, to];
    let column = 0;
    const classifications: QuestionColumn[] = [];
    const fields = boundaries.slice(1).map((end, index) => {
      const start = boundaries[index] + 1;
      const override = index > 0 ? readReviewFieldOverride(text, start, end) : undefined;
      const label = override?.label ?? inherited.get(index);
      classifications.push(label !== undefined ? label : index === 0 ? column : ++column);
      return parseExpression(text, nodeId, override?.end ?? start, end, inherited);
    });
    return { type: 'relation', separators: relationCuts.map(i => text[i]), fields, classifications };
  }
  for (const [delimiter, type] of [['=', 'or'], [',', 'and'], ['-', 'sequence']] as const) {
    const cuts = splitAt(text, from, to, delimiter);
    if (!cuts.length) continue;
    const boundaries = [from - 1, ...cuts, to];
    const items = boundaries.slice(1).map((end, i) => parseExpression(text, nodeId, boundaries[i] + 1, end, inherited)).filter(nonempty);
    if (items.length) return combine(type, items);
  }
  return { type: 'text', text: text.slice(from, to), span: { nodeId, start: from, end: to } };
}

const head = (expression: Expression): Expression => {
  if (expression.type === 'relation') return head(expression.fields[0]);
  if (expression.type === 'text') return expression;
  return { ...expression, items: expression.items.map(head) };
};
const spans = (expression: Expression): AnswerSpan[] => expression.type === 'text'
  ? (nonempty(expression) ? [expression.span] : [])
  : expression.type === 'relation' ? expression.fields.flatMap(spans) : expression.items.flatMap(spans);
export const expressionLabel = (expression: Expression): string => {
  if (expression.type === 'text') return expression.text;
  if (expression.type === 'relation') return expression.fields.map(expressionLabel).join(' → ');
  return expression.items.map(item => {
    const label = expressionLabel(item);
    return item.type !== 'text' && item.type !== expression.type ? `(${label})` : label;
  }).join(expression.type === 'and' ? ' AND ' : expression.type === 'or' ? ' OR ' : ' → ');
};

const remainingExpression = (expression: Expression, known: Set<string>): Expression | null => {
  if (expression.type === 'text') return known.has(expression.text) ? null : expression;
  if (expression.type === 'relation') return remainingExpression(head(expression), known);
  if (expression.type === 'sequence') {
    for (let index = 0; index < expression.items.length; index += 1) {
      const remaining = remainingExpression(expression.items[index], known);
      if (remaining) return combine('sequence', [remaining, ...expression.items.slice(index + 1)]);
    }
    return null;
  }
  const items = expression.items.map(item => remainingExpression(item, known));
  if (expression.type === 'or' && items.some(item => item === null)) return null;
  const remaining = items.filter((item): item is Expression => item !== null);
  return remaining.length ? combine(expression.type, remaining) : null;
};
const availableFacts = (expression: Expression): Expression[] => {
  if (expression.type === 'text') return [expression];
  if (expression.type === 'relation') return availableFacts(head(expression));
  return (expression.type === 'sequence' ? expression.items.slice(0, 1) : expression.items).flatMap(availableFacts);
};
const allFacts = (expression: Expression): Expression[] => {
  if (expression.type === 'text') return [expression];
  return expression.type === 'relation' ? allFacts(head(expression)) : expression.items.flatMap(allFacts);
};

// Explore satisfied facts breadth-first, retaining each remaining AND/OR/order structure.
const partialConditions = (expression: Expression): Array<{ given: Expression[]; remaining: Expression }> => {
  if (expression.type === 'text') return [];
  const facts = [...new Map(allFacts(expression).map(item => [expressionLabel(item), item])).values()];
  const indexByLabel = new Map(facts.map((fact, index) => [expressionLabel(fact), index]));
  const pending: number[][] = [[]];
  const visited = new Set(['']);
  const result: Array<{ given: Expression[]; remaining: Expression }> = [];
  for (let cursor = 0; cursor < pending.length && result.length < 64; cursor += 1) {
    const selected = pending[cursor];
    const known = new Set(selected.map(index => expressionLabel(facts[index])));
    const current = remainingExpression(expression, known);
    if (!current) continue;
    for (const candidate of availableFacts(current)) {
      let next = [...selected, indexByLabel.get(expressionLabel(candidate))!].sort((a, b) => a - b);
      const remaining = remainingExpression(expression, new Set(next.map(index => expressionLabel(facts[index]))));
      if (!remaining) continue;
      // Drop a supplied fact when another supplied branch already makes it unnecessary.
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const shorter = next.filter((_, i) => i !== index);
        const without = remainingExpression(expression, new Set(shorter.map(i => expressionLabel(facts[i]))));
        if (without && expressionLabel(without) === expressionLabel(remaining)) next = shorter;
      }
      const key = next.join(',');
      if (visited.has(key)) continue;
      visited.add(key);
      result.push({ given: next.map(index => facts[index]), remaining });
      pending.push(next);
      if (result.length >= 64) break;
    }
  }
  return result;
};
const hash = (text: string) => {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
};

export const getReviewQuestionClassification = (criterion: string | null | undefined, question: NoteQuestion) => {
  const text = criterion || '';
  const boundaries = [-1, ...splitAt(text, 0, text.length, ':;'), text.length];
  const columns = boundaries.slice(1).map((end, index) => text.slice(boundaries[index] + 1, end).trim());
  const labels = (indices: QuestionColumn[]) => [...new Set(indices.map(index => typeof index === 'string' ? index : columns[index]).filter(Boolean))];
  return {
    prompt: labels(question.columns.prompt),
    answer: labels(question.columns.answer),
    conditions: question.conditions.map((_, index) => labels(question.columns.conditions[index] || []))
  };
};

export function buildReviewQuestions(memo: string): { questions: NoteQuestion[]; nodes: QuestionNoteNode[] } {
  const nodes: QuestionNoteNode[] = [];
  const expressions = new Map<string, Expression[]>();
  const inheritedByNode = new Map<string, ReadonlyMap<number, string>>();
  const walkBlocks = (text: string, parentId: string | null, inherited: ReadonlyMap<number, string> = new Map()) => {
    parseReviewMemoBlocks(text).forEach((block, index) => {
      const id = `${parentId || 'root'}.${index}`;
      const value = block.type === 'toggle' ? block.title : block.text;
      nodes.push({ id, parentId, type: block.type, text: value });
      inheritedByNode.set(id, inherited);
      const cuts = splitAt(value, 0, value.length, '/\n');
      const boundaries = [-1, ...cuts, value.length];
      expressions.set(id, boundaries.slice(1).map((end, i) => parseExpression(value, id, boundaries[i] + 1, end, inherited)).filter(nonempty));
      if (block.type === 'toggle') walkBlocks(block.text, id, getReviewFieldOverrides(value, inherited));
    });
  };
  walkBlocks(memo, null);
  // A trailing relation uses direct child heads; grandchildren retain their own relations.
  [...nodes].reverse().forEach(node => {
    if (node.type !== 'toggle') return;
    const children = nodes.filter(child => child.parentId === node.id)
      .flatMap(child => (expressions.get(child.id) || []).map(head)).filter(nonempty);
    const clauses = expressions.get(node.id) || [];
    const last = clauses.at(-1);
    if (last?.type === 'relation' && !nonempty(last.fields.at(-1)!) && children.length) {
      last.fields[last.fields.length - 1] = combine(last.separators.at(-1) === ';' ? 'or' : 'and', children);
    }
  });

  const questions: NoteQuestion[] = [];
  const occurrences = new Map<string, number>();
  const reverseAlternatives = new Map<string, { question: NoteQuestion; answers: string[] }>();
  const add = (question: Omit<NoteQuestion, 'key' | 'level' | keyof ReviewQuestionDifficulty>) => {
    if (!question.prompt.trim() || !question.answer.trim() || question.prompt === question.answer) return;
    const reverseIdentity = JSON.stringify([question.prompt, question.conditions, question.priority, question.columns]);
    const existingReverse = question.kind === 'reverse' ? reverseAlternatives.get(reverseIdentity) : undefined;
    if (existingReverse) {
      if (!existingReverse.answers.includes(question.answer)) existingReverse.answers.push(question.answer);
      existingReverse.question.answer = existingReverse.answers.map(answer => existingReverse.answers.length > 1 && answer.includes(' AND ') ? `(${answer})` : answer).join(' OR ');
      existingReverse.question.answerSpans.push(...question.answerSpans);
      existingReverse.question.promptSpans.push(...question.promptSpans);
      existingReverse.question.key = `q2:${hash(JSON.stringify(['reverse', question.prompt, existingReverse.question.answer, question.conditions]))}:0`;
      return;
    }
    const signature = hash(JSON.stringify([question.kind, question.prompt, question.answer, question.conditions]));
    const occurrence = occurrences.get(signature) || 0;
    occurrences.set(signature, occurrence + 1);
    const entry: NoteQuestion = { ...question, answerSpans: [...question.answerSpans], promptSpans: [...question.promptSpans],
      level: 1, recallUnits: 0, providedUnits: 0, difficulty: 0, key: `q2:${signature}:${occurrence}` };
    questions.push(entry);
    if (question.kind === 'reverse') reverseAlternatives.set(reverseIdentity, { question: entry, answers: [question.answer] });
  };
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ancestorConditions = (node: QuestionNoteNode) => {
    const result: QuestionCondition[] = [];
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId)!;
      const rawTitle = parent.text.replace(/[:;]\s*$/, '');
      const title = stripReviewFieldOverrides(rawTitle).trim().replace(/[:;]\s*$/, '');
      const parsed = parseExpression(rawTitle, parent.id, 0, rawTitle.length, inheritedByNode.get(parent.id));
      result.unshift({ text: title, spans: spans(parsed), columns: parsed.type === 'relation'
        ? parsed.fields.flatMap((field, index) => nonempty(field) ? [parsed.classifications[index]] : []) : [0] });
      parentId = parent.parentId;
    }
    return result.filter(item => item.text);
  };
  const visit = (expression: Expression, context: QuestionCondition[], inheritedColumn: QuestionColumn = 0, inheritedPriority = 1) => {
    if (expression.type === 'text') return;
    const conditions = context.map(item => item.text);
    const conditionColumns = context.map(item => item.columns);
    const conditionSpans = context.map(item => item.spans);
    if (expression.type === 'sequence') {
      const items = expression.items.map(head);
      items.slice(1).forEach((right, index) => {
        const left = items[index];
        const base = { prompt: expressionLabel(left), answer: expressionLabel(right), direction: 'forward' as const,
          priority: inheritedPriority, conditions, conditionSpans, answerSpans: spans(right), promptSpans: spans(left),
          columns: { prompt: [inheritedColumn], answer: [inheritedColumn], conditions: conditionColumns } };
        add({ ...base, kind: 'order-next' });
        add({ ...base, prompt: base.answer, answer: base.prompt, direction: 'reverse', kind: 'order-previous',
          answerSpans: base.promptSpans, promptSpans: base.answerSpans });
      });
      if (items.length > 2) add({ prompt: expressionLabel(items[0]), answer: expressionLabel(combine('sequence', expression.items.slice(1))),
        direction: 'forward', kind: 'order-reconstruct', priority: inheritedPriority, conditions, conditionSpans,
        columns: { prompt: [inheritedColumn], answer: [inheritedColumn], conditions: conditionColumns },
        answerSpans: expression.items.slice(1).flatMap(spans), promptSpans: spans(items[0]) });
      expression.items.forEach((item, index) => visit(item, index === 0 ? context
        : [...context, { text: `${expressionLabel(combine('sequence', items.slice(0, index)))} 이후`,
          columns: [inheritedColumn], spans: items.slice(0, index).flatMap(spans) }], inheritedColumn, inheritedPriority));
      return;
    }
    if (expression.type !== 'relation') { expression.items.forEach(item => visit(item, context, inheritedColumn, inheritedPriority)); return; }
    const columns = expression.fields.map(head);
    expression.separators.forEach((separator, index) => {
      const left = columns[index];
      const right = columns[index + 1];
      if (!nonempty(left) || !nonempty(right)) return;
      const base = { prompt: expressionLabel(left), answer: expressionLabel(right), direction: 'forward' as const,
        priority: index + 1, conditions, conditionSpans, answerSpans: spans(right), promptSpans: spans(left),
        columns: { prompt: [expression.classifications[index]], answer: [expression.classifications[index + 1]], conditions: conditionColumns } };
      add({ ...base, kind: 'direct' });
      if (separator === ':') add({ ...base, prompt: base.answer, answer: base.prompt, direction: 'reverse',
        kind: 'reverse', answerSpans: base.promptSpans, promptSpans: base.answerSpans,
        columns: { ...base.columns, prompt: base.columns.answer, answer: base.columns.prompt } });
      partialConditions(right).forEach(({ given, remaining }) => add({ ...base, kind: 'remaining',
        answer: expressionLabel(remaining), answerSpans: spans(remaining),
        conditions: [...conditions, ...given.map(fact => `${expressionLabel(fact)} 충족`)],
        conditionSpans: [...conditionSpans, ...given.map(spans)],
        columns: { ...base.columns, conditions: [...conditionColumns, ...given.map(() => [expression.classifications[index + 1]])] },
        promptSpans: [...spans(left), ...given.flatMap(spans)] }));
      if (conditions.length) add({ ...base, kind: 'context',
        prompt: conditions[0], conditions: [...conditions.slice(1), base.prompt],
        promptSpans: conditionSpans[0], conditionSpans: [...conditionSpans.slice(1), base.promptSpans],
        columns: { prompt: conditionColumns[0], answer: base.columns.answer,
          conditions: [...conditionColumns.slice(1), base.columns.prompt] } });
    });
    if (columns.length > 2 && columns.every(nonempty)) {
      const rest = combine('and', expression.fields.slice(1));
      add({ prompt: expressionLabel(columns[0]), answer: expression.fields.slice(1).map(expressionLabel).join(' → '),
        direction: 'forward', kind: 'reconstruct', priority: 1, conditions, conditionSpans,
        columns: { prompt: [expression.classifications[0]], answer: expression.classifications.slice(1), conditions: conditionColumns },
        answerSpans: spans(rest), promptSpans: spans(columns[0]) });
    } else if (columns.length === 2 && nonempty(columns[0])
      && expressionLabel(expression.fields[1]) !== expressionLabel(columns[1])) {
      add({ prompt: expressionLabel(columns[0]), answer: expressionLabel(expression.fields[1]), direction: 'forward',
        kind: 'reconstruct', priority: 1, conditions, conditionSpans,
        columns: { prompt: [expression.classifications[0]], answer: [expression.classifications[1]], conditions: conditionColumns },
        answerSpans: spans(expression.fields[1]), promptSpans: spans(columns[0]) });
    }
    expression.fields.forEach((field, index) => visit(field, index > 0
      ? [...context, { text: expressionLabel(columns[0]), columns: [expression.classifications[0]], spans: spans(columns[0]) }]
      : context, expression.classifications[index], Math.max(1, index)));
  };
  nodes.forEach(node => (expressions.get(node.id) || []).forEach(expression => visit(expression, ancestorConditions(node))));
  if (!questions.length && memo.trim()) {
    const text = nodes.map(node => node.text).join('\n');
    if (text.trim()) questions.push({ key: 'note', prompt: '정리노트', answer: text, kind: 'recall', level: 1, priority: 1,
      direction: 'forward', conditions: [], conditionSpans: [], recallUnits: 0, providedUnits: 0, difficulty: 0,
      columns: { prompt: [], answer: [], conditions: [] },
      answerSpans: nodes.filter(node => node.text.trim()).map(node => ({ nodeId: node.id, start: 0, end: node.text.length })), promptSpans: [] });
  }
  questions.forEach(question => Object.assign(question, calculateReviewQuestionDifficulty(question.answerSpans,
    [...question.promptSpans, ...question.conditionSpans.flat()])));
  for (const priority of new Set(questions.map(question => question.priority))) {
    const group = questions.filter(question => question.priority === priority).sort(compareReviewQuestionDifficulty);
    const signature = (question: NoteQuestion) => `${question.difficulty}:${question.recallUnits}:${question.providedUnits}`;
    const ranks = [...new Set(group.map(signature))];
    group.forEach(question => { question.level = Math.min(3, Math.floor(ranks.indexOf(signature(question)) * 3 / ranks.length) + 1); });
  }
  questions.sort((a, b) => a.priority - b.priority || compareReviewQuestionDifficulty(a, b));
  return { questions, nodes };
}

export const REVIEW_QUESTION_KIND_LABELS: Record<NoteQuestion['kind'], string> = {
  direct: '기본 관계', reverse: '역방향', remaining: '남은 조건', context: '상위 조건 연결', reconstruct: '전체 재구성', recall: '노트 회상',
  'order-next': '다음 순서', 'order-previous': '이전 순서', 'order-reconstruct': '순서 재구성'
};
