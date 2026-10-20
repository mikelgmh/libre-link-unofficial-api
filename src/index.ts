export { LibreLinkClient, LibreLinkClientOptions } from "./client";
export { GlucoseReading } from './reading';
export {
  DEFAULT_API_URL,
  DEFAULT_LLU_VERSION,
  DEFAULT_PRODUCT,
  BUNDLED_LADDER,
  BUNDLED_VERSION_INFO,
  REGION_HOSTS,
  REMOTE_VERSION_URL,
  apiUrlForRegion,
  backoffDelay,
  buildVersionLadder,
  isRateLimited,
  isTokenError,
  isVersionBlockedError,
  markVersionWorking,
  resolveLluVersionAsync,
  resolveLluVersionSync,
  type LluVersionInfo,
  type ResolveLluVersionOptions,
} from "./version-resolver";
