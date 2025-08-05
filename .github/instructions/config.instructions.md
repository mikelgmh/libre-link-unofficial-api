---
applyTo: '*.{json,md,js,ts}'
---

# Project Configuration Instructions

## Package.json and Dependencies

- Keep dependencies minimal - this is a library, not an application
- Use peer dependencies for large packages that users likely already have
- Prefer Bun-compatible packages when possible
- Keep devDependencies up to date but stable

## Documentation Standards

- Update README.md when adding new public methods or changing APIs
- Include code examples for all public methods
- Document breaking changes clearly in version updates
- Maintain clear installation and usage instructions

## Build Configuration

- Target modern Node.js versions (ESNext) for optimal performance
- Generate both CommonJS and ESM builds for compatibility
- Include TypeScript declarations for all public APIs
- Optimize bundle size for npm package distribution

## Version Management

- Follow semantic versioning (major.minor.patch)
- Use alpha/beta versions during development
- Document breaking changes in major version updates
- Tag releases with descriptive commit messages
