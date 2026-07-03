/**
 * GenerateAssetDialog — unified model list for all providers.
 *
 * No provider tabs. Every model appears in one searchable list.
 * Each model shows its provider, type (text-to-image, image-to-image, etc.),
 * and whether it requires a primary source image.
 *
 * Reference images can be picked from media library or uploaded inline.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "@openreel/ui";
import { ChevronLeft, Search } from "lucide-react";
import type { GeneratedAsset, StoryboardShot, ValidationState } from "@openreel/music-video-domain";

// ── KieAI models ────────────────────────────────────────────────────────────
import type { ImageModelInput } from "../../../services/kieai/image-generation";
import { IMAGE_MODELS, type ImageModelId, createImageTask } from "../../../services/kieai/image-generation";
import { SeedreamForm } from "../kieai/forms/SeedreamForm";
import { ZImageForm } from "../kieai/forms/ZImageForm";
import { NanoBanana2Form } from "../kieai/forms/NanoBanana2Form";
import { Flux2Form } from "../kieai/forms/Flux2Form";
import { GrokForm } from "../kieai/forms/GrokForm";
import { QwenForm } from "../kieai/forms/QwenForm";

// ── WaveSpeed ────────────────────────────────────────────────────────────────
import type { WavespeedModel } from "../../../services/wavespeed/index";
import { fetchModelsCached, submitGeneration } from "../../../services/wavespeed/index";
import { SchemaForm } from "./SchemaForm";

import { uploadFileStream } from "../../../services/kieai/file-upload";

// ── Reference images ─────────────────────────────────────────────────────────
import { ReferenceImagePicker } from "./ReferenceImagePicker";
import { injectImageInputs, getRefImageUrls } from "./schema-injector";

// ── Store ────────────────────────────────────────────────────────────────────
import { useProjectStore } from "../../../stores/project-store";
import { useGenerationJobStore } from "../../../stores/generation-job-store";

// ── Unified model type ───────────────────────────────────────────────────────

type ModelProvider = "kieai" | "wavespeed";

type GenType = "text-to-image" | "image-to-image" | "text-to-video" | "image-to-video";

interface UnifiedModel {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  genType: GenType;
  requiresSourceImage: boolean;
  /** KieAI model constant, for routing to per-model KieAI forms */
  kieaiModel?: ImageModelId;
  /** WaveSpeed model object, for dynamic SchemaForm */
  wsModel?: WavespeedModel;
}

// ── Build KieAI unified models ───────────────────────────────────────────────

const KIEAI_MODEL_META: Array<{
  id: ImageModelId;
  name: string;
  description: string;
  genType: GenType;
  requiresSourceImage: boolean;
}> = [
  { id: IMAGE_MODELS.SEEDREAM, name: "Seedream 5 Lite", description: "High-quality image-to-image. 4K output.", genType: "image-to-image", requiresSourceImage: true },
  { id: IMAGE_MODELS.Z_IMAGE, name: "Z-Image", description: "Text-to-image. Source image used as inspiration.", genType: "text-to-image", requiresSourceImage: false },
  { id: IMAGE_MODELS.NANO_BANANA2, name: "Nano Banana 2", description: "Versatile generation, optional reference.", genType: "image-to-image", requiresSourceImage: false },
  { id: IMAGE_MODELS.FLUX2, name: "Flux 2 Pro", description: "Professional image-to-image, 2K.", genType: "image-to-image", requiresSourceImage: true },
  { id: IMAGE_MODELS.GROK, name: "Grok Imagine", description: "Style/composition transfer.", genType: "image-to-image", requiresSourceImage: true },
  { id: IMAGE_MODELS.QWEN, name: "Qwen", description: "Fine-grained image transformation control.", genType: "image-to-image", requiresSourceImage: true },
];

// ── KieAI input defaults ─────────────────────────────────────────────────────

