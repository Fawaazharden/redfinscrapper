import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, log } from 'apify';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { firefox } from 'playwright';

import { router } from './routes.js';

const DEFAULT_START_URL =
  'https://www.redfin.com/city/1903/FL/Boca-Raton/filter/property-type=condo,min-beds=2,min-baths=2,include=sold-1yr,viewport=26.34067:26.32617:-80.13766:-80.15383,no-outline';

interface Input {
  startUrl?: string;
  maxConcurrency?: number;
  maxRequestsPerCrawl?: number;
  proxy?: Record<string, unknown>;
}

await Actor.init();

try {
  const input = (await Actor.getInput<Input>()) ?? {
    startUrl: DEFAULT_START_URL,
    maxConcurrency: 1,
  };

  if (!input.startUrl) {
    throw new Error('Input field "startUrl" is required.');
  }

  log.info('Starting Redfin scraper', {
    startUrl: input.startUrl,
    maxConcurrency: input.maxConcurrency ?? 1,
  });

  const proxyConfiguration = input.proxy
    ? await Actor.createProxyConfiguration({ ...input.proxy, checkAccess: true })
    : undefined;
  const proxyUrl = await proxyConfiguration?.newUrl();

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxConcurrency ?? 1,
    maxRequestsPerCrawl: input.maxRequestsPerCrawl,
    requestHandler: router,
    requestHandlerTimeoutSecs: 120,
    maxRequestRetries: 3,
    launchContext: {
      launcher: firefox,
      launchOptions: await camoufoxLaunchOptions({
        headless: true,
        proxy: proxyUrl,
        geoip: Boolean(proxyUrl),
        block_webrtc: true,
      }),
    },
    failedRequestHandler: ({ request }, error) => {
      log.error(`Failed to scrape ${request.url}`, { error });
      throw error;
    },
  });

  await crawler.run([{ url: input.startUrl }]);

  if (crawler.stats.state.requestsFailed > 0) {
    throw new Error(`Crawler finished with ${crawler.stats.state.requestsFailed} failed request(s).`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Actor failed', { error });
  await Actor.fail(message);
}

await Actor.exit();
