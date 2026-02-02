
console.log("AI Sidekick Kimi Adapter Loaded");

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let lastKnownMessageText = ""; // Snapshot of last message BEFORE sending new request
let initialMessageCount = 0;
let isWaitingForResponse = false;
let currentRequestId: string | null = null; // Track which request we're responding to

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse(expectedRequestId?: string) {
    // Only respond if we have an active request and it matches what's being polled
    if (!currentRequestId) return;
    if (expectedRequestId && expectedRequestId !== currentRequestId) return;

    const messages = document.querySelectorAll('div.chat-content-item-assistant, div.segment-assistant');

    // Only process NEW messages (more than initial count)
    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        // Must be different from snapshot AND from last sent text (avoid duplicates)
        if (currentText && 
            currentText !== lastSentText && 
            currentText !== lastKnownMessageText) {
            
            lastSentText = currentText;
            const isComplete = !isWaitingForResponse;

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'kimi',
                text: currentText,
                requestId: currentRequestId,
                isComplete: isComplete
            }).catch(() => { });

            if (isComplete) {
                console.log(`[Kimi] Request ${currentRequestId} completed`);
            }
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

    // Handle CHECK_RESPONSE from background polling
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

    // Set the request ID for this request
    currentRequestId = requestId || Date.now().toString();
    console.log(`[Kimi] Starting request ${currentRequestId}`);

    // Capture initial message count and snapshot BEFORE sending
    const messages = document.querySelectorAll('div.chat-content-item-assistant, div.segment-assistant');
    initialMessageCount = messages.length;
    
    // Take snapshot of last message to avoid sending stale responses
    if (messages.length > 0) {
        lastKnownMessageText = (messages[messages.length - 1] as HTMLElement).innerText;
    } else {
        lastKnownMessageText = "";
    }
    
    lastSentText = "";
    isWaitingForResponse = true;

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
