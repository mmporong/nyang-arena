import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const APP_BASE = "/nyang-arena";
const WIDTH = 1280;
const HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 50;
const BGM = join(ROOT, "public", "bgm", "prepare.mp3");
const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isWithin(parent, candidate) {
  return resolve(candidate).startsWith(`${resolve(parent)}${sep}`);
}

async function waitFor(label, read, accept, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await read();
    if (accept(lastValue)) return lastValue;
    await delay(50);
  }
  throw new Error(`${label} 대기 시간 초과: ${JSON.stringify(lastValue)}`);
}

function commandPath(name) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? null;
}

function findBrowser() {
  const configured = [process.env.NYANG_BROWSER, process.env.BROWSER_BIN, process.env.CHROME_BIN].filter(Boolean);
  for (const candidate of configured) {
    const absolute = resolve(candidate);
    if (existsSync(absolute)) return absolute;
    const discovered = commandPath(candidate);
    if (discovered) return discovered;
  }

  const candidates = [];
  if (process.platform === "win32") {
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
      if (!base) continue;
      candidates.push(
        join(base, "Google", "Chrome", "Application", "chrome.exe"),
        join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
    candidates.push(commandPath("chrome.exe"), commandPath("msedge.exe"));
  } else {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      candidates.push(commandPath(name));
    }
  }
  const browser = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!browser) {
    throw new Error("Chrome/Edge를 찾지 못했습니다. NYANG_BROWSER, BROWSER_BIN 또는 CHROME_BIN을 지정하세요.");
  }
  return browser;
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      frames: { type: "string" },
      duration: { type: "string", default: String(DEFAULT_DURATION_SECONDS) },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log([
      "사용법: node scripts/capture-submission-gameplay.mjs [옵션]",
      "  --output <mp4>   BGM이 포함된 H.264 제출 영상 경로",
      "  --frames <dir>   Page.startScreencast JPEG 프레임 보존 경로",
      "  --duration <초>  45~55초, 기본 50초",
      "  --force          기존 출력 MP4를 덮어쓰기",
    ].join("\n"));
    return null;
  }

  const durationSeconds = Number(values.duration);
  assert(Number.isFinite(durationSeconds) && durationSeconds >= 45 && durationSeconds <= 55,
    `--duration은 45~55초여야 합니다 (${values.duration})`);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const captureRoot = join(tmpdir(), `nyang-submission-gameplay-${stamp}`);
  const framesDir = resolve(values.frames ?? join(captureRoot, "frames"));
  const outputPath = resolve(values.output ?? join(captureRoot, "nyang-arena-gameplay.mp4"));
  assert(extname(outputPath).toLowerCase() === ".mp4", `--output은 .mp4여야 합니다 (${outputPath})`);
  assert(isWithin(ROOT, outputPath) || isWithin(tmpdir(), outputPath),
    `--output은 저장소 또는 임시 폴더 안이어야 합니다 (${outputPath})`);
  assert(isWithin(ROOT, framesDir) || isWithin(tmpdir(), framesDir),
    `--frames는 저장소 또는 임시 폴더 안이어야 합니다 (${framesDir})`);
  return { durationSeconds, framesDir, outputPath, force: values.force };
}

async function prepareOutput({ framesDir, outputPath, force }) {
  await mkdir(framesDir, { recursive: true });
  const existingFrames = (await readdir(framesDir)).filter((name) => /^frame-\d{6}\.jpg$/u.test(name));
  assert(existingFrames.length === 0, `프레임 디렉터리에 기존 캡처가 있습니다: ${framesDir}`);
  await mkdir(dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) {
    assert(force, `출력 파일이 이미 있습니다. 덮어쓰려면 --force를 사용하세요: ${outputPath}`);
    await rm(outputPath, { force: true });
  }
}

