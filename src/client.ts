import { GlucoseReading } from "./reading";
import { LibreLinkUpEndpoints, LibreLoginResponse, LibreResponse, LibreRedirectResponse, LibreUser, LibreConnection, LibreConnectionResponse, LibreLogbookResponse, RawGlucoseReading } from "./types";
import { encryptSha256, parseUser } from "./utils";
import {
  DEFAULT_API_URL,
  DEFAULT_LLU_VERSION,
  DEFAULT_PRODUCT,
  apiUrlForRegion,
  backoffDelay,
  buildVersionLadder,
  isRateLimited,
  isTokenError,
  isVersionBlockedError,
  markVersionWorking,
  resolveLluVersionAsync,
  resolveLluVersionSync,
  sleep,
} from "./version-resolver";

/**
 * A class for interacting with the Libre Link Up API.
 */
export class LibreLinkClient {
  private apiUrl: string;
  private accessToken: string | null = null;
  private patientId: string | null = null;
  private lluVersion: string;
  private product: string;
  private credentials: { email: string; password: string };
  private options: LibreLinkClientOptions;
  private autoUpdateVersion: boolean;
  private versionUrl?: string;
  /** User-pinned version (raw option, before defaults are merged). */
  private explicitVersion?: string;

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

    // Region pin (e.g. "eu") beats a raw apiUrl; otherwise start at the
    // global endpoint so Abbott redirects to the account's region on login.
    this.apiUrl = options.apiUrl ?? apiUrlForRegion(options.region) ?? DEFAULT_API_URL;
    this.patientId = options.patientId ?? null;
    this.explicitVersion = options.lluVersion;
    // Explicit pin wins; otherwise the best version known to this process.
    // The remote file is consulted asynchronously on login (never blocks construction).
    this.lluVersion = options.lluVersion ?? resolveLluVersionSync();
    this.product = options.product ?? DEFAULT_PRODUCT;
    this.autoUpdateVersion = options.autoUpdateVersion !== false;
    this.versionUrl = options.versionUrl;

    // Merge the options with the default options.
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Currently emulated app version (may self-update after `login()`). */
  public get resolvedVersion(): string {
    return this.lluVersion;
  }

  /** Refresh the emulated version from the remote file. Never throws. */
  public async resolveVersion(): Promise<string> {
    // An explicit pin always wins — there is nothing to resolve.
    if (this.explicitVersion) return this.lluVersion;
    this.lluVersion = await resolveLluVersionAsync({
      autoUpdate: this.autoUpdateVersion,
      versionUrl: this.versionUrl,
    });
    return this.lluVersion;
  }

  /**
   * Force a fresh read of the remote version file, bypassing the TTL cache.
   * Used when Abbott just blocked our fingerprint: the watchdog may have
   * published a newer version minutes ago that this process hasn't seen.
   * Never throws; falls back to the best version known to this process.
   */
  public async resolveVersionForce(): Promise<string> {
    if (this.explicitVersion) return this.lluVersion;
    this.lluVersion = await resolveLluVersionAsync({
      autoUpdate: this.autoUpdateVersion,
      versionUrl: this.versionUrl,
      forceRefresh: true,
    });
    return this.lluVersion;
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
    return this.performLogin();
  }

