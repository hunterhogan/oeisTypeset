const { chromium } = require('playwright');
(async () => {
	const [file, out, selector, height] = process.argv.slice(2);
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1100, height: Number(height || 1800) } });
	const messages = [];
	page.on('console', (m) => messages.push(m.text()));
	page.on('pageerror', (e) => messages.push('PAGEERROR ' + e.message));
	await page.goto('file://' + require('path').resolve(file));
	await page.waitForTimeout(500);
	const stats = await page.evaluate(() => ({ formulas: document.querySelectorAll('.oeisTypeset-formula').length, prose: document.querySelectorAll('.oeisTypeset-prose').length, verbatim: document.querySelectorAll('.oeisTypeset-verbatim').length }));
	if (selector) {
		await page.evaluate((s) => { const el = [...document.querySelectorAll('div.sectname')].find((e) => e.textContent.trim() === s); if (el) el.scrollIntoView(); window.scrollBy(0, -60); }, selector);
	}
	await page.screenshot({ path: out });
	console.log(stats, messages.slice(0, 5));
	await browser.close();
})();
