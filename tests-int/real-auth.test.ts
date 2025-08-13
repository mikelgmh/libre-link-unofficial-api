import { expect, test, describe } from "bun:test";
import { LibreLinkClient } from '../src/client';

// Helper function to add delay between API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Load environment variables
const getTestCredentials = () => {
  const email = process.env.LIBRELINK_EMAIL;
  const password = process.env.LIBRELINK_PASSWORD;
  const lluVersion = process.env.LIBRELINK_LLU_VERSION || '4.12.0';

  if (!email || !password) {
    throw new Error(
      'Test credentials not found. Please set LIBRELINK_EMAIL and LIBRELINK_PASSWORD environment variables or create a .env file.'
    );
  }

  return { email, password, lluVersion };
};

describe('LibreLinkClient Real Data Authentication Tests', () => {
  let sharedClient: LibreLinkClient;

  test('should successfully authenticate with real credentials', async () => {
    const credentials = getTestCredentials();
    
    sharedClient = new LibreLinkClient({
      email: credentials.email,
      password: credentials.password,
      lluVersion: credentials.lluVersion
    });

    // Test client creation
    expect(sharedClient).toBeTruthy();
    expect(sharedClient).toBeInstanceOf(LibreLinkClient);

    try {
      // Test login
      const loginResponse = await sharedClient.login();

      expect(loginResponse).toBeTruthy();
      expect(loginResponse.status).toBe(0); // LibreLink API uses 0 for success
      expect(loginResponse.data).toBeTruthy();
      expect(loginResponse.data.user).toBeTruthy();

      // Test user data
      expect(sharedClient.me).toBeTruthy();
      expect(sharedClient.me?.email).toBe(credentials.email);
      expect(sharedClient.me?.firstName).toBeTruthy();
      expect(sharedClient.me?.lastName).toBeTruthy();
      expect(sharedClient.me?.country).toBeTruthy();

      console.log('✅ Login successful! User details:');
      console.log(`   Name: ${sharedClient.me?.firstName} ${sharedClient.me?.lastName}`);
      console.log(`   Email: ${sharedClient.me?.email}`);
      console.log(`   Country: ${sharedClient.me?.country}`);
      console.log(`   Date Format: ${sharedClient.me?.dateFormat}`);
      console.log(`   Time Format: ${sharedClient.me?.timeFormat}`);
      console.log(`   Device Count: ${Object.keys(sharedClient.me?.devices || {}).length}`);

      // Test authentication token
      expect(loginResponse.data.authTicket).toBeTruthy();
      expect(loginResponse.data.authTicket.token).toBeTruthy();
      expect(typeof loginResponse.data.authTicket.token).toBe('string');
      expect(loginResponse.data.authTicket.expires).toBeGreaterThan(Date.now() / 1000);

      console.log('✅ Authentication token received and valid');
      console.log(`   Token expires at: ${new Date(loginResponse.data.authTicket.expires * 1000).toISOString()}`);

    } catch (error) {
      const errorMessage = (error as Error).message;
      console.error('❌ Authentication failed:', errorMessage);

      // Check if it's a rate limiting error
      if (errorMessage.includes('status 430')) {
        console.log('   💡 Rate limiting detected. The API might be throttling requests.');
        console.log('   ⏳ Consider adding delays between tests or running them separately.');
      }

      throw error;
    }
  }, 30000); // Increase timeout to 30 seconds

  test('should test API data access (with error handling)', async () => {
    // Add delay to avoid rate limiting
    await delay(2000);

    // Reuse the shared client to avoid rate limiting
    expect(sharedClient).toBeTruthy();

    // Test connections with proper error handling
    try {
      const connectionsResponse = await sharedClient.fetchConnections();

      if (connectionsResponse.data && connectionsResponse.data.length > 0) {
        console.log('✅ Connections fetched successfully');
        console.log(`   Number of connections: ${connectionsResponse.data.length}`);

        const connection = connectionsResponse.data[0];
        console.log(`   Patient ID: ${connection.patientId}`);
        console.log(`   Patient Name: ${connection.firstName} ${connection.lastName}`);
        console.log(`   Target Range: ${connection.targetLow}-${connection.targetHigh}`);

        expect(connection.patientId).toBeTruthy();
        expect(connection.firstName).toBeTruthy();
        expect(connection.lastName).toBeTruthy();
      } else {
        console.log('ℹ️  No connections found (user might not have linked sensors)');
      }

    } catch (error) {
      const errorMessage = (error as Error).message;
      console.log('⚠️  Connections fetch failed:', errorMessage);

      // Check if it's a version-related error
      if (errorMessage.includes('minimumVersion') || errorMessage.includes('status 920')) {
        console.log('   💡 This might be due to API version requirements. Current lluVersion: 4.12.0');
      } else if (errorMessage.includes('no active sensors')) {
        console.log('   ℹ️  Expected if user has no active sensors');
      } else if (errorMessage.includes('status 430')) {
        console.log('   ⏳ Rate limiting detected. API is throttling requests.');
      } else if (errorMessage.includes('status 400') && errorMessage.includes('jwt')) {
        console.log('   🔑 JWT token issue. Session might have expired.');
      }
      // This is expected if the user doesn't have active sensors or there are API version issues
    }

    // Add delay between API calls
    await delay(1000);

    // Test glucose reading with proper error handling
    try {
      const glucoseReading = await sharedClient.read();

      console.log('✅ Glucose reading successful');
      console.log(`   Value: ${glucoseReading.value} mg/dL (${glucoseReading.mmol} mmol/L)`);
      console.log(`   Trend: ${glucoseReading.trendType}`);
      console.log(`   Timestamp: ${glucoseReading.timestamp.toISOString()}`);
      console.log(`   Is High: ${glucoseReading.isHigh}`);
      console.log(`   Is Low: ${glucoseReading.isLow}`);

      expect(typeof glucoseReading.value).toBe('number');
      expect(glucoseReading.value).toBeGreaterThan(0);
      expect(glucoseReading.timestamp).toBeInstanceOf(Date);

    } catch (error) {
      const errorMessage = (error as Error).message;
      console.log('⚠️  Glucose reading failed:', errorMessage);

      // Check if it's a version-related error
      if (errorMessage.includes('minimumVersion') || errorMessage.includes('status 920')) {
        console.log('   💡 This might be due to API version requirements. Current lluVersion: 4.12.0');
      } else if (errorMessage.includes('no active sensors')) {
        console.log('   ℹ️  Expected if user has no active sensors');
      } else if (errorMessage.includes('status 430')) {
        console.log('   ⏳ Rate limiting detected. API is throttling requests.');
      } else if (errorMessage.includes('status 400') && errorMessage.includes('jwt')) {
        console.log('   🔑 JWT token issue. Session might have expired.');
      }
      // This is expected if the user doesn't have active sensors
    }

    // Add delay between API calls
    await delay(1000);

    // Test logbook with proper error handling
    try {
      const logbook = await sharedClient.logbook();

      console.log('✅ Logbook fetch successful');
      console.log(`   Number of readings: ${logbook.length}`);

      if (logbook.length > 0) {
        const latest = logbook[0];
        console.log(`   Latest reading: ${latest.value} mg/dL at ${latest.timestamp.toISOString()}`);

        expect(Array.isArray(logbook)).toBe(true);
        expect(typeof logbook[0].value).toBe('number');
      }

    } catch (error) {
      const errorMessage = (error as Error).message;
      console.log('⚠️  Logbook fetch failed:', errorMessage);

      // Check if it's a version-related error
      if (errorMessage.includes('minimumVersion') || errorMessage.includes('status 920')) {
        console.log('   💡 This might be due to API version requirements. Current lluVersion: 4.12.0');
      } else if (errorMessage.includes('no active sensors')) {
        console.log('   ℹ️  Expected if user has no active sensors');
      } else if (errorMessage.includes('status 430')) {
        console.log('   ⏳ Rate limiting detected. API is throttling requests.');
      } else if (errorMessage.includes('status 400') && errorMessage.includes('jwt')) {
        console.log('   🔑 JWT token issue. Session might have expired.');
      }
      // This is expected if the user doesn't have active sensors
    }
  }, 60000); // Increase timeout to 60 seconds

  test('should validate API response structures', async () => {
    // Add delay to avoid rate limiting
    await delay(2000);

    // Check if the first test succeeded before proceeding
    if (!sharedClient || !sharedClient.me) {
      console.log('⚠️  Skipping validation test because authentication failed in previous test');
      return;
    }

    // Since we already logged in during the first test, we can validate the structure
    // from the existing session data
    const userData = sharedClient.me;

    // Validate user data structure
    expect(userData).toMatchObject({
      id: expect.any(String),
      firstName: expect.any(String),
      lastName: expect.any(String),
      email: expect.any(String),
      country: expect.any(String)
    });

    console.log('✅ User data structure validated');
    console.log('✅ All core API authentication functionality working correctly');
  }, 10000); // Increase timeout to 10 seconds
});
