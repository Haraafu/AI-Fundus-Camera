import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/app.js', import.meta.url), 'utf8').replace(/\ninit\(\);\s*$/, '');
async function dashboard(examinations) {
  const main = { innerHTML: '', addEventListener() {} };
  const context = vm.createContext({
    document: { querySelector: () => main },
    fetch: async path => ({ ok: true, json: async () => path === '/api/examinations' ? examinations : [] })
  });
  vm.runInContext(source, context);
  await vm.runInContext('dashboard()', context);
  return main.innerHTML;
}
test('DR panel counts binary DR predictions without including No DR or historical risk grades', async () => {
  const exam = (id, predictedClass, riskLevel) => ({ examinationId: id, patientId: id, createdAt: '2026-11-20T00:00:00Z',
    eye: 'RIGHT', status: 'COMPLETED', result: { predictedClass, riskLevel } });
  const html = await dashboard([exam('positive', 'DR', 'NOT_ASSESSED'), exam('negative', 'No_DR', 'NOT_ASSESSED'), exam('legacy', 'Severe', 'HIGH')]);
  const panel = html.slice(html.indexOf('<h2>DR predictions'));
  assert.match(panel, /class="count">1<\/span>/);
  assert.match(panel, /positive/);
  assert.doesNotMatch(panel, /negative|legacy|high-risk/);
});
test('an empty DR list is described as an empty list, not the No DR prediction label', async () => {
  const html = await dashboard([]);
  assert.match(html, /No examinations have been classified as DR yet\./);
  assert.doesNotMatch(html, /No DR or high-risk results/);
});
