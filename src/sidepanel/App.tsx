import { useState, useEffect } from 'react'
import { MessageContent } from './MessageContent'

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

  // Debate mode
  const [debateMode, setDebateMode] = useState(false)
  const [debateConfig, setDebateConfig] = useState({
    topic: '',
    rounds: 3,
    currentRound: 0,
    isRunning: false,
    participants: [] as string[]
  })

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
              break;
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

  const handleClear = () => {
    if (messages.length > 0 && confirm('确定要清空所有对话吗？')) {
      setMessages([]);
      setDebateConfig(prev => ({ ...prev, isRunning: false, currentRound: 0 }));
    }
  };

  // Get list of connected model names
  const connectedModelList = Object.entries(connectionStatus)
    .filter(([_, connected]) => connected)
    .map(([key]) => key);

  // Send to a specific model (used by forward)
  const sendToModel = async (text: string, targetModel: string) => {
    const userMsg = { id: Date.now(), role: 'user', text: `[转发] ${text.substring(0, 50)}...` };
    setMessages(prev => [...prev, userMsg]);

    const msgId = Date.now() + Math.random();
    setMessages(prev => [...prev, {
      id: msgId,
      role: 'model',
      source: targetModel,
      text: 'Waiting for response...',
      loading: true
    }]);

    chrome.runtime.sendMessage({ type: 'SEND_PROMPT', model: targetModel, text }, (response) => {
      if (response && response.status !== 'sent') {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: 'Error: ' + (response?.message || 'Unknown'), loading: false } : m));
      }
    });
  };

  // Handle forward from MessageContent
  const handleForward = (text: string, targetModel: string) => {
    sendToModel(text, targetModel);
  };

  // Start debate mode
  const startDebate = async () => {
    if (debateConfig.participants.length < 2 || !debateConfig.topic.trim()) return;

    setDebateConfig(prev => ({ ...prev, isRunning: true, currentRound: 1 }));

    // Add the debate topic as a user message
    const topicMsg = { id: Date.now(), role: 'user', text: `🎯 辩论主题: ${debateConfig.topic}` };
    setMessages(prev => [...prev, topicMsg]);

    // First round: Ask first participant to give opening statement
    const firstParticipant = debateConfig.participants[0];
    const openingPrompt = `请就以下话题发表你的观点 (辩论第1轮开场陈述):\n\n"${debateConfig.topic}"\n\n请给出清晰的立场和论据。`;

    sendToModel(openingPrompt, firstParticipant);

    // Note: Subsequent rounds would be triggered by watching for responses
    // This is a simplified version - full implementation would use useEffect to watch for complete responses
  };

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
        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDebateMode(!debateMode)}
              className={`text-xs px-2 py-1 rounded transition-colors ${debateMode
                ? 'bg-purple-100 text-purple-600 border border-purple-200'
                : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'
                }`}
              title="辩论模式"
            >
              ⚔️ 辩论
            </button>
            <button
              onClick={handleClear}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
              title="清空对话"
            >
              🗑️ 清空
            </button>
          </div>
        )}
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

      {/* Debate Mode Panel */}
      {debateMode && (
        <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-purple-700">⚔️ 辩论模式</span>
              {debateConfig.isRunning && (
                <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
                  第 {debateConfig.currentRound}/{debateConfig.rounds} 轮
                </span>
              )}
            </div>

            {!debateConfig.isRunning ? (
              <>
                <input
                  type="text"
                  placeholder="输入辩论主题..."
                  value={debateConfig.topic}
                  onChange={(e) => setDebateConfig(prev => ({ ...prev, topic: e.target.value }))}
                  className="w-full text-sm px-3 py-2 border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">参与模型:</span>
                  {connectedModelList.map(model => (
                    <button
                      key={model}
                      onClick={() => {
                        const isSelected = debateConfig.participants.includes(model);
                        setDebateConfig(prev => ({
                          ...prev,
                          participants: isSelected
                            ? prev.participants.filter(p => p !== model)
                            : [...prev.participants, model]
                        }));
                      }}
                      className={`text-xs px-2 py-1 rounded-full transition-colors ${debateConfig.participants.includes(model)
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-gray-500 border border-gray-200'
                        }`}
                    >
                      {model.charAt(0).toUpperCase() + model.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">轮数:</span>
                  <select
                    value={debateConfig.rounds}
                    onChange={(e) => setDebateConfig(prev => ({ ...prev, rounds: parseInt(e.target.value) }))}
                    className="text-xs px-2 py-1 border border-purple-200 rounded"
                  >
                    {[1, 2, 3, 4, 5].map(n => (
                      <option key={n} value={n}>{n} 轮</option>
                    ))}
                  </select>
                  <button
                    onClick={() => startDebate()}
                    disabled={!debateConfig.topic.trim() || debateConfig.participants.length < 2}
                    className="ml-auto text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    🚀 开始辩论
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">辩论进行中...</span>
                <button
                  onClick={() => setDebateConfig(prev => ({ ...prev, isRunning: false, currentRound: 0 }))}
                  className="ml-auto text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  ⏹️ 停止
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            选择模型并发送消息开始对话
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            {msg.role === 'model' && (
              <span className="text-[10px] font-bold tracking-wider text-gray-400 mb-1 ml-1 uppercase">
                {msg.source}
              </span>
            )}
            <div className={`max-w-[95%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm ${msg.role === 'user'
              ? 'bg-blue-600 text-white rounded-br-none'
              : 'bg-white border border-gray-100 text-gray-700 rounded-bl-none'
              }`}>
              {msg.role === 'user' ? (
                msg.text
              ) : (
                <MessageContent
                  content={msg.text}
                  role={msg.role}
                  source={msg.source}
                  connectedModels={connectedModelList}
                  onForward={handleForward}
                />
              )}
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
