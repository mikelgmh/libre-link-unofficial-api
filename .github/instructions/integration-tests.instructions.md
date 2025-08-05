---
applyTo: 'tests-int/**/*.{ts,test.ts}'
---

# Integration Testing Instructions

## Integration Test Strategy

- These tests make real API calls to validate the library works with Abbott's actual API
- Use environment variables for credentials, never hardcode them
- Tests should be idempotent and not depend on specific glucose values
- Include proper timeout handling (tests can take up to 60 seconds)

## Authentication Testing

- Test login flow with valid credentials
- Test error handling for invalid credentials
- Verify token refresh and session management
- Test different user account configurations

## Data Retrieval Testing

- Test fetching current glucose readings
- Test historical data retrieval
- Test connection and patient data fetching
- Validate data formats match expected schemas

## Snapshot Testing

- Use snapshots to verify API response structures remain consistent
- Update snapshots when API changes are detected and validated
- Focus on data structure validation, not specific glucose values

## CI/CD Considerations

- Integration tests should be skippable in CI if credentials aren't available
- Use proper environment variable handling for secure testing
- Include retry logic for network issues
- Clean up any test data created during test runs
