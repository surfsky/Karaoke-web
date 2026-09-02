import type { InferenceSession } from 'onnxruntime-web';

export interface DemucsProcessorOptions {
  onProgress?: (info: { phase?: string; progress?: number }) => void;
  onLog?: (phase: string, msg: string) => void;
}

export interface DemucsProcessorConstructorOptions extends DemucsProcessorOptions {
  ort: typeof import('onnxruntime-web');
  modelPath?: string;
  sessionOptions?: InferenceSession.SessionOptions;
}

export class DemucsProcessor {
  constructor(options?: DemucsProcessorConstructorOptions);
  loadModel(modelPathOrBuffer?: string | ArrayBuffer): Promise<void>;
  separate(left: Float32Array, right: Float32Array): Promise<{
    vocals: { left: Float32Array; right: Float32Array };
    drums: { left: Float32Array; right: Float32Array };
    bass: { left: Float32Array; right: Float32Array };
    other: { left: Float32Array; right: Float32Array };
  }>;
}

export const CONSTANTS: {
  SAMPLE_RATE: number;
  FFT_SIZE: number;
  HOP_SIZE: number;
  TRAINING_SAMPLES: number;
  MODEL_SPEC_BINS: number;
  MODEL_SPEC_FRAMES: number;
  SEGMENT_OVERLAP: number;
  TRACKS: string[];
  DEFAULT_MODEL_URL: string;
};
