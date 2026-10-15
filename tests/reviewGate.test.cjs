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

const now = Date.parse('2026-09-13T04:00:00.000Z');
const second = 1000;
const hour = 60 * 60 * second;
const day = 24 * hour;
const source = (overrides = {}) => ({
  id: 'note-a', subjectId: 'main', timestamp: '2026-09-12T20:00:00.000Z',
  pagesRead: 4, startPage: 1, endPage: 4, timeSpentMinutes: 20,
  reviewMemo: '[alpha] label: beta / other: gamma',
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
  const memo = '[alpha] label: beta / other: gamma / number: 23';
  const parsed = gate.parseReviewGateMemo(memo);
  assert.deepEqual(parsed.prompts, ['[alpha] label', 'other', 'number']);
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
  assert.deepEqual(memoColors.splitReviewMemoColonColors('::\n:'), [
    { text: ':', colonIndex: 0 }, { text: ':', colonIndex: 1 }, { text: '\n' }, { text: ':', colonIndex: 0 }
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
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] label; beta / other; gamma'), [firstKey, secondKey]);
  assert.deepEqual(gate.getReviewGateQuestionKeys('[alpha] plain recall'), ['note']);
  assert.deepEqual(gate.getReviewGateQuestionKeys(' '), []);
});

test('semicolons ask forward only and colons also ask the reverse relation', () => {
  const parsed = gate.parseReviewGateMemo('sing; sing in Korean\nA;X:B');
  assert.deepEqual(parsed.questions.filter(q => ['direct', 'reverse'].includes(q.kind)).map(({ prompt, answer, direction }) => ({ prompt, answer, direction })), [
    { prompt: 'sing', answer: 'sing in Korean', direction: 'forward' },
    { prompt: 'A', answer: 'X', direction: 'forward' },
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
  const text = 'A:B\nC:D/E ';
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit(text, text.length, text.length), { text: 'A:B\nC:D/E:', caret: text.length });
  const nextLine = 'A:B\nC ';
  assert.deepEqual(memoInput.getReviewMemoDoubleSpaceEdit(nextLine, nextLine.length, nextLine.length), { text: 'A:B\nC:', caret: nextLine.length });
  const topic = 'A:B [topic/name] C ';
  assert.equal(memoInput.getReviewMemoDoubleSpaceEdit(topic, topic.length, topic.length), null);
});

test('the space shortcut does not replace indentation, selections or toggle commands', () => {
  for (const text of ['', ' ', '  ', '\n ', 'A\n ', 'A/ ', 'A  ', '> ']) {
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
  assert.deepEqual(updated.nodes.find(node => node.id === title.id).childrenRelation, { separatorIndex: 3, operator: 'and', type: 'part' });
});

test('relation parsing preserves note text and ignores operators within topics', () => {
  for (const memo of [' [topic:context;purpose] A ; B : C, D;E\nF:G ', 'A;;B\n;C;\nD:E:', 'plain']) {
    assert.equal(gate.parseReviewGateMemo(memo).parts.map(part => part.text).join(''), memo);
  }
  const parsed = gate.parseReviewGateMemo('[topic:context;purpose] A;B');
  assert.deepEqual(parsed.questions.map(q => [q.prompt, q.answer, q.direction]), [['[topic:context;purpose] A', 'B', 'forward']]);
  assert.ok(gate.parseReviewGateMemo('A;;B').questions.every(q => q.kind === 'recall'));
});

test('toggle titles and child text use the same relation directions', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'A:B', text: 'C;D' }
  ]);
  assert.deepEqual(gate.parseReviewGateMemo(memo).questions.filter(q => ['direct', 'reverse'].includes(q.kind)).map(item => [item.prompt, item.answer]), [
    ['C', 'D'], ['A', 'B'], ['B', 'A']
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
  assert.equal(gate.updateReviewGateMemo(retry, '[alpha] label; beta').reviewGateRetry, undefined);
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

test('note logical operators store commas as AND and equals signs as OR', () => {
  const { parseReviewMemoLogicalOperators } = loadSource('utils/reviewMemoLogic.ts');
  assert.deepEqual(parseReviewMemoLogicalOperators('A,B=C,D'), [
    { index: 1, operator: 'and' }, { index: 3, operator: 'or' }, { index: 5, operator: 'and' }
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
  assert.deepEqual(parseReviewMemoLogicalOperators(text), [
    { index: text.lastIndexOf(','), operator: 'and' }, { index: text.lastIndexOf('='), operator: 'or' }
  ]);
  assert.deepEqual(parseReviewMemoLogicalOperators('값:0.2;9.8'), []);
  const unfinished = '[미완성,=\nA,B=C';
  assert.deepEqual(parseReviewMemoLogicalOperators(unfinished), [
    { index: unfinished.lastIndexOf(','), operator: 'and' }, { index: unfinished.lastIndexOf('='), operator: 'or' }
  ]);
});

test('toggle titles and descendants keep independent logical operators and stable parents after reload', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '조건:A,B=C',
    text: reviewMemo.serializeReviewMemoBlocks([{ type: 'text', text: '근거;X,Y=Z' },
      { type: 'toggle', title: '상세:D,E', text: '결론;F=G' }]) }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const loaded = memoDocument.resolveReviewMemoDocument(memo, JSON.parse(JSON.stringify(document)));
  const root = loaded.nodes[0];
  const detail = loaded.nodes.find(node => node.text === '상세:D,E');
  const leaf = loaded.nodes.find(node => node.text === '결론;F=G');
  assert.deepEqual(root.logicalOperators.map(item => item.operator), ['and', 'or']);
  assert.deepEqual(detail.logicalOperators.map(item => item.operator), ['and']);
  assert.deepEqual(leaf.logicalOperators.map(item => item.operator), ['or']);
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
  assert.deepEqual(loaded.reviewMemoDocument.nodes[0].logicalOperators, [
    { index: 4, operator: 'and' }, { index: 6, operator: 'or' }
  ]);
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
  const changed = memoDocument.resolveReviewMemoDocument('조건:A=B', original);
  assert.equal(changed.nodes[0].id, original.nodes[0].id);
  assert.deepEqual(changed.nodes[0].logicalOperators, [{ index: 4, operator: 'or' }]);
  const removed = memoDocument.resolveReviewMemoDocument('조건:AB', changed);
  assert.equal(removed.nodes[0].id, original.nodes[0].id);
  assert.equal(removed.nodes[0].logicalOperators, undefined);
  assert.deepEqual(original.nodes[0].logicalOperators, [{ index: 4, operator: 'and' }]);
});

test('a period followed by whitespace is punctuation rather than a logical connector', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['A. B', 'A.\tB', 'A.\nB', 'A.\r\nB', 'A.\u00a0B']) {
    assert.deepEqual(parseReviewMemoSyntax(text).logicalOperators, []);
  }
  assert.deepEqual(parseReviewMemoSyntax('A=B, C').logicalOperators, [
    { index: 1, operator: 'or' }, { index: 3, operator: 'and' }
  ]);
});

test('slashes mark independent same-line relations without changing AND or OR connectors', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = 'A:B,C / D:E=F / [주제/설명] G;H';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.relationSeparators, [text.indexOf('/'), text.indexOf('/', text.indexOf('/') + 1)]);
  assert.deepEqual(parsed.logicalOperators, [
    { index: text.indexOf(','), operator: 'and' }, { index: text.indexOf('='), operator: 'or' }
  ]);
  const document = memoDocument.reviewMemoDocumentFromText(text);
  assert.deepEqual(document.nodes[0].relationSeparators, parsed.relationSeparators);
  assert.equal(memoDocument.reviewMemoDocumentToText(document), text);
});

test('an empty colon suffix on a toggle makes its children AND-connected parts recursively', () => {
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
  assert.deepEqual(root.childrenRelation, { separatorIndex: 3, operator: 'and', type: 'part' });
  assert.equal(components.parentId, root.id);
  assert.deepEqual(components.logicalOperators, [{ index: 2, operator: 'and' }]);
  assert.equal(door.parentId, root.id);
  assert.deepEqual(door.childrenRelation, { separatorIndex: 1, operator: 'and', type: 'part' });
  assert.equal(power.parentId, door.id);
  assert.deepEqual(power.logicalOperators, [{ index: 2, operator: 'and' }]);
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

test('an empty semicolon toggle suffix connects its child alternatives with OR', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a;   ', text: 'b\nc' }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  assert.deepEqual(document.nodes[0].childrenRelation, { separatorIndex: 1, operator: 'or', type: 'alternative' });
  assert.deepEqual(document.nodes[1].logicalOperators, [{ index: 1, operator: 'or' }]);
  assert.equal(document.nodes[1].parentId, document.nodes[0].id);
  assert.equal(memoDocument.reviewMemoDocumentToText(document), memo);
  assert.equal(memoDocument.reviewMemoDocumentFromText('a;').nodes[0].childrenRelation, undefined);
});

test('nested semicolon and colon toggles retain their own child operators rather than inheriting an ancestor operator', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a;', text: reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: 'b:', text: 'c\nd' }, { type: 'text', text: 'e\nf' }
  ]) }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const conjunction = document.nodes.find(node => node.text === 'b:');
  assert.equal(conjunction.childrenRelation.operator, 'and');
  assert.deepEqual(document.nodes.find(node => node.text === 'c\nd').logicalOperators, [{ index: 1, operator: 'and' }]);
  assert.deepEqual(document.nodes.find(node => node.text === 'e\nf').logicalOperators, [{ index: 1, operator: 'or' }]);
});

