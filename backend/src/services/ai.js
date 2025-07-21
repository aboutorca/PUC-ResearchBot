import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

import { crawlCases } from './crawler.js';
import { processExtractedDocuments } from './processor.js';

// Configuration
const CONFIG = {
  // OpenRouter for chat
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'google/gemini-2.5-flash'
  },
  
   // Processing parameters - optimized for better search
   maxContextTokens: 180000,  // ✅ REDUCED: More focused, high-quality context 
   contextParagraphs: 3,      
   maxSearchResults: 15,      // ✅ REDUCED: Focus on top-ranked results
   keywordProximity: 1000      // ✅ INCREASED: More context around matches
 };

export class DynamicPUCResearchService {
  constructor() {
    this.currentSession = null;
    this.sessionDocuments = null;
    this.chatSessions = new Map(); // For multi-turn conversation
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      if (!CONFIG.openRouter.apiKey) {
        throw new Error('OPENROUTER_API_KEY is missing. Please check your .env file.');
      }
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
   * FIXED: Prepare documents for search - PRESERVE structured data
   */
  prepareDocumentsForSearch(chunks) {
    return chunks.map(chunk => ({
      id: chunk.id,
      content: chunk.content,
      contentLower: chunk.content.toLowerCase(),
      // PRESERVE STRUCTURED DATA
      structured: chunk.structured || null,
      metadata: {
        caseNumber: chunk.caseNumber,
        company: chunk.company,
        utilityType: chunk.utilityType,
        caseStatus: chunk.caseStatus,
        documentName: chunk.documentName,
        documentType: chunk.documentType,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        documentUrl: chunk.documentUrl
      }
    }));
  }

  /**
   * Extract AI-powered keywords from user query
   */
  async extractSearchKeywords(userQuery) {
    try {
      console.log(` Extracting search keywords for: "${userQuery}"`);

      // ENHANCED: Add rate-specific keywords for better targeting
      const rateSpecificPrompt = `Extract search keywords for this Idaho utility regulation query: "${userQuery}"

IMPORTANT: Since this is about utility rates, prioritize these types of keywords:
1. Rate-related terms: "rate of return", "ROE", "return on equity", "authorized rate", "cost of capital"
2. Document types: "direct testimony", "testimony", "direct"  
3. Company names: "Idaho Power", "Avista", "PacifiCorp", "Intermountain Gas"
4. Process terms: "rate case", "application", "request"

Return ONLY a JSON array of keywords, ordered by importance for finding rate testimony.

Format: ["keyword1", "keyword2", "keyword3"]

Query: ${userQuery}`;

      const response = await fetch(`${CONFIG.openRouter.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.openRouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://idaho-puc-research.local',
          'X-Title': 'Idaho PUC Research Assistant'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash', // Fast model for keywords
          messages: [
            { role: 'user', content: rateSpecificPrompt }
          ],
          temperature: 0.1,
          max_tokens: 200
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const keywordResponse = data.choices[0].message.content.trim();

      console.log(` Raw keyword response: "${keywordResponse}"`);

      // Enhanced JSON parsing with better error handling
      try {
        const keywords = JSON.parse(keywordResponse);
        if (Array.isArray(keywords) && keywords.length > 0) {
          console.log(` Extracted keywords (direct parse):`, keywords);
          return this.enhanceWithRateKeywords(keywords, userQuery);
        }
      } catch (error) {
        console.log(` Direct JSON parse failed: ${error.message}`);
      }

      try {
        const codeBlockMatch = keywordResponse.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          const keywords = JSON.parse(codeBlockMatch[1]);
          if (Array.isArray(keywords)) {
            console.log(` Extracted keywords (code block):`, keywords);
            return this.enhanceWithRateKeywords(keywords, userQuery);
          }
        }
      } catch (error) {
        console.log(` Code block extraction failed: ${error.message}`);
      }

      try {
        const arrayMatch = keywordResponse.match(/(\[[\s\S]*?\])/);
        if (arrayMatch) {
          const keywords = JSON.parse(arrayMatch[0]);
          if (Array.isArray(keywords)) {
            console.log(`✅ Extracted keywords (array detection):`, keywords);
            return this.enhanceWithRateKeywords(keywords, userQuery);
          }
        }
      } catch (error) {
        console.log(`⚠️ Array detection failed: ${error.message}`);
      }

      // Final fallback
      console.warn('⚠️ All keyword extraction failed, using enhanced simple extraction');
      return this.enhanceWithRateKeywords(this.simpleKeywordExtraction(userQuery), userQuery);

    } catch (error) {
      console.error('Error extracting keywords:', error);
      return this.enhanceWithRateKeywords(this.simpleKeywordExtraction(userQuery), userQuery);
    }
  }

  /**
   * ✅ NEW: Enhance keywords with rate-specific terms
   */
  enhanceWithRateKeywords(baseKeywords, userQuery) {
    const enhancedKeywords = [...baseKeywords];
    
    // Add rate-specific keywords if the query is about rates
    if (userQuery.toLowerCase().includes('rate') || userQuery.toLowerCase().includes('return')) {
      const rateKeywords = [
        'rate of return',
        'return on equity', 
        'ROE',
        'authorized rate',
        'cost of capital',
        'direct testimony',
        'testimony'
      ];
      
      rateKeywords.forEach(keyword => {
        if (!enhancedKeywords.some(k => k.toLowerCase().includes(keyword.toLowerCase()))) {
          enhancedKeywords.push(keyword);
        }
      });
    }
    
    // Always add "direct" to prioritize direct testimony
    if (!enhancedKeywords.includes('direct')) {
      enhancedKeywords.push('direct');
    }
    
    console.log(`🎯 Enhanced keywords:`, enhancedKeywords);
    return enhancedKeywords;
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
   * 🔍 DEBUG: Scan all chunks for rate-related content
   */
  debugScanAllChunksForRates() {
    console.log(`\n🔍 DEBUG: Scanning all ${this.sessionDocuments.length} chunks for rate content...`);
    
    const rateTerms = [
      'rate of return',
      'return on equity', 
      'ROE',
      'authorized rate',
      'cost of capital',
      'rate increase',
      '10.5%',
      '9.5%',
      '10.25%',
      'percent',
      'percentage',
      'basis points'
    ];
    
    const foundChunks = new Map();
    let totalMatches = 0;
    
    for (const chunk of this.sessionDocuments) {
      const content = chunk.content.toLowerCase();
      const chunkMatches = [];
      
      for (const term of rateTerms) {
        if (content.includes(term.toLowerCase())) {
          chunkMatches.push(term);
          totalMatches++;
        }
      }
      
      if (chunkMatches.length > 0) {
        const key = `${chunk.metadata.caseNumber} - ${chunk.metadata.documentName}`;
        if (!foundChunks.has(key)) {
          foundChunks.set(key, []);
        }
        foundChunks.get(key).push({
          page: chunk.metadata.pageNumber,
          chunkIndex: chunk.chunkIndex,
          matches: chunkMatches,
          preview: chunk.content.substring(0, 300)
        });
      }
    }
    
    console.log(`📊 RATE CONTENT SCAN RESULTS:`);
    console.log(`   Total chunks scanned: ${this.sessionDocuments.length}`);
    console.log(`   Chunks with rate content: ${Array.from(foundChunks.values()).flat().length}`);
    console.log(`   Documents with rate content: ${foundChunks.size}`);
    console.log(`   Total term matches: ${totalMatches}`);
    
    if (foundChunks.size === 0) {
      console.log(`❌ NO RATE CONTENT FOUND IN ANY CHUNKS!`);
      console.log(`   This suggests the chunking process may not be capturing rate testimony.`);
      
      // Sample a few chunks to see what we DO have
      console.log(`\n📄 SAMPLE OF WHAT WE DO HAVE (first 5 chunks):`);
      this.sessionDocuments.slice(0, 5).forEach((chunk, index) => {
        console.log(`   ${index + 1}. ${chunk.metadata.caseNumber} - ${chunk.metadata.documentName}, page ${chunk.metadata.pageNumber}`);
        console.log(`      Content: "${chunk.content.substring(0, 200)}..."`); 
      });
    } else {
      console.log(`\n🎯 FOUND RATE CONTENT IN THESE DOCUMENTS:`);
      for (const [docName, chunks] of foundChunks.entries()) {
        console.log(`\n📄 ${docName}:`);
        chunks.slice(0, 3).forEach(chunk => {  // Show first 3 chunks per document
          console.log(`   Page ${chunk.page}, Chunk ${chunk.chunkIndex}: [${chunk.matches.join(', ')}]`);
          console.log(`   Preview: "${chunk.preview}..."`); 
        });
        if (chunks.length > 3) {
          console.log(`   ... and ${chunks.length - 3} more chunks with rate content`);
        }
      }
    }
    
    return foundChunks;
  }

  /**
   * ✅ ENHANCED: Advanced keyword search with better ranking
   */
  enhancedKeywordSearch(query, maxResults = 15) {
    console.log(`\n🔍 Enhanced search for: "${query}"`);
    
    // Extract rate-specific keywords
    const rateKeywords = [
      'rate of return', 'authorized rate', 'ROE', 'return on equity',
      'rate increase', 'rate adjustment', 'revenue requirement',
      'percent', '%', 'basis points', 'cost of capital',
      'rate case', 'general rate', 'tariff'
    ];
    
    const searchTerms = this.extractKeywords(query);
    console.log(`📋 Search terms: ${searchTerms.join(', ')}`);
    
    const scoredChunks = this.sessionDocuments.map((chunk, index) => {
      const content = chunk.content.toLowerCase();
      const source = chunk.metadata.documentName || '';
      
      // Base keyword scoring
      let score = 0;
      let matchedTerms = [];
      
      searchTerms.forEach(term => {
        const termLower = term.toLowerCase();
        const matches = (content.match(new RegExp(termLower, 'g')) || []).length;
        score += matches * (term.length > 3 ? 2 : 1);
        if (matches > 0) matchedTerms.push(term);
      });
      
      // Rate-specific bonus scoring
      rateKeywords.forEach(rateTerm => {
        const matches = (content.match(new RegExp(rateTerm.toLowerCase(), 'g')) || []).length;
        if (matches > 0) {
          score += matches * 5; // High bonus for rate terms
          matchedTerms.push(rateTerm);
        }
      });
      
      // CRITICAL: Penalize appendix content heavily
      const isAppendix = this.isAppendixContent(chunk, source);
      if (isAppendix) {
        score *= 0.1; // Reduce appendix scores by 90%
        console.log(`⚠️  Appendix penalty applied to ${source} page ${chunk.metadata.pageNumber || 'unknown'}`);
      }
      
      // Boost main testimony documents
      const isDirectTestimony = source.toLowerCase().includes('direct') && 
                               !source.toLowerCase().includes('exhibit');
      if (isDirectTestimony) {
        score *= 2; // Double score for direct testimony
      }
      
      // Page-based scoring - earlier pages often more important
      const pageNum = parseInt(chunk.metadata.pageNumber) || 999;
      if (pageNum < 50) score *= 1.5; // Boost early pages
      if (pageNum > 1000) score *= 0.3; // Heavily penalize very late pages
      
      return {
        index,
        chunk,
        score,
        matchedTerms,
        isAppendix,
        pageNum
      };
    }).filter(item => item.score > 0);
    
    // Sort by score descending
    scoredChunks.sort((a, b) => b.score - a.score);
    
    console.log(`📊 Found ${scoredChunks.length} matching chunks`);
    
    // Debug top results
    console.log('\n🎯 TOP 5 SEARCH RESULTS:');
    scoredChunks.slice(0, 5).forEach((item, i) => {
      console.log(`${i + 1}. Score: ${item.score.toFixed(1)} | Page: ${item.pageNum} | ${item.isAppendix ? 'APPENDIX' : 'MAIN'}`);
      console.log(`   Source: ${item.chunk.metadata.documentName}`);
      console.log(`   Terms: [${item.matchedTerms.join(', ')}]`);
      console.log(`   Preview: ${item.chunk.content.substring(0, 100)}...`);
      console.log('');
    });
    
    return scoredChunks.slice(0, maxResults).map(item => item.chunk);
  }

  /**
   * Helper method to identify appendix content
   */
  isAppendixContent(chunk, source) {
    const content = chunk.content.toLowerCase();
    const sourceLower = source.toLowerCase();
    const pageNum = parseInt(chunk.metadata.pageNumber) || 0;
    
    // Multiple indicators of appendix content
    const appendixIndicators = [
      // High page numbers (usually appendices)
      pageNum > 1000,
      
      // Meeting notes content
      content.includes('meeting notes') || content.includes('attendees:'),
      
      // Exhibit appendices
      sourceLower.includes('exhibits') && pageNum > 100,
      
      // Technical appendices
      content.includes('appendix a') || content.includes('appendix b'),
      
      // Reference lists
      content.includes('bibliography') || content.includes('references'),
      
      // Data tables without context
      (content.match(/\d+\s+\d+\s+\d+/g) || []).length > 10 && content.length < 2000,
      
      // Administrative content
      content.includes('certificate of service') || content.includes('verification')
    ];
    
    return appendixIndicators.some(indicator => indicator);
  }

  /**
   * Enhanced context building with better document selection
   */
  buildContextWithEnhancedRanking(searchResults, query) {
    console.log('\n📄 ENHANCED CONTEXT BUILDING:');
    
    let context = '';
    let totalTokens = 0;
    const maxTokens = CONFIG.maxContextTokens * 0.8; // Leave room for prompt
    const citations = [];
    
    // Group by document to avoid too many chunks from same appendix
    const docGroups = {};
    searchResults.forEach(chunk => {
      const docKey = chunk.metadata.documentName;
      if (!docGroups[docKey]) docGroups[docKey] = [];
      docGroups[docKey].push(chunk);
    });
    
    // Limit chunks per document (especially for appendices)
    const balancedResults = [];
    Object.entries(docGroups).forEach(([docName, chunks]) => {
      const isAppendix = this.isAppendixContent(chunks[0], docName);
      const limit = isAppendix ? 1 : 3; // Max 1 chunk from appendices, 3 from main docs
      balancedResults.push(...chunks.slice(0, limit));
    });
    
    balancedResults.forEach((chunk, index) => {
      const chunkTokens = Math.ceil(chunk.content.length / 4);
      if (totalTokens + chunkTokens > maxTokens) return;
      
      const docInfo = this.formatCitationObject(chunk.metadata);
      context += `=== DOCUMENT: ${docInfo.documentName} ===\n`;
      context += `Company: ${docInfo.utilityType}\n`;
      context += `Case: ${docInfo.caseNumber}\n`;
      context += `Page: ${chunk.metadata.pageNumber || 'unknown'}\n\n`;
      context += `CONTENT:\n${chunk.content}\n\n`;
      
      totalTokens += chunkTokens;
      
      if (docInfo.documentUrl) {
        citations.push({
          caseNumber: docInfo.caseNumber,
          documentName: docInfo.documentName,
          documentUrl: docInfo.documentUrl,
          utilityType: docInfo.utilityType,
          pageNumber: chunk.metadata.pageNumber || 'unknown'
        });
      }
    });
    
    console.log(`📊 Context built: ${balancedResults.length} chunks, ${totalTokens} tokens`);
    return { context, citations };
  }

  /**
   * Extract keywords from query (simple version)
   */
  extractKeywords(query) {
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
    
    // 🔍 DEBUG: Scan for rate content before doing the actual search
    const rateContentScan = this.debugScanAllChunksForRates();

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
          citation: this.formatCitationObject(doc.metadata) // ✅ RETURN OBJECT WITH URL
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
   * ✅ NEW: Format citation as OBJECT with URL instead of string
   */
  formatCitationObject(metadata) {
    const { caseNumber, documentName, utilityType, pageNumber, documentUrl } = metadata;
    
    return {
      caseNumber: caseNumber,
      documentName: documentName,
      utilityType: utilityType,
      pageNumber: pageNumber,
      // ✅ INCLUDE THE ACTUAL DOCUMENT URL FROM CHUNK METADATA
      documentUrl: documentUrl || null,
      // Legacy string format for backwards compatibility
      text: `${caseNumber}, ${documentName}, ${utilityType}${pageNumber ? `, Page ${pageNumber}` : ''}`
    };
  }

  /**
   * LEGACY: Format citation string (kept for compatibility)
   */
  formatCitation(metadata) {
    const { caseNumber, documentName, utilityType, pageNumber } = metadata;
    const page = pageNumber ? `, Page ${pageNumber}` : '';
    return `${caseNumber}, ${documentName}, ${utilityType}${page}`;
  }

  /**
   * ✅ HYBRID CITATION SYSTEM: Natural flow + clickable URLs
   * Generates chat response with natural citations and post-processed URLs
   */
  async generateChatResponse(userMessage, sessionId = null) {
    const currentSessionId = sessionId || crypto.randomUUID();
    
    try {
      const chatHistory = this.chatSessions.get(currentSessionId) || [];
      console.log(`💬 Processing question: "${userMessage}" for session: ${currentSessionId}`);

      chatHistory.push({ role: 'user', content: userMessage });

      if (!this.sessionDocuments) {
        throw new Error('No research session loaded. Please start a research session first.');
      }

      // ✅ DIAGNOSTIC: Check structured data availability
      const structuredChunks = this.sessionDocuments.filter(chunk => chunk.structured).length;
      const totalChunks = this.sessionDocuments.length;
      console.log(`🔬 DIAGNOSTIC:`);
      console.log(`   Chunks with JSON structure: ${structuredChunks}/${totalChunks} (${Math.round(structuredChunks/totalChunks*100)}%)`);

      // ✅ Use enhanced search
      const searchResults = structuredChunks > 0 ? 
        this.enhancedJSONSearch(userMessage) : 
        this.enhancedKeywordSearch(userMessage);

      if (searchResults.length === 0) {
        const noResultResponse = {
          type: "bot",
          message: {
            answer: "I couldn't find any documents containing relevant information for your question. Try rephrasing your query or using different terms.",
            keyFindings: [],
            citations: [],
            confidence: "low",
            caveat: "No relevant documents found in the current dataset."
          },
          citations: [],
          timestamp: new Date().toISOString(),
          sessionId: currentSessionId
        };
        chatHistory.push({ role: 'assistant', content: JSON.stringify(noResultResponse.message) });
        this.chatSessions.set(currentSessionId, chatHistory);
        return noResultResponse;
      }

      // Limit chunks for optimal performance
      const topChunks = searchResults.slice(0, 12);
      
      // ✅ BUILD NATURAL CITATION PROMPT
      const conversationContext = chatHistory.length > 0 
        ? chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n') 
        : 'New conversation.';

      const naturalPrompt = this.buildNaturalCitationPrompt(topChunks, userMessage, conversationContext);
      const estimatedTokens = Math.ceil(naturalPrompt.length / 4);
      console.log(`📄 Using natural citation prompt: ${topChunks.length} chunks, ~${estimatedTokens} tokens`);

      // ✅ CALL AI WITH NATURAL PROMPT
      const response = await fetch(`${CONFIG.openRouter.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.openRouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://idaho-puc-research.local',
          'X-Title': 'Idaho PUC Research Assistant'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'user', content: naturalPrompt }
          ],
          temperature: 0.1,
          max_tokens: 2500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponseText = data.choices[0].message.content;

      console.log(`📝 AI Response preview: ${aiResponseText.substring(0, 300)}...`);

      // ✅ PARSE AI RESPONSE
      let structuredResponse = this.parseAIResponse(aiResponseText);
      
      // ✅ ADD CLICKABLE URLS to natural citations
      structuredResponse = this.addClickableUrlsToCitations(structuredResponse, topChunks);
      
      console.log(`✅ Generated natural response with ${structuredResponse.citations.length} clickable citations`);
      
      const botResponse = {
        type: "bot",
        message: structuredResponse,
        citations: structuredResponse.citations, // Rich citation objects for frontend
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
        relevantDocuments: searchResults.length,
        tokensUsed: estimatedTokens,
        searchMethod: 'hybrid_natural_citations'
      };

      chatHistory.push({ role: 'assistant', content: JSON.stringify(structuredResponse) });
      this.chatSessions.set(currentSessionId, chatHistory);
      
      console.log(`💰 Estimated token usage: ${estimatedTokens} (natural citations + URLs)`);

      return botResponse;

    } catch (error) {
      console.error('Error generating chat response:', error);
      const errorResponse = {
        type: "bot",
        message: {
          answer: "I apologize, but I encountered an error processing your request. Please try again.",
          keyFindings: [],
          citations: [],
          confidence: "low",
          caveat: "System error occurred during processing."
        },
        citations: [],
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId
      };
      return errorResponse;
    }
  }

  /**
   * ✅ PHASE 3: JSON-optimized AI prompt with compressed context
   */
  buildJSONOptimizedPrompt(relevantChunks, query, conversationContext) {
    // Compress chunks into structured data for AI consumption
    const compressedChunks = relevantChunks.map((chunk, index) => {
      const compressed = {
        id: `chunk_${index + 1}`,
        case: chunk.metadata.caseNumber,
        doc: chunk.metadata.documentName,
        page: chunk.metadata.pageNumber,
        company: chunk.metadata.company
      };

      // Add structured data if available
      if (chunk.structured) {
        // Include key financial data
        if (chunk.structured.financial?.amounts?.length > 0) {
          compressed.amounts = chunk.structured.financial.amounts.slice(0, 3).map(a => ({
            value: a.value,
            context: a.context.substring(0, 60) // Truncate context
          }));
        }

        if (chunk.structured.financial?.percentages?.length > 0) {
          compressed.percentages = chunk.structured.financial.percentages.slice(0, 3).map(p => ({
            value: p.value,
            context: p.context.substring(0, 60)
          }));
        }

        // Include top quotes
        if (chunk.structured.quotes?.length > 0) {
          compressed.quotes = chunk.structured.quotes.slice(0, 2).map(q => ({
            text: q.text.substring(0, 150), // Truncate long quotes
            importance: q.importance
          }));
        }

        // Include topic and witness info
        if (chunk.structured.metadata) {
          compressed.topic = chunk.structured.metadata.topic;
          compressed.witness = chunk.structured.metadata.witness;
        }

        // Include snippet of content (much smaller)
        compressed.content = chunk.content.substring(0, 400);
      } else {
        // Fallback for non-structured chunks
        compressed.content = chunk.content.substring(0, 600);
      }

      return compressed;
    });

    return `You are a regulatory research assistant for Idaho PUC documents.

DOCUMENT_CHUNKS: ${JSON.stringify(compressedChunks)}

CONVERSATION: ${conversationContext}

QUERY: ${query}

Analyze the document chunks above and provide a structured response. Return ONLY valid JSON:

{
  "answer": "Direct response using specific quotes and case numbers. Reference chunks like 'According to chunk_1 (Case No. IPC-E-24-07), [quote]'",
  "keyFindings": ["specific finding 1", "specific finding 2", "specific finding 3"],
  "citations": [
    {
      "text": "exact quote from chunk",
      "caseNumber": "IPC-E-24-07", 
      "documentName": "DIRECT TESTIMONY",
      "pages": "15"
    }
  ],
  "confidence": "high|medium|low",
  "caveat": "any limitations"
}

IMPORTANT:
- Reference chunks by ID: "According to chunk_1..."
- Use exact quotes from the chunks
- Include 2-4 citations with real quotes
- Focus on financial data (amounts, percentages) when relevant`;
  }

  /**
   * ✅ NEW: Simplified AI prompt - focus only on content, no citation formatting
   */
  buildSimplifiedPrompt(relevantChunks, query, conversationContext) {
    const compressedChunks = relevantChunks.map((chunk, index) => ({
      id: index + 1,
      case: chunk.metadata.caseNumber,
      company: chunk.metadata.company,
      page: chunk.metadata.pageNumber,
      amounts: chunk.structured?.financial?.amounts?.slice(0, 2) || [],
      percentages: chunk.structured?.financial?.percentages?.slice(0, 2) || [],
      quotes: chunk.structured?.quotes?.slice(0, 1) || [],
      content: chunk.content.substring(0, 500)
    }));

    return `You are a regulatory research assistant for Idaho PUC documents.

DOCUMENTS: ${JSON.stringify(compressedChunks)}

QUERY: ${query}

Provide a factual analysis. Return ONLY valid JSON:

{
  "answer": "Direct response with specific information. Reference documents by case number like 'Case AVU-E-25-01 shows...' or 'According to IPC-E-24-07...'",
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "confidence": "high|medium|low",
  "caveat": "limitations if any"
}

Focus on accuracy and specific data from the documents. Use case numbers to reference sources.`;
  }

  /**
   * ✅ NEW: Build enhanced prompt with citation context for natural writing
   */
  buildNaturalCitationPrompt(relevantChunks, query, conversationContext) {
    // Prepare citation-ready chunks with witness names extracted
    const citationChunks = relevantChunks.map((chunk, index) => {
      const witness = this.extractWitnessName(chunk);
      const meta = chunk.metadata;
      
      return {
        id: index + 1,
        case: meta.caseNumber,
        company: meta.company,
        witness: witness,
        page: meta.pageNumber,
        documentType: this.cleanDocumentName(meta.documentName),
        // Create citation template for AI to use
        citationTemplate: witness ? 
          `${meta.company}'s Direct Testimony of ${witness} in Case ${meta.caseNumber}, page ${meta.pageNumber}` :
          `${meta.company}'s ${this.cleanDocumentName(meta.documentName)} in Case ${meta.caseNumber}, page ${meta.pageNumber}`,
        content: chunk.content.substring(0, 500),
        // Include key financial data if available
        amounts: chunk.structured?.financial?.amounts?.slice(0, 2) || [],
        percentages: chunk.structured?.financial?.percentages?.slice(0, 2) || []
      };
    });

    return `You are a regulatory research assistant for Idaho PUC documents. Write naturally and professionally like a regulatory analyst.

AVAILABLE DOCUMENTS:
${JSON.stringify(citationChunks, null, 2)}

QUERY: ${query}

Write a comprehensive response using the citation templates provided. When referencing information, use the exact citationTemplate format.

EXAMPLE GOOD CITATIONS:
- "According to Avista Utilities' Direct Testimony of Kenneth Dillon in Case AVU-E-25-01, page 15, the company states..."
- "Idaho Power's Direct Testimony of Lisa Smith in Case IPC-E-24-07, page 32 indicates..."

Return ONLY valid JSON:
{
  "answer": "Professional analysis with natural citations using the citationTemplate format exactly as provided. Write fluidly and avoid repetitive phrasing.",
  "keyFindings": ["specific finding with rates/percentages", "another key finding"],
  "confidence": "high|medium|low",
  "caveat": "any limitations"
}

IMPORTANT:
- Use the citationTemplate format exactly as shown in the documents
- Write naturally - avoid repetitive phrasing like 'Avista Utilities' direct testimony in Case Avista Utilities' Direct Testimony'
- Include specific rates, percentages, and dollar amounts
- Reference page numbers when available
- Write as if you're a professional regulatory analyst`;
  }

  /**
   * ✅ NEW: Post-process to add clickable URLs to existing natural citations
   */
  addClickableUrlsToCitations(response, relevantChunks) {
    console.log('🔗 Adding clickable URLs to natural citations...');
    
    // Create URL mapping by case number
    const citationMap = new Map();
    const citationObjects = [];
    
    relevantChunks.forEach(chunk => {
      const meta = chunk.metadata;
      const witness = this.extractWitnessName(chunk);
      const caseNumber = meta.caseNumber;
      
      if (meta.documentUrl) {
        const citation = {
          caseNumber: caseNumber,
          company: meta.company,
          witness: witness,
          documentName: this.cleanDocumentName(meta.documentName),
          pageNumber: meta.pageNumber,
          documentUrl: meta.documentUrl,
          utilityType: meta.utilityType
        };
        
        // Use most complete citation per case
        if (!citationMap.has(caseNumber) || (witness && !citationMap.get(caseNumber).witness)) {
          citationMap.set(caseNumber, citation);
        }
        
        citationObjects.push(citation);
      }
    });
    
    // Extract case numbers mentioned in the response for frontend citations
    const usedCitations = [];
    const casePattern = /\b([A-Z]{2,4}-[A-Z]-\d{2}-\d{2})\b/g;
    const foundCases = new Set();
    
    let match;
    while ((match = casePattern.exec(response.answer)) !== null) {
      const caseNumber = match[1];
      if (!foundCases.has(caseNumber)) {
        foundCases.add(caseNumber);
        
        // Find matching citation object
        const citation = citationMap.get(caseNumber);
        if (citation) {
          usedCitations.push(citation);
        }
      }
    }
    
    return {
      ...response,
      citations: usedCitations, // For frontend display with clickable URLs
      citationMetadata: {
        totalAvailable: citationObjects.length,
        totalUsed: usedCitations.length,
        processingMethod: 'hybrid_natural_plus_urls'
      }
    };
  }

  /**
   * ✅ NEW: Parse AI response with robust error handling
   */
  parseAIResponse(aiResponseText) {
    try {
      return JSON.parse(aiResponseText);
    } catch (parseError) {
      console.log('⚠️ JSON parse failed, attempting extraction...');
      
      // Try extracting from code block
      const jsonMatch = aiResponseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          const extracted = JSON.parse(jsonMatch[1]);
          console.log('✅ Extracted JSON from code block');
          return extracted;
        } catch (extractError) {
          console.log('❌ Code block extraction failed');
        }
      }
      
      // Final fallback
      console.log('❌ Using fallback structure');
      return this.createFallbackStructure(aiResponseText, []);
    }
  }

  /**
   * ✅ COMPLETE: Post-processing citation enhancement system
   * Replaces case-level citations with document-level citations including witness names
   */
  enhanceResponseWithCitations(structuredResponse, usedChunks) {
    console.log('🔗 Post-processing citations...');
    
    // Create citation mapping from chunks
    const citationMap = new Map();
    const citationObjects = [];
    
    usedChunks.forEach((chunk, index) => {
      const meta = chunk.metadata;
      const caseNumber = meta.caseNumber;
      
      // Extract witness name from multiple sources
      const witness = this.extractWitnessName(chunk);
      
      // Create rich citation object
      const citation = {
        id: `cite_${index + 1}`,
        caseNumber: caseNumber,
        company: meta.company,
        documentName: this.cleanDocumentName(meta.documentName),
        witness: witness,
        pageNumber: meta.pageNumber,
        documentUrl: meta.documentUrl,
        utilityType: meta.utilityType,
        displayText: this.formatCitationDisplayText(meta, witness)
      };
      
      // Map case number to citation (use most complete one if duplicates)
      if (!citationMap.has(caseNumber) || (witness && !citationMap.get(caseNumber).witness)) {
        citationMap.set(caseNumber, citation);
      }
      
      citationObjects.push(citation);
    });
    
    // Enhance the answer with proper citations
    let enhancedAnswer = structuredResponse.answer;
    const foundCases = new Set();
    
    // Pattern 1: Direct case number references (AVU-E-25-01)
    const casePattern = /\b([A-Z]{2,4}-[A-Z]-\d{2}-\d{2})\b/g;
    enhancedAnswer = enhancedAnswer.replace(casePattern, (match, caseNumber) => {
      const citation = citationMap.get(caseNumber);
      
      if (citation && !foundCases.has(caseNumber)) {
        foundCases.add(caseNumber);
        return this.formatInlineCitation(citation);
      }
      
      return match;
    });
    
    // Pattern 2: Fix "[object Object]" references
    enhancedAnswer = enhancedAnswer.replace(/\[object Object\]/g, (match) => {
      // Find first unused citation
      const availableCitation = Array.from(citationMap.values())
        .find(cite => !foundCases.has(cite.caseNumber));
      
      if (availableCitation) {
        foundCases.add(availableCitation.caseNumber);
        return this.formatInlineCitation(availableCitation);
      }
      
      return "the testimony";
    });
    
    // Pattern 3: Generic references that could be enhanced
    const genericPatterns = [
      /Avista Utilities(?:'s)? direct testimony/gi,
      /Idaho Power(?:'s)? direct testimony/gi,
      /PacifiCorp(?:'s)? direct testimony/gi
    ];
    
    genericPatterns.forEach(pattern => {
      enhancedAnswer = enhancedAnswer.replace(pattern, (match) => {
        const companyName = match.toLowerCase().includes('avista') ? 'Avista Utilities' :
                           match.toLowerCase().includes('idaho') ? 'Idaho Power' :
                           match.toLowerCase().includes('pacifi') ? 'PacifiCorp' : null;
        
        if (companyName) {
          const relevantCitation = Array.from(citationMap.values())
            .find(cite => cite.company === companyName && !foundCases.has(cite.caseNumber));
          
          if (relevantCitation) {
            foundCases.add(relevantCitation.caseNumber);
            return this.formatInlineCitation(relevantCitation);
          }
        }
        
        return match;
      });
    });
    
    // Get final used citations for frontend
    const usedCitations = Array.from(foundCases)
      .map(caseNumber => citationMap.get(caseNumber))
      .filter(Boolean);
    
    console.log(`✅ Enhanced response: ${foundCases.size} citations processed`);
    
    return {
      ...structuredResponse,
      answer: enhancedAnswer,
      citations: usedCitations,
      citationMetadata: {
        totalAvailable: citationObjects.length,
        totalUsed: usedCitations.length,
        processingMethod: 'post_processed_enhanced'
      }
    };
  }

  /**
   * Extract witness name from chunk using multiple strategies
   * @param {Object} chunk - Document chunk
   * @returns {string|null} - Cleaned witness name or null
   */
  extractWitnessName(chunk) {
    try {
      // Strategy 1: Try structured data first
      if (chunk.structured?.metadata?.witness) {
        const witnessFromStructured = this.cleanWitnessName(chunk.structured.metadata.witness);
        if (witnessFromStructured) return witnessFromStructured;
      }
      
      // Strategy 2: Extract from document name
      const docName = chunk.metadata?.documentName || '';
      
      // Pattern: "DIRECT TESTIMONY OF JOHN DOE" or "DIRECT J. DOE"
      const witnessPatterns = [
        /DIRECT\s+TESTIMONY\s+OF\s+([A-Z][A-Z\s\.]+?)(?:\s+EXHIBITS)?(?:\.PDF)?$/i,
        /DIRECT\s+([A-Z]\.\s*[A-Z][A-Z\s]+?)(?:\s+EXHIBITS)?(?:\.PDF)?$/i,
        /DIRECT\s+([A-Z][A-Z\s]+?)(?:\s+-\s+REDACTED)?(?:\s+EXHIBITS)?(?:\.PDF)?$/i
      ];
      
      for (const pattern of witnessPatterns) {
        const match = docName.match(pattern);
        if (match && match[1]) {
          const witnessFromDoc = this.cleanWitnessName(match[1]);
          if (witnessFromDoc) return witnessFromDoc;
        }
      }
      
      // Strategy 3: Extract from content (first few lines often have witness name)
      if (chunk.content && typeof chunk.content === 'string') {
        const contentLines = chunk.content.split('\n').slice(0, 10);
        for (const line of contentLines) {
          // Pattern: "JOHN DOE, Di 15" or "Witness: John Doe"
          const contentPatterns = [
            /([A-Z][a-z]+\s+[A-Z][a-z]+),\s+Di\s+\d+/,
            /Witness:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
            /Prepared by:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i
          ];
          
          for (const pattern of contentPatterns) {
            const match = line.match(pattern);
            if (match && match[1]) {
              const witnessFromContent = this.cleanWitnessName(match[1]);
              if (witnessFromContent) return witnessFromContent;
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Error extracting witness name from chunk:', error);
      return null;
    }
  }

  /**
   * Clean up witness names for consistent formatting
   * @param {string} name - Raw witness name
   * @returns {string|null} - Cleaned witness name or null
   */
  cleanWitnessName(name) {
    // Ensure we have a valid string
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return null;
    }
    
    try {
      return name
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .replace(/\.$/, '')             // Remove trailing period
        .replace(/\s+-\s+REDACTED/i, '') // Remove redacted suffix
        .trim()
        .split(' ')
        .filter(word => word.length > 0) // Remove empty words
        .map(word => {
          // Handle initials (J., K., etc.)
          if (word.length <= 2 && word.endsWith('.')) {
            return word.toUpperCase();
          }
          // Handle regular names
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    } catch (error) {
      console.warn('Error cleaning witness name:', name, error);
      return null;
    }
  }

  /**
   * Clean up document names for display
   * @param {string} docName - Raw document name
   * @returns {string} - Cleaned document name
   */
  cleanDocumentName(docName) {
    if (!docName) return 'Direct Testimony';
    
    // Extract meaningful part of document name
    const cleanName = docName
      .replace(/\.PDF$/i, '')
      .replace(/_/g, ' ')
      .replace(/\s+-\s+REDACTED/i, '');
    
    if (cleanName.includes('DIRECT')) {
      return 'Direct Testimony';
    }
    if (cleanName.includes('STAFF')) {
      return 'Staff Document';
    }
    if (cleanName.includes('ORDER')) {
      return 'Commission Order';
    }
    if (cleanName.includes('EXHIBIT')) {
      return 'Exhibits';
    }
    
    return cleanName;
  }

  /**
   * Format citation display text for the citation object
   * @param {Object} metadata - Chunk metadata
   * @param {string} witness - Witness name
   * @returns {string} - Formatted citation text
   */
  formatCitationDisplayText(metadata, witness) {
    let text = metadata.company || 'Utility';
    
    if (witness) {
      text += `'s Direct Testimony of ${witness}`;
    } else {
      text += `'s ${this.cleanDocumentName(metadata.documentName)}`;
    }
    
    text += ` in Case ${metadata.caseNumber}`;
    
    if (metadata.pageNumber) {
      text += `, page ${metadata.pageNumber}`;
    }
    
    return text;
  }

  /**
   * Format inline citation for use within the answer text
   * @param {Object} citation - Citation object
   * @returns {string} - Formatted inline citation
   */
  formatInlineCitation(citation) {
    let inlineText = citation.company;
    
    if (citation.witness) {
      inlineText += `'s Direct Testimony of ${citation.witness} in Case ${citation.caseNumber}`;
    } else {
      inlineText += `'s ${citation.documentName} in Case ${citation.caseNumber}`;
    }
    
    if (citation.pageNumber) {
      inlineText += `, page ${citation.pageNumber}`;
    }
    
    return inlineText;
  }

  /**
   * Generate document URL (if not already present)
   * @param {Object} metadata - Document metadata
   * @returns {string|null} - Document URL or null
   */
  generateDocumentURL(metadata) {
    // If URL already exists, use it
    if (metadata.documentUrl) {
      return metadata.documentUrl;
    }
    
    // Try to construct URL based on patterns (Idaho PUC site structure)
    const caseNumber = metadata.caseNumber;
    const docName = metadata.documentName;
    
    if (caseNumber && docName) {
      // This would be the actual PUC URL pattern - adjust based on actual site structure
      return `https://www.puc.idaho.gov/fileroom/cases/${caseNumber.toLowerCase()}/${docName.replace(/\s+/g, '_').toLowerCase()}.pdf`;
    }
    
    return null;
  }

  // ✅ ADD: Missing enhancedJSONSearch method
  enhancedJSONSearch(query, maxResults = 15) {
    console.log(`\n🔍 JSON-enhanced search for: "${query}"`);
    
    const searchTerms = this.extractKeywords(query);
    console.log(`📋 Search terms: ${searchTerms.join(', ')}`);
    
    const scoredChunks = this.sessionDocuments.map((chunk, index) => {
      let score = 0;
      let matchedTerms = [];
      let searchDetails = [];
      
      // ✅ PRIMARY: Search structured fields if available
      if (chunk.structured) {
        // 1. Search enhanced search terms (highest weight)
        if (chunk.structured.searchTerms) {
          searchTerms.forEach(term => {
            const matches = chunk.structured.searchTerms.filter(st => 
              st.toLowerCase().includes(term.toLowerCase())
            ).length;
            if (matches > 0) {
              score += matches * 15;
              matchedTerms.push(`searchTerms:${term}`);
              searchDetails.push(`Found "${term}" in searchTerms`);
            }
          });
        }
        
        // 2. Search financial data contexts
        if (chunk.structured.financial) {
          searchTerms.forEach(term => {
            const amountMatches = chunk.structured.financial.amounts?.filter(amt =>
              amt.context.toLowerCase().includes(term.toLowerCase())
            ).length || 0;
            
            const percentMatches = chunk.structured.financial.percentages?.filter(pct =>
              pct.context.toLowerCase().includes(term.toLowerCase())
            ).length || 0;
            
            if (amountMatches > 0) {
              score += amountMatches * 10;
              matchedTerms.push(`amounts:${term}`);
            }
            if (percentMatches > 0) {
              score += percentMatches * 12;
              matchedTerms.push(`percentages:${term}`);
            }
          });
        }
        
        // 3. Search key quotes
        if (chunk.structured.quotes) {
          searchTerms.forEach(term => {
            const quoteMatches = chunk.structured.quotes.filter(quote =>
              quote.text.toLowerCase().includes(term.toLowerCase())
            ).length;
            if (quoteMatches > 0) {
              score += quoteMatches * 8;
              matchedTerms.push(`quotes:${term}`);
            }
          });
        }
        
        // 4. Document context boosting
        if (chunk.structured.metadata?.documentContext) {
          const docContext = chunk.structured.metadata.documentContext;
          if (docContext.isDirectTestimony) {
            score *= 1.8;
            searchDetails.push('Boosted: Direct Testimony');
          }
          if (docContext.isAppendix) {
            score *= 0.1;
            searchDetails.push('Penalty: Appendix content');
          }
          if (docContext.isFinancialData) {
            const isFinancialQuery = searchTerms.some(term => 
              /rate|revenue|cost|expense|return|percent|dollar|\$/.test(term.toLowerCase())
            );
            if (isFinancialQuery) {
              score *= 1.5;
              searchDetails.push('Boosted: Financial data + financial query');
            }
          }
        }
      }
      
      // Fallback text search (lower weight)
      const content = chunk.content.toLowerCase();
      searchTerms.forEach(term => {
        const matches = (content.match(new RegExp(term.toLowerCase(), 'g')) || []).length;
        if (matches > 0) {
          score += matches * 2;
          matchedTerms.push(`content:${term}`);
        }
      });
      
      // Page scoring
      const pageNum = parseInt(chunk.metadata.pageNumber) || 999;
      if (pageNum < 50) score *= 1.3;
      if (pageNum > 1000) score *= 0.2;
      
      return {
        index,
        chunk,
        score,
        matchedTerms,
        searchDetails,
        pageNum,
        hasStructuredData: !!chunk.structured
      };
    }).filter(item => item.score > 0);
    
    scoredChunks.sort((a, b) => b.score - a.score);
    
    console.log(`📊 Found ${scoredChunks.length} matching chunks`);
    console.log('\n🎯 TOP 5 JSON SEARCH RESULTS:');
    scoredChunks.slice(0, 5).forEach((item, i) => {
      console.log(`${i + 1}. Score: ${item.score.toFixed(1)} | Page: ${item.pageNum} | ${item.hasStructuredData ? 'JSON✓' : 'TEXT'}`);
      console.log(`   Source: ${item.chunk.metadata.documentName}`);
      console.log(`   Matched: [${item.matchedTerms.slice(0, 3).join(', ')}]`);
      console.log(`   Details: ${item.searchDetails.slice(0, 2).join('; ')}`);
      console.log(`   Preview: ${item.chunk.content.substring(0, 100)}...`);
      console.log('');
    });
    
    return scoredChunks.slice(0, maxResults).map(item => item.chunk);
  }

  /**
   * Create fallback structure when JSON parsing fails
   */
  createFallbackStructure(aiText, availableCitations) {
    return {
      answer: aiText,
      keyFindings: [],
      citations: availableCitations.slice(0, 3).map(cite => ({
        text: "Referenced in response",
        caseNumber: cite.caseNumber,
        documentName: cite.documentName,
        pages: cite.pageNumber || "unknown"
      })),
      confidence: "medium",
      caveat: "Response format may not be optimal due to parsing issues."
    };
  }

  /**
   * Enrich AI citations with URLs from search results
   */
  enrichCitationsWithUrls(aiCitations, searchCitations) {
    return aiCitations.map(aiCite => {
      const match = searchCitations.find(searchCite => 
        searchCite.caseNumber === aiCite.caseNumber &&
        searchCite.documentName.includes(aiCite.documentName)
      );
      
      return {
        ...aiCite,
        url: match?.documentUrl,
        utilityType: match?.utilityType
      };
    });
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  /**
   * ✅ UPDATED: Load existing documents with URL extraction for test mode
   */
  async loadExistingDocuments(documentsPath) {
    try {
      console.log(`📂 Loading existing documents from: ${documentsPath}`);
      
      const files = await fs.readdir(documentsPath);
      const txtFiles = files.filter(file => file.endsWith('.txt'));
      
      console.log(`📁 Found ${txtFiles.length} text files`);
      
      const allExtractedDocuments = [];
      
      for (const filename of txtFiles) {
        try {
          const filepath = path.join(documentsPath, filename);
          const content = await fs.readFile(filepath, 'utf8');
          
          // ✅ PARSE METADATA AND EXTRACT URL FOR TEST MODE
          const documentData = this.parseDocumentDataWithUrl(filename, content, filepath);
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
      
      const chunksWithUrls = this.sessionDocuments.filter(doc => doc.metadata.documentUrl).length;
      console.log(`🔍 Prepared ${this.sessionDocuments.length} searchable chunks (${chunksWithUrls} with URLs)`);
      
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
   * ✅ UPDATED: Parse document metadata with URL extraction for test mode
   */
  parseDocumentDataWithUrl(filename, content, filepath) {
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
    
    // ✅ EXTRACT DOCUMENT URL FROM METADATA SECTION
    let documentUrl = null;
    const metadataEnd = content.indexOf('===== END METADATA =====');
    if (metadataEnd !== -1) {
      const metadataSection = content.substring(0, metadataEnd);
      const lines = metadataSection.split('\n');
      
      for (const line of lines) {
        if (line.includes('Document Source:') && line.includes('http')) {
          const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            documentUrl = urlMatch[1];
            break;
          }
        }
      }
    }
    
    // Extract actual content (skip metadata section)
    let actualContent = content;
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
      extractedAt: new Date().toISOString(),
      // ✅ PRESERVE DOCUMENT URL FOR TEST MODE
      documentUrl: documentUrl
    };
  }

  /**
   * LEGACY: Parse document metadata (kept for compatibility)
   */
  parseDocumentData(filename, content, filepath) {
    return this.parseDocumentDataWithUrl(filename, content, filepath);
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
