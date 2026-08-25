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

async function connectCdpWhenReady(url, browserProcess, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`CDP 연결 전 브라우저가 조기 종료했습니다 (${browserProcess.exitCode})`);
    }
    try {
      // DevToolsActivePort는 WebSocket accept보다 아주 조금 먼저 생길 수 있다.
      // 전체 테스트를 재시도하지 않고 이 readiness 경계만 짧게 다시 확인한다.
      return await CdpConnection.connect(url, 750);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(`CDP readiness ${timeoutMs}ms 시간 초과: ${lastError?.message ?? "알 수 없는 오류"}`);
}

async function pressKey(cdp, sessionId, { key, code, keyCode, text = "" }) {
  const common = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };
  await cdp.send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    ...common,
    ...(text ? { text, unmodifiedText: text } : {}),
  }, sessionId);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...common }, sessionId);
}

async function pressDigit1(cdp, sessionId) {
  await pressKey(cdp, sessionId, { key: "1", code: "Digit1", keyCode: 49 });
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
    cdp = await connectCdpWhenReady(browserSocket, browserProcess);
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
    const pageRequests = [];
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
        if (/^https?:/u.test(requestUrl)) {
          pendingRequests.add(message.params.requestId);
          pageRequests.push(requestUrl);
        }
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
      cdp.send("Accessibility.enable", {}, sessionId),
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
          a11yButtons: document.querySelectorAll(".game-a11y-controls button:not([hidden])").length,
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
    assert(bootState.a11yButtons === 4, `접근성 계약 3개와 음소거 버튼이 준비되지 않았습니다 (${bootState.a11yButtons})`);
    assert(bootState.runtime.sprites.state === "ready", `sprite 상태가 ready가 아닙니다 (${bootState.runtime.sprites.state})`);
    assert(bootState.runtime.sprites.frameDescriptors === 186 && bootState.runtime.sprites.fallbackFrames === 0, "186 frame descriptor가 준비되지 않았습니다");
    const happyAtlasRequests = pageRequests.filter((url) => /\/sprites\/atlas-(?:base|extra)\.png(?:$|\?)/u.test(url));
    const happyLegacyRequests = pageRequests.filter((url) => /\/sprites\/\d{2}_[a-z]+\.png(?:$|\?)/u.test(url));
    assert(happyAtlasRequests.length === 2, `정상 sprite 요청이 정확히 2회가 아닙니다 (${happyAtlasRequests.length})`);
    assert(new Set(happyAtlasRequests.map((url) => new URL(url).pathname)).size === 2, "같은 atlas가 중복 요청됐습니다");
    assert(happyLegacyRequests.length === 0, `legacy 개별 sprite 요청 ${happyLegacyRequests.length}회`);
    console.log(
      `browser-runtime boot PASS · ${browserVersion.product} · protocol ${browserVersion.protocolVersion} · ${basename(browserPath)} · colors ${bootState.uniqueColors}`,
    );

    const initialAccessibility = await evaluate(cdp, sessionId, `(() => {
      const panel = document.querySelector(".game-a11y-controls");
      const buttons = [...panel.querySelectorAll("button:not([hidden])")];
      const first = buttons.find((button) => button.dataset.focusKey?.startsWith("raid-contract:"));
      first.focus();
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const actionButtons = [...panel.querySelectorAll(".game-a11y-actions > button:not([hidden])")];
        const rects = actionButtons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { key: button.dataset.focusKey, width: rect.width, height: rect.height, x: rect.x, y: rect.y };
        });
        resolve({
          buttonNames: buttons.map((button) => button.textContent.trim()),
          buttonSizes: buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
          focusKey: document.activeElement?.dataset.focusKey ?? null,
          rects,
          actionGap: Number.parseFloat(getComputedStyle(panel.querySelector(".game-a11y-actions")).gap),
          politeUpdates: window.nyang.runtime.accessibility.politeUpdates,
        });
      })));
    })()`);
    assert(initialAccessibility.focusKey?.startsWith("raid-contract:"), "첫 계약 DOM 버튼에 focus하지 못했습니다");
    assert(initialAccessibility.buttonNames.length === 4 && initialAccessibility.buttonNames.every(Boolean), "초기 접근성 버튼 이름이 비었습니다");
    assert(initialAccessibility.buttonSizes.every((rect) => rect.width >= 44 && rect.height >= 44), "초기 DOM 버튼이 44px 하한을 지키지 않았습니다");
    assert(initialAccessibility.actionGap >= 12, `desktop 접근성 버튼 간격이 12px 미만입니다 (${initialAccessibility.actionGap})`);
    const sameRowPair = initialAccessibility.rects
      .slice(1)
      .map((rect, index) => ({ left: initialAccessibility.rects[index], right: rect }))
      .find(({ left, right }) => Math.abs(left.y - right.y) < 1);
    if (sameRowPair) {
      assert(
        sameRowPair.right.x - (sameRowPair.left.x + sameRowPair.left.width) >= 12,
        "desktop 접근성 sibling의 실제 가로 간격이 12px 미만입니다",
      );
    }

    const { nodes: axNodes } = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
    const axRoles = axNodes.map((node) => node.role?.value);
    const axButtonNames = axNodes
      .filter((node) => node.role?.value === "button" && !node.ignored)
      .map((node) => node.name?.value ?? "");
    assert(axRoles.includes("status") && axRoles.includes("alert"), "AX tree에 status/alert live region이 없습니다");
    assert(
      initialAccessibility.buttonNames.every((name) => axButtonNames.includes(name)),
      "AX tree에서 초기 계약 3개와 음소거의 접근 가능한 이름을 찾지 못했습니다",
    );

    await pressKey(cdp, sessionId, { key: "Tab", code: "Tab", keyCode: 9 });
    const tabFocusKey = await evaluate(cdp, sessionId, `document.activeElement?.dataset.focusKey ?? null`);
    assert(tabFocusKey && tabFocusKey !== initialAccessibility.focusKey, "Tab이 다음 접근성 컨트롤로 이동하지 않았습니다");
    await evaluate(cdp, sessionId, `document.querySelector('[data-focus-key^="raid-contract:"]').focus()`);

    await delay(400);
    const idlePolite = await evaluate(cdp, sessionId, `window.nyang.runtime.accessibility.politeUpdates`);
    assert(idlePolite === initialAccessibility.politeUpdates, "idle 400ms 동안 polite live region이 중복 갱신됐습니다");

    const contractActionsBefore = bootState.runtime.actionCounts["raid-contract"] ?? 0;
    await pressKey(cdp, sessionId, { key: " ", code: "Space", keyCode: 32 });
    const contractState = await waitFor(
      "계약 native Space 선택",
      () => evaluate(cdp, sessionId, `({
        phase: window.nyang.phase,
        raidOffers: window.nyang.raidOffers.length,
        contract: window.nyang.raidContract,
        href: location.href,
        runtime: window.nyang.runtime,
      })`),
      (value) => value?.phase === "map" && value.raidOffers === 0 && value.contract && new URL(value.href).searchParams.has("raid"),
    );
    assert(
      (contractState.runtime.actionCounts["raid-contract"] ?? 0) - contractActionsBefore === 1,
      "계약 native Space가 raid-contract action을 정확히 한 번 실행하지 않았습니다",
    );
    assert(
      contractState.runtime.accessibility.politeText.includes("다음:")
        && contractState.runtime.accessibility.politeText.includes("길 선택"),
      "계약 결과 공지에 다음 지도 과업이 함께 전달되지 않았습니다",
    );
    await delay(400);
    const mapControl = await evaluate(cdp, sessionId, `(() => {
      const button = document.querySelector('[data-focus-key^="map-node:"]');
      button?.focus();
      return { key: button?.dataset.focusKey ?? null, before: window.nyang.runtime.actionCounts["map-node"] ?? 0 };
    })()`);
    assert(mapControl.key, "지도 DOM 컨트롤이 나타나지 않았습니다");
    await pressKey(cdp, sessionId, { key: "Enter", code: "Enter", keyCode: 13, text: "\r" });
    const rewardState = await waitFor(
      "지도 native Enter 선택 후 보상",
      () => evaluate(cdp, sessionId, `({ phase: window.nyang.phase, step: window.nyang.step, button: window.nyang.button, runtime: window.nyang.runtime })`),
      (value) => value?.phase === "reward" && value.step === 0 && value.button?.w > 0,
    );
    assert(
      (rewardState.runtime.actionCounts["map-node"] ?? 0) - mapControl.before === 1,
      "지도 native Enter가 map-node action을 정확히 한 번 실행하지 않았습니다",
    );
    assert(
      rewardState.runtime.accessibility.politeText.includes("다음:")
        && rewardState.runtime.accessibility.politeText.includes("상점과 배치"),
      "지도 결과 공지에 다음 상점·배치 과업이 함께 전달되지 않았습니다",
    );
    const rewardAccessibility = await evaluate(cdp, sessionId, `(() => {
      const runtime = window.nyang.runtime.accessibility;
      const grid = document.querySelector('.game-a11y-board[role="grid"]');
      const rows = [...grid.querySelectorAll(':scope > [role="row"]')];
      const cells = [...grid.querySelectorAll('[role="gridcell"]')];
      const buttonSizes = [...document.querySelectorAll('.game-a11y-controls button:not([hidden])')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      return {
        phaseKey: runtime.phaseKey,
        controlKeys: runtime.controlKeys,
        rows: rows.length,
        rowCellCounts: rows.map((row) => row.querySelectorAll(':scope > [role="gridcell"]').length),
        cells: cells.length,
        roving: cells.filter((cell) => cell.tabIndex === 0).length,
        buttonSizes,
      };
    })()`);
    assert(rewardAccessibility.phaseKey.startsWith("reward:"), "reward 접근성 phase model이 동기화되지 않았습니다");
    assert(rewardAccessibility.controlKeys.includes("reward:reroll") && rewardAccessibility.controlKeys.includes("reward:primary"), "reward 재추첨/주 행동 컨트롤이 없습니다");
    assert(rewardAccessibility.controlKeys.some((key) => key.startsWith("reward:offer:")), "reward 구매 컨트롤이 없습니다");
    assert(rewardAccessibility.controlKeys.includes("global:mute"), "reward 음소거 컨트롤이 없습니다");
    assert(
      rewardAccessibility.rows === 5 && rewardAccessibility.rowCellCounts.every((count) => count === 5),
      "reward ARIA grid가 5개 row × 5개 gridcell 구조가 아닙니다",
    );
    assert(rewardAccessibility.cells === 25 && rewardAccessibility.roving === 1, "reward 5x5 grid의 roving tabindex가 올바르지 않습니다");
    assert(rewardAccessibility.buttonSizes.every((rect) => rect.width >= 44 && rect.height >= 44), "reward DOM 버튼/grid cell이 44px 하한을 지키지 않았습니다");

    const { nodes: rewardAxNodes } = await cdp.send("Accessibility.getFullAXTree", {}, sessionId);
    const rewardAxById = new Map(rewardAxNodes.map((node) => [node.nodeId, node]));
    const rewardGrid = rewardAxNodes.find((node) => node.role?.value === "grid" && !node.ignored);
    const rewardRows = (rewardGrid?.childIds ?? []).map((id) => rewardAxById.get(id)).filter(Boolean);
    assert(rewardRows.length === 5 && rewardRows.every((row) => row.role?.value === "row"), "AX tree의 grid 직계 자식이 row 5개가 아닙니다");
    assert(
      rewardRows.every((row) => (row.childIds ?? []).map((id) => rewardAxById.get(id)).filter((node) => node?.role?.value === "gridcell").length === 5),
      "AX tree의 각 row가 gridcell 5개를 소유하지 않습니다",
    );

    await delay(450);
    const shortcutState = await evaluate(cdp, sessionId, `(() => {
      const button = document.querySelector('[data-focus-key="reward:primary"]');
      button.focus();
      const offer = [...document.querySelectorAll('[data-focus-key^="reward:offer:"]')][0];
      return {
        focusKey: document.activeElement?.dataset.focusKey ?? null,
        offerIndex: Number(offer?.dataset.focusKey?.split(':').at(-1)),
        counts: window.nyang.runtime.actionCounts,
      };
    })()`);
    assert(shortcutState.focusKey === "reward:primary", "단축키 회귀용 native 버튼에 focus하지 못했습니다");
    await pressKey(cdp, sessionId, { key: "g", code: "KeyG", keyCode: 71, text: "g" });
    const routedG = await evaluate(cdp, sessionId, `window.nyang.runtime.lastInput`);
    assert(routedG?.kind === "key-down" && routedG.code === "KeyG", "native 버튼 focus 중 G가 공용 입력 경계에 도달하지 않았습니다");
    await pressKey(cdp, sessionId, { key: "m", code: "KeyM", keyCode: 77, text: "m" });
    await waitFor(
      "native 버튼 focus 중 M",
      () => evaluate(cdp, sessionId, `window.nyang.runtime.actionCounts["mute"] ?? 0`),
      (count) => count === (shortcutState.counts.mute ?? 0) + 1,
    );
    await pressKey(cdp, sessionId, { key: "r", code: "KeyR", keyCode: 82, text: "r" });
    await waitFor(
      "native 버튼 focus 중 R",
      () => evaluate(cdp, sessionId, `window.nyang.runtime.actionCounts["reroll"] ?? 0`),
      (count) => count === (shortcutState.counts.reroll ?? 0) + 1,
    );
    const digit = shortcutState.offerIndex + 1;
    assert(Number.isInteger(digit) && digit >= 1 && digit <= 3, "숫자 구매 회귀용 offer 단축키를 찾지 못했습니다");
    await pressKey(cdp, sessionId, { key: String(digit), code: `Digit${digit}`, keyCode: 48 + digit, text: String(digit) });
    await waitFor(
      "native 버튼 focus 중 숫자 구매",
      () => evaluate(cdp, sessionId, `window.nyang.runtime.actionCounts["offer"] ?? 0`),
      (count) => count === (shortcutState.counts.offer ?? 0) + 1,
    );

    const boardStart = await evaluate(cdp, sessionId, `(() => {
      const cell = document.querySelector('.game-a11y-board [role="gridcell"][data-board-index="0"]');
      cell.focus();
      return {
        key: cell.dataset.focusKey,
        index: Number(cell.dataset.boardIndex),
        visualRightIndex: Number(cell.nextElementSibling?.dataset.boardIndex),
      };
    })()`);
    await pressKey(cdp, sessionId, { key: "ArrowRight", code: "ArrowRight", keyCode: 39 });
    const boardAfter = await evaluate(cdp, sessionId, `({
      key: document.activeElement?.dataset.focusKey ?? null,
      index: Number(document.activeElement?.dataset.boardIndex),
      lastInput: window.nyang.runtime.lastInput,
    })`);
    assert(
      boardAfter.key?.startsWith("board-cell:") && boardAfter.index === boardStart.visualRightIndex,
      "grid ArrowRight가 다음 시각 셀로 이동하지 않았습니다",
    );
    assert(boardAfter.lastInput?.code !== "ArrowRight", "grid 화살표가 전역 게임 입력으로 중복 전달됐습니다");
    console.log("browser-runtime accessibility route PASS · Space 계약→Enter 지도→reward grid");

    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    }, sessionId);
    const reducedButton = await evaluate(cdp, sessionId, `(() => {
      const button = document.querySelector('[data-focus-key="reward:reroll"]');
      button.focus();
      const rect = button.getBoundingClientRect();
      return {
        matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        transitionDuration: getComputedStyle(button).transitionDuration,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    })()`);
    assert(reducedButton.matches && reducedButton.transitionDuration === "0s", "reduced-motion에서 DOM transition이 제거되지 않았습니다");
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: reducedButton.x, y: reducedButton.y }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: reducedButton.x, y: reducedButton.y, button: "left", buttons: 1, clickCount: 1,
    }, sessionId);
    const reducedActiveTransform = await evaluate(cdp, sessionId, `getComputedStyle(document.querySelector('[data-focus-key="reward:reroll"]')).transform`);
    assert(reducedActiveTransform === "none", `reduced-motion active transform이 남았습니다 (${reducedActiveTransform})`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1275, y: 795, buttons: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: 1275, y: 795, button: "left", buttons: 0, clickCount: 1,
    }, sessionId);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    }, sessionId);

    const clickX = rewardState.button.x + rewardState.button.w / 2;
    const clickY = rewardState.button.y + rewardState.button.h / 2;
    await evaluate(cdp, sessionId, `document.querySelector("canvas").focus()`);
    await delay(400);
    await clickPoint(cdp, sessionId, clickX, clickY);
    const battleState = await waitFor(
      "보상 버튼에서 전투 진입",
      () => evaluate(cdp, sessionId, `({
        phase: window.nyang.phase,
        lastInput: window.nyang.runtime.lastInput,
        accessibility: window.nyang.runtime.accessibility,
        battleControls: [...document.querySelectorAll('[data-focus-key^="battle:"]')].map((button) => ({ key: button.dataset.focusKey, disabled: button.disabled })),
      })`),
      (value) => value?.phase === "battle"
        && value.lastInput?.kind === "pointer-up"
        && value.accessibility?.phaseKey.startsWith("battle:")
        && value.battleControls?.length > 0,
    );
    assert(battleState.battleControls.every((control) => control.key.startsWith("battle:")), "battle 접근성 개입 컨트롤이 없습니다");
    assert(battleState.accessibility.controlKeys.includes("global:mute"), "battle 음소거 컨트롤이 없습니다");
    assert(
      battleState.accessibility.politeText.includes("다음:")
        && battleState.accessibility.politeText.includes("전투"),
      "primary 단계 전환 결과에 다음 전투 지침이 함께 전달되지 않았습니다",
    );
    console.log("browser-runtime pointer route PASS · reward→battle");

    const battlePerformance = await waitFor(
      "battle 프레임 예산 표본",
      () => evaluate(cdp, sessionId, `(() => {
        const observation = window.nyangPerformance;
        return {
          phase: window.nyang.phase,
          frames: observation?.frames?.phases?.battle ?? null,
          caches: observation?.caches ?? null,
        };
      })()`),
      (value) => value?.frames?.sampleCount >= 105 && value.frames.elapsedMs >= 1_700,
      10_000,
    );
    assert(battlePerformance.frames.frameWorkMs.p95Ms <= 16.7,
      `battle frame-work p95가 16.7ms를 넘었습니다 (${battlePerformance.frames.frameWorkMs.p95Ms}ms)`);
    const allowedLongFrames = Math.floor(battlePerformance.frames.sampleCount * 0.01);
    assert(battlePerformance.frames.frameWorkMs.longCount <= allowedLongFrames,
      `battle long-frame이 1% 허용 개수를 넘었습니다 (${battlePerformance.frames.frameWorkMs.longCount}/${allowedLongFrames})`);
    assert(battlePerformance.frames.cadenceHz >= 45,
      `battle rAF cadence가 45Hz보다 낮습니다 (${battlePerformance.frames.cadenceHz}Hz)`);
    const performanceResult = {
      browser: basename(browserPath),
      product: browserVersion.product,
      viewport: "1280x800@1x",
      phase: "battle",
      sampleCount: battlePerformance.frames.sampleCount,
      elapsedMs: battlePerformance.frames.elapsedMs,
      cadenceHz: battlePerformance.frames.cadenceHz,
      frameWorkMs: battlePerformance.frames.frameWorkMs,
      rafIntervalMs: battlePerformance.frames.rafIntervalMs,
      allowedLongFrames,
      caches: battlePerformance.caches,
    };
    console.log(`PERFORMANCE_RESULT ${JSON.stringify(performanceResult)}`);
    console.log(
      `browser-runtime performance PASS · battle ${performanceResult.sampleCount} frames · p95 ${performanceResult.frameWorkMs.p95Ms.toFixed(2)}ms · long ${(performanceResult.frameWorkMs.longRate * 100).toFixed(2)}% · ${performanceResult.cadenceHz.toFixed(1)}Hz`,
    );
    const tintCache = battlePerformance.caches.tintedSprites;
    const tintHitRate = tintCache.hits / Math.max(1, tintCache.hits + tintCache.misses);
    assert(tintHitRate >= 0.75,
      `색조 sprite 캐시 적중률이 75%보다 낮습니다 (${(tintHitRate * 100).toFixed(2)}%, ${tintCache.hits}/${tintCache.misses})`);

    const viewportChurn = [
      { width: 640, height: 480, deviceScaleFactor: 1 },
      { width: 720, height: 900, deviceScaleFactor: 1 },
      { width: 900, height: 600, deviceScaleFactor: 2 },
      { width: 1100, height: 700, deviceScaleFactor: 1 },
      { width: 1280, height: 800, deviceScaleFactor: 1 },
    ];
    for (const viewport of viewportChurn) {
      const before = await evaluate(cdp, sessionId, `window.nyang.runtime.resizeCount`);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        mobile: false,
      }, sessionId);
      await waitFor(
        `${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}x 캐시 churn`,
        () => evaluate(cdp, sessionId, `(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
          runtime: window.nyang.runtime,
          phase: window.nyang.phase,
          caches: window.nyangPerformance?.caches ?? null,
        })))))()`),
        (value) => value?.phase === "battle"
          && value.runtime?.resizeCount > before
          && value.runtime.lastResize?.width === viewport.width
          && value.runtime.lastResize?.height === viewport.height,
      );
    }
    const boundedCaches = await evaluate(cdp, sessionId, `window.nyangPerformance.caches`);
    for (const name of ["backdrop", "boardGrid", "tintedSprites", "fxBuffer"]) {
      const cache = boundedCaches[name];
      assert(cache, `${name} 캐시 관찰값이 없습니다`);
      assert(cache.entries <= cache.maxEntries,
        `${name} 현재 엔트리가 상한을 넘었습니다 (${cache.entries}/${cache.maxEntries})`);
      assert(cache.peakEntries <= cache.maxEntries,
        `${name} 최대 엔트리가 상한을 넘었습니다 (${cache.peakEntries}/${cache.maxEntries})`);
      assert(cache.pixels <= cache.maxPixels,
        `${name} 현재 픽셀이 상한을 넘었습니다 (${cache.pixels}/${cache.maxPixels})`);
      assert(cache.peakPixels <= cache.maxPixels,
        `${name} 최대 픽셀이 상한을 넘었습니다 (${cache.peakPixels}/${cache.maxPixels})`);
    }
    for (const name of ["ramps", "chipTrails"]) {
      const cache = boundedCaches[name];
      assert(cache.entries <= cache.maxEntries,
        `${name} 현재 엔트리가 상한을 넘었습니다 (${cache.entries}/${cache.maxEntries})`);
    }
    assert(
      boundedCaches.boardGrid.peakEntries === boundedCaches.boardGrid.maxEntries,
      "board grid LRU가 엔트리 상한까지 실제로 채워지지 않았습니다",
    );
    console.log("browser-runtime cache budget PASS · 6 battle viewports · entry/pixel caps sealed");

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
        const snapshot = () => {
          const rect = canvas.getBoundingClientRect();
          return {
            inner: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            css: { width: rect.width, height: rect.height },
            backing: { width: canvas.width, height: canvas.height },
            orientation: { type: screen.orientation.type, angle: screen.orientation.angle },
            button: window.nyang.button,
            runtime: window.nyang.runtime,
          };
        };
        const first = snapshot();
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const value = snapshot();
          resolve({ ...value, stable: JSON.stringify({ inner: first.inner, css: first.css, backing: first.backing }) === JSON.stringify({ inner: value.inner, css: value.css, backing: value.backing }) });
        })));
      })()`),
      (value) => value?.inner.width === 800
        && value.inner.height === 1280
        && value.stable
        && value.runtime.resizeCount > beforeResize.resizeCount
        && value.runtime.lastResize?.width === 800
        && value.runtime.lastResize?.height === 1280,
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
    // CDP의 native orientation 이벤트 전달 여부와 별개로 실제 리스너·120ms
    // debounce·resize 연결을 결정론적으로 검증한다. 연속 두 이벤트는 한 번만 센다.
    // 앞선 battle viewport churn의 마지막 native orientation 이벤트까지
    // 120ms debounce 밖으로 완전히 밀어낸 뒤 수동 연속 이벤트만 계수한다.
    await delay(320);
    const beforeOrientation = await evaluate(cdp, sessionId, `window.nyang.runtime`);
    await evaluate(cdp, sessionId, `(() => {
      window.dispatchEvent(new Event("orientationchange"));
      window.dispatchEvent(new Event("orientationchange"));
    })()`);
    const orientationHandled = await waitFor(
      "orientationchange debounce 처리",
      () => evaluate(cdp, sessionId, `window.nyang.runtime`),
      (value) => value?.orientationCount === beforeOrientation.orientationCount + 1
        && value.resizeCount === beforeOrientation.resizeCount + 1
        && value.lastResize?.width === 800
        && value.lastResize?.height === 1280,
    );
    assert(
      orientationHandled.orientationCount === beforeOrientation.orientationCount + 1,
      "연속 orientationchange가 하나로 합쳐지지 않았습니다",
    );
    console.log("browser-runtime resize PASS · 1280x800→800x1280 @2x · orientation debounce");

    const backdropStress = Array.from({ length: 12 }, (_, index) => ({
      width: 820 + index * 17,
      height: 1180 - index * 19,
      deviceScaleFactor: index % 2 === 0 ? 1 : 2,
    }));
    for (const viewport of [...backdropStress, { width: 800, height: 1280, deviceScaleFactor: 2 }]) {
      const before = await evaluate(cdp, sessionId, `window.nyang.runtime.resizeCount`);
      await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false }, sessionId);
      await waitFor(
        `${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}x backdrop churn`,
        () => evaluate(cdp, sessionId, `(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
          runtime: window.nyang.runtime,
          caches: window.nyangPerformance.caches,
        })))))()`),
        (value) => value?.runtime?.resizeCount > before
          && value.runtime.lastResize?.width === viewport.width
          && value.runtime.lastResize?.height === viewport.height,
      );
    }
    const stressedCaches = await evaluate(cdp, sessionId, `window.nyangPerformance.caches`);
    assert(
      stressedCaches.backdrop.peakEntries === stressedCaches.backdrop.maxEntries,
      "backdrop LRU가 엔트리 상한까지 실제로 채워지지 않았습니다",
    );
    for (const name of ["backdrop", "boardGrid", "tintedSprites", "fxBuffer"]) {
      const cache = stressedCaches[name];
      assert(cache.entries <= cache.maxEntries && cache.peakEntries <= cache.maxEntries,
        `${name} stress 엔트리 상한을 넘었습니다 (${cache.entries}/${cache.peakEntries}/${cache.maxEntries})`);
      assert(cache.pixels <= cache.maxPixels && cache.peakPixels <= cache.maxPixels,
        `${name} stress 픽셀 상한을 넘었습니다 (${cache.pixels}/${cache.peakPixels}/${cache.maxPixels})`);
    }
    console.log(`CACHE_RESULT ${JSON.stringify({
      browser: basename(browserPath),
      product: browserVersion.product,
      viewports: 1 + viewportChurn.length + 1 + backdropStress.length + 1,
      caches: stressedCaches,
    })}`);
    console.log("browser-runtime cache stress PASS · board/backdrop LRU caps exercised");

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

    // 별도 탭에서 base atlas 하나를 네트워크 단계에서 막는다. 정상 탭의
    // singleton/cache와 섞지 않고 실제 production 실패 격리를 검증한다.
    const { targetId: degradedTargetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: degradedSessionId } = await cdp.send("Target.attachToTarget", {
      targetId: degradedTargetId,
      flatten: true,
    });
    const degraded = {
      exceptions: [],
      consoleErrors: [],
      logErrors: [],
      blockedLogs: [],
      requests: [],
      pending: new Set(),
      lastActivity: Date.now(),
      pausedRequestId: null,
    };
    cdp.on((message) => {
      if (message.sessionId !== degradedSessionId) return;
      if (message.method === "Runtime.exceptionThrown") degraded.exceptions.push(message.params.exceptionDetails);
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        degraded.consoleErrors.push(message.params.args);
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        if (
          entry.source === "network"
          && /ERR_BLOCKED_BY_CLIENT/u.test(entry.text)
          && /atlas-base\.png/u.test(entry.url ?? "")
        ) {
          degraded.blockedLogs.push(entry);
        } else if (!(entry.source === "security" && /Unrecognized Content-Security-Policy directive 'webrtc'/u.test(entry.text))) {
          degraded.logErrors.push(entry);
        }
      }
      if (message.method === "Network.requestWillBeSent" && /^https?:/u.test(message.params.request.url)) {
        degraded.requests.push(message.params.request.url);
        degraded.pending.add(message.params.requestId);
        degraded.lastActivity = Date.now();
      }
      if (message.method === "Network.loadingFinished" || message.method === "Network.loadingFailed") {
        degraded.pending.delete(message.params.requestId);
        degraded.lastActivity = Date.now();
      }
      if (message.method === "Fetch.requestPaused") {
        degraded.pausedRequestId = message.params.requestId;
      }
    });
    await Promise.all([
      cdp.send("Runtime.enable", {}, degradedSessionId),
      cdp.send("Page.enable", {}, degradedSessionId),
      cdp.send("Network.enable", {}, degradedSessionId),
      cdp.send("Log.enable", {}, degradedSessionId),
      cdp.send("Fetch.enable", {
        patterns: [{ urlPattern: "*atlas-base.png*", requestStage: "Request" }],
      }, degradedSessionId),
    ]);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, degradedSessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
      screenOrientation: { type: "landscapePrimary", angle: 90 },
    }, degradedSessionId);
    await cdp.send("Target.activateTarget", { targetId: degradedTargetId });
    await cdp.send("Page.navigate", { url: `${origin}${APP_BASE}/?seed=424242&debug=1&atlas-failure=1` }, degradedSessionId);
    const bootBeforeSprites = await waitFor(
      "atlas 대기 중 비동기 부트",
      () => evaluate(cdp, degradedSessionId, `(() => {
        if (!window.nyang) return null;
        return {
          bootGone: document.querySelector("#boot").classList.contains("gone"),
          phase: window.nyang.phase,
          runtime: window.nyang.runtime,
        };
      })()`),
      (value) => value?.bootGone
        && value.phase === "map"
        && value.runtime.frameCount >= 1
        && !value.runtime.assetsReady
        && value.runtime.sprites.state === "loading"
        && value.runtime.sprites.frameDescriptors === 66
        && degraded.pausedRequestId,
      10_000,
    );
    assert(bootBeforeSprites.runtime.sprites.frameDescriptors === 66, "대기 중 extra atlas frame을 사용하지 못했습니다");
    await cdp.send("Fetch.failRequest", {
      requestId: degraded.pausedRequestId,
      errorReason: "BlockedByClient",
    }, degradedSessionId);
    const degradedState = await waitFor(
      "atlas 일부 실패 격리",
      () => evaluate(cdp, degradedSessionId, `(() => {
        const canvas = document.querySelector("canvas");
        if (!canvas || !window.nyang) return null;
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        const stride = Math.max(4, Math.floor((canvas.width * canvas.height) / 8000) * 4);
        for (let i = 0; i < pixels.length; i += stride) {
          colors.add(pixels[i] + "," + pixels[i + 1] + "," + pixels[i + 2] + "," + pixels[i + 3]);
          if (colors.size >= 12) break;
        }
        return {
          bootGone: document.querySelector("#boot").classList.contains("gone"),
          phase: window.nyang.phase,
          runtime: window.nyang.runtime,
          colors: colors.size,
        };
      })()`),
      (value) => value?.bootGone
        && value.runtime.frameCount >= 1
        && value.runtime.assetsReady
        && value.runtime.sprites.settled,
      20_000,
    );
    assert(degradedState.phase === "map" && degradedState.colors >= 4, "atlas 실패 시 첫 map frame이 그려지지 않았습니다");
    assert(degradedState.runtime.sprites.state === "degraded", `부분 실패 상태가 degraded가 아닙니다 (${degradedState.runtime.sprites.state})`);
    assert(JSON.stringify(degradedState.runtime.sprites.readyAtlases) === '["extra"]', "extra atlas만 ready여야 합니다");
    assert(JSON.stringify(degradedState.runtime.sprites.failedAtlases) === '["base"]', "base atlas만 failed여야 합니다");
    assert(degradedState.runtime.sprites.frameDescriptors === 66 && degradedState.runtime.sprites.fallbackFrames === 120, "부분 atlas frame/fallback 수가 다릅니다");
    const fallbackBeforeRoute = degradedState.runtime.spriteFallbackDraws;
    await delay(400);
    await pressDigit1(cdp, degradedSessionId);
    await waitFor(
      "degraded 탭 실제 입력",
      () => evaluate(cdp, degradedSessionId, `({ phase: window.nyang.phase, offers: window.nyang.raidOffers.length })`),
      (value) => value?.phase === "map" && value.offers === 0,
    );
    await delay(400);
    await pressDigit1(cdp, degradedSessionId);
    const degradedReward = await waitFor(
      "degraded map→reward와 Canvas 폴백",
      () => evaluate(cdp, degradedSessionId, `({
        phase: window.nyang.phase,
        fallbackDraws: window.nyang.runtime.spriteFallbackDraws,
      })`),
      (value) => value?.phase === "reward" && value.fallbackDraws > fallbackBeforeRoute,
    );
    assert(degradedReward.fallbackDraws > fallbackBeforeRoute, "실제 Canvas 고양이 폴백이 그려지지 않았습니다");
    await waitFor(
      "degraded 네트워크 유휴",
      async () => ({ pending: degraded.pending.size, idleMs: Date.now() - degraded.lastActivity }),
      (value) => value.pending === 0 && value.idleMs >= 400,
      10_000,
    );
    const degradedAtlasRequests = degraded.requests.filter((url) => /\/sprites\/atlas-(?:base|extra)\.png(?:$|\?)/u.test(url));
    const degradedLegacyRequests = degraded.requests.filter((url) => /\/sprites\/\d{2}_[a-z]+\.png(?:$|\?)/u.test(url));
    assert(degradedAtlasRequests.length === 2 && degradedLegacyRequests.length === 0, "degraded 탭 sprite 요청 계약이 다릅니다");
    assert(degraded.exceptions.length === 0, `degraded Runtime 예외 ${degraded.exceptions.length}건`);
    assert(degraded.consoleErrors.length === 0, `degraded console.error ${degraded.consoleErrors.length}건`);
    assert(degraded.logErrors.length === 0, `degraded Log error ${degraded.logErrors.length}건`);
    assert(degraded.blockedLogs.length === 1, `예상한 atlas 차단 로그가 정확히 1건이 아닙니다 (${degraded.blockedLogs.length})`);
    console.log(`browser-runtime sprite failure PASS · async boot/map→reward · extra 66 + fallback 120 · fallback draws ${degradedReward.fallbackDraws} · runtime errors 0`);
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
