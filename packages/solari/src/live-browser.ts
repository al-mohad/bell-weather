import { EnvironmentError } from '@bellwether/core';
import type { BrowserHandle, BrowserOptions, Frame } from './types';

/**
 * VERIFICATION STATUS: unverified against the live service. See live.ts.
 *
 * Solari hands out a CDP endpoint, so we drive it with playwright-core rather
 * than a bespoke CDP client - the agent still only ever receives pixels plus an
 * optional accessibility tree, so no task becomes easier by our using Playwright.
 */

interface PwPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  url(): string;
  viewportSize(): { width: number; height: number } | null;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  accessibility?: { snapshot(): Promise<unknown> };
  mouse: {
    click(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
    move(x: number, y: number): Promise<void>;
    wheel(dx: number, dy: number): Promise<void>;
  };
  keyboard: { type(text: string): Promise<void>; press(keys: string): Promise<void> };
}

interface PwContext {
  pages?(): PwPage[];
  newPage(): Promise<PwPage>;
}

interface PwBrowser {
  contexts(): PwContext[];
  newContext(): Promise<PwContext>;
  close(): Promise<void>;
}

interface SolariBrowserSession {
  id?: string;
  cdpUrl: string;
  recordingUrl?: () => Promise<string | undefined>;
  kill(): Promise<void>;
}

export async function createLiveBrowser(
  apiKey: string,
  options: BrowserOptions,
): Promise<BrowserHandle> {
  let sdk: { browsers: { create(o: Record<string, unknown>): Promise<SolariBrowserSession> } };
  let playwright: { chromium: { connectOverCDP(url: string): Promise<PwBrowser> } };
  try {
    sdk = (await import('@solarisdk/browser')) as never;
    playwright = (await import('playwright-core')) as never;
  } catch {
    throw new EnvironmentError(
      'the live browser surface needs @solarisdk/browser and playwright-core: pnpm add -w @solarisdk/browser playwright-core',
    );
  }

  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const session = await sdk.browsers.create({
    apiKey,
    stealth: options.stealth ?? true,
    proxy: options.proxy ?? 'none',
    profileId: options.profileId,
    recordSession: options.recordSession ?? true,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
  });

  const browser = await playwright.chromium.connectOverCDP(session.cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages?.()[0] ?? (await context.newPage());
  await page.setViewportSize(viewport);

  return {
    id: session.id ?? 'browser',
    cdpUrl: session.cdpUrl,
    async frame(): Promise<Frame> {
      const png = await page.screenshot({ type: 'png' });
      const size = page.viewportSize() ?? viewport;
      const tree = await page.accessibility?.snapshot().catch(() => undefined);
      return {
        pngB64: png.toString('base64'),
        width: size.width,
        height: size.height,
        url: page.url(),
        screenText: tree ? JSON.stringify(tree) : undefined,
      };
    },
    async navigate(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },
    async click(x, y, opts) {
      await page.mouse.click(x, y, {
        button: opts?.button ?? 'left',
        clickCount: opts?.clicks ?? 1,
      });
    },
    async move(x, y) {
      await page.mouse.move(x, y);
    },
    async type(text) {
      await page.keyboard.type(text);
    },
    async press(keys) {
      await page.keyboard.press(keys);
    },
    async scroll(x, y, direction, amount) {
      await page.mouse.move(x, y);
      const distance = amount * 100;
      const delta: Record<string, [number, number]> = {
        up: [0, -distance],
        down: [0, distance],
        left: [-distance, 0],
        right: [distance, 0],
      };
      const [dx, dy] = delta[direction] ?? [0, 0];
      await page.mouse.wheel(dx, dy);
    },
    async recordingUrl() {
      return session.recordingUrl?.();
    },
    async kill() {
      await browser.close().catch(() => undefined);
      await session.kill();
    },
  };
}
