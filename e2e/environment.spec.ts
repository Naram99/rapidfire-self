import { expect, test } from '@playwright/test';

test('React and the HTTP API work through the same origin', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Think fast. Make it count.' }),
  ).toBeVisible();
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

test('the browser uses HttpOnly guest cookies for HTTP renewal and authenticated sockets', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const status = await page.evaluate(async () => {
    const created = await fetch('/api/guest/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'Browser guest' }),
    });
    const renewed = await fetch('/api/guest/session/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const history = await fetch('/api/games');
    return [created.status, renewed.status, history.status];
  });
  expect(status).toEqual([200, 200, 401]);
  const guestCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'rapidfire.guest',
  );
  expect(guestCookie?.httpOnly).toBe(true);
  expect(guestCookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'rapidfire.guest',
  );
  const connected = await page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const url = new URL(
          '/socket.io/?EIO=4&transport=websocket',
          location.href,
        );
        url.protocol = 'ws:';
        const socket = new WebSocket(url);
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('Authenticated socket timed out'));
        }, 5000);
        socket.onmessage = (event) => {
          const packet = String(event.data);
          if (packet.startsWith('0')) socket.send('40{"protocolVersion":1}');
          else if (packet.startsWith('40')) {
            clearTimeout(timeout);
            socket.close();
            resolve(true);
          } else if (packet.startsWith('44')) {
            clearTimeout(timeout);
            socket.close();
            reject(new Error('Guest authentication failed'));
          }
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          socket.close();
          reject(new Error('Socket failed'));
        };
      }),
  );
  expect(connected).toBe(true);
});

test('a late rejected guest renewal preserves a newer browser session', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start solo' })).toBeEnabled();

  const rejected = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/guest/session/renew', async (route) => {
    if (route.request().headers()['x-test-delayed-renewal'] !== '1') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    rejected.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  const oldRenewal = page.evaluate(async () => {
    const response = await fetch('/api/guest/session/renew', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Delayed-Renewal': '1',
      },
      body: '{}',
    });
    return response.status;
  });
  try {
    // The unauthenticated request completes on the server before creation, but
    // its response reaches the browser only after the new cookie is installed.
    await rejected.promise;
    const created = await page.evaluate(async () => {
      const response = await fetch('/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'New browser guest' }),
      });
      return response.status;
    });
    expect(created).toBe(200);
    const issued = (await context.cookies()).find(
      (cookie) => cookie.name === 'rapidfire.guest',
    );
    expect(issued?.httpOnly).toBe(true);
    release.resolve();
    expect(await oldRenewal).toBe(401);
    const retained = (await context.cookies()).find(
      (cookie) => cookie.name === 'rapidfire.guest',
    );
    expect(retained?.value === issued?.value).toBe(true);
    const renewed = await page.evaluate(async () => {
      const response = await fetch('/api/guest/session/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      return response.status;
    });
    expect(renewed).toBe(200);
  } finally {
    release.resolve();
    await oldRenewal;
  }
});
