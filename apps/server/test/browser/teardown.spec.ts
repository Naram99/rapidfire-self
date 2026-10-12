import { Socket } from 'node:net';
import { test, expect } from './game-fixture.js';

test('teardown closes an unfinished HTTP connection and is safe to await twice', async ({
  game,
}) => {
  const socket = new Socket();
  const received = new Promise<void>((resolve, reject) => {
    // Once data arrived, a reset from forced teardown is an expected outcome.
    socket.on('error', reject);
    game.httpServer.once('connection', (connection) => {
      connection.once('data', () => resolve());
    });
    socket.connect(Number(new URL(game.url).port), '127.0.0.1');
    socket.write('GET /api/health HTTP/1.1\r\nHost: localhost\r\n');
  });
  let closing: Promise<void> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await received;
    closing = game.close();
    await Promise.race([
      closing,
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error(
                'Test server teardown waited for unfinished HTTP headers',
              ),
            ),
          5000,
        );
      }),
    ]);
    await expect.poll(() => socket.destroyed).toBe(true);
    await game.close();
  } finally {
    clearTimeout(deadline);
    socket.destroy();
    await closing;
  }
});
