
console.log("AI Sidekick Gemini Adapter Loaded");

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

const STABILITY_DELAY = 3000;

// ===== HELPER: Send completion and clean up =====
function sendCompletion(text: string) {
    if (!currentRequestId) return;
    console.log(`[Gemini] Request ${currentRequestId} completed (text stable)`);
    chrome.runtime.sendMessage({
        type: 'AI_RESPONSE',
        model: 'gemini',
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

    const candidates = document.querySelectorAll('message-content, .model-response-text, .message-content');

    if (candidates.length > initialMessageCount) {
        const lastMessage = candidates[candidates.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText &&
            currentText !== lastSentText &&
            currentText !== lastKnownMessageText) {

            lastSentText = currentText;

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'gemini',
                text: currentText,
                requestId: currentRequestId,
                isComplete: false
            }).catch(() => { });

            // Reset stability timer
            if (stabilityTimer) clearTimeout(stabilityTimer);
            stabilityTimer = setTimeout(() => {
                sendCompletion(lastSentText);
            }, STABILITY_DELAY);
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
    const inputSelector = 'div.ql-editor[contenteditable="true"]';
    const input = document.querySelector(inputSelector) as HTMLElement;
    if (!input) throw new Error("Input element (div.ql-editor) not found");

    cleanup();

    currentRequestId = requestId || Date.now().toString();
    console.log(`[Gemini] Starting request ${currentRequestId}`);

    const messages = document.querySelectorAll('message-content, .model-response-text, .message-content');
    initialMessageCount = messages.length;

    if (messages.length > 0) {
        lastKnownMessageText = (messages[messages.length - 1] as HTMLElement).innerText;
    } else {
        lastKnownMessageText = "";
    }

    lastSentText = "";

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
    console.log("[Gemini] Waiting for AI response...");

    observer = new MutationObserver(() => {
        checkAndSendResponse();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    overallTimeout = setTimeout(() => {
        if (lastSentText && lastSentText !== lastKnownMessageText) {
            sendCompletion(lastSentText);
        } else {
            cleanup();
        }
    }, 120000);
}
