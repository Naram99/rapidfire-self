export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}
export type Parser<T> = Readonly<{ parse: (value: unknown) => T }>;
export async function request(
  path: string,
  options: Readonly<{
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  }> = {},
): Promise<unknown> {
  try {
    const timeout = AbortSignal.timeout(10000);
    const response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers:
        options.body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: options.signal
        ? AbortSignal.any([timeout, options.signal])
        : timeout,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const code =
        typeof body === 'object' &&
        body !== null &&
        'code' in body &&
        typeof body.code === 'string'
          ? body.code
          : 'SERVER_UNAVAILABLE';
      throw new ApiError(code, response.status);
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ApiError('NETWORK_ERROR');
  }
}
export async function read<T>(
  path: string,
  parser: Parser<T>,
  signal?: AbortSignal,
): Promise<T> {
  const body = await request(path, signal ? { signal } : {});
  try {
    return parser.parse(body);
  } catch {
    throw new ApiError('INVALID_RESPONSE');
  }
}
