/**
 * The port through which spreadsheet bytes become a rectangle of strings.
 *
 * It exists because `core/` imports nothing outward and decoding `.xlsx` needs a
 * vendor library. What crosses the boundary is the same shape `parseCsv`
 * produces, so the header contract in `tabular.ts` treats a spreadsheet and a
 * CSV identically rather than growing a second set of rules.
 */
export type DecodedWorkbook =
  | { readonly ok: true; readonly rows: readonly (readonly string[])[] }
  | { readonly ok: false }

export interface WorkbookDecoder {
  decode(bytes: Uint8Array): DecodedWorkbook
}
