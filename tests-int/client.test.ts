import { expect, test, beforeEach, describe } from "bun:test";
import { LibreLinkClient } from '../src/client';
import { mapObjectPropertiesToTypes } from "./utils";

describe('Libre Link Up API Integrity', () => {
  const client: LibreLinkClient = new LibreLinkClient({
    email: process.env.LIBRE_LINK_EMAIL!,
    password: process.env.LIBRE_LINK_PASSWORD!,
    patientId: process.env.LIBRE_LINK_PATIENT_ID
  });

  // Wait for a couple of seconds between tests to avoid 429 too many requests errors.
  beforeEach(() => new Promise((resolve) => setTimeout(resolve, 5000)));

  test('should be created', () => {
    expect(client).toBeTruthy();
  });

  test('should successfully login', async () => {
    try {
      await client.login();

      const sampleDevice = client.me?.devices[Object.keys(client.me?.devices)[0]];
      const processedMe = { ...client.me!, devices: { "a1b2c3d4-e5f6-1789-9abc-def012345678": sampleDevice } }

      expect(processedMe).toBeTruthy();
      expect(mapObjectPropertiesToTypes(processedMe!)).toMatchSnapshot();
    } catch (error) {
      if (error.message.includes('430')) {
        expect(true).toBe(true); // Pass on rate limit
      } else {
        throw error;
      }
    }
  });

  test('should successfully fetch connections', async () => {
    try {
      const { data } = await client.fetchConnections();

      expect(data).toBeTruthy();
      expect(mapObjectPropertiesToTypes(data!)).toMatchSnapshot();
    } catch (error) {
      if (error.message.includes('430')) {
        expect(true).toBe(true); // Pass on rate limit
      } else {
        throw error;
      }
    }
  });

  test('should successfully read data', async () => {
    try {
      const glucoseReading = await client.read();

      expect(glucoseReading).toBeTruthy();
      expect(typeof glucoseReading.value).toBe("number");
      expect(glucoseReading.timestamp instanceof Date).toBe(true);
      expect(mapObjectPropertiesToTypes(glucoseReading._raw)).toMatchSnapshot();
    } catch (error) {
      if (error.message.includes('430')) {
        expect(true).toBe(true); // Pass on rate limit
      } else {
        throw error;
      }
    }
  });

  test('should successfully read logbook', async () => {
    try {
      const glucoseReadings = await client.logbook();

      expect(glucoseReadings).toBeTruthy();
      if (glucoseReadings.length > 0) {
        expect(glucoseReadings[0]).toBeTruthy();
        expect(typeof glucoseReadings[0].value).toBe("number");
        expect(glucoseReadings[0].timestamp instanceof Date).toBe(true);
      }
    } catch (error) {
      if (error.message.includes('430')) {
        expect(true).toBe(true); // Pass on rate limit
      } else {
        throw error;
      }
    }
  });

  // TODO: Fix the test.
  // test('should initialize with a patientId', async () => {
  //   const customClient = new LibreLinkClient({ 
  //     email: process.env.LIBRE_LINK_EMAIL!,
  //     password: process.env.LIBRE_LINK_PASSWORD!,
  //     patientId: "7f51ab27-c7c8-11ed-bcc3-0242ac110002" 
  //   });

  //   await customClient.login();

  //   expect(customClient.me).toBeTruthy();
  // });

  // test('should throw error with an invalid patientId', async () => {
  //   const customClient = new LibreLinkClient({ 
  //     email: process.env.LIBRE_LINK_EMAIL!,
  //     password: process.env.LIBRE_LINK_PASSWORD!,
  //     patientId: "invalid-patient-id" 
  //   });

  //   try {
  //     await customClient.login();
  //   } catch(err) {
  //     expect(err).toBeTruthy();
  //     expect(err.message).toMatch(/(Patient ID not found in connections. (invalid-patient-id))/i);
  //   }
  // });
});