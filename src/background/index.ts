console.log("AI Sidekick Background Service Worker Started");

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Store tab IDs for connected services
let activeTabs: Record<string, number | null> = {
    chatgpt: null,
    gemini: null,
    kimi: null,
    qianwen: null,
    zhipu: null,
    deepseek: null
};

// Store current requestId for each model to track which request we're waiting for
let activeRequests: Record<string, string | null> = {
    chatgpt: null,
    gemini: null,
    kimi: null,
    qianwen: null,
    zhipu: null,
    deepseek: null
};

// Polling Loop removed (Moved to SidePanel-driven)
// We will simply expose a "POLL_TABS" message that the SidePanel can trigger
// This ensures we only poll when the UI is actually interested (SidePanel open and waiting)

// Helper to find tabs, prioritizing active/recent ones
async function findTabs() {
    const sortTabs = (tabs: chrome.tabs.Tab[]) => {
        return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    };

    const find = async (urlPattern: string) => {
        const tabs = await chrome.tabs.query({ url: urlPattern });
        const sorted = sortTabs(tabs);
        return sorted.length > 0 ? sorted[0].id! : null;
    };

    activeTabs.chatgpt = await find("https://chatgpt.com/*");
    activeTabs.gemini = await find("https://gemini.google.com/*");
    activeTabs.deepseek = await find("https://chat.deepseek.com/*");

    // For others, use broad patterns matching manifest
    // Using broad patterns here is better
    activeTabs.kimi = await find("*://*.kimi.moonshot.cn/*") || await find("*://*.kimi.com/*");
    activeTabs.qianwen = await find("*://*.qianwen.aliyun.com/*") || await find("*://*.tongyi.aliyun.com/*") || await find("*://*.qianwen.com/*");
    activeTabs.zhipu = await find("*://*.chatglm.cn/*") || await find("*://chat.z.ai/*");

    return activeTabs;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log("Background received:", message);

    if (message.type === 'AI_RESPONSE') {
        // Forward to sidepanel (already handled by runtime messaging mostly, but good to know)
        return false;
    }

    if (message.type === 'CHECK_STATUS') {
        findTabs().then((tabs) => {
            sendResponse({
                chatgpt: !!tabs.chatgpt,
                gemini: !!tabs.gemini,
                kimi: !!tabs.kimi,
                qianwen: !!tabs.qianwen,
                zhipu: !!tabs.zhipu,
                deepseek: !!tabs.deepseek
            });
        });
        return true;
    }

    if (message.type === 'POLL_TABS') {
        // Efficiently ping all known active tabs with their requestIds
        findTabs().then(tabs => {
            Object.entries(tabs).forEach(([model, tabId]) => {
                if (tabId) {
                    const requestId = activeRequests[model as keyof typeof activeRequests];
                    chrome.tabs.sendMessage(tabId, { 
                        type: 'CHECK_RESPONSE',
                        requestId: requestId  // Pass the requestId so content script knows which request we're waiting for
                    }, (_response) => {
                        // Ignore errors (tab closed etc)
                        if (chrome.runtime.lastError) { }
                    });
                }
            });
        });
        sendResponse({ status: 'polling' });
        return false;
    }

    if (message.type === 'SEND_PROMPT') {
        const { model, text, requestId } = message;
        
        // Store the requestId for this model so we can track responses
        if (requestId) {
            activeRequests[model as keyof typeof activeRequests] = requestId;
        }
        
        // Always refresh tab list before sending to ensure we target the most recent one
        findTabs().then((tabs) => {
            const tabId = tabs[model as keyof typeof tabs];

            if (tabId) {
                // Classic Message Passing - include requestId
                chrome.tabs.sendMessage(tabId, { type: 'INPUT_PROMPT', text, requestId }, (response) => {
                    if (chrome.runtime.lastError) {
                        const errMsg = chrome.runtime.lastError.message || "";
                        // If content script is missing (orphan tab), try to inject it
                        if (errMsg.includes("Receiving end does not exist")) {
                            console.log(`Content script missing for ${model}, attempting injection...`);

                            const scriptMap: Record<string, string> = {
                                chatgpt: 'content-chatgpt.js',
                                gemini: 'content-gemini.js',
                                kimi: 'content-kimi.js',
                                qianwen: 'content-qianwen.js',
                                zhipu: 'content-zhipu.js',
                                deepseek: 'content-deepseek.js'
                            };
                            const file = scriptMap[model];

                            if (file) {
                                chrome.scripting.executeScript({
                                    target: { tabId },
                                    files: [file]
                                }).then(() => {
                                    // Retry sending after injection - include requestId
                                    setTimeout(() => {
                                        chrome.tabs.sendMessage(tabId, { type: 'INPUT_PROMPT', text, requestId }, (retryResponse) => {
                                            if (chrome.runtime.lastError) {
                                                sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                                            } else {
                                                sendResponse(retryResponse);
                                            }
                                        });
                                    }, 500);
                                }).catch(err => {
                                    sendResponse({ status: 'error', message: "Injection failed: " + err.message });
                                });
                            } else {
                                sendResponse({ status: 'error', message: "No script map found for: " + model });
                            }
                        } else {
                            sendResponse({ status: 'error', message: "Connection failed: " + errMsg });
                        }
                    } else {
                        sendResponse(response);
                    }
                });
            } else {
                sendResponse({ error: "Model not connected" });
            }
        });
        return true; // Keep channel open
    }
});
