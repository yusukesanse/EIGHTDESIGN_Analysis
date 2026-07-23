// 特性テスト: 一覧行データ生成（顧客/営業/住宅・新築/法人）（現行挙動の固定）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';

const g = loadGas();

/** {col,value} 配列から col の value を取り出す（未定義列は Symbol で区別） */
const MISSING = Symbol('missing');
function valAt(rowData, col) {
  const hit = rowData.find((e) => e.col === col);
  return hit ? hit.value : MISSING;
}

test('顧客アプリ用列パッチ', () => {
  const C = g.CUSTOMER_LIST_COLS;
  const fields = {
    inquiryDate: '2025-04-21',
    likehoodNow: '成約',
    customerName: '顧客花子',
    firstAppoint: '2025-05-01',
    informationRoute: 'SUUMO',
    manager: '田中',
    age: '30代',
    currentResidence: '賃貸',
    familyMember: '3',
  };
  const rd = g.buildCustomerRowData(fields);
  assert.equal(valAt(rd, C.YEAR), '2025年');
  assert.equal(valAt(rd, C.MONTH), '5月');            // 21日→翌月
  assert.equal(valAt(rd, C.RANK), 'A');               // 成約→A
  assert.equal(valAt(rd, C.LIKEHOOD), '成約');
  assert.equal(valAt(rd, C.CUSTOMER_NAME), '顧客花子');
  assert.equal(valAt(rd, C.INQUIRY_DATE), '4月21日');
  assert.equal(valAt(rd, C.INFO_ROUTE), 'SUUMO');
  assert.equal(valAt(rd, C.MANAGER), '田中');
  assert.equal(valAt(rd, C.FAMILY_MEMBER), '3');
});

test('営業アプリ用列パッチ（共通部）', () => {
  const S = g.SALES_LIST_COLS;
  const fields = {
    inquiryDate: '2025-04-10',
    likehoodNow: '見込み大',
    negoStatus: '長期追客',
    customerName: '営業太郎',
    consultationContent: '相談です',
    manager: '佐藤',
    prefectures: '愛知県',
    city: '名古屋市',
    town: '中区',
    area: '栄',
    landAttributes: 'あり',
    workPlace: '株式会社A',
    industry: '製造',
    occupation: '会社員',
    income: '600',
    selfFunded: '1000',
    customerType: '小型店舗',
  };
  const rd = g.buildSalesRowData(fields, { resDate: '4月9日', nextAppt: '来週' },
    { mtgDays: ['4月1日', '', ''], mtgCount: '1' });
  assert.equal(valAt(rd, S.YEAR), '2025年');
  assert.equal(valAt(rd, S.MONTH), '4月');
  assert.equal(valAt(rd, S.RANK), 'B-A');                 // 見込み大→B-A
  assert.equal(valAt(rd, S.LIKEHOOD), '長期追客');         // パススルー
  assert.equal(valAt(rd, S.MTG_COUNT), '1');
  assert.equal(valAt(rd, S.CUSTOMER_NAME), '営業太郎');
  assert.equal(valAt(rd, S.LATEST_FOLLOWUP), '4月9日');
  assert.equal(valAt(rd, S.NEXT_APPT), '来週');
  assert.equal(valAt(rd, S.INCOME), '6000000');           // 万円単位化
  // バグA修正: 家族数列（27）は営業レコードに存在しないため書き込まない
  //（顧客情報アプリが設定した家族数を空で上書きしない）
  assert.equal(valAt(rd, S.FAMILY_MEMBER), MISSING);
});

test('住宅・新築用追加列', () => {
  const S = g.SALES_LIST_COLS;
  const R = g.RESIDENTIAL_EXTRA_COLS;
  const fields = {
    inquiryDate: '2025-04-10', likehoodNow: '見込み中', negoStatus: '商談中',
    customerName: '住宅次郎', customerType: '注文住宅',
    currentResidence: '賃貸', hopeRenovation: '', landAttributes: 'なし',
    workPlaceSub: '合算先', incomeSub: '300', reason: '理由X',
  };
  const rd = g.buildSalesRowData(fields, {}, { mtgDays: ['', '', ''], mtgCount: null });
  // 住宅系は 23:住居形態 / 30:収入合算者勤務先 / 31:収入合算者年収 が入る
  assert.equal(valAt(rd, S.CURRENT_RESIDENCE), '賃貸');
  assert.equal(valAt(rd, R.WORK_PLACE_SUB), '合算先');
  assert.equal(valAt(rd, R.INCOME_SUB), '3000000');
  assert.equal(valAt(rd, R.REASON), '理由X');
  // 一次取得（物件なし）フラグが立つ想定ではないケース（hopeRenovation 空）
  // バグD修正: 該当なしのときも 3フラグ列（32/33/34）をすべて '' で明示クリア
  assert.equal(valAt(rd, R.FIRST_ACQUIRER), '');
  assert.equal(valAt(rd, R.OWN_HOUSE), '');
  assert.equal(valAt(rd, R.PARENTAL_HOME), '');
});

test('住宅・新築用追加列: フラグ切替時に旧フラグをクリア（バグD修正）', () => {
  const R = g.RESIDENTIAL_EXTRA_COLS;
  const base = {
    inquiryDate: '2025-04-10', likehoodNow: '見込み中', negoStatus: '商談中',
    customerName: '住宅次郎', customerType: '注文住宅',
  };
  // マンションリノベ×物件あり → 持家(33) に '1'、一次取得(32)・実家(34) は ''
  const rd = g.buildSalesRowData(
    { ...base, hopeRenovation: 'マンションリノベ', landAttributes: 'あり' },
    {}, { mtgDays: ['', '', ''], mtgCount: null });
  assert.equal(valAt(rd, R.FIRST_ACQUIRER), '');
  assert.equal(valAt(rd, R.OWN_HOUSE), '1');
  assert.equal(valAt(rd, R.PARENTAL_HOME), '');
});

test('法人用追加列', () => {
  const B = g.BUSINESS_EXTRA_COLS;
  const fields = {
    inquiryDate: '2025-04-10', likehoodNow: '見込み小', negoStatus: '商談中',
    customerName: '法人商店', customerType: '小型店舗',
    constructionStatus: '入居希望', jobTitle: '代表', hopeBusinessType: '飲食',
    capitalStock: '500万', reason: '出店したい',
  };
  const rd = g.buildSalesRowData(fields, {}, { mtgDays: ['', '', ''], mtgCount: null });
  assert.equal(valAt(rd, B.JOB_TITLE), '代表');
  assert.equal(valAt(rd, B.HOPE_BUSINESS), '飲食');
  assert.equal(valAt(rd, B.CAPITAL_STOCK), '500万');
  assert.equal(valAt(rd, B.REASON), '出店したい');
  // 入居希望 → 希望種別A に '1'
  assert.equal(valAt(rd, B.HOPE_TYPE_A), '1');
  // バグD修正: 非該当の希望種別B/C は '' で明示クリア
  assert.equal(valAt(rd, B.HOPE_TYPE_B), '');
  assert.equal(valAt(rd, B.HOPE_TYPE_C), '');
});
