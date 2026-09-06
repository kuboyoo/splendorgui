import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

type JsonObject = Record<string, unknown>;

interface WorkerResponse {
  request_id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
  requestLine: string;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

const REQUEST_TIMEOUT_MS = 11 * 60 * 1_000;
const ENGINE_PROTOCOL_VERSION = 2;

class CsplendorMateEngine {
  readonly protocolVersion = ENGINE_PROTOCOL_VERSION;
  private process: ChildProcessWithoutNullStreams | null = null;
  private requestSequence = 0;
  private pending = new Map<string, PendingRequest>();
  private queue: string[] = [];
  private activeRequestId: string | null = null;

  async request<T>(
    command: string,
    payload: JsonObject = {},
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw this.abortError();
    const requestId = String(++this.requestSequence);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const wasActive = this.activeRequestId === requestId;
        const pending = this.takePending(requestId);
        if (!pending) return;
        pending.reject(new Error(`詰み探索がタイムアウトしました（command: ${command}）。`));
        if (wasActive) this.stopActiveProcess();
        this.dispatchNext();
      }, REQUEST_TIMEOUT_MS);
      const abortHandler = signal
        ? () => {
            const wasActive = this.activeRequestId === requestId;
            const pending = this.takePending(requestId);
            if (!pending) return;
            pending.reject(this.abortError());
            // Only an active native search requires a worker restart. Requests that
            // are still queued have not reached Python and can be removed in isolation.
            if (wasActive) this.stopActiveProcess();
            this.dispatchNext();
          }
        : undefined;
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        requestLine: `${JSON.stringify({ request_id: requestId, command, payload })}\n`,
        signal,
        abortHandler,
      });
      this.queue.push(requestId);
      if (signal && abortHandler) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      if (signal?.aborted) {
        abortHandler?.();
        return;
      }
      this.dispatchNext();
    });
  }

  shutdown(): void {
    const child = this.process;
    this.process = null;
    this.activeRequestId = null;
    this.queue = [];
    this.rejectAll(new Error('詰み探索エンジンを更新するため、処理を中断しました。'));
    if (child && !child.killed && child.exitCode === null) child.kill();
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed && this.process.exitCode === null) return this.process;
    const guiRoot = process.cwd();
    const csplendorRoot = path.resolve(
      process.env.CSPLENDOR_ROOT?.trim() || path.join(guiRoot, '..', 'csplendor'),
    );
    const scriptPath = path.join(guiRoot, 'scripts', 'csplendor_mate_engine.py');
    const python = process.env.CSPLENDOR_PYTHON?.trim() || 'python';
    const pythonPath = [csplendorRoot, process.env.PYTHONPATH]
      .filter((entry): entry is string => Boolean(entry))
      .join(path.delimiter);
    const child = spawn(python, ['-u', scriptPath], {
      cwd: csplendorRoot,
      env: { ...process.env, PYTHONPATH: pythonPath, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    let stderrTail = '';
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleResponseLine(child, line));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrTail = `${stderrTail}${text}`.slice(-8_000);
      process.stderr.write(`[csplendor-mate-gui] ${text}`);
    });
    child.on('error', (error) => {
      this.handleProcessFailure(
        child,
        new Error(`詰み探索エンジンを起動できません: ${error.message}`),
      );
    });
    child.on('exit', (code, signal) => {
      const detail = stderrTail.trim();
      this.handleProcessFailure(
        child,
        new Error(
          `詰み探索エンジンが終了しました（code=${String(code)}, signal=${String(signal)}）。${detail ? `\n${detail}` : ''}`,
        ),
      );
    });
    return child;
  }

  private dispatchNext(): void {
    if (this.activeRequestId !== null) return;
    let requestId: string | undefined;
    let pending: PendingRequest | undefined;
    while (!pending && this.queue.length > 0) {
      requestId = this.queue.shift();
      if (requestId !== undefined) pending = this.pending.get(requestId);
    }
    if (!pending || requestId === undefined) return;

    const child = this.ensureProcess();
    this.activeRequestId = requestId;
    child.stdin.write(pending.requestLine, (error) => {
      if (!error || this.process !== child || this.activeRequestId !== requestId) return;
      this.handleProcessFailure(
        child,
        new Error(`詰み探索エンジンへの送信に失敗しました: ${error.message}`),
      );
    });
  }

  private handleResponseLine(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.process !== child) return;
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.handleProcessFailure(
        child,
        new Error(`詰み探索エンジンから不正な応答を受信しました: ${line}`),
      );
      return;
    }
    const requestId = String(response.request_id);
    if (requestId !== this.activeRequestId) {
      this.handleProcessFailure(
        child,
        new Error(`詰み探索エンジンから順序外の応答を受信しました: ${requestId}`),
      );
      return;
    }
    this.activeRequestId = null;
    const pending = this.takePending(requestId);
    if (!pending) {
      this.dispatchNext();
      return;
    }
    if (!response.ok) {
      pending.reject(new Error(response.error || '詰み探索エンジンで不明なエラーが発生しました。'));
      this.dispatchNext();
      return;
    }
    pending.resolve(response.result);
    this.dispatchNext();
  }

  private rejectAll(error: Error): void {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      clearTimeout(pending.timeout);
      if (pending.signal && pending.abortHandler) {
        pending.signal.removeEventListener('abort', pending.abortHandler);
      }
      pending.reject(error);
    }
  }

  private takePending(requestId: string): PendingRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    const queueIndex = this.queue.indexOf(requestId);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler);
    }
    return pending;
  }

  private stopActiveProcess(): void {
    const child = this.process;
    this.activeRequestId = null;
    if (!child) return;
    this.process = null;
    if (!child.killed && child.exitCode === null) child.kill();
  }

  private handleProcessFailure(
    child: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.process !== child) return;
    this.process = null;
    if (!child.killed && child.exitCode === null) child.kill();
    const requestId = this.activeRequestId;
    this.activeRequestId = null;
    if (requestId !== null) this.takePending(requestId)?.reject(error);
    this.dispatchNext();
  }

  private abortError(): Error {
    const error = new Error('詰み探索を中断しました。');
    error.name = 'AbortError';
    return error;
  }
}

const globalEngine = globalThis as typeof globalThis & {
  __csplendorMateEngine?: CsplendorMateEngine;
};

export function getCsplendorMateEngine(): CsplendorMateEngine {
  const current = globalEngine.__csplendorMateEngine;
  if (current?.protocolVersion === ENGINE_PROTOCOL_VERSION) return current;
  current?.shutdown();
  const replacement = new CsplendorMateEngine();
  globalEngine.__csplendorMateEngine = replacement;
  return replacement;
}
