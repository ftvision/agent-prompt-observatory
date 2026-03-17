import { chromium } from 'playwright';

const BASE = 'http://localhost:5174';

async function verify() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];

  function log(view, status, detail) {
    results.push({ view, status, detail });
    console.log(`[${status}] ${view}: ${detail}`);
  }

  // Capture console errors from the page
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [browser error] ${msg.text()}`);
  });
  page.on('pageerror', err => console.log(`  [page error] ${err.message}`));

  try {
    // Quick debug: check what fetch URL resolves to
    console.log('=== Debug: Testing data fetch ===');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    const fetchResult = await page.evaluate(async () => {
      try {
        const res = await fetch('/../data/versions_meta.json');
        return { ok: res.ok, status: res.status, url: res.url };
      } catch(e) {
        return { error: e.message };
      }
    });
    console.log('Fetch result:', JSON.stringify(fetchResult));

    // Wait for the app to potentially load
    await page.waitForTimeout(3000);

    // Check what's in the DOM
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Body text:', bodyText);

    // Check for h1
    const h1s = await page.$$eval('h1', els => els.map(e => e.textContent));
    console.log('H1 elements:', h1s);

    if (fetchResult.error || !fetchResult.ok) {
      console.log('\nData fetch failing. Trying alternative paths...');
      for (const path of ['/../data/', '/data/', '../data/']) {
        const r = await page.evaluate(async (p) => {
          try {
            const res = await fetch(p + 'versions_meta.json');
            return { path: p, ok: res.ok, status: res.status, url: res.url };
          } catch(e) {
            return { path: p, error: e.message };
          }
        }, path);
        console.log(`  ${path}: ${JSON.stringify(r)}`);
      }
    }

    // If data loaded, run all checks
    if (h1s.some(h => h.includes('Prompt Drift Observatory'))) {
      log('Overview', 'PASS', `Title found`);

      const statValues = await page.$$eval('.stat-card .value', els => els.map(e => e.textContent));
      log('Overview', statValues.length >= 4 ? 'PASS' : 'FAIL', `Stats: ${statValues.join(', ')}`);

      const viewCards = await page.$$('.view-card');
      log('Overview', viewCards.length === 5 ? 'PASS' : 'FAIL', `${viewCards.length} view cards`);

      const layerRows = await page.$$('.layer-bar-row');
      log('Overview', layerRows.length > 0 ? 'PASS' : 'FAIL', `${layerRows.length} layer bars`);

      // Prompt view
      console.log('\n=== Checking Prompt View ===');
      await page.goto(`${BASE}/#/prompt`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const promptSections = await page.$$('.prompt-section');
      log('Prompt', promptSections.length > 0 ? 'PASS' : 'FAIL', `${promptSections.length} sections`);

      const unitCards = await page.$$('.unit-card');
      log('Prompt', unitCards.length > 0 ? 'PASS' : 'FAIL', `${unitCards.length} unit cards`);

      const layerBadges = await page.$$('.layer-badge');
      log('Prompt', layerBadges.length > 0 ? 'PASS' : 'FAIL', `${layerBadges.length} layer badges`);

      const toggles = await page.$$('.toggle-switch');
      log('Prompt', toggles.length >= 5 ? 'PASS' : 'FAIL', `${toggles.length} toolbar toggles`);

      // Narrative view
      console.log('\n=== Checking Narrative View ===');
      await page.goto(`${BASE}/#/narrative`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const changeCards = await page.$$('.change-card');
      log('Narrative', changeCards.length > 0 ? 'PASS' : 'FAIL', `${changeCards.length} change cards`);

      const clsPills = await page.$$('.cls-pill');
      log('Narrative', clsPills.length > 0 ? 'PASS' : 'FAIL', `${clsPills.length} classification pills`);

      // Lineage view
      console.log('\n=== Checking Lineage View ===');
      await page.goto(`${BASE}/#/lineage`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const sidebarItems = await page.$$('.sidebar-item');
      log('Lineage', sidebarItems.length > 0 ? 'PASS' : 'FAIL', `${sidebarItems.length} sidebar lineages`);

      const timelineDots = await page.$$('.timeline-dot');
      log('Lineage', timelineDots.length > 0 ? 'PASS' : 'FAIL', `${timelineDots.length} timeline dots`);

      // Genome view
      console.log('\n=== Checking Genome View ===');
      await page.goto(`${BASE}/#/genome`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const svgCharts = await page.$$('svg');
      log('Genome', svgCharts.length >= 2 ? 'PASS' : 'FAIL', `${svgCharts.length} SVG charts`);

      const hotspotRows = await page.$$('.hotspot-table tbody tr');
      log('Genome', hotspotRows.length > 0 ? 'PASS' : 'FAIL', `${hotspotRows.length} hotspot rows`);

      // Method view
      console.log('\n=== Checking Method View ===');
      await page.goto(`${BASE}/#/method`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      const pipelineSteps = await page.$$('.pipeline-step');
      log('Method', pipelineSteps.length === 8 ? 'PASS' : 'FAIL', `${pipelineSteps.length} pipeline steps`);

      // Evidence Inspector
      console.log('\n=== Checking Evidence Inspector ===');
      await page.goto(`${BASE}/#/prompt`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const firstUnit = await page.$('.unit-card');
      if (firstUnit) {
        await firstUnit.click();
        await page.waitForTimeout(1000);
        const panel = await page.$('.inspector-panel');
        log('Inspector', panel ? 'PASS' : 'FAIL', panel ? 'Panel opened' : 'Panel did not open');
        if (panel) {
          const unitText = await page.$('.unit-full-text');
          log('Inspector', unitText ? 'PASS' : 'FAIL', 'Unit text displayed');
        }
      }
    } else if (h1s.some(h => h.includes('Error'))) {
      log('Overview', 'FAIL', 'Error state shown - data not loading');
    } else {
      log('Overview', 'FAIL', `Unexpected state. H1s: ${h1s.join(', ')}`);
    }

  } catch (err) {
    console.error('ERROR:', err.message);
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`${passed} passed, ${failed} failed out of ${results.length} checks`);
  if (failed > 0) {
    console.log('\nFailed:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  - ${r.view}: ${r.detail}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

verify();
