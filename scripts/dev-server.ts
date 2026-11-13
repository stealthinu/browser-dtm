import { spawn, type ChildProcess } from "node:child_process";

export function startDevServer(port = 5300): Promise<{ proc: ChildProcess; base: string }> {
  const proc = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  const base = `http://127.0.0.1:${port}/`;
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString();
      if (/Local:\s+http:\/\/127\.0\.0\.1/.test(buf) || /ready in/i.test(buf)) {
        cleanup();
        resolve({ proc, base });
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      // vite が黙っていてもポートが開いていれば続行
      resolve({ proc, base });
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code && code !== 0) reject(new Error(`vite exited ${code}: ${buf}`));
    });
  });
}

export function stopProc(proc: ChildProcess): void {
  if (!proc.killed) {
    proc.kill("SIGTERM");
  }
}
