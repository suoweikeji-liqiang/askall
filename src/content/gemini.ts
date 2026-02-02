
console.log("AI Sidekick Gemini Adapter Loaded");

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

    const candidates = document.querySelectorAll('message-content, .model-response-text, .message-content');

    // Only process if we have NEW messages (more than initial count)
    if (candidates.length > initialMessageCount) {
        const lastMessage = candidates[candidates.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        // Must be different from snapshot AND from last sent text (avoid duplicates)
        if (currentText && 
            currentText !== lastSentText && 
            currentText !== lastKnownMessageText) {
            
            lastSentText = currentText;
            const isComplete = !isWaitingForResponse;

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'gemini',
                text: currentText,
                requestId: currentRequestId,
                isComplete: isComplete
            }).catch(() => { });

            if (isComplete) {
                console.log(`[Gemini] Request ${currentRequestId} completed`);
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
    const inputSelector = 'div.ql-editor[contenteditable="true"]';
    const input = document.querySelector(inputSelector) as HTMLElement;
    if (!input) throw new Error("Input element (div.ql-editor) not found");

    // Set the request ID for this request
    currentRequestId = requestId || Date.now().toString();
    console.log(`[Gemini] Starting request ${currentRequestId}`);

    // Capture initial message count and snapshot BEFORE sending
    const messages = document.querySelectorAll('message-content, .model-response-text, .message-content');
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
