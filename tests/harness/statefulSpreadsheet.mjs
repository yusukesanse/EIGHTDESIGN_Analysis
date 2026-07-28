import assert from 'node:assert/strict';

const hasValue = (value) => value !== '' && value !== null && value !== undefined;

export class StatefulRange {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    this.sheet.events.push(`read:${this.sheet.name}:${this.row}:${this.col}:${this.numRows}:${this.numCols}`);
    return Array.from({ length: this.numRows }, (_, rowOffset) =>
      Array.from({ length: this.numCols }, (_, colOffset) =>
        this.sheet.valueAt(this.row + rowOffset, this.col + colOffset)
      )
    );
  }

  setValues(values) {
    assert.equal(values.length, this.numRows, 'setValues row count');
    for (const row of values) assert.equal(row.length, this.numCols, 'setValues col count');
    if (this.sheet.failSetValues?.({
      sheetName: this.sheet.name,
      row: this.row,
      col: this.col,
      values,
    })) {
      throw new Error(`forced setValues failure: ${this.sheet.name}`);
    }
    this.sheet.events.push(`write:${this.sheet.name}:${this.row}:${this.col}:${this.numRows}:${this.numCols}`);
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet.setValueAt(this.row + r, this.col + c, values[r][c]);
      }
    }
    return this;
  }

  setValue(value) {
    return this.setValues([[value]]);
  }
}

export class StatefulSheet {
  constructor(name, grid = [[]], options = {}) {
    this.name = name;
    this.grid = grid.map((row) => row.slice());
    this.events = options.events ?? [];
    this.failSetValues = options.failSetValues;
    this.maxColumns = Math.max(
      options.maxColumns ?? 0,
      26,
      ...this.grid.map((row) => row.length),
    );
    this.maxRows = Math.max(options.maxRows ?? 0, 100, this.grid.length);
  }

  getName() {
    return this.name;
  }

  getDataRange() {
    const rows = Math.max(this.grid.length, 1);
    const cols = Math.max(this.getLastColumn(), 1);
    return new StatefulRange(this, 1, 1, rows, cols);
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new StatefulRange(this, row, col, numRows, numCols);
  }

  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      if ((this.grid[r] ?? []).some(hasValue)) return r + 1;
    }
    return 0;
  }

  getLastColumn() {
    let last = 0;
    for (const row of this.grid) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (hasValue(row[c])) {
          last = Math.max(last, c + 1);
          break;
        }
      }
    }
    return last;
  }

  getMaxColumns() {
    return this.maxColumns;
  }

  getMaxRows() {
    return this.maxRows;
  }

  insertColumnsAfter(afterColumn, howMany) {
    assert.ok(afterColumn >= 1);
    assert.ok(howMany >= 1);
    this.maxColumns += howMany;
    for (const row of this.grid) {
      while (row.length < this.maxColumns) row.push('');
    }
  }

  insertRowAfter(afterRow) {
    assert.ok(afterRow >= 1);
    this.events.push(`insert-row:${this.name}:${afterRow}`);
    this.grid.splice(afterRow, 0, new Array(this.maxColumns).fill(''));
    this.maxRows++;
  }

  insertRowsAfter(afterRow, howMany) {
    assert.ok(afterRow >= 1);
    assert.ok(howMany >= 1);
    assert.ok(afterRow <= this.maxRows);
    this.events.push(`insert-rows:${this.name}:${afterRow}:${howMany}`);
    this.maxRows += howMany;
  }

  valueAt(row, col) {
    return this.grid[row - 1]?.[col - 1] ?? '';
  }

  setValueAt(row, col, value) {
    while (this.grid.length < row) this.grid.push([]);
    const target = this.grid[row - 1];
    while (target.length < col) target.push('');
    target[col - 1] = value;
    this.maxColumns = Math.max(this.maxColumns, col);
  }
}

export class StatefulSpreadsheet {
  constructor(sheets = [], options = {}) {
    this.events = options.events ?? [];
    this.failSetValues = options.failSetValues;
    this.sheets = new Map();
    for (const sheet of sheets) this.sheets.set(sheet.getName(), sheet);
  }

  getSheetByName(name) {
    this.events.push(`get-sheet:${name}`);
    return this.sheets.get(name) ?? null;
  }

  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error(`sheet already exists: ${name}`);
    this.events.push(`insert-sheet:${name}`);
    const sheet = new StatefulSheet(name, [[]], {
      events: this.events,
      failSetValues: this.failSetValues,
    });
    this.sheets.set(name, sheet);
    return sheet;
  }
}

export function makeStatefulGasPlatform(spreadsheet, options = {}) {
  const events = options.events ?? spreadsheet.events;
  let lockHeld = false;
  const lock = {
    waitLock(timeoutMs) {
      events.push(`lock-wait:${timeoutMs}`);
      if (options.lockError) throw options.lockError;
      lockHeld = true;
      events.push('lock-acquired');
    },
    releaseLock() {
      if (!lockHeld) throw new Error('releaseLock without acquired lock');
      events.push('lock-released');
      lockHeld = false;
    },
  };

  return {
    events,
    platformOverrides: {
      SpreadsheetApp: {
        openById: () => {
          events.push('spreadsheet-open');
          return spreadsheet;
        },
        flush: () => {
          events.push('spreadsheet-flush');
          if (options.flushError) throw options.flushError;
        },
      },
      LockService: {
        getScriptLock: () => lock,
      },
    },
  };
}
