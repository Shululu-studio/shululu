import { computeAudioAnalysis } from '../utils/audioSync';

export interface WorkerAnalyzeRequest {
  id: string;
  samples: Float32Array;
  sampleRate: number;
}

self.onmessage = (event: MessageEvent<WorkerAnalyzeRequest>) => {
  const { id, samples, sampleRate } = event.data;
  try {
    const analysis = computeAudioAnalysis(samples, sampleRate, 10, 2400);
    self.postMessage({ id, ok: true, analysis });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Audio analysis failed',
    });
  }
};
