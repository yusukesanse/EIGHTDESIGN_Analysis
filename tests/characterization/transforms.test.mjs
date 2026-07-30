// 特性テスト: 日付変換・正規化・値変換・Kintone パーサ（現行挙動の固定）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';

const g = loadGas();

// ── 日付変換（transformInquiryDate）─────────────────────────
test('日付変換: 20日は当月のまま', () => {
  assert.deepEqual(g.transformInquiryDate('2025-03-20'),
    { year: '2025年', month: '3月', monthAndDay: '3月20日' });
});
test('日付変換: 21日は翌月扱い', () => {
  assert.deepEqual(g.transformInquiryDate('2025-03-21'),
    { year: '2025年', month: '4月', monthAndDay: '3月21日' });
});
// 旧挙動: 年の繰り上がりは12/21だった（暦年に近い扱い）。
// 新挙動（2026-07-30）: エイトデザインの年度は9/20締め。9/20までが今年度、
// 9/21以降は翌年度。切れ目は config.gs の YEAR_ROLLOVER で変更できる。
test('日付変換: 9月20日は今年度のまま', () => {
  assert.deepEqual(g.transformInquiryDate('2025-09-20'),
    { year: '2025年', month: '9月', monthAndDay: '9月20日' });
});
test('日付変換: 9月21日は翌年度10月へ繰り上がる', () => {
  assert.deepEqual(g.transformInquiryDate('2025-09-21'),
    { year: '2026年', month: '10月', monthAndDay: '9月21日' });
});
test('日付変換: 年度の切れ目より後の月も翌年度になる', () => {
  assert.deepEqual(g.transformInquiryDate('2025-10-05'),
    { year: '2026年', month: '10月', monthAndDay: '10月5日' });
  assert.deepEqual(g.transformInquiryDate('2025-12-20'),
    { year: '2026年', month: '12月', monthAndDay: '12月20日' });
});
test('日付変換: 12月21日は翌月繰り上がりで翌暦年1月（年度は変わらず）', () => {
  assert.deepEqual(g.transformInquiryDate('2025-12-21'),
    { year: '2026年', month: '1月', monthAndDay: '12月21日' });
});
test('日付変換: 空文字は空オブジェクト', () => {
  assert.deepEqual(g.transformInquiryDate(''), {});
});

// ── 正規化 ──────────────────────────────────────────────────
test('顧客種別正規化', () => {
  assert.equal(g.normalizeCustomerType('注文住宅'), '一般住宅');
  assert.equal(g.normalizeCustomerType('BinO'), '新築');
  assert.equal(g.normalizeCustomerType('賃貸マンション'), '賃貸');
  assert.equal(g.normalizeCustomerType('小型店舗'), '小型店舗');
  assert.equal(g.normalizeCustomerType('該当なし'), '');
  assert.equal(g.normalizeCustomerType(''), '');
});
test('販促エリア正規化: 末尾「店」を除去', () => {
  assert.equal(g.normalizePromotionArea('名古屋店'), '名古屋');
  assert.equal(g.normalizePromotionArea('東京'), '東京');
  assert.equal(g.normalizePromotionArea(''), '');
});

// ── ランク・商談ステータス・年収 ────────────────────────────
test('ランク変換', () => {
  assert.equal(g.transformRank('成約'), 'A');
  assert.equal(g.transformRank('見込み大'), 'B-A');
  assert.equal(g.transformRank('不明'), 'B-D');
  assert.equal(g.transformRank('未定義'), null);
});
test('商談ステータス変換: パススルー対象はそのまま', () => {
  assert.equal(g.transformNegotiationStatus('長期追客', '見込み大'), '長期追客');
  assert.equal(g.transformNegotiationStatus('追客中', '成約'), '追客中');
});
test('商談ステータス変換: 非パススルーは生ランクを返す', () => {
  assert.equal(g.transformNegotiationStatus('商談中', '見込み大'), '見込み大');
  assert.equal(g.transformNegotiationStatus('商談中', ''), '');
});
test('年収変換: 万円単位へ 0000 付与', () => {
  assert.equal(g.transformIncome('500'), '5000000');
  assert.equal(g.transformIncome(''), '');
});

// ── イベント文字列抽出 ──────────────────────────────────────
test('イベント抽出: 【 イベント 】…改行 まで', () => {
  assert.equal(g.extractEventDetail('冒頭\n【 イベント 】完成見学会\n以降'), '完成見学会');
  assert.equal(g.extractEventDetail('該当なし'), '');
  assert.equal(g.extractEventDetail(''), '');
});

// ── 担当者（ユーザーフィールド）──────────────────────────────
test('担当者: 複数設定時は先頭1名', () => {
  const rec = { manager: { value: [{ name: '田中' }, { name: '佐藤' }] } };
  assert.equal(g.getUserFieldName(rec, 'manager'), '田中');
  assert.equal(g.getUserFieldName({}, 'manager'), '');
});

// ── 商談履歴パーサ ──────────────────────────────────────────
test('最新商談: id が最大の行を採用し M月D日 へ整形', () => {
  const rows = [
    { id: '1', value: { response_date: { value: '2025-04-01' }, next_appointment: { value: '2025-04-10' } } },
    { id: '3', value: { response_date: { value: '2025-05-02' }, next_appointment: { value: '来週' } } },
    { id: '2', value: { response_date: { value: '2025-04-20' }, next_appointment: { value: '' } } },
  ];
  assert.deepEqual(g.parseLatestNegotiation(rows), { resDate: '5月2日', nextAppt: '来週' });
  assert.equal(g.parseLatestNegotiation([]), null);
});
test('来場回数・1〜3回目来場日', () => {
  const rows = [
    { value: { deal_count: { value: '1回目' }, response_date: { value: '2025-04-01' } } },
    { value: { deal_count: { value: '2回目' }, response_date: { value: '2025-04-15' } } },
  ];
  const r = g.parseMeetingData(rows);
  assert.deepEqual(r.mtgDays, ['2025-04-01', '2025-04-15', '']);
  assert.equal(r.mtgCount, '2');
});
test('来場データ: 空サブテーブル', () => {
  const r = g.parseMeetingData([]);
  assert.deepEqual(r.mtgDays, ['', '', '']);
  assert.equal(r.mtgCount, null);
});
