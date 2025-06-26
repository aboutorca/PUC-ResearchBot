import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/******************************
 * LaserFiche Export Helper
 ******************************/
// Robustly download a PDF via LaserFiche's async export flow.
// Returns { success: boolean, filepath?, size?, error? }
// Fixed LaserFiche export implementation based on observed network traffic
async function downloadLaserFicheDocument(page, doc) {
  const downloadDir = path.resolve('./downloads');
  await fs.mkdir(downloadDir, { recursive: true });

  let downloadUrl = null;
  let exportStarted = false;

  const onResponse = async (res) => {
    const url = res.url();
    
    // Look for the specific StartExport endpoint
    if (url.includes('ZipEntriesHandler.aspx/StartExport')) {
      console.log(`   🚀 StartExport detected for ${doc.filename}`);
      console.log(`   📡 StartExport URL: ${url}`);
      exportStarted = true;
    }
    
    // The GetExportJob request IS the download URL  
    if (url.includes('GetExportJob') && url.includes('Token=')) {
      console.log(`   📥 GetExportJob detected for ${doc.filename}`);
      console.log(`   🔗 Download URL: ${url}`);
      downloadUrl = url;
    }
  };

  page.on('response', onResponse);

  try {
    await page.goto(doc.viewerUrl, { waitUntil: 'networkidle0' });

    console.log(`   🔍 Looking for download button on ${doc.filename}...`);

    // Only look for the STR_DOWNLOAD button - no fallbacks
    const downloadTriggered = await page.evaluate(async () => {
      // Wait for the page to be fully loaded
      await new Promise(r => setTimeout(r, 2000));
      
      const strDownload = document.querySelector('#STR_DOWNLOAD');
      if (strDownload) {
        console.log('✅ Found STR_DOWNLOAD button');
        
        // Hover then click
        strDownload.dispatchEvent(new MouseEvent('mouseover', { 
          bubbles: true, cancelable: true, view: window 
        }));
        await new Promise(r => setTimeout(r, 500));
        strDownload.click();
        return true;
      }
      
      console.log('❌ STR_DOWNLOAD button not found');
      return false;
    });

    if (!downloadTriggered) {
      console.log(`   ❌ No download button found for ${doc.filename}`);
      return { success: false, error: 'no-download-button' };
    }

    console.log(`   ⏳ Waiting for export to start for ${doc.filename}...`);
    
    // Wait for StartExport to be detected
    const startTimeout = Date.now() + 15000; // 15 seconds
    while (!exportStarted && Date.now() < startTimeout) {
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (!exportStarted) {
      console.log(`   ❌ Export never started for ${doc.filename}`);
      return { success: false, error: 'export-not-started' };
    }

    // Wait for GetExportJob URL (the actual download)
    console.log(`   ⏳ Waiting for download URL for ${doc.filename}...`);
    const downloadTimeout = Date.now() + 90000; // Increased to 90 seconds
    while (!downloadUrl && Date.now() < downloadTimeout) {
      await new Promise(r => setTimeout(r, 2000)); // Check every 2 seconds instead of 1
    }
    
    if (!downloadUrl) {
      console.log(`   ❌ Download URL timeout for ${doc.filename}`);
      return { success: false, error: 'download-url-timeout' };
    }

    console.log(`   📥 Downloading ${doc.filename}...`);

    // Download the PDF using the captured URL
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await fetch(downloadUrl, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Referer': doc.viewerUrl,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin'
      },
    });
    
    if (!response.ok) {
      console.log(`   ❌ Download failed: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Clean filename and save
    const safeName = doc.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(downloadDir, `${doc.caseNumber}_${safeName}`);
    await fs.writeFile(filePath, buffer);

    console.log(`   ✅ Downloaded ${doc.filename} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return { success: true, filepath: filePath, size: buffer.length };
    
  } catch (err) {
    console.log(`   💥 Error downloading ${doc.filename}: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    page.off('response', onResponse);
  }
}

// Listing pages for Idaho PUC cases
const caseListingUrls = [
  { url: 'https://puc.idaho.gov/case?util=1&closed=0', type: 'electric', status: 'open' },
  { url: 'https://puc.idaho.gov/case?util=1&closed=1', type: 'electric', status: 'closed' },
  { url: 'https://puc.idaho.gov/case?util=4&closed=0', type: 'natural_gas', status: 'open' },
  { url: 'https://puc.idaho.gov/case?util=4&closed=1', type: 'natural_gas', status: 'closed' }
];

/******************************
 * Helper Functions
 ******************************/

// Extract rows from the correct case table
async function extractCaseListings(page, utilityType, caseStatus) {
  return page.evaluate(({ utilType, status }) => {
    const cases = [];

    // Identify the table that actually holds case data by header text
    const tables = Array.from(document.querySelectorAll('table'));
    let caseTable = tables.find((tbl) => {
      const txt = tbl.textContent.toLowerCase();
      return txt.includes('caseno') && txt.includes('company') && txt.includes('description');
    });

    // Fallback: look for a table that contains case-number looking links
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

// Check if user query matches company or description fields
function matchesQuery(caseData, userQuery) {
  const query = userQuery.toLowerCase();
  const company = caseData.company.toLowerCase();
  const description = caseData.description.toLowerCase();

  const terms = query.split(' ').filter((term) => term.length > 2);

  const matchesCompany = terms.every((t) => company.includes(t)) || company.includes(query);
  const matchesDescription =
    terms.every((t) => description.includes(t)) || description.includes(query);

  return matchesCompany || matchesDescription;
}

// Validate filed date lies within range
async function validateCaseDate(page, startDate, endDate) {
  const dateStr = await page.evaluate(() => {
    // Strategy 1: traverse tables to find "Date Filed" label
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        for (let i = 0; i < cells.length - 1; i++) {
          const current = cells[i];
          const next = cells[i + 1];
          if (current && current.textContent.trim() === 'Date Filed') {
            const match = next.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
            if (match) return match[0];
          }
        }
      }
    }

    // Strategy 2: header-based column lookup
    for (const table of tables) {
      const headerRow = table.querySelector('tr');
      if (!headerRow) continue;
      const headers = Array.from(headerRow.querySelectorAll('th, td'));
      const idx = headers.findIndex((h) => h.textContent.trim() === 'Date Filed');
      if (idx !== -1) {
        const dataRow = table.querySelectorAll('tr')[1];
        if (dataRow) {
          const dataCells = dataRow.querySelectorAll('td');
          const match = dataCells[idx]?.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
          if (match) return match[0];
        }
      }
    }

    // Strategy 3: fallback search for text containing "Date Filed"
    const elements = Array.from(document.querySelectorAll('*'));
    for (const el of elements) {
      if (el.textContent.includes('Date Filed')) {
        const m1 = el.textContent.match(/Date Filed[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (m1) return m1[1];
        const sibMatch = el.nextElementSibling?.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
        if (sibMatch) return sibMatch[0];
      }
    }
    return null;
  });

  console.log(`Date Filed found: ${dateStr}`);
  if (!dateStr) {
    console.log('No Date Filed found - skipping case');
    return false;
  }
  const filed = new Date(dateStr);
  const isValid = filed >= new Date(startDate) && filed <= new Date(endDate);
  console.log(`Date Filed ${dateStr} is ${isValid ? 'VALID' : 'INVALID'} for range ${startDate} to ${endDate}`);
  return isValid;
}

// Legacy functions removed - no longer used

// Legacy text extraction function - removed as unused

// NEW filtered implementation --------------------------------------------
async function downloadCaseDocuments(page, caseInfo) {
  try {
    console.log(`🔍 Analyzing Case Files structure for ${caseInfo.caseNumber}...`);

    // Parse the Case Files section to understand document organization
    const documentStructure = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const caseFilesDivs = allDivs.filter((div) => div.textContent.includes('Case Files') && div.textContent.includes('.PDF'));

      if (caseFilesDivs.length === 0) return { sections: [], allPdfLinks: [] };

      const mainDiv = caseFilesDivs[0];
      const fullText = mainDiv.textContent;

      // Parse text to identify document sections
      const lines = fullText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      const documentSections = [];
      let currentSection = null;

      lines.forEach((line) => {
        // Look for section headers
        if (/^(Company|Staff|Commission|Public|Intervenor|Application|Notice|Direct|Testimony)/i.test(line) && !line.includes('.PDF')) {
          currentSection = { sectionName: line, documents: [] };
          documentSections.push(currentSection);
        } else if (/\d{2}\/\d{2}\/\d{4}.*\.PDF/i.test(line)) {
          const docMatch = line.match(/(\d{2}\/\d{2}\/\d{4})\s+(.+\.PDF)/i);
          if (docMatch && currentSection) {
            currentSection.documents.push({ date: docMatch[1], filename: docMatch[2], section: currentSection.sectionName });
          }
        }
      });

      // Get all PDF links for matching
      const allLinks = Array.from(mainDiv.querySelectorAll('a'));
      const pdfLinks = allLinks
        .filter((link) => link.textContent.includes('.PDF') || link.textContent.includes('.pdf'))
        .map((link) => ({ text: link.textContent.trim(), href: link.href }));

      return { sections: documentSections, allPdfLinks: pdfLinks };
    });

    console.log('📋 Document structure:');
    console.log(`   Sections found: ${documentStructure.sections.length}`);
    documentStructure.sections.forEach((section) => {
      console.log(`   • ${section.sectionName}: ${section.documents.length} documents`);
    });

    // Filter for only target document types
    const targetSections = ['Company', 'Staff', 'Direct Testimony', 'Testimony'];
    const targetDocuments = [];

    documentStructure.sections.forEach((section) => {
      const isTargetSection = targetSections.some((target) => section.sectionName.toLowerCase().includes(target.toLowerCase()));

      if (isTargetSection) {
        console.log(`✅ Including section: ${section.sectionName}`);
        section.documents.forEach((doc) => {
          const matchingLink = documentStructure.allPdfLinks.find(
            (link) => link.text.includes(doc.filename) || doc.filename.includes(link.text),
          );

          if (matchingLink) {
            targetDocuments.push({ filename: doc.filename, date: doc.date, section: section.sectionName, viewerUrl: matchingLink.href, type: 'pdf_viewer' });
          }
        });
      } else {
        console.log(`⏭️  Skipping section: ${section.sectionName}`);
      }
    });

    console.log(`🎯 Filtered to ${targetDocuments.length} target documents`);

    if (targetDocuments.length === 0) {
      console.log(`❌ No target documents found for ${caseInfo.caseNumber}`);
      return [];
    }

    // Download each target document via LaserFiche helper
    const processedDocs = [];
    for (const doc of targetDocuments) {
      try {
        const res = await downloadLaserFicheDocument(page, { ...doc, caseNumber: caseInfo.caseNumber });
        if (res.success) {
          processedDocs.push({
            ...doc,
            filePath: res.filepath,
            fileSize: res.size,
            downloaded: true,
            type: 'pdf'
          });
        } else {
          console.log(`   ❌ Failed to download ${doc.filename}: ${res.error}`);
        }
      } catch (err) {
        console.log(`💥 Error processing ${doc.filename}: ${err.message}`);
      }
    }

    console.log(`📄 Processed ${processedDocs.length} filtered documents`);
    return processedDocs;
  } catch (error) {
    console.log(`💥 Error in filtered document discovery: ${error.message}`);
    return [];
  }
}

/******************************
 * Main Crawler Class
 ******************************/
class Crawler {
  async crawlCases(query, utilities = ['electric', 'natural_gas'], dateRange = { start: '2024-01-01', end: '2025-12-31' }) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const result = { jobId: uuidv4(), query, utilities, dateRange, casesFound: [], summary: { totalCases: 0, totalDocuments: 0, processingTime: 0 } };
    const startTime = Date.now();
    const page = await browser.newPage();
    
    // Add browser console logging to see what's happening in the page
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    
    try {
      for (const util of utilities) {
        for (const link of caseListingUrls.filter((u) => u.type === util)) {
          await page.goto(link.url, { waitUntil: 'networkidle0' });
          const allCases = await extractCaseListings(page, link.type, link.status);

          const matchingCases = allCases.filter((c) => matchesQuery(c, query));
          console.log(`Processing ${matchingCases.length} matching cases for ${link.type} ${link.status}`);

          let consecutiveInvalidDates = 0;
          const MAX_CONSECUTIVE_INVALID = 5;

          for (const c of matchingCases) {
            try {
              await page.goto(c.caseUrl, { waitUntil: 'networkidle0' });
              const isValidDate = await validateCaseDate(page, dateRange.start, dateRange.end);

              if (!isValidDate) {
                consecutiveInvalidDates += 1;
                console.log(`❌ ${c.caseNumber} - invalid date (${consecutiveInvalidDates} consecutive)`);
                if (consecutiveInvalidDates >= MAX_CONSECUTIVE_INVALID) {
                  console.log(`🛑 Stopping search - found ${consecutiveInvalidDates} consecutive cases outside date range`);
                  break;
                }
                continue;
              }

              // Reset counter after a valid date
              consecutiveInvalidDates = 0;
              console.log(`✅ ${c.caseNumber} - valid date, downloading documents...`);

              const docs = await downloadCaseDocuments(page, c);
              if (docs.length) {
                result.casesFound.push({ ...c, documents: docs });
                result.summary.totalDocuments += docs.length;
                console.log(`📄 Downloaded ${docs.length} documents for ${c.caseNumber}`);
              } else {
                console.log(`⚠️  No documents found for ${c.caseNumber}`);
                result.casesFound.push({ ...c, documents: [] });
              }
            } catch (error) {
              console.log(`💥 Error processing case ${c.caseNumber}: ${error.message}`);
              // Do not increment invalid date counter on errors
            }
          }
          console.log(`Finished processing ${link.type} ${link.status} cases`);
        }
      }
    } finally {
      await browser.close();
    }
    result.summary.totalCases = result.casesFound.length;
    result.summary.processingTime = Math.round((Date.now() - startTime) / 1000);
    return result;
  }
}

const pucCrawler = new Crawler();

// Convenience named wrapper
export async function crawlCases(query, utilities, dateRange) {
  return pucCrawler.crawlCases(query, utilities, dateRange);
}
export default pucCrawler;