async function startStaticServer() {
  await stat(join(DIST, "index.html"));
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const appPath = url.pathname === APP_BASE || url.pathname === `${APP_BASE}/`
        ? "/index.html"
        : url.pathname.startsWith(`${APP_BASE}/`)
          ? url.pathname.slice(APP_BASE.length)
          : url.pathname === "/"
            ? "/index.html"
            : url.pathname;
      const pathname = decodeURIComponent(appPath);
      const target = resolve(DIST, `.${pathname}`);
      if (target !== DIST && !target.startsWith(`${DIST}${sep}`)) {
        requests.push({ path: url.pathname, status: 403 });
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(target);
      requests.push({ path: url.pathname, status: 200 });
      response.writeHead(200, {
        "content-type": MIME.get(extname(target).toLowerCase()) ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      requests.push({ path: request.url ?? "/", status: 404 });
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object", "정적 서버 포트를 얻지 못했습니다");
  return { server, requests, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function waitForDevTools(browserProcess, profileDir) {
  let stderr = "";
  let socketUrl = null;
  browserProcess.stderr.setEncoding("utf8");
  browserProcess.stderr.on("data", (chunk) => {
    stderr += chunk;
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u);
    if (match) socketUrl = match[1];
  });
  return waitFor(
    "DevTools 기동",
    async () => {
      if (socketUrl) return socketUrl;
      if (browserProcess.exitCode !== null) {
        throw new Error(`브라우저가 조기 종료했습니다 (${browserProcess.exitCode})\n${stderr}`);
      }
      try {
        const active = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/u);
        if (active[0] && active[1]) return `ws://127.0.0.1:${active[0]}${active[1]}`;
      } catch {
        // 브라우저가 디버깅 소켓을 연 뒤 생성된다.
      }
      return null;
    },
    Boolean,
    20_000,
  );
}

class CdpConnection {
  constructor(socket, commandTimeoutMs = 12_000) {
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
    const rejectPending = (reason) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(reason));
      }
      this.pending.clear();
    };
    socket.addEventListener("error", () => rejectPending("CDP 연결 오류"));
    socket.addEventListener("close", () => rejectPending("CDP 연결 종료"));
  }

  static async connect(url, timeoutMs = 10_000) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      const onOpen = () => { cleanup(); resolveOpen(); };
      const onError = () => { cleanup(); rejectOpen(new Error(`CDP 연결 실패: ${url}`)); };
      const onClose = () => { cleanup(); rejectOpen(new Error(`CDP 연결 전 소켓 종료: ${url}`)); };
      const timer = setTimeout(() => { cleanup(); rejectOpen(new Error(`CDP 연결 ${timeoutMs}ms 시간 초과`)); }, timeoutMs);
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, sessionId, timeoutMs = this.commandTimeoutMs) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        rejectCommand(new Error(`${method}: CDP 명령 ${timeoutMs}ms 시간 초과`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand, method, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectCommand(error);
      }
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function connectCdpWhenReady(url, browserProcess, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      throw new Error(`CDP 연결 전 브라우저가 종료했습니다 (${browserProcess.exitCode ?? browserProcess.signalCode})`);
    }
    try {
      return await CdpConnection.connect(url, Math.min(2_000, deadline - Date.now()));
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(`CDP readiness 시간 초과: ${lastError?.message ?? "알 수 없는 오류"}`);
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(`브라우저 평가 실패: ${result.exceptionDetails.text ?? expression}`);
  return result.result?.value;
}

async function clickPoint(cdp, sessionId, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
  }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1,
  }, sessionId);
}

async function pressKey(cdp, sessionId, { key, code, keyCode, text = "" }) {
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await cdp.send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    ...common,
    ...(text ? { text, unmodifiedText: text } : {}),
  }, sessionId);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common }, sessionId);
}

async function pressDigit(cdp, sessionId, digit) {
  assert(Number.isInteger(digit) && digit >= 1 && digit <= 9, `잘못된 숫자 입력: ${digit}`);
  await evaluate(cdp, sessionId, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await pressKey(cdp, sessionId, {
    key: String(digit), code: `Digit${digit}`, keyCode: 48 + digit, text: String(digit),
  });
}

async function clickGameButton(cdp, sessionId, horizontalRatio = 0.5) {
  const target = await waitFor(
    "Canvas 게임 버튼",
    () => evaluate(cdp, sessionId, `(() => {
      const button = window.nyang?.button;
      if (!button || button.w < 1 || button.h < 1) return null;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return { x: button.x + button.w * ${horizontalRatio}, y: button.y + button.h / 2 };
    })()`),
    Boolean,
  );
  await clickPoint(cdp, sessionId, target.x, target.y);
}

async function runProcess(executable, args, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error(`${executable} ${timeoutMs}ms 시간 초과\n${stderr.slice(-2000)}`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`${executable} 실패 (${code ?? signal})\n${stderr.slice(-4000)}`));
    });
  });
}

