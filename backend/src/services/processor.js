import pdfParse from 'pdf-parse';
import axios from 'axios';
// Note: Readable is imported but not used, so we'll remove it to fix the lint warning

class DocumentProcessor {
  constructor() {
    this.supportedTypes = {
      'application/pdf': 'pdf',
      'text/plain': 'text',
      'text/html': 'html'
    };
  }

  /**
   * Process a document from a URL or buffer
   * @param {string|Buffer} source - URL or buffer of the document
   * @param {string} [mimeType] - MIME type of the document
   * @returns {Promise<Object>} - Processed document data
   */
  async processDocument(source, mimeType = 'application/pdf') {
    try {
      let buffer;
      
      // If source is a URL, download it
      if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))) {
        buffer = await this.downloadDocument(source);
      } else if (Buffer.isBuffer(source)) {
        buffer = source;
      } else {
        throw new Error('Invalid document source. Must be a URL or Buffer.');
      }

      // Process based on MIME type
      const type = this.supportedTypes[mimeType] || 'unknown';
      let content, metadata;

      switch (type) {
        case 'pdf':
          const pdfData = await this.processPdf(buffer);
          content = pdfData.text;
          metadata = {
            ...pdfData.metadata,
            pageCount: pdfData.numpages
          };
          break;
        
        case 'text':
        case 'html':
          content = buffer.toString('utf-8');
          metadata = { type };
          break;
        
        default:
          throw new Error(`Unsupported document type: ${mimeType}`);
      }

      return {
        content,
        metadata: {
          ...metadata,
          mimeType,
          size: buffer.length,
          processedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Error processing document:', error);
      throw new Error(`Failed to process document: ${error.message}`);
    }
  }

  /**
   * Download a document from a URL
   * @private
   */
  async downloadDocument(url) {
    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 30000 // 30 seconds timeout
      });

      return Buffer.from(response.data, 'binary');
    } catch (error) {
      throw new Error(`Failed to download document from ${url}: ${error.message}`);
    }
  }

  /**
   * Process a PDF document
   * @private
   */
  async processPdf(buffer) {
    try {
      const data = await pdfParse(buffer);
      return {
        text: data.text,
        metadata: data.metadata || {},
        numpages: data.numpages || 1
      };
    } catch (error) {
      throw new Error(`Failed to parse PDF: ${error.message}`);
    }
  }

  /**
   * Extract text from a readable stream
   * @param {Stream} stream - Readable stream
   * @returns {Promise<string>} - Extracted text
   */
  async extractTextFromStream(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('utf-8'));
      });
      stream.on('error', reject);
    });
  }

  /**
   * Split text into chunks of specified size
   * @param {string} text - Text to split
   * @param {number} chunkSize - Maximum size of each chunk in characters
   * @param {number} overlap - Number of characters to overlap between chunks
   * @returns {string[]} - Array of text chunks
   */
  chunkText(text, chunkSize = 1000, overlap = 100) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const chunks = [];
    let index = 0;
    
    while (index < text.length) {
      const chunk = text.slice(index, index + chunkSize);
      chunks.push(chunk);
      
      // Move forward by chunk size minus overlap
      index += chunkSize - overlap;
      
      // Ensure we don't get stuck in an infinite loop with very small chunks
      if (chunk.length < chunkSize / 2) {
        break;
      }
    }
    
    return chunks;
  }
}

export default DocumentProcessor;
