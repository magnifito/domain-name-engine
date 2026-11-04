import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/name.js';
import { nameLabel, slugify } from '../../src/store/names.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('FridgePlan')).toBe('fridgeplan');
    expect(slugify('Zénith Café!')).toBe('zenith-cafe');
  });

  it('cuts long titles at a word boundary within 40 characters', () => {
    expect(
      slugify('A mobile app that plans weekly meals from what is already in the fridge.'),
    ).toBe('a-mobile-app-that-plans-weekly-meals');
  });

  it('falls back to "project"', () => {
    expect(slugify('!!!')).toBe('project');
  });
});

describe('nameLabel', () => {
  it('turns a display name into a domain label', () => {
    expect(nameLabel('Blue Fern')).toBe('bluefern');
    expect(nameLabel('Zénith')).toBe('zenith');
    expect(nameLabel("Mom's_Kitchen")).toBe('momskitchen');
    expect(nameLabel('get-acme')).toBe('get-acme');
  });

  it('rejects names that cannot be a label', () => {
    expect(() => nameLabel('a!b')).toThrow(ValidationError);
  });
});
