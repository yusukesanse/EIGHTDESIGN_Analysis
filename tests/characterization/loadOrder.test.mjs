// ============================================================
// loadOrder.test.mjs — GASのファイル評価順に依存しないことを固定する
// ------------------------------------------------------------
// GAS は .gs をファイル名順に評価し、全ファイルが単一グローバルスコープを共有する。
// そのため `const` のトップレベル宣言が「後で評価されるファイルの定数」を参照すると、
// 一時的death zoneで ReferenceError になる（実機のみで発生し、依存順に連結する
// 通常のハーネスでは検出できない）。
//
// 実際に起きた不具合（2026-07-28）:
//   aggregation.gs の `const AGG_AREAS = [AREAS.NAGOYA, ...]` が config.gs より
//   先に評価され、GAS実機で "ReferenceError: AREAS is not defined" になった。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas, CORE_FILES } from '../harness/loadGas.mjs';

/** GAS実機と同じ評価順（ファイル名の昇順） */
function gasEvaluationOrder() {
  return [...CORE_FILES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

test('ロード順: GASと同じファイル名順に評価しても読み込める', () => {
  const files = gasEvaluationOrder();
  assert.equal(
    files[0],
    'Kintone/aggregation.gs',
    '前提: aggregation.gs が config.gs より先に評価される順序になっている',
  );

  let gas;
  assert.doesNotThrow(() => { gas = loadGas({ files }); });
  assert.deepEqual(gas.AGG_AREAS, ['名古屋', '東京']);
  assert.equal(gas.AGG_DOMAINS.length, 9);
  assert.equal(typeof gas.handleWebhook, 'function');
});

test('ロード順: 逆順に評価しても読み込める', () => {
  const files = gasEvaluationOrder().reverse();
  let gas;
  assert.doesNotThrow(() => { gas = loadGas({ files }); });
  assert.equal(gas.AGG_DOMAINS.length, 9);
});

test('ロード順: どの順でも同じ集計対象18組を組み立てられる', () => {
  const expected = loadGas().AGG_AREAS.flatMap(
    area => loadGas().AGG_DOMAINS.map(domain => `${area}-${domain.type}`)
  );
  assert.equal(expected.length, 18);

  for (const files of [gasEvaluationOrder(), gasEvaluationOrder().reverse()]) {
    const gas = loadGas({ files });
    const actual = gas.AGG_AREAS.flatMap(
      area => gas.AGG_DOMAINS.map(domain => gas.buildListSheetName(area, domain.type))
    );
    assert.deepEqual(actual, expected, `評価順: ${files[0]} 始まり`);
  }
});
