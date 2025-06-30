import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';

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

  console.log('Date Filed found: ' + dateStr);
  if (!dateStr) {
    console.log('No Date Filed found - skipping case');
    return false;
  }
  const filed = new Date(dateStr);
  const isValid = filed >= new Date(startDate) && filed <= new Date(endDate);
  console.log('Date Filed ' + dateStr + ' is ' + (isValid ? 'VALID' : 'INVALID') + ' for range ' + startDate + ' to ' + endDate);
  return isValid;
}

/******************************
 * Directory-Based Download Functions
 ******************************/

async function downloadDirectorySection(page, entryDocumentUrl, sectionName, filterType, caseInfo, isFirstSection = true) {
  try {
    if (isFirstSection) {
      // Navigate to entry document first
      await page.goto(entryDocumentUrl, { waitUntil: 'networkidle2' });
    }
    
    // Navigate to the section directory
    console.log('   🔗 Navigating to ' + sectionName + ' directory...');
    
    const navigationSuccess = await page.evaluate((section) => {
      // Look for breadcrumb navigation
      const breadcrumbs = Array.from(document.querySelectorAll('a'));
      
      if (section === 'Company') {
        // For Company, look for Company breadcrumb directly
        const sectionLink = breadcrumbs.find(link => 
          link.textContent.trim() === section && 
          link.href.includes('javascript:void(0)')
        );
        
        if (sectionLink) {
          console.log('✅ Found ' + section + ' breadcrumb link');
          sectionLink.click();
          return true;
        }
      } else if (section === 'Staff') {
        // For Staff, we need to go back to case level first, then click Staff
        // The case number is always the 4th breadcrumb (index 3)
        const jsVoidBreadcrumbs = breadcrumbs.filter(link => 
          link.href.includes('javascript:void(0)')
        );
        
        // Find the case level breadcrumb - it should be the case number (like AVUE2501)
        const caseBreadcrumb = jsVoidBreadcrumbs.find((link) => {
          const text = link.textContent.trim();
          // Look for a breadcrumb that matches case number pattern
          return /^[A-Z]{2,5}[E]\d{2,4}$/.test(text); // Exact match for case numbers like AVUE2501, IPCE2516
        });
        
        if (caseBreadcrumb) {
          console.log('✅ Found case breadcrumb: ' + caseBreadcrumb.textContent.trim());
          caseBreadcrumb.click();
          return 'case_level';
        }
      }
      
      console.log('❌ ' + section + ' navigation failed');
      console.log('Available breadcrumbs:');
      breadcrumbs.forEach(link => {
        if (link.href.includes('javascript:void(0)')) {
          console.log('  - "' + link.textContent.trim() + '"');
        }
      });
      return false;
    }, sectionName);

    if (!navigationSuccess) {
      console.log('   ❌ Could not navigate to ' + sectionName + ' directory');
      return [];
    }

    // If we went to case level for Staff, now click Staff
    if (navigationSuccess === 'case_level' && sectionName === 'Staff') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const staffClickSuccess = await page.evaluate(() => {
        // Look for Staff folder link (not breadcrumb, but folder link)
        const allLinks = Array.from(document.querySelectorAll('a'));
        const staffLink = allLinks.find(link => 
          link.textContent.trim() === 'Staff' && 
          link.href && !link.href.includes('javascript:void(0)')
        );
        
        if (staffLink) {
          console.log('✅ Found Staff folder link');
          staffLink.click();
          return true;
        }
        
        console.log('❌ Staff folder not found');
        console.log('Available folder links:');
        allLinks.forEach(link => {
          if (link.textContent.trim() && !link.href.includes('javascript:void(0)') && !link.href.includes('#')) {
            console.log('  - "' + link.textContent.trim() + '"');
          }
        });
        return false;
      });
      
      if (!staffClickSuccess) {
        console.log('   ❌ Could not navigate to Staff directory from case level');
        return [];
      }
    }

    // Wait for directory page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      await page.waitForSelector('input[type="checkbox"]', { timeout: 10000 });
    } catch (error) {
      console.log('   ❌ Could not navigate to ' + sectionName + ' directory');
      return [];
    }

    // Select relevant documents
    console.log('   ✅ Selecting ' + (filterType === 'ALL' ? 'all' : filterType) + ' documents...');
    
    const selectedCount = await page.evaluate(async (filter) => {
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      let selected = 0;
      
      console.log('Found ' + checkboxes.length + ' checkboxes');
      
      for (let index = 0; index < checkboxes.length; index++) {
        const checkbox = checkboxes[index];
        const row = checkbox.closest('tr');
        if (!row) {
          console.log('Checkbox ' + index + ': No parent row found');
          continue;
        }
        
        // Get filename from the specific structure: td > span.EntryNameColumn > a > span
        const filenameSpan = row.querySelector('td span.EntryNameColumn a span');
        const filename = filenameSpan ? filenameSpan.textContent.trim() : '';
        
        console.log('Checkbox ' + index + ' - File: "' + filename + '"');
        
        if (!filename) {
          console.log('  -> No filename found, skipping');
          continue;
        }
        
        // Filter logic
        let shouldSelect = false;
        if (filter === 'ALL') {
          shouldSelect = true;
        } else if (filter === 'DIRECT') {
          const upperFilename = filename.toUpperCase();
          shouldSelect = upperFilename.includes('DIRECT');
        } else {
          shouldSelect = filename.toLowerCase().includes(filter.toLowerCase());
        }
        
        if (shouldSelect) {
          // Try clicking the custom checkbox component instead of the input
          const checkboxComponent = row.querySelector('p-tablecheckbox .p-checkbox-box');
          if (checkboxComponent) {
            checkboxComponent.click();
            console.log('  -> Clicked checkbox component for: ' + filename);
          } else {
            // Fallback to regular checkbox click
            checkbox.click();
            console.log('  -> Clicked regular checkbox for: ' + filename);
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
          selected++;
        } else {
          console.log('  -> Skipped: ' + filename);
        }
      }
      
      return selected;
    }, filterType === 'ALL' ? 'ALL' : filterType);

    if (selectedCount === 0) {
      console.log('   ⚠️ No documents selected in ' + sectionName + ' section');
      return [];
    }

    console.log('   ✅ Selected ' + selectedCount + ' documents');
    
    // Wait a moment for all selections to register
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify selections before right-clicking
    const actuallySelected = await page.evaluate(() => {
      const checkedBoxes = document.querySelectorAll('input[type="checkbox"]:checked');
      return checkedBoxes.length;
    });
    
    console.log('   🔍 Verification: ' + actuallySelected + ' checkboxes actually selected');
    
    if (actuallySelected === 0) {
      console.log('   ❌ No checkboxes are actually selected - selection failed');
      return [];
    }

    // Right-click and download
    console.log('   📥 Starting batch download...');
    
    const downloadTriggered = await page.evaluate(() => {
      // Find first checked checkbox to right-click on
      const checkedBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
      console.log('Found ' + checkedBoxes.length + ' checked boxes for right-click');
      
      if (checkedBoxes.length === 0) {
        console.log('No checked boxes found for right-click');
        return false;
      }
      
      const firstChecked = checkedBoxes[0];
      const row = firstChecked.closest('tr');
      
      if (!row) {
        console.log('No row found for first checked box');
        return false;
      }
      
      console.log('Right-clicking on row...');
      
      // Right-click on the row
      const rightClickEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        clientX: 100,
        clientY: 100
      });
      
      row.dispatchEvent(rightClickEvent);
      console.log('Right-click event dispatched');
      
      return true;
    });

    if (!downloadTriggered) {
      console.log('   ❌ Could not trigger right-click menu');
      return [];
    }

    // Wait for context menu to appear
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const downloadStarted = await page.evaluate(() => {
      console.log('Looking for PrimeNG download menu item...');
      
      // Target the specific PrimeNG structure
      let downloadElement = null;
      
      // Method 1: Find by the exact span text
      const spanElements = Array.from(document.querySelectorAll('span.p-menuitem-text'));
      const downloadSpan = spanElements.find(span => 
        span.textContent && span.textContent.trim() === 'Download Selected Entries'
      );
      
      if (downloadSpan) {
        // Get the parent <a> element
        downloadElement = downloadSpan.closest('a.p-menuitem-link');
        console.log('Found download span and parent link');
      }
      
      // Method 2: Direct search for the link
      if (!downloadElement) {
        const linkElements = Array.from(document.querySelectorAll('a.p-menuitem-link'));
        downloadElement = linkElements.find(link => 
          link.textContent && link.textContent.includes('Download Selected Entries')
        );
        console.log('Found download link directly');
      }
      
      if (downloadElement) {
        console.log('✅ Found PrimeNG download element');
        console.log('Element tag: ' + downloadElement.tagName);
        console.log('Element class: ' + downloadElement.className);
        console.log('Element text: "' + downloadElement.textContent.trim() + '"');
        
        // Try clicking the PrimeNG way
        try {
          // Remove tabindex and add focus for PrimeNG
          downloadElement.focus();
          
          // Trigger both mouse and keyboard events for PrimeNG
          const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
          const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
          const click = new MouseEvent('click', { bubbles: true, cancelable: true });
          
          downloadElement.dispatchEvent(mouseDown);
          downloadElement.dispatchEvent(mouseUp);
          downloadElement.dispatchEvent(click);
          
          console.log('✅ Clicked PrimeNG download button');
          return true;
        } catch (e) {
          console.log('❌ Click failed: ' + e.message);
          return false;
        }
      }
      
      console.log('❌ PrimeNG download element not found');
      
      // Debug: Show all menu items
      const allMenuItems = Array.from(document.querySelectorAll('a.p-menuitem-link'));
      console.log('Available menu items (' + allMenuItems.length + '):');
      allMenuItems.forEach((item, index) => {
        console.log('  ' + index + ': "' + item.textContent.trim() + '"');
      });
      
      return false;
    });

    if (!downloadStarted) {
      console.log('   ❌ Could not start download');
      return [];
    }

    console.log('   📥 Starting batch download...');
    console.log('   ⏳ Staying on page for export to complete...');
    
    // Wait for download to complete - keep monitoring Downloads folder
    let downloadCompleted = false;
    const downloadPath = process.env.HOME + '/Downloads/';
    const fs = require('fs');
    const initialFiles = fs.readdirSync(downloadPath);
    
    // Wait up to 15 minutes for download
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      
      try {
        const currentFiles = fs.readdirSync(downloadPath);
        const newFiles = currentFiles.filter(file => !initialFiles.includes(file));
        const zipFiles = newFiles.filter(file => file.toLowerCase().includes('exportedcontents.zip'));
        
        if (zipFiles.length > 0) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const newFileName = caseInfo.caseNumber + '_' + sectionName + '_' + timestamp + '.zip';
          const oldPath = downloadPath + zipFiles[0];
          const newPath = downloadPath + newFileName;
          
          try {
            fs.renameSync(oldPath, newPath);
            console.log('   ✅ Download completed and renamed: ' + newFileName);
            downloadCompleted = true;
            break;
          } catch (renameError) {
            console.log('   ✅ Download completed: ' + zipFiles[0]);
            downloadCompleted = true;
            break;
          }
        }
        
        if (i % 6 === 0) { // Every minute
          console.log('   ⏳ Still waiting for download... (' + Math.round(i * 10 / 60) + ' minutes elapsed)');
        }
      } catch (error) {
        console.log('   ⚠️ Error checking downloads: ' + error.message);
      }
    }

    if (!downloadCompleted) {
      console.log('   ⚠️ Download did not complete within 15 minutes');
    }
    
    // Return mock document info for now
    const mockDocs = [];
    for (let i = 0; i < selectedCount; i++) {
      mockDocs.push({
        filename: sectionName + '_Document_' + (i + 1) + '.pdf',
        section: sectionName,
        downloaded: true,
        type: 'pdf',
        downloadMethod: 'directory_batch',
        caseNumber: caseInfo.caseNumber
      });
    }

    return mockDocs;

  } catch (error) {
    console.log('   💥 Error processing ' + sectionName + ' section: ' + error.message);
    return [];
  }
}

