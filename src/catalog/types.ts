import type { AreaName } from "../areas/areas.ts";

export type ResponseKind = "json" | "csv" | "gzip-tsv" | "apple-json";

export type ParamSpec = {
  name: string;
  type: "string" | "integer" | "boolean" | "array";
  values?: string[];
  fieldSet?: string;
  max?: number;
  required?: true;
};

export type CatalogEntry = {
  path: string;
  area: AreaName;
  response: ResponseKind;
  accept?: string;
  deprecated?: true;
  params: ParamSpec[];
};

export type Catalog = {
  specVersion: string;
  fieldSets: Record<string, string[]>;
  entries: CatalogEntry[];
};
