import { describe, expect, it } from 'vitest';
import { mergeSectionBodies, upsertUnreleased } from './build-changelog.mjs';

const HEADER = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
].join('\n');

const VERSIONED = '## [0.6.0] - 2026-07-08\n\n_Maintenance release._\n';

describe('upsertUnreleased', () => {
  it('preserves existing entries when appending a new window', () => {
    const existing = `${HEADER}### Added\n- entry A (\`aaaaaaa\`)\n\n${VERSIONED}`;
    const incoming = '### Fixed\n- entry B (\`bbbbbbb\`)\n';
    const next = upsertUnreleased(existing, incoming);

    expect(next).toContain('- entry A (`aaaaaaa`)');
    expect(next).toContain('- entry B (`bbbbbbb`)');
    expect(next.indexOf('- entry A')).toBeLessThan(next.indexOf('- entry B'));
    expect(next).toContain(VERSIONED.trim());
  });

  it('merges into the same section without duplicating identical lines', () => {
    const existing = `${HEADER}### Added\n- entry A (\`aaaaaaa\`)\n\n${VERSIONED}`;
    const incoming = '### Added\n- entry A (`aaaaaaa`)\n- entry B (`bbbbbbb`)\n';
    const next = upsertUnreleased(existing, incoming);

    expect(next.match(/entry A/g)).toHaveLength(1);
    expect(next).toContain('- entry B (`bbbbbbb`)');
  });

  it('fills an empty Unreleased section', () => {
    const existing = `${HEADER}${VERSIONED}`;
    const incoming = '### Added\n- entry A (`aaaaaaa`)\n';
    const next = upsertUnreleased(existing, incoming);

    expect(next).toContain('## [Unreleased]');
    expect(next).toContain('- entry A (`aaaaaaa`)');
    expect(next).toContain(VERSIONED.trim());
  });

  it('creates an Unreleased section when missing', () => {
    const existing = `# Changelog\n\n${VERSIONED}`;
    const incoming = '### Fixed\n- entry B (`bbbbbbb`)\n';
    const next = upsertUnreleased(existing, incoming);

    expect(next).toContain('## [Unreleased]');
    expect(next).toContain('- entry B (`bbbbbbb`)');
    expect(next.indexOf('## [0.6.0]')).toBeLessThan(next.indexOf('## [Unreleased]'));
  });
});

describe('mergeSectionBodies', () => {
  it('keeps existing order and appends new sections in preferred order', () => {
    const existingBody = '### Fixed\n- old fix (`1111111`)\n';
    const newBody = '### Added\n- new feature (`2222222`)\n';
    const merged = mergeSectionBodies(existingBody, newBody);

    expect(merged.indexOf('### Added')).toBeLessThan(merged.indexOf('### Fixed'));
    expect(merged).toContain('- new feature (`2222222`)');
    expect(merged).toContain('- old fix (`1111111`)');
  });
});
