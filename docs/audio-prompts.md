# 사운드 — 생성 프롬프트와 설계

이 게임에는 **소리가 하나도 없다.** 오디오 코드가 0줄이다. 그래서 이 문서는
"어떤 소리를 더할까"가 아니라 **소리를 처음부터 설계하는** 문서다.

먼저 제약을 적고, 그다음 소리 목록과 생성 프롬프트를 낸다. 제약을 모르고 만든
소리는 넣을 수가 없다.

---

## 1. 제약 — 먼저 읽을 것

### 1-1. 외부 요청 0건

배포된 게임은 외부로 어떤 요청도 보내지 않는다(제출 조건). **오디오도 번들에
들어가야 한다.** CDN도, 스트리밍도 안 된다.

지금 번들이 **94 KB**다. 여기에 오디오를 얹으면 자릿수가 바뀐다. 예산을 먼저 정한다.

| | 예산 | 근거 |
|---|---|---|
| BGM 4곡 | **각 120 KB 이하** (합 480 KB) | 60~90초 루프를 OGG Vorbis ~64kbps 모노로 |
| SFX 20종 | **각 8 KB 이하** (합 160 KB) | 0.2~1.5초, OGG ~48kbps 모노 |
| **합계** | **640 KB 이하** | 게임(94 KB) + 스프라이트(120장)와 같은 급 |

포맷은 **OGG Vorbis**. 사파리 구버전까지 보려면 m4a 폴백이 필요하지만, 그건
용량이 두 배가 되므로 **BGM만** 이중으로 두고 SFX는 OGG 하나로 간다.

### 1-2. 자동재생이 막힌다

브라우저는 사용자 입력 전에는 소리를 못 낸다. **첫 탭·첫 키 입력에서 오디오
컨텍스트를 연다.** 이 게임은 시작 화면이 지도라 첫 입력(길 고르기)이 반드시
있으므로 자연스럽게 걸린다.

### 1-3. 소리는 **세 번째 채널**이다

보스전 신호 셋은 이미 **색**(붉은/청록/금빛)과 **형태**(사선 해칭/동심원/채워진
고리)로 갈린다. 소리는 그 위에 얹는 세 번째 구분이다.

> **그러므로 세 신호음은 서로 확실히 달라야 한다.** 음높이만 다른 세 개는
> 안 된다 — 음색과 리듬이 갈려야 0.5초 안에 손이 반응한다.

### 1-4. 전투가 짧다

일반 전투는 **3~4초**, 보스전은 **18~33초**다(측정값). 그래서:

- 일반 전투 전용 BGM은 **만들지 않는다.** 3초 곡은 곡이 아니고, 매번 곡이
  바뀌면 판이 끊긴다. 준비 BGM을 그대로 흘린다
- 보스전만 BGM을 갈아탄다. 여기가 판이 끝나는 이유의 92%다

---

## 2. 톤

한 줄: **"한밤의 고양이 다방 결투장."**

- 팔레트가 따뜻한 갈색·테라코타에 잉크빛 배경이다. 소리도 **따뜻하고 낮게**
- 픽셀 아트지만 **칩튠은 피한다.** 8비트로 가면 귀엽기만 하고 레이드의 무게가 안 실린다
- 대신 **로파이 + 어쿠스틱**: 업라이트 피아노, 나일론 기타, 브러시 드럼, 콘트라베이스.
  거기에 보스전만 신스 베이스와 타악을 더한다
- 고양이 울음은 **쓰지 않는다.** 한 판에 수십 번 나갈 소리라 두 번째 판부터 거슬린다.
  고양이다움은 스프라이트가 이미 충분히 낸다

---

## 3. BGM 4곡

생성 도구: Suno · Udio · Lyria 등. **프롬프트는 영어**로 준다(모델이 더 잘 받는다).
길이·루프는 생성 후 편집에서 맞춘다.

### 3-1. 준비 (지도 · 상점 · 배치) — 가장 오래 듣는 곡

판 시간의 절반 이상이 이 곡이다. **눈에 안 띄어야 한다.** 멜로디가 강하면
열 번째 판에서 끈다.

```
Cozy late-night lo-fi jazz loop for a pixel-art cat cafe.
Warm upright piano with felt dampers, brushed snare, soft upright bass walking slowly,
faint vinyl crackle. Minor 7th and 9th chords, unhurried. No lead melody — just a
gentle chord bed that stays in the background. Tempo 72 BPM. Key A minor.
Seamless loop, 90 seconds. Mono-friendly mix, no wide stereo effects.
Mood: quiet, warm, slightly melancholy, safe.
```

