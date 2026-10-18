# 📁 AI Chat Folders & Groups (Chrome & Firefox Extension)

A powerful WebExtension for **Google Gemini** (`gemini.google.com`), **ChatGPT** (`chatgpt.com`), and **Claude** (`claude.ai`) that organizes chats into hierarchical folders and groups with **real-time multi-device and cross-browser sync**.

---

## ✨ Features

- 📁 **Hierarchical Folders & Subfolders**: Create multi-level nested folders to organize chats by topic (e.g. *Admissions > Germany*, *Engineering > Solar Inverters*).
- 🤖 **Multi-AI Compatibility**: Seamlessly works on **Google Gemini**, **ChatGPT**, and **Claude**.
- ☁️ **Cross-Device & Cross-Browser Sync**: Synchronize your folder hierarchies and chat assignments across all your laptops, desktops, and browsers (`storage.sync` + local backup mirrors).
- 🖱️ **Interactive Drag & Drop**: Drag conversations directly into folder headers or child areas, or drag folders to nest and reorder.
- ⚡ **Zero-Reload Native Navigation**: Click chats inside folders to navigate instantly via native Single-Page Application (SPA) routing without full page refreshes.
- 🎨 **Visual Customization**: Curated color accents and emoji/icon pickers for every folder.
- 👁️ **"Hide Filed Chats" Mode**: Declutters the native sidebar so the "All" section only shows unfiled conversations.
- 🔍 **Instant Search & Filter**: Rapidly filter folders and chats by title or keyword.
- 💾 **1-Click Backup Export & Import**: Instant JSON export and restore with direct text pasting support.

---

## 🚀 How to Install & Load

### For Google Chrome:
1. Open **Google Chrome** and navigate to:
   ```text
   chrome://extensions/
   ```
2. Enable **"Developer mode"** (toggle in the top-right corner).
3. Click **"Load unpacked"** in the top-left corner.
4. Select the unpacked folder:
   ```text
   dist/chrome/unpacked
   ```
5. Navigate to [gemini.google.com](https://gemini.google.com), [chatgpt.com](https://chatgpt.com), or [claude.ai](https://claude.ai) to start organizing!

### For Mozilla Firefox:
1. Open **Mozilla Firefox** and navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
2. Click **"Load Temporary Add-on..."**.
3. Select the `manifest.json` file in the root folder.
4. Navigate to [gemini.google.com](https://gemini.google.com).

---

## 📦 Building Distribution Packages

Run the build script to generate production packages for both Chrome and Firefox:
```bash
npm run build
```
This generates:
- **`dist/gemini-chat-folders.zip` & `.xpi`** (Firefox AMO Compliant, 0 errors, 0 warnings)
- **`dist/chrome/gemini-chat-folders-chrome.zip`** (Chrome Web Store Compliant)
- **`dist/chrome/unpacked/`** (Chrome unpacked extension directory)

---

## 🧪 Testing & Verification

The extension comes with automated test suites verifying storage, persistence, DOM injection, and SPA navigation:
```bash
npm test
```

---

## 👨‍💻 Author & Support

- **Author**: Abdul Aleem
- **Contact & Support Email**: [aleemksolutions@gmail.com](mailto:aleemksolutions@gmail.com)
- **License**: MIT
