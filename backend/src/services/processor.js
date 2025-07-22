// backend/src/services/processor.js
// Streamlined Document Processor - Optimized for Document Grouping

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

class DocumentProcessor {
  constructor() {
    this.chunkSize = 1500;
    this.chunkOverlap = 200;
    this.minChunkSize = 300;
    this.maxDocumentSize = 5000000; // 5MB limit
    this.maxChunksPerDoc = 1000;
  }

  /**
   * ✅ MAIN PROCESSING: Convert extracted documents to AI-ready chunks
   */
  async processDocuments(crawlerResults) {
    console.log('🚀 Starting document processing...');
    console.log(`📄 Processing ${crawlerResults.allExtractedDocuments.length} documents`);
    
    const processedChunks = [];
    const processingStats = {
      totalDocuments: crawlerResults.allExtractedDocuments.length,
      processedDocuments: 0,
      totalChunks: 0,
      skippedDocuments: 0,
      processingErrors: 0,
      truncatedDocuments: 0
    };

    for (const document of crawlerResults.allExtractedDocuments) {
      try {
        console.log(`📝 Processing: ${document.documentName}`);
        
        // Read document file
        const documentText = await this.readDocumentFile(document.filepath);
        
        if (!documentText) {
          console.log(`⚠️ Skipping ${document.documentName} - file could not be read or was empty`);
          processingStats.skippedDocuments++;
          processingStats.processingErrors++;
          continue;
        }

        // Handle large documents
        let processedText = documentText;
        if (documentText.length > this.maxDocumentSize) {
          console.log(`⚠️ Truncating large document ${document.documentName} (${Math.round(documentText.length/1024)}KB → ${Math.round(this.maxDocumentSize/1024)}KB)`);
          processedText = documentText.substring(0, this.maxDocumentSize) + '\n[TRUNCATED - DOCUMENT TOO LARGE]';
          processingStats.truncatedDocuments++;
        }

        // Create chunks
        const chunks = this.createChunks(processedText, document);
        processedChunks.push(...chunks);
        
        processingStats.processedDocuments++;
        processingStats.totalChunks += chunks.length;
        
        console.log(`✅ Created ${chunks.length} chunks from ${document.documentName}`);
        
      } catch (error) {
        console.log(`❌ Error processing ${document.documentName}: ${error.message}`);
        processingStats.processingErrors++;
      }
    }

    const results = {
      chunks: processedChunks,
      stats: processingStats,
      metadata: {
        processedAt: new Date().toISOString(),
        totalDocuments: processingStats.totalDocuments,
        successfullyProcessed: processingStats.processedDocuments,
        totalChunks: processingStats.totalChunks,
        averageChunksPerDocument: Math.round(processingStats.totalChunks / processingStats.processedDocuments),
        jobId: crawlerResults.jobId,
        originalQuery: crawlerResults.query,
        utilities: crawlerResults.utilities,
        dateRange: crawlerResults.dateRange
      }
    };

    console.log(`🎉 Processing complete!`);
    console.log(`📊 Stats: ${processingStats.processedDocuments}/${processingStats.totalDocuments} docs → ${processingStats.totalChunks} chunks`);
    console.log(`⚡ Average: ${Math.round(processingStats.totalChunks / processingStats.processedDocuments)} chunks per document`);
    
    return results;
  }

