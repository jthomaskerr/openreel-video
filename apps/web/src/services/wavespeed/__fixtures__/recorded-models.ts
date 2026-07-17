import {
  createRecordedWaveSpeedModel,
  recordedWaveSpeedModels,
  type WaveSpeedRecordedModel,
} from "@openreel/core/generation/wavespeed";
import type { WavespeedModel } from "../index";

function asWavespeedModel(model: WaveSpeedRecordedModel): WavespeedModel {
  return model as WavespeedModel;
}

export function recordedModel(
  id: string,
  schemaType: string,
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
  generalType = "model",
): WavespeedModel {
  return asWavespeedModel(
    createRecordedWaveSpeedModel(id, schemaType, properties, required, generalType),
  );
}

export const textToImage = asWavespeedModel(recordedWaveSpeedModels.textToImage);
export const imageToImage = asWavespeedModel(recordedWaveSpeedModels.imageToImage);
export const textToVideo = asWavespeedModel(recordedWaveSpeedModels.textToVideo);
export const imageToVideo = asWavespeedModel(recordedWaveSpeedModels.imageToVideo);
export const referenceAndAudio = asWavespeedModel(
  recordedWaveSpeedModels.referenceAndAudio,
);
export const untypedUri = asWavespeedModel(recordedWaveSpeedModels.untypedUri);
export const misleadingType = asWavespeedModel(recordedWaveSpeedModels.misleadingType);
