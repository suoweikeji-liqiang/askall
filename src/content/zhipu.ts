
console.log("AI Sidekick Zhipu Adapter Loaded");

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let lastKnownMessageText = ""; // Snapshot of last message BEFORE sending new request
let initialMessageCount = 0; // Track message count before sending
let isWaitingForResponse = false;
let currentRequestId: string | null = null; // Track which request we're responding to

// ===== HELPER: Get AI assistant messages =====
function getAssistantMessages() {
    // Zhipu uses .chat-assistant with .markdown-prose for AI responses
    // The text is inside the markdown-prose container
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

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse(expectedRequestId?: string) {
    // Only respond if we have an active request and it matches what's being polled
    if (!currentRequestId) return;
    if (expectedRequestId && expectedRequestId !== currentRequestId) return;

    const messages = getAssistantMessages();

    // Only process NEW messages (more than initial count)
    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText?.trim();

        // Must be different from snapshot AND from last sent text (avoid duplicates)
        if (currentText && 
            currentText !== lastSentText && 
            currentText !== lastKnownMessageText) {
            
            console.log(`[Zhipu] New message detected, length: ${currentText.length}`);
            lastSentText = currentText;
            const isComplete = !isWaitingForResponse;

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'zhipu',
                text: currentText,
                requestId: currentRequestId,
                isComplete: isComplete
            }).catch(() => { });

            if (isComplete) {
                console.log(`[Zhipu] Request ${currentRequestId} completed`);
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
            console.error('[Zhipu] fillAndSend error:', err);
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
    // Try multiple input selectors
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

    // Set the request ID for this request
    currentRequestId = requestId || Date.now().toString();
    console.log(`[Zhipu] Starting request ${currentRequestId}`);

    // Capture initial message count and snapshot BEFORE sending
    const messages = getAssistantMessages();
    initialMessageCount = messages.length;
    console.log(`[Zhipu] Initial message count: ${initialMessageCount}`);
    
    // Take snapshot of last message to avoid sending stale responses
    if (messages.length > 0) {
        lastKnownMessageText = (messages[messages.length - 1] as HTMLElement).innerText?.trim() || "";
    } else {
        lastKnownMessageText = "";
    }
    
    lastSentText = "";
    isWaitingForResponse = true;

    // Set value based on element type
    if (input instanceof HTMLTextAreaElement) {
        input.value = text;
    } else {
        input.innerText = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 600));

    // Try multiple send button selectors
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