  private async performLogin(triedVersions: string[] = []): Promise<LibreLoginResponse> {
    const { email, password } = this.credentials;

    try {
      // Consult the self-updating version file before authenticating, so a
      // blocked client version is refreshed proactively instead of 403ing.
      // Skipped mid-ladder: a retry already carries a chosen version.
      if (triedVersions.length === 0) await this.resolveVersion();

      type LoginResponse = LibreLoginResponse | LibreRedirectResponse;

      // Login requests must never trigger the auto-login retry path
      // (that would recurse); failures surface directly. Version retries
      // propagate the already-tried list so the ladder always terminates.
      // Mid-ladder logins (triedVersions non-empty) never start a nested
      // walk — the outer walk owns the ladder and advances it one version
      // per attempt, so login tries stay bounded by the ladder length.
      const response = await this._fetcher<LoginResponse>(LibreLinkUpEndpoints.Login, {
        method: "POST",
        body: JSON.stringify({
          email,
          password
        }),
      }, { allowAutoLogin: false, allowVersionRetry: triedVersions.length === 0, versionTried: triedVersions });

      // If the status is 2, means the credentials are invalid.
      if (response.status === 2)
        throw new Error("Invalid credentials. Please ensure that the email and password work with the LibreLinkUp app.");

      // Status 4 means the account needs action in the app (terms/privacy).
      // Re-logging in cannot fix that — fail fast with a clear message.
      if (response.status === 4)
        throw new Error("Account action required: please open the LibreLinkUp app and accept the Terms of Use / Privacy Policy, then try again.");

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

      markVersionWorking(this.lluVersion);
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

      markVersionWorking(this.lluVersion);
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

      markVersionWorking(this.lluVersion);
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

      markVersionWorking(this.lluVersion);
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

    // Prefer the pinned patient, otherwise fall back to the first connection.
    let patientId = connections.data[0].patientId;

    if (this.patientId) {
      const match = connections.data.find(
        (connection: LibreConnection) => connection.patientId === this.patientId
      );
      if (!match)
        throw new Error(`Patient ID not found in connections. (${this.patientId})`);
      patientId = match.patientId;
    }

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
      const response = await this._fetcher(LibreLinkUpEndpoints.Country, {}, { allowAutoLogin: false });

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
   * @param retry Policy flags for this call.
   */
  private async _fetcher<T = LibreResponse>(
    endpoint: string,
    options: any = { headers: {} },
    retry: { allowAutoLogin?: boolean; allowVersionRetry?: boolean; rateLimitAttempt?: number; versionTried?: string[] } = {}
  ): Promise<T> {
    const { allowAutoLogin = true, allowVersionRetry = true, rateLimitAttempt = 0, versionTried = [] } = retry;
    const headers = {
      ...options.headers,
      Authorization: this.accessToken ? `Bearer ${this.accessToken}` : "",

      // Libre Link Up API headers
      product: this.product,
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
        const errorPayload = await response.json().catch(() => null);
        // Keep the FULL body: a bare `.message` has hidden diagnoses before.
        const bodyText = JSON.stringify(errorPayload);
        const errorMessage =
          typeof errorPayload?.message === "string" && errorPayload.message
            ? `${errorPayload.message} — ${bodyText}`
            : bodyText;

        if (isRateLimited(response.status)) {
          // Back off with jitter so fleets of boxes don't hammer in lockstep.
          if (rateLimitAttempt < 2) {
            const retryAfter = Number(response.headers?.get?.("retry-after"));
            const wait = Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 60_000)
              : backoffDelay(rateLimitAttempt);
            await sleep(wait);
            return await this._fetcher<T>(endpoint, options, { ...retry, rateLimitAttempt: rateLimitAttempt + 1 });
          }
          throw new Error(`Too many requests. Please wait before trying again. ${errorMessage}`);
        }

        // Genuine token problem: clear it, log in once, retry once.
        // NOTE: a bare 403 is NOT enough — Abbott also 403s blocked app
        // versions, WAF hits and region mismatches (see below).
        if (allowAutoLogin && isTokenError(response.status, errorMessage)) {
          try {
            // Clear the expired token and user cache
            this.accessToken = null;
            this.cache.delete("user");

            // Attempt to login again to refresh the token
            await this.login();

            // Retry the original request with the new token (no further auto-login)
            return await this._fetcher<T>(endpoint, options, { ...retry, allowAutoLogin: false });
          } catch (loginError) {
            throw new Error(`Token expired and automatic login failed: ${(loginError as Error).message}`);
          }
        }

        // Blocked client version (or WAF/region block): walk the WHOLE
        // version ladder instead of pointlessly re-logging in. The remote
        // file is refreshed first (bypassing the TTL cache) so a version
        // the watchdog published minutes ago is picked up immediately.
        // Skipped when the user pinned a version explicitly. Already-tried
        // versions are skipped so the ladder always terminates.
        if (allowVersionRetry && !this.explicitVersion && isVersionBlockedError(response.status, errorMessage)) {
          const startVersion = this.lluVersion;
          if (this.autoUpdateVersion) {
            try {
              await this.resolveVersionForce();
            } catch {
              // Fall through to the bundled ladder — never fatal.
            }
          }
          const tried = [...versionTried, startVersion];
          // Note: the force-refreshed version is deliberately NOT marked as
          // tried — the ladder below picks it up first via remote-latest.
          // If everything fails, keep the freshest known version, not the
          // just-blocked one.
          const keepVersion = this.lluVersion;
          const ladder = buildVersionLadder(this.explicitVersion);
          let next = ladder.find((v) => !tried.includes(v));
          let lastError: Error | null = null;
          while (next) {
            tried.push(next);
            try {
              this.lluVersion = next;
              this.accessToken = null;
              this.cache.delete("user");
              if (endpoint === LibreLinkUpEndpoints.Login) {
                // We ARE the login request: retry it directly with the new version.
                return await this._fetcher<T>(endpoint, options, { ...retry, allowVersionRetry: false, versionTried: tried });
              }
              await this.performLogin(tried);
              return await this._fetcher<T>(endpoint, options, { ...retry, allowVersionRetry: false, allowAutoLogin: false });
            } catch (ladderError) {
              lastError = ladderError as Error;
              next = ladder.find((v) => !tried.includes(v));
            }
          }
          // Exhausted: keep the freshest known version and report everything.
          this.lluVersion = keepVersion;
          throw new Error(
            `LibreLinkUp rejected client version(s) ${tried.join(", ")} (status ${response.status}: ${errorMessage}); last attempt failed with: ${lastError?.message ?? "unknown error"}`
          );
        }

        throw new Error(
          `Error fetching data from Libre Link Up API with status ${response.status}. ${errorMessage}`
        );
      }

      const data = (await response.json()) as T;

      return data;
    } catch (err) {
      const error = err as Error;

      // Our own classified errors already carry full context — pass through.
      if (/^Error (fetching data|logging into Libre Link Up API|finding region)|Too many requests|Token expired|LibreLinkUp rejected client version/.test(error.message)) {
        throw error;
      }

      throw new Error(`Error processing request to Libre Link Up API. ${error.message}`);
    }
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
      userId: this.me?.id || null,
      lluVersion: this.lluVersion,
      apiUrl: this.apiUrl,
    };
  }
}

export interface LibreLinkClientOptions {
  email: string;
  password: string;
  apiUrl?: string;
  /** Region short-code (eu, us, …). Beats the default URL; ignored if `apiUrl` is set. */
  region?: string;
  patientId?: string;
  cache?: boolean;
  lluVersion?: string;
  /** Emulated product id. Default "llu.android". */
  product?: string;
  /** Consult the self-updating version file on login. Default true. */
  autoUpdateVersion?: boolean;
  /** Override the version-file URL (tests / mirrors). */
  versionUrl?: string;
}

const DEFAULT_OPTIONS: Partial<LibreLinkClientOptions> = {
  apiUrl: DEFAULT_API_URL,
  cache: true,
  lluVersion: DEFAULT_LLU_VERSION,
  product: DEFAULT_PRODUCT,
};
