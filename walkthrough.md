
# AI Sidekick - New Model Adapters Walkthrough

## Overview
This task involved analyzing HTML snapshots of Kimi (`kimi.ts`), Tongyi (`qianwen.ts`), and Zhipu (`zhipu.ts`) chat interfaces to identify the correct DOM selectors for input fields and send buttons. The results were used to implement new content scripts for the AI Sidekick extension.

## 1. Analysis Results & Selectors

Based on `grep` and Python script analysis of the raw HTML files, the following selectors were identified:

### Kimi (Moonshot AI)
- **Host**: `kimi.moonshot.cn`, `kimi.com`
- **Input Selector**: `div.chat-input-editor[contenteditable="true"]`
  - Uses a `contenteditable` div rather than a textarea.
- **Send Strategy**: 
  - Selector: `div.send-button-container`
  - Logic: Check for `disabled` class before clicking.

### Tongyi Qianwen (Aliyun)
- **Host**: `qianwen.aliyun.com`, `tongyi.aliyun.com`
- **Input Selector**: `textarea.ant-input`
  - Uses Ant Design textarea component.
- **Send Strategy**: 
  - Strategy: Simulate `Enter` key press on the input.
  - Reason: Send button selectors were generic/hashed. Enter key is a reliable fallback for this interface.

### Zhipu AI (ChatGLM)
- **Host**: `chatglm.cn`, `chat.z.ai`
- **Input Selector**: `#chat-input`
- **Send Strategy**: 
  - Selector: `#send-message-button`
  - Logic: Standard button with ID.

## 2. Implementation Details

### Content Scripts
Three new files were created in `src/content/`:
- `kimi.ts`: Implements logic for `contenteditable` input handling.
- `qianwen.ts`: Implements fallback `Enter` key strategy for sending.
- `zhipu.ts`: Implements standard selector-based interaction.

### Project Configuration
- **Vite Config** (`vite.config.ts`): Added new entry points for each content script to ensure they are bundled correctly.
- **Manifest** (`public/manifest.json`): Registered content scripts with appropriate URL match patterns and added necessary host permissions.

## 3. Verification
- Use `npm run build` to verify that all new adapters build without errors.
- Load the extension in Chrome (`dist` folder) and permit access to the new host permissions when prompted.
- Test sending prompts from the side panel to Kimi, Tongyi, and Zhipu tabs.

## 4. Updates (Post-Initial Implementation)

### UI Changes
- **Model Selector**: Removed "Claude" button as it is currently inaccessible. added buttons for "Kimi", "Tongyi", and "Zhipu".
- **State Management**: Updated `App.tsx` state to support selecting the new models.

### Bug Fixes
- **ChatGPT Truncation**: Fixed an issue where ChatGPT responses were cut off.
  - **Timeout**: Extended response timeout to 3 minutes to handle longer generations.

### Connectivity & Adapter Fixes
- **Background Script Logic**: Fixed a critical bug where the background script would blindly inject `content-chatgpt.js` into *any* tab if the connection was missing. It now correctly identifies the target model and injects the corresponding script (`content-gemini.js`, `content-kimi.js`, etc.).
- **Gemini Adapter**: Implemented missing `gemini.ts` adapter.
  - **Selector**: Uses `div.ql-editor` for input and `button[aria-label="Send"]`/`button[aria-label="发送"]` for sending.
- **Manifest Updates**:
  - **Match Patterns**: Updated `qianwen`, `kimi`, and `zhipu` patterns to explicitly include root domains (e.g., `qianwen.com`, `kimi.moonshot.cn`) in addition to subdomains. This resolves issues where the content script was not loading on the main chat interface.
  - **Gemini**: Registered `content-gemini.js` in `manifest.json`.

### New Model & Robustness
- **DeepSeek Integration**: Added full support for DeepSeek (input injection + response listening).

### Anti-Throttling & Visibility Hacks
### Anti-Throttling & Robustness Architecture
- **Event-Driven Response Tracking (MutationObserver)**: Abandoned `setInterval` polling entirely in content scripts. Now using `MutationObserver` to watch for DOM changes directly.
  - **Why**: `setInterval` is heavily throttled by Chrome in background tabs (running once per minute or stopping entirely). `MutationObserver` is event-driven and runs reliably even in background tabs.
  - **Fix**: All adapters (ChatGPT, Gemini, etc.) now wait for DOM mutations to detect new text instantly.
- **Stale Data Prevention (Gemini Fix)**: Fixed a bug where Gemini would send the *previous* conversation's answer immediately. Now we count the messages *before* sending and only report text from *new* message elements.
- **Visibility Spoofing (Universal)**: Injected `Object.defineProperty(document, 'hidden', ...)` into **ALL** adapters. This prevents SPAs (Single Page Apps) from pausing their generation logic when they detect the tab is in the background.
- **Smart Polling (SidePanel-Driven)**: Implemented a demand-driven polling mechanism where the Side Panel (UI) triggers a background poll only when it is waiting for a response.
  - **Why**: Previous distinct "push" or "pull" methods were either too aggressive (flooding tabs) or fragile (background service sleeping).
  - **Fix**: 
    1. **Side Panel**: When a message is in `loading` state, it sends a `POLL_TABS` signal to the Background Service every 1 second.
    2. **Background Service**: Receives the signal and immediately pings all active AI tabs with `CHECK_RESPONSE`.
    3. **Content Script**: Reads the DOM and returns the latest text.
    - This ensures polling **only happens when needed** (saving resources) and is driven by the persistent UI connection, making it immune to Service Worker sleep cycles.
