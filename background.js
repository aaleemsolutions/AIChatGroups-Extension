/**
 * Gemini Chat Folders - Firefox Extension Background Event Script
 */

const ext = typeof browser !== 'undefined' ? browser : chrome;

ext.runtime.onInstalled.addListener(async (details) => {
  console.log('[GeminiChatFolders] Extension installed/updated:', details.reason);
  
  if (details.reason === 'install') {
    // Only initialize default welcome structure if BOTH sync and local storage are 100% empty
    try {
      const syncArea = (ext.storage && ext.storage.sync) ? ext.storage.sync : null;
      const localArea = (ext.storage && ext.storage.local) ? ext.storage.local : null;

      const [syncItems, localItems] = await Promise.all([
        syncArea ? new Promise(r => syncArea.get(null, r)) : Promise.resolve({}),
        localArea ? new Promise(r => localArea.get(null, r)) : Promise.resolve({})
      ]);

      const hasExistingData = Object.keys(syncItems || {}).some(k => k.startsWith('gcf_')) ||
                              Object.keys(localItems || {}).some(k => k.startsWith('gcf_'));

      if (!hasExistingData) {
        const timestamp = Date.now();
        const starterFolder1 = {
          id: 'gcf_welcome_1',
          name: '🎓 Admissions & University',
          parentId: null,
          color: '#3b82f6',
          icon: '🎓',
          collapsed: false,
          chats: [],
          childrenIds: [],
          createdAt: timestamp,
          updatedAt: timestamp
        };
        const starterFolder2 = {
          id: 'gcf_welcome_2',
          name: '💻 Engineering & Tech',
          parentId: null,
          color: '#10b981',
          icon: '💻',
          collapsed: false,
          chats: [],
          childrenIds: [],
          createdAt: timestamp,
          updatedAt: timestamp
        };

        const initialData = {
          gcf_meta: {
            version: 1,
            rootIds: ['gcf_welcome_1', 'gcf_welcome_2'],
            settings: {
              hideFiledFromAll: false,
              autoCollapseOther: false,
              theme: 'auto',
              defaultColor: '#3b82f6',
              defaultIcon: '📁'
            },
            updatedAt: timestamp
          },
          gcf_f_gcf_welcome_1: starterFolder1,
          gcf_f_gcf_welcome_2: starterFolder2
        };

        await new Promise(r => storageArea.set(initialData, r));
        console.log('[GeminiChatFolders] Default starter folders created.');
      }
    } catch (e) {
      console.warn('[GeminiChatFolders] Error initializing defaults:', e);
    }
  }
});

// Message listener for popup or content script communications
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ status: 'OK', timestamp: Date.now() });
    return true;
  }
  if (message.action === 'GET_SYNC_INFO') {
    const isSync = !!(ext.storage && ext.storage.sync);
    sendResponse({ isSyncAvailable: isSync });
    return true;
  }
});
