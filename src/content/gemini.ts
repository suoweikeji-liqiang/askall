
console.log("AI Sidekick Gemini Adapter Loaded");

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let initialMessageCount = 0;
let isWaitingForResponse = false;

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse() {
    const candidates = document.querySelectorAll('message-content, .model-response-text, .message-content');

    // Only process if we have NEW messages (more than initial count)
    if (candidates.length > initialMessageCount) {
        const lastMessage = candidates[candidates.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText && currentText !== lastSentText) {
            lastSentText = currentText;
            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'gemini',
                text: currentText,
                isComplete: !isWaitingForResponse
            }).catch(() => { });
        }
    }
}

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'INPUT_PROMPT') {
        fillAndSend(request.text).then(() => {
            sendResponse({ status: 'sent' });
        }).catch(err => {
            sendResponse({ status: 'error', message: err.toString() });
        });
        return true;
    }

    // Handle CHECK_RESPONSE from background polling
    if (request.type === 'CHECK_RESPONSE') {
        checkAndSendResponse();
        sendResponse({ status: 'checked' });
        return false;
    }
});

async function fillAndSend(text: string) {
    const inputSelector = 'div.ql-editor[contenteditable="true"]';
    const input = document.querySelector(inputSelector) as HTMLElement;
    if (!input) throw new Error("Input element (div.ql-editor) not found");

    // Capture initial message count BEFORE sending to avoid stale data
    initialMessageCount = document.querySelectorAll('message-content, .model-response-text, .message-content').length;
    lastSentText = "";
    isWaitingForResponse = true;

    input.focus();
    input.innerHTML = `<p>${text}</p>`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 800));

    const selectors = ['button[aria-label="Send"]', 'button[aria-label="发送"]', 'button.send-button'];
    let sendBtn: HTMLElement | null = null;
    for (const s of selectors) {
        sendBtn = document.querySelector(s) as HTMLElement;
        if (sendBtn) break;
    }

    if (!sendBtn) throw new Error("Send button not found");
    sendBtn.click();
    startResponseMonitor();
}

function startResponseMonitor() {
    console.log("Waiting for AI response (MutationObserver + CHECK_RESPONSE)...");

    const observer = new MutationObserver((_mutations) => {
        checkAndSendResponse();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    setTimeout(() => {
        observer.disconnect();
        isWaitingForResponse = false;
    }, 180000);
}