function buildConcat(frames) {
  assert(frames.length >= 2, "영상 인코딩에 필요한 프레임이 부족합니다");
  const lines = ["ffconcat version 1.0"];
  for (let index = 0; index < frames.length; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    const rawDuration = next ? next.timestamp - current.timestamp : 1 / 30;
    const duration = Math.max(1 / 120, Math.min(0.2, Number.isFinite(rawDuration) ? rawDuration : 1 / 30));
    lines.push(`file '${current.name}'`, `duration ${duration.toFixed(6)}`);
  }
  lines.push(`file '${frames.at(-1).name}'`);
  return `${lines.join("\n")}\n`;
}

async function encodeVideo({ ffmpeg, ffprobe, framesDir, outputPath, frames }) {
  const concatPath = join(framesDir, "frames.ffconcat");
  const audioFadeStart = Math.max(1, frames.at(-1).timestamp - frames[0].timestamp - 1);
  await writeFile(concatPath, buildConcat(frames), "utf8");
  await runProcess(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "warning",
    "-f", "concat", "-safe", "0", "-i", concatPath,
    "-stream_loop", "-1", "-i", BGM,
    "-vf", `fps=30,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease:out_range=tv,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x0b1026,format=yuv420p,setparams=range=limited`,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
    "-pix_fmt", "yuv420p", "-color_range", "tv", "-profile:v", "high", "-level", "4.0", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-af", `volume=0.85,afade=t=in:st=0:d=0.8,afade=t=out:st=${audioFadeStart.toFixed(3)}:d=1`, "-shortest",
    "-movflags", "+faststart", outputPath,
  ], 90_000);
  const { stdout } = await runProcess(ffprobe, [
    "-v", "error", "-show_entries",
    "format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,avg_frame_rate,sample_rate,channels",
    "-of", "json", outputPath,
  ], 15_000);
  const probe = JSON.parse(stdout);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  assert(video?.codec_name === "h264", `출력 코덱이 H.264가 아닙니다 (${video?.codec_name})`);
  assert(video.width === WIDTH && video.height === HEIGHT, `출력 해상도가 ${WIDTH}x${HEIGHT}가 아닙니다`);
  assert(video.pix_fmt === "yuv420p" && video.avg_frame_rate === "30/1", "출력 픽셀 형식/프레임률이 다릅니다");
  assert(audio?.codec_name === "aac" && audio.sample_rate === "48000" && audio.channels === 2,
    `BGM 오디오 계약이 다릅니다 (${JSON.stringify(audio)})`);
  assert(duration >= 45 && duration <= 55.25, `출력 길이가 45~55초가 아닙니다 (${duration})`);
  const outputStat = await stat(outputPath);
  assert(outputStat.size <= 24_000_000, `Gmail 첨부 상한을 위한 24MB 예산을 넘었습니다 (${outputStat.size} bytes)`);
  await runProcess(ffmpeg, [
    "-v", "error", "-xerror", "-err_detect", "explode", "-i", outputPath,
    "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-",
  ], 60_000);
  return { duration, video, audio, sizeBytes: outputStat.size };
}

