import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOT = join(ROOT, "src");
const PUBLIC_ROOT = join(ROOT, "public");
const DIST_ROOT = join(ROOT, "dist");
const INDEX_FILE = join(ROOT, "index.html");
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  ".css", ".html", ".json", ".map", ".svg", ".txt", ".webmanifest", ".xml",
]);
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FORBIDDEN_APIS = new Set([
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
]);
const CSP_DIRECTIVES = new Map([
  ["default-src", ["'none'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'unsafe-inline'"]],
  ["img-src", ["'self'", "data:"]],
  ["media-src", ["'self'"]],
  ["connect-src", ["'self'"]],
  ["webrtc", ["'block'"]],
  ["form-action", ["'none'"]],
  ["base-uri", ["'none'"]],
  ["object-src", ["'none'"]],
]);

function lineAt(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function nodeFinding(sourceFile, node, reason) {
  return { line: lineAt(sourceFile, node), reason, sample: node.getText(sourceFile).slice(0, 140) };
}

function textFinding(text, offset, reason, sample) {
  return { line: text.slice(0, offset).split("\n").length, reason, sample: sample.slice(0, 140) };
}

function isScope(node) {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node);
}

function nearestScope(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (isScope(cursor)) return cursor;
  }
  return node.getSourceFile();
}

function contains(ancestor, node) {
  return ancestor.pos <= node.pos && node.end <= ancestor.end;
}

function declarationName(declaration) {
  return declaration.name && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
}

function declarationScope(declaration) {
  if (ts.isParameter(declaration)) return declaration.parent;
  return nearestScope(declaration);
}

function collectDeclarations(sourceFile) {
  const declarations = [];
  function visit(node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) &&
      declarationName(node)
    ) declarations.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return declarations;
}

function resolveDeclaration(identifier, declarations) {
  const candidates = declarations.filter((declaration) => {
    if (declarationName(declaration) !== identifier.text) return false;
    const scope = declarationScope(declaration);
    if (!contains(scope, identifier)) return false;
    return ts.isFunctionDeclaration(declaration) || ts.isParameter(declaration) || declaration.pos < identifier.pos;
  });
  candidates.sort((a, b) => {
    const aScope = declarationScope(a);
    const bScope = declarationScope(b);
    return (aScope.end - aScope.pos) - (bScope.end - bScope.pos) || b.pos - a.pos;
  });
  return candidates[0] ?? null;
}

