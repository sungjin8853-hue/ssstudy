const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const { fixture, seedData, openCard, answer, now, hour, second } = require('./reviewGate.browser.cjs');

const checkIntent = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  console.log(`PASS: ${name}`);
};
const readLogs = page => page.evaluate(() => JSON.parse(localStorage.getItem('swp_logs') || '[]'));

async function runAudit(browser) {
    const cycleData = fixture(false, 3);
    cycleData.logs = [cycleData.logs[0]];
    cycleData.logs[0].reviewMemo = 'one: a, two: b, three: c, four: d,';
    const cycle = await seedData(browser, cycleData);
    await openCard(cycle.page, '기본 복습');
    assert.equal(await cycle.page.getByText('one', { exact: true }).count(), 1);
    await answer(cycle.page, true);
    assert.equal(await cycle.page.getByText('two', { exact: true }).count(), 1);
    await answer(cycle.page, false);
    assert.equal(await cycle.page.getByText('three', { exact: true }).count(), 1);
    await answer(cycle.page, true);
    assert.equal(await cycle.page.getByText('four', { exact: true }).count(), 1);
    await answer(cycle.page, false);
    assert.equal(await cycle.page.getByText('오답 1회차', { exact: true }).count(), 1);
    assert.equal(await cycle.page.getByText('two', { exact: true }).count(), 1);
    await answer(cycle.page, true);
    assert.equal(await cycle.page.getByText('four', { exact: true }).count(), 1);
    await answer(cycle.page, false);
    assert.equal(await cycle.page.getByText('오답 2회차', { exact: true }).count(), 1);
    assert.equal(await cycle.page.getByText('four', { exact: true }).count(), 1);
    await answer(cycle.page, true);
    assert.equal(await cycle.page.getByRole('button', { name: '정답 확인', exact: true }).count(), 0);
    checkIntent('gate review cycles through the full round before retrying only wrong questions',
      await cycle.page.getByText('기본 복습 완료', { exact: true }).count(), 1);
    assert.deepEqual(cycle.errors, []);
    await cycle.context.close();

    const mixedData = fixture(false, 3);
    mixedData.logs = [mixedData.logs[0]];
    const mixed = await seedData(browser, mixedData);
    await openCard(mixed.page, '기본 복습');
    await answer(mixed.page, false);
    await answer(mixed.page, true);
    checkIntent('wrong questions repeat inside the same gate before completion',
      await mixed.page.getByRole('button', { name: '정답 확인', exact: true }).count(), 1);
    assert.equal(await mixed.page.getByText('[alpha] label', { exact: true }).count(), 1);
    assert.equal(await mixed.page.getByText('other', { exact: true }).count(), 0);
    await answer(mixed.page, false);
    assert.equal(await mixed.page.getByRole('button', { name: '정답 확인', exact: true }).count(), 1);
    await answer(mixed.page, true);
    await mixed.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const mixedLog = (await readLogs(mixed.page))[0];
    assert.equal(mixedLog.reviewGateRetry, undefined);
    checkIntent('repeated mistakes lower one question once while the other advances',
      Object.fromEntries(Object.entries(mixedLog.reviewQuestionSchedules).map(([key, value]) => [key, value.reviewStep])),
      { 'answer:0': 2, 'answer:1': 4 });
    assert.equal(Date.parse(mixedLog.reviewQuestionSchedules['answer:1'].nextReviewDate)
      - Date.parse(mixedLog.reviewQuestionSchedules['answer:0'].nextReviewDate), 6 * 24 * hour);
    await mixed.page.reload();
    await mixed.page.clock.fastForward(2 * 24 * hour + second);
    await openCard(mixed.page, '기본 복습');
    assert.equal(await mixed.page.getByText('[alpha] label', { exact: true }).count(), 1);
    await answer(mixed.page, true);
    assert.equal(await mixed.page.getByRole('button', { name: '정답 확인', exact: true }).count(), 0);
    await mixed.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const mixedNext = (await readLogs(mixed.page))[0];
    assert.deepEqual(mixedNext.reviewQuestionSchedules['answer:1'], mixedLog.reviewQuestionSchedules['answer:1']);
    console.log('PASS: refresh retains question schedules; only the due question is asked next');
    assert.deepEqual(mixed.errors, []);
    await mixed.context.close();

    const resumeData = fixture(true);
    resumeData.logs = [resumeData.logs[0]];
    resumeData.subjects.push({ ...resumeData.subjects[1], id: 'practice-b', name: 'Practice B' });
    resumeData.subjects[0].reviewSubjectIds = ['gate-practice', 'practice-b'];
    resumeData.logs[0].reviewSubjectIdsSnapshot = ['gate-practice', 'practice-b'];
    const resume = await seedData(browser, resumeData);
    await openCard(resume.page, '과목 복습');
    await answer(resume.page, false);
    await answer(resume.page, true);
    await answer(resume.page, true);
    await resume.page.getByRole('button', { name: '복습과목 시작', exact: true }).click();
    await resume.page.getByRole('button', { name: '일시정지', exact: true }).waitFor();
    await resume.page.clock.fastForward(10 * second);
    await resume.page.getByRole('button', { name: '완료', exact: true }).click();
    await resume.page.getByRole('button', { name: '복습 완료 후 다음 과목', exact: true }).click();
    await resume.page.getByText('복습 과목 · Practice B', { exact: true }).waitFor();
    assert.equal((await readLogs(resume.page))[0].reviewSubjectId, 'practice-b');
    await resume.page.reload();
    await resume.page.getByRole('heading', { name: '학습 실행', exact: true }).waitFor();
    checkIntent('unfinished next review subject remains available after reloading',
      await resume.page.getByRole('button').filter({ hasText: '과목 복습' }).filter({ hasText: 'Practice B' }).count(), 1);
    const resumeCard = resume.page.getByRole('button').filter({ hasText: '과목 복습' }).filter({ hasText: 'Practice B' });
    await resumeCard.click();
    await resumeCard.click();
    await resume.page.getByText('복습 과목 · Practice B', { exact: true }).waitFor();
    assert.equal(await resume.page.getByRole('button', { name: '정답 확인', exact: true }).count(), 0);
    assert.equal((await readLogs(resume.page))[0].reviewStep, 0);
    await resume.page.clock.fastForward(10 * second);
    await resume.page.getByRole('button', { name: '완료', exact: true }).click();
    await resume.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const resumedLog = (await readLogs(resume.page))[0];
    assert.equal(resumedLog.reviewStep, 1);
    assert.equal(resumedLog.reviewSubjectTimeRecords.length, 2, JSON.stringify(await readLogs(resume.page)));
    assert.deepEqual(resumedLog.reviewSubjectTimeRecords.map(record => record.subjectId), ['gate-practice', 'practice-b']);
    console.log('PASS: next subject resumes without repeating the gate and final completion commits schedules');
    assert.deepEqual(resume.errors, []);
    await resume.context.close();

    const legacyData = fixture(true, 3);
    legacyData.logs = [legacyData.logs[0]];
    Object.assign(legacyData.logs[0], {
      reviewGatePendingResult: 'wrong',
      reviewSubjectId: 'gate-practice',
      reviewGateRetry: {
        dueAt: new Date(now + 2 * hour).toISOString(), intervalMs: 2 * hour,
        reviewStep: 0, questionKeys: ['answer:0']
      }
    });
    const legacy = await seedData(browser, legacyData);
    assert.equal(await legacy.page.getByRole('button').filter({ hasText: '과목 복습' }).filter({ hasText: 'PracticeTest' }).count(), 1);
    await legacy.page.reload();
    await legacy.page.getByRole('heading', { name: '학습 실행', exact: true }).waitFor();
    assert.equal((await readLogs(legacy.page))[0].nextReviewDate, legacyData.logs[0].nextReviewDate);
    await legacy.page.clock.fastForward(2 * hour + second);
    await openCard(legacy.page, '기본 복습 · 오답');
    await answer(legacy.page, false);
    await answer(legacy.page, true);
    await legacy.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const legacyFinished = (await readLogs(legacy.page))[0];
    assert.equal(legacyFinished.reviewGateRetry, undefined);
    assert.equal(legacyFinished.reviewStep, legacyData.logs[0].reviewStep);
    assert.equal(legacyFinished.nextReviewDate, legacyData.logs[0].nextReviewDate);
    assert.equal(legacyFinished.reviewSubjectId, 'gate-practice');
    assert.equal(legacyFinished.reviewGatePendingResult, 'wrong');
    assert.equal(await legacy.page.getByRole('button').filter({ hasText: '과목 복습' }).filter({ hasText: 'PracticeTest' }).count(), 1);
    assert.deepEqual(legacy.errors, []);
    console.log('PASS: legacy additional reviews preserve the regular date and unfinished linked subject across reload');
    await legacy.context.close();

    const notesData = fixture(true);
    notesData.logs = [notesData.logs[0]];
    const notes = await seedData(browser, notesData);
    await openCard(notes.page, '과목 복습');
    await answer(notes.page, true);
    await answer(notes.page, true);
    await notes.page.getByRole('button', { name: '복습과목 시작', exact: true }).click();
    const textareas = () => notes.page.locator('textarea').evaluateAll(elements => elements.map(element => element.value));
    assert.equal((await textareas()).some(value => value.includes('hidden answer')), false);
    assert.equal((await readLogs(notes.page))[0].reviewStep, 0);
    await notes.page.getByRole('button', { name: '노트 보기', exact: true }).click();
    assert.equal((await textareas()).some(value => value.includes('hidden answer')), true);
    await notes.page.getByRole('button').filter({ hasText: '복습 제외' }).click();
    await notes.page.getByPlaceholder('복습 때 바로 떠올릴 핵심어를 적어주세요.').fill('[self] unique prompt: unique own answer,');
    await notes.page.clock.fastForward(20 * second);
    await notes.page.getByRole('button', { name: '완료', exact: true }).click();
    await notes.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    const saved = await readLogs(notes.page);
    const own = saved.find(log => log.subjectId === 'gate-practice');
    assert.equal(saved[0].reviewStep, 1);
    assert.equal(saved[0].reviewMemo, notesData.logs[0].reviewMemo);
    assert.equal(own.reviewMemo, '[self] unique prompt: unique own answer,');
    assert.equal(own.reviewEnabled, true);
    assert.equal(Date.parse(own.nextReviewDate) - Date.parse(own.timestamp), 2 * hour);
    console.log('PASS: parent notes are initially hidden; opt-in own notes stay separate; the final linked subject advances the cycle');
    await notes.page.clock.fastForward(2 * hour + 2 * second);
    const ownCard = notes.page.getByRole('button').filter({ hasText: '기본 복습' }).filter({ hasText: 'PracticeTest' }).first();
    await ownCard.click();
    await ownCard.click();
    await notes.page.getByRole('button', { name: '정답 확인', exact: true }).waitFor();
    assert.equal(await notes.page.getByText('[self] unique prompt', { exact: true }).count(), 1);
    assert.equal(await notes.page.getByText('[alpha] label', { exact: true }).count(), 0);
    await notes.page.getByRole('button', { name: '정답 확인', exact: true }).click();
    assert.equal(await notes.page.getByText('unique own answer', { exact: true }).count(), 1);
    await notes.page.getByRole('button', { name: '맞음', exact: true }).click();
    assert.equal(await notes.page.getByRole('button', { name: '복습과목 시작', exact: true }).count(), 0);
    await notes.page.getByRole('button', { name: '복습 완료', exact: true }).click();
    assert.equal((await readLogs(notes.page)).find(log => log.id === own.id).reviewStep, 1);
    assert.deepEqual(notes.errors, []);
    console.log('PASS: a review subject later opens its own gate with only its own note, then completes without nested subjects');
    await notes.context.close();
}

module.exports = { runAudit };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try { await runAudit(browser); } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