  /**
   * ✅ READ DOCUMENT: Extract content from file
   */
  async readDocumentFile(filepath) {
    try {
      await fs.access(filepath);
      const content = await fs.readFile(filepath, 'utf8');
      
      // Extract content after metadata
      const metadataEnd = content.indexOf('===== END METADATA =====');
      if (metadataEnd !== -1) {
        return content.substring(metadataEnd + 25).trim();
      }
      
      return content.trim();
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`❌ File not found: ${filepath}`);
      } else {
        console.log(`❌ Error reading file ${filepath}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * ✅ CREATE CHUNKS: Process document into chunks with page awareness
   */
  createChunks(text, documentMetadata) {
    const cleanedText = this.cleanText(text);
    const pages = this.extractPages(cleanedText);
    
    if (pages.length <= 1) {
      // No page breaks - process as single document
      return this.createChunksFromText(cleanedText, documentMetadata, null, cleanedText);
    } else {
      // Process each page separately
      const allChunks = [];
      for (const page of pages) {
        const pageChunks = this.createChunksFromText(page.content, documentMetadata, page.pageNumber, cleanedText);
        allChunks.push(...pageChunks);
      }
      return allChunks;
    }
  }

  /**
   * ✅ EXTRACT PAGES: Find page-separated content
   */
  extractPages(text) {
    const pages = [];
    const pageMarkers = text.split(/--- PAGE \d+ ---/);
    
    if (pageMarkers.length <= 1) {
      return []; // No page markers found
    }

    const pageNumbers = [...text.matchAll(/--- PAGE (\d+) ---/g)];
    
    for (let i = 1; i < pageMarkers.length; i++) {
      const content = pageMarkers[i].trim();
      const pageNumber = pageNumbers[i-1] ? parseInt(pageNumbers[i-1][1]) : i;
      
      if (content.length > this.minChunkSize) {
        pages.push({
          pageNumber: pageNumber,
          content: content
        });
      }
    }
    
    return pages;
  }

  /**
   * ✅ CREATE CHUNKS FROM TEXT: Split text into overlapping chunks
   */
  createChunksFromText(text, documentMetadata, pageNumber, fullDocumentText = null) {
    const chunks = [];
    
    if (text.length <= this.chunkSize) {
      chunks.push(this.createChunk(text, documentMetadata, pageNumber, 1, 1, fullDocumentText));
      return chunks;
    }

    let start = 0;
    let chunkIndex = 1;
    
    while (start < text.length && chunkIndex <= this.maxChunksPerDoc) {
      const end = Math.min(start + this.chunkSize, text.length);
      let chunkText = text.substring(start, end);
      
      // Try to break at sentence boundaries
      if (end < text.length) {
        const lastSentence = chunkText.lastIndexOf('. ');
        const lastParagraph = chunkText.lastIndexOf('\n\n');
        const breakPoint = Math.max(lastSentence, lastParagraph);
        
        if (breakPoint > start + this.chunkSize * 0.7) {
          chunkText = chunkText.substring(0, breakPoint + 1);
        }
      }
      
      if (chunkText.trim().length >= this.minChunkSize) {
        chunks.push(this.createChunk(chunkText.trim(), documentMetadata, pageNumber, chunkIndex, this.maxChunksPerDoc, fullDocumentText));
        chunkIndex++;
      }
      
      // Safe advancement
      const advancement = Math.max(chunkText.length - this.chunkOverlap, 100);
      start += advancement;
      
      // Safety break
      if (advancement <= 0 || start >= text.length) {
        break;
      }
    }
    
    return chunks;
  }

  /**
   * ✅ CREATE CHUNK: Build chunk object with metadata and streamlined JSON overlay
   */
  createChunk(content, documentMetadata, pageNumber, chunkIndex, totalChunks, fullDocumentText = null) {
    const chunkId = this.generateChunkId(documentMetadata, pageNumber, chunkIndex);
    
    const chunk = {
      // Core identifiers
      id: chunkId,
      documentId: documentMetadata.filename,
      
      // Content
      content: content,
      contentLength: content.length,
      
      // Source attribution - essential for document grouping
      caseNumber: documentMetadata.caseNumber,
      company: documentMetadata.company,
      utilityType: documentMetadata.utilityType,
      caseStatus: documentMetadata.caseStatus,
      documentName: documentMetadata.documentName,
      documentType: documentMetadata.documentType,
      documentUrl: documentMetadata.documentUrl,
      
      // Pagination
      pageNumber: pageNumber,
      chunkIndex: chunkIndex,
      totalChunks: totalChunks,
      
      // Timestamps
      extractedAt: documentMetadata.extractedAt,
      processedAt: new Date().toISOString()
    };
    
    // Add streamlined JSON overlay for search enhancement
    if (fullDocumentText) {
      return this.addStreamlinedJSONOverlay(chunk, fullDocumentText);
    }
    
    return chunk;
  }

  /**
   * ✅ STREAMLINED JSON OVERLAY: Keep only what's needed for search
   */
  addStreamlinedJSONOverlay(chunk, fullDocumentText) {
    try {
      // Extract witness info once from full document
      const documentWitness = this.extractWitnessFromDocument(fullDocumentText, chunk.documentName);
      
      chunk.structured = {
        // Essential metadata for document grouping
        metadata: {
          witness: documentWitness,
          topic: this.categorizeContent(chunk.content),
          documentContext: {
            isDirectTestimony: chunk.documentType?.includes('Direct') || chunk.documentName?.includes('DIRECT'),
            isAppendix: this.isAppendixContent(chunk),
            isFinancialData: this.containsFinancialData(chunk.content)
          }
        },
        
        // Financial data for search targeting
        financial: this.extractFinancialData(chunk.content),
        
        // Enhanced search terms for better matching
        searchTerms: this.generateSearchTerms(chunk.content, chunk),
        
        // Key quotes for citation quality
        quotes: this.extractKeyQuotes(chunk.content, chunk.pageNumber)
      };
      
      return chunk;
      
    } catch (error) {
      console.log(`⚠️ Error adding JSON overlay to chunk ${chunk.id}: ${error.message}`);
      // Minimal fallback structure
      chunk.structured = {
        metadata: { topic: 'unknown' },
        financial: { amounts: [], percentages: [] },
        searchTerms: this.generateBasicSearchTerms(chunk.content)
      };
      return chunk;
    }
  }

  /**
   * ✅ EXTRACT WITNESS: Get witness name from document
   */
  extractWitnessFromDocument(fullDocumentText, documentName) {
    // Try document name first (most reliable)
    const namePatterns = [
      /DIRECT\s+TESTIMONY\s+OF\s+([A-Z][A-Z\s\.]+?)(?:\s+EXHIBITS)?(?:\.PDF)?$/i,
      /DIRECT\s+([A-Z]\.\s*[A-Z][A-Z\s]+?)(?:\s+EXHIBITS)?(?:\.PDF)?$/i,
      /DIRECT\s+([A-Z][A-Z\s]+?)(?:\s+-\s+REDACTED)?(?:\s+EXHIBITS)?(?:\.PDF)?$/i
    ];
    
    for (const pattern of namePatterns) {
      const match = documentName.match(pattern);
      if (match && match[1]) {
        return this.cleanWitnessName(match[1]);
      }
    }
    
    // Fallback to document content
    const contentMatch = fullDocumentText.match(/DIRECT TESTIMONY\s+OF\s+([A-Z\s\.]+)\s+FOR/i) ||
                        fullDocumentText.match(/([A-Z][a-z]+ [A-Z][a-z]+),\s+Di\s+\d+/);
    
    if (contentMatch) {
      return this.cleanWitnessName(contentMatch[1]);
    }
    
    return null;
  }

  /**
   * ✅ EXTRACT FINANCIAL DATA: Find monetary amounts and percentages
   */
  extractFinancialData(content) {
    const financial = { amounts: [], percentages: [] };
    
    // Find dollar amounts
    const dollarRegex = /\$[\d,]+(?:\.\d+)?\s*(?:million|thousand|billion|M|K|B)?/gi;
    financial.amounts = [...content.matchAll(dollarRegex)].map(match => ({
      value: match[0],
      context: this.getContextAroundMatch(content, match.index, 60).trim(),
      position: match.index
    }));
    
    // Find percentages
    const percentRegex = /\d+\.?\d*\s*%|\d+\.?\d*\s*percent/gi;
    financial.percentages = [...content.matchAll(percentRegex)].map(match => ({
      value: match[0],
      context: this.getContextAroundMatch(content, match.index, 60).trim(),
      position: match.index
    }));
    
    return financial;
  }

  /**
   * ✅ GENERATE SEARCH TERMS: Create enhanced search terms for better matching
   */
  generateSearchTerms(content, chunk) {
    const terms = new Set();
    
    // Add basic content terms
    const basicTerms = this.generateBasicSearchTerms(content);
    basicTerms.forEach(term => terms.add(term));
    
    // Add document type terms
    if (chunk.documentType) {
      terms.add(chunk.documentType.toLowerCase().replace(/\s+/g, '_'));
    }
    
    // Add specific utility regulation terms
    if (/rate.*return|return.*equity|roe/i.test(content)) {
      terms.add('rate_of_return');
      terms.add('return_on_equity');
    }
    
    if (/revenue.*requirement|rate.*increase/i.test(content)) {
      terms.add('revenue_requirement');
    }
    
    if (/Q\.\s+.*A\.\s+/i.test(content)) {
      terms.add('direct_testimony');
      terms.add('qa_format');
    }
    
    // Add financial indicators
    if (this.containsFinancialData(content)) {
      terms.add('financial_data');
    }
    
    // Add utility terms
    if (/commission|approved?|authorized?|requests?|proposes?/i.test(content)) {
      terms.add('regulatory_language');
    }
    
    return Array.from(terms);
  }

  /**
   * ✅ EXTRACT KEY QUOTES: Find important sentences for citations
   */
  extractKeyQuotes(content, pageNumber) {
    const quotes = [];
    const sentences = content.split(/[.!?]+/);
    
    sentences.forEach((sentence, index) => {
      const trimmed = sentence.trim();
      if (trimmed.length < 30) return; // Minimum quote length
      
      let score = 0;
      
      // Score based on content importance
      if (/\$[\d,]+/.test(trimmed)) score += 3; // Financial amounts
      if (/\d+\.?\d*\s*%/.test(trimmed)) score += 3; // Percentages
      if (/commission|approved?|authorized?|requests?|proposes?/i.test(trimmed)) score += 2; // Regulatory language
      if (/rate.*return|return.*equity/i.test(trimmed)) score += 3; // Rate of return content
      
      if (score >= 3) {
        quotes.push({
          text: trimmed,
          score: score,
          page: pageNumber,
          position: index,
          importance: score >= 5 ? 'high' : 'medium'
        });
      }
    });
    
    return quotes.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  // ✅ HELPER METHODS

  cleanText(text) {
    return text
      .replace(/\s{3,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  generateChunkId(documentMetadata, pageNumber, chunkIndex) {
    const source = `${documentMetadata.caseNumber}_${documentMetadata.filename}_${pageNumber || 'doc'}_${chunkIndex}`;
    return crypto.createHash('md5').update(source).digest('hex').substring(0, 12);
  }

  categorizeContent(content) {
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('rate of return') || lowerContent.includes('return on equity') || lowerContent.includes('roe')) {
      return 'rate_of_return';
    }
    if (lowerContent.includes('revenue requirement') || lowerContent.includes('rate increase')) {
      return 'revenue_requirement';
    }
    if (lowerContent.includes('cost of capital') || lowerContent.includes('debt')) {
      return 'cost_of_capital';
    }
    return 'general_testimony';
  }

  isAppendixContent(chunk) {
    const content = chunk.content.toLowerCase();
    const documentName = chunk.documentName ? chunk.documentName.toLowerCase() : '';
    
    return documentName.includes('exhibits') ||
           content.includes('appendix') ||
           /schedule\s+[a-z0-9]+/i.test(content) ||
           /exhibit\s+[a-z0-9]+/i.test(content) ||
           parseInt(chunk.pageNumber) > 1000; // Very high page numbers usually appendices
  }

  containsFinancialData(content) {
    return /\$[\d,]+|\d+\.?\d*\s*%|\d+\.?\d*\s*percent/i.test(content);
  }

  cleanWitnessName(name) {
    if (!name || typeof name !== 'string') return null;
    
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
  }

  generateBasicSearchTerms(content) {
    const terms = new Set();
    const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || []; // Minimum 4 characters
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'from', 'they', 'know', 'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'over', 'such', 'take', 'than', 'them', 'well', 'were']);
    
    words.forEach(word => {
      if (!stopWords.has(word) && word.length >= 4) {
        terms.add(word);
      }
    });
    
    return Array.from(terms).slice(0, 15); // Limit to top 15 terms
  }

  getContextAroundMatch(content, position, contextLength = 60) {
    const start = Math.max(0, position - contextLength / 2);
    const end = Math.min(content.length, position + contextLength / 2);
    return content.substring(start, end);
  }

  // ✅ OPTIONAL: Statistics (kept minimal)
  getProcessingStats(processedData) {
    const chunks = processedData.chunks;
    
    return {
      overview: {
        totalChunks: chunks.length,
        totalDocuments: new Set(chunks.map(c => c.documentId)).size,
        totalCases: new Set(chunks.map(c => c.caseNumber)).size,
        totalCompanies: new Set(chunks.map(c => c.company)).size
      },
      content: {
        averageChunkLength: Math.round(chunks.reduce((sum, c) => sum + c.contentLength, 0) / chunks.length),
        totalCharacters: chunks.reduce((sum, c) => sum + c.contentLength, 0)
      }
    };
  }
}

// ✅ MAIN EXPORT FUNCTION
export async function processExtractedDocuments(crawlerResults, options = {}) {
  const processor = new DocumentProcessor();
  
  // Allow configuration overrides
  if (options.chunkSize) processor.chunkSize = options.chunkSize;
  if (options.chunkOverlap) processor.chunkOverlap = options.chunkOverlap;
  if (options.minChunkSize) processor.minChunkSize = options.minChunkSize;
  
  const processedData = await processor.processDocuments(crawlerResults);
  
  // Print basic statistics
  const stats = processor.getProcessingStats(processedData);
  console.log('\n📊 PROCESSING STATISTICS:');
  console.log(`   Total Chunks: ${stats.overview.totalChunks}`);
  console.log(`   Documents: ${stats.overview.totalDocuments}`);
  console.log(`   Cases: ${stats.overview.totalCases}`);
  console.log(`   Companies: ${stats.overview.totalCompanies}`);
  console.log(`   Average Chunk Size: ${stats.content.averageChunkLength} characters`);
  
  return processedData;
}

export default DocumentProcessor;
