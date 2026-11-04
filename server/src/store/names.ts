import { normalizeLabel } from '../domain/name.js';
import { isReservedDeviceName } from './fs-utils.js';

const SLUG_MAX = 40;

function stripMarks(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** Folder-safe slug from a title: ASCII, lowercase, hyphens, cut at a word boundary. */
export function slugify(title: string): string {
  let slug = stripMarks(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) {
    const cut = slug.slice(0, SLUG_MAX + 1).lastIndexOf('-');
    slug = slug.slice(0, cut > 0 ? cut : SLUG_MAX).replace(/-+$/, '');
  }
  if (!slug) return 'project';
  return isReservedDeviceName(slug) ? `${slug}-project` : slug;
}

/** Domain label for a display name: "Blue Fern" -> "bluefern". Throws ValidationError. */
export function nameLabel(name: string): string {
  return normalizeLabel(stripMarks(name).replace(/[\s_'’]+/g, ''));
}
