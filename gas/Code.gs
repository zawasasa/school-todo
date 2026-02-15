/* ========================================
   ささっと学年TODOアプリ - Google Apps Script
   ======================================== */

// スプレッドシートIDを設定（デプロイ時に変更）
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
const TASK_SHEET_NAME = 'やることチェックシート';

// --- 列マッピング（学年タスクシート） ---
const TASK_COLS = {
  number: 1,         // A: #
  deadline: 2,       // B: 締め切り日
  task: 3,           // C: やること
  detail: 4,         // D: 詳細
  link: 5,           // E: リンク
  submitTo: 6,       // F: 提出先・保存先
  approved: 7,       // G: 学年済 ★MOVED from N
  gakunen: 8,        // H: 全完了（自動）
  kumi1: 9,          // I: 1組
  kumi2: 10,         // J: 2組
  kumi3: 11,         // K: 3組
  kumi4: 12,         // L: 4組
  leader: 13,        // M: 学年主任
  tanningai: 14,     // N: 担任外
  assignKumi1: 15,   // O: 担当1組
  assignKumi2: 16,   // P: 担当2組
  assignKumi3: 17,   // Q: 担当3組
  assignKumi4: 18,   // R: 担当4組
  assignLeader: 19,  // S: 担当学年主任
  assignTanningai: 20 // T: 担当担任外
};

// --- 列マッピング（プライベートタスクシート） ---
const PRIVATE_COLS = {
  number: 1,       // A: #
  task: 2,         // B: やること
  deadline: 3,     // C: 締め切り日
  priority: 4,     // D: 優先度
  category: 5,     // E: カテゴリ
  memo: 6,         // F: メモ
  link: 7,         // G: リンク
  repeat: 8,       // H: 繰り返し
  repeatBase: 9,   // I: 繰り返し基準日
  completed: 10,   // J: 完了
  completedDate: 11 // K: 完了日
};

// ========================================
// エントリポイント
// ========================================

function doGet(e) {
  const action = e.parameter.action;
  try {
    switch (action) {
      case 'getTasks': return jsonResponse(getTasks());
      case 'getAllTasks': return jsonResponse(getAllTasks());
      case 'getConfig': return jsonResponse(getConfig());
      case 'getPrivateTasks': return jsonResponse(getPrivateTasks(e.parameter.myClass));
      default: return jsonError('INVALID_ACTION', '不明なアクション: ' + action);
    }
  } catch (err) {
    return jsonError('INTERNAL_ERROR', err.message);
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonError('INVALID_JSON', 'リクエストボディのパースに失敗しました');
  }

  const action = body.action;
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonError('LOCK_TIMEOUT', '他のリクエストが処理中です。少し待ってから再度お試しください');
  }

  try {
    switch (action) {
      case 'addTask': return jsonResponse(addTask(body));
      case 'updateCheck': return jsonResponse(updateCheck(body));
      case 'updateAssignment': return jsonResponse(updateAssignment(body));
      case 'approveTask': return jsonResponse(approveTask(body));
      case 'addPrivateTask': return jsonResponse(addPrivateTask(body));
      case 'updatePrivateTask': return jsonResponse(updatePrivateTask(body));
      case 'deletePrivateTask': return jsonResponse(deletePrivateTask(body));
      case 'completePrivateTask': return jsonResponse(completePrivateTask(body));
      default: return jsonError('INVALID_ACTION', '不明なアクション: ' + action);
    }
  } catch (err) {
    return jsonError('INTERNAL_ERROR', err.message);
  } finally {
    lock.releaseLock();
  }
}

// ========================================
// レスポンスヘルパー
// ========================================

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(code, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', code, message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// スプレッドシートヘルパー
// ========================================

function getSpreadsheet() {
  const id = SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  // バインドスクリプトの場合
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getTaskSheet() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(TASK_SHEET_NAME);
  if (!sheet) throw new Error('シート「' + TASK_SHEET_NAME + '」が見つかりません');
  return sheet;
}

function getPrivateSheet(myClass) {
  let sheetName;
  if (['1', '2', '3', '4'].includes(String(myClass))) {
    sheetName = myClass + '組';
  } else if (myClass === 'leader') {
    sheetName = '学年主任';
  } else if (myClass === 'tanningai') {
    sheetName = '担任外';
  } else {
    throw new Error('不正なクラス識別子: ' + myClass);
  }
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('シート「' + sheetName + '」が見つかりません');
  return sheet;
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return (value.getMonth() + 1) + '/' + value.getDate();
  }
  return String(value);
}

function formatFullDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return value.getFullYear() + '/' + (value.getMonth() + 1) + '/' + value.getDate();
  }
  return String(value);
}

function toBool(value) {
  if (value === true || value === 'TRUE' || value === 'true') return true;
  return false;
}

// ========================================
// 学年タスクAPI実装
// ========================================

function getTasks() {
  const sheet = getTaskSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { tasks: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  const tasks = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const taskName = row[TASK_COLS.task - 1];
    const approved = toBool(row[TASK_COLS.approved - 1]);

    // C列が空 or 学年済はスキップ
    if (!taskName || approved) continue;

    tasks.push(buildTaskObject(row, i + 2));
  }

  return { tasks };
}

function getAllTasks() {
  const sheet = getTaskSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { tasks: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  const tasks = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const taskName = row[TASK_COLS.task - 1];
    if (!taskName) continue;

    tasks.push(buildTaskObject(row, i + 2));
  }

  return { tasks };
}

