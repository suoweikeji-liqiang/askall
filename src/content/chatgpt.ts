console.log("AI Sidekick ChatGPT Adapter Loaded");
document.body.style.border = "5px solid #10a37f";
setTimeout(() => { document.body.style.border = ""; }, 3000);

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let lastKnownMessageText = "";
let initialMessageCount = 0;
let currentRequestId: string | null = null;
let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;
let overallTimeout: ReturnType<typeof setTimeout> | null = null;

const STABILITY_DELAY = 3000; // 3s no text change = complete

// ===== HELPER: Send completion and clean up =====
function sendCompletion(text: string) {
    if (!currentRequestId) return;
    console.log(`[ChatGPT] Request ${currentRequestId} completed (text stable)`);
    chrome.runtime.sendMessage({
        type: 'AI_RESPONSE',
        model: 'chatgpt',
        text: text,
        requestId: currentRequestId,
        isComplete: true
    }).catch(() => { });
    cleanup();
}

function cleanup() {
    if (stabilityTimer) { clearTimeout(stabilityTimer); stabilityTimer = null; }
    if (observer) { observer.disconnect(); observer = null; }
    if (overallTimeout) { clearTimeout(overallTimeout); overallTimeout = null; }
    currentRequestId = null;
}

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse(expectedRequestId?: string) {
    if (!currentRequestId) return;
    if (expectedRequestId && expectedRequestId !== currentRequestId) return;

    const messages = document.querySelectorAll('div[data-message-author-role="assistant"]');

    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText &&
            currentText !== lastSentText &&
            currentText !== lastKnownMessageText) {

            lastSentText = currentText;

            // Send streaming update
            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'chatgpt',
                text: currentText,
                requestId: currentRequestId,
                isComplete: false
            }).catch(() => { });

            // Reset stability timer — if text stops changing for 3s, mark complete
            if (stabilityTimer) clearTimeout(stabilityTimer);
            stabilityTimer = setTimeout(() => {
                sendCompletion(lastSentText);
            }, STABILITY_DELAY);
        }

        // Also check: stop button gone = immediate completion
        const stopButton = document.querySelector('button[aria-label="Stop generating"]') ||
            document.querySelector('button[aria-label="停止生成"]');
        if (!stopButton && lastSentText && lastSentText !== lastKnownMessageText) {
            // No stop button and we have new text — likely done
            if (stabilityTimer) clearTimeout(stabilityTimer);
            stabilityTimer = setTimeout(() => {
                sendCompletion(lastSentText);
            }, 1000); // shorter delay when stop button is gone
        }
    }
}

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'INPUT_PROMPT') {
        fillAndSend(request.text, request.requestId).then(() => {
            sendResponse({ status: 'sent' });
        }).catch(err => {
            sendResponse({ status: 'error', message: err.toString() });
        });
        return true;
    }

    if (request.type === 'CHECK_RESPONSE') {
        checkAndSendResponse(request.requestId);
        sendResponse({ status: 'checked' });
        return false;
    }
});

async function fillAndSend(text: string, requestId?: string) {
    const inputEl = document.querySelector('#prompt-textarea') as HTMLElement;
    if (!inputEl) throw new Error("Input element (textarea/div) not found");

    // Clean up any previous request
    cleanup();

    currentRequestId = requestId || Date.now().toString();
    console.log(`[ChatGPT] Starting request ${currentRequestId}`);

    const messages = document.querySelectorAll('div[data-message-author-role="assistant"]');
    initialMessageCount = messages.length;

    if (messages.length > 0) {
        lastKnownMessageText = (messages[messages.length - 1] as HTMLElement).innerText;
    } else {
        lastKnownMessageText = "";
    }

    lastSentText = "";

    inputEl.focus();

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
    });
    inputEl.dispatchEvent(pasteEvent);

    if (inputEl.innerText.trim() === '') {
        inputEl.innerText = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await new Promise(r => setTimeout(r, 800));

    const selectors = [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="发送提示"]',
        'button[aria-label="Start chat"]',
        'button[data-testid="brand-purple-button"]'
    ];

    let sendButton: HTMLButtonElement | null = null;
    for (const seg of selectors) {
        sendButton = document.querySelector(seg) as HTMLButtonElement;
        if (sendButton) break;
    }

    if (sendButton && !sendButton.disabled) {
        sendButton.click();
    } else {
        if (sendButton) {
            sendButton.click();
        } else {
            console.warn("Send button not found/clickable, forcing Enter.");
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13
            });
            inputEl.dispatchEvent(enterEvent);
        }
    }

    startResponseMonitor();
}

function startResponseMonitor() {
    console.log("[ChatGPT] Waiting for AI response...");

    observer = new MutationObserver(() => {
        checkAndSendResponse();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Safety timeout: force complete after 120s
    overallTimeout = setTimeout(() => {
        if (lastSentText && lastSentText !== lastKnownMessageText) {
            sendCompletion(lastSentText);
        } else {
            cleanup();
        }
    }, 120000);
}
