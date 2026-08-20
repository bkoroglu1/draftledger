import type { CanonicalFormat } from '#src/domain/types.ts';
import { parseMarkdown } from './markdown.ts';
import { parseRfcXml } from './rfcxml.ts';
import type { Diagnostic, ParsedDocument } from './model.ts';
import { flattenSections } from './model.ts';

export * from './model.ts';
export { parseMarkdown } from './markdown.ts';
export { parseRfcXml } from './rfcxml.ts';
export * from './anchors.ts';

export function parseSource(source: string, format: CanonicalFormat): ParsedDocument {
  return format === 'rfcxml' ? parseRfcXml(source) : parseMarkdown(source);
}

/** Template/namespace policy check: required sections must exist by title. */
export function requiredSectionDiagnostics(doc: ParsedDocument, required: string[]): Diagnostic[] {
  if (!required.length) return [];
  const titles = new Set(flattenSections(doc.sections).map((s) => s.title.trim().toLowerCase()));
  if (doc.abstract.length) titles.add('abstract');
  return required
    .filter((r) => !titles.has(r.trim().toLowerCase()))
    .map<Diagnostic>((r) => ({
      severity: 'error',
      code: 'missing-required-section',
      message: `Required section "${r}" is missing.`,
      hint: `Add a top-level heading named "${r}".`,
    }));
}

export function hasBlockingDiagnostics(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  return {
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    infos: diagnostics.filter((d) => d.severity === 'info').length,
  };
}
