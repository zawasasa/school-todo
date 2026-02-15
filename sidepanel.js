/* ========================================
   ささっと学年TODOアプリ - メインロジック
   ======================================== */

// --- テーマ定義 ---
const THEMES = {
  purple: { name: 'パープル', vars: { '--primary': '#9B8EC4', '--primary-light': '#C4B8E0', '--primary-dark': '#7B6FA0', '--primary-bg': '#F3F0FA', '--accent': '#E8E0F5', '--border': '#E0DCF0', '--shadow': 'rgba(155,142,196,0.12)' }},
  blue:   { name: 'ブルー',   vars: { '--primary': '#6B9EC4', '--primary-light': '#A3C4E0', '--primary-dark': '#4A7A9F', '--primary-bg': '#EFF5FA', '--accent': '#DDE9F5', '--border': '#D0DCE8', '--shadow': 'rgba(107,158,196,0.12)' }},
  green:  { name: 'グリーン', vars: { '--primary': '#7BB88C', '--primary-light': '#A8D4B4', '--primary-dark': '#5A9468', '--primary-bg': '#EFF7F1', '--accent': '#DFF0E4', '--border': '#CCE4D2', '--shadow': 'rgba(123,184,140,0.12)' }},
  pink:   { name: 'ピンク',   vars: { '--primary': '#C48EA0', '--primary-light': '#E0B8C8', '--primary-dark': '#A06F80', '--primary-bg': '#FAF0F4', '--accent': '#F5E0EA', '--border': '#F0D0DC', '--shadow': 'rgba(196,142,160,0.12)' }}
};

// --- 状態管理 ---
const state = {
  settings: {
    gasUrl: '',
    spreadsheetId: '',
    myClass: '1',
    myRoles: [],
    isLeader: false,
    totalClasses: 2,
    fontSize: 100,
    theme: 'purple'
  },
  tasks: [],
  taskFilter: { completion: 'incomplete', overdue: false, thisWeek: false, myAssign: false },
  privateTasks: [],
  privateFilter: { completion: 'incomplete', overdue: false, thisWeek: false },
  privateCategoryFilter: '',
  privateCategories: [],
  activeTab: 'tasks',
  loading: false,
  error: null
};

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', async () => {
  // サイドパネルが開いたことを記録
  chrome.storage.local.set({ sidePanelOpen: true });

  await loadSettings();
  initTabs();
  initTaskTab();
  initPrivateTab();
  initSettingsTab();

  // 学年俯瞰ボタンバー
  document.getElementById('btn-open-overview').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('overview.html') });
  });
  if (!state.settings.gasUrl) {
    switchTab('settings');
    showSettingsMessage('GAS Web App URLを設定してください。', 'error');
  } else {
    fetchTasks();
  }
});

// サイドパネルが閉じる時
window.addEventListener('beforeunload', () => {
  chrome.storage.local.set({ sidePanelOpen: false });
});

// 閉じるメッセージ受信（タイムスタンプ方式）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.shouldCloseSidePanel) {
    const val = changes.shouldCloseSidePanel.newValue;
    if (val && typeof val === 'number') {
      chrome.storage.local.set({ shouldCloseSidePanel: 0 });
      window.close();
    }
  }
});

// --- 設定の読み込み/保存 ---
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (result) => {
      if (result.settings) {
        Object.assign(state.settings, result.settings);
      }
      applySettings();
      resolve();
    });
  });
}

async function saveSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: state.settings }, resolve);
  });
}

function applySettings() {
  // 旧設定 'senka' → 'tanningai' 自動移行
  if (state.settings.myRoles && state.settings.myRoles.includes('senka')) {
    const idx = state.settings.myRoles.indexOf('senka');
    state.settings.myRoles[idx] = 'tanningai';
    saveSettings();
  }
  // 表示クラス数に応じて3組・4組の表示切り替え
  updateClassVisibility();
  // ロールステータス更新
  updateRoleStatus();
  // テーマ適用
  applyTheme(state.settings.theme || 'purple');
  // 文字サイズ適用
  document.body.style.zoom = (state.settings.fontSize || 100) / 100;
}

function applyTheme(themeName) {
  const theme = THEMES[themeName];
  if (!theme) return;
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([prop, value]) => {
    root.style.setProperty(prop, value);
  });
}

function updateRoleStatus() {
  const el = document.getElementById('role-status');
  if (!el) return;
  const myClass = state.settings.myClass;
  const roles = state.settings.myRoles || [];
  const parts = [];
  if (myClass !== 'none') {
    parts.push(myClass + '組担任');
  }
  if (roles.includes('leader')) parts.push('学年主任');
  if (roles.includes('tanningai')) parts.push('担任外');
  el.textContent = parts.length > 0 ? parts.join('・') : '未設定';
}

function updateClassVisibility() {
  const total = parseInt(state.settings.totalClasses);
  document.querySelectorAll('.assign-kumi3').forEach(el => {
    el.style.display = total >= 3 ? '' : 'none';
  });
  document.querySelectorAll('.assign-kumi4').forEach(el => {
    el.style.display = total >= 4 ? '' : 'none';
  });
}