test('the semicolon example uses equals for alternatives and leaves the final period as punctuation', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = 'a; b= c.';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.logicalOperators, [{ index: text.indexOf('='), operator: 'or' }]);
  assert.deepEqual(parsed.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [{ or: ['b', 'c.'] }]);
  const child = 'b= c.';
  assert.deepEqual(parseReviewMemoSyntax(child, 'or').logicalOperators, [{ index: 1, operator: 'or' }]);
  for (const ending of ['a.', 'a; b.', 'a; b.   ', 'a; b./c:d', '[a.]', '[a=b.]']) {
    const result = parseReviewMemoSyntax(ending);
    assert.ok(!result.logicalOperators.some(item => item.index === ending.lastIndexOf('.')), ending);
  }
});

test('square brackets preserve grouped OR clauses connected by a top-level AND', () => {
  const text = '[a=b=c],[d=e]';
  const document = memoDocument.reviewMemoDocumentFromText(text);
  const node = document.nodes[0];
  assert.deepEqual(node.logicalOperators, [{ index: 7, operator: 'and' }]);
  assert.deepEqual(node.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [{ and: [
    { group: { or: ['a', 'b', 'c'] } }, { group: { or: ['d', 'e'] } }
  ] }]);
  assert.equal(memoDocument.reviewMemoDocumentToText(document), text);
  assert.deepEqual(node.logicalExpressions[0].operands.map(group => [group.startIndex, group.endIndex]), [[0, 7], [8, 13]]);
});

test('logical groups nest recursively and AND binds before OR without losing bracket boundaries', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = '[[a=b],[c=d]]=[e,f]';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [{ or: [
    { group: { and: [{ group: { or: ['a', 'b'] } }, { group: { or: ['c', 'd'] } }] } },
    { group: { and: ['e', 'f'] } }
  ] }]);
  assert.deepEqual(parseReviewMemoSyntax('a,b=c,d').logicalExpressions.map(expression => readLogicalExpression('a,b=c,d', expression)), [
    { or: [{ and: ['a', 'b'] }, { and: ['c', 'd'] }] }
  ]);
});

test('a trailing group period creates no empty alternative and decimals stay numeric values', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['[a=b.]', '[a= b. ]']) {
    const expression = parseReviewMemoSyntax(text).logicalExpressions[0];
    assert.equal(expression.type, 'group');
    assert.deepEqual(readLogicalExpression(text, expression), { group: { or: ['a', 'b.'] } });
    assert.equal(expression.expression.operands.length, 2);
  }
  const text = '[3.5,9.8]';
  assert.deepEqual(parseReviewMemoSyntax(text).logicalExpressions.map(expression => readLogicalExpression(text, expression)), [
    { group: { and: ['3.5', '9.8'] } }
  ]);
});

test('relation columns and slash-separated statements keep their grouped expressions independent', () => {
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  const text = 'a;[b=c],[d=e]/f:[g=h]';
  const parsed = parseReviewMemoSyntax(text);
  assert.deepEqual(parsed.relationSeparators, [text.indexOf('/')]);
  assert.deepEqual(parsed.logicalExpressions.map(expression => readLogicalExpression(text, expression)), [
    { and: [{ group: { or: ['b', 'c'] } }, { group: { or: ['d', 'e'] } }] }, { group: { or: ['g', 'h'] } }
  ]);
  const child = 'a:b\nc:d';
  const inherited = parseReviewMemoSyntax(child, 'or');
  assert.deepEqual(inherited.logicalOperators, [{ index: 3, operator: 'or' }]);
  assert.deepEqual(inherited.logicalExpressions, []);
});

test('editing an OR parent to AND or plain text repairs inherited operators without replacing any note IDs', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: 'a;', text: 'b\nc' }]);
  const original = memoDocument.reviewMemoDocumentFromText(memo);
  const conjunction = memoDocument.resolveReviewMemoDocument(memo.replace('a;', 'a:'), original);
  assert.equal(conjunction.nodes[0].childrenRelation.operator, 'and');
  assert.deepEqual(conjunction.nodes[1].logicalOperators, [{ index: 1, operator: 'and' }]);
  const plain = memoDocument.resolveReviewMemoDocument(memo.replace('a;', 'a'), conjunction);
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
  const original = memoDocument.reviewMemoDocumentFromText('[a=b],[c=d]');
  const plain = memoDocument.resolveReviewMemoDocument('ab cd', original);
  assert.equal(plain.nodes[0].logicalExpressions, undefined);
  assert.equal(plain.nodes[0].logicalOperators, undefined);
  assert.equal(plain.nodes[0].id, original.nodes[0].id);
  const text = '[a=b\nc;d=e';
  const unfinished = memoDocument.resolveReviewMemoDocument(text, plain);
  assert.equal(memoDocument.reviewMemoDocumentToText(unfinished), text);
  assert.deepEqual(unfinished.nodes[0].logicalOperators, [{ index: text.lastIndexOf('='), operator: 'or' }]);
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
  assert.deepEqual(updated.childrenRelation, { separatorIndex: 2, operator: 'and', type: 'part' });
  assert.deepEqual(moved.nodes.find(node => node.parentId === source.id).logicalOperators, [{ index: 2, operator: 'and' }]);
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
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차:', text: '엔진\n타이어 / 문:전기=가솔린' }]);
  const document = memoDocument.reviewMemoDocumentFromText(memo);
  const changedText = memo.replace('자동차:', '자동차:교통수단').replace(' / ', ' ');
  const changed = memoDocument.resolveReviewMemoDocument(changedText, document);
  assert.deepEqual(changed.nodes.map(node => node.id), document.nodes.map(node => node.id));
  assert.equal(changed.nodes[0].childrenRelation, undefined);
  assert.equal(changed.nodes[1].relationSeparators, undefined);
  assert.deepEqual(changed.nodes[1].logicalOperators, [{ index: changed.nodes[1].text.indexOf('='), operator: 'or' }]);
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
  const early = buildDueReviewGroups(logs, subjects, now + 2 * hour).filter(group => group.isGateRetry);
  assert.equal(early.length, 2);
  assert.equal(early.find(group => group.subjectId === 'main').logs.length, 1);
  const later = buildDueReviewGroups(logs, subjects, now + 14 * day).filter(group => group.isGateRetry);
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
  const original = source({ reviewStep: 3, reviewMemo: '[alpha] label; beta / other; gamma' });
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
  const text = 'a:{원인} b:c / x:[y:{구체:원인/조건,[추가]}z:q]:r';
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
  const memo = 'a:{원인}b:{결과}c:d / x:[y:{방법}z:q]:r';
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
  const memo = ':::toggle a:{구성}\nb\nc\n:::end';
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
  const descendant = questionsFor(':::toggle a:{설명} b:\nc;d\n:::end').find(q => q.kind === 'direct' && q.prompt === 'c');
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
  const hidden = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question: direct, criterion: '개념:정의', revealed: false }));
  const answerField = hidden.match(/data-question-field="answer"[\s\S]*?<\/div>/)[0];
  assert.ok(answerField.includes('원인') && !hidden.includes('{원인}') && !answerField.includes('정의'));
  assert.ok(!hidden.includes('>b<'));
});

test('empty, unfinished, misplaced and multiline braces do not corrupt ordinary note text', () => {
  const empty = questionsFor('a:{} b:c').find(q => q.kind === 'direct' && q.prompt === 'a');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의', empty).answer, []);
  assert.deepEqual(memoColors.splitReviewMemoColonColors('a:{} b:c').filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0]);
  for (const memo of ['a:{미완성', 'a;{원인} b', 'a:b {원인}', 'a:{원인\nb:c']) {
    assert.equal(gate.parseReviewGateMemo(memo).parts.map(p => p.text).join(''), memo);
    assert.equal(memoColors.splitReviewMemoColonColors(memo).map(p => p.text).join(''), memo);
  }
  assert.equal(questionsFor('a;{원인} b')[0].answer, 'b');
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
  const memo = ':::toggle A:{B}C:D\nG:H;J\n:::end';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  const first = questions.find(q => q.kind === 'direct' && q.prompt === 'G');
  const next = questions.find(q => q.kind === 'direct' && q.prompt === 'H');
  assert.deepEqual(classify(first), { prompt: ['개념'], answer: ['B'], conditions: [['개념', 'B', '원인']] });
  assert.deepEqual(classify(next), { prompt: ['B'], answer: ['원인'], conditions: [['개념', 'B', '원인']] });
  assert.deepEqual(classify(questions.find(q => q.kind === 'reverse' && q.prompt === 'H')).answer, ['개념']);
  assert.ok(!questions.some(q => q.kind === 'reverse' && q.prompt === 'J'));
  assert.deepEqual(classify(questions.find(q => q.kind === 'reconstruct' && q.prompt === 'G')).answer, ['B', '원인']);
  assert.ok(questions.every(q => ![q.prompt, q.answer, ...q.conditions].some(text => /[{}]/.test(text))));
});