function isConstDeclaration(declaration) {
  return ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function isRelativeOrDataLiteral(value) {
  return value.startsWith("/") && !value.startsWith("//") || value.startsWith("./") ||
    value.startsWith("../") || value.startsWith("data:");
}

function isSameOriginBase(expression, context) {
  const value = unwrap(expression);
  if (context.built && ts.isStringLiteralLike(value)) {
    return value.text.startsWith("/") && !value.text.startsWith("//") && value.text.endsWith("/");
  }
  return !context.built && /^import\.meta\.env\?\.BASE_URL\s*\?\?\s*["']\/["']$/.test(value.getText());
}

function templatePathKind(expression, context) {
  const value = unwrap(expression);
  if (!ts.isTemplateExpression(value) || value.head.text !== "" || value.templateSpans.length < 1) return null;
  const first = value.templateSpans[0];
  const baseExpression = unwrap(first.expression);
  if (!ts.isIdentifier(baseExpression)) return null;
  const baseDeclaration = resolveDeclaration(baseExpression, context.declarations);
  if (!baseDeclaration || !isConstDeclaration(baseDeclaration) || !baseDeclaration.initializer) return null;
  if (!isSameOriginBase(baseDeclaration.initializer, context)) return null;
  if (first.literal.text === "bgm/") return "bgm";
  if (
    first.literal.text === "sprites/" ||
    first.literal.text === "sprites/atlas-base.png" ||
    first.literal.text === "sprites/atlas-extra.png"
  ) return "sprites";
  return null;
}

function isSafeResourceTemplate(expression, context) {
  const value = unwrap(expression);
  if (!ts.isTemplateExpression(value)) return false;
  if (context.built) {
    return value.head.text.startsWith("/") && !value.head.text.startsWith("//") &&
      (value.head.text.includes("/sprites/") || value.head.text.includes("/bgm/"));
  }
  if (value.head.text !== "" || value.templateSpans.length < 1) return false;
  const first = value.templateSpans[0];
  return first.expression.getText() === "import.meta.env.BASE_URL" &&
    (first.literal.text === "sprites/" || first.literal.text === "bgm/");
}

function functionReturnExpression(declaration) {
  if (ts.isFunctionDeclaration(declaration) && declaration.body) {
    const returns = declaration.body.statements.filter(ts.isReturnStatement);
    return returns.length === 1 ? returns[0].expression ?? null : null;
  }
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const initializer = unwrap(declaration.initializer);
    if (ts.isArrowFunction(initializer)) {
      if (!ts.isBlock(initializer.body)) return initializer.body;
      const returns = initializer.body.statements.filter(ts.isReturnStatement);
      return returns.length === 1 ? returns[0].expression ?? null : null;
    }
    if (ts.isFunctionExpression(initializer)) {
      const returns = initializer.body.statements.filter(ts.isReturnStatement);
      return returns.length === 1 ? returns[0].expression ?? null : null;
    }
  }
  return null;
}

function isSafeResourceExpression(expression, context, seen = new Set()) {
  const value = unwrap(expression);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return isRelativeOrDataLiteral(value.text);
  }
  if (templatePathKind(value, context) || isSafeResourceTemplate(value, context)) return true;
  if (ts.isIdentifier(value)) {
    const declaration = resolveDeclaration(value, context.declarations);
    if (!declaration || seen.has(declaration)) return false;
    const substituted = context.substitutions?.get(declaration);
    if (substituted) return isSafeResourceExpression(substituted, context, seen);
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false;
    seen.add(declaration);
    return isSafeResourceExpression(declaration.initializer, context, seen);
  }
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    const declaration = resolveDeclaration(value.expression, context.declarations);
    const returned = declaration && functionReturnExpression(declaration);
    if (!declaration || !returned || seen.has(declaration)) return false;
    const functionNode = ts.isFunctionDeclaration(declaration) ? declaration : unwrap(declaration.initializer);
    const substitutions = new Map(context.substitutions);
    for (let index = 0; index < functionNode.parameters.length; index += 1) {
      const argument = value.arguments[index];
      if (argument) substitutions.set(functionNode.parameters[index], argument);
    }
    seen.add(declaration);
    return isSafeResourceExpression(returned, { ...context, substitutions }, seen);
  }
  return false;
}

function isAllowedBgmFetch(call, context) {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "fetch" || call.arguments.length !== 1) return false;
  if (resolveDeclaration(call.expression, context.declarations)) return false;
  const argument = unwrap(call.arguments[0]);
  if (!ts.isIdentifier(argument)) return false;
  const urlDeclaration = resolveDeclaration(argument, context.declarations);
  return Boolean(
    urlDeclaration && isConstDeclaration(urlDeclaration) && urlDeclaration.initializer &&
    templatePathKind(urlDeclaration.initializer, context) === "bgm",
  );
}

function constantString(node) {
  const value = unwrap(node);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(value.left);
    const right = constantString(value.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    return constantString(node.argumentExpression);
  }
  return null;
}

export function inspectRuntimeCode(text, { built = false, fileName = "fixture.ts" } = {}) {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const declarations = collectDeclarations(sourceFile);
  const context = { built, declarations, substitutions: new Map() };
  const findings = [];
  const allowedFetches = new Set();

  function visit(node) {
    if (ts.isCallExpression(node) && isAllowedBgmFetch(node, context)) allowedFetches.add(node.expression);
    if (ts.isIdentifier(node) && node.text === "fetch" && !allowedFetches.has(node)) {
      findings.push(nodeFinding(sourceFile, node, "허용된 BGM 호출이 아닌 fetch 참조"));
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && propertyName(node) === "fetch") {
      findings.push(nodeFinding(sourceFile, node, "property/computed fetch 사용"));
    }
    if (ts.isIdentifier(node) && FORBIDDEN_APIS.has(node.text)) {
      findings.push(nodeFinding(sourceFile, node, `금지된 네트워크 API: ${node.text}`));
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      FORBIDDEN_APIS.has(propertyName(node))
    ) findings.push(nodeFinding(sourceFile, node, `property/computed 네트워크 API: ${propertyName(node)}`));
    if (ts.isStringLiteralLike(node) && (node.text === "fetch" || FORBIDDEN_APIS.has(node.text))) {
      findings.push(nodeFinding(sourceFile, node, `computed 네트워크 API 문자열: ${node.text}`));
    }
    if (
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) &&
      propertyName(node.left) === "src" && !isSafeResourceExpression(node.right, context)
    ) findings.push(nodeFinding(sourceFile, node, "출처를 증명할 수 없는 동적 src 할당"));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { findings, allowedFetchCount: allowedFetches.size };
}

