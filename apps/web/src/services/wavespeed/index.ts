/** Shared WaveSpeed presentation types. Runtime traffic uses generation-job-store. */

export interface WavespeedModel {
  model_id: string;
  name: string;
  type: string;
  description: string;
  base_price: number;
  formula: string;
  sort_order: number;
  api_schema: {
    api_schemas: Array<{
      type: string;
      method: string;
      server: string;
      api_path: string;
      request_schema: {
        properties: Record<string, SchemaProperty>;
        required?: string[];
        type: string;
        "x-order-properties"?: string[];
      };
    }>;
  };
}

export interface SchemaProperty {
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  minItems?: number;
  maxItems?: number;
  multipleOf?: number;
  "x-ui-component"?: string;
  "x-ui-component-props"?: Record<string, unknown>;
  "x-rows"?: number;
  "x-accept"?: string;
  "x-order-properties"?: string[];
}
