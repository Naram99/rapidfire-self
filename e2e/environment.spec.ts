import { expect, test } from '@playwright/test';

test('React and the HTTP API work through the same origin', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rapidfire' })).toBeVisible();
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });
  const missing = await request.get('/api/not-implemented');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-type']).toContain('application/json');
});

test('Socket.IO polling and WebSocket handshakes share the HTTP origin', async ({
  page,
  request,
}) => {
  const polling = await request.get('/socket.io/?EIO=4&transport=polling');
  expect(polling.ok()).toBe(true);
  expect(await polling.text()).toMatch(/^0\{"sid":/);
  await page.goto('/');
  const packet = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const url = new URL(
          '/socket.io/?EIO=4&transport=websocket',
          location.href,
        );
        url.protocol = 'ws:';
        const socket = new WebSocket(url);
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('WebSocket handshake timed out'));
        }, 5000);
        socket.onmessage = (event) => {
          clearTimeout(timeout);
          socket.close();
          resolve(String(event.data));
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          socket.close();
          reject(new Error('WebSocket handshake failed'));
        };
      }),
  );
  expect(packet).toMatch(/^0\{"sid":/);
});
