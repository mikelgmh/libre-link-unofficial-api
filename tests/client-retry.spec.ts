import { expect, test, afterEach, describe, beforeEach } from "bun:test";
import { LibreLinkClient } from '../src/client';
import { __resetVersionState } from "../src/version-resolver";
import { LibreLinkConnectionsMock, LibreLinkLoginMock } from './mocks';
import { stubFetch, restoreFetch, fetchCalls } from './fetch-stub';

function testClient(extra: Record<string, unknown> = {}) {
  return new LibreLinkClient({
    email: 'test@example.com',
    password: 'testpassword',
    autoUpdateVersion: false,
    ...extra,
  });
}

describe('LibreLinkClient anti-blocking', () => {
  beforeEach(() => {
    __resetVersionState();
  });

  afterEach(() => {
    restoreFetch();
  });

  test('401 with token wording triggers one re-login and then succeeds', async () => {
    stubFetch([
      {
        urlContains: 'llu/connections',
        responses: [
          { status: 401, body: { message: 'Unauthorized' } },
          { status: 200, body: LibreLinkConnectionsMock },
        ],
      },
      { urlContains: 'llu/auth/login', method: 'POST', responses: [{ status: 200, body: LibreLinkLoginMock }] },
    ]);

    const { data } = await testClient().fetchConnections();

    expect(data).toBeTruthy();
    expect(fetchCalls().filter((c) => c.url.includes('llu/auth/login')).length).toBe(1);
  });

  test('bare 403 walks the version ladder once and reports both full bodies', async () => {
    const blocked = { message: 'Forbidden', detail: 'client version not allowed' };
    stubFetch([
      { urlContains: 'llu/connections', responses: [{ status: 403, body: blocked }] },
      { urlContains: 'llu/auth/login', method: 'POST', responses: [{ status: 403, body: blocked }] },
    ]);

    const client = testClient();
    const err = await client.fetchConnections().catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    // Full Abbott bodies preserved — no more truncated mysteries.
    expect(err.message).toContain('403');
    expect(err.message).toContain('Forbidden');
    expect(err.message).toContain('client version not allowed');
    // Bounded: ladder is finite, no infinite login loop.
    const logins = fetchCalls().filter((c) => c.url.includes('llu/auth/login')).length;
    expect(logins).toBeGreaterThan(0);
    expect(logins).toBeLessThanOrEqual(6);
    // Failed ladder restores the starting version.
    expect(client.resolvedVersion).toBe('4.16.0');
  });

  test('pinned version is never auto-bumped on 403', async () => {
    stubFetch([
      { urlContains: 'llu/connections', responses: [{ status: 403, body: { message: 'Forbidden' } }] },
    ]);

    const client = testClient({ lluVersion: '4.7.0' });
    const err = await client.fetchConnections().catch((e: Error) => e);

    expect(err.message).toContain('403');
    expect(client.resolvedVersion).toBe('4.7.0');
    expect(fetchCalls().filter((c) => c.url.includes('llu/auth/login')).length).toBe(0);
  });

  test('login status 4 fails fast with an actionable message', async () => {
    stubFetch([
      { urlContains: 'llu/auth/login', method: 'POST', responses: [{ status: 200, body: { status: 4, data: {} } }] },
    ]);

    const err = await testClient().login().catch((e: Error) => e);

    expect(err.message).toContain('Account action required');
    expect(fetchCalls().filter((c) => c.url.includes('llu/auth/login')).length).toBe(1);
  });

  test('login status 2 fails without retrying', async () => {
    stubFetch([
      { urlContains: 'llu/auth/login', method: 'POST', responses: [{ status: 200, body: { status: 2, data: {} } }] },
    ]);

    const err = await testClient().login().catch((e: Error) => e);

    expect(err.message).toContain('Invalid credentials');
    expect(fetchCalls().filter((c) => c.url.includes('llu/auth/login')).length).toBe(1);
  });

  test('one 429 backs off and then succeeds', async () => {
    stubFetch([
      {
        urlContains: 'llu/connections',
        responses: [
          { status: 429, body: { message: 'Too many requests' } },
          { status: 200, body: LibreLinkConnectionsMock },
        ],
      },
    ]);

    const { data } = await testClient().fetchConnections();

    expect(data).toBeTruthy();
    expect(fetchCalls().filter((c) => c.url.includes('llu/connections')).length).toBe(2);
  }, 15000);
});