function buildTaskObject(row, rowNum) {
  return {
    row: rowNum,
    number: row[TASK_COLS.number - 1] || '',
    deadline: formatDate(row[TASK_COLS.deadline - 1]),
    task: row[TASK_COLS.task - 1] || '',
    detail: row[TASK_COLS.detail - 1] || '',
    link: row[TASK_COLS.link - 1] || '',
    submitTo: row[TASK_COLS.submitTo - 1] || '',
    gakunen: toBool(row[TASK_COLS.gakunen - 1]),
    kumi1: toBool(row[TASK_COLS.kumi1 - 1]),
    kumi2: toBool(row[TASK_COLS.kumi2 - 1]),
    kumi3: toBool(row[TASK_COLS.kumi3 - 1]),
    kumi4: toBool(row[TASK_COLS.kumi4 - 1]),
    leader: toBool(row[TASK_COLS.leader - 1]),
    tanningai: toBool(row[TASK_COLS.tanningai - 1]),
    approved: toBool(row[TASK_COLS.approved - 1]),
    assignKumi1: toBool(row[TASK_COLS.assignKumi1 - 1]),
    assignKumi2: toBool(row[TASK_COLS.assignKumi2 - 1]),
    assignKumi3: toBool(row[TASK_COLS.assignKumi3 - 1]),
    assignKumi4: toBool(row[TASK_COLS.assignKumi4 - 1]),
    assignLeader: toBool(row[TASK_COLS.assignLeader - 1]),
    assignTanningai: toBool(row[TASK_COLS.assignTanningai - 1])
  };
}

