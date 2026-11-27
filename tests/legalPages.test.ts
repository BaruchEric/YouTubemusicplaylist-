import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LegalLinks } from '../src/components/LegalLinks';
import {
  GOOGLE_PRIVACY_URL,
  LEGAL_SITE,
  PRIVACY_URL,
  TERMS_URL,
  YOUTUBE_TERMS_URL,
} from '../src/utils/legalLinks';

/** GitHub Pages serves the repo's docs/ folder at LEGAL_SITE. */
function publishedFile(url: string): URL {
  expect(url.startsWith(`${LEGAL_SITE}/`)).toBe(true);
  return new URL(`../docs/${url.slice(LEGAL_SITE.length + 1)}`, import.meta.url);
}

const privacy = readFileSync(publishedFile(PRIVACY_URL), 'utf8');
const terms = readFileSync(publishedFile(TERMS_URL), 'utf8');

describe('the public pages', () => {
  test('the app links to pages that exist in docs/', () => {
    expect(existsSync(publishedFile(PRIVACY_URL))).toBe(true);
    expect(existsSync(publishedFile(TERMS_URL))).toBe(true);
    expect(existsSync(new URL('../docs/.nojekyll', import.meta.url))).toBe(true);
  });

  // The four statements YouTube's API developer policy asks a privacy policy to carry.
  test('the privacy policy says CrateSync uses YouTube API Services', () => {
    expect(privacy).toContain('YouTube API Services');
  });

  test('the privacy policy links to the Google Privacy Policy', () => {
    expect(privacy).toContain(`href="${GOOGLE_PRIVACY_URL}"`);
  });

  test('the privacy policy says how to revoke access at Google', () => {
    expect(privacy).toContain('href="https://security.google.com/settings/security/permissions"');
  });

  test('the privacy policy gives a way to reach the developer', () => {
    expect(privacy).toContain('href="mailto:cratesync@beric.ca"');
  });

  test('the privacy policy says what a search sends to YouTube and what is kept', () => {
    expect(privacy).toContain("sends the song's artist and title to");
    expect(privacy).toContain('It does not save the titles or the channel names.');
  });

  test('the privacy policy says a saved video ID is checked again after 30 days', () => {
    expect(privacy).toContain('A saved video ID is checked again after 30 days.');
  });

  test('the terms bind the user to the YouTube Terms of Service', () => {
    expect(terms).toContain('YouTube API Services');
    expect(terms).toContain(`href="${YOUTUBE_TERMS_URL}"`);
    expect(terms).toContain('agree to be bound by the');
  });

  test('each page links to the other', () => {
    expect(privacy).toContain('href="terms.html"');
    expect(terms).toContain('href="privacy.html"');
  });
});

describe('the links in the sidebar', () => {
  test('open the privacy policy and the terms in a new tab', () => {
    const html = renderToString(createElement(LegalLinks));

    expect(html).toContain(`href="${PRIVACY_URL}"`);
    expect(html).toContain(`href="${TERMS_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