- **길이** 90초 루프 · **BPM** 72 · **키** Am
- **핵심**: 리드 멜로디 없음. 화성 침대만
- 지도·상점·배치가 같은 곡이다. 국면이 바뀌어도 안 끊긴다

### 3-2. 보스전 — 이 게임의 심장

전투 시간의 75%, 판이 끝나는 이유의 92%가 여기다. **긴장이 올라가되 신호음을
가리면 안 된다** — 중역대를 비워 둬야 예고음이 뚫고 나온다.

```
Tense boss-fight loop for a pixel-art auto-battler raid.
Driving low tom pattern and taiko-like hits, deep synth bass pulse on the root,
sparse detuned piano stabs, distant strings swell. Dark and heavy but not chaotic.
Leave the mid frequencies (800Hz-2kHz) open and uncluttered.
Tempo 132 BPM. Key A minor, same tonal center as the calm theme so the switch
feels like the same night getting dangerous.
Seamless loop, 60 seconds. Build tension without resolving.
Mood: a big animal woke up.
```

- **길이** 60초 루프 · **BPM** 132 · **키** Am(준비곡과 같은 조 — 전환이 튀지 않는다)
- **핵심**: 800Hz~2kHz를 비워 둔다. 신호음이 그 대역을 쓴다
- 해결(resolve)하지 않는다. 보스가 죽을 때까지 계속 조여야 한다

### 3-3. 타이틀 / 시작 막 — 4초

게임을 켜면 "냥 아레나 · 고양이 오토배틀러인데, 보스전은 레이드다" 막이 뜬다.

```
Four-second musical sting for a game title card.
Single warm piano arpeggio rising, one soft cymbal swell, one low bass note landing.
Analog tape warmth, vinyl noise floor. Ends clean with no tail.
Key A minor. No loop — one-shot.
Mood: a door opening into a warm room at night.
```

- **길이** 4초 원샷 · 루프 없음
- 준비 BGM과 **같은 조**로 끝나야 막이 걷힐 때 이어진다

### 3-4. 부검 (게임오버) — 조용한 정리

죽으면 무엇에 막혔는지, 예고를 몇 번 피했는지를 보여준다. **패배를 벌주지 않는다.**

```
Quiet reflective outro loop, 30 seconds.
Solo felt piano, very sparse, long pauses between phrases. One sustained low cello note
underneath. Vinyl crackle. No percussion at all.
Tempo 60 BPM. Key A minor resolving to A major at the very end.
Mood: the fight is over, someone is sitting down. Gentle, not sad.
```

- **길이** 30초 루프 · **BPM** 60
- **끝에서 장조로 푼다** — "한 판 더" 감각은 좌절이 아니라 정리에서 나온다

---

## 4. SFX 20종

생성 도구: ElevenLabs Sound Effects · AudioGen 등. 전부 **모노 · 0.2~1.5초**.

### 4-1. 보스 신호 셋 — 가장 중요

세 개가 **음색부터 갈려야** 한다. 음높이만 다르면 못 갈린다.

| 소리 | 프롬프트 | 길이 | 갈리는 축 |
|---|---|---|---|
| **붉은 예고** (흩어져) | `Sharp warning chirp, two fast rising blips, dry and percussive, like a metal ping struck twice. Bright attack, no reverb tail. Urgent.` | 0.3s | **짧고 두 번** |
| **청록 예고** (모여) | `Low sustained hum swelling upward, soft synth pad with a slow attack, like an inhale. Warm and round, no transient.` | 0.6s | **길고 한 번, 부드러움** |
| **금빛 취약 창** (때려) | `Bright bell shimmer, single struck glass chime with a long sparkling decay, ascending overtones. Rewarding, not alarming.` | 0.9s | **맑고 길게 반짝임** |

> 셋을 나란히 들어 보고 **눈을 감은 채 구분되는지** 확인할 것. 안 되면 다시 만든다.
> 이 셋이 안 갈리면 소리를 넣은 의미가 없다.

### 4-2. 전투

