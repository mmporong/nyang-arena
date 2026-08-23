/**
 * 측정 스크립트의 정책 × 시드 루프를 워커에 나눈다 — **집계는 호출자의 기존 코드 한 벌**이 한다.
 *
 * measure-all 20분의 91%가 relics·map·placement의 **런 수 × 33 ms**였다(2026-08-23 성능 분석).
 * 런은 시드만 받고 서로 상태를 공유하지 않는다(시드 1~40을 정방향·역방향으로 돌려 결과 배열이
 * 동일한 것을 실측) — 그래서 시드 블록을 나눠 돌려도 결과가 같다. 같은 이유로 **워커는 런당
 * 원시 결과만 돌려주고 평균·분위·판정은 원래 자리에서 한다.** 집계를 워커로 옮기면 "정책 사본"
 * 함정(AGENTS.md)이 재발한다 — 사본은 늘 다르게 재는 쪽으로 갈라진다.
 *
 * 쓰는 법(스크립트 쪽):
 *   const got = await runSharded(import.meta.url, Object.keys(POLICIES), (name, seed) => play(POLICIES[name], seed), { runs: RUNS, seed0: SEED0 });
 *   // got[name][i] === play(POLICIES[name], SEED0 + i + 1)
 *
 * 워커는 **같은 스크립트 파일을 다시 로드**한다. 상단의 인자 파싱·헤더 출력도 다시 도는데, 이
 * 모듈이 워커에서는 console을 잠그므로 화면에 두 번 찍히지 않는다. 워커는 맡은 시드를 돌려 보낸 뒤
 * 곧바로 끝나므로 `runSharded` 뒤의 집계 코드는 메인에서만 돈다.
 *
 * 워커 수: 환경변수 `WORKERS`(기본 min(6, 코어−1)). `WORKERS=1`이면 예전처럼 한 프로세스에서
 * 순서대로 돈다 — 결과가 같아야 하고, 같은지는 `WORKERS=1`과 기본값의 출력을 diff로 확인한다.
 */
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (!isMainThread) {
  // 워커는 조용히. 헤더·표는 메인이 한 번만 찍는다.
  console.log = () => {};
  console.warn = () => {};
}

export function workerCount() {
  const env = Number(process.env.WORKERS);
  if (Number.isFinite(env) && env >= 1) return Math.floor(env);
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(6, cores - 1));
}

/**
 * @param {string} scriptUrl  호출 스크립트의 import.meta.url
 * @param {string[]} names    정책 이름들
 * @param {(name: string, seed: number) => unknown} play  한 런. 반환값은 구조 복제 가능해야 한다
 * @param {{ runs: number, seed0: number }} opts
 * @returns {Promise<Record<string, unknown[]>>}  이름 → 시드 순서의 원시 결과
 */
export async function runSharded(scriptUrl, names, play, { runs, seed0 }) {
  if (!isMainThread) {
    // 워커: 맡은 (이름, 시드 블록)만 돌려서 보내고 끝낸다.
    const tasks = workerData?.tasks ?? [];
    const out = {};
    for (const t of tasks) {
      const arr = [];
      for (let k = 0; k < t.count; k++) arr.push(play(t.name, seed0 + t.start + k + 1));
      out[t.name] = { start: t.start, results: arr };
    }
    parentPort.postMessage(out);
    // 메시지가 나간 뒤 스크립트의 나머지(집계·판정)가 워커에서 돌면 안 된다.
    await new Promise(() => {});
  }

  const workers = workerCount();
  const results = {};
  for (const n of names) results[n] = new Array(runs);

  if (workers <= 1 || runs < workers * 4) {
    for (const n of names) for (let i = 0; i < runs; i++) results[n][i] = play(n, seed0 + i + 1);
    return results;
  }

  // 정책마다 시드를 워커 수만큼 잘라, 워커 k가 모든 정책의 k번째 블록을 맡는다 — 일이 고르다.
  const plans = Array.from({ length: workers }, () => []);
  for (const n of names) {
    const size = Math.ceil(runs / workers);
    for (let k = 0; k < workers; k++) {
      const start = k * size;
      const count = Math.max(0, Math.min(size, runs - start));
      if (count > 0) plans[k].push({ name: n, start, count });
    }
  }

  await Promise.all(
    plans.map(
      (tasks) =>
        new Promise((resolve, reject) => {
          const w = new Worker(new URL(scriptUrl), { workerData: { tasks } });
          let got = false;
          w.on("message", (msg) => {
            got = true;
            for (const [name, { start, results: arr }] of Object.entries(msg)) {
              for (let k = 0; k < arr.length; k++) results[name][start + k] = arr[k];
            }
            void w.terminate();
          });
          w.on("error", reject);
          w.on("exit", (code) => {
            if (!got) reject(new Error(`워커가 결과 없이 끝났다 (code ${code})`));
            else resolve();
          });
        }),
    ),
  );
  for (const n of names) {
    for (let i = 0; i < runs; i++) {
      if (results[n][i] === undefined) throw new Error(`${n} 시드 ${seed0 + i + 1} 결과가 비었다`);
    }
  }
  return results;
}
