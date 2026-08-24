import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const APP_BASE = "/nyang-arena";
const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
    throw new Error(
      "Chrome/Edge 실행 파일을 찾지 못했습니다. NYANG_BROWSER, BROWSER_BIN 또는 CHROME_BIN에 경로를 지정하세요.",
    );
  }
  return browser;
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
  return {
    server,
    requests,
    origin: `http://127.0.0.1:${address.port}`,
  };
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
        // 파일은 브라우저가 디버깅 소켓을 연 뒤 생성된다.
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
    socket.addEventListener("error", () => rejectPending("CDP 연결 오류가 발생했습니다"));
    socket.addEventListener("close", () => rejectPending("CDP 연결이 닫혔습니다"));
  }

  static async connect(url, openTimeoutMs = 10_000) {
    const socket = new WebSocket(url);
    try {
      await new Promise((resolveOpen, rejectOpen) => {
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeEventListener("open", onOpen);
          socket.removeEventListener("error", onError);
          socket.removeEventListener("close", onClose);
        };
        const onOpen = () => {
          cleanup();
          resolveOpen();
        };
        const onError = () => {
          cleanup();
          rejectOpen(new Error(`CDP 연결 실패: ${url}`));
        };
        const onClose = () => {
          cleanup();
          rejectOpen(new Error(`CDP 연결 전 소켓 종료: ${url}`));
        };
        const timer = setTimeout(() => {
          cleanup();
          rejectOpen(new Error(`CDP 연결 ${openTimeoutMs}ms 시간 초과: ${url}`));
        }, openTimeoutMs);
        socket.addEventListener("open", onOpen);
        socket.addEventListener("error", onError);
        socket.addEventListener("close", onClose);
      });
    } catch (error) {
      try {
        socket.close();
      } catch {
        // 아직 연결되지 않은 소켓은 close 자체가 실패할 수 있다.
      }
      throw error;
    }
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(`브라우저 평가 실패: ${result.exceptionDetails.text ?? expression}`);
  }
  return result.result?.value;
}

async function pressDigit1(cdp, sessionId) {
  const common = { key: "1", code: "Digit1", windowsVirtualKeyCode: 49, nativeVirtualKeyCode: 49 };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...common }, sessionId);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common }, sessionId);
}

