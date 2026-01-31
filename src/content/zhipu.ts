
console.log("AI Sidekick Zhipu Adapter Loaded");

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let initialMessageCount = 0; // Track message count before sending
let isWaitingForResponse = false;

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
function checkAndSendResponse() {
    const messages = getAssistantMessages();

    // Only process NEW messages (more than initial count)
    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText?.trim();

        if (currentText && currentText !== lastSentText) {
            console.log(`[Zhipu] New message detected, length: ${currentText.length}`);
            lastSentText = currentText;
            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'zhipu',
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
            console.error('[Zhipu] fillAndSend error:', err);
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

    // Capture initial message count BEFORE sending to avoid stale data
    initialMessageCount = getAssistantMessages().length;
    console.log(`[Zhipu] Initial message count: ${initialMessageCount}`);
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
