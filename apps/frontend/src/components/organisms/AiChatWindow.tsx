import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Maximize2, Minimize2 } from 'lucide-react';
import { AiMessageBubble } from '../atoms/AiMessageBubble';
import { AiTypingIndicator } from '../atoms/AiTypingIndicator';
import { AiInputArea } from '../molecules/AiInputArea';

interface AiChatWindowProps {
  onClose: () => void;
}

interface Message {
  role: 'ai' | 'user';
  content: string;
}

const API_URL = '/api/ai/ask';

export const AiChatWindow = ({ onClose }: AiChatWindowProps) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: '¡Hola! Soy tu Asesor de CastillaWeb.\n\nHe analizado tus inventarios y ventas en tiempo real. ¿En qué te ayudo a mejorar tu negocio hoy?' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  const handleSend = async (question: string) => {
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setIsProcessing(true);
    setMessages(prev => [...prev, { role: 'ai', content: '' }]);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Cookies para auth
        body: JSON.stringify({ question })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al conectar con la IA');
      }

      const body = response.body;
      if (!body) throw new Error('Cuerpo de respuesta vacío');

      const reader = body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunkString = decoder.decode(value);
        const events = chunkString.split('\n\n').filter(Boolean);
        
        for (const rawEvent of events) {
          if (rawEvent.startsWith('data: ')) {
            const jsonStr = rawEvent.replace('data: ', '');
            if (jsonStr === '[DONE]') continue;

            try {
              const data = JSON.parse(jsonStr);
              if (data.text) {
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastMsgIndex = newMsgs.length - 1;
                  const lastMsg = newMsgs[lastMsgIndex];
                  if (lastMsg) {
                    newMsgs[lastMsgIndex] = {
                      ...lastMsg,
                      content: lastMsg.content + data.text
                    };
                  }
                  return newMsgs;
                });
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error('Error parseando el chunk JSON', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Chat Error:', error);
      setMessages(prev => {
        const newMsgs = [...prev];
        const lastMsgIndex = newMsgs.length - 1;
        const lastMsg = newMsgs[lastMsgIndex];
        if (lastMsg) {
          newMsgs[lastMsgIndex] = {
            ...lastMsg,
            content: `⚠️ Disculpa, tuvimos un problema leyendo tus datos: ${error.message}`
          };
        }
        return newMsgs;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className={`fixed ${isExpanded ? 'bottom-4 right-4 w-[450px] h-[75vh]' : 'bottom-6 right-6 w-96 h-[550px]'} 
        z-50 bg-gray-900/95 backdrop-blur-2xl border border-gray-700/50 rounded-3xl shadow-2xl overflow-hidden flex flex-col font-sans transition-all duration-300 ease-in-out`}
        style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(16, 185, 129, 0.15)' }}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700/50">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-green-500 to-emerald-300 flex items-center justify-center p-0.5">
                <div className="w-full h-full bg-gray-900 rounded-full flex items-center justify-center">
                  <Bot className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-gray-900 rounded-full"></span>
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Socio Estratégico AI</h3>
              <p className="text-xs text-green-400 font-medium">CastillaWeb Premium</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 hover:bg-gray-700/50 rounded-lg text-gray-400 hover:text-white transition-colors">
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-red-500/20 rounded-lg text-gray-400 hover:text-red-400 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MESSAGES AREA */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gray-900 via-gray-900 to-black">
          {messages.map((msg, idx) => (
            <div key={idx}>
              {msg.role === 'ai' && !msg.content && isProcessing ? null : (
                <AiMessageBubble message={msg.content} isUser={msg.role === 'user'} />
              )}
            </div>
          ))}
          {isProcessing && <AiTypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <div className="p-4 border-t border-gray-800 bg-gray-900/50">
          <AiInputArea onSend={handleSend} isProcessing={isProcessing} />
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
