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
}

const REQUEST_TIMEOUT_MS = 11 * 60 * 1_000;
const ENGINE_PROTOCOL_VERSION = 1;

class CsplendorMateEngine {
  readonly protocolVersion = ENGINE_PROTOCOL_VERSION;
  private process: ChildProcessWithoutNullStreams | null = null;
  private requestSequence = 0;
  private pending = new Map<string, PendingRequest>();
  private stderrTail = '';

  async request<T>(command: string, payload: JsonObject = {}): Promise<T> {
    const child = this.ensureProcess();
    const requestId = String(++this.requestSequence);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`詰み探索がタイムアウトしました（command: ${command}）。`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      child.stdin.write(
        `${JSON.stringify({ request_id: requestId, command, payload })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(requestId);
          pending.reject(new Error(`詰み探索エンジンへの送信に失敗しました: ${error.message}`));
        },
      );
    });
  }

  shutdown(): void {
    const child = this.process;
    this.process = null;
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
    this.stderrTail = '';
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleResponseLine(line));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrTail = `${this.stderrTail}${text}`.slice(-8_000);
      process.stderr.write(`[csplendor-mate-gui] ${text}`);
    });
    child.on('error', (error) => {
      this.rejectAll(new Error(`詰み探索エンジンを起動できません: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      const detail = this.stderrTail.trim();
      this.rejectAll(new Error(
        `詰み探索エンジンが終了しました（code=${String(code)}, signal=${String(signal)}）。${detail ? `\n${detail}` : ''}`,
      ));
      if (this.process === child) this.process = null;
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
    const pending = this.pending.get(String(response.request_id));
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(String(response.request_id));
    if (!response.ok) {
      pending.reject(new Error(response.error || '詰み探索エンジンで不明なエラーが発生しました。'));
      return;
    }
    pending.resolve(response.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
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
