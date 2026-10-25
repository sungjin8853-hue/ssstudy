const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const loadedSources = new Map();

function loadSource(relativePath) {
  const basePath = path.resolve(__dirname, '..', relativePath);
  const filename = ['', '.ts', '.tsx'].map(extension => basePath + extension).find(file => fs.existsSync(file));
  if (loadedSources.has(filename)) return loadedSources.get(filename).exports;
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loadedSources.set(filename, loaded);
  loaded.require = name => name.startsWith('.')
    ? loadSource(path.resolve(path.dirname(filename), name))
    : Module.createRequire(filename)(name);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  });
  loaded._compile(outputText, filename);
  return loaded.exports;
}

const gate = loadSource('utils/reviewGate.ts');
const reviewMemo = loadSource('utils/reviewMemo.ts');
const memoDocument = loadSource('utils/reviewMemoDocument.ts');
const memoColors = loadSource('utils/reviewMemoColors.ts');
const memoInput = loadSource('utils/reviewMemoInput.ts');
const sessionMemo = loadSource('utils/sessionMemo.ts');
const schedule = loadSource('utils/schedule.ts');
global.window = { location: { href: 'http://127.0.0.1:4175/' } };
const { buildDueReviewGroups, buildStudyOrderForDate, buildStudyRunQueue, buildCompletedStudySubjectIds, SessionLogger } = loadSource('components/SessionLogger.tsx');
delete global.window;

const reviewStyle = loadSource('utils/reviewStyle.ts');
/** 카드를 고른 모양(줄글 · 플래시 카드)으로 그린다: 끝나면 원래 모양으로 되돌린다 */
const inStyle = (style, run) => {
  const before = reviewStyle.getReviewStyle();
  reviewStyle.setReviewStyle(style);
  try { return run(); } finally { reviewStyle.setReviewStyle(before); }
};
/** 논리어 색 조각(span)을 벗기고 글만 본다 */
const plainText = html => html.replace(/<[^>]+>/g, '');

const now = Date.parse('2026-09-13T04:00:00.000Z');
const second = 1000;
const hour = 60 * 60 * second;
const day = 24 * hour;
const source = (overrides = {}) => ({
  id: 'note-a', subjectId: 'main', timestamp: '2026-09-12T20:00:00.000Z',
  pagesRead: 4, startPage: 1, endPage: 4, timeSpentMinutes: 20,
  reviewMemo: '[alpha] label: beta // other: gamma',
  reviewStep: 0, nextReviewDate: '2026-09-12T23:00:00.000Z', reviewEnabled: true,
  reviewSubjectIdsSnapshot: ['practice'],
  ...overrides
});
const sourceQuestions = gate.parseReviewGateMemo(source().reviewMemo).questions;
const firstKey = sourceQuestions.find(q => q.kind === 'direct' && q.answer === 'beta').key;
const secondKey = sourceQuestions.find(q => q.kind === 'direct' && q.answer === 'gamma').key;
const reverseKey = sourceQuestions.find(q => q.kind === 'reverse' && q.prompt === 'beta').key;
const wrong = { logId: 'note-a', passed: false, wrongQuestionKeys: [firstKey] };
const right = { logId: 'note-a', passed: true, wrongQuestionKeys: [] };
const withRetry = (overrides = {}) => gate.applyReviewGateOutcomes([source(overrides)], [wrong], false, now)[0];
const withoutGateState = ({ reviewGateRetry, reviewGatePendingResult, reviewGatePendingSteps, ...log }) => log;
const subjects = [
  { id: 'main', name: 'Main', totalPages: 100, completedPages: 4, targetDate: '2026-10-31', reviewSubjectIds: ['practice'] },
  { id: 'practice', name: 'Practice', totalPages: 100, completedPages: 0, targetDate: '2026-10-31' }
];

test('slashes split statements and commas preserve a compound answer', () => {
  const memo = '[alpha] label: beta // other: gamma // number: 23';
  const parsed = gate.parseReviewGateMemo(memo);
  // 줄 맨 앞의 `[alpha]`는 그 줄이 놓인 집합이라 문제 글에는 남기지 않고 조건으로 준다
  assert.deepEqual(parsed.prompts, ['label', 'other', 'number']);
  assert.deepEqual(parsed.questions.find(q => q.prompt === 'label' && q.kind === 'direct').conditions, ['alpha']);
  assert.deepEqual(parsed.answers, ['beta', 'gamma', '23']);
  assert.equal(parsed.parts.map(part => part.text).join(''), memo);
  assert.deepEqual(gate.parseReviewGateMemo('label:answer,').prompts, ['label']);
  assert.deepEqual(gate.parseReviewGateMemo('label:answer,').answers, ['answer']);
});

test('colon colors count each line separately without treating commas as new columns', () => {
  const text = 'A:B,C:D:E\nF:G:H';
  const parts = memoColors.splitReviewMemoColonColors(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.colonIndex !== undefined).map(part => part.colonIndex), [0, 1, 2, 0, 1]);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('::a\n:'), [
    { text: ':', colonIndex: 0 }, { text: ':', colonIndex: 1 }, { text: 'a\n' }, { text: ':', colonIndex: 0 }
  ]);
  // a line that ends on a connector is unfinished: the line below counts on from its columns, like a toggle child
  assert.deepEqual(memoColors.splitReviewMemoColonColors('::\n:'), [
    { text: ':', colonIndex: 0 }, { text: ':', colonIndex: 1 }, { text: '\n' }, { text: ':', colonIndex: 2 }
  ]);
  assert.deepEqual(memoColors.splitReviewMemoColonColors(''), []);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('plain note'), [{ text: 'plain note' }]);
});

test('colon palette prioritizes red and yellow then uses bounded neutral colors', () => {
  for (const dark of [true, false]) {
    const colors = Array.from({ length: 5 }, (_, index) => memoColors.getReviewMemoColonColor(index, dark));
    assert.equal(new Set(colors).size, 5);
    assert.equal(memoColors.getReviewMemoColonColor(100, dark), colors[4]);
  }
});

test('shared colored textarea keeps the original value and removes only decoration when disabled', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MemoColorTextarea } = loadSource('components/MemoColorTextarea.tsx');
  const value = 'purpose:meaning:scaffold\nnext:column';
  const render = colorColons => renderToStaticMarkup(React.createElement(MemoColorTextarea, {
    value, colorColons, dark: true, onChange() {}, 'aria-label': 'session memo', className: 'h-16'
  }));
  const enabled = render(true);
  const disabled = render(false);
  for (const html of [enabled, disabled]) {
    assert.ok(html.includes(`>${value}</textarea>`));
    assert.ok(html.includes('aria-label="session memo"'));
    assert.ok(html.includes('h-16'));
  }
  assert.equal((enabled.match(/data-colon-index="1"/g) || []).length, 2);
  assert.ok(enabled.includes('aria-hidden="true"'));
  assert.ok(!disabled.includes('data-colon-index'));
  assert.ok(!disabled.includes('color:transparent'));
});

test('questions are stable items and do not depend on a difficulty stage', () => {
  assert.deepEqual(gate.getReviewGateQuestionKeys(source().reviewMemo), sourceQuestions.map(q => q.key));
  // `<`는 역관계라 거꾸로 문제만 낸다: `label< beta`의 문제는 `label: beta`의 역방향 문제와 같은 문제다.
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] label< beta // other< gamma'), sourceQuestions.filter(q => q.kind === 'reverse').map(q => q.key));
  // `;`는 충분조건이라 앞으로만 낸다: `label; beta`의 문제는 `label: beta`의 정방향 문제와 같은 문제다.
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] label; beta // other; gamma'), sourceQuestions.filter(q => q.kind === 'direct').map(q => q.key));
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] plain recall'), ['note']);
  assert.deepEqual(gate.getReviewGateQuestionKeys(' '), []);
});

test('less-than means the reverse relation and asks the reverse only; semicolons ask forward only; colons ask both directions', () => {
  const forwardOnly = gate.parseReviewGateMemo('sing; sing in Korean\nA;X:B');
  assert.deepEqual(forwardOnly.questions.filter(q => ['direct', 'reverse'].includes(q.kind)).map(({ prompt, answer, direction }) => ({ prompt, answer, direction })), [
    { prompt: 'sing', answer: 'sing in Korean', direction: 'forward' },
    { prompt: 'A', answer: 'X', direction: 'forward' },
    { prompt: 'X', answer: 'B', direction: 'forward' },
    { prompt: 'B', answer: 'X', direction: 'reverse' }
  ]);
  const parsed = gate.parseReviewGateMemo('sing< sing in Korean\nA<X:B');
  assert.deepEqual(parsed.questions.filter(q => ['direct', 'reverse'].includes(q.kind)).map(({ prompt, answer, direction }) => ({ prompt, answer, direction })), [
    { prompt: 'sing in Korean', answer: 'sing', direction: 'reverse' },
    { prompt: 'X', answer: 'A', direction: 'reverse' },
    { prompt: 'X', answer: 'B', direction: 'forward' },
    { prompt: 'B', answer: 'X', direction: 'reverse' }
  ]);
});

test('a second space replaces the first space with a colon and preserves the caret', () => {
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit('sing ', 5, 5), { text: 'sing:', caret: 5 });
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit('term answer', 5, 5), { text: 'term:answer', caret: 5 });
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit('자동차 ', 4, 4), { text: '자동차:', caret: 4 });
});

test('an existing colon to the left keeps ordinary spaces in the same relation', () => {
  assert.equal(memoInput.getReviewMemoDoubleSpaceEdit('A:B ', 4, 4), null);
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit('A B:C', 2, 2), { text: 'A:B:C', caret: 2 });
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit('A;B ', 4, 4), { text: 'A;B:', caret: 4 });
});

test('a new line or slash starts a new relation for the space shortcut', () => {
  const text = 'A:B\nC:D//E ';
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit(text, text.length, text.length), { text: 'A:B\nC:D//E:', caret: text.length });
  const nextLine = 'A:B\nC ';
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit(nextLine, nextLine.length, nextLine.length), { text: 'A:B\nC:', caret: nextLine.length });
  const topic = 'A:B [topic/name] C ';
  assert.equal(memoInput.getReviewMemoDoubleSpaceEdit(topic, topic.length, topic.length), null);
});

test('the space shortcut does not replace indentation, selections or toggle commands', () => {
  for (const text of ['', ' ', '  ', '\n ', 'A\n ', 'A// ', 'A  ', '> ']) {
    assert.equal(memoInput.getReviewMemoDoubleSpaceEdit(text, text.length, text.length), null, text);
  }
  assert.equal(memoInput.getReviewMemoDoubleSpaceEdit('A B', 2, 3), null);
  assert.equal(memoInput.getReviewMemoDoubleSpaceEdit('A', 1, 1), null);
});

test('shortcut edits retain toggle identities, children and logical metadata', () => {
  const document = memoDocument.reviewMemoDocumentFromText(reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: '자동차 ', text: '엔진 \n타이어;바퀴' }
  ]));
  const title = document.nodes.find(node => node.type === 'toggle');
  const edit = memoInput.getReviewMemoDoubleSpaceEdit(title.text, title.text.length, title.text.length);
  const updated = memoDocument.withReviewMemoLogicalOperators({
    ...document, nodes: document.nodes.map(node => node.id === title.id ? { ...node, text: edit.text } : node)
  });
  assert.deepEqual(updated.nodes.map(node => [node.id, node.parentId]), document.nodes.map(node => [node.id, node.parentId]));
  assert.deepEqual(updated.nodes.find(node => node.id === title.id).childrenRelation, { separatorIndex: 3, operator: 'or', type: 'alternative' });
});

test('relation parsing preserves note text and ignores operators within topics', () => {
  for (const memo of [' [topic:context;purpose] A ; B : C, D;E\nF:G ', 'A;;B\n;C;\nD:E:', 'plain']) {
    assert.equal(gate.parseReviewGateMemo(memo).parts.map(part => part.text).join(''), memo);
  }
  const parsed = gate.parseReviewGateMemo('[topic:context;purpose] A<B');
  assert.deepEqual(parsed.questions.map(q => [q.prompt, q.answer, q.direction]), [['B', 'A', 'reverse']]);
  assert.deepEqual(parsed.questions[0].conditions, ['topic:context;purpose']);
  const forward = gate.parseReviewGateMemo('[topic:context;purpose] A;B');
  assert.deepEqual(forward.questions.map(q => [q.prompt, q.answer, q.direction]), [['A', 'B', 'forward']]);
  // 같은 연결어를 붙여 쓴 `;;`는 칸 하나를 건너뛴다(A와 B는 1번째와 3번째 칸)
  assert.deepEqual(gate.parseReviewGateMemo('A;;B').questions.map(q => [q.kind, q.prompt, q.answer]), [['direct', 'A', 'B']]);
  // 서로 다른 연결어를 붙여 쓴 `:;`는 읽을 수 없다
  assert.ok(gate.parseReviewGateMemo('A:;B').questions.every(q => q.kind === 'recall'));
});

test('toggle titles and child text use the same relation directions', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'A:B', text: 'C<D' }
  ]);
  assert.deepEqual(gate.parseReviewGateMemo(memo).questions.filter(q => ['direct', 'reverse'].includes(q.kind)).map(item => [item.prompt, item.answer]), [
    ['D', 'C'], ['A', 'B'], ['B', 'A']
  ]);
});

test('both relation separators share a positional palette and reset on new lines', () => {
  const text = 'A;B:C;D\nE:F;G';
  const parts = memoColors.splitReviewMemoColonColors(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.colonIndex !== undefined), [
    { text: ';', colonIndex: 0 }, { text: ':', colonIndex: 1 }, { text: ';', colonIndex: 2 },
    { text: ':', colonIndex: 0 }, { text: ';', colonIndex: 1 }
  ]);
});

test('session memo stores one complete bracketed classification without changing its original text', () => {
  const text = '자동차 구조 이해\n[ 대상:구성요소:기능 ]\n밖의 설명:내용';
  assert.deepEqual(sessionMemo.createSessionMemoRecord(text), {
    version: 1, text, classificationCriterion: '대상:구성요소:기능'
  });
});

test('session memo migrates text and updates its single classification on edit and removal', () => {
  const data = new Map([
    [sessionMemo.SESSION_MEMO_KEY, JSON.stringify({ first: '[대상:구성요소:기능] 자동차 구조', other: '[원인:결과] 다른 과목' })]
  ]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const original = sessionMemo.readSessionMemoRecords(storage);
  assert.equal(original.first.classificationCriterion, '대상:구성요소:기능');
  assert.deepEqual(JSON.parse(data.get(sessionMemo.SESSION_MEMO_RECORDS_KEY)), original);
  sessionMemo.writeSessionMemo('first', '[대상;구성요소:기능] 자동차 구조', storage);
  assert.equal(sessionMemo.readSessionMemoRecords(storage).first.classificationCriterion, '대상;구성요소:기능');
  assert.deepEqual(sessionMemo.readSessionMemoRecords(storage).other, original.other);
  sessionMemo.writeSessionMemo('first', 'A:B', storage);
  assert.equal(sessionMemo.readSessionMemoRecords(storage).first.classificationCriterion, null);
  assert.equal(sessionMemo.readSessionMemos(storage).first, 'A:B');
  assert.deepEqual(JSON.parse(data.get(sessionMemo.SESSION_MEMO_KEY)), { first: 'A:B', other: '[원인:결과] 다른 과목' });
  sessionMemo.writeSessionMemo('', '[대상:관점]', storage);
  assert.equal(sessionMemo.readSessionMemoRecords(storage).global.classificationCriterion, '대상:관점');
});

test('structured session memo reload replaces legacy bracket arrays with one criterion and tolerates malformed storage', () => {
  const data = new Map([
    [sessionMemo.SESSION_MEMO_KEY, 'invalid JSON'],
    [sessionMemo.SESSION_MEMO_RECORDS_KEY, JSON.stringify({ first: { version: 1, text: '[대상:구성요소:기능]', bracketContents: ['old', 'other'] } })]
  ]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.equal(sessionMemo.readSessionMemoRecords(storage).first.classificationCriterion, '대상:구성요소:기능');
  const record = JSON.parse(data.get(sessionMemo.SESSION_MEMO_RECORDS_KEY)).first;
  assert.equal(record.classificationCriterion, '대상:구성요소:기능');
  assert.equal(record.bracketContents, undefined);
});

test('one subject classification retains column order and does not combine extra brackets or outside text', () => {
  const text = '[] [대상:구성요소:기능] 추가 메모 [다른:기준]';
  const record = sessionMemo.createSessionMemoRecord(text);
  assert.equal(record.classificationCriterion, '대상:구성요소:기능');
  assert.equal(record.text, text);
  assert.equal(sessionMemo.createSessionMemoRecord('[a:b;c:d]').classificationCriterion, 'a:b;c:d');
  for (const empty of ['', '기준:내용', '[]', '[   ]', '[미완성:기준']) {
    assert.equal(sessionMemo.createSessionMemoRecord(empty).classificationCriterion, null);
  }
});

test('subject classifications stay separate after editing and reloading stored session memos', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  sessionMemo.writeSessionMemo('structure', '[대상:구성요소:기능]', storage);
  sessionMemo.writeSessionMemo('language', '[외국어표기;한국어의미]', storage);
  sessionMemo.writeSessionMemo('structure', '[대상:구성요소:작동원리]', storage);
  const loaded = sessionMemo.readSessionMemoRecords(storage);
  assert.equal(loaded.structure.classificationCriterion, '대상:구성요소:작동원리');
  assert.equal(loaded.language.classificationCriterion, '외국어표기;한국어의미');
  assert.deepEqual(JSON.parse(data.get(sessionMemo.SESSION_MEMO_RECORDS_KEY)), loaded);
});

test('forward and reverse answers keep independent review schedules and retry keys', () => {
  const original = source({ reviewMemo: '[alpha] label: beta', reviewStep: 3, reviewGateLevel: 2 });
  const graded = gate.applyReviewGateOutcomes([original], [{
    ...wrong, wrongQuestionKeys: [reverseKey], completedQuestionKeys: [firstKey, reverseKey]
  }], false, now)[0];
  assert.deepEqual(graded.reviewGatePendingSteps, { [firstKey]: 4, [reverseKey]: 2 });
  const finished = { ...graded, ...gate.completeRegularReviewSchedule(graded, now) };
  assert.deepEqual(gate.getDueReviewGateQuestionKeys(finished, now + 2 * day), [reverseKey]);
  const retry = gate.applyReviewGateOutcomes([original], [{ ...wrong, wrongQuestionKeys: [reverseKey] }], false, now)[0];
  assert.deepEqual(retry.reviewGateRetry.questionKeys, [reverseKey]);
  assert.deepEqual(gate.updateReviewGateMemo(retry, '[alpha] label< beta').reviewGateRetry.questionKeys, [reverseKey], '`<` keeps the reverse question, so its retry stays');
  assert.equal(gate.updateReviewGateMemo(retry, '[alpha] label; beta').reviewGateRetry, undefined, '`;` asks forward only, so the reverse retry is gone');
  assert.equal(gate.updateReviewGateMemo(retry, '[alpha] label: gamma').reviewGateRetry, undefined);
});

test('review memo toggles preserve their title, content and order', () => {
  const blocks = [
    { type: 'text', text: 'plain note' },
    { type: 'toggle', title: 'cell division', text: '[mitosis] result: two cells,' },
    { type: 'toggle', title: 'comparison', text: 'meiosis: four cells,' }
  ];
  const serialized = reviewMemo.serializeReviewMemoBlocks(blocks);
  assert.deepEqual(reviewMemo.parseReviewMemoBlocks(serialized), blocks);
  assert.equal(
    reviewMemo.getReviewMemoPlainText(serialized),
    'plain note\ncell division\n[mitosis] result: two cells,\ncomparison\nmeiosis: four cells,'
  );
  assert.deepEqual(gate.parseReviewGateMemo(serialized).answers, ['two cells', 'four cells']);
});

test('nested toggles round-trip without swallowing siblings and produce clean questions', () => {
  const inner = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'inner', text: 'detail: answer,' },
    { type: 'text', text: 'after inner' }
  ]);
  const blocks = [
    { type: 'toggle', title: 'outer', text: reviewMemo.serializeReviewMemoBlocks([
      { type: 'text', text: 'before' },
      { type: 'toggle', title: 'middle', text: inner },
      { type: 'text', text: 'after middle' }
    ]) },
    { type: 'toggle', title: 'sibling', text: 'other: value,' }
  ];
  const saved = reviewMemo.serializeReviewMemoBlocks(blocks);
  assert.deepEqual(reviewMemo.parseReviewMemoBlocks(saved), blocks);
  assert.equal(reviewMemo.getReviewMemoPlainText(saved), 'outer\nbefore\nmiddle\ninner\ndetail: answer,\nafter inner\nafter middle\nsibling\nother: value,');
  assert.deepEqual(gate.parseReviewGateMemo(saved).answers, ['answer', 'value']);
});

test('moving a toggle under its sibling preserves titles, children, and later siblings', () => {
  const source = { type: 'toggle', title: 'A:X:B', text: reviewMemo.serializeReviewMemoBlocks([
    { type: 'text', text: 'child: answer,' },
    { type: 'toggle', title: 'grandchild:C', text: 'detail' }
  ]) };
  const target = { type: 'toggle', title: 'Target:purpose', text: 'existing' };
  const last = { type: 'toggle', title: 'Last', text: 'untouched' };
  const memo = reviewMemo.serializeReviewMemoBlocks([source, target, last]);
  const moved = reviewMemo.parseReviewMemoBlocks(reviewMemo.moveReviewMemoToggle(memo, [0], [1]));
  assert.equal(moved.length, 2);
  assert.equal(moved[0].title, target.title);
  assert.deepEqual(reviewMemo.parseReviewMemoBlocks(moved[0].text), [
    { type: 'text', text: 'existing' }, source
  ]);
  assert.deepEqual(moved[1], last);
});

test('nested toggles can move across parents or back to an ancestor without duplication', () => {
  const child = { type: 'toggle', title: 'Child:one', text: 'body' };
  const parent = { type: 'toggle', title: 'Parent', text: reviewMemo.serializeReviewMemoBlocks([child]) };
  const memo = reviewMemo.serializeReviewMemoBlocks([parent, { type: 'toggle', title: 'Other', text: '' }]);
  const across = reviewMemo.parseReviewMemoBlocks(reviewMemo.moveReviewMemoToggle(memo, [0, 0], [1]));
  assert.equal(across[0].text, '');
  assert.deepEqual(reviewMemo.parseReviewMemoBlocks(across[1].text), [child]);
  const ancestor = reviewMemo.parseReviewMemoBlocks(reviewMemo.moveReviewMemoToggle(memo, [0, 0], [0]));
  assert.deepEqual(ancestor, reviewMemo.parseReviewMemoBlocks(memo));
});

test('self, descendant, text, and missing drop targets leave a note unchanged', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'Parent', text: reviewMemo.serializeReviewMemoBlocks([
      { type: 'toggle', title: 'Child', text: 'value' }
    ]) },
    { type: 'text', text: 'plain' }
  ]);
  for (const [source, target] of [[[0], [0]], [[0], [0, 0]], [[0], [1]], [[0], [99]], [[99], [0]], [[], [0]]]) {
    assert.equal(reviewMemo.moveReviewMemoToggle(memo, source, target), memo);
  }
});

test('removing a parent toggle promotes its children without flattening descendant toggles', () => {
  const children = [
    { type: 'text', text: 'plain child' },
    { type: 'toggle', title: 'Child:A:B', text: reviewMemo.serializeReviewMemoBlocks([
      { type: 'toggle', title: 'Grandchild:C', text: 'kept' }
    ]) }
  ];
  const parent = { type: 'toggle', title: '', text: reviewMemo.serializeReviewMemoBlocks(children) };
  const unwrapped = reviewMemo.unwrapReviewMemoToggle(parent);
  assert.deepEqual(unwrapped, [{ type: 'text', text: '' }, ...children]);
  assert.deepEqual(reviewMemo.parseReviewMemoBlocks(reviewMemo.serializeReviewMemoBlocks(unwrapped)), children);
});

test('legacy notes migrate with direct parents, sibling order and untouched colon titles', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'A:X:B,C', text: reviewMemo.serializeReviewMemoBlocks([
      { type: 'text', text: 'detail:meaning, alternative' },
      { type: 'toggle', title: 'child:Y:Z', text: 'leaf:answer' }
    ]) },
    { type: 'text', text: 'last' }
  ]);
  const doc = memoDocument.reviewMemoDocumentFromText(memo);
  assert.equal(doc.version, 1);
  assert.equal(memoDocument.isReviewMemoDocument(doc), true);
  const root = doc.nodes[0];
  const child = doc.nodes.find(node => node.text === 'child:Y:Z');
  const leaf = doc.nodes.find(node => node.text === 'leaf:answer');
  assert.equal(root.parentId, null);
  assert.equal(root.text, 'A:X:B,C');
  assert.equal(child.parentId, root.id);
  assert.equal(child.order, 1);
  assert.equal(leaf.parentId, child.id);
  assert.equal(new Set(doc.nodes.map(node => node.id)).size, doc.nodes.length);
  assert.equal(memoDocument.reviewMemoDocumentToText(doc), memo);
  assert.deepEqual(gate.parseReviewGateMemo(memoDocument.reviewMemoDocumentToText(doc)), gate.parseReviewGateMemo(memo));
});

test('note logical operators store commas as AND, and equals signs are relation separators rather than operators', () => {
  const { parseReviewMemoLogicalOperators } = loadSource('utils/reviewMemoLogic.ts');
  assert.deepEqual(parseReviewMemoLogicalOperators('A,B=C,D'), [
    { index: 1, operator: 'and' }, { index: 5, operator: 'and' }
  ]);
  assert.deepEqual(parseReviewMemoLogicalOperators('A:X:B;C'), []);
  assert.deepEqual(parseReviewMemoLogicalOperators(''), []);
});

test('the wave example persists both required-condition separators without changing its text', () => {
  const text = '풍랑의 형성 조건: 풍역대 유지, 해류보다 빠른 평균풍속, 바람 많이 붊';
  const saved = memoDocument.withReviewMemoDocument(source({ reviewMemo: text }));
  const loaded = memoDocument.withReviewMemoDocument(JSON.parse(JSON.stringify(saved)));
  assert.equal(loaded.reviewMemo, text);
  assert.deepEqual(loaded.reviewMemoDocument.nodes[0].logicalOperators, [
    { index: text.indexOf(','), operator: 'and' }, { index: text.lastIndexOf(','), operator: 'and' }
  ]);
  assert.deepEqual(loaded, saved);
  assert.equal(memoDocument.reviewMemoDocumentToText(loaded.reviewMemoDocument), text);
});

test('topics and decimal numbers do not create unintended logical operators', () => {
  const { parseReviewMemoLogicalOperators } = loadSource('utils/reviewMemoLogic.ts');
  const text = '[조건,예외=주제] 값:3.5,큰 값=작은 값';
  assert.deepEqual(parseReviewMemoLogicalOperators(text), [{ index: text.lastIndexOf(','), operator: 'and' }]);
  assert.deepEqual(parseReviewMemoLogicalOperators('값:0.2;9.8'), []);
  const unfinished = '[미완성,=\nA,B=C';
  assert.deepEqual(parseReviewMemoLogicalOperators(unfinished), [{ index: unfinished.lastIndexOf(','), operator: 'and' }]);
});

test('toggle titles and descendants keep independent logical operators and stable parents after reload', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '조건:A,B,C',
    text: reviewMemo.serializeReviewMemoBlocks([{ type: 'text', text: '근거;X,Y,Z' },
      { type: 'toggle', title: '상세:D,E', text: '결론;F,G' }]) }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const loaded = memoDocument.resolveReviewMemoDocument(memo, JSON.parse(JSON.stringify(document)));
  const root = loaded.nodes[0];
  const detail = loaded.nodes.find(node => node.text === '상세:D,E');
  const leaf = loaded.nodes.find(node => node.text === '결론;F,G');
  assert.deepEqual(root.logicalOperators.map(item => item.operator), ['and', 'and']);
  assert.deepEqual(detail.logicalOperators.map(item => item.operator), ['and']);
  assert.deepEqual(leaf.logicalOperators.map(item => item.operator), ['and']);
  assert.equal(detail.parentId, root.id);
  assert.equal(leaf.parentId, detail.id);
  assert.deepEqual(loaded.nodes.map(node => node.id), document.nodes.map(node => node.id));
  assert.equal(memoDocument.resolveReviewMemoDocument(memo, loaded), loaded);
});

test('legacy operator metadata is repaired without rewriting notes, IDs or review statistics', () => {
  const document = { version: 1, nodes: [{ id: 'existing', parentId: null, type: 'text', order: 0,
    text: '조건:A,B=C', logicalOperators: [{ index: 0, operator: 'or' }] }] };
  const original = source({ reviewMemo: document.nodes[0].text, reviewMemoDocument: document,
    reviewQuestionSchedules: { [firstKey]: { reviewStep: 2, nextReviewDate: '2026-12-01T04:00:00Z' } } });
  const loaded = memoDocument.withReviewMemoDocument(original);
  assert.equal(loaded.reviewMemo, original.reviewMemo);
  assert.equal(loaded.reviewMemoDocument.nodes[0].id, 'existing');
  assert.deepEqual(loaded.reviewMemoDocument.nodes[0].logicalOperators, [{ index: 4, operator: 'and' }]);
  assert.deepEqual(document.nodes[0].logicalOperators, [{ index: 0, operator: 'or' }]);
  assert.equal(loaded.reviewQuestionSchedules, original.reviewQuestionSchedules);
  assert.equal(loaded.nextReviewDate, original.nextReviewDate);
  assert.equal(loaded.timeSpentMinutes, original.timeSpentMinutes);
  assert.equal(loaded.pagesRead, original.pagesRead);
  const { logicalOperators, ...legacyNode } = document.nodes[0];
  const legacy = memoDocument.resolveReviewMemoDocument(original.reviewMemo, { version: 1, nodes: [legacyNode] });
  assert.deepEqual(legacy.nodes[0], loaded.reviewMemoDocument.nodes[0]);
});

test('editing and removing a logical separator updates its metadata without replacing the note node', () => {
  const original = memoDocument.reviewMemoDocumentFromText('조건:A,B');
  const extended = memoDocument.resolveReviewMemoDocument('조건:A,B,C', original);
  assert.equal(extended.nodes[0].id, original.nodes[0].id);
  assert.deepEqual(extended.nodes[0].logicalOperators, [{ index: 4, operator: 'and' }, { index: 6, operator: 'and' }]);
  const equals = memoDocument.resolveReviewMemoDocument('조건:A=B', original);
  assert.equal(equals.nodes[0].id, original.nodes[0].id);
  assert.equal(equals.nodes[0].logicalOperators, undefined, 'an equals sign is a relation separator, not an operator');
  const removed = memoDocument.resolveReviewMemoDocument('조건:AB', extended);
  assert.equal(removed.nodes[0].id, original.nodes[0].id);
  assert.equal(removed.nodes[0].logicalOperators, undefined);
  assert.deepEqual(original.nodes[0].logicalOperators, [{ index: 4, operator: 'and' }]);
});

test('a period followed by whitespace is punctuation rather than a logical connector', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['A. B', 'A.\tB', 'A.\nB', 'A.\r\nB', 'A.\u00a0B']) {
    assert.deepEqual(parseReviewMemoSyntax(text).logicalOperators, []);
  }
  assert.deepEqual(parseReviewMemoSyntax('A=B, C').logicalOperators, [{ index: 3, operator: 'and' }]);
});

test('slashes mark independent same-line relations without changing AND or OR connectors', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = 'A:B,C // D:E=F // [주제/설명] G;H';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.relationSeparators, [text.indexOf('//'), text.indexOf('//', text.indexOf('//') + 2)]);
  assert.deepEqual(parsed.logicalOperators, [{ index: text.indexOf(','), operator: 'and' }]);
  const document = memoDocument.reviewMemoDocumentFromText(text);
  assert.deepEqual(document.nodes[0].relationSeparators, parsed.relationSeparators);
  assert.equal(memoDocument.reviewMemoDocumentToText(document), text);
});

test('an empty colon suffix on a toggle makes its children OR-connected alternatives recursively (the diagram reading)', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차:   ',
    text: reviewMemo.serializeReviewMemoBlocks([
      { type: 'text', text: '엔진\n타이어' },
      { type: 'toggle', title: '문:', text: '전기\n가솔린' }
    ]) }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const root = document.nodes[0];
  const components = document.nodes.find(node => node.text === '엔진\n타이어');
  const door = document.nodes.find(node => node.text === '문:');
  const power = document.nodes.find(node => node.text === '전기\n가솔린');
  assert.deepEqual(root.childrenRelation, { separatorIndex: 3, operator: 'or', type: 'alternative' });
  assert.equal(components.parentId, root.id);
  assert.deepEqual(components.logicalOperators, [{ index: 2, operator: 'or' }]);
  assert.equal(door.parentId, root.id);
  assert.deepEqual(door.childrenRelation, { separatorIndex: 1, operator: 'or', type: 'alternative' });
  assert.equal(power.parentId, door.id);
  assert.deepEqual(power.logicalOperators, [{ index: 2, operator: 'or' }]);
  const loaded = memoDocument.resolveReviewMemoDocument(memo, JSON.parse(JSON.stringify(document)));
  assert.deepEqual(loaded, document);
  assert.equal(memoDocument.resolveReviewMemoDocument(memo, loaded), loaded);
  assert.equal(memoDocument.reviewMemoDocumentToText(loaded), memo);
});

test('line breaks are implicit AND only for children of an incomplete toggle relation', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  assert.deepEqual(parseReviewMemoSyntax('A\nB').logicalOperators, []);
  const text = '엔진,타이어\n문';
  assert.deepEqual(parseReviewMemoSyntax(text, true).logicalOperators, [
    { index: text.indexOf(','), operator: 'and' }, { index: text.indexOf('\n'), operator: 'and' }
  ]);
  for (const title of ['자동차:교통수단', '자동차;교통수단', '[자동차:]', '자동차']) {
    const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title, text: '엔진\n타이어' }]);
    const document = memoDocument.reviewMemoDocumentFromText(memo);
    assert.equal(document.nodes[0].childrenRelation, undefined);
    assert.equal(document.nodes[1].logicalOperators, undefined);
  }
  assert.equal(memoDocument.reviewMemoDocumentFromText('자동차:').nodes[0].childrenRelation, undefined);
});

const readLogicalExpression = (text, expression) => {
  if (expression.type === 'text') return text.slice(expression.startIndex, expression.endIndex);
  if (expression.type === 'group') return { group: readLogicalExpression(text, expression.expression) };
  return { [expression.type]: expression.operands.map(item => readLogicalExpression(text, item)) };
};

test('a toggle title ending in a connector links its rows with OR; a , at the very end makes the rows AND', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a;   ', text: 'b\nc' }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  assert.deepEqual(document.nodes[0].childrenRelation, { separatorIndex: 1, operator: 'or', type: 'alternative' }, 'every connector is OR by default');
  assert.deepEqual(document.nodes[1].logicalOperators, [{ index: 1, operator: 'or' }]);
  assert.equal(document.nodes[1].parentId, document.nodes[0].id);
  assert.equal(memoDocument.reviewMemoDocumentToText(document), memo);
  assert.equal(memoDocument.reviewMemoDocumentFromText('a;').nodes[0].childrenRelation, undefined);
  const joined = memoDocument.reviewMemoDocumentFromText(reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a;,', text: 'b\nc' }]));
  assert.deepEqual(joined.nodes[0].childrenRelation, { separatorIndex: 1, operator: 'and', type: 'part' }, 'a , added at the very end makes each row AND');
  assert.deepEqual(joined.nodes[1].logicalOperators, [{ index: 1, operator: 'and' }]);
});

test('nested semicolon and colon toggles retain their own child operators rather than inheriting an ancestor operator', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a;,', text: reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'b:', text: 'c\nd' }, { type: 'text', text: 'e\nf' }
  ]) }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const disjunction = document.nodes.find(node => node.text === 'b:');
  assert.equal(disjunction.childrenRelation.operator, 'or');
  assert.deepEqual(document.nodes.find(node => node.text === 'c\nd').logicalOperators, [{ index: 1, operator: 'or' }]);
  assert.deepEqual(document.nodes.find(node => node.text === 'e\nf').logicalOperators, [{ index: 1, operator: 'and' }]);
});

test('the semicolon example leaves the final period as punctuation', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = 'a; b, c.';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.logicalOperators, [{ index: text.indexOf(','), operator: 'and' }]);
  assert.deepEqual(parsed.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [{ and: ['b', 'c.'] }]);
  const child = 'b, c.';
  assert.deepEqual(parseReviewMemoSyntax(child, 'or').logicalOperators, [{ index: 1, operator: 'and' }]);
  for (const ending of ['a.', 'a; b.', 'a; b.   ', 'a; b./c:d', '[a.]', '[a,b.]']) {
    const result = parseReviewMemoSyntax(ending);
    assert.ok(!result.logicalOperators.some(item => item.index === ending.lastIndexOf('.')), ending);
  }
});

test('square brackets preserve grouped clauses connected by a top-level AND', () => {
  const text = '[a-b-c],[d-e]';
  const document = memoDocument.reviewMemoDocumentFromText(text);
  const node = document.nodes[0];
  assert.deepEqual(node.logicalOperators, [{ index: 7, operator: 'and' }]);
  assert.deepEqual(node.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [{ and: [
    { group: { sequence: ['a', 'b', 'c'] } }, { group: { sequence: ['d', 'e'] } }
  ] }]);
  assert.equal(memoDocument.reviewMemoDocumentToText(document), text);
  assert.deepEqual(node.logicalExpressions[0].operands.map(group => [group.startIndex, group.endIndex]), [[0, 7], [8, 13]]);
});

test('logical groups nest recursively and sequence binds before AND without losing bracket boundaries', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = '[[a-b],[c-d]],[e,f]';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [{ and: [
    { group: { and: [{ group: { sequence: ['a', 'b'] } }, { group: { sequence: ['c', 'd'] } }] } },
    { group: { and: ['e', 'f'] } }
  ] }]);
  assert.deepEqual(parseReviewMemoSyntax('a-b,c-d').logicalExpressions.map(expression => readLogicalExpression('a-b,c-d', expression)), [
    { and: [{ sequence: ['a', 'b'] }, { sequence: ['c', 'd'] }] }
  ]);
});

test('a trailing group period creates no empty alternative and decimals stay numeric values', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['[a,b.]', '[a, b. ]']) {
    const expression = parseReviewMemoSyntax(text).logicalExpressions[0];
    assert.equal(expression.type, 'group');
    assert.deepEqual(readLogicalExpression(text, expression), { group: { and: ['a', 'b.'] } });
    assert.equal(expression.expression.operands.length, 2);
  }
  const text = '[3.5,9.8]';
  assert.deepEqual(parseReviewMemoSyntax(text).logicalExpressions.map(expression => readLogicalExpression(text, expression)), [
    { group: { and: ['3.5', '9.8'] } }
  ]);
});

test('relation columns and slash-separated statements keep their grouped expressions independent', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = 'a;[b-c],[d-e]//f:[g-h]';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.relationSeparators, [text.indexOf('//')]);
  assert.deepEqual(parsed.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [
    { and: [{ group: { sequence: ['b', 'c'] } }, { group: { sequence: ['d', 'e'] } }] }, { group: { sequence: ['g', 'h'] } }
  ]);
  const child = 'a:b\nc:d';
  const inherited = parseReviewMemoSyntax(child, 'or');
  assert.deepEqual(inherited.logicalOperators, [{ index: 3, operator: 'or' }]);
  assert.deepEqual(inherited.logicalExpressions, []);
});

test('editing an OR parent to AND or plain text repairs inherited operators without replacing any note IDs', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a:', text: 'b\nc' }]);
  const original = memoDocument.reviewMemoDocumentFromText(memo);
  const conjunction = memoDocument.resolveReviewMemoDocument(memo.replace('a:', 'a:,'), original);
  assert.equal(conjunction.nodes[0].childrenRelation.operator, 'and');
  assert.deepEqual(conjunction.nodes[1].logicalOperators, [{ index: 1, operator: 'and' }]);
  const plain = memoDocument.resolveReviewMemoDocument(memo.replace('a:', 'a'), conjunction);
  assert.equal(plain.nodes[0].childrenRelation, undefined);
  assert.equal(plain.nodes[1].logicalOperators, undefined);
  assert.equal(plain.nodes[1].logicalExpressions, undefined);
  assert.deepEqual(plain.nodes.map(node => [node.id, node.parentId]), original.nodes.map(node => [node.id, node.parentId]));
});

test('nested logic metadata survives persistence and legacy repair without changing study or review history', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a; ', text: '[b=c],[d=e]' }]);
  const saved = memoDocument.withReviewMemoDocument(source({ reviewMemo: memo }));
  const loaded = memoDocument.withReviewMemoDocument(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(loaded, saved);
  assert.equal(memoDocument.resolveReviewMemoDocument(memo, loaded.reviewMemoDocument), loaded.reviewMemoDocument);
  const stale = { ...saved, reviewMemoDocument: { ...saved.reviewMemoDocument, nodes: saved.reviewMemoDocument.nodes.map(node => ({
    ...node, logicalExpressions: [{ type: 'text', startIndex: 0, endIndex: 1 }]
  })) } };
  const repaired = memoDocument.withReviewMemoDocument(stale);
  assert.deepEqual(repaired, saved);
  assert.equal(repaired.pagesRead, saved.pagesRead);
  assert.equal(repaired.timeSpentMinutes, saved.timeSpentMinutes);
  assert.equal(repaired.nextReviewDate, saved.nextReviewDate);
  assert.equal(repaired.reviewStep, saved.reviewStep);
});

test('editing brackets clears stale grouping metadata and retains raw unfinished text', () => {
  const original = memoDocument.reviewMemoDocumentFromText('[a,b],[c,d]');
  const plain = memoDocument.resolveReviewMemoDocument('ab cd', original);
  assert.equal(plain.nodes[0].logicalExpressions, undefined);
  assert.equal(plain.nodes[0].logicalOperators, undefined);
  assert.equal(plain.nodes[0].id, original.nodes[0].id);
  const text = '[a,b\nc;d,e';
  const unfinished = memoDocument.resolveReviewMemoDocument(text, plain);
  assert.equal(memoDocument.reviewMemoDocumentToText(unfinished), text);
  assert.deepEqual(unfinished.nodes[0].logicalOperators, [{ index: text.lastIndexOf(','), operator: 'and' }]);
});

test('moving a toggle preserves its nested part relationship and all node identities', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: '자동차:', text: reviewMemo.serializeReviewMemoBlocks([
      { type: 'toggle', title: '엔진:', text: '전기\n가솔린' }
    ]) },
    { type: 'toggle', title: '다른 설명', text: '' }
  ]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const source = document.nodes.find(node => node.text === '엔진:');
  const destination = document.nodes.find(node => node.text === '다른 설명');
  const moved = memoDocument.moveReviewMemoNode(document, source.id, destination.id);
  const updated = moved.nodes.find(node => node.id === source.id);
  assert.equal(updated.parentId, destination.id);
  assert.equal(updated.logicalOperators, undefined);
  assert.deepEqual(updated.childrenRelation, { separatorIndex: 2, operator: 'or', type: 'alternative' });
  assert.deepEqual(moved.nodes.find(node => node.parentId === source.id).logicalOperators, [{ index: 2, operator: 'or' }]);
  assert.deepEqual(moved.nodes.map(node => node.id), document.nodes.map(node => node.id));
});

test('removing a parent keeps its children but clears the removed parent implicit AND context', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차:', text: '엔진\n타이어,문' }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const parentId = document.nodes[0].id;
  const child = document.nodes[1];
  const promoted = memoDocument.withReviewMemoLogicalOperators({ version: 1,
    nodes: document.nodes.filter(node => node.id !== parentId).map(node => ({ ...node, parentId: null })) });
  assert.equal(promoted.nodes[0].id, child.id);
  assert.equal(promoted.nodes[0].text, child.text);
  assert.deepEqual(promoted.nodes[0].logicalOperators, [{ index: child.text.indexOf(','), operator: 'and' }]);
});

test('editing a parent colon or a slash removes stale relation metadata without changing child IDs', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차:', text: '엔진\n타이어 // 문:전기,가솔린' }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const changedText = memo.replace('자동차:', '자동차:교통수단').replace(' // ', ' ');
  const changed = memoDocument.resolveReviewMemoDocument(changedText, document);
  assert.deepEqual(changed.nodes.map(node => node.id), document.nodes.map(node => node.id));
  assert.equal(changed.nodes[0].childrenRelation, undefined);
  assert.equal(changed.nodes[1].relationSeparators, undefined);
  assert.deepEqual(changed.nodes[1].logicalOperators, [{ index: changed.nodes[1].text.indexOf(','), operator: 'and' }]);
  const repaired = memoDocument.withReviewMemoLogicalOperators({ ...changed,
    nodes: changed.nodes.map((node, index) => ({ ...node, childrenRelation: document.nodes[index].childrenRelation,
      relationSeparators: document.nodes[index].relationSeparators, logicalOperators: document.nodes[index].logicalOperators })) });
  assert.deepEqual(repaired, changed);
});

test('JSON persistence and repeated loads keep every node identity', () => {
  const migrated = memoDocument.withReviewMemoDocument(source({ reviewMemo: 'first:one\nsecond:two' }));
  const loaded = memoDocument.withReviewMemoDocument(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(loaded, migrated);
  assert.equal(memoDocument.resolveReviewMemoDocument(loaded.reviewMemo, loaded.reviewMemoDocument), loaded.reviewMemoDocument);
  const withoutText = memoDocument.withReviewMemoDocument({ ...loaded, reviewMemo: undefined });
  assert.deepEqual(withoutText, loaded);
});

test('legacy text edits retain matching sibling and descendant identities', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'one:A:B', text: 'detail:one' },
    { type: 'toggle', title: 'two:C:D', text: 'detail:two' }
  ]);
  const old = memoDocument.reviewMemoDocumentFromText(memo);
  const changed = memoDocument.resolveReviewMemoDocument(memo.replace('one:A:B', 'changed:A:B').replace('detail:one', 'detail:updated'), old);
  assert.deepEqual(changed.nodes.map(node => node.id), old.nodes.map(node => node.id));
  const reordered = memoDocument.reviewMemoDocumentFromText(reviewMemo.serializeReviewMemoBlocks(reviewMemo.parseReviewMemoBlocks(memo).reverse()), old);
  assert.equal(memoDocument.getReviewMemoChildren(reordered)[0].id, memoDocument.getReviewMemoChildren(old)[1].id);
});

test('ID-based moves preserve all IDs and descendants and reject hierarchy cycles', () => {
  const doc = memoDocument.reviewMemoDocumentFromText(reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'source', text: reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'child', text: 'leaf' }]) },
    { type: 'toggle', title: 'target', text: 'existing' }
  ]));
  const source = doc.nodes.find(node => node.text === 'source');
  const child = doc.nodes.find(node => node.text === 'child');
  const target = doc.nodes.find(node => node.text === 'target');
  assert.equal(memoDocument.moveReviewMemoNode(doc, source.id, child.id), doc);
  assert.equal(memoDocument.moveReviewMemoNode(doc, source.id, source.id), doc);
  const moved = memoDocument.moveReviewMemoNode(doc, source.id, target.id);
  assert.equal(memoDocument.isReviewMemoDocument(moved), true);
  assert.deepEqual(moved.nodes.map(node => node.id), doc.nodes.map(node => node.id));
  assert.equal(moved.nodes.find(node => node.id === source.id).parentId, target.id);
  assert.equal(moved.nodes.find(node => node.id === child.id).parentId, source.id);
  assert.equal(doc.nodes.find(node => node.id === source.id).parentId, null);
  const subtree = memoDocument.getReviewMemoSubdocument(moved, target.id);
  assert.equal(memoDocument.isReviewMemoDocument(subtree), true);
  assert.equal(subtree.nodes.find(node => node.id === source.id).parentId, null);
});

test('structured blank paragraphs and empty toggle titles survive save and reload', () => {
  const doc = { version: 1, nodes: [
    { id: 'a', type: 'text', text: '', parentId: null, order: 0 },
    { id: 'b', type: 'toggle', text: '', parentId: null, order: 1 },
    { id: 'c', type: 'text', text: '', parentId: 'b', order: 0 }
  ] };
  const memo = memoDocument.reviewMemoDocumentToText(doc);
  assert.deepEqual(memoDocument.resolveReviewMemoDocument(memo, JSON.parse(JSON.stringify(doc))), doc);
});

test('invalid documents fall back to legacy text without losing the note', () => {
  const node = { id: 'a', parentId: null, type: 'toggle', text: 'note', order: 0 };
  for (const nodes of [
    [node, node], [{ ...node, parentId: 'missing' }], [{ ...node, parentId: 'a' }],
    [node, { ...node, id: 'b', type: 'text' }, { ...node, id: 'c', parentId: 'b' }],
    [{ ...node, parentId: 'b' }, { ...node, id: 'b', parentId: 'a' }]
  ]) {
    const invalid = { version: 1, nodes };
    assert.equal(memoDocument.isReviewMemoDocument(invalid), false);
    const repaired = memoDocument.resolveReviewMemoDocument('safe:original', invalid);
    assert.equal(memoDocument.isReviewMemoDocument(repaired), true);
    assert.equal(memoDocument.reviewMemoDocumentToText(repaired), 'safe:original');
  }
});

test('note-only structural changes save documents without advancing review schedules', () => {
  const log = memoDocument.withReviewMemoDocument(source());
  const document = { ...log.reviewMemoDocument, nodes: [...log.reviewMemoDocument.nodes] };
  const edited = gate.updateReviewGateMemo(log, log.reviewMemo, document);
  assert.equal(edited.reviewMemoDocument, document);
  assert.equal(edited.reviewStep, log.reviewStep);
  assert.equal(edited.nextReviewDate, log.nextReviewDate);
  assert.equal(edited.timeSpentMinutes, log.timeSpentMinutes);
});

test('a wrong answer lowers one step and schedules only the wrong items', () => {
  const expectedIntervals = [2 * hour, 2 * hour, day, 2 * day, 4 * day, 8 * day, 16 * day];
  expectedIntervals.forEach((expectedInterval, step) => {
    const log = withRetry({ reviewStep: step });
    assert.equal(log.reviewGateRetry.intervalMs, expectedInterval);
    assert.equal(Date.parse(log.reviewGateRetry.dueAt), now + expectedInterval);
    assert.equal(log.reviewGateRetry.reviewStep, Math.max(0, step - 1));
    assert.equal(log.reviewGatePendingResult, 'wrong');
  });
});

test('only wrong items get a retry', () => {
  const logs = [source(), source({ id: 'note-b' }), source({ id: 'empty', reviewMemo: ' ' })];
  const results = gate.applyReviewGateOutcomes(logs, [wrong, { ...right, logId: 'note-b' }], false, now);
  assert.ok(results[0].reviewGateRetry);
  assert.deepEqual(results[0].reviewGateRetry.questionKeys, [firstKey]);
  assert.equal(results[1].reviewGateRetry, undefined);
  assert.equal(results[2], logs[2]);
  assert.equal(logs[0].reviewGateRetry, undefined);
  assert.equal(results.length, logs.length);
});

test('scheduling retry leaves original dates, study totals and review records untouched', () => {
  const original = source({
    basicReviewTimeRecords: [{ pages: 4, minutes: 5, reviewNumber: 1, timestamp: new Date(now).toISOString() }],
    reviewSubjectTimeRecords: [{ subjectId: 'practice', pages: 4, minutes: 10, timestamp: new Date(now).toISOString() }]
  });
  const result = gate.applyReviewGateOutcomes([original], [wrong], false, now)[0];
  assert.deepEqual(withoutGateState(result), original);
});

test('pending retry is not duplicated or postponed by another normal attempt', () => {
  const log = withRetry();
  const again = gate.applyReviewGateOutcomes([log], [wrong, wrong], false, now + second);
  assert.equal(again.length, 1);
  assert.equal(again[0], log);
});

test('due boundary, deduplication and refresh persistence', () => {
  const saved = JSON.parse(JSON.stringify([withRetry()]));
  assert.deepEqual(gate.getDueReviewGateRetries(saved, now + 2 * hour - 1), []);
  assert.equal(gate.getDueReviewGateRetries([...saved, ...saved], now + 2 * hour).length, 1);
  assert.equal(gate.getDueReviewGateRetries([source({ reviewGateRetry: { dueAt: 'invalid' } })], now).length, 0);
});

test('retry failure lowers the retry step and keeps regular study statistics untouched', () => {
  const log = { ...withRetry(), reviewStep: 4, nextReviewDate: new Date(now + 14 * day).toISOString() };
  const failedAt = now + 2 * hour;
  const again = gate.applyReviewGateOutcomes([log], [wrong], true, failedAt)[0];
  assert.equal(again.reviewGateRetry.intervalMs, 2 * hour);
  assert.equal(again.reviewGateRetry.dueAt, new Date(failedAt + 2 * hour).toISOString());
  assert.equal(again.reviewStep, log.reviewStep);
  assert.equal(again.nextReviewDate, log.nextReviewDate);
  assert.deepEqual(again.basicReviewTimeRecords, log.basicReviewTimeRecords);
  assert.deepEqual(again.reviewSubjectTimeRecords, log.reviewSubjectTimeRecords);
});

test('retry success clears only the retry and preserves the regular schedule', () => {
  const log = { ...withRetry(), reviewStep: 2 };
  const result = gate.applyReviewGateOutcomes([log], [right], true, now + 3 * hour)[0];
  assert.equal(result.reviewGateRetry, undefined);
  assert.equal(result.reviewStep, log.reviewStep);
  assert.equal(result.nextReviewDate, log.nextReviewDate);
  assert.equal(result.timeSpentMinutes, log.timeSpentMinutes);
  assert.equal(gate.applyReviewGateOutcomes([result], [right], true, now)[0], result);
});

test('passing a regular gate marks one upward step and clears an already pending retry', () => {
  const result = gate.applyReviewGateOutcomes([withRetry()], [right], false, now)[0];
  assert.equal(result.reviewGateRetry, undefined);
  assert.equal(result.reviewGatePendingResult, 'correct');
});

test('editing an answer retires the stale retry instead of applying its score to unrelated content', () => {
  const log = withRetry();
  const edited = gate.updateReviewGateMemo(log, '[topic] label: changed answer');
  assert.equal(edited.reviewMemo, '[topic] label: changed answer');
  assert.equal(edited.reviewGateRetry, undefined);
  assert.equal(edited.nextReviewDate, log.nextReviewDate);
  assert.equal(gate.updateReviewGateMemo(edited, edited.reviewMemo), edited);
  assert.equal(gate.updateReviewGateMemo(edited, ' ').reviewGateRetry, undefined);
  assert.equal(gate.updateReviewGateMemo(edited, 'plain recall note').reviewGateRetry, undefined);
});

test('legacy retries narrow errors without changing the regular cycle', () => {
  const first = gate.applyReviewGateOutcomes(
    [source({ reviewStep: 3 })],
    [{ logId: 'note-a', passed: false, wrongQuestionKeys: [firstKey, secondKey] }],
    false,
    now
  )[0];
  const narrowed = gate.applyReviewGateOutcomes(
    [first],
    [{ logId: 'note-a', passed: false, wrongQuestionKeys: [secondKey] }],
    true,
    now + 2 * day
  )[0];
  assert.equal(first.reviewGateRetry.reviewStep, 2);
  assert.deepEqual(narrowed.reviewGateRetry.questionKeys, [secondKey]);
  assert.equal(narrowed.reviewStep, first.reviewStep);
  assert.equal(narrowed.reviewGateRetry.reviewStep, 1);
  assert.equal(narrowed.reviewGateRetry.intervalMs, day);

  const cleared = gate.applyReviewGateOutcomes(
    [narrowed],
    [right],
    true,
    now + 3 * day
  )[0];
  assert.equal(cleared.reviewGateRetry, undefined);
  assert.equal(cleared.reviewStep, first.reviewStep);
  assert.equal(cleared.nextReviewDate, first.nextReviewDate);
});

test('condensing retry does not condense original review or alter its statistics', () => {
  const log = withRetry();
  const other = withRetry({ id: 'note-b' });
  const result = gate.clearReviewGateRetries([log, other], [log.id]);
  assert.deepEqual(withoutGateState(result[0]), withoutGateState(log));
  assert.equal(result[0].reviewGateRetry, undefined);
  assert.equal(result[1], other);
});

test('a pending retry does not hide the unfinished linked review subject', () => {
  const log = withRetry();
  const groups = buildDueReviewGroups([log], subjects, now + 2 * hour);
  const retry = groups.find(group => group.isGateRetry);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(group => !group.isGateRetry).subjectId, 'practice');
  assert.equal(retry.reviewType, 'basic');
  assert.equal(retry.subjectId, 'main');
  assert.deepEqual(retry.reviewSubjectIds, []);
});

test('handling the regular review still leaves its due retry visible', () => {
  const groups = buildDueReviewGroups([withRetry()], subjects, now + 2 * hour, new Set(['note-a']));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].isGateRetry, true);
});

test('same-subject retries combine, different subjects stay separate, and each interval is retained', () => {
  const logs = gate.applyReviewGateOutcomes([
    source(), source({ id: 'note-b', reviewStep: 4, startPage: 5, endPage: 8 }),
    source({ id: 'note-c', subjectId: 'other' })
  ], [wrong, { ...wrong, logId: 'note-b' }, { ...wrong, logId: 'note-c' }], false, now);
  const withOther = [...subjects, { ...subjects[0], id: 'other', name: 'Other' }];
  const early = buildDueReviewGroups(logs, withOther, now + 2 * hour).filter(group => group.isGateRetry);
  assert.equal(early.length, 2);
  assert.equal(early.find(group => group.subjectId === 'main').logs.length, 1);
  const later = buildDueReviewGroups(logs, withOther, now + 14 * day).filter(group => group.isGateRetry);
  assert.equal(later.length, 2);
  assert.deepEqual(later.find(group => group.subjectId === 'main').logs.map(log => log.id), ['note-a', 'note-b']);
  const retried = gate.applyReviewGateOutcomes(logs, [wrong, { ...wrong, logId: 'note-b' }], true, now + 14 * day);
  assert.equal(Date.parse(retried[0].reviewGateRetry.dueAt), now + 14 * day + 2 * hour);
  assert.equal(Date.parse(retried[1].reviewGateRetry.dueAt), now + 16 * day);
});

test('linked review subjects merge only matching sequences and contiguous page ranges', () => {
  const linkedSubjects = [
    { ...subjects[0], reviewSubjectIds: ['practice', 'practice-b'] },
    subjects[1],
    { ...subjects[1], id: 'practice-b', name: 'Practice B' }
  ];
  const dueLogs = [
    source({ id: 'range-a', startPage: 1, endPage: 2, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'] }),
    source({ id: 'range-b', startPage: 3, endPage: 4, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'] }),
    source({ id: 'range-gap', startPage: 7, endPage: 8, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'] }),
    source({ id: 'different-sequence', startPage: 5, endPage: 6, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice'] }),
    source({ id: 'different-subject', startPage: 9, endPage: 10, pagesRead: 2, reviewSubjectIdsSnapshot: ['practice', 'practice-b'], reviewSubjectId: 'practice-b' })
  ];
  const groups = buildDueReviewGroups(dueLogs, linkedSubjects, now).filter(group => !group.isGateRetry);
  const practiceGroups = groups.filter(group => group.subjectId === 'practice');
  const practiceBGroups = groups.filter(group => group.subjectId === 'practice-b');

  assert.equal(practiceGroups.length, 3);
  assert.deepEqual(
    practiceGroups.map(group => group.logs.map(log => log.id)).sort((a, b) => a[0].localeCompare(b[0])),
    [['different-sequence'], ['range-a', 'range-b'], ['range-gap']]
  );
  assert.equal(practiceBGroups.length, 1);
  assert.deepEqual(practiceBGroups[0].logs.map(log => log.id), ['different-subject']);
});

test('an empty historical review-subject snapshot uses the subjects linked now', () => {
  const groups = buildDueReviewGroups([
    source({ reviewSubjectIdsSnapshot: [] })
  ], subjects, now).filter(group => !group.isGateRetry);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reviewType, 'subject');
  assert.equal(groups[0].subjectId, 'practice');
  assert.deepEqual(groups[0].reviewSubjectIds, ['practice']);
});

test('one initial error lowers only that question even after immediate correction', () => {
  const original = source({ reviewStep: 3, reviewMemo: '[alpha] label< beta // other< gamma' });
  // `<`는 거꾸로 문제만 낸다: 두 줄이 각각 역방향 문제 하나씩이다.
  const [firstKey, secondKey] = gate.getReviewGateQuestionKeys(original.reviewMemo);
  const wrong = { logId: 'note-a', passed: false, wrongQuestionKeys: [firstKey] };
  const right = { logId: 'note-a', passed: true, wrongQuestionKeys: [] };
  const graded = gate.applyReviewGateOutcomes([original], [{
    ...wrong, completedQuestionKeys: [firstKey, secondKey]
  }], false, now)[0];
  assert.deepEqual(graded.reviewGatePendingSteps, { [firstKey]: 2, [secondKey]: 4 });
  assert.equal(graded.reviewStep, 3);
  assert.equal(graded.nextReviewDate, original.nextReviewDate);
  assert.equal(graded.reviewGateRetry, undefined);
  const finished = { ...graded, ...gate.completeRegularReviewSchedule(graded, now) };
  assert.equal(finished.reviewStep, 4);
  assert.equal(finished.reviewQuestionSchedules[firstKey].nextReviewDate, new Date(now + 2 * day).toISOString());
  assert.equal(finished.reviewQuestionSchedules[secondKey].nextReviewDate, new Date(now + 8 * day).toISOString());
  assert.deepEqual(gate.getDueReviewGateQuestionKeys(finished, now + 2 * day - 1), []);
  assert.deepEqual(gate.getDueReviewGateQuestionKeys(finished, now + 2 * day), [firstKey]);
  const nextGate = gate.applyReviewGateOutcomes([finished], [{
    ...right, completedQuestionKeys: [firstKey]
  }], false, now + 2 * day)[0];
  const nextFinished = { ...nextGate, ...gate.completeRegularReviewSchedule(nextGate, now + 2 * day) };
  assert.deepEqual(nextFinished.reviewQuestionSchedules[secondKey], finished.reviewQuestionSchedules[secondKey]);
  assert.equal(nextFinished.reviewQuestionSchedules[firstKey].nextReviewDate, new Date(now + 6 * day).toISOString());
});

test('new and already-gated logs stay separate so resume cannot skip new questions', () => {
  const grouped = buildDueReviewGroups([
    source({ id: 'started', reviewGatePendingSteps: { [firstKey]: 1 }, startPage: 1, endPage: 2 }),
    source({ id: 'unstarted', startPage: 3, endPage: 4 })
  ], subjects, now);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.map(group => group.logs.length), [1, 1]);
});

test('finishing a regular review preserves existing additional review dates', () => {
  const original = withRetry({ reviewStep: 3 });
  const completed = { ...original, ...gate.completeRegularReviewSchedule(original, now) };
  assert.deepEqual(completed.reviewGateRetry, original.reviewGateRetry);
  const retryCompleted = gate.applyReviewGateOutcomes([completed], [{
    ...wrong, completedQuestionKeys: [firstKey]
  }], true, now + day)[0];
  assert.equal(retryCompleted.nextReviewDate, completed.nextReviewDate);
  assert.equal(retryCompleted.reviewStep, completed.reviewStep);
  assert.deepEqual(retryCompleted.reviewQuestionSchedules, completed.reviewQuestionSchedules);
  assert.equal(retryCompleted.reviewGateRetry, undefined);
});

const questionBuilder = loadSource('utils/reviewQuestions.ts');
const practice = loadSource('utils/reviewPractice.ts');
const noteSummary = loadSource('components/ReviewNoteSummary.tsx');
const questionsFor = memo => questionBuilder.buildReviewQuestions(memo).questions;
const catalogFor = memo => questionsFor(memo).map(q => ({ ...q, id: q.key, logId: 'note-a' }));

test('session classification maps each local relation column and reverses its prompt and answer labels', () => {
  const questions = questionsFor('a:b:c');
  const classify = question => questionBuilder.getReviewQuestionClassification('대상:설명:예시', question);
  const second = questions.find(q => q.kind === 'direct' && q.prompt === 'b');
  assert.deepEqual(classify(second), { prompt: ['설명'], answer: ['예시'], conditions: [] });
  const reverse = questions.find(q => q.kind === 'reverse' && q.prompt === 'b');
  assert.deepEqual(classify(reverse), { prompt: ['설명'], answer: ['대상'], conditions: [] });
  assert.deepEqual(classify(questions.find(q => q.kind === 'reconstruct')).answer, ['설명', '예시']);
});

test('brace overrides replace one field classification without consuming the next session column', () => {
  const memo = '해파:{원인} 바람,중력 : 파도의 파동';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:정의', q);
  const first = questions.find(q => q.kind === 'direct' && q.prompt === '해파');
  const next = questions.find(q => q.kind === 'direct' && q.answer === '파도의 파동');
  assert.equal(first.answer, '바람 AND 중력');
  assert.deepEqual(classify(first), { prompt: ['개념'], answer: ['원인'], conditions: [] });
  assert.deepEqual(classify(next), { prompt: ['원인'], answer: ['정의'], conditions: [] });
  assert.deepEqual(classify(questions.find(q => q.kind === 'reverse' && q.prompt === '바람 AND 중력')), {
    prompt: ['원인'], answer: ['개념'], conditions: []
  });
  assert.deepEqual(classify(questions.find(q => q.kind === 'reconstruct')).answer, ['원인', '정의']);
  for (const q of questions) assert.ok(![q.prompt, q.answer, ...q.conditions].some(text => /[{}]/.test(text)));
  assert.ok(first.priority < next.priority);
  assert.equal(gate.parseReviewGateMemo(memo).parts.map(part => part.text).join(''), memo);
});

test('exception colons and their label punctuation remain uncolored and do not advance the palette', () => {
  const text = 'a:{원인} b:c // x:[y:{구체:원인/조건,[추가]}z:q]:r';
  const parts = memoColors.splitReviewMemoColonColors(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.colonIndex !== undefined).map(part => part.colonIndex), [0, 0, 0, 1]);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MemoColorTextarea } = loadSource('components/MemoColorTextarea.tsx');
  const html = renderToStaticMarkup(React.createElement(MemoColorTextarea, { value: 'a:{원인}b:c', colorColons: true, onChange() {} }));
  assert.equal((html.match(/data-colon-index/g) || []).length, 1);
  assert.match(html, /data-colon-index="1"/);
});

test('multiple overrides keep their own labels while ordinary and nested columns retain their positions', () => {
  const memo = 'a:{원인}b:{결과}c:d // x:[y:{방법}z:q]:r';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:정의:예시', q);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'b')), {
    prompt: ['원인'], answer: ['결과'], conditions: []
  });
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'c')), {
    prompt: ['결과'], answer: ['정의'], conditions: []
  });
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'z')), {
    prompt: ['방법'], answer: ['정의'], conditions: [['개념']]
  });
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.answer === 'r')).answer, ['예시']);
});

test('override labels stay metadata even when containing relation and logic delimiters', () => {
  const memo = 'a:{원인:조건/설명,[분류]=관점-세부} b,c:d';
  const built = questionBuilder.buildReviewQuestions(memo);
  const first = built.questions.find(q => q.kind === 'direct' && q.prompt === 'a');
  assert.equal(first.answer, 'b AND c');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의', first).answer, ['원인:조건/설명,[분류]=관점-세부']);
  assert.ok(!built.questions.some(q => q.prompt.includes('원인') || q.answer.includes('원인')));
  const syntax = loadSource('utils/reviewMemoLogic.ts').parseReviewMemoSyntax(memo);
  assert.deepEqual(syntax.relationSeparators, []);
  assert.deepEqual(syntax.logicalOperators.map(op => [memo[op.index], op.operator]), [[',', 'and']]);
  assert.deepEqual(syntax.logicalExpressions.map(expression => readLogicalExpression(memo, expression)), [{ and: ['b', 'c'] }]);
});

test('toggle children, partial conditions and sequence questions inherit their custom field label', () => {
  const memo = ':::toggle a;{구성},\nb\nc\n:::end';
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const parent = document.nodes.find(node => node.type === 'toggle');
  assert.deepEqual(parent.childrenRelation, { separatorIndex: 1, operator: 'and', type: 'part' });
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:정의', q);
  const questions = questionsFor(memo);
  assert.equal(questions.find(q => q.kind === 'direct').answer, 'b AND c');
  const partial = questions.find(q => q.kind === 'remaining');
  assert.deepEqual(classify(partial).answer, ['구성']);
  assert.deepEqual(classify(partial).conditions, [['구성']]);
  const sequence = questionsFor('a:{과정}읽기-정리-확인').find(q => q.kind === 'order-next');
  assert.deepEqual(classify(sequence), { prompt: ['과정'], answer: ['과정'], conditions: [['개념']] });
  const descendant = questionsFor(':::toggle a:{설명} b:\nc:d\n:::end').find(q => q.kind === 'direct' && q.prompt === 'c');
  assert.deepEqual(classify(descendant).conditions, [['개념', '설명']]);
  assert.ok(!descendant.conditions[0].includes('{'));
});

test('custom labels work without a session memo and never become masked answers', () => {
  const memo = 'a:{원인} b';
  const built = questionBuilder.buildReviewQuestions(memo);
  const direct = built.questions.find(q => q.kind === 'direct');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification(null, direct), { prompt: [], answer: ['원인'], conditions: [] });
  assert.deepEqual(noteSummary.getMaskedNoteSpans(built.questions, new Set([direct.key])).map(span => memo.slice(span.start, span.end)), ['b']);
  assert.deepEqual([direct.recallUnits, direct.providedUnits], [1, 1]);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const hidden = inStyle('flash', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question: direct, criterion: '개념:정의', revealed: false })));
  const answerField = hidden.match(/data-question-field="answer"[\s\S]*?<\/div>/)[0];
  assert.ok(answerField.includes('원인') && !hidden.includes('{원인}') && !answerField.includes('정의'));
  assert.ok(!hidden.includes('>b<'));
  // 줄글에서는 맞힐 속성이 문장 안에 있다
  const prose = inStyle('prose', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question: direct, criterion: '개념:정의', revealed: false })));
  assert.ok(prose.includes('‘a’에 이어지는 원인 값은?') && !prose.includes('{원인}') && !prose.includes('>b<'));
});

test('empty, unfinished, misplaced and multiline braces do not corrupt ordinary note text', () => {
  const empty = questionsFor('a:{} b:c').find(q => q.kind === 'direct' && q.prompt === 'a');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의', empty).answer, []);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('a:{} b:c').filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0]);
  for (const memo of ['a:{미완성', 'a;{원인} b', 'a<{원인} b', 'a:b {원인}', 'a:{원인\nb:c']) {
    assert.equal(gate.parseReviewGateMemo(memo).parts.map(p => p.text).join(''), memo);
    assert.equal(memoColors.splitReviewMemoColonColors(memo).map(p => p.text).join(''), memo);
  }
  const reversed = questionsFor('a<{원인} b')[0];
  assert.deepEqual([reversed.prompt, reversed.answer, reversed.direction], ['b', 'a', 'reverse'], '`<` reads the override too, and asks only the reverse');
  const forward = questionsFor('a;{원인} b')[0];
  assert.deepEqual([forward.prompt, forward.answer, forward.direction], ['a', 'b', 'forward'], '`;` reads the override too, and asks only forward');
  assert.equal(questionsFor('a:b {원인}').find(q => q.kind === 'direct').answer, 'b {원인}');
});

test('annotated notes persist without rewriting raw text or changing semantic question keys on label edits', () => {
  const memo = 'a:{원인} b,c:d';
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const restored = memoDocument.resolveReviewMemoDocument(memo, JSON.parse(JSON.stringify(document)));
  assert.deepEqual(restored, document);
  assert.equal(memoDocument.reviewMemoDocumentToText(restored), memo);
  assert.deepEqual(questionsFor(memo.replace('{원인}', '{조건}')).map(q => q.key), questionsFor(memo).map(q => q.key));
  assert.deepEqual(questionsFor(memo).map(q => q.key), questionsFor('a: b,c:d').map(q => q.key));
});

test('a parent toggle custom slot is inherited by child colon and semicolon fields without consuming session columns', () => {
  const memo = ':::toggle A:{B}C:D\nG:H<J\n:::end';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  const first = questions.find(q => q.kind === 'direct' && q.prompt === 'G');
  const next = questions.find(q => q.kind === 'reverse' && q.prompt === 'J');
  assert.deepEqual(classify(first), { prompt: ['개념'], answer: ['B'], conditions: [['개념', 'B', '원인']] });
  assert.deepEqual(classify(next), { prompt: ['원인'], answer: ['B'], conditions: [['개념', 'B', '원인']] });
  assert.deepEqual(classify(questions.find(q => q.kind === 'reverse' && q.prompt === 'H')).answer, ['개념']);
  assert.ok(!questions.some(q => q.kind === 'direct' && q.prompt === 'H'), 'H<J is the reverse relation: it never asks forward');
  const back = classify(questions.find(q => q.kind === 'far' && q.prompt === 'J' && q.answer === 'G'));
  assert.deepEqual([back.prompt, back.answer], [['원인'], ['개념']], 'J reaches G backwards through both separators');
  assert.ok(!questions.some(q => q.kind === 'reconstruct' && q.prompt === 'G'), 'a row with a "<-" step has no forward reconstruction');
  assert.ok(questions.every(q => ![q.prompt, q.answer, ...q.conditions].some(text => /[{}]/.test(text))));
});

test('semicolon annotations share override parsing, literal preservation, OR children and reverse-only questions', () => {
  const memo = 'a<{원인:조건/구분,[보충]} b,c<d';
  const questions = questionsFor(memo);
  const first = questions.find(q => q.kind === 'reverse' && q.answer === 'a');
  assert.equal(first.prompt, 'b AND c');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의', first), { prompt: ['원인:조건/구분,[보충]'], answer: ['개념'], conditions: [] });
  assert.ok(!questions.some(q => q.kind === 'direct'), '`<` never asks forward');
  assert.deepEqual(memoColors.splitReviewMemoColonColors(memo).filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0]);
  const syntax = loadSource('utils/reviewMemoLogic.ts').parseReviewMemoSyntax(memo);
  assert.deepEqual(syntax.relationSeparators, []);
  assert.deepEqual(syntax.logicalExpressions.map(e => readLogicalExpression(memo, e)), [{ and: ['b', 'c'] }]);
  const toggle = ':::toggle a<{대안}\nb\nc\n:::end';
  const document = memoDocument.reviewMemoDocumentFromText(toggle);
  assert.equal(document.nodes[0].childrenRelation.operator, 'or');
  assert.deepEqual(questionsFor(toggle).filter(q => q.kind === 'reverse').map(q => [q.prompt, q.answer]), [['b', 'a'], ['c', 'a']], 'each alternative recalls the parent on its own');
});

test('custom classifications flow through multiple toggle generations without leaking to a sibling branch', () => {
  const memo = ':::toggle A:{B}C:D\n:::toggle E:F\nK:L<M\n:::end\n:::end\n:::toggle X:Y\nS:T<U\n:::end';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, ['B']);
  const reverseM = classify(questions.find(q => q.kind === 'reverse' && q.prompt === 'M'));
  assert.deepEqual([reverseM.prompt, reverseM.answer], [['원인'], ['B']], 'L<M reads M by the inherited label of its own slot and answers with the slot of L');
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'S')).answer, ['원인']);
  assert.ok(!classify(questions.find(q => q.kind === 'direct' && q.prompt === 'S')).conditions.flat().includes('B'));
});

test('nearest explicit override wins, including empty overrides, while sibling children keep their parent label', () => {
  const memo = ':::toggle A:{B}C:D\n:::toggle E<{X}F:G\nK:L<M\n:::end\nP:Q<R\n:::end';
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  const questions = questionsFor(memo);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, ['X']);
  const reverseM = classify(questions.find(q => q.kind === 'reverse' && q.prompt === 'M'));
  assert.deepEqual([reverseM.prompt, reverseM.answer], [['원인'], ['X']]);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'P')).answer, ['B']);
  const cleared = questionsFor(memo.replace('{X}', '{}'));
  assert.deepEqual(classify(cleared.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, []);
  const clearedM = classify(cleared.find(q => q.kind === 'reverse' && q.prompt === 'M'));
  assert.deepEqual([clearedM.prompt, clearedM.answer], [['원인'], []]);
});

test('inherited classifications also reach nested relations, partial facts and sequence stages', () => {
  const memo = ':::toggle A;{B}C:D\nG:[H:I];J\nP:[읽기-정리-확인],[예제,문제]\n:::end';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  const inner = questions.find(q => q.kind === 'direct' && q.prompt === 'H');
  assert.deepEqual(classify(inner).answer, ['B']);
  const partial = questions.find(q => q.kind === 'remaining' && q.prompt === 'P');
  assert.deepEqual(classify(partial).answer, ['B']);
  assert.deepEqual(classify(partial).conditions.at(-1), ['B']);
  const order = questions.find(q => q.kind === 'order-next');
  assert.deepEqual(classify(order).prompt, ['B']);
  assert.deepEqual(classify(order).answer, ['B']);
});

test('inherited exception colors use the same slots in the actual recursive note editor', () => {
  const { getReviewFieldOverrides } = loadSource('utils/reviewFieldOverride.ts');
  const inherited = getReviewFieldOverrides('A:{B}C:D');
  assert.deepEqual([...inherited], [[1, 'B']]);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('G:H;J', inherited).filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0]);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewMemoEditor } = loadSource('components/ReviewMemoEditor.tsx');
  const value = ':::toggle A:{B}C:D\n:::toggle E:F\nG:H;J\n:::end\n:::end';
  const html = renderToStaticMarkup(React.createElement(ReviewMemoEditor, { value, onChange() {}, colorColons: true }));
  assert.equal((html.match(/data-colon-index=/g) || []).length, 2);
  assert.ok(!html.includes('data-colon-index="2"'));
  assert.ok(!html.includes('fieldOverrides='));
  assert.ok(html.includes('G:H;J'));
});

test('override inheritance is derived from the current parent and survives persistence without rewriting child notes', () => {
  const memo = ':::toggle A:{B}C\n:::toggle G:H;J\nK:L;M\n:::end\n:::end\n:::toggle X;{Y}Z\n:::end';
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const child = document.nodes.find(n => n.text === 'G:H;J');
  const destination = document.nodes.find(n => n.text === 'X;{Y}Z');
  const moved = memoDocument.moveReviewMemoNode(document, child.id, destination.id);
  const restored = JSON.parse(JSON.stringify(moved));
  assert.equal(restored.nodes.find(n => n.id === child.id).text, 'G:H;J');
  const questions = questionsFor(memoDocument.reviewMemoDocumentToText(restored));
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'G')).answer, ['Y']);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, ['Y']);
  assert.deepEqual([...loadSource('utils/reviewFieldOverride.ts').getReviewFieldOverrides('a:[b:{내부}c]:d')], []);
});

test('reverse questions in distinct inherited classifications do not merge into the first parent label', () => {
  const memo = ':::toggle A:{B}C\nG:H\n:::end\n:::toggle A:{X}C\nK:H\n:::end';
  const reversed = questionsFor(memo).filter(q => q.kind === 'reverse' && q.prompt === 'H');
  assert.equal(reversed.length, 2);
  assert.deepEqual(reversed.map(q => [q.answer, questionBuilder.getReviewQuestionClassification('개념:원인', q).prompt]), [
    ['G', ['B']], ['K', ['X']]
  ]);
});

test('eight toggle levels retain the nearest override while editing it changes only its subtree', () => {
  const nested = override => {
    let text = '말단:정답:상세';
    for (let depth = 7; depth >= 0; depth -= 1) {
      const custom = depth === 2 ? `{${override}}` : depth === 0 ? '{최상위분류}' : '';
      text = `:::toggle 단계${depth};${custom}조건${depth}:기준${depth}\n${text}\n${depth === 0 ? '형제:답:근거\n' : ''}:::end`;
    }
    return text + '\n바깥:값:설명';
  };
  const before = questionsFor(nested('하위분류'));
  const after = questionsFor(nested('변경분류'));
  const classify = (questions, prompt) => questionBuilder.getReviewQuestionClassification('개념:원인', questions.find(q => q.kind === 'direct' && q.prompt === prompt));
  assert.deepEqual(classify(before, '말단').answer, ['하위분류']);
  assert.deepEqual(classify(after, '말단').answer, ['변경분류']);
  assert.deepEqual(classify(before, '형제').answer, ['최상위분류']);
  assert.deepEqual(classify(after, '형제').answer, ['최상위분류']);
  assert.deepEqual(classify(after, '바깥').answer, ['원인']);
  assert.equal(before.find(q => q.kind === 'direct' && q.prompt === '말단').conditions.length, 8);
  assert.deepEqual(before.map(q => q.key), after.map(q => q.key));
});

test('review question keeps compact conditions above its centered prompt without a sidebar or answer box', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = ':::toggle 전체:{관점}공통:기준\n:::toggle 중간;{세부}연결:설명\n질문:정답전용값\n:::end\n:::end';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '질문');
  const render = revealed => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question, criterion: '개념:원인', revealed }));
  const hidden = inStyle('flash', () => render(false));
  assert.ok(!hidden.includes('<aside') && !hidden.includes('data-question-answer-placeholder'));
  assert.match(hidden, /flex flex-col items-center gap-6/);
  assert.ok(hidden.indexOf('전체:공통:기준') < hidden.indexOf('data-question-field="prompt"'));
  assert.ok(!hidden.includes('정답전용값'));
  assert.ok(inStyle('flash', () => render(true)).includes('정답전용값'));
  // 줄글: 조건은 칩이 아니라 문장 안에 있다
  const prose = inStyle('prose', () => render(false));
  assert.ok(!prose.includes('data-flash-condition') && !prose.includes('<aside') && !prose.includes('정답전용값'));
  assert.match(prose, /flex flex-col items-center gap-5/);
});

test('nested questions reset classification columns while retaining classified ancestor conditions', () => {
  const questions = questionsFor('a:[b:c]=[d:c]');
  const classify = question => questionBuilder.getReviewQuestionClassification('대상:설명:예시', question);
  const inner = questions.find(q => q.kind === 'direct' && q.prompt === 'b' && q.answer === 'c');
  assert.deepEqual(classify(inner), { prompt: ['대상'], answer: ['설명'], conditions: [['대상']] });
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'a')).answer, ['설명']);
  assert.ok(!questions.some(q => q.kind === 'context'), 'there is no question that asks a parent condition from its child');
});

test('all sequence stages and partial logical facts keep their containing classification column', () => {
  const criterion = '대상;과정:보충';
  const questions = questionsFor('학습:[읽기-정리-확인],[문제,예제]');
  for (const question of questions.filter(q => q.kind.startsWith('order-'))) {
    const labels = questionBuilder.getReviewQuestionClassification(criterion, question);
    assert.deepEqual(labels.prompt, ['과정']);
    assert.deepEqual(labels.answer, ['과정']);
    assert.deepEqual(labels.conditions, [['대상']]);
  }
  const partial = questions.find(q => q.kind === 'remaining' && q.conditions.includes('읽기 충족'));
  assert.deepEqual(questionBuilder.getReviewQuestionClassification(criterion, partial), {
    prompt: ['대상'], answer: ['과정'], conditions: partial.conditions.map(() => ['과정'])
  });
});

test('lines under a toggle title that ends with a colon sit after the title, so each ancestor shifts the classification columns', () => {
  const memo = ':::toggle 상위:설명:\n:::toggle 중간:\n값:뜻\n:::end\n:::end';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '값');
  assert.deepEqual(question.conditions, ['상위:설명', '중간']);
  // 상위:설명 이 0·1번째 칸, 중간이 2번째, 값·뜻이 3·4번째: 세션 기준의 해당 `:`번째 이름을 가져온다
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('대상:정의:예시:쓰임:근거', question), {
    prompt: ['쓰임'], answer: ['근거'], conditions: [['대상', '정의'], ['예시']]
  });
  // 기준에 이름이 모자란 칸은 이름이 없다
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('대상:정의:예시', question), { prompt: [], answer: [], conditions: [['대상', '정의'], ['예시']] });
  // 한 단계 아래 줄: `자동차 :` 아래 `엔진:동력`은 정의 → 예시, 제목 칸(자동차)은 개념
  const car = questionsFor(':::toggle 자동차 :\n엔진:동력\n타이어:접지\n:::end').find(q => q.kind === 'direct' && q.prompt === '엔진');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의:예시', car), { prompt: ['정의'], answer: ['예시'], conditions: [['개념']] });
  // 제목의 빈 칸(자식 머리)도 같은 번호: 자동차 → 엔진 AND 타이어
  const heads = questionsFor(':::toggle 자동차 :\n엔진:동력\n타이어:접지\n:::end').find(q => q.kind === 'direct' && q.prompt === '자동차');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의:예시', heads), { prompt: ['개념'], answer: ['정의'], conditions: [] });
  // 끝이 닫힌 제목(`A:C`)과 관계 없는 제목은 자리를 밀지 않는다
  const closed = questionsFor(':::toggle A:C\nB:D\n:::end').find(q => q.kind === 'direct' && q.prompt === 'B');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의:예시', closed).prompt, ['개념']);
  const plain = questionsFor(':::toggle A\nB:D\n:::end').find(q => q.kind === 'direct' && q.prompt === 'B');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의:예시', plain).prompt, ['개념']);
});

test('empty classification fields keep their positions and grouped labels do not split into extra columns', () => {
  const question = questionsFor('a:b:c').find(q => q.kind === 'direct' && q.prompt === 'b');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('대상::예시', question), { prompt: [], answer: ['예시'], conditions: [] });
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('대상:[원인=조건]:예시', question), {
    prompt: ['[원인=조건]'], answer: ['예시'], conditions: []
  });
  assert.deepEqual(questionBuilder.getReviewQuestionClassification(null, question), { prompt: [], answer: [], conditions: [] });
});

test('the outer bracketed session criterion survives nested logical labels and persisted reloads', () => {
  const text = '목적 [대상:[원인=조건]:예시] 기타 [다른:기준]';
  const storageData = new Map();
  const storage = { getItem: key => storageData.get(key) ?? null, setItem: (key, value) => storageData.set(key, value) };
  sessionMemo.writeSessionMemo('first', text, storage);
  const record = sessionMemo.readSessionMemoRecords(storage).first;
  assert.equal(record.classificationCriterion, '대상:[원인=조건]:예시');
  assert.equal(record.text, text);
  assert.equal(sessionMemo.createSessionMemoRecord('[] [대상:설명]').classificationCriterion, '대상:설명');
  assert.equal(sessionMemo.createSessionMemoRecord('[미완성 [대상:설명]').classificationCriterion, null);
});

test('question content displays the target classification before reveal and the answer only afterward', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = 'alpha:beta:gamma';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === 'beta');
  const render = revealed => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question,
    criterion: '대상:설명:예시', revealed, memo }));
  // 플래시 카드: 주어진 속성 · 맞힐 속성을 크게 따로 보인다
  const hidden = inStyle('flash', () => render(false));
  const shown = inStyle('flash', () => render(true));
  assert.match(hidden, /data-question-field="prompt"[\s\S]*>설명<\/p>[\s\S]*>beta<\/p>/);
  assert.match(hidden, /data-question-field="answer"[\s\S]*맞힐 것 · 예시<\/p>/);
  assert.ok(!hidden.includes('gamma'));
  assert.ok(shown.includes('gamma'));
  const changed = inStyle('flash', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question,
    criterion: '개념:의미:활용', revealed: false, memo })));
  assert.ok(changed.includes('>의미</p>') && changed.includes('맞힐 것 · 활용</p>'));
  assert.ok(!changed.includes('>설명</p>'));
  // 줄글: 속성이 문장 안에 있고 기준 줄 · 칸 이름표는 따로 없다
  const sentence = inStyle('prose', () => render(false));
  assert.match(sentence, /data-question-statement="true"[^>]*>설명 ‘beta’에 이어지는 예시 값은\?<\/p>/);
  assert.ok(!sentence.includes('data-field-label') && !sentence.includes('data-classification-criterion') && !sentence.includes('gamma'));
  assert.ok(inStyle('prose', () => render(true)).includes('gamma'));
  assert.ok(inStyle('prose', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question,
    criterion: '개념:의미:활용', revealed: false, memo }))).includes('의미 ‘beta’에 이어지는 활용 값은?'));
  assert.equal(questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === 'beta').key, question.key);
});

test('fallback note recall still renders the full note and its global criterion', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = '기호가 없는 정리 내용';
  const question = questionsFor(memo)[0];
  const render = () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question,
    criterion: '대상:설명', revealed: true, memo }));
  const html = inStyle('flash', render);
  assert.ok(html.includes('data-review-note-summary') && html.includes(memo));
  // 세션 노트 분류 줄은 어느 모양에서도 따로 보이지 않는다
  assert.ok(!html.includes('data-classification-criterion') && !html.includes('대상:설명'));
  // 줄글에서도 세션 노트 기준 줄을 가져오지 않는다
  const prose = inStyle('prose', render);
  assert.ok(prose.includes('data-review-note-summary') && prose.includes(memo) && !prose.includes('data-classification-criterion'));
});

test('equals is a higher-importance colon while periods, decimals and spaces stay literal', () => {
  const memo = 'n:3.5 // sentence:first. second. // a=b';
  const direct = questionsFor(memo).filter(q => q.kind === 'direct');
  assert.deepEqual(direct.map(q => [q.prompt, q.answer, q.priority]), [['a', 'b', 1], ['n', '3.5', 1], ['sentence', 'first. second.', 1]],
    'a=b is asked before the colon lines (= is the more important link), and it is a relation, not an OR');
  assert.ok(questionsFor('a=b').some(q => q.kind === 'reverse' && q.prompt === 'b' && q.answer === 'a'), '= is asked backwards like a colon');
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['a.b', 'a. b', '[a.b.]', 'a;b.c', 'a=b']) assert.deepEqual(parseReviewMemoSyntax(text).logicalOperators, [], text);
});

test('nested relation columns restart their labels, keep the outer importance, and outer relations use only branch heads', () => {
  const direct = memo => questionsFor(memo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer, q.priority, q.conditions]);
  assert.deepEqual(direct('a:(b:c):(d:c)'), [['a', 'b', 1, []], ['b', 'c', 2, ['a']], ['b', 'd', 2, []], ['d', 'c', 3, ['a']]]);
  const colored = memoColors.splitReviewMemoColonColors('a:(b:c):(d:c):e // f:g');
  assert.deepEqual(colored.filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0, 0, 1, 0, 2, 0]);
  // `=`는 칸을 나누지 않는다: `(b:c)=(d:c)`는 한 칸 안에서 같다고 놓인 두 묶음이라 콜론 번호를 올리지 않는다
  assert.deepEqual(direct('a:(b:c)=(d:c)'), [['b', 'd', 1, ['a']], ['a', 'b = d', 1, []], ['b', 'c', 2, ['a']], ['d', 'c', 2, ['a']]]);
  const equalColored = memoColors.splitReviewMemoColonColors('a:(b:c)=(d:c):e // f:g');
  assert.deepEqual(equalColored.filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0, 0, 0, 1, 0]);
});

test('flat and nested chains put the important pairs first: leftmost with its neighbour, then the next pairs', () => {
  const direct = questionsFor('a:b:c // x:(y:z:q)').filter(q => q.kind === 'direct');
  assert.deepEqual(direct.map(q => [q.prompt, q.answer, q.priority]), [['a', 'b', 1], ['x', 'y', 1], ['y', 'z', 2], ['b', 'c', 2], ['z', 'q', 3]]);
});

test('whole reconstruction includes nested relations instead of repeating the easy branch-head answer', () => {
  assert.equal(questionsFor('a:(b:c)').find(q => q.kind === 'reconstruct').answer, 'b → c');
  assert.equal(questionsFor('a:(b:c):d').find(q => q.kind === 'reconstruct').answer, 'b → c → d');
  assert.ok(!questionsFor('a:(b,c),(d,e)').some(q => q.kind === 'reconstruct'));
});

test('reverse questions with identical conditions collect valid alternatives instead of asking an ambiguous duplicate', () => {
  const reversed = questionsFor('x:(b:c) // x:(d:c)').filter(q => q.kind === 'reverse' && q.prompt === 'c');
  assert.equal(reversed.length, 1);
  assert.equal(reversed[0].answer, 'b OR d');
  assert.deepEqual(reversed[0].conditions, ['x']);
  const separate = questionsFor('x:(b:c) // y:(d:c)').filter(q => q.kind === 'reverse' && q.prompt === 'c');
  assert.equal(separate.length, 2);
});

test('AND partial questions give some of the requirements and ask for the rest', () => {
  const partial = questionsFor('a:b,c,d').filter(q => q.kind === 'remaining');
  assert.deepEqual(partial.map(q => [q.conditions, q.answer]), [
    [['b 충족', 'c 충족'], 'd'], [['b 충족', 'd 충족'], 'c'], [['c 충족', 'd 충족'], 'b'],
    [['b 충족'], 'c AND d'], [['c 충족'], 'b AND d'], [['d 충족'], 'b AND c']
  ]);
  assert.equal(questionsFor('a:b=c').filter(q => q.kind === 'remaining').length, 0, 'a=b is a relation, not a set of alternatives');
  assert.equal(questionsFor('a<b,c').filter(q => q.kind === 'remaining').length, 0, 'a reverse relation never asks forward');
  assert.ok(questionsFor('a;b,c').filter(q => q.kind === 'remaining').length > 0, 'a ; relation asks forward');
});

test('sequence notation preserves order inside nested AND groups when saved and reloaded', () => {
  const text = '과정:[a-b-c],[d,[e-f]]';
  const document = memoDocument.reviewMemoDocumentFromText(text);
  const expression = document.nodes[0].logicalExpressions[0];
  assert.deepEqual(readLogicalExpression(text, expression), { and: [
    { group: { sequence: ['a', 'b', 'c'] } },
    { group: { and: ['d', { group: { sequence: ['e', 'f'] } }] } }
  ] });
  const restored = memoDocument.resolveReviewMemoDocument(text, JSON.parse(JSON.stringify(document)));
  assert.deepEqual(restored, document);
  assert.equal(memoDocument.reviewMemoDocumentToText(restored), text);
  const flat = 'a-b,c,d-e';
  assert.deepEqual(loadSource('utils/reviewMemoLogic.ts').parseReviewMemoSyntax(flat).logicalExpressions.map(e => readLogicalExpression(flat, e)), [
    { and: [{ sequence: ['a', 'b'] }, 'c', { sequence: ['d', 'e'] }] }
  ]);
});

test('sequence separators do not consume negative signs, exponents, or unfinished hyphens', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['-1', '값;-3.5', '값;1e-3', '- 항목', 'a-']) {
    assert.ok(!parseReviewMemoSyntax(text).logicalOperators.some(item => item.operator === 'sequence'), text);
    assert.ok(!questionsFor(text).some(q => q.kind.startsWith('order-')), text);
  }
  const sequence = questionsFor('a--1-b').filter(q => q.kind === 'order-next');
  assert.deepEqual(sequence.map(q => [q.prompt, q.answer]), [['a', '-1'], ['-1', 'b']]);
});

test('sequence questions ask the next and previous stage, then reconstruct the ordered remainder', () => {
  const questions = questionsFor('a-b-c');
  assert.deepEqual(questions.filter(q => q.kind === 'order-next').map(q => [q.prompt, q.answer, q.level]), [['a', 'b', 1], ['b', 'c', 1]]);
  assert.deepEqual(questions.filter(q => q.kind === 'order-previous').map(q => [q.prompt, q.answer, q.level]), [['b', 'a', 1], ['c', 'b', 1]]);
  const full = questions.find(q => q.kind === 'order-reconstruct');
  assert.equal(full.prompt, 'a');
  assert.equal(full.answer, 'b → c');
  assert.ok(full.difficulty > questions.find(q => q.kind === 'order-next').difficulty);
  assert.ok(full.level > questions.find(q => q.kind === 'order-next').level);
  assert.ok(!questionsFor('a-b').some(q => q.kind === 'order-reconstruct'));
});

test('deep logical residuals span nested groups and ask only what is still missing', () => {
  const partial = questionsFor('성립:a,(b,c),d').filter(q => q.kind === 'remaining');
  const find = conditions => partial.find(q => JSON.stringify(q.conditions) === JSON.stringify(conditions));
  assert.equal(find(['a 충족', 'b 충족']).answer, 'c AND d');
  assert.equal(find(['b 충족', 'c 충족']).answer, 'a AND d');
  assert.equal(find(['a 충족']).answer, 'b AND c AND d');
  assert.ok(find(['a 충족', 'b 충족', 'c 충족']).difficulty < find(['a 충족']).difficulty);
  assert.ok(find(['a 충족', 'b 충족', 'c 충족']).level < find(['a 충족']).level);
  assert.equal(find(['a 충족', 'a 충족']), undefined);
  assert.ok(partial.every(q => q.answer.trim() && !q.answer.includes('undefined')));
});

test('four layers of nested conjunctions produce residual questions at every layer', () => {
  const deeper = questionsFor('성립:(a,(b,(c,(d,e))))').filter(q => q.kind === 'remaining');
  assert.equal(deeper.find(q => q.conditions.join('|') === 'a 충족|b 충족').answer, 'c AND d AND e');
  assert.equal(deeper.find(q => q.conditions.join('|') === 'a 충족|d 충족|e 충족').answer, 'b AND c');
  assert.equal(deeper.find(q => q.conditions.join('|') === 'a 충족').answer, 'b AND c AND d AND e');
});

test('ordered branches only supply completed prefixes', () => {
  const partial = questionsFor('학습:(읽기-정리-확인),(문제,(예제-점검))').filter(q => q.kind === 'remaining');
  const find = conditions => partial.find(q => q.conditions.join('|') === conditions.join('|'));
  assert.equal(find(['읽기 충족', '정리 충족', '확인 충족', '문제 충족']).answer, '예제 → 점검');
  assert.equal(find(['읽기 충족', '문제 충족']).answer, '(정리 → 확인) AND (예제 → 점검)');
  assert.equal(find(['읽기 충족', '정리 충족', '확인 충족', '예제 충족']).answer, '문제 AND 점검');
  for (const question of partial) {
    if (question.conditions.includes('정리 충족')) assert.ok(question.conditions.includes('읽기 충족'));
    if (question.conditions.includes('확인 충족')) assert.ok(question.conditions.includes('정리 충족'));
    if (question.conditions.includes('점검 충족')) assert.ok(question.conditions.includes('예제 충족'));
  }
});

test('nested sequence stages retain parent toggle conditions and keep the importance of the column they sit in', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '상위:', text: '학습:[a-[b:c]-d],[e,f]' }]);
  const questions = questionsFor(memo);
  assert.deepEqual(questions.find(q => q.kind === 'order-next' && q.prompt === 'a').conditions, ['상위', '학습']);
  const nested = questions.find(q => q.kind === 'direct' && q.prompt === 'b');
  assert.deepEqual(nested.conditions, ['상위', '학습', 'a 이후']);
  assert.equal(nested.priority, 2, 'b:c sits in the second column, so it is not among the most important pairs');
  assert.equal(questions.find(q => q.kind === 'order-reconstruct').answer, '(b → c) → d');
});

test('partial-question enumeration stays bounded for large notes without changing unrelated keys', () => {
  const memo = '성립:' + Array.from({ length: 20 }, (_, i) => `a${i}`).join(',');
  const questions = questionsFor(memo);
  assert.equal(questions.filter(q => q.kind === 'remaining').length, 64);
  const simple = questionsFor('x:y')[0];
  assert.equal(questionsFor(memo + ' // x:y').find(q => q.kind === 'direct' && q.prompt === 'x').key, simple.key);
  const original = questionsFor('a-b-c').map(q => q.key);
  assert.deepEqual(questionsFor('x:y // a-b-c').filter(q => q.kind.startsWith('order-') || q.kind === 'far').map(q => q.key), original);
});

test('toggle children fill an empty colon with OR, an empty less-than asks each child backwards and an empty semicolon fills AND parts forward only; a trailing = is not a relation', () => {
  const colonMemo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차:', text: '엔진\n타이어\n문' }]);
  assert.deepEqual(questionsFor(colonMemo).filter(q => q.kind === 'direct').map(q => q.answer), ['엔진 OR 타이어 OR 문']);
  assert.deepEqual(questionsFor(colonMemo).filter(q => q.kind === 'reverse').map(q => [q.prompt, q.answer]), [['엔진', '자동차'], ['타이어', '자동차'], ['문', '자동차']], 'a : relation also asks each alternative backwards');
  // `=`는 칸을 나누는 관계(연결어)가 아니라 논리관계어다: 제목 끝의 `=`는 아래 줄들을 같음으로 이을 뿐 "또는" 관계를 만들지 않는다
  const equalMemo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차=', text: '엔진\n타이어\n문' }]);
  assert.ok(!questionsFor(equalMemo).some(q => q.answer.includes(' OR ')));
  assert.deepEqual(questionsFor(equalMemo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['자동차', '엔진'], ['엔진', '타이어'], ['타이어', '문']]);
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차<', text: '엔진\n타이어\n문' }]);
  const reverse = questionsFor(memo).filter(q => q.kind === 'reverse');
  assert.deepEqual(reverse.map(q => [q.prompt, q.answer]), [['엔진', '자동차'], ['타이어', '자동차'], ['문', '자동차']]);
  assert.ok(!questionsFor(memo).some(q => q.kind === 'direct'));
  const forwardMemo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차;', text: '엔진\n타이어\n문' }]);
  assert.deepEqual(questionsFor(forwardMemo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['자동차', '엔진 OR 타이어 OR 문']], 'every connector links the rows with OR');
  assert.ok(!questionsFor(forwardMemo).some(q => q.kind === 'reverse'), 'a ; relation never asks backwards');
  const andMemo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차;,', text: '엔진\n타이어\n문' }]);
  assert.deepEqual(questionsFor(andMemo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['자동차', '엔진 AND 타이어 AND 문']], 'a , at the very end makes the rows AND');
});

test('ancestor conditions come from the actual toggle path and do not leak a sibling context', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: '자동차:', text: reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '엔진:', text: '전기:모터' }]) },
    { type: 'toggle', title: '자전거:', text: '페달<회전' }
  ]);
  const questions = questionsFor(memo);
  assert.deepEqual(questions.find(q => q.kind === 'direct' && q.prompt === '전기').conditions, ['자동차', '엔진']);
  assert.deepEqual(questions.find(q => q.kind === 'reverse' && q.prompt === '회전').conditions, ['자전거']);
  assert.ok(!questions.some(q => q.kind === 'direct' && q.prompt === '페달'), '페달<회전 is the reverse relation: only the reverse is asked');
  assert.ok(!questions.some(q => q.kind === 'context'), 'a parent condition is never asked from its child');
});

test('semantic question keys survive an unrelated insertion but change with an answer', () => {
  const a = questionsFor('a:b')[0];
  const moved = questionsFor('x:y // a:b').find(q => q.kind === 'direct' && q.prompt === 'a');
  assert.equal(a.key, moved.key);
  assert.notEqual(a.key, questionsFor('a:c')[0].key);
});

test('empty notes and empty toggles do not manufacture recall questions', () => {
  assert.deepEqual(questionsFor(' \n '), []);
  assert.deepEqual(questionsFor(':::toggle \n:::end'), []);
});

test('difficulty counts distinct recall and supplied facts without counting supplied answers twice', () => {
  const { calculateReviewQuestionDifficulty: score } = loadSource('utils/reviewDifficulty.ts');
  const a = { nodeId: 'a', start: 0, end: 1 };
  const b = { nodeId: 'a', start: 2, end: 3 };
  const c = { nodeId: 'a', start: 4, end: 5 };
  assert.deepEqual(score([a, a, b], [a, a, c]), { recallUnits: 1, providedUnits: 2, difficulty: 1 / 3 });
  assert.ok(score([a, b], [c]).difficulty > score([a], [c]).difficulty);
  assert.ok(score([a], [b, c]).difficulty < score([a], [b]).difficulty);
});

test('more supplied facts and less recall make partial logic easier than whole reconstruction', () => {
  const questions = questionsFor('a:b,c,d');
  const full = questions.find(q => q.kind === 'direct');
  const oneGiven = questions.find(q => q.kind === 'remaining' && q.conditions.length === 1);
  const twoGiven = questions.find(q => q.kind === 'remaining' && q.conditions.length === 2);
  assert.deepEqual([twoGiven.recallUnits, twoGiven.providedUnits], [1, 3]);
  assert.deepEqual([oneGiven.recallUnits, oneGiven.providedUnits], [2, 2]);
  assert.deepEqual([full.recallUnits, full.providedUnits], [3, 1]);
  assert.ok(twoGiven.difficulty < oneGiven.difficulty && oneGiven.difficulty < full.difficulty);
  assert.ok(twoGiven.level < oneGiven.level && oneGiven.level < full.level);
  assert.ok(questions.indexOf(twoGiven) < questions.indexOf(oneGiven) && questions.indexOf(oneGiven) < questions.indexOf(full));
});

test('question type and character length alone do not assign difficulty', () => {
  const questions = questionsFor('a:b');
  assert.equal(questions[0].difficulty, questions[1].difficulty);
  assert.equal(questions[0].level, questions[1].level);
  const long = questionsFor('a;' + 'long answer '.repeat(30))[0];
  assert.equal(long.difficulty, questions[0].difficulty);
  assert.deepEqual([long.recallUnits, long.providedUnits], [1, 1]);
});

test('important pairs precede later ones despite larger recall requirements', () => {
  const questions = questionsFor('a:[b,c,d]:e-f-g');
  const later = questions.filter(q => q.priority === 3);
  assert.ok(later.some(q => q.kind === 'order-next'));
  assert.ok(questions.filter(q => q.kind.startsWith('order-')).every(q => q.priority === 3), 'the sequence sits in the third column: less + less');
  const first = questions.filter(q => q.priority === 1);
  assert.ok(Math.max(...first.map(q => q.difficulty)) > Math.min(...later.map(q => q.difficulty)));
  assert.ok(questions.indexOf(first.at(-1)) < questions.indexOf(later[0]));
});

test('ancestor conditions keep source offsets and are counted once', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '  parent:detail  ', text: 'child:answer' }]);
  const built = questionBuilder.buildReviewQuestions(memo);
  const direct = built.questions.find(q => q.kind === 'direct' && q.prompt === 'child');
  const text = span => built.nodes.find(node => node.id === span.nodeId).text.slice(span.start, span.end);
  assert.deepEqual(direct.conditionSpans.flat().map(text), ['parent', 'detail']);
  assert.equal(direct.providedUnits, 3);
});

test('practice chooses importance before difficulty and orders equal stages by supplied information', () => {
  const catalog = [
    { id: 'right', logId: 'a', priority: 2, level: 1, difficulty: 0.2, recallUnits: 1, providedUnits: 4 },
    { id: 'left-hard', logId: 'a', priority: 1, level: 3, difficulty: 0.8, recallUnits: 4, providedUnits: 1 },
    { id: 'left-easy', logId: 'a', priority: 1, level: 1, difficulty: 0.5, recallUnits: 1, providedUnits: 1 },
    { id: 'left-hinted', logId: 'a', priority: 1, level: 1, difficulty: 0.25, recallUnits: 1, providedUnits: 3 }
  ];
  let state = practice.startReviewPractice(catalog, { a: 3 });
  const visited = [];
  while (state.queue.length) {
    visited.push(state.queue[0]);
    state = practice.gradeReviewPractice(state, catalog, true);
  }
  assert.deepEqual(visited, ['left-hinted', 'left-easy', 'left-hard', 'right']);
});

test('difficulty never rises by itself: the learner opens larger recall by choosing a level, and schedule keys stay stable', () => {
  const memo = 'a:b,c,d';
  const questions = questionsFor(memo);
  const catalog = questions.map(q => ({ ...q, id: q.key, logId: 'a' }));
  const levels = [...new Set(catalog.map(q => q.level))].sort();
  assert.ok(levels.length > 1, 'the note has easier and harder questions');
  let state = practice.startReviewPractice(catalog);
  const visited = [];
  const answerAll = () => {
    while (state.queue.length) {
      visited.push(catalog.find(q => q.id === state.queue[0]).level);
      state = practice.gradeReviewPractice(state, catalog, 'easy');
    }
  };
  answerAll();
  assert.ok(visited.length > 0 && visited.every(level => level === 1), 'easy answers do not open anything beyond the chosen level');
  assert.equal(state.completed.length, catalog.filter(q => q.level === 1).length);
  assert.equal(practice.getReviewPracticeLevel(state), 1);
  for (const level of levels.slice(1)) {
    state = practice.setReviewPracticeLevel(state, catalog, level);
    assert.ok(state.queue.length > 0, 'choosing a higher level brings the harder questions');
    answerAll();
  }
  assert.ok(visited.every((level, index) => index === 0 || level >= visited[index - 1]), 'levels come in the order the learner opened them');
  assert.equal(state.completed.length, catalog.length);
  assert.deepEqual(questionsFor('x:y // ' + memo).filter(q => q.prompt === 'a').map(q => q.key), questions.filter(q => q.prompt === 'a').map(q => q.key));
});

test('practice completes 1,2,3,4 before retrying only 2,4 and then only 4', () => {
  const catalog = [1, 2, 3, 4].map(i => ({ id: String(i), logId: 'a', level: 1, priority: 1 }));
  let state = practice.startReviewPractice(catalog);
  const visited = [];
  for (const correct of [true, false, true, false, true, false, true]) {
    visited.push(state.queue[0]);
    state = practice.gradeReviewPractice(state, catalog, correct);
  }
  assert.deepEqual(visited, ['1', '2', '3', '4', '2', '4', '4']);
  assert.deepEqual(state.queue, []);
  assert.equal(state.wrongCounts['2'], 1);
  assert.equal(state.wrongCounts['4'], 2);
  assert.equal(new Set(state.completed).size, 4);
});

test('grades are only recorded: neither easy nor wrong answers change which level is open, and the learner can raise or lower it', () => {
  const catalog = Array.from({ length: 6 }, (_, i) => ({ id: 'q' + i, logId: 'a', level: i < 2 ? 1 : i < 4 ? 2 : 3, priority: 1, difficulty: (i + 1) / 10 }));
  const start = practice.startReviewPractice(catalog);
  assert.deepEqual(start.queue, ['q0', 'q1'], 'only the chosen level is open at first');
  for (const grade of ['easy', 'good', 'hard']) {
    const next = practice.gradeReviewPractice(start, catalog, grade);
    assert.deepEqual(next.queue, ['q1'], grade + ' opens nothing new');
    assert.equal(practice.getReviewPracticeLevel(next), 1);
    assert.deepEqual(next.grades.q0, [grade]);
  }
  const wrong = practice.gradeReviewPractice(start, catalog, 'again');
  assert.deepEqual(wrong.queue, ['q1']);
  assert.deepEqual(wrong.grades.q0, ['again']);
  const second = practice.setReviewPracticeLevel(start, catalog, 2);
  assert.deepEqual(second.queue, ['q0', 'q1', 'q2', 'q3']);
  assert.equal(practice.getReviewPracticeLevel(second), 2);
  assert.deepEqual(practice.setReviewPracticeLevel(second, catalog, 3).queue, ['q0', 'q1', 'q2', 'q3', 'q4', 'q5']);
  assert.deepEqual(practice.setReviewPracticeLevel(practice.setReviewPracticeLevel(start, catalog, 3), catalog, 1).queue, ['q0', 'q1'], 'lowering the level takes the harder questions away again');
  assert.equal(practice.getReviewPracticeLevel(practice.setReviewPracticeLevel(start, catalog, 9)), 3, 'the level stays within 1 to 3');
  assert.equal(practice.getReviewPracticeLevel(practice.setReviewPracticeLevel(start, catalog, 0)), 1);
  let rest = start;
  const order = [];
  const rounds = [];
  while (rest.queue.length) { order.push(rest.queue[0]); rounds.push(rest.round); rest = practice.gradeReviewPractice(rest, catalog, order.length === 1 ? 'again' : 'good'); }
  assert.deepEqual(order, ['q0', 'q1', 'q0'], 'a wrong question comes back in the retry round, as before');
  assert.deepEqual(rounds, [1, 1, 2]);
});

test('the order inside a level is fixed — importance first, then difficulty — whatever the grades', () => {
  const catalog = Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, logId: 'a', level: 1, priority: 1, difficulty: (i + 1) / 10 }));
  let state = practice.startReviewPractice(catalog);
  const visited = [];
  for (const grade of ['easy', 'easy', 'again', 'good']) { visited.push(state.queue[0]); state = practice.gradeReviewPractice(state, catalog, grade); }
  assert.deepEqual(visited, ['q0', 'q1', 'q2', 'q3'], 'easy answers do not skip ahead and a miss does not reorder the rest of the round');
  assert.deepEqual(state.grades.q2, ['again']);
  assert.equal(practice.REVIEW_GRADE_FSRS.again, 1); assert.equal(practice.REVIEW_GRADE_FSRS.easy, 4);
  assert.deepEqual(practice.gradeReviewPractice(practice.startReviewPractice(catalog), catalog, true).grades.q0, ['good'], 'a plain right/wrong still works (right = good, wrong = again)');
  const weighted = [
    { id: 'less', logId: 'a', level: 1, priority: 2, importance: 2.5, difficulty: 0.1 },
    { id: 'more-hard', logId: 'a', level: 1, priority: 2, importance: 2, difficulty: 0.9 },
    { id: 'more-easy', logId: 'a', level: 1, priority: 2, importance: 2, difficulty: 0.3 }
  ];
  assert.deepEqual(practice.startReviewPractice(weighted).queue, ['more-easy', 'more-hard', 'less'], 'a value further to the right comes after, even when its question is easier');
});

test('a note whose easiest question is above level 1 still offers that question', () => {
  const only = [{ id: 'hard', logId: 'a', level: 3, priority: 1 }];
  assert.deepEqual(practice.startReviewPractice(only).queue, ['hard']);
  const upper = [{ id: 'two', logId: 'a', level: 2, priority: 1 }, { id: 'three', logId: 'a', level: 3, priority: 1 }];
  assert.deepEqual(practice.startReviewPractice(upper).queue, ['two']);
  assert.deepEqual(practice.setReviewPracticeLevel(practice.startReviewPractice(upper), upper, 3).queue, ['two', 'three']);
});

test('merged note sessions start each note at its own saved level, and one answer never changes another note', () => {
  const catalog = ['a', 'b'].flatMap(logId => [1, 2].map(level => ({ id: logId + level, logId, level, priority: 1 })));
  let state = practice.startReviewPractice(catalog, { a: 1, b: 2 });
  assert.deepEqual(state.queue.sort(), ['a1', 'b1', 'b2']);
  for (const correct of [false, true]) state = practice.gradeReviewPractice(state, catalog, correct);
  assert.deepEqual(state.unlocked, { a: 1, b: 2 }, 'answers never move a level');
  assert.deepEqual(practice.setReviewPracticeLevel(state, catalog, 2).unlocked, { a: 2, b: 2 });
});

test('each mistake rolls back one previous interval and a clean round advances one step', () => {
  const results = [0, 1, 2, 3, 4, 10].map(wrong => practice.calculateQuestionPerformance({ reviewStep: 4 }, wrong, wrong + 1));
  assert.deepEqual(results.map(result => result.reviewStep), [5, 3, 2, 1, 0, 0]);
  assert.deepEqual(results.map(result => result.intervalMs), [16 * day, 4 * day, 2 * day, day, 2 * hour, 2 * hour]);
  assert.equal(practice.calculateQuestionPerformance(undefined, 0, 1).intervalMs, day);
  assert.equal(practice.calculateQuestionPerformance(undefined, 1, 2).intervalMs, 2 * hour);
  const sample = practice.calculateQuestionPerformance({ reviewStep: 2, wrongCount: 1 }, 1, 2, { baseIntervalMs: 3000, minimumIntervalMs: 1 });
  assert.equal(sample.intervalMs, 3000);
  assert.equal(sample.wrongCount, 2);
  const recovered = practice.calculateQuestionPerformance(sample, 0, 1, { baseIntervalMs: 3000, minimumIntervalMs: 1 });
  assert.equal(recovered.intervalMs, 6000);
  assert.equal(recovered.wrongCount, 2);
  assert.equal(practice.calculateQuestionPerformance(sample, 2, 3,
    { baseIntervalMs: 3000, initialIntervalMs: 250, minimumIntervalMs: 1 }).intervalMs, 250);
});

test('eight-day answer masking activates exactly at its boundary and stays mastered after a later mistake', () => {
  const before = practice.calculateQuestionPerformance({ reviewStep: 2 }, 0, 1);
  const boundary = practice.calculateQuestionPerformance(before, 0, 1);
  assert.equal(before.intervalMs, 4 * day);
  assert.equal(before.masked, false);
  assert.equal(boundary.intervalMs, 8 * day);
  assert.equal(boundary.masked, true);
  const later = practice.calculateQuestionPerformance(boundary, 10, 11);
  assert.ok(later.intervalMs < 8 * day);
  assert.equal(later.masked, true);
});

test('new per-question schedules wait for linked subjects, then commit at the actual completion time', () => {
  const original = source({ reviewMemo: 'a<b // c<d' });
  const keys = gate.getReviewGateQuestionKeys(original.reviewMemo);
  const graded = gate.applyReviewGateOutcomes([original], [{ logId: original.id, passed: false,
    wrongQuestionKeys: [keys[1]], completedQuestionKeys: keys, unlockedLevel: 1,
    questionResults: { [keys[0]]: { wrongCount: 0, attempts: 1 }, [keys[1]]: { wrongCount: 1, attempts: 2 } }
  }], false, now)[0];
  assert.equal(graded.nextReviewDate, original.nextReviewDate);
  assert.equal(graded.reviewStep, original.reviewStep);
  assert.deepEqual(graded.reviewQuestionSchedules, {});
  assert.equal(graded.reviewGateRetry, undefined);
  const finishedAt = now + 25 * 60000;
  const finished = { ...graded, ...gate.completeRegularReviewSchedule(graded, finishedAt) };
  assert.equal(Date.parse(finished.reviewQuestionSchedules[keys[0]].nextReviewDate), finishedAt + day);
  assert.equal(Date.parse(finished.reviewQuestionSchedules[keys[1]].nextReviewDate), finishedAt + 2 * hour);
  assert.equal(finished.reviewGatePendingSchedules, undefined);
  assert.deepEqual(gate.getDueReviewGateQuestionKeys(JSON.parse(JSON.stringify(finished)), finishedAt + 2 * hour), [keys[1]]);
  assert.deepEqual(gate.getDueReviewGateQuestionKeys(finished, finishedAt + 2 * hour - 1), []);
});

test('only due questions are remeasured and untouched question intervals survive later review completions', () => {
  const original = source({ reviewMemo: 'a<b // c<d', reviewQuestionFormat: 2 });
  const keys = gate.getReviewGateQuestionKeys(original.reviewMemo);
  original.reviewQuestionSchedules = { [keys[0]]: { reviewStep: 3, nextReviewDate: new Date(now + 8 * day).toISOString() } };
  const graded = gate.applyReviewGateOutcomes([original], [{ logId: original.id, passed: true, wrongQuestionKeys: [], completedQuestionKeys: [keys[1]],
    questionResults: { [keys[1]]: { wrongCount: 0, attempts: 1 } }
  }], false, now)[0];
  const finished = gate.completeRegularReviewSchedule(graded, now);
  assert.deepEqual(finished.reviewQuestionSchedules[keys[0]], original.reviewQuestionSchedules[keys[0]]);
});

test('saved wrong rounds roll back only their own question and resume growing from the lowered step', () => {
  const original = source({ reviewMemo: 'a<b // c<d', reviewQuestionFormat: 2 });
  const keys = gate.getReviewGateQuestionKeys(original.reviewMemo);
  original.reviewQuestionSchedules = Object.fromEntries(keys.map(key => [key,
    { reviewStep: 4, nextReviewDate: new Date(now).toISOString(), intervalMs: 8 * day, wrongCount: 3 }]));
  const graded = gate.applyReviewGateOutcomes([original], [{ logId: original.id, passed: false,
    wrongQuestionKeys: [keys[1]], completedQuestionKeys: keys,
    questionResults: { [keys[0]]: { wrongCount: 0, attempts: 1 }, [keys[1]]: { wrongCount: 2, attempts: 3 } }
  }], false, now)[0];
  const finished = JSON.parse(JSON.stringify({ ...graded, ...gate.completeRegularReviewSchedule(graded, now) }));
  assert.equal(finished.reviewQuestionSchedules[keys[0]].intervalMs, 16 * day);
  assert.equal(finished.reviewQuestionSchedules[keys[1]].reviewStep, 2);
  assert.equal(finished.reviewQuestionSchedules[keys[1]].intervalMs, 2 * day);
  assert.equal(finished.reviewQuestionSchedules[keys[1]].wrongCount, 5);
  assert.equal(finished.nextReviewDate, new Date(now + 2 * day).toISOString());
  assert.equal(practice.calculateQuestionPerformance(finished.reviewQuestionSchedules[keys[1]], 0, 1).intervalMs, 4 * day);
});

test('old positional schedules and retry keys migrate by matching relation content', () => {
  const legacy = source({ reviewMemo: 'a:b', reviewQuestionSchedules: { 'answer:0': { reviewStep: 3, nextReviewDate: new Date(now + day).toISOString() } },
    reviewGateRetry: { questionKeys: ['reverse:0'], dueAt: new Date(now).toISOString(), intervalMs: 1000, reviewStep: 0 } });
  const questions = questionsFor(legacy.reviewMemo);
  const forward = questions.find(q => q.kind === 'direct');
  const reverse = questions.find(q => q.kind === 'reverse');
  assert.deepEqual(gate.getReviewQuestionSchedules(legacy)[forward.key], legacy.reviewQuestionSchedules['answer:0']);
  assert.deepEqual(gate.getReviewGateRetryKeys(legacy), [reverse.key]);
  assert.equal(gate.getDueReviewGateRetries([legacy], now).length, 1);
});

test('full note renders every toggle and untouched text, masking only answer spans with fixed-size blanks', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차', text: '엔진:아주 길고 자세한 동력 발생 장치\n기타 메모' }]);
  const question = questionsFor(memo).find(q => q.kind === 'direct');
  const html = renderToStaticMarkup(React.createElement(noteSummary.ReviewNoteSummary, { memo, maskedKeys: [question.key] }));
  assert.match(html, /자동차/);
  assert.match(html, /엔진/);
  assert.match(html, /기타 메모/);
  assert.ok(!html.includes('아주 길고 자세한 동력 발생 장치'));
  assert.match(html, /w-24/);
  assert.match(html, /overflow-y-auto/);
  assert.equal((html.match(/data-answer-blank/g) || []).length, 1);
  assert.match(html, /aria-label="숨긴 답 보기" aria-pressed="false"/);
  const short = '엔진:힘';
  const shortHtml = renderToStaticMarkup(React.createElement(noteSummary.ReviewNoteSummary, { memo: short, maskedKeys: [questionsFor(short)[0].key] }));
  assert.equal(shortHtml.match(/data-answer-blank="true" class="([^"]+)"/)[1], html.match(/data-answer-blank="true" class="([^"]+)"/)[1]);
});

test('masking respects occurrence offsets: an identical word used as a condition elsewhere stays visible', () => {
  const memo = 'a:b // b:c';
  const questions = questionsFor(memo);
  const first = questions.find(q => q.kind === 'direct' && q.prompt === 'a');
  assert.deepEqual(noteSummary.getMaskedNoteSpans(questions, new Set([first.key])), first.answerSpans);
  const chained = questionsFor('a:b:c');
  const masks = noteSummary.getMaskedNoteSpans(chained, new Set(chained.map(q => q.key)));
  assert.deepEqual(masks.map(span => 'a:b:c'.slice(span.start, span.end)), ['c', 'c']);
});

const planningToday = new Date(2026, 9, 12, 12);
const shortPlanSubject = (overrides = {}) => ({
  id: 'deadline', name: 'Deadline', startPage: 1, totalPages: 30, completedPages: 0,
  targetDate: '2026-10-14', planResetDate: '2026-10-12',
  scheduledWeekdays: [1, 2, 3, 4, 5, 6, 0],
  scheduledWeekdayPages: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 0: 6 },
  initialAverageTimePerPage: 2, ...overrides
});

test('a deadline in three calendar days replaces a stale seven-day allocation', () => {
  const subject = shortPlanSubject();
  const diffDays = schedule.getDiffDays(subject.targetDate, planningToday);
  const plan = schedule.getWeekdayPagePlan(subject, 30, diffDays, planningToday);
  assert.equal(schedule.getPlanningDayCount(diffDays), 3);
  assert.deepEqual(plan, { 0: 0, 1: 10, 2: 10, 3: 10, 4: 0, 5: 0, 6: 0 });
  assert.equal(Object.values(plan).reduce((sum, pages) => sum + pages, 0), 30);
  const averagePages = schedule.calculateWeeklyRequiredPages(30, diffDays) / schedule.getPlanningDayCount(diffDays);
  assert.equal(averagePages, 10);
  assert.equal(averagePages * subject.initialAverageTimePerPage, 20);
});

test('only selected weekdays before or on the deadline receive whole pages', () => {
  const subject = shortPlanSubject({ totalPages: 31, scheduledWeekdays: [1, 3, 5] });
  const plan = schedule.getWeekdayPagePlan(subject, 31, 2, planningToday);
  assert.deepEqual(plan, { 0: 0, 1: 15, 2: 0, 3: 16, 4: 0, 5: 0, 6: 0 });
  assert.ok(Object.values(plan).every(Number.isInteger));
});

test('today deadlines and overdue work stay today rather than spilling into the next week', () => {
  for (const targetDate of ['2026-10-12', '2026-10-11']) {
    const subject = shortPlanSubject({ targetDate });
    const diffDays = schedule.getDiffDays(targetDate, planningToday);
    const plan = schedule.getWeekdayPagePlan(subject, 30, diffDays, planningToday);
    assert.deepEqual(plan, { 0: 0, 1: 30, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
    assert.equal(schedule.getPlanningDayCount(diffDays), 1);
  }
});

test('when all selected weekdays are past the deadline work remains available today', () => {
  const subject = shortPlanSubject({ scheduledWeekdays: [5] });
  const plan = schedule.getWeekdayPagePlan(subject, 30, 2, planningToday);
  assert.deepEqual(plan, { 0: 0, 1: 30, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
});

test('execution tasks and minutes match the short plan and disappear after the deadline', () => {
  const subject = shortPlanSubject();
  let plannedPages = 0;
  let plannedMinutes = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(planningToday);
    date.setDate(date.getDate() + offset);
    const items = buildStudyOrderForDate([subject], [], date.getDay(), schedule.getLocalDateKey(date), planningToday);
    if (offset <= 2) {
      assert.equal(items.length, 1);
      assert.equal(items[0].remainingDayPages, 10);
      assert.equal(items[0].estimatedMinutes, 20);
      plannedPages += items[0].remainingDayPages;
      plannedMinutes += items[0].estimatedMinutes;
    } else {
      assert.deepEqual(items, []);
    }
  }
  assert.equal(plannedPages, 30);
  assert.equal(plannedMinutes, 60);
});

test('manual and measured study records reduce deadline tasks through the same path', () => {
  const subject = shortPlanSubject({ completedPages: 5 });
  for (const timeSpentMinutes of [0, 10]) {
    const logs = [{ id: 'done', subjectId: subject.id, studyDate: '2026-10-12',
      timestamp: planningToday.toISOString(), pagesRead: 5, timeSpentMinutes }];
    const items = buildStudyOrderForDate([subject], logs, 1, '2026-10-12', planningToday);
    assert.equal(items[0].remainingDayPages, 5);
    assert.equal(items[0].estimatedMinutes, 10);
    assert.deepEqual(buildStudyOrderForDate([subject], logs, 4, '2026-10-15', planningToday), []);
  }
});

test('short deadline distribution includes follow-up pages and completed work disappears', () => {
  const subject = shortPlanSubject({ totalPages: 10, followUpSubjects: [
    { id: 'next', name: 'Next', startPage: 50, endPage: 69, completedPage: 49 }
  ] });
  const items = buildStudyOrderForDate([subject], [], 1, '2026-10-12', planningToday);
  assert.equal(items[0].remainingDayPages, 10);
  assert.equal(items[0].estimatedMinutes, 20);
  assert.deepEqual(buildStudyOrderForDate([shortPlanSubject({ completedPages: 30 })], [], 1, '2026-10-12', planningToday), []);
});

test('full-week plans preserve saved allocations and week totals use inclusive deadlines', () => {
  const subject = shortPlanSubject({ targetDate: '2026-10-25' });
  const diffDays = schedule.getDiffDays(subject.targetDate, planningToday);
  const plan = schedule.getWeekdayPagePlan(subject, 30, diffDays, planningToday);
  assert.deepEqual(plan, subject.scheduledWeekdayPages);
  assert.equal(schedule.calculateWeeklyRequiredPages(140, diffDays), 70);
  assert.equal(schedule.getPlanningDayCount(diffDays), 7);
});

test('carryover is included once, only today, within the remaining deadline page budget', () => {
  const subject = shortPlanSubject({ planResetDate: '2026-10-11' });
  let total = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(planningToday);
    date.setDate(date.getDate() + offset);
    const items = buildStudyOrderForDate([subject], [], date.getDay(), schedule.getLocalDateKey(date), planningToday);
    total += items.reduce((sum, item) => sum + item.remainingDayPages, 0);
    if (offset === 0) assert.ok(items[0].carryoverPages > 0);
    else assert.ok(items.every(item => item.carryoverPages === 0));
  }
  assert.equal(total, 30);
});

test('paying the carried deadline work reduces today without increasing the week total', () => {
  const before = shortPlanSubject({ planResetDate: '2026-10-11' });
  const beforeToday = buildStudyOrderForDate([before], [], 1, '2026-10-12', planningToday)[0];
  const paid = beforeToday.carryoverPages;
  const subject = { ...before, completedPages: paid };
  const logs = [{ id: 'carryover-paid', subjectId: subject.id, studyDate: '2026-10-12',
    timestamp: planningToday.toISOString(), pagesRead: paid, timeSpentMinutes: paid * 2 }];
  const afterToday = buildStudyOrderForDate([subject], logs, 1, '2026-10-12', planningToday)[0];
  assert.equal(afterToday.carryoverPages, 0);
  assert.equal(afterToday.remainingDayPages, beforeToday.remainingDayPages - paid);
  const total = [1, 2, 3].reduce((sum, weekday) => {
    const date = `2026-10-${11 + weekday}`;
    return sum + buildStudyOrderForDate([subject], logs, weekday, date, planningToday)
      .reduce((pages, item) => pages + item.remainingDayPages, 0);
  }, 0);
  assert.equal(total, 30 - paid);
});

test('partial, excess, and advance records keep the entire deadline budget consistent', () => {
  for (const planResetDate of ['2026-10-12', '2026-10-11']) {
    for (const studyDate of ['2026-10-12', '2026-10-13', '2026-10-14']) {
      for (let pagesRead = 1; pagesRead <= 30; pagesRead += 1) {
        const subject = shortPlanSubject({ planResetDate, completedPages: pagesRead });
        const logs = [{ id: 'record', subjectId: subject.id, studyDate,
          timestamp: planningToday.toISOString(), pagesRead, timeSpentMinutes: pagesRead * 2 }];
        let totalPages = 0;
        let totalMinutes = 0;
        for (let offset = 0; offset < 7; offset += 1) {
          const date = new Date(planningToday);
          date.setDate(date.getDate() + offset);
          const tasks = buildStudyOrderForDate([subject], logs, date.getDay(), schedule.getLocalDateKey(date), planningToday);
          totalPages += tasks.reduce((sum, task) => sum + task.remainingDayPages, 0);
          totalMinutes += tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
          if (offset > 2) assert.deepEqual(tasks, []);
        }
        assert.equal(totalPages, 30 - pagesRead, `${planResetDate}, ${studyDate}, ${pagesRead}P`);
        assert.equal(totalMinutes, (30 - pagesRead) * 2);
      }
    }
  }
});

test('short deadlines wrap across weekends and the full-week boundary is inclusive', () => {
  const friday = new Date(2026, 9, 16, 12);
  const subject = shortPlanSubject({ targetDate: '2026-10-19' });
  assert.deepEqual(schedule.getWeekdayPagePlan(subject, 30, 3, friday),
    { 0: 7, 1: 9, 2: 0, 3: 0, 4: 0, 5: 7, 6: 7 });
  assert.equal(schedule.getPlanningDayCount(5), 6);
  const sixDayPlan = schedule.getWeekdayPagePlan(subject, 30, 5, planningToday);
  assert.equal(sixDayPlan[0], 0);
  assert.equal(Object.values(sixDayPlan).reduce((sum, pages) => sum + pages, 0), 30);
  assert.deepEqual(schedule.getWeekdayPagePlan(subject, 30, 6, planningToday), subject.scheduledWeekdayPages);
});

test('subject detail hides daily averages and the monthly graph while retaining progress and efficiency', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const OriginalDate = global.Date;
  global.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [planningToday.getTime()])); }
    static now() { return planningToday.getTime(); }
  };
  try {
    const html = renderToStaticMarkup(React.createElement(TodaySummary, {
      logs: [], subjects: [shortPlanSubject()], tagDefinitions: [], detailSubjectId: 'deadline',
      activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {},
      onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}
    }));
    assert.ok(html.includes('학습 진척도'));
    assert.ok(html.includes('효율'));
    assert.ok(!html.includes('하루 평균 공부량'));
    assert.ok(!html.includes('최근 한 달'));
    assert.ok(!html.includes('최근 7일'));
  } finally {
    global.Date = OriginalDate;
  }
});

test('today tasks put reviews first and sort each type by requirement and shortest measured time', () => {
  const review = (id, required, minutes) => ({ id, subjectName: id, subject: { isRequired: required }, estimatedMinutes: minutes });
  const study = (id, required, minutes) => ({ subject: { id, name: id, isRequired: required }, estimatedMinutes: minutes });
  const reviews = [review('optional', false, 1), review('unknown', true, 0), review('slow', true, 8), review('fast', true, 2)];
  const studies = [study('study-optional', false, 1), study('study-unknown', true, 0), study('study-slow', true, 9), study('study-fast', true, 3)];
  const queue = buildStudyRunQueue(reviews, studies);
  assert.deepEqual(queue.map(item => item.name), ['fast', 'slow', 'unknown', 'optional', 'study-fast', 'study-slow', 'study-unknown', 'study-optional']);
  assert.deepEqual(reviews.map(item => item.id), ['optional', 'unknown', 'slow', 'fast']);
  assert.deepEqual(studies.map(item => item.subject.id), ['study-optional', 'study-unknown', 'study-slow', 'study-fast']);
  assert.equal(new Set(queue.map(item => item.key)).size, queue.length);
  assert.deepEqual(buildStudyRunQueue([], []), []);
});

test('today task list defaults to the highest priority review without starting a measurement', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const previousStorage = global.localStorage;
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const html = renderToStaticMarkup(React.createElement(SessionLogger, {
      logs: [source({ reviewSubjectIdsSnapshot: [], nextReviewDate: new Date(0).toISOString() })],
      subjects, activeWeekday: 0, activeStudyDate: '2026-10-11', detailSubjectId: '',
      onDetailSubjectChange() {}, renderSummary: (selector, _select, _done, _plan, idle, cells) => React.createElement('section', { id: 'summary' }, selector, cells, idle.startButton),
      onLogSession() {}, onReviewAction() {}, onAdvanceReviewSubject() {}, onRecordReviewSubjectTime() {},
      onUpdateReviewMemo() {}, onFinishReviewGate() {}, onClearReviewGateRetries() {}
    }));
    assert.match(html, /<h2[^>]*id="today-task-label"[^>]*>오늘 할 일<\/h2>/);
    // 고르는 목록이 아니라 상태 목록이다: 같은 과목은 한 칸이고, 그 칸에서 지금 할 차례(기본 복습)가 자동으로 "지금"이다. 줄은 버튼이 아니다.
    assert.match(html, /<ol aria-label="오늘 과목 상태"/);
    assert.match(html, /<li data-task-key="review-[^"]+" data-task-state="pending" aria-current="true"/);
    assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
    // 칸은 과목마다 하나다: 복습과목(Practice)의 복습 칸과 현재 과목(Main)의 학습 칸. 서로 다른 과목이라 따로 선다.
    assert.equal((html.match(/data-task-key=/g) || []).length, 2, 'one cell per subject');
    assert.ok(html.indexOf('data-task-key="review-') < html.indexOf('data-task-key="study-'), 'the review subject cell comes first (higher priority)');
    assert.ok(!html.includes('role="radio"') && !/<button[^>]*data-task-key/.test(html));
    assert.ok(html.includes('data-testid="task-stepper"'), 'the arrows are back');
    assert.ok(html.includes('복습 시작'));
    assert.ok(!html.includes('직접 선택'));
    assert.ok(!html.includes('요일 할 일'));
    assert.ok(!html.includes('학습 시간 측정'));
  } finally {
    global.localStorage = previousStorage;
  }
});

test('the top-priority task is selected automatically even when the detail panel points somewhere stale', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const previousStorage = global.localStorage;
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    let captured;
    const html = renderToStaticMarkup(React.createElement(SessionLogger, {
      logs: [source({ reviewSubjectIdsSnapshot: [], nextReviewDate: new Date(0).toISOString() })],
      subjects, activeWeekday: 0, activeStudyDate: '2026-10-11', detailSubjectId: 'ghost-subject',
      onDetailSubjectChange() {}, renderSummary: (selector, _select, _done, _plan, idle, cells) => { captured = idle; return React.createElement('section', null, selector, cells, idle.startButton); },
      onLogSession() {}, onReviewAction() {}, onAdvanceReviewSubject() {}, onRecordReviewSubjectTime() {},
      onUpdateReviewMemo() {}, onFinishReviewGate() {}, onClearReviewGateRetries() {}
    }));
    assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
    assert.match(html, /<li data-task-key="review-[^"]+" data-task-state="pending" aria-current="true"/, 'the review (highest priority) is the current row');
    assert.equal(captured.selectedKind, 'review');
    assert.equal(captured.memberChoices, undefined, 'one range means no tabs');
    assert.equal(typeof captured.onPickMember, 'function');
    assert.equal(captured.rowOrder.length, captured.queueCount, 'with nothing finished today the arrows walk exactly the pending tasks');
    assert.equal(captured.rowOrder[0], captured.selectedDetailKey, 'the first stop of the arrows is the auto-selected task');
    assert.deepEqual(captured.doneOnlyKeys, []);
    assert.deepEqual(captured.laterMembers, [], 'the review subject cell holds nothing but its own review, so there is no later line');
  } finally {
    global.localStorage = previousStorage;
  }
});

test('today task list has an empty state and no start button when nothing is due', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const previousStorage = global.localStorage;
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const html = renderToStaticMarkup(React.createElement(SessionLogger, {
      logs: [], subjects: [], activeWeekday: 0, activeStudyDate: '2026-10-11', detailSubjectId: '',
      onDetailSubjectChange() {}, renderSummary: (selector, _select, _done, _plan, idle, cells) => React.createElement('section', null, selector, cells, idle.startButton),
      onLogSession() {}, onReviewAction() {}, onAdvanceReviewSubject() {}, onRecordReviewSubjectTime() {},
      onUpdateReviewMemo() {}, onFinishReviewGate() {}, onClearReviewGateRetries() {}
    }));
    assert.ok(html.includes('오늘 할 일이 없습니다.'));
    assert.ok(!html.includes('role="radio"'));
    assert.ok(!html.includes('학습 시작'));
    assert.ok(!html.includes('복습 시작'));
  } finally {
    global.localStorage = previousStorage;
  }
});

test('automatically selected basic reviews keep their data visible after the source subject was deleted', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const html = renderToStaticMarkup(React.createElement(TodaySummary, {
    logs: [source({ subjectNameSnapshot: 'Archived book', basicReviewTimeRecords: [
      { pages: 4, minutes: 8, reviewNumber: 1, timestamp: new Date(now).toISOString() }
    ] })], subjects: [], tagDefinitions: [], detailSubjectId: 'basic-review:main',
    taskSelector: React.createElement('select', { 'aria-label': '오늘 할 일' }),
    activeWeekday: 0, activeStudyDate: '2026-10-11', onDetailSubjectChange() {},
    onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}
  }));
  assert.ok(html.includes('subject-live-detail'));
  assert.ok(html.includes('Archived book'));
  assert.ok(html.includes('기본 복습'));
  assert.ok(!html.includes('과목 데이터 선택'));
});

test('completed records exclude partial work and use the same remaining tasks as today selector', () => {
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  for (const pages of [0, 9, 10, 12]) {
    const subject = shortPlanSubject({ completedPages: pages });
    const logs = pages > 0 ? [{ id: 'measured', subjectId: subject.id, pagesRead: pages,
      timeSpentMinutes: pages * 2, startPage: 1, endPage: pages,
      studyDate: '2026-10-12', timestamp: planningToday.toISOString() }] : [];
    const completedIds = buildCompletedStudySubjectIds([subject], logs, 1, '2026-10-12', planningToday);
    const rows = buildCompletedSubjectSummaries(logs, [subject], completedIds, '2026-10-12');
    assert.equal(rows.length, pages >= 10 ? 1 : 0);
    if (rows.length) {
      assert.equal(rows[0].pages, pages);
      assert.equal(rows[0].minutes, pages * 2);
    }
  }
});

test('completed subject weekly minutes include only the last seven dates and do not include unfinished subjects', () => {
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  const make = (id, date, pages, minutes, subjectId = 'done') => ({ id, subjectId, studyDate: date,
    timestamp: `${date}T04:00:00Z`, pagesRead: pages, timeSpentMinutes: minutes, startPage: 1, endPage: pages });
  const logs = [make('old', '2026-10-05', 100, 200), make('boundary', '2026-10-06', 3, 6),
    make('today', '2026-10-12', 10, 20), make('future', '2026-10-13', 100, 200),
    make('partial', '2026-10-12', 2, 4, 'pending')];
  const rows = buildCompletedSubjectSummaries(logs, [{ id: 'done', name: 'Done' }], ['done'], '2026-10-12');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pages, 10);
  assert.equal(rows[0].minutes, 20);
  assert.equal(rows[0].relatedWeeklyMinutes, 26, 'only the last seven dates count: 6 + 20 minutes');
  assert.deepEqual(rows[0].logs.map(log => log.id), ['today']);
});

test('off-schedule records with no today task do not count as completing a today task', () => {
  const subject = shortPlanSubject({ targetDate: '2026-11-12', scheduledWeekdays: [2], completedPages: 3, scheduledWeekdayPages: { 2: 7 } });
  const logs = [{ id: 'extra', subjectId: subject.id, pagesRead: 3, timeSpentMinutes: 6,
    studyDate: '2026-10-12', timestamp: planningToday.toISOString() }];
  assert.deepEqual(buildCompletedStudySubjectIds([subject], logs, 1, '2026-10-12', planningToday), []);
});

test('carried work must also be paid before a today subject is a completed record', () => {
  const subject = shortPlanSubject({ totalPages: 200, targetDate: '2026-11-12', planResetDate: '2026-10-10' });
  const task = buildStudyOrderForDate([subject], [], 1, '2026-10-12', planningToday)[0];
  assert.ok(task.carryoverPages > 0);
  for (const pages of [task.remainingDayPages - 1, task.remainingDayPages]) {
    const updated = schedule.adjustSubjectProgress(subject, pages);
    const logs = [{ id: 'carry', subjectId: subject.id, pagesRead: pages, timeSpentMinutes: pages * 2,
      studyDate: '2026-10-12', timestamp: planningToday.toISOString() }];
    assert.deepEqual(buildCompletedStudySubjectIds([updated], logs, 1, '2026-10-12', planningToday),
      pages === task.remainingDayPages ? [subject.id] : []);
  }
});

test('completed review records exclude save-only measurements and use their completion date rather than original study date', () => {
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  const oldLog = source({ studyDate: '2026-09-01', basicReviewTimeRecords: [
    { pages: 3, minutes: 6, timestamp: '2026-10-12T04:00:00Z' }
  ], reviewSubjectTimeRecords: [
    { subjectId: 'partial', completed: false, pages: 20, minutes: 4, timestamp: '2026-10-12T04:00:00Z' },
    { subjectId: 'review', completed: false, pages: 20, minutes: 4, timestamp: '2026-10-11T04:00:00Z' },
    { subjectId: 'review', completed: true, pages: 5, minutes: 10, timestamp: '2026-10-12T04:00:00Z' }
  ] });
  const rows = buildCompletedSubjectSummaries([oldLog], subjects, [], '2026-10-12');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.kind === 'review'));
  assert.ok(!rows.some(row => row.subjectId === 'partial'));
  const basic = rows.find(row => row.detailId.startsWith('basic-review:'));
  assert.equal(basic.relatedWeeklyMinutes, 6);
  const review = rows.find(row => row.subjectId === 'review');
  assert.equal(review.relatedWeeklyMinutes, 14);
});

test('new plans start at the requested page without imported efficiency or earlier completed work', () => {
  const { createNewStudyPlan, SubjectPlanner } = loadSource('components/SubjectPlanner.tsx');
  const subject = createNewStudyPlan('New book', 23, 50, '2026-12-31', true, [1, 3, 5]);
  assert.equal(schedule.getActiveSubjectStage(subject).currentPage, 23);
  assert.equal(schedule.getSubjectRemainingPageCount(subject), 28);
  assert.equal(subject.initialAverageTimePerPage, undefined);
  assert.equal(schedule.getSubjectCompletedPageCount(subject), 0);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(SubjectPlanner, { onAddSubject() {} }));
  assert.ok(html.includes('시작 페이지'));
  assert.ok(html.includes('끝 페이지'));
  assert.ok(!html.includes('현재 완료 페이지'));
  assert.ok(!html.includes('기존 효율 가져오기'));
});

test('first review inherits the matching parent measurement, not unrelated own-book efficiency', () => {
  const math = loadSource('utils/math.ts');
  const parent = { id: 'parent', name: 'Parent', startPage: 1, totalPages: 100, completedPages: 10, targetDate: '2026-12-31',
    initialAverageTimePerPage: 100, reviewSubjectIds: ['practice'] };
  const practice = { ...parent, id: 'practice', name: 'Practice', reviewSubjectIds: [], initialAverageTimePerPage: 50 };
  const parentLog = { id: 'review-range', subjectId: 'parent', pagesRead: 10, startPage: 1, endPage: 10,
    timeSpentMinutes: 1000, timestamp: '2026-10-10T04:00:00Z', reviewEnabled: true, nextReviewDate: '2026-10-11T04:00:00Z' };
  const ownLog = { ...parentLog, id: 'own-pages', subjectId: 'practice', pagesRead: 2, timeSpentMinutes: 30 };
  assert.equal(math.resolveSubjectReviewAverageTimePerPage([parentLog, ownLog], 'parent', 'practice', [parent, practice]), 100);
  const measured = { ...parentLog, reviewSubjectTimeRecords: [
    { subjectId: 'practice', completed: true, pages: 10, minutes: 30, timestamp: '2026-10-10T04:00:00Z' },
    { subjectId: 'other', completed: true, pages: 1, minutes: 200, timestamp: '2026-10-11T04:00:00Z' },
    { subjectId: 'practice', completed: false, pages: 10, minutes: 100, timestamp: '2026-10-11T04:00:00Z' }
  ] };
  assert.equal(math.calculateSubjectReviewAverageTimePerPage([measured, ownLog], 'parent', 'practice'), 0);
  const group = buildDueReviewGroups([{ ...measured, pagesRead: 4, startPage: 11, endPage: 14 }], [parent, practice], Date.parse('2026-10-12T04:00:00Z'))[0];
  assert.equal(group.subjectId, 'practice');
  // Legacy measurements without a baseline cannot supply an invented percentage.
  assert.equal(group.averageTimePerPage, 250);
  assert.equal(group.estimatedMinutes, 1000);
});

test('save-only review times remain pending until full completion and combine actual pages only', () => {
  const { recordSubjectReviewTime } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const original = { id: 'upper', subjectId: 'parent', pagesRead: 10, timeSpentMinutes: 20, timestamp: '2026-10-10T04:00:00Z' };
  const firstSave = recordSubjectReviewTime(original, 'practice', 5, false, '2026-10-11T04:00:00Z', measurement('save1', 1, 2));
  const secondSave = recordSubjectReviewTime(firstSave, 'practice', 7, false, '2026-10-11T05:00:00Z', measurement('save2', 2, 2));
  assert.equal(math.calculateSubjectReviewAverageTimePerPage([secondSave], 'parent', 'practice'), 0);
  const completed = recordSubjectReviewTime(secondSave, 'practice', 18, true, '2026-10-12T04:00:00Z', measurement('finish', 3, 2));
  assert.equal(completed.reviewSubjectTimeRecords.length, 1);
  assert.equal(completed.reviewSubjectTimeRecords[0].minutes, 30);
  assert.equal(completed.reviewSubjectTimeRecords[0].pages, 6);
  assert.equal(completed.reviewSubjectTimeRecords[0].completed, true);
  assert.equal(math.calculateSubjectReviewAverageTimePerPage([completed], 'parent', 'practice'), 5);
  assert.equal(original.reviewSubjectTimeRecords, undefined);
  const anotherSubject = recordSubjectReviewTime(secondSave, 'other', 20, true, '2026-10-12T04:00:00Z', measurement('other', 4, 2));
  assert.equal(anotherSubject.reviewSubjectTimeRecords.find(record => record.subjectId === 'other').minutes, 20);
  assert.equal(anotherSubject.reviewSubjectTimeRecords.filter(record => record.subjectId === 'practice').length, 2);
  const nextRound = recordSubjectReviewTime({ ...secondSave, reviewStep: 1 }, 'practice', 20, true, '2026-10-13T04:00:00Z', measurement('next-round', 4, 2));
  assert.equal(nextRound.reviewSubjectTimeRecords.find(record => record.completed).minutes, 20);
});

test('review averages use the newest completed page unit and exclude unrelated measurements', () => {
  const math = loadSource('utils/math.ts');
  const logs = [{ subjectId: 'parent', pagesRead: 1, timeSpentMinutes: 1, timestamp: '2020-01-01T00:00:00Z',
    reviewSubjectTimeRecords: [
      { subjectId: 'practice', measurementId: 'old', pages: 100, minutes: 600, completed: true, timestamp: '2026-10-10T04:00:00Z' },
      { subjectId: 'practice', measurementId: 'recent', pages: 150, minutes: 600, completed: true, timestamp: '2026-10-11T04:00:00Z' }
    ] }];
  assert.equal(math.calculateSubjectReviewAverageTimePerPage(logs, 'parent', 'practice'), 4);
  assert.equal(math.calculateSubjectReviewAverageTimePerPage(logs, 'elsewhere', 'practice'), 0);
});

test('ordinary efficiency uses the newest completed page unit instead of the former time window', () => {
  const math = loadSource('utils/math.ts');
  const samples = [
    { pagesRead: 20, timeSpentMinutes: 200, timestamp: '2026-10-01T03:00:00Z' },
    { pagesRead: 50, timeSpentMinutes: 200, timestamp: '2026-10-12T03:00:00Z' },
    { pagesRead: 5000, timeSpentMinutes: 200, timestamp: '2020-01-01T03:00:00Z' }
  ];
  assert.equal(math.calculateRecentTimedPageAverage(samples).averageTimePerPage, 4);
  assert.equal(math.calculateRecentCompletedDayAverage(samples, 0).averageTimePerPage, 4);
});

test('finished records are merged into the subject status rows and the separate completed list is gone', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary, buildCompletedDetailRows } = loadSource('components/TodaySummary.tsx');
  const doneLogs = [{ id: 'done', subjectId: 'deadline', studyDate: '2026-10-12', timestamp: planningToday.toISOString(), pagesRead: 10, timeSpentMinutes: 20 }];
  const subjectsForDone = [shortPlanSubject({ completedPages: 10 })];
  const rows = buildCompletedDetailRows(doneLogs, subjectsForDone, ['deadline'], '2026-10-12');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detailId, 'deadline');
  assert.equal(rows[0].kind, 'study');
  assert.equal(rows[0].summary, '10P · 20분 · 2분/P');
  // 하루 평균: 오늘 처음 공부했으면 오늘 하루로 나눈다(20분 ÷ 1). 7일이 지나면 최근 7일 ÷ 7. 합계 글자(최근 7일 …)는 행에 들어 있지 않다.
  assert.equal(rows[0].dailyAverageMinutes, 20);
  const threeDays = [{ ...doneLogs[0], id: 'old', studyDate: '2026-10-10', timestamp: '2026-10-10T03:00:00.000Z', timeSpentMinutes: 10 }, ...doneLogs];
  assert.equal(buildCompletedDetailRows(threeDays, subjectsForDone, ['deadline'], '2026-10-12')[0].dailyAverageMinutes, 10, '30 minutes over 3 days');
  const longAgo = [{ ...doneLogs[0], id: 'older', studyDate: '2026-09-01', timestamp: '2026-09-01T03:00:00.000Z', timeSpentMinutes: 10 }, ...doneLogs];
  assert.equal(buildCompletedDetailRows(longAgo, subjectsForDone, ['deadline'], '2026-10-12')[0].dailyAverageMinutes, 2.9, 'a week has passed: ÷ 7');
  assert.ok(!('weekly' in rows[0]) && !('weeklyMinutes' in rows[0]) && !('weeklyPages' in rows[0]));
  const html = renderToStaticMarkup(React.createElement(TodaySummary, {
    logs: doneLogs, subjects: subjectsForDone, completedStudySubjectIds: ['deadline'],
    detailSubjectId: 'deadline', taskSelector: null, activeWeekday: 1, activeStudyDate: '2026-10-12',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}
  }));
  // 예전의 "오늘 완료된 기록" 목록은 없다. 고치고 지우는 일만 상세 칸의 "오늘 한 기록"에서 한다.
  assert.ok(!html.includes('완료된 기록'));
  assert.ok(html.includes('aria-label="오늘 한 기록"'));
  assert.ok(html.includes('10P · 20분'));
  assert.ok(html.includes('aria-label="합산 기록 수정"') && html.includes('aria-label="합산 기록 삭제"'));
  // "직접 추가"는 없어지고, 지금 보는 과목에 더하는 "학습량 추가" 버튼이 상세 칸 위쪽에 있다.
  assert.ok(!html.includes('직접 추가'));
  assert.ok(html.includes('aria-label="학습량 추가"'));
  assert.ok(!html.includes('실시간 기록'));
  assert.ok(!html.includes('하루 평균 공부량'));
  assert.ok(!html.includes('최근 한 달'));
});

test('status cells are small: pending ones carry no done data, a finished subject turns gray and shows its record', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TaskQueueList } = loadSource('components/TodayTasks.tsx');
  const items = [
    { key: 'review-a', detailKey: 'basic-review:a', kind: 'review', kindLabel: '기본 복습', title: 'A', meta: '범위 1~10', required: false, timeLabel: '18분', state: 'pending',
      done: { summary: '10P · 9분 · 0.9분/P', weekly: '최근 7일 45분 · 30P', short: '10P · 9분' } },
    { key: 'study-b', detailKey: 'b', kind: 'study', kindLabel: '학습', title: 'B', meta: '오늘 권장 p.1~3 · 3P', required: true, timeLabel: '10분', state: 'pending' },
    { key: 'done-c', detailKey: 'c', kind: 'study', kindLabel: '학습', title: 'C', meta: '', required: false, timeLabel: '', state: 'done',
      done: { summary: '4P · 14분 · 3.5분/P', weekly: '최근 7일 62분 · 24P', short: '4P · 14분' } }
  ];
  const html = renderToStaticMarkup(React.createElement(TaskQueueList, { items, currentKey: 'c', onRefresh() {} }));
  const rowOf = key => html.slice(html.indexOf(`data-task-key="${key}"`)).split('</li>')[0];
  // 가로로 늘어놓는 작은 셀: 한 줄 이름 + 한 줄 정보. 평균·주간 값 같은 긴 정보는 셀에 없다.
  assert.ok(html.includes('grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'));
  assert.ok(rowOf('review-a').includes('기본 복습') && rowOf('review-a').includes('18분'));
  assert.ok(!rowOf('review-a').includes('task-done-data') && !rowOf('review-a').includes('10P'), 'a subject not fully done shows no completion record');
  assert.ok(!rowOf('study-b').includes('data-testid="task-done-data"'));
  const done = rowOf('done-c');
  assert.ok(done.includes('data-task-state="done"') && done.includes('bg-slate-100'), 'finished cell is gray');
  assert.ok(done.includes('✓ 4P · 14분') && done.includes('보는 중') && done.includes('aria-current="true"'));
  assert.ok(!done.includes('최근 7일') && !done.includes('3.5분/P') && !done.includes('필요'), 'only the short record, nothing long');
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
  assert.ok(!html.includes('role="dialog"') && !/<li[^>]*>\s*<button/.test(html));
});

const reviewChainSubjects = [
  { id: 'parent', name: 'Parent', startPage: 1, totalPages: 100, completedPages: 10,
    targetDate: '2026-12-31', reviewSubjectIds: ['first', 'second'] },
  // 복습과목의 기본 성장 표시는 이제 단위(복습 한 번) 비교다. 이 묶음의 시험들은 '이번 복습' 비율 표시를 보므로 직접 골라 둔다
  { id: 'first', name: 'First', startPage: 20, totalPages: 200, completedPages: 19, targetDate: '2026-12-31', reviewGrowthDisplay: 'review' },
  { id: 'second', name: 'Second', startPage: 30, totalPages: 300, completedPages: 29, targetDate: '2026-12-31', reviewGrowthDisplay: 'review' }
];
const chainLog = (id = 'source', overrides = {}) => ({
  id, subjectId: 'parent', pagesRead: 10, timeSpentMinutes: 30, reviewStep: 0,
  reviewSubjectIdsSnapshot: ['first', 'second'], timestamp: '2026-10-10T04:00:00Z', ...overrides
});
const measurement = (id, pagesRead, baselineTimePerPage, lastEndPage = 80) => ({
  measurementId: id, pagesRead, baselineTimePerPage, lastEndPage
});
test('review chain hands off actual completed own pages and rate to the next subject', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  let logs = [chainLog()];
  const first = math.calculateReviewSubjectTiming(logs, 'parent', 'first', reviewChainSubjects, logs);
  assert.equal(first.pages, 10);
  assert.equal(first.baselineTimePerPage, 3);
  assert.equal(first.estimatedMinutes, 30);
  logs = recordReviewMeasurement(logs, ['source'], 'first', 20, true, '2026-10-11T04:00:00Z', measurement('one', 5, 3));
  const record = logs[0].reviewSubjectTimeRecords[0];
  assert.equal(record.pages, 5);
  assert.equal(record.lastEndPage, 80);
  assert.ok(Math.abs(record.timeChangePercent - 100 / 3) < 1e-9);
  const second = math.calculateReviewSubjectTiming(logs, 'parent', 'second', reviewChainSubjects, logs);
  assert.equal(second.pages, 5);
  assert.equal(second.baselineTimePerPage, 4);
  assert.equal(second.estimatedMinutes, 20);
  logs = recordReviewMeasurement(logs, ['source'], 'second', 24, true, '2026-10-11T05:00:00Z', measurement('two', 3, 4, 150));
  assert.equal(logs[0].reviewSubjectTimeRecords[1].timeChangePercent, 100);
  assert.equal(math.calculateSubjectReviewAverageTimePerPage(logs, 'parent', 'second'), 8);
});
test('review forecasts reuse their latest measured unit rates across rounds rather than the old percentage forecast', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  let history = recordReviewMeasurement([chainLog()], ['source'], 'first', 20, true, '2026-10-11T04:00:00Z', measurement('one', 5, 3));
  history = recordReviewMeasurement(history, ['source'], 'second', 24, true, '2026-10-11T05:00:00Z', measurement('two', 3, 4));
  const fresh = chainLog('fresh', { pagesRead: 6, timeSpentMinutes: 12 });
  const logs = [...JSON.parse(JSON.stringify(history)), fresh];
  const first = math.calculateReviewSubjectTiming(logs, 'parent', 'first', reviewChainSubjects, [fresh]);
  assert.equal(first.averageTimePerPage, 4);
  assert.equal(first.estimatedMinutes, 24);
  const second = math.calculateReviewSubjectTiming(logs, 'parent', 'second', reviewChainSubjects, [fresh]);
  assert.equal(second.estimatedMinutes, 48);
  const nextRound = { ...fresh, reviewStep: 1 };
  assert.equal(math.calculateReviewSubjectTiming(logs, 'parent', 'first', reviewChainSubjects, [nextRound]).estimatedMinutes, 24);
});
test('percentage average counts a merged measurement once and separates parents and rounds', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  let logs = [chainLog('a', { pagesRead: 2, timeSpentMinutes: 6 }), chainLog('b', { pagesRead: 8, timeSpentMinutes: 24 })];
  logs = recordReviewMeasurement(logs, ['a', 'b'], 'first', 20, true, '2026-10-11T04:00:00Z', measurement('merged', 5, 3));
  assert.equal(logs.reduce((sum, log) => sum + log.reviewSubjectTimeRecords[0].pages, 0), 5);
  const next = chainLog('c');
  logs = recordReviewMeasurement([...logs, next], ['c'], 'first', 30, true, '2026-10-11T05:00:00Z', measurement('separate', 10, 3));
  assert.ok(Math.abs(math.calculateReviewTimeChangeAverage(logs, 'parent', 'first', 1) - 50 / 3) < 1e-9);
  assert.equal(math.calculateReviewTimeChangeAverage(logs, 'unrelated', 'first'), null);
  assert.equal(math.calculateReviewTimeChangeAverage(logs, 'parent', 'first', 2), null);
});
test('partial review saves aggregate actual pages and time without counting a full parent range', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  let logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 6, false, '2026-10-11T04:00:00Z', measurement('partial', 2, 3));
  assert.equal(math.calculateReviewTimeChangeAverage(logs, 'parent', 'first'), null);
  const resumed = math.calculateReviewSubjectTiming(logs, 'parent', 'first', reviewChainSubjects, logs);
  assert.equal(resumed.remainingPages, 8);
  assert.equal(resumed.estimatedMinutes, 24);
  logs = recordReviewMeasurement(logs, ['source'], 'first', 14, true, '2026-10-11T05:00:00Z', measurement('done', 3, 3));
  assert.equal(logs[0].reviewSubjectTimeRecords.length, 1);
  assert.equal(logs[0].reviewSubjectTimeRecords[0].pages, 5);
  assert.equal(logs[0].reviewSubjectTimeRecords[0].minutes, 20);
  assert.equal(math.calculateReviewSubjectTiming(logs, 'parent', 'second', reviewChainSubjects, logs).pages, 5);
});
test('review end pages update normal progress and resume on the following page', () => {
  const { applyReviewPageCursor } = loadSource('utils/review.ts');
  const subject = reviewChainSubjects[1];
  const updated = applyReviewPageCursor(subject, { reviewParentSubjectId: 'parent', pagesRead: 5, endPage: 80 });
  assert.equal(updated.reviewStartPage, undefined);
  assert.equal(updated.completedPages, 80);
  assert.equal(schedule.getActiveSubjectStage(updated).currentPage, 81);
  assert.equal(subject.reviewStartPage, undefined);
  assert.equal(applyReviewPageCursor(subject, { pagesRead: 5, endPage: 80 }), subject);
});

test('study and review page amounts come from inclusive start/end ranges without a separate quantity', () => {
  const { calculateStudyPageAmount } = loadSource('utils/review.ts');
  assert.equal(calculateStudyPageAmount(13, 13, 88, true), 1);
  assert.equal(calculateStudyPageAmount(13, 17, 88, true), 5);
  assert.equal(calculateStudyPageAmount(13, 100, 88, true), 88);
  assert.equal(calculateStudyPageAmount(13, 12, 88, true), null);
  assert.equal(calculateStudyPageAmount(13, 101, 88, true), null);
  assert.equal(calculateStudyPageAmount(13, 17.5, 88, true), null);
  assert.equal(calculateStudyPageAmount(NaN, 17, 88, true), null);
  assert.equal(calculateStudyPageAmount(13, 17, 0, true), null);
  assert.equal(calculateStudyPageAmount(2.5, 4.5, 10), 2);
});

test('range-based review records keep timing, speed, completion rows and next-subject baselines consistent', () => {
  const { calculateStudyPageAmount, recordReviewMeasurement, applyReviewPageCursor } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  const pages = calculateStudyPageAmount(20, 24, 181, true);
  let logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 10, true,
    '2026-10-12T04:00:00Z', measurement('range-complete', pages, 3, 24));
  const updated = applyReviewPageCursor(reviewChainSubjects[1], {
    reviewParentSubjectId: 'parent', reviewPageRangeBased: true, startPage: 20, endPage: 24, pagesRead: pages
  });
  assert.equal(schedule.getActiveSubjectStage(updated).currentPage, 25);
  assert.equal(math.calculateSubjectReviewAverageTimePerPage(logs, 'parent', 'first'), 2);
  assert.deepEqual(math.calculateReviewSpeedChanges(logs, 'parent', 'first'), { average: 50, latest: 50 });
  const next = math.calculateReviewSubjectTiming(logs, 'parent', 'second', reviewChainSubjects, logs);
  assert.equal(next.pages, 5);
  assert.equal(next.averageTimePerPage, 2);
  assert.equal(next.estimatedMinutes, 10);
  const row = buildCompletedSubjectSummaries(logs, reviewChainSubjects, [], '2026-10-12')[0];
  assert.equal(row.pages, 5);
  assert.equal(row.minutes, 10);
  assert.equal(row.reviewSpeedChangePercent, 50);
});

test('a completed preceding review book still supplies the next stage timing even if no longer runnable', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 10, true,
    '2026-10-12T04:00:00Z', measurement('first-done', 5, 3));
  const subjects = reviewChainSubjects.map(subject => subject.id === 'first' ? { ...subject, completedPages: 200 } : subject);
  const next = math.calculateReviewSubjectTiming(logs, 'parent', 'second', subjects, logs, ['second']);
  assert.equal(next.pages, 5);
  assert.equal(next.baselineTimePerPage, 2);
  assert.equal(next.estimatedMinutes, 10);
});

test('finishing a review stage advances to a follow-up start and retires the separate legacy cursor', () => {
  const { applyReviewPageCursor } = loadSource('utils/review.ts');
  const subject = { ...reviewChainSubjects[1], reviewStartPage: 198, followUpSubjects: [
    { id: 'follow', name: 'Next', startPage: 30, endPage: 50, completedPage: 29 }
  ] };
  const finished = applyReviewPageCursor(subject, { reviewParentSubjectId: 'parent', subjectStageId: 'first', endPage: 200 });
  assert.equal(finished.reviewStartPage, undefined);
  assert.equal(schedule.getActiveSubjectStage(finished).currentPage, 30);
  const next = applyReviewPageCursor(finished, { reviewParentSubjectId: 'parent', subjectStageId: 'follow', endPage: 34 });
  assert.equal(schedule.getActiveSubjectStage(next).currentPage, 35);
  assert.equal(next.completedPages, 200);
});

test('legacy review cursors cannot override a new follow-up range or restart a finished book', () => {
  const { getReviewStartPage } = loadSource('utils/review.ts');
  assert.equal(getReviewStartPage({ ...reviewChainSubjects[1], reviewStartPage: 80 }), 80);
  assert.equal(getReviewStartPage({ ...reviewChainSubjects[1], completedPages: 200 }), null);
  assert.equal(getReviewStartPage({ ...reviewChainSubjects[1], completedPages: 200, reviewStartPage: 198,
    followUpSubjects: [{ id: 'next', name: 'Next', startPage: 30, endPage: 50, completedPage: 29 }] }), 30);
});
test('missing preceding timing does not manufacture improvement percentages', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const logs = recordReviewMeasurement([chainLog('source', { timeSpentMinutes: 0 })], ['source'], 'first', 10, true,
    '2026-10-11T04:00:00Z', measurement('unknown', 5, 0));
  assert.equal(logs[0].reviewSubjectTimeRecords[0].timeChangePercent, undefined);
  assert.equal(math.calculateReviewTimeChangeAverage(logs, 'parent', 'first'), null);
  const second = math.calculateReviewSubjectTiming(logs, 'parent', 'second', reviewChainSubjects, logs);
  assert.equal(second.baselineTimePerPage, 2);
  assert.equal(second.estimatedMinutes, 10);
});

test('displayed review speed gains use inverse time ratios and average complete measurements once', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  let logs = [chainLog('a', { pagesRead: 2 }), chainLog('b', { pagesRead: 8 }), chainLog('c')];
  logs = recordReviewMeasurement(logs, ['a', 'b'], 'first', 10, true, '2026-10-12T03:00:00Z', measurement('merged', 5, 3));
  logs = recordReviewMeasurement(logs, ['c'], 'first', 30, true, '2026-10-12T04:00:00Z', measurement('latest', 10, 3));
  assert.deepEqual(math.calculateReviewSpeedChanges(logs, 'parent', 'first'), { average: 25, latest: 0 });
  assert.equal(math.calculateReviewTimeChangeAverage(logs, 'parent', 'first', 1), -100 / 6);
  assert.deepEqual(math.calculateReviewSpeedChanges(logs, 'other', 'first'), { average: null, latest: null });
});

test('latest speed stays unmeasured for an unknown baseline without hiding an older measured average', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  let logs = [chainLog('old'), chainLog('new')];
  logs = recordReviewMeasurement(logs, ['old'], 'first', 10, true, '2026-10-11T03:00:00Z', measurement('old', 5, 3));
  logs = recordReviewMeasurement(logs, ['new'], 'first', 10, true, '2026-10-12T04:00:00Z', measurement('unknown', 5, 0));
  assert.deepEqual(math.calculateReviewSpeedChanges(logs, 'parent', 'first'), { average: 50, latest: null });
});

test('a partial review today cannot show an older completed review as this review improvement', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const logs = recordReviewMeasurement([chainLog('old')], ['old'], 'first', 10, true,
    '2026-10-11T03:00:00Z', measurement('old-review', 5, 3));
  logs.push(source({ id: 'partial', subjectId: 'first', reviewParentSubjectId: 'parent', pomodoroSession: true,
    pagesRead: 1, timeSpentMinutes: 4, timestamp: '2026-10-12T04:00:00Z' }));
  assert.deepEqual(math.calculateReviewSpeedChanges(logs, 'parent', 'first', '2026-10-12'), { average: 50, latest: null });
  assert.deepEqual(math.calculateReviewSpeedChanges(logs, 'parent', 'first', '2026-10-11'), { average: 50, latest: 50 });
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { logs, subjects: reviewChainSubjects,
    detailSubjectId: 'first', activeWeekday: 1, activeStudyDate: '2026-10-12', taskSelector: '오늘 할 일',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} }));
  // 기준 3분/P → 2분/P: 1시간에 푸는 장수 20 → 30(속도 +10.0P/h), 한 페이지에 쓴 시간 −1분(공부량 −1.0분/P). 퍼센트는 쓰지 않는다.
  assert.ok(html.includes('review-speed-growth') && html.includes('data-growth-kind="speed"') && html.includes('data-growth-kind="amount"'));
  assert.ok(!html.includes('+50.0%'));
  const averageCell = html.slice(html.indexOf('평균 증가율'), html.indexOf('이번 복습 증가율'));
  assert.match(averageCell, />\+10\.0<\/span>/);
  assert.match(averageCell, />−1\.0<\/span>/);
  assert.match(html, /이번 복습 증가율<\/p><p[^>]*>-<\/p>/);
});

test('completed review rows keep each completion separate while merging allocations and showing its own speed, pages and minutes', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  let logs = [chainLog('a', { pagesRead: 2 }), chainLog('b', { pagesRead: 8 }), chainLog('c'), chainLog('pending')];
  logs = recordReviewMeasurement(logs, ['a', 'b'], 'first', 10, true, '2026-10-12T03:00:00Z', measurement('merged', 5, 3));
  logs = recordReviewMeasurement(logs, ['c'], 'first', 30, true, '2026-10-12T04:00:00Z', measurement('latest', 10, 3));
  logs = recordReviewMeasurement(logs, ['pending'], 'first', 2, false, '2026-10-12T05:00:00Z', measurement('pending', 1, 3));
  const rows = buildCompletedSubjectSummaries(logs, reviewChainSubjects, [], '2026-10-12');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].pages, 10);
  assert.equal(rows[0].minutes, 30);
  assert.equal(rows[0].reviewSpeedChangePercent, 0);
  assert.equal(rows[1].pages, 5);
  assert.equal(rows[1].minutes, 10);
  assert.equal(rows[1].reviewSpeedChangePercent, 50);
  assert.notEqual(rows[0].recordKey, rows[1].recordKey);
  // 과목과 이어진 모두의 최근 7일: 부모 학습 4번(30분씩 120분) + 복습 측정 10·30·2분 = 162분
  assert.ok(rows.every(row => row.relatedWeeklyMinutes === 162));
});

test('today status list sits next to the detail, with compact pomodoro and both growth metrics below progress', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const props = { logs: [], subjects: reviewChainSubjects.map(subject => subject.id === 'first'
    ? { ...subject, reviewGrowthDisplay: 'unit' } : subject), completedStudySubjectIds: [], detailSubjectId: 'first',
    taskSelector: '오늘 할 일 테스트', activeWeekday: 1, activeStudyDate: '2026-10-12',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const empty = renderToStaticMarkup(React.createElement(TodaySummary, props));
  assert.ok(!empty.includes('완료된 기록'));
  assert.ok(empty.indexOf('오늘 할 일 테스트') < empty.indexOf('학습 진척도'), 'status cells come first (at the top)');
  assert.ok(empty.indexOf('다음 시작') < empty.indexOf('학습 진척도'));
  // 큰 칸 두 개: 왼쪽 "공부 시작"(시작 페이지 · 뽀모도로), 오른쪽 "성장"(진척도 · 전체 효율 · 타임어택 효율 · 다음 단위까지)
  assert.ok(empty.indexOf('aria-label="공부 시작"') < empty.indexOf('뽀모도로'));
  assert.ok(empty.indexOf('뽀모도로') < empty.indexOf('aria-label="성장"'), 'start things are all in the left cell');
  assert.ok(empty.indexOf('aria-label="성장"') < empty.indexOf('학습 진척도'));
  assert.ok(empty.indexOf('학습 진척도') < empty.indexOf('전체 효율'));
  assert.ok(empty.indexOf('전체 효율') < empty.indexOf('타임어택 효율'));
  assert.ok(empty.indexOf('타임어택 효율') < empty.indexOf('이번 단위'));
  assert.ok(empty.includes('lg:grid-cols-2'), 'start cell and growth cell side by side');
  assert.ok((empty.match(/측정 필요/g) || []).length >= 2);
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 10, true,
    '2026-10-12T03:00:00Z', measurement('done', 5, 3));
  const filled = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, logs, subjects: reviewChainSubjects }));
  // 평균 속도 증가율 · 이번 복습 증가율 두 칸. (예전에는 완료 기록 줄에도 한 번 더 나왔지만 그 목록은 없어졌다.)
  assert.equal((filled.match(/data-testid="review-change"/g) || []).length, 2);
  assert.equal((filled.match(/>\+10\.0<\/span>/g) || []).length, 2, 'speed: 10 more pages per hour, in both cells');
  assert.equal((filled.match(/>−1\.0<\/span>/g) || []).length, 2, 'study amount: 1 minute less per page, in both cells');
  assert.ok(!filled.includes('+50.0%'));
  const filledRows = loadSource('components/TodaySummary.tsx').buildCompletedDetailRows(logs, reviewChainSubjects, [], '2026-10-12');
  assert.equal(filledRows.length, 1);
  assert.equal(filledRows[0].detailId, 'first');
  assert.equal(filledRows[0].summary, '5P · 10분 · 2분/P');
  assert.equal(filledRows[0].growth, '이번 복습 속도 +10.0P/h · 공부량 −1.0분/P');
});

test('clearing a completed review selection chooses the current highest priority without forcing measurement', () => {
  const { getSelectedRunQueueItem } = loadSource('components/SessionLogger.tsx');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const now = Date.parse('2026-10-12T04:00:00Z');
  const base = chainLog('source', { startPage: 1, endPage: 10, nextReviewDate: '2026-10-12T03:00:00Z', reviewGatePendingResult: 'correct' });
  const recorded = recordReviewMeasurement([base], ['source'], 'first', 10, true,
    '2026-10-12T04:00:00Z', measurement('done', 5, 3));
  const pending = recorded.map(log => ({ ...log, reviewSubjectId: 'second' }));
  const queue = buildStudyRunQueue(buildDueReviewGroups(pending, reviewChainSubjects, now), []);
  assert.equal(getSelectedRunQueueItem(queue, '').reviewGroup.subjectId, 'second');
  const completed = pending.map(log => ({ ...log, ...gate.completeRegularReviewSchedule(log, now), isReviewed: true }));
  const studyQueue = buildStudyRunQueue(buildDueReviewGroups(completed, reviewChainSubjects, now), [
    { subject: { ...reviewChainSubjects[0], id: 'required', isRequired: true }, remainingDayPages: 1, averageTimePerPage: 5, estimatedMinutes: 5 },
    { subject: { ...reviewChainSubjects[0], id: 'optional' }, remainingDayPages: 1, averageTimePerPage: 1, estimatedMinutes: 1 }
  ]);
  assert.equal(getSelectedRunQueueItem(studyQueue, '').studyItem.subject.id, 'required');
  assert.equal(getSelectedRunQueueItem([], ''), undefined);
});

test('end pages automatically suggest quantity but manual quantity alone determines efficiency', () => {
  const { getAutoSolvedPageCount, createPageMeasurement, getLogProgressPages } = loadSource('utils/measurement.ts');
  const { applySessionEndPage } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  assert.equal(getAutoSolvedPageCount(13, 13), 1);
  assert.equal(getAutoSolvedPageCount(13, 17), 5);
  assert.equal(getAutoSolvedPageCount(13, 18), 6);
  assert.equal(getAutoSolvedPageCount(13, NaN), null);
  const log = { ...createPageMeasurement(13, 17, 3, 88), id: 'manual', subjectId: 'study',
    timeSpentMinutes: 15, timestamp: '2026-10-12T03:00:00Z' };
  const subject = { id: 'study', name: 'Study', startPage: 1, totalPages: 100, completedPages: 12, targetDate: '2026-12-31' };
  const advanced = applySessionEndPage(subject, log);
  assert.equal(log.pagesRead, 3);
  assert.equal(math.calculateStats([log], 83).averageTimePerPage, 5);
  assert.equal(advanced.completedPages, 17);
  assert.equal(schedule.getActiveSubjectStage(advanced).currentPage, 18);
  assert.equal(getLogProgressPages(log), 5);
  assert.equal(getLogProgressPages({ ...log, pagesRead: 8 }), 5);
  assert.equal(createPageMeasurement(13, 101, 3, 88), null);
  assert.equal(createPageMeasurement(13, 17, 0, 88), null);
  assert.equal(createPageMeasurement(13, 17, 1.5, 88), null);
});

test('review efficiency, speed and successor estimates also use the explicit quantity rather than the endpoint', () => {
  const { createPageMeasurement } = loadSource('utils/measurement.ts');
  const { recordReviewMeasurement, applySessionEndPage } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const ownLog = { ...createPageMeasurement(20, 24, 3, 181), reviewParentSubjectId: 'parent' };
  const logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 12, true,
    '2026-10-12T03:00:00Z', measurement('manual-review', ownLog.pagesRead, 3, ownLog.endPage));
  assert.equal(math.calculateSubjectReviewAverageTimePerPage(logs, 'parent', 'first'), 4);
  assert.equal(math.calculateReviewSpeedChanges(logs, 'parent', 'first').latest, -25);
  assert.equal(schedule.getActiveSubjectStage(applySessionEndPage(reviewChainSubjects[1], ownLog)).currentPage, 25);
  const next = math.calculateReviewSubjectTiming(logs, 'parent', 'second', reviewChainSubjects, logs);
  assert.equal(next.pages, 3);
  assert.equal(next.estimatedMinutes, 12);
});

test('pomodoro targets recalculate with measured efficiency and remain whole pages within the current book', () => {
  const { getPomodoroPageTarget, getMeasurementGoalEndPage, POMODORO_MINUTES } = loadSource('utils/measurement.ts');
  assert.equal(POMODORO_MINUTES, 25);
  assert.equal(getPomodoroPageTarget(2.5, 100), 10);
  assert.equal(getPomodoroPageTarget(5, 100), 5);
  assert.equal(getPomodoroPageTarget(2, 100), 12);
  assert.equal(getPomodoroPageTarget(2, 3), 3);
  assert.equal(getPomodoroPageTarget(50, 100), 1);
  assert.equal(getPomodoroPageTarget(0, 100), null);
  assert.equal(getPomodoroPageTarget(NaN, 100), null);
  assert.equal(getPomodoroPageTarget(2, 0), 0);
  assert.equal(getMeasurementGoalEndPage(71, 5), 75);
  assert.equal(getMeasurementGoalEndPage(13, 1), 13);
  assert.equal(getMeasurementGoalEndPage(13, null), null);
});

test('pomodoro over-target styling starts strictly after the page goal and never stops continued progress', () => {
  const { isPomodoroGoalExceeded } = loadSource('utils/measurement.ts');
  assert.equal(isPomodoroGoalExceeded(9, 10), false);
  assert.equal(isPomodoroGoalExceeded(10, 10), false);
  assert.equal(isPomodoroGoalExceeded(11, 10), true);
  assert.equal(isPomodoroGoalExceeded(100, 10), true);
  assert.equal(isPomodoroGoalExceeded(1, null), false);
  assert.equal(isPomodoroGoalExceeded(1, 0), false);
});

test('explicit quantity edits do not change the day plan or book position carried into future days', () => {
  const subject = shortPlanSubject({ completedPages: 5, targetDate: '2026-10-12' });
  const log = { id: 'manual', subjectId: subject.id, startPage: 1, endPage: 5, pagesRead: 3,
    pageCountIsExplicit: true, timeSpentMinutes: 15, timestamp: planningToday.toISOString(), studyDate: '2026-10-12' };
  const first = schedule.getSubjectDayRemainingPages(subject, [log], 1, '2026-10-12', planningToday);
  const edited = schedule.getSubjectDayRemainingPages(subject, [{ ...log, pagesRead: 8 }], 1, '2026-10-12', planningToday);
  assert.equal(first.scopedPages, 5);
  assert.deepEqual(edited, first);
});

test('pomodoro sits below selected subject progress and uses the execution plan efficiency for new reviews', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const props = { logs: [], subjects: reviewChainSubjects, detailSubjectId: 'first', activeWeekday: 1,
    activeStudyDate: '2026-10-12', taskSelector: '오늘 할 일',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {},
    pomodoroPlan: { subjectId: 'first', minutes: 25, pages: 10, remainingTaskPages: 20 } };
  const html = renderToStaticMarkup(React.createElement(TodaySummary, props));
  // 작은 상태 셀이 맨 위에 가로로 놓이고, 그 아래에 선택한 할 일의 상세가 온다.
  assert.ok(html.indexOf('오늘 할 일') < html.indexOf('aria-label="공부 시작"'));
  assert.ok(!html.includes('lg:order-2'));
  // 왼쪽 "공부 시작" 칸(뽀모도로)이 먼저, 오른쪽 "성장" 칸(학습 진척도)이 그 다음
  assert.ok(html.indexOf('뽀모도로') < html.indexOf('학습 진척도'));
  assert.ok(html.includes('25'));
  assert.match(html, /2<[^>]*>회/);
  assert.ok(!html.includes('남은 시간'));
  const changed = renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    pomodoroPlan: { subjectId: 'first', minutes: 25, pages: 5, remainingTaskPages: 20 } }));
  assert.match(changed, /4<[^>]*>회/);
  assert.match(changed, /풀 장수[\s\S]*5<[^>]*>P/);
});

test('measurement bar shows this-time pages, remaining pages and elapsed time, and they turn amber together only above the goal', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MeasurementProgress } = loadSource('components/SessionLogger.tsx');
  const normal = renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 10, target: 10, elapsed: '25:00' }));
  assert.ok(normal.includes('10 / 10P'));
  assert.ok(!normal.includes('text-amber-600'));
  const exceeded = renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 11, target: 10, elapsed: '27:30' }));
  assert.equal((exceeded.match(/text-amber-600/g) || []).length, 6);
  assert.ok(exceeded.includes('11 / 10P'));
  assert.ok(exceeded.includes('이번 측정'));
  assert.ok(exceeded.includes('남은 페이지'));
  assert.ok(exceeded.includes('경과 시간'));
  assert.ok(exceeded.includes('27:30'));
  // 순서: 이번 측정 → 남은 페이지 → 경과 시간
  const order = ['이번 측정', '남은 페이지', '경과 시간'].map(text => exceeded.indexOf(text));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'this-time pages, remaining pages, elapsed time from left to right');
  // 타임어택 카운트다운은 더 이상 보이지 않는다
  assert.ok(!exceeded.includes('타임어택'));
  // 남은 페이지는 목표에서 푼 만큼을 뺀 값, 목표가 없으면 '-'
  const partial = renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 3, target: 5, elapsed: '10:00' }));
  assert.match(partial, /data-testid="measurement-remaining"[^>]*>2P</);
  assert.match(renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 3, target: null, elapsed: '10:00' })), /data-testid="measurement-remaining"[^>]*>-</);
});

test('the pomodoro length sits at the far left of the measurement bar and can only be raised there', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroLength, PomodoroMinutesStepper } = loadSource('components/PomodoroMinutesStepper.tsx');
  const bar = renderToStaticMarkup(React.createElement(PomodoroLength));
  assert.ok(bar.includes('data-testid="pomodoro-up"'));
  assert.ok(!bar.includes('pomodoro-down'));
  const start = renderToStaticMarkup(React.createElement(PomodoroMinutesStepper));
  assert.ok(start.includes('pomodoro-up') && start.includes('pomodoro-down'), 'outside measurement both directions stay');
  const upOnly = renderToStaticMarkup(React.createElement(PomodoroMinutesStepper, { upOnly: true }));
  assert.ok(upOnly.includes('pomodoro-up') && !upOnly.includes('pomodoro-down'));
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'SessionLogger.tsx'), 'utf8');
  assert.ok(source.indexOf('<PomodoroLength />') < source.indexOf('<MeasurementProgress pages='), 'pomodoro comes before the progress cells');
  assert.ok(!source.includes('PageTimeAttack') && !source.includes('time-attack-group'));
  const review = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'ReviewPracticeScreen.tsx'), 'utf8');
  assert.ok(review.includes('<PomodoroMinutesStepper upOnly />'), 'the review measurement raises only as well');
});

test('the review screen no longer says harder questions open automatically at 80%', () => {
  const screen = fs.readFileSync(path.resolve(__dirname, '..', 'components/ReviewPracticeScreen.tsx'), 'utf8');
  assert.ok(!screen.includes('더 어려운 문제가 열려요') && !screen.includes('left-[80%]'));
  assert.ok(screen.includes('첫 시도 정답률'), 'the first-try accuracy itself stays');
});

test('pomodoro remaining pages decrease as pages are solved', () => {
  const { getPomodoroRemainingPages } = loadSource('utils/measurement.ts');
  for (const [solved, remaining] of [[0, 5], [1, 4], [5, 0], [8, 0]]) {
    assert.equal(getPomodoroRemainingPages(5, solved), remaining);
  }
  assert.equal(getPomodoroRemainingPages(null, 1), null);
});

test('each saved pomodoro appears even before the daily task is complete without duplicating daily totals', () => {
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  const subject = shortPlanSubject({ completedPages: 4 });
  const logs = [1, 2].map(id => ({ id: `pomo${id}`, subjectId: subject.id, pagesRead: 2, timeSpentMinutes: 25,
    startPage: id * 2 - 1, endPage: id * 2, pomodoroSession: true,
    timestamp: `2026-10-12T0${id}:00:00Z`, studyDate: '2026-10-12' }));
  for (const completedIds of [[], [subject.id]]) {
    const rows = buildCompletedSubjectSummaries(logs, [subject], completedIds, '2026-10-12');
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((sum, row) => sum + row.pages, 0), 4);
    assert.equal(rows.reduce((sum, row) => sum + row.minutes, 0), 50);
    rows.forEach(row => {
      assert.equal(row.relatedWeeklyMinutes, 50);
      assert.equal(row.logs.length, 1);
    });
  }
});

test('saved review pomodoro stays visible without advancing review completion or double counting its own log', () => {
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  const ownLog = { id: 'pomo-review', subjectId: 'first', reviewParentSubjectId: 'parent', pomodoroSession: true,
    pagesRead: 5, timeSpentMinutes: 25, timestamp: '2026-10-12T04:00:00Z', studyDate: '2026-10-12' };
  for (const completed of [false, true]) {
    const parents = [2, 3].map((pages, id) => ({ id: `parent${id}`, subjectId: 'parent', pagesRead: pages,
      timeSpentMinutes: 10, timestamp: '2026-10-11T04:00:00Z',
      reviewSubjectTimeRecords: [{ subjectId: 'first', measurementId: ownLog.id, completed, pages,
        minutes: pages * 5, baselineTimePerPage: 10, timestamp: ownLog.timestamp }] }));
    const rows = buildCompletedSubjectSummaries([...parents, ownLog], reviewChainSubjects, [], '2026-10-12');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'review');
    assert.equal(rows[0].pages, 5);
    assert.equal(rows[0].minutes, 25);
    // 부모 학습 두 번(10분씩 20분) + 자신의 뽀모도로 25분. 같은 기록을 복습 측정 기록으로 한 번 더 세지 않는다.
    assert.equal(rows[0].relatedWeeklyMinutes, 45);
    assert.equal(rows[0].reviewSpeedChangePercent, 100);
    assert.equal(parents[0].reviewSubjectTimeRecords[0].completed, completed);
  }
});

test('pomodoro remaining sessions round up today work and shrink as pages are saved', () => {
  const { getRemainingPomodoroSessions } = loadSource('utils/measurement.ts');
  assert.equal(getRemainingPomodoroSessions(21, 5), 5);
  assert.equal(getRemainingPomodoroSessions(16, 5), 4);
  assert.equal(getRemainingPomodoroSessions(0, 5), 0);
  assert.equal(getRemainingPomodoroSessions(21, null), null);
  assert.equal(getRemainingPomodoroSessions(21, 0), null);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const html = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: 5, remainingTaskPages: 21 }));
  assert.ok(html.includes('뽀모도로') && html.includes('한 번에'));
  assert.match(html, /25<[^>]*>분/);
  assert.match(html, /5<[^>]*>회/);
  assert.match(html, /풀 장수[\s\S]*5<[^>]*>P/);
});

test('organization stage shows only its own elapsed clock without per-page attack or progress', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { OrganizationTimer } = loadSource('components/SessionLogger.tsx');
  const render = seconds => renderToStaticMarkup(React.createElement(OrganizationTimer,
    { seconds, running: true, onToggle() {}, onComplete() {} }));
  const html = render(0);
  assert.ok(html.includes('막힌 부분 정리') && html.includes('00:00') && html.includes('완료'));
  assert.ok(!html.includes('타임어택') && !html.includes('진척도') && !html.includes('이번 측정'));
  assert.ok(render(125).includes('02:05'));
});

test('first completion controls attack efficiency while both phases control every overall timing calculation', () => {
  const { getSessionTimes, resizeSessionTimes } = loadSource('utils/measurement.ts');
  const math = loadSource('utils/math.ts');
  const times = getSessionTimes(1200, 600);
  assert.deepEqual(times, { timeAttackMinutes: 20, organizationMinutes: 10, timeSpentMinutes: 30 });
  const log = { ...source(), pagesRead: 5, ...times };
  assert.equal(math.calculateTimeAttackAverage([log]), 4);
  assert.equal(math.calculateRecentTimedPageAverage([log]).averageTimePerPage, 6);
  assert.equal(math.calculateTimeAttackAverage([source({ pagesRead: 5, timeSpentMinutes: 30 })]), 6);
  assert.deepEqual(resizeSessionTimes(15, log), { timeAttackMinutes: 10, organizationMinutes: 5 });
  assert.deepEqual(resizeSessionTimes(15, { timeSpentMinutes: 30 }), {});
  assert.deepEqual(getSessionTimes(0, 60), { timeAttackMinutes: 0, organizationMinutes: 1, timeSpentMinutes: 1 });
});

test('review successors inherit attack-only time separately from full time and improvement percentages', () => {
  const math = loadSource('utils/math.ts');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const log = source({ pagesRead: 5, timeSpentMinutes: 30, timeAttackMinutes: 20,
    reviewSubjectIdsSnapshot: ['first', 'second'] });
  const initialTotal = math.calculateReviewSubjectTiming([log], 'main', 'first', [], [log], ['first', 'second']);
  const initialAttack = math.calculateReviewSubjectTiming([log], 'main', 'first', [], [log], ['first', 'second'], true);
  assert.equal(initialTotal.averageTimePerPage, 6);
  assert.equal(initialAttack.averageTimePerPage, 4);
  const recorded = recordReviewMeasurement([log], [log.id], 'first', 15, true, log.timestamp,
    { pagesRead: 5, baselineTimePerPage: 6, timeAttackMinutes: 10, baselineTimeAttackPerPage: 4,
      lastEndPage: 5, measurementId: 'first-session' });
  const record = recorded[0].reviewSubjectTimeRecords[0];
  assert.equal(record.minutes, 15);
  assert.equal(record.timeAttackMinutes, 10);
  assert.equal(record.organizationMinutes, 5);
  assert.equal(math.calculateReviewSubjectTiming(recorded, 'main', 'second', [], recorded, ['first', 'second']).averageTimePerPage, 3);
  assert.equal(math.calculateReviewSubjectTiming(recorded, 'main', 'second', [], recorded, ['first', 'second'], true).averageTimePerPage, 2);
  assert.equal(math.calculateReviewSpeedChanges(recorded, 'main', 'first').latest, 100);
});

test('finishing a multi-session review retains individual pomodoro records without duplicate combined time', () => {
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  let logs = [source({ subjectId: 'parent', pagesRead: 5 })];
  const own = [1, 2].map(id => ({ id: `session${id}`, subjectId: 'first', reviewParentSubjectId: 'parent',
    pomodoroSession: true, pagesRead: 2, timeSpentMinutes: 10, timeAttackMinutes: 6,
    organizationMinutes: 4, reviewBaselineTimePerPage: 10,
    timestamp: `2026-10-12T0${id}:00:00Z`, studyDate: '2026-10-12' }));
  for (const [index, log] of own.entries()) {
    logs = recordReviewMeasurement(logs, [logs[0].id], 'first', log.timeSpentMinutes, index === 1, log.timestamp,
      { pagesRead: log.pagesRead, baselineTimePerPage: 10, timeAttackMinutes: log.timeAttackMinutes,
        baselineTimeAttackPerPage: 5, lastEndPage: (index + 1) * 2, measurementId: log.id });
  }
  const rows = buildCompletedSubjectSummaries([...logs, ...own], reviewChainSubjects, [], '2026-10-12');
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.minutes, 0), 20);
  assert.equal(rows.reduce((sum, row) => sum + row.pages, 0), 4);
  rows.forEach(row => assert.equal(row.relatedWeeklyMinutes, 20));
  assert.equal(logs[0].reviewSubjectTimeRecords[0].timeAttackMinutes, 12);
  assert.equal(logs[0].reviewSubjectTimeRecords[0].organizationMinutes, 8);
});

test('efficiency is measured in trailing 25-minute windows counted back from the latest study; a log crossing a boundary is split by time', () => {
  const { buildEfficiencyWindows, EFFICIENCY_WINDOW_MINUTES } = loadSource('utils/pageGrowth.ts');
  assert.equal(EFFICIENCY_WINDOW_MINUTES, 25);
  const samples = [
    source({ id: 'recent', pagesRead: 5, timeSpentMinutes: 5, timestamp: '2026-10-12T04:00:00Z' }),
    source({ id: 'old', pagesRead: 12, timeSpentMinutes: 60, timestamp: '2026-09-01T04:00:00Z' }),
    source({ id: 'middle', pagesRead: 8, timeSpentMinutes: 16, timestamp: '2026-10-10T04:00:00Z' })
  ];
  const before = JSON.stringify(samples);
  const windows = buildEfficiencyWindows(samples);
  // 가장 최근 25분 = recent 5분(5P) + middle 16분(8P) + old의 4분(5분/P라서 0.8P) → 13.8P. 그 앞의 25분씩은 모두 old(5분/P).
  // 맨 앞에 남은 6분은 25분이 안 되므로 버린다.
  assert.deepEqual(windows.map(item => [item.pages, item.minutes, item.complete]), [[13.8, 25, true], [5, 25, true], [5, 25, true]]);
  assert.ok(Math.abs(windows[0].averageTimePerPage - 25 / 13.8) < 1e-8);
  assert.equal(windows[1].averageTimePerPage, 5);
  assert.equal(windows[2].averageTimePerPage, 5);
  assert.equal(JSON.stringify(samples), before, 'the input is not changed');
  // 같은 기록을 어느 순서로 넘겨도 시간순으로 센다
  assert.deepEqual(buildEfficiencyWindows([...samples].reverse()), windows);
});

test('the current efficiency is the latest 25 minutes: full time for the overall value, attack time for the attack value, and everything when under 25 minutes', () => {
  const { buildEfficiencyWindows, calculateUnitEfficiency } = loadSource('utils/pageGrowth.ts');
  // 50분짜리 기록 하나: 최근 25분 = 기록의 절반(5P). 타임어택은 10분 중 절반인 5분.
  const long = [source({ pagesRead: 10, timeSpentMinutes: 50, timeAttackMinutes: 10, timestamp: '2026-10-10T04:00:00Z' })];
  const windows = buildEfficiencyWindows(long);
  assert.deepEqual(windows.map(item => [item.pages, item.minutes, item.timeAttackMinutes]), [[5, 25, 5], [5, 25, 5]]);
  const result = calculateUnitEfficiency(long);
  assert.equal(result.basis.complete, true);
  assert.equal(result.averageTimePerPage, 5);
  assert.equal(result.timeAttackAverageTimePerPage, 1);
  // 25분이 안 되면 있는 기록 전부가 한 덩어리(complete=false)
  const short = calculateUnitEfficiency([source({ pagesRead: 2, timeSpentMinutes: 4, timeAttackMinutes: 2 })]);
  assert.equal(short.basis.complete, false);
  assert.equal(short.averageTimePerPage, 2);
  assert.equal(short.timeAttackAverageTimePerPage, 1);
  // 타임어택 시간이 없으면 전체 시간이 타임어택 시간이다
  assert.equal(calculateUnitEfficiency([source({ pagesRead: 2, timeSpentMinutes: 4, timeAttackMinutes: undefined })]).timeAttackAverageTimePerPage, 2);
  // 쓸 수 있는 기록이 없으면 0
  const none = calculateUnitEfficiency([]);
  assert.deepEqual([none.basis, none.averageTimePerPage, none.timeAttackAverageTimePerPage, none.standardDeviation], [null, 0, 0, 0]);
});

test('invalid samples never enter a window and the oldest leftover under 25 minutes is dropped', () => {
  const { buildEfficiencyWindows } = loadSource('utils/pageGrowth.ts');
  const invalid = [source({ pagesRead: 2, timeSpentMinutes: 0 }), source({ pagesRead: NaN }), source({ timestamp: 'invalid' }),
    source({ pagesRead: 0, timeSpentMinutes: 10 }), source({ pagesRead: 3, timeSpentMinutes: NaN })];
  assert.deepEqual(buildEfficiencyWindows(invalid), []);
  assert.deepEqual(buildEfficiencyWindows([]), []);
  // 30분: 최근 25분 한 덩어리만 남고 앞의 5분은 버린다(전체가 25분 이상이라 부분 덩어리를 따로 만들지 않는다)
  const thirty = buildEfficiencyWindows([...invalid, source({ pagesRead: 6, timeSpentMinutes: 30 })]);
  assert.equal(thirty.length, 1);
  assert.deepEqual([thirty[0].pages, thirty[0].minutes], [5, 25]);
  // 소수 페이지도 시간에 비례해 나눈다
  const fraction = buildEfficiencyWindows([source({ pagesRead: 12.5, timeSpentMinutes: 50 })]);
  assert.deepEqual(fraction.map(item => item.pages), [6.25, 6.25]);
  // 한 덩어리 안에서 기록마다 속도가 다르면 표준편차가 생긴다
  const mixed = buildEfficiencyWindows([source({ id: 'a', pagesRead: 5, timeSpentMinutes: 10, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'b', pagesRead: 5, timeSpentMinutes: 15, timestamp: '2026-10-11T04:00:00Z' })]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].averageTimePerPage, 2.5);
  assert.ok(mixed[0].standardDeviation > 0 && mixed[0].standardDeviation < 1);
});

test('a unit is the span between two "복습에 넣기" (the first from the start), and for a review subject one review; nothing resets the efficiency', () => {
  const { getEfficiencyScope, getEfficiencyView } = loadSource('utils/pageGrowth.ts');
  const { registrationBoundaries, reviewCompletionBoundaries, unitIndexAt } = loadSource('utils/reviewUnits.ts');
  const at = hour => `2026-10-12T${String(hour).padStart(2, '0')}:00:00Z`;
  const log = (id, pages, minutes, hour, extra = {}) => source({ id, pagesRead: pages, timeSpentMinutes: minutes, timestamp: at(hour), ...extra });
  // a · b를 공부하고 3시에 복습에 넣었고, c는 아직 넣지 않았다 → 단위 1(a·b, 마침) · 단위 2(c, 채우는 중)
  const a = log('a', 5, 25, 1, { reviewRegisteredAt: at(3) });
  const b = log('b', 5, 25, 2, { reviewRegisteredAt: at(3) });
  const c = log('c', 3, 15, 4, { unitReviewPending: true });
  const boundaries = registrationBoundaries([a, b, c]);
  assert.deepEqual(boundaries, [Date.parse(at(3))], 'one boundary per press of 복습에 넣기 (pending logs are not a boundary)');
  assert.deepEqual([unitIndexAt(Date.parse(at(1)), boundaries), unitIndexAt(Date.parse(at(3)), boundaries), unitIndexAt(Date.parse(at(4)), boundaries)], [0, 0, 1]);
  const scope = getEfficiencyScope([a, b, c], boundaries);
  assert.deepEqual(scope.units.map(unit => [unit.pages, unit.complete]), [[10, true], [3, false]]);
  assert.deepEqual(scope.progress, { index: 2, done: 3 });
  assert.deepEqual(scope.current.map(item => item.id), ['a', 'b', 'c'], 'the efficiency keeps every record');
  // 막 복습에 넣었으면 다음 단위는 0장에서 시작하고, 넣은 적이 없으면 처음부터 지금까지가 첫 단위다
  assert.deepEqual(getEfficiencyScope([a, b], boundaries).progress, { index: 2, done: 0 });
  assert.deepEqual(getEfficiencyScope([log('x', 4, 20, 1)], []).progress, { index: 1, done: 4 });
  assert.equal(getEfficiencyView(getEfficiencyScope([], [])).shown, null);
  // 예전 기록(누른 시각이 없음)은 같은 범위로 함께 들어간 기록 중 가장 늦은 시각을 경계로 본다
  assert.deepEqual(registrationBoundaries([log('o1', 5, 20, 1, { reviewUnitRange: { start: 1, end: 10 } }), log('o2', 5, 20, 2, { reviewUnitRange: { start: 1, end: 10 } })]), [Date.parse(at(2))]);
  // 복습과목: 그 복습과목으로 복습을 마친 때가 경계(복습 한 번 = 한 단위)
  const parent = source({ id: 'p', subjectId: 'main', reviewSubjectTimeRecords: [
    { subjectId: 'R', completed: true, pages: 5, minutes: 15, timestamp: at(5) },
    { subjectId: 'R', completed: false, pages: 2, minutes: 6, timestamp: at(6) },
    { subjectId: 'R', completed: true, pages: 3, minutes: 9, timestamp: at(7) },
    { subjectId: 'Q', completed: true, pages: 3, minutes: 9, timestamp: at(8) }
  ] });
  assert.deepEqual(reviewCompletionBoundaries([parent], 'main', 'R'), [Date.parse(at(5)), Date.parse(at(7))]);
});

test('the efficiency can be compared with the previous unit, the one before it and the average, in the order the button steps', () => {
  const { getEfficiencyScope, getEfficiencyView, nextEfficiencyComparison, sameComparison, MAX_COMPARISON_UNITS } = loadSource('utils/pageGrowth.ts');
  assert.equal(MAX_COMPARISON_UNITS, 2);
  const log = (id, pages, minutes, hour) => source({ id, pagesRead: pages, timeSpentMinutes: minutes, timestamp: `2026-10-12T0${hour}:00:00Z` });
  // 단위(복습에 넣기 사이): 1단위 20장 100분(5분/P) · 2단위 20장 60분(3분/P) · 3단위는 10장 25분(2.5분/P)으로 채우는 중
  // 1시 30분 · 2시 30분에 복습에 넣었다(단위 경계)
  const cut = (...hours) => hours.map(hour => Date.parse(`2026-10-12T0${hour}:30:00Z`));
  const scope = getEfficiencyScope([log('u1', 20, 100, 1), log('u2', 20, 60, 2), log('u3', 10, 25, 3)], cut(1, 2));
  assert.deepEqual(scope.units.map(unit => [unit.pages, unit.averageTimePerPage, unit.complete]), [[20, 5, true], [20, 3, true], [10, 2.5, false]]);
  const base = getEfficiencyView(scope);
  assert.equal(base.shown.averageTimePerPage, 2.5, 'the shown value is the latest 25 minutes, not reset by the unit');
  assert.deepEqual(base.choice, { kind: 'pomodoro', n: 1 });
  assert.equal(base.maxUnits, 2);
  // 버튼이 넘기는 순서: 뽀모도로 1~5회 전 → 이전 단위 → 이이전 단위 → 평균
  assert.deepEqual(base.options.map(option => option.kind === 'average' ? '평균' : `${option.kind}${option.n}`),
    ['pomodoro1', 'pomodoro2', 'pomodoro3', 'pomodoro4', 'pomodoro5', 'unit1', 'unit2', '평균']);
  // 이전 단위(3분/P)와: 같은 시간에 24장 vs 20장 → 속도 +4.0P/h, 장당 −0.5분
  const previous = getEfficiencyView(scope, { kind: 'unit', n: 1 });
  assert.deepEqual(previous.choice, { kind: 'unit', n: 1 });
  assert.equal(previous.referenceUnit.averageTimePerPage, 3);
  assert.deepEqual(previous.overall, { speedPages: 4, studyMinutes: -0.5 });
  assert.deepEqual([previous.comparison, previous.reference], [0, null]);
  // 이이전 단위(5분/P)와: 24장 vs 12장 → 속도 +12.0P/h, 장당 −2.5분
  const before = getEfficiencyView(scope, { kind: 'unit', n: 2 });
  assert.equal(before.referenceUnit.averageTimePerPage, 5);
  assert.deepEqual(before.overall, { speedPages: 12, studyMinutes: -2.5 });
  // 평균(과목 전체 185분 ÷ 50장 = 3.7분/P)과: 속도 24 − 16.2 = +7.8P/h, 장당 −1.2분
  const average = getEfficiencyView(scope, { kind: 'average' });
  assert.ok(Math.abs(average.average.averageTimePerPage - 3.7) < 1e-9);
  assert.deepEqual(average.overall, { speedPages: 7.8, studyMinutes: -1.2 });
  assert.deepEqual(average.attack, average.overall, 'without time attack minutes the attack efficiency equals the total');
  // 뽀모도로로 견주는 것은 그대로다(숫자로 줘도 같다)
  assert.deepEqual(getEfficiencyView(scope, 1).overall, getEfficiencyView(scope, { kind: 'pomodoro', n: 1 }).overall);
  // 버튼은 순서대로 돌고 마지막(평균) 다음은 처음(뽀모도로 1회 전)이다
  let choice = base.choice;
  const seen = [];
  for (let step = 0; step < 9; step++) {
    const view = getEfficiencyView(scope, choice);
    seen.push(choice.kind === 'average' ? '평균' : `${choice.kind}${choice.n}`);
    choice = nextEfficiencyComparison(view);
  }
  assert.deepEqual(seen, ['pomodoro1', 'pomodoro2', 'pomodoro3', 'pomodoro4', 'pomodoro5', 'unit1', 'unit2', '평균', 'pomodoro1']);
  assert.ok(sameComparison({ kind: 'unit', n: 1 }, { kind: 'unit', n: 1 }) && !sameComparison({ kind: 'unit', n: 1 }, { kind: 'pomodoro', n: 1 }));
  // 마친 단위가 셋이어도 이이전 단위까지만 견준다. 채우는 중인 단위는 기준이 되지 않는다.
  const three = getEfficiencyScope([log('a', 20, 100, 1), log('b', 20, 80, 2), log('c', 20, 60, 3), log('d', 5, 10, 4)], cut(1, 2, 3));
  const threeView = getEfficiencyView(three, { kind: 'unit', n: 9 });
  assert.deepEqual([threeView.maxUnits, threeView.choice.n, threeView.referenceUnit.averageTimePerPage], [2, 2, 4]);
  // 마친 단위가 아직 없으면 단위로는 견줄 수 없다(변화 없음). 평균은 보이는 25분 말고 다른 기록이 있어야 한다.
  const none = getEfficiencyView(getEfficiencyScope([log('x', 5, 50, 1)], []), { kind: 'unit', n: 1 });
  assert.deepEqual([none.maxUnits, none.choice.n, none.referenceUnit, none.overall], [0, 0, null, null]);
  assert.equal(getEfficiencyView(getEfficiencyScope([log('x', 5, 20, 1)], []), { kind: 'average' }).overall, null);
  assert.equal(nextEfficiencyComparison(getEfficiencyView(getEfficiencyScope([], []))).kind, 'pomodoro');
});

test('review subjects respect the selected growth display without editing page units in execution', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  // 복습 과목 first에 25분짜리 기록 둘: 앞 25분은 5분/P, 최근 25분은 2.5분/P
  const logs = [source({ subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 5, startPage: 20, endPage: 24, timeSpentMinutes: 25 }),
    source({ id: 'new', subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 10, startPage: 25, endPage: 34, timeSpentMinutes: 25, timestamp: '2026-10-12T04:00:00Z' })];
  const props = { logs, subjects: reviewChainSubjects, detailSubjectId: 'first', activeWeekday: 1, activeStudyDate: '2026-10-12',
    taskSelector: '오늘 할 일', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const original = renderToStaticMarkup(React.createElement(TodaySummary, props));
  assert.ok(original.includes('평균 증가율') && original.includes('이번 복습 증가율'));
  assert.ok(!original.includes('효율 성장 비교'));
  const unit = renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    subjects: reviewChainSubjects.map(subject => subject.id === 'first' ? { ...subject, growthPageUnit: 20, reviewGrowthDisplay: 'unit' } : subject) }));
  assert.ok(!unit.includes('평균 증가율'));
  // 아직 복습을 마친 적이 없어 지금 단위(복습 한 번)에 15장(5장 + 10장)을 채우는 중
  assert.ok(unit.includes('unit-pages-done') && /unit-pages-done[\s\S]*?>15<span[^>]*>P<\/span><\/p>/.test(unit) && unit.includes('복습을 마치면 단위가 끝나요'));
  // 최근 25분(2.5분/P, 1시간에 24장)을 1회 전(5분/P, 12장)과 견준다: 속도 +12.0P/h, 공부량 −2.5분/P
  assert.ok(unit.includes('뽀모도로 1회 전') && unit.includes('속도 +12.0P/h') && unit.includes('공부량 −2.5분/P') && !unit.includes('+150.0%'));
  assert.ok(!unit.includes('성장 설정'));
});

test('review growth settings select either mode and retain the saved selection on reload', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewGrowthSettings } = loadSource('components/PageGrowth.tsx');
  const { normalizePageGrowthSettings } = loadSource('utils/pageGrowth.ts');
  const selected = [];
  const tree = ReviewGrowthSettings({ value: 'review', onChange: value => selected.push(value) });
  const buttons = tree.props.children[1].props.children;
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].props['aria-pressed'], true);
  assert.equal(buttons[1].props['aria-pressed'], false);
  buttons[1].props.onClick({ stopPropagation() {} });
  buttons[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(selected, ['unit', 'review']);
  for (const value of selected) {
    const saved = JSON.parse(JSON.stringify({ ...reviewChainSubjects[1], reviewGrowthDisplay: value }));
    assert.equal(normalizePageGrowthSettings(saved).reviewGrowthDisplay, value);
    const html = renderToStaticMarkup(React.createElement(ReviewGrowthSettings, { value, onChange() {} }));
    assert.ok(html.includes(`aria-pressed="true"`) && html.includes('평균 속도 증가율') && html.includes('타임어택 포함') && html.includes('뽀모도로 성장'));
    assert.ok(!html.includes('type="number"') && !html.includes('임시'));
    assert.equal(saved.completedPages, reviewChainSubjects[1].completedPages);
  }
});

test('review growth display switches between completion speed gains and pomodoro growth including legacy allocations', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  let logs = [chainLog('old'), chainLog('new')];
  logs = recordReviewMeasurement(logs, ['old'], 'first', 20, true, '2026-10-11T04:00:00Z', measurement('old-review', 5, 3));
  logs = recordReviewMeasurement(logs, ['new'], 'first', 30, true, '2026-10-12T04:00:00Z', measurement('new-review', 5, 3));
  const props = { logs, detailSubjectId: 'first', activeWeekday: 1, activeStudyDate: '2026-10-12',
    taskSelector: '오늘 할 일', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const render = (mode, unit = 0) => renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    subjects: reviewChainSubjects.map(subject => subject.id === 'first'
      ? { ...subject, growthPageUnit: unit, reviewGrowthDisplay: mode } : subject) }));
  const review = render('review');
  // 두 측정(4분/P, 6분/P)의 기준은 3분/P. 평균은 속도 (−5 − 10) ÷ 2 = −7.5P/h, 공부량 (+1 + 3) ÷ 2 = +2.0분/P,
  // 이번 복습은 속도 −10.0P/h, 공부량 +3.0분/P. 속도와 공부량을 늘 함께, 퍼센트 없이 보여준다.
  assert.ok(review.includes('review-speed-growth') && !review.includes('+87.5%') && !review.includes('+200.0%'));
  assert.ok(review.includes('>−7.5</span>') && review.includes('>+2.0</span>') && review.includes('>−10.0</span>') && review.includes('>+3.0</span>'));
  assert.equal((review.match(/data-growth-kind="speed"/g) || []).length, 2);
  assert.equal((review.match(/data-growth-kind="amount"/g) || []).length, 2);
  assert.ok(!review.includes('unit-pages-remaining'));
  const unit = render('unit');
  assert.ok(unit.includes('타임어택 효율') && unit.includes('data-testid="unit-compare"'));
  assert.ok(!unit.includes('review-speed-growth'));
  // 최근 25분(6분/P의 새 측정 25분 = 4.2P)은 6.0분/P. 그 앞 25분(새 측정 나머지 5분 + 옛 측정 20분)은 4.3분/P(25 ÷ 5.83P).
  // 뽀모도로 1회 전 대비 속도 −4.0P/h(10.0 − 14.0), 공부량 +1.7분/P
  // 복습과목도 기본은 이전 단위(복습 한 번) 대비이고, 뽀모도로 1회 전 대비는 효율 숫자 옆에 붙는다
  // 두 번의 복습(복습 한 번 = 한 단위)을 마쳤다: 마지막 복습(6분/P)을 그 전 복습(4분/P)과 견준다 → 속도 −5.0P/h, 공부량 +2.0분/P
  assert.ok(unit.includes('이전 단위') && unit.includes('속도 −5.0P/h') && unit.includes('공부량 +2.0분/P'), unit.slice(unit.indexOf('efficiency-cell'), unit.indexOf('efficiency-cell') + 1500));
  assert.ok(unit.includes('>6.0</span>'));
  assert.equal((unit.match(/data-growth-kind="speed"/g) || []).length, 2);
  assert.equal((unit.match(/data-growth-kind="amount"/g) || []).length, 2);
  assert.ok(!unit.includes('임시로') && !unit.includes('h 공부'));
});

test('repeat review reserves the same subject at its exact final page using the next regular interval', () => {
  const { createRepeatedSubjectReview, getRepeatedReviewRange, getNextReviewIntervalMs } = loadSource('utils/review.ts');
  const measured = source({ id: 'own', subjectId: 'practice', pagesRead: 5, startPage: 16, endPage: 20, subjectStageId: 'practice' });
  const repeat = createRepeatedSubjectReview(measured, 'main', 0, now);
  assert.equal(repeat.reviewRepeatStartPage, 20);
  assert.equal(repeat.reviewStep, 1);
  assert.equal(repeat.nextReviewDate, new Date(now + getNextReviewIntervalMs(0)).toISOString());
  assert.equal(repeat.reviewEnabled, true);
  assert.deepEqual(repeat.reviewSubjectIdsSnapshot, ['practice']);
  assert.equal(getRepeatedReviewRange(repeat, subjects[1]).startPage, 20);
  const before = buildDueReviewGroups([repeat], subjects, now + day - 1);
  assert.equal(before.length, 0);
  const due = buildDueReviewGroups([repeat], subjects, now + day);
  assert.equal(due.length, 1);
  assert.equal(due[0].reviewType, 'subject');
  assert.equal(due[0].parentSubjectId, 'main');
  assert.equal(due[0].subjectId, 'practice');
  assert.equal(measured.isRepeatReview, undefined);
});

test('repeated reviews remain separate from regular parent reviews and can revisit a completed book', () => {
  const { createRepeatedSubjectReview, getRepeatedReviewRange } = loadSource('utils/review.ts');
  const currentSubjects = subjects.map(subject => subject.id === 'practice' ? { ...subject, completedPages: 100 } : subject);
  const repeat = createRepeatedSubjectReview(source({ id: 'repeat', subjectId: 'practice', startPage: 96, endPage: 100,
    subjectStageId: 'practice', pagesRead: 5, timeSpentMinutes: 20, timeAttackMinutes: 10 }), 'main', 0, now - day);
  const range = getRepeatedReviewRange(repeat, currentSubjects[1]);
  assert.equal(range.startPage, 100);
  assert.equal(range.remainingPages, 1);
  const due = buildDueReviewGroups([repeat], currentSubjects, now);
  assert.equal(due[0].reviewType, 'subject');
  assert.equal(due[0].estimatedMinutes, 4);
  const math = loadSource('utils/math.ts');
  assert.equal(math.calculateReviewSubjectTiming([repeat], 'main', 'practice', currentSubjects, [repeat], ['practice'], true).estimatedMinutes, 2);
  const regular = source({ id: 'regular', reviewSubjectId: 'practice' });
  const uncompletedSubjects = subjects.map(subject => subject.id === 'practice' ? { ...subject, completedPages: 20 } : subject);
  const groups = buildDueReviewGroups([regular, repeat], uncompletedSubjects, now);
  assert.equal(groups.length, 2);
});

test('save-only measurements of a repeated review resume after the last saved page without starting the original range again', () => {
  const { createRepeatedSubjectReview, getRepeatedReviewRange, recordReviewMeasurement } = loadSource('utils/review.ts');
  const repeat = createRepeatedSubjectReview(source({ id: 'repeat', subjectId: 'practice', endPage: 20, pagesRead: 10 }), 'main', 0, now);
  const recorded = recordReviewMeasurement([repeat], [repeat.id], 'practice', 6, false, new Date(now + day).toISOString(),
    { pagesRead: 3, baselineTimePerPage: 3, timeAttackMinutes: 4, baselineTimeAttackPerPage: 2, lastEndPage: 22, measurementId: 'partial' });
  assert.equal(getRepeatedReviewRange(recorded[0], subjects[1]).startPage, 23);
  assert.equal(recorded[0].nextReviewDate, repeat.nextReviewDate);
});

test('growth configuration survives JSON save and subject normalization on reload', () => {
  const { normalizePageGrowthSettings } = loadSource('utils/pageGrowth.ts');
  const saved = JSON.parse(JSON.stringify({ ...subjects[0], growthPageUnit: 20, pageLabel: '단원', reviewGrowthDisplay: 'unit' }));
  assert.deepEqual(normalizePageGrowthSettings(saved), { growthPageUnit: 20, pageLabel: '단원', reviewGrowthDisplay: 'unit' });
  // 저장된 값이 없으면 기본: 단위 10, 단위 이름 P
  assert.deepEqual(normalizePageGrowthSettings({ ...subjects[0] }), { growthPageUnit: 10, pageLabel: 'P', reviewGrowthDisplay: 'unit' }, 'review subjects compare units by default');
  // 0은 "단위 없음"이라 그대로 남고, 잘못된 값은 기본으로 돌아간다
  assert.equal(normalizePageGrowthSettings({ ...subjects[0], growthPageUnit: 0 }).growthPageUnit, 0);
  assert.equal(normalizePageGrowthSettings(JSON.parse(JSON.stringify({ ...subjects[0], growthPageUnit: 0 }))).growthPageUnit, 0);
  assert.equal(normalizePageGrowthSettings({ ...subjects[0], growthPageUnit: NaN }).growthPageUnit, 10);
  assert.equal(normalizePageGrowthSettings({ ...subjects[0], pageLabel: '   ' }).pageLabel, 'P');
});

test('consumed repeat reservations cannot resurrect from legacy date repair after reload', () => {
  const { createRepeatedSubjectReview, completeRepeatedSubjectReview } = loadSource('utils/review.ts');
  const repeat = createRepeatedSubjectReview(source({ id: 'repeat', subjectId: 'practice', endPage: 20 }), 'main', 0, now - day);
  const completed = completeRepeatedSubjectReview(repeat);
  const reloaded = { ...JSON.parse(JSON.stringify(completed)), nextReviewDate: completed.timestamp };
  assert.equal(buildDueReviewGroups([reloaded], subjects, now + 10 * day).length, 0);
  assert.equal(completed.timeSpentMinutes, repeat.timeSpentMinutes);
  assert.equal(completed.pagesRead, repeat.pagesRead);
  const next = createRepeatedSubjectReview({ ...repeat, id: 'next' }, 'main', 1, now);
  assert.equal(buildDueReviewGroups([next], subjects, now + 2 * day).length, 1);
});

test('repeated subject measurements update the same owner speed statistics without leaking into basic reviews', () => {
  const { recordReviewMeasurement, createRepeatedSubjectReview } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const repeat = createRepeatedSubjectReview(source({ id: 'repeat', subjectId: 'practice', endPage: 20, pagesRead: 5 }), 'main', 0, now);
  const recorded = recordReviewMeasurement([repeat], [repeat.id], 'practice', 10, true, repeat.timestamp,
    { pagesRead: 5, baselineTimePerPage: 4, timeAttackMinutes: 6, baselineTimeAttackPerPage: 2, lastEndPage: 24, measurementId: 'next' });
  // 최근 25분 = 새 측정 10분(5P) + 앞 측정 15분(3.75P) → 25분 ÷ 8.75P
  assert.ok(Math.abs(math.calculateSubjectReviewAverageTimePerPage(recorded, 'main', 'practice') - 25 / 8.75) < 1e-8);
  assert.equal(math.calculateReviewSpeedChanges(recorded, 'main', 'practice').latest, 100);
  assert.equal(math.calculateReviewTimeChangeAverage(recorded, 'main', 'practice', 2), -50);
  assert.deepEqual(math.calculateBasicReviewEfficiencyByNumber(recorded, 'main'), []);
});

test('overall and attack efficiency share the latest 25 minutes of study as their timer basis', () => {
  const { calculateUnitEfficiency } = loadSource('utils/pageGrowth.ts');
  const math = loadSource('utils/math.ts');
  const samples = [source({ pagesRead: 12, timeSpentMinutes: 60, timeAttackMinutes: 36, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'second', pagesRead: 8, timeSpentMinutes: 16, timeAttackMinutes: 8, timestamp: '2026-10-11T04:00:00Z' }),
    source({ id: 'tail', pagesRead: 5, timeSpentMinutes: 5, timeAttackMinutes: 2.5, timestamp: '2026-10-12T04:00:00Z' })];
  // 최근 25분 = tail 5분(5P) + second 16분(8P) + 첫 기록의 4분(5분/P라서 0.8P): 13.8P.
  // 타임어택 시간은 2.5 + 8 + 4 × 0.6(= 2.4) = 12.9분
  const result = calculateUnitEfficiency(samples);
  assert.equal(result.basis.complete, true);
  assert.ok(Math.abs(result.averageTimePerPage - 25 / 13.8) < 1e-8);
  assert.ok(Math.abs(result.timeAttackAverageTimePerPage - 12.9 / 13.8) < 1e-8);
  assert.equal(math.calculateRecentTimedPageAverage(samples).averageTimePerPage, result.averageTimePerPage);
  assert.equal(math.calculateTimeAttackAverage(samples), result.timeAttackAverageTimePerPage);
  // 마지막에 45분짜리 한 번을 길게 풀면 그 기록 하나가 최근 25분이 된다: 9분/P, 타임어택 6분/P
  const finished = [...samples, source({ id: 'finish', pagesRead: 5, timeSpentMinutes: 45, timeAttackMinutes: 30, timestamp: '2026-10-13T04:00:00Z' })];
  assert.equal(calculateUnitEfficiency(finished).averageTimePerPage, 9);
  assert.equal(calculateUnitEfficiency(finished).timeAttackAverageTimePerPage, 6);
});

test('under 25 minutes of study both efficiency values use everything measured, and estimates follow them', () => {
  const { calculateUnitEfficiency } = loadSource('utils/pageGrowth.ts');
  const math = loadSource('utils/math.ts');
  const samples = [source({ pagesRead: 2, timeSpentMinutes: 4, timeAttackMinutes: 2, timestamp: '2026-10-12T04:00:00Z' })];
  const result = calculateUnitEfficiency(samples);
  assert.equal(result.basis.complete, false);
  assert.equal(result.averageTimePerPage, 2);
  assert.equal(result.timeAttackAverageTimePerPage, 1);
  assert.equal(math.calculateStats(samples, 5, 0, 0).estimatedRemainingTime, 10);
  assert.equal(calculateUnitEfficiency([source({ timeAttackMinutes: 0 })]).timeAttackAverageTimePerPage, 0);
  // 많이 공부한 뒤에는 오래된 기록이 아니라 가장 최근 25분이 기준이다
  const later = [source({ id: 'long', pagesRead: 5, timeSpentMinutes: 500, timeAttackMinutes: 100, timestamp: '2026-01-01T04:00:00Z' }),
    source({ id: 'recent', pagesRead: 10, timeSpentMinutes: 25, timeAttackMinutes: 10, timestamp: '2026-10-12T04:00:00Z' })];
  assert.equal(calculateUnitEfficiency(later).averageTimePerPage, 2.5);
  assert.equal(calculateUnitEfficiency(later).timeAttackAverageTimePerPage, 1);
});

test('the page unit does not change predictions: they always follow the latest 25 minutes', () => {
  const math = loadSource('utils/math.ts');
  const samples = [source({ pagesRead: 10, timeSpentMinutes: 50, timeAttackMinutes: 20, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'new', pagesRead: 5, timeSpentMinutes: 10, timeAttackMinutes: 5, timestamp: '2026-10-12T04:00:00Z' })];
  // 최근 25분 = 새 기록 10분(5P) + 앞 기록의 15분(3P) → 8P: 25 ÷ 8 = 3.125분/P, 타임어택 (5 + 6) ÷ 8 = 1.375분/P
  assert.equal(math.calculateRecentCompletedDayAverage(samples, 100).averageTimePerPage, 3.125);
  assert.equal(math.calculateTimeAttackAverage(samples), 1.375);
  // 단위는 이제 계산 함수의 입력이 아니다(과목 화면의 초기화에만 쓰인다)
  assert.equal(math.calculateRecentCompletedDayAverage(samples, 100, 15).averageTimePerPage, 3.125);
  assert.equal(math.calculateTimeAttackAverage(samples, 15), 1.375);
});

test('growth compares the latest 25 minutes with the pomodoro N times earlier (default 1); the page unit does not cut the data', () => {
  const { getEfficiencyScope, getEfficiencyView } = loadSource('utils/pageGrowth.ts');
  const view = getEfficiencyView(getEfficiencyScope([
    source({ id: 'a', pagesRead: 5, startPage: 1, endPage: 5, timeSpentMinutes: 25, timeAttackMinutes: 10, timestamp: '2026-10-12T01:00:00Z' }),
    source({ id: 'b', pagesRead: 10, startPage: 6, endPage: 15, timeSpentMinutes: 25, timeAttackMinutes: 5, timestamp: '2026-10-12T02:00:00Z' })], 20, 1));
  // 값은 가장 최근 25분(10P, 2.5분/P · 타임어택 0.5분/P), 기준은 1회 전(5.0분/P · 2.0분/P)
  assert.deepEqual([view.shown.averageTimePerPage, view.shown.timeAttackAverageTimePerPage], [2.5, 0.5]);
  assert.deepEqual([view.reference.averageTimePerPage, view.reference.timeAttackAverageTimePerPage], [5, 2]);
  // 전체: 1시간에 24장 vs 12장 → 속도 +12.0P/h, 장당 −2.5분 → 공부량 −2.5분/P. 타임어택: 120장 vs 30장 → +90.0P/h, −1.5분/P
  assert.deepEqual(view.overall, { speedPages: 12, studyMinutes: -2.5 });
  assert.deepEqual(view.attack, { speedPages: 90, studyMinutes: -1.5 });
  assert.deepEqual([view.comparison, view.maxComparison], [1, 1]);
  assert.equal('studyHours' in view, false, 'the study-hours text is gone');
  // 비교할 25분이 하나도 없으면(25분이 안 되는 기록뿐) 값만 보이고 증가는 없다
  const only = getEfficiencyView(getEfficiencyScope([source({ pagesRead: 3, timeSpentMinutes: 6 })], 10, 1));
  assert.equal(only.shown.averageTimePerPage, 2);
  assert.deepEqual([only.reference, only.overall, only.attack, only.comparison, only.maxComparison], [null, null, null, 0, 0]);
  // 기록이 없으면 보여줄 값이 없다
  const none = getEfficiencyView(getEfficiencyScope([], 10, 1));
  assert.deepEqual([none.shown, none.overall, none.comparison], [null, null, 0]);
});

test('the compare button steps from 1 pomodoro back up to 5 and returns to 1', () => {
  const { getEfficiencyScope, getEfficiencyView, nextComparison, MAX_COMPARISON_POMODOROS } = loadSource('utils/pageGrowth.ts');
  assert.equal(MAX_COMPARISON_POMODOROS, 5);
  // 25분짜리 기록 9개: 장당 10, 9, 8, 7, 6, 5, 4, 3, 2분 → 가장 최근이 2분/P이고 1회 전부터 3, 4, 5, 6, 7분/P
  const rates = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const logs = rates.map((rate, index) => source({ id: `p${index}`, pagesRead: 25 / rate, timeSpentMinutes: 25,
    timestamp: `2026-10-0${index + 1}T04:00:00Z` }));
  const scope = getEfficiencyScope(logs, 0, 1);
  const seen = [];
  let comparison = 1;
  for (let step = 0; step < 7; step++) {
    const view = getEfficiencyView(scope, comparison);
    seen.push([view.comparison, view.reference.averageTimePerPage, view.overall.studyMinutes]);
    comparison = nextComparison(view);
  }
  // 1→2→3→4→5 회 전, 한 번 더 누르면 1회 전(기본)으로 돌아온다. 5회보다 더 이전과는 견주지 않는다.
  assert.deepEqual(seen.map(item => item[0]), [1, 2, 3, 4, 5, 1, 2]);
  assert.deepEqual(seen.slice(0, 5).map(item => item[1]), [3, 4, 5, 6, 7]);
  assert.deepEqual(seen.slice(0, 5).map(item => item[2]), [-1, -2, -3, -4, -5]);
  assert.equal(getEfficiencyView(scope, 9).comparison, 5, 'asking for a farther pomodoro stays at 5');
  assert.equal(getEfficiencyView(scope, 0).comparison, 1);
  // 앞 25분이 둘뿐이면 1 → 2 → 1, 하나뿐이면 늘 1
  const three = getEfficiencyView(getEfficiencyScope(logs.slice(0, 3), 0, 1), 1);
  assert.equal(three.maxComparison, 2);
  assert.equal(nextComparison(three), 2);
  assert.equal(nextComparison(getEfficiencyView(getEfficiencyScope(logs.slice(0, 3), 0, 1), 2)), 1);
  assert.equal(nextComparison({ comparison: 1, maxComparison: 1 }), 1);
  assert.equal(nextComparison({ comparison: 0, maxComparison: 0 }), 1);
  // 하루 이상 쉬었어도 "25분 전"은 공부한 시간으로만 센다
  const rested = getEfficiencyView(getEfficiencyScope([source({ id: 'x', pagesRead: 5, timeSpentMinutes: 25, timestamp: '2026-09-01T04:00:00Z' }),
    source({ id: 'y', pagesRead: 10, timeSpentMinutes: 25, timestamp: '2026-10-30T04:00:00Z' })], 0, 1));
  assert.deepEqual([rested.comparison, rested.reference.averageTimePerPage], [1, 5]);
});

test('the efficiency cell has a title with a pomodoro compare button next to it, two efficiencies with speed and study amount chips, and no percentages', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { UnitGrowthEfficiency } = loadSource('components/PageGrowth.tsx');
  const { getEfficiencyScope } = loadSource('utils/pageGrowth.ts');
  // 세 번째 값은 단위 경계("복습에 넣기"를 누른 시각들)
  const render = (logs, props = {}, boundaries = []) => renderToStaticMarkup(React.createElement(UnitGrowthEfficiency,
    { scope: getEfficiencyScope(logs, boundaries), ...props }));
  const logs = [
    source({ id: 'old', pagesRead: 5, startPage: 1, endPage: 5, timeSpentMinutes: 25, timeAttackMinutes: 10, timestamp: '2026-10-12T05:00:00Z' }),
    source({ id: 'new', pagesRead: 10, startPage: 6, endPage: 15, timeSpentMinutes: 25, timeAttackMinutes: 5, timestamp: '2026-10-12T09:00:00Z' })];
  const html = render(logs);
  assert.ok(html.includes('data-testid="efficiency-cell"') && html.includes('aria-label="효율"'));
  // 제목 "효율" 다음에 비교 버튼, 그 아래 전체 효율 → 타임어택 효율, 맨 아래 다음 단위까지
  assert.match(html, /<h4[^>]*>효율<\/h4>[\s\S]*data-testid="unit-compare"/);
  assert.ok(html.indexOf('unit-compare') < html.indexOf('전체 효율') && html.indexOf('전체 효율') < html.indexOf('타임어택 효율')
    && html.indexOf('타임어택 효율') < html.indexOf('이번 단위'));
  // 기본은 뽀모도로 1회 전. 시간(h)은 보이지 않는다.
  assert.match(html, /data-testid="unit-compare"[^>]*data-comparison="1"/);
  assert.ok(html.includes('뽀모도로 1회 전') && !html.includes('h 공부') && !html.includes('이후'));
  // 가장 최근 25분: 전체 2.5분/P(타임어택 0.5분/P)
  assert.ok(html.includes('>2.5</span>') && html.includes('>0.5</span>'));
  // 전체: 속도 +12.0P/h, 공부량 −2.5분/P. 타임어택: 속도 +90.0P/h, 공부량 −1.5분/P
  assert.ok(html.includes('속도 +12.0P/h') && html.includes('공부량 −2.5분/P'));
  assert.ok(html.includes('속도 +90.0P/h') && html.includes('공부량 −1.5분/P'));
  assert.equal((html.match(/data-growth-kind="speed"/g) || []).length, 2);
  assert.equal((html.match(/data-growth-kind="amount"/g) || []).length, 2);
  assert.ok(!/[+−-]\d+(\.\d+)?%/.test(html) && !html.includes('rose'), 'no percent growth anywhere');
  // 아직 복습에 넣지 않아 첫 단위를 채우는 중(고정 단위 크기가 없어 남은 장수 대신 지금까지 푼 장수)
  assert.ok(html.includes('unit-pages-done') && html.includes('1번째 단위 · 복습에 넣으면 단위가 끝나요'));
  // 앞 25분이 하나뿐이어도 과목 평균이 있어 버튼이 눌린다(뽀모도로 1회 전 ↔ 평균). 마친 단위가 없으니 단위 기준은 없다.
  assert.ok(!/<button[^>]*data-testid="unit-compare"[^>]*disabled=""/.test(html) && html.includes('›'));
  // 25분 한 덩어리뿐이면 견줄 앞 뽀모도로도, 평균도, 마친 단위도 없어 버튼이 눌리지 않는다
  const single = render([source({ id: 'solo', pagesRead: 10, startPage: 1, endPage: 10, timeSpentMinutes: 25, timestamp: '2026-10-12T05:00:00Z' })]);
  assert.match(single, /<button[^>]*data-testid="unit-compare"[^>]*disabled=""/);
  assert.ok(single.includes('비교할 뽀모도로 없음') && !single.includes('data-growth-kind'));
  // 임시값 안내 문구 같은 설명은 화면에 쓰지 않는다(도움말 ? 안에만 둔다)
  assert.ok(!html.includes('임시로') && !html.includes('직전 단위 값'));
  // 앞 25분이 둘이면 버튼이 눌린다
  const three = render([source({ id: 'z', pagesRead: 4, startPage: 1, endPage: 4, timeSpentMinutes: 25, timestamp: '2026-10-12T01:00:00Z' }), ...logs]);
  assert.ok(!/<button[^>]*data-testid="unit-compare"[^>]*disabled=""/.test(three) && three.includes('›'));
  // 다른 글자를 단위 이름으로 쓰면 어디서나 그 글자가 나온다: n/h · 분/n · n.1~20 · 20n 단위
  const custom = render(logs, { label: 'n' });
  assert.ok(custom.includes('속도 +12.0n/h') && custom.includes('공부량 −2.5분/n') && /unit-pages-done[\s\S]*?n<\/span>/.test(custom));
  assert.ok(custom.includes('>n</span>') && !custom.includes('P/h') && !custom.includes('분/P'));
  const word = render(logs, { label: '회' });
  assert.ok(word.includes('속도 +12.0회/h') && word.includes('공부량 −2.5분/회') && word.includes('1번째 단위 · 복습에 넣으면 단위가 끝나요'));
  // 단위를 막 채웠다: 새 단위가 0장부터 채워지고, 효율 칸에는 이전 단위의 평균을 가져온다. 그 단위 자신과는 견주지 않는다(앞 단위가 없으면 견줄 것이 없다).
  const filled = render([source({ pagesRead: 10, startPage: 1, endPage: 10, timeSpentMinutes: 50, timestamp: '2026-10-12T05:00:00Z' })], {}, [Date.parse('2026-10-12T06:00:00Z')]);
  assert.ok(filled.includes('>5.0</span>') && !filled.includes('새 단위 시작 전'));
  assert.ok(/unit-pages-done[\s\S]*?>0<span/.test(filled) && filled.includes('2번째 단위 · 복습에 넣으면 단위가 끝나요'), 'a new unit starts from zero after 복습에 넣기');
  assert.ok(filled.includes('비교할 단위 없음') && !filled.includes('뽀모도로 1회 전'));
  assert.match(filled, /<button[^>]*data-testid="unit-compare"[^>]*disabled=""/);
  // 25분이 안 되는 기록뿐이면 견줄 앞 뽀모도로가 없다
  const alone = render([source({ pagesRead: 7, startPage: 1, endPage: 7, timeSpentMinutes: 20, timeAttackMinutes: 10 })]);
  assert.ok(alone.includes('비교할 뽀모도로 없음') && !alone.includes('data-growth-kind') && !alone.includes('측정 필요'));
  // 기록이 하나도 없으면 넘겨받은 값(처음 추정값)을 쓰고, 이번 단위는 0장이다
  const empty = render([], { efficiency: 3.2, attackEfficiency: 0 });
  assert.ok(empty.includes('>3.2</span>') && empty.includes('측정 필요') && empty.includes('비교할 뽀모도로 없음'));
  assert.ok(/unit-pages-done[\s\S]*?>0<span/.test(empty) && empty.includes('이번 단위'));
  // 복습에 넣은 적이 없으면 마친 단위가 없어 뽀모도로 1회 전과 견주고, 효율은 처음부터 이어진다
  const none = render(logs);
  assert.ok(none.includes('뽀모도로 1회 전') && none.includes('1번째 단위'));
});

test('speed and study amount are shown to one decimal place: pages per hour and minutes per page, with no percentages', () => {
  const growth = loadSource('utils/pageGrowth.ts');
  const { toGrowthChange, getGrowthDelta, roundTenth, formatSignedTenth, describeGrowthChange, describeSpeed, describeStudyAmount, pagesPerReferenceTime, SPEED_REFERENCE_MINUTES, SPEED_REFERENCE_LABEL } = growth;
  // 속도 기준은 한 시간(뽀모도로 25분이 아니다)
  assert.equal(SPEED_REFERENCE_MINUTES, 60);
  assert.equal(SPEED_REFERENCE_LABEL, '1시간');
  assert.equal(pagesPerReferenceTime(2.5), 24);
  assert.equal(pagesPerReferenceTime(0), 0);
  // 2.5분/P → 3.0분/P: 1시간에 24장 → 20장(−4.0P/h), 한 페이지에 +0.5분(+0.5분/P)
  assert.deepEqual(toGrowthChange(2.5, 3.0), { speedPages: -4, studyMinutes: 0.5 });
  // 3.0 → 2.5: 속도 +4.0P/h, 공부량 −0.5분/P (속도가 늘면 공부량은 줄어, 늘 부호가 반대다)
  assert.deepEqual(toGrowthChange(3.0, 2.5), { speedPages: 4, studyMinutes: -0.5 });
  assert.deepEqual(toGrowthChange(4, 4), { speedPages: 0, studyMinutes: 0 });
  assert.equal(Object.is(toGrowthChange(4, 4).speedPages, -0), false, 'never "-0"');
  // 소수 첫째 자리까지: 2.45 → 2.1분/P는 60/2.1 − 60/2.45 = +4.08 → +4.1P/h, −0.35 → −0.4(0.35 반올림)
  assert.deepEqual(toGrowthChange(2.45, 2.1), { speedPages: 4.1, studyMinutes: -0.4 });
  assert.equal(toGrowthChange(0, 3), null);
  assert.equal(toGrowthChange(3, 0), null);
  assert.equal(toGrowthChange(undefined, 3), null);
  assert.equal(toGrowthChange(NaN, 3), null);
  const raw = getGrowthDelta(2.5, 3.0);
  assert.ok(Math.abs(raw.speedPages + 4) < 1e-9 && Math.abs(raw.studyMinutes - 0.5) < 1e-9);
  assert.equal(roundTenth(0.05), 0.1);
  assert.equal(roundTenth(-0.05), -0.1);
  assert.equal(roundTenth(1.24), 1.2);
  assert.equal(roundTenth(-2.66), -2.7);
  assert.equal(roundTenth(0.04), 0.0);
  assert.equal(Object.is(roundTenth(-0.04), -0), false);
  assert.equal(formatSignedTenth(3), '+3.0');
  assert.equal(formatSignedTenth(-3), '−3.0');
  assert.equal(formatSignedTenth(0), '0.0');
  assert.equal(formatSignedTenth(-0.04), '0.0');
  assert.equal(formatSignedTenth(12.34), '+12.3');
  const change = { speedPages: 4, studyMinutes: -1 };
  assert.equal(describeSpeed(change), '속도 +4.0P/h');
  assert.equal(describeStudyAmount(change), '공부량 −1.0분/P');
  // 속도와 공부량은 어느 쪽 부호이든 늘 함께 나온다. 기본 복습만 속도 하나(speedOnly).
  assert.equal(describeGrowthChange(change), '속도 +4.0P/h · 공부량 −1.0분/P');
  assert.equal(describeGrowthChange({ speedPages: -2.5, studyMinutes: 1.5 }), '속도 −2.5P/h · 공부량 +1.5분/P');
  assert.equal(describeGrowthChange(change, true), '속도 +4.0P/h');
  assert.equal(describeGrowthChange(null), null);
  assert.equal(growth.toGrowthDisplay, undefined, 'the percent rule is gone');
  assert.equal(growth.describeGrowth, undefined);
  assert.equal(growth.formatSignedPercent, undefined);
  assert.equal(growth.formatSignedWhole, undefined, 'whole numbers are gone too');
  assert.equal(growth.hoursSince, undefined, 'wall-clock time since the unit is not used');
});

test('growth chips show speed and study amount together, either sign, never red; basic review shows speed only', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { GrowthChips } = loadSource('components/EfficiencyBoxes.tsx');
  const faster = renderToStaticMarkup(React.createElement(GrowthChips, { change: { speedPages: 4.2, studyMinutes: -1 } }));
  assert.ok(faster.includes('속도 +4.2P/h') && faster.includes('공부량 −1.0분/P'));
  assert.ok(faster.includes('bg-green-100') && faster.includes('bg-indigo-100'));
  const slower = renderToStaticMarkup(React.createElement(GrowthChips, { change: { speedPages: -2.5, studyMinutes: 1.5 } }));
  assert.ok(slower.includes('속도 −2.5P/h') && slower.includes('공부량 +1.5분/P'), 'both appear even when the speed dropped');
  assert.ok(!slower.includes('bg-green-100') && !slower.includes('rose') && !slower.includes('red-') && !faster.includes('rose'));
  const same = renderToStaticMarkup(React.createElement(GrowthChips, { change: { speedPages: 0, studyMinutes: 0 } }));
  assert.ok(same.includes('속도 0.0P/h') && same.includes('공부량 0.0분/P') && !same.includes('<svg'));
  const speedOnly = renderToStaticMarkup(React.createElement(GrowthChips, { change: { speedPages: 3, studyMinutes: -1 }, speedOnly: true }));
  assert.ok(speedOnly.includes('속도 +3.0P/h') && !speedOnly.includes('공부량') && !speedOnly.includes('data-growth-kind="amount"'));
  assert.equal(renderToStaticMarkup(React.createElement(GrowthChips, { change: null })), '');
  // 복습과목의 평균 · 이번 복습 칸도 소수 첫째 자리 두 줄(속도 · 공부량)
  const { ReviewSpeedGrowthCell } = loadSource('components/PageGrowth.tsx');
  const cell = renderToStaticMarkup(React.createElement(ReviewSpeedGrowthCell, { changes: { average: { speedPages: -2.5, studyMinutes: 1.5 }, latest: { speedPages: 5, studyMinutes: -2 } } }));
  assert.ok(cell.includes('평균 증가율') && cell.includes('이번 복습 증가율'));
  assert.ok(cell.includes('>−2.5</span>') && cell.includes('>+1.5</span>') && cell.includes('>+5.0</span>') && cell.includes('>−2.0</span>'));
  assert.ok(cell.includes('P/h') && cell.includes('분/P') && !/\d%/.test(cell) && !cell.includes('rose') && !cell.includes('25분'));
  assert.equal((cell.match(/data-growth-kind="speed"/g) || []).length, 2);
  assert.equal((cell.match(/data-growth-kind="amount"/g) || []).length, 2);
  assert.ok(!cell.includes('data-testid="speed-graph"'), 'no graph without a series');
  assert.match(renderToStaticMarkup(React.createElement(ReviewSpeedGrowthCell, { changes: { average: null, latest: null } })), /평균 증가율<\/p><p[^>]*>-<\/p>/);
});

test('review change amounts average the per-measurement speed and study-amount differences and round them to one decimal', () => {
  const math = loadSource('utils/math.ts');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  let logs = [chainLog('old'), chainLog('new')];
  logs = recordReviewMeasurement(logs, ['old'], 'first', 20, true, '2026-10-11T04:00:00Z', measurement('old-review', 5, 3));
  logs = recordReviewMeasurement(logs, ['new'], 'first', 5, true, '2026-10-12T04:00:00Z', measurement('new-review', 5, 3));
  const amounts = math.calculateReviewChangeAmounts(logs, 'parent', 'first', '2026-10-12');
  // 이번: 1분/P vs 기준 3분/P → 1시간에 60장 vs 20장(+40.0P/h), −2.0분/P. 평균은 앞 측정(4분/P: −5.0P/h, +1.0분/P)과 평균 → +17.5, −0.5
  assert.deepEqual(amounts.latest, { speedPages: 40, studyMinutes: -2 });
  assert.deepEqual(amounts.average, { speedPages: 17.5, studyMinutes: -0.5 });
  assert.deepEqual(math.calculateReviewChangeAmounts(logs, 'parent', 'first', '2026-10-11').latest, { speedPages: -5, studyMinutes: 1 });
  assert.deepEqual(math.calculateReviewChangeAmounts(logs, 'other', 'first'), { average: null, latest: null });
  // 기준이 없는 측정은 평균에서 빠진다
  const bare = recordReviewMeasurement([chainLog('x')], ['x'], 'first', 6, true, '2026-10-12T04:00:00Z', { measurementId: 'bare', pagesRead: 3, lastEndPage: 30 });
  assert.deepEqual(math.calculateReviewChangeAmounts(bare, 'parent', 'first'), { average: null, latest: null });
  // 속도 그래프의 점도 같은 측정에서 온다
  const series = math.getReviewSpeedSeries(logs, 'parent', 'first');
  assert.deepEqual(series.map(point => [point.minutesPerPage, point.baselineMinutesPerPage]), [[4, 3], [1, 3]]);
});

test('page units are chosen when creating a plan and are not editable in its execution detail', () => {
  const { createNewStudyPlan, SubjectPlanner } = loadSource('components/SubjectPlanner.tsx');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const plan = createNewStudyPlan('New', 1, 100, '2026-12-31', true, [1], 25);
  assert.equal(plan.growthPageUnit, 25);
  assert.ok(!renderToStaticMarkup(React.createElement(SubjectPlanner, { onAddSubject() {} })).includes('new-plan-page-unit'), 'no page unit input: units are spans between two 복습에 넣기');
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { subjects: [plan], logs: [], detailSubjectId: plan.id,
    taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {},
    onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}, onUpdateSubject() {}, pomodoroPlan: { subjectId: plan.id, pages: 5, minutes: 25, remainingTaskPages: 25 } }));
  assert.ok(!html.includes('성장 설정') && !html.includes('성장 페이지 단위'));
  assert.ok(html.indexOf('뽀모도로') < html.indexOf('필요 횟수') && html.indexOf('필요 횟수') < html.indexOf('전체 효율'));
  assert.ok(html.indexOf('전체 효율') < html.indexOf('타임어택 효율'));
  assert.ok(!html.includes('ml-auto text-2xl'));
});

test('pomodoro and the efficiency cell share a compact strip with both growth values inside the growth cell', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const { UnitGrowthEfficiency } = loadSource('components/PageGrowth.tsx');
  const { getEfficiencyScope } = loadSource('utils/pageGrowth.ts');
  const scope = getEfficiencyScope([
    source({ pagesRead: 5, startPage: 1, endPage: 5, timeSpentMinutes: 25, timeAttackMinutes: 10 }),
    source({ id: 'new', pagesRead: 10, startPage: 6, endPage: 15, timeSpentMinutes: 25, timeAttackMinutes: 5, timestamp: '2026-10-12T04:00:00Z' })], 20, 1);
  const html = renderToStaticMarkup(React.createElement(PomodoroSummary, {
    pages: 5, efficiency: 5.12, attackEfficiency: 2.26, remainingTaskPages: 21,
    efficiencySlot: React.createElement(UnitGrowthEfficiency, { scope, efficiency: 5.12, attackEfficiency: 2.26 })
  }));
  assert.ok(html.includes('pomodoro-growth-strip'));
  assert.ok(html.includes('필요 횟수'));
  assert.match(html, /5<[^>]*>회/);
  assert.ok(html.includes('전체 효율') && html.includes('타임어택 효율'));
  assert.ok(html.includes('속도 +12.0P/h') && html.includes('공부량 −2.5분/P') && html.includes('속도 +90.0P/h'));
  assert.ok(html.includes('unit-pages-done'));
  // 값은 가장 최근 25분(2.5 / 0.5)이고, 넘겨받은 5.1 / 2.3(처음 추정값)이 아니다
  assert.ok(html.includes('current-overall-efficiency') && html.includes('>2.5</span>'));
  assert.ok(html.includes('current-attack-efficiency') && html.includes('>0.5</span>'));
  assert.ok(!html.includes('>5.1</span>') && !html.includes('>2.3</span>'));
  assert.ok(html.includes('focus-visible:ring-2'), 'the compare button is focusable');
  assert.ok(!html.includes('min-w-[15rem]'));
  const empty = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: null, remainingTaskPages: 21 }));
  assert.ok(empty.includes('측정 필요') && !empty.includes('필요 횟수'));
});

test('pomodoro time and its page target are emphasized above the current calculation efficiency', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const html = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: 6, efficiency: 4.26, attackEfficiency: 1.93, remainingTaskPages: 13 }));
  assert.match(html, /25<[^>]*>분/);
  assert.match(html, /풀 장수[\s\S]*6<[^>]*>P/);
  assert.ok(html.includes('current-overall-efficiency') && html.includes('>4.3</span>') && html.includes('성장 척도'));
  assert.ok(html.indexOf('한 번에') < html.indexOf('전체 효율') && html.indexOf('전체 효율') < html.indexOf('타임어택 효율'));
  assert.ok(html.indexOf('필요 횟수') < html.indexOf('전체 효율') && html.includes('>1.9</span>'));
  assert.match(html, /3<[^>]*>회/);
  assert.ok(!html.includes('현재 전체 효율') && !html.includes('현재 타임어택 효율'));
  const empty = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: null, efficiency: 0 }));
  assert.match(empty, /25<[^>]*>분/);
  assert.ok(empty.includes('측정 필요') && !empty.includes('0.0') && !empty.includes('풀 장수'));
});

test('both efficiency values use the latest 25 minutes for ordinary and review subjects, compared with the pomodoro before', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  for (const entry of [{ id: 'main', parentId: undefined, subjects }, { id: 'first', parentId: 'parent', subjects: reviewChainSubjects }]) {
    const logs = [source({ subjectId: entry.id, reviewParentSubjectId: entry.parentId, pagesRead: 10, startPage: 1, endPage: 10,
      timeSpentMinutes: 50, timeAttackMinutes: 20, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'partial', subjectId: entry.id, reviewParentSubjectId: entry.parentId, pagesRead: 5, startPage: 11, endPage: 15,
      timeSpentMinutes: 5, timeAttackMinutes: 2.5, timestamp: '2026-10-12T04:00:00Z' })];
    const html = renderToStaticMarkup(React.createElement(TodaySummary, {
      logs, subjects: entry.subjects.map(subject => subject.id === entry.id ? { ...subject, growthPageUnit: 0, reviewGrowthDisplay: 'unit' } : subject),
      detailSubjectId: entry.id, activeWeekday: 1, activeStudyDate: '2026-10-12', taskSelector: '오늘 할 일',
      onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}
    }));
    // 최근 25분 = 새 기록 5분(5P) + 앞 기록 20분(4P) → 9P: 전체 2.8분/P(25 ÷ 9), 타임어택 (2.5 + 8) ÷ 9 = 1.2분/P
    assert.ok(html.includes('current-overall-efficiency') && html.includes('>2.8</span>') && !html.includes('>5.0</span>'));
    assert.ok(html.includes('current-attack-efficiency') && html.includes('>1.2</span>') && !html.includes('>2.0</span>'));
    // 뽀모도로 1회 전(앞 기록 25분: 5.0분/P · 타임어택 2.0분/P)과 견준 변화:
    // 전체 속도 +9.6P/h, 공부량 −2.2분/P / 타임어택 속도 +21.4P/h, 공부량 −0.8분/P
    assert.ok(html.includes('속도 +9.6P/h') && html.includes('공부량 −2.2분/P'));
    assert.ok(html.includes('속도 +21.4P/h') && html.includes('공부량 −0.8분/P'));
    assert.ok(html.includes('뽀모도로 1회 전'));
    // 단위가 없는 과목(growthPageUnit 0)에는 다음 단위까지 게이지가 없다
    assert.ok(!html.includes('다음 단위까지') && !html.includes('unit-pages-remaining'));
    assert.equal((html.match(/>분\/P<\/span>/g) || []).length, 2, 'the two efficiency values carry the per-page unit as their own span');
    assert.ok(!html.includes('현재 전체 효율') && !html.includes('현재 타임어택 효율'));
  }
});

test('review forecasts inherit the parent latest 25 minutes and use their own measured 25 minutes once available', () => {
  const math = loadSource('utils/math.ts');
  const currentSubjects = reviewChainSubjects.map(subject => ({ ...subject, growthPageUnit: 10 }));
  const old = chainLog('old', { pagesRead: 10, timeSpentMinutes: 100, timeAttackMinutes: 50, timestamp: '2026-10-10T04:00:00Z' });
  const fresh = chainLog('fresh', { pagesRead: 3, timeSpentMinutes: 3, timeAttackMinutes: 1.5, timestamp: '2026-10-12T04:00:00Z' });
  const parentHistory = [old, fresh];
  // 부모의 최근 25분 = fresh 3분(3P) + old의 22분(2.2P) → 25 ÷ 5.2P. 타임어택은 (1.5 + 11) ÷ 5.2
  const inherited = math.calculateReviewSubjectTiming(parentHistory, 'parent', 'first', currentSubjects, [fresh]);
  assert.ok(Math.abs(inherited.averageTimePerPage - 25 / 5.2) < 1e-8);
  assert.ok(Math.abs(math.calculateReviewSubjectTiming(parentHistory, 'parent', 'first', currentSubjects, [fresh], ['first'], true).averageTimePerPage - 12.5 / 5.2) < 1e-8);
  // 복습 과목 자신의 측정이 생기면 그 측정의 최근 25분을 쓴다: tail 5분(5P) + 앞 측정 20분(5P) → 2.5분/P, 타임어택 (2.5 + 10) ÷ 10
  const own = [source({ subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 20, timeSpentMinutes: 80, timeAttackMinutes: 40, timestamp: '2026-10-11T04:00:00Z' }),
    source({ id: 'tail', subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 5, timeSpentMinutes: 5, timeAttackMinutes: 2.5, timestamp: '2026-10-12T04:00:00Z' })];
  assert.equal(math.calculateReviewSubjectTiming([...parentHistory, ...own], 'parent', 'first', currentSubjects, [fresh]).averageTimePerPage, 2.5);
  assert.equal(math.calculateReviewSubjectTiming([...parentHistory, ...own], 'parent', 'first', currentSubjects, [fresh], ['first'], true).averageTimePerPage, 1.25);
});

test('review unit averages do not count parent allocations and own session logs twice', () => {
  const math = loadSource('utils/math.ts');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const own = [1, 2].map(id => source({ id: `own${id}`, subjectId: 'first', reviewParentSubjectId: 'parent',
    pagesRead: 5, timeSpentMinutes: 20, timeAttackMinutes: 10, timestamp: `2026-10-1${id}T04:00:00Z` }));
  let parents = [chainLog()];
  own.forEach((log, index) => {
    parents = recordReviewMeasurement(parents, ['source'], 'first', 20, index === 1, log.timestamp,
      { pagesRead: 5, baselineTimePerPage: 4, timeAttackMinutes: 10, baselineTimeAttackPerPage: 2, lastEndPage: 20 + index * 5, measurementId: log.id });
  });
  const samples = math.getReviewEfficiencySamples([...parents, ...own], 'parent', 'first');
  assert.equal(samples.reduce((sum, sample) => sum + sample.pagesRead, 0), 10);
  assert.equal(samples.reduce((sum, sample) => sum + sample.timeSpentMinutes, 0), 40);
  assert.equal(math.calculateSubjectReviewAverageTimePerPage([...parents, ...own], 'parent', 'first', 10), 4);
});

test('today measurement status follows the actual record date rather than its assigned task day', () => {
  const { hasMeasurementOnDate } = loadSource('utils/pageGrowth.ts');
  const log = source({ studyDate: '2026-10-13', timestamp: '2026-10-12T04:00:00Z' });
  assert.equal(hasMeasurementOnDate([log], '2026-10-13'), false);
  assert.equal(hasMeasurementOnDate([{ ...log, studyDate: '2026-10-14' }], '2026-10-12'), true);
  assert.equal(hasMeasurementOnDate([{ ...log, timeSpentMinutes: 0 }], '2026-10-12'), false);
});

test('carryover shrinks by pages studied beyond earlier daily quotas', () => {
  const { getPastCarryoverPages, getLocalDateKey } = loadSource('utils/schedule.ts');
  const mk = (id, dateKey, start, end) => ({
    id, subjectId: 's1', pagesRead: end - start + 1, startPage: start, endPage: end, pageCountIsExplicit: true,
    timeSpentMinutes: (end - start + 1) * 3, timestamp: `${dateKey}T12:00:00`, studyDate: dateKey
  });
  const plan = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 };
  const subject = (completedPages, extra = {}) => ({
    id: 's1', name: '수학', totalPages: 100, startPage: 1, completedPages, targetDate: '2026-12-31',
    createdAt: '2026-10-12T09:00:00', planResetDate: '2026-10-12', scheduledWeekdays: [1, 2, 3, 4, 5],
    scheduledWeekdayPages: plan, ...extra
  });
  const today = getLocalDateKey(new Date(2026, 9, 16, 10));
  // Monday missed (-4), Wednesday 7P (+3 over quota): carry only the 1P still owed.
  const logs = [mk('a', '2026-10-13', 1, 4), mk('b', '2026-10-14', 5, 11), mk('c', '2026-10-15', 12, 15)];
  assert.equal(getPastCarryoverPages(subject(15), logs, today, today), 1);
  // Everything done on time, or done in excess, never goes below zero.
  const done = [mk('a', '2026-10-12', 1, 4), mk('b', '2026-10-13', 5, 10), mk('c', '2026-10-14', 11, 14), mk('d', '2026-10-15', 15, 18)];
  assert.equal(getPastCarryoverPages(subject(18), done, today, today), 0);
  // A larger quota on the missed day still carries the larger shortfall.
  assert.equal(getPastCarryoverPages(subject(15, { scheduledWeekdayPages: { ...plan, 1: 6 } }), logs, today, today), 3);
});

test('the organize clock continues from the solving time and shows the split', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { OrganizationTimer } = loadSource('components/SessionLogger.tsx');
  const html = renderToStaticMarkup(React.createElement(OrganizationTimer,
    { seconds: 65, baseSeconds: 1500, running: true, onToggle() {}, onComplete() {} }));
  assert.ok(html.includes('막힌 부분 정리') && html.includes('26:05'));
  assert.ok(html.includes('풀이 25:00') && html.includes('정리 01:05'));
});

test('trend analysis plots one point per unit (between two 복습에 넣기) against the first unit', () => {
  const { getUnitSpeedTrend } = loadSource('utils/pageGrowth.ts');
  const log = (id, pagesRead, timeSpentMinutes, timestamp) => ({ id, subjectId: 'main', pagesRead, timeSpentMinutes, timestamp });
  const trend = getUnitSpeedTrend([
    log('c', 5, 12.5, '2026-10-12T03:00:00Z'),
    log('a', 10, 50, '2026-10-10T03:00:00Z'),
    log('b', 10, 40, '2026-10-11T03:00:00Z')
  ], [Date.parse('2026-10-10T12:00:00Z'), Date.parse('2026-10-11T12:00:00Z')]);
  assert.deepEqual(trend.map(point => point.speedIncrease), [0, 25, 100]);
  assert.deepEqual(trend.map(point => point.timestamp), ['2026-10-10T03:00:00Z', '2026-10-11T03:00:00Z', '2026-10-12T03:00:00Z']);
  assert.equal(trend[2].unit.complete, false);
  // 복습에 넣은 적이 없으면 한 단위(채우는 중)뿐이다
  const single = getUnitSpeedTrend([log('x', 20, 80, '2026-10-10T03:00:00Z')], []);
  assert.equal(single.length, 1);
  assert.equal(single[0].unit.complete, false);
  assert.deepEqual(getUnitSpeedTrend([], []), []);
});

test('today status rows mark one current row, keep the review accent separate and step with arrows', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TaskQueueList, StepArrows, SummaryTiles, StartButton } = loadSource('components/TodayTasks.tsx');
  const items = [
    { key: 'review-a', detailKey: 'basic-review:m', kind: 'review', kindLabel: '기본 복습', title: '수학', meta: '범위 1~10', required: false, timeLabel: '35분', state: 'pending' },
    { key: 'study-b', detailKey: 'e', kind: 'study', kindLabel: '학습', title: '영어', meta: '오늘 권장 p.1~5 · 5P', required: true, timeLabel: '측정 필요', state: 'pending' }
  ];
  const html = renderToStaticMarkup(React.createElement(TaskQueueList, { items, currentKey: 'e', onRefresh() {} }));
  assert.equal((html.match(/<li /g) || []).length, 2);
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
  assert.match(html, /data-task-key="study-b" data-task-state="pending" aria-current="true"/);
  assert.ok(html.includes('지금'));
  assert.ok(html.includes('필수') && html.includes('측정 필요') && html.includes('계획 갱신'));
  const rowOf = key => html.slice(html.indexOf(`data-task-key="${key}"`)).split('</li>')[0];
  assert.ok(rowOf('review-a').includes('bg-amber-700') && rowOf('study-b').includes('bg-indigo-600') && html.includes('border-slate-900 shadow-md bg-white ring-2 ring-indigo-300'), 'review accent stays separate from study; the current cell is framed darker');
  // 고르는 버튼이 아니다: 줄에는 button·radio가 없고, 옮기는 일은 화살표가 한다.
  assert.ok(!html.includes('role="radio"') && !/<li[^>]*>\s*<button/.test(html) && !html.includes('role="dialog"'));
  const empty = renderToStaticMarkup(React.createElement(TaskQueueList, { items: [], currentKey: '', onRefresh() {} }));
  assert.ok(empty.includes('오늘 할 일이 없습니다.') && !empty.includes('<li '));

  const stepped = [];
  const stepper = element => renderToStaticMarkup(element);
  const first = stepper(React.createElement(StepArrows, { position: 1, total: 3, done: false, onStep: d => stepped.push(d) }));
  assert.ok(first.includes('aria-label="더 중요한 할 일로" disabled') && !first.includes('aria-label="덜 중요한 할 일로" disabled'));
  assert.ok(first.includes('가장 중요한 할 일 · 1 / 3') && first.includes('data-testid="task-stepper"') && first.includes('>1 / 3<'));
  const last = stepper(React.createElement(StepArrows, { position: 3, total: 3, done: true, onStep() {} }));
  assert.ok(last.includes('aria-label="덜 중요한 할 일로" disabled') && last.includes('완료한 과목 · 3 / 3'));
  const middle = stepper(React.createElement(StepArrows, { position: 2, total: 3, done: false, onStep() {} }));
  assert.ok(!middle.includes('disabled=""') && middle.includes('중요한 순서 2 / 3'));

  // "할 일 N건" 알약은 없고, 그 자리에 화살표가 온다(그 뒤로 예상 소요 · 오늘 완료)
  const tiles = renderToStaticMarkup(React.createElement(SummaryTiles, { minutes: 148, completedLabel: '0P · 0분',
    stepper: { position: 2, total: 5, done: false, onStep() {} } }));
  assert.ok(tiles.includes('2시간 28분') && tiles.includes('0P · 0분') && !tiles.includes('건<') && !/>할 일</.test(tiles));
  assert.ok(tiles.indexOf('data-testid="task-stepper"') < tiles.indexOf('예상 소요') && tiles.indexOf('예상 소요') < tiles.indexOf('오늘 완료'));
  const withNotes = renderToStaticMarkup(React.createElement(SummaryTiles, { minutes: 148, completedLabel: '0P · 0분', action: React.createElement('button', null, '정리노트') }));
  assert.ok(withNotes.includes('정리노트') && !withNotes.includes('task-stepper'));
  assert.ok(renderToStaticMarkup(React.createElement(SummaryTiles, { minutes: 0, completedLabel: '' })).includes('측정 필요'));
  assert.ok(renderToStaticMarkup(React.createElement(StartButton, { kind: 'review', onClick() {} })).includes('복습 시작'));
  assert.ok(renderToStaticMarkup(React.createElement(StartButton, { kind: 'study', onClick() {} })).includes('학습 시작'));
});

test('the basic review screen lists questions by number and type only and previews the next interval', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewPracticeScreen, formatReviewInterval } = loadSource('components/ReviewPracticeScreen.tsx');
  assert.equal(formatReviewInterval(2 * 3600000), '2시간');
  assert.equal(formatReviewInterval(86400000), '1일');
  assert.equal(formatReviewInterval(8 * 86400000), '8일');
  assert.equal(formatReviewInterval(1000), '1시간');
  const base = {
    title: '기본 복습', isRetry: false, subjectName: '수학', rangeLabel: '1~10', elapsed: '00:10', targetRemaining: '05:00',
    isRunning: true, canPause: true, pauseLabel: '잠시 중단', onTogglePause() {}, onClose() {}, onCondenseFirst() {},
    level: 1, round: 1, roundSize: 2, queueLength: 2, hasQuestions: true, isComplete: false,
    question: React.createElement('p', null, '문제전용문장'), questionRange: '1~10', hasCurrentQuestion: true,
    revealed: false, onReveal() {}, onGrade() {}, wrongIntervalLabel: '2시간', correctIntervalLabel: '1일',
    rail: [{ id: 'a', label: '1번 · 기본 관계', status: 'now', wrongCount: 0 }, { id: 'b', label: '2번 · 역방향', status: 'waiting', wrongCount: 0 }],
    firstTryCorrect: 0, firstTryTotal: 0, completion: null, firstTryOk: 0, firstTryBad: 0,
    finishLabel: '남은 문제 2', canFinish: false, onFinish() {}
  };
  const asking = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, base));
  assert.ok(asking.includes('1번 · 기본 관계') && asking.includes('2번 · 역방향'));
  assert.equal((asking.match(/문제전용문장/g) || []).length, 1);
  assert.ok(asking.includes('정답 확인') && asking.includes('머릿속으로 먼저 떠올려 보세요'));
  assert.ok(!asking.includes('다음 복습 1일 뒤') && asking.includes('disabled=""'));
  const graded = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...base, revealed: true }));
  assert.ok(graded.includes('다시 풀고, 다음 복습 2시간 뒤') && graded.includes('다음 복습 1일 뒤')); assert.ok(['오답', '어렵게 맞음', '맞음', '쉽게 맞음'].every(label => graded.includes('>' + label + '<')), 'four grades: wrong, hard, good, easy');
  assert.ok(!graded.includes('정답 확인') && !graded.includes('머릿속으로'));
  const done = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...base, isComplete: true, canFinish: true, finishLabel: '복습 완료',
    firstTryCorrect: 4, firstTryTotal: 5, firstTryOk: 4, firstTryBad: 1, completion: React.createElement('div', null, '완료노트') }));
  assert.ok(done.includes('기본 복습 완료') && done.includes('첫 시도 정답 4') && done.includes('오답 1') && done.includes('완료노트'));
  assert.ok(done.includes('4 / 5 · 80%') && !done.includes('문제전용문장'));
});

test('tutorials walk through every step and open from a help button', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteTutorial, MeasurementTutorial } = loadSource('components/Tutorials.tsx');
  const note = renderToStaticMarkup(React.createElement(NoteTutorial, { onClose() {} }));
  assert.ok(note.includes('정리노트 쓰는 법') && note.includes('1 / 15'));
  for (const label of ['두 가지를 이어요', '거꾸로만 물어요', '그리고 · 등호', '묶어서 써요', '접어서 정리해요',
    '이름을 붙여요', '겹치는 곳을 찾아요', '빼고 찾아요', '집합을 글에 넣어요', '한 칸으로 묶어요', '앞 칸을 다시 써요', '아무 글이나 대신해요', '이어 붙여요', '이어 쓸 것을 찾아요', '문제에서 빼요']) assert.ok(note.includes(label));
  // 새 단계의 예시는 실제 출제 결과다: 노트를 그대로 넣었을 때 문장과 정답이 같다
  const { buildReviewQuestions, getReviewQuestionSentence } = loadSource('utils/reviewQuestions.ts');
  const asked = (memo, criterion) => buildReviewQuestions(memo).questions.map(q => [getReviewQuestionSentence(criterion ?? null, q)?.statement, q.answer]);
  const has = (list, statement, answer) => assert.ok(list.some(([s, a]) => s === statement && a === answer), `${statement} → ${answer}`);
  has(asked('[개념:정의] 증기기관:열로 피스톤을 움직이는 기관'), '‘개념:정의’에서 개념 ‘증기기관’에 이어지는 정의 값은?', '열로 피스톤을 움직이는 기관');
  has(asked('수열:수를 차례로 늘어놓은 것\n[수열] 등차수열:이웃한 두 항의 차가 일정한 수열'), '‘수열’에서 ‘등차수열’에 이어지는 것은?', '이웃한 두 항의 차가 일정한 수열');
  has(asked('[삼각형.특수한 도형] 이등변삼각형:두 변의 길이가 같다'), '‘삼각형.특수한 도형’에서 ‘이등변삼각형’에 이어지는 것은?', '두 변의 길이가 같다');
  has(asked('[삼각형.특수한 도형] 이등변삼각형:두 변의 길이가 같다'), '‘삼각형.특수한 도형’에서 ‘두 변의 길이가 같다’에 앞서 이어진 것은?', '이등변삼각형');
  // 연결·첨가·[?]·[!]도 실제 결과 그대로다
  const { mergeNoteChains } = loadSource('utils/noteMerge.ts');
  const linked = mergeNoteChains('[A] B : [D] C', '[A] B : [D] C : [K] L');
  assert.deepEqual([linked.text, linked.kind], ['[A] B:[D] C:[K] L', 'link']);
  const skipped = mergeNoteChains('[A] B : [D] C', '[A:D] B :: [K] L');
  assert.deepEqual([skipped.text, skipped.kind], ['[A] B:[D] C:[K] L', 'add']);
  const added = mergeNoteChains('사과:빨강', '사과:둥글다');
  assert.deepEqual([added.text, added.kind], ['사과:빨강=둥글다', 'add']);
  const fruit = loadSource('utils/noteSets.ts').buildNoteSetIndex([':::toggle 과일\n사과\n배=pear\n포도:보라색\n:::end\n[?]()']);
  assert.deepEqual(loadSource('utils/noteSets.ts').setContents(fruit, '?').map(row => row.name), ['사과', '배=pear']);
  assert.deepEqual(asked('[!] 고래:물고기\n고래:포유류').map(([s, a]) => `${s} ${a}`), ['‘고래’에 이어지는 것은? 포유류', '‘포유류’에 앞서 이어진 것은? 고래']);
  assert.deepEqual(asked(':::toggle !\n고래:물고기\n:::end\n고래:포유류').map(([s, a]) => `${s} ${a}`), ['‘고래’에 이어지는 것은? 포유류', '‘포유류’에 앞서 이어진 것은? 고래']);
  // `.`는 교집합, `,`는 합집합: 두 집합에 모두 든 셀만 나온다
  const { buildNoteSetIndex, setContents } = loadSource('utils/noteSets.ts');
  const triangles = buildNoteSetIndex([':::toggle 삼각형\n이등변삼각형\n직각삼각형\n:::end\n:::toggle 특수한 도형\n이등변삼각형\n정사각형\n:::end']);
  assert.deepEqual(setContents(triangles, '삼각형.특수한 도형').map(row => row.name), ['이등변삼각형']);
  assert.deepEqual(setContents(triangles, '삼각형,특수한 도형').map(row => row.name), ['이등변삼각형', '직각삼각형', '정사각형']);
  // `%`는 여집합: 도형에는 들고 삼각형에는 들지 않은 셀만 나온다
  const shapes = buildNoteSetIndex([':::toggle 도형\n정사각형\n직각삼각형\n이등변삼각형\n:::end\n:::toggle 삼각형\n직각삼각형\n이등변삼각형\n:::end']);
  assert.deepEqual(setContents(shapes, '도형.%삼각형').map(row => row.name), ['정사각형']);
  has(asked('[도형.%삼각형] 정사각형:네 변이 같다'), '‘도형.%삼각형’에서 ‘정사각형’에 이어지는 것은?', '네 변이 같다');
  has(asked('[도형.%삼각형] 정사각형:네 변이 같다'), '‘도형.%삼각형’에서 ‘네 변이 같다’에 앞서 이어진 것은?', '정사각형');
  // `{A}`는 집합 A의 원소가 들어갈 자리: 원소마다 한 줄씩 있는 것처럼 문제가 나온다
  const slotMemo = ':::toggle 사람\n철수\n영희\n:::end\n인사: {사람}아 반가워';
  has(asked(slotMemo), '‘인사’에 이어지는 것은?', '철수아 반가워');
  has(asked(slotMemo), '‘인사’에 이어지는 것은?', '영희아 반가워');
  has(asked(slotMemo), '‘영희아 반가워’에 앞서 이어진 것은?', '인사');
  has(asked(':::toggle 사람\n철수\n영희\n:::end\n인사: \'{사람}아, 반가워\''), '‘철수아, 반가워’에 앞서 이어진 것은?', '인사');
  // 집합이 아닌 이름은 자리가 아니라서 지금처럼 칸 이름표다
  has(asked('a:{원인}b'), '‘a’에 이어지는 원인 값은?', 'b');
  has(asked('[개념:정의] 산업혁명:{원인}증기기관'), '‘개념:정의’에서 개념 ‘산업혁명’에 이어지는 원인 값은?', '증기기관');
  has(asked('[개념:정의] 산업혁명:{원인}증기기관'), '‘개념:정의’에서 원인 ‘증기기관’에 앞서 이어진 개념 값은?', '산업혁명');
  has(asked("주제:'서울:부산'"), '‘주제’에서 ‘서울’에 대응하는 것은?', '부산');
  has(asked("'3-2':1"), '‘3-2’에 이어지는 것은?', '1');
  assert.ok(buildReviewQuestions('1 : @+1 : @+1').questions.some(q => q.prompt === '1' && q.answer === '1+1'));
  has(asked(":::toggle A\n'B-C'\n'X-Y'\n:::end\n[A] #'-'#: #+#"), '‘A’에서 ‘B-C’에 이어지는 것은?', 'B+C');
  has(asked(":::toggle A\n'B-C'\n'X-Y'\n:::end\n[A] #'-'#: #+#"), '‘A’에서 ‘X+Y’에 앞서 이어진 것은?', 'X-Y');
  const flow = renderToStaticMarkup(React.createElement(MeasurementTutorial, { onClose() {} }));
  assert.ok(flow.includes('학습 측정 이렇게 해요') && flow.includes('1 / 4'));
  for (const label of ['타임어택 풀이', '막힌 부분 정리', '세션 메모', '전체 효율']) assert.ok(flow.includes(label));
  const { HelpPopover } = loadSource('components/TodayTasks.tsx');
  const closed = renderToStaticMarkup(React.createElement(HelpPopover, { label: '설명' }, '내용'));
  assert.ok(closed.includes('aria-expanded="false"') && !closed.includes('role="dialog"') && !closed.includes('내용'));
});

test('the note diagram reads relations, arrows, same-line splits and the four toggle forms', () => {
  const { parseNoteDiagram, parseCriterionLabels, maxDiagramFields } = loadSource('utils/noteDiagram.ts');
  const memo = '등차수열:차가 일정\n등비수열<비가 일정 // 공차:{이름}이웃한 차\n메모만 있는 줄\n[a:b]:c';
  const items = parseNoteDiagram(memo);
  assert.deepEqual(items[0], { kind: 'relation', fields: ['등차수열', '차가 일정'], arrows: ['both'] });
  assert.deepEqual(items[1], { kind: 'relation', fields: ['등비수열', '비가 일정'], arrows: ['back'] });
  assert.deepEqual(parseNoteDiagram('등비수열;비가 일정')[0], { kind: 'relation', fields: ['등비수열', '비가 일정'], arrows: ['forward'] }, '`;` points forward only');
  assert.deepEqual(items[2], { kind: 'relation', fields: ['공차', '이웃한 차'], arrows: ['both'] });
  assert.deepEqual(items[3], { kind: 'plain', text: '메모만 있는 줄' });
  assert.deepEqual(items[4], { kind: 'relation', fields: ['[a:b]', 'c'], arrows: ['both'] });

  // 1) ">A:" + 아래 줄 = A:B, 줄을 바꾼 각 줄은 서로 "또는"
  assert.deepEqual(parseNoteDiagram(':::toggle A:\nB\nC\n:::end'), [{ kind: 'fan', left: 'A', arrow: 'both', right: ['B', 'C'], operator: 'or' }]);
  // 2) ">A" + 아래 줄 = A 안에 B가 들어 있는 상하관계
  assert.deepEqual(parseNoteDiagram(':::toggle A\nB\nC\n:::end'), [{ kind: 'group', relation: 'hierarchy', title: 'A', items: [{ kind: 'plain', text: 'B' }, { kind: 'plain', text: 'C' }] }]);
  // 3) ">A:C" + "B:D" = A:C 아래에 B:D가 포함된 포함관계
  assert.deepEqual(parseNoteDiagram(':::toggle A:C\nB:D\n:::end'), [{ kind: 'group', relation: 'containment', title: 'A:C',
    header: { fields: ['A', 'C'], arrows: ['both'] }, items: [{ kind: 'relation', fields: ['B', 'D'], arrows: ['both'] }] }]);
  // 4) ">A;" + 아래 줄 둘 이상 = A;B,C 부분관계 (아래 줄은 "그리고")
  assert.deepEqual(parseNoteDiagram(':::toggle A;\nB\nC\n:::end'), [{ kind: 'fan', left: 'A', arrow: 'forward', right: ['B', 'C'], operator: 'or' }]);
  assert.deepEqual(parseNoteDiagram(':::toggle A;,\nB\nC\n:::end'), [{ kind: 'fan', left: 'A', arrow: 'forward', right: ['B', 'C'], operator: 'and' }], 'a , at the very end makes the rows AND');
  assert.deepEqual(parseNoteDiagram(':::toggle A<\nB\nC\n:::end'), [{ kind: 'fan', left: 'A', arrow: 'back', right: ['B', 'C'], operator: 'or' }]);
  // `=`는 칸을 나누지 않는다: `A:B=C`는 A와 `B=C` 두 칸이고 화살표는 `:` 하나뿐이다
  assert.deepEqual(parseNoteDiagram('A:B=C')[0], { kind: 'relation', fields: ['A', 'B=C'], arrows: ['both'] });
  assert.deepEqual(parseNoteDiagram('A=B')[0], { kind: 'plain', text: 'A=B' });
  // 제목 끝의 띄어쓰기와 {분류 이름}은 무시한다
  assert.deepEqual(parseNoteDiagram(':::toggle 수열의 합 : {정의}\n항\n:::end')[0], { kind: 'fan', left: '수열의 합', arrow: 'both', right: ['항'], operator: 'or' });
  // 아래 줄이 관계이면 한 칸에 담지 않고, 제목의 기호에 맞는 연결(또는/그리고)로 묶음 안에 나열한다
  const nested = parseNoteDiagram(':::toggle 합 :\n가:나\n다:라\n:::end');
  assert.equal(nested[0].kind, 'group');
  assert.equal(nested[0].relation, 'hierarchy');
  assert.equal(nested[0].connector, 'or');
  assert.equal(nested[0].items.length, 2);

  assert.equal(maxDiagramFields(parseNoteDiagram('a:b:c\n:::toggle t :\nd:e:f:g\n:::end')), 4);
  assert.deepEqual(parseCriterionLabels('개념:정의'), ['개념', '정의']);
  assert.deepEqual(parseCriterionLabels(null), []);
  assert.deepEqual(parseNoteDiagram(''), []);
  assert.deepEqual(parseNoteDiagram('끝에 콜론:'), [{ kind: 'plain', text: '끝에 콜론:' }]);
});

test('the note tab groups notes by subject, newest first, as one paged sheet with a single symbol bar', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteTab, NoteDiagram, groupNotesBySubject, mergeNoteTexts } = loadSource('components/NoteTab.tsx');
  const { NOTE_SYMBOLS } = loadSource('components/NoteSymbolBar.tsx');
  assert.deepEqual(NOTE_SYMBOLS.map(symbol => symbol.value), [':', ';', '<', ',', '=', '-', '( )', '//', '>']);
  const logs = [
    { id: 'a', subjectId: 'main', pagesRead: 10, startPage: 21, endPage: 30, timeSpentMinutes: 20, timestamp: '2026-09-12T20:00:00.000Z', reviewMemo: '등차수열:차가 일정', reviewRegisteredAt: '2026-09-12T22:00:00.000Z' },
    { id: 'a2', subjectId: 'main', pagesRead: 10, startPage: 31, endPage: 40, timeSpentMinutes: 20, timestamp: '2026-09-13T20:00:00.000Z', reviewMemo: '등비수열;비가 일정', reviewRegisteredAt: '2026-09-13T22:00:00.000Z' },
    { id: 'b', subjectId: 'practice', pagesRead: 5, timestamp: '2026-09-14T20:00:00.000Z', reviewMemo: '   ' },
    { id: 'c', subjectId: 'gone', subjectNameSnapshot: '옛 과목', pagesRead: 3, startPage: 1, endPage: 3, timeSpentMinutes: 9, timestamp: '2026-09-10T20:00:00.000Z', reviewMemo: '가;나' }
  ];
  const groups = groupNotesBySubject(logs, subjects);
  assert.deepEqual(groups.map(group => [group.id, group.name, group.logs.map(log => log.id)]),
    [['main', 'Main', ['a2', 'a']], ['gone', '옛 과목', ['c']]]);
  assert.equal(groupNotesBySubject(logs, subjects, new Set(['b'])).some(group => group.id === 'practice'), true);
  assert.equal(mergeNoteTexts(groups[0].logs), '등비수열;비가 일정\n\n등차수열:차가 일정');

  const html = renderToStaticMarkup(React.createElement(NoteTab, { logs, subjects, onUpdateReviewMemo() {} }));
  assert.ok(html.includes('aria-label="과목 선택"') && html.includes('Main · 2개') && html.includes('옛 과목 · 1개'));
  assert.ok(!html.includes('Practice'), 'a subject with only blank notes is not listed');
  assert.ok(html.includes('등비수열') && html.includes('등차수열') && html.indexOf('등차수열') < html.indexOf('등비수열'), 'two short units share one page, the older unit above the newer one');
  assert.ok(html.includes('data-note-unit-number="1"') && html.includes('data-note-unit-number="2"') && html.includes('1번째 단위') && html.includes('2번째 단위') && html.includes('p.21~30') && html.includes('p.31~40') && !html.includes('작성') && !html.includes('data-testid="unit-bar"'), 'each unit has a bigger "N번째 단위" heading with its page range; no per-session headings, no unit stepper');
  assert.equal((html.match(/aria-label="기호 입력"/g) || []).length, 1, 'one symbol bar for all stacked notes');
  assert.ok(html.includes('data-testid="note-pager"') && html.includes('1 / 1 쪽') && html.includes('다음 쪽'));
  assert.ok(html.includes('쓰는 법 보기') && html.includes('aria-pressed="true"'));
  assert.ok(!html.includes('aria-label="관계도"'), 'the diagram is only drawn after switching the view');
  const empty = renderToStaticMarkup(React.createElement(NoteTab, { logs: [], subjects, onUpdateReviewMemo() {} }));
  assert.ok(empty.includes('아직 정리노트가 없어요') && !empty.includes('aria-label="기호 입력"'));

  const map = renderToStaticMarkup(React.createElement(NoteDiagram, {
    memo: '등차수열:차가 일정\n:::toggle A;,\nB\nC\n:::end\n:::toggle 묶음\n가\n:::end\n:::toggle X:Y\nP:Q\n:::end', criterion: '개념:정의' }));
  assert.equal((map.match(/data-diagram-row="relation"/g) || []).length, 2, 'one plain relation plus the nested relation; the inclusion title is a heading, not a relation row');
  assert.ok(map.includes('data-diagram-row="containment-header"') && (map.match(/data-diagram-heading="집합"/g) || []).length === 2 && !map.includes('들어감') && !map.includes('집합</span>'), 'the A:C toggle title is a pair of set headings; the B:D rows below go into them as components');
  assert.ok(!map.includes('>구성요소<'), 'the title fields are the sets, not the components');
  assert.ok(map.includes('data-diagram-criterion="session"') && map.includes('세션 노트') && map.includes('분류 기준') && map.includes('data-criterion-fields="session"') && map.includes('개념') && map.includes('정의') && !map.includes('[개념:정의]'), 'the criterion is shown first as a session-note card, as field names without brackets');
  const sessionCard = map.slice(map.indexOf('data-diagram-criterion="session"'), map.indexOf('</aside>'));
  assert.ok(sessionCard.includes('text-lg font-black text-slate-900') && sessionCard.includes('text-2xl font-black text-indigo-950') && sessionCard.includes('bg-indigo-200'), 'as big as the criterion above the note paper');
  assert.ok(map.includes('data-diagram-viewpoint="개념"') && map.includes('data-diagram-viewpoint="정의"') && !map.includes('개념 집합') && !map.includes('정의 집합'), 'each set heading names its classification viewpoint');
  assert.ok(!map.includes('data-diagram-row="header"'), 'no header row above the cells that positions them by the criterion');
  assert.ok(map.includes('data-diagram-row="fan"') && map.includes('data-operator="and"'));
  assert.ok(map.includes('상하관계') && map.includes('포함관계'));
  assert.ok(map.includes('aria-label="양방향"') && map.includes('aria-label="앞으로만 (→)"'), '`;` is drawn as a forward-only arrow');
  const backMap = renderToStaticMarkup(React.createElement(NoteDiagram, { memo: '등비수열<비가 일정\n:::toggle A<\nB\nC\n:::end' }));
  assert.ok(backMap.includes('aria-label="거꾸로만 (←)"') && !backMap.includes('aria-label="앞으로만 (→)"'), '`<` is drawn as a backward-only arrow');
  assert.ok(map.includes('개념') && map.includes('정의'));
  assert.ok(map.indexOf('data-diagram-criterion="session"') < map.indexOf('data-diagram-row="relation"'), 'the criterion card comes before the organized content');
  assert.ok(renderToStaticMarkup(React.createElement(NoteDiagram, { memo: '' })).includes('그릴 내용이 아직 없어요'));
  assert.ok(!renderToStaticMarkup(React.createElement(NoteDiagram, { memo: 'a:b' })).includes('data-diagram-criterion="session"'), 'no criterion, no card');
});

test('only the outermost editor gets a symbol bar, and the measuring screen offers the how-to button', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewMemoEditor } = loadSource('components/ReviewMemoEditor.tsx');
  const render = props => renderToStaticMarkup(React.createElement(ReviewMemoEditor, { value: 'a:b', onChange() {}, ...props }));
  assert.ok(render({ symbolBar: true }).includes('aria-label="기호 입력"'));
  assert.ok(!render({}).includes('aria-label="기호 입력"'));
  assert.ok(!render({ symbolBar: true, nested: true }).includes('aria-label="기호 입력"'));
  const sessionSource = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(/grid\s+symbolBar\s*\/>/.test(sessionSource) && sessionSource.includes('setShowNoteTutorial(true)'));
});

test('arrows move one row at a time through the importance order and stop at both ends', () => {
  const { stepRowKey } = loadSource('components/TodayTasks.tsx');
  const order = ['review', 'must', 'short', 'done-1', 'done-2'];
  assert.equal(stepRowKey(order, 'review', 1), 'must');
  assert.equal(stepRowKey(order, 'must', 1), 'short');
  assert.equal(stepRowKey(order, 'short', -1), 'must');
  assert.equal(stepRowKey(order, 'review', -1), undefined, 'cannot go above the most important row');
  assert.equal(stepRowKey(order, 'done-2', 1), undefined, 'cannot go past the last row');
  assert.equal(stepRowKey(order, 'short', 1), 'done-1', 'finished subjects come after every pending task');
  // 상세 칸이 아직 목록 밖(처음 상태)을 가리키면 오른쪽은 맨 위 줄, 왼쪽은 아무 데도 가지 않는다.
  assert.equal(stepRowKey(order, '', 1), 'review');
  assert.equal(stepRowKey(order, '', -1), undefined);
  assert.equal(stepRowKey([], '', 1), undefined);
});

test('the idle summary puts the start button inside the start cell, shows review steps, a notes button, and no completed list', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const idle = (overrides = {}) => ({
    queueCount: 2, queueMinutes: 40, selectedDetailKey: 'first', rowOrder: ['first', 'second', 'gone'], doneOnlyKeys: ['gone'],
    selectedKind: 'review', selectedName: 'First', startPage: null, recommendedPages: null,
    startButton: React.createElement('button', { type: 'button' }, '복습 시작'), ...overrides
  });
  const props = { logs: [], subjects: reviewChainSubjects, completedStudySubjectIds: [], detailSubjectId: 'first', taskSelector: '목록',
    activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {},
    onUpdateReviewMemo() {}, idle: idle() };
  const html = renderToStaticMarkup(React.createElement(TodaySummary, props));
  // 화살표는 제목 줄(오늘 할 일 요약)로 올라갔으므로 상세에는 없고, 시작 버튼은 "공부 시작" 칸 맨 아래에 있다.
  assert.ok(!html.includes('data-testid="task-stepper"') && !html.includes('aria-label="덜 중요한 할 일로"'));
  const cellAt = html.indexOf('data-testid="start-in-cell"');
  assert.ok(html.indexOf('aria-label="공부 시작"') < cellAt && cellAt < html.indexOf('복습 시작') && html.indexOf('복습 시작') < html.indexOf('aria-label="성장"'));
  assert.ok(html.indexOf('뽀모도로') < cellAt && html.indexOf('풀이 절차') < cellAt, 'the button is the last thing in the start cell');
  assert.ok(!html.includes('data-testid="start-row"'), 'the start-row fallback is only for views without a start cell');
  // 복습과목도 풀이 절차를 보여준다: 정리노트 문제로 기억을 확인(복습 관문) → 복습 풀이(타임어택) → 막힌 부분 정리 → 기록 저장
  assert.ok(html.includes('풀이 절차') && !html.includes('타임어택 풀이'));
  const steps = ['노트 확인', '복습 풀이', '막힌 부분 정리', '기록 저장'].map(label => html.indexOf(label));
  assert.ok(steps.every(index => index > 0) && steps.every((index, i) => i === 0 || index > steps[i - 1]), 'four review steps in order');
  assert.ok(steps[0] > html.indexOf('aria-label="공부 시작"') && steps[3] < html.indexOf('aria-label="성장"'), 'the steps are inside the start cell');
  assert.ok(html.includes('data-testid="steps-grid"'), 'four steps sit in a 2x2 grid');
  assert.ok(html.includes('aria-label="정리노트 열기"') && html.includes('정리노트'));
  // 정리노트 버튼은 과목(상세 칸) 안에 있고, 학습 과목에는 "학습량 추가", 복습에는 없다.
  assert.ok(html.indexOf('aria-label="정리노트 열기"') > html.indexOf('id="subject-live-detail"'));
  assert.ok(!html.includes('직접 추가') && !html.includes('aria-label="학습량 추가"'), 'review rows add no study amount');
  assert.ok(!html.includes('data-testid="note-sheet"'), 'the notes sheet is closed until the button is pressed');
  assert.ok(!html.includes('완료된 기록'));
  // 끝낸 과목을 보고 있으면 공부 시작 칸이 없어서 시작 버튼이 상세 칸 맨 아래 한 줄로 온다.
  const viewingDone = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, detailSubjectId: 'gone',
    idle: idle({ selectedDetailKey: 'first' }) }));
  assert.ok(viewingDone.includes('data-testid="start-row"') && !viewingDone.includes('data-testid="start-in-cell"'));
  // 할 일을 모두 끝내면 시작 버튼 자리에 안내가 나오고 › 화살표로 끝낸 과목을 볼 수 있다.
  const allDone = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, detailSubjectId: '',
    idle: idle({ queueCount: 0, queueMinutes: 0, selectedDetailKey: '', selectedKind: null, selectedName: '', rowOrder: ['gone'], doneOnlyKeys: ['gone'], startButton: null }) }));
  assert.ok(allDone.includes('오늘 할 일 옆 › 화살표로 오늘 끝낸 과목을 볼 수 있어요.') && allDone.includes('data-testid="start-row"'));
  // 정리노트 버튼은 저장 기능을 받았을 때만 생긴다.
  const noNotes = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, onUpdateReviewMemo: undefined }));
  assert.ok(!noNotes.includes('정리노트 열기'));
});

test('the notes tab is replaced by a notes sheet opened from the study screen', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const appSource = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  assert.ok(!appSource.includes("'notes'") && !appSource.includes('NoteTab') && !appSource.includes('정리노트'), 'no notes tab, nav button, title or import is left');
  assert.ok(appSource.includes('onUpdateReviewMemo={handleUpdateReviewMemo}'), 'saving edits goes through the same handler as before');
  const summarySource = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(summarySource.includes('<NoteSheet') && summarySource.includes('detailData.owner?.id ?? detailData.subject.id') && summarySource.includes('subjectId={noteSubjectId}'),
    'the sheet opens on the subject of the row being looked at (the parent subject for review rows)');
  // 분류 기준은 노트 종이 바로 위(기호 막대 밑)에 크고 진하게
  const tabSource = fs.readFileSync(path.resolve(__dirname, '../components/NoteTab.tsx'), 'utf8');
  const barAt = tabSource.indexOf('<NoteSymbolBar onInsert'), criterionAt = tabSource.indexOf('data-note-criterion="true"'), paperAt = tabSource.indexOf('<NotePaper rows={Math.min(NOTE_PAGE_ROWS, rows)}>');
  assert.ok(barAt > 0 && barAt < criterionAt && criterionAt < paperAt, 'the criterion sits between the symbol bar and the note paper');
  const criterionBlock = tabSource.slice(criterionAt, tabSource.indexOf('</p>', criterionAt));
  assert.ok(criterionBlock.includes('text-lg font-black text-slate-900') && criterionBlock.includes('<CriterionFields criterion={criterion} tone="session" />') && criterionBlock.includes('세션 노트') && !criterionBlock.includes('[{criterion}]'), 'the note line shows the session criterion as field pills without brackets');
  assert.ok(tabSource.includes("session: 'rounded-lg bg-indigo-200 px-3 py-0.5 text-2xl font-black text-indigo-950'"), 'the pills are as big and dark as before');
  // 글을 한 자 쓸 때마다 부모가 다시 그려져도 포커스가 닫기 버튼으로 옮겨 가지 않는다: 효과는 열릴 때 한 번만 돌고 onClose는 ref로 읽는다
  const sheetSource = fs.readFileSync(path.resolve(__dirname, '../components/NoteSheet.tsx'), 'utf8');
  const sheetEffect = sheetSource.slice(sheetSource.indexOf('useEffect(() => {'), sheetSource.indexOf('return (\n    <div role="dialog"'));
  assert.ok(sheetEffect.includes('closeButton.current?.focus()') && sheetEffect.includes('}, []);') && !sheetEffect.includes('[onClose]'), 'the sheet takes focus once, when it opens');
  assert.ok(sheetSource.includes('onCloseRef.current = onClose') && sheetEffect.includes('onCloseRef.current()'), 'Escape still calls the latest onClose');
  const { NoteSheet } = loadSource('components/NoteSheet.tsx');
  const memo = '개념:정의\n작용;반작용';
  const logs = [{ id: 'n1', subjectId: 'a', pagesRead: 5, timeSpentMinutes: 10, timestamp: '2026-10-10T04:00:00Z', reviewMemo: memo },
    { id: 'n2', subjectId: 'b', pagesRead: 5, timeSpentMinutes: 10, timestamp: '2026-10-11T04:00:00Z', reviewMemo: '다른 과목:다른 내용' }];
  const subjectsForNotes = [{ id: 'a', name: '과목A' }, { id: 'b', name: '과목B' }];
  const html = renderToStaticMarkup(React.createElement(NoteSheet, { logs, subjects: subjectsForNotes, subjectId: 'a', subjectName: '과목A', onUpdateReviewMemo() {}, onClose() {} }));
  assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"') && html.includes('data-testid="note-sheet"'));
  assert.ok(html.includes('닫기') && html.includes('aria-label="노트 편집기"') && html.includes('과목A 정리노트'));
  // 오른쪽에서 밀려 나오는 서랍이고(translate-x), 그 과목의 노트만 보인다. 다른 과목 목록·선택칸이 없다.
  assert.ok(html.includes('justify-end') && html.includes('translate-x-full'));
  assert.ok(!html.includes('<select') && !html.includes('다른 과목'), 'only this subject notes, no subject switcher');
  assert.ok(html.includes('개념'), 'the subject own note text is shown');
  const empty = renderToStaticMarkup(React.createElement(NoteSheet, { logs, subjects: [...subjectsForNotes, { id: 'c', name: '새과목' }], subjectId: 'c', subjectName: '새과목', onUpdateReviewMemo() {}, onClose() {} }));
  assert.ok(empty.includes('새과목에는 아직 정리노트가 없어요') && !empty.includes('다른 과목'), 'a subject without notes stays empty instead of showing another subject');
});

test('review growth cell draws a speed graph (pages per hour) under the growth rates', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewSpeedGrowthCell, buildSpeedGraphData, getSpeedGraphScale, SpeedGraph } = loadSource('components/PageGrowth.tsx');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const math = loadSource('utils/math.ts');
  const logs = recordReviewMeasurement([chainLog('old')], ['old'], 'first', 10, true,
    '2026-10-11T03:00:00Z', measurement('old-review', 5, 3));
  // 5장을 장당 2분(총 10분)에 풀었으니 1시간에 30장, 기준 장당 3분이면 1시간에 20장
  const series = math.getReviewSpeedSeries(logs, 'parent', 'first');
  assert.equal(series.length, 1);
  assert.ok(Math.abs(series[0].pagesPerReference - 30) < 1e-9 && Math.abs(series[0].baselinePagesPerReference - 20) < 1e-9);
  assert.deepEqual(math.getReviewSpeedSeries(logs, 'parent', 'nobody'), []);
  const html = renderToStaticMarkup(React.createElement(ReviewSpeedGrowthCell, { changes: { average: { speedPages: 10, studyMinutes: -1 }, latest: { speedPages: 10, studyMinutes: -1 } }, series }));
  const rates = html.indexOf('이번 복습 증가율');
  assert.ok(rates > 0 && html.indexOf('data-testid="speed-graph"') > rates, 'the graph sits below the growth rates');
  assert.ok(html.includes('1시간에 푸는 페이지') && html.includes('>30<') && !html.includes('25분에'));
  // 그래프 점: 최근 8회까지, 회차 이름과 값
  const many = Array.from({ length: 10 }, (_, i) => ({ pagesPerReference: i + 1, baselinePagesPerReference: i === 0 ? null : 5 }));
  const data = buildSpeedGraphData(many);
  assert.equal(data.length, 8);
  assert.deepEqual([data[0].label, data[7].label, data[0].speed, data[7].speed], ['3회', '10회', 3, 10]);
  assert.equal(buildSpeedGraphData([{ pagesPerReference: 6.256, baselinePagesPerReference: null }])[0].speed, 6.26);
  // 설명 문구는 없다: 칸 밑에는 증가율 이름과 그래프만 남는다
  ['이전 복습', '상위과목', '점선', '위로 갈수록', '속도는 1시간에 푼 장수', '한 페이지에 쓴 시간'].forEach(text => assert.ok(!html.includes(text), `no note: ${text}`));
  assert.ok(html.includes('평균 증가율') && html.includes('이번 복습 증가율'));
  // 세로축: 첫 값이 한가운데, 위아래 같은 폭(가장 먼 값의 1.25배를 0.5 단위로 올림, 최소 0.5), 아래는 0 밑으로 내려가지 않는다
  assert.deepEqual(getSpeedGraphScale([24, 28, 20]), { center: 24, lower: 19, upper: 29, ticks: [19, 24, 29] });
  assert.deepEqual(getSpeedGraphScale([30]), { center: 30, lower: 29.5, upper: 30.5, ticks: [29.5, 30, 30.5] });
  assert.deepEqual(getSpeedGraphScale([2, 10]), { center: 2, lower: 0, upper: 12, ticks: [0, 2, 12] });
  assert.equal(getSpeedGraphScale([]).center, 0);
  const scale = getSpeedGraphScale([24.5, 28.6, 20, 14.3]);
  assert.equal(scale.center, 24.5);
  assert.ok(Math.abs((scale.upper - scale.center) - (scale.center - scale.lower)) < 1e-9, 'the first value is exactly in the middle');
  assert.ok(scale.lower <= 14.3 && scale.upper >= 28.6, 'every point fits');
  const graphSource = fs.readFileSync(path.resolve(__dirname, '../components/PageGrowth.tsx'), 'utf8');
  assert.ok(graphSource.includes('domain={[scale.lower, scale.upper]}') && !graphSource.includes("domain={[0, 'auto']}"), 'the axis no longer starts at 0 pages');
  assert.ok(renderToStaticMarkup(React.createElement(SpeedGraph, { series: [] })).includes('측정 기록 없음'));
  // 요약 화면은 복습과목의 증가율 칸에 이 그래프용 데이터를 넘긴다
  const summarySource = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(summarySource.includes('series={detailData.reviewSpeedSeries ?? undefined}') && summarySource.includes('getReviewSpeedSeries(logs, owner.id, subject.id)'));
});

test('study report numbers: windows, streak, daily bars, time split and review summary', () => {
  const report = loadSource('utils/studyReport.ts');
  const today = new Date(2026, 9, 16, 12, 0, 0);
  const key = offset => {
    const date = new Date(2026, 9, 16 - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const at = offset => new Date(2026, 9, 16 - offset, 9).toISOString();
  const log = (id, offset, pages, solve, organize, extra = {}) => ({
    id, subjectId: 's1', pagesRead: pages, timeSpentMinutes: solve + organize, timeAttackMinutes: solve,
    organizationMinutes: organize, timestamp: at(offset), studyDate: key(offset), ...extra
  });
  const logs = [log('a', 0, 10, 30, 10), log('b', 1, 10, 40, 10), log('c', 2, 5, 15, 5), log('d', 8, 10, 60, 20), log('e', 9, 10, 60, 20)];

  const week = report.summarizeWindow(logs, 7, 0, today);
  assert.deepEqual([week.minutes, week.pages, week.sessions], [110, 25, 3]);
  assert.ok(Math.abs(week.efficiency - 110 / 25) < 1e-9);
  const before = report.summarizeWindow(logs, 7, 7, today);
  assert.deepEqual([before.minutes, before.pages], [160, 20]);
  const change = report.compareValues(week.minutes, before.minutes);
  assert.equal(change.delta, -50);
  assert.equal(report.compareValues(5, 0), null);
  // 4.0 → 3.2 분/P 는 속도 +25%
  assert.ok(Math.abs(report.speedChangePercent(3.2, 4.0) - 25) < 1e-9);
  assert.equal(report.speedChangePercent(0, 4), null);

  const streak = report.calculateStudyStreak(logs, today);
  assert.deepEqual(streak, { current: 3, best: 3, studiedToday: true });
  const quietToday = report.calculateStudyStreak(logs.filter(item => item.id !== 'a'), today);
  assert.deepEqual([quietToday.current, quietToday.studiedToday], [2, false], 'a day not over yet does not break the streak');
  assert.equal(report.calculateStudyStreak([], today).current, 0);

  const daily = report.buildDailyStudy(logs, 14, today);
  assert.equal(daily.length, 14);
  assert.equal(daily[13].minutes, 40);
  assert.ok(daily[13].isToday && !daily[12].isToday);
  assert.equal(daily[12].minutes, 50);
  assert.equal(daily[11].minutes, 20);
  assert.equal(daily[10].minutes, 0);
  assert.equal(daily[13].label, '10/16');

  const split = report.summarizeTimeSplit(logs, 30, today);
  assert.equal(split.solveMinutes + split.organizeMinutes, 40 + 50 + 20 + 80 + 80);
  assert.equal(split.organizeMinutes, 10 + 10 + 5 + 20 + 20);
  assert.ok(Math.abs(split.solveShare - (205 / 270) * 100) < 1e-9);
  assert.equal(report.summarizeTimeSplit([], 30, today).solveShare, null);
  const plain = report.summarizeTimeSplit([{ ...log('p', 0, 5, 0, 0), timeSpentMinutes: 20, timeAttackMinutes: undefined, organizationMinutes: undefined }], 30, today);
  assert.deepEqual([plain.solveMinutes, plain.organizeMinutes], [20, 0], 'records without a split count as solving time');

  const eightDays = 8 * 86400000;
  const reviewLogs = [{ ...log('r', 1, 5, 10, 5),
    reviewQuestionSchedules: {
      q1: { reviewStep: 3, nextReviewDate: at(0), intervalMs: eightDays, attempts: 4, wrongCount: 1 },
      q2: { reviewStep: 1, nextReviewDate: at(0), intervalMs: 86400000, attempts: 4, wrongCount: 3, masked: false },
      q3: { reviewStep: 5, nextReviewDate: at(0), intervalMs: 2 * 86400000, attempts: 2, wrongCount: 0, masked: true }
    },
    basicReviewTimeRecords: [{ minutes: 12, pages: 5, timestamp: at(1) }, { minutes: 99, pages: 5, timestamp: at(60) }],
    reviewSubjectTimeRecords: [{ subjectId: 'x', minutes: 8, pages: 5, timestamp: at(0) }] }];
  const review = report.summarizeReview(reviewLogs, 30, today);
  assert.deepEqual([review.questions, review.attempts, review.wrong, review.mastered, review.reviewMinutes], [3, 10, 4, 2, 20]);
  assert.ok(Math.abs(review.accuracy - 60) < 1e-9);
  assert.equal(report.summarizeReview([], 30, today).accuracy, null);
  assert.equal(report.formatMinutesShort(125), '2h 5m');
  assert.equal(report.formatMinutesShort(0), '0m');
});

test('plan check: pace of the last 4 weeks against the target date gives late, on track, ahead, idle, no date and done', () => {
  const report = loadSource('utils/studyReport.ts');
  const today = new Date(2026, 9, 16, 12, 0, 0);
  const key = offset => {
    const date = new Date(2026, 9, 16 - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const log = (offset, pages, minutes) => ({ id: `p${offset}`, subjectId: 's1', pagesRead: pages, timeSpentMinutes: minutes, timestamp: new Date(2026, 9, 16 - offset, 9).toISOString(), studyDate: key(offset) });
  // 40 days of records, 8 pages per week for the last 4 weeks (32 pages), so 8 P per week
  const logs = [0, 7, 14, 21].map(offset => log(offset, 8, 80)).concat([log(40, 6, 90)]);
  const make = (remaining, diffDays, list = logs) => report.buildPlanCheck({ logs: list, remainingPages: remaining, diffDays, now: today });
  const pace = make(80, 70);
  assert.ok(Math.abs(pace.weeklyPages - 8) < 1e-9, `weekly pages ${pace.weeklyPages}`);
  // 80 pages at 8 per week = 70 days: exactly on the date
  assert.equal(pace.status, 'ontrack');
  assert.equal(pace.gapDays, 0);
  // 160 pages need 140 days; the date is 70 days away: 70 days late and 8 more pages needed each week
  const late = make(160, 70);
  assert.equal(late.status, 'late');
  assert.equal(late.gapDays, 70);
  assert.ok(Math.abs(late.requiredWeeklyPages - 16) < 1e-9 && Math.abs(late.extraWeeklyPages - 8) < 1e-9);
  // 40 pages need 35 days, the date is 70 days away
  const ahead = make(40, 70);
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.gapDays, -35);
  assert.equal(ahead.extraWeeklyPages, null);
  // a date that is already past is late with no weekly requirement
  const overdue = make(40, -3);
  assert.equal(overdue.status, 'late');
  assert.equal(overdue.requiredWeeklyPages, null);
  assert.ok(overdue.gapDays > 0);
  assert.equal(make(0, 70).status, 'done');
  assert.equal(make(40, null).status, 'nodate');
  // no record in the last 4 weeks: idle, and the weekly need is shown
  const idle = make(40, 70, [log(40, 6, 90)]);
  assert.equal(idle.status, 'idle');
  assert.ok(Math.abs(idle.requiredWeeklyPages - 4) < 1e-9);
  // efficiency: the first four weeks against the last four (overlapping windows give no comparison)
  assert.ok(Math.abs(pace.recentEfficiency - 10) < 1e-9);
  assert.equal(pace.firstEfficiency, null, 'a window that starts 40 days ago overlaps only if the first four weeks reach the recent four');
  const longer = [log(100, 10, 200), log(90, 10, 180), log(0, 10, 100), log(3, 10, 100)];
  const compared = make(10, 30, longer);
  assert.ok(Math.abs(compared.firstEfficiency - 19) < 1e-9 && Math.abs(compared.recentEfficiency - 10) < 1e-9);
  // the records themselves are never changed
  const frozen = JSON.stringify(logs);
  make(80, 70);
  assert.equal(JSON.stringify(logs), frozen);
});

test('subject cumulative time: top subjects by accumulated time, an other group, and weekly minutes per subject', () => {
  const report = loadSource('utils/studyReport.ts');
  const today = new Date(2026, 9, 16, 12, 0, 0);
  const key = offset => {
    const date = new Date(2026, 9, 16 - offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const log = (id, subject, offset, minutes) => ({ id, subjectId: subject, pagesRead: 5, timeSpentMinutes: minutes, timestamp: new Date(2026, 9, 16 - offset, 9).toISOString(), studyDate: key(offset) });
  const names = { a: '수학', b: '영어', c: '국어', d: '과학', e: '사회', f: '한국사', g: '윤리' };
  const logs = [log('1', 'a', 30, 120), log('2', 'a', 3, 60), log('3', 'b', 20, 90), log('4', 'c', 2, 45), log('5', 'd', 40, 30), log('6', 'e', 5, 25), log('7', 'f', 1, 20), log('8', 'g', 0, 10)];
  const result = report.buildSubjectCumulative(logs, id => names[id], today, 26, 3);
  assert.deepEqual(result.series.map(item => item.name), ['수학', '영어', '국어', '기타 4개']);
  assert.deepEqual(result.series.map(item => item.totalMinutes), [180, 90, 45, 85]);
  assert.equal(result.series.reduce((sum, item) => sum + item.percent, 0), 100);
  assert.equal(result.totalMinutes, 400);
  // recent four weeks and the four weeks before
  assert.deepEqual([result.series[0].recentMinutes, result.series[0].previousMinutes], [60, 120]);
  const last = result.points[result.points.length - 1];
  assert.ok(Math.abs(last.s0 - 3) < 0.01 && Math.abs(last.s1 - 1.5) < 0.01 && Math.abs(last.s3 - 85 / 60) < 0.01, 'the last point is the total so far');
  // cumulative values never go down
  result.points.forEach((point, index) => { if (index > 0) result.series.forEach(item => assert.ok(point[item.key] >= result.points[index - 1][item.key])); });
  assert.deepEqual(report.buildSubjectCumulative([], () => '', today), { series: [], points: [], totalMinutes: 0 });
  const weekly = report.buildSubjectWeeklyMinutes(logs, 12, today);
  assert.equal(weekly.get('a').length, 12);
  assert.equal(weekly.get('a').reduce((sum, value) => sum + value, 0), 180);
  assert.equal(weekly.get('a')[11], 60, 'the current week is the last bar');
});

test('the history report is one flow: plan check, accumulated time by subject, rhythm, speed and review, raw totals', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { HistoryCharts } = loadSource('components/HistoryCharts.tsx');
  const day = offset => new Date(Date.now() - offset * 86400000);
  const dateKey = offset => {
    const date = day(offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const subjects = [
    { id: 's1', name: '수학 기출', startPage: 1, totalPages: 100, completedPages: 60, targetDate: dateKey(-10), createdAt: day(60).toISOString(), growthPageUnit: 10 },
    { id: 's2', name: '영어 독해', startPage: 1, totalPages: 50, completedPages: 10, targetDate: dateKey(-20), createdAt: day(60).toISOString(), growthPageUnit: 10 },
    { id: 's3', name: '국어 문법', startPage: 1, totalPages: 30, completedPages: 30, targetDate: dateKey(-20), createdAt: day(60).toISOString() }
  ];
  const logs = [20, 17, 14, 12, 10, 9, 7, 5, 3, 1, 0].map((offset, index) => ({
    id: `h${index}`, subjectId: index % 3 === 2 ? 's2' : 's1', pagesRead: 10, startPage: index * 10 + 1, endPage: index * 10 + 10,
    timeSpentMinutes: 55 - index, timeAttackMinutes: 40 - index, organizationMinutes: 15, timestamp: day(offset).toISOString(), studyDate: dateKey(offset),
    folderSnapshots: [{ id: 'f1', name: '시험' }],
    basicReviewTimeRecords: index === 0 ? [{ minutes: 12, pages: 10, timestamp: day(2).toISOString(), reviewNumber: 1 }, { minutes: 9, pages: 10, timestamp: day(0).toISOString(), reviewNumber: 2 }] : undefined,
    reviewQuestionSchedules: index === 0 ? { q: { reviewStep: 2, nextReviewDate: day(0).toISOString(), intervalMs: 9 * 86400000, attempts: 3, wrongCount: 1 } } : undefined
  }));
  const html = renderToStaticMarkup(React.createElement(HistoryCharts, { subjects, logs }));
  // five sections in a fixed order
  const order = ['계획 점검', '쌓인 시간', '학습 리듬', '속도와 복습', '원자료'].map(text => html.indexOf(`<h2 class="text-xl font-black text-slate-900">${text}</h2>`));
  assert.ok(order.every(index => index > 0) && order.every((index, position) => position === 0 || index > order[position - 1]), `sections in order ${order}`);
  ['plan-card', 'cumulative-card', 'calendar-card', 'weekly-card', 'weekday-card', 'review-card', 'speed-card', 'speed-25', 'speed-unit', 'review-rounds'].forEach(id =>
    assert.ok(html.includes(`data-testid="${id}"`), id));
  ['과목별 계획 점검', '과목별 쌓인 시간', '학습 달력', '주별 학습 시간', '요일별 학습 시간', '복습 현황', '복습 회차별 속도', '공부 1시간마다의 속도', '단위별 속도 상승', '학습 현황', '정답률', '외운 문제'].forEach(text =>
    assert.ok(html.includes(text), text));
  // short-term numbers belong to the study settings screen, not here
  ['최근 7일 학습 시간', '최근 7일 학습 페이지', '최근 14일 학습 시간', '과목별 진행', '풀이와 정리 시간'].forEach(text => assert.ok(!html.includes(text), `${text} moved out`));
  // the plan check has one row per subject, the rows needing change first (not done ones), and a status for each
  const rows = html.match(/data-testid="progress-row" data-plan-status="[a-z]+"/g) || [];
  assert.equal(rows.length, 3);
  assert.ok(rows[rows.length - 1].includes('"done"'), 'a finished subject goes last');
  assert.ok(html.includes('data-testid="plan-status"') && /\d+일 (?:늦음|빠름)|목표일에 맞음/.test(html));
  assert.ok(html.includes('aria-label="점검 결과 요약"'));
  // stacked area per subject and one list row per subject with its share and the last four weeks
  assert.equal((html.match(/data-testid="share-row"/g) || []).length, 2);
  assert.ok(html.includes('최근 4주'));
  assert.ok((html.match(/data-testid="calendar-cell"/g) || []).length >= 13 * 7 - 6);
  // the raw table keeps one switch for the period
  assert.ok(html.includes('aria-label="집계 기간"') && html.includes('최근 30일') && html.includes('전체 누적'));
  assert.ok(!html.includes('font-mono') && !/KPI/i.test(html));
  assert.ok(!/text-\[(?:8|9|10)px\]/.test(html), 'no tiny text on the report');
  // no data: empty notes only
  const empty = renderToStaticMarkup(React.createElement(HistoryCharts, { subjects: [], logs: [] }));
  ['과목을 등록하면 계획 점검이 나타납니다', '학습을 기록하면 쌓인 시간이 그려져요', '속도 추이가 나타납니다', '저장된 학습 기록이 없습니다'].forEach(text => assert.ok(empty.includes(text), text));
});

test('today list: many subjects shrink the cells into a fixed block instead of growing downward', () => {
  const { queueDensity } = loadSource('components/TodayTasks.tsx');
  // unknown width (first paint) and few subjects keep the two-line cells in one row
  assert.deepEqual(queueDensity(5, 0), { level: 0, columns: 5, rows: 1, height: 64 });
  assert.equal(queueDensity(4, 1000).level, 0);
  // 1000px fits 4 cells of 200px (4*200 + 3*6 = 818, 5*200 + 4*6 = 1024 > 1000)
  assert.equal(queueDensity(5, 1000).level, 1);
  // one-line cells in two rows: about the same height as one two-line cell
  const two = queueDensity(10, 1000);
  assert.deepEqual([two.level, two.rows, two.height <= 70], [1, 2, true]);
  const three = queueDensity(16, 1000);
  assert.ok(three.level === 2 && three.rows <= 3 && three.height <= 80, `sixteen ${JSON.stringify(three)}`);
  // far more subjects still stay in three rows by getting narrower
  const many = queueDensity(30, 1000);
  assert.ok(many.rows <= 3 && many.height <= 80, `many ${JSON.stringify(many)}`);
  // every subject always has a cell
  for (const count of [1, 6, 9, 12, 20, 27, 40, 60]) {
    const result = queueDensity(count, 900);
    assert.ok(result.columns * result.rows >= count, `${count} cells fit in ${result.columns}x${result.rows}`);
  }
  // narrower screens never give a cell less than the level's minimum width
  const narrow = queueDensity(6, 500);
  assert.ok(narrow.level >= 1 && narrow.columns >= 1);
  const source = fs.readFileSync(path.resolve(__dirname, '../components/TodayTasks.tsx'), 'utf8');
  assert.ok(source.includes('ResizeObserver') && !/overflow-y-auto|max-h-/.test(source.slice(source.indexOf('export const TaskQueueCells'), source.indexOf('export const TaskQueueList'))), 'no inner scrolling');
});

test('the history report keeps follow-up subjects apart: one speed tab per stage and a segmented progress bar', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { HistoryCharts } = loadSource('components/HistoryCharts.tsx');
  const day = offset => new Date(Date.now() - offset * 86400000);
  const dateKey = offset => {
    const date = day(offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const subject = { id: 's1', name: '수학', startPage: 1, totalPages: 200, completedPages: 200, targetDate: dateKey(-10), createdAt: day(60).toISOString(), growthPageUnit: 10,
    followUpSubjects: [{ id: 'f1', name: '심화', startPage: 201, endPage: 260, completedPage: 230 }, { id: 'f2', name: '모의고사', startPage: 261, endPage: 300, completedPage: 260 }] };
  const make = (id, offset, start, stage) => ({
    id, subjectId: 's1', subjectStageId: stage, subjectStageNameSnapshot: stage === 'f1' ? '심화' : undefined, pagesRead: 10, startPage: start, endPage: start + 9,
    timeSpentMinutes: 50, timeAttackMinutes: 40, organizationMinutes: 10, timestamp: day(offset).toISOString(), studyDate: dateKey(offset)
  });
  const logs = [make('a1', 9, 1), make('a2', 8, 11), make('a3', 7, 21), make('b1', 3, 201, 'f1'), make('b2', 2, 211, 'f1'), make('b3', 1, 221, 'f1')];
  const html = renderToStaticMarkup(React.createElement(HistoryCharts, { subjects: [subject], logs }));
  assert.ok(html.includes('수학 · 심화'), 'the follow-up stage has its own speed tab');
  assert.ok(html.includes('role="tab"') && html.includes('aria-label="추이 과목"'));
  // 진행 칸: 앞 과목·심화·모의고사 세 칸으로 나뉘고 이름이 순서대로
  assert.ok(html.includes('data-testid="stage-bar"'));
  assert.ok(html.includes('수학 → 심화 → 모의고사'));
  assert.ok(html.includes('230 / 300 P'));
  // 후행과목이 없는 과목은 기존 한 줄 막대
  const plain = renderToStaticMarkup(React.createElement(HistoryCharts, { subjects: [{ ...subject, followUpSubjects: undefined, totalPages: 100, completedPages: 40 }], logs: logs.slice(0, 3) }));
  assert.ok(!plain.includes('data-testid="stage-bar"') && plain.includes('40 / 100 P'));
});

test('the study settings screen keeps its frame with larger text and a compact plan form', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { SubjectPlanner } = loadSource('components/SubjectPlanner.tsx');
  const form = renderToStaticMarkup(React.createElement(SubjectPlanner, { onAddSubject() {} }));
  ['과목 명칭', '시작 페이지', '끝 페이지', '목표 완료 날짜', '학습 요일', '중요도', '계획 등록'].forEach(text => assert.ok(form.includes(text), text));
  assert.ok(!form.includes('페이지 단위'), 'no fixed page unit any more: a unit is the span between two 복습에 넣기');
  // 입력칸은 가로로 나란히(넓은 화면 4칸 · 좁으면 2칸) 놓아 세로로 길어지지 않는다. 단원 범위 칸이 있고, 요일은 한 줄이다.
  assert.ok(form.includes('grid-cols-2') && form.includes('md:grid-cols-4') && form.includes('new-plan-chapters') && form.includes('단원 범위'));
  assert.ok(!form.includes('lg:grid-cols-3') && !form.includes('lg:grid-cols-1') && !form.includes('py-3.5'), 'no tall single-column layout');
  assert.ok(form.includes('grid-cols-7'), 'the weekdays are one row');
  assert.ok(!/text-\[(?:8|9|10)px\]/.test(form), 'no tiny text in the plan form');
  const analyticsSource = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(!/text-\[(?:8|9|10)px\]/.test(analyticsSource), 'settings labels are at least 12px');
  const panelsSource = fs.readFileSync(path.resolve(__dirname, '../components/SpeedPanels.tsx'), 'utf8');
  assert.ok(analyticsSource.includes('하루 평균') && panelsSource.includes('새 분석 그룹 추가') && panelsSource.includes('새 학습 계획 추가'), 'the frame is kept; adding happens in the strips between items');
  // 큰 숫자는 xl부터 키운다: 가로 태블릿(≈1194px)에서는 왼쪽 칸이 좁아 text-2xl로 둔다.
  assert.ok(analyticsSource.includes("'text-2xl xl:text-3xl'") && !analyticsSource.includes('lg:text-3xl') && !analyticsSource.includes('lg:text-4xl'));
  // 설정 화면: 분석(과목·폴더 관리) 한 화면. 요일별 조정 탭, 오른쪽 새 계획 패널, 상단 새 분석 그룹 버튼은 없다.
  const appSource = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  const settingsStart = appSource.indexOf("activeTab === 'settings' && (");
  const settingsBlock = appSource.slice(settingsStart, appSource.indexOf("activeTab === 'history'", settingsStart));
  assert.ok(settingsBlock.includes('<Analytics') && settingsBlock.includes('focusSubjectId={settingsFocusSubjectId}'));
  assert.ok(!settingsBlock.includes('<SubjectPlanner') && !settingsBlock.includes('<aside') && !settingsBlock.includes('StudySettings') && !settingsBlock.includes('lg:sticky'), 'no side panel, no week tab');
  assert.ok(!appSource.includes("'max-w-none'") && appSource.includes('max-w-6xl'), 'settings is capped like the other tabs again');
  assert.ok(!analyticsSource.includes('＋ 새 분석 그룹 추가'), 'the top button is gone; the strips between items do the job');
});

test('the basic review chart draws speed (pages per hour); its chips show speed only, to one decimal, with no study amount and no percent', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const source = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  const chart = source.slice(source.indexOf('const BasicReviewEfficiencyTrend'), source.indexOf('\n};\n', source.indexOf('const BasicReviewEfficiencyTrend')));
  assert.ok(chart.includes('pagesPerReferenceTime(point.efficiency)') && chart.includes('<SpeedGraph series={series}'), 'the line plots pages per fixed time');
  assert.ok(chart.includes('describeSpeed(point.change, label)') && !chart.includes('describeStudyAmount') && !chart.includes('describeGrowthChange'), 'speed only');
  assert.ok(!chart.includes('data-growth-kind="amount"') && !chart.includes('}%'));
  const growth = loadSource('utils/pageGrowth.ts');
  // 예: 1회 2.45분/P, 2회 2.1분/P, 3회 3분/P, 4회 4.2분/P → 1시간에 24.5 / 28.6 / 20.0 / 14.3장
  assert.deepEqual([2.45, 2.1, 3, 4.2].map(tpp => Number(growth.pagesPerReferenceTime(tpp).toFixed(1))), [24.5, 28.6, 20, 14.3]);
  // 1회 대비 속도(소수 첫째 자리): 2회 +4.1P/h, 3회 −4.5P/h, 4회 −10.2P/h
  assert.deepEqual([2.1, 3, 4.2].map(tpp => growth.toGrowthChange(2.45, tpp).speedPages), [4.1, -4.5, -10.2]);
  // 화면: 세 칩 모두 "속도 …P/h"만 나오고 공부량·퍼센트는 없다
  const logs = [[1, 2.45], [2, 2.1], [3, 3], [4, 4.2]].map(([number, tpp]) => ({ id: `basic-${number}`, subjectId: 'main', timestamp: `2026-10-0${number}T04:00:00Z`,
    pagesRead: 10, startPage: 1, endPage: 10, timeSpentMinutes: 20, reviewStep: number - 1,
    basicReviewTimeRecords: [{ reviewNumber: number, pages: 10, minutes: tpp * 10 }] }));
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { logs, subjects, detailSubjectId: 'basic-review:main',
    activeWeekday: 1, activeStudyDate: '2026-10-12', taskSelector: '오늘 할 일', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} }));
  assert.ok(html.includes('basic-review-trend'));
  assert.ok(html.includes('속도 +4.1P/h') && html.includes('속도 −4.5P/h') && html.includes('속도 −10.2P/h'));
  const trend = html.slice(html.indexOf('basic-review-trend'));
  assert.ok(!trend.includes('공부량') || trend.indexOf('공부량') < 0);
  assert.ok(!/[+−-]\d+(\.\d+)?%/.test(trend), 'no percent growth');
  assert.equal((trend.match(/data-growth-kind="speed"/g) || []).length, 3);
  assert.ok(!trend.includes('data-growth-kind="amount"'));
});

test('study amount is added for the subject being viewed, and finished data reaches only fully done subjects', () => {
  const summarySource = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  // 직접 추가(과목 고르기 목록)가 아니라, 지금 보는 과목에 더하는 "학습량 추가". 과목은 고정되어 보이기만 한다.
  assert.ok(!summarySource.includes('직접 추가'));
  assert.ok(summarySource.includes("openAddModal(detailData.subject)") && summarySource.includes('data-testid="add-subject"'));
  assert.ok(summarySource.includes("modalMode === 'edit' ? '합산 기록 수정' : '학습량 추가'"));
  assert.ok(summarySource.includes('!detailIsReview') && summarySource.includes('getSubjectRemainingPageCount(detailData.subject) > 0'),
    'review rows have no study amount, and a book with no pages left cannot take more');
  // 모달은 머리말·내용·버튼 줄로 나뉘어 있어 내용이 길어도 저장 버튼이 화면 밖으로 밀리지 않는다.
  assert.ok(summarySource.includes('flex max-h-[92vh] w-full max-w-sm flex-col') && summarySource.includes('min-h-0 flex-1 space-y-5 overflow-y-auto'));
  // 오늘 완료 데이터는 오늘 할 양을 모두 끝낸 과목(doneCards)에만 붙는다. 남은 과목(pendingCards)에는 없다.
  const loggerSource = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  const pending = loggerSource.slice(loggerSource.indexOf('const pendingCards'), loggerSource.indexOf('const doneCards'));
  const finished = loggerSource.slice(loggerSource.indexOf('const doneCards'), loggerSource.indexOf('const taskCards'));
  assert.ok(pending.length > 0 && !pending.includes('done:') && !pending.includes('toDoneData'));
  assert.ok(finished.includes("state: 'done'") && finished.includes('toDoneData(row)'));
});


test('a finished subject: one green growth cell holding the growth content plus what was done, the daily average and extra study', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary, DoneSummary } = loadSource('components/TodaySummary.tsx');
  const doneLogs = [{ id: 'done', subjectId: 'deadline', studyDate: '2026-10-12', timestamp: planningToday.toISOString(), pagesRead: 10, timeSpentMinutes: 35, startPage: 1, endPage: 10 }];
  const subjectsForDone = [shortPlanSubject({ completedPages: 10 })];
  const idle = (extra = {}) => ({
    queueCount: 1, queueMinutes: 20, selectedDetailKey: 'other', rowOrder: ['other', 'deadline'], doneOnlyKeys: ['deadline'],
    selectedKind: 'study', selectedName: 'Other', startPage: 5, recommendedPages: 3,
    startButton: React.createElement('button', { type: 'button' }, '학습 시작'), ...extra
  });
  const props = { logs: doneLogs, subjects: subjectsForDone, completedStudySubjectIds: ['deadline'], detailSubjectId: 'deadline', taskSelector: null,
    activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {},
    onUpdateReviewMemo() {}, idle: idle({ onExtraStudy() {} }) };
  const html = renderToStaticMarkup(React.createElement(TodaySummary, props));
  // 오늘 기록이라는 칸은 없고, 성장 칸 하나만 있다.
  assert.equal((html.match(/aria-label="성장"/g) || []).length, 1);
  assert.ok(html.includes('data-testid="done-layout"') && html.includes('data-testid="done-summary"'));
  assert.ok(!html.includes('aria-label="오늘 완료"') && !html.includes('오늘 기록') && !html.includes('>오늘 완료<'), 'no separate record cell, title row or done badge');
  // 공부 시작 칸(시작 페이지 · 뽀모도로 · 풀이 절차 · 시작 버튼)은 사라진다.
  ['공부 시작', '필요 횟수', '진행 순서', '풀이 절차', '오늘 권장'].forEach(text => assert.ok(!html.includes(text), `${text} is hidden for a finished subject`));
  assert.ok(!html.includes('data-testid="start-in-cell"') && !html.includes('>학습 시작<'));
  assert.ok(!/시작<\/span><span[^>]*>p\./.test(html), 'no start page block');
  // 성장 칸은 가로로 길고(왼쪽 1.7fr · 오른쪽 1fr), 바깥 큰 칸은 옅은 초록(테두리도 옅게), 안쪽 성장 칸은 더 진한 초록(green-200)이다.
  assert.ok(html.includes('lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]'));
  assert.ok(html.includes('data-done="true"') && html.includes('border-green-200 bg-green-50') && html.includes('border-green-500 bg-[#d0f9de]'));
  const growthAt = html.indexOf('aria-label="성장"');
  const doneAt = html.indexOf('data-testid="done-summary"');
  assert.ok(growthAt > 0 && growthAt < doneAt, 'the growth content comes first (left)');
  const growthPart = html.slice(growthAt, doneAt);
  ['학습 진척도', '전체 효율', '타임어택 효율', '이번 단위'].forEach(text => assert.ok(growthPart.includes(text), text));
  // 오른쪽에는 세 가지만: 한 일(학습량 · 걸린 시간 · 페이지당) → 최근 하루 평균 공부 시간 → 추가 학습하기(맨 아래)
  const right = html.slice(doneAt);
  ['학습량', '걸린 시간', '페이지당'].forEach(text => assert.ok(right.includes(text), text));
  assert.ok(right.includes('3.5') && right.includes('35') && right.includes('10'), 'pages, minutes and minutes per page of what was done');
  assert.ok(!right.includes('aria-label="합산 기록 수정"') && !right.includes('aria-label="합산 기록 삭제"') && !right.includes('data-testid="done-records"'), 'no record rows');
  assert.ok(!/속도 [+−]|공부량 [+−]/.test(right), 'no growth text line');
  // 오늘 처음 공부한 과목: 35분 ÷ 1일 = 하루 평균 35분(7일이 차지 않으면 처음 공부한 날부터의 날 수로 나눈다)
  assert.match(right, /data-testid="daily-average"[\s\S]*?최근 하루 평균 공부 시간[\s\S]*?>35<span[^>]*>분<\/span>/);
  assert.ok(!right.includes('최근 7일') && !right.includes('7일 평균'), 'the seven-day sum is not shown, only the daily average');
  assert.ok(right.indexOf('학습량') < right.indexOf('data-testid="daily-average"') && right.indexOf('data-testid="daily-average"') < right.indexOf('data-testid="extra-study"'));
  assert.ok(right.indexOf('추가 학습하기') > right.indexOf('data-testid="daily-average"'), 'extra study is the last thing');
  assert.ok(!html.includes('data-testid="start-disabled"'), 'the extra study button takes the place of the disabled start button');
  // 추가 학습을 시작할 방법이 없으면 같은 자리에 눌러지지 않는 "오늘 학습 완료"가 온다.
  const noExtra = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, idle: idle() }));
  assert.ok(!noExtra.includes('data-testid="extra-study"') && noExtra.includes('data-testid="done-summary"'));
  assert.match(noExtra, /data-testid="start-disabled"[^>]*disabled|disabled[^>]*data-testid="start-disabled"/);
  assert.ok(noExtra.indexOf('data-testid="start-disabled"') > noExtra.indexOf('data-testid="daily-average"'));
  // 복습 줄은 "복습량"이고 성장 문장은 없다. 앞당겨 할 복습이 없으면 버튼은 눌러지지 않는다.
  const review = renderToStaticMarkup(React.createElement(DoneSummary, { row: { detailId: 'basic-review:x', kind: 'review', kindLabel: '기본 복습', title: 'X', pages: 10, minutes: 9,
    latestTimestamp: '', summary: '', short: '', growth: '속도 +10.0P/h', dailyAverageMinutes: 6.4 } }));
  assert.ok(review.includes('복습량') && !review.includes('속도 +10.0P/h') && review.includes('disabled=""') && review.includes('앞당겨 할 복습이 없어요'), 'a review always has the button, disabled when there is nothing to start early');
  assert.ok(review.includes('>6.4<'), '45 minutes over 7 days is 6.4 minutes a day');
  // 아직 할 일이 남은 과목을 보면 평소 정보와 켜진 시작 버튼이 그대로다.
  const pending = renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    idle: idle({ doneOnlyKeys: [], selectedDetailKey: 'deadline', recommendedPages: 3 }), completedStudySubjectIds: [], logs: [] }));
  assert.ok(pending.includes('학습 진척도') && pending.includes('뽀모도로') && pending.includes('>학습 시작<') && !pending.includes('start-disabled'));
  assert.ok(!pending.includes('data-done') && !pending.includes('border-green-700'), 'the green only shows once the work is done');
});

test('a finished review gets the same green growth cell and an extra study button that starts the next review early', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 10, true,
    '2026-10-12T03:00:00Z', measurement('done', 5, 3));
  const idle = (extra = {}) => ({
    queueCount: 0, queueMinutes: 0, selectedDetailKey: '', rowOrder: ['first'], doneOnlyKeys: ['first'], currentRowDone: true,
    selectedKind: null, selectedName: '', startPage: null, recommendedPages: null, startButton: null, onExtraStudy() {}, ...extra
  });
  const props = { logs, subjects: reviewChainSubjects, completedStudySubjectIds: [], detailSubjectId: 'first', taskSelector: null,
    activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}, idle: idle({ extraReviewKeys: ['first'] }) };
  const withExtra = renderToStaticMarkup(React.createElement(TodaySummary, props));
  assert.equal((withExtra.match(/aria-label="성장"/g) || []).length, 1);
  assert.ok(withExtra.includes('data-done="true"') && withExtra.includes('border-green-500 bg-[#d0f9de]') && withExtra.includes('data-testid="review-speed-growth"'));
  const right = withExtra.slice(withExtra.indexOf('data-testid="done-summary"'));
  assert.ok(right.includes('복습량') && right.includes('data-testid="extra-study"') && right.includes('추가 학습하기'));
  assert.ok(right.includes('border-amber-800 bg-amber-700 text-white'), 'the review button is filled in the review colour');
  assert.ok(!withExtra.includes('data-testid="start-disabled"') && !withExtra.includes('aria-label="합산 기록 수정"'));
  // 앞당겨 할 다음 복습이 없어도 버튼은 있다. 눌러지지 않고 이유가 적혀 있다.
  const none = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, idle: idle({ extraReviewKeys: [] }) }));
  assert.match(none, /<button[^>]*disabled=""[^>]*data-testid="extra-study"|<button[^>]*data-testid="extra-study"[^>]*disabled=""/);
  assert.ok(none.includes('추가 학습하기') && none.includes('앞당겨 할 복습이 없어요') && !none.includes('data-testid="start-disabled"'));
  // 앞당겨 할 복습: 복습 과목에 남은 장수가 있어 반복 복습이 예약돼 있으면, 아직 기한 전이어도 그 칸의 다음 복습으로 시작할 수 있다.
  const { createRepeatedSubjectReview } = loadSource('utils/review.ts');
  const repeat = createRepeatedSubjectReview({ ...chainLog('rep'), subjectId: 'first', endPage: 5 }, 'parent', 0, Date.parse('2026-10-12T04:00:00Z'));
  const notYet = buildDueReviewGroups([repeat], reviewChainSubjects, Date.parse('2026-10-12T05:00:00Z'), new Set());
  assert.equal(notYet.length, 0, 'not due yet, so it is not in the normal queue');
  const early = buildDueReviewGroups([repeat], reviewChainSubjects, Number.MAX_SAFE_INTEGER, new Set());
  assert.equal(early.length, 1);
  const { getReviewDetailKey } = loadSource('utils/review.ts');
  assert.equal(getReviewDetailKey(early[0].reviewType, early[0].parentSubjectId, early[0].subjectId), 'first', 'it belongs to the done card of that review subject');
  assert.equal(buildDueReviewGroups([repeat], reviewChainSubjects, Number.MAX_SAFE_INTEGER, new Set([repeat.id])).length, 0, 'what was handled today is skipped');
  const loggerSource = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(loggerSource.includes('const extraReviewGroups = useMemo') && loggerSource.includes('Number.MAX_SAFE_INTEGER'));
  assert.ok(loggerSource.includes("if (group.isGateRetry) return;") && loggerSource.includes('startReviewGroup(group)'));
  assert.ok(loggerSource.includes("extraReviewKeys: doneCards.filter(card => card.kind === 'review' && extraReviewGroups.has(card.detailKey))"));
  // 다시 열면 같은 칸에서 "복습 시작"이 켜진다
  const reopenSource = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(reopenSource.includes("<StartButton kind={doneRow?.kind === 'review' ? 'review' : 'study'}"));
});

test('the arrow pair sits in the first summary pill slot of the title row, and the start button no longer has a bar', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { StepArrows, TaskQueueList, DoneStartButton } = loadSource('components/TodayTasks.tsx');
  const bar = renderToStaticMarkup(React.createElement(StepArrows, { position: 2, total: 5, done: false, onStep() {} }));
  const back = bar.indexOf('aria-label="더 중요한 할 일로"');
  const label = bar.indexOf('>2 / 5<');
  const forward = bar.indexOf('aria-label="덜 중요한 할 일로"');
  assert.ok(back >= 0 && back < label && label < forward, 'back arrow, position, forward arrow in one pill');
  assert.ok(bar.includes('rounded-full border-2 border-slate-400'), 'the arrow pill has the same firm border as the other pills');
  assert.ok(renderToStaticMarkup(React.createElement(DoneStartButton)).includes('오늘 학습 완료'));
  const list = renderToStaticMarkup(React.createElement(TaskQueueList, { items: [], currentKey: '', onRefresh() {},
    stats: { minutes: 73, completedLabel: '24P · 47분' }, stepper: { position: 2, total: 5, done: false, onStep() {} } }));
  assert.ok(list.includes('1시간 13분') && list.includes('24P · 47분') && list.includes('오늘 요약') && !list.includes('4건') && !list.includes('>할 일<'));
  assert.ok(list.indexOf('오늘 요약') > list.indexOf('id="today-task-label"') && list.indexOf('오늘 요약') < list.indexOf('계획 갱신'), 'pills sit between the title and the refresh button');
  assert.ok(list.indexOf('data-testid="task-stepper"') < list.indexOf('예상 소요'), 'the arrows come first, where the task-count pill used to be');
  assert.ok(list.includes('order-last') && list.includes('lg:order-none'), 'below the title on portrait, inline on landscape');
  const summary = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(!summary.includes('TaskStepper') && !summary.includes('stepperBar'), 'the bottom arrow/start bar is gone');
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('stepper={{ position: taskCards.findIndex(card => card.key === currentChipKey) + 1') && logger.includes('onStep: stepTaskRow'));
});

test('note pages: every page the counter shows can be reached, and the paper is padded to whole pages', () => {
  const { countSheetPages, sheetPageAt } = loadSource('components/NoteTab.tsx');
  const height = 420;
  // 글 높이 896px(=2.13쪽)이면 3쪽이고, 종이를 3쪽 높이로 채우므로 3쪽 위치(840)까지 스크롤된다.
  assert.equal(countSheetPages(894 + 2, height), 3);
  assert.equal(countSheetPages(0, height), 1);
  assert.equal(countSheetPages(420, height), 1);
  assert.equal(countSheetPages(422, height), 1, 'a 2px spill is not a new page');
  assert.equal(countSheetPages(423, height), 2);
  for (let content = 1; content <= 3000; content += 7) {
    const total = countSheetPages(content, height);
    const maxScroll = total * height - height; // padded paper height = total * height
    assert.equal(sheetPageAt(maxScroll, height, total), total, `last page reachable for content ${content}`);
    for (let page = 1; page <= total; page++) assert.equal(sheetPageAt((page - 1) * height, height, total), page);
  }
  // 예전 계산: 종이를 채우지 않아 최대 스크롤(896-420=476)에서는 2쪽까지만 보였다.
  assert.equal(Math.floor((476 + height / 2) / height) + 1, 2);
  const source = fs.readFileSync(path.resolve(__dirname, '../components/NoteTab.tsx'), 'utf8');
  assert.ok(source.includes('minHeight: pageState.total * rows * ROW') && source.includes("scrollSnapAlign: 'start'") && source.includes('data-page-start'));
});

test('pomodoro, next-unit and efficiency numbers are large, and the two cells have the same height on landscape', () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, '../components', name), 'utf8');
  const summary = read('TodaySummary.tsx');
  const growth = read('PageGrowth.tsx');
  const boxes = read('EfficiencyBoxes.tsx');
  // 뽀모도로 숫자 40~44px, 라벨 15px. 큰 두 칸은 같은 높이로 늘어난다(items-stretch).
  assert.ok(summary.includes('text-[40px]') && summary.includes('md:text-[44px]') && summary.includes('text-[15px] font-bold'));
  assert.ok(summary.includes('lg:grid-cols-2') && summary.includes('lg:items-stretch'));
  // 시작 페이지 48px, 복습의 다음 시작 페이지 44px
  assert.ok(summary.includes('text-[48px] font-black') && summary.includes('text-[44px] font-black leading-[1.1] tabular-nums text-indigo-900'));
  // 전체 효율 44~48px, 타임어택 30px, 알약 15px
  assert.ok(boxes.includes('md:text-[48px]') && boxes.includes('text-[30px]') && boxes.includes('text-[15px] font-black'));
  // 이번 단위: 36px 숫자(단위 크기가 정해져 있지 않아 게이지는 없다)
  assert.ok(growth.includes('text-[36px]') && growth.includes('text-base font-black text-slate-800') && !growth.includes('<UnitGauge'));
  // 복습과목의 두 공부량 증가율 칸: 라벨 16px / 숫자 30~36px
  const cell = growth.slice(growth.indexOf('const GrowthLines'), growth.indexOf('export const UnitGauge'));
  assert.ok(cell.includes('text-base font-black text-slate-700') && cell.includes('lg:text-4xl') && !cell.includes('text-xs'));
  assert.ok(!/text-\[(?:8|9|10|11)px\]/.test(summary + growth + boxes));
});

test('detail is two big cells: start things on the left, growth things on the right, with firm borders', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { SummaryTiles, TaskQueueList } = loadSource('components/TodayTasks.tsx');
  const props = { logs: [], subjects: reviewChainSubjects.map(subject => subject.id === 'first'
    ? { ...subject, reviewGrowthDisplay: 'unit' } : { ...subject }), completedStudySubjectIds: [], detailSubjectId: 'first',
    taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const html = renderToStaticMarkup(React.createElement(TodaySummary, props));
  const startCell = html.slice(html.indexOf('aria-label="공부 시작"'), html.indexOf('aria-label="성장"'));
  const growthCell = html.slice(html.indexOf('aria-label="성장"'));
  assert.ok(startCell.includes('다음 시작') && startCell.includes('뽀모도로'));
  assert.ok(!startCell.includes('학습 진척도') && !startCell.includes('전체 효율') && !startCell.includes('다음 단위까지'));
  assert.ok(growthCell.includes('학습 진척도') && growthCell.includes('전체 효율') && growthCell.includes('타임어택 효율') && growthCell.includes('이번 단위'));
  assert.ok(!growthCell.includes('필요 횟수') && !growthCell.includes('한 번에'), 'the pomodoro summary stays in the start cell');
  // 바깥 큰 칸과 안의 두 칸은 오늘 할 일·과목 셀처럼 2px 진한 테두리(slate-500), 칸 안 구분선은 그보다 연하다(slate-300)
  assert.equal((html.match(/rounded-2xl border-2 border-slate-500 bg-white/g) || []).length, 2);
  assert.ok(html.includes('rounded-2xl border-2 border-slate-500 bg-slate-100 p-5'));
  assert.ok(html.includes('divide-slate-300') && !html.includes('divide-slate-200'));
  // 오늘 할 일 요약 알약 2개(예상 소요 · 오늘 완료)와 과목 셀은 2px 테두리, 셀은 알약보다 한 단계 더 진하다
  const tiles = renderToStaticMarkup(React.createElement(SummaryTiles, { minutes: 80, completedLabel: '24P · 47분' }));
  assert.equal((tiles.match(/rounded-full border-2 px-4 border-slate-400/g) || []).length, 2);
  const items = [
    { key: 'a', detailKey: 'a', kind: 'study', kindLabel: '학습', title: 'A', meta: '', required: false, timeLabel: '10분', state: 'pending' },
    { key: 'b', detailKey: 'b', kind: 'study', kindLabel: '학습', title: 'B', meta: '', required: false, timeLabel: '10분', state: 'done', done: { short: '4P · 14분' } }
  ];
  const list = renderToStaticMarkup(React.createElement(TaskQueueList, { items, currentKey: 'zzz', currentRowKey: 'zzz', onRefresh() {} }));
  assert.equal((list.match(/rounded-xl border-2 px-3 py-2 border-slate-300 bg-white/g) || []).length, 1);
  assert.equal((list.match(/rounded-xl border-2 px-3 py-2 border-slate-300 bg-slate-100/g) || []).length, 1);
});

test('the kind badge sits in the start cell title and there is no duplicate review line', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const base = { logs: [], completedStudySubjectIds: [], taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const review = renderToStaticMarkup(React.createElement(TodaySummary, { ...base, subjects: reviewChainSubjects, detailSubjectId: 'first' }));
  // 분류는 "공부 시작" 칸 제목에서 "공부 시작"과 끝날 날짜 사이에 놓인다(공부 시작 칸이 없을 때만 제목 줄 오른쪽)
  const cellTitle = review.slice(review.indexOf('data-testid="cell-title"'), review.indexOf('</h3>', review.indexOf('data-testid="cell-title"')));
  assert.ok(cellTitle.includes('공부 시작') && cellTitle.includes('data-testid="detail-kind"') && cellTitle.includes('복습과목'));
  assert.ok(cellTitle.indexOf('공부 시작') < cellTitle.indexOf('data-testid="cell-badges"'));
  // "복습과목"이라는 글자는 제목 줄의 분류 표시 한 번뿐이다(제목 아래 작은 글씨, 왼쪽 "복습" 표시는 없다)
  assert.equal((review.match(/복습과목/g) || []).length >= 1, true);
  assert.ok(!/<p[^>]*>[^<]*복습과목<\/p>/.test(review), 'no small duplicate line under the title');
  assert.equal((review.match(/data-testid="detail-kind"/g) || []).length, 1);
});

test('next-unit gauge fills with the pages already done in the current unit', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { UnitGauge } = loadSource('components/PageGrowth.tsx');
  const gauge = renderToStaticMarkup(React.createElement(UnitGauge, { done: 3, total: 5 }));
  assert.ok(gauge.includes('role="progressbar"') && gauge.includes('aria-valuenow="3"') && gauge.includes('aria-valuemax="5"'));
  assert.ok(gauge.includes('width:60.0%'), 'three of five pages = 60%');
  assert.ok(gauge.includes('calc(100% / 5 - 2px)'), 'one tick per page for small units');
  const empty = renderToStaticMarkup(React.createElement(UnitGauge, { done: 0, total: 10 }));
  assert.ok(empty.includes('width:0.0%'));
  const big = renderToStaticMarkup(React.createElement(UnitGauge, { done: 12, total: 30 }));
  assert.ok(big.includes('width:40.0%') && !big.includes('repeating-linear-gradient'), 'no ticks for large units');
  const over = renderToStaticMarkup(React.createElement(UnitGauge, { done: 9, total: 5 }));
  assert.ok(over.includes('width:100.0%'), 'never past full');
});

test('arrows move by row key, so rows that share a subject (review split by range) are each reachable', () => {
  const { stepRowKey } = loadSource('components/TodayTasks.tsx');
  const rows = [
    { key: 'review-s4', detailKey: 'basic-review:s4' },
    { key: 'review-s1:range-0', detailKey: 's3' },
    { key: 'review-s1:range-1', detailKey: 's3' },
    { key: 'study-s1', detailKey: 's1' },
    { key: 'done-s2', detailKey: 's2' }
  ];
  // 예전 방식(상세 키로 위치 찾기): 같은 키 's3'에서 오른쪽으로 가면 다시 's3' → 제자리
  const byDetail = rows.map(row => row.detailKey);
  assert.equal(stepRowKey(byDetail, 's3', 1), 's3', 'old behavior was stuck on the duplicate');
  // 지금 방식(칸 고유 키): 한 칸씩 끝까지 갔다가 돌아온다
  const byKey = rows.map(row => row.key);
  let current = byKey[0];
  const visited = [current];
  for (let i = 0; i < 4; i++) { current = stepRowKey(byKey, current, 1); visited.push(current); }
  assert.deepEqual(visited, byKey);
  assert.equal(stepRowKey(byKey, current, 1), undefined);
  for (let i = 0; i < 4; i++) current = stepRowKey(byKey, current, -1);
  assert.equal(current, byKey[0]);
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('stepRowKey(taskCards.map(card => card.key), currentChipKey, delta)') && logger.includes('onStep: stepTaskRow'));
  assert.ok(logger.includes('currentRowKey={currentChipKey}'), 'only the row being viewed is highlighted');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TaskQueueList } = loadSource('components/TodayTasks.tsx');
  const items = rows.map(row => ({ ...row, kind: 'review', kindLabel: '과목 복습', title: row.key, meta: '', required: false, timeLabel: '35분', state: row.key.startsWith('done') ? 'done' : 'pending' }));
  const html = renderToStaticMarkup(React.createElement(TaskQueueList, { items, currentKey: 's3', currentRowKey: 'review-s1:range-1', onRefresh() {} }));
  assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
  assert.match(html, /data-task-key="review-s1:range-1" data-task-state="pending" aria-current="true"/);
});

test('a subject can name its page unit anything: helpers fall back to P, trim spaces and cap the length', () => {
  const label = loadSource('utils/pageLabel.ts');
  assert.deepEqual([label.DEFAULT_PAGE_LABEL, label.MAX_PAGE_LABEL_LENGTH], ['P', 6]);
  assert.deepEqual([undefined, null, '', '  ', 'n', ' 단 원 ', '1234567890'].map(label.normalizePageLabel), ['P', 'P', 'P', 'P', 'n', '단원', '123456']);
  assert.equal(label.getPageLabel({ pageLabel: '회' }), '회');
  assert.equal(label.getPageLabel({}), 'P');
  assert.equal(label.getPageLabel(undefined), 'P');
  // 위치는 기본이면 소문자 p, 직접 정한 글자는 그대로 / 낱말로는 기본이면 "페이지"
  assert.deepEqual([label.pagePositionLabel('P'), label.pagePositionLabel('n'), label.pagePositionLabel('단원')], ['p', 'n', '단원']);
  assert.deepEqual([label.pageWord('P'), label.pageWord('n'), label.pageWord('단원')], ['페이지', 'n', '단원']);
  const growth = loadSource('utils/pageGrowth.ts');
  // 속도 P/h → n/h, 공부량 분/P → 분/n
  assert.equal(growth.describeSpeed({ speedPages: 12, studyMinutes: -2.5 }, 'n'), '속도 +12.0n/h');
  assert.equal(growth.describeStudyAmount({ speedPages: 12, studyMinutes: -2.5 }, 'n'), '공부량 −2.5분/n');
  assert.equal(growth.describeSpeed({ speedPages: 12, studyMinutes: -2.5 }), '속도 +12.0P/h');
  assert.equal(growth.describeGrowthChange({ speedPages: 12, studyMinutes: -2.5 }, false, '단원'), '속도 +12.0단원/h · 공부량 −2.5분/단원');
});

test('a plan is created with its own unit name and can have no page unit at all', () => {
  const { createNewStudyPlan, SubjectPlanner } = loadSource('components/SubjectPlanner.tsx');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const plain = createNewStudyPlan('Plain', 1, 100, '2026-12-31', false, [1]);
  assert.deepEqual([plain.growthPageUnit, plain.pageLabel], [10, 'P']);
  const custom = createNewStudyPlan('Custom', 1, 100, '2026-12-31', false, [1], 20, ' 단원 ');
  assert.deepEqual([custom.growthPageUnit, custom.pageLabel], [20, '단원']);
  // 단위 없음 = 0. 저장했다 다시 불러와도 0이다.
  const endless = createNewStudyPlan('Endless', 1, 100, '2026-12-31', false, [1], 0, 'n');
  assert.deepEqual([endless.growthPageUnit, endless.pageLabel], [0, 'n']);
  assert.equal(JSON.parse(JSON.stringify(endless)).growthPageUnit, 0);
  const html = renderToStaticMarkup(React.createElement(SubjectPlanner, { onAddSubject() {} }));
  assert.ok(html.includes('id="new-plan-page-label"') && html.includes('maxLength="6"') && html.includes('단위 이름'));
  assert.ok(!html.includes('id="new-plan-no-unit"') && !html.includes('id="new-plan-page-unit"'), 'no fixed page unit to choose');
  assert.ok(html.includes('시작 페이지') && html.includes('끝 페이지') && !html.includes('페이지 단위'));
});

test('the unit name replaces P and p everywhere in the subject screen and the measuring screen', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary, PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const { MeasurementProgress } = loadSource('components/SessionLogger.tsx');
  const custom = { id: 'main', name: 'Main', startPage: 1, totalPages: 100, completedPages: 15, targetDate: '2026-12-31', pageLabel: 'n', growthPageUnit: 20 };
  const logs = [
    source({ id: 'old', pagesRead: 5, startPage: 1, endPage: 5, timeSpentMinutes: 25, timeAttackMinutes: 10, timestamp: '2026-10-12T01:00:00Z' }),
    source({ id: 'new', pagesRead: 10, startPage: 6, endPage: 15, timeSpentMinutes: 25, timeAttackMinutes: 5, timestamp: '2026-10-12T02:00:00Z' })];
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { logs, subjects: [custom], detailSubjectId: 'main',
    taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {},
    pomodoroPlan: { subjectId: 'main', pages: 5, minutes: 25, remainingTaskPages: 25 } }));
  // 속도 n/h, 공부량 분/n, 위치 n.1~20, 단위 20n
  assert.ok(html.includes('속도 +12.0n/h') && html.includes('공부량 −2.5분/n') && html.includes('1번째 단위 · 복습에 넣으면 단위가 끝나요'));
  assert.ok(html.includes('>분/n</span>'), 'the efficiency values carry the unit name');
  assert.ok(!html.includes('P/h') && !html.includes('분/P') && !/>P<\/span>/.test(html.replace(/<h[^>]*>[\s\S]*?<\/h\d>/g, '')), 'no default P is left in the subject screen');
  // 기본 과목은 그대로 P / p.
  const plain = renderToStaticMarkup(React.createElement(TodaySummary, { logs, subjects: [{ ...custom, pageLabel: undefined }], detailSubjectId: 'main',
    taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} }));
  assert.ok(plain.includes('속도 +12.0P/h') && plain.includes('1번째 단위 · 복습에 넣으면') && !plain.includes('n/h'));
  // 뽀모도로 요약의 "풀 장수"
  const pomodoro = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: 6, efficiency: 4.26, attackEfficiency: 1.93, remainingTaskPages: 13, label: '회' }));
  assert.match(pomodoro, /풀 회[\s\S]*6<[^>]*>회/);
  assert.ok(!/6<[^>]*>P/.test(pomodoro) && !pomodoro.includes('분/P') && pomodoro.includes('분/회'));
  // 측정 화면: 이번 측정 3 / 5회, 남은 장수 2회
  const progress = renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 3, target: 5, elapsed: '10:00', label: '단원' }));
  assert.ok(progress.includes('3 / 5단원') && !progress.includes('5P'));
  assert.ok(renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 3, target: 5, elapsed: '10:00' })).includes('3 / 5P'));
  assert.match(progress, /data-testid="measurement-remaining"[^>]*>2단원</);
  assert.ok(!progress.includes('2P'));
});

test('the two big cell titles (공부 시작 and 성장) are large and dark, not small grey labels', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const html = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: 5, remainingTaskPages: 21 }));
  const titles = html.match(/<h3 data-testid="cell-title"[^>]*>[\s\S]*?<\/h3>/g) || [];
  assert.equal(titles.length, 2);
  assert.ok(titles[0].includes('공부 시작') && titles[1].includes('성장'));
  titles.forEach(title => assert.ok(title.includes('text-[22px]') && title.includes('font-black') && title.includes('text-slate-900')
    && !title.includes('text-slate-500') && !title.includes('text-[13px]')));
});

test('single-subject screens in history and review management use the subject unit name, while group totals keep P', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { HistoryCharts } = loadSource('components/HistoryCharts.tsx');
  const { ReviewManager } = loadSource('components/ReviewManager.tsx');
  const todayKey = new Date().toISOString();
  const custom = { id: 'main', name: 'Main', startPage: 1, totalPages: 100, completedPages: 40, targetDate: '2099-12-31', pageLabel: '단원', growthPageUnit: 20 };
  const logs = [0, 1, 2, 3].map(index => source({ id: `h${index}`, subjectId: 'main', pagesRead: 10, startPage: index * 10 + 1, endPage: index * 10 + 10,
    timeSpentMinutes: 30 - index * 4, timestamp: new Date(Date.parse(todayKey) - (4 - index) * 3600e3).toISOString() }));
  const history = renderToStaticMarkup(React.createElement(HistoryCharts, { subjects: [custom], logs }));
  assert.ok(history.includes('40 / 100 단원') && history.includes('복습에 넣기 사이 단위') && /분\/단원/.test(history));
  const plain = renderToStaticMarkup(React.createElement(HistoryCharts, { subjects: [{ ...custom, pageLabel: undefined }], logs }));
  assert.ok(plain.includes('40 / 100 P') && plain.includes('복습에 넣기 사이 단위'));
  const review = renderToStaticMarkup(React.createElement(ReviewManager, { subjects: [custom],
    logs: [source({ id: 'r1', subjectId: 'main', pagesRead: 4, startPage: undefined, endPage: undefined, reviewEnabled: true, nextReviewDate: '2020-01-01T00:00:00.000Z' })],
    onReviewAction() {}, onUpdateReviewMemo() {} }));
  assert.ok(!review.includes('4P'), 'a log without page numbers shows its amount in the unit name');
});

test('the daily average counts the subject being studied and its own review subjects only, never its follow-up subjects, and shows no seven-day sum', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { buildCompletedDetailRows, TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { getSubjectFamily } = loadSource('utils/subjectChain.ts');
  const family = [
    { id: 'main', name: 'Main', startPage: 1, totalPages: 30, completedPages: 30, targetDate: '2026-10-12', reviewSubjectIds: ['rev1'],
      followUpSubjects: [{ id: 'fu1', sourceSubjectId: 'src', name: 'Next', startPage: 31, endPage: 60, completedPage: 40, reviewSubjectIds: ['rev2'] }] },
    { id: 'rev1', name: 'Main review', startPage: 1, totalPages: 30, completedPages: 0, targetDate: '2026-12-31' },
    { id: 'rev2', name: 'Next review', startPage: 1, totalPages: 30, completedPages: 0, targetDate: '2026-12-31' },
    { id: 'src', name: 'Src', startPage: 1, totalPages: 30, completedPages: 30, targetDate: '2026-12-31' },
    { id: 'other', name: 'Other', startPage: 1, totalPages: 30, completedPages: 0, targetDate: '2026-12-31' }
  ];
  const study = (id, subjectId, date, minutes, extra = {}) => ({ id, subjectId, studyDate: date, timestamp: `${date}T04:00:00Z`,
    pagesRead: 5, startPage: 1, endPage: 5, timeSpentMinutes: minutes, ...extra });
  const logs = [
    study('today', 'main', '2026-10-12', 35),
    study('earlier', 'main', '2026-10-08', 21),
    study('original', 'src', '2026-10-10', 14),
    study('review-session', 'rev1', '2026-10-11', 28, { reviewParentSubjectId: 'main', pomodoroSession: true }),
    study('with-basic', 'main', '2026-09-20', 50, { basicReviewTimeRecords: [{ pages: 2, minutes: 14, timestamp: '2026-10-11T05:00:00Z', reviewNumber: 1 }] }),
    study('too-old', 'main', '2026-10-05', 100),
    study('unrelated', 'other', '2026-10-11', 70),
    // 후행과목(Next) 쪽 기록: 앞 단계를 끝낸 다음날부터 시작하므로 첫 단계의 평균에는 들어가지 않는다
    study('next-stage', 'main', '2026-10-11', 42, { subjectStageId: 'fu1' }),
    study('next-review', 'rev2', '2026-10-11', 9, { reviewParentSubjectId: 'main', pomodoroSession: true })
  ];
  // 첫 단계(Main)의 최근 7일(10월 6~12일): 35 + 21 + 28(Main review 세션) + 14(기본 복습) = 98분 → 하루 평균 14분.
  // 후행과목 원본(14분)·후행 단계(42분)·후행 복습(9분)·10월 5일·다른 과목은 세지 않는다.
  const rows = buildCompletedDetailRows(logs, family, ['main'], '2026-10-12');
  const mainRow = rows.find(row => row.detailId === 'main');
  assert.equal(mainRow.dailyAverageMinutes, 14);
  assert.equal(mainRow.minutes, 35, 'what was done today is still only the subject itself');
  // 후행 단계를 공부한 날: 그 단계(Next)의 기록 10 + 42, 합쳐지기 전 원래 과목 14, 후행 복습 9 = 75분. 처음 공부한 10/10부터 3일 → 25분. 첫 단계 기록은 세지 않는다.
  const nextLogs = [...logs, study('today-next', 'main', '2026-10-12', 10, { subjectStageId: 'fu1', timestamp: '2026-10-12T09:00:00Z' })];
  assert.equal(buildCompletedDetailRows(nextLogs, family, ['main'], '2026-10-12').find(row => row.detailId === 'main').dailyAverageMinutes, 25);
  // 복습과목이나 후행과목 원본에서 보면 그것이 붙은 단계의 묶음이다
  const pick = f => [f.ownerId, f.stageId, f.sourceSubjectId, [...f.reviewIds].sort()];
  assert.deepEqual(pick(getSubjectFamily(family, 'rev1')), ['main', 'main', undefined, ['rev1']]);
  assert.deepEqual(pick(getSubjectFamily(family, 'rev2')), ['main', 'fu1', 'src', ['rev2']]);
  assert.deepEqual(pick(getSubjectFamily(family, 'src')), ['main', 'fu1', 'src', ['rev2']]);
  assert.deepEqual(pick(getSubjectFamily(family, 'main', 'main')), ['main', 'main', undefined, ['rev1']]);
  assert.equal(getSubjectFamily(family, 'main').stageId, 'fu1', 'without a hint the stage being studied now is used');
  assert.deepEqual([getSubjectFamily(family, 'other').ownerId, getSubjectFamily(family, 'missing').ownerId], ['other', 'missing']);
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { logs, subjects: family, completedStudySubjectIds: ['main'], detailSubjectId: 'main',
    taskSelector: null, activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {},
    onUpdateReviewMemo() {}, idle: { queueCount: 1, queueMinutes: 20, selectedDetailKey: 'other', rowOrder: ['other', 'main'], doneOnlyKeys: ['main'],
      selectedKind: 'study', selectedName: 'Other', startPage: 5, recommendedPages: 3, startButton: React.createElement('button', { type: 'button' }, '학습 시작'), onExtraStudy() {} } }));
  assert.match(html, /data-testid="daily-average"[\s\S]*?하루 평균 공부 시간[\s\S]*?>14<span[^>]*>분<\/span>/);
  assert.ok(!html.includes('최근 7일') && !html.includes('7일 평균'));
});

test('the subject title lists the follow-up subjects and puts review subjects in brackets, like A-B[C]-D', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { getSubjectChain, formatSubjectChain, hasSubjectChain } = loadSource('utils/subjectChain.ts');
  const subject = (extra = {}) => ({ id: 'a', name: 'A', startPage: 1, totalPages: 30, completedPages: 10, targetDate: '2026-12-31', ...extra });
  const review = (id, name) => ({ id, name, startPage: 1, totalPages: 30, completedPages: 0, targetDate: '2026-12-31' });
  const follow = (id, name, extra = {}) => ({ id, name, startPage: 31, endPage: 60, completedPage: 30, ...extra });
  const render = (list, detail = 'a') => renderToStaticMarkup(React.createElement(TodaySummary, { logs: [], subjects: list, detailSubjectId: detail,
    taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} }));
  const plain = [subject()];
  assert.equal(formatSubjectChain(getSubjectChain(plain[0], plain)), 'A');
  assert.equal(hasSubjectChain(getSubjectChain(plain[0], plain)), false);
  const plainHtml = render(plain);
  assert.ok(/<h2[^>]*data-testid="detail-title"[^>]*>A<\/h2>/.test(plainHtml), 'no follow-ups and no reviews: only the name');
  assert.ok(!plainHtml.includes('chain-follow-up') && !plainHtml.includes('chain-reviews'));
  // A - B[C] - D: B(후행)에 복습과목 C가 붙고, D(후행)는 복습 없음
  const chained = [subject({ followUpSubjects: [follow('b', 'B', { reviewSubjectIds: ['c'] }), follow('d', 'D', { startPage: 61, endPage: 90, completedPage: 60 })] }),
    review('c', 'C')];
  assert.equal(formatSubjectChain(getSubjectChain(chained[0], chained)), 'A-B[C]-D');
  const html = render(chained);
  assert.equal((html.match(/data-testid="chain-first"/g) || []).length, 1);
  assert.equal((html.match(/data-testid="chain-follow-up"/g) || []).length, 2);
  assert.equal((html.match(/data-testid="chain-reviews"/g) || []).length, 1);
  // 제목은 글자로 이어진다: 후행과목은 "-"로, 복습과목은 대괄호로
  const titleOf = markup => markup.match(/<h2[^>]*data-testid="detail-title"[^>]*>([\s\S]*?)<\/h2>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(titleOf(html), 'A-B[C]-D');
  assert.ok(!html.match(/<h2[^>]*data-testid="detail-title"[^>]*>/)[0].includes('truncate'), 'a long chain wraps instead of being cut');
  // 지금 공부하는 과목(여기서는 A) 하나만 크고 가장 진하고 밑줄이 있다. 나머지는 작고 옅다.
  assert.equal((html.match(/data-current="true"/g) || []).length, 1);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.ok(/data-testid="chain-first"[^>]*data-current="true"[^>]*text-\[28px\] font-black text-slate-950 underline[^>]*>A</.test(html));
  assert.equal((html.match(/text-\[18px\] font-bold text-slate-600/g) || []).length, 2, 'B and D are small and lighter');
  // 지금 과목의 복습은 조금 진하게, 다른 과목의 복습은 옅게
  assert.ok(/data-testid="chain-reviews"[^>]*text-\[16px\] font-bold text-slate-400[^>]*>\[C\]</.test(html));
  // 과목 자신에게 붙은 복습과목도 대괄호로, 여럿이면 쉼표로 잇는다: A[E, F]-B
  const own = [subject({ reviewSubjectIds: ['e', 'f'], followUpSubjects: [follow('b', 'B')] }), review('e', 'E'), review('f', 'F')];
  assert.equal(formatSubjectChain(getSubjectChain(own[0], own)), 'A[E, F]-B');
  const ownHtml = render(own);
  assert.equal(titleOf(ownHtml), 'A[E, F]-B');
  assert.ok(/data-testid="chain-reviews"[^>]*text-\[19px\] font-bold text-slate-700[^>]*>\[E, F\]</.test(ownHtml), 'the current subject keeps its reviews a bit stronger');
  // 지워진 복습과목은 이름을 알 수 없으니 빼고, 현재 공부 중인 후행과목은 진하게 표시한다
  const missing = [subject({ completedPages: 30, reviewSubjectIds: ['gone'], followUpSubjects: [follow('b', 'B')] })];
  assert.equal(formatSubjectChain(getSubjectChain(missing[0], missing)), 'A-B');
  assert.equal(getSubjectChain(missing[0], missing).map(segment => segment.isCurrent).join(), 'false,true');
  assert.equal(getSubjectChain(missing[0], missing).map(segment => segment.isCompleted).join(), 'true,false');
  const missingHtml = render(missing);
  assert.ok(/data-testid="chain-first"[^>]*text-\[18px\] font-bold text-slate-400/.test(missingHtml), 'a finished subject is the lightest');
  assert.ok(/data-testid="chain-follow-up"[^>]*data-current="true"[^>]*text-\[28px\]/.test(missingHtml), 'the follow-up that is being studied is the strong one');
  // 복습과목 자신을 열었을 때는 제목에 이름만 보인다
  const reviewHtml = render([subject({ reviewSubjectIds: ['c'], followUpSubjects: [follow('b', 'B')] }), review('c', 'C')], 'c');
  assert.ok(!reviewHtml.includes('chain-follow-up') && !reviewHtml.includes('chain-reviews'));
});

test('idle subject cells are slightly darker than the page, and a finished subject turns the whole cell green, including the efficiency card', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { EfficiencyBoxes } = loadSource('components/EfficiencyBoxes.tsx');
  const idleHtml = renderToStaticMarkup(React.createElement(TodaySummary, { logs: [], subjects: [{ id: 'a', name: 'A', startPage: 1, totalPages: 30, completedPages: 10, targetDate: '2026-12-31' }],
    detailSubjectId: 'a', taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} }));
  // 바깥은 한 단계 진한 slate-100, 안의 두 칸은 흰색, 효율 카드는 slate-100
  assert.ok(idleHtml.includes('border-slate-500 bg-slate-100 p-5') && !idleHtml.includes('bg-slate-50 p-5'));
  assert.equal((idleHtml.match(/rounded-2xl border-2 border-slate-500 bg-white/g) || []).length, 2);
  assert.ok(idleHtml.includes('border-slate-400 bg-slate-100') && !idleHtml.includes('green'));
  // 완료: 바깥 green-50(테두리 green-200, 옅게) → 안쪽 칸 #d0f9de(green-100과 green-200 사이, 테두리 green-500) → 효율 카드도 안쪽과 같은 색(테두리 green-600). 바깥보다 안쪽이 더 진해 시선이 안으로 모이고, 효율 카드만 옅게 비지 않는다.
  const efficiencyIdle = renderToStaticMarkup(React.createElement(EfficiencyBoxes, { efficiency: 2.5, attackEfficiency: 1 }));
  const efficiencyDone = renderToStaticMarkup(React.createElement(EfficiencyBoxes, { efficiency: 2.5, attackEfficiency: 1, done: true }));
  assert.ok(efficiencyIdle.includes('border-slate-400 bg-slate-100') && !efficiencyIdle.includes('green'));
  assert.ok(efficiencyDone.includes('border-green-600 bg-[#d0f9de]') && !efficiencyDone.includes('border-slate-400'));
});

test('buttons in a subject cell are filled with colour so they stand out from the plain information', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { DoneSummary } = loadSource('components/TodaySummary.tsx');
  const { HelpPopover } = loadSource('components/TodayTasks.tsx');
  const row = { detailId: 'a', kind: 'study', kindLabel: '학습', title: 'A', pages: 5, minutes: 20, latestTimestamp: '', summary: '', short: '',
    growth: null, dailyAverageMinutes: 10, pageLabel: 'P' };
  const study = renderToStaticMarkup(React.createElement(DoneSummary, { row, onExtraStudy() {} }));
  assert.ok(/data-testid="extra-study"[^>]*class="[^"]*border-indigo-700 bg-indigo-600 text-white/.test(study) || /class="[^"]*border-indigo-700 bg-indigo-600 text-white[^"]*"[^>]*data-testid="extra-study"/.test(study),
    'study extra-study button is solid indigo with white text');
  assert.ok(!/data-testid="extra-study"[^>]*bg-white/.test(study));
  // 도움말 "?" 버튼: 색을 주면 닫힌 상태에서 그 색을, 안 주면 기존 흰 버튼을 쓴다
  const tinted = renderToStaticMarkup(React.createElement(HelpPopover, { label: 'x', triggerClassName: 'border-indigo-400 bg-indigo-100 text-indigo-900' }, 'help'));
  const plain = renderToStaticMarkup(React.createElement(HelpPopover, { label: 'x' }, 'help'));
  assert.ok(tinted.includes('border-indigo-400 bg-indigo-100 text-indigo-900') && !tinted.includes('bg-white'));
  assert.ok(plain.includes('border-slate-300 bg-white text-slate-700'));
});

test('the task chips stay under "오늘 할 일" outside the subject cell, and the one being viewed has a stronger name than the others', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TaskQueueCells, TaskQueueList } = loadSource('components/TodayTasks.tsx');
  const item = (key, title, overrides = {}) => ({ key, detailKey: key, kind: 'study', kindLabel: '학습', title, meta: '', required: false, timeLabel: '20분', state: 'pending', ...overrides });
  const items = [item('a', '수학'), item('b', '영어'), item('c', '과학', { state: 'done', done: { summary: '', short: '3P · 20분' } })];
  const html = renderToStaticMarkup(React.createElement(TaskQueueCells, { items, currentKey: 'b' }));
  assert.equal((html.match(/data-testid="task-name-current"/g) || []).length, 1);
  assert.ok(/data-testid="task-name-current"[^>]*text-\[19px\] font-black text-slate-950[^>]*>영어</.test(html));
  assert.equal((html.match(/data-testid="task-name"[^>]*text-\[15px\] font-bold/g) || []).length, 2);
  // 칩 줄은 "오늘 할 일" 제목 줄 바로 밑(TaskQueueList)에서 나온다
  const list = renderToStaticMarkup(React.createElement(TaskQueueList, { items, currentKey: 'b', onRefresh() {} }));
  assert.ok(list.includes('data-task-key="a"') && list.indexOf('오늘 할 일') < list.indexOf('data-task-key="a"'));
  // 과목 셀(TodaySummary)은 칩을 받아서 그리지 않는다
  const summarySource = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(!/taskCells/.test(summarySource), 'the subject cell does not render the task chips');
});

test('the "학습 설정 가기" button sits above "추가 학습하기" and only exists when a settings handler is given', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { DoneSummary } = loadSource('components/TodaySummary.tsx');
  const row = { detailId: 'a', kind: 'study', kindLabel: '학습', title: 'A', pages: 5, minutes: 20, latestTimestamp: '', summary: '', short: '',
    growth: null, dailyAverageMinutes: 10, pageLabel: 'P' };
  const withButton = renderToStaticMarkup(React.createElement(DoneSummary, { row, onExtraStudy() {}, onOpenSettings() {} }));
  assert.ok(withButton.includes('학습 설정 가기'));
  assert.ok(withButton.indexOf('data-testid="open-settings"') < withButton.indexOf('data-testid="extra-study"'), 'settings button is above the extra-study button');
  assert.ok(/data-testid="open-settings"[^>]*border-indigo-400 bg-indigo-100/.test(withButton), 'settings button is filled with colour');
  const without = renderToStaticMarkup(React.createElement(DoneSummary, { row, onExtraStudy() {} }));
  assert.ok(!without.includes('open-settings') && !without.includes('학습 설정 가기'));
});

test('end dates are shown as "~M/D": formatShortEndDate, estimateSubjectEndDate and the label next to "공부 시작"', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { formatShortEndDate, estimateSubjectEndDate } = loadSource('utils/completionEstimate.ts');
  assert.equal(formatShortEndDate(new Date(2026, 9, 31)), '~10/31');
  assert.equal(formatShortEndDate(new Date(2026, 0, 5)), '~1/5');
  assert.equal(formatShortEndDate(null), null);
  assert.equal(formatShortEndDate(new Date('invalid')), null);
  // 과목을 찾지 못하면 날짜를 만들지 않는다. 이미 끝난 과목도 마찬가지.
  const done = { id: 'x', name: 'X', startPage: 1, totalPages: 30, completedPages: 30, targetDate: '2026-12-31' };
  assert.equal(estimateSubjectEndDate([done], [], 'missing'), null);
  assert.equal(estimateSubjectEndDate([done], [], 'x'), null);
  // 공부 시작 옆 라벨은 CellTitle(endLabel)이 data-testid="end-date"로 그린다
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const subject = { id: 'a', name: 'A', startPage: 1, totalPages: 60, completedPages: 10, targetDate: '2099-12-31' };
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { logs: [], subjects: [subject], detailSubjectId: 'a', taskSelector: '오늘 할 일', activeWeekday: 1,
    activeStudyDate: '2026-10-12', pomodoroPlan: undefined, onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} }));
  assert.ok(!html.includes('data-testid="end-date"') || /data-testid="end-date"[^>]*>~\d{1,2}\/\d{1,2}</.test(html), 'end label is "~M/D" when present');
});

const weekNow = new Date(2026, 9, 17, 12, 0, 0); // 토요일
const weekSubjects = () => [
  { id: 'm', name: '수학', totalPages: 120, completedPages: 20, targetDate: '2026-11-20', isRequired: true, scheduledWeekdays: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'e', name: '영어', totalPages: 60, completedPages: 0, targetDate: '2026-12-10', scheduledWeekdays: [1, 3, 5] },
  { id: 'r', name: '수학 복습', totalPages: 100, completedPages: 0, targetDate: '2026-12-10' },
  { id: 'done', name: '끝난 과목', totalPages: 10, completedPages: 10, targetDate: '2026-12-10' }
].map(subject => subject.id === 'm' ? { ...subject, reviewSubjectIds: ['r'] } : subject);
const weekLogs = () => ([
  ['m', 1, 3, 30], ['m', 2, 4, 36], ['m', 3, 3, 27], ['m', 5, 5, 45], ['e', 2, 2, 50], ['e', 4, 3, 72]
]).map(([subjectId, ago, pagesRead, minutes], index) => {
  const date = new Date(weekNow.getTime() - ago * 86400e3);
  const studyDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { id: `w${index}`, subjectId, pagesRead, timeSpentMinutes: minutes, timeAttackMinutes: minutes, organizationMinutes: 0, timestamp: new Date(date.getTime() - 3600e3).toISOString(), studyDate, reviewEnabled: false };
});

test('the week plan lists only subjects that still have work, and each day adds up its subjects: pages × efficiency = minutes, deviation = σ × pages combined as root-sum-of-squares', () => {
  const { buildWeekPlan, getWeekPlanSubjects } = loadSource('utils/weekPlan.ts');
  const subjects = weekSubjects();
  assert.deepEqual(getWeekPlanSubjects(subjects).map(subject => subject.id), ['m', 'e']);
  const plan = buildWeekPlan(subjects, weekLogs(), weekNow);
  assert.deepEqual(plan.rows.map(row => row.subject.id), ['m', 'e']);
  assert.equal(plan.days.length, 7);
  assert.equal(plan.days.filter(day => day.isToday).length, 1);
  assert.equal(plan.days.find(day => day.isToday).weekday, 6);
  const near = (a, b, message) => assert.ok(Math.abs(a - b) <= 0.15, `${message}: ${a} vs ${b}`);
  plan.rows.forEach(row => {
    assert.ok(row.efficiency > 0 && row.sigma >= 0);
    Object.values(row.cells).forEach(cell => {
      near(cell.minutes, cell.pages * row.efficiency, `${row.subject.name} ${cell.weekday} minutes`);
      near(cell.spreadMinutes, cell.pages * row.sigma, `${row.subject.name} ${cell.weekday} spread`);
    });
  });
  plan.days.forEach(day => {
    const active = plan.rows.filter(row => row.cells[day.weekday].pages > 0);
    assert.equal(day.subjectCount, active.length);
    near(day.minutes, active.reduce((sum, row) => sum + row.cells[day.weekday].minutes, 0), `day ${day.weekday} minutes`);
    near(day.spreadMinutes, Math.sqrt(active.reduce((sum, row) => sum + row.cells[day.weekday].spreadMinutes ** 2, 0)), `day ${day.weekday} spread`);
    if (active.length > 0) near(Object.values(day.shares).reduce((sum, share) => sum + share, 0), 1, `day ${day.weekday} shares sum to 1`);
  });
  // 학습 요일이 아닌 날에는 그 과목이 나오지 않는다(영어는 월·수·금만)
  const english = plan.rows.find(row => row.subject.id === 'e');
  [0, 2, 4].forEach(weekday => assert.equal(english.cells[weekday].pages, 0));
  assert.ok([1, 3, 5].some(weekday => english.cells[weekday].pages > 0));
  assert.ok(plan.activeDayAverageMinutes > 0);
});

test('a hand-set weekday plan survives edits that do not touch study days or the deadline (saved pages helper)', () => {
  const { withFreshWeekPlan, hasCustomWeekdayPages, resolveSavedWeekdayPages } = loadSource('utils/weekPlan.ts');
  const soon = new Date(Date.now() + 40 * 86400e3); const target = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  const base = withFreshWeekPlan({ ...weekSubjects()[0], targetDate: target, scheduledWeekdays: [1, 2, 3, 4, 5] });
  assert.equal(hasCustomWeekdayPages(base), false, 'the automatic split is not "custom"');
  const stored = base.scheduledWeekdayPages;
  const custom = { ...base, scheduledWeekdayPages: { ...stored, 1: (stored[1] || 0) + 3 } };
  assert.equal(hasCustomWeekdayPages(custom), true);
  // 이번 수정에서 + / − 로 고친 값이 그대로 저장된다(쉬는 요일은 빠진다)
  assert.deepEqual(resolveSavedWeekdayPages(base, base, { 1: 7, 2: 0, 3: 4, 4: 4, 5: 4, 6: 9 }), { 1: 7, 2: 0, 3: 4, 4: 4, 5: 4 });
  // 안 고치고 이름만 바꾸면 전에 정해 둔 값이 남는다
  assert.deepEqual(resolveSavedWeekdayPages(custom, { ...custom, name: '새 이름' }, null), { 1: custom.scheduledWeekdayPages[1], 2: custom.scheduledWeekdayPages[2], 3: custom.scheduledWeekdayPages[3], 4: custom.scheduledWeekdayPages[4], 5: custom.scheduledWeekdayPages[5] });
  // 학습 요일이나 마감일이 바뀌면 자동으로 다시 나눈다
  const fewerDays = resolveSavedWeekdayPages(custom, { ...custom, scheduledWeekdays: [1, 3, 5] }, null);
  assert.deepEqual(Object.keys(fewerDays).map(Number).filter(day => fewerDays[day] > 0).sort(), [1, 3, 5], 'only the new study days carry pages');
  assert.ok(Object.values(fewerDays).reduce((sum, value) => sum + value, 0) > 0);
  const laterTarget = new Date(Date.now() + 80 * 86400e3); const later = `${laterTarget.getFullYear()}-${String(laterTarget.getMonth() + 1).padStart(2, '0')}-${String(laterTarget.getDate()).padStart(2, '0')}`;
  assert.notEqual(resolveSavedWeekdayPages(custom, { ...custom, targetDate: later }, null)[1], custom.scheduledWeekdayPages[1], 'a new deadline re-splits automatically instead of keeping the old hand-set value');
  // 안 고친 보통 과목은 전과 같이 자동 배분
  assert.deepEqual(resolveSavedWeekdayPages(base, { ...base, name: '새 이름' }, null), stored);

  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  const editPanel = source.slice(source.indexOf('폴더 이동</p>') - 1500, source.indexOf('폴더 이동</p>'));
  assert.ok(!editPanel.includes('요일별 페이지') && !editPanel.includes('페이지 늘리기') && !editPanel.includes('학습 요일</p>'), 'the edit panel no longer sets weekday pages or study days: that moved under 한 주 필요 시간');
  assert.ok(source.includes('resolveSavedWeekdayPages(sub, updatedSubject, null)') && !source.includes('pagesTouched') && !source.includes('toggleEditWeekday'), 'saving keeps the ratios and only re-splits pages when the deadline changes');
});

test('changing study days or the deadline rebuilds the weekday plan so the pages still add up to what remains, and short deadlines are not hand-editable', () => {
  const { buildWeekPlan, withFreshWeekPlan, formatDuration, formatDurationShort } = loadSource('utils/weekPlan.ts');
  const subject = weekSubjects()[0];
  const fresh = withFreshWeekPlan({ ...subject, scheduledWeekdays: [1, 3, 5] });
  const planned = Object.values(fresh.scheduledWeekdayPages || {}).reduce((sum, value) => sum + value, 0);
  assert.ok(planned > 0);
  assert.ok(Object.keys(fresh.scheduledWeekdayPages || {}).every(day => [1, 3, 5].includes(Number(day)) || !fresh.scheduledWeekdayPages[day]));
  const shortDeadline = { ...subject, targetDate: '2026-10-20' };
  const row = buildWeekPlan([shortDeadline], [], weekNow).rows[0];
  assert.equal(row.planEditable, false);
  assert.equal(buildWeekPlan([subject], [], weekNow).rows[0].planEditable, true);
  assert.equal(formatDuration(0), '0분');
  assert.equal(formatDuration(45), '45분');
  assert.equal(formatDuration(120), '2시간');
  assert.equal(formatDuration(134), '2시간 14분');
  assert.equal(formatDurationShort(134), '2h 14m');
  assert.equal(formatDurationShort(59), '59m');
});

test('"학습" and "필수" sit between "공부 시작" and the end date in the start cell; without a start cell they stay on the title row', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const base = { logs: [], taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', detailSubjectId: 'a',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const subject = { id: 'a', name: 'A', startPage: 1, totalPages: 60, completedPages: 10, targetDate: '2099-12-31', isRequired: true };
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { ...base, subjects: [subject] }));
  const start = html.indexOf('data-testid="cell-title"');
  const cellTitle = html.slice(start, html.indexOf('</h3>', start));
  assert.ok(cellTitle.indexOf('공부 시작') < cellTitle.indexOf('data-testid="cell-badges"'));
  const badges = cellTitle.slice(cellTitle.indexOf('data-testid="cell-badges"'));
  assert.ok(badges.indexOf('data-testid="detail-kind"') < badges.indexOf('필수'), '"학습" comes before "필수"');
  assert.equal((html.match(/data-testid="detail-kind"/g) || []).length, 1, 'the badges are not repeated on the title row');
  assert.equal((html.match(/>필수</g) || []).length, 1);
  // 칸 제목은 children → 배지 → 끝날 날짜 순서로 그린다
  const source = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  const cellTitleSource = source.slice(source.indexOf('const CellTitle'), source.indexOf('</h3>', source.indexOf('const CellTitle')));
  assert.ok(cellTitleSource.indexOf('{children}') < cellTitleSource.indexOf('cell-badges') && cellTitleSource.indexOf('cell-badges') < cellTitleSource.indexOf('data-testid="end-date"'));
  // 오늘 할 양을 끝낸 카드에는 "공부 시작" 칸이 없으니 배지가 제목 줄에 남는다
  const done = renderToStaticMarkup(React.createElement(TodaySummary, { ...base, subjects: [subject],
    logs: [{ id: 'l1', subjectId: 'a', pagesRead: 5, startPage: 11, endPage: 15, timeSpentMinutes: 25, timestamp: '2026-10-12T01:00:00.000Z', studyDate: '2026-10-12', reviewEnabled: false }],
    completedStudySubjectIds: ['a'] }));
  if (done.includes('data-testid="done-summary"')) {
    assert.ok(!done.includes('data-testid="cell-badges"') && done.includes('data-testid="detail-kind"'), 'done card keeps the badges on the title row');
  }
});

const speedLogs = (pagesList, extra = {}) => pagesList.map((pages, index) => ({
  id: `sp${index}`, subjectId: 'm', pagesRead: pages, timeSpentMinutes: 25, timeAttackMinutes: 25,
  timestamp: new Date(Date.UTC(2026, 9, 1 + index, 3, 0, 0)).toISOString(), studyDate: `2026-10-${String(1 + index).padStart(2, '0')}`, reviewEnabled: false, ...extra
}));

test('speed series: one point per 25 minutes, growth vs the previous 25 minutes, gain vs the first, acceleration = slope of the gain over study hours', () => {
  const { buildSpeedSeries, fitSlope } = loadSource('utils/speedGrowth.ts');
  assert.equal(fitSlope([1, 2, 3], [2, 4, 6]), 2);
  assert.equal(fitSlope([1], [2]), null);
  assert.equal(fitSlope([2, 2], [1, 3]), null);
  const series = buildSpeedSeries(speedLogs([4, 5, 6, 7, 8]));
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  assert.equal(series.points.length, 5);
  [9.6, 12, 14.4, 16.8, 19.2].forEach((speed, index) => near(series.points[index].speed, speed));
  near(series.points[0].gain, 0);
  near(series.points[4].gain, 9.6);
  assert.equal(series.points[0].growth, null);
  near(series.latestGrowth, 2.4);
  near(series.latestSpeed, 19.2);
  // 25분마다 속도가 2.4씩 느니까 기울기는 2.4 ÷ (25/60시간) = 5.76
  near(series.acceleration, 5.76);
  assert.equal(series.points[2].dateKey, '2026-10-03');
  near(series.points[2].hours, 75 / 60);
  // 25분이 안 되면 점이 없고, 덩어리가 둘이면 증가율은 있어도 가속도는 없다
  assert.equal(buildSpeedSeries(speedLogs([4]).map(log => ({ ...log, timeSpentMinutes: 20 }))).points.length, 0);
  const two = buildSpeedSeries(speedLogs([4, 6]));
  near(two.latestGrowth, 4.8);
  assert.equal(two.acceleration, null);
  // 한 기록이 여러 덩어리에 걸쳐도(60분 = 25 + 25 + 오래된 자투리 10) 같은 속도면 증가율 0
  const long = buildSpeedSeries([{ id: 'x', subjectId: 'm', pagesRead: 10, timeSpentMinutes: 60, timestamp: '2026-10-01T03:00:00.000Z', studyDate: '2026-10-01' }]);
  assert.equal(long.points.length, 2);
  near(long.latestSpeed, 10);
  near(long.latestGrowth, 0);
  // 기록의 순서가 뒤섞여도 시간순으로 센다
  const shuffled = buildSpeedSeries(speedLogs([4, 5, 6, 7, 8]).reverse());
  near(shuffled.latestGrowth, 2.4);
});

test('speed series with the 1-hour trend window: one point per study hour, the 25-minute default stays for everything else', () => {
  const { buildSpeedSeries, TREND_WINDOW_MINUTES } = loadSource('utils/speedGrowth.ts');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  assert.equal(TREND_WINDOW_MINUTES, 60);
  // 하루 60분씩 4, 5, 6, 7장: 시간당 4, 5, 6, 7장이고 점은 1·2·3·4시간째
  const hourly = pagesList => pagesList.map((pages, index) => ({
    id: `hr${index}`, subjectId: 'm', pagesRead: pages, timeSpentMinutes: 60, timeAttackMinutes: 50,
    timestamp: new Date(Date.UTC(2026, 9, 1 + index, 3, 0, 0)).toISOString(), studyDate: `2026-10-${String(1 + index).padStart(2, '0')}`
  }));
  const series = buildSpeedSeries(hourly([4, 5, 6, 7]), { windowMinutes: TREND_WINDOW_MINUTES });
  assert.equal(series.points.length, 4);
  assert.deepEqual(series.points.map(point => point.hours), [1, 2, 3, 4]);
  [4, 5, 6, 7].forEach((speed, index) => near(series.points[index].speed, speed));
  near(series.latestSpeed, 7);
  near(series.latestGrowth, 1);
  near(series.acceleration, 1, '1시간마다 +1P/h');
  assert.equal(series.points[2].dateKey, '2026-10-03');
  // 타임어택 기준: 50분 동안 푼 장수로 센다 → 시간당 4.8장
  const attack = buildSpeedSeries(hourly([4, 5]), { windowMinutes: TREND_WINDOW_MINUTES, timeAttack: true });
  near(attack.points[0].speed, 4.8);
  // 1시간이 안 되면 점이 없고, 두 시간이면 증가율은 있어도 가속도는 없다
  assert.equal(buildSpeedSeries(hourly([4]).map(log => ({ ...log, timeSpentMinutes: 55 })), { windowMinutes: TREND_WINDOW_MINUTES }).points.length, 0);
  const two = buildSpeedSeries(hourly([4, 6]), { windowMinutes: TREND_WINDOW_MINUTES });
  near(two.latestGrowth, 2);
  assert.equal(two.acceleration, null);
  // 25분 덩어리(기본)는 그대로: 같은 기록이 75분이면 25분 점이 3개, 1시간 점이 1개
  const logs = [{ id: 'z', subjectId: 'm', pagesRead: 15, timeSpentMinutes: 75, timestamp: '2026-10-01T03:00:00.000Z', studyDate: '2026-10-01' }];
  assert.equal(buildSpeedSeries(logs).points.length, 3);
  assert.equal(buildSpeedSeries(logs, { windowMinutes: TREND_WINDOW_MINUTES }).points.length, 1);
  assert.equal(buildSpeedSeries(logs, { windowMinutes: 0 }).points.length, 3, 'a bad window falls back to the default');
  // 추이분석은 이 1시간 덩어리를 쓰고 25분 글자는 남기지 않는다
  const history = fs.readFileSync(path.resolve(__dirname, '..', 'components/HistoryCharts.tsx'), 'utf8');
  assert.ok(history.includes('windowMinutes: TREND_WINDOW_MINUTES') && !history.includes('25분'));
});

test('completion projection: constant speed, accelerating, slowing, clamped to half/double the current speed, and unknown speed', () => {
  const { projectStudyMinutes } = loadSource('utils/speedGrowth.ts');
  const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-6, `${message} ${a} vs ${b}`);
  near(projectStudyMinutes(30, 10, 0), 180);
  near(projectStudyMinutes(30, 10, null), 180);
  assert.equal(projectStudyMinutes(0, 10, 1), 0);
  assert.equal(projectStudyMinutes(10, null, 1), null);
  assert.equal(projectStudyMinutes(10, 0, 1), null);
  // 6 P/h에서 시작해 1P를 풀 때마다 0.5P/h씩 빨라지면(페이지당 가속도) 12장은 ln((6+0.5·12)/6)/0.5 = ln2/0.5 시간
  near(projectStudyMinutes(12, 6, 0.5), (Math.log(2) / 0.5) * 60);
  assert.ok(projectStudyMinutes(100, 6, 0.5) < projectStudyMinutes(100, 6, 0));
  assert.ok(projectStudyMinutes(100, 6, -0.2) > projectStudyMinutes(100, 6, 0));
  // 지금의 2배(12 P/h)까지만 빨라진다: 1P(=(12−6)/6)를 풀면 12가 되고, 그 사이는 ln2/6 시간, 남은 999장은 12 P/h로
  near(projectStudyMinutes(1000, 6, 6), (Math.log(2) / 6 + 999 / 12) * 60);
  // 절반(3 P/h)까지만 느려진다: 0.5P를 풀면 3이 되고, 남은 999.5장은 3 P/h로
  near(projectStudyMinutes(1000, 6, -6), (Math.log(2) / 6 + 999.5 / 3) * 60, 'slow clamp');
  // 한도에 닿기 전이면 장수가 늘수록 시간이 이어서 늘어난다(남은 페이지 범위의 장수만큼 적분)
  near(projectStudyMinutes(4, 6, 0.5), (Math.log(8 / 6) / 0.5) * 60);
  assert.ok(projectStudyMinutes(8, 6, 0.5) > projectStudyMinutes(4, 6, 0.5));
});

test('subject speed analysis forecasts the current stage, its review subjects and the follow-ups, inheriting speed and acceleration for what is unmeasured', () => {
  const { analyzeSubjectSpeed, summarizeFolderSpeed, buildGroupSpeed, describeAcceleration, buildSpeedSeries } = loadSource('utils/speedGrowth.ts');
  const subjects = [
    { id: 'm', name: '수학', startPage: 1, totalPages: 100, completedPages: 40, targetDate: '2026-12-31', reviewSubjectIds: ['r'],
      followUpSubjects: [{ id: 'f', name: '심화', startPage: 101, endPage: 160, completedPage: 100 }] },
    { id: 'r', name: '오답', startPage: 1, totalPages: 20, completedPages: 5, targetDate: '2026-12-31' }
  ];
  const logs = speedLogs([4, 5, 6, 7, 8]);
  const analysis = analyzeSubjectSpeed(subjects, logs, subjects[0]);
  assert.equal(analysis.stageId, 'm');
  assert.deepEqual(analysis.forecast.map(item => `${item.kind}:${item.id}`), ['current:m', 'review:r', 'followUp:f']);
  const [current, review, followUp] = analysis.forecast;
  assert.equal(current.remainingPages, 60);
  assert.equal(current.basis, 'measured');
  assert.ok(Math.abs(current.speed - 19.2) < 1e-6 && Math.abs(current.acceleration - 9.6 / 26) < 1e-9, '페이지당 가속도 = (19.2−9.6)P/h ÷ 첫 25분 뒤에 푼 26장');
  // 재지 않은 복습과목·후행과목은 현재 과목의 속도와 가속도를 그대로 쓴다
  assert.equal(review.basis, 'inherited');
  assert.equal(followUp.basis, 'inherited');
  assert.equal(review.remainingPages, 15);
  assert.equal(followUp.remainingPages, 60);
  assert.equal(review.speed, current.speed);
  assert.equal(followUp.acceleration, current.acceleration);
  assert.ok(current.minutes > 0 && review.minutes > 0 && followUp.minutes > 0);
  assert.ok(Math.abs(analysis.totalMinutes - (current.minutes + review.minutes + followUp.minutes)) < 1e-6);
  // 기록이 없고 처음 장당 시간도 없으면 알 수 없다. 처음 장당 시간(3분 = 20 P/h)이 있으면 그 값에서 시작한다.
  const unknown = analyzeSubjectSpeed(subjects, [], subjects[0]);
  assert.equal(unknown.forecast[0].minutes, null);
  assert.equal(unknown.forecast[0].basis, 'none');
  const seeded = analyzeSubjectSpeed(subjects, [], { ...subjects[0], initialAverageTimePerPage: 3 });
  assert.equal(seeded.forecast[0].basis, 'initial');
  assert.ok(Math.abs(seeded.forecast[0].minutes - 180) < 1e-6);
  // 모두 끝난 과목은 예측이 없다
  const done = analyzeSubjectSpeed([{ ...subjects[0], completedPages: 100, followUpSubjects: [] }], logs, { ...subjects[0], completedPages: 100, followUpSubjects: [] });
  assert.equal(done.stageId, null);
  assert.equal(done.forecast.length, 0);
  // 폴더 합계 · 편차
  const folder = summarizeFolderSpeed([1, 3, null, undefined]);
  assert.equal(folder.measured, 2);
  assert.equal(folder.total, 4);
  assert.equal(folder.spread, 1);
  assert.deepEqual(summarizeFolderSpeed([]), { measured: 0, total: 0, spread: 0 });
  // 폴더(또는 과목) 하나의 선: 공부 시간(25분마다)에 따른 속도 증가. 과목 하나면 그 과목의 그래프 그대로다.
  const seriesM = buildSpeedSeries(logs);
  const seriesX = buildSpeedSeries(speedLogs([4, 8, 8]).map(log => ({ ...log, subjectId: 'x' })));
  const single = buildGroupSpeed({ id: 'm', name: '수학', isFolder: false }, [seriesM]);
  assert.deepEqual(single.points.map(point => [Math.round(point.hours * 1000) / 1000, Math.round(point.gain * 1000) / 1000]), seriesM.points.map(point => [Math.round(point.hours * 1000) / 1000, Math.round(point.gain * 1000) / 1000]));
  assert.ok(Math.abs(single.latestGrowth - 2.4) < 1e-6 && single.measured === 1 && single.isFolder === false);
  const group = buildGroupSpeed({ id: 'f', name: '시험', isFolder: true }, [seriesM, seriesX]);
  assert.deepEqual(group.points.map(point => Math.round(point.gain * 10) / 10), [0, 0, 2.4, 12, 14.4, 14.4, 16.8, 19.2], 'each 25 minutes adds the members\' current gains');
  assert.ok(Math.abs(group.points[7].hours - (8 * 25) / 60) < 1e-9, 'the folder\'s study time is every member\'s 25 minutes added up');
  assert.ok(Math.abs(group.latestGrowth - 2.4) < 1e-6 && group.measured === 2, 'latest growth = members\' latest growth added (m +2.4, x 0)');
  const empty = buildGroupSpeed({ id: 'e', name: '빈 폴더', isFolder: true }, []);
  assert.deepEqual([empty.points.length, empty.latestGrowth, empty.measured], [0, null, 0]);
  // 가속도 글자는 P/h² 이다
  assert.equal(describeAcceleration(1.14), '+1.1P/h²');
  assert.equal(describeAcceleration(null), '측정 필요');
});

test('sibling order: folders first until an order is set, then the saved order; inserting renumbers every sibling; stale parents are unordered', () => {
  const { orderSiblings, insertSiblingOrder, andParticle, joinWithAnd, ROOT_LIST_KEY } = loadSource('utils/listOrder.ts');
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  assert.deepEqual(orderSiblings([a, b, c], ROOT_LIST_KEY).map(x => x.id), ['a', 'b', 'c'], 'nothing ordered keeps the given order');
  const ordered = [{ id: 'a', listOrder: { parentId: 't1', index: 2 } }, { id: 'b', listOrder: { parentId: 't1', index: 0 } }, { id: 'c' }];
  assert.deepEqual(orderSiblings(ordered, 't1').map(x => x.id), ['b', 'a', 'c'], 'ordered first, unordered after');
  assert.deepEqual(orderSiblings(ordered, 't9').map(x => x.id), ['a', 'b', 'c'], 'another parent means unordered');
  const inserted = insertSiblingOrder([{ kind: 'folder', id: 'f1' }, { kind: 'subject', id: 's1' }, { kind: 'subject', id: 's2' }], 1, 't1', { kind: 'folder', id: 'new' });
  assert.deepEqual(inserted.map(item => `${item.id}:${item.listOrder.index}`), ['f1:0', 'new:1', 's1:2', 's2:3']);
  assert.ok(inserted.every(item => item.listOrder.parentId === 't1'));
  assert.deepEqual(insertSiblingOrder([{ kind: 'folder', id: 'f1' }], 99, ROOT_LIST_KEY, { kind: 'subject', id: 'x' }).map(item => item.id), ['f1', 'x'], 'past the end appends');
  // 와/과: 한글 받침, 숫자, 영문 끝 글자
  assert.equal(andParticle('영어 독해'), '와');
  assert.equal(andParticle('시험'), '과');
  assert.equal(andParticle('수학 기출'), '과');
  assert.equal(andParticle('토익 LC'), '와');
  assert.equal(andParticle('영어 1'), '과');
  assert.equal(andParticle('영어 2'), '와');
  assert.equal(joinWithAnd('시험', '자격증'), '시험과 자격증');
});

test('speed panels: percent inside every ratio bar, progress bar, a folder total chart, forecast as one combined total, speed facts (P/h²) and the between-items buttons', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const panels = loadSource('components/SpeedPanels.tsx');
  const { buildSpeedSeries, buildGroupSpeed } = loadSource('utils/speedGrowth.ts');

  // 퍼센트: 합이 100, 0보다 크면 최소 1, 합이 0이면 모두 0
  assert.deepEqual(panels.sharePercents([60, 30, 0, 30]), [50, 25, 0, 25]);
  assert.equal(panels.sharePercents([1, 1, 1]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(panels.sharePercents([1, 1000]).map(v => v > 0), [true, true]);
  assert.equal(panels.sharePercents([1, 1000])[0], 1);
  assert.deepEqual(panels.sharePercents([0, 0]), [0, 0]);
  // 글자색: 어두운 칸엔 흰 글자, 밝은 칸엔 짙은 글자
  assert.equal(panels.readableOn('#2a78d6'), '#ffffff');
  assert.equal(panels.readableOn('#eda100'), '#0f172a');

  const week = renderToStaticMarkup(React.createElement(panels.WeekdayNeedBar, { days: [
    { weekday: 1, label: '월', minutes: 60 }, { weekday: 2, label: '화', minutes: 30 }, { weekday: 3, label: '수', minutes: 0 }, { weekday: 4, label: '목', minutes: 30, isToday: true }] }));
  assert.equal((week.match(/data-testid="weekday-segment"/g) || []).length, 3, 'only study days get a segment');
  assert.ok(week.includes('data-testid="week-total"') && week.includes('한 주 필요 시간') && week.includes('>2h 0m<'), 'the weekly total sits above the bar');
  assert.ok(week.indexOf('week-total') < week.indexOf('weekday-segment'), 'total, then bar');
  assert.ok(week.includes('>1h 0m<') && (week.match(/>30m</g) || []).length === 2, 'each study day shows its time inside its segment, not a percent');
  assert.equal((week.match(/data-testid="weekday-time"/g) || []).length, 3);
  assert.ok(!week.includes('weekday-percent') && !/>\d+%</.test(week), 'no percent text in the weekday bar: the segment widths already show the ratio');
  assert.ok(week.includes('title="월요일 1h 0m · 50%"'), 'the percent stays in the hover title');
  const firstSegment = week.slice(week.indexOf('data-testid="weekday-segment"'), week.indexOf('data-testid="weekday-segment"', week.indexOf('data-testid="weekday-segment"') + 10));
  assert.ok(firstSegment.includes('>월<') && firstSegment.includes('>1h 0m<'), 'weekday letter and time are in the same segment');
  assert.ok(week.includes('data-testid="weekday-rest"') && week.includes('쉬는 요일 수'), 'rest days are named under the bar');
  assert.ok(week.includes('flex-grow:60') && week.includes('flex-grow:30'), 'segment widths follow the minutes');
  assert.ok(renderToStaticMarkup(React.createElement(panels.WeekdayNeedBar, { days: [{ weekday: 1, label: '월', minutes: 0 }] })).includes('학습 요일 없음'));

  const share = renderToStaticMarkup(React.createElement(panels.ShareBar, { items: [
    { id: 'a', name: '수학', minutes: 60 }, { id: 'b', name: '영어', minutes: 20, isFolder: true }, { id: 'c', name: '쉬는 과목', minutes: 0 }] }));
  assert.equal((share.match(/data-testid="ratio-segment"/g) || []).length, 2, 'zero-minute items have no segment but stay in the legend');
  const segments = share.slice(share.indexOf('data-testid="share-bar"'), share.indexOf('<ul'));
  assert.ok(segments.includes('>75%<') && segments.includes('>25%<'), 'the percent is inside the segment, not only in the legend');
  assert.ok(share.includes('📂 영어') && share.includes('쉬는 과목'));
  assert.ok(renderToStaticMarkup(React.createElement(panels.ShareBar, { items: [] })).includes('아직 들어간 과목이 없어요'));
  assert.ok(renderToStaticMarkup(React.createElement(panels.ShareBar, { items: [{ id: 'a', name: '수학', minutes: 0 }] })).includes('비율이 없어요'));

  // 진척도 막대: % 가 막대 안. 채움이 넓으면 채움 안쪽(흰 글자), 좁으면 채움 바로 옆
  const wide = renderToStaticMarkup(React.createElement(panels.ProgressBar, { percent: 62 }));
  assert.ok(wide.includes('role="progressbar"') && wide.includes('aria-valuenow="62"') && wide.includes('>62%<') && wide.includes('text-white') && wide.includes('right:calc(38% + 0.5rem)'));
  const narrow = renderToStaticMarkup(React.createElement(panels.ProgressBar, { percent: 9 }));
  assert.ok(narrow.includes('>9%<') && narrow.includes('text-slate-700') && narrow.includes('left:calc(9% + 0.5rem)'));
  assert.ok(renderToStaticMarkup(React.createElement(panels.ProgressBar, { percent: 150 })).includes('aria-valuenow="100"'));

  // 예측: 모두 합친 "남은 장수"·"예상 시간" 두 숫자뿐(과목별 막대·범례·목록 없음). 과목별 내용은 ▶ 전체 과목 목록에 있다
  const series = buildSpeedSeries(speedLogs([4, 5, 6, 7, 8]));
  const forecast = renderToStaticMarkup(React.createElement(panels.ForecastList, { totalMinutes: 150, items: [
    { kind: 'current', id: 'm', name: '수학', remainingPages: 60, minutes: 90, basis: 'measured', speed: 20, acceleration: 2 },
    { kind: 'review', id: 'r', name: '오답', remainingPages: 15, minutes: 30, basis: 'inherited', speed: 20, acceleration: 2 },
    { kind: 'followUp', id: 'f', name: '심화', remainingPages: 25, minutes: 30, basis: 'none', speed: 0, acceleration: 0 }] }));
  assert.ok(!forecast.includes('forecast-pages') && !forecast.includes('forecast-time-bar') && !forecast.includes('forecast-groups') && !forecast.includes('forecast-row') && !forecast.includes('ratio-segment') && !forecast.includes('<ul'),
    'no per-subject ratio bars, legend or list: only the combined totals');
  assert.ok(!forecast.includes('수학') && !forecast.includes('오답') && !forecast.includes('심화') && !forecast.includes('복습') && !forecast.includes('후행'), 'no subject names in the forecast area');
  assert.ok(/data-testid="forecast-total-pages"[^>]*>100P</.test(forecast) && /data-testid="forecast-total"[^>]*>2시간 30분</.test(forecast), 'current + review + follow-up are added together');
  assert.ok(forecast.indexOf('남은 장수') < forecast.indexOf('예상 시간'), 'pages, then time');
  assert.ok(!forecast.includes('끝까지 걸리는 시간 예측'), 'no heading above the totals: 남은 장수 // 예상 시간 say it already');
  assert.equal(renderToStaticMarkup(React.createElement(panels.ForecastList, { totalMinutes: 0, items: [] })), '');
  assert.ok(/>-?\d*P?</.test(forecast) && renderToStaticMarkup(React.createElement(panels.ForecastList, { totalMinutes: 0, label: '회', items: [
    { kind: 'current', id: 'm', name: '수학', remainingPages: 10, minutes: null, basis: 'none', speed: 0, acceleration: 0 }] })).includes('>10회<'), 'the page label follows the subject');
  // 재지 않은 과목만 이름 옆에 무엇으로 예측했는지 적는다(전체 과목 목록에서)
  assert.equal(panels.describeForecastBasis('measured'), null);
  assert.equal(panels.describeForecastBasis('inherited'), '측정 안 됨 · 현재 과목으로 예측');
  assert.equal(panels.describeForecastBasis('initial'), '측정 안 됨 · 처음 장당 시간으로 계산');
  assert.equal(panels.describeForecastBasis('none'), '측정 안 됨 · 속도를 재면 예측해요');
  const panelSource = fs.readFileSync(path.resolve(__dirname, '..', 'components/SpeedPanels.tsx'), 'utf8');
  assert.ok(!panelSource.includes('forecast-groups') && !panelSource.includes('columnWeights') && !panelSource.includes('forecast-row'), 'the legend grid and the per-subject rows are gone');

  const facts = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series }));
  assert.ok(facts.includes('속도 증가율 · 최근') && facts.includes('페이지당 가속도') && facts.includes('+0.37') && facts.includes('P/h씩 · 1P 풀 때마다') && facts.includes('+2.4P/h'));
  assert.ok(!facts.includes('학습시간 가속도') && !facts.includes('P/h²'), '학습 설정은 시간이 아니라 페이지당 가속도(P/h per P)를 보여 준다');
  assert.ok(renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series: buildSpeedSeries([]) })).includes('측정 필요'));
  // 세부 설명 줄은 없다(튜토리얼로 옮김): 가속도 밑 설명, 그래프 위 값 줄, 범례 괄호
  assert.ok(!facts.includes('이만큼') && !facts.includes('달라져요') && !renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series: buildSpeedSeries([]) })).includes('세 번 쌓이면'), 'no sentence under the acceleration value');
  const chart = renderToStaticMarkup(React.createElement(panels.SpeedGainChart, { series }));
  assert.ok(chart.includes('data-testid="speed-chart"') && chart.includes('추세선'));
  assert.ok(!chart.includes('speed-readout') && !chart.includes('25분마다') && !chart.includes('기울기 ='), 'no value line above the graph and no parenthesis notes in the legend');
  // 가로축은 공부 시간이 아니라 페이지 위치: 기록에 페이지 범위가 없으면 푼 장수의 합(12P), 범위가 있으면 p.숫자
  assert.ok(/<title>[\d.]+P 푼 뒤 · 속도 [\d.]+P\/h · 첫 25분보다 [+−-][\d.]+P\/h<\/title>/.test(chart), 'each dot keeps its values as a hover title');
  assert.ok(!chart.includes('시간째') && !chart.includes('시간</text>') && chart.includes('<polyline data-testid="speed-trend"'), 'no study hours on the x axis; the trend is read at each dot');
  const placed = buildSpeedSeries(speedLogs([4, 5, 6, 7, 8]).map((log, index) => ({ ...log, startPage: 10 * index + 1, endPage: 10 * index + 10 })));
  const placedChart = renderToStaticMarkup(React.createElement(panels.SpeedGainChart, { series: placed }));
  assert.ok(/<title>p\.50 · 속도 [\d.]+P\/h/.test(placedChart) && placedChart.includes('>p.10</text>') && placedChart.includes('>p.50</text>') && placedChart.includes('페이지 위치에 따른 속도 증가'), 'page position on the x axis');
  assert.ok(!placedChart.includes('시간째') && !placedChart.includes('시간</text>'));
  assert.ok(renderToStaticMarkup(React.createElement(panels.SpeedGainChart, { series: buildSpeedSeries(speedLogs([4])) })).includes('두 번 이상'));

  // 폴더 그래프: 폴더 전체의 합계 한 줄. 그 밑에 바로 아래 항목의 최근 속도 증가율 목록
  const seriesX = buildSpeedSeries(speedLogs([4, 8, 8]).map(log => ({ ...log, subjectId: 'x' })));
  const total = buildGroupSpeed({ id: 'f', name: '시험 합계', isFolder: true }, [series, seriesX]);
  const items = [
    { ...buildGroupSpeed({ id: 'm', name: '수학 영역', isFolder: true }, [series]), colorIndex: 0 },
    { ...buildGroupSpeed({ id: 'x', name: '영어 독해', isFolder: false }, [seriesX]), colorIndex: 1 },
    { ...buildGroupSpeed({ id: 'n', name: '토익 LC', isFolder: false }, []), colorIndex: 2 }];
  const folderChart = renderToStaticMarkup(React.createElement(panels.FolderSpeedChart, { total, items }));
  assert.equal((folderChart.match(/data-testid="group-speed-line"/g) || []).length, 1, 'one line: the folder total');
  assert.ok(folderChart.includes('속도 증가 합계') && folderChart.includes('합계 +19.2P/h') && !folderChart.includes('시간</text>') && /\d+(\.\d)?P<\/text>/.test(folderChart), 'several subjects mixed: pages solved so far, not a page position');
  assert.ok(!folderChart.includes('speed-readout') && !folderChart.includes('바로 아래 항목') && !/>[^<]*공부 시간에 따른/.test(folderChart), 'no value line and no caption above the folder graph or its list');
  assert.ok(/<title>[\d.]+P 푼 뒤 · 합계 \+19\.2P\/h<\/title>/.test(folderChart), 'the folder total keeps its value as a hover title');
  assert.equal((folderChart.match(/data-testid="group-speed-row"/g) || []).length, 3, 'every child is in the list');
  assert.ok(folderChart.includes('📂 수학 영역') && folderChart.includes('+2.4P/h') && folderChart.includes('측정 필요'));
  const lonely = renderToStaticMarkup(React.createElement(panels.FolderSpeedChart, { total: buildGroupSpeed({ id: 'e', name: '빈 폴더 합계', isFolder: true }, []), items: [] }));
  assert.ok(lonely.includes('두 번 이상') && !lonely.includes('group-speed-list'));

  // 요일 버튼: 평균 + 월~일, 누른 것만 aria-pressed. 요일을 고르면 그 요일의 비율을 보여 준다
  const days = [1, 2, 3, 4, 5, 6, 0].map((id, index) => ({ id, label: '월화수목금토일'[index] }));
  const pickerAvg = renderToStaticMarkup(React.createElement(panels.WeekdayPicker, { value: null, days, onChange() {} }));
  assert.equal((pickerAvg.match(/<button/g) || []).length, 8, '평균 + 7 days');
  assert.ok(pickerAvg.includes('data-testid="weekday-picker"') && pickerAvg.indexOf('>평균<') < pickerAvg.indexOf('>월<') && pickerAvg.indexOf('>월<') < pickerAvg.indexOf('>일<'));
  assert.equal((pickerAvg.match(/aria-pressed="true"/g) || []).length, 1, 'only 평균 is pressed by default');
  const pickerDay = renderToStaticMarkup(React.createElement(panels.WeekdayPicker, { value: 3, days, todayWeekday: 6, onChange() {} }));
  assert.ok(/aria-pressed="true"[^>]*aria-label="수요일 비율 보기"/.test(pickerDay) && (pickerDay.match(/aria-pressed="true"/g) || []).length === 1, 'the chosen weekday is the pressed one');
  assert.ok(pickerDay.includes('ring-amber-300'), "today's weekday is marked");
  assert.ok(renderToStaticMarkup(React.createElement(panels.ShareBar, { items: [{ id: 'a', name: '수학', minutes: 0 }], emptyNote: '월요일에는 공부하는 과목이 없어요' })).includes('월요일에는 공부하는 과목이 없어요'));

  const closed = renderToStaticMarkup(React.createElement(panels.InsertGap, { open: false, onToggle() {}, onAddPlan() {}, onAddFolder() {}, label: '시험과 자격증 사이에 추가' }));
  assert.ok(closed.includes('aria-label="시험과 자격증 사이에 추가"') && !closed.includes('새 학습 계획 추가') && !closed.includes('새 분석 그룹 추가'));
  const open = renderToStaticMarkup(React.createElement(panels.InsertGap, { open: true, onToggle() {}, onAddPlan() {}, onAddFolder() {} }));
  assert.ok(open.includes('새 학습 계획 추가') && open.includes('새 분석 그룹 추가') && open.includes('data-testid="gap-add-plan"') && open.includes('data-testid="gap-add-folder"'));
  const always = renderToStaticMarkup(React.createElement(panels.InsertGap, { open: false, alwaysOpen: true, onToggle() {}, onAddPlan() {}, onAddFolder() {} }));
  assert.ok(always.includes('새 분석 그룹 추가') && !always.includes('aria-expanded'), 'an empty list shows the two buttons without a strip to open');
});

test('"과목·폴더 관리" folders: 필요 시간 + share bar, then the speed row (sum/spread of the children) with a › graph, then 전체 진행률 at the very bottom', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { Analytics } = loadSource('components/Analytics.tsx');
  const mk = (id, name, extra = {}) => ({ id, name, createdAt: '2026-09-01T00:00:00.000Z', planResetDate: '2026-09-01', startPage: 1, totalPages: 100, completedPages: 30,
    targetDate: '2026-12-31', isRequired: false, scheduledWeekdays: [0, 1, 2, 3, 4, 5, 6], growthPageUnit: 10, pageLabel: 'P', tagIds: ['t1'], ...extra });
  const subjects = [mk('m', '수학 기출'), mk('e', '영어 독해', { completedPages: 10 }), mk('x', '독서', { tagIds: [] })];
  const logs = [...speedLogs([4, 5, 6, 7, 8]), ...speedLogs([3, 3, 4, 4, 5], { subjectId: 'e' }).map(log => ({ ...log, id: `e-${log.id}` }))];
  const tags = [{ id: 't1', name: '시험', color: '#6366f1', isVisible: true }];
  const props = { subjects, logs, tagDefinitions: tags, activeWeekday: 1, activeStudyDate: '2026-10-12',
    onActiveWeekdayChange() {}, onUpdateSubject() {}, onUpdateSubjects() {}, onDeleteSubject() {}, onUpdateTags() {}, onAddSubject() {}, onDeleteFolder() {} };
  const html = renderToStaticMarkup(React.createElement(Analytics, props));
  assert.ok(html.includes('data-testid="share-bar"') && html.includes('하루 평균 시간 비율') && html.includes('하루 평균 시간'));
  // 폴더 카드에는 요일 버튼이 없다: 요일 버튼은 맨 위 요약(하루 단위)에만 있다
  const firstFolderAt = html.indexOf('group/folder');
  assert.ok(firstFolderAt > 0 && html.indexOf('data-testid="plan-summary"') >= 0 && html.indexOf('data-testid="plan-summary"') < firstFolderAt, 'the summary sits above the folder/subject list');
  assert.equal((html.match(/data-testid="weekday-picker"/g) || []).length, 1, 'only the summary has weekday buttons');
  assert.ok(!html.slice(firstFolderAt).includes('data-testid="weekday-picker"'), 'no weekday buttons inside the folder card');
  const folderSource = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(!folderSource.includes('shareWeekdayByFolder') && !folderSource.includes('<WeekdayPicker') && folderSource.includes('getChildShareItems(folder.id, planUnit, summaryWeekday)'), 'no weekday buttons of its own: the folder bar follows the unit chosen in the summary');
  assert.ok(html.includes('data-testid="folder-speed"') && html.includes('data-testid="folder-speed-total"') && html.includes('data-testid="folder-speed-spread"'));
  assert.ok(html.includes('속도 증가율 합계 · 하루 평균') && html.includes('편차 · 2개 항목') && html.includes('전체 진행률'), 'the folder speed row follows the chosen unit (하루 평균 by default)');
  assert.ok(html.includes('시험 속도 증가 그래프 펼치기'), 'the › button opens the graph');
  assert.ok(!html.includes('data-testid="folder-speed-chart"') && !html.includes('data-testid="group-speed-list"'), 'graph and per-child list stay hidden until ›');
  assert.ok(html.indexOf('data-testid="share-bar"') < html.indexOf('data-testid="folder-speed"') && html.indexOf('data-testid="folder-speed"') < html.indexOf('data-testid="folder-progress"'), '전체 진행률 is last in the folder card');
  assert.ok(html.includes('data-testid="folder-progress"') && html.includes('전체 진행률') && html.includes('role="progressbar"') && /data-testid="progress-percent"[^>]*>\d+%</.test(html), 'the folder progress % is inside its bar');
  assert.ok(!html.includes('전체 진행률 ') || !/전체 진행률 \d+%/.test(html), 'the % moved from the label into the bar');
  ['평균 효율', '표준편차', '잔여(P)'].forEach(label => assert.ok(!html.slice(firstFolderAt).includes(label), `old folder value ${label} is gone (the summary above has its own 표준편차)`));
  assert.ok(!/>권장</.test(html), 'old folder value 권장 is gone');
  // 띠: 항목 사이, 그리고 맨 앞과 맨 뒤. 위의 새 분석 그룹 버튼과 오른쪽 계획 패널은 없다.
  assert.ok(html.includes('aria-label="시험과 독서 사이에 추가"') && html.includes('aria-label="시험 앞에 추가"') && html.includes('aria-label="독서 뒤에 추가"'));
  assert.ok(!html.includes('새 분석 그룹 추가') && !html.includes('새 학습 계획 추가'), 'nothing is open by default, and no fixed add button');
  const emptyHtml = renderToStaticMarkup(React.createElement(Analytics, { ...props, subjects: [], logs: [], tagDefinitions: [] }));
  assert.ok(emptyHtml.includes('새 분석 그룹 추가') && emptyHtml.includes('새 학습 계획 추가'), 'with nothing yet, both add buttons are shown right away');
});

test('"과목·폴더 관리" subjects: weekday need in % under the weekly total, 하루 평균 시간·페이지 below, speed growth and acceleration (P/h²), graph and forecast behind ›; 누적 시간 and 효율 are gone', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { Analytics } = loadSource('components/Analytics.tsx');
  const mk = (id, name, extra = {}) => ({ id, name, createdAt: '2026-09-01T00:00:00.000Z', planResetDate: '2026-09-01', startPage: 1, totalPages: 100, completedPages: 30,
    targetDate: '2026-12-31', isRequired: false, scheduledWeekdays: [1, 2, 3, 4, 5], growthPageUnit: 10, pageLabel: 'P', tagIds: [], ...extra });
  const props = { subjects: [mk('m', '수학 기출')], logs: speedLogs([4, 5, 6, 7, 8]), tagDefinitions: [], activeWeekday: 1, activeStudyDate: '2026-10-12',
    onActiveWeekdayChange() {}, onUpdateSubject() {}, onUpdateSubjects() {}, onDeleteSubject() {}, onUpdateTags() {}, onAddSubject() {}, onDeleteFolder() {} };
  const html = renderToStaticMarkup(React.createElement(Analytics, props));
  const need = html.indexOf('data-testid="subject-need"');
  assert.ok(need > 0);
  const order = ['data-testid="weekday-need"', '하루 평균 시간', '하루 평균 페이지', '전체 효율', 'data-testid="subject-speed"', 'data-testid="subject-progress"'].map(text => html.indexOf(text, need));
  assert.ok(order.every(index => index > 0) && order.every((index, position) => position === 0 || index > order[position - 1]), `order: ${order.join(',')}`);
  // 한 주 필요 시간 막대는 과목 카드에(시간 비율 막대 바로 아래, 시간·페이지 칸 위). 복습과목이 없으면 시간 비율 막대는 없다.
  const card = html.slice(need);
  assert.ok(card.includes('한 주 필요 시간') && card.includes('data-testid="week-total"') && card.includes('data-testid="weekday-segment"'), 'the weekly need bar is on the subject card');
  assert.ok(!card.includes('data-testid="subject-share"'), 'no review subject, no share bar');
  const progress = html.slice(html.indexOf('data-testid="subject-progress"'));
  assert.ok(progress.includes('학습 진척도') && progress.includes('role="progressbar"') && /data-testid="progress-percent"[^>]*>\d+%</.test(progress) && !/학습 진척도[^<]*\d+%/.test(progress), 'progress is the last block of the card, its % is inside the bar');
  assert.ok(!html.includes('누적 시간') && !html.includes('>효율<'), 'cumulative time and the old efficiency box are removed');
  assert.ok(html.includes('>전체 효율<') && !html.includes('타임어택 효율'), 'the subject card shows only the overall efficiency, next to the daily averages');
  assert.ok(html.includes('속도 증가율 · 하루 평균') && html.includes('페이지당 가속도') && html.includes('P/h씩 · 1P 풀 때마다'), 'the subject growth box follows the chosen unit');
  assert.ok(html.includes('속도 그래프와 예측 펼치기') && !html.includes('data-testid="speed-chart"') && !html.includes('data-testid="forecast"'), 'graph and forecast stay behind ›');
  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(source.includes('data-testid="subject-speed-detail"') && source.includes('<SpeedGainChart') && source.includes('<ForecastList') && source.includes('setSpeedOpenSubjectIds'));
  assert.ok(source.indexOf('<SpeedGainChart series={speed.series}') > source.indexOf('speedOpen && ('), 'chart and forecast are inside the opened part');
  assert.ok(source.includes('<InsertGap') && source.includes('addFolderAt') && source.includes('addPlanAt') && source.includes('<SubjectPlanner onAddSubject={addPlanAt}'));
  const planner = fs.readFileSync(path.resolve(__dirname, '../components/SubjectPlanner.tsx'), 'utf8');
  assert.ok(planner.includes('시작 페이지') && planner.includes('끝 페이지') && !planner.includes('시작단원') && !planner.includes('끝 단원') && !planner.includes('시작 단원') && !planner.includes('끝단원'));
});

test('card = current stage + its review subjects: title [+names], combined speed/efficiency on time-attack, week need added up; each subject alone behind › in the 전체 과목 list', () => {
  const { buildSpeedSeries, analyzeSubjectSpeed } = loadSource('utils/speedGrowth.ts');
  const { buildReviewWeekCells, mergeWeekCells } = loadSource('utils/weekPlan.ts');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  const mk = (id, name, extra = {}) => ({ id, name, createdAt: '2026-09-01T00:00:00.000Z', planResetDate: '2026-09-01', startPage: 1, totalPages: 100, completedPages: 30,
    targetDate: '2026-12-31', isRequired: false, scheduledWeekdays: [1, 2, 3, 4, 5], growthPageUnit: 10, pageLabel: 'P', tagIds: [], ...extra });
  const subjects = [mk('m', '수학 기출', { reviewSubjectIds: ['r'] }), mk('r', '기출 오답', { totalPages: 20, completedPages: 5, scheduledWeekdays: [1, 3] })];
  // 정리 시간(5분)이 섞인 25분: 타임어택은 20분
  const study = speedLogs([4, 5, 6, 7, 8], { timeAttackMinutes: 20 });
  const reviewLogs = [7, 8, 9].map((pages, index) => ({ id: `rv${index}`, subjectId: 'r', reviewParentSubjectId: 'm', pagesRead: pages, timeSpentMinutes: 25, timeAttackMinutes: 20,
    timestamp: new Date(Date.UTC(2026, 9, 6 + index, 3, 0, 0)).toISOString(), studyDate: `2026-10-${String(6 + index).padStart(2, '0')}`, reviewEnabled: false }));
  const logs = [...study, ...reviewLogs];

  // 속도는 타임어택 기준: 4쪽 / 타임어택 20분 = 12 P/h (전체 시간 기준이면 9.6)
  near(buildSpeedSeries(study, { timeAttack: true }).points[0].speed, 12);
  near(buildSpeedSeries(study).points[0].speed, 9.6);
  // 타임어택 기록이 없으면 전체 시간으로
  near(buildSpeedSeries(speedLogs([4]).map(log => ({ ...log, timeAttackMinutes: undefined })), { timeAttack: true }).points[0].speed, 9.6);

  const analysis = analyzeSubjectSpeed(subjects, logs, subjects[0]);
  assert.equal(analysis.own.series.points.length, 5, 'the current stage alone: its own five 25-minute chunks');
  assert.equal(analysis.reviews.r.series.points.length, 3, 'the review subject alone');
  assert.equal(analysis.series.points.length, 8, 'the card: current + review in one stream of 25-minute chunks');
  near(analysis.own.series.points[4].speed, 24);       // 8쪽 / 20분
  near(analysis.reviews.r.series.points[2].speed, 27); // 9쪽 / 20분
  near(analysis.series.points[7].speed, 27);
  near(analysis.own.efficiency, 2.5);                  // 20분 / 8쪽
  near(analysis.reviews.r.efficiency, 20 / 9);
  near(analysis.efficiency, 20 / 9);                   // 합친 기록의 가장 최근 25분
  // 예측은 그대로 전체 시간 기준(필요 시간과 같은 눈금)이라 타임어택으로 바뀌지 않는다
  const forecastCurrent = analysis.forecast.find(item => item.kind === 'current');
  near(forecastCurrent.speed, 19.2);
  assert.equal(analysis.forecast.find(item => item.kind === 'review').basis, 'measured');
  // 복습과목이 없으면 합친 값 = 현재 과목 값
  const alone = analyzeSubjectSpeed([{ ...subjects[0], reviewSubjectIds: [] }], study, { ...subjects[0], reviewSubjectIds: [] });
  assert.equal(alone.series.points.length, 5);
  near(alone.efficiency, alone.own.efficiency);

  // 요일별 필요량: 복습과목의 남은 양을 그 과목 요일로 나눠 현재 과목 칸에 더한다
  const now = new Date('2026-10-12T12:00:00+09:00');
  const reviewCells = buildReviewWeekCells(logs, subjects[0], subjects[1], 3.3, now);
  assert.deepEqual(Object.keys(reviewCells).map(Number).sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(reviewCells[1].pages > 0 && reviewCells[3].pages > 0 && reviewCells[2].pages === 0 && reviewCells[0].pages === 0, 'only the review subject\'s own weekdays have pages');
  near(reviewCells[1].minutes, Math.round(reviewCells[1].pages * (25 / 9) * 10) / 10 + 0 * 1);
  const unmeasured = buildReviewWeekCells([], subjects[0], subjects[1], 3.3, now);
  near(unmeasured[1].minutes, Math.round(unmeasured[1].pages * 3.3 * 10) / 10);
  const merged = mergeWeekCells([unmeasured, reviewCells]);
  assert.equal(merged[1].pages, unmeasured[1].pages + reviewCells[1].pages);
  near(merged[1].minutes, Math.round((unmeasured[1].minutes + reviewCells[1].minutes) * 10) / 10);

  // 화면: 제목에 [+복습과목들], 예측 영역엔 과목별 줄이 없고, 전체 과목 목록의 과목마다 이름 왼쪽 ›
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { Analytics } = loadSource('components/Analytics.tsx');
  const props = { subjects, logs, tagDefinitions: [], activeWeekday: 1, activeStudyDate: '2026-10-12',
    onActiveWeekdayChange() {}, onUpdateSubject() {}, onUpdateSubjects() {}, onDeleteSubject() {}, onUpdateTags() {}, onAddSubject() {}, onDeleteFolder() {} };
  const html = renderToStaticMarkup(React.createElement(Analytics, props));
  assert.ok(html.includes('data-testid="subject-title-reviews"') && html.includes('[+기출 오답]'), 'title: current subject [+ review names]');
  assert.ok(html.indexOf('수학 기출') < html.indexOf('[+기출 오답]'));
  const noReview = renderToStaticMarkup(React.createElement(Analytics, { ...props, subjects: [{ ...subjects[0], reviewSubjectIds: [] }], logs: study }));
  assert.ok(!noReview.includes('subject-title-reviews') && noReview.includes('수학 기출'), 'no review subject, no bracket');
  assert.ok(!html.includes('row-values') && !html.includes('data-testid="forecast-row"'), 'nothing per-subject is open by default');
  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.equal((source.match(/data-testid="row-values-toggle"/g) || []).length, 2, 'one › for the current stage, one for each review subject');
  const toggleAt = [...source.matchAll(/data-testid="row-values-toggle"/g)].map(match => match.index);
  assert.ok(toggleAt[0] < source.indexOf('{stage.name}</h5>'), 'the stage › sits to the left of the name');
  assert.ok(toggleAt[1] < source.indexOf('{reviewSubject.name}</p>'), 'the review › sits to the left of the name');
  assert.ok(source.includes('describeForecastBasis(stageForecast.basis)') && source.includes('describeForecastBasis(reviewForecast.basis)'), 'unmeasured subjects say how they were predicted next to their name');
  assert.ok(source.includes('isCurrentStage && !isInlineEditing && (') && source.includes('weekNeed.own[sub.id]') && source.includes('speedOfSubject?.own') && source.includes('weekNeed.reviews[reviewValueKey]') && source.includes('speedOfSubject?.reviews[reviewSubject.id]'), 'the opened rows show that one subject\'s own values');
  assert.ok(source.includes("combined[row.subject.id] = toDays(mergeWeekCells([row.cells, ...working.map(item => item.cells)]))") && source.includes('const weekNeedBySubject = weekNeed.combined'), 'week need on the card (and in the summary) is current + review subjects');
  assert.ok(source.includes('speedOfSubject?.efficiency'), 'the efficiency box shows the combined time-attack efficiency');
});

test('page unit review registration: a subject with a page unit keeps its sessions waiting until the user presses "복습에 넣기"', () => {
  const { applyUnitReviewRegistration, registerPendingReviews, getPendingReviewLogs, INITIAL_REVIEW_DELAY_MS } = loadSource('utils/review.ts');
  const now = Date.parse('2026-10-18T03:00:00.000Z');
  const dueAt = new Date(now + INITIAL_REVIEW_DELAY_MS).toISOString();
  const subject = { id: 'm', name: '수학', startPage: 1, totalPages: 100, completedPages: 4, targetDate: '2026-12-31', growthPageUnit: 8 };
  // 저장 흐름(App.handleLogSession)이 만드는 모양: 복습 포함이면 reviewEnabled true + 2시간 뒤
  const session = (id, startPage, endPage, extra = {}) => ({ id, subjectId: 'm', pagesRead: endPage - startPage + 1, startPage, endPage, timeSpentMinutes: 20,
    timestamp: '2026-10-18T02:00:00.000Z', isReviewed: false, reviewStep: 0, nextReviewDate: '2026-10-18T05:00:00.000Z', isCondensed: false, reviewEnabled: true, reviewMemo: `${id} 노트`, ...extra });
  const save = (logs, log, subj = subject) => { const result = applyUnitReviewRegistration(subj, logs, log, now); return { result, logs: [...result.logs, result.incoming] }; };
  const byId = (logs, id) => logs.find(log => log.id === id);

  // 1~4쪽 세션: 복습은 대기, 노트는 그대로
  let state = save([], session('a', 1, 4));
  const waiting = byId(state.logs, 'a');
  assert.equal(waiting.unitReviewPending, true);
  assert.equal(waiting.reviewEnabled, false); assert.equal(waiting.isCondensed, true);
  assert.equal(waiting.nextReviewDate, undefined, 'no review is scheduled yet');
  assert.equal(waiting.reviewMemo, 'a 노트', 'the note stays');
  // 단위(8쪽)의 끝 페이지에 닿아도, 단위를 넘어도 자동으로 복습에 들어가지 않는다: 계속 대기
  state = save(state.logs, session('b', 5, 8));
  assert.deepEqual(state.result.units, []);
  state = save(state.logs, session('c', 9, 20));
  assert.deepEqual(state.result.units, []);
  assert.deepEqual(getPendingReviewLogs(state.logs, 'm').map(log => log.id), ['a', 'b', 'c']);
  assert.ok(state.logs.every(log => log.unitReviewPending && !log.nextReviewDate && log.reviewEnabled === false));

  // "복습에 넣기": 쌓인 대기 기록이 한꺼번에 등록된다(2시간 뒤가 첫 복습), 노트는 새 복습의 재료다
  const other = { ...session('o', 1, 4), subjectId: 'other', unitReviewPending: true, reviewEnabled: false, isCondensed: true, nextReviewDate: undefined };
  const done = { ...session('d', 21, 22), reviewStep: 2, nextReviewDate: '2026-11-01T00:00:00.000Z' };
  const registered = registerPendingReviews('m', [...state.logs, other, done], now);
  assert.deepEqual(registered.logIds, ['a', 'b', 'c']);
  assert.deepEqual(registered.range, { start: 1, end: 20 });
  ['a', 'b', 'c'].forEach(id => {
    const log = byId(registered.logs, id);
    assert.equal(log.reviewEnabled, true); assert.equal(log.isCondensed, false); assert.equal(log.isReviewed, false);
    assert.equal(log.reviewStep, 0); assert.equal(log.nextReviewDate, dueAt, 'first review 2 hours after pressing');
    assert.equal(log.unitReviewPending, undefined);
    assert.deepEqual(log.reviewUnitRange, { start: 1, end: 20 });
    assert.equal(log.reviewMemo, `${id} 노트`);
  });
  assert.equal(byId(registered.logs, 'o').unitReviewPending, true, 'another subject is untouched');
  assert.equal(byId(registered.logs, 'd').reviewStep, 2); assert.equal(byId(registered.logs, 'd').nextReviewDate, '2026-11-01T00:00:00.000Z', 'already registered records are untouched');
  // 대기가 없으면 아무것도 바꾸지 않는다(같은 배열)
  assert.equal(registerPendingReviews('m', registered.logs, now).logs, registered.logs);
  assert.deepEqual(registerPendingReviews('m', registered.logs, now).logIds, []);
  // 누른 뒤의 새 세션은 다시 대기에서 시작한다
  state = save(registered.logs, session('e', 23, 24));
  assert.deepEqual(getPendingReviewLogs(state.logs, 'm').map(log => log.id), ['e']);
  // 난도 피드백(FSRS)이 있는 기록은 그 평가가 정한 때에 복습이 열린다
  const graded = { ...session('g', 25, 26), unitReviewPending: true, reviewEnabled: false, isCondensed: true, nextReviewDate: undefined, reviewFsrs: { lastReviewMs: now, stability: 3, difficulty: 5, state: 2, reps: 1, lapses: 0 } };
  const gradedResult = registerPendingReviews('m', [graded], now).logs[0];
  assert.ok(Date.parse(gradedResult.nextReviewDate) > now);
});

test('page unit review registration: exceptions keep the old behaviour', () => {
  const { applyUnitReviewRegistration } = loadSource('utils/review.ts');
  const now = Date.parse('2026-10-18T03:00:00.000Z');
  const subject = { id: 'm', name: '수학', startPage: 1, totalPages: 100, completedPages: 4, targetDate: '2026-12-31', growthPageUnit: 8 };
  const session = (id, startPage, endPage, extra = {}) => ({ id, subjectId: 'm', pagesRead: endPage - startPage + 1, startPage, endPage, timeSpentMinutes: 20,
    timestamp: '2026-10-18T02:00:00.000Z', isReviewed: false, reviewStep: 0, nextReviewDate: '2026-10-18T05:00:00.000Z', isCondensed: false, reviewEnabled: true, ...extra });
  const pending = (id, startPage, endPage) => session(id, startPage, endPage, { unitReviewPending: true, reviewEnabled: false, isCondensed: true, nextReviewDate: undefined });
  // 복습 제외로 저장한 세션은 미루지 않고 그대로(복습 제외). 대기 중인 다른 기록은 그대로 기다린다
  const skipped = applyUnitReviewRegistration(subject, [pending('p', 1, 4)], session('s', 5, 8, { reviewEnabled: false, isCondensed: true, nextReviewDate: undefined }), now);
  assert.equal(skipped.incoming.unitReviewPending, undefined); assert.equal(skipped.incoming.reviewEnabled, false); assert.equal(skipped.incoming.isCondensed, true);
  assert.equal(skipped.logs[0].unitReviewPending, true); assert.deepEqual(skipped.units, []);
  // 단위가 없는 과목(0)도 단위가 있는 과목과 똑같이 대기: "복습에 넣기"를 눌러 난도를 고를 때까지 복습에 들어가지 않는다
  const noUnit = applyUnitReviewRegistration({ ...subject, growthPageUnit: 0 }, [], session('n', 1, 4), now);
  assert.equal(noUnit.incoming.unitReviewPending, true); assert.equal(noUnit.incoming.reviewEnabled, false); assert.equal(noUnit.incoming.nextReviewDate, undefined); assert.equal(noUnit.incoming.isCondensed, true);
  const noUnitField = applyUnitReviewRegistration({ ...subject, growthPageUnit: undefined }, [], session('n2', 1, 4), now);
  assert.equal(noUnitField.incoming.unitReviewPending, true, 'a subject that never had a unit waits too');
  // 단위를 없앤 뒤에도 남은 대기 기록은 그대로 기다린다(자동으로 등록하지 않는다)
  const kept = applyUnitReviewRegistration({ ...subject, growthPageUnit: 0 }, [pending('p', 1, 4)], session('n', 5, 6), now);
  assert.equal(kept.logs[0].unitReviewPending, true); assert.equal(kept.logs[0].reviewEnabled, false);
  // 복습 세션 · 반복 복습 · 정수가 아닌 페이지 · 페이지 범위가 없는 기록은 건드리지 않는다
  [session('r', 1, 8, { reviewParentSubjectId: 'm' }), session('q', 1, 8, { isRepeatReview: true }), session('f', 1, 8.5), session('z', 1, 8, { startPage: undefined, endPage: undefined })].forEach(log => {
    const result = applyUnitReviewRegistration(subject, [], log, now);
    assert.deepEqual(result.incoming, log); assert.deepEqual(result.units, []);
  });
  // 다른 과목의 대기 기록은 건드리지 않는다
  const other = { ...pending('o', 1, 4), subjectId: 'other' };
  const untouched = applyUnitReviewRegistration(subject, [other], session('s', 5, 8), now);
  assert.equal(untouched.logs[0].unitReviewPending, true);
  assert.equal(untouched.incoming.unitReviewPending, true);

  // App 연결: 세션 저장과 오늘 화면 고쳐 저장은 대기 규칙을 쓰고, "복습에 넣기"는 과목 카드 버튼이 누른다
  const app = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8');
  assert.ok(app.includes('applyUnitReviewRegistration(subject, prev, newLog)') && app.includes('applyUnitReviewRegistration(subject, rest, enrichedLog)') && app.includes('keepsUnitReviewPending'));
  assert.ok(app.includes('registerPendingReviews(subjectId, gradePendingReviews(prev, subjectId, grade, now), now)') && app.includes('onRegisterReview={handleRegisterReview}'));
  const today = fs.readFileSync(path.resolve(__dirname, '..', 'components/TodaySummary.tsx'), 'utf8');
  assert.equal((today.match(/\|\| log\.unitReviewPending/g) || []).length, 2, 'a waiting record counts as a review-included record in the edit modal');
  assert.ok(today.includes('data-testid="register-review"') && today.includes('setChoosingReview(true)') && today.includes('onRegisterReview(detailData.subject.id, grade)') && today.includes('<RegisterReviewDialog'), '복습에 넣기는 난도 창을 열고, 난도를 고르면 등록한다');
});

test('all-subjects panel: the review card tools wrap inside a narrow card instead of sticking out of it', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'components/Analytics.tsx'), 'utf8');
  const tools = source.match(/<div data-testid="review-card-tools" className="([^"]+)"/);
  assert.ok(tools, 'the right-hand group of the review card is marked');
  assert.ok(/\bflex-wrap\b/.test(tools[1]) && /\bmin-w-0\b/.test(tools[1]) && !/\bshrink-0\b/.test(tools[1]), 'it can wrap and shrink with the card');
  assert.ok(source.includes('data-testid="review-basis" className="break-keep'));
});

test('basic review shows the pages to review now and a pomodoro (25 min · pages per pomodoro · sessions needed)', () => {
  const { getReviewPomodoro, POMODORO_MINUTES } = loadSource('utils/measurement.ts');
  assert.equal(POMODORO_MINUTES, 25);
  // 장당 1.8분이면 25분에 13장이지만 복습할 장수(10)를 넘지 않는다. 예상 18분이라 1회
  assert.deepEqual(getReviewPomodoro(10, 1.8), { pages: 10, sessions: 1 });
  // 장당 5분이면 25분에 5장 · 예상 150분 → 6회
  assert.deepEqual(getReviewPomodoro(30, 5), { pages: 5, sessions: 6 });
  // 장당 시간이 25분보다 길어도 한 번에 1장은 한다 · 예상 160분 → 7회(횟수는 장수가 아니라 예상 시간을 25분으로 나눈다)
  assert.deepEqual(getReviewPomodoro(4, 40), { pages: 1, sessions: 7 });
  // 소수 장수는 내림한 장수 · 예상 15분이라 1회
  assert.deepEqual(getReviewPomodoro(7.5, 2), { pages: 7, sessions: 1 });
  // 장수로 나누면 5회지만 예상 시간(약 97.5분)으로 나누면 4회
  assert.deepEqual(getReviewPomodoro(49, 1.99), { pages: 12, sessions: 4 });
  // 장당 시간을 모르면 둘 다 없다 · 복습할 장수가 없으면 횟수도 없다
  assert.deepEqual(getReviewPomodoro(10, 0), { pages: null, sessions: null });
  assert.deepEqual(getReviewPomodoro(0, 2), { pages: 0, sessions: null });

  const summary = fs.readFileSync(path.resolve(__dirname, '..', 'components/TodaySummary.tsx'), 'utf8');
  const logger = fs.readFileSync(path.resolve(__dirname, '..', 'components/SessionLogger.tsx'), 'utf8');
  const tasks = fs.readFileSync(path.resolve(__dirname, '..', 'components/TodayTasks.tsx'), 'utf8');
  // 칸: 복습할 페이지 · 뽀모도로(한 번에 25분, 복습 장수, 필요 횟수). 범위(시작~끝 페이지)는 제목 옆으로 옮겼다(21:55)
  const block = summary.slice(summary.indexOf('export const BasicReviewPlan'), summary.indexOf('const BasicReviewEfficiencyTrend'));
  assert.ok(!block.includes('review-plan-range'), 'the range is not repeated under the page count');
  assert.ok(summary.includes('data-testid="basic-review-range"') && summary.includes('{pagePos}.{basicReviewPlan.rangeLabel}'), 'the range sits next to the title');
  assert.ok(summary.includes('!detailData.isBasicReviewDetail && <LaterMembersStrip'), 'no later-members line on a basic review');
  ['data-testid="basic-review-plan"', 'data-testid="review-plan-pages"', 'data-testid="review-plan-pomodoro"',
    'label="한 번에"', '`복습 ${word}`', 'label="필요 횟수"', 'getReviewPomodoro(plan.pages, plan.minutesPerPage, pomodoroMinutes)'].forEach(text => assert.ok(block.includes(text), text));
  assert.ok(block.includes('if (!(plan.pages > 0)) return null'), 'nothing to review → no block');
  // 기본 복습 화면에서만, 그래프 위에 놓인다
  const basicBranch = summary.slice(summary.indexOf(') : detailData.isBasicReviewDetail ? ('), summary.indexOf('<PomodoroSummary label={pageLabel}'));
  assert.ok(basicBranch.indexOf('<BasicReviewPlan') > 0 && basicBranch.indexOf('<BasicReviewPlan') < basicBranch.indexOf('<BasicReviewEfficiencyTrend'));
  // 지금 선택한 복습 계획, 또는 끝낸 칸을 다시 연 뒤 앞당겨 할 복습의 계획
  assert.ok(summary.includes('idle.reviewPlan?.detailKey === detailSubjectId ? idle.reviewPlan : reopened ? idle.extraReviewPlans?.[detailSubjectId]'));
  assert.ok(logger.includes("reviewPlan: selectedReviewGroup?.reviewType === 'basic' ? toReviewPlan(selectedReviewGroup) : null"));
  assert.ok(logger.includes("if (group.reviewType === 'basic') extraReviewPlans[key] = toReviewPlan(group)"));
  assert.ok(logger.includes('pages: group.logs.reduce((sum, log) => sum + Math.max(0, log.pagesRead), 0)'));
  assert.ok(tasks.includes('export interface ReviewPlanContext') && tasks.includes('reviewPlan?: ReviewPlanContext | null'));
  // 학습 칸의 뽀모도로(PomodoroSummary)는 그대로 둔다
  assert.ok(summary.includes("<PomodoroStat label=\"한 번에\" value={String(pomodoroMinutes)} unit=\"분\" adjust={<PomodoroMinutesStepper />} />"));
  assert.ok(summary.includes('label={`풀 ${pageWord(label) === \'페이지\' ? \'장수\' : pageWord(label)}`}'));
});

test('basic review screen: the countdown is the pomodoro, shown large, and only notifies (no closing) when it runs out', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewPracticeScreen } = loadSource('components/ReviewPracticeScreen.tsx');
  const base = {
    title: '기본 복습', isRetry: false, subjectName: '수학', rangeLabel: '1~10', elapsed: '00:10', targetRemaining: '05:00',
    isRunning: true, canPause: true, pauseLabel: '잠시 중단', onTogglePause() {}, onClose() {}, onCondenseFirst() {},
    level: 1, round: 1, roundSize: 2, queueLength: 2, hasQuestions: true, isComplete: false,
    question: React.createElement('p', null, '문제'), questionRange: '1~10', hasCurrentQuestion: true,
    revealed: false, onReveal() {}, onGrade() {}, wrongIntervalLabel: '2시간', correctIntervalLabel: '1일',
    rail: [], firstTryCorrect: 0, firstTryTotal: 0, completion: null, firstTryOk: 0, firstTryBad: 0,
    finishLabel: '남은 문제 2', canFinish: false, onFinish() {}
  };
  const running = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, base));
  assert.ok(running.includes('뽀모도로') && !running.includes('타임어택'), 'labelled 뽀모도로, not 타임어택');
  assert.ok(!running.includes('뽀모도로 끝') && !running.includes('data-time-up'));
  assert.equal((running.match(/text-\[34px\]/g) || []).length, 2, 'elapsed time and pomodoro time are both large');
  assert.ok(running.includes('>05:00<') && running.includes('>00:10<'));
  const over = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...base, targetRemaining: '00:00', timeUp: true }));
  assert.ok(over.includes('뽀모도로 끝') && over.includes('data-time-up="true"') && over.includes('text-amber-700'));
  assert.ok(over.includes('잠시 중단') && over.includes('role="dialog"'), 'the review stays open and can be paused');

  // 회차가 끝나면 SessionLogger는 회차마다 한 번만 소리를 내고 복습 화면을 닫거나 끝내지 않는다
  const logger = fs.readFileSync(path.resolve(__dirname, '..', 'components/SessionLogger.tsx'), 'utf8');
  const start = logger.indexOf('const reviewPomodoro = getPomodoroProgress(');
  const effect = logger.slice(start, logger.indexOf('}, [reviewCompletedRounds]);', start));
  assert.ok(effect.includes('playPomodoroEndSound()') && effect.includes('reviewRoundsSeenRef'));
  ['clearPreSessionReview', 'setIsPreSessionReviewRunning', 'finishPreSessionReview', 'onFinish'].forEach(name => assert.ok(!effect.includes(name), `time up never calls ${name}`));
  assert.ok(logger.includes('timeUp={isReviewTimeUp}'));
  assert.ok(logger.includes('const isReviewTimeUp = Boolean(reviewPomodoro?.finished) && !stopsAtGateCompletion'), 'a review without questions keeps timing until it is finished');
  assert.ok(logger.includes('getPomodoroProgress(preSessionReviewTargetSeconds, preSessionReviewSeconds, pomodoroMinutes)'), 'the review countdown comes from the estimated time');
  assert.ok(logger.includes('formatTime(reviewPomodoro?.remainingSeconds ?? 0)'));
});

test('pomodoro rounds come from the estimated time: up to 25 min is one round, longer is split into 25-minute rounds with the remainder last', () => {
  const { getPomodoroRounds, getPomodoroProgress, POMODORO_SECONDS } = loadSource('utils/measurement.ts');
  assert.equal(POMODORO_SECONDS, 1500);
  assert.deepEqual([0, -5, NaN, 1, 600, 1500, 1501, 3000, 3001].map(value => getPomodoroRounds(value)), [0, 0, 0, 1, 1, 1, 2, 2, 3]);
  assert.equal(getPomodoroProgress(0, 100), null);
  // 예상 18분: 한 회, 그 시간이 다 되면 끝
  assert.deepEqual(getPomodoroProgress(1080, 0), { rounds: 1, round: 1, remainingSeconds: 1080, finished: false, completedRounds: 0 });
  assert.deepEqual(getPomodoroProgress(1080, 600), { rounds: 1, round: 1, remainingSeconds: 480, finished: false, completedRounds: 0 });
  assert.deepEqual(getPomodoroProgress(1080, 1080), { rounds: 1, round: 1, remainingSeconds: 0, finished: true, completedRounds: 1 });
  assert.deepEqual(getPomodoroProgress(1080, 5000), { rounds: 1, round: 1, remainingSeconds: 0, finished: true, completedRounds: 1 });
  // 예상 33분 20초(2000초): 25:00 + 08:20
  assert.deepEqual(getPomodoroProgress(2000, 0), { rounds: 2, round: 1, remainingSeconds: 1500, finished: false, completedRounds: 0 });
  assert.deepEqual(getPomodoroProgress(2000, 1499), { rounds: 2, round: 1, remainingSeconds: 1, finished: false, completedRounds: 0 });
  assert.deepEqual(getPomodoroProgress(2000, 1500), { rounds: 2, round: 2, remainingSeconds: 500, finished: false, completedRounds: 1 });
  assert.deepEqual(getPomodoroProgress(2000, 1999), { rounds: 2, round: 2, remainingSeconds: 1, finished: false, completedRounds: 1 });
  assert.deepEqual(getPomodoroProgress(2000, 2000), { rounds: 2, round: 2, remainingSeconds: 0, finished: true, completedRounds: 2 });
  // 예상 50분: 25분씩 두 회
  assert.deepEqual(getPomodoroProgress(3000, 1500), { rounds: 2, round: 2, remainingSeconds: 1500, finished: false, completedRounds: 1 });
  assert.deepEqual(getPomodoroProgress(3000, 3000), { rounds: 2, round: 2, remainingSeconds: 0, finished: true, completedRounds: 2 });
  // 일시정지 등으로 음수가 오면 0으로 본다
  assert.equal(getPomodoroProgress(1080, -4).remainingSeconds, 1080);

  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewPracticeScreen } = loadSource('components/ReviewPracticeScreen.tsx');
  const { PomodoroNotice } = loadSource('components/PomodoroNotice.tsx');
  const props = {
    title: '기본 복습', isRetry: false, subjectName: '수학', rangeLabel: '1~10', elapsed: '25:10', targetRemaining: '08:10',
    isRunning: true, canPause: true, pauseLabel: '잠시 중단', onTogglePause() {}, onClose() {}, onCondenseFirst() {},
    level: 1, round: 1, roundSize: 2, queueLength: 2, hasQuestions: true, isComplete: false,
    question: React.createElement('p', null, '문제'), questionRange: '1~10', hasCurrentQuestion: true,
    revealed: false, onReveal() {}, onGrade() {}, wrongIntervalLabel: '2시간', correctIntervalLabel: '1일',
    rail: [], firstTryCorrect: 0, firstTryTotal: 0, completion: null, firstTryOk: 0, firstTryBad: 0,
    finishLabel: '남은 문제 2', canFinish: false, onFinish() {}
  };
  // 여러 회차면 "뽀모도로 2/3회", 한 회면 그냥 "뽀모도로"
  assert.ok(renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...props, pomodoroRound: { round: 2, rounds: 3 } })).includes('뽀모도로 2/3회'));
  assert.ok(!renderToStaticMarkup(React.createElement(ReviewPracticeScreen, props)).includes('뽀모도로 1/'));
  // 알림 띠는 머리 아래에 들어가고, 닫기 버튼이 있으며, 복습 화면은 그대로다
  const noticed = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...props,
    notice: React.createElement(PomodoroNotice, { message: '뽀모도로 1/3회가 끝났어요', onDismiss() {} }) }));
  assert.ok(noticed.includes('data-testid="pomodoro-notice"') && noticed.includes('뽀모도로 1/3회가 끝났어요') && noticed.includes('뽀모도로 알림 닫기'));
  assert.ok(noticed.indexOf('</header>') < noticed.indexOf('pomodoro-notice') && noticed.includes('정답 확인'));
  const bare = renderToStaticMarkup(React.createElement(PomodoroNotice, { message: '안내', onDismiss() {} }));
  assert.ok(bare.includes('role="status"') && bare.includes('안내'));

  // 공부 화면: 장당 시간을 알면 목표 장수를 풀 때마다 한 회, 모르면 풀이 시간 25분마다. 알림만 낸다
  const logger = fs.readFileSync(path.resolve(__dirname, '..', 'components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('const studyPomodoroByPages = pomodoroPageTarget !== null && pomodoroPageTarget > 0 && averageSecondsPerPage > 0'));
  assert.ok(logger.includes('Math.floor(attackCompletedPages / pomodoroPageTarget!)') && logger.includes('Math.floor(seconds / (pomodoroMinutes * 60))'));
  const studyStart = logger.indexOf('const studyPomodoroSeenRef');
  const studyEffect = logger.slice(studyStart, logger.indexOf('}, [step, seconds, studyPomodoroRound]);', studyStart));
  assert.ok(studyEffect.includes('playPomodoroEndSound()'));
  ['setIsTimerRunning', 'handleTimerComplete', 'setStep'].forEach(name => assert.ok(!studyEffect.includes(name), `the study notice never calls ${name}`));
  assert.ok(logger.includes('studyPomodoroRound > dismissedPomodoroRound'));
});


test('pomodoro length: 5-minute steps, clamped to 5~90, saved on this device and shared by study and review', () => {
  const file = path.resolve(__dirname, '..', 'utils/pomodoroSetting.ts');
  const setting = loadSource('utils/pomodoroSetting.ts');
  assert.deepEqual([setting.DEFAULT_POMODORO_MINUTES, setting.POMODORO_STEP_MINUTES, setting.MIN_POMODORO_MINUTES, setting.MAX_POMODORO_MINUTES], [25, 5, 5, 90]);
  assert.deepEqual([25, 30, 27, 28, 3, 0, -10, 90, 95, 200, '35', '', 'abc', null, undefined, NaN].map(value => setting.normalizePomodoroMinutes(value)),
    [25, 30, 25, 30, 5, 5, 5, 90, 90, 90, 35, 25, 25, 25, 25, 25]);
  assert.equal(setting.stepPomodoroMinutes(25, 1), 30);
  assert.equal(setting.stepPomodoroMinutes(25, -1), 20);
  assert.equal(setting.stepPomodoroMinutes(5, -1), 5, 'the lower end stays');
  assert.equal(setting.stepPomodoroMinutes(90, 1), 90, 'the upper end stays');

  // 저장: 쓰면 localStorage에 남고, 새로 열었을 때(다음 학습) 그 값을 읽는다
  const store = new Map();
  global.window = {
    localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
    addEventListener() {}, removeEventListener() {}
  };
  try {
    assert.equal(setting.readPomodoroMinutes(), 25, 'nothing saved → 25');
    assert.equal(setting.writePomodoroMinutes(35), 35);
    assert.equal(store.get('swp_pomodoro_minutes'), '35');
    assert.equal(setting.readPomodoroMinutes(), 35);
    assert.equal(setting.writePomodoroMinutes(33), 35, 'snapped to the nearest 5');
    loadedSources.delete(file);
    const reopened = loadSource('utils/pomodoroSetting.ts');
    assert.equal(reopened.readPomodoroMinutes(), 35, 'the saved length is used the next time');
    store.set('swp_pomodoro_minutes', 'garbage');
    loadedSources.delete(file);
    assert.equal(loadSource('utils/pomodoroSetting.ts').readPomodoroMinutes(), 25, 'a broken saved value falls back to 25');
  } finally {
    delete global.window;
    loadedSources.delete(file);
  }
});

test('pomodoro helpers follow the chosen length and keep 25 as the default', () => {
  const m = loadSource('utils/measurement.ts');
  // 기본값(25분)은 그대로
  assert.deepEqual(m.getReviewPomodoro(49, 1.99), { pages: 12, sessions: 4 });
  assert.equal(m.getPomodoroPageTarget(1.8, 100), 13);
  // 30분: 장당 1.8분이면 한 번에 16장, 예상 2000초(33분 20초)는 30분 + 3분 20초로 2회
  assert.equal(m.getPomodoroPageTarget(1.8, 100, 30), 16);
  assert.equal(m.getPomodoroRounds(2000, 30), 2);
  assert.equal(m.getPomodoroRounds(1800, 30), 1);
  assert.equal(m.getPomodoroRounds(1801, 30), 2);
  assert.deepEqual(m.getPomodoroProgress(2000, 0, 30), { rounds: 2, round: 1, remainingSeconds: 1800, finished: false, completedRounds: 0 });
  assert.deepEqual(m.getPomodoroProgress(2000, 1800, 30), { rounds: 2, round: 2, remainingSeconds: 200, finished: false, completedRounds: 1 });
  // 15분: 예상 2000초는 15분 + 15분 + 3분 20초로 3회
  assert.equal(m.getPomodoroRounds(2000, 15), 3);
  assert.deepEqual(m.getPomodoroProgress(2000, 1800, 15), { rounds: 3, round: 3, remainingSeconds: 200, finished: false, completedRounds: 2 });
  assert.deepEqual(m.getReviewPomodoro(30, 5, 50), { pages: 10, sessions: 3 });
  // 예상 시간이 뽀모도로 시간보다 짧으면 뽀모도로 시간을 늘려도 한 회(예상 시간만큼)
  assert.deepEqual(m.getPomodoroProgress(1080, 0, 45), { rounds: 1, round: 1, remainingSeconds: 1080, finished: false, completedRounds: 0 });
});

test('pomodoro ▲▼ buttons: stacked vertically right beside the pomodoro length, 5 minutes per press, outside any other button', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroMinutesStepper } = loadSource('components/PomodoroMinutesStepper.tsx');
  const html = renderToStaticMarkup(React.createElement(PomodoroMinutesStepper));
  assert.ok(html.includes('data-testid="pomodoro-stepper"') && /flex[^"]*flex-col/.test(html), 'the two buttons are stacked vertically');
  assert.ok(html.indexOf('data-testid="pomodoro-up"') > 0 && html.indexOf('data-testid="pomodoro-up"') < html.indexOf('data-testid="pomodoro-down"'), 'up first, down below');
  assert.ok(html.includes('뽀모도로 5분 늘리기') && html.includes('뽀모도로 5분 줄이기') && html.includes('뽀모도로 시간 25분'));
  assert.equal((html.match(/<button/g) || []).length, 2);

  const source = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
  const logger = source('components/SessionLogger.tsx');
  // 공부 화면: 측정 칸 맨 왼쪽에 "뽀모도로 30분" 글자와 그 바로 옆 ▲ 버튼 하나(측정 중에는 줄일 수 없다)
  const group = logger.slice(logger.indexOf('data-testid="measurement-group"'), logger.indexOf('<div className="flex min-w-[10rem] flex-1 items-center rounded-xl bg-slate-50 px-4 py-3">'));
  assert.ok(group.indexOf('<PomodoroLength') > 0 && group.indexOf('<PomodoroLength') < group.indexOf('<MeasurementProgress'), 'the pomodoro length (with its ▲) is the leftmost cell');
  assert.ok(!group.includes('<PomodoroMinutesStepper') && !group.includes('PageTimeAttack'));
  const { PomodoroLength } = loadSource('components/PomodoroMinutesStepper.tsx');
  const length = renderToStaticMarkup(React.createElement(PomodoroLength));
  assert.ok(length.includes('data-testid="pomodoro-length"') && length.includes('뽀모도로') && length.includes('data-testid="pomodoro-minutes">25<'));
  assert.ok(length.indexOf('뽀모도로') < length.indexOf('data-testid="pomodoro-stepper"'), 'the ▲ comes right after the pomodoro text');
  assert.equal((length.match(/<button/g) || []).length, 1);
  assert.ok(length.includes('pomodoro-up') && !length.includes('pomodoro-down'));
  // 복습 화면 머리 줄: 뽀모도로 시간 옆
  const screen = source('components/ReviewPracticeScreen.tsx');
  assert.ok(screen.indexOf('data-testid="review-pomodoro"') < screen.indexOf('<PomodoroMinutesStepper upOnly />'));
  const React2 = React;
  const { ReviewPracticeScreen } = loadSource('components/ReviewPracticeScreen.tsx');
  const base = {
    title: '기본 복습', isRetry: false, subjectName: '수학', rangeLabel: '1~10', elapsed: '00:10', targetRemaining: '05:00',
    isRunning: true, canPause: true, pauseLabel: '잠시 중단', onTogglePause() {}, onClose() {}, onCondenseFirst() {},
    level: 1, round: 1, roundSize: 2, queueLength: 2, hasQuestions: true, isComplete: false,
    question: React2.createElement('p', null, '문제'), questionRange: '1~10', hasCurrentQuestion: true,
    revealed: false, onReveal() {}, onGrade() {}, wrongIntervalLabel: '2시간', correctIntervalLabel: '1일',
    rail: [], firstTryCorrect: 0, firstTryTotal: 0, completion: null, firstTryOk: 0, firstTryBad: 0,
    finishLabel: '남은 문제 2', canFinish: false, onFinish() {}
  };
  const header = renderToStaticMarkup(React2.createElement(ReviewPracticeScreen, base));
  assert.ok(header.includes('data-testid="pomodoro-stepper"') && header.includes('· 25분'));
  assert.ok(header.includes('pomodoro-up') && !header.includes('pomodoro-down'), 'during the review measurement the time can be raised, not lowered');
  assert.ok(renderToStaticMarkup(React2.createElement(ReviewPracticeScreen, { ...base, pomodoroMinutes: 35 })).includes('· 35분'));
  // 시작 전 칸(학습·기본 복습)의 "한 번에 25분" 옆에도 같은 버튼
  const summary = source('components/TodaySummary.tsx');
  assert.equal((summary.match(/adjust=\{<PomodoroMinutesStepper \/>\}/g) || []).length, 2);
  // 학습·복습의 모든 계산이 같은 저장 값을 쓴다(25가 굳어 있지 않다)
  assert.ok(!/POMODORO_MINUTES/.test(logger.replace(/^import .*$/gm, '')) && !/\{POMODORO_MINUTES\}|String\(POMODORO_MINUTES\)/.test(summary));
  assert.ok(logger.includes('getPomodoroPageTarget(averageTimePerPage, remainingSubjectPages, pomodoroMinutes)') && logger.includes('minutes: pomodoroMinutes'));
});

test('pomodoro end sound: a separate chime (not the page-turn sound), unlocked when a study or review starts, and it counts again if the length is changed mid-run', () => {
  const logger = fs.readFileSync(path.resolve(__dirname, '..', 'components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('const playPomodoroEndSound = () =>') && logger.includes('const ringChime = (context: AudioContext)'));
  assert.ok(/const unlockSounds = \(\) => \{\s*unlockChime\(\);/.test(logger), 'the chime is unlocked together with the other sounds');
  assert.ok(/const openPreSessionReview = [^\n]*\n\s*unlockSounds\(\);/.test(logger), 'starting a review unlocks the sounds too');
  assert.ok(/const startMeasurementNow = \(\) => \{\s*unlockSounds\(\);/.test(logger));
  // 소리 막힘이면 쪽 넘김 소리로 대신한다
  const play = logger.slice(logger.indexOf('const playPomodoroEndSound'), logger.indexOf('const formatPageNumber'));
  assert.ok(play.includes('playPageTurnSound()') && play.includes('ringChime(context)') && play.includes('context.resume()'));
  // 학습·복습 모두 회차가 끝나면 이 종소리를 내고, 장마다 나는 쪽 넘김 소리는 그대로 둔다
  assert.equal((logger.match(/playPomodoroEndSound\(\);/g) || []).length, 2);
  assert.ok(logger.includes('if (remainingInPage <= 2 && !pageTurnSoundPagesRef.current.has(currentPageIndex))'));
  // 도중에 시간을 바꿔 끝난 회차 수가 줄면 그 값부터 다시 센다
  assert.ok(logger.includes('reviewRoundsSeenRef.current = reviewCompletedRounds;\n      setDismissedReviewRound(current => Math.min(current, reviewCompletedRounds));'));
  assert.ok(logger.includes('studyPomodoroSeenRef.current = studyPomodoroRound;\n      setDismissedPomodoroRound(current => Math.min(current, studyPomodoroRound));'));
});


test('follow-up subjects (후행과목): stage ends and unit ends register nothing by themselves; pressing "복습에 넣기" registers every waiting record of the subject, old stages included', () => {
  const { applyUnitReviewRegistration, registerPendingReviews, getPendingReviewLogs, INITIAL_REVIEW_DELAY_MS } = loadSource('utils/review.ts');
  const now = Date.parse('2026-10-18T03:00:00.000Z');
  const dueAt = new Date(now + INITIAL_REVIEW_DELAY_MS).toISOString();
  const session = (id, startPage, endPage, stage, extra = {}) => ({ id, subjectId: 'm', subjectStageId: stage, pagesRead: endPage - startPage + 1, startPage, endPage, timeSpentMinutes: 20,
    timestamp: '2026-10-18T02:00:00.000Z', isReviewed: false, reviewStep: 0, nextReviewDate: '2026-10-18T05:00:00.000Z', isCondensed: false, reviewEnabled: true, ...extra });
  const save = (subject, logs, log) => { const result = applyUnitReviewRegistration(subject, logs, log, now); return { result, logs: [...result.logs, result.incoming] }; };
  const byId = (logs, id) => logs.find(log => log.id === id);
  const main = { id: 'm', name: '수학', startPage: 1, totalPages: 25, completedPages: 20, targetDate: '2026-12-31', growthPageUnit: 10,
    followUpSubjects: [{ id: 'f', name: '후행', startPage: 26, endPage: 45, completedPage: 25 }] };
  // 과목 자신의 단계를 25쪽 끝까지 마쳐도(마지막 단위가 짧아도) 자동 등록은 없다
  let state = save(main, [], session('a', 21, 23, 'm'));
  state = save(main, state.logs, session('b', 24, 25, 'm'));
  assert.deepEqual(state.result.units, []);
  assert.deepEqual(getPendingReviewLogs(state.logs, 'm').map(log => log.id), ['a', 'b']);
  // 후행 단계로 넘어가 단위를 채워도 마찬가지(앞 단계 기록도 계속 대기)
  const done = { ...main, completedPages: 25 };
  state = save(done, state.logs, session('f1', 26, 35, 'f'));
  state = save(done, state.logs, session('f2', 36, 45, 'f'));
  assert.deepEqual(getPendingReviewLogs(state.logs, 'm').map(log => log.id), ['a', 'b', 'f1', 'f2']);
  assert.ok(state.logs.every(log => !log.nextReviewDate));
  // "복습에 넣기": 단계와 상관없이 이 과목의 대기 기록이 모두 한꺼번에 들어간다
  const result = registerPendingReviews('m', state.logs, now);
  assert.deepEqual(result.logIds, ['a', 'b', 'f1', 'f2']);
  assert.deepEqual(result.range, { start: 21, end: 45 });
  result.logs.forEach(log => { assert.equal(log.nextReviewDate, dueAt); assert.equal(log.unitReviewPending, undefined); assert.equal(log.reviewEnabled, true); });
  // 단계 표시가 없는 예전 기록도 같다
  const legacy = session('legacy', 21, 23, undefined, { unitReviewPending: true, reviewEnabled: false, isCondensed: true, nextReviewDate: undefined }); delete legacy.subjectStageId;
  assert.equal(registerPendingReviews('m', [legacy], now).logs[0].nextReviewDate, dueAt);
});

test('trend screen data: weekly, cumulative, calendar, weekday pattern, subject share and review rounds', () => {
  const report = loadSource('utils/studyReport.ts');
  const now = new Date(2026, 9, 18, 12, 0, 0); // 일요일
  const log = (studyDate, minutes, extra = {}) => ({ id: `${studyDate}-${minutes}-${Math.random()}`, subjectId: 'a', pagesRead: 5, timeSpentMinutes: minutes, timestamp: new Date(`${studyDate}T12:00:00`).toISOString(), studyDate, ...extra });

  // 퍼센트: 합이 항상 100, 같으면 앞에서부터 하나씩
  assert.deepEqual(report.allocatePercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(report.allocatePercents([0, 0]), [0, 0]);
  assert.deepEqual(report.allocatePercents([120, 60, 40]), [55, 27, 18]);

  // 주별(월요일 시작): 9/28, 10/5, 10/12 주. 구간 밖(9/20)은 빼고 풀이·정리를 나눈다
  const weekly = report.buildWeeklyStudy([log('2026-10-13', 60, { timeAttackMinutes: 45 }), log('2026-10-18', 30), log('2026-10-06', 90, { organizationMinutes: 10 }), log('2026-09-20', 500)], 3, now);
  assert.deepEqual(weekly.points.map(p => p.key), ['2026-09-28', '2026-10-05', '2026-10-12']);
  assert.deepEqual(weekly.points.map(p => p.minutes), [0, 90, 90]);
  assert.deepEqual(weekly.points.map(p => p.label), ['9/28', '10/5', '10/12']);
  assert.deepEqual([weekly.points[2].solveMinutes, weekly.points[2].organizeMinutes], [75, 15]);
  assert.deepEqual([weekly.points[1].solveMinutes, weekly.points[1].organizeMinutes], [80, 10]);
  assert.equal(weekly.points[2].isCurrent, true); assert.equal(weekly.points[1].isCurrent, false);
  assert.equal(weekly.averageMinutes, 90, 'only finished weeks with study count');
  assert.equal(report.buildWeeklyStudy([], 4, now).averageMinutes, 0);

  // 누적: 처음 주부터 주 끝까지 쌓인 시간. 미래 기록은 세지 않는다
  const logs = [log('2026-09-30', 60), log('2026-10-06', 120), log('2026-10-13', 60), log('2026-10-25', 999)];
  const cumulative = report.buildCumulativeStudy(logs, now);
  assert.deepEqual(cumulative.points.map(p => p.hours), [1, 3, 4]);
  assert.deepEqual(cumulative.points.map(p => p.weekMinutes), [60, 120, 60]);
  assert.deepEqual([cumulative.totalMinutes, cumulative.totalPages, cumulative.studyDays, cumulative.firstDateKey], [240, 15, 3, '2026-09-30']);
  const lastTwo = report.buildCumulativeStudy(logs, now, 2);
  assert.deepEqual(lastTwo.points.map(p => p.hours), [3, 4], 'the first plotted point already holds everything before it');
  assert.deepEqual(report.buildCumulativeStudy([], now), { points: [], totalMinutes: 0, totalPages: 0, studyDays: 0, firstDateKey: null });

  // 달력: 2주(10/5~10/18), 월요일 시작. 진하기는 공부한 날의 사분위
  const calendar = report.buildStudyCalendar([log('2026-10-13', 60), log('2026-10-15', 30), log('2026-10-17', 90)], 2, now);
  assert.equal(calendar.columns.length, 2); assert.ok(calendar.columns.every(column => column.length === 7));
  assert.equal(calendar.columns[0][0].key, '2026-10-05'); assert.equal(calendar.columns[1][6].key, '2026-10-18');
  assert.equal(calendar.columns[1][6].isToday, true); assert.equal(calendar.columns[1][6].weekday, '일');
  const level = key => calendar.columns.flat().find(day => day.key === key).level;
  assert.deepEqual([level('2026-10-15'), level('2026-10-13'), level('2026-10-17'), level('2026-10-14')], [1, 2, 4, 0]);
  assert.deepEqual([calendar.studiedDays, calendar.totalMinutes], [3, 180]);
  assert.deepEqual(calendar.months, [{ column: 0, label: '10월' }]);
  const midweek = report.buildStudyCalendar([], 1, new Date(2026, 9, 14, 9)); // 수요일
  assert.deepEqual(midweek.columns[0].map(day => day.isFuture), [false, false, false, true, true, true, true]);
  const monthChange = report.buildStudyCalendar([], 3, now); // 9/28 시작 → 10월이 두 번째 열부터
  assert.deepEqual(monthChange.months.map(m => m.label), ['9월', '10월']);

  // 요일 패턴: 최근 1주(10/12~10/18)면 요일마다 한 번씩
  const pattern = report.buildWeekdayPattern([log('2026-10-13', 60), log('2026-10-06', 999)], 1, now);
  assert.deepEqual(pattern.map(p => p.label), ['월', '화', '수', '목', '금', '토', '일']);
  assert.deepEqual(pattern.map(p => p.averageMinutes), [0, 60, 0, 0, 0, 0, 0]);
  assert.ok(pattern.every(p => p.occurrences === 1));
  assert.equal(report.buildWeekdayPattern([log('2026-10-13', 60)], 2, now)[1].averageMinutes, 30, 'two Tuesdays in two weeks → average 30');

  // 과목 비중: 많은 순 + 기타, 합 100
  const names = { a: '가', b: '나', c: '다', d: '라', e: '마', f: '바', g: '사' };
  const share = report.buildSubjectShare([['a', 120], ['b', 60], ['c', 20], ['d', 10], ['e', 5], ['f', 3], ['g', 2]].map(([id, minutes]) => log('2026-10-13', minutes, { subjectId: id })),
    id => names[id], { topN: 3 });
  assert.deepEqual(share.map(item => [item.name, item.minutes, item.percent]), [['가', 120, 55], ['나', 60, 27], ['기타 5개', 40, 18]]);
  assert.equal(report.buildSubjectShare([log('2026-10-13', 10), log('2026-09-01', 90)], () => '가', { sinceKey: '2026-10-01' })[0].percent, 100);
  assert.deepEqual(report.buildSubjectShare([], () => '가'), []);

  // 복습 회차별 효율: 회차마다 시간과 장수를 더해 낸다. 잘못된 기록은 뺀다
  const rounds = report.buildReviewRoundEfficiency([
    log('2026-10-10', 30, { basicReviewTimeRecords: [{ minutes: 12, pages: 10, timestamp: 'x', reviewNumber: 1 }, { minutes: 9, pages: 10, timestamp: 'x', reviewNumber: 2 }, { minutes: 0, pages: 10, timestamp: 'x', reviewNumber: 3 }] }),
    log('2026-10-11', 30, { basicReviewTimeRecords: [{ minutes: 24, pages: 10, timestamp: 'x' }] })
  ]);
  assert.deepEqual(rounds.map(r => [r.round, r.sessions, r.minutes, r.pages]), [[1, 2, 36, 20], [2, 1, 9, 10]]);
  assert.deepEqual(rounds.map(r => Number(r.minutesPerPage.toFixed(2))), [1.8, 0.9]);
  assert.deepEqual(rounds.map(r => Number(r.speed.toFixed(2))), [33.33, 66.67]);
});

// ───────────── 학습 설정 맨 위 요약: 하루 · 일주일 · 전체 ─────────────

test('unit growth: 하루 = average of the net speed gained per study day, 일주일 = per Monday-start week, 전체 = first chunk to now; spread is the std dev across subjects', () => {
  const { unitGrowthOf, summarizeUnitGrowth } = loadSource('utils/speedGrowth.ts');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const series = rows => ({ points: rows.map(([dateKey, growth], index) => ({ index, hours: (index + 1) * 25 / 60, timestamp: `${dateKey}T03:00:00.000Z`, dateKey, speed: 0, gain: 0, growth })),
    latestSpeed: 1, latestGrowth: rows[rows.length - 1][1], acceleration: null });
  // 2026-10-05 월, 10-06 화, 10-11 일, 10-12 월
  const a = series([['2026-10-05', null], ['2026-10-05', 1], ['2026-10-06', 2], ['2026-10-06', 1], ['2026-10-11', 2], ['2026-10-12', -1]]);
  near(unitGrowthOf(a, 'day'), 1.25);            // 날마다 1, 3, 2, -1 → 평균
  near(unitGrowthOf(a, 'day', 1), 0);            // 월요일에 공부한 날만: 1, -1
  near(unitGrowthOf(a, 'day', 0), 2);            // 일요일
  near(unitGrowthOf(a, 'day', 2), 3);            // 화요일
  assert.equal(unitGrowthOf(a, 'day', 3), null, 'no study on a Wednesday');
  near(unitGrowthOf(a, 'week'), 2.5);            // 월~일 한 주(1+3+2=6)와 다음 주(-1)의 평균: 일요일은 같은 주
  near(unitGrowthOf(a, 'all'), 5);               // 1+2+1+2-1 = 처음부터 지금까지 늘어난 속도
  near(unitGrowthOf(a, 'all', 3), 5); // the weekday only applies to 하루
  assert.equal(unitGrowthOf({ points: [], latestSpeed: null, latestGrowth: null, acceleration: null }, 'day'), null);
  assert.equal(unitGrowthOf(series([['2026-10-05', null]]), 'all'), null, 'one chunk has nothing to compare with');

  const b = series([['2026-10-05', null], ['2026-10-05', 3]]);
  const none = { points: [], latestSpeed: null, latestGrowth: null, acceleration: null };
  const day = summarizeUnitGrowth([a, b, none], 'day');
  assert.equal(day.measured, 2, 'a subject with no speed yet is left out');
  near(day.mean, 2.125); near(day.spread, 0.875);   // 1.25와 3: 평균 2.125, 표준편차 0.875
  const all = summarizeUnitGrowth([a, b], 'all');
  near(all.mean, 4); near(all.spread, 1);
  assert.deepEqual(summarizeUnitGrowth([none], 'week'), { measured: 0, mean: 0, spread: 0 });
  near(summarizeUnitGrowth([a, b], 'day', 1).mean, 1.5);
});

test('review subjects of a finished stage keep working: they stay in the forecast and in the card\'s combined values while pages remain', () => {
  const { analyzeSubjectSpeed } = loadSource('utils/speedGrowth.ts');
  const mk = (id, name, extra = {}) => ({ id, name, createdAt: '2026-09-01T00:00:00.000Z', planResetDate: '2026-09-01', startPage: 1, totalPages: 100, completedPages: 30,
    targetDate: '2026-12-31', isRequired: false, scheduledWeekdays: [1, 2, 3, 4, 5], growthPageUnit: 10, pageLabel: 'P', tagIds: [], ...extra });
  const chain = (extra = {}) => [
    mk('m', '수학 기출', { totalPages: 100, completedPages: 100, reviewSubjectIds: ['r1'], followUpSubjects: [{ id: 'f', name: '수학 심화', startPage: 101, endPage: 150, completedPage: 110, reviewSubjectIds: ['r2'] }] }),
    mk('r1', '기출 복습', { totalPages: 20, completedPages: 5, ...extra }), mk('r2', '심화 복습', { totalPages: 20, completedPages: 5 })];
  const day = index => `2026-10-${String(1 + index).padStart(2, '0')}`;
  const log = (id, subjectId, pages, index, extra = {}) => ({ id, subjectId, pagesRead: pages, timeSpentMinutes: 25, timeAttackMinutes: 25,
    timestamp: new Date(Date.UTC(2026, 9, 1 + index, 3, 0, 0)).toISOString(), studyDate: day(index), reviewEnabled: false, ...extra });
  const logs = [
    ...[4, 5, 6].map((p, i) => log(`f${i}`, 'm', p, i, { subjectStageId: 'f' })),
    ...[7, 8, 9].map((p, i) => log(`a${i}`, 'r1', p, 3 + i, { reviewParentSubjectId: 'm' })),
    ...[5, 6].map((p, i) => log(`b${i}`, 'r2', p, 6 + i, { reviewParentSubjectId: 'm' }))];

  const subjects = chain();
  assert.equal(schedule.getSubjectStages(subjects[0]).map(stage => stage.status).join(), 'completed,current');
  const working = analyzeSubjectSpeed(subjects, logs, subjects[0]);
  assert.equal(working.stageId, 'f');
  assert.deepEqual(working.forecast.map(item => `${item.kind}:${item.id}`), ['review:r1', 'current:f', 'review:r2'], 'the earlier stage\'s review comes first and is still forecast');
  assert.equal(working.forecast[0].remainingPages, 15);
  assert.equal(working.forecast[0].basis, 'measured');
  assert.deepEqual(Object.keys(working.reviews).sort(), ['r1', 'r2'], 'each review subject can be looked at alone');
  assert.equal(working.own.series.points.length, 3, 'the current stage alone');
  assert.equal(working.series.points.length, 8, 'card = current stage (3) + earlier stage\'s review (3) + this stage\'s review (2)');

  // 그 복습을 다 끝내면 더 이어 갈 것이 없다: 예측과 합친 값에서 빠지지만, 따로 보는 값은 남는다
  const finished = chain({ completedPages: 20 });
  const done = analyzeSubjectSpeed(finished, logs, finished[0]);
  assert.deepEqual(done.forecast.map(item => item.id), ['f', 'r2']);
  assert.equal(done.series.points.length, 5);
  assert.equal(done.reviews.r1.series.points.length, 3);

  // 마지막 단계까지 다 끝나도 남은 복습은 계속 한다
  const allDone = [{ ...subjects[0], followUpSubjects: [{ ...subjects[0].followUpSubjects[0], completedPage: 150 }] }, subjects[1], subjects[2]];
  const after = analyzeSubjectSpeed(allDone, logs, allDone[0]);
  assert.equal(after.stageId, null);
  assert.deepEqual(after.forecast.map(item => item.id), ['r1', 'r2']);
  assert.equal(after.series.points.length, 5, 'only the review subjects are left to measure');
  // 복습과목이 없는 평범한 과목은 그대로
  const plain = analyzeSubjectSpeed([mk('p', '독서')], speedLogs([4, 5, 6], { subjectId: 'p' }), mk('p', '독서'));
  assert.equal(plain.series.points.length, 3);
  assert.deepEqual(plain.forecast.map(item => item.kind), ['current']);
});

test('PlanUnitSummary: one button picks 하루 / 일주일 / 전체, shows average growth · std dev · time, then the share bar; 하루 adds weekday buttons and the weekday time bar', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const panels = loadSource('components/SpeedPanels.tsx');
  const days = [1, 2, 3, 4, 5, 6, 0].map((id, index) => ({ weekday: id, label: '월화수목금토일'[index], minutes: index < 5 ? 60 : 0, isToday: id === 3 }));
  const base = { onUnitChange() {}, onWeekdayChange() {}, growth: { measured: 2, mean: 1.5, spread: 0.5 }, minutes: 125, days, weekday: null,
    shareItems: [{ id: 'a', name: '수학', minutes: 60, isFolder: true }, { id: 'b', name: '영어', minutes: 30 }] };
  const render = props => renderToStaticMarkup(React.createElement(panels.PlanUnitSummary, { ...base, ...props }));
  const at = (html, text, from = 0) => { const index = html.indexOf(text, from); assert.ok(index >= 0, `missing ${text}`); return index; };

  const day = render({ unit: 'day' });
  const unitGroup = day.slice(at(day, 'data-testid="plan-unit"'), at(day, 'data-testid="plan-stats"'));
  assert.equal((unitGroup.match(/<button/g) || []).length, 3, 'a single button group with three buttons');
  assert.ok(at(unitGroup, '>하루<') < at(unitGroup, '>일주일<') && at(unitGroup, '>일주일<') < at(unitGroup, '>전체<'));
  assert.equal((unitGroup.match(/aria-pressed="true"/g) || []).length, 1);
  assert.ok(/aria-pressed="true"[^>]*>하루</.test(unitGroup));
  const stats = day.slice(at(day, 'data-testid="plan-stats"'), at(day, 'data-testid="plan-share"'));
  assert.ok(at(stats, '평균 속도 증가율') < at(stats, '표준편차') && at(stats, '표준편차') < at(stats, '하루 평균 시간'));
  assert.ok(stats.includes('+1.5P/h') && stats.includes('±0.5P/h') && stats.includes('2h 5m'));
  assert.ok(at(day, 'data-testid="plan-stats"') < at(day, 'data-testid="plan-share"') && at(day, 'data-testid="plan-share"') < at(day, 'data-testid="plan-weekdays"'), 'average, then the share bar, then (하루 only) the weekday part');
  assert.ok(day.includes('하루 평균 시간 비율') && day.includes('data-testid="share-bar"') && day.includes('📂 수학'));
  const weekdayPart = day.slice(at(day, 'data-testid="plan-weekdays"'));
  assert.ok(weekdayPart.includes('data-testid="weekday-picker"') && at(weekdayPart, 'data-testid="weekday-picker"') < at(weekdayPart, 'data-testid="weekday-time-bar"'));
  assert.equal((weekdayPart.match(/data-testid="weekday-time-segment"/g) || []).length, 5, 'days off have no segment');
  assert.ok(!/opacity-50/.test(weekdayPart), 'nothing is dimmed while the average is shown');

  // 요일을 고르면 값과 비율이 그 요일 기준이 되고, 고른 칸만 눌린 상태, 나머지는 흐리게
  const wed = render({ unit: 'day', weekday: 3, minutes: 60 });
  assert.ok(wed.includes('수요일 시간</p>') && wed.includes('수요일 시간 비율'));
  assert.ok(/aria-pressed="true"[^>]*aria-label="수요일 비율 보기"/.test(wed));
  assert.ok(/data-weekday="3" aria-pressed="true"/.test(wed) && (wed.match(/opacity-50/g) || []).length === 4);
  assert.ok(render({ unit: 'day', weekday: 6, shareItems: [{ id: 'a', name: '수학', minutes: 0 }], minutes: 0 }).includes('토요일에는 공부하는 과목이 없어요'));

  // 일주일 · 전체: 요일 부분이 없다
  const week = render({ unit: 'week', minutes: 600 });
  assert.ok(week.includes('한 주 시간') && week.includes('일주일 시간 비율') && week.includes('10h 0m') && !week.includes('data-testid="plan-weekdays"') && !week.includes('weekday-picker'));
  assert.ok(/aria-pressed="true"[^>]*>일주일</.test(week));
  const all = render({ unit: 'all', minutes: 3000 });
  assert.ok(all.includes('전체 예상 시간') && all.includes('전체 시간 비율') && all.includes('50h 0m') && !all.includes('data-testid="plan-weekdays"'));
  assert.ok(render({ unit: 'all', minutes: 0, shareItems: [{ id: 'a', name: '수학', minutes: 0 }] }).includes('속도를 재면 전체 예상 시간이 나와요'));

  // 값이 없으면 숨김 없이 "측정 필요" / "-"
  const empty = render({ unit: 'day', growth: { measured: 0, mean: 0, spread: 0 }, minutes: 0 });
  assert.ok(empty.includes('측정 필요') && />-</.test(empty));
  assert.ok(renderToStaticMarkup(React.createElement(panels.WeekdayTimeBar, { days: days.map(d => ({ ...d, minutes: 0 })), selected: null, onSelect() {} })).includes('학습 요일 없음'));
});

test('learning settings: summary above the list; folder cards have no weekday buttons; the subject card shows current vs review time ratio instead of the weekly need, and per-item growth behind ›', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { Analytics } = loadSource('components/Analytics.tsx');
  const mk = (id, name, extra = {}) => ({ id, name, createdAt: '2026-09-01T00:00:00.000Z', planResetDate: '2026-09-01', startPage: 1, totalPages: 100, completedPages: 30,
    targetDate: '2026-12-31', isRequired: false, scheduledWeekdays: [1, 2, 3, 4, 5], growthPageUnit: 10, pageLabel: 'P', tagIds: [], ...extra });
  const subjects = [
    mk('m', '수학 기출', { totalPages: 100, completedPages: 100, reviewSubjectIds: ['r1'], followUpSubjects: [{ id: 'f', name: '수학 심화', startPage: 101, endPage: 150, completedPage: 110, reviewSubjectIds: ['r2'] }] }),
    mk('r1', '기출 복습', { totalPages: 20, completedPages: 5, scheduledWeekdays: [1, 3] }), mk('r2', '심화 복습', { totalPages: 20, completedPages: 5, scheduledWeekdays: [2, 4] }),
    mk('x', '독서', { tagIds: ['t1'] })];
  const logs = [
    ...speedLogs([4, 5, 6, 7], { subjectId: 'm', subjectStageId: 'f' }).map(log => ({ ...log, id: `f-${log.id}` })),
    ...speedLogs([7, 8, 9], { subjectId: 'r1', reviewParentSubjectId: 'm' }).map(log => ({ ...log, id: `a-${log.id}` })),
    ...speedLogs([3, 4, 5], { subjectId: 'x' }).map(log => ({ ...log, id: `x-${log.id}` }))];
  const tags = [{ id: 't1', name: '교양', color: '#6366f1', isVisible: true }];
  const props = { subjects, logs, tagDefinitions: tags, activeWeekday: 1, activeStudyDate: '2026-10-12',
    onActiveWeekdayChange() {}, onUpdateSubject() {}, onUpdateSubjects() {}, onDeleteSubject() {}, onUpdateTags() {}, onAddSubject() {}, onDeleteFolder() {} };
  const html = renderToStaticMarkup(React.createElement(Analytics, props));
  // 요약: 학습 설정 맨 위(목록 바로 위), 하루가 기본
  const summaryAt = html.indexOf('data-testid="plan-summary"');
  assert.ok(summaryAt > 0 && summaryAt < html.indexOf('group/folder') && summaryAt < html.indexOf('data-subject-id'), 'the summary is above the folders and subjects');
  assert.ok(/aria-pressed="true"[^>]*>하루</.test(html) && html.includes('data-testid="plan-weekdays"'), '하루 is the default and shows the weekday buttons');
  const summary = html.slice(summaryAt, html.indexOf('group/folder'));
  // 맨 위 폴더 · 과목: 폴더 "교양"과 과목 "수학 심화"(현재 단계 이름)가 비율 막대에 있다. 복습과목은 따로 칸이 아니라 그 과목 몫에 들어 있다.
  const share = summary.slice(summary.indexOf('data-testid="plan-share"'));
  assert.ok(share.includes('📂 교양') && share.includes('수학 심화') && !share.includes('기출 복습'), 'top-level items only');

  // 폴더: 요일 버튼 없음
  assert.equal((html.match(/data-testid="weekday-picker"/g) || []).length, 1);
  // 과목 카드: 한 주 필요 시간 · 요일별 비율 대신 현재 과목 · 복습과목 비율. 끝난 단계(수학 기출)의 복습과목도 들어간다
  const card = html.slice(html.indexOf('data-subject-id="m"'));
  const cardShare = card.slice(card.indexOf('data-testid="subject-share"'), card.indexOf('data-testid="subject-speed"'));
  assert.ok(cardShare.includes('현재 과목 · 복습과목 시간 비율') && cardShare.includes('data-testid="share-bar"'));
  ['수학 심화', '기출 복습', '심화 복습'].forEach(name => assert.ok(cardShare.includes(name), `${name} is in the card's ratio bar`));
  assert.ok(cardShare.indexOf('수학 심화') < cardShare.indexOf('기출 복습') || cardShare.indexOf('수학 심화') < cardShare.indexOf('심화 복습'), 'the current subject comes first');
  const beforeSpeed = card.slice(0, card.indexOf('data-testid="subject-speed"'));
  assert.ok(beforeSpeed.indexOf('data-testid="subject-share"') < beforeSpeed.indexOf('data-testid="weekday-need"') && beforeSpeed.indexOf('data-testid="weekday-need"') < beforeSpeed.indexOf('하루 평균 페이지'), 'the weekly need bar sits right under the ratio bar');
  // (복습과목이 없는 과목 카드에 비율 막대는 없고 한 주 필요 시간 막대만 있는 것은 위의 '과목·폴더 관리' 테스트가 본다)
  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(source.indexOf('<PlanUnitSummary') < source.indexOf('{RenderTree({})}'), 'the summary is rendered right above the tree');
  assert.ok(source.includes('summarizeUnitGrowth(') && source.includes('unitMinutes(') && source.includes("tag.parentId === undefined"), 'top-level items and unit values');
  // 과목도 폴더처럼: ›를 열면 현재 과목과 복습과목 각각의 증가율
  assert.ok(source.includes('data-testid="subject-growth-list"') && source.includes('data-testid="subject-growth-row"') && source.includes('speed.own') && source.includes('speed.reviews[part.id]'));
  assert.ok(source.indexOf('data-testid="subject-growth-list"') > source.indexOf('speedOpen && ('), 'the per-item growth sits in the opened part, like the folder');
  // 한 주 필요 시간 막대는 과목 카드에만 있고, 전체 과목 목록의 값(›)에는 없다
  assert.ok(source.includes('<WeekdayNeedBar days={weekNeedBySubject[sub.id] || emptyWeek} scheduledDays={(sub.scheduledWeekdays ?? []).length} />') && !source.includes('<WeekdayNeedBar days={days} />'));
});

test('the unit chosen in the summary also applies to the folder and subject cards below it', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const panels = loadSource('components/SpeedPanels.tsx');
  // 같은 말을 맨 위 요약과 카드가 쓴다
  const words = (unit, label) => panels.describePlanUnit(unit, label);
  assert.deepEqual([words('day').time, words('day').share, words('day').scope, words('day').pages], ['하루 평균 시간', '하루 평균 시간 비율', '하루 평균', '하루 평균 페이지']);
  assert.deepEqual([words('day', '월').time, words('day', '월').share, words('day', '월').scope], ['월요일 시간', '월요일 시간 비율', '월요일']);
  assert.deepEqual([words('week').time, words('week').share, words('week').scope, words('week').pages], ['한 주 시간', '일주일 시간 비율', '일주일', '한 주 페이지']);
  assert.deepEqual([words('all').time, words('all').share, words('all').scope, words('all').pages], ['전체 예상 시간', '전체 시간 비율', '전체', '전체 남은 페이지']);
  assert.equal(words('week', '월').scope, '일주일', 'a weekday only applies to 하루');
  assert.equal(words('day', '월').emptyShare, '월요일에는 공부하는 과목이 없어요');
  // 속도 증가율 칸: 단위 값을 주면 "최근" 값 대신 그것을 보여 준다
  const series = { points: [], latestSpeed: 10, latestGrowth: 2, acceleration: 1 };
  const recent = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series }));
  assert.ok(recent.includes('속도 증가율 · 최근') && recent.includes('+2.0P/h'));
  const unit = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series, growth: -0.5, growthName: '속도 증가율 · 월요일' }));
  assert.ok(unit.includes('속도 증가율 · 월요일') && unit.includes('−0.5P/h') && !unit.includes('최근') && !unit.includes('+2.0P/h'));
  assert.ok(renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series, growth: null, growthName: '속도 증가율 · 전체' })).includes('측정 필요'));

  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  // 폴더 카드: 시간 · 비율 막대 · 속도 증가율 합계/편차가 모두 고른 단위
  assert.ok(source.includes('label={unitWords.time}') && source.includes('getChildShareItems(folder.id, planUnit, summaryWeekday)') && source.includes('`속도 증가율 합계 · ${unitWords.scope}`'), 'folder card: time, share bar and growth follow the unit');
  assert.ok(source.includes('latestGrowth: growths.length > 0') && source.includes('unitGrowthOfSubject'), 'the folder list/spread use each subject\'s unit growth');
  // 과목 카드: 시간 · 페이지 · 비율 막대 · 속도 증가율 · 안쪽 항목별 증가율
  assert.ok(source.includes('label={unitWords.time}') && source.includes('label={unitWords.pages}') && source.includes('unitDaysValue(part.days'), 'subject card: time, pages and the ratio bar follow the unit');
  assert.ok(source.includes('growthName={`속도 증가율 · ${unitWords.scope}`}') && source.includes('unitGrowthOf(series, planUnit, summaryWeekday)'), 'subject card: growth follows the unit, also per item');
  assert.ok(!source.includes('formatTime(stats.dailyTime)'), 'the folder time no longer ignores the unit');
});

test('one subject alone: 현재 과목 학습 vs 기본복습 time ratio from the recorded minutes of that stage (review-subject sessions are not counted)', () => {
  const { splitStudyAndBasicReviewMinutes } = loadSource('utils/studyTimeSplit.ts');
  const family = { ownerId: 'm', stageId: 'm', reviewIds: new Set(['r']) };
  const at = day => `2026-10-${day}T12:00:00.000Z`;   // 정오(UTC): 어느 시간대에서도 같은 날짜
  const base = { pagesRead: 5, reviewEnabled: true };
  const logs = [
    // 월요일(10/12)에 30분 공부, 화요일(10/13)에 10분 · 다음 월요일(10/19)에 6분 기본복습
    { ...base, id: 'l1', subjectId: 'm', timeSpentMinutes: 30, studyDate: '2026-10-12', timestamp: at('12'),
      basicReviewTimeRecords: [{ minutes: 10, pages: 5, timestamp: at('13'), reviewNumber: 1 }, { minutes: 6, pages: 5, timestamp: at('19'), reviewNumber: 2 }] },
    // 수요일(10/14) 25분 공부, 기본복습 기록은 합계만 있는 예전 기록 8분
    { ...base, id: 'l4', subjectId: 'm', timeSpentMinutes: 25, studyDate: '2026-10-14', timestamp: at('14'), reviewTimeSpentMinutes: 8, reviewCompletedPages: 5 },
    // 다른 단계의 공부와 복습과목 세션은 이 단계의 몫이 아니다
    { ...base, id: 'l2', subjectId: 'm', subjectStageId: 'f', timeSpentMinutes: 99, studyDate: '2026-10-12', timestamp: at('12'),
      basicReviewTimeRecords: [{ minutes: 99, pages: 5, timestamp: at('13') }] },
    { ...base, id: 'l3', subjectId: 'r', reviewParentSubjectId: 'm', timeSpentMinutes: 77, studyDate: '2026-10-12', timestamp: at('12') }
  ];
  assert.deepEqual(splitStudyAndBasicReviewMinutes(logs, family), { study: 55, basicReview: 24 }, 'everything recorded for the stage; the legacy total counts too');
  assert.deepEqual(splitStudyAndBasicReviewMinutes(logs, family, { fromDateKey: '2026-10-14' }), { study: 25, basicReview: 6 }, 'from a date on; the undated legacy total is left out');
  assert.deepEqual(splitStudyAndBasicReviewMinutes(logs, family, { weekday: 1 }), { study: 30, basicReview: 6 }, 'Mondays only');
  assert.deepEqual(splitStudyAndBasicReviewMinutes(logs, family, { weekday: 0 }), { study: 0, basicReview: 0 });
  assert.deepEqual(splitStudyAndBasicReviewMinutes([], family), { study: 0, basicReview: 0 });
  // 후행과목 단계의 묶음은 그 단계의 기록만
  assert.deepEqual(splitStudyAndBasicReviewMinutes(logs, { ownerId: 'm', stageId: 'f', reviewIds: new Set() }), { study: 99, basicReview: 99 });

  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(!source.includes('study-review-share') && !source.includes('studyReviewShare'), 'the study vs basic-review ratio bar is gone from the one-subject values');
});

test('one subject alone: 해당 과목 and 기본복습 efficiency side by side, and their growth as a combined graph plus one line each (like a folder)', () => {
  const { analyzeSubjectSpeed, getBasicReviewSpeedSamples } = loadSource('utils/speedGrowth.ts');
  const mk = (id, extra = {}) => ({ id, name: '수학', createdAt: '2026-09-01T00:00:00.000Z', planResetDate: '2026-09-01', startPage: 1, totalPages: 100, completedPages: 30,
    targetDate: '2026-12-31', isRequired: false, scheduledWeekdays: [1, 2, 3, 4, 5], growthPageUnit: 10, pageLabel: 'P', tagIds: [], ...extra });
  const subject = mk('m');
  const at = (day, hour) => `2026-10-${day}T${hour}:00:00.000Z`;
  // 한 공부 기록에서 기본복습 기록 3개(각 25분 = 한 덩어리): 5분/P → 4분/P → 2.5분/P
  const logs = [
    { id: 'a', subjectId: 'm', pagesRead: 10, timeSpentMinutes: 25, studyDate: '2026-10-05', timestamp: at('05', '03'), reviewEnabled: true,
      basicReviewTimeRecords: [{ minutes: 25, pages: 5, timestamp: at('06', '03'), reviewNumber: 1 }, { minutes: 25, pages: 6.25, timestamp: at('07', '03'), reviewNumber: 2 }, { minutes: 25, pages: 10, timestamp: at('09', '03'), reviewNumber: 3 }] },
    { id: 'b', subjectId: 'm', pagesRead: 10, timeSpentMinutes: 25, studyDate: '2026-10-06', timestamp: at('06', '04'), reviewEnabled: true },
    { id: 'c', subjectId: 'm', pagesRead: 12, timeSpentMinutes: 25, studyDate: '2026-10-07', timestamp: at('07', '04'), reviewEnabled: true },
    // 다른 과목의 기본복습은 섞이지 않는다
    { id: 'z', subjectId: 'other', pagesRead: 10, timeSpentMinutes: 25, studyDate: '2026-10-05', timestamp: at('05', '03'), basicReviewTimeRecords: [{ minutes: 25, pages: 50, timestamp: at('06', '03') }] }
  ];
  const samples = getBasicReviewSpeedSamples(logs.filter(log => log.subjectId === 'm'));
  assert.equal(samples.length, 3);
  const analysis = analyzeSubjectSpeed([subject], logs, subject);
  const basic = analysis.basicReview;
  assert.equal(basic.series.points.length, 3, 'one speed point per 25 minutes of basic review');
  assert.deepEqual(basic.series.points.map(point => Math.round(point.speed * 10) / 10), [12, 15, 24]);
  assert.equal(Math.round(basic.efficiency * 100) / 100, 2.5, 'efficiency = latest 25 minutes (min per page)');
  assert.equal(analysis.own.series.points.length >= 2, true);
  assert.ok(analysis.own.efficiency > 0);
  assert.equal(analyzeSubjectSpeed([subject], [logs[1]], subject).basicReview.series.points.length, 0, 'no basic review yet → empty');

  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(source.includes('data-testid="basic-review-efficiency"') && source.includes('기본복습 전체 효율') && source.includes('해당 과목 전체 효율'), 'both efficiency values');
  assert.ok(source.includes('data-testid="own-basic-speed"') && source.includes('buildGroupSpeed({ id: `${key}-total`') && source.includes('[unit.series, basicReview.unit.series]'), 'combined graph of the subject and its basic review');
  assert.ok(source.includes('basicReview.subjectName') && source.includes("name: '기본복습'"), 'one row each below the graph');
  assert.ok(source.includes('speedOfSubject ? { subjectName: stage.name || sub.name, unit: speedOfSubject.basicReview } : undefined') && source.indexOf('speedOfSubject ? { subjectName') > source.indexOf('ownValueOpen && renderValueBlock('), 'only the current stage row gets it');
});

test('weekday pages: set per day in steps of the subject\'s page unit right under 한 주 필요 시간; a later plan refresh keeps the page proportions', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { stepWeekdayPages, toggleStudyWeekday, withFreshWeekPlan } = loadSource('utils/weekPlan.ts');
  const { getWeekdayPagePlan, getWeekdayPageStep, calculateFreshWeekdayPagePlan, distributePagesProportionally, getSubjectRemainingPageCount, getDiffDays } = loadSource('utils/schedule.ts');
  const { describePageUnits } = loadSource('components/SpeedPanels.tsx');
  const far = new Date(Date.now() + 80 * 86400e3); const target = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(far.getDate()).padStart(2, '0')}`;
  const base = withFreshWeekPlan({ ...weekSubjects()[0], targetDate: target, scheduledWeekdays: [1, 2, 3], growthPageUnit: 10 });
  const pagesOf = subject => getWeekdayPagePlan(subject, getSubjectRemainingPageCount(subject), getDiffDays(subject.targetDate));
  const sum = plan => Object.values(plan).reduce((a, b) => a + b, 0);
  // 고정 페이지 단위를 없앴으므로 한 번에 1쪽씩
  assert.equal(getWeekdayPageStep({ growthPageUnit: 10 }), 1);
  assert.equal(getWeekdayPageStep({}), 1);
  // + / −: 그 요일만 단위만큼 바뀌고 0 아래로는 안 내려간다
  const before = pagesOf(base);
  const up = stepWeekdayPages(base, 2, 1);
  assert.equal(pagesOf(up)[2], before[2] + 1);
  assert.equal(pagesOf(up)[1], before[1], 'the other days stay');
  let zero = base;
  for (let i = 0; i < 40; i += 1) zero = stepWeekdayPages(zero, 3, -1);
  assert.equal(pagesOf(zero)[3], 0);
  assert.equal(stepWeekdayPages(base, 5, 1), base, 'a rest day cannot be stepped');
  assert.equal(pagesOf(stepWeekdayPages({ ...base, growthPageUnit: 0 }, 1, 1))[1], before[1] + 1, 'no unit → one page at a time');
  // 요일 켜고 끄기: 마지막 하나는 못 끄고, 끄면 남은 요일이 그 비율대로 한 주 몫을 나눠 갖고, 켜면 평균 몫으로 시작
  const lopsided = { ...base, scheduledWeekdayPages: { 1: 40, 2: 20, 3: 20 } };
  const off = toggleStudyWeekday(lopsided, 3);
  assert.deepEqual(off.scheduledWeekdays, [1, 2]);
  const offPages = pagesOf(off);
  assert.ok(offPages[3] === 0 && Math.abs(offPages[1] - 2 * offPages[2]) <= 1, JSON.stringify(offPages));
  assert.equal(sum(offPages), sum(calculateFreshWeekdayPagePlan(withFreshWeekPlan(base), getSubjectRemainingPageCount(base), getDiffDays(base.targetDate))), 'the weekly need is split among the remaining days');
  const on = toggleStudyWeekday(off, 5);
  assert.deepEqual(on.scheduledWeekdays, [1, 2, 5]);
  assert.ok(pagesOf(on)[5] > 0, 'a newly switched-on day gets a share');
  assert.equal(toggleStudyWeekday({ ...base, scheduledWeekdays: [4], scheduledWeekdayPages: { 4: 30 } }, 4).scheduledWeekdays.join(), '4');
  // 계획 갱신: 저장된 페이지 비율을 최대한 그대로 두고 다시 나눈다(과목의 페이지 단위 덩어리로)
  const refreshed = calculateFreshWeekdayPagePlan({ ...base, scheduledWeekdayPages: { 1: 30, 2: 20, 3: 10 } }, 2870, 200);
  assert.deepEqual([refreshed[1], refreshed[2], refreshed[3]], [50, 33, 17], '30:20:10 of 100 pages, as close as whole pages allow');
  assert.ok(Object.keys(refreshed).filter(day => refreshed[day] > 0).join() === '1,2,3');
  // 비율 재료가 없으면 전과 같이 같은 몫
  const equal = calculateFreshWeekdayPagePlan({ ...base, scheduledWeekdayPages: undefined }, 2870, 200);
  assert.ok(Math.max(equal[1], equal[2], equal[3]) - Math.min(equal[1], equal[2], equal[3]) <= 1);
  // 나누기 자체: 합계 보존 · 비율을 최대한 그대로 · 0은 0
  const split = distributePagesProportionally(94, [1, 2, 3], { 1: 60, 2: 30, 3: 10 });
  [[1, 56.4], [2, 28.2], [3, 9.4]].forEach(([day, exact]) => assert.ok(Math.abs(split[day] - exact) < 1, `${day}: ${split[day]} vs ${exact}`));
  assert.equal(sum(split), 94);
  assert.deepEqual([1, 2, 3].map(day => distributePagesProportionally(5, [1, 2, 3], { 1: 3, 2: 1, 3: 1 })[day]), [3, 1, 1]);
  assert.equal(distributePagesProportionally(40, [1, 2], { 1: 0, 2: 5 })[1], 0, 'a day set to 0 stays 0');
  assert.equal(sum(distributePagesProportionally(40, [1, 2], { 1: 0, 2: 0 })), 40, 'all zero → equal split of the total');
  // 단위 말하기
  assert.equal(describePageUnits(20, 10), '2단위'); assert.equal(describePageUnits(24, 10), '2단위+4'); assert.equal(describePageUnits(6, 10), '6'); assert.equal(describePageUnits(20, 1), '');

  // 화면: 평소에는 한 주 필요 시간 밑에 학습 요일 · 요일별 페이지 칸이 없다(과목 카드의 "수정"을 눌러야 나온다). 퍼센트 칸은 없다.
  const Analytics = loadSource('components/Analytics.tsx').Analytics;
  const props = { subjects: [{ ...base, scheduledWeekdayPages: { 1: 30, 2: 24, 3: 10 } }], logs: [], tagDefinitions: [], activeWeekday: 1, activeStudyDate: '2026-10-12',
    onActiveWeekdayChange() {}, onUpdateSubject() {}, onUpdateSubjects() {}, onDeleteSubject() {}, onUpdateTags() {}, onAddSubject() {}, onDeleteFolder() {} };
  const html = renderToStaticMarkup(React.createElement(Analytics, props));
  const card = html.slice(html.indexOf('data-testid="subject-need"'));
  assert.ok(card.includes('data-testid="weekday-need"') && card.includes('하루 평균 시간'), 'the weekly need bar and the time/page boxes stay');
  {
    // 시간 차지 비율 막대가 한 주 필요 시간 막대(h-8)보다 크다
    const { RatioBar, WeekdayNeedBar } = loadSource('components/SpeedPanels.tsx');
    const ratio = renderToStaticMarkup(React.createElement(RatioBar, { large: true, ariaLabel: 'x', segments: [{ id: 'a', name: 'A', value: 3, color: '#2563eb' }, { id: 'b', name: 'B', value: 1, color: '#f97316' }] }));
    const weekly = renderToStaticMarkup(React.createElement(WeekdayNeedBar, { days: [{ weekday: 1, label: '월', minutes: 90 }, { weekday: 2, label: '화', minutes: 60 }] }));
    const heightOf = (markup) => Number((/ (?:min-)?h-(\d+) /.exec(markup) || [])[1]);
    assert.ok(heightOf(ratio) > heightOf(weekly), `ratio bar h-${heightOf(ratio)} vs weekly h-${heightOf(weekly)}`);
    assert.ok(ratio.includes('text-[18px]'), 'the percent text is bigger too');
  }
  assert.ok(!card.includes('data-testid="weekday-pages"') && !card.includes('학습 요일 · 요일별'), 'study weekdays and weekday pages are hidden until 수정 is pressed');
  assert.ok(!card.includes('weekday-ratio'), 'no percent control');
  // 수정 중에 나오는 칸: 학습 요일 · 요일별 페이지와 페이지 옆의 작은 ▲▼(1쪽씩). 페이지 단위(10쪽)씩 올리고 내리는 큰 + / − 버튼은 없다.
  const { WeekdayPagesEditor } = loadSource('components/SpeedPanels.tsx');
  const days = [{ id: 1, label: '월' }, { id: 2, label: '화' }, { id: 3, label: '수' }, { id: 4, label: '목' }];
  const editor = renderToStaticMarkup(React.createElement(WeekdayPagesEditor, { days, selected: [1, 2, 3], pages: { 1: 30, 2: 24, 3: 10 }, pageLabel: 'P', step: 10,
    onToggle() {}, onStep() {} }));
  assert.ok(editor.includes('학습 요일 · 요일별 P') && editor.includes('합계 64P'), 'title and total');
  assert.ok(editor.includes('3단위') && editor.includes('2단위+4') && editor.includes('>쉼<') && editor.includes('aria-pressed="true"'), 'units per day, rest days, weekday toggles');
  assert.equal((editor.match(/data-testid="weekday-pages-value"/g) || []).length, 3);
  assert.equal((editor.match(/data-testid="weekday-pages-up"/g) || []).length, 3, 'a small up button next to each study day page value');
  assert.equal((editor.match(/data-testid="weekday-pages-down"/g) || []).length, 3);
  assert.ok(editor.includes('월요일 1P 늘리기') && editor.includes('월요일 1P 줄이기'), 'the small buttons move one page');
  assert.ok(!editor.includes('10P 늘리기') && !editor.includes('10P 줄이기') && !editor.includes('>+<') && !editor.includes('>−<'), 'no page-unit (10P) steppers any more');
  assert.ok(editor.indexOf('weekday-pages-value') < editor.indexOf('weekday-pages-up'), 'the small buttons sit right beside the page value');
  assert.ok(!editor.includes('%'), 'no percent control');
  // 작은 ▲▼는 단위와 상관없이 1쪽씩
  const unitTen = { ...base, growthPageUnit: 10, scheduledWeekdayPages: { 1: 30, 2: 24, 3: 10 } };
  assert.equal(pagesOf(stepWeekdayPages(unitTen, 1, 1, 1))[1], 31); assert.equal(pagesOf(stepWeekdayPages(unitTen, 1, -1, 1))[1], 29);
  assert.equal(pagesOf(stepWeekdayPages(unitTen, 1, 1))[1], 31, 'the big button steps one page too (no fixed page unit)');
  let floor = unitTen; for (let i = 0; i < 40; i += 1) floor = stepWeekdayPages(floor, 3, -1, 1);
  assert.equal(pagesOf(floor)[3], 0, 'never below 0');
  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(source.includes('if (!isEditing || !original || !onUpdateSubject) return null;'), 'only while the subject is being edited');
  assert.ok(source.includes('onUpdateSubject(toggleStudyWeekday(original, dayId))') && source.includes('onUpdateSubject(stepWeekdayPages(original, dayId, direction, 1))') && !source.includes('onNudge'), 'taps apply to the subject right away, one page at a time');
});

test('note diagram: criteria written with [ ] in toggle titles change the criterion inside that toggle and show as chips; grouping brackets stay grouping', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { parseNoteDiagram, splitTitleCriteria, parseCriterionRelation } = loadSource('utils/noteDiagram.ts');
  const { NoteDiagram } = loadSource('components/NoteTab.tsx');
  // 제목의 분류 기준 [ ]: 여러 번 써도 쓴 순서대로 모두 남고, 기준이 아닌 묶음 대괄호는 건드리지 않는다
  assert.deepEqual(splitTitleCriteria('[원인:결과] 전쟁'), { head: '전쟁', criteria: ['원인:결과'] });
  assert.deepEqual(splitTitleCriteria('[개념:정의] 삼각형 [원인:결과]'), { head: '삼각형', criteria: ['개념:정의', '원인:결과'] });
  assert.deepEqual(splitTitleCriteria('수열의 합;[등차수열:항],[등비수열:공비]'), { head: '수열의 합;[등차수열:항],[등비수열:공비]', criteria: [] }, 'grouping brackets next to ; , are not criteria');
  assert.deepEqual(splitTitleCriteria('[하나] 메모'), { head: '[하나] 메모', criteria: [] }, 'one field is not a criterion');
  assert.deepEqual(parseCriterionRelation('개념:정의;예시'), { labels: ['개념', '정의', '예시'], arrows: ['both', 'forward'] });
  assert.deepEqual(parseCriterionRelation('개념:정의<예시'), { labels: ['개념', '정의', '예시'], arrows: ['both', 'back'] });

  const memo = ':::toggle [원인:결과] 전쟁\n가:나\n:::end\n:::toggle [시기:사건][장소:사건] 혁명 :\nA\nB\n:::end\n:::toggle 그냥 묶음\n다:라\n:::end';
  const items = parseNoteDiagram(memo, '개념:정의');
  assert.equal(items[0].title, '전쟁'); assert.deepEqual(items[0].criteria, ['원인:결과']); assert.deepEqual(items[0].labels, ['원인', '결과']);
  assert.equal(items[1].kind, 'fan'); assert.deepEqual(items[1].criteria, ['시기:사건', '장소:사건']); assert.deepEqual(items[1].labels, ['장소', '사건']); assert.equal(items[1].left, '혁명');
  assert.equal(items[2].criteria, undefined, 'a toggle that does not change the criterion carries none'); assert.equal(items[2].labels, undefined);
  // 안쪽 토글은 바깥 토글이 바꾼 기준을 이어받는다(바꾸지 않으면 표시하지 않는다)
  const nested = parseNoteDiagram(':::toggle [원인:결과] 바깥\n:::toggle 안쪽\n가:나\n:::end\n:::toggle [정의:예시] 다른 안쪽\n다:라\n:::end\n:::end', '개념:정의');
  assert.deepEqual(nested[0].items[0].labels, undefined);
  assert.deepEqual(nested[0].items[1].labels, ['정의', '예시']);
  // {이름}으로 칸 이름만 바꾼 것도 이어받는다
  assert.deepEqual(parseNoteDiagram(':::toggle 뜻 :{예시}\n가\n:::end', '개념:정의')[0].labels, ['개념', '예시']);

  // 포함관계 제목 `A:C`의 칸은 그 토글에서 쓰이는 기준의 칸 이름(분류 관점)을 가진다
  assert.deepEqual(parseNoteDiagram(':::toggle 수열:뜻\n등차수열:차가 일정\n:::end', '개념:정의')[0].fieldLabels, ['개념', '정의']);
  assert.deepEqual(parseNoteDiagram(':::toggle [원인:결과] 전쟁:피해\n가:나\n:::end', '개념:정의')[0].fieldLabels, ['원인', '결과'], 'the toggle own criterion names its own title fields too');
  assert.equal(parseNoteDiagram(':::toggle 수열:뜻\n등차수열:차가 일정\n:::end')[0].fieldLabels, undefined, 'no criterion, no viewpoint names');

  const html = renderToStaticMarkup(React.createElement(NoteDiagram, { memo, criterion: '개념:정의' }));
  assert.equal((html.match(/data-diagram-criteria="true"/g) || []).length, 2, 'one change marker per toggle that changes the criterion');
  assert.equal((html.match(/data-diagram-scope="true"/g) || []).length, 2, 'only the two toggles that changed the criterion are framed; the plain one is not');
  assert.equal((html.match(/data-diagram-criteria="true"[^>]*><span[^>]*>이 토글 안에서만/g) || []).length, 2, 'one scope tag per toggle that changes the criterion (the session card only mentions it in its note)');
  assert.ok(html.includes('data-diagram-session-scope="true"') && html.includes('data-diagram-session-scope-note="true"'), 'the session criterion shows the range it covers: the whole diagram except the toggles that change it');
  assert.ok(html.includes('data-criterion-fields="scoped"') && !html.includes('data-criterion-fields="previous"') && html.includes('원인') && html.includes('장소'), 'toggle criteria are shown as field pills, only the criterion in force is shown');
  assert.ok(!html.includes('[원인:결과]') && !html.includes('[개념:정의]') && !html.includes('[시기:사건]'), 'no [ ] is printed: the diagram shows field names, not the brackets typed in the note');
  assert.ok(!html.includes('data-diagram-criterion-chip="previous"') && html.includes('data-diagram-criterion-chip="current"') && !html.includes('line-through'), 'only the criterion in force is shown: no struck-through earlier criteria');
  assert.ok(!html.includes('[원인:결과] 전쟁'), 'the bracket is no longer part of the printed title');
  // 기준 칸 위치에 맞추지 않는다: 줄마다 자기 칸 수만큼만 쓴다
  assert.ok(!/gridTemplateColumns:[^"]*minmax\(0,1fr\)\s+88px\s+minmax\(0,1fr\)\s+88px\s+minmax\(0,1fr\)/.test(html), 'rows are not stretched to the widest relation');
});

test('note pages follow the subject page unit: one unit per page, and a study that crosses into the next unit goes with its end page', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { groupLogsByPageUnit, lastPageIndex, carriedNoteLogs } = loadSource('utils/noteUnits.ts');
  const { NoteTab, UnitNoteDiagram } = loadSource('components/NoteTab.tsx');
  const log = (id, start, end, day, extra = {}) => ({ id, subjectId: 's', pagesRead: end - start + 1, startPage: start, endPage: end, timeSpentMinutes: 20,
    timestamp: `2026-09-${String(day).padStart(2, '0')}T20:00:00.000Z`, reviewMemo: `${id}:노트`, ...extra });
  const newestFirst = (...items) => items;
  // 단위(10P)마다 한 쪽, 책 순서. 노트를 열면 맨 뒤 쪽(가장 뒤의 단위)
  const plain = groupLogsByPageUnit(newestFirst(log('c', 21, 30, 12), log('b', 11, 20, 11), log('a', 1, 10, 10)), 10, 1, 's');
  assert.deepEqual(plain.map(page => [page.key, page.start, page.end, page.logs.map(l => l.id), page.spanning]),
    [['s:unit:0', 1, 10, ['a'], []], ['s:unit:1', 11, 20, ['b'], []], ['s:unit:2', 21, 30, ['c'], []]]);
  assert.equal(lastPageIndex(plain), 2);
  assert.equal(lastPageIndex([]), 0);
  // 단위는 끝 페이지로 정한다: 10쪽에서 끝나면 앞 단위, 11쪽에서 끝나면 다음 단위
  assert.equal(groupLogsByPageUnit(newestFirst(log('x', 1, 10, 10)), 10)[0].index, 0);
  assert.equal(groupLogsByPageUnit(newestFirst(log('x', 5, 11, 10)), 10)[0].index, 1);
  // 책의 첫 페이지가 1이 아니면 거기서부터 센다
  assert.deepEqual(groupLogsByPageUnit(newestFirst(log('y', 15, 24, 11), log('x', 5, 14, 10)), 10, 5).map(page => [page.start, page.end]), [[5, 14], [15, 24]]);
  // 한 번의 학습이 다음 단위까지 넘어가면: 끝 페이지 단위의 쪽에 한 번만 넣고 "앞 단위에서 시작"으로 표시한다(두 쪽에 겹치지 않는다)
  const crossing = groupLogsByPageUnit(newestFirst(log('d', 28, 34, 13), log('c', 21, 27, 12), log('b', 11, 20, 11)), 10, 1, 's');
  assert.deepEqual(crossing.map(page => [page.index, page.logs.map(l => l.id), page.spanning]), [[1, ['b'], []], [2, ['c'], []], [3, ['d'], ['d']]]);
  assert.equal(crossing.flatMap(page => page.logs).length, 3, 'every record is on exactly one page');
  // 페이지를 적지 않은 기록은 앞선 기록과 같은 쪽에 둔다
  const pageless = groupLogsByPageUnit(newestFirst(log('e', 0, 0, 14, { startPage: undefined, endPage: undefined }), log('d', 28, 34, 13)), 10);
  assert.deepEqual(pageless.map(page => page.logs.map(l => l.id)), [['d', 'e']]);
  // 쪽 안에서도 오래된 기록이 위, 최신 기록이 맨 뒤(받은 순서와 상관없이)
  const sameUnit = groupLogsByPageUnit(newestFirst(log('p3', 17, 20, 13), log('p1', 11, 14, 11), log('p2', 14, 17, 12)), 10);
  assert.deepEqual(sameUnit[0].logs.map(l => l.id), ['p1', 'p2', 'p3']);
  // 단위가 없는 과목이나 페이지를 적은 기록이 없으면 학습한 날마다 한 쪽(날짜 순서, 최근 날이 맨 뒤)
  const days = groupLogsByPageUnit(newestFirst(log('c', 21, 30, 12, { studyDate: '2026-09-12' }), log('b2', 11, 15, 11, { timestamp: '2026-09-11T22:00:00.000Z', studyDate: '2026-09-11' }), log('b1', 6, 10, 11, { timestamp: '2026-09-11T08:00:00.000Z', studyDate: '2026-09-11' }), log('a', 1, 5, 10, { studyDate: '2026-09-10' })), 0, 1, 's');
  assert.deepEqual(days.map(page => [page.key, page.kind, page.index, page.day, page.logs.map(l => l.id)]),
    [['s:day:2026-09-10', 'day', null, '2026-09-10', ['a']], ['s:day:2026-09-11', 'day', null, '2026-09-11', ['b1', 'b2']], ['s:day:2026-09-12', 'day', null, '2026-09-12', ['c']]]);
  assert.equal(lastPageIndex(days), 2);
  assert.equal(groupLogsByPageUnit(newestFirst(log('e', 0, 0, 14, { startPage: undefined, endPage: undefined, studyDate: '2026-09-14' })), 10)[0].kind, 'day');
  assert.deepEqual(groupLogsByPageUnit([], 10), []);

  // 측정 중 이어 쓰는 노트지: 단위가 끝나기 전까지는 같은 단위 쪽의 기록들이 이어지고, 단위의 마지막 페이지까지 갔으면 빈 새 노트지
  const book = [log('a', 1, 10, 10), log('b', 11, 15, 11), log('c', 16, 18, 12)];
  assert.deepEqual(carriedNoteLogs(book, 10, 1, '2026-09-13').map(l => l.id), ['b', 'c'], 'the unfinished unit p.11~20 keeps its sheet');
  assert.deepEqual(carriedNoteLogs([...book, log('d', 19, 20, 13)], 10, 1, '2026-09-14'), [], 'the unit ended at its last page, so the next study gets a blank sheet');
  assert.deepEqual(carriedNoteLogs([...book, log('d', 28, 34, 13)], 10, 1, '2026-09-14').map(l => l.id), ['d'], 'a study that crossed into the next unit continues the sheet of that unit');
  assert.deepEqual(carriedNoteLogs([], 10, 1, '2026-09-14'), []);
  // 단위가 없는 과목은 그날 하루만 이어 쓴다
  const dayBook = [log('a', 1, 5, 10, { studyDate: '2026-09-10' }), log('b', 6, 9, 11, { studyDate: '2026-09-11' }), log('c', 10, 12, 11, { studyDate: '2026-09-11' })];
  assert.deepEqual(carriedNoteLogs(dayBook, 0, 1, '2026-09-11').map(l => l.id), ['b', 'c'], 'today only');
  assert.deepEqual(carriedNoteLogs(dayBook, 0, 1, '2026-09-12'), [], 'a new day starts a blank sheet');

  // 쪽 나누기: 쪽당 행 수를 미리 정해 두고(구역 제목 1행 + 기록 줄 수, 구역 사이 1행) 그 안에서 구역을 담는다
  const { paginateNoteSections, estimateMemoRows, NOTE_PAGE_ROWS } = loadSource('utils/noteUnits.ts');
  assert.equal(NOTE_PAGE_ROWS, 12, 'one page holds at most 12 rows');
  assert.equal(estimateMemoRows(''), 1);
  assert.equal(estimateMemoRows('가:나'), 1);
  assert.equal(estimateMemoRows('가:나\n다:라\n마:바'), 3);
  assert.equal(estimateMemoRows(':::toggle X:Y\nP:Q\n:::end'), 2, 'the closing line of a toggle has no row');
  assert.equal(estimateMemoRows('가'.repeat(40)), 2, 'a long line wraps onto a second row');
  const sameDay = (id, start, end, memo, day = 12) => log(id, start, end, day, { studyDate: `2026-09-${day}`, reviewMemo: memo });
  const unitOf = (...logs) => groupLogsByPageUnit(logs, 10, 1, 's');
  // 짧은 단위들은 한 쪽에 여러 개(2행짜리 구역 4개 = 11행), 다섯째부터 다음 쪽
  const shortUnits = unitOf(...[0, 1, 2, 3, 4].map(i => sameDay(`u${i}`, i * 10 + 1, i * 10 + 10, '가:나', 10 + i)));
  const shortPages = paginateNoteSections(shortUnits);
  assert.deepEqual(shortPages.map(page => page.sections.map(section => section.index)), [[0, 1, 2, 3], [4]]);
  assert.deepEqual(shortPages.map(page => page.rows), [11, 2]);
  assert.ok(shortPages.every(page => page.rows <= NOTE_PAGE_ROWS));
  // 한 쪽에 통째로 들어가는 단위는 쪼개지 않고 다음 쪽으로 보낸다(6행 + 6행은 한 쪽에 안 들어간다)
  const wholeUnits = paginateNoteSections(unitOf(...[0, 1].flatMap(i => [0, 1, 2].map(j => sameDay(`w${i}${j}`, i * 10 + j * 3 + 1, i * 10 + j * 3 + 3, '가:나', 12)))));
  assert.deepEqual(wholeUnits.map(page => page.sections.map(section => [section.index, section.entries.length, section.continued])), [[[0, 3, false]], [[1, 3, false]]]);
  // 한 쪽보다 긴 단위는 기록 단위로 나뉘어 이어지고 뒤 쪽 제목에 "이어서"가 붙는다
  const longUnit = paginateNoteSections(unitOf(...[0, 1, 2, 3, 4, 5, 6].map(i => sameDay(`l${i}`, 1 + i, 2 + i, '가:나\n다:라')).map((item, i) => ({ ...item, endPage: 9, startPage: 1 + i }))));
  assert.deepEqual(longUnit.map(page => page.sections.map(section => [section.entries.length, section.continued])), [[[4, false]], [[3, true]]]);
  assert.deepEqual(longUnit.flatMap(page => page.sections.flatMap(section => section.entries.map(entry => entry.log.id))), ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'], 'every record is on exactly one page, in order');
  // 기록 하나가 한 쪽보다 길면 그 기록 혼자 한 쪽을 쓴다
  const huge = paginateNoteSections(unitOf(sameDay('h1', 1, 5, Array.from({ length: 20 }, (_, i) => `줄${i}:값`).join('\n')), sameDay('h2', 6, 10, '가:나')));
  assert.deepEqual(huge.map(page => page.sections.map(section => section.entries.map(entry => entry.log.id))), [[['h1']], [['h2']]]);
  // 편집 중 행 수를 고정하려고 기록별 행 수를 따로 줄 수 있다
  const fixed = paginateNoteSections(unitOf(sameDay('f1', 1, 5, '가:나\n다:라\n마:바\n사:아\n자:차\n카:타\n파:하\n거:너\n더:러'), sameDay('f2', 6, 10, '가:나')), NOTE_PAGE_ROWS, () => 1);
  assert.equal(fixed.length, 1, 'with the row counts frozen at 1 the longer text does not move records to another page');
  assert.deepEqual(paginateNoteSections([]), []);
  // 단위가 없으면 하루가 한 구역이고 같은 방식으로 담긴다
  const dayPages = paginateNoteSections(groupLogsByPageUnit([sameDay('d1', 1, 5, '가:나', 10), sameDay('d2', 6, 9, '다:라', 11), sameDay('d3', 10, 12, '마:바', 12)], 0, 1, 's'));
  assert.deepEqual(dayPages.map(page => page.sections.map(section => [section.kind, section.day])), [[['day', '2026-09-10'], ['day', '2026-09-11'], ['day', '2026-09-12']]]);

  // 화면: 짧은 두 단위가 한 쪽에 같이 들어가고, 각 단위 위에 "N번째 단위"가 조금 큰 글씨로 있다
  const unitSubjects = [{ id: 's', name: '수학', totalPages: 100, completedPages: 34, targetDate: '2026-10-31', growthPageUnit: 10 }];
  // 단위는 "복습에 넣기" 사이: c를 12일에 복습에 넣고 d를 13일에 넣었다 → 1번째 단위(c, p.21~27) · 2번째 단위(d, p.28~34)
  const html = renderToStaticMarkup(React.createElement(NoteTab, { logs: [log('d', 28, 34, 13, { reviewMemo: '마지막:노트', reviewRegisteredAt: '2026-09-13T22:00:00.000Z' }), log('c', 21, 27, 12, { reviewMemo: '앞쪽:노트', reviewRegisteredAt: '2026-09-12T22:00:00.000Z' })], subjects: unitSubjects, onUpdateReviewMemo() {} }));
  assert.ok(html.includes('data-note-unit-number="1"') && html.includes('data-note-unit-number="2"') && html.includes('1번째 단위') && html.includes('2번째 단위') && html.includes('p.21~27') && html.includes('p.28~34'), 'both units are on the one page, each with its number and page range');
  assert.ok(html.indexOf('앞쪽') < html.indexOf('마지막'), 'the older unit is above the newer one');
  assert.ok(/data-note-heading="unit"[^>]*class="[^"]*"/.test(html) && html.includes('text-xl font-black text-indigo-900'), 'the unit number is a little bigger than the note text');
  assert.ok(!html.includes('data-unit-spanning-log="true"'), 'a unit is split by time, so no study crosses two units');
  assert.ok(!html.includes('data-testid="unit-bar"') && !html.includes('다음 단위 ▶') && html.includes('data-testid="note-pager"') && html.includes('1 / 1 쪽'), 'no unit stepper, only the page pager');
  assert.ok(!html.includes('data-note-day='), 'a unit page has no date tags');
  const noUnit = renderToStaticMarkup(React.createElement(NoteTab, { logs: [log('b', 11, 20, 11, { studyDate: '2026-09-11' }), log('a', 1, 10, 10, { studyDate: '2026-09-10' })], subjects: [{ ...unitSubjects[0], growthPageUnit: 0 }], onUpdateReviewMemo() {} }));
  assert.ok(!noUnit.includes('data-note-unit-number') && noUnit.includes('data-note-day-heading="2026-09-10"') && noUnit.includes('data-note-day-heading="2026-09-11"') && noUnit.includes('9월 11일 (금)') && noUnit.includes('9월 10일 (목)'), 'a subject without a page unit uses the day as its unit, with a simple date on top');
  assert.ok(noUnit.indexOf('a:노트') < noUnit.indexOf('b:노트'), 'oldest day first');
  const pagerButton = (markup, label) => (new RegExp(`<button[^>]*>${label}</button>`).exec(markup) || [''])[0];
  assert.ok(/ disabled=""/.test(pagerButton(noUnit, '◀ 이전 쪽')) && / disabled=""/.test(pagerButton(noUnit, '다음 쪽 ▶')), 'with only one page both buttons stay closed');
  // 쪽이 여러 개면 맨 뒤 쪽(가장 최근)이 열리고 앞 쪽으로 갈 수 있다
  const bigMemo = Array.from({ length: 6 }, (_, i) => `줄${i}:값`).join('\n');
  const manyDays = [10, 11, 12, 13].map(day => log(`m${day}`, day * 2, day * 2 + 1, day, { studyDate: `2026-09-${day}`, reviewMemo: `${day}일:${bigMemo}` }));
  const multi = renderToStaticMarkup(React.createElement(NoteTab, { logs: manyDays, subjects: [{ ...unitSubjects[0], growthPageUnit: 0 }], onUpdateReviewMemo() {} }));
  assert.ok(multi.includes('13일:') && !multi.includes('12일:') && multi.includes('4 / 4 쪽'), 'the last page opens first');
  assert.ok(!/ disabled=""/.test(pagerButton(multi, '◀ 이전 쪽')) && / disabled=""/.test(pagerButton(multi, '다음 쪽 ▶')), 'previous page is open, nothing after the last page');
  // 한 단위 안에서 여러 날에 걸쳐도 날짜는 달지 않고, 오래된 기록이 위
  const order = renderToStaticMarkup(React.createElement(NoteTab, { logs: [log('p3', 17, 20, 13, { reviewMemo: '셋째:노트', studyDate: '2026-09-13', reviewRegisteredAt: '2026-09-14T00:00:00.000Z' }), log('p1', 11, 14, 11, { reviewMemo: '첫째:노트', studyDate: '2026-09-11', reviewRegisteredAt: '2026-09-14T00:00:00.000Z' }), log('p2', 14, 17, 12, { reviewMemo: '둘째:노트', studyDate: '2026-09-12', reviewRegisteredAt: '2026-09-14T00:00:00.000Z' })], subjects: unitSubjects, onUpdateReviewMemo() {} }));
  assert.ok(order.indexOf('첫째') < order.indexOf('둘째') && order.indexOf('둘째') < order.indexOf('셋째'), 'the newest record is last on the page');
  assert.equal((order.match(/data-note-day=/g) || []).length, 0, 'a unit that spans several days still shows only its unit number, no dates');
  assert.equal((order.match(/data-note-heading="unit"/g) || []).length, 1);

  // 관계도: 같은 쪽을 보여 주고 구역마다 같은 제목을 단다. 세션 기준은 맨 위에 한 번
  const { NoteSheetDiagram } = loadSource('components/NoteTab.tsx');
  const diagramPage = paginateNoteSections(unitOf(sameDay('g1', 21, 30, '등차수열:차가 일정\n:::toggle A;\nB\nC\n:::end', 12), sameDay('g2', 31, 40, ':::toggle X:Y\nP:Q\n:::end', 13)))[0];
  const map = renderToStaticMarkup(React.createElement(NoteSheetDiagram, { page: diagramPage, criterion: '개념:정의', rows: 14 }));
  assert.equal((map.match(/data-diagram-criterion="session"/g) || []).length, 1, 'the criterion is shown once above the page');
  assert.ok(map.includes('3번째 단위') && map.includes('4번째 단위') && map.includes('data-diagram-row="fan"') && map.includes('data-diagram-row="relation"'), 'each unit of the page is drawn under its heading');
  assert.ok(map.includes('overflow-y-auto') && !map.includes('note-pager'), 'the page scrolls on its own only when it is longer than the screen; the pager is outside');
  assert.ok(map.indexOf('data-diagram-criterion="session"') < map.indexOf('overflow-y-auto'), 'the criterion stays above the scrolling part');
  assert.ok(renderToStaticMarkup(React.createElement(NoteSheetDiagram, { page: { key: 'k', rows: 2, sections: [{ ...diagramPage.sections[0], entries: [{ log: sameDay('z', 1, 2, ''), spanning: false }] }] }, criterion: null, rows: 14 })).includes('그릴 내용이 아직 없어요'));
  const tabSource = fs.readFileSync(path.resolve(__dirname, '../components/NoteTab.tsx'), 'utf8');
  assert.ok(tabSource.includes('paginateNoteSections') && tabSource.includes('<NoteSheetDiagram') && tabSource.includes('<SheetPager') && !tabSource.includes('<UnitBar') && !tabSource.includes('UnitNoteDiagram') && !tabSource.includes('goUnit'), 'notes and the diagram share the same pages; the unit bar is gone');
  assert.ok(tabSource.includes('lastPageIndex') && tabSource.includes('rowCache') && tabSource.includes("'ArrowRight'") && tabSource.includes('onTouchEnd'), 'the note opens on the last page, row counts stay frozen while editing, and the diagram turns with arrow keys and a swipe');
});

test('measuring note sheet carries over until the page unit ends: only the newly written part is saved, edits go back to the record that holds them', () => {
  const { mergeSheetParts, splitNoteSheet } = loadSource('utils/noteSheet.ts');
  const parts = [
    { logId: 'a', memo: '등차수열:차가 일정\n등비수열:비가 일정' },
    { logId: 'b', memo: ':::toggle 함수\n정의역:공역\n:::end' },
    { logId: 'c', memo: '  \n마지막 줄\n' }
  ];
  const sheet = mergeSheetParts(parts);
  assert.equal(sheet, '등차수열:차가 일정\n등비수열:비가 일정\n\n:::toggle 함수\n정의역:공역\n:::end\n\n마지막 줄', 'oldest first, one blank line between records, blank records skipped');
  assert.equal(mergeSheetParts([{ logId: 'x', memo: '   ' }]), '');
  // 아무것도 안 고치면 이번 기록에 담을 것도, 고칠 이전 기록도 없다
  assert.deepEqual(splitNoteSheet(parts, sheet), { added: '', updates: [] });
  // 끝에 이어 쓰면 이번 기록의 노트가 된다(이미 저장된 글은 겹쳐 저장하지 않는다)
  assert.deepEqual(splitNoteSheet(parts, `${sheet}\n\n새로 쓴:글\n둘째 줄`), { added: '새로 쓴:글\n둘째 줄', updates: [] });
  assert.deepEqual(splitNoteSheet(parts, `${sheet}\n새로 쓴:글`), { added: '새로 쓴:글', updates: [] });
  // 앞부분을 고치면 그 글이 있던 기록이 고쳐지고, 이어 쓴 글은 이번 기록에 담긴다
  const edited = sheet.replace('등비수열:비가 일정', '등비수열:공비가 일정') + '\n\n새로 쓴:글';
  assert.deepEqual(splitNoteSheet(parts, edited), { added: '새로 쓴:글', updates: [{ logId: 'a', memo: '등차수열:차가 일정\n등비수열:공비가 일정' }] });
  // 기록 사이에 끼워 쓰거나 지우기
  assert.deepEqual(splitNoteSheet(parts, sheet.replace('정의역:공역\n', '정의역:공역\n치역:함숫값\n')), { added: '', updates: [{ logId: 'b', memo: ':::toggle 함수\n정의역:공역\n치역:함숫값\n:::end' }] });
  assert.deepEqual(splitNoteSheet(parts, sheet.replace('\n\n:::toggle 함수\n정의역:공역\n:::end', '')), { added: '', updates: [{ logId: 'b', memo: '' }] }, 'deleting a whole record note empties that record only');
  // 전부 지우고 새로 쓰면 이전 기록은 비우고 새로 쓴 글은 이번 기록에 담긴다(같은 글이 겹치지 않는다)
  assert.deepEqual(splitNoteSheet(parts, '처음부터:다시'), { added: '처음부터:다시', updates: [{ logId: 'a', memo: '' }, { logId: 'b', memo: '' }, { logId: 'c', memo: '마지막 줄'.slice(0, 0) }] });
  // 이어 쓴 기록이 없으면 그냥 이번 노트
  assert.deepEqual(splitNoteSheet([], '\n가:나\n'), { added: '가:나', updates: [] });
  assert.deepEqual(splitNoteSheet([], ''), { added: '', updates: [] });
  // 어떤 경우에도 저장된 글을 합치면 노트지와 같다(빠지거나 겹치는 글이 없다)
  const rebuild = (split) => mergeSheetParts([...parts.map(part => ({ logId: part.logId, memo: (split.updates.find(update => update.logId === part.logId) || part).memo })), { logId: 'new', memo: split.added }]);
  [edited, `${sheet}\n\n하나`, sheet.replace('마지막 줄', '고친 줄\n붙인 줄'), '완전히:새로'].forEach(text => {
    assert.equal(rebuild(splitNoteSheet(parts, text)), mergeSheetParts([{ logId: 'x', memo: text }]), text);
  });

  // 측정 화면 연결: 학습을 시작할 때 이어 쓸 노트로 채우고, 저장할 때 새로 쓴 부분만 기록에 담는다
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('carriedNoteLogs(') && logger.includes('seedCarriedNoteSheet();') && logger.includes('mergeSheetParts(parts)'), 'the sheet is filled when a study starts');
  assert.ok(logger.includes('splitNoteSheet(carriedParts, reviewMemo)') && logger.includes('reviewMemo: savedMemo || undefined') && logger.includes('applyCarriedSheetEdits();'), 'only the new part is saved and edited older records are updated');
  assert.equal((logger.match(/applyCarriedSheetEdits\(\);/g) || []).length, 2, 'both save paths (normal save and review-run hand-off) apply the edits');
});

test('logical words inside a diagram cell are split into named, colored chips with the same precedence as the questions', () => {
  const { parseLogicText } = loadSource('utils/noteDiagram.ts');
  const text = value => ({ kind: 'text', text: value });
  assert.deepEqual(parseLogicText('그냥 글'), text('그냥 글'));
  assert.deepEqual(parseLogicText('가, 나'), { kind: 'op', operator: 'and', items: [text('가'), text('나')] });
  assert.deepEqual(parseLogicText('가 = 나'), { kind: 'op', operator: 'equal', items: [text('가'), text('나')] }, '= does not split columns; inside a cell it is a logic word like , and -');
  // = 는 - 와 , 보다 단단히 묶인다
  assert.deepEqual(parseLogicText('가 - 나 = 다'), { kind: 'op', operator: 'sequence', items: [text('가'), { kind: 'op', operator: 'equal', items: [text('나'), text('다')] }] });
  assert.deepEqual(parseLogicText('준비 - 실행 - 정리'), { kind: 'op', operator: 'sequence', items: [text('준비'), text('실행'), text('정리')] });
  // - 가 , 보다 단단히 묶인다
  assert.deepEqual(parseLogicText('가, 나 - 다 - 라'), { kind: 'op', operator: 'and', items: [text('가'),
    { kind: 'op', operator: 'sequence', items: [text('나'), text('다'), text('라')] }] });
  // 묶음 [ ] 과 줄 전체를 감싼 ( ) 는 한 덩어리
  assert.deepEqual(parseLogicText('[가, 나], 다'), { kind: 'op', operator: 'and', items: [
    { kind: 'group', inner: { kind: 'op', operator: 'and', items: [text('가'), text('나')] } }, text('다')] });
  assert.deepEqual(parseLogicText('(가, 나), 다').items[0], { kind: 'group', inner: { kind: 'op', operator: 'and', items: [text('가'), text('나')] } });
  assert.deepEqual(parseLogicText('(가 : 나)'), text('(가 : 나)'), 'a wrapped row without logical words stays plain text');
  assert.deepEqual(parseLogicText('f(x, y) 의 값'), { kind: 'text', text: 'f(x, y) 의 값' }, 'commas inside a closed ( ) are not split');
  assert.deepEqual(parseLogicText('(열린 괄호, 나'), { kind: 'op', operator: 'and', items: [text('(열린 괄호'), text('나')] }, 'an unmatched ( does not swallow the rest');

  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteDiagram } = loadSource('components/NoteTab.tsx');
  const html = renderToStaticMarkup(React.createElement(NoteDiagram, { memo: '원인 : 가, 나 - 다\n일반 : 평범한 글' }));
  assert.ok(html.includes('data-logic-operator="and"') && !html.includes('data-logic-operator="or"') && html.includes('data-logic-operator="sequence"'), 'each logical word has its own chip, and there is no OR inside a cell any more');
  assert.ok(html.includes('그리고') && html.includes('다음') && html.includes('data-logic-nested="true"'), 'named chips; a tighter group inside another is framed');
  assert.ok(html.includes('bg-teal-100') && html.includes('bg-sky-100'), 'and / order use different colors');
  assert.ok(!html.includes('평범한 글</span>') || !/data-logic="[a-z]+"[^>]*>[^<]*평범한/.test(html), 'plain cells are not wrapped');
});

test('a slash separates statements only when written twice (//); a single slash is plain text', () => {
  const { parseNoteDiagram } = loadSource('utils/noteDiagram.ts');
  const prompts = memo => questionsFor(memo).filter(item => item.kind === 'direct').map(item => item.prompt);
  assert.deepEqual(prompts('속도:km/h'), ['속도']);
  assert.deepEqual(questionsFor('속도:km/h').filter(item => item.kind === 'direct').map(item => item.answer), ['km/h']);
  assert.deepEqual(prompts('a:b//c:d'), ['a', 'c']);
  assert.deepEqual(prompts('a:b // c:d'), ['a', 'c']);
  assert.equal(parseNoteDiagram('속도:km/h').length, 1);
  assert.equal(parseNoteDiagram('a:b // c:d').length, 2);
});

test('fill-in-the-blank questions: the rest of a chain is shown; one blank moves right, then fewer clues, and only then more blanks', () => {
  const blanks = memo => questionsFor(memo).filter(q => q.kind === 'blank');
  assert.equal(blanks('A:B').length, 0, 'a pair has no blank type');
  const three = blanks('A:B:C');
  assert.deepEqual(three.slice(0, 3).map(q => [q.prompt, q.answer]), [['＿ → B → C', 'A'], ['A → ＿ → C', 'B'], ['A → B → ＿', 'C']]);
  const four = blanks('A:B:C:D');
  const fullClues = four.filter(q => !q.answer.includes('→') && !q.prompt.includes('…'));
  assert.deepEqual(fullClues.map(q => q.answer), ['A', 'B', 'C', 'D'], 'one blank moves to the right as it gets harder');
  const fewerClues = four.filter(q => !q.answer.includes('→') && q.prompt.includes('…'));
  const moreBlanks = four.filter(q => q.answer.includes('→'));
  const top = list => Math.max(...list.map(q => q.difficulty)), low = list => Math.min(...list.map(q => q.difficulty));
  assert.ok(low(fewerClues) > top(fullClues) && fewerClues.length > 0, 'hiding clues is harder than showing them all');
  assert.ok(low(moreBlanks) > low(fewerClues) && moreBlanks.some(q => q.difficulty > top(fewerClues)), 'adding blanks is the harder step');
  assert.ok(four.some(q => q.prompt === '… → B → ＿ → D'), 'clues farthest from the blank are hidden first');
  const sorted = [...four].sort((a, b) => a.difficulty - b.difficulty);
  assert.deepEqual(sorted.map(q => q.level), [...sorted.map(q => q.level)].sort(), 'levels never go down with difficulty');
});

test('practice starts with the easiest question of the note and moves to harder types as answers come right', () => {
  const all = questionsFor('A:B:C:D');
  const catalog = all.map((q, i) => ({ id: String(i), logId: 'a', level: q.level, priority: q.priority, difficulty: q.difficulty,
    recallUnits: q.recallUnits, providedUnits: q.providedUnits, blankStart: q.blankStart }));
  const state = practice.startReviewPractice(catalog, { a: 3 });
  const first = all[Number(state.queue[0])];
  const firstGroup = all.filter(q => q.priority === 1);
  assert.equal(first.difficulty, Math.min(...firstGroup.map(q => q.difficulty)));
  assert.ok(['direct', 'blank', 'order-next', 'remaining', 'alternative'].includes(first.kind) && first.direction === 'forward', 'it is a forward one-step question');
  const easy = practice.gradeReviewPractice(state, catalog, 'easy');
  assert.ok(all[Number(easy.queue[0])].difficulty >= first.difficulty);
});

test('far questions: one answer several steps away, the process is shown with the answer, and harder steps have fewer questions', () => {
  const far = (memo, distance) => questionsFor(memo).filter(q => q.kind === 'far' && (distance === undefined || q.distance === distance));
  assert.equal(far('A:B').length, 0, 'a pair has nothing far away');
  assert.equal(far('A:B:C').length, 2, 'A→C and C→A');
  const forward = far('A:B:C:D').filter(q => q.direction === 'forward');
  assert.deepEqual(forward.map(q => [q.prompt, q.answer, q.process, q.distance]),
    [['A', 'C', 'A → B → C', 2], ['B', 'D', 'B → C → D', 2], ['A', 'D', 'A → B → C → D', 3]]);
  const counts = [2, 3].map(distance => far('A:B:C:D', distance).length);
  assert.deepEqual(counts, [4, 2], 'fewer questions the farther the answer is');
  assert.ok(far('A:B:C:D').every(q => q.columns.prompt.length === 1 && q.columns.answer.length === 1), 'one condition, one answer, each with its own classification');
  assert.ok(far('A:B:C:D').every(q => !q.prompt.includes('B') || q.prompt === 'B' || q.direction === 'reverse'), 'middle values are never given');
  const direct = questionsFor('A:B:C:D').find(q => q.kind === 'direct');
  assert.ok(far('A:B:C:D', 2).every(q => q.difficulty > direct.difficulty) && far('A:B:C:D', 3)[0].difficulty > far('A:B:C:D', 2)[0].difficulty, 'more steps is harder');
  const oneWay = far('A<B:C:D');
  assert.ok(!oneWay.some(q => q.direction === 'forward' && q.answer === 'D' && q.prompt === 'A') && oneWay.some(q => q.prompt === 'D' && q.answer === 'A'),
    'a reverse (<) step is only walked backwards: D reaches A, A never reaches D');
  const forwardWay = far('A;B:C:D');
  assert.ok(forwardWay.some(q => q.prompt === 'A' && q.answer === 'D') && !forwardWay.some(q => q.prompt === 'D' && q.answer === 'A'),
    'a ; step is only walked forwards: A reaches D, D never reaches A');
  assert.ok(oneWay.some(q => q.prompt === 'B' && q.answer === 'D') && oneWay.some(q => q.prompt === 'D' && q.answer === 'B'), 'the all-colon stretch goes both ways');
  assert.ok(forwardWay.some(q => q.prompt === 'B' && q.answer === 'D') && forwardWay.some(q => q.prompt === 'D' && q.answer === 'B'), 'the all-colon stretch goes both ways');
  const withParent = far(':::toggle 조건\nA:B:C\n:::end');
  assert.ok(withParent.length > 0 && withParent.every(q => q.conditions.includes('조건')), 'parent toggle titles are still conditions');
  const nested = far('A:[B:[C:D]]');
  assert.ok(nested.some(q => q.prompt === 'A' && q.answer === 'D' && q.process === 'A → B → C → D'), 'a chain continues through a last-cell relation');
  assert.ok(!nested.some(q => q.prompt === 'D' && q.direction === 'reverse' && (q.answer === 'A' || q.answer === 'B')), 'a grouped relation can be entered but not walked back out of');
  assert.ok(nested.some(q => q.prompt === 'C' && q.answer === 'D') === false, 'a pair has nothing far away');
  assert.ok(nested.filter(q => q.prompt === 'B' && q.answer === 'D').every(q => q.conditions.includes('A')), 'a chain inside carries the outer cell as a condition');
  const sequence = far('A-B-C-D', 2).filter(q => q.direction === 'forward');
  assert.deepEqual(sequence.map(q => q.process), ['A → B → C', 'B → C → D']);
  const group = far('A:(B,(K,F)):H');
  assert.ok(group.some(q => q.prompt === 'A' && q.answer === 'H' && q.process === 'A → B AND K AND F → H'), 'several values derived together lead to one answer');
  assert.ok(questionsFor('A:B:C:D').filter(q => q.kind === 'far').every(q => q.process.split(' → ').length === q.distance + 1), 'the process lists every step');
});

test('= is a classification-free logic word inside one cell: A:B=C is the cells A and "B = C", and inside a cell = comes before - and ,', () => {
  const direct = memo => questionsFor(memo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer, q.priority, q.conditions]);
  // `A:F=G`는 `A`와 `F=G` 두 칸이다: A를 보고 "F = G" 전체를 맞힌다(칸을 더 나누지 않는다)
  assert.deepEqual(direct('A:F=G').filter(item => item[0] === 'A'), [['A', 'F = G', 1, []]]);
  assert.ok(questionsFor('A:F=G').some(q => q.kind === 'reverse' && q.prompt === 'F = G' && q.answer === 'A'));
  // 칸 안에서는 이웃한 값끼리 앞으로도 거꾸로도 이어진다(칸이 놓인 자리 A가 조건)
  assert.deepEqual(direct('A:F=G').filter(item => item[0] === 'F'), [['F', 'G', 1, ['A']]]);
  assert.ok(questionsFor('A:F=G').some(q => q.kind === 'reverse' && q.prompt === 'G' && q.answer === 'F' && q.conditions.join() === 'A'));
  assert.deepEqual(direct('A=B'), [['A', 'B', 1, []]]);
  assert.deepEqual(direct('A=B=C').map(item => item.slice(0, 3)), [['A', 'B', 1], ['B', 'C', 1]]);
  assert.ok(!questionsFor('A:F=G').some(q => q.kind === 'alternative' || q.kind === 'remaining'), '= is not an OR and not an AND list');
  // 분류기준 이름은 `:` 칸만 센다: `A:F=G:H`의 칸은 A · F=G · H
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:정의:예시', q);
  const cells = questionsFor('A:F=G:H').filter(q => q.kind === 'direct');
  const outer = cells.find(q => q.prompt === 'A');
  const next = cells.find(q => q.prompt === 'F = G');
  assert.deepEqual(classify(outer), { prompt: ['개념'], answer: ['정의'], conditions: [] });
  assert.deepEqual(classify(next), { prompt: ['정의'], answer: ['예시'], conditions: [] });
  // 한 칸 안의 논리어 중 `=`가 `-`·`,`보다 중요도가 높아 먼저 낸다(선 출제)
  const mixed = questionsFor('A:B-C=D');
  const equal = mixed.find(q => q.kind === 'direct' && q.prompt === 'C' && q.answer === 'D');
  const order = mixed.find(q => q.kind === 'order-next');
  assert.ok(equal.importance < order.importance && mixed.indexOf(equal) < mixed.indexOf(order));
  // 모든 칸에 집합이 있는 `=`는 분류기준 없는 `:`다: 능력 변환 단위 문제
  const sets = questionsFor('[a] b = [c] d').filter(q => q.kind === 'convert');
  assert.deepEqual(sets.map(q => [q.prompt, q.answer]), [['b', 'd'], ['d', 'b']]);
  // `[a] X=y`는 a 안에서 X와 y가 같다: 조건 a
  assert.deepEqual(direct('[a] X=y'), [['X', 'y', 1, ['a']]]);
});

test('pair tiers: important + important first, important + less second, less + less third', () => {
  const tiers = memo => Object.fromEntries(questionsFor(memo).filter(q => q.kind === 'direct').map(q => [q.prompt + q.answer, q.priority]));
  assert.deepEqual(tiers('A:B:C:D'), { AB: 1, BC: 2, CD: 3 });
  assert.deepEqual(tiers('A:B=C'), { 'AB = C': 1, BC: 1 });
  assert.deepEqual(tiers('A:B:C=D'), { AB: 1, 'BC = D': 2, CD: 3 });
  const far = questionsFor('A:B:C:D').filter(q => q.kind === 'far');
  assert.deepEqual(far.map(q => [q.prompt + q.answer, q.priority]).sort(), [['AC', 2], ['AD', 2], ['BD', 2], ['CA', 2], ['DA', 2], ['DB', 2]].sort());
  // 변주(빈칸·전체 재구성)는 난도만 다르고 중요도는 기본 문제의 것을 따른다: 한 행 전체를 떠올리는 문제와 같은 묶음
  const variants = questionsFor('A:B:C').filter(q => q.kind === 'blank' || q.kind === 'reconstruct');
  assert.ok(variants.length > 0 && variants.every(q => q.priority === 2 && q.importance === 2));
  assert.ok(new Set(variants.map(q => q.level)).size > 1, 'variations differ in difficulty only');
});

test('blank questions are only asked when the shown conditions determine the answer through the relation direction', () => {
  const prompts = memo => questionsFor(memo).filter(q => q.kind === 'blank').map(q => q.prompt);
  assert.ok(prompts('A<B<C').includes('＿ → B → C') && prompts('A<B<C').includes('A → ＿ → C'), 'a reverse relation is walked backwards');
  assert.ok(!prompts('A<B<C').includes('A → B → ＿'), 'C cannot be found from B when B<C only points back');
  assert.ok(prompts('A<B:C').includes('＿ → B → C'), 'A is found from B through "<"');
  assert.ok(prompts('A:B<C').includes('＿ → B → C'), 'A:B can be asked backwards');
  assert.ok(!prompts('A:B<C').includes('A → B → ＿'), 'C is not found from B when B<C is one way back');
  assert.ok(prompts('A;B;C').includes('A → B → ＿') && prompts('A;B;C').includes('A → ＿ → C'), 'a ; relation is walked forwards');
  assert.ok(!prompts('A;B;C').includes('＿ → B → C'), 'A cannot be found from B when A;B only points forward');
  assert.ok(prompts('A:B;C').includes('A → B → ＿'), 'A:B;C walks forward to C');
  assert.ok(prompts('A:B;C').includes('＿ → B → C'), 'A:B can still be asked backwards');
  assert.ok(prompts('A;B:C').includes('A → B → ＿') && !prompts('A;B:C').includes('＿ → B → C'), 'A;B is one way forward, so A is not found back from B');
  assert.ok(prompts('A:B:C').includes('A → B → ＿') && prompts('A:B:C').includes('A → ＿ → C'), 'forward questions stay');
  const withParent = questionsFor(':::toggle 조건\nA:B:C\n:::end').filter(q => q.kind === 'blank');
  assert.ok(withParent.length > 0 && withParent.every(q => q.conditions.includes('조건')), 'blank questions keep the parent toggle conditions');
});

test('importance stays ahead of difficulty even when easy answers jump ahead', () => {
  const catalog = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: 'p1-' + i, logId: 'a', level: 1, priority: 1, difficulty: (i + 1) / 10 })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'p2-' + i, logId: 'a', level: 1, priority: 2, difficulty: (i + 1) / 10 }))
  ];
  let state = practice.startReviewPractice(catalog, { a: 3 });
  const visited = [];
  while (state.queue.length && visited.length < 40) { visited.push(state.queue[0]); state = practice.gradeReviewPractice(state, catalog, 'easy'); }
  const firstSecond = visited.findIndex(id => id.startsWith('p2'));
  assert.ok(firstSecond === 6 && visited.slice(0, 6).every(id => id.startsWith('p1')), 'all priority-1 questions come before any priority-2 question');
});

test('the process of a question sits behind a "풀이 과정" button that appears only after the answer is revealed', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const { ProcessToggle } = loadSource('components/ProcessToggle.tsx');
  const far = questionsFor('A:B:C:D').find(q => q.kind === 'far' && q.prompt === 'A' && q.answer === 'D');
  const hidden = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: far, criterion: '개념:정의:예:쓰임', revealed: false, memo: 'A:B:C:D' }));
  assert.ok(!hidden.includes('data-process-button') && !hidden.includes('A → B → C → D') && hidden.includes('연결 추론'));
  const shown = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: far, criterion: '개념:정의:예:쓰임', revealed: true, memo: 'A:B:C:D' }));
  assert.ok(shown.includes('data-process-button="true"') && shown.includes('풀이 과정 보기') && shown.includes('aria-expanded="false"'), 'revealed: the button is there');
  assert.ok(!shown.includes('A → B → C → D') && !shown.includes('data-question-process'), 'the process stays folded until the button is pressed');
  const open = renderToStaticMarkup(React.createElement(ProcessToggle, { process: far.process, resetKey: far.key, revealed: true, defaultOpen: true }));
  assert.ok(open.includes('data-question-process="true"') && plainText(open).includes('A → B → C → D') && open.includes('풀이 과정 닫기'));
  assert.equal(renderToStaticMarkup(React.createElement(ProcessToggle, { process: far.process, resetKey: far.key, revealed: false, defaultOpen: true })), '', 'never before the answer');
  const direct = questionsFor('A:B').find(q => q.kind === 'direct');
  assert.ok(!renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: direct, revealed: true, memo: 'A:B' })).includes('풀이 과정'), 'a question with no process has no button');
  // 능력 변환 문제: 카드에는 건너뛴 칸이 없지만 버튼을 누르면 길 전체(능력 집합 포함)가 있다
  const { planConvertReview } = loadSource('utils/abilityConvert.ts');
  const candidates = questionsFor('[a] b ; [c] d\n[c] d ; [u] e').filter(q => q.kind === 'convert').map(question => ({ logId: 'L', question, state: { freedom: question.prompt === 'b' ? 1 : 0, reps: 1 } }));
  const jump = planConvertReview(candidates).planned[0].question;
  assert.equal(jump.process, 'b (a) → d (c) → e (u)');
  const { ConvertQuestionContent } = loadSource('components/ConvertQuestionContent.tsx');
  const card = renderToStaticMarkup(React.createElement(ConvertQuestionContent, { question: jump, revealed: true }));
  assert.ok(card.includes('data-process-button="true"') && !card.includes('>d<') && !card.includes('b (a) → d (c)'), 'the skipped value is not on the card');
});

test('free practice from the note: a unit range or a page range picks the notes, and the questions come from them', () => {
  const notePractice = loadSource('utils/notePractice.ts');
  const units = loadSource('utils/noteUnits.ts');
  const logs = [
    { id: 'a', subjectId: 'main', pagesRead: 10, startPage: 1, endPage: 10, timeSpentMinutes: 20, timestamp: '2026-09-12T20:00:00.000Z', reviewMemo: 'A:B:C:D' },
    { id: 'b', subjectId: 'main', pagesRead: 10, startPage: 11, endPage: 20, timeSpentMinutes: 20, timestamp: '2026-09-13T20:00:00.000Z', reviewMemo: 'X;Y' },
    { id: 'c', subjectId: 'main', pagesRead: 10, startPage: 21, endPage: 30, timeSpentMinutes: 20, timestamp: '2026-09-14T20:00:00.000Z', reviewMemo: '   ' },
    { id: 'd', subjectId: 'main', pagesRead: 10, startPage: 21, endPage: 30, timeSpentMinutes: 20, timestamp: '2026-09-15T20:00:00.000Z', reviewMemo: 'P:Q' }
  ];
  const unitPages = units.groupLogsByPageUnit(logs, 10, 1, 'main');
  assert.deepEqual(unitPages.map(unit => notePractice.noteUnitLabel(unit)), ['1번째 단위 · p.1~10', '2번째 단위 · p.11~20', '3번째 단위 · p.21~30']);
  assert.deepEqual(notePractice.logsInUnitRange(unitPages, unitPages[0].key, unitPages[1].key).map(log => log.id), ['a', 'b']);
  assert.deepEqual(notePractice.logsInUnitRange(unitPages, unitPages[1].key, unitPages[0].key).map(log => log.id), ['a', 'b'], 'the two ends can be given in either order');
  assert.deepEqual(notePractice.logsInUnitRange(unitPages, unitPages[2].key, unitPages[2].key).map(log => log.id), ['d'], 'a blank note has no questions');
  assert.deepEqual(notePractice.logsInPageRange(logs, 5, 12).map(log => log.id), ['a', 'b'], 'a note is in range when its pages overlap');
  assert.deepEqual(notePractice.logsInPageRange(logs, 30, 21).map(log => log.id), ['d']);
  assert.deepEqual(notePractice.logsInPageRange(logs, NaN, 3), []);
  assert.deepEqual(notePractice.pageBoundsOf(logs), { start: 1, end: 30 });
  const { catalog, entries } = notePractice.buildNotePracticeCatalog([logs[0], logs[1]]);
  assert.equal(catalog.length, entries.length);
  assert.ok(catalog.every(item => item.id.startsWith('a:') || item.id.startsWith('b:')) && new Set(catalog.map(item => item.logId)).size === 2);
  assert.ok(entries.some(entry => entry.question.kind === 'far'));
  // 범위를 직접 골랐으니 모든 단계가 열려 있고, 가장 쉬운 문제에서 시작한다.
  const open = { a: 3, b: 3 };
  const started = practice.startReviewPractice(catalog, open);
  const first = entries.find(entry => entry.id === started.queue[0]);
  assert.equal(first.question.difficulty, Math.min(...entries.filter(entry => entry.question.priority === 1 && entry.log.id === first.log.id).map(entry => entry.question.difficulty)), 'practice starts with the easiest question of the most important line');
  assert.equal(started.queue.length, catalog.filter(item => item.priority === 1).length, 'each note starts with its most important line');
});

test('free practice records are stored with the FSRS rating and do not touch review schedules', () => {
  const notePractice = loadSource('utils/notePractice.ts');
  const memoryStorage = () => { const data = {}; return { getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); } }; };
  const storage = memoryStorage();
  assert.deepEqual(notePractice.readNotePracticeRecords(storage), []);
  const log = { id: 'a', subjectId: 'main', pagesRead: 1, timestamp: '2026-09-12T20:00:00.000Z', reviewMemo: 'A:B:C:D', reviewStep: 2, nextReviewDate: '2026-09-20T00:00:00.000Z' };
  const before = JSON.stringify(log);
  const { entries } = notePractice.buildNotePracticeCatalog([log]);
  const entry = entries.find(item => item.question.kind === 'far');
  const when = new Date('2026-10-19T12:00:00.000Z');
  notePractice.appendNotePracticeRecord(notePractice.makeNotePracticeRecord(entry, 'main', 'hard', 2, 4321.7, '1번째 단위 · p.1~10', when), storage);
  notePractice.appendNotePracticeRecord(notePractice.makeNotePracticeRecord(entries[0], 'main', 'again', 1, 900, 'p.1~10', when), storage);
  const records = notePractice.readNotePracticeRecords(storage);
  assert.equal(records.length, 2);
  assert.deepEqual({ ...records[0], id: undefined }, {
    id: undefined, at: '2026-10-19T12:00:00.000Z', subjectId: 'main', logId: 'a', questionKey: entry.question.key, kind: 'far',
    level: entry.question.level, priority: entry.question.priority, difficulty: entry.question.difficulty, distance: entry.question.distance,
    grade: 'hard', rating: 2, attempt: 2, elapsedMs: 4322, scope: '1번째 단위 · p.1~10'
  });
  assert.equal(records[1].rating, 1);
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(JSON.stringify(log), before, 'the log (and its schedule) is untouched');
  storage.setItem('swp_note_practice_records_v1', 'not json');
  assert.deepEqual(notePractice.readNotePracticeRecords(storage), [], 'unreadable storage is treated as empty');
});

test('the note tab has a practice button, and the range dialog offers units and pages', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteTab } = loadSource('components/NoteTab.tsx');
  const { NotePracticeDialog } = loadSource('components/NotePractice.tsx');
  const units = loadSource('utils/noteUnits.ts');
  const logs = [
    { id: 'a', subjectId: 'main', pagesRead: 10, startPage: 1, endPage: 10, timeSpentMinutes: 20, timestamp: '2026-09-12T20:00:00.000Z', reviewMemo: 'A:B:C:D' },
    { id: 'b', subjectId: 'main', pagesRead: 10, startPage: 11, endPage: 20, timeSpentMinutes: 20, timestamp: '2026-09-13T20:00:00.000Z', reviewMemo: 'X;Y' }
  ];
  const tab = renderToStaticMarkup(React.createElement(NoteTab, { logs, subjects, onUpdateReviewMemo() {} }));
  assert.ok(tab.includes('data-testid="note-practice-open"') && tab.includes('문제 풀기'));
  assert.ok(!tab.includes('data-testid="note-practice-setup"'), 'the dialog is closed until the button is pressed');
  const unitPages = units.groupLogsByPageUnit(logs, 10, 1, 'main');
  const dialog = renderToStaticMarkup(React.createElement(NotePracticeDialog, { subjectId: 'main', subjectName: 'Main', units: unitPages, defaultUnitKey: unitPages[0].key, criterion: null, onClose() {} }));
  assert.ok(dialog.includes('data-testid="note-practice-setup"') && dialog.includes('단위로') && dialog.includes('페이지로'));
  assert.ok(dialog.includes('1번째 단위 · p.1~10') && dialog.includes('2번째 단위 · p.11~20') && dialog.includes('aria-label="시작 단위"') && dialog.includes('aria-label="끝 단위"'));
  assert.ok(/노트 1개 · 문제 \d+개/.test(dialog) && dialog.includes('풀기 시작'), 'starts on the unit that was open, counting its notes and questions');
});

test('grouping brackets are ( ): they make the same questions as the old [ ] grouping, and [ ] stays the classification criterion', () => {
  const same = (paren, square) => {
    const sign = memo => questionsFor(memo).map(q => `${q.kind}|${q.prompt}=>${q.answer}|${q.conditions.join('>')}`);
    assert.deepEqual(sign(paren), sign(square), `${paren} reads like ${square}`);
    assert.ok(sign(paren).length > 0);
  };
  same('A:(B:(C-D),(K=F))', 'A:[B:[C-D],[K=F]]');
  same('성립;(a=b),(c=(d,e))', '성립;[a=b],[c=[d,e]]');
  same('x:(y:z)=(p:q)', 'x:[y:z]=[p:q]');
  // 묶음 안의 기호는 칸을 나누지 않는다: 글 속 괄호의 ':'도 마찬가지(바깥은 여전히 두 칸). 칸 값은 그 자리의 값만 남고(`시간예`) 안쪽 관계는 자기 문제를 따로 만든다.
  const prose = questionsFor('시간(예: 3시):길이');
  assert.deepEqual(prose.filter(q => q.prompt.includes('시간') || q.answer.includes('시간')).map(q => [q.kind, q.prompt, q.answer]),
    [['direct', '시간예', '길이'], ['reverse', '길이', '시간예']]);
  assert.deepEqual(prose.filter(q => !q.prompt.includes('시간') && !q.answer.includes('시간')).map(q => [q.kind, q.prompt, q.answer, q.conditions]),
    [['direct', '예', '3시', []], ['reverse', '3시', '예', []]]);
  // 괄호가 한 쌍으로 묶인 한 칸은 풀어서 읽는다
  const nested = questionsFor('A:(B:C)');
  assert.ok(nested.some(q => q.kind === 'direct' && q.prompt === 'A' && q.answer === 'B'));
  assert.ok(nested.some(q => q.kind === 'direct' && q.prompt === 'B' && q.answer === 'C'));
  // 쓰던 중이라 닫지 않은 괄호는 그 줄 끝까지 묶음이다(내용이 흔들리지 않는다)
  const { parseReviewMemoLogicalOperators } = loadSource('utils/reviewMemoLogic.ts');
  assert.deepEqual(parseReviewMemoLogicalOperators('A:(B,C),D'), [{ index: 7, operator: 'and' }]);
  const unfinished = '(미완성,=\nA,B=C';
  assert.deepEqual(parseReviewMemoLogicalOperators(unfinished), [{ index: unfinished.lastIndexOf(','), operator: 'and' }]);
  // 콜론 색은 괄호 안에서 다시 센다
  const colored = memoColors.splitReviewMemoColonColors('a:(b:c):d').filter(part => part.colonIndex !== undefined).map(part => part.colonIndex);
  assert.deepEqual(colored, [0, 0, 1]);
  // 관계도도 같다
  const { parseNoteDiagram, splitTitleCriteria } = loadSource('utils/noteDiagram.ts');
  assert.deepEqual(parseNoteDiagram('A:(B:C),D')[0].fields, ['A', '(B:C),D']);
  // [ ]는 분류 기준이고 ( )는 기준이 되지 않는다
  assert.deepEqual(splitTitleCriteria('[개념:정의] 삼각형'), { head: '삼각형', criteria: ['개념:정의'] });
  assert.deepEqual(splitTitleCriteria('(개념:정의) 삼각형'), { head: '(개념:정의) 삼각형', criteria: [] });
  assert.equal(sessionMemo.createSessionMemoRecord('(a:b) [대상:설명]').classificationCriterion, '대상:설명');
});

test('the symbol bar offers ( ) for grouping and puts the cursor between the parentheses', () => {
  const { NOTE_SYMBOLS } = loadSource('components/NoteSymbolBar.tsx');
  const group = NOTE_SYMBOLS.find(symbol => symbol.value === '( )');
  assert.ok(group && group.aria.includes('괄호') && !group.aria.includes('대괄호'));
  assert.equal(NOTE_SYMBOLS.some(symbol => symbol.value === '[ ]'), false);
  const editorSource = fs.readFileSync(path.resolve(__dirname, '../components/ReviewMemoEditor.tsx'), 'utf8');
  assert.ok(editorSource.includes("const pair = symbol === '( )';") && editorSource.includes("pair ? '()' : symbol"));
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteTutorial } = loadSource('components/Tutorials.tsx');
  const note = renderToStaticMarkup(React.createElement(NoteTutorial, { onClose() {} }));
  assert.equal(note.includes('대괄호'), false, 'the tutorial no longer calls grouping a square bracket');
});

test('merge rules: each row of the agreed table gives the agreed result', () => {
  const { mergeNoteChains } = loadSource('utils/noteMerge.ts');
  const rows = [
    ['B:D', 'B:F', 'B:D=F', 'add'],
    ['B:D', 'B:[분류기준] F', 'B:D:[분류기준] F', 'add'],
    ['B:D', 'D:K', 'B:(D:K)', 'group'],
    ['B:F-D', 'B:F-W', 'B:F-D-W', 'link'],
    ['A:K:B', 'A::B:C', 'A:K:B:C', 'link'],
    ['A:K:B:C', 'A:K:B:Z', 'A:K:B:C=Z', 'link'],
    ['[A] B:[D] C', '[A] B : [D] C:[K] L', '[A] B:[D] C:[K] L', 'link'],
    ['[A] B:[D] C', '[A:D] B :: [K] L', '[A] B:[D] C:[K] L', 'add'],
    ['A:R', 'A:B:C', 'A:R=(B:C)', 'add'],
    ['성립;a', '성립;b', '성립;a=b', 'add'],
    ['성립;a,b', '성립;b,c', '성립;a,b,c', 'link'],
    ['A:F=G', 'A:H=G', 'A:F=G=H', 'link'],
  ];
  for (const [existing, incoming, expected, kind] of rows) {
    const merged = mergeNoteChains(existing, incoming);
    assert.ok(merged, `${existing} + ${incoming}`);
    assert.equal(merged.text, expected, `${existing} + ${incoming}`);
    assert.equal(merged.kind, kind, `${existing} + ${incoming} kind`);
  }
});

test('merge rules: already contained, unrelated and unsupported shapes change nothing, and merging twice is the same as once', () => {
  const { mergeNoteChains } = loadSource('utils/noteMerge.ts');
  // 이미 들어 있는 글
  for (const [existing, incoming] of [['B:D=F', 'B:F'], ['B:(D:K)', 'D:K'], ['A:K:B:C=Z', 'K:B:Z'], ['성립;a,b,c', '성립;b,c'], ['B:F-D-W', 'B:F-W'], ['B:D:[분류기준] F', 'B:[분류기준] F'], ['A:R=(B:C)', 'A:B:C']]) {
    assert.equal(mergeNoteChains(existing, incoming), null, `${existing} + ${incoming}`);
  }
  // 겹치는 칸이 없거나 S의 맨 앞 칸이 E에 없으면 합치지 않는다
  assert.equal(mergeNoteChains('A:R', 'X:Y'), null);
  assert.equal(mergeNoteChains('A:R', 'X:A'), null);
  assert.equal(mergeNoteChains('A', 'A:B'), null);
  // 순서가 거꾸로 겹치면 합치지 않는다
  assert.equal(mergeNoteChains('A:B:C', 'C:B:Z'), null);
  // 띄어쓰기는 같은 이름 판정에 영향이 없다
  assert.equal(mergeNoteChains('등차 수열:공차', '등차수열:첫항').text, '등차 수열:공차=첫항');
  // 합친 결과에 같은 글을 다시 합쳐도 그대로
  for (const [existing, incoming] of [['B:D', 'B:F'], ['A:K:B', 'A::B:C'], ['성립;a,b', '성립;b,c'], ['B:D', 'D:K'], ['A:R', 'A:B:C']]) {
    const once = mergeNoteChains(existing, incoming).text;
    assert.equal(mergeNoteChains(once, incoming), null, `${existing} + ${incoming} stays merged`);
  }
});

test('every question kind is asked as a workbook sentence: no AND/OR in the question or in the shown answer', () => {
  const memos = ['A:p,q,r', 'A:p-q-r', '성립:(a,b),(c,d)', 'A:B:C:D', 'A;b,c', 'A<b', 'A:(b:c)', 'A:p=q=r', 'A:p-q=r', '[a] X=y',
    ':::toggle 자동차 :\n엔진:동력\n타이어:접지\n:::end', ':::toggle 자동차<\n엔진\n타이어\n:::end'];
  memos.forEach(memo => questionsFor(memo).filter(q => q.kind !== 'convert').forEach(q => {
    assert.equal(typeof q.statement, 'string', `${memo} ${q.kind}`);
    assert.ok(!/ AND | OR /.test(q.statement) && !/ AND | OR /.test(q.solution ?? ''), `${memo} ${q.kind}: ${q.statement}`);
  }));
  const by = (memo, kind, prompt) => questionsFor(memo).find(q => q.kind === kind && (prompt === undefined || q.prompt === prompt));
  assert.equal(by('A:B', 'direct').statement, '‘A’에 이어지는 것은?');
  assert.equal(by('A:B', 'reverse').statement, '‘B’에 앞서 이어진 것은?');
  // 그리고: 정답은 모두, 정답 칸에는 쉼표로 푼다
  const and = by('A:p,q,r', 'direct');
  assert.equal(and.statement, '‘A’에 이어지는 것을 모두 쓰시오.');
  assert.equal(and.answer, 'p AND q AND r');
  assert.equal(and.solution, 'p, q, r');
  assert.equal(by('A:p,q,r', 'reverse').statement, '‘p, q, r’ 모두에 앞서 이어진 것은?');
  // 남은 조건: 이미 충족한 것은 `외에`로
  assert.equal(by('A:p,q,r', 'remaining', 'A').statement.startsWith('‘A’에 필요한 것 중 ‘'), true);
  assert.ok(questionsFor('A:p,q,r').some(q => q.statement === '‘A’에 필요한 것 중 ‘p, q’ 외에 남은 것은?' && q.answer === 'r'));
  // 순서
  assert.equal(by('A:p-q-r', 'order-next', 'p').statement, '‘A’에서 ‘p’ 바로 다음에 오는 것은?');
  assert.equal(by('A:p-q-r', 'order-previous', 'q').statement, '‘A’에서 ‘q’ 바로 앞에 오는 것은?');
  assert.equal(by('A:p-q-r', 'order-reconstruct').statement, '‘A’에서 ‘p’ 다음에 오는 것을 순서대로 쓰시오.');
  assert.equal(by('A:B:C:D', 'reconstruct').statement, '‘A’에서 이어지는 것을 끝까지 순서대로 쓰시오.');
  // 연결 추론: 몇 걸음인지
  assert.equal(by('A:B:C:D', 'far', 'A').statement, '‘A’부터 두 걸음 뒤에 이어지는 것은?');
  assert.ok(questionsFor('A:B:C:D').some(q => q.kind === 'far' && q.prompt === 'D' && q.answer === 'A' && q.statement === '‘D’부터 세 걸음 앞에 이어지는 것은?'));
  // 줄 안의 칸을 가린 문제
  assert.ok(questionsFor('A:B:C:D').some(q => q.kind === 'blank' && q.statement === '‘A → ( ㉠ ) → ( ㉡ ) → D’에서 ㉠, ㉡에 알맞은 것을 차례로 쓰시오.' && q.answer === 'B → C'));
  // 한 칸 안의 `=` 이웃 쌍과 위쪽 토글 칸
  assert.equal(by('A:p=q', 'direct', 'p').statement, '‘A’에서 ‘p’에 대응하는 것은?');
  assert.ok(questionsFor('A:p-q=r').some(q => q.statement === '‘A’에서 ‘p’ 다음 자리의 ‘q’에 대응하는 것은?'));
  assert.equal(questionsFor(':::toggle 자동차 :\n엔진:동력\n:::end').find(q => q.kind === 'direct' && q.prompt === '엔진').statement, '‘자동차’에서 ‘엔진’에 이어지는 것은?');
  // 노트 회상은 그대로
  assert.equal(questionsFor('그냥 글').find(q => q.kind === 'recall').statement, undefined);
});

test('ability-convert cards are sentences too: the given values are in the sentence and the card keeps only the answer slots', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { convertStatement } = loadSource('utils/questionProse.ts');
  const { ConvertQuestionContent } = loadSource('components/ConvertQuestionContent.tsx');
  const statements = memo => questionsFor(memo).filter(q => q.convert).map(q => [convertStatement(q.convert), q.answer]);
  assert.deepEqual(statements('[a] b ; [c] d'), [['집합 ‘a’의 ‘b’에 대응하는 집합 ‘c’의 값은?', 'd']]);
  assert.deepEqual(statements('[a] b < [c] d'), [['집합 ‘c’의 ‘d’에 대응하는 집합 ‘a’의 값은?', 'b']]);
  const chain = statements('[a] b ; [c] d ; [u] e').map(item => item[0]);
  assert.ok(chain.includes('집합 ‘a’의 ‘b’, 집합 ‘u’의 ‘e’ 사이에 놓인 집합 ‘c’의 값은?'), 'a row with the middle hidden');
  assert.ok(chain.includes('집합 ‘a’의 ‘b’, 집합 ‘c’의 ‘d’ 다음에 이어지는 집합 ‘u’의 값은?'), 'a row with the last hidden');
  assert.ok(chain.includes('집합 ‘a’의 ‘b’에서 이어지는 집합 ‘c’, ‘u’의 값을 차례로 쓰시오.'), 'two answers in order');
  // 칸 안을 가린 변주
  const cell = statements('[과정] 풀이 ; [단계] 읽기-정리-확인').map(item => item[0]);
  assert.ok(cell.includes('집합 ‘과정’의 ‘풀이’에 대응하는 집합 ‘단계’의 ‘( ㉠ )-( ㉡ )-확인’에서 ㉠, ㉡에 알맞은 것을 차례로 쓰시오.'));
  assert.ok(statements('[과정] 풀이 ; [단계] B, C, D').some(item => item[0].endsWith('에서 ㉠, ㉡에 알맞은 것을 쓰시오. (순서는 상관없다)')));
  // 카드: 문장 + 정답 칸만. 주어진 값이 따로 칸으로 놓이지 않고, 정답은 확인할 때만 보인다.
  const unit = questionsFor('[a] b ; [c] d').find(q => q.convert);
  const hidden = renderToStaticMarkup(React.createElement(ConvertQuestionContent, { question: unit, revealed: false }));
  const shown = renderToStaticMarkup(React.createElement(ConvertQuestionContent, { question: unit, revealed: true }));
  assert.ok(hidden.includes('data-question-statement="true"') && hidden.includes('집합 ‘a’의 ‘b’에 대응하는 집합 ‘c’의 값은?'));
  assert.ok(!hidden.includes('data-convert-given') && (hidden.match(/data-convert-slot="answer"/g) ?? []).length === 1);
  assert.ok(!hidden.includes('>d<') && shown.includes('>d<'));
});

test('an = cell of three words blanks every word and every pair as a prose question worded as a relation that holds', () => {
  const blanks = questionsFor('A:p=q=r').filter(q => q.kind === 'blank' && q.statement);
  assert.deepEqual(blanks.map(q => q.statement), [
    '‘A’에서는 ‘( ㉠ ) = q = r’ 관계가 성립한다. ㉠에 알맞은 것은?',
    '‘A’에서는 ‘p = ( ㉠ ) = r’ 관계가 성립한다. ㉠에 알맞은 것은?',
    '‘A’에서는 ‘p = q = ( ㉠ )’ 관계가 성립한다. ㉠에 알맞은 것은?',
    '‘A’에서는 ‘( ㉠ ) = ( ㉡ ) = r’ 관계가 성립한다. ㉠, ㉡에 알맞은 것을 차례로 쓰시오.',
    '‘A’에서는 ‘( ㉠ ) = q = ( ㉡ )’ 관계가 성립한다. ㉠, ㉡에 알맞은 것을 차례로 쓰시오.',
    '‘A’에서는 ‘p = ( ㉠ ) = ( ㉡ )’ 관계가 성립한다. ㉠, ㉡에 알맞은 것을 차례로 쓰시오.'
  ]);
  assert.deepEqual(blanks.map(q => q.answer), ['p', 'q', 'r', '㉠ p   ㉡ q', '㉠ p   ㉡ r', '㉠ q   ㉡ r']);
  // `=`가 `-`보다 단단히 묶인다: `q = r`은 순서 안의 한 덩어리
  const mixed = questionsFor('A:p-q=r');
  assert.ok(mixed.some(q => q.statement === '‘A’에서는 ‘( ㉠ ) → (q = r)’ 순서로 이어진다. ㉠에 알맞은 것은?'));
  assert.ok(mixed.some(q => q.kind === 'direct' && q.prompt === 'q' && q.answer === 'r' && q.conditions.join('|') === 'A|p 이후'));
});

test('merging also holds for every word inside a logic cell: = , - cells take an incoming line at the word, with the same attribute path', () => {
  const { mergeNoteChains, mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const shorthand = loadSource('utils/noteShorthand.ts');
  // `=` 칸은 합집합: 같은 칸에 같은 자리의 값이 합쳐진다
  assert.equal(mergeNoteChains('A:F=G', 'A:F=H').text, 'A:F=G=H');
  assert.equal(mergeNoteChains('A:F=G', 'A:H=G').text, 'A:F=G=H');
  assert.equal(mergeNoteChains('A:F=G', 'A:H').text, 'A:F=G=H');
  // 칸 안의 낱말(`,` `-` `=`)이 들어온 줄의 맨 앞 칸이면, 그 낱말만 묶어 이어 붙인다
  assert.equal(mergeNoteChains('A:B,C', 'C:D').text, 'A:B,(C:D)');
  assert.equal(mergeNoteChains('A:p-q-r', 'q:x').text, 'A:p-(q:x)-r');
  assert.equal(mergeNoteChains('A:B=C', 'C:D').text, 'A:B=(C:D)');
  assert.equal(mergeNoteChains('A:F=G', 'G:H').text, 'A:F=(G:H)');
  assert.equal(mergeNoteChains('A:B,C', 'C:D=E').text, 'A:B,(C:D=E)');
  // 같은 낱말이 둘 이상이면 어디인지 알 수 없다 · 이미 합쳐졌으면 그대로 · 단축어를 끄면 `-`는 글자
  assert.equal(mergeNoteChains('A:B,C,C', 'C:D'), null);
  assert.equal(mergeNoteChains('A:B,(C:D)', 'C:D'), null);
  try {
    shorthand.setNoteShorthand(false);
    assert.equal(mergeNoteChains('A:p-q', 'q:x'), null);
    assert.equal(mergeNoteChains('A:B,C', 'C:D').text, 'A:B,(C:D)');
  } finally {
    shorthand.setNoteShorthand(true);
  }
  // 칸 전체와 겹치는 줄이 있으면 그쪽에 먼저 합친다
  const updates = mergeNoteIntoEarlier('G:H', [{ id: '1', memo: 'A:F=G' }, { id: '2', memo: 'G:Z' }]);
  assert.deepEqual(updates.map(item => [item.logId, item.after]), [['2', 'G:Z=H']]);
  // 칸 안의 낱말에 합칠 때도 같은 속성 경로 안에서만
  assert.deepEqual(mergeNoteIntoEarlier(':::toggle 가 :\nG:H\n:::end', [{ id: '1', memo: 'A:F=G' }]), []);
  assert.deepEqual(mergeNoteIntoEarlier('G:H', [{ id: '1', memo: 'A:F=G' }]).map(item => item.after), ['A:F=(G:H)']);
});

test('merge into earlier pages: same attribute path only, oldest matching row, new note text is left alone', () => {
  const { mergeNoteIntoEarlier, scanNoteStatements } = loadSource('utils/noteMerge.ts');
  // 최상위에서 속성(>A:)을 다시 써서 이전 쪽을 고친다
  const earlier = [{ id: 'p1', memo: ':::toggle A :\nB:F-D\n:::end' }, { id: 'p2', memo: '다른:글' }];
  const next = ':::toggle A :\nB:F-W\n:::end';
  const updates = mergeNoteIntoEarlier(next, earlier);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].logId, 'p1');
  assert.equal(updates[0].before, earlier[0].memo);
  assert.equal(updates[0].after, ':::toggle A :\nB:F-D-W\n:::end');
  assert.deepEqual(updates[0].steps, [{ statement: 'B:F-W', kind: 'link' }]);
  // 같은 이름이라도 속성 경로가 다르면 합치지 않는다
  assert.deepEqual(mergeNoteIntoEarlier('B:F-W', earlier), []);
  assert.deepEqual(mergeNoteIntoEarlier(':::toggle C :\nB:F-W\n:::end', earlier), []);
  // 다시 합쳐도 그대로
  assert.deepEqual(mergeNoteIntoEarlier(next, [{ id: 'p1', memo: updates[0].after }]), []);
  // 같은 줄 안 `//` 칸과 가장 오래된 줄
  const multi = [{ id: 'old', memo: '가:나 // 다:라' }, { id: 'new', memo: '다:마' }];
  const merged = mergeNoteIntoEarlier('다:바', multi);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].logId, 'old');
  assert.equal(merged[0].after, '가:나 // 다:라=바');
  // 겹침이 더 많은 줄이 먼저
  const better = mergeNoteIntoEarlier('A:K:B:C', [{ id: 'x', memo: 'A:R' }, { id: 'y', memo: 'A:K:B' }]);
  assert.equal(better.length, 1);
  assert.equal(better[0].logId, 'y');
  assert.equal(better[0].after, 'A:K:B:C');
  // 훑기: 줄 번호·속성 경로
  const scan = scanNoteStatements(':::toggle 동물 :\n:::toggle 포유류 :\n고래:바다\n:::end\n:::end\n설명 글만\n가:나');
  assert.deepEqual(scan.map(item => [item.text, item.path.join('/')]), [['고래:바다', '동물/포유류'], ['가:나', '']]);
});

test('merge records keep the text from before the merge and can be undone only while the merged text is still untouched', () => {
  const { recordNoteMerges, readNoteMergeRecords, undoNoteMerge } = loadSource('utils/noteMergeLog.ts');
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const data = {};
  const storage = { getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); } };
  const updates = mergeNoteIntoEarlier('B:F-W', [{ id: 'p1', memo: 'B:F-D' }]);
  const [record] = recordNoteMerges('today', updates, '2026-10-20T00:00:00.000Z', storage);
  assert.equal(record.before, 'B:F-D');
  assert.equal(record.after, 'B:F-D-W');
  assert.equal(readNoteMergeRecords(storage).length, 1);
  // 그 뒤에 이전 쪽 글을 또 고쳤다면 되돌리지 않는다
  assert.equal(undoNoteMerge(record.id, 'B:F-D-W!', storage), null);
  assert.equal(readNoteMergeRecords(storage)[0].undone, undefined);
  // 합친 직후 글이면 합치기 전 글을 돌려주고, 한 번 되돌린 기록은 다시 쓰지 않는다
  assert.equal(undoNoteMerge(record.id, 'B:F-D-W', storage), 'B:F-D');
  assert.equal(undoNoteMerge(record.id, 'B:F-D-W', storage), null);
  // 바뀐 게 없으면 기록하지 않는다
  assert.deepEqual(recordNoteMerges('today', [], '2026-10-20T00:00:00.000Z', storage), []);
});

test('finishing a study merges the new note into earlier pages once, and the note screen can show and undo it', () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
  const logger = read('components/SessionLogger.tsx');
  assert.ok(logger.includes('mergeNewNoteIntoEarlierPages(nextLog);') && logger.indexOf('mergeNewNoteIntoEarlierPages(nextLog);') < logger.indexOf('applyCarriedSheetEdits();\n    onLogSession(nextLog);'),
    'merged text is queued before the carried edits are applied');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteMergeHistory } = loadSource('components/NoteMergeHistory.tsx');
  assert.equal(renderToStaticMarkup(React.createElement(NoteMergeHistory, { logs: [], onRestore() {} })), '', 'nothing is shown without records');
  assert.ok(read('components/NoteTab.tsx').includes('<NoteMergeHistory logs={current.logs}'));
});

test('sets: a toggle title is a set, [X] alone is the set itself with every nested subset, and [ ] set expressions use . , %', () => {
  const { buildNoteSetIndex, evaluateSetExpression, ancestorsOf, suggestSetNames, readNoteSetLine, headCellOf } = loadSource('utils/noteSets.ts');
  const memo = [
    ':::toggle 동물 :', ':::toggle 포유류 :', '고래:바다에 산다', '개', ':::end', ':::toggle 어류 :', '상어', '고래상어', ':::end', '조류', ':::end',
    ':::toggle 바다 :', '고래', '상어', ':::end'
  ].join('\n');
  const index = buildNoteSetIndex([memo]);
  const names = expression => evaluateSetExpression(index, expression);
  // [X] 홀로: 집합 그 자체 — 안의 모든 부분집합과 셀(부분집합의 부분집합까지, 쓴 순서)
  assert.deepEqual(names('동물'), ['포유류', '고래', '개', '어류', '상어', '고래상어', '조류']);
  assert.deepEqual(names('포유류'), ['고래', '개']);
  // 합집합·교집합·여집합: 연산자가 있으면 안쪽의 모든 셀로 센다
  assert.deepEqual(names('포유류,어류'), ['고래', '개', '상어', '고래상어']);
  assert.deepEqual(names('포유류.바다'), ['고래']);
  assert.deepEqual(names('동물.바다'), ['고래', '상어']);
  assert.deepEqual(names('동물.%어류'), ['고래', '개', '조류']);
  assert.deepEqual(names('%어류'), ['고래', '개', '조류'], 'complement stays inside the same upper set');
  assert.deepEqual(names('포유류.%바다'), ['개']);
  assert.deepEqual(names('없는집합'), []);
  // 한 데이터가 두 집합에 동시에 속한다(같은 이름은 같은 데이터)
  assert.deepEqual(ancestorsOf(index, '고래'), ['포유류', '바다', '동물']);
  // 조류는 아래에 항목이 없으면 그냥 셀, 항목이 생기면 집합이 된다
  assert.ok(!index.sets.has('조류'));
  const grown = buildNoteSetIndex([memo + '\n:::toggle 조류 :\n참새\n:::end']);
  assert.ok(grown.sets.has('조류'));
  assert.deepEqual(evaluateSetExpression(grown, '동물.%어류'), ['고래', '개', '참새']);
  // 추천: 뒤따르는 셀의 위치·상위 집합 / 모르면 쓴 집합 이름
  assert.deepEqual(suggestSetNames(index, '', '고래'), ['포유류', '바다', '동물']);
  assert.deepEqual(suggestSetNames(index, '포', '고래'), ['포유류']);
  assert.deepEqual(suggestSetNames(index, '어'), ['어류']);
  assert.deepEqual(suggestSetNames(index, '').sort(), ['동물', '바다', '어류', '포유류'].sort());
  // 줄 읽기
  assert.deepEqual(readNoteSetLine('[포유류]'), { kind: 'set', expression: '포유류' });
  assert.deepEqual(readNoteSetLine('[동물.%어류]'), { kind: 'set', expression: '동물.%어류' });
  assert.deepEqual(readNoteSetLine('[개념:정의]'), { kind: 'criterion', criterion: '개념:정의' });
  assert.deepEqual(readNoteSetLine('[도형]:[개념:정의]'), { kind: 'ability', expression: '도형', criterion: '개념:정의' });
  assert.equal(readNoteSetLine('B:[분류기준] F'), null);
  assert.equal(readNoteSetLine('고래:바다'), null);
  assert.equal(headCellOf('[포유류] 고래:바다'), '고래');
});

test('abilities: [집합식]:[기준] applies to the data inside the set expression, within its toggle scope only', () => {
  const { buildNoteSetIndex, abilitiesFor } = loadSource('utils/noteSets.ts');
  const memo = [
    '[도형.%삼각형]:[개념:정의]',
    ':::toggle 도형 :', '정사각형:네 변이 같다', '직각삼각형', ':::toggle 삼각형 :', '직각삼각형', '이등변삼각형', ':::end', ':::end',
    ':::toggle 수 :', '[소수]:[수:성질]', ':::toggle 소수 :', '2', '3', ':::end', '4', ':::end'
  ].join('\n');
  const index = buildNoteSetIndex([memo]);
  assert.equal(index.abilities.length, 2);
  assert.deepEqual(index.abilities[0].members, ['정사각형']);
  assert.deepEqual(abilitiesFor(index, '정사각형').map(a => a.criterion), ['개념:정의']);
  assert.deepEqual(abilitiesFor(index, '직각삼각형'), [], 'the triangle is left out by the complement');
  // 토글 안에서 정의한 능력은 그 토글 안에서만 적용된다
  assert.deepEqual(abilitiesFor(index, '2', ['수']).map(a => a.criterion), ['수:성질']);
  assert.deepEqual(abilitiesFor(index, '2', ['도형']), []);
  assert.deepEqual(abilitiesFor(index, '2', []), []);
});

test('set lines ([X] alone, [집합식]:[기준], [개념:정의]) are not turned into questions, other lines are unchanged', () => {
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const plain = buildReviewQuestions('정사각형:네 변이 같다').questions.map(q => q.key);
  assert.ok(plain.length > 0);
  const withSetLines = buildReviewQuestions(['[도형]:[개념:정의]', '[동물.%어류]', '[포유류]', '[개념:정의]', '정사각형:네 변이 같다'].join('\n')).questions.map(q => q.key);
  assert.deepEqual(withSetLines, plain, 'only the real relation makes questions');
  // 같은 줄 안 `//` 칸도 마찬가지
  assert.deepEqual(buildReviewQuestions('[도형]:[개념:정의] // 정사각형:네 변이 같다').questions.map(q => q.key), plain);
  // 위치 표시가 붙은 셀은 예전 그대로 문제가 된다
  assert.ok(buildReviewQuestions('B:D:[분류기준] F').questions.length > 0);
  const { noteCriterionOf } = loadSource('utils/noteSets.ts');
  assert.equal(noteCriterionOf('[개념:정의]\n정사각형:네 변이 같다'), '개념:정의');
  assert.equal(noteCriterionOf(':::toggle 도형 :\n[개념:정의]\n:::end'), null, 'a criterion inside a toggle is not the whole-note criterion');
  assert.equal(noteCriterionOf('[포유류]\n가:나'), null);
});

test('a question card shows which ability set the prompt and answer cells belong to, with the criterion', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = ['[도형]:[개념:정의]', ':::toggle 도형 :', '정사각형:네 변이 같다', ':::end', '원:한 점에서 같은 거리'].join('\n');
  const { questions } = buildReviewQuestions(memo);
  const forSquare = questions.find(q => q.prompt === '정사각형' || q.answer === '정사각형');
  assert.ok(forSquare, 'the square relation makes a question');
  const html = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: forSquare, revealed: false, memo }));
  assert.match(html, /data-ability-chip="true"[^>]*>[^<]*정사각형 ∈ 도형[\s\S]*개념:정의/);
  // 도형 밖의 원은 능력이 붙지 않는다
  const forCircle = questions.find(q => q.prompt === '원' || q.answer === '원');
  assert.ok(forCircle);
  assert.ok(!renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: forCircle, revealed: false, memo })).includes('data-ability-chip'));
  // 다른 쪽에서 정의한 능력도 setMemos로 찾는다
  const lone = ':::toggle 도형 :\n정사각형:네 변이 같다\n:::end';
  const loneQuestion = buildReviewQuestions(lone).questions[0];
  assert.ok(!renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: loneQuestion, revealed: false, memo: lone })).includes('data-ability-chip'));
  assert.ok(renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: loneQuestion, revealed: false, memo: lone, setMemos: ['[도형]:[개념:정의]', lone] })).includes('data-ability-chip'));
  // 노트 맨 위의 [개념:정의]가 세션 기준이 없을 때의 분류 기준이 된다
  const noted = '[개념:정의]\n정사각형:네 변이 같다';
  const q = buildReviewQuestions(noted).questions[0];
  assert.ok(!inStyle('flash', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: q, revealed: false, memo: noted }))).includes('data-classification-criterion'), 'the session note classification line is not shown on a review question');
  assert.ok(!inStyle('prose', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question: q, revealed: false, memo: noted }))).includes('data-classification-criterion'));
});

test('the relation map shows [X] with every nested subset, ability definitions, and an ability button on rows inside the set', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteDiagram } = loadSource('components/NoteTab.tsx');
  const memo = [
    '[도형.%삼각형]:[개념:정의]', '[도형]', '[개념:정의]',
    ':::toggle 도형 :', '정사각형:네 변이 같다', ':::toggle 삼각형 :', '직각삼각형:한 각이 직각', ':::end', ':::end',
    '원:한 점에서 같은 거리'
  ].join('\n');
  const html = renderToStaticMarkup(React.createElement(NoteDiagram, { memo }));
  // 집합 줄: [도형] = 정사각형 · 삼각형 · 직각삼각형(부분집합의 부분집합까지)
  assert.match(html, /data-diagram-row="set"[\s\S]*?도형[\s\S]*?정사각형[\s\S]*?삼각형[\s\S]*?직각삼각형/);
  // 능력 정의 줄과 노트 전체 기준 줄
  assert.match(html, /data-diagram-row="ability"[\s\S]*?도형\.%삼각형[\s\S]*?개념/);
  assert.match(html, /data-diagram-row="note-criterion"/);
  // 도형 안의 정사각형 줄에만 기준 버튼이 붙는다(삼각형 안, 도형 밖의 원에는 없다)
  const buttons = html.match(/data-ability-button="true"/g) || [];
  assert.equal(buttons.length, 1);
  const button = html.indexOf('data-ability-button="true"');
  assert.ok(button > html.indexOf('네 변이 같다') && button < html.indexOf('한 각이 직각'), 'the button sits under the square row');
  assert.match(html, /능력 · 개념 → 정의/);
  // 집합 줄은 문제나 관계 줄로 그려지지 않는다
  assert.ok(!/data-diagram-row="relation"[^>]*>[\s\S]{0,200}\[도형\]/.test(html));
});

test('bracket context: suggestions only inside [ ] on the same line, with the word cell that follows', () => {
  const { bracketContext } = loadSource('utils/noteSets.ts');
  const at = (text, marker = '|') => bracketContext(text.replace(marker, ''), text.indexOf(marker));
  assert.equal(at('고래|'), null, 'outside brackets');
  assert.equal(at('[포유류]| 고래'), null, 'after the bracket is closed');
  assert.deepEqual(at('[개념:정의|]'), { tokenStart: 4, tokenEnd: 6, typed: '정의', following: undefined }, 'logic words such as ":" inside [ ] still show suggestions');
  assert.deepEqual(at('[개념|] 고래:바다 // 가'), { tokenStart: 1, tokenEnd: 3, typed: '개념', following: '고래' }, 'the following cell stops at the relation symbol');
  assert.deepEqual(at('[|] 고래'), { tokenStart: 1, tokenEnd: 1, typed: '', following: '고래' });
  assert.deepEqual(at('B:[포| 고래'), { tokenStart: 3, tokenEnd: 4, typed: '포', following: undefined }, 'still typing: no closing bracket yet');
  assert.deepEqual(at('[포|] 고래:바다'), { tokenStart: 1, tokenEnd: 2, typed: '포', following: '고래' });
  assert.deepEqual(at('[동물.%어|]'), { tokenStart: 5, tokenEnd: 6, typed: '어', following: undefined });
  assert.deepEqual(at('[포유류,|어류]'), { tokenStart: 5, tokenEnd: 7, typed: '', following: undefined });
  assert.equal(at('[포유류\n고|래'), null, 'a bracket never reaches across lines');
});

test('location marks: [ ] left of a word cell places it, and ":" inside [ ] still suggests the linked toggle values', () => {
  const { bracketDetail, bracketSuggestions, buildNoteSetIndex, headCellOf, splitHeadMarks } = loadSource('utils/noteSets.ts');
  const toggles = [':::toggle 수열 :', ':::toggle 급수 :', '1', '2', ':::end', ':::end'];
  const detailAt = (text) => bracketDetail(text.replace('|', ''), text.indexOf('|'));
  // 단어 셀 왼쪽의 위치 표시는 셀 이름에서 빠진다. 집합 기호는 `[ ]` 안에서만이라 `[ ]` 밖의 점은 셀 글자이고, 셀 뒤에 붙인 `[ ]`는 위치 표시가 아니다
  assert.deepEqual(splitHeadMarks('[급수.[A:C]] V:D'), { cell: 'V', marks: ['급수.[A:C]'] });
  assert.deepEqual(splitHeadMarks('급수.[A:C]: 정의'), { cell: '급수.[A:C]', marks: [] });
  assert.deepEqual(splitHeadMarks('[A:C].급수'), { cell: '.급수', marks: ['A:C'] });
  assert.equal(headCellOf('문제 [3]'), '문제 [3]', 'a bracket after the word without a dot is just text');
  // `:` 가 있어도 쓰던 이름은 마지막 논리어 뒤, 뒤따르는 단어 셀도 읽는다
  assert.deepEqual(detailAt('[A:C|] 급수'), { tokenStart: 3, tokenEnd: 4, typed: 'C', following: '급수', open: 0, close: 4, inner: 'A:C', followingEnd: 8, standalone: true });
  assert.equal(detailAt('[급수 A|:C] V:D').typed, '급수 A', 'a space is part of a name, never an operator');
  // 토글 연결값은 논리어 뒤에서도 뜬다
  const index = buildNoteSetIndex([[...toggles, '[A:C] 급수'].join('\n')]);
  const afterColon = bracketSuggestions(index, bracketDetail('[A:] 급수', 3));
  assert.deepEqual(afterColon.filter(item => item.tag === '토글').map(item => item.text), ['수열'], 'the toggle the word cell lives in is offered right after ":"');
  const typing = bracketSuggestions(index, bracketDetail('[A:열', 5));
  assert.deepEqual(typing.map(item => item.text), ['수열'], 'while typing before "]" the set names are offered');
  // 조건 하나에 단어 셀 하나면 교집합 `급수.[A:C]`
  assert.deepEqual(bracketSuggestions(index, detailAt('[A:C|] 급수')).filter(item => item.tag !== '토글'),
    [{ text: '급수.[A:C]', label: '[급수.[A:C]]', from: 1, to: 4, tag: '교집합' }], 'the suggestion is the bracket\'s inner content only: [A:C] 급수 becomes [급수.[A:C]] 급수');
  // 같은 조건 아래 다른 셀이 생기면 조건은 상위 집합: `[A:C].급수`, `[A:C].(D,급수..)`, `[A:C]:(D,급수)`
  const grown = buildNoteSetIndex([[...toggles, '[A:C] 급수', '[A:C] D'].join('\n')]);
  assert.deepEqual(bracketSuggestions(grown, detailAt('[A:C|] D')).filter(item => item.tag !== '토글').map(item => [item.text, item.tag]), [
    ['[A:C].D', '상위'], ['[A:C].(D,급수..)', '상위'], ['[A:C]:(D,급수)', '정의']
  ]);
  assert.deepEqual(bracketSuggestions(grown, detailAt('[A:C|] 급수: 설명')).filter(item => item.tag !== '토글').map(item => item.text), ['[A:C].급수'], 'a list form is offered only when the cell stands alone');
  // 이어 붙인 다른 노트에서 같은 조건이 쓰여도 관계가 바뀐다
  const joined = buildNoteSetIndex(['[A:C] 급수', '[A:C] D']);
  assert.equal(bracketSuggestions(joined, detailAt('[A:C|] 급수'))[0].text, '[A:C].급수');
});

test('set expressions with [A:C] marks, parentheses and ".." evaluate over the cells located at the mark', () => {
  const { buildNoteSetIndex, evaluateSetExpression, readNoteSetLine, abilitiesFor } = loadSource('utils/noteSets.ts');
  const memo = [':::toggle 수열 :', ':::toggle 급수 :', '1', '2', ':::end', ':::end', '[A:C] 급수', '[A:C] D', '[급수.[A:C]] V:D', '[도형]:[개념:정의]', ':::toggle 도형 :', '정사각형', ':::end', '[도형:개념:정의] 원'].join('\n');
  const index = buildNoteSetIndex([memo]);
  const names = expression => evaluateSetExpression(index, expression);
  assert.deepEqual(names('[A:C]'), ['1', '2', 'V', 'D'], 'cells at the mark, a set contributes the cells inside it');
  assert.deepEqual(names('급수.[A:C]'), ['1', '2', 'V']);
  assert.deepEqual(names('[A:C].급수'), ['1', '2', 'V']);
  assert.deepEqual(names('[A:C].(D,급수..)'), ['1', '2', 'V', 'D']);
  assert.deepEqual(names('[A:C].D'), ['D']);
  assert.deepEqual(names('(급수,D).[A:C]'), ['1', '2', 'V', 'D']);
  // 줄 읽기
  assert.deepEqual(readNoteSetLine('[A:C]:(D,급수)'), { kind: 'define', mark: 'A:C', members: ['D', '급수'] });
  // 집합 기호를 `[ ]` 밖에 쓴 줄은 집합 줄이 아니다(21:09): 같은 뜻은 `[A:C]:(D,급수)` · `[급수.[A:C]]` · `[A:C] 급수`
  assert.equal(readNoteSetLine('[A:C].(D,급수..)'), null);
  assert.equal(readNoteSetLine('급수.[A:C]'), null);
  assert.equal(readNoteSetLine('[A:C].급수'), null);
  assert.deepEqual(readNoteSetLine('[급수.[A:C]]'), { kind: 'set', expression: '급수.[A:C]' });
  assert.equal(readNoteSetLine('[alpha] label'), null, 'a mark and a word without an operator stays a plain cell');
  assert.equal(readNoteSetLine('[읽기-정리-확인],[예제,문제]'), null, 'legacy bracket groups are not set lines');
  assert.equal(readNoteSetLine('급수.[A:C]: 정의'), null, 'with a relation it is a normal line whose cell is located');
  // 정의 줄은 그 위치의 셀을 정한다
  const defined = buildNoteSetIndex(['[A:C]:(D,급수)']);
  assert.deepEqual(evaluateSetExpression(defined, '[A:C]'), ['D', '급수']);
  // 셀을 위치에 두는 것은 셀 왼쪽의 위치 표시다. `[ ]` 밖에 점으로 이은 `급수.[A:C]`는 셀을 그 위치에 두지 않는다
  const byMark = buildNoteSetIndex(['[A:C] 급수\n[A:C] D']);
  assert.deepEqual([...byMark.marks.get('A:C').cells], ['급수', 'D']);
  const byDot = buildNoteSetIndex(['급수.[A:C]\n[A:C] D']);
  assert.deepEqual([...byDot.marks.get('A:C').cells], ['D']);
  // [A:B]는 능력 [A]:[B]의 속성 조건: 셀 왼쪽에 쓰면 그 능력이 걸린다
  assert.deepEqual(abilitiesFor(index, '원').map(a => [a.expression, a.criterion]), [['도형', '개념:정의']]);
  assert.deepEqual(abilitiesFor(index, '정사각형').map(a => [a.expression, a.criterion]), [['도형', '개념:정의']]);
  assert.deepEqual(abilitiesFor(index, '급수'), []);
});

test('set lines with marks are not questions and the editor suggestion list is a vertical, scrollable code-style list with Tab', () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');
  const lines = questionsFor('[A:C]:(D,급수)\n[급수.[A:C]]\n[[A:C].(D,급수..)]\n개념:정의');
  assert.ok(lines.length > 0 && !/급수|A:C/.test(JSON.stringify(lines.map(q => [q.prompt, q.answer]))), 'only the real relation line makes questions');
  const source = read('components/ReviewMemoEditor.tsx');
  assert.ok(source.includes('SUGGESTION_VISIBLE_ROWS = 5'), 'five rows at a time');
  assert.ok(source.includes('overflow-y-auto') && source.includes('SUGGESTION_MAX_HEIGHT'), 'the list scrolls inside itself');
  assert.ok(source.includes("event.key === 'Tab'"), 'Tab completes the chosen line');
  assert.ok(!source.includes('flex-wrap gap-1.5 rounded-xl border p-1.5 shadow-lg'), 'no horizontal chip row');
});

test('a [ ] mark in front of a cell places the line inside that set in the note diagram, like writing it under a toggle', () => {
  const { parseNoteDiagram } = loadSource('utils/noteDiagram.ts');
  const containment = (title, items) => ({ kind: 'group', relation: 'containment', title, header: { fields: title.split(':'), arrows: ['both'] }, items });
  assert.deepEqual(parseNoteDiagram('[A:C] B'), [containment('A:C', [{ kind: 'plain', text: 'B' }])]);
  assert.deepEqual(parseNoteDiagram('[A:C] B\n[A:C] O:P\nx:y'), [
    containment('A:C', [{ kind: 'plain', text: 'B' }, { kind: 'relation', fields: ['O', 'P'], arrows: ['both'] }]),
    { kind: 'relation', fields: ['x', 'y'], arrows: ['both'] }
  ]);
  assert.deepEqual(parseNoteDiagram('[A:C] O:P\n:::toggle A:C\nq:r\n:::end'), [
    containment('A:C', [{ kind: 'relation', fields: ['q', 'r'], arrows: ['both'] }, { kind: 'relation', fields: ['O', 'P'], arrows: ['both'] }])
  ], 'a toggle with the same title takes the marked lines in');
  assert.deepEqual(parseNoteDiagram('[포유류] 고래'), [{ kind: 'group', relation: 'hierarchy', title: '포유류', items: [{ kind: 'plain', text: '고래' }] }]);
  assert.deepEqual(parseNoteDiagram('[a:b]:c'), [{ kind: 'relation', fields: ['[a:b]', 'c'], arrows: ['both'] }], 'a bracket that is the whole field is not a placement');
  const inner = parseNoteDiagram('[급수.[A:C]] 급수:x');
  assert.equal(inner[0].title, '급수.[A:C]', 'a bracket inside a bracket keeps its pair');
});

test('suggestions appear only inside [ ], follow nested brackets, and replace only what is inside the bracket', () => {
  const { bracketDetail, bracketSuggestions, buildNoteSetIndex, evaluateSetExpression, readNoteSetLine, splitHeadMarks } = loadSource('utils/noteSets.ts');
  const detailAt = (text) => bracketDetail(text.replace('|', ''), text.indexOf('|'));
  // 닫은 뒤에는 뜨지 않는다
  assert.equal(detailAt('[A:C]| 급수'), null);
  assert.equal(detailAt('[A:C] 급수|'), null);
  assert.equal(detailAt('급수|'), null);
  // 겹친 대괄호: 커서가 들어 있는 가장 안쪽 `[ ]`
  const innerMost = detailAt('[급수.[A:C|]] 급수');
  assert.deepEqual([innerMost.open, innerMost.close, innerMost.typed, innerMost.inner], [4, 8, 'C', 'A:C']);
  const outer = detailAt('[급수.[A:C]|] 급수');
  assert.deepEqual([outer.open, outer.close, outer.inner], [0, 9, '급수.[A:C]']);
  assert.equal(detailAt('[급수.[A:C]] 급수|'), null, 'after the outer bracket closes there is no suggestion');
  // 추천을 받아들이면 안쪽만 바뀐다
  const index = buildNoteSetIndex(['[A:C] 급수']);
  const text = '[A:C] 급수';
  const [pick] = bracketSuggestions(index, bracketDetail(text, 4)).filter(item => item.tag !== '토글');
  assert.equal(`${text.slice(0, pick.from)}${pick.text}${text.slice(pick.to)}`, '[급수.[A:C]] 급수');
  assert.equal(pick.label, '[급수.[A:C]]');
  // 이미 겹친 꼴이면 다시 감싸지 않는다
  assert.deepEqual(bracketSuggestions(index, bracketDetail('[급수.[A:C]] 급수', 9)).filter(item => item.tag !== '토글'), []);
  // 겹친 대괄호도 한 덩어리로 읽는다
  assert.deepEqual(splitHeadMarks('[급수.[A:C]] 급수'), { cell: '급수', marks: ['급수.[A:C]'] });
  assert.deepEqual(readNoteSetLine('[급수.[A:C]]'), { kind: 'set', expression: '급수.[A:C]' });
  assert.deepEqual(readNoteSetLine('[급수.[A:C]]:[개념:정의]'), { kind: 'ability', expression: '급수.[A:C]', criterion: '개념:정의' });
  // 교집합 위치에 둔 셀은 식 안의 위치 [A:C] 안에도 있다
  const placed = buildNoteSetIndex(['[급수.[A:C]] 급수', '[A:C] D']);
  assert.deepEqual(evaluateSetExpression(placed, '[A:C]'), ['D', '급수']);
  assert.deepEqual(evaluateSetExpression(placed, '[급수.[A:C]]'), ['급수']);
});

test('FSRS-6 matches the reference implementation (ts-fsrs 5.4) for first reviews, spaced reviews, lapses and same-day retries', () => {
  const fsrs = loadSource('utils/fsrs.ts');
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-5 * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);
  assert.equal(fsrs.FSRS_DEFAULT_WEIGHTS.length, 21, 'FSRS-6 has 21 parameters');
  const first = rating => fsrs.fsrsReview(null, rating, 0);
  [[1, 0.212, 6.4133], [2, 1.2931, 5.11217071], [3, 2.3065, 2.11810397], [4, 8.2956, 1]].forEach(([rating, stability, difficulty]) => {
    close(first(rating).stability, stability, `first ${rating} S`);
    close(first(rating).difficulty, difficulty, `first ${rating} D`);
  });
  const day = fsrs.DAY_MS;
  const afterThree = rating => fsrs.fsrsReview(first(3), rating, 3 * day);
  [[3, 13.82690327, 2.11121424], [1, 0.63685069, 7.39450274], [4, 23.88306328, 1], [2, 9.23487052, 4.75285849]].forEach(([rating, stability, difficulty]) => {
    close(afterThree(rating).stability, stability, `good, 3 days, ${rating} S`);
    close(afterThree(rating).difficulty, difficulty, `good, 3 days, ${rating} D`);
  });
  const sameDay = fsrs.fsrsReview(first(1), 3, 0);
  close(sameDay.stability, 0.24668919, 'again then good on the same day S');
  close(sameDay.difficulty, 6.40211507, 'again then good on the same day D');
  assert.equal(sameDay.lapses, 1);
  assert.equal(sameDay.reps, 2);
  // 같은 날 어려움은 안정도가 줄 수 있다(FSRS-6은 좋음·쉬움만 1배 아래로 막는다)
  close(fsrs.fsrsReview(first(3), 2, 0).stability, 1.33337872, 'good then hard on the same day S');
  assert.ok(fsrs.fsrsReview(first(3), 3, 0).stability >= 2.3065, 'good again on the same day never lowers S');
  close(fsrs.fsrsRetrievability(3, 10), 0.96102427, 'R(3 days, S=10)');
  close(fsrs.fsrsRetrievability(10, 10), 0.9, 'R equals the desired retention after S days');
  close(fsrs.fsrsIntervalDays(10), 10, 'at 90% retention the interval is the stability');
  assert.ok(fsrs.fsrsIntervalDays(10, 0.8) > 10 && fsrs.fsrsIntervalDays(10, 0.95) < 10, 'a lower target retention waits longer');
  const preview = fsrs.fsrsPreviewIntervals(first(3), 3 * day);
  assert.ok(preview[1] < preview[2] && preview[2] < preview[3] && preview[3] < preview[4], 'harder grades come back sooner');
});

test('Enter between ( and ) after a [set] opens a read-only members window; a trailing "> " turns the line into an open toggle', () => {
  const { buildNoteSetIndex, setContents, setMembersTrigger } = loadSource('utils/noteSets.ts');
  // 트리거: `[집합]()` 괄호 사이(또는 `].()` · `]:()`)에서만
  assert.equal(setMembersTrigger('[급수]()', 5), '급수');
  assert.equal(setMembersTrigger('x [A:C].()', 9), 'A:C');
  assert.equal(setMembersTrigger('[급수.[A:C]]:()', 12), '급수.[A:C]', 'nested brackets are matched');
  assert.equal(setMembersTrigger('[급수]()', 4), null, 'the caret has to sit between the parentheses');
  assert.equal(setMembersTrigger('급수()', 3), null, 'a plain word is not a [set]');
  assert.equal(setMembersTrigger('[급수](a)', 6), null, 'the parentheses must be empty at the caret');
  // 모든 요소: 이름 하나인 집합은 계층 그대로, 위치 표시와 집합식은 계산한 셀들
  const index = buildNoteSetIndex([[':::toggle 수열', ':::toggle 급수', '1', '2', ':::end', '등차', ':::end', '[A:C] 급수', '[A:C] D', '[A:C] O:P'].join('\n')]);
  assert.deepEqual(setContents(index, '수열').map(row => [row.name, row.depth, row.isSet]), [['급수', 0, true], ['1', 1, false], ['2', 1, false], ['등차', 0, false]]);
  assert.deepEqual(setContents(index, 'A:C').map(row => row.name).sort(), ['1', '2', 'D', 'O'].sort());
  assert.deepEqual(setContents(index, '급수.[A:C]').map(row => row.name), ['1', '2']);
  assert.deepEqual(setContents(index, '없는 집합'), []);
  const withEmptyParens = buildNoteSetIndex([[':::toggle 수열', '1', ':::end', '[수열]()', '[A:C]()'].join('\n')]);
  assert.deepEqual(setContents(withEmptyParens, '수열').map(row => row.name), ['1'], 'a line that is only [set]() places no cell');
  assert.deepEqual(setContents(withEmptyParens, 'A:C'), []);
  // 편집기: 스크롤되는 창, 고칠 수 있는 화면(NoteSetEditContext가 있을 때)에서는 값 입력칸, 없는 화면에서는 보기 전용
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'components/ReviewMemoEditor.tsx'), 'utf8');
  assert.ok(source.includes('data-set-members="true"') && source.includes("aria-readonly={rewriteNotes ? undefined : 'true'}") && source.includes('overflow-y-auto'), 'a scrollable window that is read-only without an edit provider');
  assert.ok(source.includes('data-set-member-input="true"') && source.includes('rewriteSetMember'), 'rows are inputs that rewrite the notes');
  assert.ok(source.includes('convertLine(index, caret, \'\', true)'), 'a trailing > converts the line into a toggle');
});

test('ability conversion questions: every field marked with a [set] makes minimal-unit questions with the sets and the given value', () => {
  const converts = memo => questionsFor(memo).filter(q => q.kind === 'convert');
  // 변주(빈칸·덩어리 안쪽)는 단위가 아니다: 단위 문제만 본다
  const brief = memo => converts(memo).filter(q => !q.convert.variation).map(q => [q.prompt, q.answer, q.direction, q.convert.steps.map(step => step.set).join('>')]);
  assert.deepEqual(brief('[a] b ; [c] d'), [['b', 'd', 'forward', 'a>c']], '; is forward only');
  assert.deepEqual(brief('[a] b < [c] d'), [['d', 'b', 'reverse', 'c>a']], '< is reverse only');
  assert.deepEqual(brief('[a] b : [c] d'), [['b', 'd', 'forward', 'a>c'], ['d', 'b', 'reverse', 'c>a']], ': goes both ways');
  assert.deepEqual(brief('[a] b ; [c] d ; [u] e'), [['b', 'd', 'forward', 'a>c'], ['d', 'e', 'forward', 'c>u']], 'one unit per neighbouring pair');
  assert.deepEqual(brief('[a] b ; c'), [], 'a field without a [set] is an ordinary relation');
  assert.equal(questionsFor('[a] b ; c').filter(q => q.kind === 'direct').length, 1);
  assert.ok(!questionsFor('[a] b ; [c] d').some(q => q.kind === 'direct' || q.kind === 'reverse'), 'the conversion question replaces the plain relation question');
  const [unit] = converts('[a] b ; [c] d');
  assert.equal(unit.convert.form, 'unit');
  assert.ok(!('reversible' in unit.convert), 'no inverse / contrapositive machinery any more');
  assert.deepEqual(unit.convert.unitKeys, [unit.key]);
  assert.ok(unit.key.startsWith('cv1:'));
  const keys = converts('[a] b : [c] d').map(q => q.key);
  assert.equal(new Set(keys).size, 2, 'the two directions are separate units with their own keys');
  // 칸 이름에 붙은 값 안의 `[ ]` 겹침도 집합으로 읽는다
  assert.deepEqual(brief('[급수.[A:C]] x ; [u] y'), [['x', 'y', 'forward', '급수.[A:C]>u']]);
  // 여러 `[ ]`는 표준 교집합 `.`으로 잇고, 합집합이 든 것은 괄호로 묶는다 (띄어쓰기나 가운뎃점은 연산이 아니다)
  assert.deepEqual(brief('[a][b] x ; [c] y'), [['x', 'y', 'forward', 'a.b>c']]);
  assert.deepEqual(brief('[a,b][c] x ; [u] y'), [['x', 'y', 'forward', '(a,b).c>u']]);
  assert.deepEqual(brief('[수열 A] x ; [u] y'), [['x', 'y', 'forward', '수열 A>u']], 'a space is part of a name');
  // 문제 키는 노트를 고쳐도(다른 줄을 더해도) 그대로다
  assert.equal(converts('[a] b ; [c] d\nplain:line')[0].key, converts('[a] b ; [c] d')[0].key);
});

test('a relation toggle title gives its lines hidden classification sets: > [A] B: [C] D makes h:j into [A.B] h : [C.D] j', () => {
  const lines = memo => questionsFor(memo).filter(q => q.kind === 'convert' && ['h', 'j'].includes(q.prompt) && ['h', 'j'].includes(q.answer))
    .map(q => [q.prompt, q.answer, q.convert.steps.map(step => step.set).join('>')]);
  assert.deepEqual(lines(':::toggle [A] B: [C] D\nh:j\n:::end'), [['h', 'j', 'A.B>C.D'], ['j', 'h', 'C.D>A.B']], 'unmarked lines inherit the classification sets');
  // 줄에 직접 쓴 [p]도 점 없이 그 칸의 상위 분류와 교집합이다: [A.B.p] h : [C.D] j
  assert.deepEqual(lines(':::toggle [A] B: [C] D\n[p] h:j\n:::end'), [['h', 'j', 'A.B.p>C.D'], ['j', 'h', 'C.D>A.B.p']]);
  // 점 줄임 `.[p]`은 없다: 앞의 점은 집합 기호가 아니라서 값의 글자이고, 그 칸의 집합은 상위 분류뿐이다
  assert.deepEqual(lines(':::toggle [A] B: [C] D\n.[p] h:j\n:::end'), []);
  assert.deepEqual(questionsFor(':::toggle [A] B: [C] D\n.[p] h:j\n:::end').filter(q => q.kind === 'convert' && !['B', 'D'].includes(q.prompt)).map(q => [q.prompt, q.answer, q.convert.steps.map(step => step.set).join('>')]), [['.[p] h', 'j', 'A.B>C.D'], ['j', '.[p] h', 'C.D>A.B']]);
  assert.deepEqual(lines(':::toggle [A] B: [C] D\n[p] h:[q] j\n:::end'), [['h', 'j', 'A.B.p>C.D.q'], ['j', 'h', 'C.D.q>A.B.p']]);
  // 안쪽 토글의 새 분류 집합도 바깥 토글의 분류와 교집합이다
  assert.deepEqual(lines(':::toggle [A] B: [C] D\n:::toggle [E] F: [G] H\nh:j\n:::end\n:::end'), [['h', 'j', 'A.B.E.F>C.D.G.H'], ['j', 'h', 'C.D.G.H>A.B.E.F']]);
  // 안쪽 토글 제목에 [ ]가 없으면 바깥 분류만 이어받는다
  assert.deepEqual(lines(':::toggle [A] B: [C] D\n:::toggle E:F\nh:j\n:::end\n:::end'), [['h', 'j', 'A.B>C.D'], ['j', 'h', 'C.D>A.B']]);
  // [ ]가 하나도 없는 제목(A:C)이나 끝이 열린 제목(A:)은 분류 집합을 만들지 않는다: 보통 관계 문제 그대로
  assert.deepEqual(lines(':::toggle A:C\nh:j\n:::end'), []);
  assert.ok(questionsFor(':::toggle A:C\nh:j\n:::end').some(q => q.kind === 'direct' && q.prompt === 'h' && q.answer === 'j'));
  assert.deepEqual(lines(':::toggle [A] B:\nh:j\n:::end'), []);
  // 한쪽에만 [ ]가 있는 제목은 칸 번호마다 이어받는다
  assert.deepEqual(lines(':::toggle [A] B: D\nh:j\n:::end'), [['h', 'j', 'A.B>D'], ['j', 'h', 'D>A.B']]);
  // 줄에 칸이 더 많아도 칸 번호가 맞는 곳만 이어받고, 이어받을 게 없는 칸에 [ ]가 없으면 문제로 만들지 않는다
  const three = questionsFor(':::toggle [A] B: [C] D\nh:j:k\n:::end').filter(q => q.kind === 'convert' && q.prompt === 'j' && q.answer === 'k');
  assert.deepEqual(three, [], 'the third field has no set');
  // 숨은 집합은 집합 이름이 아니라서 앞(프론트) 글에는 아무것도 더해지지 않는다
  assert.equal(questionsFor(':::toggle [A] B: [C] D\nh:j\n:::end').find(q => q.kind === 'convert' && q.prompt === 'h').conditions.every(text => !text.includes('A.B')), true);
});

test('ability conversion planning: due units combine along a chain and a freed output is skipped without being shown', () => {
  const { planConvertReview, convertModeOf, convertLabel } = loadSource('utils/abilityConvert.ts');
  const units = (memo, logId = 'L1', states = {}) => questionsFor(memo).filter(q => q.kind === 'convert').map(question => ({
    logId, question, state: states[`${question.prompt}>${question.answer}`] || { freedom: 0, reps: 0 }
  }));
  const text = plan => plan.planned.map(item => [item.form, item.question.prompt, item.question.answer]);
  const chain = '[a] b ; [c] d\n[c] d ; [u] e';
  // 둘 다 복습할 때가 되면 결합: b → d → e
  const together = planConvertReview(units(chain));
  assert.deepEqual(text(together), [['chain', 'b', 'd → e']]);
  assert.equal(together.planned[0].covered.length, 2);
  assert.deepEqual(together.planned[0].question.convert.steps.map(step => step.set), ['a', 'c', 'u'], 'every ability set is given');
  assert.equal(together.absorbed.size, 2);
  // 한쪽만 복습할 때가 되면 결합하지 않는다(간격이 달라져 떨어진 경우)
  const separated = planConvertReview(units(chain).slice(0, 1));
  assert.deepEqual(text(separated), []);
  assert.equal(separated.absorbed.size, 0, 'a lone unit is asked as its own question');
  // 자유도: 쉬움으로 자유도를 얻은 출력 값 d를 건너뛴다 → [a] b ; [u] e. 건너뛴 칸과 관계는 문제에 드러나지 않는다.
  const freed = planConvertReview(units(chain, 'L1', { 'b>d': { freedom: 1, reps: 1 } }));
  assert.deepEqual(text(freed), [['jump', 'b', 'e']]);
  const jump = freed.planned[0].question;
  assert.deepEqual(jump.convert.required, [2], 'only the final value has to be answered');
  assert.equal(jump.process, 'b (a) → d (c) → e (u)', 'the whole path is kept for the process button only');
  assert.ok(!jump.answer.includes('d') && !jump.prompt.includes('d'), 'the card itself never names the skipped value');
  assert.equal(freed.planned[0].covered.length, 2, 'both units are graded by the jump');
  // 모드는 건너뛰는지만 가르고(논리관계변주는 따로 정한다), 얼마나 멀리 닿는지는 자유도가 정한다: 1 오를 때마다 1칸, 최대 3칸
  assert.deepEqual([0, 1, 2, 3].map(freedom => convertModeOf({ freedom, reps: 5 })), ['plain', 'skip', 'skip', 'skip']);
  const { convertReachOf } = loadSource('utils/abilityConvert.ts');
  assert.deepEqual([0, 1, 2, 3, 5].map(freedom => convertReachOf({ freedom, reps: 5 })), [0, 1, 2, 3, 3]);
  // 어디에도 부정(¬)이나 여집합 변주는 나오지 않는다
  const every = [chain, '[a] b : [c] d\n[c] d : [u] e'].flatMap(memo => planConvertReview(units(memo, 'L1', { 'b>d': { freedom: 3, reps: 2 } })).planned);
  assert.ok(every.every(item => !('variant' in item.question.convert) && item.question.convert.steps.every(step => !step.set.includes('%') && !step.cell.includes('¬'))));
  assert.equal(convertLabel({ form: 'chain' }), '능력 변환');
  // 다른 노트(다른 과목)와도 이어진다
  const across = planConvertReview([...units('[a] b ; [c] d', 'LA'), ...units('[c] d ; [u] e', 'LB')]);
  assert.deepEqual(text(across), [['chain', 'b', 'd → e']]);
  assert.deepEqual(across.planned[0].covered.map(item => item.logId), ['LA', 'LB']);
  // 긴 길도 최대 4단위까지 이어서 묻는다
  const long = planConvertReview(units('[a] 1 ; [b] 2 ; [c] 3 ; [d] 4 ; [e] 5 ; [f] 6'));
  // 4단위 + 같은 글자의 row 변주(`1 → ＿ → ＿ → ＿ → ＿`) 하나를 함께 덮는다
  assert.deepEqual(long.planned.map(item => item.covered.length), [5], 'a 5-unit chain is asked as one 4-unit question');
  assert.equal(long.planned[0].covered.filter(item => item.questionKey.startsWith('cv1:')).length, 4);
  assert.equal(long.absorbed.size, 5, 'the leftover unit stays an ordinary unit question');
});

test('freedom stretches the ability logic one cell per level: reverse units exist at freedom 0 and farther cells are linked; [A] @ points at the nearest earlier cell of A', () => {
  const { planConvertReview } = loadSource('utils/abilityConvert.ts');
  const units = (memo, freedom = 0, only = null) => questionsFor(memo).filter(q => q.kind === 'convert').map(question => ({
    logId: 'L1', question, state: { freedom: only && `${question.prompt}>${question.answer}` !== only ? 0 : freedom, reps: freedom ? 1 : 0 }
  }));
  const asked = plan => plan.planned.map(item => [item.form, item.question.prompt, item.question.answer]);
  // `:` — 자유도가 0이어도 역방향 단위 문제가 출제된다(b → d 와 d → b 둘 다)
  const both = units('[a] b : [c] d');
  assert.deepEqual(both.map(item => [item.question.prompt, item.question.answer]), [['b', 'd'], ['d', 'b']]);
  assert.deepEqual(planConvertReview(both).planned, [], 'nothing is combined, so both stay ordinary unit questions');
  // 자유도 1칸마다 연결이 한 칸씩 더 멀리 닿는다: 1 → 4 사이에서 가린 칸이 한 칸씩 늘어난다
  const line = '[a] 1 ; [b] 2 ; [c] 3 ; [d] 4';
  const hiddenOf = plan => plan.planned[0].question.convert.required;
  assert.deepEqual(hiddenOf(planConvertReview(units(line, 0))), [1, 2, 3], 'freedom 0 asks every cell');
  assert.deepEqual(hiddenOf(planConvertReview(units(line, 1, '1>2'))), [2, 3], 'freedom 1 on the first unit hides the next cell');
  assert.deepEqual(hiddenOf(planConvertReview(units(line, 2, '1>2'))), [3], 'freedom 2 reaches one cell farther');
  assert.deepEqual(hiddenOf(planConvertReview(units(line, 1, '2>3'))), [1, 3], 'a unit in the middle hides only its own next cell');
  assert.deepEqual(asked(planConvertReview(units(line, 3, '1>2'))), [['jump', '1', '4']], 'the last cell is always asked');
  // `[A] @+1`의 `@`는 A에 든 가장 가까운 앞 칸이다: d는 A에 없으니 건너뛰어 b+1
  const cycle = '[A] b : [C] d : [A] @+1';
  const back = units(cycle, 0).find(item => item.question.prompt === 'd' && item.question.answer === 'b+1');
  assert.ok(back, 'the third cell is b+1, not d+1');
  assert.ok(!units(cycle, 0).some(item => item.question.answer === 'd+1'));
  // 같은 집합에 든 앞 칸이 없으면 바로 앞 칸이다 · 집합을 쓰지 않은 `@+1`은 바로 앞 칸(과 그 집합)을 잇는다
  assert.ok(units('[A] b : [C] d : [E] @+1', 0).some(item => item.question.answer === 'd+1'));
  assert.ok(units('[A] b : [C] d : @+1', 0).some(item => item.question.answer === 'd+1'));
  // 여러 집합을 거쳐 돌아오는 순환: 쓴 길 b → d → b+1 은 자유도 0이면 모든 칸을 묻는다
  assert.deepEqual(asked(planConvertReview(units(cycle, 0))).slice(0, 1), [['chain', 'b', 'd → b+1']]);
  // 자유도 1이면 쓴 길의 2칸째를 묻고 가운데 d는 가린다(쓴 길보다 더 멀리 이어 가지는 않는다)
  assert.deepEqual(asked(planConvertReview(units(cycle, 1))).slice(0, 1), [['jump', 'b', 'b+1']]);
  assert.deepEqual(asked(planConvertReview(units(cycle, 3))).slice(0, 1), [['jump', 'b', 'b+1']], 'no further than the written cells');
  assert.deepEqual(planConvertReview(units(cycle, 2)).planned[0].question.convert.steps.map(step => step.cell), ['b', 'd', 'b+1']);
});

test('# stands for any text: [A] #\'-\'#: #+# makes A:\'B-C\':\'B+C\' through the connect/add merge for every cell of A shaped like #-# (quotes hold no logic word)', () => {
  const { fillNoteTemplate, readNoteTemplate, buildNoteSetIndex, evaluateSetExpression } = loadSource('utils/noteSets.ts');
  // 따옴표 안에는 논리어가 없다: 'B-C'는 순서 B → C가 아니라 한 셀 B-C
  const pairs = memo => questionsFor(memo).map(q => [q.kind, q.prompt, q.answer].join('|'));
  assert.deepEqual([...new Set(pairs("A:'B-C'"))].sort(), ['direct|A|B-C', 'reverse|B-C|A']);
  assert.ok(pairs('A:B-C').some(text => text.startsWith('order-next|B|C')), 'without quotes - is still the sequence word');
  assert.deepEqual([...new Set(pairs("A:'B,C=D'"))].sort(), ['direct|A|B,C=D', 'reverse|B,C=D|A'], ', and = are plain inside quotes too');
  // 틀 읽기: 틀 안 따옴표는 글자(`#'-'#`의 -), 따옴표 없는 `#-#`도 같은 뜻, `'#'`은 글자 #
  assert.deepEqual(readNoteTemplate("[A] #'-'#: #+#"), { marks: ['A'], pattern: "#'-'#", results: ['#+#'], separators: [':'] });
  assert.deepEqual(readNoteTemplate('[A] #-#: #+#'), { marks: ['A'], pattern: '#-#', results: ['#+#'], separators: [':'] });
  assert.equal(readNoteTemplate("#'-'#: #+#"), null, 'without [ ] in front it is an ordinary line');
  assert.equal(readNoteTemplate('[A] x:y'), null);
  assert.equal(readNoteTemplate('[A] C#'), null, 'a single cell is not a template');
  // 따옴표는 논리어만 글자로 만들고 텍스트어 `#`는 따옴표 안에서도 자리다(`'#′'` → `x^2′`)
  assert.deepEqual(readNoteTemplate("[A] 'C#': x")?.results, ['x'], "a quoted '#' is still a blank");
  assert.deepEqual(fillNoteTemplate(readNoteTemplate("[f] #: [f′] '#′'"), 'x^2'), ['[f′] x^2′'], 'the result keeps its [set] as written');
  // 채우기: 첫 #는 첫 값, 둘째 #는 둘째 값. 맞지 않으면 null
  const template = readNoteTemplate("[A] #'-'#: #+#");
  assert.deepEqual(fillNoteTemplate(template, 'B-C'), ['B+C']);
  assert.deepEqual(fillNoteTemplate(readNoteTemplate('[A] #-#: #+#'), 'B-C'), ['B+C']);
  assert.equal(fillNoteTemplate(template, 'BC'), null, 'no - in the cell');
  assert.deepEqual(fillNoteTemplate(template, 'A-B-C'), ['A+B-C'], 'the first # takes the shortest, the last # the rest');
  assert.equal(fillNoteTemplate(readNoteTemplate("[A] #'-'#: #+#+#"), 'B-C'), null, 'more # than values to put in');
  assert.deepEqual(fillNoteTemplate(readNoteTemplate("[A] #'-'#: # ; #*#"), 'B-C'), ['B', 'B*C'], 'each following cell takes the values again from the first');
  // 따옴표는 논리어만 글자로 만든다: `'#'`의 #도 자리라서 값이 모자라면 줄이 없다(글자 #를 쓰는 표기는 아직 없다)
  assert.equal(fillNoteTemplate(readNoteTemplate("[A] #'-'#: #'#'#"), 'B-C'), null, "a quoted '#' is still a blank, so three blanks lack a value");
  assert.equal(fillNoteTemplate(template, '#-#'), null, 'the template itself is not a value');
  // 연결어가 있는 줄(A:'B-C')은 연결·첨가로 이어진다: A와 이 셀이 이미 있는 줄마다 합친 줄이 생긴다(여러 자리면 모두)
  const expected = ['direct|A|B-C', 'direct|B-C|B+C', 'direct|A|X-Y', 'direct|X-Y|X+Y'];
  const lines = new Set(pairs("A:'B-C'\nA:'X-Y'\nA:plain\n[A] #'-'#: #+#"));
  expected.forEach(text => assert.ok(lines.has(text), `${text} from the lines`));
  assert.ok(!lines.has('direct|plain|plain+'), 'cells that do not fit #-# make nothing');
  assert.ok([...lines].every(text => !text.includes('#')), 'the template line itself is no question');
  assert.ok(lines.has('reverse|B+C|B-C') && lines.has('reconstruct|A|B-C → B+C'), 'the chain A : B-C : B+C is a whole line');
  const twice = new Set(pairs("A:'B-C'\nA:x:'B-C'\n[A] #'-'#: #+#"));
  assert.ok(twice.has('reconstruct|A|B-C → B+C') && twice.has('reconstruct|A|x → B-C → B+C'), 'every place where the merge can be made gets its own question');
  // 연결어 없이 [A] 안에 든 셀(토글 · 위치 표시)은 A와 교집합이라 `[A] 'B-C':'B+C'` 줄이 된다: 조건 A
  const inside = (memo) => questionsFor(memo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer, (q.conditions || []).slice(-1).join('')].join('|'));
  ["[A] #'-'#: #+#\n:::toggle A\n'B-C'\n'X-Y'\nplain\n:::end", "[A] 'B-C'\n[A] 'X-Y'\n[A] plain\n[A] #'-'#: #+#", "[A] 'B-C'\n[A] 'X-Y'\n[A] plain\n[A] #-#: #+#"].forEach(memo => {
    const found = new Set(inside(memo));
    assert.ok(found.has('B-C|B+C|A') && found.has('X-Y|X+Y|A'), `${JSON.stringify(memo)} → ${[...found]}`);
    assert.ok(![...found].some(text => text.startsWith('plain|')), 'cells that do not fit #-# make nothing');
  });
  // 틀 줄은 집합의 요소가 아니다
  assert.deepEqual(evaluateSetExpression(buildNoteSetIndex(["[A] 'B-C'\n[A] #'-'#: #+#"]), '[A]'), ["'B-C'"]);
  // 집합식 `[도형.삼각형]`이면 그 식의 셀에 줄 앞 `[식]`을 달아 만든다 · 둘째 칸 기호(`;`)는 그대로
  const wide = pairs(":::toggle 동물\n:::toggle 포유류\n'소-젖'\n:::end\n:::end\n[동물] #'-'#; #에서 #");
  assert.ok(wide.includes('direct|소-젖|소에서 젖') && wide.includes('reverse|소에서 젖|소-젖') === false, 'the ; of the template keeps the forward-only direction');
});

test('difficulty recommendation from the time to reveal: fast is easy, normal is good, slow is hard, never wrong, too quick to count is none', () => {
  const rec = loadSource('utils/gradeRecommendation.ts');
  // 기록이 없으면 정답 글자 수로 어림한다: 10자 → 2500 + 2200 = 4.7초
  assert.equal(Math.round(rec.expectedResponseMs(undefined, 10)), 4700);
  assert.equal(rec.expectedResponseMs(undefined, 0), 3000, 'a floor so very short answers are not judged on milliseconds');
  assert.equal(rec.expectedResponseMs(undefined, 1000), 60000, 'and a ceiling');
  const at = (elapsedMs, extra = {}) => rec.recommendReviewGrade({ elapsedMs, textLength: 10, ...extra });
  assert.equal(at(1000), null, 'under 1.2 s is a skip, not a recall');
  assert.equal(at(2300), 'easy', 'half the usual time or less');
  assert.equal(at(4700), 'good');
  assert.equal(at(6100), 'good', 'up to 1.3 times the usual');
  assert.equal(at(6200), 'hard');
  assert.equal(at(600000), 'hard', 'however slow, the answer is never "wrong" - only the learner knows that');
  // 지난 첫 시도 기록이 2번 이상이면 그 가운데 값이 기준이 된다
  assert.equal(rec.expectedResponseMs([8000], 10), 4700, 'one record is not enough');
  assert.equal(rec.expectedResponseMs([8000, 12000, 4000], 10), 8000);
  assert.equal(rec.expectedResponseMs([6000, 10000], 10), 8000);
  assert.equal(at(3000), 'good', 'by the length guess 3 s is a normal time');
  assert.equal(at(3000, { history: [8000, 12000, 4000] }), 'easy', 'but against this question\'s own history it is quick');
  assert.equal(at(5000, { history: [8000, 12000, 4000] }), 'good');
  assert.equal(at(11000, { history: [8000, 12000, 4000] }), 'hard');
  assert.equal(rec.formatResponseSeconds(4200), '4.2초');
  assert.equal(rec.formatResponseSeconds(12400), '12초');
  assert.equal(rec.formatResponseSeconds(75000), '1분 15초');
});

test('FSRS-6 scheduling for review questions: grades drive the interval, unit questions gain and lose freedom, the old path stays when there are no grades', () => {
  const practice = loadSource('utils/reviewPractice.ts');
  const t0 = Date.parse('2026-09-13T04:00:00.000Z');
  const perf = (previous, wrong, attempts, grades, extra = {}) => practice.calculateQuestionPerformance(previous, wrong, attempts, { grades, nowMs: t0, ...extra });
  // 등급이 없으면 예전 방식(두 배씩) 그대로
  assert.equal(practice.calculateQuestionPerformance(undefined, 0, 1).fsrs, undefined);
  const first = grade => perf(undefined, 0, 1, [grade]);
  assert.ok(first('again').intervalMs < first('hard').intervalMs && first('hard').intervalMs < first('good').intervalMs && first('good').intervalMs < first('easy').intervalMs);
  assert.ok(first('good').fsrs && first('good').fsrs.reps === 1);
  // 일반 문제도 첫 시도 쉬움이면 자유도가 오른다(관계쌍 묶음이 결합 범위에 쓴다). 다만 쉬움은 FSRS의 쉬움 그대로 간격이 더 길어진다
  assert.equal(first('easy').freedom, 1);
  assert.equal(first('good').freedom, 0);
  // 능력 변환 단위: 쉬움은 맞음(좋음)으로 처리되고 자유도만 오른다 → 간격은 맞음과 같다
  const unit = (previous, grades, extra = {}) => perf(previous, grades[0] === 'again' ? 1 : 0, grades.length, grades, { unit: true, ...extra });
  const good = unit(undefined, ['good']);
  const easy = unit(undefined, ['easy']);
  assert.equal(easy.freedom, 1);
  assert.equal(good.freedom, 0);
  assert.equal(easy.intervalMs, good.intervalMs, 'easy counts as correct until the freedom is full');
  assert.deepEqual([easy.fsrs.stability, easy.fsrs.difficulty], [good.fsrs.stability, good.fsrs.difficulty]);
  // 자유도는 단계마다 한 칸씩, 최대 3
  let state = undefined;
  const freedoms = [];
  for (let step = 0; step < 4; step += 1) { state = unit(state, ['easy']); freedoms.push(state.freedom); }
  assert.deepEqual(freedoms, [1, 2, 3, 3]);
  // 최대 자유도를 가진 뒤에야 쉬움이 FSRS의 쉬움으로 간격을 더 늘린다
  const full = { ...state, freedom: 3 };
  const fullEasy = unit(full, ['easy'], { nowMs: t0 + 3 * day });
  const fullGood = unit(full, ['good'], { nowMs: t0 + 3 * day });
  assert.ok(fullEasy.intervalMs > fullGood.intervalMs, 'after the maximum freedom, easy lengthens the interval');
  assert.equal(fullEasy.freedom, 3);
  // 틀리면 자유도가 한 단계 줄어든다(0 아래로는 내려가지 않는다)
  assert.equal(unit({ ...state, freedom: 2 }, ['again', 'good']).freedom, 1);
  assert.equal(unit(undefined, ['again', 'good']).freedom, 0);
  // 오답 뒤 같은 세션에서 다시 맞히면 같은 날 복습 공식으로 이어진다: 다시 풀지 않은 오답보다 길다
  assert.ok(unit(undefined, ['again', 'good']).intervalMs >= unit(undefined, ['again']).intervalMs);
  // 걸린 시간 기록: 최근 6개만, 첫 시도 시간
  let timed = undefined;
  [1000, 2000, 3000, 4000, 5000, 6000, 7000].forEach(ms => { timed = perf(timed, 0, 1, ['good'], { responseMs: ms }); });
  assert.deepEqual(timed.responseMs, [2000, 3000, 4000, 5000, 6000, 7000]);
  assert.deepEqual(perf(timed, 0, 1, ['good']).responseMs, timed.responseMs, 'no new time keeps the old records');
  // 단계 수·누적 오답은 예전 의미를 그대로 잇는다
  assert.equal(perf(undefined, 0, 1, ['good']).reviewStep, 1);
  assert.equal(perf({ reviewStep: 3, wrongCount: 1, attempts: 4 }, 1, 2, ['again', 'good']).reviewStep, 2);
  // 예전 일정(FSRS 기록이 없는 것)은 그때의 간격을 안정도로 보고 이어 간다
  const legacy = { reviewStep: 3, wrongCount: 0, attempts: 3, intervalMs: 4 * day, nextReviewDate: new Date(t0).toISOString() };
  const carried = perf(legacy, 0, 1, ['good']);
  assert.ok(carried.fsrs.reps >= 4 && carried.intervalMs > 4 * day, 'the carried-over memory keeps growing');
  // 8일에 닿으면 답을 가린다
  assert.equal(perf({ ...legacy, intervalMs: 10 * day }, 0, 1, ['good']).masked, true);
  // 평가 버튼에 보여 줄 간격: 어려울수록 빨리 돌아온다. 오답은 다시 풀어 맞힌 뒤의 간격이다
  const preview = practice.previewGradeIntervals(undefined, t0);
  assert.ok(preview.again < preview.hard && preview.hard < preview.good && preview.good < preview.easy);
  const again = unit(undefined, ['again', 'good']);
  assert.equal(practice.previewGradeIntervals(undefined, t0, true).again, again.intervalMs);
});

test('graded results flow through the review gate: unit questions keep FSRS memory, freedom and response times in the pending schedule', () => {
  const memo = '[a] b ; [c] d';
  const log = source({ reviewMemo: memo, reviewStep: 0 });
  const unitKey = gate.parseReviewGateMemo(memo).questions.find(q => q.kind === 'convert').key;
  assert.ok(unitKey.startsWith('cv1:'));
  assert.deepEqual(gate.getDueReviewGateQuestionKeys(log, now, true), [unitKey], 'the unit question is due with the note');
  const graded = (grades, extra = {}) => gate.applyReviewGateOutcomes([log], [{
    logId: 'note-a', passed: true, wrongQuestionKeys: [], completedQuestionKeys: [unitKey],
    questionResults: { [unitKey]: { wrongCount: 0, attempts: grades.length, grades, responseMs: 5200, ...extra } }
  }], false, now)[0];
  const afterEasy = graded(['easy']);
  const pending = afterEasy.reviewGatePendingSchedules[unitKey];
  assert.equal(pending.freedom, 1, 'easy gives one level of freedom');
  assert.ok(pending.fsrs && pending.fsrs.reps === 1);
  assert.deepEqual(pending.responseMs, [5200]);
  assert.equal(pending.reviewStep, 1);
  assert.ok(Date.parse(pending.nextReviewDate) > now);
  // 복습을 마치면 일정으로 확정되고, 다음 복습의 자유도·기억이 이어진다
  const finished = { ...afterEasy, ...gate.completeRegularReviewSchedule(afterEasy, now) };
  const stored = finished.reviewQuestionSchedules[unitKey];
  assert.equal(stored.freedom, 1);
  assert.deepEqual(stored.fsrs, pending.fsrs);
  const second = gate.applyReviewGateOutcomes([finished], [{
    logId: 'note-a', passed: true, wrongQuestionKeys: [], completedQuestionKeys: [unitKey],
    questionResults: { [unitKey]: { wrongCount: 0, attempts: 1, grades: ['easy'], responseMs: 3000 } }
  }], false, now + 3 * day)[0].reviewGatePendingSchedules[unitKey];
  assert.equal(second.freedom, 2);
  assert.equal(second.fsrs.reps, 2);
  assert.deepEqual(second.responseMs, [5200, 3000]);
  // 오답이면 자유도가 줄고 다시 풀 문제로 남는다
  const afterWrong = gate.applyReviewGateOutcomes([finished], [{
    logId: 'note-a', passed: false, wrongQuestionKeys: [unitKey], completedQuestionKeys: [unitKey],
    questionResults: { [unitKey]: { wrongCount: 1, attempts: 2, grades: ['again', 'good'] } }
  }], false, now + 3 * day)[0];
  assert.equal(afterWrong.reviewGatePendingSchedules[unitKey].freedom, 0);
  // 등급 없이 들어오면(예전 호출) 예전 방식대로 FSRS 기록 없이 쌓인다
  const legacy = gate.applyReviewGateOutcomes([log], [{
    logId: 'note-a', passed: true, wrongQuestionKeys: [], completedQuestionKeys: [unitKey],
    questionResults: { [unitKey]: { wrongCount: 0, attempts: 1 } }
  }], false, now)[0].reviewGatePendingSchedules[unitKey];
  assert.equal(legacy.fsrs, undefined);
  assert.equal(legacy.freedom, undefined);
  // 일반 문제는 등급이 있어도 자유도가 붙지 않는다
  const plainKey = sourceQuestions.find(q => q.kind === 'direct').key;
  const plain = gate.applyReviewGateOutcomes([source()], [{
    logId: 'note-a', passed: true, wrongQuestionKeys: [], completedQuestionKeys: [plainKey],
    questionResults: { [plainKey]: { wrongCount: 0, attempts: 1, grades: ['easy'] } }
  }], false, now)[0].reviewGatePendingSchedules[plainKey];
  assert.equal(plain.freedom, 1);
  assert.ok(plain.fsrs);
});

test('subject difficulty feedback: speed (P/h) from the same subject, a recommendation that never says again, and a target speed next to easy', () => {
  const fb = loadSource('utils/subjectFeedback.ts');
  const log = (id, pages, minutes, extra = {}) => ({ id, subjectId: 'S', pagesRead: pages, timeSpentMinutes: minutes, timestamp: `2026-10-0${id}T10:00:00.000Z`, ...extra });
  assert.equal(fb.speedPerHour(10, 60), 10, 'pages per hour');
  assert.equal(fb.speedPerHour(0, 60), null);
  assert.equal(fb.speedPerHour(5, 0), null);
  const logs = [
    log('1', 10, 60, { feedbackGrade: 'good' }), log('2', 12, 60, { feedbackGrade: 'good' }), log('3', 15, 60, { feedbackGrade: 'easy' }),
    log('4', 8, 60, { reviewParentSubjectId: 'P', feedbackGrade: 'hard' }), { ...log('5', 9, 60), subjectId: 'OTHER' }
  ];
  // 공부 기록과 복습 측정 기록은 따로 모은다. 다른 과목은 섞이지 않는다.
  assert.deepEqual(fb.pastSessions(logs, 'S', 'study').map(item => item.id), ['1', '2', '3']);
  assert.deepEqual(fb.pastSessions(logs, 'S', 'review').map(item => item.id), ['4']);
  const summary = fb.summarizeSpeedFeedback(fb.pastSessions(logs, 'S', 'study'));
  assert.equal(summary.averageSpeed, 12, 'the middle value of the recent speeds');
  assert.ok(Math.abs(summary.targetSpeed - 12 * fb.EASY_SPEED_RATIO) < 1e-9, 'target speed = average x 1.15');
  assert.deepEqual(summary.byGrade.map(item => [item.grade, item.count, item.averageSpeed]), [['good', 2, 11], ['easy', 1, 15]], 'which feedback was given at which average speed');
  assert.deepEqual(fb.summarizeSpeedFeedback([]), { averageSpeed: null, targetSpeed: null, byGrade: [] });
  // 추천: 평균보다 충분히 빠르면 쉬움, 비슷하면 보통, 느리면 어려움, 기록이 없으면 권하지 않는다. 다시는 권하지 않는다.
  assert.equal(fb.recommendSubjectGrade(14, 12), 'easy');
  assert.equal(fb.recommendSubjectGrade(12, 12), 'good');
  assert.equal(fb.recommendSubjectGrade(10.5, 12), 'good');
  assert.equal(fb.recommendSubjectGrade(10, 12), 'hard', 'below 85% of the average');
  assert.equal(fb.recommendSubjectGrade(1, 12), 'hard', 'slow is hard, never again');
  assert.equal(fb.recommendSubjectGrade(14, null), null);
  assert.equal(fb.recommendSubjectGrade(null, 12), null);
  assert.equal(fb.formatSpeed(13.14, 'P'), '13.1P/h');
  assert.equal(fb.formatSpeed(null), '-');
});

test('subject difficulty feedback drives the next review with FSRS-6: study logs, repeated reviews, unit registration and the review gate', () => {
  const fb = loadSource('utils/subjectFeedback.ts');
  const fsrs = loadSource('utils/fsrs.ts');
  const review = loadSource('utils/review.ts');
  const t0 = Date.parse('2026-10-21T10:00:00.000Z');
  const dayMs = 86400000;
  const study = { id: 'a', subjectId: 'S', pagesRead: 10, timeSpentMinutes: 50, timestamp: new Date(t0).toISOString(), reviewEnabled: true };
  // 첫 평가가 첫 기억이 되고, 쉬울수록 다음 복습이 멀다
  const cards = Object.fromEntries(['again', 'hard', 'good', 'easy'].map(grade => [grade, fb.gradeSubjectCard(study, grade, t0)]));
  const due = grade => fsrs.fsrsIntervalMs(cards[grade]);
  assert.ok(due('again') < due('hard') && due('hard') < due('good') && due('good') < due('easy'));
  assert.equal(cards.good.reps, 1);
  const preview = fb.previewSubjectIntervals(null, t0);
  assert.deepEqual(['again', 'hard', 'good', 'easy'].map(grade => preview[grade]), ['again', 'hard', 'good', 'easy'].map(due), 'the buttons show the same intervals the grade will schedule');
  // 예전 기록(평가 없음)은 지금 복습 단계의 간격을 이어 간다: 3단계 = 4일 간격
  const legacy = { ...study, reviewStep: 3, nextReviewDate: new Date(t0 + 4 * dayMs).toISOString() };
  const carried = fb.subjectCardOf(legacy);
  assert.equal(carried.stability, 4);
  assert.equal(carried.lastReviewMs, t0, 'the last review is when the previous interval began');
  const easyAfterLegacy = fb.gradeSubjectCard(legacy, 'easy', t0 + 4 * dayMs);
  assert.ok(fsrs.fsrsIntervalMs(easyAfterLegacy) > 4 * dayMs, 'a good review after step 3 keeps growing instead of restarting');
  assert.equal(fb.subjectCardOf({ ...study, reviewStep: 0 }), null);
  // 반복 복습: 평가가 있으면 FSRS 날짜와 기억을 이어 가고, 없으면 예전처럼 두 배씩
  const repeated = review.createRepeatedSubjectReview(study, 'P', 2, t0, cards.good);
  assert.deepEqual(repeated.reviewFsrs, cards.good);
  assert.equal(Date.parse(repeated.nextReviewDate), t0 + due('good'));
  assert.equal(Date.parse(review.createRepeatedSubjectReview(study, 'P', 2, t0).nextReviewDate), t0 + 4 * dayMs * 1, 'unchanged without feedback: 2^step days');
  // 복습 등록: 평가가 있는 기록은 그 날짜, 없는 기록은 2시간 뒤
  const pendingLogs = [{ ...study, id: 'p1', unitReviewPending: true, reviewEnabled: false, isCondensed: true, reviewFsrs: cards.easy },
    { ...study, id: 'p2', unitReviewPending: true, reviewEnabled: false, isCondensed: true }];
  const registered = review.registerPendingReviews('S', pendingLogs, t0).logs;
  assert.equal(Date.parse(registered.find(item => item.id === 'p1').nextReviewDate), t0 + due('easy'));
  assert.equal(Date.parse(registered.find(item => item.id === 'p2').nextReviewDate), t0 + 2 * 3600000);
  // 복습을 마칠 때: 문제가 없어도(노트 비어도) 과목 평가가 다음 복습을 정하고, 문제 일정이 더 빠르면 그쪽을 따른다
  const gateModule = loadSource('utils/reviewGate.ts');
  const finished = { ...study, reviewStep: 0, reviewFsrs: cards.good, reviewMemo: '' };
  assert.equal(Date.parse(gateModule.completeRegularReviewSchedule(finished, t0).nextReviewDate), t0 + due('good'));
  const noFeedback = gateModule.completeRegularReviewSchedule({ ...study, reviewStep: 0 }, t0);
  assert.equal(Date.parse(noFeedback.nextReviewDate), t0 + dayMs, 'without feedback the old doubling still applies');
});

test('a leading [set] is the scope of the whole line: [a] X:y puts X:y inside a, so a is a condition and never part of the text', () => {
  const brief = memo => questionsFor(memo).filter(q => q.kind !== 'recall').map(q => [q.kind, q.prompt, q.answer, q.conditions.join('|')]);
  const both = [['direct', 'X', 'y', 'a'], ['reverse', 'y', 'X', 'a']];
  assert.deepEqual(brief('[a] X:y'), both);
  assert.deepEqual(brief('[a] X=y'), both, '= is an unclassified : (X and y are the same inside a)');
  assert.deepEqual(brief('[a] X;y'), [['direct', 'X', 'y', 'a']], '; keeps going forward only');
  assert.deepEqual(brief('[a][b] X:y')[0], ['direct', 'X', 'y', 'a.b'], 'several sets are intersected');
  assert.deepEqual(brief('[a] X-y'), [['order-next', 'X', 'y', 'a'], ['order-previous', 'y', 'X', 'a']], '- inside a set');
  assert.ok(questionsFor('[a] X:y').every(q => !/[\[\]]/.test(q.prompt + q.answer)), 'no bracket text leaks into the question');
  // 모든 칸에 집합이 따로 있으면 칸마다 자기 집합이다(집합 조건이 붙지 않는다)
  assert.deepEqual(questionsFor('[a] b ; [c] d').map(q => [q.kind, q.conditions.length]), [['convert', 0]]);
  // 모든 칸에 집합이 있는 순서는 분류기준 없는 `;`다. 집합이 없는 순서는 그대로 순서 문제다.
  const dash = questionsFor('[a] b - [c] d');
  assert.deepEqual(dash.map(q => [q.kind, q.prompt, q.answer]), [['convert', 'b', 'd']]);
  assert.equal(dash[0].key, questionsFor('[a] b ; [c] d')[0].key, 'the same unit as ;');
  assert.deepEqual(questionsFor('A-B-C').filter(q => q.kind === 'order-next').map(q => [q.prompt, q.answer]), [['A', 'B'], ['B', 'C']]);
});

test('a logic chunk is one cell: A:B,C is the cells A and "B,C", and its inside can be masked anywhere except the sets', () => {
  const { planConvertReview, isConvertUnitKey, MASK } = loadSource('utils/abilityConvert.ts');
  const converts = memo => questionsFor(memo).filter(q => q.kind === 'convert');
  const units = memo => converts(memo).filter(q => !q.convert.variation);
  const variations = memo => converts(memo).filter(q => q.convert.variation === 'cell');
  // 한 칸: `B,C`가 B와 C로 쪼개지지 않는다
  assert.deepEqual(units('[a] A : [b] B, C').map(q => [q.prompt, q.answer, q.convert.steps.map(step => step.set).join('>')]),
    [['B, C', 'A', 'b>a'], ['A', 'B, C', 'a>b']].sort((x, y) => (x[0] === units('[a] A : [b] B, C')[0].prompt ? -1 : 1)));
  assert.equal(units('[a] A ; [b] B, C').length, 1, 'one unit for the pair, each cell gets its own freedom');
  // 덩어리 안쪽을 가린 변주: 보이는 항목 뒤에 빈칸(그리고는 순서가 없다)
  assert.deepEqual(variations('[a] A ; [b] B, C').map(q => q.convert.partial[1]).sort(), [`B, ${MASK}`, `C, ${MASK}`].sort());
  assert.deepEqual(variations('[a] A ; [b] B, C').map(q => q.answer).sort(), ['B', 'C']);
  // 순서: 자리를 그대로 두고 가린다. "정리 다음 단계는?"은 `읽기-정리-＿`
  const steps = variations('[과정] 풀이 ; [단계] 읽기-정리-확인');
  assert.deepEqual(steps.map(q => q.convert.partial[1]).sort(), ['읽기-정리-＿', '읽기-＿-확인', '＿-정리-확인', '읽기-＿-＿', '＿-정리-＿', '＿-＿-확인'].sort());
  assert.ok(steps.every(q => q.convert.partial[1] !== '＿-＿-＿'), 'hiding everything is the unit question itself');
  const next = steps.find(q => q.convert.partial[1] === '읽기-정리-＿');
  assert.equal(next.answer, '확인');
  assert.equal(next.prompt, '풀이', 'the value to convert stays given');
  assert.deepEqual(next.convert.steps.map(step => step.set), ['과정', '단계'], 'the sets are always given and never masked');
  assert.deepEqual(next.convert.given, [0]);
  assert.deepEqual(next.convert.required, [1]);
  // 집합(논리어)은 가리지 않고, 변주는 보통 문제로 `[ ]` 글이 새지 않는다
  assert.ok(converts('[과정] 풀이 ; [단계] 읽기-정리-확인').every(q => !/[\[\]]/.test(q.prompt + q.answer + (q.convert.partial?.[1] ?? ''))));
  assert.ok(!questionsFor('[과정] 풀이 ; [단계] 읽기-정리-확인').some(q => ['order-next', 'order-previous', 'far', 'remaining', 'direct'].includes(q.kind)));
  // 변주는 단위가 아니다: 결합하지 않고 자유도가 붙지 않는다
  steps.forEach(q => { assert.ok(q.key.startsWith('cvv:')); assert.ok(!isConvertUnitKey(q.key)); });
  const candidates = converts('[a] A ; [b] B, C\n[b] B, C ; [u] E').map(q => ({ logId: 'L', question: q, state: { freedom: 0, reps: 0 } }))
    .filter(item => item.question.convert.form === 'unit');
  const plan = planConvertReview(candidates);
  assert.equal(plan.planned.length, 1, 'the two units sharing the cell "B, C" still combine');
  assert.ok(!plan.planned[0].covered.some(item => item.questionKey.startsWith('cvv:')));
  // 집합이 첫 항목 말고 다른 항목에도 있으면 한 칸이 아니다
  assert.equal(units('[a] A ; [b] B, [c] C').length, 0);
  // 한 줄 전체의 빈칸: 집합은 가리지 않고 값만 가린다. 두 칸만 남는 것은 단위 문제와 같아서 내지 않는다.
  const rows = questionsFor('[a] b ; [c] d ; [e] f').filter(q => q.convert?.variation === 'row');
  assert.deepEqual(rows.map(q => q.prompt).sort(), [`b → ${MASK} → ${MASK}`, `b → ${MASK} → f`, `b → d → ${MASK}`].sort());
  const middle = rows.find(q => q.prompt === `b → ${MASK} → f`);
  assert.deepEqual([middle.convert.given, middle.convert.required, middle.answer], [[0, 2], [1], 'd']);
  assert.deepEqual(middle.convert.steps.map(step => step.set), ['a', 'c', 'e']);
  assert.ok(!questionsFor('[a] b ; [c] d ; [e] f').some(q => ['blank', 'reconstruct'].includes(q.kind)), 'no raw [ ] text is blanked any more');
  // 쉬울수록 가린 칸이 적고, 칸을 더 가릴수록 어렵다
  const easyRow = rows.find(q => q.prompt === `b → d → ${MASK}`);
  const hardRow = rows.find(q => q.prompt === `b → ${MASK} → ${MASK}`);
  assert.ok(easyRow.difficulty < hardRow.difficulty);
});

test('@ points at the cell just before : ; < = (or the toggle title): bare @ is its value, [@] is its sets', () => {
  const cells = memo => questionsFor(memo).filter(q => q.convert && !q.convert.variation).map(q => [q.prompt, q.answer, q.convert.steps.map(step => step.set).join('>')]);
  assert.deepEqual(cells('[A] B: @+1'), [['B', 'B+1', 'A>A'], ['B+1', 'B', 'A>A']], '[A] B : @+1 is [A] B : [A] B+1');
  assert.deepEqual(cells('[A] B: [@] C'), [['B', 'C', 'A>A'], ['C', 'B', 'A>A']], '[@] takes only the sets');
  assert.deepEqual(cells('[A][X] B ; [@] C'), [['B', 'C', 'A.X>A.X']]);
  assert.deepEqual(cells('[A] B ; [Q,@] C'), [['B', 'C', 'A>Q,A']], '@ inside a set expression works like a name');
  assert.deepEqual(cells('[A] B ; [C] @+1'), [['B', 'B+1', 'A>C']], 'a cell that writes its own sets keeps them');
  assert.deepEqual(cells('[A] B ; @+1 ; @+1'), [['B', 'B+1', 'A>A'], ['B+1', 'B+1+1', 'A>A']], 'each @ refers to the cell right before it');
  assert.deepEqual(cells('[A] B ; @ ; [C] x'), [['B', 'x', 'A>C']], 'a cell that is the same value as the one before is skipped, the next pair stays');
  // 토글 제목 아래 줄의 @는 제목의 마지막 칸이다
  assert.deepEqual(cells(':::toggle [A] B:\n@+1\n:::end'), [['B', 'B+1', 'A>A'], ['B+1', 'B', 'A>A']]);
  // 메일 주소처럼 글자에 붙은 @는 가리킴이 아니고, 앞 칸이 없으면 그대로 둔다
  assert.deepEqual(questionsFor('a@b.c : x').filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['a@b.c', 'x']]);
  assert.doesNotThrow(() => questionsFor('@ : x'));
  assert.equal(questionsFor('@ : x').find(q => q.kind === 'direct').prompt, '@');
  // 보통 관계에서도 같다
  assert.deepEqual(questionsFor('B : @+1').filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['B', 'B+1']]);
  // 같은 줄이 아닌 칸은 가리키지 않는다
  assert.deepEqual(questionsFor('A : B\n@ : C').filter(q => q.kind === 'direct').map(q => q.prompt), ['A', '@']);
});

test('adding a link or editing a cell only creates questions for that part; the rest keeps its key and schedule, and new units combine with old ones', () => {
  const { planConvertReview } = loadSource('utils/abilityConvert.ts');
  const unitKeys = memo => questionsFor(memo).filter(q => q.convert && !q.convert.variation).map(q => q.key);
  const base = '[a] b ; [c] d';
  const linked = `${base}\n[c] d ; [u] e`;
  const added = unitKeys(linked).filter(key => !unitKeys(base).includes(key));
  assert.equal(added.length, 1, 'only the new link is a new question');
  assert.ok(unitKeys(base).every(key => unitKeys(linked).includes(key)));
  // 값을 고치면 그 줄의 단위만 바뀐다
  const three = '[a] b ; [c] d\n[x] p ; [y] q';
  const edited = '[a] b ; [c] d\n[x] p ; [y] q2';
  assert.deepEqual(unitKeys(edited).filter(key => unitKeys(three).includes(key)), unitKeys(three).slice(0, 1));
  assert.equal(unitKeys(edited).length, 2);
  // 새 연결도 결합의 원리를 따른다: 같은 칸으로 이어진 단위는 한 문제로 묶인다
  const candidates = questionsFor(linked).filter(q => q.convert && !q.convert.variation).map(q => ({ logId: 'L', question: q, state: { freedom: 0, reps: 0 } }));
  const plan = planConvertReview(candidates);
  assert.equal(plan.planned.length, 1);
  assert.deepEqual(plan.planned[0].question.convert.steps.map(step => step.cell), ['b', 'd', 'e']);
});

test('the same question is never asked twice: a repeated line, or the same cells linked by other symbols or at other places, is one question', () => {
  const kinds = memo => questionsFor(memo).filter(q => q.kind !== 'recall').map(q => [q.kind, q.prompt, q.answer]);
  assert.deepEqual(kinds('A:B\nA:B'), kinds('A:B'), 'the same line twice');
  assert.deepEqual(kinds('A;B\nA;B'), kinds('A;B'));
  assert.deepEqual(kinds('[a] b ; [c] d\n[a] b ; [c] d'), kinds('[a] b ; [c] d'));
  assert.deepEqual(kinds('[a] b ; [c] d\n[a] b ; [c] d').length, 1);
  // 결합은 기호(:·;)나 노트의 위치와 상관없이 집합으로 이어진다: 같은 집합의 같은 값은 같은 단위다
  const units = memo => questionsFor(memo).filter(q => q.convert && !q.convert.variation);
  assert.equal(units('[a] b ; [c] d\n[a] b : [c] d').length, 2, 'forward once, reverse once');
  const placed = units('[a] b ; [c] d\n:::toggle T\n[a] b ; [c] d\n:::end');
  assert.equal(placed.length, 1, 'the same unit inside a toggle is the same unit');
  assert.equal(placed[0].key, units('[a] b ; [c] d')[0].key, 'the key does not depend on where the line is');
  assert.deepEqual(units('[a] b ; [c] d\n:::toggle T\n[a] b ; [c] d\n:::end')[0].conditions, [], 'the unit keeps the first line as its place');
  // 둘째 줄의 글자 범위도 가림에 쓰이고, 난도는 한 줄 기준이다
  const twice = questionsFor('A:B\nA:B').find(q => q.kind === 'direct');
  const once = questionsFor('A:B').find(q => q.kind === 'direct');
  assert.equal(once.answerSpans.length, 1);
  assert.equal(twice.answerSpans.length, 2, 'both lines are hidden when the answer is masked');
  assert.equal(twice.difficulty, once.difficulty);
  // 같은 글이어도 위쪽 토글(조건)이 다른 보통 문제는 서로 다른 문제다
  assert.equal(questionsFor('A:B\n:::toggle T\nA:B\n:::end').filter(q => q.kind === 'direct').length, 2);
});

test('logic words: a matched [ ] chunk, its inner symbols included, gets its own color without changing any text', () => {
  const mark = text => memoColors.markReviewMemoLogicWords(text, memoColors.splitReviewMemoColonColors(text));
  const memo = '[급수.[A:C]] 정사각형: [도형] 사각형; 설명';
  const parts = mark(memo);
  assert.equal(parts.map(part => part.text).join(''), memo);
  // 겹친 `[ ]`는 가장 바깥 하나가 한 덩어리
  assert.equal(parts.filter(part => part.logic).map(part => part.text).join(''), '[급수.[A:C]][도형]');
  // 덩어리 안의 `:`는 colonIndex를 그대로 두고 논리어 색을 받고, 덩어리 밖의 `:` `;`는 지금처럼 자리 색이다
  const inner = mark('[a:b] x : y');
  assert.equal(inner.filter(part => part.logic).map(part => part.text).join(''), '[a:b]');
  assert.deepEqual(inner.filter(part => part.colonIndex !== undefined && !part.logic).map(part => [part.text, part.colonIndex]), [[':', 0]]);
  // 아직 닫지 않은 `[`나 줄을 넘는 `[`는 논리어가 아니다
  assert.ok(!mark('[abc : d').some(part => part.logic));
  assert.ok(!mark('[abc\nd]').some(part => part.logic));
  // `[`가 없으면 조각을 그대로 돌려준다
  const plain = memoColors.splitReviewMemoColonColors('a: b; c');
  assert.equal(memoColors.markReviewMemoLogicWords('a: b; c', plain), plain);
  // 화면: 논리어 조각은 data-logic-word와 논리어 색을 받는다
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MemoColorTextarea } = loadSource('components/MemoColorTextarea.tsx');
  const html = renderToStaticMarkup(React.createElement(MemoColorTextarea, { value: '[a:b] x: y', colorColons: true, onChange: () => {} }));
  assert.match(html, /data-logic-word="true"[^>]*color:#0f766e/);
  assert.equal((html.match(/data-colon-index/g) || []).length, 1, 'only the colon outside the bracket keeps its place color');
  assert.ok(!renderToStaticMarkup(React.createElement(MemoColorTextarea, { value: '[a:b] x: y', colorColons: false, onChange: () => {} })).includes('data-logic-word'));
});

test('the = and - shorthand can be turned off: both become plain letters everywhere notes are read', () => {
  const shorthand = loadSource('utils/noteShorthand.ts');
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const { parseReviewMemoSyntax, isReviewSequenceSeparator } = loadSource('utils/reviewMemoLogic.ts');
  const { buildNoteSetIndex } = loadSource('utils/noteSets.ts');
  const shape = memo => buildReviewQuestions(memo).questions.map(question => `${question.kind}|${question.prompt}|${question.answer}`);
  try {
    assert.equal(shorthand.isNoteShorthandOn(), true, 'on by default');
    assert.deepEqual(shape('a=b'), ['direct|a|b', 'reverse|b|a']);
    assert.ok(shape('서울-부산-대구').includes('order-next|서울|부산'));
    assert.equal(shorthand.relationMarks(), ':;<', '`=` never splits columns');
    assert.deepEqual(shape('a=b=c'), ['direct|a|b', 'reverse|b|a', 'direct|b|c', 'reverse|c|b'], '`=` pairs the neighbours inside one cell');
    shorthand.setNoteShorthand(false);
    assert.equal(shorthand.relationMarks(), ':;<');
    assert.deepEqual(shape('a=b'), ['recall|정리노트|a=b'], 'a=b is one plain text');
    assert.deepEqual(shape('서울-부산-대구'), ['recall|정리노트|서울-부산-대구']);
    assert.deepEqual(shape('x: y = z'), ['direct|x|y = z', 'reverse|y = z|x'], ':, ; and < still split');
    assert.deepEqual(shape('a=b=c'), ['recall|정리노트|a=b=c']);
    assert.deepEqual(shape('2-1: 답'), ['direct|2-1|답', 'reverse|답|2-1']);
    assert.equal(isReviewSequenceSeparator('서울-부산', 2), false);
    assert.deepEqual(parseReviewMemoSyntax('a-b, c').logicalOperators.map(item => item.operator), ['and'], 'only the comma is a logic operator');
    // 색: `=`는 자리 색을 받지 않는다
    assert.deepEqual(memoColors.splitReviewMemoColonColors('a=b'), [{ text: 'a=b' }]);
    // 토글 제목 끝의 `=`도 글자다
    assert.deepEqual([...buildNoteSetIndex([':::toggle A= :\nx\n:::end']).display.values()].includes('A='), true);
    shorthand.setNoteShorthand(true);
    assert.deepEqual(shape('a=b'), ['direct|a|b', 'reverse|b|a'], 'turning it back on restores the old reading');
    assert.deepEqual(memoColors.splitReviewMemoColonColors('a=b'), [{ text: 'a=b' }], '`=` is inside a cell, so it never takes a column colour');
  } finally {
    shorthand.setNoteShorthand(true);
  }
  // 막대: 끄면 `=`·`-` 버튼이 빠진다
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { NoteSymbolBar } = loadSource('components/NoteSymbolBar.tsx');
  const bar = () => renderToStaticMarkup(React.createElement(NoteSymbolBar, { onInsert: () => {} }));
  assert.match(bar(), /aria-label="등호/);
  try {
    shorthand.setNoteShorthand(false);
    assert.ok(!bar().includes('aria-label="등호') && !bar().includes('aria-label="하이픈'));
    assert.match(bar(), /aria-label="콜론/);
  } finally {
    shorthand.setNoteShorthand(true);
  }
});

test('a standalone [X] is the set itself: it holds every nested subset, so an ability on [도형] also covers a cell two levels down', () => {
  const { buildNoteSetIndex, evaluateSetExpression, abilitiesFor } = loadSource('utils/noteSets.ts');
  const memo = [':::toggle 도형 :', ':::toggle 삼각형 :', '직각삼각형', '예각삼각형', ':::end', '정사각형', '원', ':::end', '[도형]:[개념:정의]'].join('\n');
  const index = buildNoteSetIndex([memo]);
  assert.deepEqual(evaluateSetExpression(index, '도형'), ['삼각형', '직각삼각형', '예각삼각형', '정사각형', '원'], 'subsets and the cells of subsets of subsets, in written order');
  assert.deepEqual(evaluateSetExpression(index, '삼각형'), ['직각삼각형', '예각삼각형']);
  assert.deepEqual(evaluateSetExpression(index, '원'), [], 'a cell with nothing under it holds nothing');
  assert.deepEqual(abilitiesFor(index, '직각삼각형', ['도형', '삼각형']).map(ability => ability.criterion), ['개념:정의']);
  assert.deepEqual(abilitiesFor(index, '삼각형', ['도형']).map(ability => ability.criterion), ['개념:정의']);
  // 연산자가 있는 식은 그대로(안의 모든 셀)
  assert.deepEqual(evaluateSetExpression(index, '도형.%삼각형'), ['정사각형', '원']);
});

test('( ) is an application scope: its inner relation makes its own questions, apart from the outside and from the leading [set]', () => {
  const shape = memo => questionsFor(memo).map(q => `${q.kind}|${q.prompt}|${q.answer}|${q.conditions.join('>')}`);
  // 바깥 칸의 값은 `( )`가 놓인 자리의 A와 안녕(`A 안녕`)이고 B는 단절된 값이다. 안쪽 A:B는 따로
  assert.deepEqual(shape('(A:B) 안녕 : C'), ['direct|A 안녕|C|', 'reverse|C|A 안녕|', 'direct|A|B|', 'reverse|B|A|']);
  assert.deepEqual(shape('X : (A:B) 안녕'), ['direct|X|A 안녕|', 'reverse|A 안녕|X|', 'direct|A|B|', 'reverse|B|A|']);
  // 논리는 분리되어도 위치는 분리되지 않는다: 줄 앞 `[D]` 안에 놓인 괄호라 안쪽도 D 안의 문제다
  assert.deepEqual(shape('[D] (A:B) 안녕 : C'), ['direct|A 안녕|C|D', 'reverse|C|A 안녕|D', 'direct|A|B|D', 'reverse|B|A|D']);
  // 칸마다 집합이 있으면 안쪽 첫 값은 괄호가 놓인 칸의 집합, `:` 뒤 값은 다음 칸의 집합이다
  const convert = questionsFor('[D] (A:B) 안녕 : [E] C');
  assert.deepEqual(convert.filter(q => q.kind === 'convert').map(q => q.convert.steps.map(step => step.set + '/' + step.cell).join('>')),
    ['D/A 안녕>E/C', 'E/C>D/A 안녕', 'D/A>E/B', 'E/B>D/A']);
  // 관계가 없는 괄호 글은 문제를 더하지 않는다
  assert.deepEqual(shape('밑변 (cm) : 길이'), ['direct|밑변 (cm)|길이|', 'reverse|길이|밑변 (cm)|']);
  // 칸 전체가 `( )`인 것은 지금처럼 풀어 읽고 문제를 겹쳐 내지 않는다
  assert.equal(shape('X : (A:B)').length, 6);
  // 안쪽 문제는 다른 줄의 같은 문제와 한 번만 나온다
  const keys = questionsFor('(A:B) 안녕 : C\nA:B').map(q => q.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 4);
  // 괄호가 겹치면 안쪽부터 각자 범위다
  assert.ok(questionsFor('(A:(B:C)) 안녕 : Z').some(q => q.kind === 'direct' && q.prompt === 'B' && q.answer === 'C'));
});

test('( ) takes the position it stands in: inner values are in the set of that column, and an inner colon continues the outer column numbers', () => {
  const shape = memo => questionsFor(memo).map(q => `${q.kind}|${q.prompt}|${q.answer}|${q.conditions.join('>')}`);
  const stepsOf = q => q.convert.steps.map(step => step.set).join('>');
  // 놓인 자리가 없으면 아무 조건도 더하지 않는다(전과 같음)
  assert.deepEqual(shape('(A:B) 안녕 : C'), ['direct|A 안녕|C|', 'reverse|C|A 안녕|', 'direct|A|B|', 'reverse|B|A|']);
  // 칸마다 집합이 따로 있는 줄: 괄호가 놓인 칸 → 안쪽 첫 값, 다음 칸 → `:` 뒤 값
  assert.ok(questionsFor('[D] (A:B) 안녕 : [E] C').some(q => q.convert && q.prompt === 'A' && q.answer === 'B' && stepsOf(q) === 'D>E'));
  // 바깥에 다음 칸이 없으면 첫 값만 자리의 집합을 가진다(조건으로 준다)
  const lone = questionsFor('[D] 안녕 : [E] (A:B) 값').filter(q => !q.convert);
  assert.deepEqual(lone.map(q => [q.prompt, q.answer, q.conditions]), [['A', 'B', ['E']], ['B', 'A', ['E']]]);
  // 위쪽 토글 제목이 이어 주는 칸 집합: 괄호가 n번째 칸이면 안쪽 `:` 뒤 값은 n+1번째 칸의 집합이다
  const two = questionsFor(':::toggle [도형] 이름 : [개념] 정의\n삼각형 : (세 변:세 각) 합\n:::end');
  assert.deepEqual(two.filter(q => q.kind === 'direct' && q.prompt === '세 변').map(q => q.conditions), [['[도형] 이름 : [개념] 정의', '개념.정의']]);
  const three = questionsFor(':::toggle [도형] 이름 : [개념] 정의 : [예] 보기\n삼각형 : (세 변:세 각) 합\n:::end');
  assert.ok(three.some(q => q.convert && q.prompt === '세 변' && q.answer === '세 각' && stepsOf(q) === '개념.정의>예.보기'));
  const first = questionsFor(':::toggle [도형] 이름 : [개념] 정의\n(세 변:세 각) 합 : 삼각형\n:::end');
  assert.ok(first.some(q => q.convert && q.prompt === '세 변' && q.answer === '세 각' && stepsOf(q) === '도형.이름>개념.정의'));
  // 칸 전체가 `( )`인 안쪽 관계도 같은 칸 번호를 따른다(여기서는 `삼각형`이 0번째, 괄호가 1번째 칸)
  const whole = questionsFor(':::toggle [도형] 이름 : [개념] 정의 : [예] 보기\n삼각형 : (세 변:세 각)\n:::end');
  assert.ok(whole.some(q => q.convert && q.prompt === '세 변' && q.answer === '세 각' && stepsOf(q) === '개념.정의>예.보기'));
  // 괄호가 겹쳐도 안쪽 문제는 그대로 나온다
  assert.ok(questionsFor('[D] (A:(B:C)) 안녕 : Z').some(q => q.prompt === 'B' && q.answer === 'C'));
});

test('a logic cell makes questions that blank every detail cell at least once, with two blanks too, asked as prose that gets harder with freedom', () => {
  const cellBlanks = memo => questionsFor(memo).filter(q => q.kind === 'blank' && q.statement);
  const blanked = memo => new Set(cellBlanks(memo).flatMap(q => q.answer.split('   ').map(part => part.replace(/^㉠ |^㉡ /, ''))));
  // A; p-d-s: p와 d는 줄글 빈칸으로, 끝 항목 s는 "남은 조건"(앞 항목을 충족하면 남은 것)이 이미 묻는다 → 세 칸 모두 한 번씩, 빈칸 둘인 문제도 있다
  const sequence = questionsFor('A; p-d-s');
  assert.deepEqual([...blanked('A; p-d-s')].sort(), ['d', 'p', 's']);
  const answers = new Set(sequence.filter(q => q.kind === 'remaining').map(q => q.answer));
  assert.ok(answers.has('s') && answers.has('d → s'), 'the trailing ones are asked by the remaining-conditions questions');
  assert.deepEqual(cellBlanks('A; p-d-s').map(q => q.answer), ['p', 'd', '㉠ p   ㉡ d', '㉠ p   ㉡ s']);
  // 줄글 문장(문제집처럼): 값은 따옴표로 묶고 빈칸은 ㉠ ㉡ 번호
  assert.deepEqual(cellBlanks('A; p-d-s').map(q => q.statement), [
    '‘A’에서는 ‘( ㉠ ) → d → s’ 순서로 이어진다. ㉠에 알맞은 것은?',
    '‘A’에서는 ‘p → ( ㉠ ) → s’ 순서로 이어진다. ㉠에 알맞은 것은?',
    '‘A’에서는 ‘( ㉠ ) → ( ㉡ ) → s’ 순서로 이어진다. ㉠, ㉡에 알맞은 것을 차례로 쓰시오.',
    '‘A’에서는 ‘( ㉠ ) → d → ( ㉡ )’ 순서로 이어진다. ㉠, ㉡에 알맞은 것을 차례로 쓰시오.'
  ]);
  // 자유도가 커질수록 어렵다: 빈칸 하나 < 빈칸 둘 < 건너뛴 빈칸 둘
  const [one, , two, skip] = cellBlanks('A; p-d-s');
  assert.ok(one.difficulty < two.difficulty && two.difficulty < skip.difficulty);
  assert.ok(one.level <= two.level && two.level <= skip.level && one.level < skip.level);
  // `;`는 앞으로만, `<`는 거꾸로만, `:`는 양쪽
  assert.ok(cellBlanks('A; p-d-s').every(q => q.direction === 'forward'));
  assert.ok(cellBlanks('p-d-s < A').every(q => q.direction === 'reverse') && cellBlanks('p-d-s < A').length > 0);
  assert.ok(cellBlanks('p-d-s : A').some(q => q.direction === 'reverse') && cellBlanks('A : p-d-s').some(q => q.direction === 'forward'));
  // 가장 바깥의 그리고는 "남은 조건"이 모든 부분집합을 이미 묻는다 → 줄글 빈칸을 겹쳐 내지 않는다
  assert.equal(cellBlanks('A : p,q,r').length, 0);
  assert.equal(questionsFor('A : p,q,r').filter(q => q.kind === 'remaining').length, 6);
  // 덩어리 안의 덩어리도 세부 칸마다 한 번씩
  assert.ok(cellBlanks('X : p-(q,r)-s').some(q => q.statement === '‘X’에서는 ‘p → (r, ( ㉠ )) → s’ 순서로 이어진다. ㉠에 알맞은 것은?' && q.answer === 'q'));
  assert.ok(cellBlanks('X : p-(q,r)-s').some(q => q.answer === 'r'));
  // 능력 집합이 있는 줄은 원래의 능력 변환 변주가 그대로 낸다(줄글 빈칸을 더하지 않는다)
  assert.equal(cellBlanks('[과정] 풀이 ; [단계] 읽기-정리-확인').length, 0);
  // 모든 문제 종류가 줄글이다(노트 회상 · 능력 변환 카드만 따로)
  assert.ok(questionsFor('A:B:C').every(q => typeof q.statement === 'string' && q.statement.length > 0));
  // 카드: 줄글 문제는 문장으로 보이고, 정답은 확인할 때만 보인다
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const card = cellBlanks('A; p-d-s')[2];
  const closed = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo: 'A; p-d-s', question: card, criterion: null, revealed: false }));
  assert.ok(closed.includes('data-question-statement="true"') && plainText(closed).includes('‘A’에서는 ‘( ㉠ ) → ( ㉡ ) → s’ 순서로 이어진다.'));
  assert.ok(!closed.includes('㉠ p'));
  const opened = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo: 'A; p-d-s', question: card, criterion: null, revealed: true }));
  assert.ok(opened.includes('㉠ p') && opened.includes('㉡ d'));
});

test('review style: prose by default, stored on this device, one choice for every review question', () => {
  assert.equal(reviewStyle.REVIEW_STYLE_KEY, 'swp_review_style');
  assert.equal(reviewStyle.getReviewStyle(), 'prose', '줄글이 기본이다');
  const store = new Map();
  global.localStorage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) };
  try {
    let heard = 0;
    const stop = reviewStyle.subscribeReviewStyle(() => { heard += 1; });
    reviewStyle.setReviewStyle('flash');
    assert.equal(reviewStyle.getReviewStyle(), 'flash');
    assert.equal(store.get('swp_review_style'), 'flash');
    reviewStyle.setReviewStyle('flash');
    assert.equal(heard, 1, 'the same choice again changes nothing');
    stop();
    reviewStyle.setReviewStyle('prose');
    assert.equal(heard, 1, 'after unsubscribing nobody is told');
    assert.equal(store.get('swp_review_style'), 'prose');
  } finally { delete global.localStorage; }
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewStyleSelector } = loadSource('components/ReviewStyleSelector.tsx');
  const markup = style => inStyle(style, () => renderToStaticMarkup(React.createElement(ReviewStyleSelector)));
  const prose = markup('prose');
  assert.match(prose, /data-testid="review-style"/);
  assert.match(prose, /data-style="prose"[^>]*aria-pressed="true"[^>]*>줄글</);
  assert.match(prose, /data-style="flash"[^>]*aria-pressed="false"[^>]*>플래시 카드</);
  assert.match(markup('flash'), /data-style="flash"[^>]*aria-pressed="true"/);
});

test('the style choice sits in both practice screens and the progress panel moves to the left', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewPracticeScreen } = loadSource('components/ReviewPracticeScreen.tsx');
  const base = {
    title: '기본 복습', isRetry: false, subjectName: '수학', rangeLabel: '1~10', elapsed: '00:10', targetRemaining: '05:00',
    isRunning: true, canPause: true, pauseLabel: '잠시 중단', onTogglePause() {}, onClose() {}, onCondenseFirst() {},
    level: 1, round: 1, roundSize: 2, queueLength: 2, hasQuestions: true, isComplete: false, maxLevel: 3, onChangeLevel() {},
    question: React.createElement('p', null, '문제전용문장'), questionRange: '1~10', hasCurrentQuestion: true,
    revealed: false, onReveal() {}, onGrade() {}, wrongIntervalLabel: '2시간', correctIntervalLabel: '1일',
    rail: [{ id: 'a', label: '1번 · 기본 관계', status: 'now', wrongCount: 0 }, { id: 'b', label: '2번 · 역방향', status: 'waiting', wrongCount: 0 }],
    firstTryCorrect: 0, firstTryTotal: 0, completion: null, firstTryOk: 0, firstTryBad: 0, finishLabel: '남은 문제 2', canFinish: false, onFinish() {}
  };
  const html = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, base));
  assert.ok(html.includes('data-testid="review-style"') && html.includes('data-testid="practice-level"'));
  const aside = html.match(/<aside[^>]*>/)[0];
  assert.ok(aside.includes('lg:order-first') && aside.includes('order-last'), '넓은 화면에서는 문제 카드의 왼쪽, 좁은 화면에서는 카드 아래');
  assert.ok(html.includes('이번 문제 묶음') && html.includes('첫 시도 정답률') && html.indexOf('<aside') > html.indexOf('문제전용문장'), '패널은 그대로 안에 있고 보이는 자리만 옮긴다');
  assert.ok(!renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...base, hasQuestions: false })).includes('data-testid="review-style"'));
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'NotePractice.tsx'), 'utf8');
  assert.ok(source.includes('<ReviewStyleSelector />'), 'the same choice is made in the note practice screen');
});

test('prose sentences carry the attribute of every value (given, conditions, asked) with plain particles', () => {
  const { getReviewQuestionSentence } = questionBuilder;
  const criterion = '개념:정의:예시';
  const nested = questionsFor(':::toggle 자동차 :\n엔진:동력\n:::end');
  const direct = nested.find(q => q.kind === 'direct' && q.prompt === '엔진');
  assert.equal(getReviewQuestionSentence(criterion, direct).statement, '개념 ‘자동차’에서 정의 ‘엔진’에 이어지는 예시 값은?');
  const reverse = nested.find(q => q.kind === 'reverse' && q.prompt === '동력');
  assert.equal(getReviewQuestionSentence(criterion, reverse).statement, '개념 ‘자동차’에서 예시 ‘동력’에 앞서 이어진 정의 값은?');
  // 기준이 없으면 속성 이름 없이 같은 문장(조사만 그대로)
  assert.equal(getReviewQuestionSentence(null, direct).statement, '‘자동차’에서 ‘엔진’에 이어지는 것은?');
  // 모든 종류의 문제가 속성이 든 문장을 받는다
  for (const question of questionsFor('자동차 : 바퀴-축 : 타이어').filter(q => q.kind !== 'recall')) {
    const sentence = getReviewQuestionSentence(criterion, question);
    assert.ok(sentence && sentence.statement.length > 0, question.kind);
    assert.ok(/개념|정의|예시/.test(sentence.statement), `${question.kind}: ${sentence.statement}`);
  }
  // 덩어리 칸 빈칸도 문제가 놓인 자리와 속성이 문장 안에 있다
  const cell = questionsFor(':::toggle 자동차 :\n엔진:점화-가속-출력\n:::end').find(q => q.kind === 'blank' && q.cell);
  assert.ok(cell, 'the cell blank keeps its parts so it can be rewritten');
  const text = getReviewQuestionSentence(criterion, cell).statement;
  assert.ok(text.startsWith('개념 ‘자동차’에서 정의 ‘엔진’에서는 예시 ‘') && /예시 값/.test(text), text);
  assert.ok(cell.statement.startsWith('‘자동차’에서 ‘엔진’에서는 ‘'), 'without the criterion the condition is still in the sentence');
  // 능력 변환 카드
  const convert = questionsFor('[a] b ; [c] d').find(q => q.kind === 'convert');
  assert.ok(getReviewQuestionSentence('대상:설명:예시', convert).statement.includes('값은?'));
});

test('flash look: conditions, the given attribute and the asked attribute are big and separate', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = ':::toggle 자동차 :\n엔진:동력\n:::end';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '엔진');
  const render = (style, revealed = false) => inStyle(style, () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question, criterion: '개념:정의:예시', revealed })));
  const flash = render('flash');
  assert.match(flash, /data-review-style="flash"/);
  assert.match(flash, /data-flash-condition="true"[\s\S]*?개념[\s\S]*?자동차/, 'the condition chip shows its attribute above the value');
  assert.match(flash, /data-flash-ask="true"[^>]*text-xl[^>]*>맞힐 것 · 예시</, 'the asked attribute is a big badge');
  assert.match(flash, /text-lg font-black text-slate-800">정의</, 'the given attribute is labelled');
  assert.ok(!flash.includes('data-classification-criterion') && !flash.includes('개념:정의:예시') && !flash.includes('data-question-statement'));
  assert.ok(!flash.includes('동력') && render('flash', true).includes('동력'));
  const prose = render('prose');
  assert.match(prose, /data-review-style="prose"/);
  assert.ok(!prose.includes('data-flash-condition') && !prose.includes('data-flash-ask') && !prose.includes('data-field-label'));
  assert.equal(plainText(prose).includes('개념 ‘자동차’에서 정의 ‘엔진’에 이어지는 예시 값은?'), true);
});

test('ability-convert cards follow the chosen look too', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = '[a] b ; [c] d';
  const question = questionsFor(memo).find(q => q.kind === 'convert');
  const render = style => inStyle(style, () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question, criterion: '대상:설명:예시', revealed: false })));
  const prose = render('prose');
  assert.ok(prose.includes('data-question-statement="true"') && !prose.includes('data-convert-given'));
  const flash = render('flash');
  assert.match(flash, /data-convert-given="true"/);
  assert.ok(flash.includes('data-convert-slot="answer"') && !flash.includes('data-question-statement'), 'the old chain look: given boxes and the slot to fill');
  assert.match(flash, /data-field-label="true"[^>]*>맞힐 것 · /);
});

test('inside the note, the logic words = , - share the one logic colour and the text is unchanged', () => {
  const colors = loadSource('utils/reviewMemoColors.ts');
  const shorthand = loadSource('utils/noteShorthand.ts');
  const parts = (text, fields) => colors.markReviewMemoOperators(text, colors.markReviewMemoLogicWords(text, colors.splitReviewMemoColonColors(text, fields)));
  const operators = text => parts(text).filter(part => part.operator).map(part => [part.text, part.operator]);
  const joined = text => parts(text).map(part => part.text).join('');
  assert.deepEqual(operators('A:p-q, r=s'), [['-', 'sequence'], [',', 'and'], ['=', 'equal']]);
  assert.deepEqual(operators('읽기-정리-확인'), [['-', 'sequence'], ['-', 'sequence']]);
  for (const text of ['A:p-q, r=s', '읽기-정리-확인', 'a:{원인} b\n[x,y]:[기준]', 'n:3.5 // a=b', '', 'plain 글']) assert.equal(joined(text), text, text);
  // 관계 기호의 칸 색(:)은 그대로 있고, = 는 칸을 나누지 않는다
  const colon = parts('A:B=C');
  assert.deepEqual(colon.map(part => [part.text, part.colonIndex, part.operator]), [['A', undefined, undefined], [':', 0, undefined], ['B', undefined, undefined], ['=', undefined, 'equal'], ['C', undefined, undefined]]);
  // 논리어로 읽히지 않는 것은 칠하지 않는다: 양쪽에 글이 없는 -, 지수 꼴, :{이름} 안쪽, [ ] 덩어리 안쪽
  assert.deepEqual(operators('- 목록 줄'), []);
  assert.deepEqual(operators('A:-5'), []);
  assert.deepEqual(operators('A:1e-5'), []);
  assert.deepEqual(operators('A:{원인,결과} 값'), [], 'a name written in braces is a label, not logic');
  assert.deepEqual(operators('[a,b]:[개념-정의]'), [], 'a [ ] block already has the logic colour as one piece');
  // 줄마다 따로 읽는다
  assert.deepEqual(operators('가-나\n다=라'), [['-', 'sequence'], ['=', 'equal']]);
  // 단축어를 끄면 = 와 - 는 그냥 글자이고 쉼표만 논리어다
  shorthand.setNoteShorthand(false);
  try { assert.deepEqual(operators('A:p-q, r=s'), [[',', 'and']]); } finally { shorthand.setNoteShorthand(true); }
  // 색: 논리어는 종류와 상관없이 하나이고(밝은/어두운 바탕은 따로), `:` 칸 색과는 겹치지 않는다
  const light = ['and', 'sequence', 'equal'].map(kind => colors.getReviewMemoOperatorColor(kind, false));
  const dark = ['and', 'sequence', 'equal'].map(kind => colors.getReviewMemoOperatorColor(kind, true));
  assert.deepEqual([...new Set(light)], [colors.getReviewMemoLogicColor(false)]);
  assert.deepEqual([...new Set(dark)], [colors.getReviewMemoLogicColor(true)]);
  assert.ok(light.every(color => !['#dc2626', '#a16207', '#475569', '#71717a', '#64748b'].includes(color)), '`:` 칸 색과 겹치지 않는다');
  // 편집기: 글자 폭은 그대로(색만) 거울 글에 논리어 조각이 있다
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MemoColorTextarea } = loadSource('components/MemoColorTextarea.tsx');
  const markup = (dark) => renderToStaticMarkup(React.createElement(MemoColorTextarea, { value: 'A:p-q, r=s', colorColons: true, dark, onChange() {} }));
  const mirror = markup(false);
  assert.match(mirror, /data-logic-operator="sequence"[^>]*#0f766e[^>]*>-</);
  assert.match(mirror, /data-logic-operator="and"[^>]*#0f766e[^>]*>,</);
  assert.match(mirror, /data-logic-operator="equal"[^>]*#0f766e[^>]*>=</);
  assert.match(markup(true), /data-logic-operator="equal"[^>]*#5eead4/);
  assert.ok(!/font-(bold|black|semibold)|font-weight/.test(mirror.slice(mirror.indexOf('aria-hidden'))), 'the overlay keeps the textarea glyph widths');
  assert.ok(!renderToStaticMarkup(React.createElement(MemoColorTextarea, { value: 'A:p-q', colorColons: false, onChange() {} })).includes('data-logic-operator'), 'no colours when colouring is off');
  // 문제 카드에는 색을 넣지 않는다(노트 안에서만)
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = 'A:p=q=r';
  const question = questionsFor(memo).find(q => q.kind === 'blank' && q.statement && q.statement.includes(' = '));
  for (const style of ['prose', 'flash']) {
    assert.ok(!inStyle(style, () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question, criterion: null, revealed: true }))).includes('data-logic'), `${style}: question cards stay plain`);
  }
});

test("quotes '…': inside one, : ; < are logic words (= - and reversed -), never column separators", () => {
  const shorthand = loadSource('utils/noteShorthand.ts');
  const { reviewQuotes } = loadSource('utils/reviewQuote.ts');
  const signature = memo => questionsFor(memo).map(q => JSON.stringify([q.kind, q.prompt, q.answer, q.conditions, q.key])).sort();
  const same = (quoted, plain) => assert.deepEqual(signature(quoted), signature(plain), `${quoted}  ==  ${plain}`);
  // : → =, ; → -, < → reversed -  (precedence is the same as the plain forms: = binds tightest, then -, then ,)
  same("A : '가 ; 나 : 다'", 'A : 가 - 나 = 다');
  same("A : '다 < 나 : 가'", 'A : 나 = 가 - 다');
  same("A : '가 < 나 < 다'", 'A : 다 - 나 - 가');
  same("A : 'a ; b ; c' : z", 'A : a - b - c : z');
  same("A ; x : 'p ; q' ; z", 'A ; x : p - q ; z');
  same("[a] 'p ; q' ; [c] d", '[a] p - q ; [c] d');
  same("A : 'p ; (q : r) ; s'", 'A : p - (q : r) - s');
  // the quote marks themselves are not text
  assert.ok(questionsFor("A : '가 ; 나'").every(q => !q.prompt.includes("'") && !q.answer.includes("'")));
  // ...and outside a quote nothing changes: the same marks still split columns
  assert.ok(signature('A : 가 ; 나').length > 0 && JSON.stringify(signature("A : 가 ; 나")) !== JSON.stringify(signature('A : 가 - 나')));
  // apostrophes in words and unmatched quotes are plain letters
  assert.equal(reviewQuotes("it's a don't").marks.size, 0);
  assert.equal(reviewQuotes("A : 'x ; y").marks.size, 0, 'no closing quote');
  assert.equal(reviewQuotes("A : x ; y'").marks.size, 0, 'no opening quote');
  assert.deepEqual([...reviewQuotes("A : 'x ; y'").marks.values()], ['sequence']);
  assert.deepEqual([...reviewQuotes("'a:b' 'c<d'").marks.values()], ['equal', 'reverse'], 'two quotes on one line');
  assert.equal(reviewQuotes("'a ;\nb'").marks.size, 0, 'a quote never crosses a line');
  // inside ( ) the ordinary rule comes back: the : there splits columns
  assert.deepEqual([...reviewQuotes("'p ; (q : r) ; s'").marks.values()], ['sequence', 'sequence']);
  // the = - shorthand off: marks inside a quote still do not split columns, and they are plain letters
  shorthand.setNoteShorthand(false);
  try {
    assert.ok(questionsFor("A : 'x ; y'").some(q => q.prompt === 'A' && q.answer === 'x ; y'), 'the whole quoted text is one plain cell');
    assert.ok(!questionsFor("A : 'x : y'").some(q => q.prompt === 'x' || q.answer === 'y'), 'x and y are not separate cells');
  } finally { shorthand.setNoteShorthand(true); }
});

test("quotes '…' are read the same way by the diagram, the editor colours, the syntax reader and the merge", () => {
  const { parseNoteDiagram, parseLogicText } = loadSource('utils/noteDiagram.ts');
  const text = value => ({ kind: 'text', text: value });
  // diagram: one relation with two cells, the quoted cell is shown as chips (a reversed < shows in the order it reads)
  const diagram = parseNoteDiagram("A : '가 ; 나 : 다'");
  assert.equal(diagram.length, 1);
  assert.equal(diagram[0].fields.length, 2);
  assert.deepEqual(parseLogicText(diagram[0].fields[1]), { kind: 'op', operator: 'sequence', items: [text('가'), { kind: 'op', operator: 'equal', items: [text('나'), text('다')] }] });
  assert.deepEqual(parseLogicText("'다 < 나 : 가'"), { kind: 'op', operator: 'sequence', items: [{ kind: 'op', operator: 'equal', items: [text('나'), text('가')] }, text('다')] });
  assert.deepEqual(parseLogicText("'그냥 글'"), text('그냥 글'), 'the quote marks are not shown');
  // editor colours: the marks inside a quote get the logic-word colours instead of the column (colon) colours; the text is unchanged
  const colors = loadSource('utils/reviewMemoColors.ts');
  const memo = "A : '가 ; 나 : 다 < 라' : 마";
  const parts = colors.markReviewMemoOperators(memo, colors.markReviewMemoLogicWords(memo, colors.splitReviewMemoColonColors(memo)));
  assert.equal(parts.map(part => part.text).join(''), memo);
  assert.deepEqual(parts.filter(part => part.colonIndex !== undefined).map(part => part.colonIndex), [0, 1], 'only the two outside : count as columns');
  assert.deepEqual(parts.filter(part => part.operator).map(part => [part.text, part.operator]), [[';', 'sequence'], [':', 'equal'], ['<', 'sequence']]);
  // syntax reader: a quoted ; is an order word, no column separator and no toggle-tail relation
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const syntax = parseReviewMemoSyntax("A : '가 ; 나'");
  assert.deepEqual(syntax.logicalOperators.map(item => item.operator), ['sequence']);
  assert.equal(syntax.childrenRelation, undefined);
  assert.equal(parseReviewMemoSyntax("A '가 ;'").childrenRelation, undefined);
  // merge: the quoted cell stays one cell; a word in it can take a new link
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const merged = (incoming, earlier) => mergeNoteIntoEarlier(incoming, [{ id: 'e', memo: earlier }]).map(update => update.after);
  assert.deepEqual(merged('A : 다', "A : '가 ; 나'"), ["A:'가 ; 나'=다"]);
  assert.deepEqual(merged('나 : 마', "A : '가 ; 나 ; 다'"), ["A:'가 ; (나:마) ; 다'"]);
  assert.deepEqual(merged('가 : 마', "A : '가 ; 나'"), ["A:'(가:마) ; 나'"], 'the quote mark at the cell edge is not part of the word');
});

test('editor : colours count from the column an open toggle title leaves off, the same number the questions use', () => {
  const { getToggleChildOffset } = loadSource('utils/reviewQuestions.ts');
  assert.equal(getToggleChildOffset('자동차 :'), 1);
  assert.equal(getToggleChildOffset('자동차 : '), 1);
  assert.equal(getToggleChildOffset('A:B :'), 2);
  assert.equal(getToggleChildOffset('A:C'), 0, 'a closed title starts its children at its own column');
  assert.equal(getToggleChildOffset('자동차'), 0);
  assert.equal(getToggleChildOffset('X :', 1), 2, 'an open title inside an open toggle moves further');
  // the questions agree: 엔진 is the second column under `자동차 :`
  const questions = questionBuilder.buildReviewQuestions(':::toggle 자동차 :\n엔진:동력\n:::end').questions;
  assert.ok(questions.some(q => q.kind === 'direct' && q.prompt === '엔진' && q.answer === '동력' && JSON.stringify(q.columns.prompt) === '[1]'), 'prompt 엔진 is column 1 (0-based) → the second attribute');
  // colours: a line that starts at column 1 gives its first : the colour of the second column
  assert.deepEqual(memoColors.splitReviewMemoColonColors('엔진:동력', new Map(), 1).filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [1]);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('엔진:동력\n차:바퀴', new Map(), 1).filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [1, 1], 'every line restarts at the base');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewMemoEditor } = loadSource('components/ReviewMemoEditor.tsx');
  const render = value => renderToStaticMarkup(React.createElement(ReviewMemoEditor, { value, onChange() {}, colorColons: true }));
  const open = render(':::toggle 자동차 :\n엔진:동력\n:::end');
  assert.ok(open.includes('data-colon-index="2"'), 'the : under an open title has the second column colour');
  const closed = render(':::toggle 자동차\n엔진:동력\n:::end');
  assert.ok(closed.includes('data-colon-index="1"') && !closed.includes('data-colon-index="2"'), 'a title without a trailing : leaves the children at column 0');
});

test('( ) is detached from the upper criterion: an inner : gets no inherited cell name, only an explicit :{이름} inside', () => {
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:정의:예시:비고', q);
  const pair = (memo, prompt, answer) => questionBuilder.buildReviewQuestions(memo).questions.find(q => q.kind === 'direct' && q.prompt === prompt && q.answer === answer);
  // ( ) in the middle of a cell: the inner : is not named 정의 → 예시 any more
  const middle = pair('삼각형 : (세 변:세 각) 합', '세 변', '세 각');
  assert.ok(middle);
  assert.deepEqual([classify(middle).prompt, classify(middle).answer], [[], []]);
  // the cell is only ( ): detached as well
  const whole = pair('A : x : (p:q:r)', 'p', 'q');
  assert.ok(whole);
  assert.deepEqual([classify(whole).prompt, classify(whole).answer], [[], []]);
  // a leading ( ) on a plain line: detached too (the outer cell `p 합` keeps its own column)
  const plain = pair('(p:q) 합', 'p', 'q');
  assert.ok(plain);
  assert.deepEqual([classify(plain).prompt, classify(plain).answer], [[], []]);
  const outer = pair('(p:q) 합 : Z', 'p 합', 'Z');
  assert.deepEqual([classify(outer).prompt, classify(outer).answer], [['개념'], ['정의']]);
  // an explicit name written inside the parentheses still applies
  const named = pair('삼각형 : (세 변:{상세}세 각) 합', '세 변', '세 각');
  assert.ok(named);
  assert.deepEqual(classify(named).answer, ['상세']);
  // the outer condition keeps its name: 개념 ‘임진왜란’에서 ‘원인’에 이어지는 것은?
  const { getReviewQuestionSentence } = questionBuilder;
  const inner = questionBuilder.buildReviewQuestions(':::toggle [개념:정의;예시]\n임진왜란 : (원인 : 일본의 야욕) ; 1592년\n:::end').questions.find(q => q.kind === 'direct' && q.prompt === '원인' && q.answer === '일본의 야욕');
  assert.equal(getReviewQuestionSentence(inner.criterion, inner).statement, '개념 ‘임진왜란’에서 ‘원인’에 이어지는 것은?');
});

test('[집합(1)] : [집합(2)] connects the sub-values of the two sets: relation lines between them become ability-convert questions', () => {
  const convertSteps = memo => questionBuilder.buildReviewQuestions(memo).questions.filter(q => q.convert).map(q => q.convert.steps.map(step => `${step.set}/${step.cell}`).join(' > '));
  // values stored as `[집합] 텍스트`
  assert.deepEqual(convertSteps('[도형] 삼각형\n[도형] 원\n[색] 빨강\n[색] 파랑\n[도형]:[색]\n삼각형 : 빨강\n원 : 파랑'),
    ['도형/삼각형 > 색/빨강', '색/빨강 > 도형/삼각형', '도형/원 > 색/파랑', '색/파랑 > 도형/원']);
  // values stored under toggles; the order of the two cells in the line does not matter
  assert.deepEqual(convertSteps(':::toggle 도형\n삼각형\n원\n:::end\n:::toggle 색\n빨강\n파랑\n:::end\n[도형]:[색]\n파랑 : 원'),
    ['색/파랑 > 도형/원', '도형/원 > 색/파랑']);
  // without the link line the same relation stays an ordinary pair
  assert.deepEqual(convertSteps('[도형] 삼각형\n[색] 빨강\n삼각형 : 빨강'), []);
  // the second [ ] is a column list (not a set in the note): still an ability definition, nothing changes
  assert.deepEqual(convertSteps('[도형] 삼각형\n[색] 빨강\n[도형]:[개념]\n삼각형 : 빨강'), []);
  // a cell outside the sets is not pulled in
  assert.deepEqual(convertSteps('[도형] 삼각형\n[색] 빨강\n[도형]:[색]\n사각형 : 빨강'), []);
  // the link line itself is not a question
  assert.ok(!questionBuilder.buildReviewQuestions('[도형] 삼각형\n[색] 빨강\n[도형]:[색]\n삼각형 : 빨강').questions.some(q => q.prompt.includes('[도형]')));
});

test('merging reaches words inside ( ): a line that starts with such a word is tied to that one word', () => {
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const merged = (incoming, earlier) => mergeNoteIntoEarlier(incoming, [{ id: 'e', memo: earlier }]).map(update => update.after);
  assert.deepEqual(merged('B:D', 'A:(B,C)'), ['A:((B:D),C)']);
  assert.deepEqual(merged('B:D', 'A:(B)'), ['A:(B:D)'], 'a group holding only that word is replaced, not wrapped twice');
  assert.deepEqual(merged('B:D', 'A:(B:E)'), ['A:((B:D):E)'], 'words split by : inside the group count too');
  assert.deepEqual(merged('B:D', 'A:((B,C),F)'), ['A:(((B:D),C),F)']);
  assert.deepEqual(merged('B:D', 'A:(B,C),B'), [], 'the same word twice: no way to tell which, so no merge');
  assert.deepEqual(merged('E:F', 'A:(B,C)'), []);
  assert.deepEqual(merged('B:D', 'A:B,C'), ['A:(B:D),C'], 'words without ( ) work as before');
  // merging again changes nothing
  assert.deepEqual(merged('B:D', 'A:((B:D),C)'), []);
});

test('a line whose end is an unfinished relation takes the line below as a toggle child, before anything else is read', () => {
  const { expandOpenLines, openTailOf } = loadSource('utils/noteOpenTail.ts');
  // tails: connectors, logic words, both, and a column name after the connector
  assert.deepEqual(openTailOf('A :'), { connector: ':', start: 2, end: 3 });
  assert.equal(openTailOf('A ;,').logic, ',');
  assert.equal(openTailOf('A ;,').connector, ';');
  assert.equal(openTailOf('A,').connector, undefined);
  assert.equal(openTailOf('A -').logic, '-');
  assert.equal(openTailOf('A :{원인}').connector, ':');
  assert.equal(openTailOf('A :{원인},').logic, ',');
  assert.equal(openTailOf('A : B'), null);
  assert.equal(openTailOf('(A :'), null, 'a mark inside an unclosed group is not a tail');
  assert.equal(openTailOf("'a ;'"), null, 'a quoted mark is not a tail');
  assert.equal(openTailOf(':'), null, 'nothing before the mark');
  // expansion: only the line directly below, at any depth; a chain nests; a toggle below is taken whole
  assert.equal(expandOpenLines('자동차 :\n엔진\n타이어'), ':::toggle 자동차 :\n엔진\n:::end\n타이어');
  assert.equal(expandOpenLines('A :\nB :\nC'), ':::toggle A :\n:::toggle B :\nC\n:::end\n:::end');
  assert.equal(expandOpenLines('A :\n:::toggle B\nc\n:::end'), ':::toggle A :\n:::toggle B\nc\n:::end\n:::end');
  assert.equal(expandOpenLines(':::toggle T\nA :\nB\n:::end'), ':::toggle T\n:::toggle A :\nB\n:::end\n:::end');
  assert.equal(expandOpenLines(':::toggle T\nA :\n:::end'), ':::toggle T\nA :\n:::end', 'the end of a toggle is not a line below');
  assert.equal(expandOpenLines('A :\n\nB'), 'A :\n\nB', 'a blank line is not a line below');
  assert.equal(expandOpenLines('A : B\nC'), 'A : B\nC');
  // questions read it exactly like the written toggle
  const same = (plain, toggle) => assert.deepEqual(
    questionsFor(plain).map(q => [q.kind, q.prompt, q.answer]), questionsFor(toggle).map(q => [q.kind, q.prompt, q.answer]));
  same('자동차 :\n엔진', ':::toggle 자동차 :\n엔진\n:::end');
  same('자동차 ;\n엔진', ':::toggle 자동차 ;\n엔진\n:::end');
  same('읽기 -\n정리', ':::toggle 읽기 -\n정리\n:::end');
  assert.deepEqual(questionsFor('자동차 :\n엔진').filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['자동차', '엔진']]);
  // the line below starts after the columns the line above used (same numbering as a toggle title)
  const deeper = questionsFor('A :\nB:C').find(q => q.kind === 'direct' && q.prompt === 'B');
  assert.deepEqual(JSON.stringify(deeper.columns.prompt), '[1]');
  // the diagram draws it as the same fan
  const { parseNoteDiagram } = loadSource('utils/noteDiagram.ts');
  assert.deepEqual(parseNoteDiagram('A :\nB'), parseNoteDiagram(':::toggle A :\nB\n:::end'));
  // editor colours count the same way
  assert.deepEqual(memoColors.splitReviewMemoColonColors('자동차 :\n엔진:동력').filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0, 1]);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('A :\nB :\nc:d').filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0, 1, 2]);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('A:B\nx:y').filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0, 0], 'a finished line does not shift the next one');
  // logic words at the end: , AND, - order, = equal
  assert.deepEqual(questionsFor('읽기 -\n정리').filter(q => q.kind === 'order-next').map(q => [q.prompt, q.answer]), [['읽기', '정리']]);
  assert.deepEqual(questionsFor('가 =\n나').filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['가', '나']]);
  assert.deepEqual(questionsFor('자동차 :,\n엔진').filter(q => q.kind === 'direct').map(q => q.answer), ['엔진']);
});

test('( ) is a toggle word: its first value shares the cell with the text around it; the other values are cut off from that cell', () => {
  const direct = memo => questionsFor(memo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]);
  // A and 안녕 are in the same cell at the same position (value `A 안녕`); B sits at another position, so there is no `B 안녕`
  assert.deepEqual(direct('(A:B) 안녕 : X'), [['A 안녕', 'X'], ['A', 'B']]);
  assert.deepEqual(direct('X : 안녕 (A:B)'), [['X', '안녕 A'], ['A', 'B']]);
  assert.ok(!questionsFor('(A:B) 안녕 : X').some(q => q.prompt.includes('B 안녕') || q.answer.includes('B 안녕') || q.answer.includes('(')));
  // the other connectors and nested groups pick the first value too
  assert.deepEqual(direct('(A;B) 안녕 : X')[0], ['A 안녕', 'X']);
  assert.deepEqual(direct('((A:B):C) 안녕 : X')[0], ['A 안녕', 'X']);
  // a group with no connector inside is only grouping: the text stays as written
  assert.deepEqual(direct('(A,B) 안녕 : X'), [['(A,B) 안녕', 'X']]);
  assert.deepEqual(direct('밑변 (cm) : 길이'), [['밑변 (cm)', '길이']]);
  // the masked answer range still covers what was written
  const asked = questionsFor('(A:B) 안녕 : X').find(q => q.kind === 'direct' && q.prompt === 'A 안녕');
  assert.deepEqual(asked.promptSpans.map(span => [span.start, span.end]), [[0, 8]]);
});

test('merging works with every connector and treats the values of a ( ) in the same cell as words of that cell', () => {
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const merged = (incoming, earlier) => mergeNoteIntoEarlier(incoming, [{ id: 'e', memo: earlier }]).map(update => update.after);
  // : ; < are all connectors: any of them can be the one in the old line or in the new line
  assert.deepEqual(merged('B;C', 'A:B'), ['A:(B;C)']);
  assert.deepEqual(merged('B<C', 'A:B'), ['A:(B<C)']);
  assert.deepEqual(merged('B:C', 'A;B'), ['A;(B:C)']);
  assert.deepEqual(merged('B:C', 'A<B'), ['A<(B:C)']);
  assert.deepEqual(merged('B;E', 'A:B:D'), ['A:(B;E):D'], 'an insertion keeps its own relation and shows none with its neighbours');
  assert.deepEqual(merged('C;D', 'A:B,C'), ['A:B,(C;D)']);
  assert.deepEqual(merged('C<D', 'A:B-C-E'), ['A:B-(C<D)-E']);
  // a link keeps the new cells next to the cell they follow
  assert.deepEqual(merged('A:B:D:E', 'A:B:D'), ['A:B:D:E']);
  // (A:B) 안녕: A and 안녕 share a cell and a position, so A takes a merge like any word of the cell; B (another position) can too
  assert.deepEqual(merged('A:C', '(A:B) 안녕 : X'), ['((A:C):B) 안녕:X']);
  assert.deepEqual(merged('B:C', '(A:B) 안녕 : X'), ['(A:(B:C)) 안녕:X']);
  assert.deepEqual(merged('A:C', 'X:(A:B) 안녕'), ['X:((A:C):B) 안녕']);
  assert.deepEqual(merged('A:C', '((A:C):B) 안녕:X'), [], 'merging again changes nothing');
});

test('[!] is the set of values that do not fit the logic: a line with a cell that needs [!] makes no questions, a toggle titled ! hides its subtree', () => {
  const pairs = memo => questionsFor(memo).filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]);
  assert.deepEqual(pairs('삼각형 : 빨강\n원 : 파랑'), [['삼각형', '빨강'], ['원', '파랑']]);
  // [!] and an intersection with ! (the value is in both sets) keep the line out of questions; the line next to it is unchanged
  assert.deepEqual(pairs('[!] 삼각형 : 빨강\n원 : 파랑'), [['원', '파랑']]);
  assert.deepEqual(pairs('삼각형 : [!] 빨강\n원 : 파랑'), [['원', '파랑']]);
  assert.deepEqual(pairs('[도형.!] 삼각형 : 빨강\n원 : 파랑'), [['원', '파랑']]);
  // the complement of ! (everything that fits) and a union that does not need ! are not held back
  assert.deepEqual(pairs('[도형.%!] 삼각형 : 빨강'), [['삼각형', '빨강']]);
  assert.deepEqual(pairs('[도형,!] 삼각형 : 빨강'), [['삼각형', '빨강']]);
  // a toggle titled ! holds back everything under it
  assert.deepEqual(pairs(':::toggle !\n삼각형 : 빨강\n:::end\n원 : 파랑'), [['원', '파랑']]);
  // recalling the whole note does not leak the held-back line either
  assert.ok(!questionsFor('[!] 삼각형 : 빨강\n원 : 파랑').some(q => q.kind === 'recall' && /삼각형/.test(q.answer)));
});

test('marking a cell with ! intersects it with the cell\'s set, and stripping ! takes it back out', () => {
  const marks = loadSource('utils/noteLogicMarks.ts');
  assert.equal(marks.markLogicCell('빨강'), '[!] 빨강');
  assert.equal(marks.markLogicCell('[도형] 삼각형'), '[도형.!] 삼각형');
  assert.equal(marks.markLogicCell('[도형,색] 삼각형'), '[(도형,색).!] 삼각형');
  assert.equal(marks.markLogicCell('[도형.!] 삼각형'), '[도형.!] 삼각형', 'already marked');
  assert.equal(marks.stripLogicMarks('[도형.!] 삼각형'), '[도형] 삼각형');
  assert.equal(marks.stripLogicMarks('[!] 삼각형'), '삼각형');
  assert.equal(marks.stripLogicMarks('[도형.%!] 삼각형'), '[도형.%!] 삼각형', 'the complement of ! is not a mark');
  assert.equal(marks.markLogicInLine('원 : [색] 파랑', 4, 11), '원 : [색.!] 파랑');
  assert.equal(marks.hasLogicMark("'[!]' 삼각형"), false, 'quoted text is just text');
});

test('editing a held-back line frees it from [!]; a line added with [!] by hand stays; the old lines are kept as earlier values', () => {
  const { memoEditEffects } = loadSource('utils/noteLogicMarks.ts');
  const fixed = memoEditEffects('[!] 가 : 나\n다 : 라', '[!] 가 : 나2\n다 : 라');
  assert.equal(fixed.memo, '가 : 나2\n다 : 라');
  assert.equal(fixed.released, 1);
  assert.deepEqual(fixed.oldLines, [{ text: '[!] 가 : 나', replacedBy: '[!] 가 : 나2' }]);
  const added = memoEditEffects('가 : 나', '가 : 나\n[!] 마 : 바');
  assert.equal(added.memo, '가 : 나\n[!] 마 : 바');
  assert.equal(added.released, 0);
  assert.deepEqual(memoEditEffects('가 : 나', '가 : 나').oldLines, []);
  // other lines of the note are not touched
  const other = memoEditEffects('[!] 가 : 나\n다 : 라\n마 : 바', '[!] 가 : 나\n다 : 라2\n마 : 바');
  assert.equal(other.memo, '[!] 가 : 나\n다 : 라2\n마 : 바');
  assert.equal(other.released, 0);
});

test('editing a note puts the new questions into review (switchable); questions already there keep their date', () => {
  const nowMs = Date.parse('2026-10-22T00:00:00.000Z');
  const log = { id: 'L1', subjectId: 's', reviewMemo: '가 : 나\n다 : 라', nextReviewDate: new Date(nowMs + 3 * 86400000).toISOString(), reviewEnabled: true, reviewStep: 1 };
  const edited = '가 : 나\n다 : 라\n마 : 바';
  const off = gate.updateReviewGateMemo(log, edited, undefined, { nowMs });
  assert.equal(off.nextReviewDate, log.nextReviewDate);
  assert.equal(off.reviewQuestionSchedules, undefined);
  const on = gate.updateReviewGateMemo(log, edited, undefined, { intake: true, nowMs });
  assert.equal(on.nextReviewDate, new Date(nowMs).toISOString(), 'the note is due now for the new part');
  const schedules = on.reviewQuestionSchedules;
  const fresh = Object.values(schedules).filter(item => item.nextReviewDate === new Date(nowMs).toISOString());
  const kept = Object.values(schedules).filter(item => item.nextReviewDate === log.nextReviewDate);
  assert.ok(fresh.length > 0 && kept.length > 0, 'new questions are due now, the old ones keep their date');
  assert.equal(fresh.length, getKeys(edited).length - getKeys(log.reviewMemo).length);
  // a line added already held back by [!] makes no question, so nothing is taken in
  const held = gate.updateReviewGateMemo(log, '가 : 나\n다 : 라\n[!] 마 : 바', undefined, { intake: true, nowMs });
  assert.equal(held.nextReviewDate, log.nextReviewDate);
  // a note that is not in review (condensed / off) is left alone
  const condensed = gate.updateReviewGateMemo({ ...log, isCondensed: true }, edited, undefined, { intake: true, nowMs });
  assert.equal(condensed.reviewQuestionSchedules, undefined);
  function getKeys(memo) { return gate.getReviewGateQuestionKeys(memo); }
});

test('removing a question from review: low importance keeps the note, logic puts [!] on its line, both can be undone', () => {
  const removal = loadSource('utils/reviewRemoval.ts');
  const memo = '[도형]:[개념:정의]\n:::toggle 도형 :\n정사각형:네 변이 같다\n:::end\n원:한 점에서 같은 거리';
  const target = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '정사각형');
  assert.ok(target);
  const cover = { logId: 'a', questionKey: target.key };
  const log = { id: 'a', subjectId: 's', reviewMemo: memo };
  const nowIso = '2026-10-22T00:00:00.000Z';
  // 중요도가 떨어져서: the note is unchanged, only the review leaves it
  const low = removal.planReviewRemoval({ reason: 'low', covers: [cover], memos: [{ logId: 'a', memo }], nowIso });
  assert.equal(low.length, 1);
  assert.equal(low[0].memo, undefined);
  assert.equal(low[0].removed[target.key].reason, 'low');
  const lowLog = gate.applyReviewRemoval(log, low[0]);
  assert.equal(lowLog.reviewMemo, memo);
  assert.ok(gate.isReviewQuestionRemoved(lowLog, target.key));
  assert.ok(!gate.getDueReviewGateQuestionKeys(lowLog, Date.parse(nowIso) + 1, true).includes(target.key));
  assert.ok(gate.getDueReviewGateQuestionKeys(lowLog, Date.parse(nowIso) + 1, true).length > 0, 'the other questions are still due');
  assert.equal(gate.restoreReviewRemoval(lowLog, target.key).reviewRemoved, undefined);
  assert.ok(!gate.isReviewQuestionRemoved(gate.restoreReviewRemoval(lowLog, target.key), target.key));
  // 논리적 관계에 안 맞아서: the answer cell's line gets [!] (the question is not made while it is there)
  const logic = removal.planReviewRemoval({ reason: 'logic', covers: [cover], memos: [{ logId: 'a', memo }], relatedMemos: [{ logId: 'a', memo }], nowIso });
  const record = logic[0].removed[target.key];
  assert.equal(record.reason, 'logic');
  assert.equal(record.markedLines.length, 1);
  assert.match(record.markedLines[0], /\[!\]/);
  assert.equal(loadSource('utils/noteLogicMarks.ts').stripLogicMarks(record.markedLines[0]), '정사각형:네 변이 같다');
  assert.match(logic[0].memo, /\[!\]/);
  assert.equal(record.related, undefined, 'the held-back line itself is not repeated as related data');
  const logicLog = gate.applyReviewRemoval(log, logic[0]);
  assert.ok(!questionsFor(logicLog.reviewMemo).some(q => q.prompt === '정사각형' && q.answer === '네 변이 같다'));
  assert.ok(questionsFor(logicLog.reviewMemo).some(q => q.prompt === '원'), 'other lines keep their questions');
  assert.ok(!gate.isReviewQuestionRemoved(logicLog, target.key), 'held back by [!], not by the record');
  // the note keeps its text apart from the mark; undoing takes the mark out and the question comes back
  assert.equal(marksStripped(logicLog.reviewMemo), memo);
  const back = gate.restoreReviewRemoval(logicLog, target.key);
  assert.equal(back.reviewMemo, memo);
  assert.equal(back.reviewRemoved, undefined);
  assert.ok(questionsFor(back.reviewMemo).some(q => q.key === target.key));
  // editing the held-back line frees it: the mark is gone and the record is dropped
  const edited = gate.updateReviewGateMemo(logicLog, logicLog.reviewMemo.replace('네 변이 같다', '네 변이 모두 같다'), undefined, {});
  assert.doesNotMatch(edited.reviewMemo, /\[!\]/);
  assert.equal(edited.reviewRemoved, undefined);
  assert.ok(edited.reviewMemoOldLines.some(line => line.text.includes('네 변이 같다')), 'the earlier value is kept');
  function marksStripped(text) { return loadSource('utils/noteLogicMarks.ts').stripLogicMarks(text); }
});

test('removing a question made by a # template blocks only that one made line, and undoing takes the added line out again', () => {
  const removal = loadSource('utils/reviewRemoval.ts');
  const nowIso = '2026-10-23T00:00:00.000Z';
  const cases = [
    { memo: "A:'B-C'\nA:'X-Y'\n[A] #'-'#: #+#", line: "[!] A:'B-C':'B+C'" },
    { memo: ":::toggle A\n'B-C'\n'X-Y'\n:::end\n[A] #'-'#: #+#", line: "[A.!] 'B-C':'B+C'" }
  ];
  cases.forEach(({ memo, line }) => {
    const target = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === 'B-C' && q.answer === 'B+C');
    assert.ok(target, memo);
    const cover = { logId: 'a', questionKey: target.key };
    const log = { id: 'a', subjectId: 's', reviewMemo: memo };
    // 논리 이유: the template line stays, one made line is added as a real [!] line right below it
    const plan = removal.planReviewRemoval({ reason: 'logic', covers: [cover], memos: [{ logId: 'a', memo }], nowIso });
    const record = plan[0].removed[target.key];
    assert.deepEqual(record.markedLines, [line]);
    assert.deepEqual(record.addedLines, [line]);
    const lines = plan[0].memo.split('\n');
    assert.equal(lines[lines.indexOf("[A] #'-'#: #+#") + 1], line, 'the added line sits right under the template');
    assert.ok(memo.split('\n').every(text => lines.includes(text)), 'nothing the person wrote is changed');
    const after = gate.applyReviewRemoval(log, plan[0]);
    const kept = questionsFor(after.reviewMemo).filter(q => q.kind === 'direct').map(q => `${q.prompt}>${q.answer}`);
    assert.ok(!kept.includes('B-C>B+C'), 'that one made line gives no question any more');
    assert.ok(kept.includes('X-Y>X+Y'), 'the other made lines of the same template stay');
    // removing it twice does not add a second line
    const again = removal.planReviewRemoval({ reason: 'logic', covers: [cover], memos: [{ logId: 'a', memo }], liveMemos: [{ logId: 'a', memo: after.reviewMemo }], nowIso });
    assert.equal((again[0].memo ?? after.reviewMemo).split('\n').filter(text => text === line).length, 1);
    // 되돌리기: the added line is deleted, the note is exactly as it was and the question is back
    const back = gate.restoreReviewRemoval(after, target.key);
    assert.equal(back.reviewMemo, memo);
    assert.ok(questionsFor(back.reviewMemo).some(q => q.key === target.key));
    // 중요도 이유: the note is not touched at all
    const low = removal.planReviewRemoval({ reason: 'low', covers: [cover], memos: [{ logId: 'a', memo }], nowIso });
    assert.equal(low[0].memo, undefined);
  });
});

test('the removal panel finds the ability definition and the note line a question came from, and edits them where they stand', () => {
  const removal = loadSource('utils/reviewRemoval.ts');
  const memo = '[도형]:[개념:정의]\n:::toggle 도형 :\n정사각형:네 변이 같다\n:::end';
  const target = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '정사각형');
  const cover = { logId: 'a', questionKey: target.key };
  const defs = removal.questionDefinitions({ covers: [cover], memos: [{ logId: 'a', memo }], setMemos: [{ logId: 'a', memo }] });
  assert.deepEqual(defs.abilities.map(line => [line.lineIndex, line.text]), [[0, '[도형]:[개념:정의]']]);
  assert.deepEqual(defs.lines.map(line => [line.lineIndex, line.text]), [[2, '정사각형:네 변이 같다']]);
  assert.deepEqual(defs.values, ['정사각형', '네 변이 같다']);
  // a definition kept on another page is found through the other notes of the subject
  const lone = ':::toggle 도형 :\n정사각형:네 변이 같다\n:::end';
  const loneKey = questionsFor(lone).find(q => q.kind === 'direct' && q.prompt === '정사각형').key;
  const other = removal.questionDefinitions({ covers: [{ logId: 'b', questionKey: loneKey }], memos: [{ logId: 'b', memo: lone }], setMemos: [{ logId: 'a', memo: '[도형]:[개념:정의]' }, { logId: 'b', memo: lone }] });
  assert.deepEqual(other.abilities.map(line => [line.logId, line.lineIndex]), [['a', 0]]);
  // replacing a line checks that it is still the line shown (the note may have changed meanwhile)
  assert.equal(removal.replaceMemoLine(memo, 0, '[도형]:[개념:정의]', '[도형]:[개념:이름]', false), memo.replace('정의]', '이름]'));
  assert.equal(removal.replaceMemoLine('x\n[도형]:[개념:정의]', 0, '[도형]:[개념:정의]', '[도형]:[개념:이름]', false), 'x\n[도형]:[개념:이름]', 'found by its text when the line moved');
  assert.equal(removal.replaceMemoLine(memo, 0, '없는 줄', 'x', false), null);
  assert.equal(removal.replaceMemoLine(memo, 1, '도형 :', '도형2 :', true), memo.replace(':::toggle 도형 :', ':::toggle 도형2 :'));
  // earlier values that mention the same words are fetched too
  const related = removal.collectRelatedData([{ logId: 'a', memo }], [{ text: '정사각형:네 변이 다르다', at: 'x' }, { text: '원:둥글다', at: 'x' }], defs.values);
  assert.ok(related.current.some(item => item.text.includes('정사각형')));
  assert.deepEqual(related.previous.map(item => item.text), ['정사각형:네 변이 다르다']);
});

test('the practice state follows the question list when a question leaves review or comes back', () => {
  const { startReviewPractice, gradeReviewPractice, reconcileReviewPractice } = loadSource('utils/reviewPractice.ts');
  const catalog = ['a', 'b', 'c'].map(id => ({ id, logId: 'L', level: 1, priority: 1 }));
  let state = gradeReviewPractice(startReviewPractice(catalog, {}), catalog, 'good');
  assert.deepEqual(state.queue, ['b', 'c']);
  const smaller = catalog.filter(item => item.id !== 'b');
  const dropped = reconcileReviewPractice(state, smaller);
  assert.deepEqual(dropped.queue, ['c']);
  assert.deepEqual(dropped.completed, ['a']);
  // a question answered and then taken out leaves no trace in the results
  const afterC = gradeReviewPractice(dropped, smaller, 'again');
  const without = reconcileReviewPractice(afterC, catalog.filter(item => item.id !== 'c'));
  assert.equal(without.wrongCounts.c, undefined);
  assert.equal(without.grades.c, undefined);
  // bringing it back puts it in line again
  assert.deepEqual(reconcileReviewPractice(dropped, catalog).queue, ['b', 'c']);
});

test('the review screen holds the removal tools and the undo strip; the note screen has the switch and the removed list', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewPracticeScreen } = loadSource('components/ReviewPracticeScreen.tsx');
  const { ReviewQuestionTools } = loadSource('components/ReviewQuestionTools.tsx');
  const { ReviewRemovedList } = loadSource('components/ReviewRemovedList.tsx');
  const base = {
    title: '기본 복습', isRetry: false, subjectName: '수학', rangeLabel: '1~10', elapsed: '00:10', targetRemaining: '05:00',
    isRunning: true, canPause: true, pauseLabel: '잠시 중단', onTogglePause() {}, onClose() {}, onCondenseFirst() {},
    level: 1, round: 1, roundSize: 2, queueLength: 2, hasQuestions: true, isComplete: false,
    question: React.createElement('p', null, '문제전용문장'), questionRange: '1~10', hasCurrentQuestion: true,
    revealed: false, onReveal() {}, onGrade() {}, wrongIntervalLabel: '2시간', correctIntervalLabel: '1일',
    rail: [{ id: 'a', label: '1번 · 기본 관계', status: 'now', wrongCount: 0 }],
    firstTryCorrect: 0, firstTryTotal: 0, completion: null, firstTryOk: 0, firstTryBad: 0,
    finishLabel: '남은 문제 2', canFinish: false, onFinish() {}
  };
  const plain = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, base));
  assert.ok(!plain.includes('복습에서 빼기') && !plain.includes('removal-notice'));
  const memo = '정사각형:네 변이 같다';
  const key = questionsFor(memo)[0].key;
  const tools = React.createElement(ReviewQuestionTools, { covers: [{ logId: 'a', questionKey: key }], memos: [{ logId: 'a', memo }], setMemos: [{ logId: 'a', memo }], oldLines: [], onRemove() {}, onEdit() { return null; } });
  const withTools = renderToStaticMarkup(React.createElement(ReviewPracticeScreen, { ...base, questionTools: tools, removalNotice: React.createElement('div', { 'data-testid': 'removal-notice' }, '복습에서 뺐어요') }));
  assert.ok(withTools.includes('data-testid="question-tools"') && withTools.includes('복습에서 빼기'));
  assert.ok(withTools.indexOf('문제전용문장') < withTools.indexOf('복습에서 빼기') && withTools.indexOf('복습에서 빼기') < withTools.indexOf('정답 확인'), 'the tools sit between the question and the reveal button');
  assert.ok(withTools.includes('removal-notice'));
  // the note screen: the switch is on by default; removed questions are listed with their reason, the [!] line and the fetched data
  const logs = [{ id: 'a', subjectId: 's', timestamp: 't', reviewRemoved: {
    k1: { reason: 'logic', at: '2026-10-22T00:00:00.000Z', prompt: '정사각형', answer: '네 변이 같다', markedLines: ['정사각형:[!] 네 변이 같다'], related: ['이전 · 정사각형:네 변이 다르다'] },
    k2: { reason: 'low', at: '2026-10-21T00:00:00.000Z', prompt: '원', answer: '둥글다' }
  } }];
  const closed = renderToStaticMarkup(React.createElement(ReviewRemovedList, { logs, onRestore() {} }));
  // 스위치는 노트 위의 띠(EditIntakeBar)로 옮겼다
  const { EditIntakeBar } = loadSource('components/ReviewRemovedList.tsx');
  assert.match(renderToStaticMarkup(React.createElement(EditIntakeBar, { logs })), /role="switch"[^>]*aria-checked="true"/);
  assert.ok(!closed.includes('role="switch"'));
  assert.ok(closed.includes('복습에서 뺀 문제') && closed.includes('>2<'));
  assert.ok(!closed.includes('논리적 관계에 안 맞아요'), 'the list is folded until opened');
  assert.ok(!renderToStaticMarkup(React.createElement(ReviewRemovedList, { logs: [{ id: 'a', subjectId: 's', timestamp: 't' }] })).includes('복습에서 뺀 문제'));
});

test('finishing a review does not make the record due again because of the old subject FSRS date', () => {
  const fsrs = loadSource('utils/fsrs.ts');
  const { completeRegularReviewSchedule } = loadSource('utils/reviewGate.ts');
  const DAY = 86400000;
  const t0 = Date.parse('2026-10-01T03:00:00.000Z');
  const card = fsrs.fsrsReview(null, 3, t0);
  const firstDue = t0 + fsrs.fsrsIntervalMs(card);
  const log = { id: 'a', subjectId: 's', timestamp: new Date(t0).toISOString(), pagesRead: 10, timeSpentMinutes: 30, reviewMemo: '정사각형:네 변이 같다',
    reviewStep: 0, reviewFsrs: card, reviewEnabled: true, nextReviewDate: new Date(firstDue).toISOString() };
  // 첫 복습 때(= 과목 FSRS 예정일이 막 지난 때) 문제 복습만 마치면 다음 복습은 미래다
  const now = firstDue + 1000;
  const done = completeRegularReviewSchedule(log, now);
  assert.ok(Date.parse(done.nextReviewDate) > now, 'the next review is in the future, not at the old due date');
  // 방금 난도 피드백으로 카드를 새로 갱신했다면 그 날짜가 다음 복습을 정한다
  const refreshed = { ...log, reviewFsrs: fsrs.fsrsReview(card, 3, now) };
  const doneFresh = completeRegularReviewSchedule(refreshed, now);
  assert.equal(Date.parse(doneFresh.nextReviewDate), refreshed.reviewFsrs.lastReviewMs + fsrs.fsrsIntervalMs(refreshed.reviewFsrs));
  assert.ok(Date.parse(doneFresh.nextReviewDate) - now > DAY, 'a good grade waits more than a day');
});

test('editing a summed record keeps the difficulty feedback memory, question schedules and removed questions', () => {
  const { carriedReviewState } = loadSource('utils/review.ts');
  const log = { id: 'a', subjectId: 's', timestamp: 't', pagesRead: 5, timeSpentMinutes: 20,
    reviewFsrs: { stability: 2.3, difficulty: 5, reps: 1, lapses: 0, lastReviewMs: 1 }, feedbackGrade: 'good',
    reviewQuestionSchedules: { k: { reviewStep: 1, nextReviewDate: '2026-11-01T00:00:00.000Z' } }, reviewQuestionFormat: 2, reviewGateLevel: 2,
    reviewRemoved: { k2: { reason: 'low', at: 'x', prompt: 'p', answer: 'a' } }, reviewMemoOldLines: [{ text: 'old', replacedBy: 'new', at: 'x' }] };
  const kept = carriedReviewState(log);
  assert.deepEqual(Object.keys(kept).sort(), ['feedbackGrade', 'reviewFsrs', 'reviewGateLevel', 'reviewMemoOldLines', 'reviewQuestionFormat', 'reviewQuestionSchedules', 'reviewRemoved']);
  assert.equal(kept.reviewFsrs, log.reviewFsrs); assert.equal(kept.reviewRemoved, log.reviewRemoved);
  // 없는 값은 만들지 않는다
  assert.deepEqual(carriedReviewState({ id: 'b', subjectId: 's', timestamp: 't', pagesRead: 1, timeSpentMinutes: 1 }), {});
  // 합산 기록 수정은 이 값들을 이어 받는다
  const summary = fs.readFileSync(path.resolve(__dirname, '..', 'components/TodaySummary.tsx'), 'utf8');
  assert.match(summary, /\.\.\.carriedReviewState\(retainedReviewLog\)/);
});

test('writing a relation again does not fabricate an equality in another earlier line', () => {
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  // 이미 같은 글이 이전 페이지에 있으면(맨 앞 칸이 같고 낱말이 모두 있음) 같은 이름으로 시작하는 다른 줄에 합치지 않는다
  assert.deepEqual(mergeNoteIntoEarlier('사각형:변', [{ id: 'a', memo: '사각형:변' }, { id: 'b', memo: '사각형;넓이' }]), []);
  assert.deepEqual(mergeNoteIntoEarlier('사각형:변', [{ id: 'a', memo: '사각형:변:A\n사각형;넓이' }]), []);
  // 한 번 합친 뒤 같은 글을 또 합쳐도 달라지지 않는다
  const first = mergeNoteIntoEarlier('사각형:변', [{ id: 'b', memo: '사각형;넓이' }]);
  assert.equal(first[0].after, '사각형;넓이=변');
  assert.deepEqual(mergeNoteIntoEarlier('사각형:변', [{ id: 'b', memo: first[0].after }, { id: 'c', memo: '사각형;둘레' }]), []);
  // 겹치지만 아직 들어 있지 않은 글은 예전처럼 합친다
  assert.equal(mergeNoteIntoEarlier('사각형:변', [{ id: 'a', memo: '사각형;넓이' }])[0].after, '사각형;넓이=변');
  assert.equal(mergeNoteIntoEarlier('사각형:각', [{ id: 'a', memo: '사각형:변' }, { id: 'b', memo: '사각형;넓이' }])[0].logId, 'a');
});

// ---- 하루에 풀 페이지는 푼 페이지(장수)를 기준으로 줄인다 ----
const solvedSubject = (overrides = {}) => shortPlanSubject({ id: 'endpage', totalPages: 60, ...overrides });
const solvedLog = (id, date, startPage, endPage, extra = {}) => ({
  id, subjectId: 'endpage', studyDate: date, timestamp: new Date(`${date}T10:00:00`).toISOString(),
  pagesRead: endPage - startPage + 1, timeSpentMinutes: 20, startPage, endPage, pageCountIsExplicit: true, ...extra
});
const solvedToday = (subject, logs) => buildStudyOrderForDate([subject], logs, 1, '2026-10-12', planningToday)[0];

test('daily pages shrink by the pages actually solved, not by how far the end page moved', () => {
  const item = solvedToday(solvedSubject({ completedPages: 10 }), [solvedLog('a', '2026-10-12', 1, 10)]);
  assert.equal(item.scopedPages, 10);
  assert.equal(item.remainingDayPages, 10);
  // 21~30만 풀면(앞 쪽은 건너뜀) 끝 페이지는 30이어도 푼 장수는 10이라 그만큼만 줄고 하루 몫은 남는다
  const skipped = solvedToday(solvedSubject({ completedPages: 30 }), [solvedLog('before', '2026-10-11', 1, 10), solvedLog('today', '2026-10-12', 21, 30)]);
  assert.equal(skipped.scopedPages, 10);
  assert.ok(skipped.remainingDayPages > 0, 'skipping ahead does not finish the day');
});

test('a new unit inherits the previous unit: with no pages in the new unit yet the cell shows the previous unit average', () => {
  const { getEfficiencyScope, getEfficiencyView, nextEfficiencyComparison } = loadSource('utils/pageGrowth.ts');
  const unitLogs = [
    source({ id: 'a', pagesRead: 10, timeSpentMinutes: 25, timestamp: '2026-10-12T01:00:00Z' }),
    source({ id: 'b', pagesRead: 10, timeSpentMinutes: 20, timestamp: '2026-10-12T03:00:00Z' }),
    source({ id: 'c', pagesRead: 10, timeSpentMinutes: 25, timestamp: '2026-10-12T05:00:00Z' }),
    source({ id: 'd', pagesRead: 10, timeSpentMinutes: 15, timestamp: '2026-10-12T07:00:00Z' })
  ];
  // 4시와 8시에 복습에 넣어 단위를 둘 마쳤고 셋째 단위에는 아직 푼 기록이 없다 → 둘째 단위(40분 ÷ 20쪽 = 2분/P)를 가져온다
  const cuts = [Date.parse('2026-10-12T04:00:00Z'), Date.parse('2026-10-12T08:00:00Z')];
  const fresh = getEfficiencyView(getEfficiencyScope(unitLogs, cuts));
  assert.equal(fresh.inherited, true);
  assert.equal(fresh.shown.averageTimePerPage, 2);
  // 자기 자신과 견주지 않는다: 이전 단위는 첫째 단위(45분 ÷ 20쪽 = 2.25분/P), 뽀모도로로는 견주지 않는다
  assert.equal(fresh.choice.kind, 'unit');
  assert.equal(fresh.referenceUnit.index, 1);
  assert.equal(fresh.maxComparison, 0);
  assert.ok(fresh.overall, 'compared against the unit before it');
  assert.deepEqual(fresh.options.map(option => option.kind), ['unit', 'average']);
  assert.equal(nextEfficiencyComparison(fresh).kind, 'average');
  // 새 단위에 한 장이라도 풀면 그 단위의 최근 25분으로 돌아온다
  const started = getEfficiencyView(getEfficiencyScope([...unitLogs,
    source({ id: 'e', pagesRead: 5, timeSpentMinutes: 10, timestamp: '2026-10-12T09:00:00Z' })], cuts));
  assert.equal(started.inherited, false);
  assert.ok(Math.abs(started.shown.averageTimePerPage - 25 / 15) < 1e-9);
  assert.equal(started.choice.kind, 'pomodoro');
  // 단위가 하나뿐이면 앞 단위가 없어 평균도 없고, 단위가 없는 과목은 늘 최근 25분이다
  const one = getEfficiencyView(getEfficiencyScope(unitLogs.slice(0, 2), cuts.slice(0, 1)));
  assert.equal(one.inherited, true);
  assert.equal(one.shown.averageTimePerPage, 2.25);
  assert.deepEqual(one.options, []);
  assert.equal(getEfficiencyView(getEfficiencyScope(unitLogs, [])).inherited, false, 'never put into review: one open unit');
});

test('writing a note cell recommends its position, and the recommendation puts [position] in front of the cell', () => {
  const { buildNoteSetIndex, cellLocationSuggestions, headCellAtCaret } = loadSource('utils/noteSets.ts');
  const notes = [':::toggle 동물', ':::toggle 포유류', '고래', ':::end', ':::end'].join('\n');
  const index = buildNoteSetIndex([notes]);
  const at = text => headCellAtCaret(text.replace('|', ''), text.indexOf('|'));
  // 새 노트에 같은 셀을 쓰면 그 셀의 위치(가까운 상위 집합부터)를 추천한다
  const typed = at('고래|');
  assert.deepEqual(typed, { cellStart: 0, cellEnd: 2, cell: '고래' });
  const items = cellLocationSuggestions(index, typed, 2);
  assert.deepEqual(items.map(item => [item.text, item.label, item.tag]), [['[포유류] ', '[포유류]', '위치'], ['[동물] ', '[동물]', '위치']]);
  // 탭을 누르면 셀 앞에 [위치]가 붙고 커서는 셀 끝에 그대로 있다
  const apply = (text, caret, item) => {
    const next = `${text.slice(0, item.from)}${item.text}${text.slice(item.to)}`;
    return { next, caret: item.from + item.caret };
  };
  const done = apply('고래', 2, items[0]);
  assert.equal(done.next, '[포유류] 고래');
  assert.equal(done.caret, done.next.length);
  // 위치를 붙인 셀은 더 이상 추천하지 않는다(이미 위치 표시가 있다)
  assert.equal(at('[포유류] 고래|'), null);
  // 관계 기호가 뒤따라도 맨 앞 셀이고, 뒤 칸의 셀·`//` 뒤 칸은 그 칸의 맨 앞 셀이다
  assert.equal(at('고래| : 포유류').cell, '고래');
  assert.equal(at('고래 : 포유|류'), null);
  assert.equal(at('설명 // 돌고래|').cell, '돌고래');
  // 커서가 셀 밖(줄 맨 앞·다른 줄)이면 셀이 아니다
  assert.equal(at('|고래'), null);
  assert.equal(at('고래\n|'), null);
  // 이름을 아직 다 쓰지 않았거나 위치를 모르는 셀은 추천이 없다
  assert.deepEqual(cellLocationSuggestions(index, at('고|'), 1), []);
  assert.deepEqual(cellLocationSuggestions(index, at('낯선셀|'), 4), []);
});

test('logic words in one cell: a:b-c reads as a:(b-c), and a quoted operator in a:f\':\'g reads as a:(f=g)', () => {
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const shape = memo => buildReviewQuestions(memo).questions.map(question => JSON.stringify([question.kind, question.prompt, question.answer])).sort();
  assert.deepEqual(shape('a:b-c'), shape('a:(b-c)'));
  assert.deepEqual(shape('a:b=c'), shape('a:(b=c)'));
  assert.deepEqual(shape('a:b,c'), shape('a:(b,c)'));
  // 기호만 따옴표로 감싸면 단어에 붙여 써도 그 기호가 논리어다: ':' = '=' · ';' = '-'
  assert.deepEqual(shape("a:f':'g"), shape('a:(f=g)'));
  assert.deepEqual(shape("a:f';'g"), shape('a:(f-g)'));
  assert.deepEqual(shape("a:f':'g"), shape("a:f ':' g"), 'with or without spaces around the quoted operator');
  // 따옴표가 단어 속 글자(don't)이거나 짝이 없으면 그냥 글자다
  assert.ok(shape("a:don't").every(item => !item.includes('=')));
});

test('[a:b:c] is short for [[a]:[b]:[c]]: marks, toggle titles and the ability definition all name the same position', () => {
  const { buildNoteSetIndex, evaluateSetExpression, markKeyOf, positionChainOf, toggleName } = loadSource('utils/noteSets.ts');
  const { canonicalMark } = loadSource('utils/noteDiagram.ts');
  assert.equal(canonicalMark('[a]:[b]:[c]'), 'a:b:c');
  assert.equal(canonicalMark('a : [b]'), 'a:b');
  assert.equal(markKeyOf('[A]:[C]'), markKeyOf('A:C'));
  ['[a:b:c]', '[a]:[b]:[c]', '[[a]:[b]:[c]]'].forEach(title => {
    assert.equal(positionChainOf(title), 'a:b:c', title);
    assert.equal(toggleName(title), 'a:b:c', title);
  });
  assert.equal(positionChainOf('수 [개념:정의]'), null, 'a name with a criterion is not a pure position chain');
  assert.equal(positionChainOf('[소수]'), null, 'a single [name] is not a chain');
  // 같은 위치를 어떻게 적어도 한 곳에 모인다: 토글 제목 아래 줄, `[A:C] 셀`, `[[A]:[C]] 셀`
  const memo = [':::toggle [A]:[C] :', 'V', ':::end', '[A:C] W', '[[A]:[C]] X'].join('\n');
  const index = buildNoteSetIndex([memo]);
  assert.deepEqual([...evaluateSetExpression(index, '[A:C]')].sort(), ['V', 'W', 'X']);
  assert.deepEqual([...index.marks.get('A:C').cells], ['W', 'X']);
});

test('an ability definition is itself a set: [소수]:[수:성질] is the position 소수:수:성질 and holds the cells the definition covers', () => {
  const { buildNoteSetIndex, evaluateSetExpression, abilitiesFor } = loadSource('utils/noteSets.ts');
  const memo = [':::toggle 수 :', '[소수]:[수:성질]', ':::toggle 소수 :', '2', '3', ':::end', '4', ':::end'].join('\n');
  const index = buildNoteSetIndex([memo]);
  assert.deepEqual([...evaluateSetExpression(index, '[소수:수:성질]')].sort(), ['2', '3']);
  assert.deepEqual([...evaluateSetExpression(index, '[[소수]:[수:성질]]')].sort(), ['2', '3'], 'the long form is the same set');
  assert.deepEqual([...index.marks.get('소수:수:성질').cells], ['2', '3']);
  // 정의가 집합으로도 보인다고 해서 정의가 걸리는 범위가 넓어지지는 않는다: 직접 쓴 위치 표시만 따로 센다
  assert.equal(index.placements.has('소수:수:성질'), false);
  assert.equal(abilitiesFor(index, '2', ['수']).length, 1);
  assert.equal(abilitiesFor(index, '2', []).length, 0, 'still only inside its own toggle');
});

test('a location keeps its lowest set and shortens the sets above it to ..: [A.B] becomes [..B] when B sits only in A; more parents bring names back; recommendations never shorten', () => {
  const { ancestorsOf, buildNoteSetIndex, cellLocationSuggestions, displayedLocations, headCellAtCaret } = loadSource('utils/noteSets.ts');
  const base = [':::toggle 도형 :', ':::toggle 삼각형 :', '직각삼각형', '이등변삼각형', ':::end', '정사각형', ':::end'];
  const one = buildNoteSetIndex([base.join('\n')]);
  assert.deepEqual(displayedLocations(one, '이등변삼각형'), ['..삼각형'], 'the lowest set stays, 도형 above it is shortened');
  assert.deepEqual(displayedLocations(one, '정사각형'), ['도형'], 'nothing above 도형, so nothing is shortened');
  assert.deepEqual(displayedLocations(one, '도형'), [], 'a top set has no location');
  assert.deepEqual(ancestorsOf(one, '이등변삼각형'), ['삼각형', '도형'], 'the full chain still exists');
  // 직각삼각형이 다른 집합에도 들어가면 상위가 둘이 되어 두 위치가 모두 보인다
  const two = buildNoteSetIndex([[...base, ':::toggle 특수 :', '직각삼각형', ':::end'].join('\n')]);
  assert.deepEqual(displayedLocations(two, '직각삼각형'), ['..삼각형', '특수']);
  // 삼각형이 도형과 특수 둘 아래에 있으면 둘 다 보인다: 도형.삼각형 · 특수.삼각형
  const both = buildNoteSetIndex([[...base, ':::toggle 특수 :', ':::toggle 삼각형 :', '직각삼각형', ':::end', ':::end'].join('\n')]);
  assert.deepEqual(displayedLocations(both, '이등변삼각형').sort(), ['도형.삼각형', '특수.삼각형']);
  // 생략한 가운데 집합: 도형이 두 곳(수학, 미술) 아래에 있으면 그 위가 보이고 하나뿐인 삼각형 자리는 ..로 접힌다
  const mid = buildNoteSetIndex([[':::toggle 수학 :', ':::toggle 도형 :', ':::toggle 삼각형 :', '이등변삼각형', ':::end', ':::end', ':::end', ':::toggle 미술 :', ':::toggle 도형 :', '원', ':::end', ':::end'].join('\n')]);
  assert.deepEqual(displayedLocations(mid, '이등변삼각형').sort(), ['미술..삼각형', '수학..삼각형']);
  // 추천은 줄이지 않는다
  const typed = '이등변삼각형';
  const context = headCellAtCaret(typed, typed.length);
  assert.deepEqual(cellLocationSuggestions(one, context, typed.length).map(item => item.label), ['[삼각형]', '[도형]']);
});

test('= - , never change the classification criterion, so they group tighter than : ; < wherever the line sits', () => {
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const shape = memo => buildReviewQuestions(memo).questions.map(question => JSON.stringify([question.kind, question.prompt, question.answer])).sort();
  assert.deepEqual(shape('a:b-c:d'), shape('a:(b-c):d'), 'in the middle of a chain');
  assert.deepEqual(shape('a-b:c'), shape('(a-b):c'), 'before the colon');
  assert.deepEqual(shape("a:f':'g:h"), shape('a:(f=g):h'), 'a quoted operator in the middle');
  assert.notDeepEqual(shape('a:b:c'), shape('a:(b:c)'), ': changes the criterion, so it is not grouped');
  assert.deepEqual(shape('[x] a:b-c'), shape('[x] a:(b-c)'), 'with a position in front');
  assert.deepEqual(shape(':::toggle T :\na:b-c\n:::end'), shape(':::toggle T :\na:(b-c)\n:::end'), 'inside a toggle');
});

test('a criterion written left of a cell, [A:B;C] x:y;z, names the cells to its right: x is A, y is B, z is C, for that line only', () => {
  const { buildReviewQuestions, getReviewQuestionClassification } = loadSource('utils/reviewQuestions.ts');
  const { leadingCriterionOf } = loadSource('utils/noteSets.ts');
  assert.equal(leadingCriterionOf('[개념:정의;예시] 정사각형:네 변이 같다'), '개념:정의;예시');
  assert.equal(leadingCriterionOf('[도형] 정사각형'), undefined, 'a single name is a position, not a criterion');
  assert.equal(leadingCriterionOf('[도형.%삼각형] 정사각형'), undefined, 'a set expression is not a criterion');
  const labels = (memo, key) => {
    const { questions } = buildReviewQuestions(memo);
    const question = questions.find(item => item.kind === 'direct' && item.prompt === key);
    return question && [question.criterion ?? null, ...Object.values(getReviewQuestionClassification(null, question)).slice(0, 2)];
  };
  assert.deepEqual(labels('[개념:정의] 정사각형:네 변이 같다', '정사각형'), ['개념:정의', ['개념'], ['정의']]);
  assert.deepEqual(labels('[개념:정의] 정사각형:네 변이 같다\n원:둥글다', '원'), [null, [], []], 'the next line is not covered');
  assert.deepEqual(labels('[개념:정의] 정사각형:네 변이 같다 // [원인:결과] 비:홍수', '비'), ['원인:결과', ['원인'], ['결과']], 'each // cell has its own criterion');
  // 가까운 기준이 먼저: 토글 제목의 기준보다 줄 앞의 기준이 우선한다
  assert.deepEqual(labels(':::toggle 수열 [A:B] :\n[개념:정의] x:y\n:::end', 'x')?.[0], '개념:정의');
});

test('ghost locations: each line whose first cell has a position shows [..B] as if written, without touching the saved text', () => {
  const { buildNoteSetIndex, ghostLocationsOf: ghostFull } = loadSource('utils/noteSets.ts');
  const ghostLocationsOf = (...args) => ghostFull(...args).map(({ line, label }) => ({ line, label }));
  const memo = [':::toggle 도형 :', ':::toggle 삼각형 :', '직각삼각형:직각이 하나', '이등변삼각형:두 변이 같다', ':::end', '정사각형:네 변이 같다', ':::end', ':::toggle 특수 :', '직각삼각형', ':::end'].join('\n');
  const index = buildNoteSetIndex([memo]);
  const inner = ['직각삼각형:직각이 하나', '', '이등변삼각형:두 변이 같다', '정사각형:네 변이 같다', '[삼각형] 직각삼각형', '[도형]', '낯선셀:없다'].join('\n');
  assert.deepEqual(ghostLocationsOf(index, inner), [
    { line: 0, label: '[..삼각형] [특수]' },
    { line: 2, label: '[..삼각형]' },
    { line: 3, label: '[도형]' }
  ], 'empty lines, set lines, cells that already carry [ ], and unknown cells show nothing');
  // `>` 토글 밑에서는 그 토글 제목(삼각형 · 도형)으로 이미 알려진 위치를 되풀이하지 않는다: 남은 위치(특수)만 보이고, 전부 겹치면 아무것도 없다
  assert.deepEqual(ghostLocationsOf(index, inner, ['도형', '삼각형']), [{ line: 0, label: '[특수]' }], 'lines whose location the enclosing toggles already state show only what is left');
  assert.deepEqual(ghostLocationsOf(index, '이등변삼각형:두 변이 같다', ['도형', '삼각형']), [], 'a line fully covered by its toggle shows nothing');
  assert.deepEqual(ghostLocationsOf(index, '이등변삼각형:두 변이 같다', ['특수']), [{ line: 0, label: '[..삼각형]' }], 'a toggle that is not the cell\'s location hides nothing');
  // 관계가 바뀌면(삼각형이 특수 아래에도 들어가면) 접혀 있던 위가 풀린다
  const wider = buildNoteSetIndex([[memo, ':::toggle 특수 :', ':::toggle 삼각형 :', '이등변삼각형', ':::end', ':::end'].join('\n')]);
  assert.deepEqual(ghostLocationsOf(wider, '이등변삼각형:두 변이 같다'), [{ line: 0, label: '[도형.삼각형] [특수.삼각형]' }]);
});

test('a text-unit cell put in [ ] holds the values added under it: [X] cell, [X]:(a,b) and [X].(a,b..) make the cell a set', () => {
  const { ancestorsOf, buildNoteSetIndex, evaluateSetExpression, ghostLocationsOf: ghostFull, setContents } = loadSource('utils/noteSets.ts');
  const ghostLocationsOf = (...args) => ghostFull(...args).map(({ line, label }) => ({ line, label }));
  ['삼각형:세 변\n[삼각형] 직각삼각형:직각이 하나\n[삼각형] 예각삼각형', '삼각형:세 변\n[삼각형]:(직각삼각형,예각삼각형)'].forEach(memo => {
    const index = buildNoteSetIndex([memo]);
    assert.ok(index.sets.has('삼각형'), memo);
    assert.deepEqual(ancestorsOf(index, '직각삼각형'), ['삼각형'], memo);
    assert.ok(evaluateSetExpression(index, '[삼각형]').includes('직각삼각형'), memo);
    assert.ok(!evaluateSetExpression(index, '[삼각형]').includes('삼각형'), 'the cell itself is the set, not a member of it');
    assert.deepEqual(setContents(index, '삼각형').map(row => row.name).slice(0, 1), ['직각삼각형'], memo);
  });
  // `[ ]` 밖에 점으로 이은 꼴(`[삼각형].(…)` · `직각삼각형.[삼각형]`)은 집합 표기가 아니다(집합 기호는 `[ ]` 안에서만)
  ['삼각형:세 변\n[삼각형].(직각삼각형,예각삼각형..)', '삼각형:세 변\n직각삼각형.[삼각형]'].forEach(memo => {
    assert.deepEqual(ancestorsOf(buildNoteSetIndex([memo]), '직각삼각형'), [], memo);
  });
  // 토글 안의 셀이면 위쪽 관계가 이어진다: 도형 > 삼각형(셀) > 직각삼각형
  const nested = buildNoteSetIndex([':::toggle 도형 :\n삼각형:세 변\n:::end\n[삼각형] 직각삼각형']);
  assert.deepEqual(ancestorsOf(nested, '직각삼각형'), ['삼각형', '도형']);
  assert.deepEqual(ghostLocationsOf(nested, '직각삼각형:직각이 하나'), [{ line: 0, label: '[..삼각형]' }]);
  // 서로를 가리켜도 멈춘다
  const loop = buildNoteSetIndex(['A:1\nB:2\n[A] B\n[B] A']);
  assert.deepEqual(evaluateSetExpression(loop, '[A]').length >= 0, true);
  // 셀이 아닌 위치 표시(`A:C`)는 셀로 보지 않는다
  assert.ok(!buildNoteSetIndex(['[A:C] 합']).sets.has('A:C'));
});

test('note ghost text: positions sit in the editor text like characters, and strip/offset mapping keeps the stored note and the caret exact', () => {
  const ghost = loadSource('utils/noteGhost.ts');
  const { buildNoteSetIndex, ghostLocationsOf } = loadSource('utils/noteSets.ts');
  const M = ghost.GHOST_MARK;
  const stored = '삼각형:세 변\n직각삼각형:직각이 하나\n일반 줄';
  const shown = ghost.insertGhosts(stored, [{ line: 1, label: '[..삼각형]' }]);
  assert.equal(shown, `삼각형:세 변\n${M}[..삼각형] ${M}직각삼각형:직각이 하나\n일반 줄`);
  assert.equal(ghost.stripGhosts(shown), stored, 'stripping gives the stored text back');
  assert.equal(ghost.insertGhosts(stored, []), stored);
  // 커서: 저장 ↔ 보이는 글. 줄 맨 앞은 끼운 글 뒤쪽에 놓인다
  const lineStart = stored.indexOf('직각삼각형');
  const ghostEnd = shown.indexOf('직각삼각형');
  assert.equal(ghost.displayOffset(shown, lineStart), ghostEnd);
  assert.equal(ghost.storedOffset(shown, ghostEnd), lineStart);
  assert.equal(ghost.storedOffset(shown, ghostEnd - 3), lineStart, 'inside the ghost counts as the line start');
  assert.equal(ghost.displayOffset(shown, lineStart - 1), lineStart - 1, 'end of the line before stays put');
  assert.equal(ghost.displayOffset(shown, stored.length), shown.length);
  assert.equal(ghost.storedOffset(shown, shown.length), stored.length);
  for (let at = 0; at <= stored.length; at += 1) assert.equal(ghost.storedOffset(shown, ghost.displayOffset(shown, at)), at, `round trip at ${at}`);
  // 끼운 글 판별: 줄 맨 앞의 온전한 짝만 spans에 든다
  assert.deepEqual(ghost.ghostSpans(shown).map(span => [span.line, span.label]), [[1, '[..삼각형]']]);
  assert.equal(ghost.ghostEndingAt(shown, ghostEnd)?.label, '[..삼각형]');
  assert.equal(ghost.ghostEndingAt(shown, ghostEnd + 1), null);
  // 줄이 합쳐져 끼운 글이 줄 가운데로 가면 글자째 버린다
  const merged = shown.replace('세 변\n', '세 변');
  assert.equal(ghost.stripGhosts(merged), '삼각형:세 변직각삼각형:직각이 하나\n일반 줄');
  // 앞뒤 MARK 중 하나가 지워져도(expected를 알려 주면) 남은 위치 글자까지 걷는다
  const expected = new Map([[1, '[..삼각형]']]);
  assert.equal(ghost.stripGhosts(shown.replace(`${M}[..삼각형] ${M}`, `[..삼각형] ${M}`), expected), stored);
  assert.equal(ghost.stripGhosts(shown.replace(`${M}[..삼각형] ${M}`, `${M}[..삼각형] `), expected), stored);
  assert.equal(ghost.stripGhosts(shown.replace(`${M}[..삼각형] ${M}`, `${M}`), expected), stored, 'a lone leftover marker is dropped');
  // 선택 고치기: 커서는 끼운 글 뒤로, 범위는 끼운 글을 반쯤 걸치지 않는다
  const spanStart = shown.indexOf(M);
  assert.deepEqual(ghost.normalizeSelection(shown, spanStart + 2, spanStart + 2), { start: ghostEnd, end: ghostEnd });
  assert.deepEqual(ghost.normalizeSelection(shown, spanStart, spanStart), { start: ghostEnd, end: ghostEnd });
  assert.equal(ghost.normalizeSelection(shown, ghostEnd, ghostEnd), null);
  assert.equal(ghost.normalizeSelection(shown, 1, 3), null);
  assert.deepEqual(ghost.normalizeSelection(shown, spanStart + 2, ghostEnd + 2), { start: ghostEnd, end: ghostEnd + 2 });
  assert.equal(ghost.normalizeSelection(shown, spanStart, ghostEnd + 2), null, 'selecting from the line start takes the ghost too');
  assert.deepEqual(ghost.normalizeSelection(shown, 2, spanStart + 3), { start: 2, end: spanStart });
  // 실제 노트에서: 계산된 위치를 끼워 넣고 걷어도 저장 글은 그대로, 펼친 전체 위치(full)는 `[..B]`와 같은 집합을 가리킨다
  const note = ':::toggle 수학 :\n:::toggle 도형 :\n삼각형:세 변\n:::end\n:::end\n[삼각형] 직각삼각형';
  const index = buildNoteSetIndex([note]);
  const line = '직각삼각형:직각이 하나';
  const labels = ghostLocationsOf(index, line);
  assert.equal(labels.length, 1);
  assert.ok(labels[0].label.startsWith('[..'), labels[0].label);
  assert.ok(labels[0].full.startsWith('[수학.도형.삼각형]'), labels[0].full);
  const view = ghost.insertGhosts(line, labels);
  assert.equal(ghost.stripGhosts(view), line);
  // 펼치면(글자로 쓰면) 같은 집합에 들어간다: 접힌 `[..삼각형]` 줄 = 전체 위치를 쓴 줄
  const folded = buildNoteSetIndex([`${note}\n${labels[0].label} ${line}`]);
  const unfolded = buildNoteSetIndex([`${note}\n${labels[0].full} ${line}`]);
  assert.deepEqual([...unfolded.sets.keys()].sort(), [...folded.sets.keys()].sort(), 'unfolding changes no set');
  assert.deepEqual([...(unfolded.parents.get('직각삼각형') ?? [])].sort(), [...(folded.parents.get('직각삼각형') ?? [])].sort(), 'unfolding keeps the same parents');
});

test('[?] is the set of cells that sit inside a set without any connective (: ; <); = and - are not connectives', () => {
  const { buildNoteSetIndex, evaluateSetExpression, setContents } = loadSource('utils/noteSets.ts');
  const note = [
    '사과',
    ':::toggle 도형 :',
    '삼각형:세 변',
    '직각삼각형',
    '정사각형=네 변이 같은 사각형',
    '[과일] 배',
    '[과일] 포도:보라색',
    '예각삼각형;뾰족',
    ':::end',
    '귤'
  ].join('\n');
  const index = buildNoteSetIndex([note]);
  const names = evaluateSetExpression(index, '?');
  assert.deepEqual([...names].sort(), ['배', '정사각형=네 변이 같은 사각형', '직각삼각형'].sort(), 'only cells in a set, without : ; <');
  assert.deepEqual(evaluateSetExpression(index, '[?]').sort(), names.slice().sort(), '[?] and ? are the same set');
  assert.ok(!names.includes('사과') && !names.includes('귤'), 'cells outside every set are not in [?]');
  assert.ok(!names.includes('삼각형') && !names.includes('포도') && !names.includes('예각삼각형'), 'cells that used a connective are not in [?]');
  assert.ok(!names.includes('도형'), 'a set itself is not a cell');
  // 교집합: B 안의 연결어 없는 셀
  assert.deepEqual(evaluateSetExpression(index, '도형.[?]').sort(), ['배', '정사각형=네 변이 같은 사각형', '직각삼각형'].sort(), 'inside the toggle: 배 is placed in 도형 too');
  assert.deepEqual(evaluateSetExpression(index, '도형.?').sort(), ['배', '정사각형=네 변이 같은 사각형', '직각삼각형'].sort());
  assert.deepEqual(evaluateSetExpression(index, '[과일].[?]'), ['배'], '포도 used a connective, so only 배 is in both');
  // 연결어 뒤에 이어 쓴 값도 이어진 셀이다: 다른 줄에서 연결어 없이 쓴 같은 셀은 [?]에서 빠진다
  const linked = buildNoteSetIndex([':::toggle T :\n물\n불\n물:액체\n:::end']);
  assert.deepEqual(evaluateSetExpression(linked, '?'), ['불']);
  const tail = buildNoteSetIndex([':::toggle T :\n흙\n돌\n바위:돌\n:::end']);
  assert.deepEqual(evaluateSetExpression(tail, '?'), ['흙'], 'a value written after a connective is connected too');
  // 나중에 연결하면 [?]에서 빠진다
  assert.deepEqual(evaluateSetExpression(buildNoteSetIndex([':::toggle T :\n흙\n:::end']), '?'), ['흙']);
  assert.deepEqual(evaluateSetExpression(buildNoteSetIndex([':::toggle T :\n흙:갈색\n:::end']), '?'), []);
  // 요소 보기 창(`[?]()`)에 쓰이는 목록
  assert.deepEqual(setContents(index, '?').map(row => row.name).sort(), names.slice().sort());
  // 내용이 아예 없으면 빈 집합
  assert.deepEqual(evaluateSetExpression(buildNoteSetIndex(['']), '?'), []);
});

test('editing a value in the [set]() window changes only the lines at that same position, in every note, and erasing keeps the other values', () => {
  const { buildNoteSetIndex, evaluateSetExpression } = loadSource('utils/noteSets.ts');
  const { rewriteSetMember } = loadSource('utils/noteSetEdit.ts');
  const notes = [
    ':::toggle 도형 :\n직각삼각형\n정사각형\n삼각형:세 변\n:::end\n:::toggle 장난감 :\n정사각형\n:::end',
    '[도형] 정사각형\n[장난감] 정사각형\n:::toggle 도형 :\n정사각형=네 변\n:::end'
  ];
  const index = buildNoteSetIndex(notes);
  const apply = (set, from, to) => notes.map(memo => rewriteSetMember(memo, index, set, from, to));
  // 같은 위치(도형 안)의 정사각형만 바뀌고, 장난감 안의 정사각형은 그대로: 다른 노트의 같은 위치도 같이 바뀐다
  const renamed = apply('도형', '정사각형', '정사각');
  assert.equal(renamed[0], ':::toggle 도형 :\n직각삼각형\n정사각\n삼각형:세 변\n:::end\n:::toggle 장난감 :\n정사각형\n:::end');
  assert.equal(renamed[1], '[도형] 정사각\n[장난감] 정사각형\n:::toggle 도형 :\n정사각형=네 변\n:::end', 'the [도형] mark line changes, the [장난감] line and the other cell do not');
  // 바뀐 노트로 다시 보면 도형 안에 정사각이 있고 장난감 안에는 정사각형이 그대로
  const after = buildNoteSetIndex(renamed);
  assert.ok(evaluateSetExpression(after, '[도형]').includes('정사각'));
  assert.ok(!evaluateSetExpression(after, '[도형]').includes('정사각형'));
  assert.ok(evaluateSetExpression(after, '[장난감]').includes('정사각형'));
  // 지우기: 그 셀 글자만 없어지고 다른 값은 남는다. 셀만 있던 줄은 줄째 없어진다
  const erased = apply('도형', '삼각형', '');
  assert.equal(erased[0], ':::toggle 도형 :\n직각삼각형\n정사각형\n:세 변\n:::end\n:::toggle 장난감 :\n정사각형\n:::end', 'the rest of the line stays');
  const gone = apply('도형', '직각삼각형', '');
  assert.equal(gone[0], ':::toggle 도형 :\n정사각형\n삼각형:세 변\n:::end\n:::toggle 장난감 :\n정사각형\n:::end', 'a line with only the cell disappears');
  assert.equal(rewriteSetMember('[A] x', buildNoteSetIndex(['[A] x']), 'A', 'x', ''), '[A]', 'a mark stays when only the cell is erased');
  // 분류기준이 든 위치: 같은 분류기준 아래의 값만
  const criteria = ['[개념:정의] y:z\n[개념:예시] y:w'];
  const cIndex = buildNoteSetIndex(criteria);
  assert.equal(rewriteSetMember(criteria[0], cIndex, '개념:정의', 'y', 'q'), '[개념:정의] q:z\n[개념:예시] y:w');
  // [?] 창: 연결어 없이 집합 안에 있는 줄만
  const loose = [':::toggle T :\n흙\n흙:갈색\n:::end'];
  const lIndex = buildNoteSetIndex(loose);
  assert.equal(rewriteSetMember(loose[0], lIndex, '?', '흙', '진흙'), loose[0], 'the connected cell is not in [?], so nothing changes');
  const plain = [':::toggle T :\n흙\n:::end\n흙:갈색'];
  assert.equal(rewriteSetMember(plain[0], buildNoteSetIndex(plain), '?', '흙', '진흙'), plain[0], 'connected elsewhere → not in [?]');
  const only = [':::toggle T :\n흙\n:::end\n흙'];
  assert.equal(rewriteSetMember(only[0], buildNoteSetIndex(only), '?', '흙', '진흙'), ':::toggle T :\n진흙\n:::end\n흙', 'only the occurrence inside a set changes');
  // 한 줄에 칸이 여럿이면(//) 셀이 있는 칸만
  const slash = [':::toggle T :\n흙 // 돌\n:::end'];
  assert.equal(rewriteSetMember(slash[0], buildNoteSetIndex(slash), 'T', '돌', '바위'), ':::toggle T :\n흙 // 바위\n:::end');
  // 같은 이름이 없으면 그대로
  assert.equal(rewriteSetMember(notes[0], index, '도형', '없는값', 'x'), notes[0]);
});

test('range tabs: the chooser is a tablist, and a cell list without onSelect is not pressable', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MemberChooser, TaskQueueList } = loadSource('components/TodayTasks.tsx');
  const members = [
    { key: 'all:review-a', detailKey: 'a-review', kind: 'review', label: '전체', state: 'pending', all: true },
    { key: 'range:review-a:0', detailKey: 'a-review', kind: 'review', label: 'p.1~10', state: 'pending' },
    { key: 'range:review-a:1', detailKey: 'a-review', kind: 'review', label: 'p.31~40', state: 'pending' }
  ];
  const html = renderToStaticMarkup(React.createElement(MemberChooser, { members, currentKey: 'range:review-a:1', onPick() {} }));
  assert.ok(html.includes('role="tablist"') && (html.match(/role="tab"/g) || []).length === 3, 'the members are tabs');
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1, 'only the viewed tab is selected');
  assert.match(html, /data-member-key="range:review-a:1"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-member-key="range:review-a:1"/);
  assert.ok(html.indexOf('전체') < html.indexOf('p.1~10') && html.indexOf('p.1~10') < html.indexOf('p.31~40'), 'all first, then each range');
  const chips = [{ key: 'review-a', detailKey: 'a-review', kind: 'review', kindLabel: '과목 복습', title: '수학 기출 복습', meta: '', required: false, timeLabel: '68분', state: 'pending' }];
  const list = renderToStaticMarkup(React.createElement(TaskQueueList, { items: chips, currentKey: '', currentRowKey: 'review-a', onRefresh() {}, onSelect() {} }));
  assert.ok(list.includes('data-selectable="true"') && list.includes('tabindex="0"') && !list.includes('data-testid="task-stepper"'));
  const plain = renderToStaticMarkup(React.createElement(TaskQueueList, { items: chips, currentKey: '', currentRowKey: 'review-a', onRefresh() {} }));
  assert.ok(!plain.includes('data-selectable') && !plain.includes('tabindex'), 'without onSelect the list is unchanged');
});

test('review kinds stay separate cells: basic review of one subject is one cell, ranges of one review subject are one cell with range groups', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewScopeStrip } = loadSource('components/TodayTasks.tsx');
  const strip = renderToStaticMarkup(React.createElement(ReviewScopeStrip, { all: true, scope: { range: 'p.1~10, 31~40', pages: 20, minutes: 68, groups: 2, pageLabel: 'P' } }));
  assert.ok(strip.includes('전체 복습 범위') && strip.includes('p.1~10, 31~40') && strip.includes('20P') && strip.includes('1시간 8분'));
  const one = renderToStaticMarkup(React.createElement(ReviewScopeStrip, { all: false, scope: { range: 'p.31~40', pages: 10, minutes: 0, groups: 1, pageLabel: 'P' } }));
  assert.ok(one.includes('복습 범위') && !one.includes('전체 복습 범위') && one.includes('측정 필요'));
  const { mergeQueueReviewGroups } = loadSource('components/SessionLogger.tsx');
  const log = (id, start, end, extra = {}) => ({ id, subjectId: 'a', startPage: start, endPage: end, pagesRead: end - start + 1, timestamp: 1, timeSpentMinutes: 10, ...extra });
  const group = (id, type, logs, extra = {}) => ({ id, parentSubjectId: 'a', parentSubjectName: 'A', subjectId: type === 'basic' ? 'a' : 'r', subjectName: type === 'basic' ? 'A' : 'R', reviewType: type, reviewSubjectIds: type === 'basic' ? [] : ['r'], logs, earliestReviewTime: 100, averageTimePerPage: 3, estimatedMinutes: 30, ...extra });
  const subjectsForMerge = [{ id: 'a', name: 'A', totalPages: 100, completedPages: 40 }, { id: 'r', name: 'R', totalPages: 100, completedPages: 0 }];
  // 기본 복습: 같은 과목은 한 칸. 복습과목 · 오답 복습 · 다른 과목은 그대로.
  const basics = [group('a:a:x:gate', 'basic', [log('l1', 1, 10)], { earliestReviewTime: 90 }), group('a:a:y:gate', 'basic', [log('l2', 21, 30)]),
    group('b:b:x:gate', 'basic', [log('l3', 1, 5, { subjectId: 'b' })], { parentSubjectId: 'b', subjectId: 'b' }), group('gate-retry:a', 'basic', [log('l4', 1, 2)], { isGateRetry: true })];
  const merged = mergeQueueReviewGroups(basics, basics.flatMap(item => item.logs), subjectsForMerge);
  assert.deepEqual(merged.map(item => item.id), ['a:basic:all', 'b:b:x:gate', 'gate-retry:a'], 'the same subject appears once in basic review; other subjects and retries are untouched');
  assert.deepEqual(merged[0].logs.map(item => item.id), ['l1', 'l2'], 'the merged basic review holds every due basic log of the subject');
  assert.equal(merged[0].earliestReviewTime, 90);
  assert.equal(merged[0].rangeGroups, undefined, 'basic reviews have no range tabs');
  // 복습과목: 범위로만 나뉜 복습은 한 칸이고 원래 범위 묶음은 rangeGroups에 남는다. 기본 복습과는 합치지 않는다.
  const ranged = [group('a:r:s:subjects:range-0', 'subject', [log('l5', 1, 10)]), group('a:r:s:subjects:range-1', 'subject', [log('l6', 31, 40)]), group('a:a:x:gate', 'basic', [log('l7', 11, 20)])];
  const rangedMerged = mergeQueueReviewGroups(ranged, ranged.flatMap(item => item.logs), subjectsForMerge);
  assert.deepEqual(rangedMerged.map(item => [item.id, item.reviewType]), [['a:r:s:subjects:all', 'subject'], ['a:a:x:gate', 'basic']], 'a review subject and the basic review stay separate cells');
  assert.deepEqual(rangedMerged[0].rangeGroups.map(item => item.id), ['a:r:s:subjects:range-0', 'a:r:s:subjects:range-1']);
  assert.deepEqual(rangedMerged[0].logs.map(item => item.id), ['l5', 'l6']);
  const otherSubject = mergeQueueReviewGroups([ranged[0], group('a:r2:s:subjects:range-0', 'subject', [log('l8', 1, 3)], { subjectId: 'r2' })], [], subjectsForMerge);
  assert.equal(otherSubject.length, 2, 'different review subjects stay apart');
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('mergeQueueReviewGroups(dueReviewGroups, logs, subjects)') && logger.includes('startReviewGroup(selectedRunQueueItem.reviewGroup)'), 'the queue uses the merged groups and the start button starts the whole cell');
  const summary = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(summary.includes('<MemberChooser members={idle.memberChoices}') && summary.indexOf('<MemberChooser') < summary.indexOf('<GrowthCell efficiency={detailData.efficiency}'), 'the tabs sit above the metrics of the detail panel');
});


test('one cell per subject: basic review comes first, the subject (study / review subject) is later and shown as one line', () => {
  const { runQueueCellId, getRunQueueCellLead } = loadSource('components/SessionLogger.tsx');
  const study = id => ({ kind: 'study', key: `study-${id}`, studyItem: { subject: { id } }, isRequired: false, estimatedMinutes: 20, name: id });
  const review = (key, type, parent, subject) => ({ kind: 'review', key, reviewGroup: { reviewType: type, parentSubjectId: parent, subjectId: subject }, isRequired: false, estimatedMinutes: 25, name: subject });
  const items = [review('review-r:all', 'subject', 'x', 'r'), study('x'), review('review-x:basic', 'basic', 'x', 'x'), review('review-r:basic', 'basic', 'r', 'r'), study('y')];
  assert.deepEqual(items.map(runQueueCellId), ['r', 'x', 'x', 'r', 'y'], 'a general subject: study + its basic review; a review subject: its review + its basic review');
  assert.equal(getRunQueueCellLead(items, items[1]).key, 'review-x:basic', 'the basic review comes before the study');
  assert.equal(getRunQueueCellLead(items, items[0]).key, 'review-r:basic', 'a review subject does its basic review before its review');
  assert.equal(getRunQueueCellLead(items, items[4]).key, 'study-y', 'a lone study is its own lead');
  assert.equal(getRunQueueCellLead(items, undefined), undefined);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { LaterMembersStrip } = loadSource('components/TodayTasks.tsx');
  const html = renderToStaticMarkup(React.createElement(LaterMembersStrip, { members: [
    { key: 'study-x', kind: 'study', label: '학습', text: '오늘 권장 p.5~7 · 3P · 23분', state: 'pending' },
    { key: 'done-s', kind: 'study', label: '학습', text: '✓ 4P · 14분', state: 'done' }] }));
  assert.ok(html.includes('이어서') && html.includes('끝냄') && html.includes('오늘 권장 p.5~7 · 3P · 23분') && html.includes('data-testid="later-members"'));
  const summary = fs.readFileSync(path.resolve(__dirname, '../components/TodaySummary.tsx'), 'utf8');
  assert.ok(summary.includes('<LaterMembersStrip members={idle.laterMembers} />'), 'later members are one line of information in the detail panel');
});

// ───────────── 학습 설정: 속도 증가율 옆의 공부량(한 페이지에 쓴 시간의 변화, 분/P) ─────────────

test('study amount growth: the same two chunks as the speed growth, seen as minutes per page (opposite sign), per unit like the speed growth', () => {
  const { amountGrowthOfPoints, latestAmountGrowthOf, unitAmountGrowthOf, summarizeUnitAmount, sumOf, describeStudyAmountGrowth, unitGrowthOf, buildGroupSpeed } = loadSource('utils/speedGrowth.ts');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  // 속도 20 → 30 → 24 P/h = 장당 3 → 2 → 2.5분. 앞 두 덩어리는 월요일, 마지막은 화요일
  const make = rows => ({ points: rows.map(([dateKey, speed], index) => ({ index, hours: (index + 1) * 25 / 60, timestamp: `${dateKey}T03:00:00.000Z`, dateKey, speed, gain: speed - rows[0][1], growth: index > 0 ? speed - rows[index - 1][1] : null })),
    latestSpeed: rows[rows.length - 1][1], latestGrowth: rows.length > 1 ? rows[rows.length - 1][1] - rows[rows.length - 2][1] : null, acceleration: null });
  const a = make([['2026-10-05', 20], ['2026-10-05', 30], ['2026-10-06', 24]]);
  assert.deepEqual(amountGrowthOfPoints(a.points).map(value => (value === null ? null : Math.round(value * 1000) / 1000)), [null, -1, 0.5]);
  near(latestAmountGrowthOf(a), 0.5);
  near(unitAmountGrowthOf(a, 'day'), -0.25);       // 월요일 −1, 화요일 +0.5 → 날마다의 평균
  near(unitAmountGrowthOf(a, 'day', 1), -1);       // 월요일에 공부한 날만
  assert.equal(unitAmountGrowthOf(a, 'day', 3), null, 'no study on a Wednesday');
  near(unitAmountGrowthOf(a, 'week'), -0.5);       // 같은 주: −1 + 0.5
  near(unitAmountGrowthOf(a, 'all'), -0.5);        // 처음 3분 → 지금 2.5분
  // 속도 증가율과 늘 반대 방향이다(빨라지면 속도 +, 공부량 −)
  assert.ok(unitGrowthOf(a, 'all') > 0 && unitAmountGrowthOf(a, 'all') < 0);
  const one = make([['2026-10-05', 20]]);
  assert.equal(latestAmountGrowthOf(one), null, 'one chunk has nothing to compare with');
  assert.equal(unitAmountGrowthOf(one, 'all'), null);
  assert.equal(latestAmountGrowthOf({ points: [] }), null);
  // 과목들의 평균: 값이 있는 과목만
  const b = make([['2026-10-05', 20], ['2026-10-05', 40]]);          // 장당 3 → 1.5 = −1.5
  near(summarizeUnitAmount([a, b, { points: [] }], 'all'), -1);       // (−0.5 + −1.5) / 2
  assert.equal(summarizeUnitAmount([{ points: [] }], 'week'), null);
  // 합계: 값이 있는 것만 더한다
  near(sumOf([1, null, 2.5, undefined]), 3.5);
  assert.equal(sumOf([null]), null);
  // 묶음(폴더)의 값은 안에 든 과목들의 최근 값을 더한 것
  near(buildGroupSpeed({ id: 'f', name: '시험', isFolder: true }, [a, b]).latestAmountGrowth, 0.5 + -1.5);
  assert.equal(buildGroupSpeed({ id: 'e', name: '빈', isFolder: true }, []).latestAmountGrowth, null);
  // 글자
  assert.equal(describeStudyAmountGrowth(-0.44), '−0.4분/P');
  assert.equal(describeStudyAmountGrowth(0.5, '문제'), '+0.5분/문제');
  assert.equal(describeStudyAmountGrowth(null), '측정 필요');
});

test('every speed growth rate of the study settings has its study amount (공부량) right beside it', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const panels = loadSource('components/SpeedPanels.tsx');
  const { buildGroupSpeed } = loadSource('utils/speedGrowth.ts');
  const make = rows => ({ points: rows.map(([dateKey, speed], index) => ({ index, hours: (index + 1) * 25 / 60, timestamp: `${dateKey}T03:00:00.000Z`, dateKey, speed, gain: speed - rows[0][1], growth: index > 0 ? speed - rows[index - 1][1] : null })),
    latestSpeed: rows[rows.length - 1][1], latestGrowth: rows.length > 1 ? rows[rows.length - 1][1] - rows[rows.length - 2][1] : null, acceleration: null });
  const a = make([['2026-10-05', 20], ['2026-10-05', 30], ['2026-10-06', 24]]);

  // ① 과목 카드 · 과목 하나 값: 속도 증가율 칸 안에 공부량이 나란히
  const facts = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series: a }));
  assert.ok(facts.includes('data-testid="speed-growth"') && facts.includes('−6.0P/h') && facts.includes('data-testid="speed-growth-amount"') && facts.includes('공부량 +0.5분/P'));
  assert.ok(facts.indexOf('speed-growth"') < facts.indexOf('speed-growth-amount'), 'the amount comes right after the speed growth');
  const unitFacts = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series: a, growth: 2.5, amount: -0.4, growthName: '속도 증가율 · 하루 평균' }));
  assert.ok(unitFacts.includes('+2.5P/h') && unitFacts.includes('공부량 −0.4분/P'), 'a unit value is shown with the unit amount');
  const unmeasured = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series: make([['2026-10-05', 20]]), growth: null, amount: null }));
  assert.ok(unmeasured.includes('측정 필요') && !unmeasured.includes('speed-growth-amount'), 'no amount where there is no speed growth');
  const labelled = renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series: a, label: '문제' }));
  assert.ok(labelled.includes('공부량 +0.5분/문제'), 'the page word follows the subject');

  // ② 맨 위 요약
  const days = [1, 2, 3, 4, 5, 6, 0].map((id, index) => ({ weekday: id, label: '월화수목금토일'[index], minutes: 60, isToday: false }));
  const base = { onUnitChange() {}, onWeekdayChange() {}, unit: 'day', weekday: null, minutes: 60, days, shareItems: [{ id: 'a', name: '수학', minutes: 60 }] };
  const summary = renderToStaticMarkup(React.createElement(panels.PlanUnitSummary, { ...base, growth: { measured: 2, mean: 1.5, spread: 0.5 }, amount: -0.2 }));
  assert.ok(summary.includes('data-testid="plan-growth"') && summary.includes('+1.5P/h') && summary.includes('data-testid="plan-growth-amount"') && summary.includes('공부량 −0.2분/P'));
  assert.ok(summary.indexOf('plan-growth"') < summary.indexOf('plan-growth-amount') && summary.indexOf('plan-growth-amount') < summary.indexOf('plan-spread'), 'beside the growth, before the std dev');
  const noAmount = renderToStaticMarkup(React.createElement(panels.PlanUnitSummary, { ...base, growth: { measured: 0, mean: 0, spread: 0 } }));
  assert.ok(noAmount.includes('측정 필요') && !noAmount.includes('plan-growth-amount'));

  // ③ 폴더 목록: 항목마다 한 줄에 속도 증가율 · 공부량
  const x = make([['2026-10-05', 20], ['2026-10-05', 40]]);
  const group = { ...buildGroupSpeed({ id: 'm', name: '수학', isFolder: false }, [a]), colorIndex: 0 };
  const total = buildGroupSpeed({ id: 'f', name: '합계', isFolder: true }, [a, x]);
  const chart = renderToStaticMarkup(React.createElement(panels.FolderSpeedChart, { total, items: [group, { ...buildGroupSpeed({ id: 'n', name: '새 과목', isFolder: false }, []), colorIndex: 1 }] }));
  const rows = chart.split('data-testid="group-speed-row"').slice(1);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes('−6.0P/h') && rows[0].includes('data-testid="group-speed-amount"') && rows[0].includes('공부량 +0.5분/P'));
  assert.ok(rows[1].includes('측정 필요') && !rows[1].includes('group-speed-amount'), 'an unmeasured item has no amount either');

  // ④ Analytics가 모든 자리에 값을 넘긴다: 맨 위 요약 · 폴더 합계와 목록 · 과목 카드 · 과목 안 목록
  const source = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(source.includes('amount={summaryAmount}') && source.includes('summarizeUnitAmount('), 'top summary');
  assert.ok(source.includes('data-testid="folder-speed-total"') && source.includes('testId="folder-speed-amount"') && source.includes('latestAmountGrowth: sumOf(memberIds.map(unitAmountOfSubject))'), 'folder total and list rows');
  assert.ok(source.includes('amount={unitAmountOfSubject(sub.id)}'), 'subject card');
  assert.ok(source.includes('testId="subject-growth-amount"') && source.includes('unitAmountGrowthOf(series, planUnit, summaryWeekday)'), 'subject rows');
});

// ───────────── 플래시 카드: 줄글에서 키워드만 따 가로로 ─────────────

test('flash keywords are taken from the prose sentence, in the same order, for every kind of question', () => {
  const { flashOf } = loadSource('utils/questionFlash.ts');
  const memo = ':::toggle 자동차 :\n엔진:동력\n:::end\n읽기-정리-확인\n[a] b ; [c] d\nx:p,q,r\nm:n=o\nA:p:q:r:s:t';
  const questions = questionsFor(memo);
  const kinds = new Set();
  questions.forEach(question => {
    const labels = questionBuilder.getReviewQuestionClassification('개념:정의:예시', question);
    const prose = questionBuilder.getReviewQuestionSentence('개념:정의:예시', question);
    const card = flashOf(question, { prompt: labels.prompt, answer: labels.answer, conditions: labels.conditions });
    if (question.kind === 'recall' || question.convert) { assert.equal(card, null, `${question.kind}: no keyword row`); return; }
    kinds.add(question.kind);
    assert.ok(card && prose, `${question.kind} has both a sentence and keywords`);
    // 키워드는 줄글에 들어 있는 말이다(문장에서 따온 것)
    const sentence = prose.statement;
    card.place.forEach(chip => assert.ok(sentence.includes(chip.value), `place "${chip.value}" is in "${sentence}"`));
    if (card.given) assert.ok(sentence.includes(card.given.value), `given "${card.given.value}" is in "${sentence}"`);
    if (card.done) assert.ok(sentence.includes(card.done.value), `done "${card.done.value}" is in "${sentence}"`);
    // 맞힐 속성 이름은 줄글에서 "예시 값은?"으로 묻는 것과 같다
    if (card.ask.label.length > 0) assert.ok(sentence.includes(`${card.ask.label.join('·')} 값`), `ask "${card.ask.label}" is in "${sentence}"`);
    // 맞힐 값은 키워드 줄에 없다(정답은 가려진 칸 한 자리)
    const shown = JSON.stringify(card);
    if (card.chain === null && question.answer.length > 3 && !sentence.includes(question.answer)) assert.ok(!shown.includes(question.answer), 'the answer is not among the keywords');
  });
  assert.ok(['direct', 'reverse', 'remaining'].every(kind => kinds.has(kind)), `kinds seen: ${[...kinds]}`);
});

test('flash keywords: where the question sits, the given value, the linking word and the asked slot', () => {
  const { flashOf } = loadSource('utils/questionFlash.ts');
  const memo = ':::toggle 자동차 :\n엔진:동력\n:::end';
  const direct = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '엔진');
  const labels = questionBuilder.getReviewQuestionClassification('개념:정의:예시', direct);
  const card = flashOf(direct, { prompt: labels.prompt, answer: labels.answer, conditions: labels.conditions });
  assert.deepEqual(card.place.map(chip => [chip.role, chip.label, chip.value]), [['place', ['개념'], '자동차']]);
  assert.deepEqual(card.given, { label: ['정의'], value: '엔진' });
  assert.deepEqual(card.relation, { word: '이어지는', arrow: 'forward' });
  assert.deepEqual(card.ask, { label: ['예시'], mode: null });
  assert.equal(card.chain, null);
  // 거꾸로: 화살표가 맞힐 칸 쪽을 가리키지 않는다(맞힐 칸이 앞)
  const reverse = questionsFor('a:b').find(q => q.kind === 'reverse');
  assert.deepEqual(flashOf(reverse, undefined).relation, { word: '앞서 이어진', arrow: 'back' });
  // 여럿을 쓰는 문제는 쓰는 방법이 붙는다
  const remaining = questionsFor('a:b,c,d').find(q => q.kind === 'remaining' && q.answer === 'c AND d');
  const remainingCard = flashOf(remaining, undefined);
  assert.deepEqual([remainingCard.relation.word, remainingCard.ask.mode], ['필요한 것 중 남은', '모두']);
  assert.deepEqual(remainingCard.done, { label: [], value: 'b' }, 'the satisfied value is its own muted chip');
  assert.equal(flashOf(questionsFor('a:b,c,d').find(q => q.kind === 'remaining' && q.answer === 'd'), undefined).ask.mode, null, 'one value left: nothing to say about how many');
  const reconstruct = questionsFor('a:(b:c)').find(q => q.kind === 'reconstruct');
  assert.equal(flashOf(reconstruct, undefined).ask.mode, '순서대로');
  // 순서 문제
  const next = questionsFor('a--1-b').find(q => q.kind === 'order-next');
  assert.deepEqual(flashOf(next, undefined).relation, { word: '바로 다음', arrow: 'forward' });
  // 줄 안을 가린 문제는 줄 전체가 키워드이고 가린 자리만 칸이다
  const lineBlank = flashOf({ kind: 'blank', prompt: '＿ → B → C', answer: 'A', conditions: [], direction: 'forward' }, undefined);
  assert.deepEqual(lineBlank.chain, [{ type: 'blank', mark: '㉠', answer: 'A' }, { type: 'glue', glyph: '→' }, { type: 'text', value: 'B' }, { type: 'glue', glyph: '→' }, { type: 'text', value: 'C' }]);
  assert.equal(lineBlank.given, null);
  const twoBlanks = flashOf({ kind: 'blank', prompt: '＿ → ＿ → C', answer: 'A → B', conditions: [], direction: 'forward' }, undefined);
  assert.deepEqual(twoBlanks.chain.filter(piece => piece.type === 'blank').map(piece => [piece.mark, piece.answer]), [['㉠', 'A'], ['㉡', 'B']], 'each hidden place gets its own answer');
  assert.equal(twoBlanks.ask.mode, '차례로');
  // 덩어리 칸 빈칸(`A:p=q=r`): 주어진 칸 → 관계 → 줄(가린 자리만 칸)
  const cell = questionsFor('A:p=q=r').find(q => q.kind === 'blank' && q.cell);
  const cellCard = flashOf(cell, undefined);
  assert.deepEqual(cellCard.given, { label: [], value: 'A' });
  assert.deepEqual(cellCard.relation, { word: '관계', arrow: 'equal' });
  assert.ok(cellCard.chain.some(piece => piece.type === 'blank' && piece.answer) && cellCard.chain.some(piece => piece.type === 'glue' && piece.glyph === '＝'));
});

test('flash card renders one row of keywords; the asked slot is "?" until the answer is shown and then holds the answer in the same place', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = ':::toggle 자동차 :\n엔진:동력\n:::end';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '엔진');
  const render = (style, revealed) => inStyle(style, () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question, criterion: '개념:정의:예시', revealed })));
  const hidden = render('flash', false);
  const shown = render('flash', true);
  // 한 줄(가로): 자리 › 주어진 값 → 맞힐 칸
  assert.equal((hidden.match(/data-flash-row="true"/g) || []).length, 1);
  assert.match(hidden, /data-flash-row="true"[^>]*>[\s\S]*data-flash-condition="true"[\s\S]*자동차[\s\S]*data-question-field="prompt"[\s\S]*엔진[\s\S]*data-flash-relation="forward"[\s\S]*이어지는[\s\S]*data-flash-ask="true"[\s\S]*맞힐 것 · 예시[\s\S]*data-flash-slot="true"/);
  assert.ok(/flex-wrap/.test(hidden.slice(hidden.indexOf('data-flash-row'))), 'the row wraps on a narrow screen');
  assert.ok(hidden.includes('가려진 정답') && !hidden.includes('동력') && !hidden.includes('data-flash-answer'));
  // 정답을 확인하면 같은 칸이 정답으로
  assert.ok(shown.includes('data-flash-answer="true"') && shown.includes('동력') && !shown.includes('data-flash-slot'));
  assert.match(shown, /data-question-field="answer"[^>]*>[\s\S]*data-flash-ask="true"[\s\S]*data-flash-answer="true"/, 'the answer takes the slot under the same asked label');
  // 줄글은 그대로(문장 하나, 키워드 줄 없음)
  const prose = render('prose', false);
  assert.ok(!prose.includes('data-flash-row') && plainText(prose).includes('개념 ‘자동차’에서 정의 ‘엔진’에 이어지는 예시 값은?'));
  // 여럿을 쓰는 문제: 쓰는 방법 한 줄
  const many = questionsFor('a:b,c,d').find(q => q.kind === 'remaining' && q.answer === 'c AND d');
  const manyHtml = inStyle('flash', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo: 'a:b,c,d', question: many, criterion: null, revealed: false })));
  assert.ok(manyHtml.includes('data-flash-mode="true"') && manyHtml.includes('모두 쓰기'));
  // 줄 안을 가린 문제: 줄이 키워드로 늘어서고 가린 자리만 칸이며, 확인하면 그 자리가 채워진다
  const blank = questionsFor('A:p=q=r').find(q => q.kind === 'blank' && q.statement && q.statement.includes(' = '));
  const blankShow = revealed => inStyle('flash', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo: 'A:p=q=r', question: blank, criterion: null, revealed })));
  assert.ok(blankShow(false).includes('data-flash-chain="true"') && blankShow(false).includes('data-flash-blank="true"'));
  assert.ok(blankShow(true).includes('data-flash-answer="true"') && !blankShow(true).includes('data-flash-slot'));
  // 노트 회상은 키워드 줄이 없다(예전 카드)
  const recall = questionsFor('기호가 없는 정리 내용')[0];
  const recallHtml = inStyle('flash', () => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo: '기호가 없는 정리 내용', question: recall, criterion: '대상:설명', revealed: false })));
  assert.ok(!recallHtml.includes('data-flash-row'));
});

test('chapters: 1~10, 20~30 are parsed and counting, end page and the next-chapter hint skip the gap between chapters', () => {
  const chapterLib = loadSource('utils/subjectChapters.ts');
  const parsed = chapterLib.parseChapterText('1~10, 20~30');
  assert.deepEqual(parsed.chapters, [{ startPage: 1, endPage: 10 }, { startPage: 20, endPage: 30 }]);
  assert.equal(parsed.error, null);
  assert.deepEqual(chapterLib.parseChapterText('').chapters, []);
  assert.equal(chapterLib.parseChapterText('').error, null);
  assert.deepEqual(chapterLib.parseChapterText('p.5-9, 40').chapters, [{ startPage: 5, endPage: 9 }, { startPage: 40, endPage: 40 }]);
  assert.ok(chapterLib.parseChapterText('1~10, 5~12').error.includes('겹쳐'));
  assert.ok(chapterLib.parseChapterText('abc').error);
  assert.ok(chapterLib.parseChapterText('10~1').error);
  const chapters = parsed.chapters;
  // 8, 9, 10, 20 → 끝 페이지 20 · 푼 장수 4
  assert.equal(chapterLib.endPageForSolved(chapters, 8, 4), 20);
  assert.equal(chapterLib.endPageForSolved(chapters, 8, 3), 10);
  assert.equal(chapterLib.pagesBetween(chapters, 8, 20), 4);
  assert.equal(chapterLib.pagesBetween(chapters, 8, 10), 3);
  assert.equal(chapterLib.positionAfterSolved(chapters, 8, 3), 20);
  assert.equal(chapterLib.formatChapters(chapters), '1~10, 20~30');
  // 측정 중 진행 칸: 이번 뽀모도로 끝 페이지가 지금 단원 끝을 넘을 때만 두 칸(지금 하는 곳 / 다음 단원)으로 나뉜다
  // 9쪽부터 12장 → 끝 페이지 29: 9/10 · 다음 단원 20/29
  assert.deepEqual(chapterLib.splitByChapter(chapters, 9, 29), {
    chapter: { number: 1, startPage: 1, endPage: 10 }, current: { page: 9, end: 10 }, next: { number: 2, page: 20, end: 29 } });
  // 단원 안에서 끝나면 한 칸: 9/10 (딱 단원 끝에서 끝나는 경우도 한 칸)
  assert.deepEqual(chapterLib.splitByChapter(chapters, 9, 10), { chapter: { number: 1, startPage: 1, endPage: 10 }, current: { page: 9, end: 10 }, next: null });
  // 다음 단원으로 넘어온 뒤에는 20/29 한 칸
  assert.deepEqual(chapterLib.splitByChapter(chapters, 20, 29), { chapter: { number: 2, startPage: 20, endPage: 30 }, current: { page: 20, end: 29 }, next: null });
  // 마지막 단원이거나 그 단원 안에서 끝나면 다음 단원 칸이 없다
  assert.equal(chapterLib.splitByChapter(chapters, 25, 30).next, null);
  // 다음 단원이 짧으면 그 단원 끝까지만(세 단원에 걸쳐도 바로 다음 단원만 보인다)
  const three = [...chapters, { startPage: 40, endPage: 45 }];
  assert.deepEqual(chapterLib.splitByChapter(three, 29, 44).next, { number: 3, page: 40, end: 44 });
  assert.deepEqual(chapterLib.splitByChapter(three, 9, 44).next, { number: 2, page: 20, end: 30 });
  assert.equal(chapterLib.splitByChapter([], 9, 29), null);
});

test('chapters: progress follows the current chapter and starts over when the next chapter begins', () => {
  const base = { id: 's', name: 'S', startPage: 1, totalPages: 30, completedPages: 0, targetDate: '2099-01-01',
    chapters: [{ startPage: 1, endPage: 10 }, { startPage: 20, endPage: 30 }] };
  const stageAt = completedPages => schedule.getSubjectStages({ ...base, completedPages })[0];
  let stage = stageAt(4);
  assert.deepEqual([stage.chapter.number, stage.chapter.total, stage.chapter.pageCount, stage.chapter.completedCount, stage.currentPage], [1, 2, 10, 4, 5]);
  assert.equal(stage.pageCount, 21);
  assert.equal(stage.completedCount, 4);
  // 단원 끝까지 풀면 바로 다음 단원: 진척도 0, 다음 시작은 20
  stage = stageAt(10);
  assert.deepEqual([stage.chapter.number, stage.chapter.startPage, stage.chapter.endPage, stage.chapter.completedCount, stage.currentPage], [2, 20, 30, 0, 20]);
  assert.equal(stage.completedCount, 10);
  assert.equal(stage.remainingPages, 11);
  stage = stageAt(25);
  assert.deepEqual([stage.chapter.number, stage.chapter.completedCount, stage.currentPage, stage.remainingPages], [2, 6, 26, 5]);
  // 단원이 없는 과목은 예전 그대로
  const plain = schedule.getSubjectStages({ ...base, chapters: undefined, completedPages: 4 })[0];
  assert.equal(plain.chapter, null);
  assert.deepEqual([plain.currentPage, plain.remainingPages, plain.pageCount], [5, 26, 30]);
});

test('chapters: a measurement ends on a chapter page and carries the solved pages without the gap', () => {
  const measurement = loadSource('utils/measurement.ts');
  const chapters = [{ startPage: 1, endPage: 10 }, { startPage: 20, endPage: 30 }];
  assert.deepEqual(measurement.createPageMeasurement(8, 20, 4, 14, chapters),
    { startPage: 8, endPage: 20, pagesRead: 4, pageCountIsExplicit: true, progressPages: 4 });
  assert.equal(measurement.createPageMeasurement(8, 15, 4, 14, chapters), null, 'a page between chapters cannot be an end page');
  assert.equal(measurement.createPageMeasurement(8, 31, 4, 14, chapters), null);
  assert.equal(measurement.createPageMeasurement(8, 30, 4, 3, chapters), null, 'more than the pages left is refused');
  // 푼 장수를 직접 고쳐도 진척도 장수는 범위에서 센다
  assert.equal(measurement.createPageMeasurement(8, 20, 3, 14, chapters).progressPages, 4);
  // 단원이 없으면 예전 그대로
  assert.equal(measurement.createPageMeasurement(13, 17, 3, 88).progressPages, undefined);
  const log = { ...measurement.createPageMeasurement(8, 20, 4, 14, chapters), id: 'l', subjectId: 's', timeSpentMinutes: 10, timestamp: '2026-01-01T00:00:00.000Z' };
  assert.equal(measurement.getLogProgressPages(log), 4);
  const subject = { id: 's', name: 'S', startPage: 1, totalPages: 30, completedPages: 7, targetDate: '2099-01-01', chapters };
  // 8~10(3장) + 20~30(11장)
  assert.equal(measurement.getMeasurementRemainingPages(subject), 14);
  const stage = schedule.getActiveSubjectStage(subject);
  assert.equal(schedule.getRecommendedEndPage(subject, stage, 8, 4), 20);
  assert.equal(schedule.getRecommendedEndPage({ ...subject, chapters: undefined }, stage, 8, 4), 11);
});

test('chapters: a subject is created with its chapters (start and end follow the first and last chapter) and keeps them when loaded', () => {
  const { createNewStudyPlan } = loadSource('components/SubjectPlanner.tsx');
  const chapters = [{ startPage: 3, endPage: 10 }, { startPage: 20, endPage: 30 }];
  const made = createNewStudyPlan('S', 1, 100, '2099-01-01', false, [1, 2, 3], 10, '문제', chapters);
  assert.deepEqual([made.startPage, made.totalPages, made.completedPages], [3, 30, 2]);
  assert.deepEqual(made.chapters, chapters);
  const plain = createNewStudyPlan('S', 1, 100, '2099-01-01', false, [1, 2, 3], 10, '문제');
  assert.ok(!('chapters' in plain));
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'App.tsx'), 'utf8');
  assert.ok(source.includes('normalizeChapters(subject.chapters)') && source.includes('chapters: savedChapters'));
});

test('chapters: the measuring progress box splits into the current place and the next chapter only when this pomodoro can cross into it', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'components/SessionLogger.tsx'), 'utf8');
  assert.ok(source.includes('splitByChapter(stageChapters, progressCurrentPages, progressTargetPages)'));
  assert.match(source, /data-testid="next-chapter-start"[\s\S]{0,200}다음 단원 \{progressSplit\.next\.number\}/);
  assert.ok(source.includes('formatPageNumber(progressSplit.current.page)} / ${formatPageNumber(progressSplit.current.end)}'));
  assert.ok(source.includes('createPageMeasurement(sPage, endPage, Number(solvedPageCount), remainingSubjectPages, stageChapters)'));
  assert.ok(source.includes('pagesBetween(stageChapters, Number(startPage), Number(value))'));
});

test('toggle keys: Backspace at the start of a toggle\'s first block climbs to the toggle title instead of getting stuck, and the lone empty block stays', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'components/ReviewMemoEditor.tsx'), 'utf8');
  // 안쪽 편집기는 맨 앞 칸 앞으로 백스페이스가 나가면 바깥 토글 제목 끝으로 커서를 올려 보낸다
  assert.ok(source.includes('onBack={() => caretToEnd(fields.current.get(`${block.id}:title`))}'));
  assert.ok(source.includes("event.key === 'Backspace' && !event.shiftKey && caret === 0 && selectionEnd === 0 && stepBackFrom(index)"));
  const body = source.slice(source.indexOf('const stepBackFrom'), source.indexOf('const exitToggle'));
  // 글이 있으면 지우지 않고 커서만 · 빈 칸이 하나뿐이면 지우지 않고 · 빈 칸이 더 있으면 그 칸만 지운다
  assert.ok(body.includes('if (block.text) return reach();'));
  assert.ok(body.includes('if (blocks.length <= 1) return reach();'));
  assert.ok(body.includes('commit(blocks.filter((_, blockIndex) => blockIndex !== index));'));
  // 앞이 열린 토글이면 그 안 마지막 칸 끝으로
  assert.ok(source.includes("querySelectorAll('textarea')") && source.includes('.pop()'));
});

test('toggle keys: the > symbol on a toggle title makes a new toggle inside it, as its first child, and opens it if folded', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'components/ReviewMemoEditor.tsx'), 'utf8');
  const body = source.slice(source.indexOf("if (symbol === '>')"), source.indexOf('const pair = symbol'));
  assert.ok(body.includes("if (block.type === 'text') { convertLine(index, start); return; }"));
  assert.ok(body.includes("serializeReviewMemoBlocks([{ type: 'toggle', title: '', text: '' }])"));
  assert.ok(body.includes('setClosed(prev => { const next = new Set(prev); next.delete(block.id); return next; });'));
  assert.ok(body.includes('`${inner}\\n${block.text}`'));
  // 새 토글 문서가 그대로 읽힌다: 제목은 비고 맨 앞에 온다
  const parsed = reviewMemo.parseReviewMemoBlocks(`${reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '', text: '' }])}\nx`);
  assert.deepEqual(parsed.map(item => [item.type, item.title ?? item.text]), [['toggle', ''], ['text', 'x']]);
});

test('speed graph x axis: each 25 minutes carries the page position where it ended; without a page range it falls back to pages solved so far', () => {
  const { buildSpeedSeries, buildGroupSpeed } = loadSource('utils/speedGrowth.ts');
  const panels = loadSource('components/SpeedPanels.tsx');
  const at = (minute, extra) => ({ id: `p${minute}`, subjectId: 'm', timeSpentMinutes: 25, timeAttackMinutes: 25, reviewEnabled: false,
    timestamp: new Date(Date.UTC(2026, 9, 1, 3, minute, 0)).toISOString(), ...extra });
  // 한 기록(50분, p.11~30, 20장)이 25분 둘에 걸친다: 25분이 끝날 때 p.20, 50분이 끝날 때 p.30. 장수의 합은 10, 20
  const one = buildSpeedSeries([{ ...at(0), timeSpentMinutes: 50, pagesRead: 20, startPage: 11, endPage: 30 }]);
  assert.deepEqual(one.points.map(point => point.page), [20, 30]);
  assert.deepEqual(one.points.map(point => Math.round(point.pagesDone * 1000) / 1000), [10, 20]);
  // 기록 둘: 앞 기록 끝 페이지에서 다음 기록 시작 페이지로 이어진다(건너뛴 페이지가 있어도 위치는 기록의 페이지를 따른다)
  const two = buildSpeedSeries([
    { ...at(0), pagesRead: 5, startPage: 1, endPage: 5 },
    { ...at(30), pagesRead: 5, startPage: 41, endPage: 45 }]);
  assert.deepEqual(two.points.map(point => point.page), [5, 45]);
  // 페이지 범위가 없는 기록이 하나라도 있으면 그 점은 위치가 없다(null) → 그래프는 푼 장수의 합을 가로로 쓴다
  const mixed = buildSpeedSeries([{ ...at(0), pagesRead: 5, startPage: 1, endPage: 5 }, { ...at(30), pagesRead: 6 }]);
  assert.deepEqual(mixed.points.map(point => point.page), [5, null]);
  assert.equal(panels.speedAxisOf(mixed.points).position, false);
  assert.deepEqual(panels.speedAxisOf(mixed.points).values, [5, 11]);
  assert.equal(panels.speedAxisOf(two.points).position, true);
  assert.deepEqual(panels.speedAxisOf(two.points).ticks, [5, 25, 45]);
  // 위치가 한 곳뿐이면 눈금 하나, 페이지 이름은 과목이 정한 글자를 따른다
  assert.deepEqual(panels.speedAxisOf([{ page: 7 }, { page: 7 }]).ticks, [7]);
  assert.equal(panels.formatSpeedAxisValue(31, true, 'P'), 'p.31');
  assert.equal(panels.formatSpeedAxisValue(31, true, 'n'), 'n.31');
  assert.equal(panels.formatSpeedAxisValue(12.5, false, 'P'), '12.5P');
  // 속도·가속도는 가로축과 상관없이 그대로(시간 기준)
  const plain = buildSpeedSeries([4, 5, 6, 7, 8].map((pages, index) => at(index * 25, { id: `s${index}`, pagesRead: pages })));
  const placedSame = buildSpeedSeries([4, 5, 6, 7, 8].map((pages, index) => at(index * 25, { id: `s${index}`, pagesRead: pages, startPage: 100 - index * 9, endPage: 100 - index * 9 + pages - 1 })));
  assert.deepEqual(placedSame.points.map(point => [point.speed, point.gain]), plain.points.map(point => [point.speed, point.gain]));
  assert.equal(placedSame.acceleration, plain.acceleration);
  // 폴더: 과목 하나뿐이면 위치를 그대로, 여러 과목이 섞이면 위치 대신 푼 장수의 합
  const single = buildGroupSpeed({ id: 'a', name: 'a', isFolder: false }, [two]);
  assert.deepEqual(single.points.map(point => point.page), [5, 45]);
  const mixedFolder = buildGroupSpeed({ id: 'f', name: 'f', isFolder: true }, [two, one]);
  assert.ok(mixedFolder.points.every(point => point.page === null), 'different books share no page axis');
  assert.deepEqual(mixedFolder.points.map(point => Math.round(point.pagesDone * 1000) / 1000), [...mixedFolder.points.map(point => point.pagesDone)].sort((a, b) => a - b).map(value => Math.round(value * 1000) / 1000), 'pages solved only grow');
  assert.ok(Math.abs(mixedFolder.points[mixedFolder.points.length - 1].pagesDone - (two.points[1].pagesDone + one.points[1].pagesDone)) < 1e-9);
  // 앞 페이지로 되돌아가면(같은 곳을 다시 풀 때) 선을 새 구간으로 끊는다. 푼 장수의 합은 한 구간
  assert.deepEqual(panels.speedRunsOf([1, 5, 9, 3, 7, 2], true), [[0, 1, 2], [3, 4], [5]]);
  assert.deepEqual(panels.speedRunsOf([1, 5, 9, 3], false), [[0, 1, 2, 3]]);
  assert.deepEqual(panels.speedRunsOf([4, 4, 4], true), [[0, 1, 2]], 'staying on the same page is not going back');
  const back = buildSpeedSeries([
    { ...at(0), pagesRead: 5, startPage: 1, endPage: 5 }, { ...at(30), pagesRead: 5, startPage: 6, endPage: 10 },
    { ...at(60), pagesRead: 5, startPage: 1, endPage: 5 }, { ...at(90), pagesRead: 5, startPage: 6, endPage: 10 }]);
  const backChart = require('react-dom/server').renderToStaticMarkup(require('react').createElement(panels.SpeedGainChart, { series: back }));
  // 같은 쪽을 다시 풀어 위치가 앞으로 되돌아가면 위치 대신 늘 앞으로만 가는 "푼 장수의 합"을 가로축으로 쓴다(한 줄, 한 위치에 한 값)
  assert.equal((backChart.match(/data-testid="speed-trend"/g) || []).length, 1, 'one line on the pages-solved axis');
  assert.equal(panels.speedAxisOf([{ page: 5, pagesDone: 5 }, { page: 2, pagesDone: 8 }]).position, false);
  assert.equal(panels.speedAxisOf([{ page: 5, pagesDone: 5 }, { page: 9, pagesDone: 9 }]).position, true);
  // 설정 쪽 소스: 그래프 가로에 공부 시간을 쓰지 않는다
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'components/SpeedPanels.tsx'), 'utf8');
  assert.ok(!source.includes('x(point.hours)') && !source.includes('시간</text>') && !source.includes('시간째'));
});

test('page acceleration: speed gained per page solved (average increase slope), separate from the time-based acceleration the trend analysis keeps', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { buildSpeedSeries, averageGainPerPage, formatSignedHundredth, describePageAcceleration, describeAcceleration } = loadSource('utils/speedGrowth.ts');
  const panels = loadSource('components/SpeedPanels.tsx');
  // 25분마다 4·5·6·7·8장: 속도 9.6 → 19.2 P/h(+9.6), 첫 25분 뒤에 푼 장수 5+6+7+8 = 26 → 9.6/26 P/h per P
  const series = buildSpeedSeries(speedLogs([4, 5, 6, 7, 8]));
  assert.ok(Math.abs(series.pageAcceleration - 9.6 / 26) < 1e-9);
  assert.ok(Math.abs(series.acceleration - 5.76) < 1e-9, '시간 기준 가속도(추이 분석)는 그대로');
  // 평균 증가량 = (25분마다 늘어난 속도의 평균) ÷ (25분마다 푼 장수의 평균)
  const growths = series.points.slice(1).map(point => point.growth);
  const pagesEach = series.points.slice(1).map((point, index) => point.pagesDone - series.points[index].pagesDone);
  assert.ok(Math.abs(growths.reduce((a, b) => a + b, 0) / growths.length / (pagesEach.reduce((a, b) => a + b, 0) / pagesEach.length) - series.pageAcceleration) < 1e-9);
  // 덩어리가 셋보다 적거나 푼 장수가 0이면 null
  assert.equal(buildSpeedSeries(speedLogs([4, 5])).pageAcceleration, null);
  assert.equal(averageGainPerPage([{ gain: 0, pagesDone: 3 }, { gain: 2, pagesDone: 3 }]), null);
  assert.equal(averageGainPerPage([{ gain: 0, pagesDone: 3 }]), null);
  assert.ok(Math.abs(averageGainPerPage([{ gain: 0, pagesDone: 4 }, { gain: -3, pagesDone: 10 }]) + 0.5) < 1e-12, 'slowing down is negative');
  assert.equal(formatSignedHundredth(0.3692), '+0.37');
  assert.equal(formatSignedHundredth(-0.004), '0.00');
  assert.equal(formatSignedHundredth(-1.256), '−1.26');
  assert.equal(describePageAcceleration(0.1), '+0.10P/h/P');
  assert.equal(describePageAcceleration(0.1, 'n'), '+0.10n/h/n');
  assert.equal(describePageAcceleration(null), '측정 필요');
  assert.equal(describeAcceleration(1.14), '+1.1P/h²', '추이 분석의 시간 기준 글자는 그대로');
  // 예측: 남은 페이지 범위의 장수가 많을수록 속도가 더 올라 있다. 같은 속도·같은 장수라면 가속도가 클수록 빨리 끝난다
  const { projectStudyMinutes } = loadSource('utils/speedGrowth.ts');
  assert.ok(projectStudyMinutes(40, 19.2, series.pageAcceleration) < projectStudyMinutes(40, 19.2, 0));
  // 그래프: 추세선은 첫 점과 마지막 점을 지난다(평균 증가량 기울기)
  const chart = renderToStaticMarkup(React.createElement(panels.SpeedGainChart, { series }));
  const trend = /data-testid="speed-trend" points="([^"]+)"/.exec(chart);
  const dots = [...chart.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="(?:4|5\.5)"/g)].map(match => [Number(match[1]), Number(match[2])]);
  const ends = trend && [trend[1].split(' ')[0], trend[1].split(' ').pop()].map(pair => pair.split(',').map(Number));
  const close = (a, b) => Math.abs(a[0] - b[0]) < 0.06 && Math.abs(a[1] - b[1]) < 0.06;
  assert.ok(ends && dots.length === 5 && close(ends[0], dots[0]) && close(ends[1], dots[dots.length - 1]), 'the trend line runs from the first dot to the last dot');
  assert.ok(!/학습시간 가속도/.test(renderToStaticMarkup(React.createElement(panels.SpeedFacts, { series }))));
});

test('복습에 넣기: 난도는 저장할 때가 아니라 복습에 넣을 때 한 번 고르고, 단위가 없는 과목도 똑같이 대기한다', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const fb = loadSource('utils/subjectFeedback.ts');
  const review = loadSource('utils/review.ts');
  const fsrs = loadSource('utils/fsrs.ts');
  const t0 = Date.parse('2026-10-21T10:00:00.000Z');
  const log = (id, extra = {}) => ({ id, subjectId: 'S', pagesRead: 10, timeSpentMinutes: 30, startPage: 1, endPage: 10, timestamp: new Date(t0 - 3600000).toISOString(), reviewEnabled: true, isReviewed: false, reviewStep: 0, ...extra });
  const waiting = (id, extra = {}) => log(id, { unitReviewPending: true, reviewEnabled: false, isCondensed: true, ...extra });
  const subject = { id: 'S', name: 'S', startPage: 1, totalPages: 100, completedPages: 0, targetDate: '2027-01-01' };
  // 저장: 단위가 없어도 대기, 난도는 아직 없다
  const saved = review.applyUnitReviewRegistration(subject, [], log('a'), t0).incoming;
  assert.equal(saved.unitReviewPending, true);
  assert.equal(saved.reviewFsrs, undefined);
  assert.equal(saved.feedbackGrade, undefined);
  // 난도 창의 바탕: 대기 기록 묶음의 속도(장수 합 ÷ 시간 합), 평균은 대기 기록을 뺀 지난 기록
  const past = [1, 2, 3].map(index => log(`h${index}`, { timestamp: new Date(t0 - index * 86400000).toISOString(), feedbackGrade: 'good' }));
  const logs = [...past, waiting('w1'), waiting('w2', { pagesRead: 20, timeSpentMinutes: 30 })];
  const info = fb.pendingFeedbackOf(logs, 'S', t0);
  assert.deepEqual(info.pending.map(item => item.id), ['w1', 'w2']);
  assert.equal(info.pages, 30); assert.equal(info.minutes, 60);
  assert.ok(Math.abs(info.speed - 30) < 1e-9, '30장 ÷ 1시간');
  assert.ok(Math.abs(info.summary.averageSpeed - 20) < 1e-9, '지난 기록 3개(10장 ÷ 30분 = 20 P/h)의 평균, 대기 기록은 빼고');
  assert.equal(info.recommended, 'easy', '평균보다 충분히 빠르면 쉬움을 권한다');
  assert.equal(info.summary.byGrade[0].grade, 'good');
  assert.deepEqual(['again', 'hard', 'good', 'easy'].map(grade => info.intervals[grade]), ['again', 'hard', 'good', 'easy'].map(grade => fsrs.fsrsIntervalMs(fb.gradeSubjectCard(waiting('x'), grade, t0))));
  assert.deepEqual(fb.pendingFeedbackOf([waiting('o', { subjectId: 'other' })], 'S', t0).pending, [], 'another subject is not included');
  // 난도를 고르면 대기 기록 모두에 그 난도가 매겨지고 한꺼번에 등록된다(다른 과목 · 이미 등록된 기록은 그대로)
  const done = log('d', { nextReviewDate: '2026-10-22T00:00:00.000Z', reviewStep: 2 });
  const other = waiting('o', { subjectId: 'other' });
  const graded = fb.gradePendingReviews([...logs, done, other], 'S', 'hard', t0);
  ['w1', 'w2'].forEach(id => { const item = graded.find(entry => entry.id === id); assert.equal(item.feedbackGrade, 'hard'); assert.deepEqual(item.reviewFsrs, fb.gradeSubjectCard(waiting('x'), 'hard', t0)); });
  assert.equal(graded.find(entry => entry.id === 'd').feedbackGrade, undefined); assert.equal(graded.find(entry => entry.id === 'o').feedbackGrade, undefined);
  const registered = review.registerPendingReviews('S', graded, t0).logs;
  const hardDue = t0 + fsrs.fsrsIntervalMs(fb.gradeSubjectCard(waiting('x'), 'hard', t0));
  ['w1', 'w2'].forEach(id => { const item = registered.find(entry => entry.id === id); assert.equal(item.unitReviewPending, undefined); assert.equal(item.reviewEnabled, true); assert.equal(Date.parse(item.nextReviewDate), hardDue); });
  const easyDue = t0 + fsrs.fsrsIntervalMs(fb.gradeSubjectCard(waiting('x'), 'easy', t0));
  assert.ok(easyDue > hardDue, 'the easier the grade, the later the first review');
  assert.equal(registered.find(entry => entry.id === 'o').unitReviewPending, true);
  assert.equal(registered.find(entry => entry.id === 'd').nextReviewDate, '2026-10-22T00:00:00.000Z');
  // 난도 창: 네 등급과 간격, 누르면 그 등급으로 등록
  const { RegisterReviewDialog } = loadSource('components/RegisterReviewDialog.tsx');
  const html = renderToStaticMarkup(React.createElement(RegisterReviewDialog, { info, pageLabel: 'P', onChoose() {}, onClose() {} }));
  assert.ok(html.includes('role="dialog"') && html.includes('난도 피드백') && html.includes('이번 속도') && html.includes('30.0P/h') && html.includes('평균 속도 20.0P/h'));
  ['again', 'hard', 'good', 'easy'].forEach(grade => assert.ok(html.includes(`data-feedback-grade="${grade}"`)));
  assert.ok(/data-feedback-grade="easy" data-recommended="true"/.test(html) && html.includes('추천') && (html.match(/다음 복습 /g) || []).length === 4);
  // 저장 화면: 공부 세션에는 난도 피드백이 없고(복습 실행에서만 나온다), 공부 기록에 난도를 매기지 않는다
  const logger = fs.readFileSync(path.resolve(__dirname, '..', 'components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('{feedbackInfo && activeReviewRun && (() => {'), 'the grade picker stays only on the review-run end screen');
  assert.ok(logger.includes('const nextLog: StudyLog = activeReviewRun ? { ...created, feedbackGrade: chosenFeedbackGrade() } : created;') && !logger.includes('reviewFsrs: gradeSubjectCard(created, grade, Date.now())'));
});

test('같은 문제(글 · 정답 · 조건이 모두 같음)가 한 과목의 여러 노트에 있으면 복습 주기가 가장 짧은 하나만 복습에 남는다', () => {
  const dup = loadSource('utils/reviewDuplicates.ts');
  const t0 = Date.parse('2026-10-24T00:00:00.000Z');
  const keyOf = (memo, prompt, answer) => questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === prompt && q.answer === answer).key;
  const memoA = '가:나\n다:라';
  const memoB = '가:나\n마:바';
  const longKey = keyOf(memoA, '가', '나');
  const logA = { id: 'a', subjectId: 'S', reviewMemo: memoA, reviewEnabled: true, reviewQuestionFormat: 2, reviewStep: 3, nextReviewDate: new Date(t0 + 3 * day).toISOString(),
    reviewQuestionSchedules: { [longKey]: { reviewStep: 3, nextReviewDate: new Date(t0 + 3 * day).toISOString(), intervalMs: 3 * day } } };
  const logB = { id: 'b', subjectId: 'S', reviewMemo: memoB, reviewEnabled: true, reviewQuestionFormat: 2, reviewStep: 0, nextReviewDate: new Date(t0 + 2 * hour).toISOString() };
  const out = dup.dedupeIdenticalQuestions([logA, logB], t0);
  const a = out.find(l => l.id === 'a'), b = out.find(l => l.id === 'b');
  // 주기가 더 짧은 B의 문제가 남고 A의 같은 문제(가 → 나, 나 → 가)는 복습에서 빠진다. 노트 글은 그대로.
  assert.equal(a.reviewMemo, memoA);
  assert.equal(a.reviewRemoved[longKey].reason, 'duplicate');
  assert.ok(!b.reviewRemoved);
  const reverseKey = questionsFor(memoA).find(q => q.kind === 'reverse' && q.prompt === '나').key;
  assert.equal(a.reviewRemoved[reverseKey].reason, 'duplicate');
  assert.ok(!gate.getDueReviewGateQuestionKeys(a, t0 + 10 * day, true).includes(longKey));
  assert.ok(gate.getDueReviewGateQuestionKeys(a, t0 + 10 * day, true).length > 0, 'A keeps its other questions');
  assert.ok(gate.getDueReviewGateQuestionKeys(b, t0 + 10 * day, true).includes(longKey));
  // 이미 정리된 상태에서는 아무것도 바꾸지 않는다(같은 배열)
  assert.equal(dup.dedupeIdenticalQuestions(out, t0 + hour), out);
  // 주기가 같으면 먼저 오래된(앞선) 노트가 남는다
  const tie = dup.dedupeIdenticalQuestions([{ ...logB, id: 'x' }, { ...logB, id: 'y' }], t0);
  assert.ok(!tie[0].reviewRemoved && tie[1].reviewRemoved);
  // 조건이 다르면 다른 문제다(토글 제목이 다름), 다른 과목도 그대로
  const logC = { id: 'c', subjectId: 'S', reviewMemo: ':::toggle 도형\n가:나\n:::end', reviewEnabled: true, reviewStep: 0, nextReviewDate: logB.nextReviewDate };
  const logD = { ...logB, id: 'd', subjectId: 'other' };
  const mixed = dup.dedupeIdenticalQuestions([logB, logC, logD], t0);
  assert.equal(mixed[0], logB); assert.equal(mixed[1], logC); assert.equal(mixed[2], logD);
  // 복습에서 뺀 다른 이유의 문제는 겹침으로 세지 않는다
  const lowKey = keyOf(memoB, '가', '나');
  const lowRecord = { reason: 'low', at: '2026-10-23T00:00:00.000Z', prompt: '가', answer: '나' };
  const lowLog = { ...logB, id: 'z', reviewRemoved: { [lowKey]: lowRecord, [reverseKey]: lowRecord } };
  assert.equal(dup.dedupeIdenticalQuestions([logA, lowLog], t0)[0], logA);
  // 남은 쪽 노트에서 그 문제가 없어지면 뺐던 문제가 다시 나온다
  const edited = out.map(l => (l.id === 'b' ? { ...l, reviewMemo: '마:바' } : l));
  const back = dup.dedupeIdenticalQuestions(edited, t0 + hour);
  assert.equal(back.find(l => l.id === 'a').reviewRemoved, undefined);
  // 되돌리기 목록에서는 같은 문제로 뺀 것을 되돌릴 수 없다(버튼 없음), 라벨은 있다
  const { renderToStaticMarkup } = require('react-dom/server');
  const React = require('react');
  const { ReviewRemovedList } = loadSource('components/ReviewRemovedList.tsx');
  assert.equal(loadSource('utils/reviewRemoval.ts').REMOVE_REASON_LABELS.duplicate, '같은 문제가 있어요');
  assert.ok(typeof ReviewRemovedList === 'function' && renderToStaticMarkup(React.createElement(ReviewRemovedList, { logs: out, onRestore() {} })).includes('복습에서 뺀 문제'));
});

test('merging needs the same column number: a name in another column does not connect, and :: skips a column to reach it', () => {
  const { mergeNoteChains, parseNoteChain } = loadSource('utils/noteMerge.ts');
  const merge = (existing, incoming) => { const result = mergeNoteChains(existing, incoming); return result ? [result.text, result.kind] : null; };
  // 칸 번호: 같은 연결어를 붙여 쓰면 칸 하나를 건너뛴다
  assert.deepEqual(parseNoteChain('a::c:d::e').cols, [0, 2, 3, 5]);
  assert.deepEqual(parseNoteChain('a::c:d::e').fields, ['a', 'c', 'd', 'e']);
  assert.deepEqual(parseNoteChain('a::c').seps, ['::']);
  // 이름만 같고 칸 번호가 다르면(도시화: 이전 쪽은 3번째 칸, 새 줄은 2번째 칸) 연결되지 않는다
  assert.equal(merge('산업혁명:증기기관:도시화', '산업혁명:도시화:환경오염'), null);
  assert.equal(merge('a:b:c', 'a:c:d'), null);
  assert.equal(merge('A:K:B', 'A:B:C'), null);
  // 건너뛰어 칸 번호를 맞추면 연결된다
  assert.deepEqual(merge('산업혁명:증기기관:도시화', '산업혁명::도시화:환경오염'), ['산업혁명:증기기관:도시화:환경오염', 'link']);
  // 전체를 다 쓰지 않아도 쓴 칸의 번호만 같으면 된다(두 번째는 겹치는 칸이 맨 앞 B 하나뿐이라 첨가)
  assert.deepEqual(merge('[A] B:[D] C', '[A] B : [D] C:[K] L'), ['[A] B:[D] C:[K] L', 'link']);
  assert.deepEqual(merge('[A] B:[D] C', '[A:D] B :: [K] L'), ['[A] B:[D] C:[K] L', 'add']);
  assert.deepEqual(merge('A:b:c:d', 'A::c:e'), ['A:b:c:d=e', 'link']);
  // 맨 앞 칸만 겹치는 첨가: 같은 번호의 칸에 `=`로, 번호가 E의 끝을 넘으면 그만큼 건너뛰어 잇는다
  assert.deepEqual(merge('사과:빨강', '사과:둥글다'), ['사과:빨강=둥글다', 'add']);
  assert.deepEqual(merge('사과:빨강', '사과::둥글다'), ['사과:빨강:둥글다', 'add']);
  assert.deepEqual(merge('a:b', 'a:::d'), ['a:b::d', 'add']);
  // 사이에 낀 새 칸은 같은 번호의 칸에 `=`로 붙는다
  assert.deepEqual(merge('A:b:c', 'A:x:c'), ['A:b=x:c', 'link']);
  // E가 건너뛴 칸은 나중에 채울 수 있다
  assert.deepEqual(merge('[A] B::[K] L', '[A] B:[D] C'), ['[A] B:[D] C:[K] L', 'add']);
  // 맨 앞 칸만 E의 뒤쪽 칸과 겹치면 그 칸에 묶는다(연결이 아니다)
  assert.deepEqual(merge('[A] B:[D] C', '[D] C:[K] L'), ['[A] B:([D] C:[K] L)', 'group']);
  assert.equal(merge('A:K:B:C', 'K:B:Z'), null);
  // 합친 뒤 같은 글을 다시 합쳐도 그대로
  for (const [existing, incoming] of [['산업혁명:증기기관:도시화', '산업혁명::도시화:환경오염'], ['a:b', 'a:::d'], ['[A] B:[D] C', '[A:D] B :: [K] L'], ['A:b:c', 'A:x:c']]) {
    const once = mergeNoteChains(existing, incoming).text;
    assert.equal(mergeNoteChains(once, incoming), null, `${existing} + ${incoming} stays merged`);
  }
  // 저장할 때의 합치기(여러 줄)도 같은 규칙이다
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const saved = (incoming, earlier) => mergeNoteIntoEarlier(incoming, [{ id: 'e', memo: earlier }]).map(update => update.after);
  assert.deepEqual(saved('산업혁명:도시화:환경오염', '산업혁명:증기기관:도시화'), []);
  assert.deepEqual(saved('산업혁명::도시화:환경오염', '산업혁명:증기기관:도시화'), ['산업혁명:증기기관:도시화:환경오염']);
});

test(':: skips a column in questions: the column names, importance and sentences follow the column number', () => {
  const asked = memo => questionsFor(memo).filter(q => q.kind === 'direct');
  // 산업혁명(개념)과 도시화(예시) 사이의 정의 칸은 건너뛴다
  const { getReviewQuestionSentence } = loadSource('utils/reviewQuestions.ts');
  const skipped = questionsFor('[개념:정의:예시] 산업혁명::도시화');
  assert.ok(skipped.every(q => q.kind !== 'recall'));
  const sentences = skipped.map(q => [getReviewQuestionSentence(null, q)?.statement, q.answer]);
  assert.ok(sentences.some(([s, a]) => s === '‘개념:정의:예시’에서 개념 ‘산업혁명’에 이어지는 예시 값은?' && a === '도시화'), JSON.stringify(sentences));
  assert.ok(sentences.some(([s, a]) => s === '‘개념:정의:예시’에서 예시 ‘도시화’에 앞서 이어진 개념 값은?' && a === '산업혁명'));
  // 여러 칸을 건너뛴다: a:::d의 d는 4번째 칸이고, 건너뛴 칸만큼 덜 중요하다(중요도 값이 크다)
  const importance = (memo, prompt, answer) => asked(memo).find(q => q.prompt === prompt && q.answer === answer).importance;
  assert.ok(importance('a:::d', 'a', 'd') > importance('a::d', 'a', 'd') && importance('a::d', 'a', 'd') > importance('a:d', 'a', 'd'));
  assert.deepEqual(asked('a:b::d').map(q => `${q.prompt}→${q.answer}`), ['a→b', 'b→d']);
  // 건너뛴 칸을 지나는 긴 줄도 한 줄로 이어 읽는다
  assert.ok(questionsFor('a:b::d').some(q => q.kind === 'reconstruct' && q.prompt === 'a' && q.answer === 'b → d'));
  // `;;` `<<`도 같다, 서로 다른 연결어를 붙인 `:;`와 끝·앞의 `::`는 읽을 수 없다
  assert.deepEqual(asked('a;;c').map(q => [q.prompt, q.answer, q.direction]), [['a', 'c', 'forward']]);
  assert.deepEqual(questionsFor('a<<c').filter(q => q.kind === 'reverse').map(q => [q.prompt, q.answer, q.direction]), [['c', 'a', 'reverse']]);
  ['a:;c', 'A::', '::B'].forEach(memo => assert.ok(questionsFor(memo).every(q => q.kind === 'recall'), memo));
  // 모든 칸에 집합이 있는 줄은 건너뛰어도 능력 변환이다
  assert.ok(questionsFor('[A:D] B :: [K] L').some(q => q.kind === 'convert' && q.prompt === 'B' && q.answer === 'L'));
  // 토글 제목 아래 줄: 위쪽 토글이 이어주는 칸 집합도 건너뛴 칸 번호대로 읽는다
  const underTitle = questionsFor(':::toggle [개념:정의:예시]\n산업혁명::도시화\n:::end');
  assert.ok(underTitle.length > 0 && underTitle.every(q => q.kind !== 'recall'));
});

test('# keeps working in many cases: every place where the cell sits (even after skipped columns) gets its merged line, and :: can be used in the template', () => {
  const pairs = memo => new Set(questionsFor(memo).filter(q => ['direct', 'reconstruct', 'reverse'].includes(q.kind)).map(q => `${q.kind}|${q.prompt}|${q.answer}`));
  const T = "[A] #'-'#: #+#";
  // 셀이 몇 번째 칸에 있든 그 줄에 합쳐진 문제가 생긴다(칸 번호에 맞춰 건너뛴 줄로 합친다)
  const second = pairs(`A:'B-C'\nA:x:'B-C'\n${T}`);
  assert.ok(second.has('reconstruct|A|x → B-C → B+C') && second.has('reconstruct|A|B-C → B+C'));
  const third = pairs(`A:'B-C'\nA:x:y:'B-C'\n${T}`);
  assert.ok(third.has('reconstruct|A|x → y → B-C → B+C') && third.has('direct|B-C|B+C'));
  // 줄에 `::`로 건너뛰어 쓴 셀도 A의 이웃이고, 그 줄에 이어진다
  const written = pairs(`A::'B-C'\n${T}`);
  assert.ok(written.has('direct|A|B-C') && written.has('direct|B-C|B+C') && written.has('reconstruct|A|B-C → B+C'));
  // 두 줄에서 셀의 칸 번호가 달라도 각각 합쳐진다
  const both = pairs(`A:'B-C'\nA:x:'B-C'\nA:'B-C':w\n${T}`);
  assert.ok(both.has('reconstruct|A|x → B-C → B+C') && both.has('reconstruct|A|B-C → w = B+C'));
  // 이웃이 아닌 이름 · 다른 토글 경로의 줄에는 이어 붙지 않는다
  const other = pairs(`Q:'B-C'\n${T}\n:::toggle A\n'B-C'\n:::end`);
  assert.ok(![...other].some(text => text.includes('Q → B-C → B+C') || text.includes('Q|B-C → B+C')));
  // 틀 안에서도 `::`는 칸 하나를 건너뛴다
  const { readNoteTemplate } = loadSource('utils/noteSets.ts');
  const skipTemplate = readNoteTemplate("[A] #'-'#:: #+#");
  assert.deepEqual([skipTemplate.results, skipTemplate.separators], [['#+#'], ['::']]);
  const inTemplate = pairs(`A:'B-C'\n[A] #'-'#:: #+#`);
  assert.ok(inTemplate.has('direct|B-C|B+C') && inTemplate.has('reconstruct|A|B-C → B+C'));
  assert.ok([...inTemplate].every(text => !text.includes('#')), 'the template line itself is no question');
  const chained = pairs(`A:'B-C'\n[A] #'-'#: #+#:: #*#`);
  assert.ok(chained.has('direct|B+C|B*C') && chained.has('reconstruct|A|B-C → B+C → B*C'));
});

test('[A] k is intersected with the classification of its own column number by default (no dot): [개념:정의] above makes [A] k : j into [개념.A] k : [정의] j', () => {
  /** 풀어 쓴 꼴: 분류기준이 없는 노트에 집합을 모두 직접 쓴 줄과 같은 문제가 나온다 */
  const sets = memo => questionsFor(memo).filter(q => q.kind === 'convert' && q.convert.form === 'unit').map(q => q.convert.steps.map(step => `${step.set}=${step.cell}`).join('>'));
  const sameSets = (short, full) => {
    assert.deepEqual(sets(short), sets(full), short);
    assert.ok(sets(short).length > 0, `${short} makes ability-conversion questions`);
  };
  // 분류기준 `개념:정의` 아래의 `[A] k : j`는 `[개념.A] k : [정의] j`다(점 없이 해당 번째의 분류기준과 교집합)
  sameSets(':::toggle [개념:정의]\n[A] k : j\n:::end', '[개념.A] k : [정의] j');
  sameSets(':::toggle [개념:정의:예시]\n[A] k : j : m\n:::end', '[개념.A] k : [정의] j : [예시] m');
  // `:` 뒤의 칸에 써도 그 칸 번호의 분류기준이다
  sameSets(':::toggle [개념:정의]\nx : [B] y\n:::end', '[개념] x : [정의.B] y');
  // `::`로 건너뛴 칸은 번호를 세어 넘어간다(m은 3번째 칸이라 예시)
  sameSets(':::toggle [개념:정의:예시]\n[A] k :: m\n:::end', '[개념.A] k :: [예시] m');
  // 직접 쓴 `[ ]`가 있는 칸도 상위 분류와 교집합이다
  sameSets(':::toggle [개념:정의]\n[A] k : [B] j\n:::end', '[개념.A] k : [정의.B] j');
  assert.deepEqual(questionsFor(':::toggle [개념:정의]\n[A] k : [B] j\n:::end').filter(q => q.kind === 'convert').map(q => q.convert.steps.map(step => step.set)), [['개념.A', '정의.B'], ['정의.B', '개념.A']]);
  // 안쪽 토글 · 논리어가 든 칸
  sameSets(':::toggle [개념:정의]\n:::toggle 산업\n[A] k : j\n:::end\n:::end', '[개념.A] k : [정의] j');
  sameSets(':::toggle [개념:정의]\n[A] k-m : j\n:::end', '[개념.A] k-m : [정의] j');
  // 집합이 붙은 칸이 하나도 없는 줄은 줄이지 않는다
  assert.ok(questionsFor(':::toggle [개념:정의]\nk : j\n:::end').every(q => q.kind !== 'convert'));
  // 상위 속성이 없으면 `[A]`는 쓴 그대로다(교집합할 것이 없음)
  assert.deepEqual(questionsFor('[A] k : j').filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer, q.conditions]), [['k', 'j', ['A']]]);
  assert.ok(questionsFor(':::toggle [개념]\n[A] k : j\n:::end').every(q => q.kind !== 'convert'));
  // 이름이 없는 칸(분류기준보다 칸이 많음)은 집합이 없어서 모든 칸에 집합이 있는 줄이 아니다
  assert.ok(questionsFor(':::toggle [개념:정의]\n[A] k : j : m\n:::end').every(q => q.kind !== 'convert'));
  // 노트 맨 위(토글 밖)에 쓴 분류기준도 상위 속성이다. 상위가 여럿이면 바깥부터 모두 교집합이다(토글 밑 토글도 다시)
  sameSets('[개념:정의]\n[A] k : j', '[개념.A] k : [정의] j');
  sameSets('[개념:정의]\n:::toggle [원인:결과]\n[A] k : j\n:::end', '[개념.원인.A] k : [정의.결과] j');
  assert.deepEqual(questionsFor(':::toggle [개념:정의]\n:::toggle [원인:결과]\n[A] k : j\n:::end\n:::end').filter(q => q.kind === 'convert').map(q => q.convert.steps.map(step => step.set)), [['개념.원인.A', '정의.결과'], ['정의.결과', '개념.원인.A']]);
  assert.deepEqual(questionsFor(':::toggle [개념:정의]\n:::toggle [원인:결과]\n:::toggle [가:나]\n[A] k : j\n:::end\n:::end\n:::end').filter(q => q.kind === 'convert').map(q => q.convert.steps.map(step => step.set)), [['개념.원인.가.A', '정의.결과.나'], ['정의.결과.나', '개념.원인.가.A']]);
  // 관계 토글 제목의 `[A]`도 상위 분류와 교집합이고, 그 아래 줄이 그대로 이어받는다
  assert.deepEqual(questionsFor('[개념:정의]\n:::toggle [A] B: [C] D\nh:j\n:::end').filter(q => q.kind === 'convert' && q.prompt === 'h').map(q => q.convert.steps.map(step => step.set)), [['개념.A.B', '정의.C.D']]);
  // 줄 앞 분류기준(`[개념:정의;예시] 값:값`)과 위치 표시(`[A:C] 값`)만 쓴 줄은 집합이 붙은 칸이 아니라서 줄이지 않는다
  assert.ok(questionsFor('[개념:정의]\n[개념:정의;예시] 증기기관:열로 움직인다\n').every(q => q.kind !== 'convert'));
  assert.ok(questionsFor(':::toggle [개념:정의]\n[A:C] k : j\n:::end').every(q => q.kind !== 'convert'));
  // 점 줄임은 없다: `.[A] k`의 점은 집합 기호가 아니라 값의 글자다. `[ ]` 밖의 점으로 이은 `[A].[B] k`도 집합식이 아니다
  assert.ok(questionsFor(':::toggle [개념:정의]\n.[A] k : j\n:::end').every(q => q.kind !== 'convert'));
  assert.deepEqual(questionsFor(':::toggle [개념:정의]\n.[A] k : j\n:::end').filter(q => q.kind === 'direct').map(q => [q.prompt, q.answer]), [['.[A] k', 'j']]);
  const { readConvertCell } = loadSource('utils/abilityConvert.ts');
  assert.deepEqual(readConvertCell('[A].[B] k'), { sets: ['A'], cell: '.[B] k' });
  assert.deepEqual(readConvertCell('[A.B] k'), { sets: ['A.B'], cell: 'k' });
  assert.deepEqual(readConvertCell('[A:C].급수'), { sets: ['A:C'], cell: '.급수' }, 'a dot outside [ ] is a letter of the value (21:09: set words only inside [ ])');
  // 관계도 그림도 풀어 쓴 꼴과 같다(개념 > A 안에 k). 토글 밑 토글이면 바깥 기준부터 쌓인다(개념 > 원인 > A)
  const { parseNoteDiagram } = loadSource('utils/noteDiagram.ts');
  assert.deepEqual(parseNoteDiagram(':::toggle [개념:정의]\n[A] k : j\n:::end')[0].items, parseNoteDiagram('[개념][A] k : [정의] j'));
  assert.deepEqual(parseNoteDiagram('[개념:정의]\n[A] k : j').slice(1), parseNoteDiagram('[개념][A] k : [정의] j'));
  assert.deepEqual(parseNoteDiagram(':::toggle [개념:정의:예시]\n[A] k :: m\n:::end')[0].items, parseNoteDiagram('[개념][A] k :: [예시] m'));
  assert.deepEqual(parseNoteDiagram(':::toggle [개념:정의]\n:::toggle [원인:결과]\n[A] k : j\n:::end\n:::end')[0].items[0].items, parseNoteDiagram('[개념][원인][A] k : [정의][결과] j'));
  // 분류기준이 없으면 쓴 그대로, 위치 표시만 쓴 줄(`[A:C] k`)도 줄이지 않는다
  assert.deepEqual(parseNoteDiagram('[A] k : j'), [{ kind: 'group', relation: 'hierarchy', title: 'A', items: [{ kind: 'relation', fields: ['k', 'j'], arrows: ['both'] }] }]);
  const marked = parseNoteDiagram(':::toggle [개념:정의]\n[A:C] k : j\n:::end')[0].items;
  assert.equal(marked[0].title, 'A:C');
  assert.deepEqual(marked[0].items, [{ kind: 'relation', fields: ['k', 'j'], arrows: ['both'] }]);
});

test('a # template can use {A} (one element of the set A) next to #, and # may be empty: `[K] #{A}+# : #+{A}#` turns CB+ into CB+:C+B', () => {
  const lines = (memo, condition = 'K') => questionsFor(memo).filter(q => q.kind === 'direct' && q.conditions.includes(condition)).map(q => `${q.prompt} → ${q.answer} [${q.conditions.join(',')}]`);
  const template = '[K] #{A}+# : #+{A}#';
  // `[A] B=N=M`은 A 안의 B · N · M이다: CB+는 `#`=C · {A}=B · `#`=빈 글이라 C+B가 된다
  assert.deepEqual(lines(`[A] B=N=M\n[K] CB+\n${template}`), ['CB+ → C+B [K]']);
  assert.deepEqual(questionsFor(`[A] B=N=M\n[K] CB+\n${template}`).filter(q => q.kind === 'reverse' && q.conditions.includes('K')).map(q => `${q.prompt} → ${q.answer}`), ['C+B → CB+']);
  // 토글로 쓴 집합도 같고, 원소마다 따로 쓴 `[A] B` 줄도 같다. 쓴 자리(토글 경로)와는 상관없다
  assert.deepEqual(lines(`:::toggle A\nB=N=M\n:::end\n[K] CB+\n${template}`), ['CB+ → C+B [K]']);
  assert.deepEqual(lines(`[A] B\n[A] N\n[A] M\n[K] CB+\n${template}`), ['CB+ → C+B [K]']);
  assert.deepEqual(lines(`:::toggle 어디\n:::toggle 더 안\n[A] B=N=M\n:::end\n:::end\n[K] CB+\n${template}`), ['CB+ → C+B [K]']);
  // 틀에 맞는 셀마다 줄이 생기고, 맞지 않는 셀(원소가 없음 · `+`가 없음)은 줄이 없다
  assert.deepEqual(lines(`[A] B=N=M\n[K] CB+\n[K] NN+x\n[K] CX+\n[K] CB\n${template}`), ['CB+ → C+B [K]', 'NN+x → N+Nx [K]']);
  // 원소가 겹치면 더 긴 원소가 먼저 맞는다
  assert.deepEqual(lines(`[A] B=BN\n[K] XBN+\n${template}`), ['XBN+ → X+BN [K]']);
  // 쉼표로 이은 셀은 한 원소다(`,`는 그리고라서 원소를 나누지 않는다)
  assert.deepEqual(lines(`[A] B,N,M\n[K] CB+\n${template}`), []);
  // 집합이 아닌 `{A}`는 글자 그대로(자리가 아니다)
  assert.deepEqual(lines(`[K] CB+\n${template}`), []);
  // 결과 칸의 `{A}`가 첫 칸의 `{A}`보다 많으면 채울 값이 모자라 줄이 없다
  assert.deepEqual(lines('[A] B=N\n[K] CB+\n[K] #{A}+# : {A}{A}'), []);
  // `#`는 빈 글도 된다: 앞 · 뒤 · 가운데
  assert.deepEqual(lines("[A] #'-'#: #+#\n[A] B-", 'A'), ['B- → B+ [A]']);
  assert.deepEqual(lines("[A] #'-'#: #+#\n[A] -C", 'A'), ['-C → +C [A]']);
  // 틀에서 `#`가 하나도 비지 않는 예전 줄은 그대로다
  assert.deepEqual(lines("[A] #'-'#: #+#\n[A] 'B-C'", 'A'), ["B-C → B+C [A]"]);
});

test('{A} means the set A wherever its cells were written: a plain {A} line takes the cells of `[A] B=N=M` too, and = splits them', () => {
  const greet = memo => questionsFor(memo).filter(q => q.kind === 'direct' && q.prompt === '인사').map(q => q.answer);
  // 토글 집합, `[A] 셀`로 쓴 집합, 깊이 들어간 `[A]`가 모두 같다
  assert.deepEqual(greet(':::toggle A\nB\nN\n:::end\n인사: {A}아'), ['B아', 'N아']);
  assert.deepEqual(greet('[A] B\n[A] N\n인사: {A}아'), ['B아', 'N아']);
  assert.deepEqual(greet('[A] B=N=M\n인사: {A}아'), ['B아', 'N아', 'M아']);
  assert.deepEqual(greet(':::toggle A\nB=N=M\n:::end\n인사: {A}아'), ['B아', 'N아', 'M아']);
  assert.deepEqual(greet(':::toggle 어디\n:::toggle 더 안\n[A] B=N=M\n:::end\n:::end\n인사: {A}아'), ['B아', 'N아', 'M아']);
  // 원소가 없는 이름의 `{원인}`은 예전처럼 칸 이름표다
  assert.deepEqual(greet('인사: {원인}반가워'), ['반가워']);
  // 쉼표는 원소를 나누지 않는다
  assert.deepEqual(greet('[A] B,N\n인사: {A}아'), ['B AND N아']);
  // 따옴표로 묶은 `=`는 한 원소
  assert.deepEqual(greet("[A] 'B=N'\n인사: {A}아"), ["'B = N'아"]);
});

test('layers: a text-less title `[수]:[성질]` is the criterion 수:성질 (no title question), like `[수:성질]` and `[[수]:[성질]]`', () => {
  const { getReviewQuestionSentence } = questionBuilder;
  const say = memo => questionsFor(memo).map(q => [getReviewQuestionSentence(q.criterion ?? null, q)?.statement, q.answer]);
  const body = ':::toggle ② 표기\n:::toggle TITLE\n소수:약수가 1과 자기 자신뿐인 수\n:::end\n:::end';
  const expected = [
    ['‘② 표기’에서 수 ‘소수’에 이어지는 성질 값은?', '약수가 1과 자기 자신뿐인 수'],
    ['‘② 표기’에서 성질 ‘약수가 1과 자기 자신뿐인 수’에 앞서 이어진 수 값은?', '소수']
  ];
  for (const title of ['[수:성질]', '[수]:[성질]', '[[수]:[성질]]']) assert.deepEqual(say(body.replace('TITLE', title)), expected, title);
  // 글자가 있는 관계 제목(`[A] B: [C] D`)은 전처럼 관계 줄이다
  assert.ok(questionsFor(':::toggle [A] B: [C] D\n:::end').some(q => q.convert));
});

test('layers: a plain toggle title is a position, not a criterion cell, so no cell name is attached to it; a trailing-relation title head keeps its name', () => {
  const { getReviewQuestionSentence } = questionBuilder;
  const say = memo => questionsFor(memo).map(q => getReviewQuestionSentence(q.criterion ?? null, q)?.statement);
  assert.deepEqual(say(':::toggle [개념:정의]\n:::toggle 수학\n직각삼각형:직각이 하나인 삼각형\n:::end\n:::end'),
    ['‘수학’에서 개념 ‘직각삼각형’에 이어지는 정의 값은?', '‘수학’에서 정의 ‘직각이 하나인 삼각형’에 앞서 이어진 개념 값은?']);
  assert.deepEqual(say(':::toggle [개념:정의]\n:::toggle 증기기관:\n열로 물을 끓인다\n:::end\n:::end'),
    ['개념 ‘증기기관’에 이어지는 정의 값은?', '정의 ‘열로 물을 끓인다’에 앞서 이어진 개념 값은?']);
});

test('layers: the second cell of an ability definition `[동물]:[개념:정의]` is the position of the cells in the set, so its names reach the sentence', () => {
  const { getReviewQuestionSentence } = questionBuilder;
  const memo = '[동물]:[개념:정의]\n:::toggle 동물\n고래:새끼를 낳는다\n:::end';
  const qs = questionsFor(memo);
  assert.deepEqual(qs.map(q => q.criterion), ['개념:정의', '개념:정의']);
  assert.equal(getReviewQuestionSentence(null, qs[0]).statement, '‘동물’에서 개념 ‘고래’에 이어지는 정의 값은?');
  // 능력 정의가 없는 노트는 그대로
  assert.deepEqual(questionsFor(':::toggle 동물\n고래:새끼를 낳는다\n:::end').map(q => q.criterion), [undefined, undefined]);
});

test('layers: a same-set unit conversion says 다음/앞 by the connector direction instead of 대응', () => {
  const { getReviewQuestionSentence } = questionBuilder;
  const units = questionsFor('[번호] 1 : @+1').filter(q => q.convert && !q.convert.variation);
  assert.deepEqual(units.map(q => [getReviewQuestionSentence(null, q).statement, q.answer]), [
    ['집합 ‘번호’의 ‘1’ 다음에 이어지는 집합 ‘번호’의 값은?', '1+1'],
    ['집합 ‘번호’의 ‘1+1’ 앞에 놓인 집합 ‘번호’의 값은?', '1']
  ]);
  // 다른 집합 사이의 변환은 전처럼 대응
  const [go] = questionsFor('[기본형] go ; [과거형] went');
  assert.equal(getReviewQuestionSentence(null, go).statement, '집합 ‘기본형’의 ‘go’에 대응하는 집합 ‘과거형’의 값은?');
});

test("quotes: , - = stay letters even inside ( ) within the quote, so a formula '(f(x+h)-f(x))/h' makes no order question", () => {
  const kinds = memo => questionsFor(memo).map(q => q.kind).sort();
  assert.deepEqual(kinds("A:'x (b-c) y'"), ['direct', 'reverse']);
  assert.deepEqual(kinds("도함수:'f′(x) = lim h→0 (f(x+h)-f(x))/h'"), ['direct', 'reverse']);
  assert.deepEqual(kinds("등차수열:'a_n = a + (n-1)d'"), ['direct', 'reverse']);
  // 괄호 안의 `:` `;` `<`는 전처럼 보통 규칙(안쪽 관계)
  assert.ok(kinds("A : 'p ; (q : r) ; s'").includes('order-next'));
});

test("templates: {#%S} is a chunk free of S's symbols and parentheses, {@}/{@n} re-use matched slots, and a quoted '=' is a set element", () => {
  const { slotCellsOf, buildNoteSetIndex } = loadSource('utils/noteSets.ts');
  const convertPairs = memo => questionsFor(memo).filter(q => q.convert && q.direction === 'forward').map(q => `${q.prompt} → ${q.answer}`);
  const symbols = "[기호] + = '=' = / = * = ^";
  assert.deepEqual(slotCellsOf(buildNoteSetIndex([symbols]), '기호'), ['+', "'='", '/', '*', '^'], "the quoted = stays one element (its quotes kept)");
  // (sin x)^2 → 2*(sin x); (x+1)^2 is skipped because + is a symbol of the set
  assert.deepEqual(convertPairs(`${symbols}\n[수식] (sin x)^2\n[수식] (x+1)^2\n[수식] #({#%기호})^2# : [미분] #2*({@})#`), ['(sin x)^2 → 2*(sin x)']);
  // numbered back-references: {@1} = the chunk inside ( ), {@2} = the exponent chunk
  assert.deepEqual(convertPairs(`${symbols}\n[수식] (sin x)^3\n[수식] #({#%기호})^{#%기호}# : [미분] #{@2}*({@1})^({@2}-1)#`), ['(sin x)^3 → 3*(sin x)^(3-1)']);
  // the plain # around keeps its old meaning (shortest text), so a leading factor is glued as letters
  assert.deepEqual(convertPairs(`${symbols}\n[수식] 3(cos x)^2 + 1\n[수식] #({#%기호})^2# : [미분] #2*({@})#`), ['3(cos x)^2 + 1 → 32*(cos x) + 1']);
  // a {@n} past the matched slots lacks a value → no line
  assert.deepEqual(convertPairs(`${symbols}\n[수식] (sin x)^2\n[수식] #({#%기호})^2# : [미분] #{@2}#`), []);
});

test('a lone [X] on a later cell (no criterion, not all cells set) names that cell instead of staying letters, also inside ( )', () => {
  const { getReviewQuestionSentence } = questionBuilder;
  const say = memo => questionsFor(memo).filter(q => q.kind === 'direct' || q.kind === 'reverse').map(q => getReviewQuestionSentence(q.criterion ?? null, q).statement);
  assert.deepEqual(say('임진왜란 : [원인] 일본의 야욕'), ['‘임진왜란’에 이어지는 원인 값은?', '원인 ‘일본의 야욕’에 앞서 이어진 것은?']);
  const inner = say('세포 : (막 : [기능] 보호)');
  assert.ok(inner.includes('‘세포’에서 ‘막’에 이어지는 기능 값은?') && inner.includes('‘세포’에서 기능 ‘보호’에 앞서 이어진 것은?'), inner.join(' | '));
  // 첫 칸만의 [a]는 전처럼 조건, 모든 칸의 [ ]는 전처럼 능력 변환
  assert.deepEqual(questionsFor('[a] X:y').map(q => q.conditions), [['a'], ['a']]);
  assert.ok(questionsFor('[사건] 임진왜란 : [원인] 일본의 야욕').every(q => q.convert));
});

test('arithmetic folding: number-op-number is computed with precedence; a unit with freedom shows the folded output', () => {
  const { foldArithmetic } = loadSource('utils/arithmeticFold.ts');
  const { foldConvertUnit, planConvertReview } = loadSource('utils/abilityConvert.ts');
  assert.deepEqual(['3-2', '3*(sin x)^(3-1)', 'x^2-1', '1+2*3', 'x^2*3', '(3-1)', '10/0', 'x2*3', 'F = 3*2 N'].map(foldArithmetic),
    ['1', '3*(sin x)^2', 'x^2-1', '7', 'x^2*3', '2', '10/0', 'x2*3', 'F = 6 N']);
  const memo = "[기호] + = '=' = / = * = ^\n[수식] (sin x)^3\n[수식] #({#%기호})^{#%기호}# : [미분] #{@2}*({@1})^({@2}-1)#";
  const unit = questionsFor(memo).find(q => q.convert && q.prompt === '(sin x)^3');
  assert.equal(unit.answer, '3*(sin x)^(3-1)');
  assert.equal(foldConvertUnit(unit, { freedom: 0, reps: 0 }), unit, 'no freedom: shown as written');
  const folded = foldConvertUnit(unit, { freedom: 1, reps: 1 });
  assert.equal(folded.answer, '3*(sin x)^2');
  assert.equal(folded.key, unit.key, 'the key (schedule) does not change');
  // a combined question folds the shown cell written by a unit that has freedom (a skipped middle cell is hidden anyway)
  const chain = questionsFor('[a] 1 : [b] 4 : [c] 2+1');
  const units = chain.filter(q => q.convert?.form === 'unit' && !q.convert.variation && q.direction === 'forward');
  const plan = planConvertReview(units.map(q => ({ logId: 'L', question: q, state: { freedom: q.prompt === '4' ? 1 : 0, reps: 1 } })));
  assert.equal(plan.planned.length, 1);
  assert.deepEqual(plan.planned[0].question.convert.steps.map(s => s.cell), ['1', '4', '3']);
  assert.equal(plan.planned[0].question.answer, '4 → 3');
});

test('basic facts are always level 1: a line outside a toggle is not pushed to level 2 by the relative thirds', () => {
  assert.deepEqual(questionsFor(':::toggle T\na:b\n:::end\nc:d').map(q => [q.prompt, q.level]), [['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
  // 두 걸음 추론·재구성은 그대로 뒤 단계
  const long = questionsFor('a:b:c:d');
  assert.ok(long.filter(q => q.kind === 'far').every(q => q.level >= 2));
});

test('diagram: , - = inside quotes stay letters, and template/slot lines show the lines they generate', () => {
  const { parseLogicText, parseNoteDiagram } = loadSource('utils/noteDiagram.ts');
  const { generatedLinesOf } = loadSource('utils/reviewQuestions.ts');
  assert.deepEqual(parseLogicText("'v^2 - v0^2 = 2as'"), { kind: 'text', text: 'v^2 - v0^2 = 2as' });
  assert.equal(parseLogicText('a-b').kind, 'op');
  const memo = '[규칙 동사] walk\n[규칙 동사] play\n[규칙 동사] #: #ed';
  const items = parseNoteDiagram(memo, null, generatedLinesOf(memo));
  const expanded = JSON.stringify(items).includes('"kind":"expanded"');
  assert.ok(expanded, JSON.stringify(items));
  const flat = JSON.stringify(items);
  assert.ok(flat.includes('walked') && flat.includes('played'));
  // 펼침 정보를 주지 않으면 전처럼 글자 줄
  assert.ok(!JSON.stringify(parseNoteDiagram(memo, null)).includes('"kind":"expanded"'));
});

test('pair bundles: each question knows the relation pairs it asks (all pairs in between), and review shows one question per pair, more pairs per question as freedom grows', () => {
  const { planPairReview } = loadSource('utils/pairReview.ts');
  const qs = questionsFor('a:b:c:d');
  const pick = (prompt, answer, kind) => qs.find(q => q.prompt === prompt && q.answer === answer && (!kind || q.kind === kind));
  assert.equal(pick('a', 'b', 'direct').bundles.length, 1);
  assert.equal(pick('a', 'c', 'far').bundles.length, 2, 'two steps = both pairs in between');
  assert.equal(pick('a', 'd', 'far').bundles.length, 3);
  const shown = freedom => { const plan = planPairReview(qs.map(question => ({ logId: 'L', question, freedom }))); return { count: qs.length - plan.absorbed.size, plan }; };
  // 자유도 0: 쌍마다 하나(a→b, b→c, c→d), 모두 기본 관계
  const zero = shown(0);
  assert.equal(zero.count, 3);
  const leads = zero.plan.planned.map(item => item.question);
  assert.deepEqual(leads.map(q => q.kind), ['direct', 'direct', 'direct']);
  // 함께 받는 문제들이 모두 어딘가에 들어 있다
  assert.equal(zero.plan.planned.reduce((sum, item) => sum + item.covered.length, 0), qs.length);
  // 자유도가 오르면 한 문제가 더 많은 쌍을 덮어 문제 수가 줄어든다
  assert.ok(shown(1).count <= 2 && shown(2).count <= shown(1).count && shown(3).count === 1, `${shown(1).count} ${shown(2).count} ${shown(3).count}`);
  // 덜 익은 쌍(자유도 0)은 건너뛰어 묻지 않는다
  const mixed = planPairReview(qs.map(question => ({ logId: 'L', question, freedom: question.bundles?.includes(pick('c', 'd', 'direct').bundles[0]) && question.bundles.length === 1 ? 0 : 3 })));
  assert.ok(mixed.planned.every(item => !item.question.bundles.includes(pick('c', 'd', 'direct').bundles[0]) || item.question.bundles.length === 1));
  // 한 칸 안 순서는 이웃 항목 쌍이 묶음이다
  const seq = questionsFor('풀이:읽기-정리-확인');
  const next = seq.find(q => q.kind === 'order-next' && q.prompt === '읽기');
  assert.equal(next.bundles.length, 1);
  assert.equal(seq.find(q => q.kind === 'far' && q.prompt === '읽기').bundles.length, 2);
});

test('editing with intake off (an error fix) passes the old schedule to the most similar new question; intake on starts it now', () => {
  const gate = loadSource('utils/reviewGate.ts');
  const before = '한양 천도:1349년\n집현전:학문 연구 기관';
  const after = '한양 천도:1394년\n집현전:학문 연구 기관';
  const schedules = {};
  questionsFor(before).forEach((q, i) => { schedules[q.key] = { reviewStep: 2, nextReviewDate: `2026-11-0${i + 1}T00:00:00.000Z` }; });
  const log = { id: 'l', reviewMemo: before, reviewQuestionSchedules: schedules, nextReviewDate: '2026-11-01T00:00:00.000Z', reviewEnabled: true };
  const nowMs = Date.parse('2026-10-24T00:00:00Z');
  const fixed = gate.updateReviewGateMemo(log, after, undefined, { intake: false, nowMs });
  const learned = gate.updateReviewGateMemo(log, after, undefined, { intake: true, nowMs });
  const dateOf = (l, prompt) => l.reviewQuestionSchedules[questionsFor(after).find(q => q.prompt === prompt).key]?.nextReviewDate;
  assert.equal(dateOf(fixed, '한양 천도'), '2026-11-01T00:00:00.000Z');
  assert.equal(dateOf(learned, '한양 천도'), new Date(nowMs).toISOString());
  // 닮지 않은 새 문제는 물려받지 않는다
  const other = gate.updateReviewGateMemo(log, '훈민정음:바른 소리\n집현전:학문 연구 기관', undefined, { intake: false, nowMs });
  assert.equal(other.reviewQuestionSchedules[questionsFor('훈민정음:바른 소리').find(q => q.prompt === '훈민정음').key], undefined);
});

test('small fixes: full-width colons read as colons, a toggle name equal to the line set is one condition, prime after a word stays in templates, {A} skips its own line, # splits = cells', () => {
  assert.deepEqual(questionsFor('태조：이성계').map(q => q.kind), ['direct', 'reverse']);
  assert.deepEqual(questionsFor(':::toggle 할로젠\n[할로젠] F=Cl\n:::end').map(q => q.conditions), [['할로젠'], ['할로젠']]);
  assert.ok(questionsFor("[f] x^2\n[f] #: [f′] (#)'").some(q => q.prompt === 'x^2' && q.answer === "(x^2)'"));
  const chem = ':::toggle 할로젠\n[할로젠] F=Cl\n{할로젠}2 : 이원자 분자\n[할로젠] #: [수소 화합물] H#\n:::end';
  const qs = questionsFor(chem);
  assert.ok(!qs.some(q => /\{할로젠\}2{2}|H\{/.test(q.prompt + q.answer)), qs.map(q => q.prompt + '→' + q.answer).join(' | '));
  assert.ok(qs.some(q => q.prompt === 'F' && q.answer === 'HF') && qs.some(q => q.prompt === 'Cl' && q.answer === 'HCl'));
  // 합치기: 새 줄 기준이 옛 기준을 늘린 것이면 늘어난 기준
  const nm = loadSource('utils/noteMerge.ts');
  const merged = nm.mergeNoteIntoEarlier('[개념:정의;예시] 태조:조선을 세운 왕;위화도 회군', [{ id: 'n1', memo: '[개념:정의] 태조:조선을 세운 왕' }]);
  assert.equal(merged[0].after, '[개념:정의;예시] 태조:조선을 세운 왕;위화도 회군');
});

test('diagram resolves @ to the cell before it and says what it took', () => {
  const { parseNoteDiagram } = loadSource('utils/noteDiagram.ts');
  const [row] = parseNoteDiagram('가속도 : @의 변화량/시간', null);
  assert.deepEqual(row.fields, ['가속도', '가속도의 변화량/시간']);
  assert.deepEqual(row.atValues, { 1: '가속도' });
});

test('done minutes are whole minutes (no decimals from seconds), under a minute says so', () => {
  const { formatDoneMinutes } = loadSource('utils/studyReport.ts');
  assert.deepEqual([0, 0.07, 0.99, 1, 12.35, 59.6].map(formatDoneMinutes), ['0분', '1분 미만', '1분 미만', '1분', '12분', '60분']);
});

test('merging needs the same position: the criterion name of each cell (line, toggle title, note top) and its own [ ] must match', () => {
  const { mergeNoteIntoEarlier } = loadSource('utils/noteMerge.ts');
  const merged = (incoming, earlier) => mergeNoteIntoEarlier(incoming, [{ id: 'e', memo: earlier }]).map(update => update.after);
  // 줄 앞 기준이 다르면 같은 이름이어도 다른 자리다
  assert.deepEqual(merged('[사건:결과] 태조:위화도 회군', '[개념:정의] 태조:조선을 세운 왕'), []);
  assert.deepEqual(merged('[개념:정의] 태조:이성계', '[개념:정의] 태조:조선을 세운 왕'), ['[개념:정의] 태조:조선을 세운 왕=이성계']);
  // 노트 맨 위 기준 · 토글 제목의 기준도 칸의 위치다
  assert.deepEqual(merged('[인물:출생]\n세종:1397년', '[인물:업적]\n세종:한글'), []);
  assert.deepEqual(merged('[인물:업적]\n세종:측우기', '[인물:업적]\n세종:한글'), ['[인물:업적]\n세종:한글=측우기']);
  assert.deepEqual(merged('세종:측우기', '[인물:업적]\n세종:한글'), [], 'a criterion on one side only is another position');
  assert.deepEqual(merged(':::toggle 왕 [인물:출생]\n세종:1397년\n:::end', ':::toggle 왕 [인물:업적]\n세종:한글\n:::end'), []);
  // 묶기: 맨 앞 칸의 위치가 그 칸의 위치와 같을 때만, ( ) 안으로 들어가는 칸은 이름을 {이름}으로 지킨다
  assert.deepEqual(merged('[업적:의미] 한글:백성 교화', '[왕:업적] 세종:한글'), ['[왕:업적] 세종:(한글:{의미}백성 교화)']);
  assert.deepEqual(merged('[개념:정의:예시]\n증기기관:와트', '[개념:정의:예시]\n산업혁명:증기기관'), [], '증기기관 is 개념 in the new line but 정의 in the old one');
  // 늘어난 기준 · 같은 기준의 연결은 그대로
  assert.deepEqual(merged('[개념:정의;예시] 태조:조선을 세운 왕;위화도 회군', '[개념:정의] 태조:조선을 세운 왕'), ['[개념:정의;예시] 태조:조선을 세운 왕;위화도 회군']);
  assert.deepEqual(merged('[개념:정의:예시]\n산업혁명:증기기관:도시화', '[개념:정의:예시]\n산업혁명:증기기관'), ['[개념:정의:예시]\n산업혁명:증기기관:도시화']);
  // 토글 이름과 같은 줄 앞 [이름]은 따로 쓴 위치가 아니다
  assert.deepEqual(merged(':::toggle 할로젠\nF:기체\n:::end', ':::toggle 할로젠\n[할로젠] F:가장 강함\n:::end'), [':::toggle 할로젠\n[할로젠] F:가장 강함=기체\n:::end']);
  // 같은 낱말이 다른 자리에 있는 것은 "이미 있는 글"이 아니다
  const { noteChainContains } = loadSource('utils/noteMerge.ts');
  assert.equal(noteChainContains('[개념:정의] 태조:왕', '[사건:결과] 태조:왕'), false);
  assert.equal(noteChainContains('[개념:정의] 태조:왕', '[개념:정의] 태조:왕'), true);
});

test('= - shorthand is per subject: a log is read with its subject setting, the screen reads the subject it shows (last opened on top)', () => {
  const shorthand = loadSource('utils/noteShorthand.ts');
  const gate = loadSource('utils/reviewGate.ts');
  const orderKinds = () => questionBuilder.buildReviewQuestions('A:p-q').questions.filter(q => q.kind === 'order-next').length;
  try {
    shorthand.syncSubjectShorthands([{ id: 'off', noteShorthand: false }, { id: 'on', noteShorthand: true }, { id: 'unset' }]);
    assert.equal(shorthand.withLogShorthand({ subjectId: 'off' }, orderKinds), 0, 'shorthand off: - is a letter, no order question');
    assert.equal(shorthand.withLogShorthand({ subjectId: 'on' }, orderKinds), 1);
    assert.equal(shorthand.withLogShorthand({ subjectId: 'unset' }, orderKinds), 1, 'a subject that never chose follows the old device setting (on by default)');
    // 여러 과목의 기록을 한꺼번에 다뤄도 기록마다 제 과목 설정으로 읽는다
    const log = subjectId => ({ id: subjectId, subjectId, reviewMemo: 'A:p-q', nextReviewDate: '2000-01-01T00:00:00.000Z', reviewGateLevel: 3 });
    const offKeys = gate.getDueReviewGateQuestionKeys(log('off'), Date.now(), true);
    const onKeys = gate.getDueReviewGateQuestionKeys(log('on'), Date.now(), true);
    assert.ok(onKeys.length > offKeys.length, `${offKeys.length} < ${onKeys.length}`);
    // 화면: 나중에 연 화면(정리노트 서랍)의 과목이 위, 닫으면 앞 화면의 과목으로 돌아간다
    const session = {}; const sheet = {};
    shorthand.claimNoteShorthand(session, 'off');
    assert.equal(shorthand.isNoteShorthandOn(), false);
    shorthand.claimNoteShorthand(sheet, 'on');
    assert.equal(shorthand.isNoteShorthandOn(), true);
    shorthand.claimNoteShorthand(session, 'off');
    assert.equal(shorthand.isNoteShorthandOn(), true, 'the screen below re-rendering does not take the top');
    shorthand.releaseNoteShorthand(sheet);
    assert.equal(shorthand.isNoteShorthandOn(), false);
    assert.equal(shorthand.withNoteShorthand(true, () => shorthand.isNoteShorthandOn()), true, 'a wrapped read wins over the screen');
    shorthand.releaseNoteShorthand(session);
    assert.equal(shorthand.isNoteShorthandOn(), true);
  } finally {
    shorthand.syncSubjectShorthands([]);
  }
});

test('combine length (2~10, default 4) caps the convert chain units and the relation pairs one question covers; freedom rises up to length-1', () => {
  const length = loadSource('utils/combineLength.ts');
  const { planConvertReview } = loadSource('utils/abilityConvert.ts');
  const { planPairReview } = loadSource('utils/pairReview.ts');
  const { calculateQuestionPerformance, freedomCap } = loadSource('utils/reviewPractice.ts');
  assert.equal(length.readCombineLength(), 4, 'default 4 = as before');
  assert.deepEqual([1, 2, 7, 10, 11, NaN].map(length.clampCombineLength), [2, 2, 7, 10, 10, 4]);
  const units = memo => questionsFor(memo).filter(q => q.kind === 'convert' && q.convert.form === 'unit' && !q.convert.variation && q.direction === 'forward')
    .map(question => ({ logId: 'L', question, state: { freedom: 0, reps: 1 } }));
  const chain = units('[a] 1 ; [b] 2 ; [c] 3 ; [d] 4 ; [e] 5 ; [f] 6');
  const unitCounts = limit => planConvertReview(chain, limit).planned.map(item => item.covered.filter(cover => cover.questionKey.startsWith('cv1:')).length);
  assert.deepEqual(unitCounts(4), [4]);
  assert.deepEqual(unitCounts(10), [5], 'all five units in one question');
  assert.deepEqual(unitCounts(2), [2, 2]);
  const qs = questionsFor('a:b:c:d:e:f');
  const shown = (freedom, limit) => qs.length - planPairReview(qs.map(question => ({ logId: 'L', question, freedom })), limit).absorbed.size;
  assert.ok(shown(9, 10) < shown(9, 4), `${shown(9, 10)} < ${shown(9, 4)}`);
  assert.equal(shown(3, 10), shown(3, 4), 'freedom still decides how far it reaches (f+1 pairs)');
  try {
    length.writeCombineLength(10);
    assert.equal(freedomCap(), 9);
    assert.equal(calculateQuestionPerformance({ freedom: 3 }, 0, 1, { grades: ['easy'], nowMs: 0 }).freedom, 4, 'freedom keeps rising past 3');
    assert.equal(planConvertReview(chain).planned[0].covered.filter(cover => cover.questionKey.startsWith('cv1:')).length, 5, 'the setting is the default limit');
  } finally {
    length.writeCombineLength(4);
  }
  assert.equal(freedomCap(), 3);
  assert.equal(calculateQuestionPerformance({ freedom: 3 }, 0, 1, { grades: ['easy'], nowMs: 0 }).freedom, 3);
});

test('real-use fixes (21:50): review subject shared by stages counts once, a fresh follow-up inherits the previous speed, one completion date, stage names, effective next-review preview', () => {
  const { analyzeSubjectSpeed } = loadSource('utils/speedGrowth.ts');
  const { estimateReviewSubjectCompletion, estimateStageSchedule } = loadSource('utils/completionEstimate.ts');
  const { getSubjectStages } = loadSource('utils/schedule.ts');
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const A = { id: 'A', name: '수학 기본', startPage: 1, totalPages: 30, completedPages: 30, targetDate: iso(now + 9 * 864e5).slice(0, 10), reviewSubjectIds: ['R'],
    followUpSubjects: [{ id: 'A-f1', name: '수학 심화', startPage: 1, endPage: 20, completedPage: 5, reviewSubjectIds: ['R'] }] };
  const R = { id: 'R', name: '수학 오답노트', startPage: 1, totalPages: 100, completedPages: 10, targetDate: iso(now + 30 * 864e5).slice(0, 10) };
  const log = (id, stage, s, e, min, daysAgo) => ({ id, subjectId: 'A', subjectStageId: stage, startPage: s, endPage: e, pagesRead: e - s + 1, timeSpentMinutes: min,
    timestamp: iso(now - daysAgo * 864e5), reviewEnabled: true, reviewStep: 0, nextReviewDate: iso(now + 864e5), reviewSubjectIdsSnapshot: ['R'] });
  const logs = [log('m1', 'A', 1, 15, 50, 4), log('m2', 'A', 16, 30, 50, 3), log('f1', 'A-f1', 1, 5, 20, 1)];
  const speed = analyzeSubjectSpeed([A, R], logs, A);
  assert.equal(speed.forecast.filter(item => item.id === 'R').length, 1, 'R is forecast once though both stages link it');
  const current = speed.forecast.find(item => item.kind === 'current');
  assert.equal(current.id, 'A-f1');
  assert.equal(current.basis, 'previous', 'under 25 minutes of the follow-up: the previous stage speed');
  assert.ok(current.speed > 0);
  const stages = getSubjectStages(A).filter(stage => stage.reviewSubjectIds.includes('R'));
  const schedule = estimateStageSchedule(A);
  const events = stages.flatMap(stage => schedule.studyEvents.get(stage.id) || []);
  const both = estimateReviewSubjectCompletion(A, stages, R, events, logs);
  assert.ok(both instanceof Date);
  const onlyMain = estimateReviewSubjectCompletion(A, stages[0], R, schedule.studyEvents.get('A') || [], logs);
  assert.ok(!onlyMain || onlyMain.getTime() >= both.getTime(), 'more linked pages finish R no later');
  // 오늘 끝낸 공부 칸 · 할 일 칸은 후행과목 이름
  const { buildCompletedSubjectSummaries } = loadSource('components/TodaySummary.tsx');
  const today = new Date(now).toISOString().slice(0, 10);
  const studied = { ...log('f2', 'A-f1', 6, 8, 12, 0), studyDate: today, timestamp: iso(now) };
  const rows = buildCompletedSubjectSummaries([studied], [A, R], ['A'], today);
  assert.equal(rows[0].name, '수학 심화');
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('activeStage && activeStage.id !== item.studyItem.subject.id ? activeStage.name : item.name'));
  // 복습 문제가 끝나면 복습과목을 바로 시작하고, 저장 완료가 남은 장수를 채우면 복습을 마친다
  assert.ok(logger.includes('if (!gateLeadsToReviewSubject || preSessionReviewLogs.length === 0) return;') && logger.includes('finishPreSessionReview();\n  });'));
  assert.ok(logger.includes('created.pagesRead >= activeReviewTiming.remainingPages') && logger.includes('handleSwitchToNextReviewSubject();\n      return;'));
  // 난도 버튼의 다음 복습 = 문제 일정과 과목 난도 중 이른 쪽
  const { previewReviewCompletionIntervals } = loadSource('utils/reviewGate.ts');
  const { previewSubjectIntervals } = loadSource('utils/subjectFeedback.ts');
  const gateDone = { ...log('m1', 'A', 1, 15, 50, 4), reviewStep: 1, reviewQuestionFormat: 2, reviewMemo: '사인:높이/빗변', reviewGateLevel: 1,
    reviewQuestionSchedules: {}, reviewGatePendingSchedules: {}, reviewFsrs: { stability: 20, difficulty: 5, reps: 2, lapses: 0, lastReviewMs: now - 864e5 } };
  const keys = questionBuilder.buildReviewQuestions('사인:높이/빗변').questions.map(q => q.key);
  keys.forEach(key => { gateDone.reviewGatePendingSchedules[key] = { reviewStep: 1, intervalMs: 2 * 864e5, nextReviewDate: iso(now + 2 * 864e5) }; });
  const effective = previewReviewCompletionIntervals(gateDone, now);
  const subjectOnly = previewSubjectIntervals(gateDone, now);
  assert.ok(subjectOnly.good > 3 * 864e5, 'the subject grade alone is far');
  assert.ok(Math.abs(effective.good - 2 * 864e5) < 60e3, `the questions due in 2 days open it first: ${effective.good}`);
});

test('reviews of a deleted subject stay as records but are not put on today\'s list', () => {
  const { buildDueReviewGroups } = loadSource('components/SessionLogger.tsx');
  const now = Date.now();
  const log = { id: 'gone', subjectId: 'deleted', subjectNameSnapshot: '영어', pagesRead: 6, startPage: 1, endPage: 6, timeSpentMinutes: 18,
    timestamp: new Date(now - 3 * 864e5).toISOString(), reviewEnabled: true, nextReviewDate: new Date(now - 3600e3).toISOString(), reviewStep: 0 };
  const kept = { ...log, id: 'kept', subjectId: 'live' };
  const live = { id: 'live', name: '물리', totalPages: 30, completedPages: 6, targetDate: '2099-01-01', reviewEnabled: true };
  assert.deepEqual(buildDueReviewGroups([log, kept], [live], now).flatMap(group => group.logs.map(item => item.id)), ['kept']);
});

test('unseen-area fixes: times carry into the next unit, record edits keep inside the plan, a late session stays on its day, a bad save is kept', () => {
  const { formatResponseSeconds } = loadSource('utils/gradeRecommendation.ts');
  assert.equal(formatResponseSeconds(119600), '2분 0초');
  assert.equal(formatResponseSeconds(9970), '10초');
  assert.equal(formatResponseSeconds(3400), '3.4초');
  const { formatMinutesLabel } = loadSource('components/TodayTasks.tsx');
  assert.equal(formatMinutesLabel(119.5), '2시간');
  assert.equal(formatMinutesLabel(59.5), '1시간');
  assert.equal(formatMinutesLabel(61.2), '1시간 2분');
  // 학습량 고치기: 마지막 페이지를 넘거나 단원 사이 페이지에서 끝날 수 없다. 후행과목 기록에는 앞 과목의 단원을 쓰지 않는다
  const { editRangeOf } = loadSource('components/TodaySummary.tsx');
  const B = { id: 'B', name: '물리', startPage: 1, totalPages: 30, completedPages: 8, targetDate: '2099-01-01',
    chapters: [{ startPage: 1, endPage: 10 }, { startPage: 21, endPage: 30 }],
    followUpSubjects: [{ id: 'B2', name: '물리 심화', startPage: 1, endPage: 100, completedPage: 0, reviewSubjectIds: [] }] };
  assert.equal(editRangeOf(B, 'B', 50).valid, false);
  assert.equal(editRangeOf(B, 'B', 12).valid, false);
  assert.equal(editRangeOf(B, 'B', 25).valid, true);
  assert.equal(editRangeOf(B, 'B2', 12).valid, true);
  assert.equal(editRangeOf(B, 'B2', 12).chapters.length, 0);
  // 자정을 넘긴 측정은 시작한 날의 기록
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes("if (step === 'idle') sessionDayRef.current = null;") && logger.includes('activeStudyDate: liveStudyDate'));
  // 불러오기가 끝나기 전에는 저장하지 않고, 깨진 목록은 백업해 둔다
  const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  assert.ok(app.includes('if (!storageLoaded) return;') && app.includes("parseStoredList('swp_logs', savedLogs)") && app.includes('_backup_'));
});

test('folders cannot hold each other, and report time charts count review time kept inside records', () => {
  const { breakFolderCycles } = loadSource('utils/listOrder.ts');
  const tags = [{ id: 'A', name: 'A', parentId: 'B' }, { id: 'B', name: 'B', parentId: 'A' }, { id: 'C', name: 'C', parentId: 'A' }, { id: 'D', name: 'D' }];
  const fixed = breakFolderCycles(tags);
  assert.deepEqual(fixed.map(tag => tag.parentId), [undefined, 'A', 'A', undefined], 'one folder of the loop comes back to the top');
  assert.equal(breakFolderCycles(fixed), fixed, 'a clean list is left as it is');
  const analytics = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(analytics.includes('tagDefinitions.filter(t => !folderSubtreeIds(folder.id).has(t.id))'));
  const { withReviewTimeLogs, calculateStudyStreak, buildWeeklyStudy } = loadSource('utils/studyReport.ts');
  const logs = [
    { id: 'a', subjectId: 'S', studyDate: '2026-10-20', timestamp: '2026-10-20T03:00:00.000Z', pagesRead: 10, timeSpentMinutes: 30,
      basicReviewTimeRecords: [{ minutes: 12, pages: 10, timestamp: '2026-10-21T03:00:00.000Z', reviewNumber: 1 }],
      reviewSubjectTimeRecords: [{ subjectId: 'R', minutes: 20, pages: 5, timestamp: '2026-10-21T04:00:00.000Z', measurementId: 'session', completed: true },
        { subjectId: 'R', minutes: 9, pages: 3, timestamp: '2026-10-21T05:00:00.000Z', measurementId: 'old', completed: true }] },
    { id: 'session', subjectId: 'R', studyDate: '2026-10-21', timestamp: '2026-10-21T04:00:00.000Z', pagesRead: 5, timeSpentMinutes: 20, pomodoroSession: true, reviewParentSubjectId: 'S' }
  ];
  const timed = withReviewTimeLogs(logs);
  assert.equal(timed.length, 4, 'basic review + the review record without its own session');
  assert.equal(timed.reduce((sum, log) => sum + log.timeSpentMinutes, 0), 30 + 20 + 12 + 9);
  assert.equal(timed.reduce((sum, log) => sum + log.pagesRead, 0), 15, 'review time adds no pages');
  const now = new Date('2026-10-21T12:00:00');
  assert.equal(calculateStudyStreak(timed, now).current, 2);
  assert.equal(buildWeeklyStudy(timed, 1, now).points[0].minutes, 71);
});

test('one review is graded once: the last review subject sets the subject memory, and a basic review without review subjects asks for a grade too', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  assert.ok(app.includes('feedbackGrade && !nextReviewSubjectId ? { ...source, reviewFsrs: gradeSubjectCard(source, feedbackGrade, nowMs) } : source'));
  assert.ok(app.includes('const reviewFsrs = feedbackGrade ? gradeSubjectCard(log, feedbackGrade, nowMs) : log.reviewFsrs;'));
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes("onReviewAction(finishedLogIds, 'complete', preSessionReviewSeconds / 60, basicFeedback ? basicFeedbackChoice ?? basicFeedback.recommended ?? 'good' : undefined);"));
  assert.ok(logger.includes('data-basic-feedback="true"') && logger.includes('data-feedback-later="true"'));
  const { basicReviewFeedbackOf } = loadSource('utils/subjectFeedback.ts');
  const past = [{ id: 'a', subjectId: 'E', pagesRead: 10, timeSpentMinutes: 30, timestamp: '2026-10-01T00:00:00Z',
    basicReviewTimeRecords: [{ minutes: 10, pages: 10, timestamp: '2026-10-03T00:00:00Z' }, { minutes: 20, pages: 10, timestamp: '2026-10-05T00:00:00Z' }] }];
  const fast = basicReviewFeedbackOf(past, 'E', 10, 6);
  assert.equal(fast.averageSpeed, 45, 'median of 60 and 30 P/h');
  assert.equal(fast.recommended, 'easy');
  assert.equal(basicReviewFeedbackOf(past, 'E', 10, 30).recommended, 'hard');
  assert.equal(basicReviewFeedbackOf([], 'E', 10, 6).recommended, null, 'no past basic review: no recommendation');
});

test('a toggle named like the answer is left out of the question, and a basic review without questions keeps timing', () => {
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const { flashOf } = loadSource('utils/questionFlash.ts');
  const memo = ':::toggle 조선 전기\n:::toggle 태조\n태조=이성계:조선을 세운 왕\n:::end\n:::end';
  const asks = buildReviewQuestions(memo).questions.filter(q => q.answer === '태조');
  assert.ok(asks.length > 0);
  asks.forEach(q => {
    assert.ok(!(q.statement || '').includes('‘태조’'), `no answer in the place: ${q.statement}`);
    const card = flashOf(q);
    if (card) assert.ok(!card.place.some(chip => chip.value === '태조'));
  });
  const other = buildReviewQuestions(memo).questions.find(q => q.answer === '조선을 세운 왕');
  assert.ok(other && other.statement.includes('‘태조’'), 'other questions keep the toggle as their place');
  const logger = fs.readFileSync(path.resolve(__dirname, '../components/SessionLogger.tsx'), 'utf8');
  assert.ok(logger.includes('const stopsAtGateCompletion = isGateReviewComplete && gateReviewQuestions.length > 0;'));
  assert.ok(logger.includes('feedback={basicFeedback && isGateReviewComplete ?'));
});

test('note practice leaves out the questions removed from review', () => {
  const { buildNotePracticeCatalog } = loadSource('utils/notePractice.ts');
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const memo = '광합성:빛 에너지\n호흡:열';
  const key = buildReviewQuestions(memo).questions.find(q => q.answer === '빛 에너지').key;
  const log = { id: 'n1', subjectId: 'S', reviewMemo: memo, reviewRemoved: { [key]: { reason: 'low', at: '2026-10-01T00:00:00Z' } } };
  const { entries } = buildNotePracticeCatalog([log]);
  assert.ok(entries.length > 0 && !entries.some(entry => entry.question.key === key));
  assert.equal(buildNotePracticeCatalog([{ ...log, reviewRemoved: undefined }]).entries.length, entries.length + 1);
});

test('an edit taken into review can be skipped from the note screen: the review date and schedules come back as if the edit were a fix', () => {
  const { updateReviewGateMemo, editIntakeCount, skipEditIntake, completeRegularReviewSchedule } = loadSource('utils/reviewGate.ts');
  const { buildReviewQuestions } = loadSource('utils/reviewQuestions.ts');
  const now = Date.parse('2026-10-25T00:00:00Z');
  const later = new Date(now + 5 * 864e5).toISOString();
  const memo = '광합성:빛 에너지';
  const schedules = Object.fromEntries(buildReviewQuestions(memo).questions.map(q => [q.key, { reviewStep: 2, nextReviewDate: later, intervalMs: 5 * 864e5 }]));
  const log = { id: 'a', subjectId: 'S', timestamp: '2026-10-20T00:00:00Z', pagesRead: 5, timeSpentMinutes: 10, reviewEnabled: true, reviewMemo: memo,
    reviewStep: 2, nextReviewDate: later, reviewQuestionSchedules: schedules, reviewQuestionFormat: 2 };
  const edited = updateReviewGateMemo(log, '광합성:빛 에너지\n호흡:열', undefined, { intake: true, nowMs: now });
  assert.equal(edited.nextReviewDate, new Date(now).toISOString(), 'the new questions open the review now');
  assert.equal(editIntakeCount(edited), 2);
  const again = updateReviewGateMemo(edited, '광합성:빛 에너지\n호흡:열\n증산:물', undefined, { intake: true, nowMs: now + 1000 });
  assert.equal(editIntakeCount(again), 4, 'later edits add to the same record');
  assert.equal(again.reviewEditIntake.base.nextReviewDate, later, 'the base stays the first one');
  const skipped = skipEditIntake(again);
  assert.equal(skipped.nextReviewDate, later);
  assert.deepEqual(skipped.reviewQuestionSchedules, schedules);
  assert.equal(skipped.reviewEditIntake, undefined);
  assert.equal(editIntakeCount(skipped), 0);
  // 고친 줄은 오류를 고친 것처럼 옛 일정을 이어받는다
  const fixed = skipEditIntake(updateReviewGateMemo(log, '광합성:빛 에너지들', undefined, { intake: true, nowMs: now }));
  assert.equal(fixed.nextReviewDate, later);
  assert.ok(Object.values(fixed.reviewQuestionSchedules).some(item => item.nextReviewDate === later && item.reviewStep === 2));
  assert.equal(Object.keys(fixed.reviewQuestionSchedules).filter(key => !(key in schedules)).length > 0, true);
  // 복습을 마치면 되돌릴 기록은 사라진다
  assert.equal('reviewEditIntake' in completeRegularReviewSchedule(edited, now) && completeRegularReviewSchedule(edited, now).reviewEditIntake, undefined);
  // 스위치를 끄고 고치면 기록이 생기지 않는다
  assert.equal(updateReviewGateMemo(log, '광합성:빛 에너지\n호흡:열', undefined, { intake: false, nowMs: now }).reviewEditIntake, undefined);
});

test('the subject speed chart never mixes the page positions of different books', () => {
  const { analyzeSubjectSpeed } = loadSource('utils/speedGrowth.ts');
  const A = { id: 'A', name: '수학', startPage: 1, totalPages: 20, completedPages: 10, targetDate: '2099-01-01', reviewSubjectIds: ['R'] };
  const R = { id: 'R', name: '오답', startPage: 1, totalPages: 60, completedPages: 30, targetDate: '2099-01-01' };
  const at = day => new Date(Date.parse('2026-10-01T03:00:00Z') + day * 864e5).toISOString();
  const logs = [
    { id: 's1', subjectId: 'A', startPage: 1, endPage: 5, pagesRead: 5, timeSpentMinutes: 25, timestamp: at(0) },
    { id: 's2', subjectId: 'A', startPage: 6, endPage: 10, pagesRead: 5, timeSpentMinutes: 25, timestamp: at(1) },
    { id: 'r1', subjectId: 'R', reviewParentSubjectId: 'A', reviewPageRangeBased: true, startPage: 21, endPage: 30, pagesRead: 10, timeSpentMinutes: 25, timestamp: at(2), pomodoroSession: true }
  ];
  const analysis = analyzeSubjectSpeed([A, R], logs, A);
  assert.ok(analysis.series.points.length >= 2);
  assert.ok(analysis.series.points.every(point => point.page === null), 'with review records mixed in, the axis is pages solved');
  const own = analyzeSubjectSpeed([A, R], logs.slice(0, 2), A);
  assert.ok(own.series.points.every(point => typeof point.page === 'number'), 'one book keeps page positions');
});

test('a follow-up subject can have chapters, its own required flag and its own page word', () => {
  const schedule = loadSource('utils/schedule.ts');
  const { getPageLabel } = loadSource('utils/pageLabel.ts');
  const A = { id: 'A', name: '수학', startPage: 1, totalPages: 10, completedPages: 10, targetDate: '2099-01-01', isRequired: false, pageLabel: 'P',
    followUpSubjects: [{ id: 'F', name: '심화', startPage: 1, endPage: 30, completedPage: 0, chapters: [{ startPage: 1, endPage: 10 }, { startPage: 21, endPage: 30 }], isRequired: true, pageLabel: '문제' }] };
  const stage = schedule.getSubjectStages(A).find(item => item.id === 'F');
  assert.equal(stage.status, 'current');
  assert.equal(stage.pageCount, 20, 'only pages inside the chapters');
  assert.equal(schedule.getStageChapters(A, stage).length, 2);
  assert.equal(schedule.isSubjectRequiredNow(A), true, 'the follow-up decides while it is studied');
  assert.equal(getPageLabel(A), '문제');
  const after = schedule.adjustSubjectProgress(A, 12);
  const moved = schedule.getSubjectStages(after).find(item => item.id === 'F');
  assert.equal(after.followUpSubjects[0].completedPage, 22, '12 pages inside the chapters end at p.22');
  assert.equal(moved.currentPage, 23);
  assert.equal(moved.remainingPages, 8);
  assert.equal(schedule.isSubjectRequiredNow({ ...A, completedPages: 3 }), false, 'before the follow-up starts the subject decides');
  assert.equal(getPageLabel({ ...A, completedPages: 3 }), 'P');
});

test('a new review subject can be made inside the stage editor and is linked to that stage at once', () => {
  const analytics = fs.readFileSync(path.resolve(__dirname, '../components/Analytics.tsx'), 'utf8');
  assert.ok(analytics.includes('data-testid="new-review-subject-open"') && analytics.includes('data-testid="new-review-chapters"') && analytics.includes('data-testid="new-review-label"'));
  assert.ok(analytics.includes('createNewStudyPlan(name, newReviewForm.startPage, newReviewForm.endPage, owner.targetDate, false, [], 0,'), 'the deadline follows the owner subject');
  assert.ok(analytics.includes("reviewSubjectIds: [...(owner.reviewSubjectIds || []), created.id]"));
  assert.ok(analytics.includes('data-testid="follow-up-page-label"') && analytics.includes('follow-up-required-'));
});
