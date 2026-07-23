// 特性テスト: 行探索・書き込み計画（planRowWrite）と適用（applyRowWrite）
// 「純粋な計画算出(planRowWrite)」＋「Range I/O(applyRowWrite)」に分離。
// 行特定ロジック: 顧客名一致 → 月ブロック → 年ブロック → 末尾に新規行を追加（既存末尾行は上書きしない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas, makeFakeSheet } from '../harness/loadGas.mjs';

const g = loadGas();
const C = g.LIST_COL_INDEX;

// index0 はダミー行。CUSTOMER_NAME 列は index5、YEAR=0, MONTH=1。
function fixtureData() {
  return [
    ['', ''],                                          // 0: ダミー
    ['2025年', '4月', 'A', '', '', '既存太郎'],          // 1
    ['2025年', '4月', 'B', '', '', '別の人'],            // 2
    ['2025年', '5月', 'B', '', '', '五月子'],            // 3
  ];
}

// ── planRowWrite: 行特定 ────────────────────────────────────
test('planRowWrite: 顧客名一致で既存行、挿入なし', () => {
  const plan = g.planRowWrite(fixtureData(), '既存太郎', '2025年', '4月', []);
  assert.equal(plan.rowIndex, 1);
  assert.equal(plan.insertAfterRow, null);
  assert.equal(plan.setMonth, false);
});

test('planRowWrite: 対象月ありは月ブロック末尾直下に挿入', () => {
  const plan = g.planRowWrite(fixtureData(), '新規花子', '2025年', '4月', []);
  assert.equal(plan.insertAfterRow, 2);
  assert.equal(plan.rowIndex, 3);
  assert.equal(plan.setMonth, false);
});

test('planRowWrite: 対象年のみは年ブロック末尾直下に挿入し月セット', () => {
  const plan = g.planRowWrite(fixtureData(), '新規次郎', '2025年', '6月', []);
  assert.equal(plan.insertAfterRow, 3);
  assert.equal(plan.rowIndex, 4);
  assert.equal(plan.setMonth, true);
  assert.equal(plan.month, '6月');
});

test('planRowWrite[新挙動]: 該当年なしは末尾に新規行を追加（既存末尾行を上書きしない）', () => {
  const data = fixtureData();
  const plan = g.planRowWrite(data, '新参者', '2099年', '1月', []);
  // 旧挙動は rowIndex=data.length-1（末尾行を上書き）だった。
  // 新挙動は末尾直下へ挿入するため、既存の最終行(五月子)は保持される。
  assert.equal(plan.insertAfterRow, data.length - 1);   // = 3（末尾行の直下に挿入）
  assert.equal(plan.rowIndex, data.length);             // = 4（新規行）
  assert.equal(plan.setMonth, false);
});

// ── applyRowWrite: Range I/O 効果 ───────────────────────────
test('applyRowWrite: 既存行は挿入せず updateRowData のみ', () => {
  const { sheet, inserts, writes } = makeFakeSheet();
  const plan = g.planRowWrite(fixtureData(), '既存太郎', '2025年', '4月',
    [{ col: 3, value: 'A' }]);
  g.applyRowWrite(sheet, plan);
  assert.equal(inserts.length, 0);
  assert.equal(writes.length, 1);           // updateRowData の setValues 1回
  assert.equal(writes[0].row, 1);
});

test('applyRowWrite: 年ブロック挿入は insertRowAfter＋月セル setValue＋updateRowData', () => {
  const { sheet, inserts, singleSets, writes } = makeFakeSheet();
  const plan = g.planRowWrite(fixtureData(), '新規次郎', '2025年', '6月',
    [{ col: 3, value: 'B-A' }]);
  g.applyRowWrite(sheet, plan);
  assert.deepEqual(inserts, [3]);
  assert.deepEqual(singleSets, [{ row: 4, col: C.MONTH + 1, value: '6月' }]);
  assert.equal(writes[0].row, 4);
});

test('applyRowWrite[新挙動]: 該当年なしは末尾直下へ insertRowAfter して書き込む', () => {
  const { sheet, inserts, writes } = makeFakeSheet();
  const data = fixtureData();
  // 反響年・反響月は colData に含まれるため、挿入行へそのまま書き込まれる
  const plan = g.planRowWrite(data, '新参者', '2099年', '1月',
    [{ col: 1, value: '2099年' }, { col: 2, value: '1月' }, { col: 6, value: '新参者' }]);
  g.applyRowWrite(sheet, plan);
  assert.deepEqual(inserts, [data.length - 1]);   // 末尾行の直下へ挿入（上書きしない）
  assert.equal(writes[0].row, data.length);        // 新規行へ書き込み
});

// updateRowData: 指定列以外（数式セル等）に触れないこと（バグC対策）
test('updateRowData[新挙動]: 指定列のみ書き込み、非対象列は読み書きしない', () => {
  const { sheet, writes } = makeFakeSheet();
  // 非連続の列（3 と 6）→ 2グループに分かれて setValues される
  g.updateRowData(sheet, 5, [{ col: 3, value: 'A' }, { col: 6, value: '名前' }]);
  assert.equal(writes.length, 2);
  // それぞれ対象列のみ・幅1で書き込む（行全体の setValues をしない）
  assert.deepEqual(writes.map((w) => [w.row, w.col, w.numCols]), [[5, 3, 1], [5, 6, 1]]);
  // 連続列（3,4,5）は1グループにまとまる
  const { sheet: s2, writes: w2 } = makeFakeSheet();
  g.updateRowData(s2, 5, [{ col: 4, value: 'b' }, { col: 3, value: 'a' }, { col: 5, value: 'c' }]);
  assert.equal(w2.length, 1);
  assert.deepEqual([w2[0].row, w2[0].col, w2[0].numCols], [5, 3, 3]);
  assert.deepEqual(w2[0].values, [['a', 'b', 'c']]);
});
