/**
 * Automated Unit Test Suite for GeminiFolderStorage & Sync Engine
 */

const assert = require('assert');
const { GeminiFolderStorage } = require('../storage-sync.js');

// Mock WebExtensions storage.sync & storage.local
class MockStorageArea {
  constructor(areaName, memoryStore) {
    this.areaName = areaName;
    this.memoryStore = memoryStore;
  }

  get(keys, callback) {
    let result = {};
    if (keys === null || keys === undefined) {
      result = { ...this.memoryStore };
    } else if (typeof keys === 'string') {
      if (this.memoryStore[keys] !== undefined) {
        result[keys] = JSON.parse(JSON.stringify(this.memoryStore[keys]));
      }
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (this.memoryStore[k] !== undefined) {
          result[k] = JSON.parse(JSON.stringify(this.memoryStore[k]));
        }
      }
    }
    if (callback) callback(result);
    return Promise.resolve(result);
  }

  set(items, callback) {
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      const oldVal = this.memoryStore[k];
      this.memoryStore[k] = JSON.parse(JSON.stringify(v));
      changes[k] = { oldValue: oldVal, newValue: this.memoryStore[k] };
    }
    if (global.mockStorageChangeListeners) {
      for (const listener of global.mockStorageChangeListeners) {
        listener(changes, this.areaName);
      }
    }
    if (callback) callback();
    return Promise.resolve();
  }

  remove(keys, callback) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    for (const k of keyList) {
      const oldVal = this.memoryStore[k];
      delete this.memoryStore[k];
      changes[k] = { oldValue: oldVal, newValue: undefined };
    }
    if (global.mockStorageChangeListeners) {
      for (const listener of global.mockStorageChangeListeners) {
        listener(changes, this.areaName);
      }
    }
    if (callback) callback();
    return Promise.resolve();
  }
}

function setupMockBrowser() {
  const syncStore = {};
  const localStore = {};
  global.mockStorageChangeListeners = [];

  global.browser = {
    storage: {
      sync: new MockStorageArea('sync', syncStore),
      local: new MockStorageArea('local', localStore),
      onChanged: {
        addListener: (fn) => global.mockStorageChangeListeners.push(fn),
        removeListener: (fn) => {
          global.mockStorageChangeListeners = global.mockStorageChangeListeners.filter(l => l !== fn);
        }
      }
    }
  };

  return { syncStore, localStore };
}