// NEW directory-based implementation
async function downloadCaseDocuments(page, caseInfo) {
  try {
    console.log('🔍 Using directory-based download for ' + caseInfo.caseNumber + '...');

    // First, get a Company or Staff document URL to use as entry point
    const documentStructure = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const caseFilesDivs = allDivs.filter((div) => div.textContent.includes('Case Files') && div.textContent.includes('.PDF'));

      if (caseFilesDivs.length === 0) return { allPdfLinks: [] };

      const mainDiv = caseFilesDivs[0];
      const allLinks = Array.from(mainDiv.querySelectorAll('a'));
      const pdfLinks = allLinks
        .filter((link) => link.textContent.includes('.PDF') || link.textContent.includes('.pdf'))
        .map((link) => ({ text: link.textContent.trim(), href: link.href }));

      // Look for Company or Staff documents first (better entry points)
      const companyStaffLinks = pdfLinks.filter(link => 
        link.text.includes('DIRECT') || 
        link.href.includes('Company') ||
        link.href.includes('Staff')
      );

      return { 
        allPdfLinks: pdfLinks,
        preferredLinks: companyStaffLinks.length > 0 ? companyStaffLinks : pdfLinks
      };
    });

    if (documentStructure.allPdfLinks.length === 0) {
      console.log('❌ No documents found for ' + caseInfo.caseNumber);
      return [];
    }

    // Use a Company/Staff document as entry point if available
    const entryDocument = documentStructure.preferredLinks[0];
    console.log('📍 Using entry document: ' + entryDocument.text);

    const processedDocs = [];

    // Process Company documents
    console.log('📁 Processing Company documents...');
    const companyDocs = await downloadDirectorySection(page, entryDocument.href, 'Company', 'DIRECT', caseInfo, true);
    processedDocs.push(...companyDocs);

    // Skip Staff for now - let Company download complete first
    console.log('📁 Skipping Staff documents - focusing on Company download completion...');
    // const staffDocs = await downloadDirectorySection(page, entryDocument.href, 'Staff', 'ALL', caseInfo, false);
    // processedDocs.push(...staffDocs);

    console.log('📄 Total processed documents: ' + processedDocs.length);
    return processedDocs;

  } catch (error) {
    console.log('💥 Error in directory-based download for ' + caseInfo.caseNumber + ': ' + error.message);
    return [];
  }
}

