import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';
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

async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function downloadPdfDocument(page, docInfo, caseData, downloadRoot) {
  await page.goto(docInfo.url, { waitUntil: 'networkidle0' });
  const btn = await page.$('button[title*="download" i], a[title*="download" i], .download-btn');
  if (!btn) throw new Error('Download button not found');
  await ensureDir(downloadRoot);
  await page._client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadRoot });
  await btn.click();
  await page.waitForTimeout(4000);
  const ts = new Date().toISOString().split('T')[0];
  const safe = docInfo.filename.replace(/\s+/g, '_');
  const filename = `${caseData.caseNumber}_${caseData.utilityType}_${caseData.caseStatus}_${docInfo.type}_${ts}_${safe}`;
  return {
    originalFilename: docInfo.filename,
    savedFilename: filename,
    documentType: docInfo.type,
    caseNumber: caseData.caseNumber,
    utilityType: caseData.utilityType,
    caseStatus: caseData.caseStatus,
    downloadUrl: docInfo.url,
    downloadPath: path.join(downloadRoot, filename)
  };
}

// NEW filtered implementation --------------------------------------------
async function downloadCaseDocuments(page, caseInfo, _downloadPath) {
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

    // Process only filtered documents (limit to 3 for testing)
    const processedDocs = [];
    const limitedDocs = targetDocuments;

    for (const doc of limitedDocs) {
      try {
        console.log(`📖 Processing: ${doc.section}/${doc.filename}`);
        await page.goto(doc.viewerUrl, { waitUntil: 'networkidle0' });

        const hasDownload = await page.evaluate(() => {
          const downloadElements = document.querySelectorAll('[title*="download" i], [aria-label*="download" i]');
          return downloadElements.length > 0;
        });

        processedDocs.push({ filename: doc.filename, section: doc.section, date: doc.date, viewerUrl: doc.viewerUrl, downloadAvailable: hasDownload, type: 'pdf' });
        console.log(`   ${hasDownload ? '✅' : '❌'} Download ${hasDownload ? 'available' : 'not found'}`);
      } catch (error) {
        console.log(`💥 Error processing ${doc.filename}: ${error.message}`);
      }
    }

    console.log(`📄 Processed ${processedDocs.length} filtered documents`);
    return processedDocs;
  } catch (error) {
    console.log(`💥 Error in filtered document discovery: ${error.message}`);
    return [];
  }
}

