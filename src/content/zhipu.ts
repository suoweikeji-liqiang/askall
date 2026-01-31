
console.log("AI Sidekick Zhipu Adapter Loaded");

// ===== VISIBILITY HACK (Run immediately on script load) =====
// This MUST be at the top, before any website code checks visibility
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let isWaitingForResponse = false;

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse() {
    const messages = document.querySelectorAll('div.chat-assistant, div.message-assistant');
    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText && currentText !== lastSentText) {
            lastSentText = currentText;
            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'zhipu',
                text: currentText,
                isComplete: !isWaitingForResponse // If we're still waiting, it's not complete
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

    // THIS IS THE KEY FIX: Handle CHECK_RESPONSE from background polling
    if (request.type === 'CHECK_RESPONSE') {
        checkAndSendResponse();
        sendResponse({ status: 'checked' });
        return false;
    }
});

async function fillAndSend(text: string) {
    const inputSelector = '#chat-input';
    const sendButtonSelector = '#send-message-button';

    const input = document.querySelector(inputSelector) as HTMLTextAreaElement;
    if (!input) throw new Error("Input field not found");

    // Reset state for new request
    lastSentText = "";
    isWaitingForResponse = true;

    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 500));

    const sendBtn = document.querySelector(sendButtonSelector) as HTMLElement;
    if (!sendBtn) throw new Error("Send button not found");

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

    // Auto-disconnect after 3 minutes and mark as complete
    setTimeout(() => {
        observer.disconnect();
        isWaitingForResponse = false;
    }, 180000);
}
