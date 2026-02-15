
console.log("AI Sidekick Zhipu Adapter Loaded");

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

// ===== HELPER: Get AI assistant messages =====
function getAssistantMessages() {
    const selectors = [
        'div.chat-assistant .markdown-prose',
        'div.chat-assistant',
        '.message-assistant',
        '[id^="message-"] .markdown-prose'
    ];

    for (const selector of selectors) {
        const messages = document.querySelectorAll(selector);
        if (messages.length > 0) {
            console.log(`[Zhipu] Found ${messages.length} messages with selector: ${selector}`);
            return messages;
        }
    }
    return document.querySelectorAll('div.chat-assistant');
}

function sendCompletion(text: string) {
    if (!currentRequestId) return;
    console.log(`[Zhipu] Request ${currentRequestId} completed (text stable)`);
    chrome.runtime.sendMessage({
        type: 'AI_RESPONSE',
        model: 'zhipu',
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

    const messages = getAssistantMessages();

    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText?.trim();

        if (currentText &&
            currentText !== lastSentText &&
            currentText !== lastKnownMessageText) {

            console.log(`[Zhipu] New message detected, length: ${currentText.length}`);
            lastSentText = currentText;

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'zhipu',
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
            console.error('[Zhipu] fillAndSend error:', err);
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
    const inputSelectors = [
        'textarea[placeholder*="输入"]',
        'textarea[placeholder*="问"]',
        '#chat-input',
        'textarea',
        'div[contenteditable="true"]'
    ];

    let input: HTMLTextAreaElement | HTMLElement | null = null;
    for (const selector of inputSelectors) {
        input = document.querySelector(selector) as HTMLTextAreaElement;
        if (input) {
            console.log(`[Zhipu] Found input with selector: ${selector}`);
            break;
        }
    }

    if (!input) throw new Error("Input field not found - tried: " + inputSelectors.join(', '));

    cleanup();

    currentRequestId = requestId || Date.now().toString();
    console.log(`[Zhipu] Starting request ${currentRequestId}`);

    const messages = getAssistantMessages();
    initialMessageCount = messages.length;
    console.log(`[Zhipu] Initial message count: ${initialMessageCount}`);

    if (messages.length > 0) {
        lastKnownMessageText = (messages[messages.length - 1] as HTMLElement).innerText?.trim() || "";
    } else {
        lastKnownMessageText = "";
    }

    lastSentText = "";

    if (input instanceof HTMLTextAreaElement) {
        input.value = text;
    } else {
        input.innerText = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 600));

    const sendButtonSelectors = [
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        '#send-message-button',
        'button.send-button',
        'button[type="submit"]'
    ];

    let sendBtn: HTMLElement | null = null;
    for (const selector of sendButtonSelectors) {
        sendBtn = document.querySelector(selector) as HTMLElement;
        if (sendBtn) {
            console.log(`[Zhipu] Found send button with selector: ${selector}`);
            break;
        }
    }

    if (!sendBtn) throw new Error("Send button not found - tried: " + sendButtonSelectors.join(', '));

    if (sendBtn.hasAttribute('disabled')) {
        throw new Error("Send button is disabled");
    }

    sendBtn.click();
    startResponseMonitor();
}

function startResponseMonitor() {
    console.log("[Zhipu] Waiting for AI response...");

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
