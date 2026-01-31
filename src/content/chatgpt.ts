console.log("AI Sidekick ChatGPT Adapter Loaded");
document.body.style.border = "5px solid #10a37f";
setTimeout(() => { document.body.style.border = ""; }, 3000);

// ===== VISIBILITY HACK (Run immediately on script load) =====
Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });

// ===== STATE =====
let lastSentText = "";
let initialMessageCount = 0; // Track message count before sending
let isWaitingForResponse = false;

// ===== HELPER: Check current response and send to sidepanel =====
function checkAndSendResponse() {
    const messages = document.querySelectorAll('div[data-message-author-role="assistant"]');

    // Only process NEW messages (more than initial count)
    if (messages.length > initialMessageCount) {
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        const currentText = lastMessage.innerText;

        if (currentText && currentText !== lastSentText) {
            lastSentText = currentText;

            // Check for stop button to determine completion
            const stopButton = document.querySelector('button[aria-label="Stop generating"]') ||
                document.querySelector('button[aria-label="停止生成"]');

            chrome.runtime.sendMessage({
                type: 'AI_RESPONSE',
                model: 'chatgpt',
                text: currentText,
                isComplete: !stopButton && !isWaitingForResponse
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
    const inputEl = document.querySelector('#prompt-textarea') as HTMLElement;
    if (!inputEl) throw new Error("Input element (textarea/div) not found");

    // Capture initial message count BEFORE sending to avoid stale data
    initialMessageCount = document.querySelectorAll('div[data-message-author-role="assistant"]').length;
    lastSentText = "";
    isWaitingForResponse = true;

    inputEl.focus();

    // Simulate Paste
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
    });
    inputEl.dispatchEvent(pasteEvent);

    // Backup text insertion
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
