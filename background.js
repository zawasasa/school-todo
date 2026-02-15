/* ========================================
   ささっと学年TODOアプリ - Background Service Worker
   ======================================== */

// アクションクリックでサイドパネルを開く
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[TODO BG] setPanelBehavior error:', error));

// メッセージルーティング
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidePanel') {
    (async () => {
      try {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        sendResponse({ success: true });
      } catch (error) {
        console.error('[TODO BG] openSidePanel error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'closeSidePanel') {
    (async () => {
      try {
        // タイムスタンプで確実にstorage.onChangedを発火させる
        await chrome.storage.local.set({
          sidePanelOpen: false,
          shouldCloseSidePanel: Date.now()
        });
        sendResponse({ success: true });
      } catch (error) {
        console.error('[TODO BG] closeSidePanel error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});