function addTask(body) {
  if (!body.task) throw new Error('タスク名は必須です');

  const sheet = getTaskSheet();
  const lastRow = sheet.getLastRow();

  // 番号自動採番
  let maxNumber = 0;
  if (lastRow >= 2) {
    const numbers = sheet.getRange(2, TASK_COLS.number, lastRow - 1, 1).getValues();
    for (const n of numbers) {
      const num = parseInt(n[0]);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }
  const newNumber = maxNumber + 1;
  const newRow = lastRow + 1;

  // 行データの構築
  const rowData = new Array(20).fill('');
  rowData[TASK_COLS.number - 1] = newNumber;
  rowData[TASK_COLS.deadline - 1] = body.deadline || '';
  rowData[TASK_COLS.task - 1] = body.task;
  rowData[TASK_COLS.detail - 1] = body.detail || '';
  rowData[TASK_COLS.link - 1] = body.link || '';
  rowData[TASK_COLS.submitTo - 1] = body.submitTo || '';
  rowData[TASK_COLS.gakunen - 1] = false;
  rowData[TASK_COLS.kumi1 - 1] = false;
  rowData[TASK_COLS.kumi2 - 1] = false;
  rowData[TASK_COLS.kumi3 - 1] = false;
  rowData[TASK_COLS.kumi4 - 1] = false;
  rowData[TASK_COLS.leader - 1] = false;
  rowData[TASK_COLS.tanningai - 1] = false;
  rowData[TASK_COLS.approved - 1] = false;
  rowData[TASK_COLS.assignKumi1 - 1] = toBool(body.assignKumi1);
  rowData[TASK_COLS.assignKumi2 - 1] = toBool(body.assignKumi2);
  rowData[TASK_COLS.assignKumi3 - 1] = toBool(body.assignKumi3);
  rowData[TASK_COLS.assignKumi4 - 1] = toBool(body.assignKumi4);
  rowData[TASK_COLS.assignLeader - 1] = toBool(body.assignLeader);
  rowData[TASK_COLS.assignTanningai - 1] = toBool(body.assignTanningai);

  sheet.getRange(newRow, 1, 1, 20).setValues([rowData]);

  // チェックボックスをデータ検証で設定
  const checkCols = [TASK_COLS.gakunen, TASK_COLS.kumi1, TASK_COLS.kumi2, TASK_COLS.kumi3, TASK_COLS.kumi4,
                     TASK_COLS.leader, TASK_COLS.tanningai,
                     TASK_COLS.approved, TASK_COLS.assignKumi1, TASK_COLS.assignKumi2,
                     TASK_COLS.assignKumi3, TASK_COLS.assignKumi4, TASK_COLS.assignLeader, TASK_COLS.assignTanningai];
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  for (const col of checkCols) {
    sheet.getRange(newRow, col).setDataValidation(rule);
  }

  // 追加後に自動ソート（締切順、空白行は下へ）
  SpreadsheetApp.flush();
  sortByDeadline_(sheet);

  // ソート後の実際の行番号を返す
  const sortedRow = findTaskRow_(sheet, newNumber);
  return { row: sortedRow || newRow, number: newNumber };
}

function updateCheck(body) {
  if (!body.row || !body.column) throw new Error('rowとcolumnは必須です');

  const columnMap = {
    gakunen: TASK_COLS.gakunen,
    kumi1: TASK_COLS.kumi1,
    kumi2: TASK_COLS.kumi2,
    kumi3: TASK_COLS.kumi3,
    kumi4: TASK_COLS.kumi4,
    leader: TASK_COLS.leader,
    tanningai: TASK_COLS.tanningai
  };

  const col = columnMap[body.column];
  if (!col) throw new Error('不正なcolumn値: ' + body.column);

  const sheet = getTaskSheet();
  const row = parseInt(body.row);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('指定行が存在しません');

  sheet.getRange(row, col).setValue(toBool(body.value));

  // クラスチェック更新時にG列（学年）を自動同期
  if (body.column !== 'gakunen') {
    SpreadsheetApp.flush(); // 書き込みを確定してから読み取る
    syncGakunenColumn_(sheet, row);
  }

  // 更新後のG列の値を返す
  const gakunenValue = toBool(sheet.getRange(row, TASK_COLS.gakunen).getValue());
  return { row, column: body.column, value: toBool(body.value), gakunen: gakunenValue };
}

// G列（学年）を全担当クラスの完了状況から自動同期
function syncGakunenColumn_(sheet, row) {
  const data = sheet.getRange(row, 1, 1, 20).getValues()[0];
  let allComplete = true;
  let hasAssignment = false;

  // クラスチェック
  for (let i = 1; i <= 4; i++) {
    const assignCol = TASK_COLS['assignKumi' + i];
    const checkCol = TASK_COLS['kumi' + i];
    if (toBool(data[assignCol - 1])) {
      hasAssignment = true;
      if (!toBool(data[checkCol - 1])) {
        allComplete = false;
        break;
      }
    }
  }

  // 学年主任チェック
  if (allComplete && toBool(data[TASK_COLS.assignLeader - 1])) {
    hasAssignment = true;
    if (!toBool(data[TASK_COLS.leader - 1])) allComplete = false;
  }

  // 担任外チェック
  if (allComplete && toBool(data[TASK_COLS.assignTanningai - 1])) {
    hasAssignment = true;
    if (!toBool(data[TASK_COLS.tanningai - 1])) allComplete = false;
  }

  if (hasAssignment) {
    sheet.getRange(row, TASK_COLS.gakunen).setValue(allComplete);
  }
}

function updateAssignment(body) {
  if (!body.row) throw new Error('rowは必須です');

  const sheet = getTaskSheet();
  const row = parseInt(body.row);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('指定行が存在しません');

  const assignCols = {
    assignKumi1: TASK_COLS.assignKumi1,
    assignKumi2: TASK_COLS.assignKumi2,
    assignKumi3: TASK_COLS.assignKumi3,
    assignKumi4: TASK_COLS.assignKumi4,
    assignLeader: TASK_COLS.assignLeader,
    assignTanningai: TASK_COLS.assignTanningai
  };

  for (const [key, col] of Object.entries(assignCols)) {
    if (key in body) {
      sheet.getRange(row, col).setValue(toBool(body[key]));
    }
  }

  return { row };
}

function approveTask(body) {
  if (!body.row) throw new Error('rowは必須です');

  const sheet = getTaskSheet();
  const row = parseInt(body.row);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('指定行が存在しません');

  const approved = toBool(body.approved);
  sheet.getRange(row, TASK_COLS.approved).setValue(approved);

  return { row, approved };
}

function getConfig() {
  const sheet = getTaskSheet();
  const lastRow = sheet.getLastRow();

  let lastTaskNumber = 0;
  if (lastRow >= 2) {
    const numbers = sheet.getRange(2, TASK_COLS.number, lastRow - 1, 1).getValues();
    for (const n of numbers) {
      const num = parseInt(n[0]);
      if (!isNaN(num) && num > lastTaskNumber) lastTaskNumber = num;
    }
  }

  return {
    config: {
      sheetName: TASK_SHEET_NAME,
      totalRows: lastRow,
      lastTaskNumber: lastTaskNumber
    }
  };
}

// ========================================
// プライベートタスクAPI実装
// ========================================

function getPrivateTasks(myClass) {
  if (!myClass) throw new Error('myClassパラメータは必須です');

  const sheet = getPrivateSheet(myClass);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { myClass: String(myClass), tasks: [], categories: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  const tasks = [];
  const categorySet = new Set();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const taskName = row[PRIVATE_COLS.task - 1];
    if (!taskName) continue;

    const category = row[PRIVATE_COLS.category - 1] || '';
    if (category) categorySet.add(category);

    tasks.push({
      row: i + 2,
      number: row[PRIVATE_COLS.number - 1] || '',
      task: taskName,
      deadline: formatDate(row[PRIVATE_COLS.deadline - 1]),
      priority: row[PRIVATE_COLS.priority - 1] || '中',
      category: category,
      memo: row[PRIVATE_COLS.memo - 1] || '',
      link: row[PRIVATE_COLS.link - 1] || '',
      repeat: row[PRIVATE_COLS.repeat - 1] || 'none',
      repeatBase: formatFullDate(row[PRIVATE_COLS.repeatBase - 1]),
      completed: toBool(row[PRIVATE_COLS.completed - 1]),
      completedDate: formatFullDate(row[PRIVATE_COLS.completedDate - 1])
    });
  }

  return {
    myClass: String(myClass),
    tasks,
    categories: Array.from(categorySet).sort()
  };
}

function addPrivateTask(body) {
  if (!body.myClass) throw new Error('myClassは必須です');
  if (!body.task) throw new Error('タスク名は必須です');

  const sheet = getPrivateSheet(body.myClass);
  const lastRow = sheet.getLastRow();

  // 番号自動採番
  let maxNumber = 0;
  if (lastRow >= 2) {
    const numbers = sheet.getRange(2, PRIVATE_COLS.number, lastRow - 1, 1).getValues();
    for (const n of numbers) {
      const num = parseInt(n[0]);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }
  const newNumber = maxNumber + 1;
  const newRow = lastRow + 1;

  const rowData = new Array(11).fill('');
  rowData[PRIVATE_COLS.number - 1] = newNumber;
  rowData[PRIVATE_COLS.task - 1] = body.task;
  rowData[PRIVATE_COLS.deadline - 1] = body.deadline || '';
  rowData[PRIVATE_COLS.priority - 1] = body.priority || '中';
  rowData[PRIVATE_COLS.category - 1] = body.category || '';
  rowData[PRIVATE_COLS.memo - 1] = body.memo || '';
  rowData[PRIVATE_COLS.link - 1] = body.link || '';
  rowData[PRIVATE_COLS.repeat - 1] = body.repeat || 'none';
  rowData[PRIVATE_COLS.repeatBase - 1] = body.deadline || '';
  rowData[PRIVATE_COLS.completed - 1] = false;
  rowData[PRIVATE_COLS.completedDate - 1] = '';

  sheet.getRange(newRow, 1, 1, 11).setValues([rowData]);

  // 完了列にチェックボックスのデータ検証
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(newRow, PRIVATE_COLS.completed).setDataValidation(rule);

  return { row: newRow, number: newNumber };
}

function updatePrivateTask(body) {
  if (!body.myClass) throw new Error('myClassは必須です');
  if (!body.row) throw new Error('rowは必須です');

  const sheet = getPrivateSheet(body.myClass);
  const row = parseInt(body.row);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('指定行が存在しません');

  // 更新対象のフィールド
  const updates = {};
  if ('task' in body) updates[PRIVATE_COLS.task] = body.task;
  if ('deadline' in body) updates[PRIVATE_COLS.deadline] = body.deadline;
  if ('priority' in body) updates[PRIVATE_COLS.priority] = body.priority;
  if ('category' in body) updates[PRIVATE_COLS.category] = body.category;
  if ('memo' in body) updates[PRIVATE_COLS.memo] = body.memo;
  if ('link' in body) updates[PRIVATE_COLS.link] = body.link;
  if ('repeat' in body) updates[PRIVATE_COLS.repeat] = body.repeat;

  for (const [col, value] of Object.entries(updates)) {
    sheet.getRange(row, parseInt(col)).setValue(value);
  }

  return { row };
}

function deletePrivateTask(body) {
  if (!body.myClass) throw new Error('myClassは必須です');
  if (!body.row) throw new Error('rowは必須です');

  const sheet = getPrivateSheet(body.myClass);
  const row = parseInt(body.row);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('指定行が存在しません');

  sheet.deleteRow(row);

  return { deletedRow: row };
}

function completePrivateTask(body) {
  if (!body.myClass) throw new Error('myClassは必須です');
  if (!body.row) throw new Error('rowは必須です');

  const sheet = getPrivateSheet(body.myClass);
  const row = parseInt(body.row);
  if (row < 2 || row > sheet.getLastRow()) throw new Error('指定行が存在しません');

  const completed = toBool(body.completed);
  const today = new Date();
  const todayStr = today.getFullYear() + '/' + (today.getMonth() + 1) + '/' + today.getDate();

  // 完了フラグ更新
  sheet.getRange(row, PRIVATE_COLS.completed).setValue(completed);

  // 完了日
  if (completed) {
    sheet.getRange(row, PRIVATE_COLS.completedDate).setValue(todayStr);
  } else {
    sheet.getRange(row, PRIVATE_COLS.completedDate).setValue('');
    return { row, completed, completedDate: '', newTask: null };
  }

  // 繰り返し処理
  const repeatType = sheet.getRange(row, PRIVATE_COLS.repeat).getValue();
  if (!repeatType || repeatType === 'none') {
    return { row, completed: true, completedDate: todayStr, newTask: null };
  }

  // 次回締め切り日を計算
  const nextDeadline = calcNextDeadline(today, repeatType);
  const nextDeadlineStr = (nextDeadline.getMonth() + 1) + '/' + nextDeadline.getDate();

  // 元のタスク情報を取得
  const rowData = sheet.getRange(row, 1, 1, 11).getValues()[0];
  const taskName = rowData[PRIVATE_COLS.task - 1];
  const priority = rowData[PRIVATE_COLS.priority - 1];
  const category = rowData[PRIVATE_COLS.category - 1];
  const memo = rowData[PRIVATE_COLS.memo - 1];
  const link = rowData[PRIVATE_COLS.link - 1];

  // 番号採番
  const lastRow = sheet.getLastRow();
  let maxNumber = 0;
  if (lastRow >= 2) {
    const numbers = sheet.getRange(2, PRIVATE_COLS.number, lastRow - 1, 1).getValues();
    for (const n of numbers) {
      const num = parseInt(n[0]);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }
  const newNumber = maxNumber + 1;
  const newRow = lastRow + 1;

  // 新規タスク作成
  const newRowData = new Array(11).fill('');
  newRowData[PRIVATE_COLS.number - 1] = newNumber;
  newRowData[PRIVATE_COLS.task - 1] = taskName;
  newRowData[PRIVATE_COLS.deadline - 1] = nextDeadlineStr;
  newRowData[PRIVATE_COLS.priority - 1] = priority || '中';
  newRowData[PRIVATE_COLS.category - 1] = category || '';
  newRowData[PRIVATE_COLS.memo - 1] = memo || '';
  newRowData[PRIVATE_COLS.link - 1] = link || '';
  newRowData[PRIVATE_COLS.repeat - 1] = repeatType;
  newRowData[PRIVATE_COLS.repeatBase - 1] = nextDeadlineStr;
  newRowData[PRIVATE_COLS.completed - 1] = false;
  newRowData[PRIVATE_COLS.completedDate - 1] = '';

  sheet.getRange(newRow, 1, 1, 11).setValues([newRowData]);

  // チェックボックスのデータ検証
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(newRow, PRIVATE_COLS.completed).setDataValidation(rule);

  return {
    row,
    completed: true,
    completedDate: todayStr,
    newTask: {
      row: newRow,
      number: newNumber,
      task: taskName,
      deadline: nextDeadlineStr,
      repeat: repeatType
    }
  };
}

function calcNextDeadline(baseDate, repeatType) {
  const next = new Date(baseDate);
  switch (repeatType) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      next.setDate(next.getDate() + 1);
  }
  return next;
}

// ========================================
// カスタムメニュー（スプレッドシートから直接操作）
// ========================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📋 ささっとTODO')
    .addItem('🔄 学年タスクを整理（締切順ソート）', 'menuOrganizeTasks')
    .addSeparator()
    .addItem('☑️ チェックボックスを修復', 'menuRepairCheckboxes')
    .addItem('📊 番号を振り直す', 'menuRenumber')
    .addSeparator()
    .addItem('🔧 G列マイグレーション（初回のみ）', 'migrateGakunenColumn')
    .addItem('🔧 主任・担任外チェック列追加', 'migrateAddCheckColumns')
    .addItem('🔧 学年済列をG列に移動 + 主任/担任外シート作成', 'migrateReorderApproved')
    .addToUi();
}

// --- 学年タスクを整理（締切順ソート、空白行は下へ） ---
function menuOrganizeTasks() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getTaskSheet();

  const sortedCount = sortByDeadline_(sheet);

  ui.alert('整理完了',
    sortedCount + '件のタスクを締切順にソートしました。\n（空白行は下に移動しました）',
    ui.ButtonSet.OK);
}