async function main(options) {
  const ffmpeg = commandPath("ffmpeg");
  const ffprobe = commandPath("ffprobe");
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  assert(ffmpeg, "FFmpeg를 찾지 못했습니다. PATH에 ffmpeg를 추가하세요.");
  assert(ffprobe, "FFprobe를 찾지 못했습니다. PATH에 ffprobe를 추가하세요.");
  assert(existsSync(npmCli), `npm CLI를 찾지 못했습니다: ${npmCli}`);
  await stat(BGM);
  await runProcess(process.execPath, [npmCli, "run", "build"], 120_000);
  console.log("fresh build PASS · npm run build");
  await prepareOutput(options);

  const browserPath = findBrowser();
  const profileDir = await mkdtemp(join(tmpdir(), "nyang-submission-browser-"));
  let serverResource = null;
  let browserProcess = null;
  let cdp = null;
  let recording = false;
  try {
    serverResource = await startStaticServer();
    const { origin, requests } = serverResource;
    const args = [
      "--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update",
      "--disable-default-apps", "--disable-extensions", "--disable-sync", "--hide-scrollbars", "--mute-audio",
      "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`,
      `--window-size=${WIDTH},${HEIGHT}`, "about:blank",
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) args.unshift("--no-sandbox");
    browserProcess = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const browserSocket = await waitForDevTools(browserProcess, profileDir);
    cdp = await connectCdpWhenReady(browserSocket, browserProcess);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const faults = { exceptions: [], consoleErrors: [], logErrors: [], httpErrors: [], loadingFailures: [], frameErrors: [] };
    const frames = [];
    let frameWrites = Promise.resolve();
    cdp.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") faults.exceptions.push(message.params.exceptionDetails);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") faults.consoleErrors.push(message.params.args);
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        if (!(entry.source === "security" && /Unrecognized Content-Security-Policy directive 'webrtc'/u.test(entry.text))) {
          faults.logErrors.push(entry);
        }
      }
      if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        faults.httpErrors.push({ url: message.params.response.url, status: message.params.response.status });
      }
      if (message.method === "Network.loadingFailed" && !message.params.canceled) {
        faults.loadingFailures.push(message.params.errorText);
      }
      if (message.method === "Page.screencastFrame") {
        const index = frames.length + 1;
        const name = `frame-${String(index).padStart(6, "0")}.jpg`;
        frames.push({ name, timestamp: message.params.metadata?.timestamp ?? index / 30 });
        frameWrites = frameWrites.then(() => writeFile(join(options.framesDir, name), Buffer.from(message.params.data, "base64")));
        void cdp.send("Page.screencastFrameAck", { sessionId: message.params.sessionId }, sessionId)
          .catch((error) => faults.frameErrors.push(error.message));
      }
    });
    await Promise.all([
      cdp.send("Runtime.enable", {}, sessionId), cdp.send("Page.enable", {}, sessionId),
      cdp.send("Network.enable", {}, sessionId), cdp.send("Log.enable", {}, sessionId),
    ]);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
      screenOrientation: { type: "landscapePrimary", angle: 90 },
    }, sessionId);
    await cdp.send("Target.activateTarget", { targetId });
    await cdp.send("Page.navigate", { url: `${origin}${APP_BASE}/?seed=424242&debug=1` }, sessionId);
    await waitFor(
      "게임 부트",
      () => evaluate(cdp, sessionId, `(() => ({
        ready: Boolean(window.nyang),
        bootGone: document.querySelector('#boot')?.classList.contains('gone'),
        assetsReady: window.nyang?.runtime?.assetsReady,
        frames: window.nyang?.runtime?.frameCount,
        phase: window.nyang?.phase,
      }))()`),
      (value) => value?.ready && value.bootGone && value.assetsReady && value.frames >= 2 && value.phase === "map",
      30_000,
    );
    await evaluate(cdp, sessionId, `document.fonts.ready`);

    await cdp.send("Page.startScreencast", {
      format: "jpeg", quality: 90, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 2,
    }, sessionId);
    recording = true;
    const captureStartedAt = Date.now();
    const holdUntil = async (seconds) => {
      const remaining = captureStartedAt + seconds * 1000 - Date.now();
      if (remaining > 0) await delay(remaining);
    };
    const holdScene = (secondsOnDefaultTimeline) => holdUntil(
      secondsOnDefaultTimeline * options.durationSeconds / DEFAULT_DURATION_SECONDS,
    );

    await holdScene(2.5);
    await pressDigit(cdp, sessionId, 1);
    await waitFor(
      "계약 선택",
      () => evaluate(cdp, sessionId, `({ phase: window.nyang.phase, offers: window.nyang.raidOffers.length, contract: window.nyang.raidContract })`),
      (value) => value?.phase === "map" && value.offers === 0 && value.contract,
    );

    await holdScene(5.5);
    await pressDigit(cdp, sessionId, 1);
    await waitFor("첫 상점", () => evaluate(cdp, sessionId, `window.nyang.phase`), (phase) => phase === "reward");

    await holdScene(9);
    await pressDigit(cdp, sessionId, 1);
    await waitFor(
      "첫 고양이 구매",
      () => evaluate(cdp, sessionId, `window.nyang.allies`),
      (count) => count >= 1,
    );
    await holdScene(10.5);
    await pressDigit(cdp, sessionId, 2);
    await waitFor(
      "두 번째 고양이 구매",
      () => evaluate(cdp, sessionId, `window.nyang.allies`),
      (count) => count >= 2,
    );

    await holdScene(12.5);
    await clickGameButton(cdp, sessionId);
    await waitFor("전투 진입", () => evaluate(cdp, sessionId, `window.nyang.phase`), (phase) => phase === "battle");
    const combatBefore = await evaluate(cdp, sessionId, `(() => {
      const totals = window.nyang.combat.totals;
      return {
        attacks: Object.values(totals.attacks).reduce((sum, count) => sum + count, 0),
        hits: Object.values(totals.hits).reduce((sum, count) => sum + count, 0),
      };
    })()`);
    const combatAfter = await waitFor(
      "자연 전투 공격/피격",
      () => evaluate(cdp, sessionId, `(() => {
        const totals = window.nyang.combat.totals;
        return {
          phase: window.nyang.phase,
          attacks: Object.values(totals.attacks).reduce((sum, count) => sum + count, 0),
          hits: Object.values(totals.hits).reduce((sum, count) => sum + count, 0),
        };
      })()`),
      (value) => value?.attacks > combatBefore.attacks && value.hits > combatBefore.hits,
      18_000,
    );
    assert(combatAfter.attacks > combatBefore.attacks && combatAfter.hits > combatBefore.hits,
      `실제 공격/피격 피드백이 발생하지 않았습니다 (${JSON.stringify({ combatBefore, combatAfter })})`);
    let dodgeUsed = false;
    let battleOutcome = null;
    const battleObservationDeadline = captureStartedAt + (options.durationSeconds - 5) * 1000;
    while (Date.now() < battleObservationDeadline) {
      const observation = await evaluate(cdp, sessionId, `({
        phase: window.nyang.phase,
        stage: window.nyang.stage,
        step: window.nyang.step,
        gold: window.nyang.gold,
        dodgeCharges: window.nyang.dodgeCharges,
        telegraphs: window.nyang.telegraphs,
      })`);
      if (observation.phase !== "battle") {
        battleOutcome = observation;
        break;
      }
      if (!dodgeUsed && observation.dodgeCharges > 0 && observation.telegraphs.includes("avoid")) {
        const chargesBefore = observation.dodgeCharges;
        await clickGameButton(cdp, sessionId, 0.25);
        await waitFor(
          "자연 전투 회피 클릭",
          () => evaluate(cdp, sessionId, `window.nyang.dodgeCharges`),
          (charges) => charges === chargesBefore - 1,
          5_000,
        );
        dodgeUsed = true;
      }
      await delay(100);
    }
    let currentState = battleOutcome ?? await evaluate(cdp, sessionId, `({
      phase: window.nyang.phase, stage: window.nyang.stage, step: window.nyang.step, gold: window.nyang.gold
    })`);
    let continuationBattles = 0;
    let continuationPurchases = 0;
    let continuationCombatVerified = 0;
    const continuationDeadline = captureStartedAt + (options.durationSeconds - 1) * 1000;
    while (Date.now() < continuationDeadline && currentState.phase !== "gameover") {
      const remainingMs = () => continuationDeadline - Date.now();
      if (currentState.phase === "map") {
        await delay(Math.min(1_500, Math.max(0, remainingMs())));
        if (remainingMs() <= 2_000) break;
        await pressDigit(cdp, sessionId, 1);
        currentState = await waitFor(
          "연속 런 다음 지도 노드",
          () => evaluate(cdp, sessionId, `({
            phase: window.nyang.phase, stage: window.nyang.stage, step: window.nyang.step, gold: window.nyang.gold
          })`),
          (value) => value?.phase !== "map",
          Math.min(8_000, remainingMs()),
        );
        continue;
      }

      if (currentState.phase === "reward") {
        await delay(Math.min(1_000, Math.max(0, remainingMs())));
        if (remainingMs() <= 3_000) break;
        let shop = await evaluate(cdp, sessionId, `({
          gold: window.nyang.gold,
          offers: window.nyang.offers,
          relicDraft: window.nyang.relicDraft,
        })`);
        if (shop.relicDraft.active) {
          await clickGameButton(cdp, sessionId);
          await waitFor(
            "연속 런 유물 선택 종료",
            () => evaluate(cdp, sessionId, `window.nyang.relicDraft.active`),
            (active) => !active,
            Math.min(5_000, remainingMs()),
          );
          shop = await evaluate(cdp, sessionId, `({
            gold: window.nyang.gold, offers: window.nyang.offers, relicDraft: window.nyang.relicDraft
          })`);
        }
        for (let purchase = 0; purchase < 2 && remainingMs() > 3_000; purchase += 1) {
          const offerIndex = shop.offers.findIndex((offer) => offer && offer.cost <= shop.gold);
          if (offerIndex < 0) break;
          const beforeGold = shop.gold;
          const beforeLabel = shop.offers[offerIndex].label;
          await pressDigit(cdp, sessionId, offerIndex + 1);
          shop = await waitFor(
            `연속 런 상점 영입 ${purchase + 1}`,
            () => evaluate(cdp, sessionId, `({ gold: window.nyang.gold, offers: window.nyang.offers })`),
            (value) => value?.gold < beforeGold || value?.offers?.[offerIndex]?.label !== beforeLabel,
            Math.min(5_000, remainingMs()),
          );
          continuationPurchases += 1;
          await delay(Math.min(500, Math.max(0, remainingMs())));
        }
        if (remainingMs() <= 2_000) break;
        await clickGameButton(cdp, sessionId);
        currentState = await waitFor(
          "연속 런 다음 전투 시작",
          () => evaluate(cdp, sessionId, `({
            phase: window.nyang.phase, stage: window.nyang.stage, step: window.nyang.step, gold: window.nyang.gold
          })`),
          (value) => value?.phase === "battle",
          Math.min(8_000, remainingMs()),
        );
        continuationBattles += 1;
        continue;
      }

      if (currentState.phase === "battle") {
        const before = await evaluate(cdp, sessionId, `(() => {
          const totals = window.nyang.combat.totals;
          return {
            attacks: Object.values(totals.attacks).reduce((sum, count) => sum + count, 0),
            hits: Object.values(totals.hits).reduce((sum, count) => sum + count, 0),
          };
        })()`);
        let verifiedThisBattle = false;
        while (Date.now() < continuationDeadline) {
          const observation = await evaluate(cdp, sessionId, `(() => {
            const totals = window.nyang.combat.totals;
            return {
              phase: window.nyang.phase,
              stage: window.nyang.stage,
              step: window.nyang.step,
              gold: window.nyang.gold,
              dodgeCharges: window.nyang.dodgeCharges,
              telegraphs: window.nyang.telegraphs,
              attacks: Object.values(totals.attacks).reduce((sum, count) => sum + count, 0),
              hits: Object.values(totals.hits).reduce((sum, count) => sum + count, 0),
            };
          })()`);
          if (!verifiedThisBattle && observation.attacks > before.attacks && observation.hits > before.hits) {
            verifiedThisBattle = true;
            continuationCombatVerified += 1;
          }
          if (!dodgeUsed && observation.dodgeCharges > 0 && observation.telegraphs.includes("avoid")) {
            const chargesBefore = observation.dodgeCharges;
            await clickGameButton(cdp, sessionId, 0.25);
            await waitFor(
              "연속 런 자연 회피 클릭",
              () => evaluate(cdp, sessionId, `window.nyang.dodgeCharges`),
              (charges) => charges === chargesBefore - 1,
              Math.min(5_000, remainingMs()),
            );
            dodgeUsed = true;
          }
          if (observation.phase !== "battle") {
            currentState = observation;
            break;
          }
          currentState = observation;
          await delay(100);
        }
        continue;
      }

      break;
    }
    assert(continuationBattles >= 1, "첫 승리 뒤 실제 다음 전투를 시작하지 못했습니다");
    assert(continuationPurchases >= 1, "첫 승리 뒤 실제 상점 영입을 수행하지 못했습니다");
    assert(continuationCombatVerified >= 1, "연속 런 두 번째 전투의 자연 공격/피격을 확인하지 못했습니다");
    const finalGameplayState = await evaluate(cdp, sessionId, `({
      phase: window.nyang.phase, stage: window.nyang.stage, step: window.nyang.step, gold: window.nyang.gold
    })`);

    await holdUntil(options.durationSeconds);
    await cdp.send("Page.stopScreencast", {}, sessionId);
    recording = false;
    await delay(250);
    await frameWrites;

    const captureElapsed = (Date.now() - captureStartedAt) / 1000;
    assert(captureElapsed >= options.durationSeconds && captureElapsed <= options.durationSeconds + 2,
      `실제 캡처 시간이 범위를 벗어났습니다 (${captureElapsed.toFixed(3)}초)`);
    assert(frames.length >= options.durationSeconds * 20,
      `screencast 프레임이 부족합니다 (${frames.length}/${options.durationSeconds}초)`);
    assert(faults.exceptions.length === 0, `Runtime 예외 ${faults.exceptions.length}건`);
    assert(faults.consoleErrors.length === 0, `console.error ${faults.consoleErrors.length}건`);
    assert(faults.logErrors.length === 0, `브라우저 Log error ${faults.logErrors.length}건`);
    assert(faults.httpErrors.length === 0, `HTTP 오류 ${faults.httpErrors.length}건`);
    assert(faults.loadingFailures.length === 0, `리소스 로드 실패 ${faults.loadingFailures.length}건`);
    assert(faults.frameErrors.length === 0, `screencast ACK 오류 ${faults.frameErrors.length}건`);
    assert(requests.every((request) => request.status < 400), "정적 서버 요청 오류가 발생했습니다");

    const encoded = await encodeVideo({ ffmpeg, ffprobe, framesDir: options.framesDir, outputPath: options.outputPath, frames });
    console.log(JSON.stringify({
      status: "PASS",
      output: options.outputPath,
      frames: options.framesDir,
      capturedFrames: frames.length,
      wallDurationSeconds: Number(captureElapsed.toFixed(3)),
      encodedDurationSeconds: encoded.duration,
      video: { codec: encoded.video.codec_name, width: encoded.video.width, height: encoded.video.height,
        pixelFormat: encoded.video.pix_fmt, frameRate: encoded.video.avg_frame_rate },
      audio: { codec: encoded.audio.codec_name, sampleRate: encoded.audio.sample_rate, channels: encoded.audio.channels },
      sizeBytes: encoded.sizeBytes,
      flow: [
        "계약 선택", "지도", "고양이 2마리 구매", "실제 전투 공격/피격",
        ...(dodgeUsed ? ["자연 예고에서 회피 클릭"] : []),
        ...(battleOutcome ? [`전투 종료 → ${battleOutcome.phase}`] : ["제한시간까지 실제 전투"]),
        `다음 지도→상점 영입 ${continuationPurchases}회→추가 전투 ${continuationBattles}회`,
      ],
      finalGameplayState,
    }, null, 2));
  } finally {
    if (recording && cdp) {
      try { await cdp.send("Page.stopScreencast"); } catch { /* 종료 중 소켓 단절 */ }
    }
    if (cdp) {
      try { await Promise.race([cdp.send("Browser.close"), delay(1_000)]); } catch { /* 정상 종료 경쟁 */ }
    }
    const browserRunning = () => browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null;
    if (browserRunning()) {
      await Promise.race([new Promise((resolveExit) => browserProcess.once("exit", resolveExit)), delay(2_000)]);
      if (browserRunning()) browserProcess.kill();
      await Promise.race([new Promise((resolveExit) => browserProcess.once("exit", resolveExit)), delay(2_000)]);
      if (browserRunning()) browserProcess.kill("SIGKILL");
      await Promise.race([new Promise((resolveExit) => browserProcess.once("exit", resolveExit)), delay(2_000)]);
      assert(!browserRunning(), "브라우저 프로세스 종료 실패");
    }
    if (serverResource) await closeServer(serverResource.server);
    const safeTempRoot = `${resolve(tmpdir())}${sep}`;
    assert(resolve(profileDir).startsWith(safeTempRoot), "임시 브라우저 프로필이 안전 범위 밖입니다");
    await rm(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

const options = parseCli();
if (options) await main(options);