async function runTests() {
  console.log('🧪 Starting Gemini Chat Folders Unit Tests...\n');
  const { syncStore, localStore } = setupMockBrowser();

  const storage = new GeminiFolderStorage();
  await storage.init();

  // Test 1: Empty initialization
  console.log('Test 1: Initializes with clean state');
  const initState = storage.getState();
  assert.strictEqual(initState.folderCount, 0, 'Initial folder count should be 0');
  assert.strictEqual(initState.chatCount, 0, 'Initial chat count should be 0');
  assert.strictEqual(initState.isSyncSupported, true, 'Sync should be supported');
  console.log('  ✓ Passed\n');

  // Test 2: Create root folders
  console.log('Test 2: Create root folders');
  const fEurope = await storage.createFolder({
    name: '🎓 Europe Master\'s Admissions',
    color: '#3b82f6',
    icon: '🎓'
  });
  assert.ok(fEurope.id, 'Folder should have an ID');
  assert.strictEqual(fEurope.name, '🎓 Europe Master\'s Admissions');
  assert.strictEqual(storage.getState().folderCount, 1);
  assert.ok(syncStore['gcf_f_' + fEurope.id], 'Folder should be stored in sync storage');
  console.log('  ✓ Passed: Created root folder ' + fEurope.id + '\n');

  // Test 3: Create nested subfolders
  console.log('Test 3: Create nested subfolders');
  const fGermany = await storage.createFolder({
    name: '🇩🇪 Germany Admissions',
    parentId: fEurope.id,
    color: '#10b981',
    icon: '🇩🇪'
  });
  const fItaly = await storage.createFolder({
    name: '🇮🇹 Italy Admissions',
    parentId: fEurope.id,
    color: '#f59e0b',
    icon: '🇮🇹'
  });

  const updatedEurope = storage.folders.get(fEurope.id);
  assert.strictEqual(updatedEurope.childrenIds.length, 2, 'Parent should have 2 children IDs');
  assert.ok(updatedEurope.childrenIds.includes(fGermany.id));
  assert.ok(updatedEurope.childrenIds.includes(fItaly.id));
  console.log('  ✓ Passed: Subfolders successfully nested under parent\n');

  // Test 4: Add and organize chats
  console.log('Test 4: Add chats to folders');
  await storage.addChatToFolder(fGermany.id, {
    id: '8dd07bc5f2e48b89',
    title: 'Apply - GERMANY',
    url: '/app/8dd07bc5f2e48b89'
  });
  await storage.addChatToFolder(fGermany.id, {
    id: '5b5917c4fdcda23d',
    title: 'EU Master\'s Admissions Strategy for Software Engineers',
    url: '/app/5b5917c4fdcda23d'
  });
  await storage.addChatToFolder(fItaly.id, {
    id: '13f2a58496a0108d',
    title: 'EU - italy',
    url: '/app/13f2a58496a0108d'
  });

  assert.strictEqual(storage.getState().chatCount, 3, 'Total organized chats should be 3');
  assert.strictEqual(storage.folders.get(fGermany.id).chats.length, 2);
  assert.strictEqual(storage.folders.get(fItaly.id).chats.length, 1);
  console.log('  ✓ Passed: Chats added and tracked\n');

  // Test 5: Moving a chat from one folder to another (ensuring uniqueness)
  console.log('Test 5: Move chat to another folder');
  await storage.addChatToFolder(fItaly.id, {
    id: '8dd07bc5f2e48b89',
    title: 'Apply - GERMANY',
    url: '/app/8dd07bc5f2e48b89'
  });
  assert.strictEqual(storage.folders.get(fGermany.id).chats.length, 1, 'German folder should now have 1 chat');
  assert.strictEqual(storage.folders.get(fItaly.id).chats.length, 2, 'Italy folder should now have 2 chats');
  assert.strictEqual(storage.getChatFolder('8dd07bc5f2e48b89').id, fItaly.id);
  console.log('  ✓ Passed: Chat moved cleanly without duplication\n');

  // Test 6: Removing a chat
  console.log('Test 6: Remove chat from folder');
  const removed = await storage.removeChatFromFolder(fItaly.id, '8dd07bc5f2e48b89');
  assert.strictEqual(removed, true, 'Removal should succeed');
  assert.strictEqual(storage.isChatFiled('8dd07bc5f2e48b89'), false, 'Chat should now be unfiled');
  console.log('  ✓ Passed: Chat unfiled\n');

  // Test 7: Export & Import JSON Backup
  console.log('Test 7: Export and Import backup data');
  const exportedJson = storage.exportData();
  const parsed = JSON.parse(exportedJson);
  assert.strictEqual(parsed.app, 'GeminiChatFolders');
  assert.strictEqual(parsed.folders.length, 3);

  // Create a second storage instance and import
  const storage2 = new GeminiFolderStorage();
  await storage2.importData(exportedJson);
  assert.strictEqual(storage2.getState().folderCount, 3);
  assert.strictEqual(storage2.getState().chatCount, 2);
  console.log('  ✓ Passed: Export and import verified\n');

  // Test 8: Cross-Device Remote Sync Event Simulation
  console.log('Test 8: Simulate remote Firefox Sync update from another device');
  let syncEventFired = false;
  storage.subscribe((evt, data) => {
    if (evt === 'sync-update') syncEventFired = true;
  });

  // Another device creates a new folder in storage.sync
  const remoteFolder = {
    id: 'gcf_device2_folder',
    name: '☀️ Solar & Electronics Projects',
    parentId: null,
    color: '#ef4444',
    icon: '☀️',
    collapsed: false,
    chats: [
      { id: 'b6e44fa6fc9e1d94', title: 'DIY Solar Inverter Wi-Fi Dongle Project', url: '/app/b6e44fa6fc9e1d94' },
      { id: '791d7a9386afac5e', title: 'Troubleshooting Ziewnic Inverter PV Current', url: '/app/791d7a9386afac5e' }
    ],
    childrenIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now() + 5000
  };

  // Simulate remote write to sync area
  await global.browser.storage.sync.set({
    gcf_f_gcf_device2_folder: remoteFolder
  });

  // Allow async listener to complete microtasks
  await new Promise(r => setTimeout(r, 20));

  assert.strictEqual(syncEventFired, true, 'storage.onChanged should notify storage instance');
  assert.ok(storage.folders.has('gcf_device2_folder'), 'Remote folder should appear in local instance');
  assert.strictEqual(storage.getState().chatCount, 4, 'Total chats should now include remote chats');
  console.log('  ✓ Passed: Real-time multi-device sync successfully propagated\n');

  // Test 9: Quota & Item safety
  console.log('Test 9: Verify 8KB item boundary protection');
  for (const [k, v] of Object.entries(syncStore)) {
    const size = Buffer.byteLength(JSON.stringify(v), 'utf8');
    assert.ok(size < 8192, `Item ${k} size (${size} bytes) must be well below 8KB WebExtensions quota`);
  }
  console.log('  ✓ Passed: All synced items comply with Firefox WebExtensions 8KB quota\n');

  console.log('🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
