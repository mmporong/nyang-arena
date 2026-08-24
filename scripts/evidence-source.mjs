import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** 현재 Node 프로세스를 다시 실행할 수 있는 형태로 기록한다. */
export function invokedNodeCommand(script) {
  return ["node", "--experimental-strip-types", script, ...process.argv.slice(2)].join(" ");
}

/** 측정 파일을 어떤 커밋·트리·명령·시드·종료 상태가 만들었는지 결박한다. */
export function evidenceSource(command, seeds, exitCode) {
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  return {
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: status === null ? null : status !== "",
    command,
    seeds,
    exitCode,
    node: process.version,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

/** 사람이 읽는 JSON 내용 자체도 해시해 조용한 수정·부분 결합을 잡는다. */
export function evidenceDigest(evidence) {
  const copy = { ...evidence };
  delete copy.evidenceSha256;
  return createHash("sha256").update(JSON.stringify(canonical(copy))).digest("hex");
}

export function sealEvidence(evidence) {
  return { ...evidence, evidenceSha256: evidenceDigest(evidence) };
}

export function verifyEvidenceSeal(evidence) {
  return typeof evidence?.evidenceSha256 === "string" && evidence.evidenceSha256 === evidenceDigest(evidence);
}
