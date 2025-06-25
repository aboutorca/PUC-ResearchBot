import puppeteer from 'puppeteer'

async function debugPageStructure(url) {
  const browser = await puppeteer.launch({ headless: false })
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle0' })

  const pageInfo = await page.evaluate(() => ({
    title: document.title,
    tableCount: document.querySelectorAll('table').length,
    rowCount: document.querySelectorAll('table tr').length,
    hasAvista: document.body.textContent.includes('AVISTA'),
    firstTableHTML: document.querySelector('table')?.outerHTML.substring(0, 500) || null,
  }))

  console.log('Page analysis:', pageInfo)
  await browser.close()
}

// Allow running via CLI: node scripts/debugPage.js <url>
const urlArg = process.argv[2] || 'https://puc.idaho.gov/case?util=1&closed=0'

// Wrap in top-level await (Node 20+ supports) or IIFE
;(async () => {
  try {
    await debugPageStructure(urlArg)
  } catch (err) {
    console.error('Debug failed:', err)
    process.exit(1)
  }
})()
