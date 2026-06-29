import type {
  Template,
  TemplateSummary,
  ScriptableTemplate,
} from "@openreel/core";

import { OPENREEL_CLOUD_URL } from "../config/api-endpoints";
import { staleWhileRevalidate, invalidateCache, CACHE_KEYS } from "./cache";
import type { CacheResult } from "./cache";

const CLOUD_API_URL = OPENREEL_CLOUD_URL;

export interface CloudTemplate extends TemplateSummary {
  author?: string;
}

export class TemplateCloudService {
  private apiUrl: string;

  constructor(apiUrl: string = CLOUD_API_URL) {
    this.apiUrl = apiUrl;
  }

  async listTemplates(): Promise<CloudTemplate[]> {
    try {
      const response = await fetch(`${this.apiUrl}/templates`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.templates || [];
    } catch (error) {
      console.error("Failed to list templates from cloud:", error);
      return [];
    }
  }

  /**
   * Cached version of listTemplates() with stale-while-revalidate.
   * Returns cached data immediately if available.
   */
  listTemplatesCached(): CacheResult<CloudTemplate[]> {
    return staleWhileRevalidate(
      CACHE_KEYS.CLOUD_TEMPLATES,
      () => this.listTemplates(),
      3_600_000, // 1 hour TTL
    );
  }

  async getTemplate(id: string): Promise<Template | null> {
    try {
      const response = await fetch(`${this.apiUrl}/templates/${id}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`Failed to get template ${id} from cloud:`, error);
      return null;
    }
  }

  /**
   * Cached version of getTemplate().
   * Individual template cache uses a per-id key and a longer TTL (24h).
   */
  getTemplateCached(id: string): CacheResult<Template | null> {
    return staleWhileRevalidate(
      CACHE_KEYS.CLOUD_TEMPLATE(id),
      () => this.getTemplate(id),
      86_400_000, // 24 hour TTL
    );
  }

  async uploadTemplate(
    template: Template,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(template),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || "Upload failed" };
      }

      // Invalidate the list cache so next fetch gets the new template
      invalidateCache(CACHE_KEYS.CLOUD_TEMPLATES);

      return { success: true };
    } catch (error) {
      console.error("Failed to upload template to cloud:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  async deleteTemplate(
    id: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/templates/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || "Delete failed" };
      }

      // Invalidate both list and per-template caches
      invalidateCache(CACHE_KEYS.CLOUD_TEMPLATES);
      invalidateCache(CACHE_KEYS.CLOUD_TEMPLATE(id));

      return { success: true };
    } catch (error) {
      console.error(`Failed to delete template ${id} from cloud:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listScriptableTemplates(): Promise<ScriptableTemplate[]> {
    try {
      const response = await fetch(`${this.apiUrl}/templates/scriptable`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.templates || [];
    } catch (error) {
      console.error("Failed to list scriptable templates from cloud:", error);
      return [];
    }
  }

  async getScriptableTemplate(id: string): Promise<ScriptableTemplate | null> {
    try {
      const response = await fetch(`${this.apiUrl}/templates/scriptable/${id}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error(
        `Failed to get scriptable template ${id} from cloud:`,
        error,
      );
      return null;
    }
  }
}

export const templateCloudService = new TemplateCloudService();
