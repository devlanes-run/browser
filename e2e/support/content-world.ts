import { type BrowserContext, expect, type Page } from '@playwright/test';

/**
 * Runs code in the login fill's content script world on `page`, the isolated
 * world the extension's content script lives in. It stands in for a lane page
 * whose renderer an attacker controls, which reaches the same `chrome` APIs.
 * Returns a function that evaluates an expression there and gives its JSON value.
 */
export async function contentWorld(
  context: BrowserContext,
  page: Page
): Promise<(expression: string) => Promise<unknown>> {
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; name: string; type: string | undefined }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: created }) => {
    worlds.push({ id: created.id, name: created.name, type: created.auxData?.type });
  });
  // Enabling the domain reports every context that already exists.
  await cdp.send('Runtime.enable');
  let world: number | undefined;
  await expect
    .poll(
      () => {
        world = worlds.find((each) => each.type === 'isolated' && each.name === 'devlanes')?.id;
        return world;
      },
      { message: "the content script's isolated world" }
    )
    .toBeDefined();
  return async (expression) =>
    (
      await cdp.send('Runtime.evaluate', {
        contextId: world as number,
        expression,
        awaitPromise: true,
        returnByValue: true
      })
    ).result.value as unknown;
}
