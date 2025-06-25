import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const router = Router();

// In-memory store for chat sessions (in production, use a database)
const chatSessions = new Map();

// Create a new chat session
router.post('/sessions', (req, res) => {
  const sessionId = uuidv4();
  chatSessions.set(sessionId, []);
  res.status(201).json({ sessionId });
});

/**
 * @route   POST /api/chat/:sessionId/message
 * @desc    Send a chat message and get a response
 * @access  Public
 */
router.post('/:sessionId/message', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required and must be a string' });
    }

    const session = chatSessions.get(sessionId) || [];
    const userMessage = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };

    // Add user message to session
    session.push(userMessage);
    chatSessions.set(sessionId, session);

    // Call OpenRouter API
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: process.env.AI_MODEL_CHAT || 'anthropic/claude-3.5-sonnet',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful research assistant for the Idaho Public Utilities Commission. Provide accurate and concise information.'
          },
          ...session.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const aiResponse = response.data.choices[0].message;
    const assistantMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: aiResponse.content,
      timestamp: new Date().toISOString()
    };

    // Add assistant response to session
    session.push(assistantMessage);
    chatSessions.set(sessionId, session);

    // In a real implementation, uncomment and use this:
    // await saveChatMessage(sessionId, userMessage);
    // await saveChatMessage(sessionId, assistantMessage);

    res.json({
      response: assistantMessage,
      sessionId
    });
  } catch (error) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ 
      error: 'Failed to process chat message',
      details: error.response?.data || error.message 
    });
  }
});

/**
 * @route   GET /api/chat/:sessionId/history
 * @desc    Get chat history for a session
 * @access  Public
 */
router.get('/:sessionId/history', (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = chatSessions.get(sessionId) || [];

    if (!messages.length) {
      return res.status(404).json({ error: 'Chat session not found or empty' });
    }
    
    res.json({
      sessionId,
      messages,
    });
  } catch (error) {
    console.error('Error getting chat history:', error);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

// Note: The following function is not currently used but will be needed when integrating with Supabase
/*
async function saveChatMessage(sessionId, message) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert([
      {
        session_id: sessionId,
        role: message.role,
        content: message.content,
        created_at: message.timestamp
      }
    ]);

  if (error) {
    console.error('Error saving chat message:', error);
    throw error;
  }
  return data;
}
*/

export default router;
