/* ========================================
   学年俯瞰モーダル - ロジック
   ======================================== */

let settings = {};
let allTasks = [];
let viewMode = 'table'; // 'table' or 'card'

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });
  document.body.addEventListener('click', (e) => {
    if (e.target === document.body) window.close();
  });

  // ビュータブ切替
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      viewMode = tab.dataset.view;
      renderOverview();
    });
  });

  await loadSettings();
  if (!settings.gasUrl) {
    showError('設定が未完了です。サイドパネルの設定タブからGAS URLを設定してください。');
    return;
  }
  fetchAllTasks();
});

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      settings = result.settings || {};
      resolve();
    });
  });
}

// --- API ---
async function apiGet(action, params = {}) {
  const url = new URL(settings.gasUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('タイムアウト');
    throw e;
  }
}

async function apiPost(action, body = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(settings.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, ...body }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('タイムアウト');
    throw e;
  }
}

// --- データ取得 ---
async function fetchAllTasks() {
  const body = document.getElementById('overview-body');
  body.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><div>読み込み中...</div></div>';
  try {
    const data = await apiGet('getAllTasks');
    allTasks = data.tasks || [];
    renderOverview();
  } catch (e) {
    showError('データ取得エラー: ' + e.message);
  }
}

// --- ソート ---
function getSortedTasks() {
  return [...allTasks].sort((a, b) => {
    if (a.approved !== b.approved) return a.approved ? 1 : -1;
    const da = parseDeadline(a.deadline);
    const db = parseDeadline(b.deadline);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
}

// --- 描画 ---
function renderOverview() {
  const body = document.getElementById('overview-body');
  const total = parseInt(settings.totalClasses) || 2;

  if (allTasks.length === 0) {
    body.innerHTML = '<div class="empty-state"><div class="icon">👀</div><div>タスクがありません</div></div>';
    return;
  }

  const sorted = getSortedTasks();

  if (viewMode === 'table') {
    body.innerHTML = renderTable(sorted, total);
  } else {
    body.innerHTML = '<div class="overview-grid">' +
      sorted.map(task => renderCard(task, total)).join('') +
      '</div>';
  }

  bindEvents();
}

// --- テーブルビュー ---
function renderTable(tasks, total) {
  let headerCells = '<th class="th-task">タスク</th><th class="th-deadline">締切</th>';
  for (let i = 1; i <= total; i++) {
    headerCells += '<th class="th-check">' + i + '組</th>';
  }
  headerCells += '<th class="th-check">主任</th><th class="th-check">担任外</th>';
  headerCells += '<th class="th-progress">進捗</th><th class="th-action">決済</th>';

  let rows = '';
  for (const task of tasks) {
    const { assigned, completed } = getAssignedCount(task, total);
    const percent = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
    const isComplete = percent === 100;

    let deadlineClass = '';
    if (task.deadline) {
      if (isOverdue(task.deadline)) deadlineClass = 'overdue';
      else if (isThisWeek(task.deadline)) deadlineClass = 'this-week';
    }

    let rowClass = task.approved ? 'approved-row' : '';

    rows += '<tr class="' + rowClass + '">';
    rows += '<td class="task-name-cell">' + esc(task.task) + '</td>';
    rows += '<td class="deadline-cell ' + deadlineClass + '">' + esc(task.deadline || '') + '</td>';

    // クラスチェック
    for (let i = 1; i <= total; i++) {
      if (task['assignKumi' + i]) {
        rows += '<td class="check-cell ' + (task['kumi' + i] ? 'done' : 'pending') + '">' +
          (task['kumi' + i] ? '✅' : '☐') + '</td>';
      } else {
        rows += '<td class="check-cell na">―</td>';
      }
    }

    // 学年主任チェック
    if (task.assignLeader) {
      rows += '<td class="check-cell ' + (task.leader ? 'done' : 'pending') + '">' +
        (task.leader ? '✅' : '☐') + '</td>';
    } else {
      rows += '<td class="check-cell na">―</td>';
    }

    // 担任外チェック
    if (task.assignTanningai) {
      rows += '<td class="check-cell ' + (task.tanningai ? 'done' : 'pending') + '">' +
        (task.tanningai ? '✅' : '☐') + '</td>';
    } else {
      rows += '<td class="check-cell na">―</td>';
    }

    // 進捗
    rows += '<td class="progress-cell">' +
      '<div class="progress-mini"><div class="progress-mini-fill ' + (isComplete ? 'complete' : '') +
      '" style="width:' + percent + '%"></div></div>' +
      '<span class="progress-mini-text">' + percent + '%</span></td>';

    // 決済ボタン
    if (task.approved) {
      rows += '<td><button class="btn-approve-mini approved-btn" data-row="' + task.row +
        '" data-approved="true">✅済</button></td>';
    } else if (isComplete) {
      rows += '<td><button class="btn-approve-mini enabled" data-row="' + task.row +
        '" data-approved="false">決済</button></td>';
    } else {
      rows += '<td><button class="btn-approve-mini disabled" disabled>―</button></td>';
    }

    rows += '</tr>';
  }

  return '<table class="overview-table"><thead><tr>' + headerCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// --- カードビュー ---
function renderCard(task, total) {
  const { assigned, completed } = getAssignedCount(task, total);
  const percent = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
  const isComplete = percent === 100;

  let deadlineClass = 'normal';
  if (task.deadline) {
    if (isOverdue(task.deadline)) deadlineClass = 'overdue';
    else if (isThisWeek(task.deadline)) deadlineClass = 'this-week';
  }

  let matrix = '';
  for (let i = 1; i <= total; i++) {
    const isAssigned = task['assignKumi' + i];
    const checked = task['kumi' + i];
    if (isAssigned) {
      matrix += '<div class="matrix-cell ' + (checked ? 'checked' : '') + '">' +
        '<span class="matrix-label">' + i + '組</span>' +
        '<span class="matrix-status">' + (checked ? '✅' : '☐') + '</span></div>';
    } else {
      matrix += '<div class="matrix-cell not-assigned">' +
        '<span class="matrix-label">' + i + '組</span>' +
        '<span class="matrix-status">―</span></div>';
    }
  }

  // 学年主任
  if (task.assignLeader) {
    matrix += '<div class="matrix-cell ' + (task.leader ? 'checked' : '') + '">' +
      '<span class="matrix-label">主任</span>' +
      '<span class="matrix-status">' + (task.leader ? '✅' : '☐') + '</span></div>';
  }

  // 担任外
  if (task.assignTanningai) {
    matrix += '<div class="matrix-cell ' + (task.tanningai ? 'checked' : '') + '">' +
      '<span class="matrix-label">担任外</span>' +
      '<span class="matrix-status">' + (task.tanningai ? '✅' : '☐') + '</span></div>';
  }

  let approveBtn = '';
  if (task.approved) {
    approveBtn = '<button class="btn-approve approved-btn" data-row="' + task.row + '" data-approved="true">✅ 学年済（クリックで取消）</button>';
  } else if (isComplete) {
    approveBtn = '<button class="btn-approve enabled" data-row="' + task.row + '" data-approved="false">学年済にする</button>';
  } else {
    approveBtn = '<button class="btn-approve disabled" disabled>未完了あり（決済不可）</button>';
  }

  return '<div class="card ' + (task.approved ? 'approved' : '') + '">' +
    '<div class="card-header">' +
      '<span class="task-name">' + esc(task.task) + '</span>' +
      (task.deadline ? '<span class="deadline ' + deadlineClass + '">' + esc(task.deadline) + '</span>' : '') +
      (task.approved ? '<span class="approved-badge">学年済</span>' : '') +
    '</div>' +
    '<div class="progress-wrap">' +
      '<div class="progress-bar"><div class="progress-fill ' + (isComplete ? 'complete' : '') + '" style="width:' + percent + '%"></div></div>' +
      '<div class="progress-text">' + completed + ' / ' + assigned + ' (' + percent + '%)</div>' +
    '</div>' +
    '<div class="matrix">' + matrix + '</div>' +
    approveBtn +
  '</div>';
}

// --- イベント ---
function bindEvents() {
  document.querySelectorAll('.btn-approve:not([disabled]), .btn-approve-mini:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = parseInt(btn.dataset.row);
      const isApproved = btn.dataset.approved === 'true';
      const title = isApproved ? '決済取り消し' : '学年済の決済';
      const msg = isApproved ? 'この学年済の決済を取り消しますか？' : 'このタスクを学年済として決済しますか？';

      const ok = await showConfirm(title, msg);
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = '処理中...';
      try {
        await apiPost('approveTask', { row, approved: !isApproved });
        showToast(isApproved ? '決済を取り消しました' : '学年済として決済しました', 'success');
        fetchAllTasks();
      } catch (e) {
        showToast('エラー: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = isApproved ? '✅ 済' : '決済';
      }
    });
  });
}

// --- ユーティリティ ---
function getAssignedCount(task, total) {
  let assigned = 0, completed = 0;
  for (let i = 1; i <= total; i++) {
    if (task['assignKumi' + i]) {
      assigned++;
      if (task['kumi' + i]) completed++;
    }
  }
  if (task.assignLeader) {
    assigned++;
    if (task.leader) completed++;
  }
  if (task.assignTanningai) {
    assigned++;
    if (task.tanningai) completed++;
  }
  return { assigned, completed };
}

function parseDeadline(str) {
  if (!str) return null;
  if (/^\d{1,2}\/\d{1,2}$/.test(str)) {
    const [m, d] = str.split('/').map(Number);
    return new Date(new Date().getFullYear(), m - 1, d);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function isOverdue(deadline) {
  const d = parseDeadline(deadline);
  if (!d) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return d < today;
}

function isThisWeek(deadline) {
  const d = parseDeadline(deadline);
  if (!d) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(today); end.setDate(end.getDate() + (7 - end.getDay()));
  return d >= today && d <= end;
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showError(msg) {
  document.getElementById('overview-body').innerHTML =
    '<div class="error-state">' + esc(msg) + '</div>';
}

function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML =
      '<div class="confirm-dialog">' +
        '<h4>' + esc(title) + '</h4>' +
        '<p>' + esc(message) + '</p>' +
        '<div class="confirm-actions">' +
          '<button class="btn-cancel" id="c-no">キャンセル</button>' +
          '<button class="btn-ok" id="c-yes">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#c-yes').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.querySelector('#c-no').addEventListener('click', () => { overlay.remove(); resolve(false); });
  });
}