interface KieAIDefaults {
  seedream: import("../../../services/kieai/image-generation").SeedreamInput;
  zimage: import("../../../services/kieai/image-generation").ZImageInput;
  nanoBanana2: import("../../../services/kieai/image-generation").NanoBanana2Input;
  flux2: import("../../../services/kieai/image-generation").Flux2Input;
  grok: import("../../../services/kieai/image-generation").GrokInput;
  qwen: import("../../../services/kieai/image-generation").QwenInput;
}

function makeKieAIDefaults(asset?: GeneratedAsset, shot?: StoryboardShot): KieAIDefaults {
  const prompt = asset?.prompt ?? shot?.videoPrompt ?? shot?.prompt ?? "";
  const negPrompt = asset?.negativePrompt ?? shot?.negativePrompt ?? "";
  const asp = (shot?.aspectRatio ?? "16:9") as "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
  return {
    seedream: { prompt, image_urls: [], aspect_ratio: asp, quality: "basic" },
    zimage: { prompt, aspect_ratio: "16:9" },
    nanoBanana2: { prompt, aspect_ratio: asp, resolution: "2K", output_format: "png" },
    flux2: { prompt, input_urls: [], aspect_ratio: asp, resolution: "1K" },
    grok: { image_urls: [], ...(prompt ? { prompt } : {}) },
    qwen: { prompt, image_url: "", strength: 0.8, output_format: "png", acceleration: "regular", ...(negPrompt ? { negative_prompt: negPrompt } : {}), ...(shot?.seed != null ? { seed: shot.seed } : {}) },
  };
}