test('semicolon annotations share override parsing, literal preservation, OR children and one-way questions', () => {
  const memo = 'a;{원인:조건/구분,[보충]} b,c;d';
  const questions = questionsFor(memo);
  const first = questions.find(q => q.kind === 'direct' && q.prompt === 'a');
  assert.equal(first.answer, 'b AND c');
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('개념:정의', first).answer, ['원인:조건/구분,[보충]']);
  assert.ok(!questions.some(q => q.kind === 'reverse'));
  assert.deepEqual(memoColors.splitReviewMemoColonColors(memo).filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0]);
  const syntax = loadSource('utils/reviewMemoLogic.ts').parseReviewMemoSyntax(memo);
  assert.deepEqual(syntax.relationSeparators, []);
  assert.deepEqual(syntax.logicalExpressions.map(e => readLogicalExpression(memo, e)), [{ and: ['b', 'c'] }]);
  const toggle = ':::toggle a;{대안}\nb\nc\n:::end';
  const document = memoDocument.reviewMemoDocumentFromText(toggle);
  assert.equal(document.nodes[0].childrenRelation.operator, 'or');
  assert.equal(questionsFor(toggle).find(q => q.kind === 'direct').answer, 'b OR c');
});

test('custom classifications flow through multiple toggle generations without leaking to a sibling branch', () => {
  const memo = ':::toggle A:{B}C:D\n:::toggle E:F\nK:L;M\n:::end\n:::end\n:::toggle X:Y\nS:T;U\n:::end';
  const questions = questionsFor(memo);
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, ['B']);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'L')).answer, ['원인']);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'S')).answer, ['원인']);
  assert.ok(!classify(questions.find(q => q.kind === 'direct' && q.prompt === 'S')).conditions.flat().includes('B'));
});

test('nearest explicit override wins, including empty overrides, while sibling children keep their parent label', () => {
  const memo = ':::toggle A:{B}C:D\n:::toggle E;{X}F:G\nK:L;M\n:::end\nP:Q;R\n:::end';
  const classify = q => questionBuilder.getReviewQuestionClassification('개념:원인', q);
  const questions = questionsFor(memo);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, ['X']);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'L')).answer, ['원인']);
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'P')).answer, ['B']);
  const cleared = questionsFor(memo.replace('{X}', '{}'));
  assert.deepEqual(classify(cleared.find(q => q.kind === 'direct' && q.prompt === 'K')).answer, []);
  assert.deepEqual(classify(cleared.find(q => q.kind === 'direct' && q.prompt === 'L')).answer, ['원인']);
});

test('inherited classifications also reach nested relations, partial facts, sequence stages and contextual targets', () => {
  const memo = ':::toggle A;{B}C:D\nG:[H:I];J\nP;[읽기-정리-확인],[예제=문제]\n:::end';
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
  const context = questions.find(q => q.kind === 'context' && q.answer === 'I');
  assert.deepEqual(classify(context).answer, ['B']);
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
    let text = '말단;정답;상세';
    for (let depth = 7; depth >= 0; depth -= 1) {
      const custom = depth === 2 ? `{${override}}` : depth === 0 ? '{최상위분류}' : '';
      text = `:::toggle 단계${depth};${custom}조건${depth}:기준${depth}\n${text}\n${depth === 0 ? '형제;답;근거\n' : ''}:::end`;
    }
    return text + '\n바깥;값;설명';
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
  const memo = ':::toggle 전체:{관점}공통:기준\n:::toggle 중간;{세부}연결:설명\n질문;정답전용값\n:::end\n:::end';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '질문');
  const render = revealed => renderToStaticMarkup(React.createElement(ReviewQuestionContent, { memo, question, criterion: '개념:원인', revealed }));
  const hidden = render(false);
  assert.ok(!hidden.includes('<aside') && !hidden.includes('data-question-answer-placeholder'));
  assert.match(hidden, /flex flex-col items-center gap-5/);
  assert.ok(hidden.indexOf('전체:공통:기준') < hidden.indexOf('data-question-field="prompt"'));
  assert.ok(!hidden.includes('정답전용값'));
  assert.ok(render(true).includes('정답전용값'));
});

test('nested questions reset classification columns while retaining classified ancestor conditions', () => {
  const questions = questionsFor('a:[b:c]=[d:c]');
  const classify = question => questionBuilder.getReviewQuestionClassification('대상:설명:예시', question);
  const inner = questions.find(q => q.kind === 'direct' && q.prompt === 'b');
  assert.deepEqual(classify(inner), { prompt: ['대상'], answer: ['설명'], conditions: [['대상']] });
  assert.deepEqual(classify(questions.find(q => q.kind === 'direct' && q.prompt === 'a')).answer, ['설명']);
  const context = questions.find(q => q.kind === 'context' && q.conditions.includes('b'));
  assert.deepEqual(classify(context), { prompt: ['대상'], answer: ['설명'], conditions: [['대상']] });
});

test('all sequence stages and partial logical facts keep their containing classification column', () => {
  const criterion = '대상;과정:보충';
  const questions = questionsFor('학습;[읽기-정리-확인],[문제=예제]');
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

test('toggle titles carry their own column classifications through multiple ancestors', () => {
  const memo = ':::toggle 상위:설명:\n:::toggle 중간:\n값:뜻\n:::end\n:::end';
  const question = questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === '값');
  assert.deepEqual(question.conditions, ['상위:설명', '중간']);
  assert.deepEqual(questionBuilder.getReviewQuestionClassification('대상:정의:예시', question), {
    prompt: ['대상'], answer: ['정의'], conditions: [['대상', '정의'], ['대상']]
  });
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
  const hidden = render(false);
  const shown = render(true);
  assert.match(hidden, /data-question-field="prompt"[\s\S]*>설명<\/p>[\s\S]*>beta<\/p>/);
  assert.match(hidden, /data-question-field="answer"[\s\S]*>예시<\/p>/);
  assert.ok(!hidden.includes('gamma'));
  assert.ok(shown.includes('gamma'));
  const changed = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question,
    criterion: '개념:의미:활용', revealed: false, memo }));
  assert.ok(changed.includes('>의미</p>') && changed.includes('>활용</p>'));
  assert.ok(!changed.includes('>설명</p>'));
  assert.equal(questionsFor(memo).find(q => q.kind === 'direct' && q.prompt === 'beta').key, question.key);
});

test('fallback note recall still renders the full note and its global criterion', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { ReviewQuestionContent } = loadSource('components/ReviewQuestionContent.tsx');
  const memo = '기호가 없는 정리 내용';
  const question = questionsFor(memo)[0];
  const html = renderToStaticMarkup(React.createElement(ReviewQuestionContent, { question,
    criterion: '대상:설명', revealed: true, memo }));
  assert.ok(html.includes('data-review-note-summary') && html.includes(memo));
  assert.ok(html.includes('data-classification-criterion') && html.includes('대상:설명'));
});

test('equals is OR everywhere while periods, decimals and spaces stay literal', () => {
  const memo = 'a:[b=c],[d=e] / n;3.5 / sentence;first. second.';
  const direct = questionsFor(memo).filter(q => q.kind === 'direct');
  assert.deepEqual(direct.map(q => q.answer), ['3.5', 'first. second.', '(b OR c) AND (d OR e)']);
  const { parseReviewMemoSyntax } = loadSource('utils/reviewMemoLogic.ts');
  for (const text of ['a.b', 'a. b', '[a.b.]', 'a;b.c']) assert.deepEqual(parseReviewMemoSyntax(text).logicalOperators, []);
});

test('nested relation columns reset priority and outer relations use only branch heads', () => {
  const direct = questionsFor('a:[b:c]=[d:c]').filter(q => q.kind === 'direct');
  assert.deepEqual(direct.map(q => [q.prompt, q.answer, q.priority]), [['b', 'c', 1], ['d', 'c', 1], ['a', 'b OR d', 1]]);
  assert.deepEqual(direct[0].conditions, ['a']);
  assert.deepEqual(direct[1].conditions, ['a']);
  const colored = memoColors.splitReviewMemoColonColors('a:[b:c]=[d:c]:e / f:g');
  assert.deepEqual(colored.filter(p => p.colonIndex !== undefined).map(p => p.colonIndex), [0, 0, 0, 1, 0]);
});

test('flat and nested chains sort first columns before later columns and more supplied context first', () => {
  const direct = questionsFor('a:b:c / x:[y:z:q]').filter(q => q.kind === 'direct');
  assert.deepEqual(direct.map(q => [q.prompt, q.answer, q.priority]), [['y', 'z', 1], ['a', 'b', 1], ['x', 'y', 1], ['z', 'q', 2], ['b', 'c', 2]]);
});

