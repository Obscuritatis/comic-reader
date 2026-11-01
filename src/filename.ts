export interface ParsedName {
  title: string;
  series: string;
  issue?: number;
  year?: number;
}

/**
 * Haalt serie, nummer en jaar uit een bestandsnaam zoals
 * "Amazing Spider-Man 001 (1963) (Digital).cbz" of "X-Men_v2_#012.cbr".
 */
export function parseComicFileName(fileName: string): ParsedName {
  let name = fileName.replace(/\.(cbz|cbr|zip|rar)$/i, '');
  const yearMatch = name.match(/\((\d{4})\)/) ?? name.match(/\b(19[3-9]\d|20[0-4]\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  // haakjes en vierkante haken (jaar, scanner-tags, "Digital") weg
  name = name.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
  name = name.replace(/_+|\.(?!\d)|(?<!\d)\./g, ' ').replace(/\s+/g, ' ').trim();
  const title = name;

  // "of 4" van mini-series weg, dan laatste nummer = issue
  const cleaned = name.replace(/\s*\(?of \d+\)?\s*$/i, '');
  const issueMatch = cleaned.match(/^(.*?)(?:\s+|#|\s-\s)#?(\d{1,4}(?:\.\d+)?)$/);
  if (issueMatch && issueMatch[1].trim()) {
    const series = issueMatch[1].replace(/[\s\-–#]+$/, '').trim();
    return { title, series, issue: Number(issueMatch[2]), year };
  }
  return { title, series: cleaned, year };
}