// --- チェックボックスを修復 ---
function menuRepairCheckboxes() {
  const sheet = getTaskSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  const checkCols = [
    TASK_COLS.gakunen, TASK_COLS.kumi1, TASK_COLS.kumi2, TASK_COLS.kumi3, TASK_COLS.kumi4,
    TASK_COLS.leader, TASK_COLS.tanningai,
    TASK_COLS.approved, TASK_COLS.assignKumi1, TASK_COLS.assignKumi2,
    TASK_COLS.assignKumi3, TASK_COLS.assignKumi4, TASK_COLS.assignLeader, TASK_COLS.assignTanningai
  ];

  for (const col of checkCols) {
    const range = sheet.getRange(2, col, lastRow - 1, 1);
    range.setDataValidation(checkRule);
    const values = range.getValues();
    for (let r = 0; r < values.length; r++) {
      if (values[r][0] !== true && values[r][0] !== false) {
        values[r][0] = toBool(values[r][0]);
      }
    }
    range.setValues(values);
  }

  SpreadsheetApp.getUi().alert('修復完了', 'チェックボックスを修復しました（' + (lastRow - 1) + '行）', SpreadsheetApp.getUi().ButtonSet.OK);
}

// --- 番号を振り直す ---
function menuRenumber() {
  const ui = SpreadsheetApp.getUi();
  const ss = getSpreadsheet();
  const activeSheet = ss.getActiveSheet();
  const sheetName = activeSheet.getName();

  let taskCol, numCol;
  if (sheetName === TASK_SHEET_NAME) {
    taskCol = TASK_COLS.task;
    numCol = TASK_COLS.number;
  } else if (['1組', '2組', '3組', '4組', '学年主任', '担任外'].includes(sheetName)) {
    taskCol = PRIVATE_COLS.task;
    numCol = PRIVATE_COLS.number;
  } else {
    ui.alert('このシートでは使用できません');
    return;
  }

  const lastRow = activeSheet.getLastRow();
  if (lastRow < 2) return;

  const tasks = activeSheet.getRange(2, taskCol, lastRow - 1, 1).getValues();
  const numbers = [];
  let num = 1;
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i][0]) {
      numbers.push([num]);
      num++;
    } else {
      numbers.push(['']);
    }
  }
  activeSheet.getRange(2, numCol, lastRow - 1, 1).setValues(numbers);

  ui.alert('採番完了', (num - 1) + '件のタスクに番号を振り直しました。', ui.ButtonSet.OK);
}