// --- タブ制御 ---
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const activeTabBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (activeTabBtn) activeTabBtn.classList.add('active');
  const activeContent = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.classList.add('active');

  // タブ切り替え時にデータ再取得
  if (tabName === 'tasks' && state.settings.gasUrl) fetchTasks();
  if (tabName === 'private' && state.settings.gasUrl) fetchPrivateTasks();
}

// --- API通信 ---
async function apiGet(action, params = {}) {
  const url = new URL(state.settings.gasUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message || 'API error');
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('タイムアウト: サーバーが応答しません');
    throw e;
  }
}

async function apiPost(action, body = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(state.settings.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, ...body }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message || 'API error');
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('タイムアウト: サーバーが応答しません');
    throw e;
  }
}

// --- トースト通知 ---
function showToast(message, type = 'info', retryFn = null) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let html = `<span>${message}</span>`;
  if (retryFn) {
    html += `<button class="btn-retry" onclick="this.closest('.toast').retryFn()">リトライ</button>`;
    toast.retryFn = () => { toast.remove(); retryFn(); };
  }
  html += `<button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  toast.innerHTML = html;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// --- 確認ダイアログ ---
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h4>${title}</h4>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-cancel" id="confirm-no">キャンセル</button>
          <button class="btn btn-primary" id="confirm-yes">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-yes').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('#confirm-no').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
  });
}

// --- 日付ユーティリティ ---
function parseDeadline(str) {
  if (!str) return null;
  // "M/D" 形式 or "YYYY/MM/DD" 形式 or "YYYY-MM-DD"
  if (/^\d{1,2}\/\d{1,2}$/.test(str)) {
    const [m, d] = str.split('/').map(Number);
    const now = new Date();
    const year = now.getFullYear();
    return new Date(year, m - 1, d);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function isOverdue(deadline) {
  if (!deadline) return false;
  const d = parseDeadline(deadline);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function isThisWeek(deadline) {
  if (!deadline) return false;
  const d = parseDeadline(deadline);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
  return d >= today && d <= weekEnd;
}

function formatDeadline(str) {
  if (!str) return '';
  return str;
}

// --- プライベートシートキー ---
function getPrivateSheetKey() {
  const myClass = state.settings.myClass;
  if (myClass !== 'none') return myClass;
  if (state.settings.isLeader || state.settings.myRoles.includes('leader')) {
    return 'leader';
  }
  return 'tanningai';
}

// --- 担当判定ユーティリティ ---
function isMyAssignment(task) {
  const myClass = state.settings.myClass;
  const myRoles = state.settings.myRoles;
  // クラス担任の場合のみクラス担当チェック
  if (myClass !== 'none') {
    if (task[`assignKumi${myClass}`]) return true;
  }
  if (myRoles.includes('leader') && task.assignLeader) return true;
  if (myRoles.includes('tanningai') && task.assignTanningai) return true;
  return false;
}

function isTaskCompletedForMe(task) {
  if (!isMyAssignment(task)) return true; // 担当でないならば完了扱い
  const myClass = state.settings.myClass;
  const myRoles = state.settings.myRoles;
  // 自分のクラスが担当されてて未チェック → 未完了（クラスありの場合のみ）
  if (myClass !== 'none' && task[`assignKumi${myClass}`] && !task[`kumi${myClass}`]) return false;
  // 学年主任が担当されてて未チェック → 未完了
  if (myRoles.includes('leader') && task.assignLeader && !task.leader) return false;
  // 担任外が担当されてて未チェック → 未完了
  if (myRoles.includes('tanningai') && task.assignTanningai && !task.tanningai) return false;
  return true;
}

function isAllAssigneesCompleted(task) {
  const total = parseInt(state.settings.totalClasses);
  for (let i = 1; i <= total; i++) {
    if (task[`assignKumi${i}`] && !task[`kumi${i}`]) return false;
  }
  if (task.assignLeader && !task.leader) return false;
  if (task.assignTanningai && !task.tanningai) return false;
  return true;
}

function getAssignedCount(task) {
  const total = parseInt(state.settings.totalClasses);
  let assigned = 0;
  let completed = 0;
  for (let i = 1; i <= total; i++) {
    if (task[`assignKumi${i}`]) {
      assigned++;
      if (task[`kumi${i}`]) completed++;
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

// ========================================
// 学年タスクタブ
// ========================================

function initTaskTab() {
  // 完了状態ラジオボタン
  document.querySelectorAll('input[name="task-completion"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.taskFilter.completion = radio.value;
      renderTasks();
    });
  });
  // 条件チェックボックス
  document.getElementById('filter-overdue').addEventListener('change', (e) => {
    state.taskFilter.overdue = e.target.checked;
    renderTasks();
  });
  document.getElementById('filter-thisWeek').addEventListener('change', (e) => {
    state.taskFilter.thisWeek = e.target.checked;
    renderTasks();
  });
  document.getElementById('filter-myAssign').addEventListener('change', (e) => {
    state.taskFilter.myAssign = e.target.checked;
    renderTasks();
  });
  // 更新ボタン
  document.getElementById('btn-refresh-tasks').addEventListener('click', () => {
    const btn = document.getElementById('btn-refresh-tasks');
    btn.classList.add('spinning');
    fetchTasks().finally(() => btn.classList.remove('spinning'));
  });
  // 追加ボタン
  document.getElementById('btn-add-task').addEventListener('click', () => {
    const form = document.getElementById('task-add-form');
    form.classList.toggle('hidden');
  });
  document.getElementById('btn-cancel-task').addEventListener('click', () => {
    document.getElementById('task-add-form').classList.add('hidden');
    clearTaskForm();
  });
  document.getElementById('btn-submit-task').addEventListener('click', submitNewTask);

  // プリセットボタン
  document.querySelectorAll('#task-add-form .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyAssignPreset(btn.dataset.preset, 'new-task-assigns'));
  });
}

function applyAssignPreset(preset, containerId) {
  const container = document.getElementById(containerId);
  const total = parseInt(state.settings.totalClasses);
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    const assign = cb.dataset.assign;
    if (preset === 'all') {
      // 表示中のクラスと役職を全チェック
      if (assign.startsWith('assignKumi')) {
        const num = parseInt(assign.replace('assignKumi', ''));
        cb.checked = num <= total;
      } else {
        cb.checked = true;
      }
    } else if (preset === 'classes') {
      if (assign.startsWith('assignKumi')) {
        const num = parseInt(assign.replace('assignKumi', ''));
        cb.checked = num <= total;
      } else {
        cb.checked = false;
      }
    } else {
      cb.checked = false;
    }
  });
}

function clearTaskForm() {
  document.getElementById('new-task-name').value = '';
  document.getElementById('new-task-deadline').value = '';
  document.getElementById('new-task-detail').value = '';
  document.getElementById('new-task-link').value = '';
  document.getElementById('new-task-submit').value = '';
  document.querySelectorAll('#new-task-assigns input[type="checkbox"]').forEach(cb => cb.checked = false);
}

async function fetchTasks() {
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '<div class="skeleton-loader"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
  try {
    const data = await apiGet('getTasks');
    state.tasks = data.tasks || [];
    renderTasks();
  } catch (e) {
    taskList.innerHTML = '';
    showToast(`タスク取得エラー: ${e.message}`, 'error', fetchTasks);
  }
}

function filterTasks(tasks) {
  const f = state.taskFilter;
  return tasks.filter(task => {
    // 1. 完了状態フィルタ（ラジオ）
    if (f.completion === 'incomplete' && isTaskCompletedForMe(task)) return false;
    if (f.completion === 'completed' && !isTaskCompletedForMe(task)) return false;

    // 2. 条件フィルタ（チェックボックス、OR結合）
    const hasCondition = f.overdue || f.thisWeek || f.myAssign;
    if (hasCondition) {
      let match = false;
      if (f.overdue && isOverdue(task.deadline)) match = true;
      if (f.thisWeek && isThisWeek(task.deadline)) match = true;
      if (f.myAssign && isMyAssignment(task)) match = true;
      if (!match) return false;
    }

    return true;
  });
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const da = parseDeadline(a.deadline);
    const db = parseDeadline(b.deadline);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
}

function renderTasks() {
  const taskList = document.getElementById('task-list');
  const filtered = sortTasks(filterTasks(state.tasks));

  if (filtered.length === 0) {
    taskList.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>表示するタスクがありません</p></div>';
    return;
  }

  taskList.innerHTML = filtered.map(task => renderTaskCard(task)).join('');
  bindTaskCardEvents();
}

function renderTaskCard(task) {
  const myAssigned = isMyAssignment(task);
  const completed = isTaskCompletedForMe(task);
  const overdue = isOverdue(task.deadline);
  const thisWeek = isThisWeek(task.deadline);
  const total = parseInt(state.settings.totalClasses);

  let cardClass = 'task-card';
  if (completed) cardClass += ' completed';
  if (!myAssigned && !state.settings.isLeader) cardClass += ' not-assigned';
  if (overdue && !completed) cardClass += ' overdue';
  else if (thisWeek && !completed) cardClass += ' this-week';

  let deadlineClass = '';
  if (overdue && !completed) deadlineClass = 'overdue';
  else if (thisWeek && !completed) deadlineClass = 'this-week';

  // 担当バッジ
  let badges = '';
  for (let i = 1; i <= total; i++) {
    if (task[`assignKumi${i}`]) {
      badges += `<span class="assign-badge class-badge">${i}組</span>`;
    }
  }
  if (task.assignLeader) badges += '<span class="assign-badge role-badge">学年主任</span>';
  if (task.assignTanningai) badges += '<span class="assign-badge role-badge">担任外</span>';
  if (!badges && !state.settings.isLeader) badges = '<span class="not-assigned-label">担当外</span>';

  // 決済済みバッジ
  let approvedBadge = task.approved ? '<span class="approved-badge">学年済</span>' : '';

  // チェックボックス
  let checks = '';
  if (state.settings.isLeader) {
    // 学年主任は担当クラスのチェックを表示
    for (let i = 1; i <= total; i++) {
      if (task[`assignKumi${i}`]) {
        checks += renderCheckItem(`${i}組`, `kumi${i}`, task[`kumi${i}`], task.row);
      }
    }
    // 学年主任自身のチェック
    if (task.assignLeader) {
      checks += renderCheckItem('主任', 'leader', task.leader, task.row);
    }
    // 担任外のチェック
    if (task.assignTanningai) {
      checks += renderCheckItem('担任外', 'tanningai', task.tanningai, task.row);
    }
  } else if (myAssigned) {
    const myClass = state.settings.myClass;
    if (myClass !== 'none' && task[`assignKumi${myClass}`]) {
      checks += renderCheckItem(`${myClass}組`, `kumi${myClass}`, task[`kumi${myClass}`], task.row);
    }
    // 学年主任ロールを持つ場合
    if (state.settings.myRoles.includes('leader') && task.assignLeader) {
      checks += renderCheckItem('主任', 'leader', task.leader, task.row);
    }
    // 担任外ロールを持つ場合
    if (state.settings.myRoles.includes('tanningai') && task.assignTanningai) {
      checks += renderCheckItem('担任外', 'tanningai', task.tanningai, task.row);
    }
    // ミニ進捗: 他の完了状況を表示
    const { assigned, completed: doneCount } = getAssignedCount(task);
    if (assigned > 1) {
      checks += `<span class="mini-progress">${doneCount}/${assigned}完了</span>`;
    }
  }

  // リンク
  const linkIcon = task.link ? `<a href="${escapeHtml(task.link)}" target="_blank" class="task-link-icon" title="リンクを開く" onclick="event.stopPropagation()">🔗</a>` : '';

  // 提出先
  const submitTo = task.submitTo ? `<div class="task-submit-to">提出先: ${escapeHtml(task.submitTo)}</div>` : '';

  return `
    <div class="${cardClass}" data-row="${task.row}">
      <div class="task-card-header">
        ${task.deadline ? `<span class="task-deadline ${deadlineClass}">${escapeHtml(formatDeadline(task.deadline))}</span>` : ''}
        <span class="task-name">${escapeHtml(task.task)}</span>
        ${linkIcon}
        ${approvedBadge}
      </div>
      ${submitTo}
      <div class="assign-badges" data-row="${task.row}">${badges}</div>
      ${checks ? `<div class="task-checks">${checks}</div>` : ''}
      ${task.detail ? `<div class="task-detail">${escapeHtml(task.detail)}</div>` : ''}
    </div>
  `;
}

function renderCheckItem(label, column, checked, row) {
  return `
    <label class="task-check-item" data-row="${row}" data-column="${column}">
      <input type="checkbox" ${checked ? 'checked' : ''} data-row="${row}" data-column="${column}">
      <span class="spinner-small"></span>
      ${label}
    </label>
  `;
}

function bindTaskCardEvents() {
  // カード展開（詳細表示）
  document.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('input, a, .assign-badges, .assign-edit-panel, button')) return;
      card.classList.toggle('expanded');
    });
  });

  // チェックボックス
  document.querySelectorAll('.task-checks input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      handleCheckToggle(cb);
    });
  });

  // 担当バッジクリック→編集パネル
  document.querySelectorAll('.assign-badges').forEach(badges => {
    badges.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = parseInt(badges.dataset.row);
      toggleAssignEditPanel(badges, row);
    });
  });
}

async function handleCheckToggle(cb) {
  const row = parseInt(cb.dataset.row);
  const column = cb.dataset.column;
  const value = cb.checked;
  const item = cb.closest('.task-check-item');

  item.classList.add('loading');
  cb.disabled = true;

  try {
    const result = await apiPost('updateCheck', { row, column, value });
    // ローカル状態を更新（チェック値 + G列同期結果）
    const task = state.tasks.find(t => t.row === row);
    if (task) {
      task[column] = value;
      if (result && result.gakunen !== undefined) {
        task.gakunen = result.gakunen;
      }
    }
    item.classList.remove('loading');
    cb.disabled = false;
    // 完了状態の再レンダリング
    renderTasks();
  } catch (e) {
    // ロールバック
    cb.checked = !value;
    item.classList.remove('loading');
    cb.disabled = false;
    showToast(`更新エラー: ${e.message}`, 'error');
  }
}

function toggleAssignEditPanel(badgesEl, row) {
  // 既存パネルがあれば閉じる
  const existing = badgesEl.parentElement.querySelector('.assign-edit-panel');
  if (existing) {
    existing.remove();
    return;
  }

  const task = state.tasks.find(t => t.row === row);
  if (!task) return;
  const total = parseInt(state.settings.totalClasses);

  const panel = document.createElement('div');
  panel.className = 'assign-edit-panel';
  panel.innerHTML = `
    <div class="assign-presets">
      <button type="button" class="preset-btn" data-preset="all">全員</button>
      <button type="button" class="preset-btn" data-preset="classes">クラスのみ</button>
      <button type="button" class="preset-btn" data-preset="clear">クリア</button>
    </div>
    <div class="assign-checkboxes" id="assign-edit-${row}">
      <label><input type="checkbox" data-assign="assignKumi1" ${task.assignKumi1 ? 'checked' : ''}> 1組</label>
      <label><input type="checkbox" data-assign="assignKumi2" ${task.assignKumi2 ? 'checked' : ''}> 2組</label>
      <label class="assign-kumi3" style="display:${total >= 3 ? '' : 'none'}"><input type="checkbox" data-assign="assignKumi3" ${task.assignKumi3 ? 'checked' : ''}> 3組</label>
      <label class="assign-kumi4" style="display:${total >= 4 ? '' : 'none'}"><input type="checkbox" data-assign="assignKumi4" ${task.assignKumi4 ? 'checked' : ''}> 4組</label>
      <label><input type="checkbox" data-assign="assignLeader" ${task.assignLeader ? 'checked' : ''}> 学年主任</label>
      <label><input type="checkbox" data-assign="assignTanningai" ${task.assignTanningai ? 'checked' : ''}> 担任外</label>
    </div>
    <div class="assign-edit-actions">
      <button class="btn btn-cancel btn-assign-cancel" style="font-size:11px;padding:3px 8px;">キャンセル</button>
      <button class="btn btn-primary btn-assign-save" style="font-size:11px;padding:3px 8px;">保存</button>
    </div>
  `;

  panel.addEventListener('click', e => e.stopPropagation());

  // プリセット
  panel.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const containerId = `assign-edit-${row}`;
      applyAssignPreset(btn.dataset.preset, containerId);
    });
  });

  // キャンセル
  panel.querySelector('.btn-assign-cancel').addEventListener('click', () => panel.remove());

  // 保存
  panel.querySelector('.btn-assign-save').addEventListener('click', async () => {
    const assigns = {};
    panel.querySelectorAll(`#assign-edit-${row} input[type="checkbox"]`).forEach(cb => {
      assigns[cb.dataset.assign] = cb.checked;
    });
    const saveBtn = panel.querySelector('.btn-assign-save');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-small"></span> 保存中';
    try {
      await apiPost('updateAssignment', { row, ...assigns });
      // ローカル状態更新
      const t = state.tasks.find(tk => tk.row === row);
      if (t) Object.assign(t, assigns);
      panel.remove();
      renderTasks();
      showToast('担当を更新しました', 'success');
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
      showToast(`担当更新エラー: ${e.message}`, 'error');
    }
  });

  badgesEl.parentElement.insertBefore(panel, badgesEl.nextSibling);
}

