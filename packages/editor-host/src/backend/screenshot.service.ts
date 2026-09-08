// Screenshot capture service: bridges a backend capture request to the renderer frontend that actually draws the frame, over a request/response gap that crosses processes.

import { randomUUID } from 'crypto';

// Shape of a completed screenshot returned to callers, and the controller that tracks one in-flight capture awaiting the renderer's reply.
export interface ScreenshotRecord {
  captureId: string;
  dataUrl: string;       // "data:image/png;base64,..."
  width: number;
  height: number;
  capturedAt: string;    // ISO 8601
}

interface PendingCapture {
  resolve: (record: ScreenshotRecord) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// The service: owns in-flight captures keyed by id plus a cache of the last successful frame, so callers can request-and-await or cheaply read the most recent shot.
class ScreenshotService {
  private pending = new Map<string, PendingCapture>();
  private latest: ScreenshotRecord | null = null;

  // Opens a new capture: returns its id (for the renderer to echo back) and a Promise that settles when the renderer replies or the timeout fires.
  createCapture(timeoutMs = 5000): { captureId: string; promise: Promise<ScreenshotRecord> } {
    const captureId = randomUUID();

    const promise = new Promise<ScreenshotRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(captureId);
        console.warn(`[Screenshot] Capture timeout: ${captureId}`);
        reject(new Error('timeout'));
      }, timeoutMs);

      this.pending.set(captureId, { resolve, reject, timer });
    });

    console.log(`[Screenshot] Capture created: ${captureId} (timeout=${timeoutMs}ms)`);
    return { captureId, promise };
  }

  // Renderer-side callback once a frame is ready: settles the matching pending capture and updates the latest cache, or reports the id as unknown (already timed out / invalid).
  resolveCapture(captureId: string, record: ScreenshotRecord): boolean {
    const pending = this.pending.get(captureId);
    if (!pending) {
      console.warn(`[Screenshot] No pending capture for id: ${captureId}`);
      return false;
    }

    clearTimeout(pending.timer);
    this.pending.delete(captureId);
    this.latest = record;
    pending.resolve(record);

    console.log(`[Screenshot] Captured: ${captureId} (${record.width}x${record.height}, ${(record.dataUrl.length / 1024).toFixed(1)}KB base64)`);
    return true;
  }

  // Renderer-side error callback: the renderer couldn't produce a frame (no
  // canvas, empty scene, encode failure). Settle the pending capture as a
  // rejection NOW so the awaiting /capture returns immediately instead of
  // hanging until the timeout fires (the "renderer online but capture 504s"
  // symptom). Reports the id as unknown if it already timed out / is invalid.
  rejectCapture(captureId: string, reason: string): boolean {
    const pending = this.pending.get(captureId);
    if (!pending) {
      console.warn(`[Screenshot] No pending capture to reject for id: ${captureId}`);
      return false;
    }
    clearTimeout(pending.timer);
    this.pending.delete(captureId);
    console.warn(`[Screenshot] Capture rejected: ${captureId} (${reason})`);
    pending.reject(new Error(reason));
    return true;
  }

  // Non-blocking read of the most recent successful frame.
  getLatest(): ScreenshotRecord | null {
    return this.latest;
  }
}

// Process-wide accessor: the service is a lazily-created singleton so request and reply sides share one capture registry.
let screenshotServiceInstance: ScreenshotService | null = null;

export function getScreenshotService(): ScreenshotService {
  if (!screenshotServiceInstance) {
    screenshotServiceInstance = new ScreenshotService();
  }
  return screenshotServiceInstance;
}