| 소리 | 프롬프트 | 길이 |
|---|---|---|
| 근접 평타 | `Short soft thud, cloth-wrapped mallet hitting a padded surface. Muffled, low, no metallic ring.` | 0.15s |
| 원거리 평타 | `Quick light whoosh with a soft tick at the end, small object cutting air and landing.` | 0.2s |
| 피격 | `Dull muffled impact on soft fur, low frequency thump with a tiny high scuff.` | 0.15s |
| 치명타 | `Sharper version of a padded impact with a bright metallic overtone layered on top. Satisfying crunch.` | 0.25s |
| 스킬 발동 | `Warm magical shimmer rising quickly, soft bell cluster with a short whoosh. Bright but not harsh.` | 0.4s |
| 회피 성공 | `Quick airy swish, fabric moving fast, with a soft landing tap.` | 0.25s |
| 모임 성공 | `Soft gathering whoosh inward, several light footsteps converging, ending in a gentle low thump.` | 0.5s |
| 약점 공격 타격 | `Punchy impact with a bright bell accent, layered crunch and chime. Each hit should feel like scoring.` | 0.2s |
| 콤보 상승 | `Very short ascending blip, single tone stepping up a semitone. Tiny and clean.` | 0.1s |
| 고양이 쓰러짐 | `Soft descending sigh, a light object settling onto cloth. Gentle, not gruesome.` | 0.4s |

> **콤보 상승**은 재생할 때마다 피치를 반음씩 올린다(`playbackRate`). 파일은 하나면 된다 —
> 12단계를 다 만들면 용량이 12배가 되는데 코드 한 줄이면 같은 결과가 나온다.

### 4-3. 보스

| 소리 | 프롬프트 | 길이 |
|---|---|---|
| 보스 등장 | `Deep resonant impact followed by a low rumbling swell, large creature landing. Dark and heavy, with a slight metallic edge.` | 1.5s |
| 문턱 돌파 | `Low cracking sound with a short descending groan, something structural giving way.` | 0.6s |
| 예고 폭발 | `Muffled wide impact, low boom with a dusty tail, felt more than heard.` | 0.7s |
| 보스 격파 | `Heavy collapse with a long low decay, then one clear bright bell. Release of tension.` | 1.5s |

### 4-4. UI

| 소리 | 프롬프트 | 길이 |
|---|---|---|
| 카드 구매 | `Soft paper flip with a small warm coin clink at the end. Satisfying, understated.` | 0.3s |
| 다시 뽑기 | `Quick riffle of cards being shuffled, short and dry.` | 0.4s |
| 생선 획득 | `Light watery plink, a small bright drop with a short bubble tail.` | 0.25s |
| 고양이 집기 | `Very short soft pick-up tick, fingertip on felt.` | 0.08s |
| 고양이 놓기 | `Soft settle thump on cloth, slightly lower than the pick-up sound.` | 0.12s |
| 버튼 누름 | `Small warm wooden click, dry and rounded.` | 0.1s |
| 길 고르기 | `Soft paper unfold with a single low woodblock tap.` | 0.3s |

---

## 5. 붙일 때 지켜야 할 것

이건 소리를 만든 다음의 이야기지만, 여기 적어 둬야 만들 때 반영된다.

1. **평타 소리는 겹친다.** 고양이 열 마리가 동시에 때리면 초당 열 번 넘게 난다.
   같은 소리를 그대로 쌓으면 소음이 된다 — **20ms 안에 같은 소리가 또 오면
   버리고**, 재생마다 피치를 ±5% 흔든다
2. **신호음은 절대 안 버린다.** 위 규칙에서 보스 신호 셋은 예외다. 놓치면
   플레이어가 반응할 근거가 사라진다
3. **BGM 전환은 크로스페이드 0.8초.** 준비 → 보스전은 같은 조(Am)라 그냥 겹쳐도
   맞는다. 툭 끊으면 보스 등장의 무게가 오히려 깎인다
4. **음소거를 첫 화면에 둔다.** 브라우저 게임은 소리부터 끄는 사람이 많다.
   상태는 `localStorage`에 남긴다(네트워크 아님)
5. **소리는 게임 로직에 못 들어간다.** 헤드리스 하네스(`npm run sim`)가 같은
   `stepBattle`을 부르는데 거기엔 오디오가 없다. 재생은 **렌더 계층에서만** —
   `battle.ts`가 아니라 이벤트를 보고 `main.ts`나 렌더가 울린다.
   이 선을 넘으면 300런 시뮬이 안 돈다

---

## 6. 만들고 나서 확인할 것

- [ ] 신호 셋을 눈 감고 구분할 수 있나
- [ ] 보스전 BGM 위에서 신호음이 묻히지 않나 (중역대 확인)
- [ ] 준비 → 보스전 전환이 튀지 않나
- [ ] 열 마리가 동시에 때릴 때 소음이 되지 않나
- [ ] 번들 합계가 640 KB 예산 안인가
- [ ] `npm run sim`이 그대로 도나 (오디오가 로직에 안 섞였는가)