function makeWsDefaults(model: WavespeedModel, asset?: GeneratedAsset, shot?: StoryboardShot): Record<string, unknown> {
  const schema = model.api_schema?.api_schemas?.[0]?.request_schema;
  if (!schema?.properties) return {};
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop && typeof prop === "object" && "default" in prop) defaults[key] = prop.default;
  }
  if ("prompt" in schema.properties) defaults.prompt = asset?.prompt ?? shot?.videoPrompt ?? shot?.prompt ?? defaults.prompt ?? "";
  if ("negative_prompt" in schema.properties) defaults.negative_prompt = asset?.negativePrompt ?? shot?.negativePrompt ?? defaults.negative_prompt ?? "";
  if ("seed" in schema.properties && shot?.seed != null) defaults.seed = shot.seed;
  const arKey = "aspect_ratio" in schema.properties ? "aspect_ratio" : "size" in schema.properties ? "size" : null;
  if (arKey && shot?.aspectRatio) defaults[arKey] = shot.aspectRatio;
  return defaults;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface GenerateAssetDialogProps {
  open: boolean;
  onClose: () => void;
  sourceFile?: File;
  previewUrl?: string | null;
  asset?: GeneratedAsset;
  shot?: StoryboardShot;
  /** Clip ID passed from ReferenceImages "Generate" button — used to seed prompt from clip metadata */
  clipId?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Step = "pick" | "form" | "submitting" | "error";

export function GenerateAssetDialog({ open, onClose, sourceFile, previewUrl, asset, shot, clipId }: GenerateAssetDialogProps) {
  const [step, setStep] = useState<Step>("pick");
  const [search, setSearch] = useState("");
  const [model, setModel] = useState<UnifiedModel | null>(null);
  const [errorMsg, setError] = useState("");
  const [wsModels, setWsModels] = useState<WavespeedModel[]>([]);
  const [wsModelsLoading, setWsModelsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const { project, addPlaceholderMedia } = useProjectStore();
  const enqueueJob = useGenerationJobStore((s) => s.enqueue);

  // If opened from a clip's ReferenceImages "Generate" button, pull the prompt
  // from that clip's metadata payload so the dialog pre-fills correctly.
  const effectiveShot: StoryboardShot | undefined = useMemo(() => {
    if (!clipId) return shot;
    const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) return shot;
    const payload = clip.metadata && typeof clip.metadata.payload === "object" && clip.metadata.payload !== null
      ? (clip.metadata.payload as Record<string, unknown>)
      : (clip.metadata as Record<string, unknown>) ?? {};
    const prompt = typeof payload.prompt === "string" ? payload.prompt
      : typeof payload.text === "string" ? payload.text
      : typeof payload.videoPrompt === "string" ? payload.videoPrompt
      : shot?.prompt ?? "";
    if (!prompt && !shot) return undefined;
    if (shot) return { ...shot, prompt };
    const validation: ValidationState = { valid: true, warnings: [], errors: [] };
    return {
      id: clipId, index: 0, label: "", startSeconds: 0, endSeconds: 0,
      prompt, model: "", resolution: "", aspectRatio: "16:9",
      includeMainAudio: false, referenceAssetIds: [], generatedAssetIds: [],
      validation, outputs: [], selected: false,
    };
  }, [clipId, project.timeline.tracks, shot]);

  // ── KieAI input state ────────────────────────────────────────────────────
  const defaults = makeKieAIDefaults(asset, effectiveShot);
  const [seedream, setSeedream] = useState(defaults.seedream);
  const [zimage, setZimage] = useState(defaults.zimage);
  const [nanoBanana2, setNanoBanana2] = useState(defaults.nanoBanana2);
  const [flux2, setFlux2] = useState(defaults.flux2);
  const [grok, setGrok] = useState(defaults.grok);
  const [qwen, setQwen] = useState(defaults.qwen);

  // ── WaveSpeed input state ─────────────────────────────────────────────────
  const [wsInputs, setWsInputs] = useState<Record<string, unknown>>({});

// ── Reference images ──────────────────────────────────────────────────────
  const [refIds, setRefIds] = useState<string[]>([]);
  const [generateRefOpen, setGenerateRefOpen] = useState(false);

  const wsFetchRef = useRef(false);

  // Fetch WaveSpeed models with cache-first + background refresh
  useEffect(() => {
    if (!open) {
      wsFetchRef.current = false;
      return;
    }
    if (wsFetchRef.current) return;
    wsFetchRef.current = true;

    const { cached, refresh } = fetchModelsCached();

    // Show cached models immediately
    if (cached && cached.length > 0) {
      setWsModels(cached);
    }

    // Always refresh in background (even if cached data was shown)
    setWsModelsLoading(true);
    refresh()
      .then(setWsModels)
      .catch(() => {})
      .finally(() => setWsModelsLoading(false));
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    const d = makeKieAIDefaults(asset, effectiveShot);
    setStep("pick");
    setModel(null);
    setError("");
    setSearch("");
    setSeedream(d.seedream);
    setZimage(d.zimage);
    setNanoBanana2(d.nanoBanana2);
    setFlux2(d.flux2);
    setGrok(d.grok);
    setQwen(d.qwen);
    setWsInputs({});
    setRefIds([]);
  }, [open]);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  // ── Unified model list ────────────────────────────────────────────────────
  const unifiedModels = useMemo<UnifiedModel[]>(() => {
    const kieai: UnifiedModel[] = KIEAI_MODEL_META.map((m) => ({
      id: `kieai:${m.id}`,
      provider: "kieai",
      name: m.name,
      description: m.description,
      genType: m.genType,
      requiresSourceImage: m.requiresSourceImage,
      kieaiModel: m.id,
    }));
    const ws: UnifiedModel[] = wsModels.map((m) => {
      const schemaType = m.api_schema?.api_schemas?.[0]?.type ?? "";
      let genType: GenType = "text-to-image";
      if (schemaType.includes("image-to-video") || m.type.includes("video")) genType = "image-to-video";
      else if (schemaType.includes("text-to-video")) genType = "text-to-video";
      else if (schemaType.includes("image-to-image")) genType = "image-to-image";
      const isEdit = schemaType.includes("image-to") || m.type.includes("edit") || m.type.includes("upscale");
      return {
        id: `wavespeed:${m.model_id}`,
        provider: "wavespeed",
        name: m.name,
        description: m.description?.slice(0, 120) ?? "",
        genType,
        requiresSourceImage: isEdit,
        wsModel: m,
      };
    });
    return [...kieai, ...ws].sort((a, b) => a.name.localeCompare(b.name));
  }, [wsModels]);

  const filteredModels = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return unifiedModels;
    return unifiedModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.provider.includes(q),
    );
  }, [unifiedModels, search]);

  // ── Model select ──────────────────────────────────────────────────────────
  const handleSelectModel = useCallback((m: UnifiedModel) => {
    setModel(m);
    if (m.provider === "wavespeed" && m.wsModel) {
      const schema = m.wsModel.api_schema?.api_schemas?.[0]?.request_schema;
      const base = makeWsDefaults(m.wsModel, asset, effectiveShot);
      if (schema) {
        setWsInputs(injectImageInputs(schema, base, getRefImageUrls(project?.mediaLibrary.items ?? [], refIds)));
      } else {
        setWsInputs(base);
      }
    }
    setStep("form");
  }, [asset, effectiveShot, project, refIds]);

  // Re-inject reference images into WaveSpeed inputs when refIds change
  useEffect(() => {
    if (!model || model.provider !== "wavespeed" || !model.wsModel) return;
    const schema = model.wsModel.api_schema?.api_schemas?.[0]?.request_schema;
    if (!schema) return;
    setWsInputs((prev) => injectImageInputs(schema, prev, getRefImageUrls(project?.mediaLibrary.items ?? [], refIds)));
  }, [refIds, model, project]);

  // ── Reference image upload ────────────────────────────────────────────────
  const handleRefUpload = useCallback(async (file: File) => {
    if (!project) return;
    // Import the uploaded file as media, then add its ID to selection
    const { importMedia } = useProjectStore.getState();
    const result = await importMedia(file);
    if (result.success && result.actionId) {
      setRefIds((prev) => [...prev, result.actionId!]);
    }
  }, [project]);

  const handleRequestGenerateRef = useCallback(() => {
    setGenerateRefOpen(true);
  }, []);


  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!model || !project) return;
    setStep("submitting");
    setError("");
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      if (model.provider === "kieai" && model.kieaiModel) {
        // Upload reference images first
        const refUrls: string[] = [];
        for (const refId of refIds) {
          const refItem = project.mediaLibrary.items.find((item) => item.id === refId);
          if (refItem?.blob) {
            try {
              const uploaded = await uploadFileStream(refItem.blob);
              const url = uploaded.fileUrl || uploaded.downloadUrl || "";
              if (url) refUrls.push(url);
            } catch { /* skip failed uploads */ }
          }
        }

        // Upload source if needed
        let uploadedUrl = "";
        if (model.requiresSourceImage && sourceFile) {
          const uploaded = await uploadFileStream(sourceFile);
          if (ac.signal.aborted) return;
          uploadedUrl = uploaded.fileUrl || uploaded.downloadUrl || "";
          if (!uploadedUrl) throw new Error("Upload returned no URL");
        }
        // Merge source and reference image URLs
        const allImageUrls = [...(uploadedUrl ? [uploadedUrl] : []), ...refUrls];
        const kinputs: Record<string, unknown> = (() => {
          switch (model.kieaiModel) {
            case IMAGE_MODELS.SEEDREAM:    return { prompt: seedream.prompt, image_urls: allImageUrls, aspect_ratio: seedream.aspect_ratio, quality: seedream.quality };
            case IMAGE_MODELS.Z_IMAGE:     return { prompt: zimage.prompt, aspect_ratio: zimage.aspect_ratio };
            case IMAGE_MODELS.NANO_BANANA2: return { prompt: nanoBanana2.prompt, image_input: allImageUrls, aspect_ratio: nanoBanana2.aspect_ratio, resolution: nanoBanana2.resolution, output_format: nanoBanana2.output_format };
            case IMAGE_MODELS.FLUX2:       return { prompt: flux2.prompt, input_urls: allImageUrls, aspect_ratio: flux2.aspect_ratio, resolution: flux2.resolution };
            case IMAGE_MODELS.GROK:        return { ...(grok.prompt ? { prompt: grok.prompt } : {}), image_urls: allImageUrls };
            case IMAGE_MODELS.QWEN:        return { prompt: qwen.prompt, image_url: uploadedUrl, strength: qwen.strength, output_format: qwen.output_format, acceleration: qwen.acceleration, ...(qwen.negative_prompt ? { negative_prompt: qwen.negative_prompt } : {}), ...(qwen.seed != null ? { seed: qwen.seed } : {}) };
            default: throw new Error("Unknown KieAI model");
          }
        })();

        const taskId = await createImageTask(model.kieaiModel, kinputs as unknown as ImageModelInput);
        if (ac.signal.aborted) return;

        const mediaId = uuidv4();
        const name = `${(sourceFile?.name ?? "generated").replace(/\.[^.]+$/, "")}_kieai.png`;
        addPlaceholderMedia({
          id: mediaId, name, type: "image", fileHandle: null, blob: null,
          metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
          thumbnailUrl: previewUrl ?? null, waveformData: null, isPlaceholder: true, isPending: true, kieaiTaskId: taskId,
          generationMeta: { provider: "kieai", model: model.kieaiModel, prompt: String(kinputs.prompt ?? ""), inputs: kinputs, jobId: taskId, status: "pending" },
        });
        enqueueJob({
          provider: "kieai", providerJobId: taskId, model: model.kieaiModel, prompt: String(kinputs.prompt ?? ""),
          inputs: kinputs, projectId: project.id, linkedMediaIds: refIds,
        });
      } else if (model.provider === "wavespeed" && model.wsModel) {
        const schema = model.wsModel.api_schema?.api_schemas?.[0]?.request_schema;
        const injected = schema ? injectImageInputs(schema, wsInputs, getRefImageUrls(project.mediaLibrary.items, refIds)) : wsInputs;
        const jobId = await submitGeneration(model.wsModel.model_id, injected);
        if (ac.signal.aborted) return;

        const mediaId = uuidv4();
        const isVideo = model.genType.includes("video");
        const name = `wavespeed_${model.wsModel.model_id.split("/").pop()}.${isVideo ? "mp4" : "jpg"}`;
        addPlaceholderMedia({
          id: mediaId, name, type: isVideo ? "video" : "image", fileHandle: null, blob: null,
          metadata: { duration: 0, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
          thumbnailUrl: previewUrl ?? null, waveformData: null, isPlaceholder: true, isPending: true,
          generationMeta: { provider: "wavespeed", model: model.wsModel.model_id, prompt: String(wsInputs.prompt ?? ""), inputs: wsInputs, jobId, status: "pending" },
        });
        enqueueJob({
          provider: "wavespeed", providerJobId: jobId, model: model.wsModel.model_id,
          prompt: String(wsInputs.prompt ?? ""), inputs: wsInputs, projectId: project.id, linkedMediaIds: refIds,
        });
        handleClose();
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setStep("error");
    }
  }, [model, project, sourceFile, previewUrl, seedream, zimage, nanoBanana2, flux2, grok, qwen, wsInputs, refIds, addPlaceholderMedia, enqueueJob, handleClose]);

  // ── Gen type label ────────────────────────────────────────────────────────
  const genTypeLabel: Record<GenType, string> = {
    "text-to-image": "Text → Image",
    "image-to-image": "Image → Image",
    "text-to-video": "Text → Video",
    "image-to-video": "Image → Video",
  };

  const providerColors: Record<ModelProvider, string> = {
    kieai: "bg-violet-500/20 text-violet-300",
    wavespeed: "bg-emerald-500/20 text-emerald-300",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const imageMedia = project?.mediaLibrary.items ?? [];
  const title = step === "pick" ? "Generate Asset"
    : step === "submitting" ? "Submitting…"
    : step === "error" ? "Generation Failed"
    : model?.name ?? "";

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-lg h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* Source image preview */}
        {(sourceFile || previewUrl) && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background-elevated p-2 shrink-0">
            {previewUrl ? (
              <img src={previewUrl} alt="Source" className="h-10 w-10 rounded object-cover flex-shrink-0" />
            ) : (
              <div className="h-10 w-10 rounded bg-background-tertiary flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-text-primary">{sourceFile?.name ?? "Reference"}</p>
              <p className="text-[10px] text-text-muted">Source image</p>
            </div>
          </div>
        )}

        {/* Content — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          {step === "pick" && (
            <div className="space-y-3">
              {/* Search */}
              <div className="sticky top-0 bg-background z-10 pb-2">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2">
                  <Search size={14} className="text-text-muted flex-shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${unifiedModels.length} models…`}
                    className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                  />
                </div>
              </div>

              {wsModelsLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
                  <span className="ml-2 text-xs text-text-muted">Loading WaveSpeed models…</span>
                </div>
              )}

              {/* Model cards */}
              <div className="grid grid-cols-1 gap-2">
                {filteredModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleSelectModel(m)}
                    className="flex items-start gap-3 rounded-lg border border-border bg-background-elevated p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{m.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerColors[m.provider]}`}>
                          {m.provider === "kieai" ? "KieAI" : "WaveSpeed"}
                        </span>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-background-tertiary text-text-muted">
                          {genTypeLabel[m.genType]}
                        </span>
                        {m.requiresSourceImage && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">Needs source</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-text-muted leading-relaxed line-clamp-2">{m.description}</p>
                    </div>
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ))}
              </div>

              {filteredModels.length === 0 && !wsModelsLoading && (
                <p className="text-xs text-text-muted text-center py-8">No models match "{search}"</p>
              )}
            </div>
          )}

          {step === "form" && model && (
            <div className="space-y-3">
              <button onClick={() => setStep("pick")} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                <ChevronLeft size={12} /> Back to models
              </button>

              {/* Selected model header */}
              <div className="rounded-lg border border-border bg-background-elevated p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-text-primary">{model.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerColors[model.provider]}`}>
                    {model.provider === "kieai" ? "KieAI" : "WaveSpeed"}
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-background-tertiary text-text-muted">
                    {genTypeLabel[model.genType]}
                  </span>
                  {model.requiresSourceImage && !sourceFile && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">
                      Source image recommended
                    </span>
                  )}
                </div>
              </div>

              {/* Reference images — always visible */}
              <ReferenceImagePicker
                mediaItems={imageMedia}
                selectedIds={refIds}
                onChange={setRefIds}
                onUpload={handleRefUpload}
                onRequestGenerate={handleRequestGenerateRef}
              />

              {/* KieAI per-model form */}
              {model.provider === "kieai" && model.kieaiModel && (
                <>
                  {model.kieaiModel === IMAGE_MODELS.SEEDREAM    && <SeedreamForm value={seedream} onChange={setSeedream} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.Z_IMAGE     && <ZImageForm value={zimage} onChange={setZimage} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.NANO_BANANA2 && <NanoBanana2Form value={nanoBanana2} onChange={setNanoBanana2} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.FLUX2       && <Flux2Form value={flux2} onChange={setFlux2} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.GROK        && <GrokForm value={grok} onChange={setGrok} onSubmit={handleGenerate} isLoading={false} />}
                  {model.kieaiModel === IMAGE_MODELS.QWEN        && <QwenForm value={qwen} onChange={setQwen} onSubmit={handleGenerate} isLoading={false} />}
                </>
              )}

              {/* WaveSpeed dynamic form */}
              {model.provider === "wavespeed" && model.wsModel && (
                <>
                  <SchemaForm
                    schema={model.wsModel.api_schema.api_schemas[0].request_schema}
                    values={wsInputs}
                    onChange={setWsInputs}
                  />
                  <Button onClick={handleGenerate} className="w-full" size="sm">Generate</Button>
                </>
              )}
            </div>
          )}

          {step === "submitting" && (
            <div className="space-y-4 py-8 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
              <p className="text-sm text-text-secondary">Submitting to {model?.provider === "kieai" ? "KieAI" : "WaveSpeed"}…</p>
              <Button variant="outline" size="sm" onClick={() => { abortRef.current?.abort(); handleClose(); }}>Cancel</Button>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{errorMsg}</div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleClose}>Close</Button>
                <Button className="flex-1" onClick={() => setStep("form")}>Try Again</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {generateRefOpen && (
      <GenerateAssetDialog
        open={generateRefOpen}
        onClose={() => setGenerateRefOpen(false)}
      />
    )}
    </>
  );
}
