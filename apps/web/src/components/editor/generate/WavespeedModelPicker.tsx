/**
 * WavespeedModelPicker — rich card-based model browser.
 *
 * Shows type filter tabs, cost, description, capability tags, and input schema
 * summary per model. Relevant types for shot/image generation are surfaced first.
 */

import React, { useState, useMemo } from "react";
import { Input, ScrollArea } from "@openreel/ui";
import { Search, Zap, Clock, Image, Video, Cpu } from "lucide-react";
import type { WavespeedModel } from "../../../services/wavespeed/index";

// Types relevant to asset generation, in priority order
const PRIORITY_TYPES = [
  "image-to-image",
  "text-to-image",
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "upscaler",
];

const TYPE_LABELS: Record<string, string> = {
  "image-to-image": "Image → Image",
  "text-to-image": "Text → Image",
  "image-to-video": "Image → Video",
  "text-to-video": "Text → Video",
  "video-to-video": "Video → Video",
  "upscaler": "Upscaler",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  "image-to-image": Image,
  "text-to-image": Image,
  "image-to-video": Video,
  "text-to-video": Video,
  "video-to-video": Video,
  "upscaler": Zap,
};

function typeColor(type: string): string {
  if (type.includes("video")) return "text-purple-400 bg-purple-500/10 border-purple-500/20";
  if (type.includes("image")) return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  if (type === "upscaler") return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
  return "text-text-muted bg-background-tertiary border-border";
}

/** Extract human-readable capability tags from the model schema */
function capabilityTags(model: WavespeedModel): string[] {
  const schema = model.api_schema?.api_schemas?.[0]?.request_schema;
  if (!schema?.properties) return [];
  const props = schema.properties;
  const tags: string[] = [];
  if (props.prompt) tags.push("Prompt");
  if (props.negative_prompt) tags.push("Neg. prompt");
  if (props.seed) tags.push("Seed");
  if (props.aspect_ratio || props.size) tags.push("Aspect ratio");
  if (props.duration) tags.push("Duration");
  if (props.enable_sync_mode) tags.push("Sync mode");
  const resolution = props.resolution ?? props.size;
  if (resolution?.enum?.some((v: string) => v.includes("4K") || v.includes("4k") || parseInt(v) >= 2160)) tags.push("4K");
  return tags;
}

/** Format cost as a human-readable string */
function formatCost(model: WavespeedModel): string {
  if (!model.base_price) return "Free";
  return `$${model.base_price.toFixed(4)}/run`;
}

interface Props {
  models: WavespeedModel[];
  onSelect: (model: WavespeedModel) => void;
}

export function WavespeedModelPicker({ models, onSelect }: Props) {
  const [activeType, setActiveType] = useState<string>("image-to-image");
  const [query, setQuery] = useState("");

  // Only show types we care about for asset generation
  const availableTypes = useMemo(
    () => PRIORITY_TYPES.filter((t) => models.some((m) => m.type === t)),
    [models],
  );

  const filtered = useMemo(() => {
    let list = models.filter((m) => m.type === activeType);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (m) =>
          m.model_id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0));
  }, [models, activeType, query]);

  const Icon = TYPE_ICONS[activeType] ?? Cpu;

  return (
    <div className="flex flex-col gap-3">
      {/* Type filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {availableTypes.map((type) => {
          const TabIcon = TYPE_ICONS[type] ?? Cpu;
          return (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                activeType === type
                  ? typeColor(type)
                  : "text-text-muted bg-transparent border-border hover:border-border-hover"
              }`}
            >
              <TabIcon size={10} />
              {TYPE_LABELS[type] ?? type}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          className="pl-7 h-7 text-xs"
        />
      </div>

      {/* Model cards */}
      <ScrollArea className="h-[360px]">
        <div className="space-y-2 pr-1">
          {filtered.length === 0 && (
            <p className="text-xs text-text-muted text-center py-8">No models found</p>
          )}
          {filtered.map((model) => {
            const tags = capabilityTags(model);
            const color = typeColor(model.type);
            return (
              <button
                key={model.model_id}
                onClick={() => onSelect(model)}
                className="w-full text-left rounded-lg border border-border bg-background-secondary hover:border-primary/40 hover:bg-background-elevated transition-colors p-3 group"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`p-1 rounded border ${color} flex-shrink-0`}>
                      <Icon size={12} />
                    </div>
                    <span className="text-xs font-medium text-text-primary truncate group-hover:text-primary transition-colors">
                      {model.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-text-muted flex-shrink-0">
                    <Clock size={9} />
                    <span className="font-medium text-text-secondary">{formatCost(model)}</span>
                  </div>
                </div>

                {/* Description */}
                {model.description && (
                  <p className="text-[10px] text-text-muted leading-snug line-clamp-2 mb-2">
                    {model.description}
                  </p>
                )}

                {/* Capability tags */}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-background-tertiary text-text-muted border border-border"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
