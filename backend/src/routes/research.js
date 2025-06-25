import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// In-memory store for job status (in production, use a database)
const jobStatus = new Map();

// Note: The following import is not currently used but will be needed later
// import { supabase } from '../config/database.js';

/**
 * @route   POST /api/research/start
 * @desc    Start a new research job
 * @access  Public
 */
router.post('/start', async (req, res) => {
  try {
    const { urls, researchParameters } = req.body;
    const jobId = uuidv4();
    
    // Validate input
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'At least one URL is required' });
    }

    // Initialize job status
    const job = {
      id: jobId,
      status: 'pending',
      progress: 0,
      totalUrls: urls.length,
      processedUrls: 0,
      startTime: new Date().toISOString(),
      endTime: null,
      results: [],
      error: null
    };

    jobStatus.set(jobId, job);

    // Emit job creation event
    const io = req.app.get('io');
    io.to(`job-${jobId}`).emit('job-update', job);

    // Start processing in the background
    processResearchJob(job, urls, researchParameters, io);

    res.status(202).json({
      message: 'Research job started',
      jobId,
      statusUrl: `/api/research/${jobId}/status`
    });
  } catch (error) {
    console.error('Error starting research job:', error);
    res.status(500).json({ error: 'Failed to start research job', details: error.message });
  }
});

/**
 * @route   GET /api/research/:jobId/status
 * @desc    Get status of a research job
 * @access  Public
 */
router.get('/:jobId/status', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobStatus.get(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

/**
 * @route   GET /api/research/:jobId/progress
 * @desc    Get real-time progress of a research job (SSE)
 * @access  Public
 */
router.get('/:jobId/progress', (req, res) => {
  const { jobId } = req.params;
  const job = jobStatus.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial progress
  res.write(`data: ${JSON.stringify(job)}\n\n`);

  // Listen for updates
  const io = req.app.get('io');
  const listener = (updatedJob) => {
    if (updatedJob.id === jobId) {
      res.write(`data: ${JSON.stringify(updatedJob)}\n\n`);
      
      // Close connection if job is complete or failed
      if (['completed', 'failed'].includes(updatedJob.status)) {
        res.end();
      }
    }
  };

  // Listen for job updates
  io.on('job-update', listener);

  // Clean up on client disconnect
  req.on('close', () => {
    io.off('job-update', listener);
  });
});

/**
 * Process research job (simplified for now)
 */
async function processResearchJob(job, urls, parameters, io) {
  try {
    // Update job status to in-progress
    job.status = 'in-progress';
    jobStatus.set(job.id, job);
    io.to(`job-${job.id}`).emit('job-update', job);

    // Simulate processing each URL
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update progress
      job.processedUrls++;
      job.progress = Math.round((job.processedUrls / job.totalUrls) * 100);
      job.results.push({
        url,
        status: 'processed',
        summary: `Processed ${url}`,
        timestamp: new Date().toISOString()
      });
      
      // Save to Supabase (placeholder)
      // await saveResearchResult(job.id, url, {});
      
      // Emit progress update
      jobStatus.set(job.id, job);
      io.to(`job-${job.id}`).emit('job-update', job);
    }

    // Mark job as completed
    job.status = 'completed';
    job.endTime = new Date().toISOString();
    jobStatus.set(job.id, job);
    io.to(`job-${job.id}`).emit('job-update', job);
    
  } catch (error) {
    console.error('Error processing research job:', error);
    job.status = 'failed';
    job.error = error.message;
    job.endTime = new Date().toISOString();
    jobStatus.set(job.id, job);
    io.to(`job-${job.id}`).emit('job-update', job);
  }
}

// Note: The following function is not currently used but will be needed when integrating with Supabase
/*
async function saveResearchResult(jobId, url, data) {
  const { data: result, error } = await supabase
    .from('research_results')
    .insert([
      {
        job_id: jobId,
        url,
        data,
        created_at: new Date().toISOString()
      }
    ]);

  if (error) {
    console.error('Error saving research result:', error);
    throw error;
  }

  return result;
}
*/

export default router;
