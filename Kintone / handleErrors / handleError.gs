// function handleError(stack, message, func, name, type) {
//   try {
//     const ss    = _getSpreadsheet();
//     const sheet = ss.getSheetByName(ERROR_SHEET_NAME);

//     const now        = new Date();
//     const formatDate = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
//     const cxType     = transformCustomerType(type);

//     const writeArray = [[formatDate, func, name, cxType, stack, message]];
//     sheet.getRange(sheet.getLastRow() + 1, 1, 1, writeArray[0].length).setValues(writeArray);

//   } catch (e) {
//     // スタックと引数を全て出力して根本原因を特定できるようにする
//     AppLogger.error('handleError: シートへの書き込みに失敗しました', {
//       fallbackError:   String(e),
//       fallbackStack:   e.stack,
//       originalFunc:    func,
//       originalName:    name,
//       originalType:    type,
//       originalMessage: message,
//     });
//   }
// }


function handleError(stack, message, func, name, type) {
  AppLogger.error(`[${func}] ${name}(${type ?? ''}): ${message}`, { stack });
}