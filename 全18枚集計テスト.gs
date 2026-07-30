/**
 * 全18枚集計テスト.gs — 9ドメイン × 2エリア = 18枚の集計シートをまとめて確認・再計算する
 *
 * GASエディタの関数プルダウンから実行し、「実行ログ」で結果を見る。
 * 使う順番:
 *
 *   1. test18_check()  … 書き込まない。18組すべてを点検し、どこが通ってどこが
 *                        止まるかを1行ずつ出す。止まる理由はセル番地つき。
 *   2. test18_run()    … 実際に18枚を全面再計算する。1枚ごとの結果を表で出す。
 *
 * どちらも既存の本番経路（_validateAggregationPreflight / runDomainAggregation）を
 * そのまま呼ぶ。テスト専用の集計ロジックは持たない ＝ ここが通れば本番も通る。
 */

/** ログ1行に載せる件数の上限（新設列・読めない行の列挙） */
const TEST18_SAMPLE_LIMIT = 4;

/**
 * 【書き込まない】18組を点検し、集計が通るかどうかを1組1行で報告する。
 *
 * 実際に書き込む前にこれを実行して、データ不備・年度列の不足を洗い出す。
 * 本番と同じ preflight を通すので、ここで ✔ なら test18_run() も通る。
 *
 * @returns {{ total: number, ok: number, ng: number, lines: string[] }}
 */
function test18_check() {
  const ss = getSpreadsheet();
  const currentYear = computeCurrentAggregationYear();
  const lines = [];
  let ok = 0;
  let ng = 0;

  for (const area of AGG_AREAS) {
    for (const domain of AGG_DOMAINS) {
      const listSheetName = buildListSheetName(area, domain.type);
      const domainSheetName = buildDomainSheetName(domain.type, area);
      const listSheet = ss.getSheetByName(listSheetName);
      const domainSheet = ss.getSheetByName(domainSheetName);

      if (!listSheet || !domainSheet) {
        ng++;
        lines.push(
          `✖ ${domainSheetName} | シートが見つかりません` +
          `（一覧=${listSheet ? 'あり' : 'なし'} / 集計=${domainSheet ? 'あり' : 'なし'}）`
        );
        continue;
      }

      try {
        const grid = domainSheet.getDataRange().getValues();
        const listData = listSheet.getDataRange().getValues();
        const targetYear = resolveAggregationYear(grid);
        const preflight = _validateAggregationPreflight(
          grid, listData, targetYear, domain.style, listSheetName
        );

        ok++;
        lines.push(
          `✔ ${domainSheetName} | 対象年度=${targetYear}` +
          (targetYear === currentYear ? '' : `（⚠ 今年度=${currentYear} とズレています）`) +
          ` 集計対象=${preflight.sourceRows}行` +
          ` 過年度スキップ=${preflight.skippedOtherYears}行` +
          _test18_describeNewColumns(preflight.newYearColumns) +
          _test18_describeUnreadable(preflight.unreadableRows)
        );
      } catch (e) {
        ng++;
        lines.push(`✖ ${domainSheetName} | ${e.message}`);
      }
    }
  }

  AppLogger.info(
    '【書き込みなし】18枚 集計前点検\n' +
    `今年度 = ${currentYear}\n` +
    lines.join('\n') +
    `\n----\n通る=${ok}枚 / 止まる=${ng}枚` +
    (ng === 0
      ? '\nすべて通ります。test18_run() で書き込んでください。'
      : '\n✖ の行を直してから test18_run() を実行してください。')
  );

  return { total: ok + ng, ok, ng, lines };
}

/**
 * 18枚を実際に全面再計算し、1組ごとの結果を表で報告する。
 *
 * 中身は本番の runDomainAggregation()。1組失敗しても残りは処理され、
 * _SYNC_JOBS へジョブ結果が残る。失敗が1枚でもあれば、レポートを出したうえで
 * 例外を再送出する（失敗を成功扱いにしないため）。
 *
 * @returns {ReturnType<typeof runDomainAggregation>}
 */
function test18_run() {
  const startedAtMs = Date.now();
  let summary;
  let batchError;

  try {
    summary = runDomainAggregation();
  } catch (e) {
    batchError = e;
    summary = e.aggregationSummary;
  }

  if (!summary) {
    // 集計そのものに入る前（ログ書き込み失敗など）で落ちたケース
    AppLogger.error('test18_run: 18枚の再計算を開始できませんでした', batchError, {
      durationMs: Date.now() - startedAtMs,
    });
    throw batchError;
  }

  const lines = summary.results.map((r) => (
    r.success
      ? `✔ ${r.domainSheetName} | 対象年度=${r.targetYear}` +
        ` 集計対象=${r.sourceRows}行 書込=${r.cells}セル 検証済=${r.verifiedCells}セル` +
        _test18_describeNewColumns(r.newYearColumns) +
        (r.unreadableRows ? ` 年度が読めない行=${r.unreadableRows}件` : '')
      : `✖ ${r.domainSheetName} | [${r.stage}] ${r.message}`
  ));

  AppLogger.info(
    '18枚 全面再計算の結果\n' +
    lines.join('\n') +
    `\n----\n成功=${summary.succeeded}枚 / 失敗=${summary.failed}枚` +
    ` 所要=${summary.durationMs}ms` +
    (summary.failed === 0
      ? '\n18枚すべて書き込み済みです。'
      : `\n${summary.succeeded}枚は書き込み済みです。✖ の原因を直して再実行してください。`)
  );

  if (batchError) throw batchError;
  return summary;
}

/**
 * 新設した（する）年度列を1行に収まる形へ整える
 * @param {string[]} [newYearColumns]
 * @returns {string}
 * @private
 */
function _test18_describeNewColumns(newYearColumns) {
  if (!newYearColumns || newYearColumns.length === 0) return '';
  const shown = newYearColumns.slice(0, TEST18_SAMPLE_LIMIT).join(', ');
  const omitted = newYearColumns.length - Math.min(newYearColumns.length, TEST18_SAMPLE_LIMIT);
  return ` 年度列を新設=[${shown}${omitted > 0 ? ` ほか${omitted}件` : ''}]`;
}

/**
 * 年度が読めず集計対象外にした行を1行に収まる形へ整える
 * @param {Array<{ cell: string, shown: string, customerName: string }>} [unreadableRows]
 * @returns {string}
 * @private
 */
function _test18_describeUnreadable(unreadableRows) {
  if (!unreadableRows || unreadableRows.length === 0) return '';
  const shown = unreadableRows
    .slice(0, TEST18_SAMPLE_LIMIT)
    .map((r) => `${r.cell}(${r.customerName})`)
    .join(', ');
  const omitted = unreadableRows.length - Math.min(unreadableRows.length, TEST18_SAMPLE_LIMIT);
  return ` ⚠年度が読めず対象外=${unreadableRows.length}件[${shown}${omitted > 0 ? ' ほか' : ''}]`;
}