// --- 内部: 空白行を削除 ---
function deleteEmptyRows_(sheet, taskCol) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const data = sheet.getRange(2, taskCol, lastRow - 1, 1).getValues();
  let deletedCount = 0;

  // 下から削除（行番号がずれないように）
  for (let i = data.length - 1; i >= 0; i--) {
    if (!data[i][0] || String(data[i][0]).trim() === '') {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return deletedCount;
}

// --- 内部: 締切順ソート（空白行は下へ、タスクは上詰め） ---
function sortByDeadline_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return lastRow < 2 ? 0 : 1;

  const dataRange = sheet.getRange(2, 1, lastRow - 1, 20);
  const data = dataRange.getValues();

  // 元のインデックスを付与（安定ソート用）
  for (let i = 0; i < data.length; i++) {
    data[i]._origIdx = i;
  }

  // ソート: 空白行→最下部、学年済→下、未済→締切日昇順、同日付→元順序維持
  data.sort(function(a, b) {
    const aEmpty = !a[TASK_COLS.task - 1];
    const bEmpty = !b[TASK_COLS.task - 1];
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (aEmpty && bEmpty) return a._origIdx - b._origIdx;

    const aApproved = toBool(a[TASK_COLS.approved - 1]) ? 1 : 0;
    const bApproved = toBool(b[TASK_COLS.approved - 1]) ? 1 : 0;
    if (aApproved !== bApproved) return aApproved - bApproved;

    const aDate = parseSortDate_(a[TASK_COLS.deadline - 1]);
    const bDate = parseSortDate_(b[TASK_COLS.deadline - 1]);
    if (!aDate && !bDate) return a._origIdx - b._origIdx;
    if (!aDate) return 1;
    if (!bDate) return -1;
    if (aDate.getTime() !== bDate.getTime()) return aDate - bDate;
    return a._origIdx - b._origIdx;
  });

  // 元インデックスを削除してから書き戻す
  for (let i = 0; i < data.length; i++) {
    delete data[i]._origIdx;
  }

  dataRange.setValues(data);

  // ソート後にチェックボックスのデータ検証を再適用
  const checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  const checkCols = [
    TASK_COLS.gakunen, TASK_COLS.kumi1, TASK_COLS.kumi2, TASK_COLS.kumi3, TASK_COLS.kumi4,
    TASK_COLS.leader, TASK_COLS.tanningai,
    TASK_COLS.approved, TASK_COLS.assignKumi1, TASK_COLS.assignKumi2,
    TASK_COLS.assignKumi3, TASK_COLS.assignKumi4, TASK_COLS.assignLeader, TASK_COLS.assignTanningai
  ];
  for (const col of checkCols) {
    sheet.getRange(2, col, lastRow - 1, 1).setDataValidation(checkRule);
  }

  return data.filter(function(r) { return !!r[TASK_COLS.task - 1]; }).length;
}

