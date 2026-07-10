function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]{1,10}$/, "");
}

function capitalizeFirstLetter(s: string): string {
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    if (/\p{L}/u.test(chars[i])) {
      chars[i] = chars[i].toLocaleUpperCase();
      return chars.join("");
    }
  }
  return chars.join("");
}

function capitalizePosition0(s: string): string {
  const chars = Array.from(s);
  if (chars.length === 0) return s;
  chars[0] = chars[0].toLocaleUpperCase();
  return chars.join("");
}

export function filenameToTitle(filename: string): string {
  const withoutExt = stripExtension(filename);
  const hadSeparators = /[_-]/.test(withoutExt);

  let spaced = withoutExt.replace(/[_-]+/g, " ");
  spaced = spaced.replace(/\s+/g, " ").trim();

  if (spaced.length === 0) return "Untitled";

  if (hadSeparators) {
    // Case was collapsed to lowercase above, so title-casing must scan
    // forward to the first cased letter (digits/punctuation can't carry case).
    spaced = spaced.toLocaleLowerCase();
    return capitalizeFirstLetter(spaced);
  }

  // No separators: original casing (e.g. camelCase, acronyms) is preserved.
  // Only force the literal first character, don't hunt forward past it.
  return capitalizePosition0(spaced);
}
