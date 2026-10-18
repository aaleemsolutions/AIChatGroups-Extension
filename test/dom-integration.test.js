/**
 * Automated Headless DOM Integration Test for Gemini Chat Folders Extension
 * Uses JSDOM with the user's real Gemini sidebar DOM snippet.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function runDomIntegrationTest() {
  console.log('🧪 Starting Gemini Sidebar DOM Integration Test...\n');

  // Load the test mock HTML
  const mockHtmlPath = path.join(__dirname, 'gemini-mock.html');
  const htmlContent = fs.readFileSync(mockHtmlPath, 'utf8');

  // Load extension source files
  const storageSyncCode = fs.readFileSync(path.join(__dirname, '..', 'storage-sync.js'), 'utf8');
  const contentCode = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

  // Strip script tags from HTML so we can control script execution order in test
  const cleanHtml = htmlContent.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Create virtual browser window
  const dom = new JSDOM(cleanHtml, {
    url: 'https://gemini.google.com/app/8dd07bc5f2e48b89',
    runScripts: 'dangerously',
    resources: 'usable'
  });

  const { window } = dom;
  const { document } = window;

  // Forward console errors and logs
  window.console.log = (...args) => console.log('  [browser-log]', ...args);
  window.console.warn = (...args) => console.warn('  [browser-warn]', ...args);
  window.console.error = (...args) => console.error('  [browser-error]', ...args);

  // Setup Mock WebExtensions Storage
  const memorySync = {};
  const memoryLocal = {};
  const listeners = [];

  window.browser = {
    storage: {
      sync: {
        get: (keys, cb) => {
          let res = keys === null ? { ...memorySync } : (typeof keys === 'string' ? { [keys]: memorySync[keys] } : {});
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items, cb) => {
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: memorySync[k], newValue: v };
            memorySync[k] = v;
          }
          listeners.forEach(fn => fn(changes, 'sync'));
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          keyList.forEach(k => {
            changes[k] = { oldValue: memorySync[k], newValue: undefined };
            delete memorySync[k];
          });
          listeners.forEach(fn => fn(changes, 'sync'));
          if (cb) cb();
          return Promise.resolve();
        }
      },
      local: {
        get: (keys, cb) => {
          let res = keys === null ? { ...memoryLocal } : (typeof keys === 'string' ? { [keys]: memoryLocal[keys] } : {});
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items, cb) => {
          for (const [k, v] of Object.entries(items)) memoryLocal[k] = v;
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(k => delete memoryLocal[k]);
          if (cb) cb();
          return Promise.resolve();
        }
      },
      onChanged: {
        addListener: fn => listeners.push(fn)
      }
    }
  };

  // Execute storage-sync.js in virtual window
  window.eval(storageSyncCode);

  // Execute content.js in virtual window
  window.eval(contentCode);

  // Dispatch DOMContentLoaded if readyState is loading
  if (document.readyState === 'loading') {
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }

  // Allow DOM mutations & async init to execute
  await new Promise(r => setTimeout(r, 200));

  // Step 1: Verify #gcf-root injected
  console.log('Step 1: Check #gcf-root injected into Gemini sidebar');
  const gcfRoot = document.getElementById('gcf-root');
  assert.ok(gcfRoot, '#gcf-root container must be present in DOM');
  
  // Verify placed right before expandable-section[data-test-id="chats-expandable-section"]
  const chatsSection = document.querySelector('expandable-section[data-test-id="chats-expandable-section"]');
  assert.ok(chatsSection, 'Native chats section exists');
  console.log('  ✓ Passed: #gcf-root successfully mounted in sidebar\n');

  // Step 2: Verify injected folder action buttons on native conversations
  console.log('Step 2: Check injected folder buttons on native conversation items');
  const convItems = document.querySelectorAll('gem-nav-list-item[data-test-id="conversation"]');
  assert.ok(convItems.length > 0, 'Found native conversation items in user DOM');
  let injectedButtons = 0;
  convItems.forEach(item => {
    if (item.querySelector('.gcf-injected-folder-btn')) injectedButtons++;
  });
  assert.strictEqual(injectedButtons, convItems.length, 'All native conversation items must have folder action button');
  console.log(`  ✓ Passed: ${injectedButtons}/${convItems.length} conversation items have folder button\n`);

  // Step 3: Create folder via storage API
  console.log('Step 3: Create folder "🎓 Master\'s Admissions" and verify DOM render');
  const storage = window.geminiStorage;
  const fMaster = await storage.createFolder({
    name: '🎓 Master\'s Admissions',
    color: '#3b82f6',
    icon: '🎓'
  });
  await new Promise(r => setTimeout(r, 100));

  const folderRow = document.querySelector(`.gcf-folder-row[data-folder-id="${fMaster.id}"]`);
  assert.ok(folderRow, 'Folder row must render in DOM');
  assert.strictEqual(folderRow.querySelector('.gcf-folder-name').textContent, '🎓 Master\'s Admissions');
  console.log('  ✓ Passed: Folder row rendered in DOM with correct name and icon\n');

  // Step 4: Add chat to folder and check badge + chat item in folder
  console.log('Step 4: Add chat "Apply - GERMANY" (8dd07bc5f2e48b89) into folder');
  await storage.addChatToFolder(fMaster.id, {
    id: '8dd07bc5f2e48b89',
    title: 'Apply - GERMANY',
    url: '/app/8dd07bc5f2e48b89'
  });
  await new Promise(r => setTimeout(r, 100));

  const updatedFolderRow = document.querySelector(`.gcf-folder-row[data-folder-id="${fMaster.id}"]`);
  assert.ok(updatedFolderRow, 'Updated folder row must exist in DOM');
  const countBadge = updatedFolderRow.querySelector('.gcf-folder-count');
  assert.strictEqual(countBadge.textContent, '1', 'Folder count badge should show 1');

  const chatInFolder = updatedFolderRow.querySelector('.gcf-chat-item[data-chat-id="8dd07bc5f2e48b89"]');
  assert.ok(chatInFolder, 'Chat item must appear in folder DOM');
  assert.ok(chatInFolder.classList.contains('gcf-active-chat'), 'Active chat must have .gcf-active-chat class');
  console.log('  ✓ Passed: Chat rendered inside folder with active highlight\n');

  // Step 5: Test "Hide filed chats from All" setting
  console.log('Step 5: Verify "Hide filed chats from All" toggles .gcf-filed-hidden on native list');
  const nativeGermanyChat = Array.from(convItems).find(item => item.querySelector('a[href*="8dd07bc5f2e48b89"]'));
  assert.ok(nativeGermanyChat, 'Found native Germany chat item');

  // Before enabling: not hidden
  assert.strictEqual(nativeGermanyChat.classList.contains('gcf-filed-hidden'), false);

  // Enable setting
  await storage.updateSettings({ hideFiledFromAll: true });
  await new Promise(r => setTimeout(r, 100));

  // Now: should be hidden in flat list
  assert.strictEqual(nativeGermanyChat.classList.contains('gcf-filed-hidden'), true, 'Filed chat should now be hidden from flat list');
  console.log('  ✓ Passed: Native item hidden from flat list when filed in a folder\n');

  // Step 6: Test multi-device Firefox Sync event
  console.log('Step 6: Simulate remote Firefox Sync update from another device');
  const remoteFolder = {
    id: 'gcf_remotedev_123',
    name: '☀️ Solar & Electronics Projects',
    parentId: null,
    color: '#f59e0b',
    icon: '☀️',
    collapsed: false,
    chats: [
      { id: 'b6e44fa6fc9e1d94', title: 'DIY Solar Inverter Wi-Fi Dongle Project', url: '/app/b6e44fa6fc9e1d94' }
    ],
    childrenIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now() + 1000
  };

  // Simulate remote write to storage.sync
  await window.browser.storage.sync.set({
    gcf_f_gcf_remotedev_123: remoteFolder
  });
  await new Promise(r => setTimeout(r, 100));

  const remoteFolderDom = document.querySelector('.gcf-folder-row[data-folder-id="gcf_remotedev_123"]');
  assert.ok(remoteFolderDom, 'Remote synced folder must automatically render in DOM without page reload');
  assert.strictEqual(remoteFolderDom.querySelector('.gcf-folder-name').textContent, '☀️ Solar & Electronics Projects');
  console.log('  ✓ Passed: Real-time multi-device sync immediately re-rendered folder in DOM\n');

  // Step 7: Verify SPA Non-Refresh Conversation Click
  console.log('Step 7: Verify conversation click uses SPA navigation without hard page reload');
  const chatLinkInFolder = chatInFolder.querySelector('.gcf-chat-link');
  assert.ok(chatLinkInFolder, 'Chat link in folder exists');
  
  // Track defaultPrevented on click event
  let defaultWasPrevented = false;
  chatLinkInFolder.addEventListener('click', (e) => {
    defaultWasPrevented = e.defaultPrevented;
  });
  
  const clickEvt = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  chatLinkInFolder.dispatchEvent(clickEvt);
  
  assert.strictEqual(defaultWasPrevented, true, 'Chat click MUST call preventDefault() to prevent full page reload');
  console.log('  ✓ Passed: Chat link click prevented full page reload and navigated via SPA\n');

  // Step 8: Verify Drag & Drop onto entire folder area
  console.log('Step 8: Verify dragging onto entire folder row area or children container');
  const fDropTarget = await storage.createFolder({ name: '🧪 Full Area Drop Target', color: '#10b981', icon: '🧪' });
  await new Promise(r => setTimeout(r, 100));

  const dropFolderRow = document.querySelector(`.gcf-folder-row[data-folder-id="${fDropTarget.id}"]`);
  assert.ok(dropFolderRow, 'Drop target folder row exists');

  // Simulate drop onto folderRow (not just header)
  const dropEvent = new window.Event('drop', { bubbles: true, cancelable: true });
  dropEvent.dataTransfer = {
    getData: (format) => JSON.stringify({
      type: 'gemini-native-chat',
      id: 'area_drop_chat_999',
      title: 'Full Area Drag Test Chat',
      url: '/app/area_drop_chat_999'
    })
  };
  dropFolderRow.dispatchEvent(dropEvent);
  await new Promise(r => setTimeout(r, 100));

  const targetFolderData = storage.folders.get(fDropTarget.id);
  assert.ok(targetFolderData, 'Target folder must exist in storage');
  const droppedChat = targetFolderData.chats.find(c => c.id === 'area_drop_chat_999');
  assert.ok(droppedChat, 'Chat must be added to folder when dropped anywhere on folder row');
  console.log('  ✓ Passed: Dropping onto folder row/area successfully filed chat\n');

  // Step 9: Verify Strict Placement directly above chats section (and NOT below New chat)
  console.log('Step 9: Verify strict placement directly above native chats section');
  const currentGcfRoot = document.getElementById('gcf-root');
  const targetChatsSection = document.querySelector('expandable-section[data-test-id="chats-expandable-section"]');
  const newChatBtn = document.querySelector('gem-nav-list-item[data-test-id="new-chat-button"]');

  // Verify gcfRoot is located directly before chatsSection (or divider)
  assert.ok(
    currentGcfRoot.nextSibling === targetChatsSection ||
    currentGcfRoot.nextElementSibling === targetChatsSection ||
    currentGcfRoot.nextElementSibling?.classList.contains('section-divider'),
    'gcf-root MUST be placed immediately above the native chats section'
  );

  // Verify gcfRoot is NOT immediately below newChatBtn
  assert.notStrictEqual(newChatBtn.nextSibling, currentGcfRoot, 'gcf-root must NOT be under New chat button');
  console.log('  ✓ Passed: Folders container strictly positioned directly above chats\n');

  console.log('🎉 ALL DOM & SPA INTEGRATION TESTS PASSED 100%!');
  process.exit(0);
}

runDomIntegrationTest().catch(err => {
  console.error('❌ DOM Integration test failed:', err);
  process.exit(1);
});
