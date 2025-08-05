---
applyTo: 'sandbox/**/*.ts'
---

# Sandbox Development Instructions

## Purpose of Sandbox

- The sandbox is for manual testing and experimentation during development
- Use it to test new features before writing formal tests
- Debug API responses and data parsing logic
- Validate authentication flows manually

## Development Guidelines

- Always use environment variables for credentials in sandbox code
- Include console.log statements to show data flow and results
- Test edge cases and error scenarios manually
- Document any interesting findings or API behavior observations

## Safety Practices

- Never commit real credentials or sensitive data
- Use try-catch blocks to handle errors gracefully
- Include timeouts for long-running operations
- Clean up any persistent state after testing

## Typical Sandbox Patterns

- Initialize LibreLinkClient with environment credentials
- Test login and authentication flows
- Fetch and log sample data responses
- Experiment with new API endpoints or parameters
- Validate data transformation and parsing logic
