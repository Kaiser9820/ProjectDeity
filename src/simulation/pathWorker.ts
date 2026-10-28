/// <reference lib="webworker" />
import { predictPaths, type PathRequest } from './predictPaths';

self.onmessage = (e: MessageEvent<{ id: number; req: PathRequest }>) => {
  const paths = predictPaths(e.data.req);
  const out: Record<string, Float64Array> = {};
  for (const [k, pts] of paths) out[k] = Float64Array.from(pts.flat());
  self.postMessage({ id: e.data.id, paths: out });
};
