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
  
  // Track active requestIds for each model to match responses
  const [activeRequestIds, setActiveRequestIds] = useState<Record<string, string | null>>({
    chatgpt: null,
    gemini: null,
    kimi: null,
    qianwen: null,
    zhipu: null,
    deepseek: null
  })

  // Debate mode
  const [debateMode, setDebateMode] = useState(false)
  const [debateConfig, setDebateConfig] = useState({
    topic: '',
    rounds: 3,
    currentRound: 0,
    isRunning: false,
    participants: [] as string[]
  })

  // Phase 3: Layout, Export, Templates
  const [layout, setLayout] = useState<'list' | 'compare'>('list')
  const [showSettings, setShowSettings] = useState(false)
  const [promptTemplates] = useState([
    { id: 1, name: '简洁回答', prompt: '请用简洁的语言回答，不超过3句话：' },
    { id: 2, name: '代码示例', prompt: '请给出代码示例：' },
    { id: 3, name: '对比分析', prompt: '请对比分析以下内容的优缺点：' },
    { id: 4, name: '逐步解释', prompt: '请一步一步解释：' },
    { id: 5, name: '中文回答', prompt: '请用中文回答：' },
  ])

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
        const { model, text, isComplete, requestId } = message;

        // Verify requestId matches our active request for this model
        // This prevents stale/old responses from being processed
        setActiveRequestIds(currentIds => {
          const expectedRequestId = currentIds[model as keyof typeof currentIds];
          
          // If requestId doesn't match, ignore this response (it's stale)
          if (requestId && expectedRequestId && requestId !== expectedRequestId) {
            console.log(`[App] Ignoring stale response from ${model}: expected ${expectedRequestId}, got ${requestId}`);
            return currentIds;
          }

          // Valid response - update messages
          setMessages(prev => {
            const newMessages = [...prev];
            // Find the last message from this model with matching requestId
            let foundIndex = -1;
            for (let i = newMessages.length - 1; i >= 0; i--) {
              if (newMessages[i].source === model && 
                  newMessages[i].role === 'model' &&
                  (!requestId || newMessages[i].requestId === requestId)) {
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
                requestId: requestId,
                loading: !isComplete
              });
            }
            return newMessages;
          });

          // If complete, clear the active requestId for this model
          if (isComplete) {
            return { ...currentIds, [model]: null };
          }
          return currentIds;
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

  // Debate Mode: Auto-reply when a participant finishes
  useEffect(() => {
    if (!debateConfig.isRunning || isLoading) return;
    if (debateConfig.currentRound > debateConfig.rounds) {
      // Debate finished
      setDebateConfig(prev => ({ ...prev, isRunning: false }));
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'user',
        text: `🏁 辩论结束！共进行了 ${debateConfig.rounds} 轮。`
      }]);
      return;
    }

    // Find the last completed model message
    const modelMessages = messages.filter(m => m.role === 'model' && !m.loading);
    if (modelMessages.length === 0) return;

    const lastMsg = modelMessages[modelMessages.length - 1];
    const lastSource = lastMsg.source;

    // Find next participant
    const currentIndex = debateConfig.participants.indexOf(lastSource);
    if (currentIndex === -1) return;

    const isRoundComplete = currentIndex === debateConfig.participants.length - 1;
    const nextIndex = isRoundComplete ? 0 : currentIndex + 1;
    const nextParticipant = debateConfig.participants[nextIndex];

    // Check if we already sent to this participant in the current context
    const recentMessages = messages.slice(-3);
    const alreadySent = recentMessages.some(m =>
      m.role === 'model' && m.source === nextParticipant && m.loading
    );
    if (alreadySent) return;

    // Update round if completing a cycle
    if (isRoundComplete) {
      setDebateConfig(prev => ({ ...prev, currentRound: prev.currentRound + 1 }));
    }

    // Send rebuttal prompt
    const rebuttalPrompt = `${lastSource.toUpperCase()} 的观点是：\n\n"${lastMsg.text.substring(0, 500)}${lastMsg.text.length > 500 ? '...' : ''}"\n\n请针对以上观点进行反驳或补充（第${debateConfig.currentRound}轮）：`;

    setTimeout(() => {
      sendToModel(rebuttalPrompt, nextParticipant);
    }, 1000); // Small delay for better UX

  }, [messages, debateConfig, isLoading]);

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

    // Generate unique requestId for this request
    const requestId = `${targetModel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store the active requestId for this model
    setActiveRequestIds(prev => ({ ...prev, [targetModel]: requestId }));

    const msgId = Date.now() + Math.random();
    setMessages(prev => [...prev, {
      id: msgId,
      role: 'model',
      source: targetModel,
      text: 'Waiting for response...',
      requestId: requestId,
      loading: true
    }]);

    chrome.runtime.sendMessage({ type: 'SEND_PROMPT', model: targetModel, text, requestId }, (response) => {
      if (response && response.status !== 'sent') {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: 'Error: ' + (response?.message || 'Unknown'), loading: false } : m));
        // Clear requestId on error
        setActiveRequestIds(prev => ({ ...prev, [targetModel]: null }));
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

  // Export conversation as Markdown
  const exportConversation = () => {
    if (messages.length === 0) return;

    const date = new Date().toLocaleDateString('zh-CN');
    let markdown = `# AI Sidekick 对话记录\n\n📅 日期: ${date}\n\n---\n\n`;

    messages.forEach(msg => {
      if (msg.role === 'user') {
        markdown += `## 👤 用户\n\n${msg.text}\n\n`;
      } else {
        markdown += `## 🤖 ${msg.source?.toUpperCase() || 'AI'}\n\n${msg.text}\n\n---\n\n`;
      }
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-sidekick-chat-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply prompt template
  const applyTemplate = (templatePrompt: string) => {
    setInput(prev => templatePrompt + prev);
    setShowSettings(false);
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

    // Generate requestIds for all target models
    const newRequestIds: Record<string, string> = {};
    for (const model of targets) {
      newRequestIds[model] = `${model}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Update active requestIds
    setActiveRequestIds(prev => ({ ...prev, ...newRequestIds }));

    for (const model of targets) {
      const requestId = newRequestIds[model];
      
      // Optimistic UI: Add loading message with requestId
      const msgId = Date.now() + Math.random();
      setMessages(prev => [...prev, {
        id: msgId,
        role: 'model',
        source: model,
        text: 'Waiting for response...',
        requestId: requestId,
        loading: true
      }]);

      chrome.runtime.sendMessage({ type: 'SEND_PROMPT', model, text: textToSend, requestId }, (response) => {
        // Handle basic acknowledgement
        if (response && response.status === 'sent') {
          // We don't update text here anymore, we wait for AI_RESPONSE
          console.log(`Prompt sent to ${model} with requestId ${requestId}`);
        } else {
          setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: 'Error sending: ' + (response?.message || 'Unknown'), loading: false } : m));
          // Clear requestId on error
          setActiveRequestIds(prev => ({ ...prev, [model]: null }));
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
          <div className="flex items-center gap-1">
            {/* Layout Toggle */}
            <button
              onClick={() => setLayout(layout === 'list' ? 'compare' : 'list')}
              className={`text-xs px-2 py-1 rounded transition-colors ${layout === 'compare'
                ? 'bg-blue-100 text-blue-600 border border-blue-200'
                : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50'
                }`}
              title={layout === 'list' ? '切换到对比视图' : '切换到列表视图'}
            >
              {layout === 'list' ? '📊' : '📋'}
            </button>
            {/* Export */}
            <button
              onClick={exportConversation}
              className="text-xs text-gray-400 hover:text-green-500 transition-colors px-2 py-1 rounded hover:bg-green-50"
              title="导出对话"
            >
              💾
            </button>
            {/* Debate */}
            <button
              onClick={() => setDebateMode(!debateMode)}
              className={`text-xs px-2 py-1 rounded transition-colors ${debateMode
                ? 'bg-purple-100 text-purple-600 border border-purple-200'
                : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'
                }`}
              title="辩论模式"
            >
              ⚔️
            </button>
            {/* Clear */}
            <button
              onClick={handleClear}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
              title="清空对话"
            >
              🗑️
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
      <main className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm h-full">
            选择模型并发送消息开始对话
          </div>
        )}

        {/* List Layout */}
        {layout === 'list' && messages.length > 0 && (
          <div className="space-y-6">
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
          </div>
        )}

        {/* Compare Layout */}
        {layout === 'compare' && messages.length > 0 && (
          <div className="space-y-4">
            {/* User Messages */}
            {messages.filter(m => m.role === 'user').map(msg => (
              <div key={msg.id} className="bg-blue-600 text-white rounded-xl p-3 text-sm">
                {msg.text}
              </div>
            ))}

            {/* Model Responses Grid */}
            {(() => {
              const modelMessages = messages.filter(m => m.role === 'model');
              const uniqueSources = [...new Set(modelMessages.map(m => m.source))];

              if (uniqueSources.length === 0) return null;

              return (
                <div className={`grid gap-3 ${uniqueSources.length >= 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {uniqueSources.map(source => {
                    const sourceMessages = modelMessages.filter(m => m.source === source);
                    const latestMsg = sourceMessages[sourceMessages.length - 1];

                    return (
                      <div key={source} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                        <div className="text-[10px] font-bold tracking-wider text-gray-400 mb-2 uppercase border-b pb-2">
                          {source}
                        </div>
                        {latestMsg && (
                          <div className="text-sm text-gray-700">
                            <MessageContent
                              content={latestMsg.text}
                              role={latestMsg.role}
                              source={latestMsg.source}
                              connectedModels={connectedModelList}
                              onForward={handleForward}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white border-t border-gray-100">
        {/* Prompt Templates */}
        {showSettings && (
          <div className="mb-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">📝 快速模板</span>
              <button
                onClick={() => setShowSettings(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {promptTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t.prompt)}
                  className="text-xs px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`absolute left-2 bottom-2 p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
            title="快速模板"
          >
            📝
          </button>
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
            className="w-full resize-none bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-12 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-inner"
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
