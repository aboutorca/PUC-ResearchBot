import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// === DEBUGGING CODE - REMOVE AFTER FIXING FAILURES ===
const DEBUG_FAILURES = {
  failed: [],
  record: function(caseNumber, documentName, documentUrl, company, error, workerId) {
    this.failed.push({
      caseNumber,
      documentName, 
      documentUrl,
      company,
      error: error.message,
      workerId,
      timestamp: new Date().toISOString()
    });
    console.log(`❌ FAILURE ${this.failed.length}: ${documentName} - ${error.message}`);
  },
  
  report: function() {
    if (this.failed.length === 0) {
      console.log('\n✅ NO FAILURES - Perfect run!');
      return;
    }
    
    console.log(`\n🔍 FAILURE REPORT - ${this.failed.length} documents failed:`);
    console.log('='.repeat(60));
    
    this.failed.forEach((failure, i) => {
      console.log(`\n${i+1}. ${failure.documentName}`);
      console.log(`   Case: ${failure.caseNumber} | Company: ${failure.company}`);
      console.log(`   Error: ${failure.error}`);
      console.log(`   URL: ${failure.documentUrl}`);
      console.log(`   Worker: ${failure.workerId} | Time: ${failure.timestamp}`);
    });
    
    // Quick pattern analysis
    const errorTypes = {};
    this.failed.forEach(f => {
      const errorType = f.error.includes('timeout') ? 'TIMEOUT' : 
                       f.error.includes('network') ? 'NETWORK' : 'OTHER';
      errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
    });
    
    console.log(`\n📊 Error patterns:`);
    Object.entries(errorTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} failures`);
    });
    
    console.log('\n💡 Next steps: Check the URLs above manually to see what they have in common');
    console.log('='.repeat(60));
  }
};
// === END DEBUGGING CODE ===

const caseListingUrls = [
  { url: 'https://puc.idaho.gov/case?util=1&closed=0', type: 'electric', status: 'open' },
  { url: 'https://puc.idaho.gov/case?util=1&closed=1', type: 'electric', status: 'closed' },
  { url: 'https://puc.idaho.gov/case?util=4&closed=0', type: 'natural_gas', status: 'open' },
  { url: 'https://puc.idaho.gov/case?util=4&closed=1', type: 'natural_gas', status: 'closed' }
];

// SIMPLE TEXT CLEANUP - No aggressive enhancement
function simpleTextCleanup(rawText) {
  return rawText
    .replace(/View plain text/gi, '')
    .replace(/View images/gi, '')
    .replace(/Search in document/gi, '')
    .replace(/PUC Case Management/gi, '')
    .replace(/PublicFiles.*?Company/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// PROGRESS TRACKER CLASS
class ProgressTracker {
  constructor() {
    this.startTime = Date.now();
    this.totalDocuments = 0;
    this.extractedDocuments = 0;
    this.currentCase = '';
    this.currentCaseProgress = { extracted: 0, total: 0 };
    this.activeWorkers = 0;
    this.maxWorkers = 0;
    this.updateInterval = null;
    this.onUpdate = null; // Callback for UI updates
  }

  initialize(totalDocs, maxWorkers, onUpdateCallback = null) {
    this.totalDocuments = totalDocs;
    this.maxWorkers = maxWorkers;
    this.onUpdate = onUpdateCallback;
    this.startRealTimeUpdates();
  }

  updateProgress(extracted, currentCase = '', caseProgress = { extracted: 0, total: 0 }, activeWorkers = 0) {
    this.extractedDocuments = extracted;
    this.currentCase = currentCase;
    this.currentCaseProgress = caseProgress;
    this.activeWorkers = activeWorkers;
  }

  getProgressData() {
    const elapsed = (Date.now() - this.startTime) / 1000; // seconds
    const percentage = this.totalDocuments > 0 ? Math.round((this.extractedDocuments / this.totalDocuments) * 100) : 0;
    
    // Calculate speed (docs per minute)
    const docsPerMinute = elapsed > 0 ? (this.extractedDocuments / (elapsed / 60)) : 0;
    
    // Calculate ETA
    const remainingDocs = this.totalDocuments - this.extractedDocuments;
    const etaMinutes = docsPerMinute > 0 ? remainingDocs / docsPerMinute : 0;
    const etaFormatted = this.formatTime(etaMinutes * 60);

    return {
      percentage,
      extracted: this.extractedDocuments,
      total: this.totalDocuments,
      docsPerMinute: Math.round(docsPerMinute * 10) / 10, // 1 decimal place
      eta: etaFormatted,
      activeWorkers: this.activeWorkers,
      maxWorkers: this.maxWorkers,
      currentCase: this.currentCase,
      currentCaseProgress: this.currentCaseProgress,
      elapsedTime: this.formatTime(elapsed)
    };
  }

  formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}:${mins.toString().padStart(2, '0')}:00`;
    }
  }

  displayProgress() {
    const data = this.getProgressData();
    
    const progressBar = this.createProgressBar(data.percentage);
    
    const display = `
🚀 CRAWLER PROGRESS
${progressBar}
📊 Overall: ${data.extracted}/${data.total} documents (${data.percentage}%) | ETA: ${data.eta} remaining
⚡ Speed: ${data.docsPerMinute} docs/min | Workers: ${data.activeWorkers}/${data.maxWorkers} active | Elapsed: ${data.elapsedTime}
📄 Current: ${data.currentCase} (${data.currentCaseProgress.extracted}/${data.currentCaseProgress.total} docs)
    `.trim();

    // Clear previous lines and display new progress
    process.stdout.write('\x1b[2K\r'); // Clear current line
    process.stdout.write('\x1b[1A\x1b[2K\r'); // Move up and clear
    process.stdout.write('\x1b[1A\x1b[2K\r'); // Move up and clear
    process.stdout.write('\x1b[1A\x1b[2K\r'); // Move up and clear
    process.stdout.write('\x1b[1A\x1b[2K\r'); // Move up and clear
    console.log(display);

    // Call UI callback if provided
    if (this.onUpdate) {
      this.onUpdate(data);
    }

    return data;
  }

  createProgressBar(percentage, width = 30) {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}] ${percentage}%`;
  }

  startRealTimeUpdates() {
    // Display initial progress
    console.log('\n'.repeat(4)); // Reserve space for progress display
    this.displayProgress();

    // Update every 2 seconds
    this.updateInterval = setInterval(() => {
      this.displayProgress();
    }, 2000);
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Final progress display
    const finalData = this.displayProgress();
    console.log('\n✅ Progress tracking complete!');
    
    return finalData;
  }
}

async function extractCaseListings(page, utilityType, caseStatus) {
  return page.evaluate(({ utilType, status }) => {
    const cases = [];
    const tables = Array.from(document.querySelectorAll('table'));
    let caseTable = tables.find((tbl) => {
      const txt = tbl.textContent.toLowerCase();
      return txt.includes('caseno') && txt.includes('company') && txt.includes('description');
    });

    if (!caseTable) {
      caseTable = tables.find((tbl) => {
        const links = Array.from(tbl.querySelectorAll('a[href*="case"]'));
        return links.some((a) => /[A-Z]{2,4}-[A-Z]-\d{2}-\d{2}/.test(a.textContent));
      });
    }

    if (!caseTable) {
      console.log('Could not find case data table');
      return cases;
    }

    const rows = Array.from(caseTable.querySelectorAll('tr'));
    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 3) {
        const caseNumber = cells[0].textContent.trim();
        const company = cells[1].textContent.trim();
        const description = cells[2].textContent.trim();
        const caseUrl = cells[0].querySelector('a')?.href;
        if (
          caseNumber &&
          caseUrl &&
          /[A-Z]{2,4}-[A-Z]-\d{2}-\d{2}/.test(caseNumber)
        ) {
          cases.push({
            caseNumber,
            company,
            description,
            caseUrl,
            utilityType: utilType,
            caseStatus: status,
          });
        }
      }
    });

    return cases;
  }, { utilType: utilityType, status: caseStatus });
}

function matchesQuery(caseData, userQuery) {
  const query = userQuery.toLowerCase();
  const company = caseData.company.toLowerCase();
  const description = caseData.description.toLowerCase();
  
  const coreTerms = query
    .replace(/\brate cases\b/g, 'rate')
    .replace(/\bgeneral rate cases\b/g, 'rate')
    .replace(/\bcases\b/g, 'case')
    .split(' ')
    .filter((term) => term.length > 2);
  
  const matchesCompany = coreTerms.some((t) => company.includes(t));
  const matchesDescription = coreTerms.some((t) => description.includes(t));
  
  return matchesCompany || matchesDescription;
}

async function validateCaseDate(page, startDate, endDate) {
  const dateStr = await page.evaluate(() => {
    const dateFiledCell = document.querySelector('td[data-title="Date Filed"]');
    if (dateFiledCell) {
      const match = dateFiledCell.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
      if (match) return match[0];
    }
    
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headerRow = table.querySelector('tr');
      if (!headerRow) continue;
      
      const headers = Array.from(headerRow.querySelectorAll('th'));
      const dateFiledIndex = headers.findIndex(th => 
        th.textContent.trim() === 'Date Filed' || 
        th.getAttribute('data-title') === 'Date Filed'
      );
      
      if (dateFiledIndex !== -1) {
        const dataRow = table.querySelector('tbody tr');
        if (dataRow) {
          const dataCells = dataRow.querySelectorAll('td');
          if (dataCells[dateFiledIndex]) {
            const match = dataCells[dateFiledIndex].textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
            if (match) return match[0];
          }
        }
      }
    }
    
    return null;
  });

  if (!dateStr) {
    console.log('No Date Filed found - skipping case');
    return false;
  }
  const filed = new Date(dateStr);
  const isValid = filed >= new Date(startDate) && filed <= new Date(endDate);
  console.log('Date Filed ' + dateStr + ' is ' + (isValid ? 'VALID' : 'INVALID') + ' for range ' + startDate + ' to ' + endDate);
  return isValid;
}

// UPDATED extractDocumentText with failure tracking
async function extractDocumentText(page, documentUrl, documentName, caseNumber, caseInfo, workerId = 0) {
  try {
    console.log(`[Worker ${workerId}] 📄 Extracting text from: ${documentName}`);
    
    await page.goto(documentUrl, { waitUntil: 'networkidle2', timeout: 120000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const needsTextMode = await page.evaluate(() => {
      const textModeButton = document.querySelector('#TEXTMODE');
      return !!textModeButton;
    });

    if (needsTextMode) {
      console.log(`[Worker ${workerId}] 🔄 Clicking "View plain text" button...`);
      await page.click('#TEXTMODE');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // RE-DETECT document type AFTER clicking "View plain text"
    // This is the key fix - WebLink docs should now show LaserFiche-style text layers
    const documentType = await page.evaluate(() => {
      const hasTextLayers = document.querySelectorAll('.textPageInner.TextLayer').length > 0;
      const hasPdfLayers = document.querySelectorAll('.textLayer').length > 0;
      const hasPdfViewer = document.querySelector('#viewer.pdfViewer') !== null;
      const hasMarkedContent = document.querySelectorAll('.markedContent').length > 0;
      const hasWebLinkIframe = document.querySelector('#pdfViewerIFrame') !== null;
      
      // PRIORITY ORDER CHANGE: Check for clean text layers first
      if (hasTextLayers) {
        return 'laserfiche_image'; // Use LaserFiche extraction for clean text
      } else if (hasPdfViewer && hasMarkedContent) {
        return 'pdfjs'; // Use PDF.js extraction for clean text
      } else if (hasPdfLayers) {
        return 'laserfiche_text'; // Use LaserFiche text extraction
      } else if (hasWebLinkIframe) {
        return 'weblink_iframe'; // Fallback to iframe (should be rare after "View plain text")
      } else {
        return 'unknown';
      }
    });

    console.log(`[Worker ${workerId}] 🔍 Document type detected (after text mode): ${documentType}`);

    if (documentType === 'unknown') {
      console.log(`[Worker ${workerId}] ❌ Unknown document type for ${documentName}`);
      return null;
    }

    let fullText = '';
    let totalPages = 0;

    if (documentType === 'laserfiche_image') {
      console.log(`[Worker ${workerId}] 🔄 LaserFiche Image detected - using BULK SCROLLING extraction...`);
      
      const totalPageCount = await page.evaluate(() => {
        const pageCountDiv = document.querySelector('div[style*="display: inline-block"]');
        if (pageCountDiv && pageCountDiv.textContent.includes('/')) {
          const match = pageCountDiv.textContent.match(/\/\s*(\d+)/);
          return match ? parseInt(match[1]) : 0;
        }
        
        const bodyText = document.body.textContent || '';
        const match = bodyText.match(/\/\s*(\d+)/);
        return match ? parseInt(match[1]) : 0;
      });
      
      console.log(`[Worker ${workerId}] 📖 Total pages detected: ${totalPageCount}`);
      
      if (totalPageCount > 0) {
        let allText = '';
        let successfulPages = 0;
        
        if (totalPageCount <= 50) {
          // SMALL DOCS: Use original page-by-page for reliability
          console.log(`[Worker ${workerId}] 📄 Small doc - using page-by-page extraction`);
          
          for (let pageNum = 1; pageNum <= totalPageCount; pageNum++) {
            try {
              await page.evaluate((targetPage) => {
                const pageInput = document.querySelector('#pageNum');
                if (pageInput) {
                  pageInput.focus();
                  pageInput.select();
                  pageInput.value = targetPage.toString();
                  pageInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
                }
              }, pageNum);
              
              await new Promise(resolve => setTimeout(resolve, 800));
              
              const pageText = await page.evaluate(() => {
                const currentPage = document.querySelector('.currentImageBoxShadow .textPageInner.TextLayer');
                if (currentPage) {
                  const text = currentPage.textContent || currentPage.innerText || '';
                  return text.trim();
                }
                
                const textLayers = document.querySelectorAll('.textPageInner.TextLayer');
                for (const layer of textLayers) {
                  const text = layer.textContent || layer.innerText || '';
                  if (text.trim().length > 10) {
                    return text.trim();
                  }
                }
                return '';
              });
              
              if (pageText.length > 10) {
                allText += `\n--- PAGE ${pageNum} ---\n${pageText}\n`;
                successfulPages++;
              }
              
            } catch (error) {
              console.log(`[Worker ${workerId}] 💥 Error on page ${pageNum}: ${error.message}`);
            }
          }
          
        } else {
          // LARGE DOCS: Use BULK SCROLLING approach
          console.log(`[Worker ${workerId}] 🚀 Large doc (${totalPageCount} pages) - using BULK SCROLLING`);
          
          // Strategy: Jump to different sections and scroll, collecting pages as we go
          const sectionsToProcess = Math.min(10, Math.ceil(totalPageCount / 100)); // Process in 10 sections max
          const pagesPerSection = Math.ceil(totalPageCount / sectionsToProcess);
          
          for (let section = 0; section < sectionsToProcess; section++) {
            const startPage = (section * pagesPerSection) + 1;
            const endPage = Math.min((section + 1) * pagesPerSection, totalPageCount);
            
            console.log(`[Worker ${workerId}] 📊 Processing section ${section + 1}/${sectionsToProcess}: pages ${startPage}-${endPage}`);
            
            // Jump to start of this section
            await page.evaluate((targetPage) => {
              const pageInput = document.querySelector('#pageNum');
              if (pageInput) {
                pageInput.focus();
                pageInput.select();
                pageInput.value = targetPage.toString();
                pageInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
              }
            }, startPage);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // BULK SCROLL through this section
            const sectionPages = endPage - startPage + 1;
            for (let i = 0; i < sectionPages && i < 50; i++) { // Max 50 pages per scroll session
              const currentPageNum = startPage + i;
              
              // Quick navigation - don't wait as long
              if (i > 0) {
                await page.evaluate(() => {
                  const nextButton = document.querySelector('img[title="Next Page"]') || 
                                   document.querySelector('input[title="Next Page"]') ||
                                   document.querySelector('button[title="Next Page"]');
                  if (nextButton) {
                    nextButton.click();
                  }
                });
                await new Promise(resolve => setTimeout(resolve, 300)); // Much faster
              }
              
              // Extract text from current page
              const pageText = await page.evaluate(() => {
                const currentPage = document.querySelector('.currentImageBoxShadow .textPageInner.TextLayer');
                if (currentPage) {
                  const text = currentPage.textContent || currentPage.innerText || '';
                  return text.trim();
                }
                
                const textLayers = document.querySelectorAll('.textPageInner.TextLayer');
                for (const layer of textLayers) {
                  const text = layer.textContent || layer.innerText || '';
                  if (text.trim().length > 10) {
                    return text.trim();
                  }
                }
                return '';
              });
              
              if (pageText.length > 10) {
                allText += `\n--- PAGE ${currentPageNum} ---\n${pageText}\n`;
                successfulPages++;
              }
              
              // Progress update every 25 pages
              if (currentPageNum % 25 === 0) {
                console.log(`[Worker ${workerId}] 📊 Bulk progress: ${currentPageNum}/${totalPageCount} pages (${Math.round(currentPageNum/totalPageCount*100)}%)`);
              }
            }
          }
        }
        
        fullText = allText;
        totalPages = successfulPages;
        console.log(`[Worker ${workerId}] 📑 LaserFiche extraction complete: ${successfulPages}/${totalPageCount} pages`);
      }
      
    } else if (documentType === 'pdfjs') {
      // PDF.js extraction (clean text from marked content)
      console.log(`[Worker ${workerId}] 🔍 Using PDF.js extraction (clean text)...`);
      
      let extractionResult = await page.evaluate(() => {
        const textLayers = document.querySelectorAll('.textLayer');
        let allText = '';
        let pageCount = 0;
        
        textLayers.forEach((layer, index) => {
          let pageText = '';
          const markedContent = layer.querySelectorAll('.markedContent');
          
          markedContent.forEach(content => {
            const textSpans = content.querySelectorAll('span[role="presentation"]');
            textSpans.forEach(span => {
              const spanText = span.textContent || span.innerText || '';
              if (spanText.trim() && !spanText.match(/^[\d\s\-\.,;:]+$/)) {
                pageText += spanText + ' ';
              }
            });
            
            if (content.querySelector('br[role="presentation"]')) {
              pageText += '\n';
            }
          });
          
          if (pageText.trim().length > 10) {
            pageCount++;
            allText += '\n--- PAGE ' + pageCount + ' ---\n' + pageText.trim() + '\n';
          }
        });
        
        const totalPageDivs = document.querySelectorAll('.page').length;
        return {
          text: allText,
          pages: pageCount,
          totalExpected: totalPageDivs,
          needsLazyLoading: pageCount < (totalPageDivs * 0.8)
        };
      });
      
      if (extractionResult.needsLazyLoading && extractionResult.totalExpected > 5) {
        console.log(`[Worker ${workerId}] 📜 Triggering lazy loading...`);
        
        await page.evaluate(() => {
          const viewer = document.querySelector('#viewerContainer') || document.querySelector('#viewer');
          if (viewer) {
            viewer.scrollTop = viewer.scrollHeight;
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await page.evaluate(() => {
          const viewer = document.querySelector('#viewerContainer') || document.querySelector('#viewer');
          if (viewer) {
            viewer.scrollTop = 0;
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        extractionResult = await page.evaluate(() => {
          const textLayers = document.querySelectorAll('.textLayer');
          let allText = '';
          let pageCount = 0;
          
          textLayers.forEach((layer, index) => {
            let pageText = '';
            const markedContent = layer.querySelectorAll('.markedContent');
            
            markedContent.forEach(content => {
              const textSpans = content.querySelectorAll('span[role="presentation"]');
              textSpans.forEach(span => {
                const spanText = span.textContent || span.innerText || '';
                if (spanText.trim() && !spanText.match(/^[\d\s\-\.,;:]+$/)) {
                  pageText += spanText + ' ';
                }
              });
              if (content.querySelector('br[role="presentation"]')) {
                pageText += '\n';
              }
            });
            
            if (pageText.trim().length > 10) {
              pageCount++;
              allText += '\n--- PAGE ' + pageCount + ' ---\n' + pageText.trim() + '\n';
            }
          });
          
          return { text: allText, pages: pageCount };
        });
      }
      
      fullText = extractionResult.text;
      totalPages = extractionResult.pages;
      
    } else if (documentType === 'laserfiche_text') {
      let extractionResult = await page.evaluate(() => {
        const textLayers = document.querySelectorAll('.textLayer');
        let allText = '';
        let pageCount = 0;
        
        textLayers.forEach((layer, index) => {
          let pageText = '';
          const markedContent = layer.querySelectorAll('.markedContent');
          
          markedContent.forEach(content => {
            const textSpans = content.querySelectorAll('span[role="presentation"]');
            textSpans.forEach(span => {
              const spanText = span.textContent || span.innerText || '';
              if (spanText.trim() && !spanText.match(/^[\d\s\-\.,;:]+$/)) {
                pageText += spanText + ' ';
              }
            });
            
            if (content.querySelector('br[role="presentation"]')) {
              pageText += '\n';
            }
          });
          
          if (pageText.trim().length > 10) {
            pageCount++;
            allText += '\n--- PAGE ' + pageCount + ' ---\n' + pageText.trim() + '\n';
          }
        });
        
        const totalPageDivs = document.querySelectorAll('.page').length;
        return {
          text: allText,
          pages: pageCount,
          totalExpected: totalPageDivs,
          needsLazyLoading: pageCount < (totalPageDivs * 0.8)
        };
      });
      
      if (extractionResult.needsLazyLoading && extractionResult.totalExpected > 5) {
        console.log(`[Worker ${workerId}] 📜 Triggering lazy loading...`);
        
        await page.evaluate(() => {
          const viewer = document.querySelector('#viewerContainer') || document.querySelector('#viewer');
          if (viewer) {
            viewer.scrollTop = viewer.scrollHeight;
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        await page.evaluate(() => {
          const viewer = document.querySelector('#viewerContainer') || document.querySelector('#viewer');
          if (viewer) {
            viewer.scrollTop = 0;
          }
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        extractionResult = await page.evaluate(() => {
          const textLayers = document.querySelectorAll('.textLayer');
          let allText = '';
          let pageCount = 0;
          
          textLayers.forEach((layer, index) => {
            let pageText = '';
            const markedContent = layer.querySelectorAll('.markedContent');
            
            markedContent.forEach(content => {
              const textSpans = content.querySelectorAll('span[role="presentation"]');
              textSpans.forEach(span => {
                const spanText = span.textContent || span.innerText || '';
                if (spanText.trim() && !spanText.match(/^[\d\s\-\.,;:]+$/)) {
                  pageText += spanText + ' ';
                }
              });
              if (content.querySelector('br[role="presentation"]')) {
                pageText += '\n';
              }
            });
            
            if (pageText.trim().length > 10) {
              pageCount++;
              allText += '\n--- PAGE ' + pageCount + ' ---\n' + pageText.trim() + '\n';
            }
          });
          
          return { text: allText, pages: pageCount };
        });
      }
      
      fullText = extractionResult.text;
      totalPages = extractionResult.pages;
      
} else if (documentType === 'weblink_iframe') {
  console.log(`[Worker ${workerId}] 🔗 WebLink iframe detected - using BULK LOADING extraction...`);
  
  try {
    await page.waitForSelector('#pdfViewerIFrame', { timeout: 90000 });
    
    const iframe = await page.$('#pdfViewerIFrame');
    const frame = await iframe.contentFrame();
    
    if (!frame) {
      throw new Error('Could not access iframe content');
    }
    
    await frame.waitForFunction(
      () => {
        const viewer = document.querySelector('#viewer.pdfViewer');
        const pages = document.querySelectorAll('.page[data-page-number]');
        const markedContent = document.querySelectorAll('.markedContent');
        return viewer && pages.length > 0 && markedContent.length > 5;
      },
      { timeout: 120000, polling: 2000 }
    );
    
    // VALIDATION: Check initial page count
    const initialPageCount = await frame.evaluate(() => {
      const totalPages = document.querySelectorAll('.page[data-page-number]').length;
      const loadedPages = document.querySelectorAll('.page[data-loaded="true"]').length;
      return { totalPages, loadedPages };
    });
    
    console.log(`[Worker ${workerId}] 📊 Initial state: ${initialPageCount.loadedPages}/${initialPageCount.totalPages} pages loaded`);
    
    let allText = '';
    let processedPages = 0;
    
    if (initialPageCount.totalPages <= 50) {
      // SMALL DOCS: Use page-by-page for reliability
      console.log(`[Worker ${workerId}] 📄 Small WebLink doc - using page-by-page`);
      
      for (let pageNum = 1; pageNum <= initialPageCount.totalPages; pageNum++) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const currentPageContent = await frame.evaluate(() => {
            const allPages = document.querySelectorAll('.page[data-page-number]');
            let loadedPages = [];
            
            allPages.forEach(page => {
              const pageNumber = page.getAttribute('data-page-number');
              const isLoaded = page.getAttribute('data-loaded') === 'true';
              const markedContents = page.querySelectorAll('.markedContent');
              
              if (isLoaded && markedContents.length > 0) {
                let pageText = '';
                markedContents.forEach(content => {
                  const textSpans = content.querySelectorAll('span[role="presentation"]');
                  textSpans.forEach(span => {
                    const spanText = span.textContent || span.innerText || '';
                    if (spanText.trim()) {
                      pageText += spanText + ' ';
                    }
                  });
                  
                  if (content.querySelector('br[role="presentation"]')) {
                    pageText += '\n';
                  }
                });
                
                if (pageText.trim().length > 10) {
                  loadedPages.push({
                    pageNumber: pageNumber,
                    text: pageText.trim()
                  });
                }
              }
            });
            
            return loadedPages;
          });
          
          currentPageContent.forEach(loadedPage => {
            const pageMarker = `--- PAGE ${loadedPage.pageNumber} ---`;
            if (!allText.includes(pageMarker)) {
              allText += `\n${pageMarker}\n${loadedPage.text}\n`;
              processedPages++;
            }
          });
          
          if (pageNum < initialPageCount.totalPages) {
            await frame.evaluate(() => {
              const nextButton = document.querySelector('#next');
              if (nextButton && !nextButton.disabled) {
                nextButton.click();
              }
            });
          }
          
        } catch (pageError) {
          console.log(`[Worker ${workerId}] ⚠️ Error processing page ${pageNum}: ${pageError.message}`);
        }
      }
      
    } else {
      // LARGE DOCS: Use ENHANCED BULK LOADING with detailed logging
      console.log(`[Worker ${workerId}] 🚀 Large WebLink doc (${initialPageCount.totalPages} pages) - using BULK LOADING`);
      
      // Step 1: Aggressive scrolling to load ALL pages
      console.log(`[Worker ${workerId}] 🔄 Starting bulk lazy loading...`);
      
      const scrollSteps = Math.min(15, Math.ceil(initialPageCount.totalPages / 200));
      for (let step = 0; step <= scrollSteps; step++) {
        await frame.evaluate((currentStep, totalSteps) => {
          const viewer = document.querySelector('#viewerContainer') || document.querySelector('#viewer');
          if (viewer) {
            viewer.scrollTop = (viewer.scrollHeight * currentStep) / totalSteps;
          }
        }, step, scrollSteps);
        
        // INCREASED WAIT TIME: 3 seconds per scroll step for better loading
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Log progress every few steps
        if (step % 3 === 0) {
          const progressCheck = await frame.evaluate(() => {
            const totalPages = document.querySelectorAll('.page[data-page-number]').length;
            const loadedPages = document.querySelectorAll('.page[data-loaded="true"]').length;
            return { totalPages, loadedPages };
          });
          console.log(`[Worker ${workerId}] 📊 Scroll step ${step}/${scrollSteps}: ${progressCheck.loadedPages}/${progressCheck.totalPages} pages loaded`);
        }
      }
    
      // VALIDATION: Check final loading status after scrolling
      const finalPageCount = await frame.evaluate(() => {
        const totalPages = document.querySelectorAll('.page[data-page-number]').length;
        const loadedPages = document.querySelectorAll('.page[data-loaded="true"]').length;
        const pagesWithContent = document.querySelectorAll('.page[data-page-number] .markedContent').length;
        return { totalPages, loadedPages, pagesWithContent };
      });
      
      console.log(`[Worker ${workerId}] 📊 After scrolling: ${finalPageCount.loadedPages}/${finalPageCount.totalPages} pages loaded, ${finalPageCount.pagesWithContent} with content`);
      
      // VALIDATION: Warn if not enough pages loaded
      const loadingSuccessRate = (finalPageCount.loadedPages / finalPageCount.totalPages) * 100;
      if (loadingSuccessRate < 80) {
        console.log(`[Worker ${workerId}] ⚠️ Warning: Only ${Math.round(loadingSuccessRate)}% of pages loaded after scrolling`);
      }
      
      // Step 2: BULK EXTRACT all loaded pages
      console.log(`[Worker ${workerId}] 📖 Starting bulk extraction of ${finalPageCount.loadedPages} loaded pages...`);
      
      const allPageContent = await frame.evaluate(() => {
        const allPages = document.querySelectorAll('.page[data-page-number]');
        let loadedPages = [];
        let skippedPages = 0;
        
        allPages.forEach(page => {
          const pageNumber = parseInt(page.getAttribute('data-page-number'));
          const isLoaded = page.getAttribute('data-loaded') === 'true';
          const markedContents = page.querySelectorAll('.markedContent');
          
          if (isLoaded && markedContents.length > 0) {
            let pageText = '';
            markedContents.forEach(content => {
              const textSpans = content.querySelectorAll('span[role="presentation"]');
              textSpans.forEach(span => {
                const spanText = span.textContent || span.innerText || '';
                if (spanText.trim()) {
                  pageText += spanText + ' ';
                }
              });
              
              if (content.querySelector('br[role="presentation"]')) {
                pageText += '\n';
              }
            });
            
            if (pageText.trim().length > 10) {
              loadedPages.push({
                pageNumber: pageNumber,
                text: pageText.trim(),
                textLength: pageText.trim().length
              });
            } else {
              skippedPages++;
            }
          } else {
            skippedPages++;
          }
        });
        
        // Sort by page number
        return { 
          loadedPages: loadedPages.sort((a, b) => a.pageNumber - b.pageNumber),
          skippedPages: skippedPages
        };
      });
      
      console.log(`[Worker ${workerId}] 📊 Extraction results: ${allPageContent.loadedPages.length} pages extracted, ${allPageContent.skippedPages} pages skipped`);
      
      // Log first few and last few pages for validation
      if (allPageContent.loadedPages.length > 0) {
        const firstPage = allPageContent.loadedPages[0];
        const lastPage = allPageContent.loadedPages[allPageContent.loadedPages.length - 1];
        console.log(`[Worker ${workerId}] 📄 Page range: ${firstPage.pageNumber} to ${lastPage.pageNumber}`);
        console.log(`[Worker ${workerId}] 📝 Text lengths: Page ${firstPage.pageNumber}=${firstPage.textLength} chars, Page ${lastPage.pageNumber}=${lastPage.textLength} chars`);
      }
      
      // Step 3: Process all extracted pages
      allPageContent.loadedPages.forEach(loadedPage => {
        allText += `\n--- PAGE ${loadedPage.pageNumber} ---\n${loadedPage.text}\n`;
        processedPages++;
      });
      
      // FINAL VALIDATION
      const extractionSuccessRate = (processedPages / finalPageCount.totalPages) * 100;
      console.log(`[Worker ${workerId}] 📊 Final extraction: ${processedPages}/${finalPageCount.totalPages} pages (${Math.round(extractionSuccessRate)}% success)`);
      
      if (extractionSuccessRate < 80) {
        console.log(`[Worker ${workerId}] ❌ WARNING: Low extraction success rate - only ${Math.round(extractionSuccessRate)}% of pages extracted`);
      }
    }
    
    fullText = allText;
    totalPages = processedPages;
    console.log(`[Worker ${workerId}] ✅ WebLink extraction complete: ${processedPages} pages, ${allText.length} characters`);
    
  } catch (error) {
    console.log(`[Worker ${workerId}] ❌ WebLink extraction failed: ${error.message}`);
    throw error;
  }
}

    console.log(`[Worker ${workerId}] 📑 Total pages extracted: ${totalPages}`);
    console.log(`[Worker ${workerId}] 📝 Total text length: ${fullText.length}`);

    if (fullText.trim()) {
      const filename = caseNumber + '_' + sanitizeFilename(documentName) + '.txt';
      const textDir = path.join(process.env.HOME, 'Downloads', 'extracted_texts');
      
      if (!fs.existsSync(textDir)) {
        fs.mkdirSync(textDir, { recursive: true });
      }
      
      // SIMPLE CLEANUP ONLY - No aggressive enhancement
      const cleanedText = simpleTextCleanup(fullText);
      
      console.log(`[Worker ${workerId}] 🧹 Text cleaned: ${cleanedText.length} characters`);
      
      const enhancedContent = '===== DOCUMENT METADATA =====\n' +
        'Case Number: ' + caseNumber + '\n' +
        'Company: ' + caseInfo.company + '\n' +
        'Utility Type: ' + caseInfo.utilityType + ' (' + (caseInfo.utilityType === 'electric' ? 'Electric' : 'Natural Gas') + ')\n' +
        'Case Status: ' + caseInfo.caseStatus + ' (' + (caseInfo.caseStatus === 'open' ? 'Currently Active' : 'Closed/Completed') + ')\n' +
        'Document Name: ' + documentName + '\n' +
        'Document Type: ' + (documentName.includes('DIRECT') ? 'Company Direct Testimony' : 'Staff Document') + '\n' +
        'Document Source: ' + documentUrl + '\n' +
        'Extracted Pages: ' + totalPages + '\n' +
        'Extraction Date: ' + new Date().toISOString() + '\n' +
        '===== END METADATA =====\n\n' +
        cleanedText;
      
      const filepath = path.join(textDir, filename);
      fs.writeFileSync(filepath, enhancedContent, 'utf8');
      
      console.log(`[Worker ${workerId}] ✅ Saved: ${filename} (${cleanedText.length} characters, ${totalPages} pages)`);
      
      return {
        filename,
        filepath,
        textLength: cleanedText.length,
        pages: totalPages,
        caseNumber,
        company: caseInfo.company,
        utilityType: caseInfo.utilityType,
        caseStatus: caseInfo.caseStatus,
        documentName,
        documentType: documentName.includes('DIRECT') ? 'Company_Direct_Testimony' : 'Staff_Document',
        documentUrl,
        extractedAt: new Date().toISOString(),
        content: cleanedText,
        contentWithMetadata: enhancedContent,
        success: true,
        citation: {
          caseNumber,
          company: caseInfo.company,
          utilityType: caseInfo.utilityType === 'electric' ? 'Electric' : 'Natural Gas',
          caseStatus: caseInfo.caseStatus === 'open' ? 'Open Case' : 'Closed Case',
          documentName,
          documentType: documentName.includes('DIRECT') ? 'Company Direct Testimony' : 'Staff Document',
          pageCount: totalPages,
          source: 'Idaho Public Utilities Commission'
        }
      };
    } else {
      console.log(`[Worker ${workerId}] ❌ No text extracted from ${documentName}`);
      return null;
    }

  } catch (error) {
    // === ADD FAILURE TRACKING ===
    DEBUG_FAILURES.record(caseNumber, documentName, documentUrl, caseInfo.company, error, workerId);
    console.log(`[Worker ${workerId}] 💥 Error extracting text from ${documentName}: ${error.message}`);
    return null;
  }
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9\s\-_.]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

async function getDocumentLinksFromCase(page, caseInfo) {
  await page.goto(caseInfo.caseUrl, { waitUntil: 'networkidle2' });
  
  const documentLinks = await page.evaluate(() => {
    const links = [];
    
    const companyHeaders = Array.from(document.querySelectorAll('.div-header-box')).filter(h => h.textContent.trim() === 'Company');
    if (companyHeaders.length > 0) {
      const companySection = companyHeaders[0].parentElement;
      const companyLinks = Array.from(companySection.querySelectorAll('a[href*="lf-puc.idaho.gov"]'));
      
      companyLinks.forEach(link => {
        const documentName = link.textContent.trim();
        if (documentName.includes('DIRECT')) {
          links.push({
            text: documentName,
            href: link.href,
            section: 'Company_Direct',
            priority: 'required'
          });
        }
      });
    }
    
    const staffHeaders = Array.from(document.querySelectorAll('.div-header-box')).filter(h => h.textContent.trim() === 'Staff');
    if (staffHeaders.length > 0) {
      const staffSection = staffHeaders[0].parentElement;
      const staffLinks = Array.from(staffSection.querySelectorAll('a[href*="lf-puc.idaho.gov"]'));
      
      staffLinks.forEach(link => {
        const documentName = link.textContent.trim();
        links.push({
          text: documentName,
          href: link.href,
          section: 'Staff',
          priority: 'required'
        });
      });
    }
    
    return links;
  });
  
  return documentLinks;
}

async function processDocumentChunk(caseInfo, documentChunk, workerId, onProgressUpdate = null) {
  // HEADLESS FOR SPEED - but can switch back to visual if needed
  const browser = await puppeteer.launch({ 
    headless: true, // SPEED: headless
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  const extractedTexts = [];
  
  try {
    const page = await browser.newPage();
    
    for (const docLink of documentChunk) {
      console.log(`[Worker ${workerId}] 📄 Processing: ${docLink.text}`);
      
      const textResult = await extractDocumentText(
        page, 
        docLink.href, 
        docLink.text, 
        caseInfo.caseNumber,
        caseInfo,
        workerId
      );
      
      if (textResult) {
        extractedTexts.push(textResult);
      }
      
      // Update progress after each document
      if (onProgressUpdate) {
        onProgressUpdate(extractedTexts.length);
      }
    }
    
    console.log(`[Worker ${workerId}] ✅ Chunk complete: ${extractedTexts.length}/${documentChunk.length} documents extracted`);
    
  } catch (error) {
    console.log(`[Worker ${workerId}] 💥 Error processing chunk: ${error.message}`);
  } finally {
    await browser.close();
  }
  
  return extractedTexts;
}

async function processDocumentsInParallel(caseInfo, documentLinks, maxWorkers = 15, onProgressUpdate = null) {
  console.log(`📦 Processing ${caseInfo.caseNumber}: ${documentLinks.length} documents with up to ${maxWorkers} workers`);
  
  if (documentLinks.length === 0) {
    console.log(`⚠️ No documents found for ${caseInfo.caseNumber}`);
    return [];
  }
  
  const effectiveWorkers = Math.min(maxWorkers, documentLinks.length);
  const documentsPerWorker = Math.ceil(documentLinks.length / effectiveWorkers);
  const documentChunks = chunkArray(documentLinks, documentsPerWorker);
  
  console.log(`📋 Splitting ${documentLinks.length} documents into ${documentChunks.length} chunks of ~${documentsPerWorker} docs each`);
  
  const extractedTexts = [];
  let completedDocs = 0;
  
  const workerPromises = documentChunks.map((chunk, chunkIndex) => {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(processDocumentChunk(caseInfo, chunk, chunkIndex + 1, (extractedCount) => {
          completedDocs = extractedTexts.length + extractedCount;
          if (onProgressUpdate) {
            onProgressUpdate(completedDocs);
          }
        }));
      }, chunkIndex * 1500); // Faster stagger
    });
  });
  
  const chunkResults = await Promise.all(workerPromises);
  
  chunkResults.forEach(chunkTexts => {
    extractedTexts.push(...chunkTexts);
  });
  
  console.log(`✅ ${caseInfo.caseNumber}: ${extractedTexts.length}/${documentLinks.length} documents extracted using ${documentChunks.length} workers`);
  
  return extractedTexts;
}

function preprocessQuery(query) {
  const originalQuery = query.toLowerCase().trim();
  
  let processedQuery = originalQuery
    .replace(/\brate cases\b/g, 'rate case')
    .replace(/\bgeneral rate increases\b/g, 'general rate')
    .replace(/\bcases\b/g, 'case')
    .replace(/\bincreases\b/g, 'increase')
    .replace(/\bcompanies\b/g, 'company')
    .replace(/\btariffs\b/g, 'tariff')
    .replace(/\brates\b/g, 'rate');
  
  console.log('📝 Preprocessed query: "' + originalQuery + '" → "' + processedQuery + '"');
  return processedQuery;
}

async function searchCasesByDescription(page, utilityType, caseStatus, query, dateRange) {
  const searchQuery = preprocessQuery(query);
  console.log('🔍 Searching ' + caseStatus + ' ' + utilityType + ' cases for: "' + searchQuery + '"');
  
  const dropdownSuccess = await page.evaluate(() => {
    const dropdown = document.querySelector('select#fc[name="fc"]');
    if (dropdown) {
      dropdown.value = "3";
      const event = new Event('change', { bubbles: true });
      dropdown.dispatchEvent(event);
      return true;
    }
    return false;
  });
  
  if (!dropdownSuccess) {
    console.log('❌ Could not find search dropdown - falling back to full listing');
    return [];
  }
  
  const searchSuccess = await page.evaluate((searchTerm) => {
    const searchInput = document.querySelector('input[name="fv"]');
    if (searchInput) {
      searchInput.value = searchTerm;
      return true;
    }
    return false;
  }, searchQuery);
  
  if (!searchSuccess) {
    console.log('❌ Could not find search input - falling back to full listing');
    return [];
  }
  
  const clickSuccess = await page.evaluate(() => {
    const goButton = document.querySelector('input[type="button"][value="Go"][onclick="searchPSFGrid();"]');
    if (goButton) {
      goButton.click();
      return true;
    }
    return false;
  });
  
  if (!clickSuccess) {
    console.log('❌ Could not find Go button');
    return [];
  }
  
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  
  const allCases = await extractCaseListings(page, utilityType, caseStatus);
  console.log('📋 Found ' + allCases.length + ' cases matching "' + searchQuery + '"');
  
  const filteredCases = allCases.filter(caseInfo => {
    const matches = matchesQuery(caseInfo, query);
    return matches;
  });
  
  console.log('🎯 ' + filteredCases.length + ' cases after client-side refinement');
  
  const validCases = [];
  
  if (caseStatus === 'closed') {
    let consecutiveTooNew = 0;
    const MAX_CONSECUTIVE_TOO_NEW = 5;
    const endDate = new Date(dateRange.end);
    
    for (const caseInfo of filteredCases) {
      try {
        await page.goto(caseInfo.caseUrl, { waitUntil: 'networkidle0' });
        const isValidDate = await validateCaseDate(page, dateRange.start, dateRange.end);
        
        if (isValidDate) {
          consecutiveTooNew = 0;
          validCases.push(caseInfo);
          console.log('✅ Valid: ' + caseInfo.caseNumber);
        } else {
          const dateStr = await page.evaluate(() => {
            const dateFiledCell = document.querySelector('td[data-title="Date Filed"]');
            if (dateFiledCell) {
              const match = dateFiledCell.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
              return match ? match[0] : null;
            }
            return null;
          });
          
          if (dateStr) {
            const caseDate = new Date(dateStr);
            if (caseDate > endDate) {
              consecutiveTooNew++;
              console.log('⏭️ Too new: ' + caseInfo.caseNumber + ' (' + dateStr + ')');
              
              if (consecutiveTooNew >= MAX_CONSECUTIVE_TOO_NEW) {
                console.log('🛑 Stopping - too many consecutive new dates');
                break;
              }
            } else {
              consecutiveTooNew = 0;
              console.log('⏪ Too old: ' + caseInfo.caseNumber + ' (' + dateStr + ')');
            }
          }
        }
      } catch (error) {
        console.log('💥 Error validating ' + caseInfo.caseNumber + ': ' + error.message);
      }
    }
  } else {
    let consecutiveInvalidDates = 0;
    const MAX_CONSECUTIVE_INVALID = 5;
    
    for (const caseInfo of filteredCases) {
      try {
        await page.goto(caseInfo.caseUrl, { waitUntil: 'networkidle0' });
        const isValidDate = await validateCaseDate(page, dateRange.start, dateRange.end);
        
        if (!isValidDate) {
          consecutiveInvalidDates++;
          if (consecutiveInvalidDates >= MAX_CONSECUTIVE_INVALID) {
            console.log('🛑 Stopping - too many consecutive invalid dates');
            break;
          }
          continue;
        }
        
        consecutiveInvalidDates = 0;
        validCases.push(caseInfo);
        console.log('✅ Valid: ' + caseInfo.caseNumber);
      } catch (error) {
        console.log('💥 Error validating ' + caseInfo.caseNumber + ': ' + error.message);
      }
    }
  }
  
  return validCases;
}

class ProvenWorkingCrawler {
  constructor() {
    this.progressTracker = new ProgressTracker();
  }

  async crawlCases(query, utilities = ['electric', 'natural_gas'], dateRange = { start: '2024-01-01', end: '2025-12-31' }, maxParallel = 15, onProgressUpdate = null) {
    console.log(`🚀 Starting PROVEN WORKING crawler with ${maxParallel} workers...`);
    console.log(`⚡ Optimizations: Headless browsers, WebLink text fix, complete extraction`);
    
    const result = { 
      jobId: uuidv4(), 
      query, 
      utilities, 
      dateRange, 
      maxParallel,
      casesFound: [], 
      allExtractedDocuments: [],
      documentsByCaseNumber: {},
      chatReadyData: {
        documents: [],
        caseNumbers: [],
        companies: [],
        utilityTypes: [],
        documentTypes: [],
        totalContent: '',
        extractionSummary: ''
      },
      summary: { 
        totalCases: 0, 
        totalDocuments: 0, 
        totalTextFiles: 0, 
        processingTime: 0,
        casesByUtility: {},
        casesByStatus: {},
        documentsByType: {},
        averageDocumentLength: 0,
        workersUtilized: 0,
        optimizations: [
          'Headless browsers for speed',
          'WebLink text quality fix',
          'Complete document extraction',
          'Proven extraction logic',
          'Real-time progress tracking'
        ]
      } 
    };
    const startTime = Date.now();
    
    try {
      console.log('🔍 Step 1: Case discovery...');
      const allValidCases = await this.discoverCases(utilities, query, dateRange);
      
      console.log(`🎯 Found ${allValidCases.length} valid cases`);
      
      if (allValidCases.length === 0) {
        console.log('⚠️ No valid cases found');
        return result;
      }

      // Count total documents across all cases
      console.log('📊 Counting total documents...');
      let totalDocuments = 0;
      const caseDocumentCounts = {};
      
      for (const caseInfo of allValidCases) {
        const browser = await puppeteer.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        const documentLinks = await getDocumentLinksFromCase(page, caseInfo);
        await browser.close();
        
        caseDocumentCounts[caseInfo.caseNumber] = documentLinks.length;
        totalDocuments += documentLinks.length;
      }

      console.log(`📄 Total documents to extract: ${totalDocuments}`);
      
      // Initialize progress tracker
      this.progressTracker.initialize(totalDocuments, maxParallel, onProgressUpdate);
      
      console.log(`📄 Step 2: Complete document extraction...`);
      
      let totalWorkersUsed = 0;
      let totalExtracted = 0;
      
      for (const caseInfo of allValidCases) {
        console.log(`\n🔄 Processing case: ${caseInfo.caseNumber}`);
        
        const browser = await puppeteer.launch({ 
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        const documentLinks = await getDocumentLinksFromCase(page, caseInfo);
        await browser.close();
        
        if (documentLinks.length === 0) {
          console.log(`⚠️ No documents found for ${caseInfo.caseNumber}, skipping...`);
          continue;
        }
        
        // Update progress tracker with current case
        const currentCaseTotal = caseDocumentCounts[caseInfo.caseNumber];
        const activeWorkers = Math.min(maxParallel, documentLinks.length);
        
        this.progressTracker.updateProgress(
          totalExtracted,
          `Processing ${caseInfo.caseNumber}`,
          { extracted: 0, total: currentCaseTotal },
          activeWorkers
        );
        
        const extractedTexts = await processDocumentsInParallel(
          caseInfo, 
          documentLinks, 
          maxParallel,
          (caseExtracted) => {
            // Update progress during case processing
            this.progressTracker.updateProgress(
              totalExtracted + caseExtracted,
              `Processing ${caseInfo.caseNumber}`,
              { extracted: caseExtracted, total: currentCaseTotal },
              activeWorkers
            );
          }
        );
        
        totalExtracted += extractedTexts.length;
        
        const workersUsedThisCase = Math.min(maxParallel, documentLinks.length);
        totalWorkersUsed = Math.max(totalWorkersUsed, workersUsedThisCase);
        
        const caseResult = {
          ...caseInfo,
          documents: extractedTexts.length,
          extractedTexts,
          textFilesCreated: extractedTexts.length
        };
        
        result.casesFound.push(caseResult);
        
        extractedTexts.forEach(textResult => {
          result.allExtractedDocuments.push(textResult);
          
          if (!result.documentsByCaseNumber[caseResult.caseNumber]) {
            result.documentsByCaseNumber[caseResult.caseNumber] = {
              caseInfo: caseResult,
              documents: []
            };
          }
          result.documentsByCaseNumber[caseResult.caseNumber].documents.push(textResult);
          
          result.chatReadyData.documents.push({
            id: textResult.filename,
            caseNumber: textResult.caseNumber,
            company: textResult.company,
            utilityType: textResult.utilityType,
            caseStatus: textResult.caseStatus,
            documentName: textResult.documentName,
            documentType: textResult.documentType,
            content: textResult.content,
            citation: textResult.citation,
            metadata: {
              caseDescription: caseResult.description,
              extractedAt: textResult.extractedAt,
              pageCount: textResult.pages
            }
          });
        });
        
        // Update progress after case completion
        this.progressTracker.updateProgress(
          totalExtracted,
          `Completed ${caseInfo.caseNumber}`,
          { extracted: extractedTexts.length, total: currentCaseTotal },
          0
        );
        
        if (allValidCases.indexOf(caseInfo) < allValidCases.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Stop progress tracker
      const finalProgress = this.progressTracker.stop();
      
      console.log('\n📊 Compiling final results...');
      
      result.chatReadyData.caseNumbers = [...new Set(result.allExtractedDocuments.map(doc => doc.caseNumber))];
      result.chatReadyData.companies = [...new Set(result.allExtractedDocuments.map(doc => doc.company))];
      result.chatReadyData.utilityTypes = [...new Set(result.allExtractedDocuments.map(doc => doc.utilityType))];
      result.chatReadyData.documentTypes = [...new Set(result.allExtractedDocuments.map(doc => doc.documentType))];
      result.chatReadyData.totalContent = result.allExtractedDocuments.map(doc => doc.content).join('\n\n---\n\n');
      result.chatReadyData.extractionSummary = `Complete research for query "${query}". Found ${result.casesFound.length} cases with ${result.allExtractedDocuments.length} documents across ${utilities.join(' and ')} utilities from companies: ${result.chatReadyData.companies.join(', ')}.`;
      
      result.summary.totalCases = result.casesFound.length;
      result.summary.totalDocuments = result.allExtractedDocuments.length;
      result.summary.totalTextFiles = result.allExtractedDocuments.length;
      result.summary.workersUtilized = totalWorkersUsed;
      result.summary.averageDocumentLength = result.allExtractedDocuments.length > 0 ? Math.round(
        result.allExtractedDocuments.reduce((sum, doc) => sum + doc.textLength, 0) / result.allExtractedDocuments.length
      ) : 0;
      
      result.summary.casesByUtility = result.casesFound.reduce((acc, case_) => {
        acc[case_.utilityType] = (acc[case_.utilityType] || 0) + 1;
        return acc;
      }, {});
      
      result.summary.casesByStatus = result.casesFound.reduce((acc, case_) => {
        acc[case_.caseStatus] = (acc[case_.caseStatus] || 0) + 1;
        return acc;
      }, {});
      
      result.summary.documentsByType = result.allExtractedDocuments.reduce((acc, doc) => {
        acc[doc.documentType] = (acc[doc.documentType] || 0) + 1;
        return acc;
      }, {});
      
      // Add progress data to result
      result.progressData = finalProgress;
      
    } catch (error) {
      console.log('💥 Fatal error in proven working crawler:', error.message);
      this.progressTracker.stop();
    }
    
    result.summary.processingTime = Math.round((Date.now() - startTime) / 1000);
    
    // === ADD FAILURE REPORT ===
    DEBUG_FAILURES.report();
    
    console.log('\n🎉 PROVEN WORKING extraction complete!');
    console.log(`📊 Summary: ${result.summary.totalCases} cases, ${result.summary.totalTextFiles} text files created`);
    console.log(`⚡ Total time: ${Math.floor(result.summary.processingTime / 60)}:${(result.summary.processingTime % 60).toString().padStart(2, '0')}`);
    console.log(`🏢 Companies: ${result.chatReadyData.companies.join(', ')}`);
    console.log(`💻 Utilities: ${result.chatReadyData.utilityTypes.join(', ')}`);
    console.log(`📈 Case Status: ${Object.entries(result.summary.casesByStatus).map(([status, count]) => `${count} ${status}`).join(', ')}`);
    console.log(`🔧 Maximum workers utilized: ${result.summary.workersUtilized}/${maxParallel}`);
    console.log(`⚡ Optimizations: ${result.summary.optimizations.join(', ')}`);
    
    return result;
  }
  
  async discoverCases(utilities, query, dateRange) {
    const browser = await puppeteer.launch({ 
      headless: true, // SPEED
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const allValidCases = [];
    
    try {
      for (const util of utilities) {
        const utilityLinks = caseListingUrls.filter((u) => u.type === util);
        
        for (const link of utilityLinks) {
          const page = await browser.newPage();
          
          try {
            console.log('🔍 Discovering ' + link.type + ' ' + link.status + ' cases...');
            
            await page.goto(link.url, { waitUntil: 'networkidle0' });
            
            const validCases = await searchCasesByDescription(
              page, 
              link.type, 
              link.status, 
              query, 
              dateRange
            );
            
            allValidCases.push(...validCases);
            console.log('✅ ' + link.type + ' ' + link.status + ': ' + validCases.length + ' valid cases');
            
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
    
    return allValidCases;
  }
}

const provenWorkingCrawler = new ProvenWorkingCrawler();

export async function crawlCases(query, utilities, dateRange, maxParallel = 15, onProgressUpdate = null) {
  return provenWorkingCrawler.crawlCases(query, utilities, dateRange, maxParallel, onProgressUpdate);
}

export default provenWorkingCrawler;