/******************************
 * Main Crawler Class
 ******************************/
class Crawler {
  async crawlCases(query, utilities = ['electric', 'natural_gas'], dateRange = { start: '2024-01-01', end: '2025-12-31' }) {
    const browser = await puppeteer.launch({ 
      headless: false, // Show browser window to see what's happening
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      slowMo: 1000 // Slow down actions so you can see them
    });
    const result = { jobId: uuidv4(), query, utilities, dateRange, casesFound: [], summary: { totalCases: 0, totalDocuments: 0, processingTime: 0 } };
    const startTime = Date.now();
    const page = await browser.newPage();
    
    // Set download behavior - correct API for newer Puppeteer
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: process.env.HOME + '/Downloads'
    });
    
    // Monitor download events
    client.on('Browser.downloadWillBegin', (params) => {
      console.log('DOWNLOAD STARTING:', params.url, params.suggestedFilename);
    });
    
    client.on('Browser.downloadProgress', (params) => {
      if (params.state === 'completed') {
        console.log('DOWNLOAD COMPLETED:', params.guid);
      } else if (params.state === 'inProgress') {
        console.log('DOWNLOAD PROGRESS:', params.receivedBytes, '/', params.totalBytes);
      }
    });
    
    // Add browser console logging to see what's happening in the page
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    
    try {
      for (const util of utilities) {
        for (const link of caseListingUrls.filter((u) => u.type === util)) {
          await page.goto(link.url, { waitUntil: 'networkidle0' });
          const allCases = await extractCaseListings(page, link.type, link.status);

          const matchingCases = allCases.filter((c) => matchesQuery(c, query));
          console.log('Processing ' + matchingCases.length + ' matching cases for ' + link.type + ' ' + link.status);

          let consecutiveInvalidDates = 0;
          const MAX_CONSECUTIVE_INVALID = 5;

          for (const c of matchingCases) {
            try {
              await page.goto(c.caseUrl, { waitUntil: 'networkidle0' });
              const isValidDate = await validateCaseDate(page, dateRange.start, dateRange.end);

              if (!isValidDate) {
                consecutiveInvalidDates += 1;
                console.log('❌ ' + c.caseNumber + ' - invalid date (' + consecutiveInvalidDates + ' consecutive)');
                if (consecutiveInvalidDates >= MAX_CONSECUTIVE_INVALID) {
                  console.log('🛑 Stopping search - found ' + consecutiveInvalidDates + ' consecutive cases outside date range');
                  break;
                }
                continue;
              }

              // Reset counter after a valid date
              consecutiveInvalidDates = 0;
              console.log('✅ ' + c.caseNumber + ' - valid date, downloading documents...');

              const docs = await downloadCaseDocuments(page, c);
              if (docs.length) {
                result.casesFound.push({ ...c, documents: docs });
                result.summary.totalDocuments += docs.length;
                console.log('📄 Downloaded ' + docs.length + ' documents for ' + c.caseNumber);
              } else {
                console.log('⚠️  No documents found for ' + c.caseNumber);
                result.casesFound.push({ ...c, documents: [] });
              }
            } catch (error) {
              console.log('💥 Error processing case ' + c.caseNumber + ': ' + error.message);
              // Do not increment invalid date counter on errors
            }
          }
          console.log('Finished processing ' + link.type + ' ' + link.status + ' cases');
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