async function clickPoint(cdp, sessionId, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 },
    sessionId,
  );
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function main() {
  const browserPath = findBrowser();
  const profileDir = await mkdtemp(join(tmpdir(), "nyang-browser-runtime-"));
  let serverResource = null;
  let browserProcess = null;
  let cdp = null;
  try {
    serverResource = await startStaticServer();
    const { requests, origin } = serverResource;
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) args.unshift("--no-sandbox");
    browserProcess = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const browserSocket = await waitForDevTools(browserProcess, profileDir);
    cdp = await CdpConnection.connect(browserSocket);
    const browserVersion = await cdp.send("Browser.getVersion");

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const faults = {
      exceptions: [],
      consoleErrors: [],
      logErrors: [],
      compatibilityNotices: [],
      httpErrors: [],
      externalRequests: [],
      loadingFailures: [],
      forbiddenChannels: [],
    };
    const pendingRequests = new Set();
    let lastNetworkActivity = Date.now();
    cdp.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") faults.exceptions.push(message.params.exceptionDetails);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        faults.consoleErrors.push(message.params.args);
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        // Chromium 140은 CSP3의 `webrtc 'block'`을 아직 모르는 보안 호환성
        // 진단을 error 레벨로 낸다. 실제 console.error와 런타임 오류는 아니다.
        if (entry.source === "security" && /Unrecognized Content-Security-Policy directive 'webrtc'/u.test(entry.text)) {
          faults.compatibilityNotices.push(entry);
        } else {
          faults.logErrors.push(entry);
        }
      }
      if (message.method === "Network.requestWillBeSent") {
        const requestUrl = message.params.request.url;
        lastNetworkActivity = Date.now();
        if (/^https?:/u.test(requestUrl)) pendingRequests.add(message.params.requestId);
        if (/^https?:/u.test(requestUrl) && new URL(requestUrl).origin !== origin) faults.externalRequests.push(requestUrl);
        if (message.params.type === "EventSource") {
          faults.forbiddenChannels.push({ kind: "EventSource", url: requestUrl });
        }
      }
      if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        faults.httpErrors.push({ url: message.params.response.url, status: message.params.response.status });
      }
      if (message.method === "Network.loadingFinished" || message.method === "Network.loadingFailed") {
        lastNetworkActivity = Date.now();
        pendingRequests.delete(message.params.requestId);
        if (message.method === "Network.loadingFailed" && !message.params.canceled) {
          faults.loadingFailures.push(message.params.errorText);
        }
      }
      if (message.method === "Network.webSocketCreated") {
        faults.forbiddenChannels.push({ kind: "WebSocket", url: message.params.url });
      }
      if (message.method === "Network.webTransportCreated") {
        faults.forbiddenChannels.push({ kind: "WebTransport", url: message.params.url });
      }
    });
    await Promise.all([
      cdp.send("Runtime.enable", {}, sessionId),
      cdp.send("Page.enable", {}, sessionId),
      cdp.send("Network.enable", {}, sessionId),
      cdp.send("Log.enable", {}, sessionId),
    ]);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
      screenOrientation: { type: "landscapePrimary", angle: 90 },
    }, sessionId);
    await cdp.send("Target.activateTarget", { targetId });
    await cdp.send("Page.navigate", { url: `${origin}${APP_BASE}/?seed=424242&debug=1` }, sessionId);

    let bootState;
    try {
      bootState = await waitFor(
        "production bundle 부트",
        () => evaluate(cdp, sessionId, `(() => {
        const canvas = document.querySelector("canvas");
        const boot = document.querySelector("#boot");
        if (!canvas || !window.nyang) return {
          href: location.href,
          readyState: document.readyState,
          canvas: Boolean(canvas),
          debugSurface: Boolean(window.nyang),
          body: document.body?.innerText?.slice(0, 200) ?? "",
        };
        const rect = canvas.getBoundingClientRect();
        const context = canvas.getContext("2d");
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        const stride = Math.max(4, Math.floor((canvas.width * canvas.height) / 12000) * 4);
        for (let i = 0; i < pixels.length; i += stride) {
          colors.add(pixels[i] + "," + pixels[i + 1] + "," + pixels[i + 2] + "," + pixels[i + 3]);
          if (colors.size >= 16) break;
        }
        return {
          bootGone: boot.classList.contains("gone"),
          inner: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          css: { width: rect.width, height: rect.height },
          backing: { width: canvas.width, height: canvas.height },
          uniqueColors: colors.size,
          phase: window.nyang.phase,
          raidOffers: window.nyang.raidOffers.length,
          a11yButtons: document.querySelectorAll(".raid-a11y-controls:not([hidden]) button:not([hidden])").length,
          runtime: window.nyang.runtime,
        };
        })()`),
        (value) => value?.bootGone && value.runtime?.assetsReady && value.runtime?.booted && value.runtime?.frameCount >= 1,
        30_000,
      );
    } catch (error) {
      console.error("browser-runtime boot diagnostics", JSON.stringify({ requests, faults }, null, 2));
      throw error;
    }
    assert(bootState.inner.width === 1280 && bootState.inner.height === 800, "초기 viewport가 1280x800이 아닙니다");
    assert(bootState.css.width === 1280 && bootState.css.height === 800, "캔버스 CSS 크기가 viewport와 다릅니다");
    assert(bootState.backing.width === 1280 && bootState.backing.height === 800, "캔버스 backing 크기가 DPR과 다릅니다");
    assert(bootState.uniqueColors >= 4, `캔버스가 단색에 가깝습니다 (${bootState.uniqueColors}색)`);
    assert(bootState.phase === "map" && bootState.raidOffers === 3, "초기 계약 세 장이 열리지 않았습니다");
    assert(bootState.a11yButtons === 3, `접근성 계약 버튼이 세 개가 아닙니다 (${bootState.a11yButtons})`);
    console.log(
      `browser-runtime boot PASS · ${browserVersion.product} · protocol ${browserVersion.protocolVersion} · ${basename(browserPath)} · colors ${bootState.uniqueColors}`,
    );

    // 첫 프레임의 페이즈 잠금은 실제 사용자 입력에도 적용된다.
    await delay(400);
    await pressDigit1(cdp, sessionId);
    const contractState = await waitFor(
      "계약 키보드 선택",
      () => evaluate(cdp, sessionId, `({
        phase: window.nyang.phase,
        raidOffers: window.nyang.raidOffers.length,
        contract: window.nyang.raidContract,
        href: location.href,
        lastInput: window.nyang.runtime.lastInput,
      })`),
      (value) => value?.phase === "map" && value.raidOffers === 0 && value.contract && new URL(value.href).searchParams.has("raid"),
    );
    assert(contractState.lastInput?.code === "Digit1", "실제 Digit1 입력이 런타임 경계에 기록되지 않았습니다");
    await delay(400);
    await pressDigit1(cdp, sessionId);
    const rewardState = await waitFor(
      "지도 선택 후 보상",
      () => evaluate(cdp, sessionId, `({ phase: window.nyang.phase, step: window.nyang.step, button: window.nyang.button })`),
      (value) => value?.phase === "reward" && value.step === 0 && value.button?.w > 0,
    );
    console.log("browser-runtime keyboard route PASS · map→reward");

    const clickX = rewardState.button.x + rewardState.button.w / 2;
    const clickY = rewardState.button.y + rewardState.button.h / 2;
    await delay(400);
    await clickPoint(cdp, sessionId, clickX, clickY);
    await waitFor(
      "보상 버튼에서 전투 진입",
      () => evaluate(cdp, sessionId, `({ phase: window.nyang.phase, lastInput: window.nyang.runtime.lastInput })`),
      (value) => value?.phase === "battle" && value.lastInput?.kind === "pointer-up",
    );
    console.log("browser-runtime pointer route PASS · reward→battle");

    const beforeResize = await evaluate(cdp, sessionId, `window.nyang.runtime`);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 800,
      height: 1280,
      deviceScaleFactor: 2,
      mobile: false,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    }, sessionId);
    const resized = await waitFor(
      "세로 viewport 적용",
      () => evaluate(cdp, sessionId, `(() => {
        const canvas = document.querySelector("canvas");
        const rect = canvas.getBoundingClientRect();
        return {
          inner: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          css: { width: rect.width, height: rect.height },
          backing: { width: canvas.width, height: canvas.height },
          orientation: { type: screen.orientation.type, angle: screen.orientation.angle },
          button: window.nyang.button,
          runtime: window.nyang.runtime,
        };
      })()`),
      (value) => value?.inner.width === 800
        && value.inner.height === 1280
        && value.runtime.resizeCount > beforeResize.resizeCount
        && value.runtime.orientationCount > beforeResize.orientationCount,
    );
    assert(resized.css.width === 800 && resized.css.height === 1280, "세로 캔버스 CSS 크기가 viewport와 다릅니다");
    assert(resized.backing.width === 1600 && resized.backing.height === 2560, "세로 캔버스 backing/DPR가 다릅니다");
    assert(resized.orientation.type === "portrait-primary" && resized.orientation.angle === 0, "화면 방향 값이 갱신되지 않았습니다");
    assert(
      resized.button.w > 0 && resized.button.h > 0
        && resized.button.x >= 0 && resized.button.y >= 0
        && resized.button.x + resized.button.w <= 800
        && resized.button.y + resized.button.h <= 1280,
      "세로 화면의 주 버튼이 viewport 밖으로 나갔습니다",
    );
    assert(resized.runtime.lastResize.width === 800 && resized.runtime.lastResize.height === 1280, "마지막 resize 관찰값이 다릅니다");
    console.log("browser-runtime resize PASS · 1280x800→800x1280 @2x");

    const baselineStart = await evaluate(cdp, sessionId, `window.nyang.runtime.frameCount`);
    await delay(350);
    const baselineEnd = await evaluate(cdp, sessionId, `window.nyang.runtime.frameCount`);
    const baselineFrames = baselineEnd - baselineStart;
    assert(baselineFrames >= 2, `활성 탭 baseline cadence가 너무 낮습니다 (${baselineFrames}/350ms)`);

    const { targetId: blankTargetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await cdp.send("Target.activateTarget", { targetId: blankTargetId });
      const hidden = await waitFor(
        `게임 탭 숨김 ${cycle}`,
        () => evaluate(cdp, sessionId, `({ hidden: document.hidden, runtime: window.nyang.runtime })`),
        (value) => value?.hidden && value.runtime.paused,
      );
      const hiddenFrame = hidden.runtime.frameCount;
      await delay(300);
      const held = await evaluate(cdp, sessionId, `({ hidden: document.hidden, runtime: window.nyang.runtime })`);
      assert(held.hidden && held.runtime.frameCount === hiddenFrame, `숨김 ${cycle}회차에 프레임이 진행됐습니다`);

      await cdp.send("Target.activateTarget", { targetId });
      const resumed = await waitFor(
        `게임 탭 복귀 ${cycle}`,
        () => evaluate(cdp, sessionId, `({ hidden: document.hidden, runtime: window.nyang.runtime })`),
        (value) => !value?.hidden
          && !value.runtime.paused
          && value.runtime.frameCount >= hiddenFrame + 2
          && value.runtime.resumeCount > hidden.runtime.resumeCount,
      );
      assert(
        Math.abs(resumed.runtime.resumeFirstDt - 16) <= 0.01,
        `복귀 ${cycle}회차 첫 dt가 16ms가 아닙니다 (${resumed.runtime.resumeFirstDt})`,
      );
      const cadenceStart = resumed.runtime.frameCount;
      await delay(350);
      const cadenceEnd = await evaluate(cdp, sessionId, `window.nyang.runtime.frameCount`);
      const cadenceFrames = cadenceEnd - cadenceStart;
      const relativeCeiling = Math.ceil(baselineFrames * 1.75) + 2;
      assert(
        cadenceFrames >= 2 && cadenceFrames <= relativeCeiling,
        `복귀 ${cycle}회차 rAF cadence가 baseline 대비 배증했습니다 (${cadenceFrames}/${baselineFrames}, 상한 ${relativeCeiling})`,
      );
    }
    console.log("browser-runtime visibility PASS · 2x hidden freeze→16ms single-cadence resume");

    await waitFor(
      "네트워크 유휴",
      async () => ({ pending: pendingRequests.size, idleMs: Date.now() - lastNetworkActivity }),
      (value) => value.pending === 0 && value.idleMs >= 500,
      10_000,
    );
    const serverErrors = requests.filter((request) => request.status >= 400);
    assert(faults.exceptions.length === 0, `Runtime 예외 ${faults.exceptions.length}건`);
    assert(faults.consoleErrors.length === 0, `console.error ${faults.consoleErrors.length}건`);
    assert(faults.logErrors.length === 0, `브라우저 Log error ${faults.logErrors.length}건`);
    assert(faults.httpErrors.length === 0 && serverErrors.length === 0, "HTTP 오류가 발생했습니다");
    assert(faults.loadingFailures.length === 0, `리소스 로드 실패 ${faults.loadingFailures.length}건`);
    assert(faults.externalRequests.length === 0, `외부 origin 요청: ${faults.externalRequests.join(", ")}`);
    assert(faults.forbiddenChannels.length === 0, `금지 네트워크 채널: ${JSON.stringify(faults.forbiddenChannels)}`);
    console.log(
      `browser-runtime boundary PASS · HTTP ${requests.length} · external/forbidden/errors 0 · CSP compat ${faults.compatibilityNotices.length}`,
    );
  } finally {
    if (cdp) {
      try {
        await Promise.race([cdp.send("Browser.close"), delay(1_000)]);
      } catch {
        // 브라우저가 응답보다 먼저 소켓을 닫는 정상 종료도 있다.
      }
    }
    const browserRunning = () => browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null;
    if (browserRunning()) {
      await Promise.race([
        new Promise((resolveExit) => browserProcess.once("exit", resolveExit)),
        delay(2_000),
      ]);
      if (browserRunning()) {
        browserProcess.kill();
        await Promise.race([
          new Promise((resolveExit) => browserProcess.once("exit", resolveExit)),
          delay(2_000),
        ]);
      }
      if (browserRunning()) {
        browserProcess.kill("SIGKILL");
        await Promise.race([
          new Promise((resolveExit) => browserProcess.once("exit", resolveExit)),
          delay(2_000),
        ]);
      }
      assert(!browserRunning(), "브라우저 프로세스가 제한시간 안에 종료되지 않았습니다");
    }
    if (serverResource) await closeServer(serverResource.server);
    const safeTempRoot = `${resolve(tmpdir())}${sep}`;
    assert(resolve(profileDir).startsWith(safeTempRoot), "임시 브라우저 프로필 경로가 안전 범위 밖입니다");
    await rm(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

await main();
