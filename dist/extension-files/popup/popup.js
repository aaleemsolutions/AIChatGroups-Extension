/**
 * Gemini Chat Folders - Extension Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const storage = window.geminiStorage || new window.GeminiFolderStorage();
  await storage.init();

  // Elements
  const statFolders = document.getElementById('stat-folders');
  const statChats = document.getElementById('stat-chats');
  const syncBadge = document.getElementById('sync-status-badge');
  const searchInput = document.getElementById('popup-search');
  const btnNewFolder = document.getElementById('btn-new-folder');
  const foldersList = document.getElementById('folders-list');
  const toggleHideFiled = document.getElementById('toggle-hide-filed');
  const btnToggleAll = document.getElementById('btn-toggle-all');
  const btnExport = document.getElementById('btn-export-backup');
  const btnImport = document.getElementById('btn-import-backup');
  const fileImportInput = document.getElementById('file-import-input');
  const btnOpenGemini = document.getElementById('btn-open-gemini');

  let currentSearch = '';

  // Render full popup view
  function refreshView() {
    const state = storage.getState();

    // 1. Update stats
    statFolders.textContent = state.folderCount;
    statChats.textContent = state.chatCount;

    // 2. Sync status
    syncBadge.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'sync-dot';
    const text = document.createElement('span');
    text.className = 'sync-text';

    if (state.isSyncSupported) {
      text.textContent = 'Firefox Sync Active';
      syncBadge.append(dot, text);
      syncBadge.title = `Firefox Sync Connected • Last sync: ${new Date(state.lastSyncTime).toLocaleTimeString()}`;
    } else {
      dot.style.background = '#eab308';
      dot.style.boxShadow = '0 0 6px #eab308';
      text.style.color = '#ca8a04';
      text.textContent = 'Local Storage';
      syncBadge.append(dot, text);
      syncBadge.title = 'Storage is operating locally (Firefox Sync not configured)';
    }

    // 3. Settings toggle
    toggleHideFiled.checked = !!(state.meta.settings && state.meta.settings.hideFiledFromAll);

    // 4. Render folder items
    renderFoldersList(state);
  }

  function renderFoldersList(state) {
    foldersList.replaceChildren();

    const rootIds = state.meta.rootIds || [];
    if (rootIds.length === 0 && storage.folders.size === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.textContent = 'No folders yet. Click + New to create one!';
      foldersList.appendChild(emptyDiv);
      return;
    }

    // Render tree
    for (const folderId of rootIds) {
      const folder = storage.folders.get(folderId);
      if (folder) {
        renderFolderItem(folder, 0);
      }
    }
  }

  function renderFolderItem(folder, depth = 0) {
    const matchesSearch = !currentSearch || folder.name.toLowerCase().includes(currentSearch);
    const chats = folder.chats || [];
    const chatMatches = currentSearch && chats.some(c => c.title.toLowerCase().includes(currentSearch));

    // Check children
    const childFolders = (folder.childrenIds || [])
      .map(cid => storage.folders.get(cid))
      .filter(Boolean);

    if (currentSearch && !matchesSearch && !chatMatches && childFolders.length === 0) {
      return;
    }

    const row = document.createElement('div');
    row.className = 'folder-item';
    row.style.paddingLeft = `${depth * 14 + 10}px`;

    const left = document.createElement('div');
    left.className = 'folder-item-left';

    const iconSpan = document.createElement('span');
    iconSpan.style.color = folder.color || '#3b82f6';
    iconSpan.textContent = folder.icon || '📁';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-item-name';
    nameSpan.title = folder.name;
    nameSpan.textContent = folder.name;

    left.append(iconSpan, nameSpan);

    const right = document.createElement('div');
    right.className = 'folder-item-right';
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '6px';

    const badge = document.createElement('span');
    badge.className = 'folder-item-badge';
    badge.textContent = String(chats.length);

    const actions = document.createElement('div');
    actions.className = 'folder-item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-icon-tiny rename';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✏️';

    const subBtn = document.createElement('button');
    subBtn.className = 'btn-icon-tiny sub';
    subBtn.title = 'Add Subfolder';
    subBtn.textContent = '➕';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon-tiny delete';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '🗑️';

    actions.append(renameBtn, subBtn, deleteBtn);
    right.append(badge, actions);
    row.append(left, right);

    // Actions
    row.querySelector('.rename').addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt('Enter new folder name:', folder.name);
      if (newName && newName.trim() && newName.trim() !== folder.name) {
        storage.updateFolder(folder.id, { name: newName.trim() });
      }
    });

    row.querySelector('.sub').addEventListener('click', async (e) => {
      e.stopPropagation();
      const subName = prompt(`Enter subfolder name inside "${folder.name}":`);
      if (subName && subName.trim()) {
        await storage.createFolder({
          name: subName.trim(),
          parentId: folder.id,
          color: folder.color,
          icon: '📁'
        });
      }
    });

    row.querySelector('.delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete folder "${folder.name}"? (Chats inside will be kept)`)) {
        await storage.deleteFolder(folder.id);
      }
    });

    foldersList.appendChild(row);

    // Recursively render children
    for (const child of childFolders) {
      renderFolderItem(child, depth + 1);
    }
  }

  // Event Listeners
  searchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value.toLowerCase().trim();
    refreshView();
  });

  btnNewFolder.addEventListener('click', async () => {
    const name = prompt('Enter new folder name:');
    if (name && name.trim()) {
      await storage.createFolder({ name: name.trim() });
    }
  });

  toggleHideFiled.addEventListener('change', async (e) => {
    await storage.updateSettings({ hideFiledFromAll: e.target.checked });
  });

  let allCollapsed = false;
  btnToggleAll.addEventListener('click', async () => {
    allCollapsed = !allCollapsed;
    for (const folder of storage.folders.values()) {
      await storage.updateFolder(folder.id, { collapsed: allCollapsed });
    }
    btnToggleAll.textContent = allCollapsed ? 'Expand All' : 'Collapse All';
  });

  btnExport.addEventListener('click', () => {
    const json = storage.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-folders-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnImport.addEventListener('click', () => {
    fileImportInput.value = '';
    fileImportInput.click();
  });

  fileImportInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const resState = await storage.importData(evt.target.result);
          refreshView();

          // Broadcast refresh signal to active AI tabs
          const ext = typeof browser !== 'undefined' ? browser : chrome;
          if (ext && ext.tabs && ext.tabs.query) {
            ext.tabs.query({}, (tabs) => {
              if (tabs) {
                tabs.forEach(t => {
                  if (t.id && t.url && (t.url.includes('gemini.google.com') || t.url.includes('chatgpt.com') || t.url.includes('claude.ai'))) {
                    ext.tabs.sendMessage(t.id, { action: 'gcf_refresh' }).catch(() => {});
                  }
                });
              }
            });
          }

          alert(`✓ Restored ${resState.folderCount} folders with ${resState.chatCount} chats!`);
        } catch (err) {
          alert('Failed to import: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  });

  btnOpenGemini.addEventListener('click', () => {
    const ext = typeof browser !== 'undefined' ? browser : chrome;
    if (ext.tabs && ext.tabs.create) {
      ext.tabs.create({ url: 'https://gemini.google.com' });
    } else {
      window.open('https://gemini.google.com', '_blank');
    }
  });

  // Listen to cross-device storage changes in real-time
  storage.subscribe(() => {
    refreshView();
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  refreshView();
});