// --- 内部: タスク番号で行を検索 ---
function findTaskRow_(sheet, taskNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const numbers = sheet.getRange(2, TASK_COLS.number, lastRow - 1, 1).getValues();
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i][0] == taskNumber) return i + 2;
  }
  return null;
}

// --- 内部: ソート用日付パース ---
function parseSortDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value);
  // "M/D" 形式
  if (/^\d{1,2}\/\d{1,2}$/.test(str)) {
    const parts = str.split('/');
    const year = new Date().getFullYear();
    return new Date(year, parseInt(parts[0]) - 1, parseInt(parts[1]));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ========================================
// トリガー登録（1回だけ実行）
// GASエディタから installTriggers() を実行してください
// ========================================

function installTriggers() {
  const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!ssId) throw new Error('先に setupSpreadsheet() を実行してください');

  const ss = SpreadsheetApp.openById(ssId);

  // 既存のonOpenトリガーを削除（重複防止）
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'onOpen') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // インストール可能トリガーとして登録
  ScriptApp.newTrigger('onOpen')
    .forSpreadsheet(ss)
    .onOpen()
    .create();

  Logger.log('onOpenトリガーを登録しました');
  SpreadsheetApp.getUi().alert('トリガー登録完了', 'スプレッドシートを開くと「📋 ささっとTODO」メニューが表示されるようになりました。', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ========================================
// G列マイグレーション（1回だけ実行）
// GASエディタから migrateGakunenColumn() を実行してください
// ========================================

function migrateGakunenColumn() {
  const sheet = getTaskSheet();

  // G列ヘッダーを変更
  sheet.getRange(1, TASK_COLS.gakunen).setValue('全完了（自動）');

  // 既存データのG列を再計算
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('マイグレーション完了', 'G列ヘッダーを「全完了（自動）」に変更しました。\nデータ行がないため再計算はスキップしました。', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 20).getValues();
  let updatedCount = 0;

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!row[TASK_COLS.task - 1]) continue; // 空行スキップ

    let allComplete = true;
    let hasAssignment = false;

    for (let i = 1; i <= 4; i++) {
      const assignCol = TASK_COLS['assignKumi' + i];
      const checkCol = TASK_COLS['kumi' + i];
      if (toBool(row[assignCol - 1])) {
        hasAssignment = true;
        if (!toBool(row[checkCol - 1])) {
          allComplete = false;
          break;
        }
      }
    }
    if (allComplete && toBool(row[TASK_COLS.assignLeader - 1])) {
      hasAssignment = true;
      if (!toBool(row[TASK_COLS.leader - 1])) allComplete = false;
    }
    if (allComplete && toBool(row[TASK_COLS.assignTanningai - 1])) {
      hasAssignment = true;
      if (!toBool(row[TASK_COLS.tanningai - 1])) allComplete = false;
    }

    if (hasAssignment) {
      sheet.getRange(r + 2, TASK_COLS.gakunen).setValue(allComplete);
      updatedCount++;
    }
  }

  SpreadsheetApp.getUi().alert('マイグレーション完了',
    'G列ヘッダー: 「学年」→「全完了（自動）」\n' +
    'G列再計算: ' + updatedCount + '件のタスクを更新しました。\n\n' +
    '今後G列はクラスのチェック状況から自動計算されます。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ========================================
// 学年主任・担任外チェック列追加マイグレーション
// K列の後に2列挿入 → 既存データは自動右シフト
// ========================================

function migrateAddCheckColumns() {
  const sheet = getTaskSheet();
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'マイグレーション確認',
    'K列の後に2列（学年主任チェック、担任外チェック）を挿入します。\n既存データは右にシフトされます。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  // K列（11列目）の後に2列挿入
  sheet.insertColumnsAfter(11, 2);

  // 新しいL,M列のヘッダー設定
  sheet.getRange(1, 12).setValue('学年主任');
  sheet.getRange(1, 13).setValue('担任外');

  // T列ヘッダーリネーム（旧R列「担当専科」→「担当担任外」）
  sheet.getRange(1, 20).setValue('担当担任外');

  // 新列にfalse + チェックボックスバリデーション設定
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    for (const col of [12, 13]) {
      const range = sheet.getRange(2, col, lastRow - 1, 1);
      const values = [];
      for (let i = 0; i < lastRow - 1; i++) {
        values.push([false]);
      }
      range.setValues(values);
      range.setDataValidation(checkRule);
    }
  }

  // G列再計算
  if (lastRow >= 2) {
    for (let r = 2; r <= lastRow; r++) {
      const taskName = sheet.getRange(r, TASK_COLS.task).getValue();
      if (taskName) {
        syncGakunenColumn_(sheet, r);
      }
    }
  }

  ui.alert('マイグレーション完了',
    '2列を挿入しました:\n' +
    '  L列: 学年主任チェック\n' +
    '  M列: 担任外チェック\n\n' +
    'T列ヘッダーを「担当担任外」に変更しました。\n' +
    'G列の再計算を実行しました。',
    ui.ButtonSet.OK);
}

