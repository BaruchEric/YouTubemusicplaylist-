/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { foldFileName, nameSizeKey } from '../src/utils/fileNameKey';

// macOS hands back "é" as "e" plus a combining accent. Google Drive sends one character.
const ONE_CHARACTER = "01 L'Eté Indien.mp3";
const TWO_CHARACTERS = "01 L'Eté Indien.mp3";

describe('foldFileName', () => {
  test('gives both spellings of an accented name the same form', () => {
    expect(ONE_CHARACTER).not.toBe(TWO_CHARACTERS);
    expect(foldFileName(TWO_CHARACTERS)).toBe(foldFileName(ONE_CHARACTER));
  });

  test('ignores letter case', () => {
    expect(foldFileName('Song.MP3')).toBe(foldFileName('song.mp3'));
  });
});

describe('nameSizeKey', () => {
  test('is the same for both spellings of a name with the same size', () => {
    expect(nameSizeKey(TWO_CHARACTERS, 4_413_440)).toBe(nameSizeKey(ONE_CHARACTER, 4_413_440));
  });

  test('differs when the size differs', () => {
    expect(nameSizeKey(ONE_CHARACTER, 1)).not.toBe(nameSizeKey(ONE_CHARACTER, 2));
  });
});
