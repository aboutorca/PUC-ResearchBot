/**
 * Dynamic AI Service - Idaho PUC Research Assistant
 * 
 * Features:
 * - Dynamic research per user query
 * - AI-powered keyword extraction and semantic search
 * - Context-aware document search (no embeddings needed)
 * - Smart context extraction around relevant keywords
 * - Citation system with exact document references
 */

import dotenv from 'dotenv';
dotenv.config();

import { crawlCases } from './crawler.js';
import { processExtractedDocuments } from './processor.js';

// Configuration
const CONFIG = {
  // OpenRouter for chat
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'google/gemini-2.5-flash-lite-preview-06-17'
  },
  
  // Processing parameters
  maxContextTokens: 800000,  // 80% of 1M token limit for safety
  contextParagraphs: 3,      // Paragraphs before/after keyword match
  maxSearchResults: 20,      // Maximum document sections to include
  keywordProximity: 500      // Characters around keyword for context
};

export class DynamicPUCResearchService {
  constructor() {
    this.currentSession = null;
    this.sessionDocuments = null; // Processed documents for current session
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      console.log('🚀 Dynamic AI Service initialized successfully (Keyword-based search)');
      return true;
    } catch (error) {
      console.error('Failed to initialize AI service:', error);
      throw error;
    }
  }

  /**
   * Start a new research session
   */
  async startResearch(query, userId = 'default', utilities = ['electric', 'natural_gas'], dateRange = { start: '2023-01-01', end: '2025-12-31' }, testMode = false) {
    try {
      console.log(`🔬 Starting research: "${query}"`);

      // Create new session
      const sessionId = `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.currentSession = {
        id: sessionId,
        user_id: userId,
        query: query,
        status: 'crawling'
      };

      // Start the research pipeline
      const researchResult = await this.conductResearch(sessionId, query, utilities, dateRange, testMode);
      
      return {
        sessionId,
        status: 'ready',
        query,
        summary: researchResult.summary,
        canChat: true
      };

    } catch (error) {
      console.error('Error starting research:', error);
      throw error;
    }
  }

  /**
   * Conduct the full research pipeline
   */
  async conductResearch(sessionId, query, utilities, dateRange, testMode) {
    try {
      console.log('📊 Step 1: Crawling documents...');

      // Run crawler
      let crawlerResults;
      if (testMode) {
        console.log('🧪 Using pre-loaded test data for research...');
        // In test mode, we load existing documents instead of crawling
        const result = await this.loadExistingDocuments('/Users/juandi/Downloads/extracted_texts/');
        return { summary: { totalDocuments: result.totalDocuments, companies: [], utilityTypes: [] }, chunks: this.sessionDocuments };
      } else {
        console.log('🌍 Crawling live data...');
        crawlerResults = await crawlCases(query, utilities, dateRange, 15);
      }
      
      console.log('📊 Step 2: Processing documents...');

      // Process documents into chunks
      const processedData = await processExtractedDocuments(crawlerResults);
      
      console.log('📊 Step 3: Preparing documents for keyword search...');

      // Store processed documents for search
      this.sessionDocuments = this.prepareDocumentsForSearch(processedData.chunks);
      
      console.log('📊 Step 4: Finalizing session...');
      
      const summary = {
        totalCases: crawlerResults.summary.totalCases,
        totalDocuments: crawlerResults.summary.totalDocuments,
        companies: crawlerResults.chatReadyData.companies,
        utilityTypes: crawlerResults.chatReadyData.utilityTypes,
        processingTime: crawlerResults.summary.processingTime,
        documentsByType: crawlerResults.summary.documentsByType,
        totalChunks: this.sessionDocuments.length
      };

      console.log(`✅ Research session ready! ${summary.totalDocuments} documents processed into ${summary.totalChunks} searchable chunks`);

      return { summary, chunks: this.sessionDocuments };

    } catch (error) {
      throw error;
    }
  }

  /**
   * Prepare documents for efficient keyword search
   */
  prepareDocumentsForSearch(chunks) {
    return chunks.map(chunk => ({
      id: chunk.id,
      content: chunk.content,
      contentLower: chunk.content.toLowerCase(), // Pre-compute for faster search
      metadata: {
        caseNumber: chunk.caseNumber,
        company: chunk.company,
        utilityType: chunk.utilityType,
        caseStatus: chunk.caseStatus,
        documentName: chunk.documentName,
        documentType: chunk.documentType,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber
      }
    }));
  }

  /**
   * Extract AI-powered keywords from user query
   */
  async extractSearchKeywords(userQuery) {
    try {
      console.log(`🧠 Extracting search keywords for: "${userQuery}"`);

      const keywordPrompt = `You are an expert at analyzing regulatory utility queries and extracting the most relevant search keywords.

Given this user question about Idaho utility regulation: "${userQuery}"

Extract the most important keywords and phrases that would help find relevant information in regulatory documents. Include:
1. Direct terms from the query
2. Related regulatory terminology
3. Utility industry synonyms
4. Relevant entities (companies, staff, commission)
5. Related concepts that might not use exact query words

Return ONLY a JSON array of keywords/phrases, ordered by importance. Include both single words and multi-word phrases.

Example format: ["rate increase", "tariff adjustment", "Idaho Power", "commission staff", "rate hike", "price adjustment"]

IMPORTANT: Respond with ONLY the JSON array, no other text or formatting.`;

      const response = await fetch(`${CONFIG.openRouter.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.openRouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://idaho-puc-research.local',
          'X-Title': 'Idaho PUC Research Assistant'
        },
        body: JSON.stringify({
          model: CONFIG.openRouter.chatModel,
          messages: [
            { role: 'user', content: keywordPrompt }
          ],
          temperature: 0.1,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const keywordResponse = data.choices[0].message.content.trim();

      // Enhanced JSON parsing with multiple fallback strategies
      try {
        // Strategy 1: Direct JSON parse
        const keywords = JSON.parse(keywordResponse);
        if (Array.isArray(keywords)) {
          console.log(`📝 Extracted keywords (direct parse):`, keywords.slice(0, 10));
          return keywords;
        }
      } catch (error) {
        console.log(`⚠️ Direct JSON parse failed, trying extraction methods...`);
      }

      try {
        // Strategy 2: Extract from markdown code blocks
        const codeBlockMatch = keywordResponse.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          const keywords = JSON.parse(codeBlockMatch[1]);
          if (Array.isArray(keywords)) {
            console.log(`📝 Extracted keywords (code block):`, keywords.slice(0, 10));
            return keywords;
          }
        }
      } catch (error) {
        console.log(`⚠️ Code block extraction failed, trying array detection...`);
      }

      try {
        // Strategy 3: Find JSON array in text
        const arrayMatch = keywordResponse.match(/\[[\s\S]*?\]/);
        if (arrayMatch) {
          const keywords = JSON.parse(arrayMatch[0]);
          if (Array.isArray(keywords)) {
            console.log(`📝 Extracted keywords (array detection):`, keywords.slice(0, 10));
            return keywords;
          }
        }
      } catch (error) {
        console.log(`⚠️ Array detection failed, trying line parsing...`);
      }

      try {
        // Strategy 4: Parse line by line if response is formatted differently
        const lines = keywordResponse.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//') && !line.startsWith('#'))
          .map(line => {
            // Remove quotes, bullets, dashes
            return line.replace(/^[•*]\s*/, '').replace(/^[\"']|[\"']$/g, '').trim();
          })
          .filter(line => line.length > 0);

        if (lines.length > 0) {
          console.log(`📝 Extracted keywords (line parsing):`, lines.slice(0, 10));
          return lines;
        }
      } catch (error) {
        console.log(`⚠️ Line parsing failed, falling back to simple extraction...`);
      }

      // Strategy 5: Fallback to simple keyword extraction
      console.warn('⚠️ All JSON parsing strategies failed, using simple extraction');
      console.log(`Raw response was: "${keywordResponse}"`);
      return this.simpleKeywordExtraction(userQuery);

    } catch (error) {
      console.error('Error extracting keywords:', error);
      // Final fallback to simple keyword extraction
      return this.simpleKeywordExtraction(userQuery);
    }
  }

  /**
   * Fallback simple keyword extraction
   */
  simpleKeywordExtraction(query) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'what', 'how', 'when', 'where', 'why']);
    
    const words = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    return [...new Set(words)]; // Remove duplicates
  }

  /**
   * Search documents using keywords and extract relevant context
   */
  async searchDocumentsByKeywords(keywords) {
    if (!this.sessionDocuments) {
      throw new Error('No documents loaded. Please start a research session first.');
    }

    console.log(`🔍 Searching ${this.sessionDocuments.length} documents for keywords...`);

    const searchResults = [];

    for (const doc of this.sessionDocuments) {
      const matches = this.findKeywordMatches(doc, keywords);
      
      if (matches.length > 0) {
        // Extract context around each match
        const contexts = matches.map(match => 
          this.extractContextAroundMatch(doc.content, match)
        );

        searchResults.push({
          document: doc,
          matches: matches,
          contexts: contexts,
          score: this.calculateRelevanceScore(matches),
          citation: this.formatCitation(doc.metadata)
        });
      }
    }

    // Sort by relevance score
    searchResults.sort((a, b) => b.score - a.score);

    console.log(`📊 Found ${searchResults.length} documents with keyword matches`);

    return searchResults.slice(0, CONFIG.maxSearchResults);
  }

  /**
   * Find keyword matches in document
   */
  findKeywordMatches(doc, keywords) {
    const matches = [];
    const content = doc.contentLower;

    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      let startIndex = 0;

      while (true) {
        const index = content.indexOf(keywordLower, startIndex);
        if (index === -1) break;

        matches.push({
          keyword: keyword,
          position: index,
          context: this.getContextSnippet(doc.content, index, 100)
        });

        startIndex = index + keywordLower.length;
      }
    }

    return matches;
  }

  /**
   * Extract context around a keyword match
   */
  extractContextAroundMatch(content, match) {
    const start = Math.max(0, match.position - CONFIG.keywordProximity);
    const end = Math.min(content.length, match.position + CONFIG.keywordProximity);
    
    return {
      context: content.slice(start, end).trim(),
      keyword: match.keyword,
      position: match.position
    };
  }

  /**
   * Get a short context snippet around a position
   */
  getContextSnippet(content, position, radius) {
    const start = Math.max(0, position - radius);
    const end = Math.min(content.length, position + radius);
    return content.slice(start, end).trim();
  }

  /**
   * Calculate relevance score for a document
   */
  calculateRelevanceScore(matches) {
    let score = 0;
    
    // Base score from number of matches
    score += matches.length;
    
    // Bonus for unique keywords matched
    const uniqueKeywords = new Set(matches.map(m => m.keyword.toLowerCase()));
    score += uniqueKeywords.size * 2;
    
    // Bonus for multiple matches of important keywords
    const keywordCounts = {};
    matches.forEach(match => {
      const key = match.keyword.toLowerCase();
      keywordCounts[key] = (keywordCounts[key] || 0) + 1;
    });
    
    // Extra points for frequently mentioned keywords
    Object.values(keywordCounts).forEach(count => {
      if (count > 1) score += count;
    });

    return score;
  }

  /**
   * Format citation for a document
   */
  formatCitation(metadata) {
    const { caseNumber, documentName, utilityType, pageNumber } = metadata;
    const page = pageNumber ? `, Page ${pageNumber}` : '';
    return `${caseNumber}, ${documentName}, ${utilityType}${page}`;
  }

  /**
   * Generate AI chat response using keyword search
   */
  async generateChatResponse(userMessage, sessionId = null) {
    try {
      console.log(`💬 Processing question: "${userMessage}"`);

      if (!this.sessionDocuments) {
        throw new Error('No research session loaded. Please start a research session first.');
      }

      // Step 1: Extract keywords using AI
      const keywords = await this.extractSearchKeywords(userMessage);

      // Step 2: Search documents for relevant content
      const searchResults = await this.searchDocumentsByKeywords(keywords);

      if (searchResults.length === 0) {
        return {
          type: "bot",
          message: "I couldn't find any documents containing relevant information for your question. Try rephrasing your query or using different terms.",
          citations: [],
          timestamp: new Date().toISOString(),
          sessionId: sessionId || this.currentSession?.id
        };
      }

      // Step 3: Build context from search results
      const contextSections = [];
      let currentTokens = 0;

      for (const result of searchResults) {
        // Combine all contexts from this document
        const docContext = result.contexts
          .map(ctx => ctx.context)
          .join('\n\n...\n\n');

        const section = `[Document: ${result.citation}]\n${docContext}`;
        const sectionTokens = this.estimateTokens(section);

        if (currentTokens + sectionTokens > CONFIG.maxContextTokens) {
          break; // Stop if we'd exceed token limit
        }

        contextSections.push(section);
        currentTokens += sectionTokens;
      }

      const context = contextSections.join('\n\n---\n\n');

      console.log(`📄 Using ${contextSections.length} document sections (${currentTokens.toLocaleString()} tokens)`);

      // Step 4: Generate AI response
      const systemPrompt = `You are an expert research assistant for the Idaho Public Utilities Commission. Analyze the provided regulatory documents and answer the user's question with accurate, well-cited information.

IMPORTANT CITATION RULES:
- Always cite specific documents when making claims
- Use the format: [Citation: case_number, document_title, utility_type, page]
- Include multiple citations when information comes from different sources
- Be precise about which document supports each claim

SEARCH CONTEXT:
${context}

Instructions:
1. Answer the user's question using ONLY the provided document context
2. Cite specific documents for each claim using the provided citation format
3. If the context doesn't fully answer the question, acknowledge what information is missing
4. Organize your response clearly with key findings
5. Use professional regulatory terminology`;

      const response = await fetch(`${CONFIG.openRouter.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.openRouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://idaho-puc-research.local',
          'X-Title': 'Idaho PUC Research Assistant'
        },
        body: JSON.stringify({
          model: CONFIG.openRouter.chatModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.1,
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponse = data.choices[0].message.content;

      // Extract citations from response
      const citationRegex = /\[Citation: ([^\]]+)\]/g;
      const citations = [];
      let match;
      
      while ((match = citationRegex.exec(aiResponse)) !== null) {
        citations.push(match[1]);
      }

      // Clean response (remove citation tags for display)
      const cleanResponse = aiResponse.replace(citationRegex, '').trim();

      console.log(`✅ Generated response with ${citations.length} citations`);

      return {
        type: "bot",
        message: cleanResponse,
        citations: [...new Set(citations)], // Remove duplicates
        timestamp: new Date().toISOString(),
        sessionId: sessionId || this.currentSession?.id,
        relevantDocuments: searchResults.length,
        keywordsUsed: keywords.slice(0, 5) // Include first 5 keywords for debugging
      };

    } catch (error) {
      console.error('Error generating chat response:', error);
      return {
        type: "bot",
        message: "I apologize, but I encountered an error processing your request. Please try again.",
        citations: [],
        timestamp: new Date().toISOString(),
        sessionId: sessionId || this.currentSession?.id
      };
    }
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * Load existing documents from local directory (for testing)
   */
  async loadExistingDocuments(documentsPath) {
    try {
      console.log(`📂 Loading existing documents from: ${documentsPath}`);
      
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const files = await fs.readdir(documentsPath);
      const txtFiles = files.filter(file => file.endsWith('.txt'));
      
      console.log(`📁 Found ${txtFiles.length} text files`);
      
      const allExtractedDocuments = [];
      
      for (const filename of txtFiles) {
        try {
          const filepath = path.join(documentsPath, filename);
          const content = await fs.readFile(filepath, 'utf8');
          
          // Parse metadata from filename and content
          const documentData = this.parseDocumentData(filename, content, filepath);
          allExtractedDocuments.push(documentData);
          
        } catch (error) {
          console.log(`⚠️ Error reading ${filename}:`, error.message);
        }
      }
      
      console.log(`✅ Successfully loaded ${allExtractedDocuments.length} documents`);
      
      // Create mock crawler results format
      const mockCrawlerResults = {
        allExtractedDocuments,
        summary: {
          totalDocuments: allExtractedDocuments.length,
          totalCases: new Set(allExtractedDocuments.map(doc => doc.caseNumber)).size,
        },
        chatReadyData: {
          companies: [...new Set(allExtractedDocuments.map(doc => doc.company))],
          utilityTypes: [...new Set(allExtractedDocuments.map(doc => doc.utilityType))],
        }
      };
      
      // Process documents using the existing processor
      const processedData = await processExtractedDocuments(mockCrawlerResults);
      
      // Store processed documents for search
      this.sessionDocuments = this.prepareDocumentsForSearch(processedData.chunks);
      
      console.log(`🔍 Prepared ${this.sessionDocuments.length} searchable chunks`);
      
      return {
        totalDocuments: allExtractedDocuments.length,
        totalChunks: this.sessionDocuments.length,
        ready: true
      };
      
    } catch (error) {
      console.error('❌ Error loading existing documents:', error);
      throw error;
    }
  }

  /**
   * Parse document metadata from filename and content
   */
  parseDocumentData(filename, content, filepath) {
    // Extract case number from filename (e.g., "AVU-E-25-01_DIRECT_TESTIMONY.txt")
    const caseNumberMatch = filename.match(/([A-Z]{2,4}-[A-Z]-\d{2}-\d{2})/);
    const caseNumber = caseNumberMatch ? caseNumberMatch[1] : 'UNKNOWN';
    
    // Extract company from case number
    const companyMap = {
      'AVU': 'Avista Utilities',
      'IPC': 'Idaho Power',
      'PAC': 'PacifiCorp', 
      'INT': 'Intermountain Gas'
    };
    const companyCode = caseNumber.split('-')[0];
    const company = companyMap[companyCode] || 'Unknown Company';
    
    // Extract utility type from case number
    const utilityType = caseNumber.includes('-E-') ? 'electric' : 
                       caseNumber.includes('-G-') ? 'natural_gas' : 'unknown';
    
    // Determine document type from filename
    const documentType = filename.includes('DIRECT') ? 'Company_Direct_Testimony' : 'Staff_Document';
    
    // Extract actual content (skip metadata section)
    let actualContent = content;
    const metadataEnd = content.indexOf('===== END METADATA =====');
    if (metadataEnd !== -1) {
      actualContent = content.substring(metadataEnd + 25).trim();
    }
    
    // Count pages
    const pageMatches = content.match(/--- PAGE \d+ ---/g);
    const pages = pageMatches ? pageMatches.length : 1;
    
    return {
      filename: filename.replace('.txt', ''),
      filepath: filepath,
      caseNumber: caseNumber,
      company: company,
      utilityType: utilityType,
      caseStatus: 'closed', // Assume closed for existing documents
      documentName: filename.replace('.txt', '').replace(/_/g, ' '),
      documentType: documentType,
      content: actualContent,
      textLength: actualContent.length,
      pages: pages,
      extractedAt: new Date().toISOString()
    };
  }
  getSessionStats() {
    return {
      documentsLoaded: this.sessionDocuments ? this.sessionDocuments.length : 0,
      sessionReady: !!(this.sessionDocuments && this.currentSession),
      currentSession: this.currentSession?.id || null
    };
  }
}

// Export the service
export default DynamicPUCResearchService;

// Convenience functions for easy integration
export const setupResearchService = async () => {
  const service = new DynamicPUCResearchService();
  await service.initialize();
  return service;
};

export const startNewResearch = async (service, query, userId, utilities, dateRange) => {
  return await service.startResearch(query, userId, utilities, dateRange);
};

export const chatWithResearch = async (service, message, sessionId) => {
  return await service.generateChatResponse(message, sessionId);
};