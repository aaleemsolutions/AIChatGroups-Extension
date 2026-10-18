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

  // Multi-Platform Detection (Gemini, ChatGPT, Claude)
  function getPlatform() {
    const host = (window.location.hostname || '').toLowerCase();
    if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    return 'gemini';
  }
  const currentPlatform = getPlatform();

  console.log(`[AIChatFolders] Content script loaded on: ${currentPlatform}`);

  // Reference storage engine from storage-sync.js
  const storage = window.geminiStorage || new window.GeminiFolderStorage();

  // State
  let searchQuery = '';
  let isSectionCollapsed = false;
  let activeDropdown = null;
  let currentlyDraggedFolderId = null;

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
      renderPendingFolderBanner();
      checkPendingChatAutoFile();
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
      renderPendingFolderBanner();
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
          renderPendingFolderBanner();
        }
      });
    }
  }

  function setupUrlChangeListener() {
    // Detect URL changes across Gemini, ChatGPT, and Claude SPAs
    let currentUrl = window.location.href;

    const onUrlChange = () => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        highlightActiveChat();
        checkPendingChatAutoFile();
      }
    };

    // 1. Monkey-patch pushState & replaceState for immediate SPA route tracking
    const origPushState = history.pushState;
    if (origPushState) {
      history.pushState = function (...args) {
        const res = origPushState.apply(this, args);
        onUrlChange();
        return res;
      };
    }

    const origReplaceState = history.replaceState;
    if (origReplaceState) {
      history.replaceState = function (...args) {
        const res = origReplaceState.apply(this, args);
        onUrlChange();
        return res;
      };
    }

    // 2. Popstate
    window.addEventListener('popstate', onUrlChange);

    // 3. Head / DOM MutationObserver fallback
    const urlObserver = new MutationObserver(onUrlChange);
    urlObserver.observe(document.querySelector('head') || document.documentElement, {
      subtree: true,
      childList: true
    });
  }

  function startDomObserver() {
    // Observe DOM changes in sidebar to keep folders locked strictly above native chats
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        ensureCorrectPlacement();
        scanAndEnhanceNativeChats();
        checkPendingChatAutoFile();
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
   * Reliably locates the native conversation section in the sidebar
   * across Google Gemini, ChatGPT, and Claude.
   */
  function findChatsSection() {
    // 1. ChatGPT
    if (currentPlatform === 'chatgpt') {
      const nav = document.querySelector('nav[aria-label="Chat history"]') || document.querySelector('nav');
      if (nav) {
        const firstChat = nav.querySelector('a[href*="/c/"]');
        if (firstChat) {
          const listElem = firstChat.closest('ol') || firstChat.closest('ul') || firstChat.closest('div[class*="overflow-y"]');
          if (listElem) return listElem;
        }
        const chatsContainer = nav.querySelector('.overflow-y-auto, [class*="overflow-y"]') || nav.querySelector('ol');
        if (chatsContainer) return chatsContainer;
      }
      return null;
    }

    // 2. Claude
    if (currentPlatform === 'claude') {
      const firstChat = document.querySelector('a[href*="/chat/"]');
      if (firstChat) {
        const parentContainer = firstChat.closest('div[class*="overflow-y"]') || 
                                firstChat.closest('nav') || 
                                firstChat.closest('ul') ||
                                firstChat.parentElement?.parentElement;
        if (parentContainer) return parentContainer;
      }
      const headings = document.querySelectorAll('h2, h3, div');
      for (const h of headings) {
        if (/^recent/i.test((h.textContent || '').trim()) && h.nextElementSibling) {
          return h.nextElementSibling;
        }
      }
      return null;
    }

    // 3. Google Gemini (Default)
    const chatsSection = document.querySelector('expandable-section[storagekey="chats"]') ||
                          document.querySelector('expandable-section[data-test-id="chats-expandable-section"]');
    if (chatsSection) return chatsSection;

    const convList = document.querySelector('conversations-list[data-test-id="all-conversations"]') ||
                     document.querySelector('conversations-list');
    if (convList) {
      return convList.closest('expandable-section') || convList;
    }

    const anyChat = document.querySelector('gem-nav-list-item[data-test-id="conversation"]');
    if (anyChat) {
      return anyChat.closest('expandable-section') || anyChat.closest('.chat-history') || anyChat.closest('conversations-list');
    }

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
      return { parent: chatsSection.parentNode, beforeNode: chatsSection };
    }

    // ChatGPT fallback if first conversation hasn't loaded yet
    if (currentPlatform === 'chatgpt') {
      const nav = document.querySelector('nav[aria-label="Chat history"]') || document.querySelector('nav');
      if (nav) {
        const scroller = nav.querySelector('div[class*="overflow-y"]') || nav;
        if (scroller) {
          return { parent: scroller, beforeNode: scroller.firstChild };
        }
      }
    }

    // Claude fallback
    if (currentPlatform === 'claude') {
      const nav = document.querySelector('nav') || document.querySelector('div[class*="overflow-y"]');
      if (nav) {
        return { parent: nav, beforeNode: nav.firstChild };
      }
    }

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
            <button class="gcf-icon-btn" id="gcf-btn-start-chat-header" title="Start new chat in folder">
              <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
            </button>
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

    // Start Chat in Folder header button
    const startChatHeaderBtn = container.querySelector('#gcf-btn-start-chat-header');
    if (startChatHeaderBtn) {
      startChatHeaderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showStartChatFolderMenu(startChatHeaderBtn);
      });
    }

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
   * Ensures infinite scroll fires continuously when scrolling down across Gemini, ChatGPT, and Claude
   */
  function setupInfiniteScrollWatcher() {
    const chatsSection = findChatsSection();
    if (!chatsSection) return;

    const scroller = chatsSection.closest('.side-nav-scroller, [scrollable], bard-sidenav-content, [class*="overflow-y"], nav') || chatsSection.parentElement;
    if (!scroller || scroller._gcfInfiniteWatcher) return;
    scroller._gcfInfiniteWatcher = true;

    scroller.addEventListener('scroll', () => {
      // Check if user is scrolled near bottom
      const distanceToBottom = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight);
      if (distanceToBottom < 350) {
        // Find any loading sentinel or trigger in sidebar DOM
        const sentinel = chatsSection.querySelector('.bottom-sentinel, [data-test-id="loading-indicator"], .infinite-scroll-bottom, button[data-test-id="show-more"], button[class*="show-more"]');
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
        'nav a[href*="/c/"], ' +
        'nav ol li a, ' +
        'a[href*="/chat/"]'
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

    // Attach tree-level drop target for dropping folders back to root
    if (!treeElem._dropAttached) {
      treeElem._dropAttached = true;
      treeElem.addEventListener('dragover', (e) => {
        if (currentlyDraggedFolderId && (e.target === treeElem || e.target.classList.contains('gcf-empty-state'))) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      });
      treeElem.addEventListener('drop', async (e) => {
        if (currentlyDraggedFolderId && (e.target === treeElem || e.target.classList.contains('gcf-empty-state'))) {
          e.preventDefault();
          e.stopPropagation();
          const draggedId = currentlyDraggedFolderId;
          currentlyDraggedFolderId = null;
          await storage.moveFolder(draggedId, null);
          renderFolderTree();
        }
      });
    }

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
    renderPendingFolderBanner();
  }

  function createFolderDom(folder, depth = 0) {
    const isFiltered = searchQuery.length > 0;
    
    // Filter chats strictly for the currently opened platform (Gemini, ChatGPT, or Claude)
    const platformChats = (folder.chats || []).filter(c => (c.platform || 'gemini') === currentPlatform);

    // Check if this folder or any of its children match search query
    const nameMatches = folder.name.toLowerCase().includes(searchQuery);
    const matchingChats = platformChats.filter(c => 
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

    const totalChatCount = platformChats.length;
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

    const startChatBtn = document.createElement('button');
    startChatBtn.className = 'gcf-mini-btn gcf-btn-start-chat';
    startChatBtn.title = `Start new chat in "${folder.name}"`;
    startChatBtn.textContent = '💬';

    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'gcf-mini-btn gcf-btn-add-sub';
    addSubBtn.title = 'Add Subfolder';
    addSubBtn.textContent = '➕';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'gcf-mini-btn gcf-btn-folder-menu';
    menuBtn.title = 'Folder Options';
    menuBtn.textContent = '⋮';

    hoverActions.append(startChatBtn, addSubBtn, menuBtn);
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

    // Start chat in this folder
    startChatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startChatInFolder(folder);
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

    // Append chats strictly belonging to the currently opened platform
    const chatsToRender = matchingChats;
    for (const chat of chatsToRender) {
      const chatItem = createChatItemDom(chat, folder.id);
      childrenContainer.appendChild(chatItem);
    }

    // If folder has no chats and no subfolders on this platform, show friendly drop zone with start chat link
    if (childNodes.length === 0 && chatsToRender.length === 0) {
      const emptyZone = document.createElement('div');
      emptyZone.className = 'gcf-folder-empty-zone';
      emptyZone.style.pointerEvents = 'auto';

      const dropSpan = document.createElement('span');
      dropSpan.textContent = '📥 Drop chats or ';

      const startLink = document.createElement('span');
      startLink.className = 'gcf-empty-start-link';
      startLink.textContent = '+ Start Chat';
      startLink.title = `Start a new conversation in "${folder.name}"`;
      startLink.addEventListener('click', (e) => {
        e.stopPropagation();
        startChatInFolder(folder);
      });

      emptyZone.append(dropSpan, startLink);
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

    const chatPlatform = chat.platform || 'gemini';

    // Check if current page is this chat
    const currentPath = window.location.pathname;
    if (chatPlatform === currentPlatform && currentPath.includes(chat.id)) {
      item.classList.add('gcf-active-chat');
    }

    const defaultUrl = chatPlatform === 'chatgpt' ? `/c/${chat.id}` :
                       chatPlatform === 'claude' ? `/chat/${chat.id}` :
                       `/app/${chat.id}`;
    const chatUrl = chat.url || defaultUrl;

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
    unfileBtn.type = 'button';
    unfileBtn.className = 'gcf-mini-btn gcf-chat-unfile';
    unfileBtn.title = 'Remove from folder (keep in history)';
    unfileBtn.textContent = '✕';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'gcf-mini-btn gcf-chat-delete';
    deleteBtn.title = 'Permanently delete conversation';
    deleteBtn.textContent = '🗑️';

    // Prevent dragging or parent click when clicking buttons
    unfileBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    unfileBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    deleteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Unfile button event listener
    unfileBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await storage.removeChatFromFolder(folderId, chat.id, chatPlatform);
    });

    // Permanent delete event listener
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await deleteChatPermanently(chat.id, chat.title, folderId, chatPlatform);
    });

    actions.append(unfileBtn, deleteBtn);
    item.append(link, actions);

    link.addEventListener('click', (e) => {
      // Allow user to open in new tab with Cmd/Ctrl or middle click
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      navigateToChat(chat.id, chatUrl, chatPlatform);
    });

    // Drag chat item
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'gcf-chat',
        chatId: chat.id,
        title: chat.title,
        url: chat.url,
        platform: chatPlatform,
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
   * Seamlessly navigates to a conversation across Gemini, ChatGPT, and Claude.
   * If chat belongs to a different platform, opens in that platform.
   */
  function navigateToChat(chatId, chatUrl, chatPlatform = null) {
    const targetPlatform = chatPlatform || currentPlatform;

    // Cross-platform jump: open in target platform
    if (targetPlatform !== currentPlatform) {
      let externalUrl = chatUrl;
      if (!externalUrl || !externalUrl.startsWith('http')) {
        if (targetPlatform === 'chatgpt') externalUrl = `https://chatgpt.com/c/${chatId}`;
        else if (targetPlatform === 'claude') externalUrl = `https://claude.ai/chat/${chatId}`;
        else externalUrl = `https://gemini.google.com/app/${chatId}`;
      }
      window.open(externalUrl, '_blank');
      return;
    }

    const cleanId = (chatId || '').replace(/^.*\/(app|c|chat)\//, '').replace(/[?#].*$/, '').trim();
    const defaultLocalUrl = currentPlatform === 'chatgpt' ? `/c/${cleanId}` :
                           currentPlatform === 'claude' ? `/chat/${cleanId}` :
                           `/app/${cleanId}`;
    const targetUrl = chatUrl || (cleanId ? defaultLocalUrl : '/');

    console.log(`[AIChatFolders] Navigating to ${currentPlatform} chat ${cleanId}...`);

    // 1. Look for native conversation link in DOM
    const nativeLink = findNativeChatLink(cleanId);
    if (nativeLink) {
      if (typeof nativeLink.scrollIntoView === 'function') {
        nativeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
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

    // 2. Expand collapsed section if on Gemini
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

    // 3. Fallback: History API
    try {
      const targetPath = targetUrl.startsWith('http') ? new URL(targetUrl).pathname : targetUrl;
      if (window.location.pathname !== targetPath) {
        history.pushState({ gcfNav: true, id: cleanId }, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate', { state: { gcfNav: true, id: cleanId } }));
      }
      highlightActiveChat(cleanId);
    } catch (err) {
      window.location.href = targetUrl;
    }
  }

  function findNativeChatLink(cleanId) {
    if (!cleanId) return null;
    const candidates = document.querySelectorAll(
      'gem-nav-list-item[data-test-id="conversation"] a, ' +
      'conversations-list a, ' +
      'bard-sidenav a[href*="/app/"], ' +
      'nav a[href*="/c/"], ' +
      'ol li a[href*="/c/"], ' +
      'a[href*="/chat/"]'
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
    let dropPosition = 'inside'; // 'before' | 'after' | 'inside'

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

      if (currentlyDraggedFolderId) {
        if (currentlyDraggedFolderId === folderId) {
          folderRow.classList.remove('gcf-drop-before', 'gcf-drop-after', 'gcf-drag-over');
          return;
        }

        const rect = headerElem.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const height = rect.height || 36;

        folderRow.classList.remove('gcf-drop-before', 'gcf-drop-after', 'gcf-drag-over');

        if (relY <= height * 0.35) {
          dropPosition = 'before';
          folderRow.classList.add('gcf-drop-before');
        } else if (relY >= height * 0.65) {
          dropPosition = 'after';
          folderRow.classList.add('gcf-drop-after');
        } else {
          dropPosition = 'inside';
          folderRow.classList.add('gcf-drag-over');
        }
      } else {
        dropPosition = 'inside';
        folderRow.classList.add('gcf-drag-over');

        // Auto-expand closed folder after hovering for 550ms
        if (folder.collapsed && !hoverExpandTimer) {
          hoverExpandTimer = setTimeout(() => {
            folder.collapsed = false;
            folderRow.classList.remove('is-collapsed');
            storage.updateFolder(folder.id, { collapsed: false });
          }, 550);
        }
      }
    };

    const handleDragEnter = (e) => {
      if (!isEventForThisFolder(e)) return;
      dragEnterCount++;
    };

    const handleDragLeave = (e) => {
      if (!isEventForThisFolder(e)) return;
      dragEnterCount--;
      if (dragEnterCount <= 0) {
        dragEnterCount = 0;
        folderRow.classList.remove('gcf-drag-over', 'gcf-drop-before', 'gcf-drop-after');
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
      const position = dropPosition;
      folderRow.classList.remove('gcf-drag-over', 'gcf-drop-before', 'gcf-drop-after');

      try {
        const rawData = e.dataTransfer.getData('text/plain');
        if (!rawData) return;
        const data = JSON.parse(rawData);

        if (data.type === 'gcf-chat' || data.type === 'gemini-native-chat') {
          // Chat dropped anywhere into this folder's area
          await storage.addChatToFolder(folderId, {
            id: data.chatId || data.id,
            title: data.title,
            url: data.url,
            platform: data.platform || currentPlatform
          });
          console.log(`[AIChatFolders] Dropped chat "${data.title}" into folder "${folder.name}"`);
        } else if (data.type === 'gcf-folder' && data.folderId !== folderId) {
          if (position === 'before') {
            await storage.reorderFolder(data.folderId, folderId, 'before');
          } else if (position === 'after') {
            await storage.reorderFolder(data.folderId, folderId, 'after');
          } else {
            // Folder dropped directly into this folder as a subfolder
            await storage.moveFolder(data.folderId, folderId);
          }
          renderFolderTree();
        }
      } catch (err) {
        console.warn('[AIChatFolders] Drop error:', err);
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
      currentlyDraggedFolderId = folderId;
      folderRow.classList.add('gcf-dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'gcf-folder',
        folderId: folderId
      }));
      e.dataTransfer.effectAllowed = 'move';
    });

    folderRow.addEventListener('dragend', () => {
      currentlyDraggedFolderId = null;
      folderRow.classList.remove('gcf-dragging');
      document.querySelectorAll('.gcf-drop-before, .gcf-drop-after, .gcf-drag-over').forEach(el => {
        el.classList.remove('gcf-drop-before', 'gcf-drop-after', 'gcf-drag-over');
      });
    });
  }

  // ========================================================
  // Native AI Chats Integration (Gemini, ChatGPT, Claude)
  // ========================================================

  function scanAndEnhanceNativeChats() {
    if (currentPlatform === 'chatgpt') {
      scanChatGPTChats();
    } else if (currentPlatform === 'claude') {
      scanClaudeChats();
    } else {
      scanGeminiChats();
    }
  }

  function scanGeminiChats() {
    // Select all conversation items in Gemini's sidebar
    const chatItems = document.querySelectorAll('gem-nav-list-item[data-test-id="conversation"]') ||
                      document.querySelectorAll('conversations-list gem-nav-list-item');

    const hideFiled = storage.meta.settings && storage.meta.settings.hideFiledFromAll;

    chatItems.forEach(item => {
      const link = item.querySelector('a[href*="/app/"]');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/app\/([a-zA-Z0-9_\-]+)/);
      if (!match) return;

      const chatId = match[1];
      const titleElem = item.querySelector('.title-text') || link;
      const title = (titleElem.textContent || link.getAttribute('aria-label') || 'Gemini Conversation').trim();

      // Check if chat is filed in any folder
      const filedFolder = storage.getChatFolder(chatId, 'gemini');

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
            type: 'gcf-chat',
            chatId: chatId,
            id: chatId,
            title: title,
            url: href,
            platform: 'gemini'
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
          showChatFolderPicker(chatId, title, href, folderBtn, 'gemini');
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

  function scanChatGPTChats() {
    const links = document.querySelectorAll('nav a[href*="/c/"], nav ol li a[href*="/c/"]');
    const hideFiled = storage.meta.settings && storage.meta.settings.hideFiledFromAll;

    links.forEach(link => {
      if (link.closest('#gcf-root')) return;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/c\/([a-zA-Z0-9_\-]+)/);
      if (!match) return;

      const chatId = match[1];
      const row = link.closest('li') || link.parentElement || link;
      const textElem = link.querySelector('div') || link;
      const title = (textElem.textContent || link.getAttribute('aria-label') || 'ChatGPT Conversation').trim();

      const filedFolder = storage.getChatFolder(chatId, 'chatgpt');

      if (hideFiled && filedFolder) {
        row.classList.add('gcf-filed-hidden');
      } else {
        row.classList.remove('gcf-filed-hidden');
      }

      if (!row.dataset.gcfDraggable) {
        row.dataset.gcfDraggable = 'true';
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'gcf-chat',
            chatId: chatId,
            id: chatId,
            title: title,
            url: href,
            platform: 'chatgpt'
          }));
          e.dataTransfer.effectAllowed = 'move';
        });
      }

      let folderBtn = row.querySelector('.gcf-injected-folder-btn');
      if (!folderBtn) {
        folderBtn = document.createElement('button');
        folderBtn.type = 'button';
        folderBtn.className = `gcf-injected-folder-btn ${filedFolder ? 'is-filed' : ''}`;
        folderBtn.title = filedFolder ? `Filed in: ${filedFolder.name} (Click to change)` : 'Add to Folder';
        folderBtn.textContent = filedFolder ? (filedFolder.icon || '📁') : '📁';

        folderBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          showChatFolderPicker(chatId, title, href, folderBtn, 'chatgpt');
        });

        const menuBtn = row.querySelector('button[aria-haspopup="menu"], button[data-testid*="menu"], button[id*="radix"]');
        if (menuBtn && menuBtn.parentNode) {
          menuBtn.parentNode.insertBefore(folderBtn, menuBtn);
        } else if (link.nextElementSibling) {
          link.parentNode.insertBefore(folderBtn, link.nextElementSibling);
        } else {
          row.appendChild(folderBtn);
        }
      } else {
        folderBtn.className = `gcf-injected-folder-btn ${filedFolder ? 'is-filed' : ''}`;
        folderBtn.title = filedFolder ? `Filed in: ${filedFolder.name} (Click to change)` : 'Add to Folder';
        folderBtn.textContent = filedFolder ? (filedFolder.icon || '📁') : '📁';
      }
    });
  }

  function scanClaudeChats() {
    const links = document.querySelectorAll('a[href*="/chat/"]');
    const hideFiled = storage.meta.settings && storage.meta.settings.hideFiledFromAll;

    links.forEach(link => {
      if (link.closest('#gcf-root')) return;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/chat\/([a-zA-Z0-9_\-]+)/);
      if (!match) return;

      const chatId = match[1];
      const row = link.closest('li') || link.closest('div[class*="group"]') || link.parentElement || link;
      const title = (link.textContent || 'Claude Conversation').trim();

      const filedFolder = storage.getChatFolder(chatId, 'claude');

      if (hideFiled && filedFolder) {
        row.classList.add('gcf-filed-hidden');
      } else {
        row.classList.remove('gcf-filed-hidden');
      }

      if (!row.dataset.gcfDraggable) {
        row.dataset.gcfDraggable = 'true';
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'gcf-chat',
            chatId: chatId,
            id: chatId,
            title: title,
            url: href,
            platform: 'claude'
          }));
          e.dataTransfer.effectAllowed = 'move';
        });
      }

      let folderBtn = row.querySelector('.gcf-injected-folder-btn');
      if (!folderBtn) {
        folderBtn = document.createElement('button');
        folderBtn.type = 'button';
        folderBtn.className = `gcf-injected-folder-btn ${filedFolder ? 'is-filed' : ''}`;
        folderBtn.title = filedFolder ? `Filed in: ${filedFolder.name} (Click to change)` : 'Add to Folder';
        folderBtn.textContent = filedFolder ? (filedFolder.icon || '📁') : '📁';

        folderBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          showChatFolderPicker(chatId, title, href, folderBtn, 'claude');
        });

        const menuBtn = row.querySelector('button[aria-label*="More"], button[aria-haspopup="menu"], button svg');
        if (menuBtn && menuBtn.closest('button') && menuBtn.closest('button').parentNode) {
          const btn = menuBtn.closest('button');
          btn.parentNode.insertBefore(folderBtn, btn);
        } else {
          row.appendChild(folderBtn);
        }
      } else {
        folderBtn.className = `gcf-injected-folder-btn ${filedFolder ? 'is-filed' : ''}`;
        folderBtn.title = filedFolder ? `Filed in: ${filedFolder.name} (Click to change)` : 'Add to Folder';
        folderBtn.textContent = filedFolder ? (filedFolder.icon || '📁') : '📁';
      }
    });
  }

  function highlightActiveChat(activeId = null) {
    let currentId = activeId;
    if (!currentId) {
      const match = window.location.pathname.match(/\/(app|c|chat)\/([a-zA-Z0-9_\-]+)/);
      if (match) currentId = match[2];
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
   * Popup picker to assign a chat to any folder (Hierarchical tree + instant search)
   */
  function showChatFolderPicker(chatId, title, url, anchorElem, chatPlatform = null) {
    const plat = chatPlatform || currentPlatform;
    closeActiveDropdown();

    const rect = anchorElem.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'gcf-dropdown-menu';
    dropdown.style.width = '240px';
    dropdown.style.top = `${Math.min(window.innerHeight - 340, rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, rect.left - 110))}px`;

    const currentFolder = storage.getChatFolder(chatId, plat);

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
        await storage.removeChatFromFolder(currentFolder.id, chatId, plat);
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
          await storage.addChatToFolder(folder.id, { id: chatId, title, url, platform: plat });
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
      showCreateFolderModal(null, null, { id: chatId, title, url, platform: plat });
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
    dropdown.style.top = `${Math.min(window.innerHeight - 340, rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.min(window.innerWidth - 220, rect.left - 120)}px`;

    const headerTitle = document.createElement('div');
    headerTitle.className = 'gcf-menu-header';
    headerTitle.textContent = folder.name;
    dropdown.appendChild(headerTitle);

    function createMenuItem(id, icon, text, isDanger = false, isDisabled = false) {
      const item = document.createElement('div');
      item.className = `gcf-menu-item${isDanger ? ' danger' : ''}${isDisabled ? ' disabled' : ''}`;
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

    const isRoot = !folder.parentId;
    const siblings = isRoot 
      ? (storage.meta.rootIds || []) 
      : (storage.folders.get(folder.parentId)?.childrenIds || []);
    const idx = siblings.indexOf(folder.id);
    const canMoveUp = idx > 0;
    const canMoveDown = idx >= 0 && idx < siblings.length - 1;

    dropdown.append(
      createMenuItem('gcf-act-new-chat', '💬', 'Start Chat in this Folder'),
      divider(),
      createMenuItem('gcf-act-move-up', '⬆️', 'Move Up', false, !canMoveUp),
      createMenuItem('gcf-act-move-down', '⬇️', 'Move Down', false, !canMoveDown),
      ...(!isRoot ? [createMenuItem('gcf-act-move-root', '📂', 'Move to Root Level')] : []),
      divider(),
      createMenuItem('gcf-act-subfolder', '➕', 'Add Subfolder'),
      createMenuItem('gcf-act-rename', '✏️', 'Rename Folder'),
      createMenuItem('gcf-act-style', '🎨', 'Change Color & Icon'),
      divider(),
      createMenuItem('gcf-act-delete', '🗑️', 'Delete Folder', true)
    );

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;

    dropdown.querySelector('#gcf-act-new-chat').addEventListener('click', () => {
      closeActiveDropdown();
      startChatInFolder(folder);
    });

    if (canMoveUp) {
      dropdown.querySelector('#gcf-act-move-up').addEventListener('click', async () => {
        closeActiveDropdown();
        await storage.moveFolderStep(folder.id, 'up');
      });
    }

    if (canMoveDown) {
      dropdown.querySelector('#gcf-act-move-down').addEventListener('click', async () => {
        closeActiveDropdown();
        await storage.moveFolderStep(folder.id, 'down');
      });
    }

    if (!isRoot) {
      dropdown.querySelector('#gcf-act-move-root')?.addEventListener('click', async () => {
        closeActiveDropdown();
        await storage.moveFolder(folder.id, null);
      });
    }

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

  function showCreateFolderModal(parentId = null, parentName = null, chatToAssign = null, onCreatedCallback = null) {
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

      if (typeof onCreatedCallback === 'function' && newFolder) {
        await onCreatedCallback(newFolder);
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
  // Direct "Start Chat in Folder" & Auto-Filing Engine
  // ========================================================

  function getPendingFolderTarget() {
    try {
      const raw = sessionStorage.getItem('gcf_pending_chat_folder');
      if (!raw) return null;
      const target = JSON.parse(raw);
      // Valid for 20 minutes
      if (!target || !target.folderId || (Date.now() - (target.startedAt || 0) > 20 * 60 * 1000)) {
        sessionStorage.removeItem('gcf_pending_chat_folder');
        return null;
      }
      return target;
    } catch (e) {
      return null;
    }
  }

  function setPendingFolderTarget(folder) {
    const target = {
      folderId: folder.id,
      folderName: folder.name,
      folderIcon: folder.icon || '📁',
      folderColor: folder.color || '#3b82f6',
      platform: currentPlatform,
      startedAt: Date.now()
    };
    try {
      sessionStorage.setItem('gcf_pending_chat_folder', JSON.stringify(target));
    } catch (e) {}
    renderPendingFolderBanner();
  }

  function clearPendingFolderTarget() {
    try {
      sessionStorage.removeItem('gcf_pending_chat_folder');
    } catch (e) {}
    renderPendingFolderBanner();
  }

  function renderPendingFolderBanner() {
    const root = document.getElementById('gcf-root');
    if (!root) return;
    const foldersContainer = root.querySelector('#gcf-folders-container');
    if (!foldersContainer) return;

    let banner = root.querySelector('#gcf-pending-banner');
    const target = getPendingFolderTarget();

    if (!target) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'gcf-pending-banner';
      banner.className = 'gcf-pending-banner';
      const foldersTree = foldersContainer.querySelector('#gcf-folders-tree');
      if (foldersTree) {
        foldersContainer.insertBefore(banner, foldersTree);
      } else {
        foldersContainer.appendChild(banner);
      }
    }

    banner.innerHTML = `
      <div class="gcf-pending-info">
        <span class="gcf-pending-dot"></span>
        <span class="gcf-pending-text">Next chat → <strong>${escapeHtml(target.folderName)}</strong></span>
      </div>
      <button class="gcf-pending-cancel" id="gcf-pending-cancel-btn" title="Cancel auto-filing">✕</button>
    `;

    const cancelBtn = banner.querySelector('#gcf-pending-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPendingFolderTarget();
      });
    }
  }

  function startChatInFolder(folder) {
    if (!folder) return;
    setPendingFolderTarget(folder);
    triggerNewChat();
    // Open folder if collapsed so user sees where it will be placed
    if (folder.collapsed) {
      folder.collapsed = false;
      storage.updateFolder(folder.id, { collapsed: false });
      renderFolderTree();
    }
    showToast(`💬 Starting chat in "${folder.name}". Next conversation will be auto-filed!`);
  }

  function dispatchClick(elem) {
    if (!elem) return;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
      elem.dispatchEvent(new MouseEvent(evtType, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0
      }));
    });
    if (typeof elem.click === 'function') {
      elem.click();
    }
  }

  function findGeminiNewChatButton() {
    return document.querySelector(
      'a[href="/app"], ' +
      'a[href="https://gemini.google.com/app"], ' +
      '[data-test-id="new-chat-button"], ' +
      'button[aria-label*="New chat" i], ' +
      'a[aria-label*="New chat" i], ' +
      '[role="button"][aria-label*="New chat" i], ' +
      'side-nav-action-button a, ' +
      'side-nav-action-button button, ' +
      '.chat-history-new-chat, ' +
      'button.new-chat'
    );
  }

  function triggerNewChat() {
    if (currentPlatform === 'chatgpt') {
      const btn = document.querySelector('nav a[href="/"], [data-testid="create-chat-button"], button[aria-label="New chat"], a[aria-label="New chat"]');
      if (btn) {
        dispatchClick(btn);
      }
      setTimeout(() => {
        if (window.location.pathname !== '/' && window.location.pathname !== '') {
          window.location.href = 'https://chatgpt.com/';
        } else {
          focusChatInput();
        }
      }, 120);
    } else if (currentPlatform === 'claude') {
      const btn = document.querySelector('a[href="/new"], a[href*="/new"], button[aria-label="Start new chat"]');
      if (btn) {
        dispatchClick(btn);
      }
      setTimeout(() => {
        if (!window.location.pathname.includes('/new')) {
          window.location.href = 'https://claude.ai/new';
        } else {
          focusChatInput();
        }
      }, 120);
    } else {
      // Google Gemini
      const nativeBtn = findGeminiNewChatButton();
      if (nativeBtn) {
        dispatchClick(nativeBtn);
      }

      // Check if we are already on /app
      setTimeout(() => {
        const isAlreadyNewChat = window.location.pathname === '/app' || window.location.pathname === '/app/';
        if (!isAlreadyNewChat) {
          console.log('[AIChatFolders] Redirecting to https://gemini.google.com/app for fresh session...');
          window.location.href = 'https://gemini.google.com/app';
        } else {
          focusChatInput();
        }
      }, 100);
    }

    setTimeout(() => {
      focusChatInput();
    }, 150);
  }

  async function deleteChatPermanently(chatId, chatTitle, folderId, platform) {
    if (!chatId) return;
    const isCurrentChat = !!(chatId && window.location.pathname.includes(chatId));

    if (!confirm(`Permanently delete conversation "${chatTitle || 'Conversation'}"? This action cannot be undone.`)) {
      return;
    }

    try {
      // 1. Trigger native deletion on the AI platform
      await triggerNativeChatDeletion(chatId, platform);

      // 2. Remove from folder in storage
      await storage.removeChatFromFolder(folderId, chatId, platform);

      showToast(`✓ Conversation "${chatTitle || 'Chat'}" deleted`);

      // 3. Update folder tree and sidebar immediately
      renderFolderTree();
      scanAndEnhanceNativeChats();

      // 4. If currently viewing this chat, transition cleanly without reloading the page!
      if (isCurrentChat) {
        setTimeout(() => {
          // If the platform hasn't already switched away from this deleted chat URL:
          if (window.location.pathname.includes(chatId)) {
            if (platform === 'gemini') {
              const newChatBtn = findGeminiNewChatButton();
              if (newChatBtn) {
                dispatchClick(newChatBtn);
              } else {
                history.pushState(null, '', '/app');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
            } else if (platform === 'chatgpt') {
              const newChatBtn = document.querySelector('nav a[href="/"], [data-testid="create-chat-button"]');
              if (newChatBtn) {
                dispatchClick(newChatBtn);
              } else {
                history.pushState(null, '', '/');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
            } else if (platform === 'claude') {
              const newChatBtn = document.querySelector('a[href="/new"]');
              if (newChatBtn) {
                dispatchClick(newChatBtn);
              } else {
                history.pushState(null, '', '/new');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
            }
          }
          focusChatInput();
        }, 250);
      }
    } catch (err) {
      console.warn('[AIChatFolders] Error during chat deletion:', err);
      await storage.removeChatFromFolder(folderId, chatId, platform);
      renderFolderTree();
      scanAndEnhanceNativeChats();
    }
  }

  async function triggerNativeChatDeletion(chatId, platform) {
    if (platform === 'gemini') {
      // 1. Locate native chat link
      const nativeLink = findNativeChatLink(chatId);
      let menuTrigger = null;

      if (nativeLink) {
        const row = nativeLink.closest('gem-nav-list-item[data-test-id="conversation"]') || 
                    nativeLink.closest('gem-nav-list-item') || 
                    nativeLink.parentElement;
        if (row) {
          ['mouseenter', 'mouseover'].forEach(evtType => {
            row.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true }));
          });
          menuTrigger = row.querySelector('[data-test-id="conversation-actions-menu"], button[aria-label*="More" i], button[aria-label*="action" i], button[aria-haspopup="menu"], .hovered-trailing-content button:not(.gcf-injected-folder-btn)');
        }
      }

      // If not in sidebar row, check top bar / chat header (if viewing active conversation)
      if (!menuTrigger && chatId && window.location.pathname.includes(chatId)) {
        menuTrigger = document.querySelector('[data-test-id="conversation-actions-menu"], button[aria-label*="Conversation actions" i], header button[aria-label*="More" i]');
      }

      if (menuTrigger) {
        dispatchClick(menuTrigger);
        await new Promise(r => setTimeout(r, 180));

        // 2. Click Gemini's delete button (data-test-id="delete-button")
        const deleteMenuItem = document.querySelector('button[data-test-id="delete-button"], [role="menuitem"][data-test-id="delete-button"], [role="menuitem"]:has(gem-icon[fonticonname="delete"])');
        if (deleteMenuItem) {
          dispatchClick(deleteMenuItem);
          await new Promise(r => setTimeout(r, 220));

          // 3. Confirm in Gemini's confirmation dialog (data-test-id="confirm-button")
          const confirmBtn = document.querySelector(
            'mat-dialog-container button[data-test-id="confirm-button"], ' +
            'mat-dialog-container [data-test-id="confirm-button"], ' +
            'mat-dialog-actions button:last-child, ' +
            '[role="dialog"] button[data-test-id="confirm-button"]'
          );
          if (confirmBtn) {
            dispatchClick(confirmBtn);
            await new Promise(r => setTimeout(r, 150));
          }
        }
      }
    } else if (platform === 'chatgpt') {
      const nativeLink = findNativeChatLink(chatId);
      if (nativeLink) {
        const row = nativeLink.closest('li') || nativeLink.parentElement;
        if (row) {
          ['mouseenter', 'mouseover'].forEach(evtType => {
            row.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true }));
          });
        }
        const moreBtn = row ? row.querySelector('button[id*="radix"], button[aria-haspopup="menu"]') : null;
        if (moreBtn) {
          dispatchClick(moreBtn);
          await new Promise(r => setTimeout(r, 150));
          const deleteItem = document.querySelector('[role="menuitem"][data-testid*="delete"], [role="menuitem"]:has(svg)');
          if (deleteItem) {
            dispatchClick(deleteItem);
            await new Promise(r => setTimeout(r, 180));
            const confirmBtn = document.querySelector('button[class*="btn-danger"], [role="dialog"] button:last-child');
            if (confirmBtn) {
              dispatchClick(confirmBtn);
              await new Promise(r => setTimeout(r, 150));
            }
          }
        }
      }
    } else if (platform === 'claude') {
      const nativeLink = findNativeChatLink(chatId);
      if (nativeLink) {
        const row = nativeLink.closest('li') || nativeLink.closest('div[class*="group"]');
        if (row) {
          ['mouseenter', 'mouseover'].forEach(evtType => {
            row.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true }));
          });
        }
        const moreBtn = row ? row.querySelector('button[aria-label*="More" i], button[aria-haspopup="menu"]') : null;
        if (moreBtn) {
          dispatchClick(moreBtn);
          await new Promise(r => setTimeout(r, 150));
          const deleteItem = document.querySelector('[role="menuitem"]:last-child, button[role="menuitem"]');
          if (deleteItem) {
            dispatchClick(deleteItem);
            await new Promise(r => setTimeout(r, 180));
            const confirmBtn = document.querySelector('[role="dialog"] button:last-child');
            if (confirmBtn) {
              dispatchClick(confirmBtn);
              await new Promise(r => setTimeout(r, 150));
            }
          }
        }
      }
    }
  }

  function focusChatInput() {
    let input = null;
    if (currentPlatform === 'chatgpt') {
      input = document.querySelector('#prompt-textarea, textarea[data-id="root"], textarea');
    } else if (currentPlatform === 'claude') {
      input = document.querySelector('fieldset [contenteditable="true"], div[contenteditable="true"], textarea');
    } else {
      input = document.querySelector('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea');
    }
    if (input) {
      input.focus();
    }
  }

  let isAutoFiling = false;
  async function checkPendingChatAutoFile() {
    const target = getPendingFolderTarget();
    if (!target || isAutoFiling) return;

    const pathname = window.location.pathname;
    const match = pathname.match(/\/(app|c|chat)\/([a-zA-Z0-9_\-]+)/);
    if (!match) return;

    const chatId = match[2];
    if (!chatId || chatId === 'app' || chatId === 'new') return;

    // Check if chat is already filed
    const existingFolder = storage.getChatFolder(chatId, target.platform);
    if (existingFolder) {
      if (existingFolder.id === target.folderId) {
        clearPendingFolderTarget();
      }
      return;
    }

    isAutoFiling = true;
    try {
      let title = '';
      const candidateLink = findNativeChatLink(chatId);
      if (candidateLink) {
        title = (candidateLink.textContent || '').replace(/[📁✓⋮]/g, '').trim();
      }
      if (!title || title === 'Conversation' || title === 'New chat') {
        const docTitle = (document.title || '').replace(/ - (Gemini|ChatGPT|Claude)$/i, '').trim();
        if (docTitle && !/^(Gemini|ChatGPT|Claude|New chat)$/i.test(docTitle)) {
          title = docTitle;
        } else {
          title = 'New Conversation';
        }
      }

      console.log(`[AIChatFolders] Auto-filing new chat ${chatId} ("${title}") into folder "${target.folderName}"`);

      await storage.addChatToFolder(target.folderId, {
        id: chatId,
        title: title,
        url: pathname,
        platform: target.platform
      });

      showToast(`✓ Chat filed into "${target.folderName}"!`);
      clearPendingFolderTarget();
      renderFolderTree();
      scanAndEnhanceNativeChats();

      // Poll for refined title as AI generates it in sidebar
      refineChatTitleWhenReady(target.folderId, chatId, target.platform);
    } catch (err) {
      console.warn('[AIChatFolders] Error auto-filing chat:', err);
    } finally {
      isAutoFiling = false;
    }
  }

  function refineChatTitleWhenReady(folderId, chatId, platform) {
    let attempts = 0;
    const maxAttempts = 8;
    const interval = setInterval(async () => {
      attempts++;
      const nativeLink = findNativeChatLink(chatId);
      if (nativeLink) {
        const cleanTitle = (nativeLink.textContent || '').replace(/[📁✓⋮]/g, '').trim();
        if (cleanTitle && cleanTitle !== 'New chat' && cleanTitle !== 'Conversation' && cleanTitle !== 'New Conversation' && cleanTitle.length > 2) {
          const folder = storage.folders.get(folderId);
          if (folder && folder.chats) {
            const chat = folder.chats.find(c => c.id === chatId && (c.platform || 'gemini') === platform);
            if (chat && chat.title !== cleanTitle) {
              chat.title = cleanTitle;
              await storage._saveFolder(folder);
              renderFolderTree();
            }
          }
          clearInterval(interval);
          return;
        }
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 2500);
  }

  function showToast(message) {
    let toast = document.getElementById('gcf-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'gcf-toast';
      toast.className = 'gcf-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  function showStartChatFolderMenu(anchorElem) {
    closeActiveDropdown();

    const rect = anchorElem.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'gcf-dropdown-menu';
    dropdown.style.width = '230px';
    dropdown.style.top = `${Math.min(window.innerHeight - 300, rect.bottom + 4)}px`;
    dropdown.style.left = `${Math.min(window.innerWidth - 250, Math.max(10, rect.left - 160))}px`;

    const headerTitle = document.createElement('div');
    headerTitle.className = 'gcf-menu-header';
    headerTitle.textContent = 'Start Chat in Folder';
    dropdown.appendChild(headerTitle);

    const pending = getPendingFolderTarget();
    if (pending) {
      const activeItem = document.createElement('div');
      activeItem.className = 'gcf-menu-item active';
      activeItem.style.color = 'var(--gcf-accent)';
      activeItem.innerHTML = `<span>🎯</span><span>Target: <strong>${escapeHtml(pending.folderName)}</strong></span>`;
      dropdown.appendChild(activeItem);

      const cancelItem = document.createElement('div');
      cancelItem.className = 'gcf-menu-item danger';
      cancelItem.innerHTML = `<span>✕</span><span>Cancel Auto-File</span>`;
      cancelItem.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPendingFolderTarget();
        closeActiveDropdown();
      });
      dropdown.appendChild(cancelItem);

      const div = document.createElement('div');
      div.className = 'gcf-menu-divider';
      dropdown.appendChild(div);
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'gcf-picker-list';
    listContainer.style.maxHeight = '220px';

    if (storage.folders.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'gcf-menu-item';
      empty.style.color = 'var(--gcf-text-secondary)';
      empty.style.cursor = 'default';
      empty.textContent = 'No folders created yet';
      listContainer.appendChild(empty);
    } else {
      const rootIds = storage.meta.rootIds || [];
      function walk(folderId, depth = 0) {
        const folder = storage.folders.get(folderId);
        if (!folder) return;

        const item = document.createElement('div');
        item.className = 'gcf-menu-item';
        if (depth > 0) item.style.paddingLeft = `${10 + depth * 14}px`;

        const iconSpan = document.createElement('span');
        iconSpan.textContent = folder.icon || '📁';
        if (folder.color) iconSpan.style.color = folder.color;

        const nameSpan = document.createElement('span');
        nameSpan.style.flex = '1';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.textContent = folder.name;

        item.append(iconSpan, nameSpan);
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          closeActiveDropdown();
          startChatInFolder(folder);
        });

        listContainer.appendChild(item);

        if (folder.childrenIds) {
          for (const cid of folder.childrenIds) {
            walk(cid, depth + 1);
          }
        }
      }

      for (const rid of rootIds) walk(rid, 0);
      for (const [id, f] of storage.folders.entries()) {
        if (!f.parentId && !rootIds.includes(id)) walk(id, 0);
      }
    }

    dropdown.appendChild(listContainer);

    const div2 = document.createElement('div');
    div2.className = 'gcf-menu-divider';
    dropdown.appendChild(div2);

    const newFolderItem = document.createElement('div');
    newFolderItem.className = 'gcf-menu-item';
    newFolderItem.innerHTML = '<span>➕</span><span>New Folder & Start Chat...</span>';
    newFolderItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      showCreateFolderAndStartChatModal();
    });
    dropdown.appendChild(newFolderItem);

    document.body.appendChild(dropdown);
    activeDropdown = dropdown;
  }

  function showCreateFolderAndStartChatModal() {
    showCreateFolderModal(null, null, null, (createdFolder) => {
      if (createdFolder) {
        startChatInFolder(createdFolder);
      }
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