function maskSvgNamespace(text) {
  return text.replaceAll(SVG_NAMESPACE, "svg-namespace");
}

function isSafeResourceReference(value) {
  return value === "" || value.startsWith("#") || isRelativeOrDataLiteral(value) ||
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function inspectRuntimeText(text) {
  const findings = [];
  const masked = maskSvgNamespace(text);
  for (const match of masked.matchAll(/(?:https?|wss?):\/\/[^\s"'`<>()]+/gi)) {
    findings.push(textFinding(text, match.index, "외부 프로토콜 URL", match[0]));
  }
  for (const match of masked.matchAll(/(?<!:)\/\/[A-Za-z0-9][^\s"'`<>()]*/g)) {
    findings.push(textFinding(text, match.index, "protocol-relative URL", match[0]));
  }
  for (const match of text.matchAll(/\b(?:src|href|poster|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[1] ?? match[2];
    if (!isSafeResourceReference(value)) findings.push(textFinding(text, match.index, "외부 리소스 참조", match[0]));
  }
  return findings;
}

function parseCsp(text) {
  const tag = /<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const content = /\bcontent="([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent='([^']*)'/i.exec(tag)?.[1];
  if (!content) return null;
  return new Map(content.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [directive, ...values] = part.split(/\s+/);
    return [directive, values];
  }));
}

function inspectCsp(text) {
  const actual = parseCsp(text);
  assert.ok(actual, "Content-Security-Policy meta가 없음");
  for (const [directive, expectedValues] of CSP_DIRECTIVES) {
    assert.ok(actual.has(directive), `CSP ${directive} directive가 없음`);
    assert.deepEqual(actual.get(directive), expectedValues, `CSP ${directive} 값이 안전 정책과 다름`);
  }
  assert.equal(actual.size, CSP_DIRECTIVES.size, "CSP에 검증되지 않은 directive가 있음");
}

function collectTextFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...collectTextFiles(path));
    else if (TEXT_EXTENSIONS.has(extname(path).toLowerCase())) files.push(path);
  }
  return files;
}

function runSelfTest() {
  const sourceAllowed = `
    const BASE_URL = import.meta.env?.BASE_URL ?? "/";
    const sprite = (name) => \`\${BASE_URL}sprites/\${name}.png\`;
    const image = new Image(); image.src = sprite("01_idle");
    async function load(name) { const url = \`\${BASE_URL}bgm/\${name}.\${EXT}\`; await fetch(url); }
  `;
  const builtAllowed = `
    const A = "/nyang-arena/";
    function s(n) { return \`\${A}sprites/\${n}.png\`; }
    const i = new Image(); i.src = s("01_idle");
    async function l(n) { const u = \`\${A}bgm/\${n}.\${X}\`; await fetch(u); }
  `;
  assert.deepEqual(inspectRuntimeCode(sourceAllowed), { findings: [], allowedFetchCount: 1 });
  assert.deepEqual(inspectRuntimeCode(builtAllowed, { built: true, fileName: "fixture.js" }), { findings: [], allowedFetchCount: 1 });
  const base = `const BASE_URL=import.meta.env?.BASE_URL??"/"; const url=\`\${BASE_URL}bgm/\${name}.\${EXT}\`;`;
  const hostile = [
    `${base} function bad(fetch){ fetch(url); }`,
    `${base} fetch(url); fetch("/extra")`,
    `${base} const request=fetch; request(url)`,
    `${base} globalThis.fetch(url)`,
    `${base} globalThis["fetch"](url)`,
    `${base} globalThis["fe" + "tch"](url)`,
    `const X=globalThis["XMLHttpRequest"]; new X()`,
    `const X=globalThis["XML" + "HttpRequest"]; new X()`,
    `new WebSocket("wss://evil.example")`,
    `new EventSource("/events")`,
    `navigator.sendBeacon("/metrics", body)`,
    `new RTCPeerConnection({iceServers:[{urls:"stun:evil.example"}]})`,
    `new globalThis["RTC" + "PeerConnection"]({iceServers:[{urls:"stun:evil.example"}]})`,
    `const image=new Image(); image.src=runtimeSelectedUrl`,
    `const image=new Image(); image["sr" + "c"]=runtimeSelectedUrl`,
  ];
  for (const [index, sample] of hostile.entries()) {
    assert.ok(inspectRuntimeCode(sample).findings.length > 0, `hostile fixture ${index + 1}`);
  }
  assert.ok(inspectRuntimeText(`<img src="https://evil.example/cat.png">`).length > 0);
  assert.deepEqual(inspectRuntimeText(`<svg xmlns="${SVG_NAMESPACE}"></svg>`), []);
}

function inspectFile(path, built) {
  const text = readFileSync(path, "utf8");
  const findings = inspectRuntimeText(text);
  let allowedFetchCount = 0;
  if (CODE_EXTENSIONS.has(extname(path).toLowerCase())) {
    const codeResult = inspectRuntimeCode(text, { built, fileName: path });
    findings.push(...codeResult.findings);
    allowedFetchCount = codeResult.allowedFetchCount;
  }
  return {
    findings: findings.map((item) => ({ file: relative(ROOT, path).replaceAll("\\", "/"), ...item })),
    allowedFetchCount,
  };
}

function main() {
  runSelfTest();
  assert.ok(existsSync(INDEX_FILE), "index.html이 없습니다");
  assert.ok(existsSync(SOURCE_ROOT), "src 디렉터리가 없습니다");
  assert.ok(existsSync(DIST_ROOT), "dist가 없습니다. 먼저 npm run build를 실행하세요");
  const distIndex = join(DIST_ROOT, "index.html");
  assert.ok(existsSync(distIndex), "dist/index.html이 없습니다");
  inspectCsp(readFileSync(INDEX_FILE, "utf8"));
  inspectCsp(readFileSync(distIndex, "utf8"));
  const sourceFiles = [INDEX_FILE, ...collectTextFiles(SOURCE_ROOT), ...collectTextFiles(PUBLIC_ROOT)];
  const distFiles = collectTextFiles(DIST_ROOT);
  assert.ok(distFiles.length > 0, "dist에 검사할 텍스트 산출물이 없습니다");
  const sourceResults = sourceFiles.map((path) => inspectFile(path, false));
  const distResults = distFiles.map((path) => inspectFile(path, true));
  const sourceFetches = sourceResults.reduce((sum, result) => sum + result.allowedFetchCount, 0);
  const distFetches = distResults.reduce((sum, result) => sum + result.allowedFetchCount, 0);
  const findings = [...sourceResults, ...distResults].flatMap((result) => result.findings);
  if (sourceFetches !== 1) findings.push({ file: "src", line: 1, reason: `허용 BGM fetch가 정확히 1개가 아님 (${sourceFetches})`, sample: "fetch" });
  if (distFetches !== 1) findings.push({ file: "dist", line: 1, reason: `빌드의 허용 BGM fetch가 정확히 1개가 아님 (${distFetches})`, sample: "fetch" });
  if (findings.length > 0) {
    for (const item of findings) console.error(`FAIL ${item.file}:${item.line} ${item.reason} — ${item.sample}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `runtime network gate passed — CSP policy sealed (webrtc 'block') · AST/text findings 0 · BGM fetch source/dist 1/1 · hostile fixtures 15 · scanned source/public ${sourceFiles.length}, dist ${distFiles.length}`,
  );
}

main();
