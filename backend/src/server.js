import express from 'express';
import cors from 'cors';
import { DynamicPUCResearchService } from './services/ai.js';

const app = express();
const port = 3002; // Port for the backend server

// Middleware
const corsOptions = {
  origin: 'http://localhost:3000', // Allow only the frontend to connect
  optionsSuccessStatus: 200 // For legacy browser support
};
app.use(cors(corsOptions)); // Enable CORS with specific options
app.use(express.json()); // Enable JSON body parsing

const researchService = new DynamicPUCResearchService();
let isServiceInitialized = false;



// API Endpoints

// Endpoint to check service status
app.get('/api/status', (req, res) => {
  if (isServiceInitialized) {
    res.json({ success: true, message: 'Service is initialized' });
  } else {
    res.status(503).json({ success: false, message: 'Service is not ready' });
  }
});

// Endpoint to initialize a research session
app.post('/api/initialize', async (req, res) => {
  try {
    // The service is already initialized at startup, so we just create a session ID.
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`✅ New session created: ${sessionId}`);
    
    // In a real multi-user app, we'd associate this session with a user.
    // For now, sending it back to the client is enough.
    res.json({ success: true, sessionId: sessionId });

  } catch (error) { 
    console.error('Error during session initialization:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint to start research
app.post('/api/research', async (req, res) => {
  try {
    const { query, utilityType, fromYear, toYear } = req.body;
    const result = await researchService.startResearch(
      query,
      'user-from-frontend',
      utilityType,
      { start: fromYear, end: toYear }
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint for chat
// Endpoint for document URL
app.post('/api/research/document-url', async (req, res) => {
  try {
    const { caseNumber, documentName } = req.body;
    if (!caseNumber || !documentName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const url = await researchService.getDocumentUrl(caseNumber, documentName);

    if (url) {
      res.json({ url });
    } else {
      // Fallback URL if no specific one is found
      const cleanCaseNumber = caseNumber.replace(/[^A-Z0-9-]/g, '');
      res.json({ url: `https://puc.idaho.gov/case/${cleanCaseNumber}` });
    }
  } catch (error) {
    console.error('API Error fetching document URL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint for chat - Updated for optimized backend
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    console.log(`💬 Chat request: sessionId=${sessionId}, message="${message}"`);
    
    const result = await researchService.generateChatResponse(message, sessionId);
    
    // ✅ RETURN STRUCTURED FORMAT (matches ChatMessage.tsx expectations)
    res.json({ 
      message: result.message, // Keep the FULL structured object
      citations: result.citations,
      sessionId: result.sessionId,
      // Optional metadata for debugging
      metadata: {
        tokensUsed: result.tokensUsed,
        relevantDocuments: result.relevantDocuments
      }
    });
  } catch (error) {
    console.error('❌ Chat endpoint error:', error);
    res.status(500).json({ 
      message: "I apologize, but I encountered an error processing your request. Please try again.",
      citations: [],
      sessionId: sessionId 
    });
  }
});

const startServer = async () => {
  try {
    await researchService.initialize();
    isServiceInitialized = true;
    console.log('✅ Backend service initialized and ready.');

    app.listen(port, () => {
      console.log(`🚀 Backend server listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('🚨 Failed to initialize backend service:', error);
    process.exit(1); // Exit if service fails to initialize
  }
};

startServer();
