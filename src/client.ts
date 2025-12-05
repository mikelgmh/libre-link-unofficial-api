import { GlucoseReading } from "./reading";
import { LibreLinkUpEndpoints, LibreLoginResponse, LibreResponse, LibreRedirectResponse, LibreUser, LibreConnection, LibreConnectionResponse, LibreLogbookResponse, RawGlucoseReading } from "./types";
import { encryptSha256, parseUser } from "./utils";

/**
 * A class for interacting with the Libre Link Up API.
 */
export class LibreLinkClient {
  private apiUrl: string;
  private accessToken: string | null = null;
  private patientId: string | null = null;
  private lluVersion: string;
  private credentials: { email: string; password: string };
  private options: LibreLinkClientOptions;

  // A cache for storing fetched data.
  private cache = new Map<string, any>();

  constructor(options: LibreLinkClientOptions) {
    if (!options?.email || !options?.password) {
      throw new Error("Email and password are required to create a LibreLinkClient instance.");
    }

    this.credentials = {
      email: options.email,
      password: options.password
    };

    this.apiUrl = options.apiUrl ?? DEFAULT_OPTIONS.apiUrl!;
    this.patientId = options.patientId ?? null;
    this.lluVersion = options.lluVersion ?? DEFAULT_OPTIONS.lluVersion!;

    // Merge the options with the default options.
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * @description Get the user data. Only available after logging in.
   */
  public get me(): LibreUser | null {
    if (!this.cache.has("user")) {
      return null;
    }

    return this.cache.get("user");
  }

  /**
   * @description Log into the Libre Link Up API using the provided credentials.
   */
  public async login(): Promise<LibreLoginResponse> {
    const { email, password } = this.credentials;

    try {
      type LoginResponse = LibreLoginResponse | LibreRedirectResponse;

      // Attempt to login to the Libre Link Up API.
      const response = await this._fetcher<LoginResponse>(LibreLinkUpEndpoints.Login, {
        method: "POST",
        body: JSON.stringify({
          email,
          password
        }),
      });

      // If the status is 2, means the credentials are invalid.
      if (response.status === 2)
        throw new Error("Invalid credentials. Please ensure that the email and password work with the LibreLinkUp app.");

      if (!response.data)
        throw new Error("No data returned from Libre Link Up API.");

      // If the response contains a redirect, update the region and try again.
      if ("redirect" in response.data) {
        const regionUrl = await this.findRegion(response.data.region);
        // Update the API URL with the region url.
        this.apiUrl = regionUrl;

        return await this.login();
      }

      // Set the access token for future requests.
      this.accessToken = response.data.authTicket?.token;

      // Cache the user data for future use. Log in again to refresh the user data.
      if (response.data.user) {
        this.setCache("user", parseUser(response.data.user));
      }

      return response as LibreLoginResponse;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error logging into Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Read the data from the Libre Link Up API.
   * @returns The latest glucose measurement from the Libre Link Up API.
   */
  public async read() {
    try {
      const response = await this.fetchReading();

      // Parse and return the latest glucose item from the response.
      return new GlucoseReading(response.data?.connection.glucoseItem, response.data.connection);
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error reading data from Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Read the history data from the Libre Link Up API.
   */
  public async history() {
    try {
      const response = await this.fetchReading();

      const list = response.data.graphData.map((item: RawGlucoseReading) => new GlucoseReading(item, response.data.connection));

      return list;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error reading data from Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Read the logbook data from manual scans from the Libre Link Up API.
   */
  public async logbook() {
    try {
      const response = await this.fetchLogbook();

      const list = response.data.map((item: RawGlucoseReading) => new GlucoseReading(item));

      return list;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error reading data from Libre Link Up API. ${error.message}`);
    }
  }

  /**
     * @description Stream the readings from the Libre Link Up API.
     * @param intervalMs The interval between each reading. Default is 90 seconds.
     */
  public async *stream(intervalMs = 1000 * 90) {
    while (true) { // Keep streaming until manually stopped
      try {
        const reading = await this.read();
        yield reading;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      } catch (error) {
        throw error;
      }
    }
  }

  /**
   * @description Fetch the reading from the Libre Link Up API. Use to obtain the raw reading and more.
   * @returns The response from the Libre Link Up API.
   */
  public async fetchReading() {
    try {
      const patientId = await this.getPatientId();

      const headers = {
        "Account-Id": this.me?.id ? await encryptSha256(this.me.id) : "",
      };

      const response = await this._fetcher<LibreConnectionResponse>(`${LibreLinkUpEndpoints.Connections}/${patientId}/graph`, { headers });

      return response;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error fetching reading from Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Fetch the logbook from the Libre Link Up API. Use to obtain the list of manual scanned readings.
   * @returns The response from the Libre Link Up API.
   */
  public async fetchLogbook() {
    try {
      const patientId = await this.getPatientId();

      const headers = {
        "Account-Id": this.me?.id ? await encryptSha256(this.me.id) : "",
      };

      const response = await this._fetcher<LibreLogbookResponse>(`${LibreLinkUpEndpoints.Connections}/${patientId}/logbook`, { headers });

      return response;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error fetching reading from Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Get the connections from the Libre Link Up API.
   */
  public async fetchConnections() {
    try {
      if (this.cache.has("connections"))
        return this.cache.get("connections");

      const headers = {
        "Account-Id": this.me?.id ? await encryptSha256(this.me.id) : "",
      };

      // Fetch the connections from the Libre Link Up API.
      const connections = await this._fetcher(LibreLinkUpEndpoints.Connections, { headers });

      if (!!connections?.data?.length)
        // Cache the connections for future use.
        this.setCache("connections", connections);

      return connections;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error fetching connections from Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Get the patient ID from the connections.
   */
  private async getPatientId() {
    const connections = await this.fetchConnections();

    // If there are no connections, throw an error.
    if (!connections.data?.length)
      throw new Error("No connections found. Please ensure that you have a connection with the LibreLinkUp app.");

    // Get the patient ID from the connections, or fallback to the first connection.

    let patientId = connections.data[0].patientId;

    if (this.patientId)
      connections.data.find(
        (connection: LibreConnection) => connection.patientId === this.patientId
      )?.patientId;

    if (!patientId)
      throw new Error(`Patient ID not found in connections. (${this.patientId})`);

    return patientId;
  }

  /**
   * @description Find the region in the Libre Link Up API. This is used when the API returns a redirect.
   * @param region The region to find.
   * @returns The server URL for the region.
   */
  private async findRegion(region: string) {
    try {
      const response = await this._fetcher(LibreLinkUpEndpoints.Country);

      // Find the region in the response.
      const lslApi = response.data?.regionalMap[region]?.lslApi;

      if (!lslApi)
        throw new Error("Region not found in Libre Link Up API.");

      return lslApi;
    } catch (err) {
      const error = err as Error;

      throw new Error(`Error finding region in Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description A generic fetcher for the Libre Link Up API.
   * @param endpoint
   * @param options
   * @param isRetry Internal flag to prevent infinite retry loops
   */
  private async _fetcher<T = LibreResponse>(endpoint: string, options: any = { headers: {} }, isRetry = false): Promise<T> {
    const headers = {
      ...options.headers,
      Authorization: this.accessToken ? `Bearer ${this.accessToken}` : "",

      // Libre Link Up API headers
      product: 'llu.android',
      version: this.lluVersion,

      'accept-encoding': 'gzip',
      'cache-control': 'no-cache',
      connection: 'Keep-Alive',
      'content-type': 'application/json',
    };

    const requestOptions = Object.freeze({
      ...options,
      headers
    });

    try {
      const response = await fetch(
        `${this.apiUrl}/${endpoint}`,
        requestOptions
      );

      if (!response.ok) {
        const errorPayload = await response.json();
        const errorMessage = errorPayload?.message ?? JSON.stringify(errorPayload, null, 2)

        if (response.status === 429)
          throw new Error(`Too many requests. Please wait before trying again. ${errorMessage}`);

        // Check if the error is related to token expiration
        if (!isRetry && this.isTokenExpiredError(response.status, errorMessage)) {
          try {
            // Clear the expired token and user cache
            this.accessToken = null;
            this.cache.delete("user");

            // Attempt to login again to refresh the token
            await this.login();

            // Retry the original request with the new token
            return await this._fetcher<T>(endpoint, options, true);
          } catch (loginError) {
            throw new Error(`Token expired and automatic login failed: ${(loginError as Error).message}`);
          }
        }

        throw new Error(
          `Error fetching data from Libre Link Up API with status ${response.status}. ${errorMessage}`
        );
      }

      const data = (await response.json()) as T;

      return data;
    } catch (err) {
      const error = err as Error;

      // Check if this is a network error that might indicate token expiration
      if (!isRetry && this.isTokenExpiredError(0, error.message)) {
        try {
          // Clear the expired token and user cache
          this.accessToken = null;
          this.cache.delete("user");

          // Attempt to login again to refresh the token
          await this.login();

          // Retry the original request with the new token
          return await this._fetcher<T>(endpoint, options, true);
        } catch (loginError) {
          throw new Error(`Token expired and automatic login failed: ${(loginError as Error).message}`);
        }
      }

      throw new Error(`Error processing request to Libre Link Up API. ${error.message}`);
    }
  }

  /**
   * @description Check if an error indicates that the authentication token has expired.
   * @param statusCode The HTTP status code from the response
   * @param errorMessage The error message from the response
   * @returns True if the error indicates token expiration
   */
  private isTokenExpiredError(statusCode: number, errorMessage: string): boolean {
    // Check for common token expiration indicators
    const tokenErrorIndicators = [
      'token',
      'jwt',
      'unauthorized',
      'authentication',
      'expired',
      'invalid token',
      'access denied',
      'malformed jwt',
      'missing jwt'
    ];

    const messageContainsTokenError = tokenErrorIndicators.some(indicator =>
      errorMessage.toLowerCase().includes(indicator.toLowerCase())
    );

    // HTTP 401 (Unauthorized), 403 (Forbidden), or 400 (Bad Request with JWT errors) often indicate token issues
    const isAuthStatusCode = statusCode === 401 || statusCode === 403 || (statusCode === 400 && messageContainsTokenError);

    return messageContainsTokenError || isAuthStatusCode;
  }

  /**
   * @description Cache a value, if caching is enabled.
   * @param key The key to cache the value under.
   * @param value The value to cache.
   */
  private setCache(key: string, value: any) {
    if (!this.options.cache) return;

    this.cache.set(key, value);
  }

  /**
   * @description Clear the cache.
   */
  public clearCache() {
    this.cache.clear();
  }

  /**
   * @description Debug method to check if the client has a valid access token
   * @returns Information about the current authentication state
   */
  public getAuthStatus() {
    return {
      hasToken: !!this.accessToken,
      tokenLength: this.accessToken?.length || 0,
      hasUser: !!this.me,
      userId: this.me?.id || null
    };
  }
}

export interface LibreLinkClientOptions {
  email: string;
  password: string;
  apiUrl?: string;
  patientId?: string;
  cache?: boolean;
  lluVersion?: string;
}

const DEFAULT_OPTIONS: Partial<LibreLinkClientOptions> = {
  apiUrl: "https://api-us.libreview.io",
  cache: true,
  lluVersion: "4.7.0"
};