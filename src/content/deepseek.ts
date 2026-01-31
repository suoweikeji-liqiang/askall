
console.log("AI Sidekick DeepSeek Adapter Loaded");

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let isWaitingForResponse = false;

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse() {
    const messages = document.querySelectorAll('div.ds-markdown');
    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText && currentText !== lastSentText) {
            lastSentText = currentText;
            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'deepseek',
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
    const inputSelector = 'textarea';
    const input = document.querySelector(inputSelector) as HTMLTextAreaElement;
    if (!input) throw new Error("Input field not found");

    lastSentText = "";
    isWaitingForResponse = true;

    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 500));

    // Press Enter to send
    const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
    });
    input.dispatchEvent(enterEvent);

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
