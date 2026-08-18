# dsh-web-search-pool v0.1.0-rc.7

Release Date: 2026-08-18
Compatible with: DeepSeek Harness 0.1.0-rc.7+

## Highlights

- Official cordis.patch.yml Bundle integration
- Standard installation via dsh plugin --profile web add
- No manual DSH source patching required
- Complete test suite (104/104 passing)
- Validated pack integrity (npm pack --dry-run)

## Changes

### Added
- Anonymous Exa free tier support (no API key needed)
- Manual usage refresh button in settings UI
- Provider priority and timeout configuration
- Native Bundle contract (dsh.bundle.patch)
- Keyed slot registration for rc.7 (key: web-search-pool)
- Upgrade and rollback guides

### Changed
- All credentials via DS H service only
- peerDependencies pinned to ^0.1.0-rc.7
- Installation via dsh plugin command only
- README with complete documentation

### Fixed
- Settings card not rendering (rc.7 keyed slot issue)
- Usage refresh visibility and feedback
- Token bucket limiter edge cases
- Two regression tests in scripts.test.js

### Removed
- WEB_SETTINGS_NAMESPACES patch dependency
- Legacy patch script from install path
- Wildcard peerDependencies

## Installation

npm pack
dsh plugin --profile web add ./dsh-web-search-pool-0.1.0-rc.7.tgz

## Notes

Breaking changes require upgrading slot registration.
See docs/upgrade-guide for migration steps.
