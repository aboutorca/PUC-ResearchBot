// backend/src/services/processor.js
// Clean Document Processor - Production Ready

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

class DocumentProcessor {
  constructor() {
    this.chunkSize = 1500;
    this.chunkOverlap = 200;
    this.minChunkSize = 300;
    this.maxDocumentSize = 5000000; // 5MB limit - capture everything
    this.maxChunksPerDoc = 1000; // Allow up to 1000 chunks per document
  }

  /**
   * Main processing function - convert extracted documents to AI-ready chunks
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
        
        // Gracefully skip if file read failed
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
   * Read document file from filepath
   */
  async readDocumentFile(filepath) {
    try {
      await fs.access(filepath); // Check if file exists and is accessible
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
      return null; // Return null to allow processing to continue
    }
  }

  /**
   * Create chunks from document text
   */
  createChunks(text, documentMetadata) {
    const chunks = [];
    
    // Basic text cleanup
    const cleanedText = this.cleanText(text);
    
    // Check if document has page breaks
    const pages = this.extractPages(cleanedText);
    
    if (pages.length <= 1) {
      // No page breaks found, process as single document
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
   * Extract page-separated content
   */
  extractPages(text) {
    const pages = [];
    const pageMarkers = text.split(/--- PAGE \d+ ---/);
    
    if (pageMarkers.length <= 1) {
      return []; // No page markers found
    }

    // Find page numbers
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
   * Create chunks from text with overlapping windows
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
   * Create a chunk object with complete metadata and JSON overlay
   */
  createChunk(content, documentMetadata, pageNumber, chunkIndex, totalChunks, fullDocumentText = null, searchQuery = null) {
    const chunkId = this.generateChunkId(documentMetadata, pageNumber, chunkIndex);
    
    const chunk = {
      // Unique identifiers
      id: chunkId,
      documentId: documentMetadata.filename,
      
      // Content
      content: content,
      contentLength: content.length,
      
      // Source attribution
      caseNumber: documentMetadata.caseNumber,
      company: documentMetadata.company,
      utilityType: documentMetadata.utilityType,
      caseStatus: documentMetadata.caseStatus,
      documentName: documentMetadata.documentName,
      documentType: documentMetadata.documentType,
      documentUrl: documentMetadata.documentUrl,
      fileName: documentMetadata.filename, // Add fileName for appendix detection
      
      // Pagination
      pageNumber: pageNumber,
      chunkIndex: chunkIndex,
      totalChunks: totalChunks,
      
      // Technical metadata
      extractedAt: documentMetadata.extractedAt,
      processedAt: new Date().toISOString(),
      
      // For citations in AI responses
      citation: {
        caseNumber: documentMetadata.caseNumber,
        company: documentMetadata.company,
        utilityType: documentMetadata.utilityType === 'electric' ? 'Electric' : 'Natural Gas',
        caseStatus: documentMetadata.caseStatus === 'open' ? 'Open Case' : 'Closed Case',
        documentName: documentMetadata.documentName,
        documentType: documentMetadata.documentType === 'Company_Direct_Testimony' ? 'Company Direct Testimony' : 'Staff Document',
        pageNumber: pageNumber,
        source: 'Idaho Public Utilities Commission'
      }
    };
    
    // Add JSON overlay if full document text is available
    if (fullDocumentText) {
      return this.addJSONOverlay(chunk, fullDocumentText, searchQuery);
    }
    
    return chunk;
  }

  /**
   * Basic text cleanup
   */
  cleanText(text) {
    return text
      .replace(/\s{3,}/g, ' ')          // Remove excessive whitespace
      .replace(/\n{3,}/g, '\n\n')      // Limit line breaks
      .trim();
  }

  /**
   * Generate unique chunk ID
   */
  generateChunkId(documentMetadata, pageNumber, chunkIndex) {
    const source = `${documentMetadata.caseNumber}_${documentMetadata.filename}_${pageNumber || 'doc'}_${chunkIndex}`;
    return crypto.createHash('md5').update(source).digest('hex').substring(0, 12);
  }

  /**
   * Save processed chunks to file
   */
  async saveProcessedData(processedData, outputPath) {
    try {
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(processedData, null, 2), 'utf8');
      console.log(`💾 Processed data saved to: ${outputPath}`);
      
    } catch (error) {
      console.log(`❌ Error saving processed data: ${error.message}`);
    }
  }

  /**
   * Get processing statistics
   */
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
        minChunkLength: Math.min(...chunks.map(c => c.contentLength)),
        maxChunkLength: Math.max(...chunks.map(c => c.contentLength)),
        totalCharacters: chunks.reduce((sum, c) => sum + c.contentLength, 0)
      },
      distribution: {
        byUtilityType: this.groupBy(chunks, 'utilityType'),
        byDocumentType: this.groupBy(chunks, 'documentType'),
        byCaseStatus: this.groupBy(chunks, 'caseStatus'),
        byCompany: this.groupBy(chunks, 'company')
      }
    };
  }

  /**
   * Group chunks by field
   */
  groupBy(chunks, field) {
    return chunks.reduce((acc, chunk) => {
      const key = chunk[field];
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Add JSON overlay to existing chunk structure
   * This enhances chunks with structured data while keeping all existing fields
   */
  addJSONOverlay(chunk, fullDocumentText, searchQuery = null) {
    try {
      // Extract metadata from full document text (for witness info, etc.)
      const documentMetadata = this.parseFullDocumentMetadata(fullDocumentText);
      
      // Create structured overlay
      chunk.structured = {
        metadata: {
          witness: this.extractWitnessInfo(chunk.content, documentMetadata),
          section: this.extractSection(chunk.content),
          topic: this.categorizeContent(chunk.content),
          documentContext: {
            isDirectTestimony: chunk.documentType?.includes('Direct') || false,
            isAppendix: this.isAppendixContent(chunk),
            isFinancialData: this.containsFinancialData(chunk.content),
            isTableData: /Table No\.|Line\s+\d+|Row\s+\d+/i.test(chunk.content)
          }
        },
        financial: this.extractFinancialData(chunk.content),
        testimony: this.extractTestimonyStructure(chunk.content),
        quotes: this.extractKeyQuotes(chunk.content, chunk.pageNumber, searchQuery),
        entities: this.extractEntities(chunk.content),
        searchTerms: this.generateEnhancedSearchTerms(chunk.content, chunk, searchQuery),
        contentAnalysis: {
          hasQAFormat: /Q\.\s+.*?A\.\s+/i.test(chunk.content),
          hasTable: /Table No\.|Line\s+\d+|Row\s+\d+/i.test(chunk.content),
          hasFinancialData: this.containsFinancialData(chunk.content),
          hasRegulatoryLanguage: /commission|approved?|authorized?|requests?|proposes?/i.test(chunk.content),
          wordCount: chunk.content.split(/\s+/).length,
          queryRelevance: searchQuery ? this.calculateQueryRelevance(chunk.content, searchQuery) : null
        }
      };
      
      return chunk;
      
    } catch (error) {
      console.log(`⚠️ Error adding JSON overlay to chunk ${chunk.id}: ${error.message}`);
      // Add minimal structure on error
      chunk.structured = {
        metadata: { topic: 'unknown' },
        financial: { amounts: [], percentages: [] },
        searchTerms: this.generateBasicSearchTerms(chunk.content),
        contentAnalysis: { wordCount: chunk.content.split(/\s+/).length }
      };
      return chunk;
    }
  }

  // Helper methods for JSON overlay functionality
  parseFullDocumentMetadata(fullDocumentText) {
    const metadata = {};
    const witnessMatch = fullDocumentText.match(/DIRECT TESTIMONY\s+OF\s+([A-Z\s\.]+)\s+FOR/i) ||
                        fullDocumentText.match(/([A-Z][a-z]+ [A-Z][a-z]+),\s+Di\s+\d+/);
    if (witnessMatch) {
      metadata.witness = witnessMatch[1].trim();
    }
    return metadata;
  }

  extractFinancialData(content) {
    const financial = { amounts: [], percentages: [], timeframes: [] };
    const dollarRegex = /\$[\d,]+(?:\.\d+)?\s*(?:million|thousand|billion|M|K|B)?/gi;
    const percentRegex = /\d+\.?\d*\s*%|\d+\.?\d*\s*percent/gi;
    
    financial.amounts = [...content.matchAll(dollarRegex)].map(match => ({
      value: match[0],
      context: this.getContextAroundMatch(content, match.index, 80).trim(),
      position: match.index
    }));
    
    financial.percentages = [...content.matchAll(percentRegex)].map(match => ({
      value: match[0],
      context: this.getContextAroundMatch(content, match.index, 60).trim(),
      position: match.index
    }));
    
    return financial;
  }

  extractTestimonyStructure(content) {
    return {
      format: /Q\.\s+/i.test(content) && /A\.\s+/i.test(content) ? 'qa_testimony' : 'unknown',
      isQuestion: /Q\.\s+/.test(content),
      isAnswer: /A\.\s+/.test(content),
      topic: this.categorizeContent(content)
    };
  }

  categorizeContent(content) {
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('rate of return') || lowerContent.includes('return on equity') || lowerContent.includes('roe')) {
      return 'rate_of_return';
    }
    if (lowerContent.includes('revenue requirement') || lowerContent.includes('rate increase')) {
      return 'revenue_requirement';
    }
    return 'general_testimony';
  }

  extractWitnessInfo(content, documentMetadata) {
    if (documentMetadata.witness) {
      return { name: documentMetadata.witness, source: 'document_header' };
    }
    const witnessMatch = content.match(/([A-Z][a-z]+ [A-Z][a-z]+),\s+Di\s+\d+/);
    return witnessMatch ? { name: witnessMatch[1], source: 'content' } : null;
  }

  extractSection(content) {
    const sectionMatch = content.match(/([IVX]+\.\s+[A-Z\s]+)/) ||
                        content.match(/(Section\s+[A-Z0-9]+[:\.]?\s+[A-Z][^\n]*)/i);
    return sectionMatch ? sectionMatch[1].trim() : null;
  }

  isAppendixContent(chunk) {
    const content = chunk.content.toLowerCase();
    const fileName = chunk.fileName ? chunk.fileName.toLowerCase() : '';
    return content.includes('appendix') || fileName.includes('appendix') ||
           /schedule\s+[a-z0-9]+/i.test(content) || /exhibit\s+[a-z0-9]+/i.test(content);
  }

  containsFinancialData(content) {
    return /\$[\d,]+|\.\d+\s*%|\d+\.\d+\s*percent/i.test(content);
  }

  extractKeyQuotes(content, pageNumber, searchQuery = null) {
    const quotes = [];
    const sentences = content.split(/[.!?]+/);
    
    sentences.forEach((sentence, index) => {
      const trimmed = sentence.trim();
      if (trimmed.length < 20) return;
      
      let score = 0;
      if (/\$[\d,]+/.test(trimmed)) score += 3;
      if (/\d+\.?\d*\s*%/.test(trimmed)) score += 3;
      if (/commission|approved?|authorized?|requests?|proposes?/i.test(trimmed)) score += 2;
      
      if (searchQuery) {
        const queryWords = searchQuery.toLowerCase().split(/\s+/);
        queryWords.forEach(word => {
          if (trimmed.toLowerCase().includes(word)) score += 2;
        });
      }
      
      if (score >= 3) {
        quotes.push({ text: trimmed, score: score, page: pageNumber, position: index });
      }
    });
    
    return quotes.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  extractEntities(content) {
    const entities = { companies: [], people: [], locations: [], regulations: [] };
    const companyRegex = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Corp|Corporation|Inc|LLC|Company|Co\.|Ltd)/g;
    const peopleRegex = /(?:Mr\.|Ms\.|Dr\.|Mrs\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
    const locationRegex = /\b(?:Idaho|Utah|Oregon|Washington|California|Nevada|Montana)\b/g;
    const regulationRegex = /\b(?:Commission|IPUC|FERC|Order|Docket|Case|Tariff|Schedule)\s+[A-Z0-9-]+/g;
    
    entities.companies = [...new Set([...content.matchAll(companyRegex)].map(m => m[0]))];
    entities.people = [...new Set([...content.matchAll(peopleRegex)].map(m => m[0]))];
    entities.locations = [...new Set([...content.matchAll(locationRegex)].map(m => m[0]))];
    entities.regulations = [...new Set([...content.matchAll(regulationRegex)].map(m => m[0]))];
    
    return entities;
  }

  generateEnhancedSearchTerms(content, chunk, searchQuery = null) {
    const terms = new Set();
    const basicTerms = this.generateBasicSearchTerms(content);
    basicTerms.forEach(term => terms.add(term));
    
    if (this.containsFinancialData(content)) {
      terms.add('financial_data');
      terms.add('monetary_amounts');
    }
    
    if (/rate.*return|return.*equity|roe/i.test(content)) {
      terms.add('rate_of_return');
      terms.add('equity_return');
      terms.add('roe');
    }
    
    if (/Q\.\s+.*A\.\s+/i.test(content)) {
      terms.add('qa_testimony');
      terms.add('direct_testimony');
    }
    
    if (chunk.documentType) {
      terms.add(chunk.documentType.toLowerCase().replace(/\s+/g, '_'));
    }
    
    return Array.from(terms);
  }

  generateBasicSearchTerms(content) {
    const terms = new Set();
    const words = content.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use']);
    
    words.forEach(word => {
      if (!stopWords.has(word) && word.length >= 4) {
        terms.add(word);
      }
    });
    
    return Array.from(terms).slice(0, 20);
  }

  calculateQueryRelevance(content, searchQuery) {
    if (!searchQuery) return 0;
    const queryWords = searchQuery.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    let score = 0;
    queryWords.forEach(word => {
      const matches = (contentLower.match(new RegExp(word, 'g')) || []).length;
      score += matches;
    });
    return score;
  }

  getContextAroundMatch(content, position, contextLength = 100) {
    const start = Math.max(0, position - contextLength / 2);
    const end = Math.min(content.length, position + contextLength / 2);
    return content.substring(start, end);
  }
}

// Main processing function
export async function processExtractedDocuments(crawlerResults, options = {}) {
  const processor = new DocumentProcessor();
  
  // Override settings if provided
  if (options.chunkSize) processor.chunkSize = options.chunkSize;
  if (options.chunkOverlap) processor.chunkOverlap = options.chunkOverlap;
  if (options.minChunkSize) processor.minChunkSize = options.minChunkSize;
  
  const processedData = await processor.processDocuments(crawlerResults);
  
  // Save if requested
  if (options.saveToFile) {
    await processor.saveProcessedData(processedData, options.saveToFile);
  }
  
  // Print statistics
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