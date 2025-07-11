import puppeteer from 'puppeteer';

async function extractWebLinkCurrentPage() {
  const browser = await puppeteer.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 500
  });
  
  const page = await browser.newPage();
  
  try {
    const testUrl = 'https://lf-puc.idaho.gov/WebLink/DocView.aspx?id=144430&dbid=0&repo=PUC-PROD';
    console.log('🧪 Testing WebLink current page extraction: ' + testUrl);
    
    await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const needsTextMode = await page.evaluate(() => {
      const textModeButton = document.querySelector('#TEXTMODE');
      return !!textModeButton;
    });

    if (needsTextMode) {
      console.log('🔄 Clicking "View plain text" button...');
      await page.click('#TEXTMODE');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Access iframe
    await page.waitForSelector('#pdfViewerIFrame', { timeout: 30000 });
    const iframe = await page.$('#pdfViewerIFrame');
    const frame = await iframe.contentFrame();
    
    await frame.waitForFunction(
      () => {
        const viewer = document.querySelector('#viewer.pdfViewer');
        const pages = document.querySelectorAll('.page[data-page-number]');
        const markedContent = document.querySelectorAll('.markedContent');
        return viewer && pages.length > 0 && markedContent.length > 10;
      },
      { timeout: 30000, polling: 2000 }
    );

    let allText = '';
    let processedPages = 0;
    const maxPages = 10; // Test first 10 pages

    // Navigate through pages and extract from currently loaded content
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        console.log(`🔄 Processing page ${pageNum}/${maxPages}...`);

        // Wait for page content to load after navigation
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract from ALL currently loaded/visible content (not specific page number)
        const currentPageContent = await frame.evaluate(() => {
          // Find all pages that have loaded content
          const allPages = document.querySelectorAll('.page[data-page-number]');
          let visibleText = '';
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
                  text: pageText.trim(),
                  length: pageText.trim().length
                });
              }
            }
          });
          
          return {
            loadedPages: loadedPages,
            totalMarkedContent: document.querySelectorAll('.markedContent').length
          };
        });

        console.log(`📄 Found ${currentPageContent.loadedPages.length} loaded pages with ${currentPageContent.totalMarkedContent} total marked content`);

        // Add any new pages we haven't seen before
        let newContent = '';
        currentPageContent.loadedPages.forEach(loadedPage => {
          // Simple check to avoid duplicates - look for page marker in existing text
          const pageMarker = `--- PAGE ${loadedPage.pageNumber} ---`;
          if (!allText.includes(pageMarker)) {
            newContent += `\n${pageMarker}\n${loadedPage.text}\n`;
            processedPages++;
            console.log(`✅ New page ${loadedPage.pageNumber}: ${loadedPage.length} chars`);
          } else {
            console.log(`⏭️  Page ${loadedPage.pageNumber}: Already extracted`);
          }
        });

        allText += newContent;

        // Navigate to next page
        if (pageNum < maxPages) {
          const nextClicked = await frame.evaluate(() => {
            const nextButton = document.querySelector('#next');
            if (nextButton && !nextButton.disabled) {
              nextButton.click();
              return true;
            }
            return false;
          });

          if (nextClicked) {
            console.log(`➡️  Navigated to next page`);
          } else {
            console.log(`⚠️ Could not navigate to next page`);
            break;
          }
        }

      } catch (pageError) {
        console.log(`❌ Page ${pageNum} error:`, pageError.message);
      }
    }

    console.log('\n📊 Final Results:');
    console.log(`  Pages processed: ${processedPages}`);
    console.log(`  Total text length: ${allText.length}`);
    console.log(`  Average per page: ${processedPages > 0 ? Math.round(allText.length / processedPages) : 0} chars`);

    if (allText.length > 0) {
      console.log('\n📝 Sample text:');
      console.log(allText.substring(0, 600) + '...');
      console.log('\n🎉 SUCCESS: WebLink current page extraction working!');
      
      return {
        text: allText,
        pages: processedPages
      };
    } else {
      console.log('\n❌ No text extracted');
    }
    
  } catch (error) {
    console.log('💥 Error:', error.message);
  } finally {
    console.log('\n⏸️ Browser kept open for inspection');
  }
}

// Run test
extractWebLinkCurrentPage();

export { extractWebLinkCurrentPage };