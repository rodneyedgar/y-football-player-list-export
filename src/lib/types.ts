export type ExportRow = Record<string, string>;

export interface ExtractedData {
  headers: string[];
  rows: ExportRow[];
}

export interface PositionProfile {
  gridColumns: string[];
  exportHeaders: string[];
  isDefense: boolean;
}
