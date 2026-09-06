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
  signal?: AbortSignal;
  abortHandler?: () => void;
}

const REQUEST_TIMEOUT_MS = 11 * 60 * 1_000;
const ENGINE_PROTOCOL_VERSION = 1;

class CsplendorMateEngine {
  readonly protocolVersion = ENGINE_PROTOCOL_VERSION;
  private process: ChildProcessWithoutNullStreams | null = null;
  private requestSequence = 0;
  private pending = new Map<string, PendingRequest>();
  private stderrTail = '';

  async request<T>(
    command: string,
    payload: JsonObject = {},
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw this.abortError();
    const child = this.ensureProcess();
    const requestId = String(++this.requestSequence);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.takePending(requestId);
        if (!pending) return;
        pending.reject(new Error(`詰み探索がタイムアウトしました（command: ${command}）。`));
        this.stopProcess(
          child,
          new Error('先行する詰み探索がタイムアウトしたため、処理を中断しました。'),
        );
      }, REQUEST_TIMEOUT_MS);
      const abortHandler = signal
        ? () => {
            const pending = this.takePending(requestId);
            if (!pending) return;
            pending.reject(this.abortError());
            // The Python worker processes stdin serially. Restarting it is the only
            // way to stop the active native search and discard requests queued behind it.
            this.stopProcess(
              child,
              new Error('先行する詰み探索が中断されたため、処理を中断しました。'),
            );
          }
        : undefined;
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
        signal,
        abortHandler,
      });
      if (signal && abortHandler) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      if (signal?.aborted) {
        abortHandler?.();
        return;
      }
      child.stdin.write(
        `${JSON.stringify({ request_id: requestId, command, payload })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.takePending(requestId);
          if (!pending) return;
          pending.reject(new Error(`詰み探索エンジンへの送信に失敗しました: ${error.message}`));
        },
      );
    });
  }

  shutdown(): void {
    const child = this.process;
    if (!child) return;
    this.stopProcess(child, new Error('詰み探索エンジンを更新するため、処理を中断しました。'));
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
    this.stderrTail = '';
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleResponseLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrTail = `${this.stderrTail}${text}`.slice(-8_000);
      process.stderr.write(`[csplendor-mate-gui] ${text}`);
    });
    child.on('error', (error) => {
      if (this.process !== child) return;
      this.process = null;
      this.rejectAll(new Error(`詰み探索エンジンを起動できません: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      const detail = this.stderrTail.trim();
      this.rejectAll(new Error(
        `詰み探索エンジンが終了しました（code=${String(code)}, signal=${String(signal)}）。${detail ? `\n${detail}` : ''}`,
      ));
    });
    return child;
  }

  private handleResponseLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.rejectAll(new Error(`詰み探索エンジンから不正な応答を受信しました: ${line}`));
      return;
    }
    const pending = this.takePending(String(response.request_id));
    if (!pending) return;
    if (!response.ok) {
      pending.reject(new Error(response.error || '詰み探索エンジンで不明なエラーが発生しました。'));
      return;
    }
    pending.resolve(response.result);
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
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler);
    }
    return pending;
  }

  private stopProcess(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.process !== child) return;
    this.process = null;
    this.rejectAll(error);
    if (!child.killed && child.exitCode === null) child.kill();
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
