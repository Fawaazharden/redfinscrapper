import { Actor, log } from 'apify';
import { createPlaywrightRouter, type PlaywrightCrawlingContext } from '@crawlee/playwright';

const CARD_SELECTOR = [
  '.bp-Homecard',
  '[class*="Homecard"]',
  '[class*="HomeCardContainer"]',
].join(', ');

const CLOSE_MODAL_SELECTORS = [
  'button[aria-label="Close"]',
  'button[aria-label="close"]',
  'button:has-text("No thanks")',
  'button:has-text("Not now")',
  'button:has-text("Maybe later")',
  '[role="button"][aria-label="Close"]',
];

interface RedfinRow {
  Badge: string;
  'bp-Homecard__Price--value': string;
  'bp-Homecard__Price--label': string;
  'bp-Homecard__Stats--beds': string;
  'bp-Homecard__Stats--baths': string;
  'bp-Homecard__LockedStat--value': string;
  'bp-Homecard__Address': string;
  'bp-Homecard__Address href': string;
  'bp-Homecard__Content': string;
}

export const router = createPlaywrightRouter();

router.addDefaultHandler(async (context) => {
  await handleRedfinPage(context);
});

async function handleRedfinPage({ page, request, crawler }: PlaywrightCrawlingContext): Promise<void> {
  log.info(`Scraping ${request.url}`);

  await page.waitForLoadState('domcontentloaded');
  await dismissKnownModals(page);
  await throwIfBlocked(page, request.url, request);
  await page.waitForSelector(CARD_SELECTOR, { timeout: 45_000 });

  const rows = await page.$$eval(CARD_SELECTOR, extractRowsFromCards);
  const uniqueRows = uniqueBy(rows, (row) => row['bp-Homecard__Address href'] || row['bp-Homecard__Address']);

  if (uniqueRows.length === 0) {
    log.warning(`No Redfin cards were extracted from ${request.url}`);
  } else {
    await Actor.pushData(uniqueRows);
    log.info(`Saved ${uniqueRows.length} rows from ${request.url}`);
  }

  const resultCountText = await extractResultCountText(page);
  if (resultCountText && /\b350\s+of\b/i.test(resultCountText)) {
    log.warning(`Redfin may have capped this search: ${resultCountText}`);
  }

  const nextUrl = await findNextPageUrl(page);
  if (nextUrl) {
    await crawler.addRequests([{ url: nextUrl }]);
  }
}

async function throwIfBlocked(
  page: PlaywrightCrawlingContext['page'],
  url: string,
  request: PlaywrightCrawlingContext['request'],
): Promise<void> {
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');

  if (/human verification|security check|confirm you are human/i.test(`${title} ${bodyText}`)) {
    request.noRetry = true;
    throw new Error(
      `Redfin served a human verification page for ${url}. Use a high-quality residential proxy or provide a solved browser session.`,
    );
  }
}

async function dismissKnownModals(page: PlaywrightCrawlingContext['page']): Promise<void> {
  for (const selector of CLOSE_MODAL_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 750 }).catch(() => false)) {
      await locator.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }
}

async function extractResultCountText(page: PlaywrightCrawlingContext['page']): Promise<string> {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('div, span, h1, h2, p'))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);

    return candidates.find((text) => /\b\d[\d,]*\s+(?:of\s+\d[\d,]*\s+)?Homes?\b/i.test(text)) ?? '';
  });
}

async function findNextPageUrl(page: PlaywrightCrawlingContext['page']): Promise<string> {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const nextAnchor = anchors.find((anchor) => {
      const label = [
        anchor.getAttribute('aria-label'),
        anchor.getAttribute('title'),
        anchor.textContent,
      ].join(' ');

      return /\bnext\b/i.test(label) && !anchor.getAttribute('aria-disabled');
    });

    if (!nextAnchor) return '';
    return new URL(nextAnchor.getAttribute('href') ?? '', window.location.href).toString();
  });
}

function extractRowsFromCards(cards: Element[]): RedfinRow[] {
  return cards
    .map((card) => extractRowFromCard(card))
    .filter((row) => row['bp-Homecard__Address'] || row['bp-Homecard__Address href']);
}

function extractRowFromCard(card: Element): RedfinRow {
  const addressLink = pickAddressLink(card);

  return {
    Badge: text(card, '.Badge, [class*="Badge"], [class*="badge"]'),
    'bp-Homecard__Price--value': text(card, '.bp-Homecard__Price--value, [class*="Price--value"]'),
    'bp-Homecard__Price--label': text(card, '.bp-Homecard__Price--label, [class*="Price--label"]'),
    'bp-Homecard__Stats--beds': text(card, '.bp-Homecard__Stats--beds, [class*="Stats--beds"]'),
    'bp-Homecard__Stats--baths': text(card, '.bp-Homecard__Stats--baths, [class*="Stats--baths"]'),
    'bp-Homecard__LockedStat--value': text(card, '.bp-Homecard__LockedStat--value, [class*="LockedStat--value"]'),
    'bp-Homecard__Address': clean(addressLink?.textContent) || text(card, '.bp-Homecard__Address, [class*="Address"]'),
    'bp-Homecard__Address href': href(addressLink),
    'bp-Homecard__Content': jsonLdContent(card),
  };
}

function pickAddressLink(card: Element): HTMLAnchorElement | null {
  const address = card.querySelector('.bp-Homecard__Address, [class*="Address"]');
  const directLink = address?.closest('a[href]');
  if (directLink instanceof HTMLAnchorElement) return directLink;

  const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'));
  return links.find((link) => /\/home\/\d+/i.test(link.href)) ?? links[0] ?? null;
}

function jsonLdContent(card: Element): string {
  const scripts = Array.from(card.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))
    .map((script) => script.textContent?.trim() ?? '')
    .filter(Boolean);

  if (scripts.length === 0) return '';
  if (scripts.length === 1) return normalizeJson(scripts[0]);

  return JSON.stringify(scripts.map((content) => parseJsonOrRaw(content)));
}

function normalizeJson(content: string): string {
  return JSON.stringify(parseJsonOrRaw(content));
}

function parseJsonOrRaw(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function text(root: Element, selector: string): string {
  return clean(root.querySelector(selector)?.textContent);
}

function href(anchor: HTMLAnchorElement | null): string {
  return anchor?.href ?? '';
}

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