// ========================================
// 初期セットアップ（1回だけ実行）
// GASエディタから setupSpreadsheet() を実行してください
// ========================================

function setupSpreadsheet() {
  // スプレッドシートIDをスクリプトプロパティに設定
  const ssId = 'YOUR_SPREADSHEET_ID_HERE'; // ← 自分のスプレッドシートIDに置き換えてください
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ssId);

  const ss = SpreadsheetApp.openById(ssId);

  // --- 1. 学年タスクシートのセットアップ ---
  let taskSheet = ss.getSheetByName(TASK_SHEET_NAME);
  if (!taskSheet) {
    taskSheet = ss.insertSheet(TASK_SHEET_NAME);
    Logger.log('「' + TASK_SHEET_NAME + '」シートを作成しました');
  }

  // ヘッダー行を設定（既存データがある場合はL列以降のみ追加）
  const taskHeaders = [
    '#', '締め切り日', 'やること', '詳細', 'リンク', '提出先・保存先',
    '学年済', '全完了（自動）',
    '1組', '2組', '3組', '4組',
    '学年主任', '担任外',
    '担当1組', '担当2組', '担当3組', '担当4組', '担当学年主任', '担当担任外'
  ];

  // 既存のヘッダーを確認
  const existingHeaders = taskSheet.getRange(1, 1, 1, taskSheet.getMaxColumns()).getValues()[0];
  const hasExistingData = existingHeaders[0] !== '' && existingHeaders[0] !== undefined;

  if (hasExistingData) {
    // 既存シート: G〜T列のヘッダーを追加/更新
    const newHeaders = taskHeaders.slice(6); // G列以降
    for (let i = 0; i < newHeaders.length; i++) {
      taskSheet.getRange(1, 7 + i).setValue(newHeaders[i]);
    }
    Logger.log('学年タスクシート: G〜T列のヘッダーを更新しました');

    // 既存データ行にチェックボックスを設定（G〜T列）
    const lastRow = taskSheet.getLastRow();
    if (lastRow >= 2) {
      const checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      for (let col = 7; col <= 20; col++) {
        const range = taskSheet.getRange(2, col, lastRow - 1, 1);
        range.setDataValidation(checkRule);
        // 空セルをfalseで初期化
        const values = range.getValues();
        for (let r = 0; r < values.length; r++) {
          if (values[r][0] === '' || values[r][0] === null || values[r][0] === undefined) {
            values[r][0] = false;
          }
        }
        range.setValues(values);
      }
      Logger.log('既存データ行にチェックボックスを設定しました（' + (lastRow - 1) + '行）');
    }
  } else {
    // 新規シート: 全ヘッダーを設定
    taskSheet.getRange(1, 1, 1, taskHeaders.length).setValues([taskHeaders]);
    Logger.log('学年タスクシート: 全ヘッダーを設定しました');
  }

  // ヘッダー行の書式設定
  const headerRange = taskSheet.getRange(1, 1, 1, 20);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#E8E0F5');
  taskSheet.setFrozenRows(1);

  // --- 2. プライベートタスクシートのセットアップ ---
  const privateHeaders = [
    '#', 'やること', '締め切り日', '優先度', 'カテゴリ',
    'メモ', 'リンク', '繰り返し', '繰り返し基準日', '完了', '完了日'
  ];

  const classNames = ['1組', '2組', '3組', '4組', '学年主任', '担任外'];
  for (const className of classNames) {
    let sheet = ss.getSheetByName(className);
    if (!sheet) {
      sheet = ss.insertSheet(className);
      Logger.log('「' + className + '」シートを作成しました');
    }

    // ヘッダーが空なら設定
    const firstCell = sheet.getRange(1, 1).getValue();
    if (!firstCell) {
      sheet.getRange(1, 1, 1, privateHeaders.length).setValues([privateHeaders]);
    }

    // ヘッダー行の書式設定
    const pHeaderRange = sheet.getRange(1, 1, 1, privateHeaders.length);
    pHeaderRange.setFontWeight('bold');
    pHeaderRange.setBackground('#E8E0F5');
    sheet.setFrozenRows(1);

    // 列幅調整
    sheet.setColumnWidth(1, 40);   // #
    sheet.setColumnWidth(2, 200);  // やること
    sheet.setColumnWidth(3, 100);  // 締め切り日
    sheet.setColumnWidth(4, 60);   // 優先度
    sheet.setColumnWidth(5, 100);  // カテゴリ
    sheet.setColumnWidth(6, 200);  // メモ
    sheet.setColumnWidth(7, 200);  // リンク
    sheet.setColumnWidth(8, 80);   // 繰り返し
    sheet.setColumnWidth(9, 100);  // 繰り返し基準日
    sheet.setColumnWidth(10, 50);  // 完了
    sheet.setColumnWidth(11, 100); // 完了日
  }

  Logger.log('===== セットアップ完了 =====');
  Logger.log('スプレッドシートID: ' + ssId);
  Logger.log('学年タスクシート: ' + TASK_SHEET_NAME);
  Logger.log('プライベートシート: 1組, 2組, 3組, 4組, 学年主任, 担任外');
}

