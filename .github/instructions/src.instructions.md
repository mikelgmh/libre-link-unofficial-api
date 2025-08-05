---
applyTo: 'src/**/*.ts'
---

# Source Code Instructions

## TypeScript Standards for Library Code

- Use strict TypeScript with all strict flags enabled
- Export all public APIs through `src/index.ts`
- Prefer interfaces over type aliases for object shapes
- Use proper JSDoc comments for all public methods and classes
- Handle errors gracefully with try-catch blocks and meaningful error messages

## Class Design

- The `LibreLinkClient` is the main entry point - all methods should be instance methods
- Use private methods for internal API calls
- Implement proper error handling for network requests
- Cache authentication tokens but not glucose data
- Validate constructor parameters and provide sensible defaults

## API Integration

- All HTTP requests should include proper headers and authentication
- Implement retry logic for transient failures
- Respect API rate limits
- Parse and validate API responses before returning to users
- Handle different API versions gracefully

## Data Models

- Create strong TypeScript types for all API responses
- Validate data shapes when parsing API responses
- Use readonly properties where appropriate
- Implement proper data transformation between raw API and public interfaces

## Error Handling

- Create custom error types for different failure scenarios
- Provide helpful error messages that guide users to solutions
- Don't expose internal API details in public error messages
- Log detailed error information for debugging
