/**
 * Gemini Chat Folders - Content Script
 * Injected into gemini.google.com to provide hierarchical folders, groups,
 * drag-and-drop, and real-time Firefox cross-device sync.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__GCF_INITIALIZED__) return;
  window.__GCF_INITIALIZED__ = true;

  console.log('[GeminiChatFolders] Content script loaded on Gemini');

  // Reference storage engine from storage-sync.js
  const storage = window.geminiStorage || new window.GeminiFolderStorage();

  // State
  let searchQuery = '';
  let isSectionCollapsed = false;
  let activeDropdown = null;

  // ========================================================
  // Initialization & Injection Engine
  // ========================================================

  async function init() {
    try {
      await storage.init();
      setupStorageListener();
      setupMessageListener();
      setupUrlChangeListener();
      startDomObserver();
      ensureCorrectPlacement();
      scanAndEnhanceNativeChats();
      applyLayoutMode();
    } catch (err) {
      console.error('[GeminiChatFolders] Init error:', err);
    }
  }

  function setupStorageListener() {
    storage.subscribe((event, data) => {
      console.log(`[GeminiChatFolders] Storage event: ${event}`);
      renderFolderTree();
      scanAndEnhanceNativeChats();
      applyLayoutMode();
      updateSyncStatusIndicator();
    });
  }

  function setupMessageListener() {
    const ext = typeof browser !== 'undefined' ? browser : chrome;
    if (ext && ext.runtime && ext.runtime.onMessage) {
      ext.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === 'gcf_refresh') {
          console.log('[GeminiChatFolders] Extension refresh signal received');
          renderFolderTree();
          scanAndEnhanceNativeChats();
          updateSyncStatusIndicator();
        }
      });
    }
  }

  function setupUrlChangeListener() {
    // Detect URL changes in Gemini SPA
    let currentUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        highlightActiveChat();
      }
    });
    urlObserver.observe(document.querySelector('head') || document.documentElement, {
      subtree: true,
      childList: true
    });
    window.addEventListener('popstate', highlightActiveChat);
  }

  function startDomObserver() {
    // Observe DOM changes in Gemini sidebar to keep folders locked strictly above native chats
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        ensureCorrectPlacement();
        scanAndEnhanceNativeChats();
      }, 100);
    });

    const target = document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
  }

  // ========================================================
  // DOM Finding & Strict Injection directly ABOVE Chats
  // ========================================================

  /**
   * Reliably locates Gemini's native conversation section in the sidebar.
   * Matches the user's live DOM structure and survives Angular re-renders.
   */
  function findChatsSection() {
    // 1. Direct storagekey or test-id attribute: <expandable-section storagekey="chats">
    const chatsSection = document.querySelector('expandable-section[storagekey="chats"]') ||
                          document.querySelector('expandable-section[data-test-id="chats-expandable-section"]');
    if (chatsSection) return chatsSection;

    // 2. Section containing conversations-list container
    const convList = document.querySelector('conversations-list[data-test-id="all-conversations"]') ||
                     document.querySelector('conversations-list');
    if (convList) {
      return convList.closest('expandable-section') || convList;
    }

    // 3. Section containing native conversation items
    const anyChat = document.querySelector('gem-nav-list-item[data-test-id="conversation"]');
    if (anyChat) {
      return anyChat.closest('expandable-section') || anyChat.closest('.chat-history') || anyChat.closest('conversations-list');
    }

    // 4. Any expandable section with title matching "Recent", "Chats", or "All"
    const sections = document.querySelectorAll('expandable-section');
    for (const sec of sections) {
      const titleElem = sec.querySelector('.expandable-section-title, .expandable-section-header');
      if (titleElem && /recent|chat|all/i.test(titleElem.textContent || '')) {
        return sec;
      }
    }

    return null;
  }

  function findInsertionTarget() {
    const chatsSection = findChatsSection();
    if (chatsSection && chatsSection.parentNode) {
      // Strictly inject directly before the native chats section!
      return { parent: chatsSection.parentNode, beforeNode: chatsSection };
    }

    // CRITICAL: Do NOT fall back to scroller.firstChild (which is "New chat")!
    // Returning null allows MutationObserver to wait until the chats section is rendered,
    // ensuring the extension is NEVER misplaced below "New chat".
    return null;
  }

  /**
   * Ensures #gcf-root is strictly positioned directly above the native chats section.
   * If Gemini re-renders the sidebar or if #gcf-root ever drifts,
   * this immediately relocates it back directly above the chats.
   */
  function ensureCorrectPlacement() {
    const chatsSection = findChatsSection();
    if (!chatsSection || !chatsSection.parentNode) {
      return;
    }

    const targetParent = chatsSection.parentNode;
    const targetBefore = chatsSection;
    const gcfRoot = document.getElementById('gcf-root');
    const divider = document.querySelector('.gcf-injected-divider');

    if (!gcfRoot) {
      injectFolderInterface();
      return;
    }

    // Check if gcfRoot is directly preceding chatsSection
    const isDirectlyBeforeChats = (
      gcfRoot.nextSibling === targetBefore ||
      gcfRoot.nextElementSibling === targetBefore ||
      (divider && gcfRoot.nextElementSibling === divider && (divider.nextSibling === targetBefore || divider.nextElementSibling === targetBefore))
    );

    if (!isDirectlyBeforeChats) {
      console.log('[GeminiChatFolders] Relocating folders section directly above native chats...');
      targetParent.insertBefore(gcfRoot, targetBefore);
      if (divider) {
        targetParent.insertBefore(divider, targetBefore);
      }
    }
  }

  function injectFolderInterface() {
    if (document.getElementById('gcf-root')) {
      ensureCorrectPlacement();
      return;
    }

    const target = findInsertionTarget();
    if (!target || !target.parent) return;

    console.log('[GeminiChatFolders] Injecting folders container directly above chats...');

    const container = document.createElement('div');
    container.id = 'gcf-root';
    container.className = 'gcf-folders-section';

    container.innerHTML = `
      <!-- Segmented Two-Tab Navigation Bar -->
      <div class="gcf-tabs-bar" id="gcf-tabs-bar">
        <button class="gcf-tab-btn active" id="gcf-tab-folders" data-tab="folders" title="View organized chat folders">
          <span class="gcf-tab-icon">📁</span>
          <span class="gcf-tab-label">Folders</span>
          <span class="gcf-tab-badge" id="gcf-folders-badge">0</span>
        </button>
        <button class="gcf-tab-btn" id="gcf-tab-flat" data-tab="flat" title="View original flat recent chats">
          <span class="gcf-tab-icon">💬</span>
          <span class="gcf-tab-label">Recent</span>
          <span class="gcf-tab-badge" id="gcf-chats-badge">0</span>
        </button>
        <button class="gcf-layout-toggle-btn" id="gcf-btn-layout-toggle" title="Switch layout mode (Tabs / Stacked)">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M3 3h18v2H3V3zm0 4h8v14H3V7zm10 0h8v14h-8V7z"/></svg>
        </button>
      </div>

      <!-- Folders Container -->
      <div class="gcf-folders-container" id="gcf-folders-container">
        <div class="gcf-section-header" id="gcf-section-toggle">
          <div class="gcf-header-left">
            <span class="gcf-section-chevron">▼</span>
            <span class="gcf-section-title">Folders</span>
            <span class="gcf-sync-pill" id="gcf-sync-status" title="Syncing across your devices">
              <span class="gcf-sync-dot"></span> Sync
            </span>
          </div>
          <div class="gcf-header-actions" onclick="event.stopPropagation()">
            <button class="gcf-icon-btn" id="gcf-btn-search" title="Filter folders & chats">
              <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            </button>
            <button class="gcf-icon-btn" id="gcf-btn-add-folder" title="New Folder">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <button class="gcf-icon-btn" id="gcf-btn-settings" title="Settings & Layout Options">
              <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
            </button>
          </div>
        </div>

        <div class="gcf-search-container" id="gcf-search-box" style="display: none;">
          <input type="text" class="gcf-search-input" id="gcf-search-field" placeholder="Search chats in folders..." />
          <button class="gcf-search-clear" id="gcf-search-clear-btn">✕</button>
        </div>

        <div class="gcf-folders-body" id="gcf-folders-tree">
          <!-- Folders rendered here -->
        </div>
      </div>
    `;

    // Section divider before native chats
    const divider = document.createElement('div');
    divider.className = 'section-divider gcf-injected-divider';
    divider.style.margin = '4px 0 8px 0';

    if (target.beforeNode) {
      target.parent.insertBefore(container, target.beforeNode);
      target.parent.insertBefore(divider, target.beforeNode);
    } else {
      target.parent.appendChild(container);
      target.parent.appendChild(divider);
    }

    setupContainerEvents(container);
    renderFolderTree();
    applyLayoutMode();
  }

  function setupContainerEvents(container) {
    // Tabs Navigation Events
    const tabFolders = container.querySelector('#gcf-tab-folders');
    const tabFlat = container.querySelector('#gcf-tab-flat');
    const layoutToggleBtn = container.querySelector('#gcf-btn-layout-toggle');

    if (tabFolders) {
      tabFolders.addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.updateSettings({ activeTab: 'folders' });
        applyLayoutMode();
      });
    }

    if (tabFlat) {
      tabFlat.addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.updateSettings({ activeTab: 'flat' });
        applyLayoutMode();
      });
    }

    if (layoutToggleBtn) {
      layoutToggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleLayoutMode();
      });
    }

    // Toggle Folders Section collapse (inside Folders view)
    const toggleHeader = container.querySelector('#gcf-section-toggle');
    const foldersTree = container.querySelector('#gcf-folders-tree');
    
    toggleHeader.addEventListener('click', () => {
      isSectionCollapsed = !isSectionCollapsed;
      container.classList.toggle('gcf-collapsed', isSectionCollapsed);
      foldersTree.style.display = isSectionCollapsed ? 'none' : 'flex';
      const searchBox = container.querySelector('#gcf-search-box');
      if (isSectionCollapsed) searchBox.style.display = 'none';
    });

    // Search button toggle
    const searchBtn = container.querySelector('#gcf-btn-search');
    const searchBox = container.querySelector('#gcf-search-box');
    const searchField = container.querySelector('#gcf-search-field');
    const searchClear = container.querySelector('#gcf-search-clear-btn');

    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = searchBox.style.display !== 'none';
      searchBox.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        searchField.focus();
      } else {
        searchQuery = '';
        searchField.value = '';
        renderFolderTree();
      }
    });

    searchField.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderFolderTree();
    });

    searchClear.addEventListener('click', (e) => {
      e.stopPropagation();
      searchField.value = '';
      searchQuery = '';
      renderFolderTree();
      searchField.focus();
    });

    // Add Folder button
    const addBtn = container.querySelector('#gcf-btn-add-folder');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCreateFolderModal();
    });

    // Settings / Options menu
    const settingsBtn = container.querySelector('#gcf-btn-settings');
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showSettingsMenu(settingsBtn);
    });
  }

  /**
   * Applies the current layout mode (Tabs vs Stacked) and active tab
   */
  function applyLayoutMode() {
    const root = document.getElementById('gcf-root');
    if (!root) return;

    const settings = storage.meta.settings || {};
    const mode = settings.sidebarMode || 'tabs'; // 'tabs' or 'stacked'
    const activeTab = settings.activeTab || 'folders'; // 'folders' or 'flat'

    const tabsBar = root.querySelector('#gcf-tabs-bar');
    const foldersContainer = root.querySelector('#gcf-folders-container');
    const btnFolders = root.querySelector('#gcf-tab-folders');
    const btnFlat = root.querySelector('#gcf-tab-flat');
    const layoutToggleBtn = root.querySelector('#gcf-btn-layout-toggle');
    const chatsSection = findChatsSection();
    const divider = document.querySelector('.gcf-injected-divider');

    root.classList.toggle('gcf-mode-tabs', mode === 'tabs');
    root.classList.toggle('gcf-mode-stacked', mode === 'stacked');

    if (mode === 'stacked') {
      if (tabsBar) tabsBar.style.display = 'none';
      if (foldersContainer) foldersContainer.style.display = isSectionCollapsed ? 'none' : 'block';
      if (chatsSection) {
        chatsSection.classList.remove('gcf-native-hidden');
        chatsSection.style.display = '';
      }
      if (divider) divider.style.display = '';
    } else {
      // Tabs mode
      if (tabsBar) tabsBar.style.display = 'flex';
      if (btnFolders) btnFolders.classList.toggle('active', activeTab === 'folders');
      if (btnFlat) btnFlat.classList.toggle('active', activeTab === 'flat');

      if (layoutToggleBtn) {
        layoutToggleBtn.title = 'Current: Tabs View. Click to switch to Stacked View.';
      }

      if (activeTab === 'folders') {
        if (foldersContainer) foldersContainer.style.display = isSectionCollapsed ? 'none' : 'block';
        if (chatsSection) {
          chatsSection.classList.add('gcf-native-hidden');
        }
        if (divider) divider.style.display = 'none';
      } else {
        // Flat / Recent chats tab
        if (foldersContainer) foldersContainer.style.display = 'none';
        if (chatsSection) {
          chatsSection.classList.remove('gcf-native-hidden');
          chatsSection.style.display = '';
        }
        if (divider) divider.style.display = 'none';

        // Re-dispatch resize and scroll events so Angular / Gemini re-evaluates viewport and triggers infinite scroll
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('resize'));
          if (chatsSection) {
            const scroller = chatsSection.closest('[scrollable], .side-nav-scroller, .chat-history-scroller') || chatsSection.parentElement;
            if (scroller) {
              scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
          }
        });
      }
    }

    setupInfiniteScrollWatcher();
    updateBadges();
  }

  /**
   * Ensures Gemini's infinite scroll fires continuously when scrolling down
   */
  function setupInfiniteScrollWatcher() {
    const chatsSection = findChatsSection();
    if (!chatsSection) return;

    const scroller = chatsSection.closest('.side-nav-scroller, [scrollable], bard-sidenav-content') || chatsSection.parentElement;
    if (!scroller || scroller._gcfInfiniteWatcher) return;
    scroller._gcfInfiniteWatcher = true;

    scroller.addEventListener('scroll', () => {
      // Check if user is scrolled near bottom
      const distanceToBottom = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
      if (distanceToBottom < 350) {
        // Find any loading sentinel or trigger in Gemini's DOM
        const sentinel = chatsSection.querySelector('.bottom-sentinel, [data-test-id="loading-indicator"], .infinite-scroll-bottom, button[data-test-id="show-more"]');
        if (sentinel) {
          sentinel.scrollIntoView({ block: 'nearest' });
          if (typeof sentinel.click === 'function') sentinel.click();
        }
      }
    }, { passive: true });
  }

  function updateBadges() {
    const root = document.getElementById('gcf-root');
    if (!root) return;
    const foldersBadge = root.querySelector('#gcf-folders-badge');
    const chatsBadge = root.querySelector('#gcf-chats-badge');

    if (foldersBadge) {
      foldersBadge.textContent = storage.folders.size;
    }

    if (chatsBadge) {
      const nativeItems = document.querySelectorAll(
        'gem-nav-list-item[data-test-id="conversation"], ' +
        'conversations-list a, ' +
        'nav[aria-label="Chat history"] a'
      );
      let count = 0;
      nativeItems.forEach(item => {
        if (!item.closest('#gcf-root')) count++;
      });
      chatsBadge.textContent = count > 0 ? count : (storage.folders.size > 0 ? '•' : '0');
    }
  }

  async function toggleLayoutMode() {
    const currentMode = storage.meta.settings?.sidebarMode || 'tabs';
    const newMode = currentMode === 'tabs' ? 'stacked' : 'tabs';
    await storage.updateSettings({ sidebarMode: newMode });
    applyLayoutMode();
  }

  // ========================================================
  // Folder Tree Rendering
  // ========================================================

  function renderFolderTree() {
    const treeElem = document.getElementById('gcf-folders-tree');
    if (!treeElem) return;

    const state = storage.getState();
    const rootIds = state.meta.rootIds || [];

    if (rootIds.length === 0 && storage.folders.size === 0) {
      treeElem.replaceChildren();
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'gcf-empty-state';

      const textDiv = document.createElement('div');
      textDiv.textContent = 'No folders yet';

      const btnsRow = document.createElement('div');
      btnsRow.style.cssText = 'display: flex; gap: 6px; margin-top: 8px; justify-content: center; flex-wrap: wrap;';

      const createBtn = document.createElement('button');
      createBtn.className = 'gcf-empty-btn';
      createBtn.id = 'gcf-empty-create-btn';
      createBtn.textContent = '+ Create Folder';
      createBtn.addEventListener('click', () => showCreateFolderModal());

      const defaultFoldersBtn = document.createElement('button');
      defaultFoldersBtn.className = 'gcf-empty-btn';
      defaultFoldersBtn.id = 'gcf-empty-defaults-btn';
      defaultFoldersBtn.style.cssText = 'background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: var(--gcf-text-primary, #e2e8f0); cursor: pointer;';
      defaultFoldersBtn.textContent = '✨ Starter Folders';
      defaultFoldersBtn.addEventListener('click', async () => {
        await storage.createDefaultFolders();
      });

      const importBtn = document.createElement('button');
      importBtn.className = 'gcf-empty-btn';
      importBtn.id = 'gcf-empty-import-btn';
      importBtn.style.cssText = 'background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.4); color: var(--gcf-text-primary, #e2e8f0); cursor: pointer;';
      importBtn.textContent = '📥 Import Backup';
      importBtn.addEventListener('click', () => showImportModal());

      btnsRow.append(createBtn, defaultFoldersBtn, importBtn);
      emptyDiv.append(textDiv, btnsRow);
      treeElem.appendChild(emptyDiv);
      return;
    }

    treeElem.replaceChildren();

    // Render root folders
    for (const folderId of rootIds) {
      const folder = storage.folders.get(folderId);
      if (folder) {
        const folderNode = createFolderDom(folder, 0);
        if (folderNode) treeElem.appendChild(folderNode);
      }
    }

    highlightActiveChat();
  }

  function createFolderDom(folder, depth = 0) {
    const isFiltered = searchQuery.length > 0;
    
    // Check if this folder or any of its children match search query
    const nameMatches = folder.name.toLowerCase().includes(searchQuery);
    const matchingChats = (folder.chats || []).filter(c => 
      !isFiltered || c.title.toLowerCase().includes(searchQuery)
    );

    // Render children
    const childNodes = [];
    if (folder.childrenIds && folder.childrenIds.length > 0) {
      for (const childId of folder.childrenIds) {
        const child = storage.folders.get(childId);
        if (child) {
          const childDom = createFolderDom(child, depth + 1);
          if (childDom) childNodes.push(childDom);
        }
      }
    }

    if (isFiltered && !nameMatches && matchingChats.length === 0 && childNodes.length === 0) {
      return null; // Hide in search if no matches
    }

    const totalChatCount = (folder.chats ? folder.chats.length : 0);
    const folderRow = document.createElement('div');
    folderRow.className = `gcf-folder-row ${folder.collapsed && !isFiltered ? 'is-collapsed' : ''}`;
    folderRow.dataset.folderId = folder.id;
    folderRow.draggable = true;

    // Folder Header
    const header = document.createElement('div');
    header.className = 'gcf-folder-header';
    header.style.paddingLeft = `${Math.min(24, depth * 12 + 6)}px`;

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'gcf-folder-collapse-btn';
    collapseBtn.title = 'Toggle Folder';
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'gcf-arrow';
    arrowSpan.textContent = '▼';
    collapseBtn.appendChild(arrowSpan);

    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'gcf-folder-icon-wrapper';
    iconWrapper.style.backgroundColor = `${folder.color || '#3b82f6'}22`;
    iconWrapper.style.color = folder.color || '#3b82f6';
    iconWrapper.textContent = folder.icon || '📁';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'gcf-folder-name';
    nameSpan.title = folder.name;
    nameSpan.textContent = folder.name;

    const countSpan = document.createElement('span');
    countSpan.className = 'gcf-folder-count';
    countSpan.textContent = String(totalChatCount);

    const hoverActions = document.createElement('div');
    hoverActions.className = 'gcf-folder-hover-actions';

    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'gcf-mini-btn gcf-btn-add-sub';
    addSubBtn.title = 'Add Subfolder';
    addSubBtn.textContent = '➕';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'gcf-mini-btn gcf-btn-folder-menu';
    menuBtn.title = 'Folder Options';
    menuBtn.textContent = '⋮';

    hoverActions.append(addSubBtn, menuBtn);
    header.append(collapseBtn, iconWrapper, nameSpan, countSpan, hoverActions);

    // Folder collapse toggle
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      folder.collapsed = !folder.collapsed;
      folderRow.classList.toggle('is-collapsed', folder.collapsed);
      storage.updateFolder(folder.id, { collapsed: folder.collapsed });
    });

    header.addEventListener('click', () => {
      folder.collapsed = !folder.collapsed;
      folderRow.classList.toggle('is-collapsed', folder.collapsed);
      storage.updateFolder(folder.id, { collapsed: folder.collapsed });
    });

    // Add subfolder
    addSubBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCreateFolderModal(folder.id, folder.name);
    });

    // Folder menu
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderActionMenu(folder, menuBtn);
    });

    folderRow.appendChild(header);

    // Children & Chats container
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'gcf-folder-children';

    // Append child subfolders
    for (const childDom of childNodes) {
      childrenContainer.appendChild(childDom);
    }

    // Append chats
    const chatsToRender = isFiltered ? matchingChats : (folder.chats || []);
    for (const chat of chatsToRender) {
      const chatItem = createChatItemDom(chat, folder.id);
      childrenContainer.appendChild(chatItem);
    }

    // If folder has no chats and no subfolders, show a friendly drop zone
    if (childNodes.length === 0 && chatsToRender.length === 0) {
      const emptyZone = document.createElement('div');
      emptyZone.className = 'gcf-folder-empty-zone';
      const dropSpan = document.createElement('span');
      dropSpan.textContent = '📥 Drop chats here';
      emptyZone.appendChild(dropSpan);
      childrenContainer.appendChild(emptyZone);
    }

    folderRow.appendChild(childrenContainer);

    // Setup Drag-and-Drop on the entire folder area (header, row, children, empty zone)
    setupFolderDragDrop(folderRow, header, childrenContainer, folder);

    return folderRow;
  }

  function createChatItemDom(chat, folderId) {
    const item = document.createElement('div');
    item.className = 'gcf-chat-item';
    item.dataset.chatId = chat.id;
    item.draggable = true;

    // Check if current page is this chat
    const currentPath = window.location.pathname;
    if (currentPath.includes(chat.id)) {
      item.classList.add('gcf-active-chat');
    }

    const chatUrl = chat.url || `/app/${chat.id}`;

    const link = document.createElement('a');
    link.href = chatUrl;
    link.className = 'gcf-chat-link';
    link.title = chat.title;

    const bullet = document.createElement('span');
    bullet.className = 'gcf-chat-bullet';
    bullet.textContent = '💬';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'gcf-chat-title';
    titleSpan.textContent = chat.title;

    link.append(bullet, titleSpan);

    const actions = document.createElement('div');
    actions.className = 'gcf-chat-actions';

    const unfileBtn = document.createElement('button');
    unfileBtn.className = 'gcf-mini-btn gcf-chat-unfile';
    unfileBtn.title = 'Remove from folder';
    unfileBtn.textContent = '✕';

    // Unfile button event listener
    unfileBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await storage.removeChatFromFolder(folderId, chat.id);
    });

    actions.appendChild(unfileBtn);
    item.append(link, actions);

    link.addEventListener('click', (e) => {
      // Allow user to open in new tab with Cmd/Ctrl or middle click
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      navigateToChat(chat.id, chatUrl);
    });

    // Drag chat item
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'gcf-chat',
        chatId: chat.id,
        title: chat.title,
        url: chat.url,
        fromFolderId: folderId
      }));
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.5';
    });

    item.addEventListener('dragend', () => {
      item.style.opacity = '1';
    });

    return item;
  }

  /**
   * Seamlessly navigates to a conversation without hard page reloading,
   * matching Gemini's native Single Page Application (SPA) behavior.
   */
  function navigateToChat(chatId, chatUrl) {
    const cleanId = (chatId || '').replace(/^.*\/app\//, '').replace(/[?#].*$/, '').trim();
    const targetUrl = chatUrl || (cleanId ? `/app/${cleanId}` : '/app');

    console.log(`[GeminiChatFolders] Navigating to chat ${cleanId} via native SPA...`);

    // 1. Look for native Gemini conversation link in DOM (excluding our own injected elements)
    const nativeLink = findNativeChatLink(cleanId);
    if (nativeLink) {
      if (typeof nativeLink.scrollIntoView === 'function') {
        nativeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      // Dispatch MouseEvent click and .click() to ensure Angular RouterLink activates
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0
      });
      nativeLink.dispatchEvent(clickEvent);
      nativeLink.click();
      highlightActiveChat(cleanId);
      return;
    }

    // 2. If native link was not found, check if native chats section is collapsed; expand it and retry
    const chatsSection = findChatsSection();
    if (chatsSection && !chatsSection.classList.contains('expanded')) {
      const toggle = chatsSection.querySelector('[data-test-id="expandable-section-toggle"], .expandable-section-header');
      if (toggle) {
        toggle.click();
        setTimeout(() => {
          const retriedLink = findNativeChatLink(cleanId);
          if (retriedLink) {
            retriedLink.click();
            highlightActiveChat(cleanId);
            return;
          }
        }, 50);
      }
    }

    // 3. Fallback: Use browser SPA History API with popstate event to notify Angular Router
    try {
      const targetPath = targetUrl.startsWith('http') ? new URL(targetUrl).pathname : targetUrl;
      if (window.location.pathname !== targetPath) {
        history.pushState({ gcfNav: true, id: cleanId }, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate', { state: { gcfNav: true, id: cleanId } }));
      }
      highlightActiveChat(cleanId);
    } catch (err) {
      console.warn('[GeminiChatFolders] SPA router fallback failed, using location.href:', err);
      window.location.href = targetUrl;
    }
  }

  function findNativeChatLink(cleanId) {
    if (!cleanId) return null;
    const candidates = document.querySelectorAll(
      'gem-nav-list-item[data-test-id="conversation"] a, ' +
      'conversations-list a, ' +
      'bard-sidenav a[href*="/app/"]'
    );
    for (const a of candidates) {
      if (a.closest('#gcf-root')) continue;
      const href = a.getAttribute('href') || '';
      if (href.includes(cleanId)) {
        return a;
      }
    }
    return null;
  }

  // ========================================================
  // Drag & Drop Handling (Supports dropping on entire folder area)
  // ========================================================

  /**
   * Sets up drag-and-drop on the entire folder area:
   * Header, folder label/icon, children container, empty drop zone, and row borders.
   * Also supports auto-expanding collapsed folders when hovering with a dragged chat for 550ms.
   */
  function setupFolderDragDrop(folderRow, headerElem, childrenContainer, folder) {
    const folderId = folder.id;
    let dragEnterCount = 0;
    let hoverExpandTimer = null;

    // Helper: is the event directly for this folder (not a nested subfolder inside it)?
    function isEventForThisFolder(e) {
      const closestRow = e.target.closest('.gcf-folder-row');
      return closestRow === folderRow;
    }

    const handleDragOver = (e) => {
      if (!isEventForThisFolder(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      folderRow.classList.add('gcf-drag-over');

      // Auto-expand closed folder after hovering for 550ms
      if (folder.collapsed && !hoverExpandTimer) {
        hoverExpandTimer = setTimeout(() => {
          folder.collapsed = false;
          folderRow.classList.remove('is-collapsed');
          storage.updateFolder(folder.id, { collapsed: false });
        }, 550);
      }
    };

    const handleDragEnter = (e) => {
      if (!isEventForThisFolder(e)) return;
      dragEnterCount++;
      folderRow.classList.add('gcf-drag-over');
    };

    const handleDragLeave = (e) => {
      if (!isEventForThisFolder(e)) return;
      dragEnterCount--;
      if (dragEnterCount <= 0) {
        dragEnterCount = 0;
        folderRow.classList.remove('gcf-drag-over');
      }
      if (hoverExpandTimer) {
        clearTimeout(hoverExpandTimer);
        hoverExpandTimer = null;
      }
    };

    const handleDrop = async (e) => {
      if (!isEventForThisFolder(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragEnterCount = 0;
      if (hoverExpandTimer) {
        clearTimeout(hoverExpandTimer);
        hoverExpandTimer = null;
      }
      folderRow.classList.remove('gcf-drag-over');

      try {
        const rawData = e.dataTransfer.getData('text/plain');
        if (!rawData) return;
        const data = JSON.parse(rawData);

        if (data.type === 'gcf-chat' || data.type === 'gemini-native-chat') {
          // Chat dropped anywhere into this folder's area
          await storage.addChatToFolder(folderId, {
            id: data.chatId || data.id,
            title: data.title,
            url: data.url
          });
          console.log(`[GeminiChatFolders] Dropped chat "${data.title}" into folder "${folder.name}"`);
        } else if (data.type === 'gcf-folder' && data.folderId !== folderId) {
          // Folder dropped into this folder as a subfolder
          await storage.moveFolder(data.folderId, folderId);
        }
      } catch (err) {
        console.warn('[GeminiChatFolders] Drop error:', err);
      }
    };

    // Attach drag & drop listeners to folderRow (covers header, row, children container, drop zone)
    folderRow.addEventListener('dragover', handleDragOver);
    folderRow.addEventListener('dragenter', handleDragEnter);
    folderRow.addEventListener('dragleave', handleDragLeave);
    folderRow.addEventListener('drop', handleDrop);

    // Make folder itself draggable to nest or reorder
    folderRow.addEventListener('dragstart', (e) => {
      // Only drag folder if drag started from header or row itself, not from child chat
      if (e.target !== folderRow && e.target !== headerElem && !headerElem.contains(e.target)) return;
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'gcf-folder',
        folderId: folderId
      }));
      e.dataTransfer.effectAllowed = 'move';
    });
  }

  // ========================================================
  // Native Gemini Chats Integration
  // ========================================================

  function scanAndEnhanceNativeChats() {
    // Select all conversation items in Gemini's sidebar
    // From user's DOM: <gem-nav-list-item data-test-id="conversation">
    const chatItems = document.querySelectorAll('gem-nav-list-item[data-test-id="conversation"]') ||
                      document.querySelectorAll('conversations-list gem-nav-list-item');

    const hideFiled = storage.meta.settings && storage.meta.settings.hideFiledFromAll;

    chatItems.forEach(item => {
      const link = item.querySelector('a[href*="/app/"]');
      if (!link) return;

      const href = link.getAttribute('href');
      const match = href.match(/\/app\/([a-zA-Z0-9_\-]+)/);
      if (!match) return;

      const chatId = match[1];
      const titleElem = item.querySelector('.title-text') || link;
      const title = (titleElem.textContent || link.getAttribute('aria-label') || 'Conversation').trim();

      // Check if chat is filed in any folder
      const filedFolder = storage.getChatFolder(chatId);

      // Handle "Hide filed chats from recent list" setting
      if (hideFiled && filedFolder) {
        item.classList.add('gcf-filed-hidden');
      } else {
        item.classList.remove('gcf-filed-hidden');
      }

      // Make native item draggable into folders
      if (!item.dataset.gcfDraggable) {
        item.dataset.gcfDraggable = 'true';
        item.setAttribute('draggable', 'true');
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'gemini-native-chat',
            id: chatId,
            title: title,
            url: href
          }));
          e.dataTransfer.effectAllowed = 'move';
        });
      }

      // Inject folder quick action button in .hovered-trailing-content
      const trailingContainer = item.querySelector('.hovered-trailing-content');
      if (trailingContainer && !trailingContainer.querySelector('.gcf-injected-folder-btn')) {
        const folderBtn = document.createElement('button');
        folderBtn.type = 'button';
        folderBtn.className = `gcf-injected-folder-btn ${filedFolder ? 'is-filed' : ''}`;
        folderBtn.title = filedFolder ? `Filed in: ${filedFolder.name} (Click to change)` : 'Add to Folder';
        folderBtn.textContent = filedFolder ? (filedFolder.icon || '📁') : '📁';

        folderBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          showChatFolderPicker(chatId, title, href, folderBtn);
        });

        trailingContainer.prepend(folderBtn);
      } else if (trailingContainer) {
        const existingBtn = trailingContainer.querySelector('.gcf-injected-folder-btn');
        if (existingBtn) {
          existingBtn.className = `gcf-injected-folder-btn ${filedFolder ? 'is-filed' : ''}`;
          existingBtn.title = filedFolder ? `Filed in: ${filedFolder.name} (Click to change)` : 'Add to Folder';
          existingBtn.textContent = filedFolder ? (filedFolder.icon || '📁') : '📁';
        }
      }
    });
  }

  function highlightActiveChat(activeId = null) {
    let currentId = activeId;
    if (!currentId) {
      const match = window.location.pathname.match(/\/app\/([a-zA-Z0-9_\-]+)/);
      if (match) currentId = match[1];
    }

    document.querySelectorAll('.gcf-chat-item').forEach(elem => {
      const isCurrent = currentId && elem.dataset.chatId === currentId;
      elem.classList.toggle('gcf-active-chat', isCurrent);
    });
  }

  function updateSyncStatusIndicator() {
    const pill = document.getElementById('gcf-sync-status');
    if (!pill) return;
    const isSync = storage.getState().isSyncSupported;
    pill.title = isSync 
      ? `Firefox Sync Connected • Last synced: ${new Date(storage.lastSyncTime).toLocaleTimeString()}`
      : 'Local Storage (Sync disabled)';
  }

  // ========================================================
  // Interactive UI Menus & Modals
  // ========================================================

  function closeActiveDropdown() {
    if (activeDropdown && activeDropdown.parentNode) {
      activeDropdown.parentNode.removeChild(activeDropdown);
      activeDropdown = null;
    }
  }

  document.addEventListener('click', (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeActiveDropdown();
    }
  });

  /**
   * Popup picker to assign a chat to any folder
   */
  /**
   * Popup picker to assign a chat to any folder (Hierarchical tree + instant search)
   */
  function showChatFolderPicker(chatId, title, url, anchorElem) {
    closeActiveDropdown();

    const rect = anchorElem.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'gcf-dropdown-menu';
    dropdown.style.width = '240px';
    dropdown.style.top = `${Math.min(window.innerHeight - 340, rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, rect.left - 110))}px`;

    const currentFolder = storage.getChatFolder(chatId);

    const headerTitle = document.createElement('div');
    headerTitle.className = 'gcf-menu-header';
    headerTitle.textContent = 'Organize into Folder';
    dropdown.appendChild(headerTitle);

    // Instant Search Input
    const searchBox = document.createElement('div');
    searchBox.className = 'gcf-picker-search-box';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'gcf-picker-search-input';
    searchInput.placeholder = 'Search folders...';
    searchBox.appendChild(searchInput);
    dropdown.appendChild(searchBox);

    if (currentFolder) {
      const unfileItem = document.createElement('div');
      unfileItem.className = 'gcf-menu-item danger';
      unfileItem.id = 'gcf-picker-unfile';
      const xSpan = document.createElement('span');
      xSpan.textContent = '✕';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = `Remove from "${currentFolder.name}"`;
      unfileItem.append(xSpan, labelSpan);
      unfileItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.removeChatFromFolder(currentFolder.id, chatId);
        closeActiveDropdown();
      });
      dropdown.appendChild(unfileItem);

      const d = document.createElement('div');
      d.className = 'gcf-menu-divider';
      dropdown.appendChild(d);
    }

    // Scrollable list container for folders
    const listContainer = document.createElement('div');
    listContainer.className = 'gcf-picker-list';
    dropdown.appendChild(listContainer);

    function renderPickerFolders(query = '') {
      listContainer.replaceChildren();
      const lowerQuery = query.toLowerCase().trim();

      // Collect folders in hierarchical order
      const items = [];
      function walk(folderId, depth = 0, parentName = '') {
        const folder = storage.folders.get(folderId);
        if (!folder) return;

        const matches = !lowerQuery || 
          folder.name.toLowerCase().includes(lowerQuery) || 
          (parentName && parentName.toLowerCase().includes(lowerQuery));

        if (matches) {
          items.push({ folder, depth, parentName });
        }

        if (folder.childrenIds && Array.isArray(folder.childrenIds)) {
          for (const cid of folder.childrenIds) {
            walk(cid, depth + 1, folder.name);
          }
        }
      }

      const rootIds = storage.meta.rootIds || [];
      for (const rid of rootIds) {
        walk(rid, 0, '');
      }

      // Add any unlisted/orphan root folders
      for (const [id, f] of storage.folders.entries()) {
        if (!f.parentId && !rootIds.includes(id)) {
          walk(id, 0, '');
        }
      }

      if (items.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'gcf-menu-item';
        emptyItem.style.color = 'var(--gcf-text-secondary)';
        emptyItem.style.cursor = 'default';
        emptyItem.textContent = storage.folders.size === 0 ? 'No folders created yet' : 'No matching folders';
        listContainer.appendChild(emptyItem);
        return;
      }

      for (const { folder, depth, parentName } of items) {
        const isCurrent = currentFolder && currentFolder.id === folder.id;
        const item = document.createElement('div');
        item.className = `gcf-menu-item${isCurrent ? ' active' : ''}`;
        item.dataset.folderId = folder.id;

        // Visual hierarchical tree indentation
        if (depth > 0) {
          item.style.paddingLeft = `${10 + depth * 14}px`;
          const branchSpan = document.createElement('span');
          branchSpan.className = 'gcf-subfolder-branch';
          branchSpan.textContent = '↳ ';
          item.appendChild(branchSpan);
        }

        const iconSpan = document.createElement('span');
        iconSpan.textContent = folder.icon || '📁';
        if (folder.color) {
          iconSpan.style.color = folder.color;
        }

        const nameSpan = document.createElement('span');
        nameSpan.style.flex = '1';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.textContent = folder.name;

        item.append(iconSpan, nameSpan);

        if (depth > 0 && parentName && lowerQuery) {
          const hintSpan = document.createElement('span');
          hintSpan.className = 'gcf-parent-hint';
          hintSpan.textContent = `(${parentName})`;
          item.appendChild(hintSpan);
        }

        if (isCurrent) {
          const check = document.createElement('span');
          check.textContent = '✓';
          check.style.color = 'var(--gcf-accent)';
          check.style.fontWeight = 'bold';
          item.appendChild(check);
        }

        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          await storage.addChatToFolder(folder.id, { id: chatId, title, url });
          closeActiveDropdown();
        });

        listContainer.appendChild(item);
      }
    }

    renderPickerFolders('');

    // Search input events
    searchInput.addEventListener('input', (e) => {
      renderPickerFolders(e.target.value);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstMatch = listContainer.querySelector('.gcf-menu-item[data-folder-id]');
        if (firstMatch) {
          firstMatch.click();
        }
      } else if (e.key === 'Escape') {
        closeActiveDropdown();
      }
    });

    const d2 = document.createElement('div');
    d2.className = 'gcf-menu-divider';
    dropdown.appendChild(d2);

    const newFolderItem = document.createElement('div');
    newFolderItem.className = 'gcf-menu-item';
    newFolderItem.id = 'gcf-picker-new-folder';
    const plusSpan = document.createElement('span');
    plusSpan.textContent = '➕';
    const newTextSpan = document.createElement('span');
    newTextSpan.textContent = 'New Folder...';
    newFolderItem.append(plusSpan, newTextSpan);
    newFolderItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      showCreateFolderModal(null, null, { chatId, title, url });
    });
    dropdown.appendChild(newFolderItem);

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    // Focus search input automatically
    setTimeout(() => {
      if (searchInput && document.body.contains(searchInput)) {
        searchInput.focus();
      }
    }, 60);
  }

  /**
   * Action menu on each folder
   */
  function showFolderActionMenu(folder, anchorElem) {
    closeActiveDropdown();

    const rect = anchorElem.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'gcf-dropdown-menu';
    dropdown.style.top = `${Math.min(window.innerHeight - 250, rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.min(window.innerWidth - 220, rect.left - 120)}px`;

    const headerTitle = document.createElement('div');
    headerTitle.className = 'gcf-menu-header';
    headerTitle.textContent = folder.name;
    dropdown.appendChild(headerTitle);

    function createMenuItem(id, icon, text, isDanger = false) {
      const item = document.createElement('div');
      item.className = `gcf-menu-item${isDanger ? ' danger' : ''}`;
      item.id = id;
      const iSpan = document.createElement('span');
      iSpan.textContent = icon;
      const tSpan = document.createElement('span');
      tSpan.textContent = text;
      item.append(iSpan, tSpan);
      return item;
    }

    const divider = () => {
      const d = document.createElement('div');
      d.className = 'gcf-menu-divider';
      return d;
    };

    dropdown.append(
      createMenuItem('gcf-act-subfolder', '➕', 'Add Subfolder'),
      createMenuItem('gcf-act-rename', '✏️', 'Rename Folder'),
      createMenuItem('gcf-act-style', '🎨', 'Change Color & Icon'),
      divider(),
      createMenuItem('gcf-act-delete', '🗑️', 'Delete Folder', true)
    );

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    dropdown.querySelector('#gcf-act-subfolder').addEventListener('click', () => {
      closeActiveDropdown();
      showCreateFolderModal(folder.id, folder.name);
    });

    dropdown.querySelector('#gcf-act-rename').addEventListener('click', () => {
      closeActiveDropdown();
      showRenameFolderModal(folder);
    });

    dropdown.querySelector('#gcf-act-style').addEventListener('click', () => {
      closeActiveDropdown();
      showStyleFolderModal(folder);
    });

    dropdown.querySelector('#gcf-act-delete').addEventListener('click', async () => {
      closeActiveDropdown();
      if (confirm(`Delete folder "${folder.name}"? (Chats inside will be kept in your history)`)) {
        await storage.deleteFolder(folder.id);
      }
    });
  }

  /**
   * Settings Menu
   */
  function showSettingsMenu(anchorElem) {
    closeActiveDropdown();

    const rect = anchorElem.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'gcf-dropdown-menu';
    dropdown.style.top = `${Math.min(window.innerHeight - 300, rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.min(window.innerWidth - 250, rect.left - 180)}px`;

    const settings = storage.meta.settings || {};

    const headerTitle = document.createElement('div');
    headerTitle.className = 'gcf-menu-header';
    headerTitle.textContent = 'Folder Options';
    dropdown.appendChild(headerTitle);

    function createMenuItem(id, icon, text) {
      const item = document.createElement('div');
      item.className = 'gcf-menu-item';
      item.id = id;
      const iSpan = document.createElement('span');
      iSpan.textContent = icon;
      const tSpan = document.createElement('span');
      tSpan.textContent = text;
      item.append(iSpan, tSpan);
      return item;
    }

    const divider = () => {
      const d = document.createElement('div');
      d.className = 'gcf-menu-divider';
      return d;
    };

    const currentMode = settings.sidebarMode || 'tabs';
    const layoutLabel = currentMode === 'tabs' ? 'Layout: Tabs (Switch to Stacked)' : 'Layout: Stacked (Switch to Tabs)';
    const layoutIcon = currentMode === 'tabs' ? '📑' : '🗂️';

    dropdown.append(
      createMenuItem('gcf-opt-layout', layoutIcon, layoutLabel),
      createMenuItem('gcf-opt-starter-folders', '✨', 'Create Starter Default Folders'),
      divider(),
      createMenuItem('gcf-opt-hide-filed', settings.hideFiledFromAll ? '☑' : '☐', 'Hide filed chats from "All"'),
      createMenuItem('gcf-opt-collapse-all', '📁', 'Collapse All Folders'),
      createMenuItem('gcf-opt-expand-all', '📂', 'Expand All Folders'),
      divider(),
      createMenuItem('gcf-opt-export', '💾', 'Export Backup (JSON)'),
      createMenuItem('gcf-opt-import', '📥', 'Import Backup')
    );

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    // Toggle layout mode
    dropdown.querySelector('#gcf-opt-layout').addEventListener('click', async () => {
      closeActiveDropdown();
      await toggleLayoutMode();
    });

    // Create starter folders
    dropdown.querySelector('#gcf-opt-starter-folders').addEventListener('click', async () => {
      closeActiveDropdown();
      await storage.createDefaultFolders();
    });

    // Toggle hide filed
    dropdown.querySelector('#gcf-opt-hide-filed').addEventListener('click', async () => {
      const newVal = !settings.hideFiledFromAll;
      await storage.updateSettings({ hideFiledFromAll: newVal });
      closeActiveDropdown();
      scanAndEnhanceNativeChats();
    });

    // Collapse all
    dropdown.querySelector('#gcf-opt-collapse-all').addEventListener('click', async () => {
      closeActiveDropdown();
      for (const folder of storage.folders.values()) {
        await storage.updateFolder(folder.id, { collapsed: true });
      }
    });

    // Expand all
    dropdown.querySelector('#gcf-opt-expand-all').addEventListener('click', async () => {
      closeActiveDropdown();
      for (const folder of storage.folders.values()) {
        await storage.updateFolder(folder.id, { collapsed: false });
      }
    });

    // Export JSON
    dropdown.querySelector('#gcf-opt-export').addEventListener('click', () => {
      closeActiveDropdown();
      const json = storage.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gemini-folders-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import JSON Backup
    dropdown.querySelector('#gcf-opt-import').addEventListener('click', () => {
      closeActiveDropdown();
      showImportModal();
    });
  }

  // ========================================================
  // Dialog Modals
  // ========================================================

  function showImportModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'gcf-modal-backdrop';

    const box = document.createElement('div');
    box.className = 'gcf-modal-box';
    box.style.maxWidth = '480px';

    const titleH3 = document.createElement('h3');
    titleH3.className = 'gcf-modal-title';
    titleH3.textContent = 'Import Folders & Backup';

    const descP = document.createElement('p');
    descP.style.cssText = 'font-size: 13px; color: var(--gcf-text-secondary); margin: 0 0 12px 0; line-height: 1.4;';
    descP.textContent = 'Restore your folders and chat organization by selecting a JSON file or pasting backup data:';

    // File input + choose file button
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';

    const chooseFileBtn = document.createElement('button');
    chooseFileBtn.className = 'gcf-btn-secondary';
    chooseFileBtn.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 13px; margin-bottom: 12px; width: 100%; justify-content: center; cursor: pointer;';
    chooseFileBtn.textContent = '📁 Choose JSON Backup File...';

    chooseFileBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });

    // Textarea for direct paste
    const textareaLabel = document.createElement('label');
    textareaLabel.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--gcf-text-secondary); text-transform: uppercase; margin-bottom: 4px; display: block;';
    textareaLabel.textContent = 'Or Paste Backup JSON Directly:';

    const textarea = document.createElement('textarea');
    textarea.className = 'gcf-input-field';
    textarea.placeholder = '{\n  "app": "GeminiChatFolders",\n  "folders": [...]\n}';
    textarea.style.cssText = 'height: 125px; font-family: monospace; font-size: 11px; line-height: 1.4; resize: vertical; margin-bottom: 12px; width: 100%; box-sizing: border-box;';

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          textarea.value = evt.target.result;
          chooseFileBtn.textContent = `✓ Loaded: ${file.name}`;
          chooseFileBtn.style.borderColor = 'var(--gcf-primary)';
        };
        reader.readAsText(file);
      }
    });

    // Merge option
    const mergeRow = document.createElement('label');
    mergeRow.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gcf-text-secondary); margin-bottom: 14px; cursor: pointer; user-select: none;';
    const mergeCheckbox = document.createElement('input');
    mergeCheckbox.type = 'checkbox';
    mergeCheckbox.style.cursor = 'pointer';
    const mergeText = document.createElement('span');
    mergeText.textContent = 'Merge with existing folders (instead of replacing)';
    mergeRow.append(mergeCheckbox, mergeText);

    // Status message container
    const statusMsg = document.createElement('div');
    statusMsg.style.cssText = 'display: none; font-size: 12px; padding: 8px 10px; border-radius: 6px; margin-bottom: 12px; line-height: 1.4;';

    // Actions
    const actions = document.createElement('div');
    actions.className = 'gcf-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'gcf-btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const importBtn = document.createElement('button');
    importBtn.className = 'gcf-btn-primary';
    importBtn.textContent = 'Import Now';

    actions.append(cancelBtn, importBtn);

    box.append(titleH3, descP, fileInput, chooseFileBtn, textareaLabel, textarea, mergeRow, statusMsg, actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    textarea.focus();

    cancelBtn.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    importBtn.addEventListener('click', async () => {
      const raw = textarea.value.trim();
      if (!raw) {
        statusMsg.style.display = 'block';
        statusMsg.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
        statusMsg.style.color = '#ef4444';
        statusMsg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusMsg.textContent = 'Please choose a file or paste JSON data into the box.';
        return;
      }

      importBtn.disabled = true;
      importBtn.textContent = 'Importing...';

      try {
        const state = await storage.importData(raw, mergeCheckbox.checked);
        statusMsg.style.display = 'block';
        statusMsg.style.backgroundColor = 'rgba(16, 185, 129, 0.12)';
        statusMsg.style.color = '#10b981';
        statusMsg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        statusMsg.textContent = `✓ Successfully restored ${state.folderCount} folders and ${state.chatCount} chats!`;

        renderFolderTree();
        scanAndEnhanceNativeChats();
        updateSyncStatusIndicator();

        setTimeout(() => {
          backdrop.remove();
        }, 800);
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import Now';
        statusMsg.style.display = 'block';
        statusMsg.style.backgroundColor = 'rgba(239, 68, 68, 0.12)';
        statusMsg.style.color = '#ef4444';
        statusMsg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusMsg.textContent = 'Import error: ' + err.message;
      }
    });
  }

  function showCreateFolderModal(parentId = null, parentName = null, chatToAssign = null) {
    const backdrop = document.createElement('div');
    backdrop.className = 'gcf-modal-backdrop';

    let selectedColor = window.DEFAULT_COLORS ? window.DEFAULT_COLORS[0] : '#3b82f6';
    let selectedIcon = '📁';

    const box = document.createElement('div');
    box.className = 'gcf-modal-box';

    const titleH3 = document.createElement('h3');
    titleH3.className = 'gcf-modal-title';
    titleH3.textContent = parentId ? `New Subfolder in "${parentName}"` : 'Create New Folder';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gcf-input-field';
    input.id = 'gcf-folder-name-input';
    input.placeholder = 'e.g. EU Admissions, Solar Project...';

    // Color section
    const colorWrap = document.createElement('div');
    const colorLabel = document.createElement('label');
    colorLabel.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--gcf-text-secondary); text-transform: uppercase;';
    colorLabel.textContent = 'Choose Color';
    const colorGrid = document.createElement('div');
    colorGrid.className = 'gcf-color-grid';
    colorGrid.id = 'gcf-colors';
    const colors = window.DEFAULT_COLORS || ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
    colors.forEach(c => {
      const sw = document.createElement('div');
      sw.className = `gcf-color-swatch ${c === selectedColor ? 'selected' : ''}`;
      sw.style.backgroundColor = c;
      sw.dataset.color = c;
      colorGrid.appendChild(sw);
    });
    colorWrap.append(colorLabel, colorGrid);

    // Icon section
    const iconWrap = document.createElement('div');
    const iconLabel = document.createElement('label');
    iconLabel.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--gcf-text-secondary); text-transform: uppercase;';
    iconLabel.textContent = 'Choose Icon';
    const iconGrid = document.createElement('div');
    iconGrid.className = 'gcf-icon-grid';
    iconGrid.id = 'gcf-icons';
    const icons = (window.DEFAULT_ICONS || ['📁', '💼', '🎓', '💻', '💡', '🔬', '🚀', '📚', '⭐', '🛠️']).slice(0, 10);
    icons.forEach(ic => {
      const sw = document.createElement('div');
      sw.className = `gcf-icon-swatch ${ic === selectedIcon ? 'selected' : ''}`;
      sw.dataset.icon = ic;
      sw.textContent = ic;
      iconGrid.appendChild(sw);
    });
    iconWrap.append(iconLabel, iconGrid);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'gcf-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'gcf-btn-secondary';
    cancelBtn.id = 'gcf-modal-cancel';
    cancelBtn.textContent = 'Cancel';
    const createBtn = document.createElement('button');
    createBtn.className = 'gcf-btn-primary';
    createBtn.id = 'gcf-modal-create';
    createBtn.textContent = 'Create Folder';
    actions.append(cancelBtn, createBtn);

    box.append(titleH3, input, colorWrap, iconWrap, actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    input.focus();

    // Color picker
    backdrop.querySelectorAll('.gcf-color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        backdrop.querySelectorAll('.gcf-color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = swatch.dataset.color;
      });
    });

    // Icon picker
    backdrop.querySelectorAll('.gcf-icon-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        backdrop.querySelectorAll('.gcf-icon-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedIcon = swatch.dataset.icon;
      });
    });

    const closeModal = () => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };

    backdrop.querySelector('#gcf-modal-cancel').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    const handleCreate = async () => {
      const name = input.value.trim() || 'New Folder';
      const newFolder = await storage.createFolder({
        name,
        parentId,
        color: selectedColor,
        icon: selectedIcon
      });

      if (chatToAssign && newFolder) {
        await storage.addChatToFolder(newFolder.id, chatToAssign);
      }

      closeModal();
    };

    backdrop.querySelector('#gcf-modal-create').addEventListener('click', handleCreate);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreate();
      if (e.key === 'Escape') closeModal();
    });
  }

  function showRenameFolderModal(folder) {
    const newName = prompt('Enter new folder name:', folder.name);
    if (newName && newName.trim() && newName.trim() !== folder.name) {
      storage.updateFolder(folder.id, { name: newName.trim() });
    }
  }

  function showStyleFolderModal(folder) {
    const backdrop = document.createElement('div');
    backdrop.className = 'gcf-modal-backdrop';

    let selectedColor = folder.color || '#3b82f6';
    let selectedIcon = folder.icon || '📁';

    const box = document.createElement('div');
    box.className = 'gcf-modal-box';

    const titleH3 = document.createElement('h3');
    titleH3.className = 'gcf-modal-title';
    titleH3.textContent = `Customize "${folder.name}"`;

    // Color section
    const colorWrap = document.createElement('div');
    const colorLabel = document.createElement('label');
    colorLabel.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--gcf-text-secondary); text-transform: uppercase;';
    colorLabel.textContent = 'Color';
    const colorGrid = document.createElement('div');
    colorGrid.className = 'gcf-color-grid';
    const colors = window.DEFAULT_COLORS || ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
    colors.forEach(c => {
      const sw = document.createElement('div');
      sw.className = `gcf-color-swatch ${c === selectedColor ? 'selected' : ''}`;
      sw.style.backgroundColor = c;
      sw.dataset.color = c;
      colorGrid.appendChild(sw);
    });
    colorWrap.append(colorLabel, colorGrid);

    // Icon section
    const iconWrap = document.createElement('div');
    const iconLabel = document.createElement('label');
    iconLabel.style.cssText = 'font-size: 11px; font-weight: 600; color: var(--gcf-text-secondary); text-transform: uppercase;';
    iconLabel.textContent = 'Icon';
    const iconGrid = document.createElement('div');
    iconGrid.className = 'gcf-icon-grid';
    const icons = window.DEFAULT_ICONS || ['📁', '💼', '🎓', '💻', '💡', '🔬', '🚀', '📚', '⭐', '🛠️'];
    icons.forEach(ic => {
      const sw = document.createElement('div');
      sw.className = `gcf-icon-swatch ${ic === selectedIcon ? 'selected' : ''}`;
      sw.dataset.icon = ic;
      sw.textContent = ic;
      iconGrid.appendChild(sw);
    });
    iconWrap.append(iconLabel, iconGrid);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'gcf-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'gcf-btn-secondary';
    cancelBtn.id = 'gcf-style-cancel';
    cancelBtn.textContent = 'Cancel';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'gcf-btn-primary';
    saveBtn.id = 'gcf-style-save';
    saveBtn.textContent = 'Save Changes';
    actions.append(cancelBtn, saveBtn);

    box.append(titleH3, colorWrap, iconWrap, actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    backdrop.querySelectorAll('.gcf-color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        backdrop.querySelectorAll('.gcf-color-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedColor = swatch.dataset.color;
      });
    });

    backdrop.querySelectorAll('.gcf-icon-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        backdrop.querySelectorAll('.gcf-icon-swatch').forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        selectedIcon = swatch.dataset.icon;
      });
    });

    const closeModal = () => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };

    backdrop.querySelector('#gcf-style-cancel').addEventListener('click', closeModal);
    backdrop.querySelector('#gcf-style-save').addEventListener('click', async () => {
      await storage.updateFolder(folder.id, { color: selectedColor, icon: selectedIcon });
      closeModal();
    });
  }

  // ========================================================
  // Helpers
  // ========================================================

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Kickstart
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