test('whole reconstruction includes nested relations instead of repeating the easy branch-head answer', () => {
  const nested = questionsFor('a:[b:c]=[d:c]');
  assert.equal(nested.find(q => q.kind === 'direct' && q.prompt === 'a').answer, 'b OR d');
  assert.equal(nested.find(q => q.kind === 'reconstruct').answer, '(b → c) OR (d → c)');
  assert.equal(questionsFor('a:[b:c]:d').find(q => q.kind === 'reconstruct').answer, 'b → c → d');
  assert.ok(!questionsFor('a:[b=c],[d=e]').some(q => q.kind === 'reconstruct'));
});

test('reverse questions with identical conditions collect valid alternatives instead of asking an ambiguous duplicate', () => {
  const reversed = questionsFor('a:[b:c]=[d:c]').filter(q => q.kind === 'reverse' && q.prompt === 'c');
  assert.equal(reversed.length, 1);
  assert.equal(reversed[0].answer, 'b OR d');
  assert.deepEqual(reversed[0].conditions, ['a']);
  const separate = questionsFor('x:[b:c] / y:[d:c]').filter(q => q.kind === 'reverse' && q.prompt === 'c');
  assert.equal(separate.length, 2);
});

test('AND partial questions retain OR alternatives and do not confuse one alternative with all requirements', () => {
  const partial = questionsFor('a:[b=c],[d=e]').filter(q => q.kind === 'remaining');
  assert.deepEqual(partial.map(q => [q.conditions, q.answer]), [
    [['b 충족'], 'd OR e'], [['c 충족'], 'd OR e'], [['d 충족'], 'b OR c'], [['e 충족'], 'b OR c']
  ]);
  assert.equal(questionsFor('a:b=c').filter(q => q.kind === 'remaining').length, 0);
});

test('sequence notation preserves order inside nested AND and OR groups when saved and reloaded', () => {
  const text = '과정;[a-b-c],[d=[e-f]]';
  const document = memoDocument.reviewMemoDocumentFromText(text);
  const expression = document.nodes[0].logicalExpressions[0];
  assert.deepEqual(readLogicalExpression(text, expression), { and: [
    { group: { sequence: ['a', 'b', 'c'] } },
    { group: { or: ['d', { group: { sequence: ['e', 'f'] } }] } }
  ] });
  const restored = memoDocument.resolveReviewMemoDocument(text, JSON.parse(JSON.stringify(document)));
  assert.deepEqual(restored, document);
  assert.equal(memoDocument.reviewMemoDocumentToText(restored), text);
  const flat = 'a-b,c=d-e';
  assert.deepEqual(loadSource('utils/reviewMemoLogic.ts').parseReviewMemoSyntax(flat).logicalExpressions.map(e => readLogicalExpression(flat, e)), [
    { or: [{ and: [{ sequence: ['a', 'b'] }, 'c'] }, { sequence: ['d', 'e'] }] }
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

test('deep logical residuals span multiple layers and remove already satisfied alternative branches', () => {
  const partial = questionsFor('성립;[a=b],[c=[d,e]]').filter(q => q.kind === 'remaining');
  const find = conditions => partial.find(q => JSON.stringify(q.conditions) === JSON.stringify(conditions));
  assert.equal(find(['a 충족', 'd 충족']).answer, 'c OR e');
  assert.equal(find(['a 충족', 'e 충족']).answer, 'c OR d');
  assert.equal(find(['d 충족', 'e 충족']).answer, 'a OR b');
  assert.ok(find(['a 충족', 'd 충족']).difficulty < find(['a 충족']).difficulty);
  assert.ok(find(['a 충족', 'd 충족']).level < find(['a 충족']).level);
  assert.equal(find(['c 충족', 'd 충족']), undefined);
  assert.equal(find(['a 충족', 'b 충족']), undefined);
  assert.ok(partial.every(q => q.answer.trim() && !q.answer.includes('undefined')));
});

test('OR of nested conjunctions produces cross-branch residual questions at four layers', () => {
  const partial = questionsFor('성립;[[a=b],[c=d]]=[e,[f=g]]').filter(q => q.kind === 'remaining');
  assert.equal(partial.find(q => q.conditions.join('|') === 'a 충족|e 충족').answer, 'c OR d OR f OR g');
  assert.equal(partial.find(q => q.conditions.join('|') === 'c 충족|g 충족').answer, 'a OR b OR e');
  const deeper = questionsFor('성립;[a=b],[c=[d,[e=[f,g]]]]').filter(q => q.kind === 'remaining');
  assert.equal(deeper.find(q => q.conditions.join('|') === 'a 충족|d 충족|f 충족').answer, 'c OR e OR g');
});

test('ordered branches only supply completed prefixes while mixed alternatives remain available', () => {
  const partial = questionsFor('학습;[읽기-정리-확인],[문제=[예제-점검]]').filter(q => q.kind === 'remaining');
  const find = conditions => partial.find(q => q.conditions.join('|') === conditions.join('|'));
  assert.equal(find(['읽기 충족', '정리 충족', '문제 충족']).answer, '확인');
  assert.equal(find(['읽기 충족', '문제 충족']).answer, '정리 → 확인');
  assert.equal(find(['읽기 충족', '정리 충족', '확인 충족', '예제 충족']).answer, '문제 OR 점검');
  for (const question of partial) {
    if (question.conditions.includes('정리 충족')) assert.ok(question.conditions.includes('읽기 충족'));
    if (question.conditions.includes('확인 충족')) assert.ok(question.conditions.includes('정리 충족'));
    if (question.conditions.includes('점검 충족')) assert.ok(question.conditions.includes('예제 충족'));
  }
});

test('nested sequence stages retain parent toggle conditions and reset local relation priority', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '상위:', text: '학습;[a-[b:c]-d],[e=f]' }]);
  const questions = questionsFor(memo);
  assert.deepEqual(questions.find(q => q.kind === 'order-next' && q.prompt === 'a').conditions, ['상위', '학습']);
  const nested = questions.find(q => q.kind === 'direct' && q.prompt === 'b');
  assert.deepEqual(nested.conditions, ['상위', '학습', 'a 이후']);
  assert.equal(nested.priority, 1);
  assert.equal(questions.find(q => q.kind === 'order-reconstruct').answer, '(b → c) → d');
});

test('partial-question enumeration stays bounded for large notes without changing unrelated keys', () => {
  const memo = '성립;' + Array.from({ length: 20 }, (_, i) => `a${i}`).join(',');
  const questions = questionsFor(memo);
  assert.equal(questions.filter(q => q.kind === 'remaining').length, 64);
  const simple = questionsFor('x;y')[0];
  assert.equal(questionsFor(memo + ' / x;y').find(q => q.kind === 'direct' && q.prompt === 'x').key, simple.key);
  const original = questionsFor('a-b-c').map(q => q.key);
  assert.deepEqual(questionsFor('x;y / a-b-c').filter(q => q.kind.startsWith('order-')).map(q => q.key), original);
});

test('toggle children fill an empty colon with AND and an empty semicolon with OR', () => {
  for (const [separator, joiner] of [[':', 'AND'], [';', 'OR']]) {
    const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: `자동차${separator}`, text: '엔진\n타이어\n문' }]);
    const direct = questionsFor(memo).filter(q => q.kind === 'direct');
    assert.deepEqual(direct.map(q => q.answer), [`엔진 ${joiner} 타이어 ${joiner} 문`]);
  }
});

test('ancestor conditions come from the actual toggle path and do not leak a sibling context', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([
    { type: 'toggle', title: '자동차:', text: reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '엔진:', text: '전기;모터' }]) },
    { type: 'toggle', title: '자전거:', text: '페달;회전' }
  ]);
  const questions = questionsFor(memo);
  assert.deepEqual(questions.find(q => q.kind === 'direct' && q.prompt === '전기').conditions, ['자동차', '엔진']);
  assert.deepEqual(questions.find(q => q.kind === 'context' && q.answer === '모터').conditions, ['엔진', '전기']);
  assert.deepEqual(questions.find(q => q.kind === 'direct' && q.prompt === '페달').conditions, ['자전거']);
  assert.ok(!questions.some(q => q.kind === 'reverse' && q.prompt === '모터'));
});

