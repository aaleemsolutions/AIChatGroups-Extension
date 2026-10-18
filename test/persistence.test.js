/**
 * Automated Persistence & Immutability Verification Test Suite
 *
 * Verifies that:
 * 1. Storage is strictly persistent across browser restarts and reloads.
 * 2. Storage ONLY updates when the user explicitly moves or removes conversations.
 * 3. Empty remote sync responses never wipe local data.
 * 4. Navigating, rendering, or querying causes zero storage mutations.
 */

const assert = require('assert');
const { GeminiFolderStorage } = require('../storage-sync.js');

class MockPersistentStorage {
  constructor() {
    this.syncData = {};
    this.localData = {};
    this.writeCount = 0;
  }

  createBrowserMock() {
    const self = this;
    return {
      storage: {
        sync: {
          get: (keys, cb) => {
            let res = keys === null ? { ...self.syncData } : (typeof keys === 'string' ? { [keys]: self.syncData[keys] } : {});
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (items, cb) => {
            self.writeCount++;
            for (const [k, v] of Object.entries(items)) {
              self.syncData[k] = JSON.parse(JSON.stringify(v));
            }
            if (cb) cb();
            return Promise.resolve();
          },
          remove: (keys, cb) => {
            self.writeCount++;
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach(k => delete self.syncData[k]);
            if (cb) cb();
            return Promise.resolve();
          }
        },
        local: {
          get: (keys, cb) => {
            let res = keys === null ? { ...self.localData } : (typeof keys === 'string' ? { [keys]: self.localData[keys] } : {});
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (items, cb) => {
            for (const [k, v] of Object.entries(items)) {
              self.localData[k] = JSON.parse(JSON.stringify(v));
            }
            if (cb) cb();
            return Promise.resolve();
          },
          remove: (keys, cb) => {
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach(k => delete self.localData[k]);
            if (cb) cb();
            return Promise.resolve();
          }
        },
        onChanged: {
          addListener: () => {}
        }
      }
    };
  }
}

async function runPersistenceTests() {
  console.log('🔒 Starting Storage Persistence & Strict Mutation Test Suite...\n');

  const persistentBackend = new MockPersistentStorage();
  global.browser = persistentBackend.createBrowserMock();

  // ========================================================
  // Phase 1: Setup Initial Folders & Chats
  // ========================================================
  console.log('Phase 1: User creates folders and files chats');
  let storageInstance = new GeminiFolderStorage();
  await storageInstance.init();

  const folderAdmissions = await storageInstance.createFolder({
    name: '🎓 European Admissions',
    color: '#3b82f6',
    icon: '🎓'
  });

  const folderSolar = await storageInstance.createFolder({
    name: '☀️ Solar Projects',
    color: '#f59e0b',
    icon: '☀️'
  });

  // Explicit user action: Move conversations into folders
  await storageInstance.addChatToFolder(folderAdmissions.id, {
    id: '8dd07bc5f2e48b89',
    title: 'Apply - GERMANY',
    url: '/app/8dd07bc5f2e48b89'
  });
  await storageInstance.addChatToFolder(folderAdmissions.id, {
    id: '5b5917c4fdcda23d',
    title: 'EU Master\'s Admissions Strategy',
    url: '/app/5b5917c4fdcda23d'
  });
  await storageInstance.addChatToFolder(folderSolar.id, {
    id: 'b6e44fa6fc9e1d94',
    title: 'DIY Solar Inverter Wi-Fi Dongle Project',
    url: '/app/b6e44fa6fc9e1d94'
  });

  assert.strictEqual(storageInstance.getState().chatCount, 3, 'Should have 3 organized chats');
  console.log('  ✓ Initial state created with 2 folders and 3 organized chats\n');

  // ========================================================
  // Phase 2: Persistence Across Simulated Browser Restarts
  // ========================================================
  console.log('Phase 2: Simulate complete browser restart (5 consecutive reloads)');
  for (let cycle = 1; cycle <= 5; cycle++) {
    // Reset memory instance completely
    storageInstance = new GeminiFolderStorage();
    await storageInstance.init();

    const state = storageInstance.getState();
    assert.strictEqual(state.folderCount, 2, `Cycle ${cycle}: Folder count must remain 2`);
    assert.strictEqual(state.chatCount, 3, `Cycle ${cycle}: Chat count must remain 3`);

    const adm = storageInstance.folders.get(folderAdmissions.id);
    assert.ok(adm, `Cycle ${cycle}: Admissions folder must persist`);
    assert.strictEqual(adm.chats.length, 2, `Cycle ${cycle}: Admissions folder must have 2 chats`);
    assert.strictEqual(adm.chats[0].id, '5b5917c4fdcda23d');
    assert.strictEqual(adm.chats[1].id, '8dd07bc5f2e48b89');

    const sol = storageInstance.folders.get(folderSolar.id);
    assert.ok(sol, `Cycle ${cycle}: Solar folder must persist`);
    assert.strictEqual(sol.chats.length, 1, `Cycle ${cycle}: Solar folder must have 1 chat`);
  }
  console.log('  ✓ All folders and chats remained 100% persistent across 5 restarts\n');

  // ========================================================
  // Phase 3: Zero Mutation Guarantee on Reads & Page Navigation
  // ========================================================
  console.log('Phase 3: Verify Zero Storage Mutations during reads, search, & navigation');
  const initialWrites = persistentBackend.writeCount;

  // Simulate heavy navigation & read operations
  for (let i = 0; i < 50; i++) {
    storageInstance.getState();
    storageInstance.getChatFolder('8dd07bc5f2e48b89');
    storageInstance.isChatFiled('b6e44fa6fc9e1d94');
    storageInstance.isChatFiled('unknown_chat_id');
  }

  assert.strictEqual(
    persistentBackend.writeCount,
    initialWrites,
    'Storage writes must be ZERO when user is browsing, reading, or navigating'
  );
  console.log('  ✓ Zero unnecessary writes: Storage remains pristine unless mutated by user\n');

  // ========================================================
  // Phase 4: Explicit Move / Add Conversation
  // ========================================================
  console.log('Phase 4: Explicit user move conversation into new folder');
  const writesBeforeMove = persistentBackend.writeCount;

  // User moves "Apply - GERMANY" from Admissions to Solar
  await storageInstance.addChatToFolder(folderSolar.id, {
    id: '8dd07bc5f2e48b89',
    title: 'Apply - GERMANY',
    url: '/app/8dd07bc5f2e48b89'
  });

  assert.ok(persistentBackend.writeCount > writesBeforeMove, 'Write must occur on user move');
  assert.strictEqual(storageInstance.folders.get(folderAdmissions.id).chats.length, 1, 'Removed from old folder');
  assert.strictEqual(storageInstance.folders.get(folderSolar.id).chats.length, 2, 'Added to new folder');
  assert.strictEqual(storageInstance.getChatFolder('8dd07bc5f2e48b89').id, folderSolar.id);
  console.log('  ✓ Conversation cleanly moved with updated persistence\n');

  // ========================================================
  // Phase 5: Explicit Remove Conversation
  // ========================================================
  console.log('Phase 5: Explicit user remove conversation from folder');
  const writesBeforeRemove = persistentBackend.writeCount;

  const removed = await storageInstance.removeChatFromFolder(folderSolar.id, '8dd07bc5f2e48b89');
  assert.strictEqual(removed, true);
  assert.ok(persistentBackend.writeCount > writesBeforeRemove, 'Write must occur on user remove');
  assert.strictEqual(storageInstance.folders.get(folderSolar.id).chats.length, 1);
  assert.strictEqual(storageInstance.isChatFiled('8dd07bc5f2e48b89'), false);
  console.log('  ✓ Conversation explicitly removed; remaining chats preserved\n');

  // ========================================================
  // Phase 6: Empty Remote Sync Non-Destructive Protection
  // ========================================================
  console.log('Phase 6: Remote sync returns empty object (protection against remote wipes)');
  
  // Save current local state, then simulate sync backend being temporarily empty
  const localBackup = JSON.parse(JSON.stringify(persistentBackend.localData));
  persistentBackend.syncData = {}; // Remote sync is empty!

  // Re-initialize storage: It must NOT wipe local data!
  const resilientStorage = new GeminiFolderStorage();
  await resilientStorage.init();

  const finalState = resilientStorage.getState();
  assert.strictEqual(finalState.folderCount, 2, 'Must not wipe local folders when remote is empty');
  assert.strictEqual(finalState.chatCount, 2, 'Must not wipe local chats when remote is empty');
  
  // Verify it restored the data to sync backend as well
  assert.ok(persistentBackend.syncData['gcf_f_' + folderAdmissions.id], 'Local folders pushed to empty sync backend');
  console.log('  ✓ Protection confirmed: Empty sync storage will NEVER wipe local folders or chats\n');

  console.log('🎉 ALL PERSISTENCE & IMMUTABILITY TESTS PASSED 100%!');
}

runPersistenceTests().catch(err => {
  console.error('❌ Persistence test failed:', err);
  process.exit(1);
});
