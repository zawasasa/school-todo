/* ========================================
   ささっと学年TODOアプリ - Content Script (Toggle Tab)
   ======================================== */
(function () {
  'use strict';

  const TAB_ID = 'sasatto-todo-toggle-tab';
  const TAB_WIDTH = 32;
  const TAB_HEIGHT = 64;
  const MARGIN = 20;

  // 紫色テーマ
  const COLOR_DEFAULT = '#9B8EC4';
  const COLOR_HOVER = '#B0A4D4';
  const COLOR_DRAG = '#7B6FA0';

  // 二重注入防止
  if (document.getElementById(TAB_ID)) return;
  // トップレベルフレームのみ
  if (window.self !== window.top) return;

  // --- 動的配置（衝突回避） ---
  function findAvailablePosition() {
    const defaultTop = Math.round((window.innerHeight - TAB_HEIGHT) / 2);
    const rightEdgeElements = [];

    try {
      const all = document.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.id === TAB_ID) continue;
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed') continue;
        const rect = el.getBoundingClientRect();
        if (
          rect.right >= window.innerWidth - 50 &&
          rect.width > 15 && rect.width < 120 &&
          rect.height > 30 && rect.height < 200
        ) {
          rightEdgeElements.push({
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height
          });
        }
      }
    } catch (e) {
      // CSP制限等でエラーになる場合はデフォルト位置を使う
    }

    if (rightEdgeElements.length === 0) return defaultTop;

    // 衝突チェック関数
    function isColliding(top) {
      const bottom = top + TAB_HEIGHT;
      for (const el of rightEdgeElements) {
        if (top < el.bottom + 8 && bottom > el.top - 8) return true;
      }
      return false;
    }

    // デフォルト位置で衝突なし → そのまま
    if (!isColliding(defaultTop)) return defaultTop;

    // 下方向に探索
    for (let t = defaultTop + 10; t < window.innerHeight - TAB_HEIGHT - MARGIN; t += 10) {
      if (!isColliding(t)) return t;
    }

    // 上方向に探索
    for (let t = defaultTop - 10; t >= MARGIN; t -= 10) {
      if (!isColliding(t)) return t;
    }

    return defaultTop;
  }

  // --- トグルタブ作成 ---
  function createToggleTab() {
    const tab = document.createElement('div');
    tab.id = TAB_ID;

    // スタイル
    Object.assign(tab.style, {
      position: 'fixed',
      right: '0',
      width: TAB_WIDTH + 'px',
      height: TAB_HEIGHT + 'px',
      background: COLOR_DEFAULT,
      borderRadius: '8px 0 0 8px',
      cursor: 'pointer',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '16px',
      boxShadow: '-2px 0 8px rgba(155, 142, 196, 0.3)',
      transition: 'background 0.2s, box-shadow 0.2s',
      userSelect: 'none',
      WebkitUserSelect: 'none'
    });
    tab.textContent = '📋';
    tab.title = 'ささっと学年TODO（Shift+ドラッグで移動）';

    // 位置を復元 or 動的配置
    chrome.storage.local.get('tabPosition', (result) => {
      if (result.tabPosition != null) {
        tab.style.top = result.tabPosition + 'px';
      } else {
        tab.style.top = findAvailablePosition() + 'px';
      }
    });

    // --- ホバー ---
    tab.addEventListener('mouseenter', () => {
      if (!isDragging) {
        tab.style.background = COLOR_HOVER;
        tab.style.boxShadow = '-3px 0 12px rgba(155, 142, 196, 0.45)';
      }
    });
    tab.addEventListener('mouseleave', () => {
      if (!isDragging) {
        tab.style.background = COLOR_DEFAULT;
        tab.style.boxShadow = '-2px 0 8px rgba(155, 142, 196, 0.3)';
      }
    });

    // --- クリック（サイドパネルトグル） ---
    tab.addEventListener('click', async (e) => {
      if (wasDragging) {
        wasDragging = false;
        return;
      }

      // 拡張機能コンテキスト検証
      if (!chrome.runtime?.id) {
        alert('拡張機能が更新されました。ページをリロードしてください。');
        return;
      }

      try {
        const { sidePanelOpen } = await chrome.storage.local.get('sidePanelOpen');
        if (sidePanelOpen) {
          await chrome.runtime.sendMessage({ action: 'closeSidePanel' });
        } else {
          await chrome.runtime.sendMessage({ action: 'openSidePanel' });
        }
      } catch (error) {
        console.error('[TODO Content] toggle error:', error);
        if (error.message?.includes('Extension context invalidated')) {
          alert('拡張機能が更新されました。ページをリロードしてください。');
        }
      }
    });

    // --- ドラッグ（Shift+ドラッグ） ---
    let isDragging = false;
    let wasDragging = false;
    let dragStartY = 0;
    let tabStartTop = 0;

    tab.addEventListener('mousedown', (e) => {
      if (e.shiftKey) {
        isDragging = true;
        wasDragging = false;
        dragStartY = e.clientY;
        tabStartTop = parseInt(tab.style.top) || 0;
        tab.style.background = COLOR_DRAG;
        tab.style.cursor = 'grabbing';
        tab.title = 'ドラッグ中...';
        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      wasDragging = true;
      const delta = e.clientY - dragStartY;
      let newTop = tabStartTop + delta;
      // 画面内に制限
      newTop = Math.max(MARGIN, Math.min(window.innerHeight - TAB_HEIGHT - MARGIN, newTop));
      tab.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      tab.style.background = COLOR_DEFAULT;
      tab.style.cursor = 'pointer';
      tab.title = 'ささっと学年TODO（Shift+ドラッグで移動）';
      // 位置を保存
      const currentTop = parseInt(tab.style.top) || 0;
      chrome.storage.local.set({ tabPosition: currentTop });
    });

    // Shift+ダブルクリックで位置リセット
    tab.addEventListener('dblclick', (e) => {
      if (e.shiftKey) {
        const newTop = findAvailablePosition();
        tab.style.top = newTop + 'px';
        chrome.storage.local.set({ tabPosition: newTop });
      }
    });

    document.body.appendChild(tab);
  }

  // DOM準備後に作成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createToggleTab);
  } else {
    createToggleTab();
  }
})();
