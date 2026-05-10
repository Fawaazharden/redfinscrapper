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

function normalizeInput(raw: Input | null | undefined): Input {
  const merged: Input = {
    startUrl: DEFAULT_START_URL,
    maxConcurrency: 1,
    ...raw,
  };

  const url = merged.startUrl?.trim();
  if (!url) {
    throw new Error(
      'Input "startUrl" is missing or empty. In the Apify console, open Input → Restore example input, or set startUrl to your Redfin search URL.',
    );
  }
  merged.startUrl = url;

  return merged;
}

await Actor.init();

try {
  const rawInput = await Actor.getInput<Input>();
  const input = normalizeInput(rawInput);

  log.info('Redfin actor started', {
    hasRawInput: rawInput != null,
    rawKeys: rawInput && typeof rawInput === 'object' ? Object.keys(rawInput) : [],
    startUrl: input.startUrl,
    maxConcurrency: input.maxConcurrency ?? 1,
  });

  // Match Apify template: always attach proxy config on the platform (credentials come from env).
  // checkAccess: false avoids failing the run when validation is flaky; proxy URL still resolves on use.
  const proxyConfiguration = await Actor.createProxyConfiguration({
    useApifyProxy: true,
    ...(input.proxy ?? {}),
    checkAccess: false,
  } as Parameters<typeof Actor.createProxyConfiguration>[0]);

  const proxyUrl = await proxyConfiguration?.newUrl().catch((err: unknown) => {
    log.warning('Could not get proxy URL; continuing without proxy for Camoufox launch.', { err });
    return undefined;
  });

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

  await Actor.exit();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Actor failed', { error });
  await Actor.fail(message);
}
