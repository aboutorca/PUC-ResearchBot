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
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'google/gemini-2.5-flash'
  },
  
  // Processing parameters - optimized for document grouping
  maxContextTokens: 400000,  // Increased for 300 chunks
  maxSearchResults: 300,     // Up to 300 relevant chunks
  keywordProximity: 1000
};

export class DynamicPUCResearchService {
  constructor() {
    this.currentSession = null;
    this.sessionDocuments = null;
    this.chatSessions = new Map();
  }

  // ✅ CORE INITIALIZATION
  async initialize() {
    try {
      if (!CONFIG.openRouter.apiKey) {
        throw new Error('OPENROUTER_API_KEY is missing. Please check your .env file.');
      }
      console.log('🚀 Dynamic AI Service initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize AI service:', error);
      throw error;
    }
  }

  // ✅ CORE SESSION MANAGEMENT
  async startResearch(query, userId = 'default', utilities = ['electric', 'natural_gas'], dateRange = { start: '2023-01-01', end: '2025-12-31' }, testMode = false) {
    try {
      console.log(`🔬 Starting research: "${query}"`);

      const sessionId = `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.currentSession = {
        id: sessionId,
        user_id: userId,
        query: query,
        status: 'crawling'
      };

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

  async conductResearch(sessionId, query, utilities, dateRange, testMode) {
    try {
      console.log('📊 Step 1: Getting documents...');

      let crawlerResults;
      if (testMode) {
        console.log('🧪 Using pre-loaded test data...');
        const result = await this.loadExistingDocuments('/Users/juandi/Downloads/extracted_texts/');
        return { summary: { totalDocuments: result.totalDocuments, companies: [], utilityTypes: [] }, chunks: this.sessionDocuments };
      } else {
        console.log('🌍 Crawling live data...');
        crawlerResults = await crawlCases(query, utilities, dateRange, 15);
      }
      
      console.log('📊 Step 2: Processing documents...');
      const processedData = await processExtractedDocuments(crawlerResults);
      
      console.log('📊 Step 3: Preparing documents for search...');
      this.sessionDocuments = this.prepareDocumentsForSearch(processedData.chunks);
      
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

  prepareDocumentsForSearch(chunks) {
    return chunks.map(chunk => ({
      id: chunk.id,
      content: chunk.content,
      contentLower: chunk.content.toLowerCase(),
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

  // ✅ MAIN CHAT RESPONSE - DOCUMENT GROUPED WITH 300 CHUNKS
  async generateChatResponse(userMessage, sessionId = null) {
    const currentSessionId = sessionId || crypto.randomUUID();
    
    try {
      const chatHistory = this.chatSessions.get(currentSessionId) || [];
      console.log(`💬 Processing question: "${userMessage}" for session: ${currentSessionId}`);

      chatHistory.push({ role: 'user', content: userMessage });

      if (!this.sessionDocuments) {
        throw new Error('No research session loaded. Please start a research session first.');
      }

      // Diagnostic check
      const structuredChunks = this.sessionDocuments.filter(chunk => chunk.structured).length;
      const totalChunks = this.sessionDocuments.length;
      console.log(`🔬 DIAGNOSTIC: Chunks with JSON structure: ${structuredChunks}/${totalChunks} (${Math.round(structuredChunks/totalChunks*100)}%)`);

      // ✅ ENHANCED SEARCH: Get up to 300 relevant chunks
      const searchResults = structuredChunks > 0 ? 
        this.enhancedJSONSearch(userMessage, CONFIG.maxSearchResults) : 
        this.enhancedKeywordSearch(userMessage, CONFIG.maxSearchResults);

      if (searchResults.length === 0) {
        return this.createNoResultsResponse(currentSessionId, chatHistory);
      }

      // ✅ USE ALL RELEVANT CHUNKS (up to 300)
      const topChunks = searchResults;
      console.log(`📄 Using ${topChunks.length} chunks for comprehensive analysis`);
      
      // ✅ BUILD DOCUMENT-GROUPED PROMPT
      const conversationContext = chatHistory.length > 0 
        ? chatHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n') 
        : 'New conversation.';

      const documentGroupedPrompt = this.buildDocumentGroupedPrompt(topChunks, userMessage, conversationContext);
      const estimatedTokens = Math.ceil(documentGroupedPrompt.length / 4);
      console.log(`📄 Using document-grouped prompt: ${topChunks.length} chunks, ~${estimatedTokens} tokens`);

      // ✅ CALL AI
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
          messages: [{ role: 'user', content: documentGroupedPrompt }],
          temperature: 0.1,
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponseText = data.choices[0].message.content;

      console.log(`📝 AI Response preview: ${aiResponseText.substring(0, 300)}...`);

      // ✅ PARSE AND ENHANCE RESPONSE
      let structuredResponse = this.parseAIResponse(aiResponseText);
      structuredResponse = this.addClickableUrlsToDocumentCitations(structuredResponse, topChunks);
      
      console.log(`✅ Generated comprehensive response with ${structuredResponse.citations.length} document citations`);
      
      const botResponse = {
        type: "bot",
        message: structuredResponse,
        citations: structuredResponse.citations,
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
        relevantDocuments: searchResults.length,
        tokensUsed: estimatedTokens,
        searchMethod: 'document_grouped_comprehensive'
      };

      chatHistory.push({ role: 'assistant', content: JSON.stringify(structuredResponse) });
      this.chatSessions.set(currentSessionId, chatHistory);
      
      console.log(`💰 Estimated token usage: ${estimatedTokens} (comprehensive document analysis)`);
      return botResponse;

    } catch (error) {
      console.error('Error generating chat response:', error);
      return this.createErrorResponse(currentSessionId);
    }
  }

  // ✅ OPTIMIZED: buildDocumentGroupedPrompt for perfect frontend integration
  buildDocumentGroupedPrompt(relevantChunks, query, conversationContext) {
    console.log('📄 Building document-grouped prompt...');
    
    // ... existing document grouping logic (keep same) ...
    const documentGroups = new Map();
    
    relevantChunks.forEach(chunk => {
      const docKey = `${chunk.metadata.caseNumber}_${chunk.metadata.documentName}`;
      
      if (!documentGroups.has(docKey)) {
        documentGroups.set(docKey, {
          caseNumber: chunk.metadata.caseNumber,
          company: chunk.metadata.company,
          documentName: chunk.metadata.documentName,
          witness: this.extractWitnessName(chunk),
          documentUrl: chunk.metadata.documentUrl,
          pageNumbers: [],
          combinedContent: [],
          totalChunks: 0,
          relevanceScore: 0
        });
      }
      
      const doc = documentGroups.get(docKey);
      doc.combinedContent.push(chunk.content);
      doc.pageNumbers.push(chunk.metadata.pageNumber);
      doc.totalChunks++;
      
      if (chunk.score) doc.relevanceScore += chunk.score;
    });

    const sortedDocuments = Array.from(documentGroups.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log(`📚 Grouped ${relevantChunks.length} chunks into ${sortedDocuments.length} documents`);
    console.log('📋 TOP 5 DOCUMENTS:');
    sortedDocuments.slice(0, 5).forEach((doc, i) => {
      console.log(`  ${i + 1}. ${doc.caseNumber} - ${doc.witness || 'No witness'} (${doc.totalChunks} chunks)`);
    });

    const documentData = sortedDocuments.map((doc, index) => {
      return {
        documentId: index + 1,
        caseNumber: doc.caseNumber,
        company: doc.company,
        witness: doc.witness,
        documentName: this.cleanDocumentName(doc.documentName),
        pageRange: `${Math.min(...doc.pageNumbers)}-${Math.max(...doc.pageNumbers)}`,
        citationTemplate: doc.witness ? 
          `${doc.company}'s Direct Testimony of ${doc.witness} in Case ${doc.caseNumber}` :
          `${doc.company}'s ${this.cleanDocumentName(doc.documentName)} in Case ${doc.caseNumber}`,
        content: doc.combinedContent.join('\n\n--- SECTION BREAK ---\n\n').substring(0, 6000), // Reduced for better focus
        documentUrl: doc.documentUrl
      };
    });

    // ✅ FRONTEND-OPTIMIZED PROMPT: Perfect for ChatMessage.tsx components
    return `You are a regulatory research assistant for Idaho Public Utilities Commission documents.

AVAILABLE DOCUMENTS (${documentData.length} documents):
${JSON.stringify(documentData, null, 2)}

USER QUERY: ${query}

RESPONSE REQUIREMENTS:
You must return a JSON response that will be rendered by React components. The response must be:
- CONCISE and scannable (not a wall of text)
- Professional but readable
- Include specific case numbers for all claims
- Use exact citation templates provided

REQUIRED JSON FORMAT:
{
  "answer": "Brief professional summary with case references",
  "keyFindings": [
    "Specific finding with case number",
    "Another finding with case number",
    "Cross-utility comparison with case numbers"
  ],
  "confidence": "high|medium|low",
  "caveat": "Brief limitation note if applicable"
}

ANSWER FIELD RULES:
- Keep to 2-4 sentences maximum
- Include 2-3 specific case numbers with rates/amounts
- Write naturally, like: "According to Idaho Power's Direct Testimony of Thompson in Case IPC-E-25-16, the company requests a 10.4% ROE."
- NO markdown headers (##) - plain text only
- NO bullet points in answer - save those for keyFindings

KEY FINDINGS RULES:
- Maximum 5 bullet points
- Each must include specific data (rates, amounts, percentages)
- Each must include a case number
- Format like: "Idaho Power requests 10.4% ROE in Case IPC-E-25-16"
- Focus on quantitative findings, not general statements

CONFIDENCE LEVELS:
- "high": Multiple utilities with specific data points
- "medium": Some utilities with partial data
- "low": Limited or unclear information

CAVEAT RULES:
- Only include if there are genuine limitations
- Keep to one sentence
- Examples: "Final authorized rates may differ from requested rates" or "Analysis limited to electric utility filings"

EXAMPLES:

GOOD RESPONSE:
{
  "answer": "Utilities are requesting return on equity (ROE) rates between 9.6% and 10.4%. According to Idaho Power's Direct Testimony of Thompson in Case IPC-E-25-16, the company seeks a 10.4% ROE, while Avista Utilities' Direct Testimony of Kalich in Case AVU-E-25-01 requests 9.6%.",
  "keyFindings": [
    "Idaho Power requests 10.4% ROE in Case IPC-E-25-16",
    "Avista Utilities proposes 9.6% ROE in Case AVU-E-25-01",
    "PacifiCorp seeks 10.0% ROE in Case PAC-E-24-04",
    "Average requested ROE across utilities is 10.0%"
  ],
  "confidence": "high",
  "caveat": "Final authorized rates determined by Commission may differ from requested rates"
}

BAD RESPONSE (DON'T DO THIS):
{
  "answer": "## Summary\n\nUtilities consistently highlight challenges in achieving their authorized rates of return due to regulatory lag...", // Too long, has markdown
  "keyFindings": [
    "Utilities face challenges", // No case number, too vague
    "Rates are important" // No specific data
  ]
}

CRITICAL RULES:
1. Answer field: Plain text, no markdown, 2-4 sentences max
2. Every claim needs a case number (IPC-E-25-16, AVU-E-25-01, etc.)
3. Use exact citationTemplate format when mentioning testimonies
4. Focus on specific numbers (percentages, dollar amounts)
5. Write for regulatory professionals who want facts, not fluff

Return ONLY the JSON response. No other text.`;
  }

  // ✅ ENHANCED SEARCH METHODS
  enhancedJSONSearch(query, maxResults = 300) {
    console.log(`\n🔍 JSON-enhanced search for: "${query}" (up to ${maxResults} results)`);
    
    const searchTerms = this.extractKeywords(query);
    console.log(`📋 Search terms: ${searchTerms.join(', ')}`);
    
    const scoredChunks = this.sessionDocuments.map((chunk, index) => {
      let score = 0;
      let matchedTerms = [];
      
      // Search structured fields if available
      if (chunk.structured) {
        // Search enhanced search terms
        if (chunk.structured.searchTerms) {
          searchTerms.forEach(term => {
            const matches = chunk.structured.searchTerms.filter(st => 
              st.toLowerCase().includes(term.toLowerCase())
            ).length;
            if (matches > 0) {
              score += matches * 15;
              matchedTerms.push(`searchTerms:${term}`);
            }
          });
        }
        
        // Search financial data contexts
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
        
        // Search key quotes
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
      }
      
      // Fallback text search
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
        chunk: { ...chunk, score },
        score,
        matchedTerms,
        pageNum,
        hasStructuredData: !!chunk.structured
      };
    }).filter(item => item.score > 0);
    
    scoredChunks.sort((a, b) => b.score - a.score);
    
    console.log(`📊 Found ${scoredChunks.length} matching chunks, using top ${Math.min(maxResults, scoredChunks.length)}`);
    
    return scoredChunks.slice(0, maxResults).map(item => item.chunk);
  }

  enhancedKeywordSearch(query, maxResults = 300) {
    console.log(`\n🔍 Enhanced keyword search for: "${query}" (up to ${maxResults} results)`);
    
    const searchTerms = this.extractKeywords(query);
    console.log(`📋 Search terms: ${searchTerms.join(', ')}`);
    
    const scoredChunks = this.sessionDocuments.map((chunk, index) => {
      const content = chunk.content.toLowerCase();
      const source = chunk.metadata.documentName || '';
      
      let score = 0;
      let matchedTerms = [];
      
      searchTerms.forEach(term => {
        const termLower = term.toLowerCase();
        const matches = (content.match(new RegExp(termLower, 'g')) || []).length;
        score += matches * (term.length > 3 ? 2 : 1);
        if (matches > 0) matchedTerms.push(term);
      });
      
      // Boost main testimony documents
      const isDirectTestimony = source.toLowerCase().includes('direct') && 
                               !source.toLowerCase().includes('exhibit');
      if (isDirectTestimony) {
        score *= 2;
      }
      
      // Page-based scoring
      const pageNum = parseInt(chunk.metadata.pageNumber) || 999;
      if (pageNum < 50) score *= 1.5;
      if (pageNum > 1000) score *= 0.3;
      
      return {
        index,
        chunk: { ...chunk, score },
        score,
        matchedTerms,
        pageNum
      };
    }).filter(item => item.score > 0);
    
    scoredChunks.sort((a, b) => b.score - a.score);
    
    console.log(`📊 Found ${scoredChunks.length} matching chunks, using top ${Math.min(maxResults, scoredChunks.length)}`);
    
    return scoredChunks.slice(0, maxResults).map(item => item.chunk);
  }

  addClickableUrlsToDocumentCitations(response, relevantChunks) {
    console.log('🔗 Adding clickable URLs to document citations...');
    
    // ✅ FIXED: Build comprehensive document mapping from ALL chunks
    const documentMap = new Map();
    const citationObjects = [];
    
    console.log(`🔍 Processing ${relevantChunks.length} chunks for citation mapping...`);
    
    relevantChunks.forEach((chunk, index) => {
      const meta = chunk.metadata;
      const witness = this.extractWitnessName(chunk);
      const caseNumber = meta.caseNumber;
      
      // ✅ IMPROVED: Create unique document key (case + witness)
      const documentKey = witness ? 
        `${caseNumber}_${witness}` : 
        `${caseNumber}_${this.cleanDocumentName(meta.documentName)}`;
      
      // Create citation object matching frontend expectations
      const citation = {
        text: witness ? 
          `Direct Testimony of ${witness}` : 
          this.cleanDocumentName(meta.documentName),
        caseNumber: caseNumber,
        documentName: meta.documentName,
        pages: meta.pageNumber ? meta.pageNumber.toString() : "unknown",
        // Extended fields for better frontend experience
        company: meta.company,
        witness: witness,
        documentUrl: meta.documentUrl,
        utilityType: meta.utilityType,
        pageNumber: meta.pageNumber,
        // ✅ DEBUG: Track source
        debugInfo: `Chunk ${index}: ${meta.documentName}`
      };
      
      // ✅ FIXED: Map by unique document key (not just case number)
      if (!documentMap.has(documentKey)) {
        documentMap.set(documentKey, citation);
        citationObjects.push(citation);
        
        console.log(`📝 Mapped: ${documentKey} → ${citation.company} - ${citation.witness || 'No witness'}`);
      }
      
      // ✅ ALSO map by case number for fallback compatibility
      if (!documentMap.has(caseNumber)) {
        documentMap.set(caseNumber, citation);
      }
    });
    
    console.log(`📋 Citation mapping complete: ${citationObjects.length} unique documents`);
    console.log('📋 Available document keys:', Array.from(documentMap.keys()).slice(0, 10));
    
    // ✅ NEW: Enhanced pattern matching for witness-specific citations
    const allCitations = new Set();
    const fullResponseText = `${response.answer || ''} ${(response.keyFindings || []).join(' ')}`;
    
    // ✅ ENHANCED: Match witness-specific patterns first
    const witnessPatterns = [
      // "Direct Testimony of Grow in Case IPC-E-25-16"
      /(?:Direct\s+Testimony\s+of\s+([A-Z][A-Za-z\s\.]+?)\s+in\s+Case\s+([A-Z]{2,4}-[A-Z]-\d{2}-\d{2}))/gi,
      // "Idaho Power's Direct Testimony of Thompson in Case IPC-E-25-16"
      /(?:([A-Za-z\s]+?)'s\s+Direct\s+Testimony\s+of\s+([A-Z][A-Za-z\s\.]+?)\s+in\s+Case\s+([A-Z]{2,4}-[A-Z]-\d{2}-\d{2}))/gi,
      // Just case numbers as fallback
      /\b([A-Z]{2,4}-[A-Z]-\d{2}-\d{2})\b/g
    ];
    
    // Process each pattern
    witnessPatterns.forEach((pattern, patternIndex) => {
      let match;
      while ((match = pattern.exec(fullResponseText)) !== null) {
        if (patternIndex === 0) {
          // Pattern: "Direct Testimony of Grow in Case IPC-E-25-16"
          const witnessName = match[1].trim();
          const caseNumber = match[2];
          const documentKey = `${caseNumber}_${witnessName}`;
          
          if (documentMap.has(documentKey)) {
            allCitations.add(documentMap.get(documentKey));
            console.log(`✅ Matched witness-specific: ${witnessName} in ${caseNumber}`);
          } else {
            // Try partial witness name matching
            const partialMatch = this.findWitnessByPartialName(witnessName, caseNumber, citationObjects);
            if (partialMatch) {
              allCitations.add(partialMatch);
              console.log(`✅ Matched partial witness: ${witnessName} → ${partialMatch.witness} in ${caseNumber}`);
            }
          }
        } else if (patternIndex === 1) {
          // Pattern: "Idaho Power's Direct Testimony of Thompson in Case IPC-E-25-16"
          const witnessName = match[2].trim();
          const caseNumber = match[3];
          const documentKey = `${caseNumber}_${witnessName}`;
          
          if (documentMap.has(documentKey)) {
            allCitations.add(documentMap.get(documentKey));
            console.log(`✅ Matched company-witness: ${witnessName} in ${caseNumber}`);
          } else {
            // Try partial witness name matching
            const partialMatch = this.findWitnessByPartialName(witnessName, caseNumber, citationObjects);
            if (partialMatch) {
              allCitations.add(partialMatch);
              console.log(`✅ Matched partial company-witness: ${witnessName} → ${partialMatch.witness} in ${caseNumber}`);
            }
          }
        } else {
          // Fallback: just case number
          const caseNumber = match[1];
          if (documentMap.has(caseNumber)) {
            allCitations.add(documentMap.get(caseNumber));
            console.log(`✅ Matched case fallback: ${caseNumber}`);
          }
        }
      }
    });
    
    const usedCitations = Array.from(allCitations);
    console.log(`🔗 Final citations: ${usedCitations.length} documents with specific links`);
    
    // ✅ ENHANCED: Remove debug info before returning
    const cleanCitations = usedCitations.map(cite => {
      const { debugInfo, ...cleanCite } = cite;
      return cleanCite;
    });
    
    return {
      ...response,
      citations: cleanCitations,
      citationMetadata: {
        totalDocuments: citationObjects.length,
        documentsUsed: cleanCitations.length,
        processingMethod: 'witness_aware_citations_v2'
      }
    };
  }

  // ✅ NEW: Helper function to find witnesses by partial name matching
  findWitnessByPartialName(searchWitness, caseNumber, citationObjects) {
    const searchTerms = searchWitness.toLowerCase().split(/\s+/);
    
    // Find all citations for this case
    const caseCitations = citationObjects.filter(cite => cite.caseNumber === caseNumber);
    
    // Try to match witness names
    for (const citation of caseCitations) {
      if (!citation.witness) continue;
      
      const witnessTerms = citation.witness.toLowerCase().split(/\s+/);
      
      // Check if any search terms match witness terms
      const hasMatch = searchTerms.some(searchTerm => 
        witnessTerms.some(witnessTerm => 
          witnessTerm.includes(searchTerm) || searchTerm.includes(witnessTerm)
        )
      );
      
      if (hasMatch) {
        return citation;
      }
    }
    
    return null;
  }

  // ✅ HELPER METHODS
  extractWitnessName(chunk) {
    try {
      // Try structured data first
      if (chunk.structured?.metadata?.witness) {
        const witnessFromStructured = this.cleanWitnessName(chunk.structured.metadata.witness);
        if (witnessFromStructured) return witnessFromStructured;
      }
      
      // Extract from document name
      const docName = chunk.metadata?.documentName || '';
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
      
      return null;
    } catch (error) {
      console.warn('Error extracting witness name:', error);
      return null;
    }
  }

  cleanWitnessName(name) {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return null;
    }
    
    try {
      return name
        .replace(/\s+/g, ' ')
        .replace(/\.$/, '')
        .replace(/\s+-\s+REDACTED/i, '')
        .trim()
        .split(' ')
        .filter(word => word.length > 0)
        .map(word => {
          if (word.length <= 2 && word.endsWith('.')) {
            return word.toUpperCase();
          }
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    } catch (error) {
      console.warn('Error cleaning witness name:', name, error);
      return null;
    }
  }

  cleanDocumentName(docName) {
    if (!docName) return 'Direct Testimony';
    
    const cleanName = docName
      .replace(/\.PDF$/i, '')
      .replace(/_/g, ' ')
      .replace(/\s+-\s+REDACTED/i, '');
    
    if (cleanName.includes('DIRECT')) return 'Direct Testimony';
    if (cleanName.includes('STAFF')) return 'Staff Document';
    if (cleanName.includes('ORDER')) return 'Commission Order';
    if (cleanName.includes('EXHIBIT')) return 'Exhibits';
    
    return cleanName;
  }

  extractKeywords(query) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'what', 'how', 'when', 'where', 'why']);
    
    const words = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    return [...new Set(words)];
  }

  parseAIResponse(aiResponseText) {
    try {
      return JSON.parse(aiResponseText);
    } catch (parseError) {
      console.log('⚠️ JSON parse failed, attempting extraction...');
      
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
      
      console.log('❌ Using fallback structure');
      return this.createFallbackStructure(aiResponseText, []);
    }
  }

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

  createNoResultsResponse(sessionId, chatHistory) {
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
      sessionId: sessionId
    };
    chatHistory.push({ role: 'assistant', content: JSON.stringify(noResultResponse.message) });
    this.chatSessions.set(sessionId, chatHistory);
    return noResultResponse;
  }

  createErrorResponse(sessionId) {
    return {
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
      sessionId: sessionId
    };
  }

  // ✅ DOCUMENT LOADING (for test mode)
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
          const documentData = this.parseDocumentDataWithUrl(filename, content, filepath);
          allExtractedDocuments.push(documentData);
        } catch (error) {
          console.log(`⚠️ Error reading ${filename}:`, error.message);
        }
      }
      
      console.log(`✅ Successfully loaded ${allExtractedDocuments.length} documents`);
      
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
      
      const processedData = await processExtractedDocuments(mockCrawlerResults);
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

  parseDocumentDataWithUrl(filename, content, filepath) {
    const caseNumberMatch = filename.match(/([A-Z]{2,4}-[A-Z]-\d{2}-\d{2})/);
    const caseNumber = caseNumberMatch ? caseNumberMatch[1] : 'UNKNOWN';
    
    const companyMap = {
      'AVU': 'Avista Utilities',
      'IPC': 'Idaho Power',
      'PAC': 'PacifiCorp', 
      'INT': 'Intermountain Gas'
    };
    const companyCode = caseNumber.split('-')[0];
    const company = companyMap[companyCode] || 'Unknown Company';
    
    const utilityType = caseNumber.includes('-E-') ? 'electric' : 
                       caseNumber.includes('-G-') ? 'natural_gas' : 'unknown';
    
    const documentType = filename.includes('DIRECT') ? 'Company_Direct_Testimony' : 'Staff_Document';
    
    // Extract document URL from metadata section
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
      caseStatus: 'closed',
      documentName: filename.replace('.txt', '').replace(/_/g, ' '),
      documentType: documentType,
      content: actualContent,
      textLength: actualContent.length,
      pages: pages,
      extractedAt: new Date().toISOString(),
      documentUrl: documentUrl
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
