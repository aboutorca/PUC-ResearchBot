import express from 'express';
import cors from 'cors';
import { DynamicPUCResearchService } from './services/ai.js';

const app = express();
const port = 3002; // Port for the backend server

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Enable JSON body parsing

const researchService = new DynamicPUCResearchService();
let isServiceInitialized = false;

// Initialize the service once at startup
researchService.initialize()
  .then(() => {
    isServiceInitialized = true;
    console.log('✅ Backend service initialized and ready.');
  })
  .catch(error => {
    console.error('🚨 Failed to initialize backend service:', error);
    process.exit(1); // Exit if service fails to initialize
  });

// API Endpoints

// Endpoint to check service status
app.get('/api/status', (req, res) => {
  if (isServiceInitialized) {
    res.json({ success: true, message: 'Service is initialized' });
  } else {
    res.status(503).json({ success: false, message: 'Service is not ready' });
  }
});

// Endpoint to initialize a research session (now handles mode)
app.post('/api/initialize', async (req, res) => {
  try {
    const { testMode } = req.body;
    // The service is already initialized at startup, so we just create a session ID.
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`✅ New session created: ${sessionId} in ${testMode ? 'Test' : 'Live'} Mode`);
    
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
    const { query, utilityType, fromYear, toYear, testMode } = req.body;
    const result = await researchService.startResearch(
      query,
      'user-from-frontend',
      utilityType,
      { start: fromYear, end: toYear },
      testMode
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint for chat
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    const result = await researchService.generateChatResponse(message, sessionId);
    res.json({ success: true, message: result.message, citations: result.citations });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Backend server listening on http://localhost:${port}`);
});
