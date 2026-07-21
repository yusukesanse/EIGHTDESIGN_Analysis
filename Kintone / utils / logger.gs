/**
 * logger.gs
 * ログ管理の統一
 * console出力の散在防止・障害解析を容易にする
 */

// ============================================================
// ログレベル定義
// ============================================================

/** @enum {string} ログレベル */
const LOG_LEVEL = {
  DEBUG: 'DEBUG',
  INFO:  'INFO',
  WARN:  'WARN',
  ERROR: 'ERROR',
};

// ============================================================
// ロガー本体
// ============================================================

/**
 * Logger ユーティリティ
 * DEBUG_MODE が true のときのみ DEBUG ログを出力する
 */
const AppLogger = {

  /**
   * DEBUGログを出力する（DEBUG_MODEがtrueの場合のみ）
   * @param {string} message - ログメッセージ
   * @param {*} [data] - 追加データ（オブジェクト等）
   */
  debug(message, data) {
    if (!DEBUG_MODE) return;
    _log(LOG_LEVEL.DEBUG, message, data);
  },

  /**
   * INFOログを出力する
   * @param {string} message - ログメッセージ
   * @param {*} [data] - 追加データ（オブジェクト等）
   */
  info(message, data) {
    _log(LOG_LEVEL.INFO, message, data);
  },

  /**
   * WARNログを出力する
   * @param {string} message - ログメッセージ
   * @param {*} [data] - 追加データ（オブジェクト等）
   */
  warn(message, data) {
    _log(LOG_LEVEL.WARN, message, data);
  },

  /**
   * ERRORログを出力し、Slack通知も送信する
   * @param {string} message - エラーメッセージ
   * @param {Error|null} [error] - Errorオブジェクト
   * @param {Object} [context] - 追加コンテキスト情報
   * @param {string} [context.functionName] - エラー発生関数名
   * @param {string} [context.customerName] - 処理中のお客様名
   * @param {string} [context.customerType] - 処理中の顧客種別
   */
  error(message, error, context = {}) {
    const detail = {
      ...(error ? { stack: error.stack, errorMessage: error.message } : {}),
      ...context,
    };
    _log(LOG_LEVEL.ERROR, message, detail);
    _notifySlack(message, error, context);
  },

  /**
   * 実行時間を計測してINFOログに記録するタイマーを返す
   * @param {string} label - 計測ラベル
   * @returns {{ stop: function(): number }} stopを呼ぶと経過msを返す
   */
  startTimer(label) {
    const start = Date.now();
    AppLogger.debug(`[TIMER START] ${label}`);
    return {
      stop() {
        const elapsed = Date.now() - start;
        AppLogger.info(`[TIMER END] ${label}: ${elapsed}ms`);
        return elapsed;
      },
    };
  },
};

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 実際のログ出力処理
 * @param {string} level - ログレベル
 * @param {string} message - メッセージ
 * @param {*} [data] - 追加データ
 */
function _log(level, message, data) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const prefix    = `[${timestamp}] [${level}]`;

  if (data !== undefined) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    console.log(`${prefix} ${message}\n${dataStr}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Slack通知送信
 * SLACK_WEBHOOK_URL が設定されていない場合はスキップ
 * @param {string} message - エラーメッセージ
 * @param {Error|null} [error] - Errorオブジェクト
 * @param {Object} [context] - コンテキスト情報
 */
function _notifySlack(message, error, context = {}) {
  if (!SLACK_WEBHOOK_URL) return;

  try {
    const lines = [
      `*:rotating_light: GAS エラー通知*`,
      `*メッセージ:* ${message}`,
    ];

    if (context.functionName) lines.push(`*発生関数:* ${context.functionName}`);
    if (context.customerName) lines.push(`*お客様名:* ${context.customerName}`);
    if (context.customerType) lines.push(`*顧客種別:* ${context.customerType}`);
    if (error?.stack)         lines.push(`*スタックトレース:*\n\`\`\`${error.stack}\`\`\``);

    const payload = JSON.stringify({ text: lines.join('\n') });

    UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
      method:      'post',
      contentType: 'application/json',
      payload:     payload,
    });
  } catch (slackErr) {
    console.error('Slack通知送信エラー:', slackErr);
  }
}