async function submitNewTask() {
  const name = document.getElementById('new-task-name').value.trim();
  if (!name) {
    showToast('タスク名を入力してください', 'error');
    return;
  }

  // 担当チェック
  const assigns = {};
  let hasAssign = false;
  document.querySelectorAll('#new-task-assigns input[type="checkbox"]').forEach(cb => {
    assigns[cb.dataset.assign] = cb.checked;
    if (cb.checked) hasAssign = true;
  });
  if (!hasAssign) {
    showToast('担当を1つ以上選択してください', 'error');
    return;
  }

  const deadlineInput = document.getElementById('new-task-deadline').value;
  let deadline = '';
  if (deadlineInput) {
    const d = new Date(deadlineInput);
    deadline = `${d.getMonth() + 1}/${d.getDate()}`;
  }

  const body = {
    task: name,
    deadline,
    detail: document.getElementById('new-task-detail').value.trim(),
    link: document.getElementById('new-task-link').value.trim(),
    submitTo: document.getElementById('new-task-submit').value.trim(),
    ...assigns
  };

  const btn = document.getElementById('btn-submit-task');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-small"></span> 追加中...';

  try {
    await apiPost('addTask', body);
    showToast('タスクを追加しました', 'success');
    document.getElementById('task-add-form').classList.add('hidden');
    clearTaskForm();
    fetchTasks();
  } catch (e) {
    showToast(`追加エラー: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '追加';
  }
}

// ========================================
// プライベートタスクタブ
// ========================================

function initPrivateTab() {
  // 完了状態ラジオボタン
  document.querySelectorAll('input[name="private-completion"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.privateFilter.completion = radio.value;
      renderPrivateTasks();
    });
  });
  // 条件チェックボックス
  document.getElementById('private-filter-overdue').addEventListener('change', (e) => {
    state.privateFilter.overdue = e.target.checked;
    renderPrivateTasks();
  });
  document.getElementById('private-filter-thisWeek').addEventListener('change', (e) => {
    state.privateFilter.thisWeek = e.target.checked;
    renderPrivateTasks();
  });

  // カテゴリフィルタ
  document.getElementById('category-filter').addEventListener('change', (e) => {
    state.privateCategoryFilter = e.target.value;
    renderPrivateTasks();
  });

  // 更新ボタン
  document.getElementById('btn-refresh-private').addEventListener('click', () => {
    const btn = document.getElementById('btn-refresh-private');
    btn.classList.add('spinning');
    fetchPrivateTasks().finally(() => btn.classList.remove('spinning'));
  });
  // 追加ボタン
  document.getElementById('btn-add-private').addEventListener('click', () => {
    openPrivateForm();
  });
  document.getElementById('btn-cancel-private').addEventListener('click', () => {
    document.getElementById('private-add-form').classList.add('hidden');
    clearPrivateForm();
  });
  document.getElementById('btn-submit-private').addEventListener('click', submitPrivateTask);
}

function openPrivateForm(editTask = null) {
  const form = document.getElementById('private-add-form');
  form.classList.remove('hidden');

  if (editTask) {
    document.getElementById('private-form-title').textContent = 'プライベートタスク編集';
    document.getElementById('private-edit-row').value = editTask.row;
    document.getElementById('new-private-name').value = editTask.task || '';
    document.getElementById('new-private-deadline').value = convertToInputDate(editTask.deadline) || '';
    document.getElementById('new-private-priority').value = editTask.priority || '中';
    document.getElementById('new-private-category').value = editTask.category || '';
    document.getElementById('new-private-memo').value = editTask.memo || '';
    document.getElementById('new-private-link').value = editTask.link || '';
    document.getElementById('new-private-repeat').value = editTask.repeat || 'none';
    document.getElementById('btn-submit-private').textContent = '保存';
  } else {
    document.getElementById('private-form-title').textContent = 'プライベートタスク追加';
    document.getElementById('private-edit-row').value = '';
    clearPrivateForm();
    document.getElementById('btn-submit-private').textContent = '追加';
  }
}

function convertToInputDate(str) {
  if (!str) return '';
  // "M/D" → "YYYY-MM-DD"
  if (/^\d{1,2}\/\d{1,2}$/.test(str)) {
    const [m, d] = str.split('/');
    const year = new Date().getFullYear();
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // "YYYY/MM/DD" → "YYYY-MM-DD"
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
    return str.replace(/\//g, '-');
  }
  return str;
}

function clearPrivateForm() {
  document.getElementById('new-private-name').value = '';
  document.getElementById('new-private-deadline').value = '';
  document.getElementById('new-private-priority').value = '中';
  document.getElementById('new-private-category').value = '';
  document.getElementById('new-private-memo').value = '';
  document.getElementById('new-private-link').value = '';
  document.getElementById('new-private-repeat').value = 'none';
  document.getElementById('private-edit-row').value = '';
}

async function fetchPrivateTasks() {
  const list = document.getElementById('private-task-list');
  list.innerHTML = '<div class="skeleton-loader"><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
  try {
    const data = await apiGet('getPrivateTasks', { myClass: getPrivateSheetKey() });
    state.privateTasks = data.tasks || [];
    state.privateCategories = data.categories || [];
    updateCategorySuggestions();
    updateCategoryFilter();
    renderPrivateTasks();
  } catch (e) {
    list.innerHTML = '';
    showToast(`プライベートタスク取得エラー: ${e.message}`, 'error', fetchPrivateTasks);
  }
}

function updateCategorySuggestions() {
  const datalist = document.getElementById('category-suggestions');
  datalist.innerHTML = state.privateCategories.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function updateCategoryFilter() {
  const select = document.getElementById('category-filter');
  const current = select.value;
  select.innerHTML = '<option value="">カテゴリ</option>';
  state.privateCategories.forEach(c => {
    select.innerHTML += `<option value="${escapeHtml(c)}" ${c === current ? 'selected' : ''}>${escapeHtml(c)}</option>`;
  });
}

function filterPrivateTasks(tasks) {
  const f = state.privateFilter;
  return tasks.filter(task => {
    // 完了状態フィルタ
    if (f.completion === 'incomplete' && task.completed) return false;
    if (f.completion === 'completed' && !task.completed) return false;
    // 条件チェックボックス（OR結合）
    const hasCondition = f.overdue || f.thisWeek;
    if (hasCondition) {
      let match = false;
      if (f.overdue && isOverdue(task.deadline)) match = true;
      if (f.thisWeek && isThisWeek(task.deadline)) match = true;
      if (!match) return false;
    }
    // カテゴリフィルタ
    if (state.privateCategoryFilter && task.category !== state.privateCategoryFilter) return false;
    return true;
  });
}

function sortPrivateTasks(tasks) {
  const priorityOrder = { '高': 0, '中': 1, '低': 2 };
  return [...tasks].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 1;
    const pb = priorityOrder[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    const da = parseDeadline(a.deadline);
    const db = parseDeadline(b.deadline);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
}

function renderPrivateTasks() {
  const list = document.getElementById('private-task-list');
  const filtered = sortPrivateTasks(filterPrivateTasks(state.privateTasks));

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🔒</div><p>表示するタスクがありません</p></div>';
    return;
  }

  list.innerHTML = filtered.map(task => renderPrivateCard(task)).join('');
  bindPrivateCardEvents();
}

function renderPrivateCard(task) {
  const completed = task.completed;
  const overdue = isOverdue(task.deadline) && !completed;
  const thisWeek = isThisWeek(task.deadline) && !completed;
  const priority = task.priority || '中';
  const priorityClass = priority === '高' ? 'high' : priority === '低' ? 'low' : 'mid';

  let cardClass = 'private-card';
  if (completed) cardClass += ' completed';

  let deadlineClass = '';
  if (overdue) deadlineClass = 'overdue';
  else if (thisWeek) deadlineClass = 'this-week';

  const repeatIcon = task.repeat && task.repeat !== 'none' ? '<span class="private-repeat-icon" title="繰り返しタスク">🔄</span>' : '';
  const linkIcon = task.link ? `<a href="${escapeHtml(task.link)}" target="_blank" class="private-link-icon" title="リンクを開く" onclick="event.stopPropagation()">🔗</a>` : '';
  const categoryTag = task.category ? `<span class="category-tag">${escapeHtml(task.category)}</span>` : '';
  const completedDate = task.completedDate ? `<span class="completed-date">完了: ${escapeHtml(task.completedDate)}</span>` : '';

  const repeatLabels = { daily: '毎日', weekly: '毎週', monthly: '毎月' };
  const repeatLabel = task.repeat && task.repeat !== 'none' ? ` (${repeatLabels[task.repeat] || task.repeat})` : '';

  return `
    <div class="${cardClass}" data-row="${task.row}">
      <div class="private-priority-bar ${priorityClass}"></div>
      <div class="private-check">
        <input type="checkbox" ${completed ? 'checked' : ''} data-row="${task.row}" class="private-complete-cb">
      </div>
      <div class="private-card-body">
        <div class="private-card-header">
          <span class="private-task-name">${escapeHtml(task.task)}</span>
          ${repeatIcon}
          ${linkIcon}
        </div>
        <div class="private-meta">
          ${task.deadline ? `<span class="private-deadline ${deadlineClass}">${escapeHtml(formatDeadline(task.deadline))}</span>` : ''}
          <span class="priority-badge ${priorityClass}">${escapeHtml(priority)}</span>
          ${categoryTag}
          ${completedDate}
        </div>
        ${task.memo ? `<div class="private-memo">${escapeHtml(task.memo)}${repeatLabel}</div>` : (repeatLabel ? `<div class="private-memo">${repeatLabel}</div>` : '')}
      </div>
      <div class="private-card-actions">
        <button class="icon-btn edit" data-row="${task.row}" title="編集">✏️</button>
        <button class="icon-btn delete" data-row="${task.row}" title="削除">🗑️</button>
      </div>
    </div>
  `;
}

function bindPrivateCardEvents() {
  // カード展開（メモ表示）
  document.querySelectorAll('.private-card-body').forEach(body => {
    body.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      body.closest('.private-card').classList.toggle('expanded');
    });
  });

  // 完了チェック
  document.querySelectorAll('.private-complete-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      handlePrivateComplete(cb);
    });
  });

  // 編集ボタン
  document.querySelectorAll('.private-card-actions .edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = parseInt(btn.dataset.row);
      const task = state.privateTasks.find(t => t.row === row);
      if (task) openPrivateForm(task);
    });
  });

  // 削除ボタン
  document.querySelectorAll('.private-card-actions .delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = parseInt(btn.dataset.row);
      const ok = await showConfirm('タスクの削除', 'このタスクを削除しますか？');
      if (ok) deletePrivateTask(row);
    });
  });
}

async function handlePrivateComplete(cb) {
  const row = parseInt(cb.dataset.row);
  const completed = cb.checked;
  const card = cb.closest('.private-card');

  cb.disabled = true;
  try {
    const data = await apiPost('completePrivateTask', {
      myClass: getPrivateSheetKey(),
      row,
      completed
    });
    if (data.newTask) {
      showToast(`繰り返しタスク「${data.newTask.task}」を生成しました (${data.newTask.deadline})`, 'info');
    }
    fetchPrivateTasks();
  } catch (e) {
    cb.checked = !completed;
    cb.disabled = false;
    showToast(`完了更新エラー: ${e.message}`, 'error');
  }
}

async function submitPrivateTask() {
  const name = document.getElementById('new-private-name').value.trim();
  if (!name) {
    showToast('タスク名を入力してください', 'error');
    return;
  }

  const editRow = document.getElementById('private-edit-row').value;
  const deadlineInput = document.getElementById('new-private-deadline').value;
  let deadline = '';
  if (deadlineInput) {
    const d = new Date(deadlineInput);
    deadline = `${d.getMonth() + 1}/${d.getDate()}`;
  }

  const body = {
    myClass: getPrivateSheetKey(),
    task: name,
    deadline,
    priority: document.getElementById('new-private-priority').value,
    category: document.getElementById('new-private-category').value.trim(),
    memo: document.getElementById('new-private-memo').value.trim(),
    link: document.getElementById('new-private-link').value.trim(),
    repeat: document.getElementById('new-private-repeat').value
  };

  const btn = document.getElementById('btn-submit-private');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="spinner-small"></span> 処理中...';

  try {
    if (editRow) {
      body.row = parseInt(editRow);
      await apiPost('updatePrivateTask', body);
      showToast('タスクを更新しました', 'success');
    } else {
      await apiPost('addPrivateTask', body);
      showToast('タスクを追加しました', 'success');
    }
    document.getElementById('private-add-form').classList.add('hidden');
    clearPrivateForm();
    fetchPrivateTasks();
  } catch (e) {
    showToast(`エラー: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function deletePrivateTask(row) {
  try {
    await apiPost('deletePrivateTask', { myClass: getPrivateSheetKey(), row });
    showToast('タスクを削除しました', 'success');
    fetchPrivateTasks();
  } catch (e) {
    showToast(`削除エラー: ${e.message}`, 'error');
  }
}

// ========================================
// 設定画面
// ========================================

function initSettingsTab() {
  // 設定値の表示
  document.getElementById('setting-gas-url').value = state.settings.gasUrl;
  document.getElementById('setting-spreadsheet-id').value = state.settings.spreadsheetId;
  document.getElementById('setting-my-class').value = state.settings.myClass;
  document.getElementById('setting-role-leader').checked = state.settings.myRoles.includes('leader');
  document.getElementById('setting-role-tanningai').checked = state.settings.myRoles.includes('tanningai');
  document.getElementById('setting-leader-mode').checked = state.settings.isLeader;
  document.getElementById('setting-total-classes').value = state.settings.totalClasses;

  // 文字サイズスライダー
  const fontSlider = document.getElementById('setting-font-size');
  const fontValue = document.getElementById('font-size-value');
  fontSlider.value = state.settings.fontSize || 100;
  fontValue.textContent = fontSlider.value + '%';
  fontSlider.addEventListener('input', (e) => {
    fontValue.textContent = e.target.value + '%';
    document.body.style.zoom = parseInt(e.target.value) / 100;
  });

  // テーマセレクター
  const themeContainer = document.getElementById('theme-selector');
  const currentTheme = state.settings.theme || 'purple';
  themeContainer.innerHTML = Object.entries(THEMES).map(([key, theme]) =>
    `<div class="theme-option ${key === currentTheme ? 'active' : ''}" data-theme="${key}">
      <div class="theme-swatch" style="background: ${theme.vars['--primary']}"></div>
      <span>${theme.name}</span>
    </div>`
  ).join('');
  themeContainer.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      themeContainer.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      applyTheme(opt.dataset.theme);
    });
  });

  // 学年主任チェック→学年主任モード自動ON
  document.getElementById('setting-role-leader').addEventListener('change', (e) => {
    if (e.target.checked) {
      document.getElementById('setting-leader-mode').checked = true;
    }
  });

  // クラスなし選択時にロール未選択なら担任外を自動チェック
  document.getElementById('setting-my-class').addEventListener('change', (e) => {
    if (e.target.value === 'none') {
      const leaderCb = document.getElementById('setting-role-leader');
      const tanningaiCb = document.getElementById('setting-role-tanningai');
      if (!leaderCb.checked && !tanningaiCb.checked) {
        tanningaiCb.checked = true;
      }
    }
  });

  // 保存
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const gasUrl = document.getElementById('setting-gas-url').value.trim();
    const spreadsheetId = document.getElementById('setting-spreadsheet-id').value.trim();
    const myClass = document.getElementById('setting-my-class').value;
    const totalClasses = document.getElementById('setting-total-classes').value;

    if (!gasUrl) {
      showSettingsMessage('GAS Web App URLは必須です', 'error');
      return;
    }
    if (!spreadsheetId) {
      showSettingsMessage('スプレッドシートIDは必須です', 'error');
      return;
    }

    const roles = [];
    if (document.getElementById('setting-role-leader').checked) roles.push('leader');
    if (document.getElementById('setting-role-tanningai').checked) roles.push('tanningai');

    state.settings = {
      gasUrl,
      spreadsheetId,
      myClass,
      myRoles: roles,
      isLeader: document.getElementById('setting-leader-mode').checked,
      totalClasses: parseInt(totalClasses),
      fontSize: parseInt(document.getElementById('setting-font-size').value),
      theme: document.querySelector('.theme-option.active')?.dataset.theme || 'purple'
    };

    await saveSettings();
    applySettings();
    showSettingsMessage('設定を保存しました', 'success');
  });

  // 接続テスト
  document.getElementById('btn-test-connection').addEventListener('click', async () => {
    const gasUrl = document.getElementById('setting-gas-url').value.trim();
    if (!gasUrl) {
      showSettingsMessage('GAS URLを入力してください', 'error');
      return;
    }
    const btn = document.getElementById('btn-test-connection');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-small"></span> テスト中...';
    try {
      const url = new URL(gasUrl);
      url.searchParams.set('action', 'getConfig');
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.status === 'success') {
        showSettingsMessage(`接続成功! シート: ${data.config.sheetName}, 行数: ${data.config.totalRows}`, 'success');
      } else {
        showSettingsMessage(`接続エラー: ${data.message}`, 'error');
      }
    } catch (e) {
      showSettingsMessage(`接続失敗: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '接続テスト';
    }
  });

  // スプレッドシートを開く
  document.getElementById('btn-open-spreadsheet').addEventListener('click', () => {
    const id = document.getElementById('setting-spreadsheet-id').value.trim();
    if (!id) {
      showSettingsMessage('スプレッドシートIDを入力してください', 'error');
      return;
    }
    chrome.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  });
}

function showSettingsMessage(text, type) {
  const el = document.getElementById('settings-message');
  el.textContent = text;
  el.className = `settings-message ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// --- HTMLエスケープ ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
