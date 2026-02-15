
console.log("AI Sidekick Kimi Adapter Loaded");

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

function sendCompletion(text: string) {
    if (!currentRequestId) return;
    console.log(`[Kimi] Request ${currentRequestId} completed (text stable)`);
    chrome.runtime.sendMessage({
        type: 'AI_RESPONSE',
        model: 'kimi',
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

function checkAndSendResponse(expectedRequestId?: string) {
    if (!currentRequestId) return;
    if (expectedRequestId && expectedRequestId !== currentRequestId) return;

    const messages = document.querySelectorAll('div.chat-content-item-assistant, div.segment-assistant');

    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText &&
            currentText !== lastSentText &&
            currentText !== lastKnownMessageText) {

            lastSentText = currentText;

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'kimi',
                text: currentText,
                requestId: currentRequestId,
                isComplete: false
            }).catch(() => { });

            if (stabilityTimer) clearTimeout(stabilityTimer);
            stabilityTimer = setTimeout(() => {
                sendCompletion(lastSentText);
            }, STABILITY_DELAY);
        }
    }
}

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
    const inputSelector = 'div.chat-input-editor[contenteditable="true"]';
    const sendButtonSelector = 'div.send-button-container';

    const input = document.querySelector(inputSelector) as HTMLElement;
    if (!input) throw new Error("Input field not found");

    cleanup();

    currentRequestId = requestId || Date.now().toString();
    console.log(`[Kimi] Starting request ${currentRequestId}`);

    const messages = document.querySelectorAll('div.chat-content-item-assistant, div.segment-assistant');
    initialMessageCount = messages.length;

    if (messages.length > 0) {
        lastKnownMessageText = (messages[messages.length - 1] as HTMLElement).innerText;
    } else {
        lastKnownMessageText = "";
    }

    lastSentText = "";

    input.focus();
    input.innerHTML = "";
    input.textContent = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 500));

    const sendBtn = document.querySelector(sendButtonSelector) as HTMLElement;
    if (!sendBtn) throw new Error("Send button not found");

    if (sendBtn.classList.contains('disabled')) {
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        await new Promise(r => setTimeout(r, 500));
    }

    if (sendBtn.classList.contains('disabled')) {
        throw new Error("Send button is disabled");
    }

    sendBtn.click();
    startResponseMonitor();
}

function startResponseMonitor() {
    console.log("[Kimi] Waiting for AI response...");

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
