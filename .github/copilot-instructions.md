# Project Overview

This project is an unofficial Node.js API for Libre Link Up, designed to interact with CGM (Continuous Glucose Monitoring) data from Freestyle Libre 2/3 devices stored in Abbott's database. The library was reverse engineered for educational purposes and is currently in alpha stage.

## Purpose and Goals

- Provide a TypeScript/JavaScript interface for accessing Libre Link Up data
- Enable developers to build applications that consume glucose monitoring data
- Maintain compatibility with Libre Link Up authentication and API endpoints
- Offer both real-time streaming and historical data access

## Folder Structure

- `/src`: Contains the main source code for the library
  - `client.ts`: Main LibreLinkClient class with API methods
  - `config.ts`: Configuration and environment variable handling
  - `constants.ts`: API endpoints and constant values
  - `reading.ts`: GlucoseReading class and data parsing logic
  - `types.ts`: TypeScript type definitions
  - `utils.ts`: Utility functions
- `/tests`: Unit tests using Bun's test runner
- `/tests-int`: Integration tests with real API calls
- `/sandbox`: Development playground for testing functionality
- `/dist`: Built output (JavaScript and TypeScript declarations)

## Tech Stack and Dependencies

- **Runtime**: Bun (preferred) and Node.js
- **Language**: TypeScript with ESNext target
- **Testing**: Bun test runner with coverage
- **Build**: Bun build system for bundling and minification
- **Package Manager**: Bun (primary), npm compatible

## Coding Standards and Conventions

- Use TypeScript with strict mode enabled
- Follow ESNext module syntax (import/export)
- Use arrow functions for callbacks and short functions
- Prefer async/await over Promise chains
- Use descriptive variable and function names
- Class names should be PascalCase (e.g., `LibreLinkClient`, `GlucoseReading`)
- File names should be kebab-case or camelCase
- Export main classes and types from `src/index.ts`
- Use single quotes for strings
- End statements with semicolons

## API Design Patterns

- Main entry point is the `LibreLinkClient` class
- All async operations return Promises
- Support both environment variables and constructor options for configuration
- Implement caching for non-critical data (not glucose readings)
- Provide both raw and parsed data access methods
- Use streaming for real-time data when possible

## Testing Guidelines

- Write unit tests for all public methods
- Use integration tests for API calls (with proper mocking in CI)
- Test both success and error scenarios
- Use snapshots for complex response data validation
- Mock external API calls in unit tests

## Security Considerations

- Never commit real credentials to version control
- Use environment variables for sensitive configuration
- Validate input parameters to prevent injection attacks
- Handle authentication errors gracefully
- Respect rate limits from Abbott's API

## Build and Development

- Use `bun run dev` for development with hot reload
- Use `bun run test` for running all tests
- Use `bun run build` to create production build
- Use `bun run sandbox` for manual testing and experimentation

## Common Patterns

- Always call `client.login()` before making API requests
- Use the `read()` method for parsed glucose readings
- Use `fetchReading()` for raw API responses
- Handle network errors and authentication failures
- Cache user data but not glucose readings (for freshness)
