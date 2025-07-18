import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import './ChatPanel.css';

// Use relative path for Docker nginx proxy, fallback to localhost for development
const API_BASE = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:8000';

const ChatPanel = ({ expanded, onToggle }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [serviceType, setServiceType] = useState('agents');
  const [isLoading, setIsLoading] = useState(false);
  const [availableAgents, setAvailableAgents] = useState({});
  const [currentAgent, setCurrentAgent] = useState('chat_agent');
  const [sessionId, setSessionId] = useState(`session_${Date.now()}`);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Load available agents when component mounts
    loadAvailableAgents();
  }, []);

  const loadAvailableAgents = async () => {
    try {
      const response = await axios.get(`${API_BASE}/chat/agents/available`);
      if (response.data.status === 'success') {
        setAvailableAgents(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  };

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
      let response;
      
      // Get last 5 messages for context (excluding the current message we just added)
      const recentMessages = messages.slice(-5).map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text
      }));
      
      if (serviceType === 'agents') {
        // Use the new OpenAI agents service
        response = await axios.post(`${API_BASE}/chat/agents`, {
          current_message: inputMessage,
          prior_messages: recentMessages,
          user_id: 'user_' + Date.now(),
          agent: currentAgent,
          session_id: sessionId
        });
        
        const aiMessage = {
          id: Date.now() + 1,
          text: response.data.content,
          sender: 'ai',
          serviceType: 'agents',
          agent: response.data.agent,
          timestamp: new Date().toLocaleTimeString(),
          metadata: response.data.metadata || {}
        };
        
        setMessages(prev => [...prev, aiMessage]);
        
        // Update current agent if it changed
        if (response.data.agent && response.data.agent !== currentAgent) {
          setCurrentAgent(response.data.agent);
        }
        
      } else {
        // Use legacy services
        response = await axios.post(`${API_BASE}/${serviceType}`, {
          message: inputMessage,
          context: {
            prior_messages: recentMessages
          }
        });

        const aiMessage = {
          id: Date.now() + 1,
          text: formatResponse(response.data, serviceType),
          sender: 'ai',
          serviceType,
          timestamp: new Date().toLocaleTimeString()
        };

        setMessages(prev => [...prev, aiMessage]);
      }
      
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        text: `Error: ${error.response?.data?.detail || error.message}`,
        sender: 'error',
        timestamp: new Date().toLocaleTimeString()
      };
      setMessages(prev => [...prev, errorMessage]);
      toast.error('Failed to send message');
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

  const clearConversation = async () => {
    try {
      if (serviceType === 'agents') {
        await axios.post(`${API_BASE}/chat/agents/clear`);
      }
      setMessages([]);
      setSessionId(`session_${Date.now()}`); // Generate new session ID
      toast.success('Conversation cleared');
    } catch (error) {
      console.error('Failed to clear conversation:', error);
      toast.error('Failed to clear conversation');
    }
  };

  const getAgentIcon = (agentName) => {
    const icons = {
      'chat_agent': '💬',
      'creation_agent': '➕',
      'sql_agent': '📊',
      'update_agent': '✏️'
    };
    return icons[agentName] || '🤖';
  };

  const getAgentName = (agentName) => {
    return availableAgents[agentName]?.name || agentName;
  };

  const getAgentDescription = (agentName) => {
    return availableAgents[agentName]?.description || '';
  };

  if (!expanded) {
    return (
      <>
        <button className="chat-toggle" onClick={onToggle}>
          💬
        </button>
      </>
    );
  }

  return (
    <>
      <div className="chat-panel expanded">
        <div className="chat-header">
          <h3>AI Assistant</h3>
          <button onClick={onToggle}>
            ✕
          </button>
        </div>

        <div className="service-selector">
          <select 
            value={serviceType} 
            onChange={(e) => setServiceType(e.target.value)}
            className="service-dropdown"
          >
            <option value="agents">🤖 AI Agents (Recommended)</option>
            <option value="chat">💬 Chat (LLM)</option>
            <option value="agent">🔗 Agent (LangChain)</option>
            <option value="plan_execute">📋 Plan & Execute</option>
          </select>
        </div>

        {serviceType === 'agents' && (
          <div className="agent-info">
            <div className="agent-icon">
              {getAgentIcon(currentAgent)}
            </div>
            <div>
              <strong>{getAgentName(currentAgent)}</strong>
              <div>{getAgentDescription(currentAgent)}</div>
            </div>
          </div>
        )}

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="message ai">
              <div className="message-content">
                <p>👋 Hello! I'm your AI assistant for financial forecasting. I can help you with:</p>
                <ul>
                  <li>📊 Data analysis and reporting</li>
                  <li>➕ Creating new records (customers, products, forecasts)</li>
                  <li>✏️ Updating existing data</li>
                  <li>💬 General questions about your forecast system</li>
                </ul>
                <p>What would you like to work on today?</p>
              </div>
            </div>
          )}
          
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.sender}`}>
              <div className="message-header">
                <span className="sender">
                  {message.sender === 'user' ? 'You' : 
                   message.sender === 'ai' ? (
                     <>
                       <div className="agent-icon">
                         {message.agent ? getAgentIcon(message.agent) : '🤖'}
                       </div>
                       {message.agent ? getAgentName(message.agent) : `AI (${message.serviceType || 'chat'})`}
                     </>
                   ) : 'Error'}
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
            placeholder="Ask about your forecast data, create records, or analyze data..."
            rows={3}
            disabled={isLoading}
          />
          <div className="chat-actions">
            <button 
              className="clear-button"
              onClick={clearConversation}
              disabled={messages.length === 0}
            >
              Clear Chat
            </button>
            <button 
              className="send-button"
              onClick={sendMessage}
              disabled={!inputMessage.trim() || isLoading}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ChatPanel; 