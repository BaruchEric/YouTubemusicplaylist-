/**
 * Keys for telling whether two listings name the same file.
 *
 * A folder on a Mac can hand back "é" as "e" plus a combining accent. The folder Google Drive
 * for desktop keeps does, and the Drive listing sends one character for the same file.
 * A name is folded to one spelling and to lower case before two listings are compared.
 */
export function foldFileName(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** The same for two files with the same name and byte size, however the name is spelled. */
export function nameSizeKey(name: string, size: number): string {
  return `${foldFileName(name)}::${size}`;
}