test('semantic question keys survive an unrelated insertion but change with an answer', () => {
  const a = questionsFor('a:b')[0];
  const moved = questionsFor('x:y / a:b').find(q => q.kind === 'direct' && q.prompt === 'a');
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
  const questions = questionsFor('a;b,c,d');
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

test('all local first relations precede later relations despite larger recall requirements', () => {
  const questions = questionsFor('a:[b,c,d]:e-f-g');
  const later = questions.filter(q => q.priority === 2);
  assert.ok(later.some(q => q.kind === 'order-next'));
  assert.ok(questions.filter(q => q.kind.startsWith('order-')).every(q => q.priority === 2));
  const first = questions.filter(q => q.priority === 1);
  assert.ok(Math.max(...first.map(q => q.difficulty)) > Math.min(...later.map(q => q.difficulty)));
  assert.ok(questions.indexOf(first.at(-1)) < questions.indexOf(later[0]));
});

test('ancestor conditions keep source offsets and are counted only once in contextual questions', () => {
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '  parent:detail  ', text: 'child;answer' }]);
  const built = questionBuilder.buildReviewQuestions(memo);
  const direct = built.questions.find(q => q.kind === 'direct' && q.prompt === 'child');
  const context = built.questions.find(q => q.kind === 'context');
  const text = span => built.nodes.find(node => node.id === span.nodeId).text.slice(span.start, span.end);
  assert.deepEqual(direct.conditionSpans.flat().map(text), ['parent', 'detail']);
  assert.deepEqual(context.promptSpans.map(text), ['parent', 'detail']);
  assert.equal(direct.providedUnits, 3);
  assert.equal(context.providedUnits, 3);
  assert.equal(direct.difficulty, context.difficulty);
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

test('clean easy rounds unlock progressively larger recall while preserving stable schedule keys', () => {
  const memo = 'a;b,c,d';
  const questions = questionsFor(memo);
  const catalog = questions.map(q => ({ ...q, id: q.key, logId: 'a' }));
  let state = practice.startReviewPractice(catalog);
  const levels = [];
  while (state.queue.length) {
    levels.push(catalog.find(q => q.id === state.queue[0]).level);
    state = practice.gradeReviewPractice(state, catalog, true);
  }
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  assert.equal(state.completed.length, catalog.length);
  assert.deepEqual(questionsFor('x;y / ' + memo).filter(q => q.prompt === 'a').map(q => q.key), questions.map(q => q.key));
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

test('difficulty unlock uses first attempts: 80 percent passes but eventual correction alone does not', () => {
  const catalog = [1, 2, 3, 4, 5].map(i => ({ id: String(i), logId: 'a', level: 1, priority: 1 }));
  catalog.push({ id: 'hard', logId: 'a', level: 2, priority: 1 });
  for (const wrongCount of [1, 2]) {
    let state = practice.startReviewPractice(catalog);
    for (let i = 0; i < 5; i++) state = practice.gradeReviewPractice(state, catalog, i >= wrongCount);
    assert.ok(!state.queue.includes('hard'));
    for (let i = 0; i < wrongCount; i++) state = practice.gradeReviewPractice(state, catalog, true);
    assert.deepEqual(state.queue, wrongCount === 1 ? ['hard'] : []);
  }
});

test('missing intermediate question types do not prevent unlocking a contextual third level', () => {
  const catalog = [{ id: 'easy', logId: 'a', level: 1, priority: 1 }, { id: 'hard', logId: 'a', level: 3, priority: 1 }];
  const state = practice.gradeReviewPractice(practice.startReviewPractice(catalog), catalog, true);
  assert.deepEqual(state.queue, ['hard']);
  assert.equal(state.unlocked.a, 3);
});

test('merged note sessions do not award another note a higher level from someone else correct answers', () => {
  const catalog = ['a', 'b'].flatMap(logId => [1, 2].map(level => ({ id: logId + level, logId, level, priority: 1 })));
  let state = practice.startReviewPractice(catalog);
  for (const correct of [false, true, true]) state = practice.gradeReviewPractice(state, catalog, correct);
  assert.deepEqual(state.queue, ['b2']);
  assert.equal(state.unlocked.a, undefined);
  assert.equal(state.unlocked.b, 2);
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
  const original = source({ reviewMemo: 'a;b / c;d' });
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
  const original = source({ reviewMemo: 'a;b / c;d', reviewQuestionFormat: 2 });
  const keys = gate.getReviewGateQuestionKeys(original.reviewMemo);
  original.reviewQuestionSchedules = { [keys[0]]: { reviewStep: 3, nextReviewDate: new Date(now + 8 * day).toISOString() } };
  const graded = gate.applyReviewGateOutcomes([original], [{ logId: original.id, passed: true, wrongQuestionKeys: [], completedQuestionKeys: [keys[1]],
    questionResults: { [keys[1]]: { wrongCount: 0, attempts: 1 } }
  }], false, now)[0];
  const finished = gate.completeRegularReviewSchedule(graded, now);
  assert.deepEqual(finished.reviewQuestionSchedules[keys[0]], original.reviewQuestionSchedules[keys[0]]);
});

test('saved wrong rounds roll back only their own question and resume growing from the lowered step', () => {
  const original = source({ reviewMemo: 'a;b / c;d', reviewQuestionFormat: 2 });
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
  const memo = reviewMemo.serializeReviewMemoBlocks([{ type: 'toggle', title: '자동차', text: '엔진;아주 길고 자세한 동력 발생 장치\n기타 메모' }]);
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
  const short = '엔진;힘';
  const shortHtml = renderToStaticMarkup(React.createElement(noteSummary.ReviewNoteSummary, { memo: short, maskedKeys: [questionsFor(short)[0].key] }));
  assert.equal(shortHtml.match(/data-answer-blank="true" class="([^"]+)"/)[1], html.match(/data-answer-blank="true" class="([^"]+)"/)[1]);
});

test('masking respects occurrence offsets: an identical word used as a condition elsewhere stays visible', () => {
  const memo = 'a;b / b;c';
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

test('today task selector defaults to the highest priority review without starting a measurement', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const previousStorage = global.localStorage;
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const html = renderToStaticMarkup(React.createElement(SessionLogger, {
      logs: [source({ reviewSubjectIdsSnapshot: [], nextReviewDate: new Date(0).toISOString() })],
      subjects, activeWeekday: 0, activeStudyDate: '2026-10-11', detailSubjectId: '',
      onDetailSubjectChange() {}, renderSummary: selector => React.createElement('section', { id: 'summary' }, selector),
      onLogSession() {}, onReviewAction() {}, onAdvanceReviewSubject() {}, onRecordReviewSubjectTime() {},
      onUpdateReviewMemo() {}, onFinishReviewGate() {}, onClearReviewGateRetries() {}
    }));
    assert.match(html, /<label[^>]*for="today-task-select"[^>]*>오늘 할 일<\/label>/);
    assert.match(html, /<option[^>]*value="review-[^"]+"[^>]*selected=""/);
    assert.ok(html.includes('복습 시작'));
    assert.ok(!html.includes('직접 선택'));
    assert.ok(!html.includes('요일 할 일'));
    assert.ok(!html.includes('학습 시간 측정'));
  } finally {
    global.localStorage = previousStorage;
  }
});

test('today task selector has an empty state and no start button when nothing is due', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const previousStorage = global.localStorage;
  global.localStorage = { getItem: () => null, setItem() {} };
  try {
    const html = renderToStaticMarkup(React.createElement(SessionLogger, {
      logs: [], subjects: [], activeWeekday: 0, activeStudyDate: '2026-10-11', detailSubjectId: '',
      onDetailSubjectChange() {}, renderSummary: selector => selector,
      onLogSession() {}, onReviewAction() {}, onAdvanceReviewSubject() {}, onRecordReviewSubjectTime() {},
      onUpdateReviewMemo() {}, onFinishReviewGate() {}, onClearReviewGateRetries() {}
    }));
    assert.ok(html.includes('오늘 할 일이 없습니다.'));
    assert.match(html, /<select[^>]*disabled=""/);
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

test('completed subject weekly totals include only the last seven dates and do not include unfinished subjects', () => {
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
  assert.equal(rows[0].weeklyPages, 13);
  assert.equal(rows[0].weeklyMinutes, 26);
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
  assert.equal(basic.weeklyPages, 3);
  assert.equal(basic.weeklyMinutes, 6);
  const review = rows.find(row => row.subjectId === 'review');
  assert.equal(review.weeklyPages, 5);
  assert.equal(review.weeklyMinutes, 14);
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

test('completed record rows show weekly time and pages and hide the removed detail statistics', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const html = renderToStaticMarkup(React.createElement(TodaySummary, {
    logs: [{ id: 'done', subjectId: 'deadline', studyDate: '2026-10-12', timestamp: planningToday.toISOString(), pagesRead: 10, timeSpentMinutes: 20 }],
    subjects: [shortPlanSubject({ completedPages: 10 })], completedStudySubjectIds: ['deadline'],
    detailSubjectId: 'deadline', activeWeekday: 1, activeStudyDate: '2026-10-12',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}
  }));
  assert.ok(html.includes('완료된 기록'));
  assert.ok(html.includes('최근 7일'));
  assert.ok(html.includes('20분 · 10P'));
  assert.ok(!html.includes('실시간 기록'));
  assert.ok(!html.includes('하루 평균 공부량'));
  assert.ok(!html.includes('최근 한 달'));
});

const reviewChainSubjects = [
  { id: 'parent', name: 'Parent', startPage: 1, totalPages: 100, completedPages: 10,
    targetDate: '2026-12-31', reviewSubjectIds: ['first', 'second'] },
  { id: 'first', name: 'First', startPage: 20, totalPages: 200, completedPages: 19, targetDate: '2026-12-31' },
  { id: 'second', name: 'Second', startPage: 30, totalPages: 300, completedPages: 29, targetDate: '2026-12-31' }
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
  assert.ok(html.includes('review-speed-growth') && html.includes('+50.0%'));
  assert.match(html, /이번 복습 증가율<\/p><p[^>]*>측정 필요<\/p>/);
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
  assert.ok(rows.every(row => row.weeklyPages === 15 && row.weeklyMinutes === 42));
});

test('today selector is above completed records, with compact pomodoro and both growth metrics below progress', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const props = { logs: [], subjects: reviewChainSubjects.map(subject => subject.id === 'first'
    ? { ...subject, reviewGrowthDisplay: 'unit' } : subject), completedStudySubjectIds: [], detailSubjectId: 'first',
    taskSelector: '오늘 할 일 테스트', activeWeekday: 1, activeStudyDate: '2026-10-12',
    onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const empty = renderToStaticMarkup(React.createElement(TodaySummary, props));
  assert.ok(empty.indexOf('오늘 할 일 테스트') < empty.indexOf('완료된 기록'));
  assert.ok(empty.indexOf('다음 시작') < empty.indexOf('학습 진척도'));
  assert.ok(empty.indexOf('학습 진척도') < empty.indexOf('뽀모도로'));
  assert.ok(empty.indexOf('뽀모도로') < empty.indexOf('전체 효율'));
  assert.ok(empty.indexOf('전체 효율') < empty.indexOf('타임어택 효율'));
  assert.ok(empty.includes('grid grid-cols-2'));
  assert.ok((empty.match(/측정 필요/g) || []).length >= 2);
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  const logs = recordReviewMeasurement([chainLog()], ['source'], 'first', 10, true,
    '2026-10-12T03:00:00Z', measurement('done', 5, 3));
  const filled = renderToStaticMarkup(React.createElement(TodaySummary, { ...props, logs, subjects: reviewChainSubjects }));
  assert.equal((filled.match(/\+50.0%/g) || []).length, 3);
  assert.ok(filled.includes('5P'));
  assert.ok(filled.includes('10분'));
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
  assert.ok(html.indexOf('완료된 기록') < html.indexOf('학습 진척도'));
  assert.ok(html.indexOf('학습 진척도') < html.indexOf('뽀모도로'));
  assert.ok(html.includes('25'));
  assert.ok(html.includes('2회'));
  assert.ok(!html.includes('남은 시간'));
  const changed = renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    pomodoroPlan: { subjectId: 'first', minutes: 25, pages: 5, remainingTaskPages: 20 } }));
  assert.ok(changed.includes('4회') && !changed.includes('5P'));
});

test('measurement page goal and elapsed time turn bright yellow together only above the goal', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MeasurementProgress } = loadSource('components/SessionLogger.tsx');
  const normal = renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 10, target: 10, elapsed: '25:00' }));
  assert.ok(normal.includes('10 / 10P'));
  assert.ok(!normal.includes('text-yellow-300'));
  const exceeded = renderToStaticMarkup(React.createElement(MeasurementProgress, { pages: 11, target: 10, elapsed: '27:30' }));
  assert.equal((exceeded.match(/text-yellow-300/g) || []).length, 4);
  assert.ok(exceeded.includes('11 / 10P'));
  assert.ok(exceeded.includes('이번 측정'));
  assert.ok(exceeded.includes('경과 시간'));
  assert.ok(exceeded.includes('27:30'));
});

