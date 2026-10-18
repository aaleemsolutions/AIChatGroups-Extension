# 🦊 Gemini Chat Folders & Groups (Firefox Extension)

A powerful Firefox WebExtension for **Google Gemini** (`gemini.google.com`) that organizes chats into hierarchical folders and groups with **seamless multi-device sync via Firefox Sync**.

---

## ✨ Features

- 📁 **Hierarchical Folders & Subfolders**: Create multi-level nested folders to organize chats by topic (e.g. *Admissions > Germany*, *Engineering > Solar Inverters*).
- ☁️ **Multi-Device Firefox Sync**: Backed by `browser.storage.sync` to synchronize your folder structure and chat assignments across all your laptops, desktops, and mobile devices connected via Firefox Accounts.
- 🎨 **Visual Customization**: 10 curated color accents and emoji/icon pickers for every folder.
- 🗂️ **Interactive Drag & Drop**: Drag native Gemini conversations directly into any folder, or drag folders to nest and reorder.
- ⚡ **Direct Sidebar Integration**: Seamlessly integrates into Gemini's sidebar above the conversation list, adhering to Google's Material 3 design and Light/Dark themes.
- 👁️ **"Hide Filed Chats" Mode**: Declutters Gemini's flat list so the "All" section only shows unfiled conversations.
- 🔍 **Instant Search & Filter**: Rapidly filter folders and chats by title or keyword.
- 💾 **Offline Cache & Backup**: Instant loading from local mirror (`storage.local`), quota-safe chunking (<8KB per item), and one-click JSON Export & Import.

---

## 🚀 How to Install & Load in Mozilla Firefox

### Option A: Load Temporary Add-on (Recommended for Development)
1. Open **Mozilla Firefox**.
2. In the URL address bar, navigate to:
   ```
   about:debugging#/runtime/this-firefox
   ```
3. Click the **"Load Temporary Add-on..."** button.
4. Select the [`manifest.json`](manifest.json) file located at:
   ```
   C:\Users\TechShop\.gemini\antigravity-ide\scratch\gemini-chat-folders-firefox\manifest.json
   ```
5. Navigate to [gemini.google.com](https://gemini.google.com). Your sidebar will now show the **Folders & Groups** section!

### Option B: Install Packaged XPI / ZIP
Pre-built packages are generated in the `dist/` folder:
- **`dist/gemini-chat-folders.xpi`**
- **`dist/gemini-chat-folders.zip`**

To build fresh packages at any time:
```bash
npm run build
```

---

## 🧪 Testing & Verification

The extension comes with two automated test suites:
1. **Storage & Firefox Sync Engine Tests (`test/storage-sync.test.js`)**:
   - 9 automated unit tests verifying folder CRUD, nested subfolder hierarchies, chat uniqueness, data boundaries, quota compliance (<8KB per item), and real-time remote sync event propagation (`storage.onChanged`).
2. **Gemini Live DOM Integration Tests (`test/dom-integration.test.js`)**:
   - Headless DOM integration tests using the user's actual Gemini sidebar DOM structure (`bard-sidenav`, `conversations-list`, `gem-nav-list-item`).
   - Verifies `#gcf-root` mounting, button injection, folder row rendering, active chat highlight, and "Hide filed chats" filtering.

### Run Tests in Terminal:
```bash
npm test
```

### Run Interactive Test Harness in Firefox:
```bash
npm run open:test-harness
```
This opens `test/gemini-mock.html` directly in Mozilla Firefox, rendering your live sidebar and running interactive assertions.

---

## 🛠️ Architecture & Multi-Device Sync

WebExtensions `browser.storage.sync` has strict quotas:
- **Maximum per item**: 8,192 bytes (8 KB)
- **Total storage**: ~100 KB
- **Maximum items**: 512

To ensure the extension never exceeds quotas even with hundreds of chats:
- Metadata is stored in `gcf_meta` (`rootIds`, settings, `updatedAt`).
- Each folder is stored under its own key: `gcf_f_<folderId>`, containing its chats, style, and children IDs.
- A local cache mirror is kept in `browser.storage.local` (`gcf_cache_data`) for instant synchronous startup.
- `browser.storage.onChanged` automatically detects when another device updates folders via Firefox Sync and updates the DOM in real-time with zero page reload.

---

## 📂 Project Structure

```
gemini-chat-folders-firefox/
├── manifest.json              # WebExtension MV3 manifest for Firefox
├── background.js              # Event script handling install & messaging
├── storage-sync.js            # Multi-device Firefox Sync engine & storage API
├── content.js                 # Gemini sidebar DOM injector & controller
├── content.css                # Material 3 Light/Dark adaptive stylesheet
├── icons/                     # 16px, 48px, 128px PNG & SVG icons
├── popup/                     # Toolbar popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── dist/                      # Packaged .zip and .xpi files
├── test/
│   ├── storage-sync.test.js   # Unit test suite
│   ├── dom-integration.test.js# Headless DOM test suite
│   ├── gemini-mock.html       # Interactive mock Gemini sidebar
│   └── run-all-tests.js       # Master test runner
├── scripts/
│   ├── generate-icons.js      # Pixel icon generator
│   └── build-xpi.js           # Package builder
└── package.json
```

---

## 👨‍💻 Author & Support

- **Author**: Abdul Aleem
- **Contact & Support Email**: [aleemksolutions@gmail.com](mailto:aleemksolutions@gmail.com)
- **License**: MIT

