// backend/src/services/processor.js
// Clean Document Processor - Production Ready

import fs from 'fs';
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
        
        if (!documentText || documentText.length < this.minChunkSize) {
          console.log(`⚠️ Skipping ${document.documentName} - too short or empty`);
          processingStats.skippedDocuments++;
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
      if (!fs.existsSync(filepath)) {
        throw new Error(`File not found: ${filepath}`);
      }
      
      const content = fs.readFileSync(filepath, 'utf8');
      
      // Extract content after metadata
      const metadataEnd = content.indexOf('===== END METADATA =====');
      if (metadataEnd !== -1) {
        return content.substring(metadataEnd + 25).trim();
      }
      
      return content.trim();
    } catch (error) {
      console.log(`❌ Error reading file ${filepath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Create chunks from document text
   */
  createChunks(text, documentMetadata) {
    const chunks = [];
    
    // Basic text cleanup
    const cleanedText = this.cleanText(text);
    
    // Extract pages if they exist
    const pages = this.extractPages(cleanedText);
    
    if (pages.length === 0) {
      // No page markers - process as single document
      return this.createChunksFromText(cleanedText, documentMetadata, null);
    }

    // Process each page
    pages.forEach((page) => {
      const pageChunks = this.createChunksFromText(page.content, documentMetadata, page.pageNumber);
      chunks.push(...pageChunks);
    });

    return chunks;
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
   * Create chunks from text with safe limits
   */
  createChunksFromText(text, documentMetadata, pageNumber) {
    const chunks = [];
    
    if (text.length <= this.chunkSize) {
      chunks.push(this.createChunk(text, documentMetadata, pageNumber, 1, 1));
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
        chunks.push(this.createChunk(chunkText.trim(), documentMetadata, pageNumber, chunkIndex, this.maxChunksPerDoc));
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
   * Create a chunk object with complete metadata
   */
  createChunk(content, documentMetadata, pageNumber, chunkIndex, totalChunks) {
    const chunkId = this.generateChunkId(documentMetadata, pageNumber, chunkIndex);
    
    return {
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