test('per-page time attack counts seconds while pomodoro remaining pages decrease independently', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PageTimeAttack } = loadSource('components/SessionLogger.tsx');
  const { getPomodoroRemainingPages } = loadSource('utils/measurement.ts');
  for (const [solved, remaining] of [[0, 5], [1, 4], [5, 0], [8, 0]]) {
    assert.equal(getPomodoroRemainingPages(5, solved), remaining);
  }
  assert.equal(getPomodoroRemainingPages(null, 1), null);
  const first = renderToStaticMarkup(React.createElement(PageTimeAttack,
    { remainingSeconds: 125, targetSeconds: 125, remainingPages: 5 }));
  const next = renderToStaticMarkup(React.createElement(PageTimeAttack,
    { remainingSeconds: 124, targetSeconds: 125, remainingPages: 4 }));
  assert.ok(first.includes('타임어택') && first.includes('02:05'));
  assert.ok(next.includes('02:04') && next.includes('남은 장수 4P'));
  assert.ok(!next.includes('남은 시간') && !next.includes('25:00'));
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
      assert.equal(row.weeklyPages, 4);
      assert.equal(row.weeklyMinutes, 50);
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
    assert.equal(rows[0].weeklyPages, 5);
    assert.equal(rows[0].weeklyMinutes, 25);
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
  assert.ok(html.includes('뽀모도로') && html.includes('25분') && html.includes('5회'));
  assert.ok(!html.includes('5P'));
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
  rows.forEach(row => assert.equal(row.weeklyMinutes, 20));
  assert.equal(logs[0].reviewSubjectTimeRecords[0].timeAttackMinutes, 12);
  assert.equal(logs[0].reviewSubjectTimeRecords[0].organizationMinutes, 8);
});

test('page units split oldest-first and weight each portion by its own measured per-page time', () => {
  const { calculatePageUnitGrowth } = loadSource('utils/pageGrowth.ts');
  const samples = [
    source({ id: 'recent', pagesRead: 5, timeSpentMinutes: 5, timestamp: '2026-10-12T04:00:00Z' }),
    source({ id: 'old', pagesRead: 12, timeSpentMinutes: 60, timestamp: '2026-09-01T04:00:00Z' }),
    source({ id: 'middle', pagesRead: 8, timeSpentMinutes: 16, timestamp: '2026-10-10T04:00:00Z' })
  ];
  const before = JSON.stringify(samples);
  const growth = calculatePageUnitGrowth(samples, 'main', 10, 1);
  assert.deepEqual(growth.units.map(unit => [unit.pages, unit.minutes, unit.complete]), [[10, 50, true], [10, 26, true], [5, 5, false]]);
  assert.equal(growth.current.averageTimePerPage, 1);
  assert.equal(growth.reference.averageTimePerPage, 2.6);
  assert.equal(growth.speedChangePercent, 160);
  assert.equal(calculatePageUnitGrowth(samples, 'main', 10, 2).speedChangePercent, 400);
  assert.equal(JSON.stringify(samples), before);
});

test('partial unit growth updates with each new page and uses full time rather than attack time or endpoint gaps', () => {
  const { calculatePageUnitGrowth } = loadSource('utils/pageGrowth.ts');
  const old = source({ pagesRead: 10, timeSpentMinutes: 50, timeAttackMinutes: 10, timestamp: '2026-10-10T04:00:00Z' });
  const newLog = source({ id: 'new', pagesRead: 2, startPage: 100, endPage: 110, pageCountIsExplicit: true,
    timeSpentMinutes: 4, timeAttackMinutes: 1, timestamp: '2026-10-11T04:00:00Z' });
  const first = calculatePageUnitGrowth([old, newLog], 'main', 10);
  assert.equal(first.current.pages, 2);
  assert.equal(first.speedChangePercent, 150);
  const next = source({ id: 'next', pagesRead: 1, timeSpentMinutes: 5, timestamp: '2026-10-12T04:00:00Z' });
  const growth = calculatePageUnitGrowth([old, newLog, next], 'main', 10);
  assert.equal(growth.current.pages, 3);
  assert.equal(growth.current.averageTimePerPage, 3);
  assert.ok(Math.abs(growth.speedChangePercent - 66.6666666667) < 1e-8);
});

test('page unit changes rebucket history, keep only the final remainder, and reject invalid samples', () => {
  const { calculatePageUnitGrowth } = loadSource('utils/pageGrowth.ts');
  const samples = [source({ pagesRead: 25, timeSpentMinutes: 100 }),
    source({ subjectId: 'other', pagesRead: 100, timeSpentMinutes: 500 }),
    source({ pagesRead: 2, timeSpentMinutes: 0 }), source({ pagesRead: NaN }), source({ timestamp: 'invalid' })];
  const growth = calculatePageUnitGrowth(samples, 'main', 12);
  assert.deepEqual(growth.units.map(unit => unit.pages), [12, 12, 1]);
  assert.equal(growth.speedChangePercent, 0);
  assert.equal(calculatePageUnitGrowth(samples, 'main', 12, 3).speedChangePercent, null);
  assert.equal(calculatePageUnitGrowth([], 'main', 0).current, null);
  assert.deepEqual(calculatePageUnitGrowth([source({ pagesRead: 20, timeSpentMinutes: 80 })], 'main', 10).units.map(unit => unit.complete), [true, true]);
  const fraction = calculatePageUnitGrowth([source({ pagesRead: 12.5, timeSpentMinutes: 25 })], 'main', 10);
  assert.deepEqual(fraction.units.map(unit => unit.pages), [10, 2.5]);
});

