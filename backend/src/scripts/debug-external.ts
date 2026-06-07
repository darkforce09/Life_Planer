import { ExternalScraper } from '../sensors/ExternalScraper.js';

async function run() {
    const scraper = new ExternalScraper();
    await scraper.run();
}

run().catch(console.error);
