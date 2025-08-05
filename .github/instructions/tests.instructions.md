---
applyTo: 'tests/**/*.{ts,spec.ts}'
---

# Testing Instructions

## Unit Testing Standards

- Use Bun's built-in test runner and assertion library
- Mock all external API calls using the patterns in `tests/mocks.ts`
- Test both success and failure scenarios
- Use descriptive test names that explain what is being tested
- Group related tests using `describe` blocks

## Test Structure

- Follow the Arrange-Act-Assert pattern
- Set up test data in the arrange phase
- Make the function call in the act phase
- Verify results in the assert phase
- Clean up any side effects after tests

## Mock Strategy

- Create reusable mocks in `tests/mocks.ts`
- Mock the entire HTTP layer, not individual methods
- Use realistic response data that matches actual API responses
- Test edge cases like network timeouts and API errors

## Coverage Expectations

- Aim for high test coverage on all public APIs
- Test error conditions and edge cases
- Don't test implementation details, focus on public interfaces
- Use snapshot testing for complex response data validation

## Test Data

- Use realistic but anonymized data for glucose readings
- Create multiple scenarios (normal readings, alerts, historical data)
- Test with different user configurations and patient IDs
- Validate data parsing and transformation logic thoroughly
