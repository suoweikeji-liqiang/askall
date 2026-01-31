import { useState, useEffect } from 'react'

export default function App() {
  const [input, setInput] = useState('')
  const [connectionStatus, setConnectionStatus] = useState({
    chatgpt: false,
    gemini: false,
    kimi: false,
    qianwen: false,
    zhipu: false,
    deepseek: false
  })

  const [selectedModels, setSelectedModels] = useState({
    chatgpt: true,
    gemini: false,
    kimi: false,
    qianwen: false,
    zhipu: false,
    deepseek: false
  })

  const [messages, setMessages] = useState<any[]>([])
  const [isSending, setIsSending] = useState(false)

  // Poll connection status
  useEffect(() => {
    const checkConnections = () => {
      chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (response) => {
        if (chrome.runtime.lastError) return; // Ignore if background not ready
        if (response) setConnectionStatus(response);
      });
    };

    checkConnections();
    const interval = setInterval(checkConnections, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for AI Responses
  useEffect(() => {
    const messageListener = (message: any) => {
      if (message.type === 'AI_RESPONSE') {
        const { model, text, isComplete } = message;

        setMessages(prev => {
          const newMessages = [...prev];
          // Find the last message from this model
          let foundIndex = -1;
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].source === model && newMessages[i].role === 'model') {
              foundIndex = i;
              break; // Found the latest one
            }
          }

          if (foundIndex !== -1) {
            // Update existing message
            newMessages[foundIndex] = {
              ...newMessages[foundIndex],
              text: text,
              loading: !isComplete
            };
          } else {
            // Should not happen normally if "Sending..." placeholder exists, 
            // but if it does, append new
            newMessages.push({
              id: Date.now(),
              role: 'model',
              source: model,
              text: text,
              loading: !isComplete
            });
          }
          return newMessages;
        });
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  const isLoading = messages.some(m => m.loading);

  // Polling Driver: When waiting for response, ping background to ping content scripts
  // We use a separate useEffect dependent only on `isLoading` to prevent resetting the timer on every message update
  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'POLL_TABS' }, () => {
        if (chrome.runtime.lastError) { }
      });
    }, 500); // 500ms is stable and sufficient

    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    const userMsg = { id: Date.now(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setIsSending(true);
    const textToSend = input;
    setInput('');

    // Send to all selected AND connected models
    const targets = Object.entries(selectedModels)
      .filter(([key, active]) => active && connectionStatus[key as keyof typeof connectionStatus])
      .map(([key]) => key);

    for (const model of targets) {
      // Optimistic UI: Add loading message
      const msgId = Date.now() + Math.random();
      setMessages(prev => [...prev, {
        id: msgId,
        role: 'model',
        source: model,
        text: 'Waiting for response...',
        loading: true
      }]);

      chrome.runtime.sendMessage({ type: 'SEND_PROMPT', model, text: textToSend }, (response) => {
        // Handle basic acknowledgement
        if (response && response.status === 'sent') {
          // We don't update text here anymore, we wait for AI_RESPONSE
          console.log(`Prompt sent to ${model}`);
        } else {
          setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: 'Error sending: ' + (response?.message || 'Unknown'), loading: false } : m));
        }
      });
    }

    setIsSending(false);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-slate-800 font-sans">
      {/* Header */}
      <header className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
          AI Sidekick
        </h1>
      </header>

      {/* Model Selector */}
      <div className="px-4 py-2 bg-white border-b border-gray-100 flex gap-2 overflow-x-auto no-scrollbar">
        {Object.entries(selectedModels).map(([key, active]) => {
          const isConnected = connectionStatus[key as keyof typeof connectionStatus];
          return (
            <button
              key={key}
              onClick={() => setSelectedModels(prev => ({ ...prev, [key]: !prev[key as keyof typeof selectedModels] }))}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 border flex items-center gap-1 ${active
                ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-105'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
            >
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-gray-300'}`}></span>
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          )
        })}
      </div>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            {msg.role === 'model' && (
              <span className="text-[10px] font-bold tracking-wider text-gray-400 mb-1 ml-1 uppercase">
                {msg.source}
              </span>
            )}
            <div className={`max-w-[90%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm ${msg.role === 'user'
              ? 'bg-blue-600 text-white rounded-br-none'
              : 'bg-white border border-gray-100 text-gray-700 rounded-bl-none'
              }`}>
              {msg.text}
            </div>
          </div>
        ))}
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white border-t border-gray-100">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask anything..."
            className="w-full resize-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-inner"
            rows={1}
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            className="absolute right-2 bottom-2 p-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!input.trim() || isSending}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="text-center mt-2">
          <span className="text-[10px] text-gray-400">Powered by browser sessions</span>
        </div>
      </footer>
    </div>
  )
}