// ========================================
// 学年済列移動 + 学年主任/担任外シート作成マイグレーション
// スプレッドシートメニューから1回だけ実行してください
// ========================================

function migrateReorderApproved() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'マイグレーション確認',
    '以下の変更を実行します:\n' +
    '1. N列（学年済）をG列に移動\n' +
    '2. 「学年主任」「担任外」プライベートシートを作成\n\n' +
    '※ 既にG列が「学年済」の場合は移動をスキップします。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  const ss = getSpreadsheet();
  const sheet = getTaskSheet();
  const lastRow = sheet.getLastRow();
  const maxRows = Math.max(lastRow, 1);

  // --- 1. N列（学年済）をG列に移動 ---
  const currentG = sheet.getRange(1, 7).getValue();
  let columnMoved = false;

  if (String(currentG) !== '学年済') {
    // 現在の14列目（学年済）をG列（7列目）の前に移動
    // moveColumns(range, destinationIndex): destinationIndexはinsert前の列番号
    sheet.moveColumns(sheet.getRange(1, 14, maxRows, 1), 7);
    columnMoved = true;
    Logger.log('N列（学年済）をG列に移動しました');

    // チェックボックス再適用（G〜T列）
    if (lastRow >= 2) {
      const checkRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      for (let col = 7; col <= 14; col++) {
        sheet.getRange(2, col, lastRow - 1, 1).setDataValidation(checkRule);
      }
      // 担当列（O〜T: 15〜20）もチェックボックス再適用
      for (let col = 15; col <= 20; col++) {
        sheet.getRange(2, col, lastRow - 1, 1).setDataValidation(checkRule);
      }
    }
  } else {
    Logger.log('G列は既に「学年済」です。列移動をスキップしました');
  }

  // --- 2. 学年主任・担任外プライベートシート作成 ---
  const privateHeaders = [
    '#', 'やること', '締め切り日', '優先度', 'カテゴリ',
    'メモ', 'リンク', '繰り返し', '繰り返し基準日', '完了', '完了日'
  ];

  const newSheetNames = ['学年主任', '担任外'];
  const createdSheets = [];

  for (const sheetName of newSheetNames) {
    let privateSheet = ss.getSheetByName(sheetName);
    if (!privateSheet) {
      privateSheet = ss.insertSheet(sheetName);
      privateSheet.getRange(1, 1, 1, privateHeaders.length).setValues([privateHeaders]);
      const headerRange = privateSheet.getRange(1, 1, 1, privateHeaders.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#E8E0F5');
      privateSheet.setFrozenRows(1);
      privateSheet.setColumnWidth(1, 40);
      privateSheet.setColumnWidth(2, 200);
      privateSheet.setColumnWidth(3, 100);
      privateSheet.setColumnWidth(4, 60);
      privateSheet.setColumnWidth(5, 100);
      privateSheet.setColumnWidth(6, 200);
      privateSheet.setColumnWidth(7, 200);
      privateSheet.setColumnWidth(8, 80);
      privateSheet.setColumnWidth(9, 100);
      privateSheet.setColumnWidth(10, 50);
      privateSheet.setColumnWidth(11, 100);
      createdSheets.push(sheetName);
      Logger.log('「' + sheetName + '」シートを作成しました');
    } else {
      Logger.log('「' + sheetName + '」シートは既に存在します。スキップしました');
    }
  }

  // --- 結果表示 ---
  let msg = '';
  if (columnMoved) {
    msg += '✅ N列（学年済）をG列に移動しました\n';
    msg += '   G:学年済  H:全完了(自動)  I:1組  J:2組  K:3組  L:4組  M:学年主任  N:担任外\n\n';
  } else {
    msg += 'ℹ️ 列移動: 既にG列が「学年済」のためスキップ\n\n';
  }
  if (createdSheets.length > 0) {
    msg += '✅ プライベートシート作成: ' + createdSheets.join(', ') + '\n';
  } else {
    msg += 'ℹ️ プライベートシート: 既に存在するためスキップ\n';
  }

  ui.alert('マイグレーション完了', msg, ui.ButtonSet.OK);
}