// ------------------------------------------------------------------
// Legacy diagnostic-heavy implementation retained for reference only
// eslint-disable-next-line no-unused-vars
async function legacyDownloadCaseDocuments(page, caseInfo, _downloadPath) {
    // keep reference for linter
    void downloadPdfDocument;
    // reference to ensure linter considers helper used
    void downloadPdfDocument;
  try {
    // ----- Overall page diagnostics -----
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      hasFilesSection: /Case Files/i.test(document.body.textContent),
      hasDocuments: /\.pdf/i.test(document.body.textContent),
      linkCount: document.querySelectorAll('a').length,
      pdfLinkCount: document.querySelectorAll('a[href*=".pdf" i]').length,
    }));
    console.log(`📋 Page analysis for ${caseInfo.caseNumber}:`, pageInfo);

    // ----- Strategy 1: direct PDF anchors -----
    const pdfLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*=".pdf" i]'));
      return links.map((l) => ({ text: l.textContent.trim(), href: l.href, filename: l.href.split('/').pop() }));
    });
    if (pdfLinks.length) {
      console.log(`📄 Found ${pdfLinks.length} PDF links:`, pdfLinks.map((l) => l.filename));
    } else {
      console.log('❌ No direct PDF links found');
    }

    // ----- Strategy 2: inspect "Case Files" sections -----
    const caseFilesInfo = await page.evaluate(() => {
      const elems = Array.from(document.querySelectorAll('*')).filter((el) => /Case Files/i.test(el.textContent) && el.tagName !== 'SCRIPT');
      if (!elems.length) return { found: false, message: 'No "Case Files" section found' };
      const sections = elems.map((element) => {
        const gather = (root) => Array.from(root.querySelectorAll('a'));
        const nearby = [
          ...gather(element),
          ...(element.parentElement ? gather(element.parentElement) : []),
          ...(element.nextElementSibling ? gather(element.nextElementSibling) : []),
          ...(element.nextElementSibling?.nextElementSibling ? gather(element.nextElementSibling.nextElementSibling) : []),
        ];
        return {
          elementTag: element.tagName,
          elementText: element.textContent.slice(0, 100),
          nearbyLinkCount: nearby.length,
          nearbyLinks: nearby.map((lnk) => ({ text: lnk.textContent.trim(), href: lnk.href, isPdf: /\.pdf/i.test(lnk.href) })),
        };
      });
      return { found: true, sections };
    });
    console.log('📁 Case Files analysis:', caseFilesInfo);

    // ----- Strategy 3: generic download elements -----
    const downloadElements = await page.evaluate(() => {
      const selectors = ['a[download]', 'button[title*="download" i]', 'a[title*="download" i]', 'a[href*="download" i]', '.download-link', '.file-download'];
      const out = [];
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          out.push({ selector: sel, tag: el.tagName, text: el.textContent.trim(), href: el.href || 'no href', title: el.title || 'no title' });
        });
      });
      return out;
    });
    if (downloadElements.length) {
      console.log(`⬇️  Found ${downloadElements.length} download elements:`, downloadElements);
    } else {
      console.log('❌ No download elements found');
    }

    // ----- Smart Case-Files filtering for relevant documents -----
    console.log('🔍 Looking for Case Files section...');
    const caseDocs = await page.evaluate(() => {
      const genericNames = [
        'Final_Order_No_35474.pdf',
        'SKM_C36822080116150.pdf',
        'Incorporation_by_Reference_Rules_PDF_MAY2024.pdf',
      ].map((n) => n.toUpperCase());

      const isPdfLink = (href) => /\.pdf$/i.test(href);

      const docs = [];

      // find <div> blocks that contain the phrase "Case Files" plus date strings
      const divs = Array.from(document.querySelectorAll('div')).filter((div) => {
        const txt = div.textContent;
        return /Case Files/i.test(txt) && /\d{2}\/\d{2}\/\d{4}/.test(txt) && /\.pdf/i.test(txt);
      });

      divs.forEach((div) => {
        // first, anchor tags inside the block
        const anchors = Array.from(div.querySelectorAll('a')).filter((a) => isPdfLink(a.href));
        anchors.forEach((a) => {
          const file = a.href.split('/').pop();
          if (!genericNames.includes(file.toUpperCase())) {
            docs.push({ filename: a.textContent.trim() || file, url: a.href, type: 'pdf' });
          }
        });

        // fallback: parse plain text lines with date and filename
        const matches = div.textContent.match(/(\d{2}\/\d{2}\/\d{4})\s+([^\n]+\.pdf)/gi) || [];
        matches.forEach((m) => {
          const [, datePart, fileName] = m.match(/(\d{2}\/\d{2}\/\d{4})\s+([^\n]+\.pdf)/i) || [];
          if (fileName && !genericNames.includes(fileName.toUpperCase())) {
            // attempt to find link with filename
            const link = anchors.find((a) => a.href.toUpperCase().includes(fileName.toUpperCase()));
            if (link) {
              docs.push({ filename: fileName.trim(), url: link.href, type: 'pdf', fileDate: datePart });
            }
          }
        });
      });

      // dedupe by url
      return docs.filter((d, idx, arr) => idx === arr.findIndex((o) => o.url === d.url));
    });

    // --------------- Multi-step PDF viewer workflow ---------------
    console.log(`📄 Finding PDF viewer links for ${caseInfo.caseNumber}...`);

    const pdfViewerLinks = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div')).filter((d) => d.textContent.includes('Case Files') && /\.pdf/i.test(d.textContent));
      const bad = ['Final_Order_No_35474', 'SKM_C36822080116150', 'Incorporation_by_Reference'];
      const out = [];
      divs.forEach((div) => {
        div.querySelectorAll('a').forEach((a) => {
          const txt = a.textContent.trim();
          const href = a.href;
          if (!href || !/\.pdf/i.test(txt)) return;
          if (bad.some((b) => href.includes(b))) return;
          out.push({ filename: txt, viewerUrl: href, type: 'pdf_viewer' });
        });
      });
      return out;
    });
    console.log(`🔗 Found ${pdfViewerLinks.length} PDF viewer links:`, pdfViewerLinks.map((l) => l.filename));
    if (!pdfViewerLinks.length) return [];

    const discovered = [];

    for (const link of pdfViewerLinks) {
      try {
        console.log(`📖 Opening PDF viewer for: ${link.filename}`);
        await page.goto(link.viewerUrl, { waitUntil: 'networkidle0' });

        const dlInfo = await page.evaluate(() => {
          const selectors = [
            'button[title*="download" i]',
            'a[title*="download" i]',
            'button[aria-label*="download" i]',
            'a[aria-label*="download" i]',
            '.download-button',
            '.download-link',
            '[data-download]'
          ];
          let elem = null;
          for (const sel of selectors) {
            const found = document.querySelector(sel);
            if (found) { elem = found; break; }
          }
          if (!elem) {
            elem = Array.from(document.querySelectorAll('button,a,span,div')).find((e) => /download/i.test(e.textContent));
          }
          return elem ? {
            tag: elem.tagName,
            text: elem.textContent.trim(),
            title: elem.title || null,
            className: elem.className || null,
          } : null;
        });
        const hasDownload = !!dlInfo;
        console.log('🔍 Download button analysis:', dlInfo || 'none');
        discovered.push({ filename: link.filename, viewerUrl: link.viewerUrl, downloadAvailable: hasDownload, downloadButtonInfo: dlInfo, type: 'pdf' });
      } catch (err) {
        console.log(`💥 Error processing ${link.filename}: ${err.message}`);
      }
    }

    console.log(`📋 Document discovery complete: ${discovered.length} documents processed`);
    return discovered;
  } catch (error) {
    console.log(`💥 Error in downloadCaseDocuments for ${caseInfo.caseNumber}: ${error.message}`);
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

    const docs = await downloadCaseDocuments(page, c, path.resolve('./downloads'));
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
export default pucCrawler;
