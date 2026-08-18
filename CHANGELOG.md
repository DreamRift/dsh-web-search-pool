# Changelog

All notable changes to this project.

## [0.3.0] - 2026-08-18

### Changed (Breaking)
- RC7 native Bundle integration with cordis.patch.yml
- Keyed slot registration (key: instead of id:)
- Peer dependencies pinned to ^0.1.0-rc.7

### Added
- Native Bundle support for rc.7
- Anonymous Exa free tier support
- Complete contract tests (bundle, client, install)
- Upgrade and rollback guides

### Fixed
- Settings card visibility (keyed slot)
- Usage refresh feedback loop
- Token bucket limiter edge cases

### Removed
- WEB_SETTINGS_NAMESPACES patching dependency
- Wildcard peerDependencies

## [0.2.x] - 2026-08
Legacy rc.6 integration methods.