/** BibTeX citation record generated from local metadata — no upstream call. */

export interface BibtexInput {
  documentNumber: string;
  title: string;
  authors: string[];
  year: number;
  month: string;
  organization: string;
  series: string;
  url: string;
  abstract?: string | null;
  doi?: string | null;
}

export function renderBibtex(input: BibtexInput): string {
  const key = input.documentNumber.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fields: Array<[string, string]> = [
    ['title', `{${escapeBibtex(input.title)}}`],
    ['author', `{${input.authors.map(escapeBibtex).join(' and ')}}`],
    ['number', `{${escapeBibtex(input.documentNumber)}}`],
    ['institution', `{${escapeBibtex(input.organization)}}`],
    ['series', `{${escapeBibtex(input.series)}}`],
    ['year', `{${input.year}}`],
    ['month', `{${escapeBibtex(input.month)}}`],
    ['url', `{${escapeBibtex(input.url)}}`],
  ];
  if (input.doi) fields.push(['doi', `{${escapeBibtex(input.doi)}}`]);
  if (input.abstract) fields.push(['abstract', `{${escapeBibtex(collapse(input.abstract))}}`]);

  const body = fields.map(([k, v]) => `    ${k.padEnd(12)} = ${v},`).join('\n');
  return `@techreport{${key},\n${body.replace(/,$/, '')}\n}\n`;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeBibtex(text: string): string {
  return text.replace(/[{}\\]/g, (c) => `\\${c}`).replace(/&/g, '\\&').replace(/%/g, '\\%');
}
