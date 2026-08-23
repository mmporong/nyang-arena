import {
  isMuted,
  playBossSignal,
  setBed,
  toggleMute,
  unlockAudio,
  type BossSignal,
} from "./game/audio.ts";
import { drawIcon, ICON_NAMES, type IconName } from "./game/icons.ts";

const ICON_LABELS = {
  fish: "생선",
  "cls-warrior": "전사",
  "cls-rogue": "도적",
  "cls-archer": "궁수",
  "cls-mage": "마법사",
  "cls-summoner": "소환사",
  "relic-iron_collar": "무쇠 목걸이",
  "relic-shadow_claw": "그림자 발톱",
  "relic-hawk_eye": "매의 눈",
  "relic-stardust_rod": "별가루 지팡이",
  "relic-lone_hunter": "고독한 사냥꾼",
  "relic-the_swarm": "고양이 떼",
  "relic-crown": "왕관",
  "relic-rainbow_bell": "무지개 방울",
  "relic-mirror_charm": "거울 부적",
  "relic-kitten_basket": "아기 고양이 바구니",
  "relic-hollow_bell": "빈 방울",
} as const satisfies Record<IconName, string>;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`QA 요소가 없습니다: ${selector}`);
  return element;
}

function createIconCard(name: IconName): HTMLElement {
  const card = document.createElement("article");
  card.className = "icon-card";

  const canvas = document.createElement("canvas");
  const logicalWidth = 156;
  const logicalHeight = 62;
  const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  canvas.width = Math.round(logicalWidth * ratio);
  canvas.height = Math.round(logicalHeight * ratio);
  canvas.setAttribute("aria-label", `${ICON_LABELS[name]} 아이콘의 6.3px와 32px 비교`);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D 컨텍스트를 만들 수 없습니다.");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0d0f18";
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  drawIcon(ctx, name, 30, 30, 6.3, "#f9d77e");
  drawIcon(ctx, name, 108, 30, 32, "#f9d77e");

  const title = document.createElement("div");
  title.className = "icon-name";
  title.textContent = `${ICON_LABELS[name]} · ${name}`;

  const sizes = document.createElement("div");
  sizes.className = "icon-size";
  sizes.textContent = "6.3px                         32px";

  card.append(canvas, title, sizes);
  return card;
}

const iconGrid = requireElement<HTMLDivElement>("#icon-grid");
for (const name of ICON_NAMES) iconGrid.append(createIconCard(name));

const audioStatus = requireElement<HTMLParagraphElement>("#audio-status");

function prepareAudio(): void {
  unlockAudio();
  if (isMuted()) toggleMute();
}

function playOne(signal: BossSignal): void {
  prepareAudio();
  setBed(null);
  playBossSignal(signal);
  audioStatus.textContent = `${signal} 신호 재생`;
}

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-signal]")) {
  button.addEventListener("click", () => {
    const signal = button.dataset.signal;
    if (signal === "avoid" || signal === "gather" || signal === "vulnerable") playOne(signal);
  });
}

const sequenceButton = requireElement<HTMLButtonElement>("#play-sequence");
sequenceButton.addEventListener("click", () => {
  sequenceButton.disabled = true;
  prepareAudio();
  setBed("boss");
  audioStatus.textContent = "보스 BGM 준비 중 — 곧 붉은 → 청록 → 금빛 순서로 재생합니다.";

  const sequence: ReadonlyArray<{ signal: BossSignal; delayMs: number; label: string }> = [
    { signal: "avoid", delayMs: 1200, label: "1/3 붉은 예고" },
    { signal: "gather", delayMs: 2000, label: "2/3 청록 예고" },
    { signal: "vulnerable", delayMs: 3000, label: "3/3 금빛 취약" },
  ];

  for (const item of sequence) {
    window.setTimeout(() => {
      playBossSignal(item.signal);
      audioStatus.textContent = item.label;
    }, item.delayMs);
  }

  window.setTimeout(() => {
    setBed(null);
    sequenceButton.disabled = false;
    audioStatus.textContent = "연속 재생 완료";
  }, 4300);
});
