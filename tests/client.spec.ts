import { expect, test, afterEach, describe } from "bun:test";
import { GlucoseReading } from '../src/reading';
import { LibreLinkClient } from '../src/client';
import { LibreLinkConnectionsMock, LibreLinkLoginMock, LibreLinkReadMock } from './mocks';
import { stubFetch, restoreFetch } from './fetch-stub';

const graphBody = {
  status: 0,
  data: {
    connection: LibreLinkConnectionsMock.data[0],
    activeSensors: [],
    graphData: [LibreLinkConnectionsMock.data[0].glucoseItem],
  },
  ticket: LibreLinkConnectionsMock.ticket,
};

function testClient() {
  return new LibreLinkClient({
    email: 'test@example.com',
    password: 'testpassword',
    autoUpdateVersion: false,
  });
}

describe('LibreLinkClient', () => {
  afterEach(() => {
    restoreFetch();
  });

  test('should be created', () => {
    expect(testClient()).toBeTruthy();
  });

  test('should successfully login', async () => {
    stubFetch([
      { urlContains: 'llu/auth/login', method: 'POST', responses: [{ status: 200, body: LibreLinkLoginMock }] },
    ]);

    const client = testClient();
    await client.login();

    expect(client.me).toBeTruthy();
    expect(client.getAuthStatus().hasToken).toBe(true);
  });

  test('should successfully fetch connections', async () => {
    stubFetch([
      { urlContains: 'llu/connections', responses: [{ status: 200, body: LibreLinkConnectionsMock }] },
    ]);

    const { data } = await testClient().fetchConnections();

    expect(data).toBeTruthy();
  });

  test('should successfully read data', async () => {
    stubFetch([
      { urlContains: '/graph', responses: [{ status: 200, body: graphBody }] },
      { urlContains: 'llu/connections', responses: [{ status: 200, body: LibreLinkConnectionsMock }] },
    ]);

    const data = await testClient().read();

    expect(data).toBeTruthy();
  });

  test('should return the logbook', async () => {
    stubFetch([
      { urlContains: '/logbook', responses: [{ status: 200, body: { status: 0, data: [LibreLinkConnectionsMock.data[0].glucoseMeasurement] } }] },
      { urlContains: 'llu/connections', responses: [{ status: 200, body: LibreLinkConnectionsMock }] },
    ]);

    const data = await testClient().logbook();

    expect(data).toBeTruthy();
    expect(data[0]).toBeInstanceOf(GlucoseReading);
    expect(data.length).toBe(1);
  });

  test('should successfully stream data', async () => {
    stubFetch([
      { urlContains: '/graph', responses: [{ status: 200, body: graphBody }] },
      { urlContains: 'llu/connections', responses: [{ status: 200, body: LibreLinkConnectionsMock }] },
    ]);

    const stream = testClient().stream(10);

    const readings: GlucoseReading[] = [];

    for await (const reading of stream) {
      expect(reading).toBeTruthy();
      expect(reading.value).toBeTruthy();

      readings.push(reading);
      if (readings.length === 2) break;
    }

    expect(readings.length).toBe(2);
  });

  test('uses the pinned patient when several connections exist', async () => {
    const second = { ...LibreLinkConnectionsMock.data[0], patientId: 'second-patient' };
    stubFetch([
      { urlContains: '/graph', responses: [{ status: 200, body: graphBody }] },
      { urlContains: 'llu/connections', responses: [{ status: 200, body: { ...LibreLinkConnectionsMock, data: [LibreLinkConnectionsMock.data[0], second] } }] },
    ]);

    const client = new LibreLinkClient({
      email: 'test@example.com',
      password: 'testpassword',
      patientId: 'second-patient',
      autoUpdateVersion: false,
    });
    await client.read();
    // The graph request must target the pinned patient, not always the first.
    const graphCalls = (await import('./fetch-stub')).fetchCalls().filter((c) => c.url.includes('/graph'));
    expect(graphCalls.length).toBe(1);
    expect(graphCalls[0].url).toContain('second-patient');
  });
});
