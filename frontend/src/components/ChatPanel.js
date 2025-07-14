import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './ChatPanel.css';

const API_BASE = 'http://localhost:8000';

const ChatPanel = ({ expanded, onToggle }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [serviceType, setServiceType] = useState('chat');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      text: inputMessage,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/${serviceType}`, {
        message: inputMessage,
        context: {}
      });

      const aiMessage = {
        id: Date.now() + 1,
        text: formatResponse(response.data, serviceType),
        sender: 'ai',
        serviceType,
        timestamp: new Date().toLocaleTimeString()
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        text: `Error: ${error.response?.data?.detail || error.message}`,
        sender: 'error',
        timestamp: new Date().toLocaleTimeString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatResponse = (data, type) => {
    if (type === 'plan_execute') {
      const plan = data.data.plan || [];
      const results = data.data.results || [];
      return `Plan:\n${plan.map((step, i) => `${i+1}. ${step}`).join('\n')}\n\nResults:\n${results.map((r, i) => `${i+1}. ${r.step}: ${r.result}`).join('\n')}`;
    } else if (type === 'agent') {
      return data.data.response || 'No response';
    } else {
      return data.data.explanation || data.data.response || 'No response';
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!expanded) {
    return (
      <div className="chat-panel collapsed">
        <button className="chat-toggle" onClick={onToggle}>
          💬
        </button>
      </div>
    );
  }

  return (
    <div className="chat-panel expanded">
      <div className="chat-header">
        <h3>AI Assistant</h3>
        <button className="btn btn-secondary btn-sm" onClick={onToggle}>
          ✕
        </button>
      </div>

      <div className="service-selector">
        <label>
          <input
            type="radio"
            name="service"
            value="chat"
            checked={serviceType === 'chat'}
            onChange={(e) => setServiceType(e.target.value)}
          />
          Chat (LLM)
        </label>
        <label>
          <input
            type="radio"
            name="service"
            value="agent"
            checked={serviceType === 'agent'}
            onChange={(e) => setServiceType(e.target.value)}
          />
          Agent (LangChain)
        </label>
        <label>
          <input
            type="radio"
            name="service"
            value="plan_execute"
            checked={serviceType === 'plan_execute'}
            onChange={(e) => setServiceType(e.target.value)}
          />
          Plan & Execute
        </label>
      </div>

      <div className="chat-messages">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.sender}`}>
            <div className="message-header">
              <span className="sender">
                {message.sender === 'user' ? 'You' : 
                 message.sender === 'ai' ? `AI (${message.serviceType || 'chat'})` : 'Error'}
              </span>
              <span className="timestamp">{message.timestamp}</span>
            </div>
            <div className="message-content">
              <pre>{message.text}</pre>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message ai">
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <textarea
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask about your forecast data..."
          rows={3}
          disabled={isLoading}
        />
        <button 
          className="btn btn-primary"
          onClick={sendMessage}
          disabled={!inputMessage.trim() || isLoading}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatPanel; 