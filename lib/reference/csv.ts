export function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let parts: string[] = [];
  let start = 0;
  let quoted = false;
  const field = (end: number) => {
    if (!parts.length) return text.slice(start, end);
    parts.push(text.slice(start, end));
    const value = parts.join(""); parts = []; return value;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          parts.push(text.slice(start, i), '"');
          i += 1;
          start = i + 1;
        } else { parts.push(text.slice(start, i)); start = i + 1; quoted = false; }
      }
      continue;
    }
    if (c === '"') { parts.push(text.slice(start, i)); start = i + 1; quoted = true; }
    else if (c === ",") {
      row.push(field(i)); start = i + 1;
    } else if (c === "\n") {
      row.push(field(i)); start = i + 1;
      yield row; row = [];
    } else if (c === "\r") { parts.push(text.slice(start, i)); start = i + 1; }
  }
  const last = field(text.length);
  if (last !== "" || row.length > 0) {
    row.push(last); yield row;
  }
}

export function parseCsv(text: string): string[][] { return [...csvRows(text)]; }

