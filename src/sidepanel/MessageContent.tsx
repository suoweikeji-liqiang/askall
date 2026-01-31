import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MessageContentProps {
    content: string;
    role?: 'user' | 'model';
    showCopyButton?: boolean;
}

export const MessageContent: React.FC<MessageContentProps> = ({
    content,
    role,
    showCopyButton = true
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <div className="message-content-wrapper">
            <div className="message-content">
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
                        // 表格样式
                        table({ children }) {
                            return (
                                <div className="table-wrapper">
                                    <table>{children}</table>
                                </div>
                            );
                        },
                        // 引用块样式
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
                        className={`copy-btn ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title="复制回答"
                    >
                        {copied ? '✓ 已复制' : '📋 复制'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default MessageContent;