test('review subjects respect the selected growth display without editing page units in execution', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const logs = [source({ subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 10, timeSpentMinutes: 50 }),
    source({ id: 'new', subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 5, timeSpentMinutes: 10, timestamp: '2026-10-12T04:00:00Z' })];
  const props = { logs, subjects: reviewChainSubjects, detailSubjectId: 'first', activeWeekday: 1, activeStudyDate: '2026-10-12',
    taskSelector: '오늘 할 일', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const original = renderToStaticMarkup(React.createElement(TodaySummary, props));
  assert.ok(original.includes('평균 속도 증가율') && original.includes('이번 복습 증가율'));
  assert.ok(!original.includes('효율 성장 비교'));
  const unit = renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    subjects: reviewChainSubjects.map(subject => subject.id === 'first' ? { ...subject, growthPageUnit: 10, reviewGrowthDisplay: 'unit' } : subject) }));
  assert.ok(!unit.includes('평균 속도 증가율'));
  assert.ok(unit.includes('unit-pages-remaining') && unit.includes('>5P</p>') && unit.includes('+150.0%'));
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
    assert.ok(html.includes(`aria-pressed="true"`) && html.includes('복습 증가율') && html.includes('페이지 단위 성장'));
    assert.ok(!html.includes('type="number"'));
    assert.equal(saved.completedPages, reviewChainSubjects[1].completedPages);
  }
});

test('review growth display switches between completion speed gains and page-unit growth including legacy allocations', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const { recordReviewMeasurement } = loadSource('utils/review.ts');
  let logs = [chainLog('old'), chainLog('new')];
  logs = recordReviewMeasurement(logs, ['old'], 'first', 20, true, '2026-10-11T04:00:00Z', measurement('old-review', 5, 3));
  logs = recordReviewMeasurement(logs, ['new'], 'first', 5, true, '2026-10-12T04:00:00Z', measurement('new-review', 5, 3));
  const props = { logs, detailSubjectId: 'first', activeWeekday: 1, activeStudyDate: '2026-10-12',
    taskSelector: '오늘 할 일', onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {} };
  const render = mode => renderToStaticMarkup(React.createElement(TodaySummary, { ...props,
    subjects: reviewChainSubjects.map(subject => subject.id === 'first'
      ? { ...subject, growthPageUnit: 5, reviewGrowthDisplay: mode } : subject) }));
  const review = render('review');
  assert.ok(review.includes('review-speed-growth') && review.includes('+87.5%') && review.includes('+200.0%'));
  assert.ok(!review.includes('unit-pages-remaining'));
  const unit = render('unit');
  assert.ok(unit.includes('unit-pages-remaining') && unit.includes('타임어택 효율'));
  assert.ok(!unit.includes('review-speed-growth'));
  assert.ok((unit.match(/\+300\.0%/g) || []).length >= 3);
  assert.ok(unit.includes('페이지 단위 성장'));
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
  const saved = JSON.parse(JSON.stringify({ ...subjects[0], growthPageUnit: 20, growthComparisonUnits: 2, reviewGrowthDisplay: 'unit' }));
  assert.deepEqual(normalizePageGrowthSettings(saved), { growthPageUnit: 20, growthComparisonUnits: 2, reviewGrowthDisplay: 'unit' });
  assert.deepEqual(normalizePageGrowthSettings({ ...subjects[0], growthPageUnit: 0, growthComparisonUnits: NaN }),
    { growthPageUnit: 10, growthComparisonUnits: 1, reviewGrowthDisplay: 'review' });
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
  assert.equal(math.calculateSubjectReviewAverageTimePerPage(recorded, 'main', 'practice'), 3);
  assert.equal(math.calculateReviewSpeedChanges(recorded, 'main', 'practice').latest, 100);
  assert.equal(math.calculateReviewTimeChangeAverage(recorded, 'main', 'practice', 2), -50);
  assert.deepEqual(math.calculateBasicReviewEfficiencyByNumber(recorded, 'main'), []);
});

test('overall and attack efficiency share the latest completed unit and ignore the unfinished tail as their timer basis', () => {
  const { calculateUnitEfficiency, calculatePageUnitGrowth } = loadSource('utils/pageGrowth.ts');
  const math = loadSource('utils/math.ts');
  const samples = [source({ pagesRead: 12, timeSpentMinutes: 60, timeAttackMinutes: 36, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'second', pagesRead: 8, timeSpentMinutes: 16, timeAttackMinutes: 8, timestamp: '2026-10-11T04:00:00Z' }),
    source({ id: 'tail', pagesRead: 5, timeSpentMinutes: 5, timeAttackMinutes: 2.5, timestamp: '2026-10-12T04:00:00Z' })];
  const result = calculateUnitEfficiency(samples, 10);
  assert.equal(result.basis.index, 2);
  assert.equal(result.averageTimePerPage, 2.6);
  assert.equal(result.timeAttackAverageTimePerPage, 1.4);
  assert.equal(math.calculateRecentTimedPageAverage(samples, 10).averageTimePerPage, 2.6);
  assert.equal(math.calculateTimeAttackAverage(samples, 10), 1.4);
  assert.equal(calculatePageUnitGrowth(samples, 'main', 10).current.averageTimePerPage, 1);
  const finished = [...samples, source({ id: 'finish', pagesRead: 5, timeSpentMinutes: 45, timeAttackMinutes: 30, timestamp: '2026-10-13T04:00:00Z' })];
  assert.equal(calculateUnitEfficiency(finished, 10).averageTimePerPage, 5);
  assert.equal(calculateUnitEfficiency(finished, 10).timeAttackAverageTimePerPage, 3.25);
});

test('before the first complete unit both efficiency values use all measured pages and no time cap', () => {
  const { calculateUnitEfficiency } = loadSource('utils/pageGrowth.ts');
  const samples = [source({ pagesRead: 5, timeSpentMinutes: 500, timeAttackMinutes: 100, timestamp: '2026-01-01T04:00:00Z' }),
    source({ id: 'new', pagesRead: 2, timeSpentMinutes: 4, timeAttackMinutes: 2, timestamp: '2026-10-12T04:00:00Z' })];
  const result = calculateUnitEfficiency(samples, 10);
  assert.equal(result.basis.complete, false);
  assert.equal(result.averageTimePerPage, 504 / 7);
  assert.equal(result.timeAttackAverageTimePerPage, 102 / 7);
  const math = loadSource('utils/math.ts');
  assert.equal(math.calculateStats(samples, 5, 0, 0, 10).estimatedRemainingTime, 504 / 7 * 5);
  assert.equal(calculateUnitEfficiency([source({ timeAttackMinutes: 0 })], 10).timeAttackAverageTimePerPage, 0);
});

test('subject-specific unit size changes the calculation boundary for both efficiency types', () => {
  const math = loadSource('utils/math.ts');
  const samples = [source({ pagesRead: 10, timeSpentMinutes: 50, timeAttackMinutes: 20, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'new', pagesRead: 5, timeSpentMinutes: 10, timeAttackMinutes: 5, timestamp: '2026-10-12T04:00:00Z' })];
  assert.equal(math.calculateRecentCompletedDayAverage(samples, 100, 10).averageTimePerPage, 5);
  assert.equal(math.calculateRecentCompletedDayAverage(samples, 100, 15).averageTimePerPage, 4);
  assert.equal(math.calculateTimeAttackAverage(samples, 10), 2);
  assert.equal(math.calculateTimeAttackAverage(samples, 15), 25 / 15);
});

test('growth comparison cycles previous, second, third, older average, then previous with distinct attack growth', () => {
  const { calculatePageUnitGrowth, nextGrowthComparison, getGrowthComparison } = loadSource('utils/pageGrowth.ts');
  const logs = [10, 8, 6, 4, 3, 2].map((rate, index) => source({ id: String(index), pagesRead: 10,
    timeSpentMinutes: rate * 10, timeAttackMinutes: 10, timestamp: `2026-10-0${index + 1}T04:00:00Z` }));
  const units = calculatePageUnitGrowth(logs, 'main', 10).units;
  let mode = 1;
  const values = [];
  for (let index = 0; index < 5; index++) {
    const comparison = getGrowthComparison(units, mode);
    values.push([mode, comparison.overallGrowth, comparison.attackGrowth]);
    mode = nextGrowthComparison(units, mode);
  }
  assert.deepEqual(values, [[1, 50, 0], [2, 100, 0], [3, 200, 0], ['older', 350, 0], [1, 50, 0]]);
  assert.equal(nextGrowthComparison(units.slice(0, 2), 1), 1);
  assert.equal(getGrowthComparison(units.slice(0, 2), 3).comparison, 1);
  assert.equal(getGrowthComparison([], 'older').overallGrowth, null);
});

