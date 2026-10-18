/**
 * Gemini Chat Folders - Cross-Device Firefox Sync Engine
 * Uses browser.storage.sync for multi-device sync with local cache & quota protection.
 */

(function (global) {
  'use strict';

  // Dynamic storage resolver
  function getExtStorage() {
    if (typeof browser !== 'undefined' && browser.storage) return browser.storage;
    if (typeof chrome !== 'undefined' && chrome.storage) return chrome.storage;
    return null;
  }

  // Storage key prefixes
  const PREFIX_META = 'gcf_meta';
  const PREFIX_FOLDER = 'gcf_f_';
  const PREFIX_LOCAL_CACHE = 'gcf_cache_data';

  // Default colors & icons
  const DEFAULT_COLORS = [
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#06b6d4', // Cyan
    '#ef4444', // Red
    '#6366f1', // Indigo
    '#14b8a6', // Teal
    '#84cc16'  // Lime
  ];

  const DEFAULT_ICONS = [
    '📁', '💼', '🎓', '💻', '💡', '🔬', '🚀', '📚', '⭐', '🛠️',
    '🌐', '📝', '🎯', '⚡', '🤖', '💰', '🩺', '🌍', '🔥', '📌'
  ];

  class GeminiFolderStorage {
    constructor() {
      this.meta = {
        version: 1,
        rootIds: [],
        settings: {
          hideFiledFromAll: false,
          autoCollapseOther: false,
          theme: 'auto',
          defaultColor: DEFAULT_COLORS[0],
          defaultIcon: DEFAULT_ICONS[0]
        },
        updatedAt: 0
      };
      this.folders = new Map(); // folderId -> Folder Object
      this.listeners = new Set();
      this.isInitialized = false;
      this.isSyncing = false;
      this.lastSyncTime = Date.now();
      this.initPromise = null;
    }

    /**
     * Initialize storage and subscribe to cross-device sync changes
     */
    async init() {
      if (this.initPromise) return this.initPromise;
      this.initPromise = this._doInit();
      return this.initPromise;
    }

    async _doInit() {
      try {
        // 1. Try to load from local cache first for instant UI response
        await this._loadFromCache();

        // 2. Fetch fresh data from storage.sync
        await this._loadFromSync();

        // 3. Setup real-time listener for remote updates from other Firefox devices
        this._setupStorageListener();

        this.isInitialized = true;
        this.lastSyncTime = Date.now();
        this._notifyListeners('init', this.getState());
        return this.getState();
      } catch (err) {
        console.error('[GeminiFolderSync] Initialization error:', err);
        this.isInitialized = true;
        return this.getState();
      }
    }

    /**
     * Load fast local cache
     */
    async _loadFromCache() {
      const ext = getExtStorage();
      if (!ext || !ext.local) return;
      try {
        const result = await this._promisifyStorageGet(ext.local, PREFIX_LOCAL_CACHE);
        if (result && result[PREFIX_LOCAL_CACHE]) {
          const cache = result[PREFIX_LOCAL_CACHE];
          if (cache.meta) this.meta = cache.meta;
          if (cache.folders && Array.isArray(cache.folders)) {
            this.folders.clear();
            cache.folders.forEach(f => this.folders.set(f.id, f));
          }
        }
      } catch (e) {
        console.warn('[GeminiFolderSync] Could not read local cache:', e);
      }
    }

    /**
     * Load state from browser.storage.sync with non-destructive persistence merge
     */
    async _loadFromSync() {
      const ext = getExtStorage();
      const storageArea = (ext && ext.sync) ? ext.sync : ext?.local;
      if (!storageArea) return;

      try {
        // Get all items in storage
        const allItems = await this._promisifyStorageGet(storageArea, null);
        if (!allItems) return;

        // Load remote folders
        const syncFolders = new Map();
        for (const key of Object.keys(allItems)) {
          if (key.startsWith(PREFIX_FOLDER)) {
            const folder = allItems[key];
            if (folder && folder.id) {
              syncFolders.set(folder.id, folder);
            }
          }
        }

        // NON-DESTRUCTIVE PERSISTENCE MERGE:
        // Rule: Never wipe existing local folders if remote sync is empty or missing them.
        if (syncFolders.size > 0) {
          // Merge remote folders into this.folders
          for (const [syncId, syncFolder] of syncFolders.entries()) {
            if (this.folders.has(syncId)) {
              const localFolder = this.folders.get(syncId);
              // If local folder was updated more recently, keep local folder
              if ((localFolder.updatedAt || 0) > (syncFolder.updatedAt || 0)) {
                const localChatIds = new Set((localFolder.chats || []).map(c => c.id));
                const mergedChats = [...(localFolder.chats || [])];
                for (const remoteChat of (syncFolder.chats || [])) {
                  if (!localChatIds.has(remoteChat.id)) {
                    mergedChats.push(remoteChat);
                  }
                }
                localFolder.chats = mergedChats;
                // Push more recent local version to sync storage
                const item = {};
                item[PREFIX_FOLDER + localFolder.id] = localFolder;
                await this._promisifyStorageSet(storageArea, item);
              } else {
                // Remote folder is newer or equal: use remote folder, preserving any local-only chats
                const syncChatIds = new Set((syncFolder.chats || []).map(c => c.id));
                const mergedChats = [...(syncFolder.chats || [])];
                for (const localChat of (localFolder.chats || [])) {
                  if (!syncChatIds.has(localChat.id)) {
                    mergedChats.push(localChat);
                  }
                }
                syncFolder.chats = mergedChats;
                this.folders.set(syncId, syncFolder);
              }
            } else {
              // Remote folder doesn't exist locally: add it
              this.folders.set(syncId, syncFolder);
            }
          }

          // If local has folders not yet in remote sync, push them to remote sync!
          for (const [localId, localFolder] of this.folders.entries()) {
            if (!syncFolders.has(localId)) {
              const item = {};
              item[PREFIX_FOLDER + localId] = localFolder;
              await this._promisifyStorageSet(storageArea, item);
            }
          }
        } else if (this.folders.size > 0) {
          // Remote sync has NO folders, but local has folders!
          // Push all existing local folders to remote sync so they persist across devices!
          console.log('[GeminiFolderSync] Syncing existing local folders to remote storage...');
          const itemsToSync = {};
          for (const [id, folder] of this.folders.entries()) {
            itemsToSync[PREFIX_FOLDER + id] = folder;
          }
          await this._promisifyStorageSet(storageArea, itemsToSync);
        }

        // Merge meta safely
        if (allItems[PREFIX_META]) {
          const remoteMeta = allItems[PREFIX_META];
          if (!this.meta.updatedAt || (remoteMeta.updatedAt || 0) >= this.meta.updatedAt) {
            this.meta = { ...this.meta, ...remoteMeta };
          }
        }

        this._reconcileRootIds();
        await this._saveMeta();
        await this._updateLocalCache();
      } catch (e) {
        console.warn('[GeminiFolderSync] Failed loading from sync storage:', e);
      }
    }

    /**
     * Listen for remote changes from other Firefox devices
     */
    _setupStorageListener() {
      const ext = getExtStorage();
      if (!ext || !ext.onChanged) return;

      ext.onChanged.addListener(async (changes, areaName) => {
        // We listen to sync changes (or local fallback if sync is not present)
        if (areaName !== 'sync' && areaName !== 'local') return;

        let changed = false;

        // Check meta change
        if (changes[PREFIX_META]) {
          const newMeta = changes[PREFIX_META].newValue;
          if (newMeta) {
            this.meta = { ...this.meta, ...newMeta };
            changed = true;
          }
        }

        // Check folder changes
        for (const [key, change] of Object.entries(changes)) {
          if (key.startsWith(PREFIX_FOLDER)) {
            const folderId = key.substring(PREFIX_FOLDER.length);
            if (change.newValue) {
              // Updated or created folder
              this.folders.set(folderId, change.newValue);
              changed = true;
            } else if (!change.newValue && this.folders.has(folderId)) {
              // Deleted folder
              this.folders.delete(folderId);
              changed = true;
            }
          }
        }

        if (changed) {
          this._reconcileRootIds();
          this.lastSyncTime = Date.now();
          await this._updateLocalCache();
          this._notifyListeners('sync-update', this.getState());
        }
      });
    }

    /**
     * Reconcile rootIds array so all non-child folders are represented
     */
    _reconcileRootIds() {
      const allIds = new Set(this.folders.keys());
      const childIds = new Set();

      for (const folder of this.folders.values()) {
        if (folder.childrenIds && Array.isArray(folder.childrenIds)) {
          folder.childrenIds.forEach(cid => childIds.add(cid));
        }
        if (folder.parentId) {
          childIds.add(folder.id);
        }
      }

      // Filter existing rootIds that are still valid and not children
      let validRoots = (this.meta.rootIds || []).filter(id => allIds.has(id) && !childIds.has(id));

      // Add any missing root folders
      for (const id of allIds) {
        if (!childIds.has(id) && !validRoots.includes(id)) {
          validRoots.push(id);
        }
      }

      this.meta.rootIds = validRoots;
    }

    /**
     * Save folder to sync storage
     */
    async _saveFolder(folder) {
      folder.updatedAt = Date.now();
      this.folders.set(folder.id, folder);

      const ext = getExtStorage();
      const storageArea = (ext && ext.sync) ? ext.sync : ext?.local;
      if (storageArea) {
        const item = {};
        item[PREFIX_FOLDER + folder.id] = folder;
        await this._promisifyStorageSet(storageArea, item);
      }

      await this._saveMeta();
      await this._updateLocalCache();
      this._notifyListeners('folder-changed', { folder, state: this.getState() });
    }

    /**
     * Save metadata to sync storage
     */
    async _saveMeta() {
      this.meta.updatedAt = Date.now();
      const ext = getExtStorage();
      const storageArea = (ext && ext.sync) ? ext.sync : ext?.local;
      if (storageArea) {
        const item = {};
        item[PREFIX_META] = this.meta;
        await this._promisifyStorageSet(storageArea, item);
      }
    }

    /**
     * Update local mirror cache
     */
    async _updateLocalCache() {
      const ext = getExtStorage();
      if (!ext || !ext.local) return;
      try {
        const cacheData = {
          meta: this.meta,
          folders: Array.from(this.folders.values()),
          cachedAt: Date.now()
        };
        const item = {};
        item[PREFIX_LOCAL_CACHE] = cacheData;
        await this._promisifyStorageSet(ext.local, item);
      } catch (e) {
        console.warn('[GeminiFolderSync] Error updating local cache:', e);
      }
    }

    /**
     * Generate unique ID
     */
    _generateId() {
      return 'gcf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    // ==========================================
    // Public Folder CRUD Operations
    // ==========================================

    /**
     * Create a new folder
     */
    async createFolder({ name, parentId = null, color = null, icon = null }) {
      await this.init();

      const id = this._generateId();
      const newFolder = {
        id,
        name: (name || 'New Folder').trim(),
        parentId: parentId || null,
        color: color || DEFAULT_COLORS[this.folders.size % DEFAULT_COLORS.length],
        icon: icon || DEFAULT_ICONS[this.folders.size % DEFAULT_ICONS.length],
        collapsed: false,
        chats: [], // Array of { id, title, url, addedAt }
        childrenIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      if (parentId && this.folders.has(parentId)) {
        const parent = this.folders.get(parentId);
        if (!parent.childrenIds) parent.childrenIds = [];
        if (!parent.childrenIds.includes(id)) {
          parent.childrenIds.push(id);
        }
        await this._saveFolder(parent);
      } else {
        if (!this.meta.rootIds) this.meta.rootIds = [];
        this.meta.rootIds.push(id);
      }

      await this._saveFolder(newFolder);
      return newFolder;
    }

    /**
     * Update folder details (rename, change color/icon, toggle collapse)
     */
    async updateFolder(folderId, updates) {
      await this.init();
      const folder = this.folders.get(folderId);
      if (!folder) throw new Error(`Folder ${folderId} not found`);

      if (updates.name !== undefined) folder.name = updates.name.trim();
      if (updates.color !== undefined) folder.color = updates.color;
      if (updates.icon !== undefined) folder.icon = updates.icon;
      if (updates.collapsed !== undefined) folder.collapsed = !!updates.collapsed;

      await this._saveFolder(folder);
      return folder;
    }

    /**
     * Delete a folder
     */
    async deleteFolder(folderId, keepChats = true) {
      await this.init();
      const folder = this.folders.get(folderId);
      if (!folder) return false;

      // 1. Remove from parent's childrenIds or from meta.rootIds
      if (folder.parentId && this.folders.has(folder.parentId)) {
        const parent = this.folders.get(folder.parentId);
        if (parent.childrenIds) {
          parent.childrenIds = parent.childrenIds.filter(id => id !== folderId);
          await this._saveFolder(parent);
        }
      } else {
        this.meta.rootIds = (this.meta.rootIds || []).filter(id => id !== folderId);
      }

      // 2. Handle subfolders: promote them to parent or root
      if (folder.childrenIds && folder.childrenIds.length > 0) {
        for (const childId of folder.childrenIds) {
          const child = this.folders.get(childId);
          if (child) {
            child.parentId = folder.parentId || null;
            if (!child.parentId) {
              if (!this.meta.rootIds.includes(childId)) {
                this.meta.rootIds.push(childId);
              }
            }
            await this._saveFolder(child);
          }
        }
      }

      // 3. Remove folder from storage
      this.folders.delete(folderId);
      const ext = getExtStorage();
      const storageArea = (ext && ext.sync) ? ext.sync : ext?.local;
      if (storageArea) {
        await this._promisifyStorageRemove(storageArea, PREFIX_FOLDER + folderId);
      }

      await this._saveMeta();
      await this._updateLocalCache();
      this._notifyListeners('folder-deleted', { folderId, state: this.getState() });
      return true;
    }

    // ==========================================
    // Chat Management Operations
    // ==========================================

    /**
     * Add chat to folder (ensures chat is in at most one folder per platform)
     */
    async addChatToFolder(folderId, { id, title = '', url = '', platform = 'gemini' }) {
      await this.init();
      const targetFolder = this.folders.get(folderId);
      if (!targetFolder) throw new Error(`Folder ${folderId} not found`);

      const plat = platform || 'gemini';

      // 1. Clean existing occurrences of this chat on this platform in any other folder
      for (const [fId, f] of this.folders.entries()) {
        if (f.chats && f.chats.some(c => c.id === id && (c.platform || 'gemini') === plat)) {
          f.chats = f.chats.filter(c => !(c.id === id && (c.platform || 'gemini') === plat));
          if (fId !== folderId) {
            await this._saveFolder(f);
          }
        }
      }

      // 2. Add to target folder
      if (!targetFolder.chats) targetFolder.chats = [];
      targetFolder.chats.unshift({
        id,
        title: title || 'Conversation',
        url: url || (plat === 'gemini' ? `/app/${id}` : plat === 'claude' ? `/chat/${id}` : `/c/${id}`),
        platform: plat,
        addedAt: Date.now()
      });

      await this._saveFolder(targetFolder);
      return targetFolder;
    }

    /**
     * Remove chat from folder
     */
    async removeChatFromFolder(folderId, chatId, platform = null) {
      await this.init();
      const folder = this.folders.get(folderId);
      if (!folder || !folder.chats) return false;

      const initialLen = folder.chats.length;
      folder.chats = folder.chats.filter(c => {
        if (platform) {
          return !(c.id === chatId && (c.platform || 'gemini') === platform);
        }
        return c.id !== chatId;
      });
      if (folder.chats.length !== initialLen) {
        await this._saveFolder(folder);
        return true;
      }
      return false;
    }

    /**
     * Find which folder contains a given chat ID
     */
    getChatFolder(chatId, platform = null) {
      for (const folder of this.folders.values()) {
        if (folder.chats && folder.chats.some(c => {
          if (platform) {
            return c.id === chatId && (c.platform || 'gemini') === platform;
          }
          return c.id === chatId;
        })) {
          return folder;
        }
      }
      return null;
    }

    /**
     * Check if a chat ID is filed in any folder
     */
    isChatFiled(chatId, platform = null) {
      return this.getChatFolder(chatId, platform) !== null;
    }

    /**
     * Reorder root folders
     */
    async reorderRootFolders(newRootIds) {
      await this.init();
      this.meta.rootIds = newRootIds;
      await this._saveMeta();
      await this._updateLocalCache();
      this._notifyListeners('reorder', this.getState());
    }

    /**
     * Reorder subfolders within a parent folder
     */
    async reorderSubfolders(parentId, newChildrenIds) {
      await this.init();
      const parent = this.folders.get(parentId);
      if (!parent) return;
      parent.childrenIds = newChildrenIds;
      await this._saveFolder(parent);
    }

    /**
     * Move a folder into another folder as a child, or back to root
     */
    async moveFolder(folderId, targetParentId = null) {
      await this.init();
      if (folderId === targetParentId) return;
      const folder = this.folders.get(folderId);
      if (!folder) return;

      // Prevent moving folder into one of its descendants
      if (targetParentId && this._isDescendant(folderId, targetParentId)) {
        console.warn('Cannot move folder into its own descendant');
        return;
      }

      // Remove from previous parent or rootIds
      if (folder.parentId && this.folders.has(folder.parentId)) {
        const oldParent = this.folders.get(folder.parentId);
        if (oldParent.childrenIds) {
          oldParent.childrenIds = oldParent.childrenIds.filter(id => id !== folderId);
          await this._saveFolder(oldParent);
        }
      } else {
        this.meta.rootIds = (this.meta.rootIds || []).filter(id => id !== folderId);
      }

      // Add to new parent or root
      folder.parentId = targetParentId;
      if (targetParentId && this.folders.has(targetParentId)) {
        const newParent = this.folders.get(targetParentId);
        if (!newParent.childrenIds) newParent.childrenIds = [];
        if (!newParent.childrenIds.includes(folderId)) {
          newParent.childrenIds.push(folderId);
        }
        await this._saveFolder(newParent);
      } else {
        if (!this.meta.rootIds) this.meta.rootIds = [];
        if (!this.meta.rootIds.includes(folderId)) {
          this.meta.rootIds.push(folderId);
        }
      }

      await this._saveFolder(folder);
    }

    _isDescendant(parentCandidateId, targetId) {
      const parentCandidate = this.folders.get(parentCandidateId);
      if (!parentCandidate || !parentCandidate.childrenIds) return false;
      if (parentCandidate.childrenIds.includes(targetId)) return true;
      for (const childId of parentCandidate.childrenIds) {
        if (this._isDescendant(childId, targetId)) return true;
      }
      return false;
    }

    /**
     * Update extension settings
     */
    async updateSettings(newSettings) {
      await this.init();
      this.meta.settings = { ...this.meta.settings, ...newSettings };
      await this._saveMeta();
      await this._updateLocalCache();
      this._notifyListeners('settings-changed', this.getState());
      return this.meta.settings;
    }

    /**
     * Get full state snapshot
     */
    getState() {
      const foldersObj = {};
      for (const [id, folder] of this.folders.entries()) {
        foldersObj[id] = folder;
      }

      let totalChats = 0;
      for (const f of this.folders.values()) {
        totalChats += (f.chats ? f.chats.length : 0);
      }

      const ext = getExtStorage();

      return {
        meta: this.meta,
        folders: foldersObj,
        folderCount: this.folders.size,
        chatCount: totalChats,
        lastSyncTime: this.lastSyncTime,
        isSyncSupported: !!(ext && ext.sync)
      };
    }

    /**
     * Export full data as JSON string for backup/sharing
     */
    exportData() {
      const state = this.getState();
      const exportObject = {
        app: 'GeminiChatFolders',
        exportedAt: new Date().toISOString(),
        version: 1,
        meta: state.meta,
        folders: Object.values(state.folders)
      };
      return JSON.stringify(exportObject, null, 2);
    }

    /**
     * Import full data from JSON string or Object
     */
    async importData(jsonInput, merge = false) {
      await this.init();

      let data = jsonInput;
      if (typeof jsonInput === 'string') {
        // Strip Windows UTF-8 BOM (\uFEFF) and trim whitespace
        const cleanStr = jsonInput.replace(/^\uFEFF/, '').trim();
        data = JSON.parse(cleanStr);
      }

      // Support array of folders directly or standard backup format
      let foldersToImport = [];
      if (Array.isArray(data)) {
        foldersToImport = data;
      } else if (data && Array.isArray(data.folders)) {
        foldersToImport = data.folders;
      } else {
        throw new Error('Invalid backup format: missing folders array');
      }

      const ext = getExtStorage();
      const storageArea = (ext && ext.sync) ? ext.sync : ext?.local;

      // 1. Prepare batch of items to persist
      const batchItems = {};
      const newFoldersMap = new Map();

      if (merge) {
        for (const [id, f] of this.folders.entries()) {
          newFoldersMap.set(id, f);
        }
      }

      // 2. Process all folders into map and batch
      for (const folder of foldersToImport) {
        if (folder && folder.id) {
          const folderObj = {
            id: folder.id,
            name: folder.name || 'Untitled Folder',
            parentId: folder.parentId || null,
            color: folder.color || DEFAULT_COLORS[0],
            icon: folder.icon || DEFAULT_ICONS[0],
            collapsed: folder.collapsed !== false,
            chats: Array.isArray(folder.chats) ? folder.chats : [],
            childrenIds: Array.isArray(folder.childrenIds) ? folder.childrenIds : [],
            createdAt: folder.createdAt || Date.now(),
            updatedAt: Date.now()
          };
          newFoldersMap.set(folderObj.id, folderObj);
          batchItems[PREFIX_FOLDER + folderObj.id] = folderObj;
        }
      }

      // 3. Update in-memory folders
      this.folders = newFoldersMap;

      // 4. Update metadata
      if (data && data.meta && !merge) {
        this.meta = { ...this.meta, ...data.meta, updatedAt: Date.now() };
      } else {
        this.meta.updatedAt = Date.now();
      }
      this._reconcileRootIds();
      batchItems[PREFIX_META] = this.meta;

      // 5. Clean up old keys if not merging
      if (!merge && storageArea) {
        try {
          const allStorage = await this._promisifyStorageGet(storageArea, null);
          const oldFolderKeys = Object.keys(allStorage || {}).filter(k =>
            k.startsWith(PREFIX_FOLDER) && !batchItems[k]
          );
          if (oldFolderKeys.length > 0) {
            await this._promisifyStorageRemove(storageArea, oldFolderKeys);
          }
        } catch (e) {
          console.warn('[GeminiFolderSync] Could not clean old storage keys:', e);
        }
      }

      // 6. Persist batch atomically
      if (storageArea) {
        try {
          await this._promisifyStorageSet(storageArea, batchItems);
        } catch (syncErr) {
          console.warn('[GeminiFolderSync] storage.sync batch save failed, falling back to local:', syncErr);
          if (ext && ext.local && ext.local !== storageArea) {
            await this._promisifyStorageSet(ext.local, batchItems);
          }
        }
      }

      // 7. Ensure local mirror cache is updated
      if (ext && ext.local) {
        try {
          await this._promisifyStorageSet(ext.local, batchItems);
        } catch (localErr) {
          console.warn('[GeminiFolderSync] local storage set failed:', localErr);
        }
      }

      await this._updateLocalCache();
      this.lastSyncTime = Date.now();
      this._notifyListeners('imported', this.getState());
      return this.getState();
    }

    /**
     * Subscribe to storage change events
     */
    subscribe(callback) {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    _notifyListeners(event, data) {
      for (const listener of this.listeners) {
        try {
          listener(event, data);
        } catch (e) {
          console.error('[GeminiFolderSync] Listener notification error:', e);
        }
      }
    }

    // Storage promise helpers (supports both Promise and callback APIs)
    _promisifyStorageGet(area, keys) {
      return new Promise((resolve, reject) => {
        try {
          const ext = getExtStorage();
          const res = area.get(keys, result => {
            const lastErr = (typeof browser !== 'undefined' && browser.runtime?.lastError) || (typeof chrome !== 'undefined' && chrome.runtime?.lastError);
            if (lastErr) return reject(lastErr);
            resolve(result);
          });
          if (res && typeof res.then === 'function') {
            res.then(resolve).catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      });
    }

    _promisifyStorageSet(area, items) {
      return new Promise((resolve, reject) => {
        try {
          const res = area.set(items, () => {
            const lastErr = (typeof browser !== 'undefined' && browser.runtime?.lastError) || (typeof chrome !== 'undefined' && chrome.runtime?.lastError);
            if (lastErr) return reject(lastErr);
            resolve();
          });
          if (res && typeof res.then === 'function') {
            res.then(resolve).catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      });
    }

    _promisifyStorageRemove(area, keys) {
      return new Promise((resolve, reject) => {
        try {
          const res = area.remove(keys, () => {
            const lastErr = (typeof browser !== 'undefined' && browser.runtime?.lastError) || (typeof chrome !== 'undefined' && chrome.runtime?.lastError);
            if (lastErr) return reject(lastErr);
            resolve();
          });
          if (res && typeof res.then === 'function') {
            res.then(resolve).catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      });
    }
  }

  // Create singleton instance
  const storageInstance = new GeminiFolderStorage();

  // Always export to global scope
  global.GeminiFolderStorage = GeminiFolderStorage;
  global.geminiStorage = storageInstance;
  global.DEFAULT_COLORS = DEFAULT_COLORS;
  global.DEFAULT_ICONS = DEFAULT_ICONS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GeminiFolderStorage, DEFAULT_COLORS, DEFAULT_ICONS };
  }


})(typeof window !== 'undefined' ? window : globalThis);
