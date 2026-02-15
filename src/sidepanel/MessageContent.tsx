import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MessageContentProps {
    content: string;
    role?: 'user' | 'model';
    source?: string;
    showCopyButton?: boolean;
    connectedModels?: string[];
    onForward?: (text: string, targetModel: string) => void;
}

export const MessageContent: React.FC<MessageContentProps> = ({
    content,
    role,
    source,
    showCopyButton = true,
    connectedModels = [],
    onForward
}) => {
    const [copied, setCopied] = useState(false);
    const [showForwardMenu, setShowForwardMenu] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleForward = (targetModel: string) => {
        if (onForward) {
            // 发送时包含来源信息
            const forwardText = `以下是${source || 'AI'}的回答，请评价或补充：\n\n${content}`;
            onForward(forwardText, targetModel);
        }
        setShowForwardMenu(false);
    };

    // 过滤掉当前消息的来源模型
    const availableModels = connectedModels.filter(m => m !== source);

    return (
        <div className="message-content-wrapper">
            <div className="message-content prose prose-sm max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent prose-blockquote:my-0 prose-blockquote:p-0 prose-blockquote:border-0 prose-blockquote:not-italic">
                <ReactMarkdown
                    components={{
                        code({ node, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            const isInline = !match && !className;

                            if (isInline) {
                                return (
                                    <code className="inline-code" {...props}>
                                        {children}
                                    </code>
                                );
                            }

                            return (
                                <div className="code-block-wrapper">
                                    <div className="code-block-header">
                                        <span className="code-language">{match ? match[1] : 'code'}</span>
                                        <button
                                            className="code-copy-btn"
                                            onClick={() => {
                                                navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
                                            }}
                                        >
                                            复制
                                        </button>
                                    </div>
                                    <SyntaxHighlighter
                                        style={oneDark}
                                        language={match ? match[1] : 'text'}
                                        PreTag="div"
                                        customStyle={{
                                            margin: 0,
                                            borderRadius: '0 0 8px 8px',
                                            fontSize: '13px',
                                        }}
                                    >
                                        {String(children).replace(/\n$/, '')}
                                    </SyntaxHighlighter>
                                </div>
                            );
                        },
                        table({ children }) {
                            return (
                                <div className="table-wrapper">
                                    <table>{children}</table>
                                </div>
                            );
                        },
                        blockquote({ children }) {
                            return <blockquote className="blockquote">{children}</blockquote>;
                        },
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>

            {showCopyButton && role === 'model' && (
                <div className="message-actions">
                    <button
                        className={`action-btn ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title="复制回答"
                    >
                        {copied ? '✓ 已复制' : '📋 复制'}
                    </button>

                    {availableModels.length > 0 && onForward && (
                        <div className="forward-dropdown">
                            <button
                                className="action-btn"
                                onClick={() => setShowForwardMenu(!showForwardMenu)}
                                title="转发给其他AI"
                            >
                                🔄 转发
                            </button>
                            {showForwardMenu && (
                                <div className="forward-menu">
                                    {availableModels.map(model => (
                                        <button
                                            key={model}
                                            className="forward-menu-item"
                                            onClick={() => handleForward(model)}
                                        >
                                            → {model.charAt(0).toUpperCase() + model.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default MessageContent;