test('without a measurement today the growth cell hides old percentages but still shows remaining pages', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { EfficiencyGrowthCell } = loadSource('components/PageGrowth.tsx');
  const { calculatePageUnitGrowth } = loadSource('utils/pageGrowth.ts');
  const growth = calculatePageUnitGrowth([source({ pagesRead: 10, timeSpentMinutes: 50, timeAttackMinutes: 20 }),
    source({ id: 'new', pagesRead: 5, timeSpentMinutes: 10, timeAttackMinutes: 5, timestamp: '2026-10-12T04:00:00Z' })], 'main', 10);
  const empty = renderToStaticMarkup(React.createElement(EfficiencyGrowthCell, { growth, measuredToday: false }));
  assert.equal((empty.match(/측정 필요/g) || []).length, 2);
  assert.ok(!empty.includes('+150.0%'));
  assert.ok(empty.includes('unit-pages-remaining') && empty.includes('>5P</p>'));
  const today = renderToStaticMarkup(React.createElement(EfficiencyGrowthCell, { growth, measuredToday: true }));
  assert.ok(today.includes('+150.0%') && today.includes('+100.0%'));
  assert.ok(today.includes('효율 성장 비교') && today.includes('이전 단위 대비'));
});

test('page units are chosen when creating a plan and are not editable in its execution detail', () => {
  const { createNewStudyPlan, SubjectPlanner } = loadSource('components/SubjectPlanner.tsx');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  const plan = createNewStudyPlan('New', 1, 100, '2026-12-31', true, [1], 25);
  assert.equal(plan.growthPageUnit, 25);
  assert.ok(renderToStaticMarkup(React.createElement(SubjectPlanner, { onAddSubject() {} })).includes('new-plan-page-unit'));
  const html = renderToStaticMarkup(React.createElement(TodaySummary, { subjects: [plan], logs: [], detailSubjectId: plan.id,
    taskSelector: '오늘 할 일', activeWeekday: 1, activeStudyDate: '2026-10-12', onDetailSubjectChange() {},
    onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}, onUpdateSubject() {}, pomodoroPlan: { subjectId: plan.id, pages: 5, minutes: 25, remainingTaskPages: 25 } }));
  assert.ok(!html.includes('성장 설정') && !html.includes('성장 페이지 단위'));
  assert.ok(html.indexOf('뽀모도로') < html.indexOf('전체 효율') && html.indexOf('전체 효율') < html.indexOf('타임어택 효율'));
  assert.ok(html.indexOf('타임어택 효율') < html.indexOf('5회'));
  assert.ok(!html.includes('ml-auto text-2xl'));
});

test('pomodoro and both growth rates share a compact strip without a nested growth card', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const { EfficiencyGrowthCell } = loadSource('components/PageGrowth.tsx');
  const { calculatePageUnitGrowth } = loadSource('utils/pageGrowth.ts');
  const growth = calculatePageUnitGrowth([source({ pagesRead: 10, timeSpentMinutes: 50, timeAttackMinutes: 20 }),
    source({ id: 'new', pagesRead: 5, timeSpentMinutes: 10, timeAttackMinutes: 5, timestamp: '2026-10-12T04:00:00Z' })], 'main', 10);
  const html = renderToStaticMarkup(React.createElement(PomodoroSummary, {
    pages: 5, efficiency: 5.12, attackEfficiency: 2.26, remainingTaskPages: 21,
    growth: React.createElement(EfficiencyGrowthCell, { growth, measuredToday: true })
  }));
  assert.ok(html.includes('pomodoro-growth-strip') && html.includes('lg:flex-row'));
  assert.ok(html.includes('lg:flex-wrap') && html.includes('lg:min-w-[20rem]'));
  assert.ok(html.includes('필요 횟수') && html.includes('5회'));
  assert.ok(html.includes('전체 효율') && html.includes('타임어택 효율'));
  assert.ok(html.includes('+150.0%') && html.includes('+100.0%'));
  const growthHtml = renderToStaticMarkup(React.createElement(EfficiencyGrowthCell, { growth, measuredToday: true }));
  assert.ok(!growthHtml.includes('분/P'));
  assert.ok(html.includes('unit-pages-remaining') && html.includes('>5P</p>'));
  assert.ok(html.includes('lg:border-l') && html.includes('focus-visible:ring-2'));
  assert.ok(html.includes('current-overall-efficiency') && html.includes('>5.1</span>'));
  assert.ok(html.includes('current-attack-efficiency') && html.includes('>2.3</span>'));
  assert.ok(!html.includes('bg-white') && !html.includes('min-w-[15rem]'));
  const empty = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: null, remainingTaskPages: 21 }));
  assert.ok(empty.includes('측정 필요') && !empty.includes('필요 횟수'));
});

test('pomodoro time is emphasized beside the current calculation efficiency without showing its page target', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { PomodoroSummary } = loadSource('components/TodaySummary.tsx');
  const html = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: 6, efficiency: 4.26, attackEfficiency: 1.93, remainingTaskPages: 13 }));
  assert.ok(html.includes('text-3xl') && html.includes('25분'));
  assert.ok(html.includes('current-overall-efficiency') && html.includes('>4.3</span>'));
  assert.ok(html.indexOf('25분') < html.indexOf('전체 효율') && html.indexOf('전체 효율') < html.indexOf('타임어택 효율'));
  assert.ok(html.indexOf('타임어택 효율') < html.indexOf('3회') && html.includes('>1.9</span>'));
  assert.ok(!html.includes('현재 전체 효율') && !html.includes('현재 타임어택 효율'));
  assert.ok(!html.includes('6P'));
  const empty = renderToStaticMarkup(React.createElement(PomodoroSummary, { pages: null, efficiency: 0 }));
  assert.ok(empty.includes('25분') && empty.includes('측정 필요') && !empty.includes('0.0'));
});

test('both front efficiency values use the completed unit for ordinary and review subjects, not the partial growth tail', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { TodaySummary } = loadSource('components/TodaySummary.tsx');
  for (const entry of [{ id: 'main', parentId: undefined, subjects }, { id: 'first', parentId: 'parent', subjects: reviewChainSubjects }]) {
    const logs = [source({ subjectId: entry.id, reviewParentSubjectId: entry.parentId, pagesRead: 10,
      timeSpentMinutes: 50, timeAttackMinutes: 20, timestamp: '2026-10-10T04:00:00Z' }),
    source({ id: 'partial', subjectId: entry.id, reviewParentSubjectId: entry.parentId, pagesRead: 5,
      timeSpentMinutes: 5, timeAttackMinutes: 2.5, timestamp: '2026-10-12T04:00:00Z' })];
    const html = renderToStaticMarkup(React.createElement(TodaySummary, {
      logs, subjects: entry.subjects.map(subject => subject.id === entry.id ? { ...subject, growthPageUnit: 10, reviewGrowthDisplay: 'unit' } : subject),
      detailSubjectId: entry.id, activeWeekday: 1, activeStudyDate: '2026-10-12', taskSelector: '오늘 할 일',
      onDetailSubjectChange() {}, onAddLog() {}, onReplaceLogs() {}, onDeleteLogs() {}
    }));
    assert.ok(html.includes('current-overall-efficiency') && html.includes('>5.0</span>'));
    assert.ok(html.includes('current-attack-efficiency') && html.includes('>2.0</span>'));
    assert.equal((html.match(/분\/P/g) || []).length, 2);
    assert.ok(!html.includes('현재 전체 효율') && !html.includes('현재 타임어택 효율'));
  }
});

test('review forecasts inherit a parent completed unit and use their own measured unit once available', () => {
  const math = loadSource('utils/math.ts');
  const currentSubjects = reviewChainSubjects.map(subject => ({ ...subject, growthPageUnit: 10 }));
  const old = chainLog('old', { pagesRead: 10, timeSpentMinutes: 100, timeAttackMinutes: 50, timestamp: '2026-10-10T04:00:00Z' });
  const fresh = chainLog('fresh', { pagesRead: 3, timeSpentMinutes: 3, timeAttackMinutes: 1.5, timestamp: '2026-10-12T04:00:00Z' });
  const parentHistory = [old, fresh];
  assert.equal(math.calculateReviewSubjectTiming(parentHistory, 'parent', 'first', currentSubjects, [fresh]).averageTimePerPage, 10);
  assert.equal(math.calculateReviewSubjectTiming(parentHistory, 'parent', 'first', currentSubjects, [fresh], ['first'], true).averageTimePerPage, 5);
  const own = [source({ subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 20, timeSpentMinutes: 80, timeAttackMinutes: 40, timestamp: '2026-10-11T04:00:00Z' }),
    source({ id: 'tail', subjectId: 'first', reviewParentSubjectId: 'parent', pagesRead: 5, timeSpentMinutes: 5, timeAttackMinutes: 2.5, timestamp: '2026-10-12T04:00:00Z' })];
  assert.equal(math.calculateReviewSubjectTiming([...parentHistory, ...own], 'parent', 'first', currentSubjects, [fresh]).averageTimePerPage, 4);
  assert.equal(math.calculateReviewSubjectTiming([...parentHistory, ...own], 'parent', 'first', currentSubjects, [fresh], ['first'], true).averageTimePerPage, 2);
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
