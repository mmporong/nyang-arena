# 사운드 — 설계, 프롬프트, 그리고 실제로 들어간 것

먼저 제약을 적고, 소리를 설계하고, 생성 프롬프트를 내고, 만들어진 것을
측정해서 넣는다. 제약을 모르고 만든 소리는 넣을 수가 없다.

**현재 상태 — BGM 4곡은 들어갔고, SFX 20종은 아직이다.**

| | 상태 |
|---|---|
| BGM 4곡 | **완료.** 생성 → 측정 → 마스터링 → `public/bgm/` → `src/game/audio.ts` |
| SFX 20종 | 미착수. 프롬프트만 있다(§4). 절차적 합성 시제품 8종은 검증됨 |

만들어진 곡을 어떻게 검수하고 무엇을 고쳤는지는 [§7](#7-실제로-만들어진-것)에 있다.

---

## 1. 제약 — 먼저 읽을 것

### 1-1. 외부 요청 0건

배포된 게임은 외부로 어떤 요청도 보내지 않는다(제출 조건). **오디오도 번들에
들어가야 한다.** CDN도, 스트리밍도 안 된다.

지금 번들이 **94 KB**다. 여기에 오디오를 얹으면 자릿수가 바뀐다.

> **처음에 적었던 예산표는 산수가 틀렸다.** "90초 루프를 64kbps 모노로 120 KB에"라고
> 썼는데, 90초 × 64kbps ÷ 8 = **720 KB**다. 120 KB에 넣으려면 10.7kbps여야 하고
> 그건 음악이 아니다. 아래는 실제로 인코딩해서 잰 값으로 다시 세운 것이다.

| | 예산 | 실제 | 근거 |
|---|---|---|---|
| BGM 4곡 | 500 KB | **452 KB** | 83초, OGG Vorbis q4 · 22.05kHz 모노 |
| SFX 20종 | 160 KB | 미정 | 절차적 합성이면 0 KB (§4-0) |
| **합계** | **660 KB** | **452 KB** | |

**전부 지연 로드한다.** 첫 화면은 지금처럼 게임 97 KB + 스프라이트만으로 뜨고,
음악은 첫 입력 뒤에 따라온다. 준비곡(154 KB)이 먼저 오고 나머지는 뒤에 온다.

### 1-1-1. 왜 22.05kHz인가

네 곡 다 **6kHz 위에 아무것도 없다** — 측정값으로 -39dBFS(준비·보스·타이틀)에서
-67dBFS(부검)다. 로파이 어쿠스틱이라 원래 그렇다. 있지도 않은 고역에 비트를 쓸
이유가 없으므로 9kHz에서 자르고 절반으로 내렸다. 용량이 그대로 절반이 된다.

### 1-1-2. 포맷 — Vorbis 본선, MP3 폴백

**MP3는 갭리스 루프가 안 된다.** 인코더가 앞뒤에 패딩을 붙여서 루프마다 짧은
정적이 낀다. 마디에 맞춰 자른 것이 무의미해진다.

| | 용량 | 갭리스 | 브라우저 |
|---|---|---|---|
| **OGG Vorbis q4** | 452 KB | 된다 | 크롬·파폭·엣지·사파리 17+ |
| MP3 VBR q3 | 602 KB | **안 된다** | 전부 |

Vorbis를 먼저 시도하고(`canPlayType`), 못 열면 MP3를 받는다. **브라우저당 한
쪽만 내려받는다** — 저장소에 둘 다 있을 뿐이다. MP3 경로에서는 루프 이음새가
살짝 어긋나지만, 소리가 아예 안 나는 것보다는 낫다.

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

생성 도구는 **Lyria**(Google, Gemini 경유)를 썼다. Suno·Udio도 후보였지만,
아래 프롬프트는 어느 모델에 넣어도 통하도록 **곡의 조건**만 적는다 — 특정 모델의
문법에 기대면 다음에 도구를 바꿀 때 프롬프트를 다시 써야 한다.
**프롬프트는 영어**로 준다(모델이 더 잘 받는다).
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

**아직 안 들어갔다.** 아래는 프롬프트고, 만드는 방법은 두 갈래다.

### 4-0. 파일로 만들 것인가, 브라우저에서 합성할 것인가

효과음은 대부분 짧은 과도음이라 **파형을 직접 만들 수 있다**(sfxr이 하는 일이다).
시제품으로 8종을 절차적으로 합성해 봤고, 검수 기준을 통과했다.

| | 파일로 번들 | **브라우저에서 실시간 합성** |
|---|---|---|
| 용량 | ~95 KB (20종) | **0 KB** (코드 ~3 KB) |
| 로딩 | 20개 요청 | 없음 |
| 반복 | 같은 파일이 계속 → 지겹다 | 피치·감쇠를 매번 흔들 수 있다 |
| 손질 | 파일 다시 굽기 | 상수 한 줄 |

평타는 한 판에 수백 번 난다. **재생마다 ±5% 흔드는 것이 공짜**인 쪽이 맞고,
"런타임 의존성 0개 · 외부 요청 0건"과도 결이 같다. 실시간 합성으로 간다.

시제품에서 신호 셋의 판정을 **코드에 박았다** — 사람이 표를 보고 판단하면
놓친다(실제로 첫 판에 놓쳤다. 붉은 4328Hz / 금빛 4324Hz로 밝기가 사실상 같은데
길이와 리듬만 보고 넘어갈 뻔했다). 두 소리는 **길이·밝기·어택 세 축 중 최소
둘**에서 갈려야 통과다. 한 축만 다르면 전투가 시끄러울 때 그 축이 묻힌다.

| 신호 | 길이 | 밝기 | 어택 |
|---|---|---|---|
| 붉은 (흩어져) | 0.30s | 1782Hz | 0ms |
| 청록 (모여) | 0.60s | 2466Hz | 246ms |
| 금빛 (때려) | 0.90s | 5745Hz | 3ms |

셋이 서로 두 축 이상에서 갈린다. 붉은 예고를 중역(거친 경고)으로 내리고 금빛을
고역(맑은 종)으로 올려 **대역을 나눠 갖게** 한 결과다.

아래 프롬프트는 생성 도구(ElevenLabs Sound Effects · AudioGen)로 갈 경우를
위해 남긴다. 실시간 합성으로 가더라도 **무엇을 만들 것인가의 명세**로 그대로
쓴다. 전부 **모노 · 0.2~1.5초**.

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
3. **BGM 전환은 크로스페이드 0.8초.** 준비 → 보스전은 같은 조(A#/B♭ — 요청은
   Am이었는데 둘이 같이 반음 올라왔다)라 그냥 겹쳐도 맞는다. 툭 끊으면 보스
   등장의 무게가 오히려 깎인다. 등파워 곡선을 쓴다 — 선형으로 겹치면 가운데서
   3dB 꺼져서 보스가 나오는 순간 음악이 주저앉는다
4. **음소거를 첫 화면에 둔다.** 브라우저 게임은 소리부터 끄는 사람이 많다.
   상태는 `localStorage`에 남긴다(네트워크 아님)
5. **소리는 게임 로직에 못 들어간다.** 헤드리스 하네스(`npm run sim`)가 같은
   `stepBattle`을 부르는데 거기엔 오디오가 없다. 재생은 **렌더 계층에서만** —
   `battle.ts`가 아니라 이벤트를 보고 `main.ts`나 렌더가 울린다.
   이 선을 넘으면 300런 시뮬이 안 돈다

---

## 6. 만들고 나서 확인할 것

- [x] 보스전 BGM 위에서 신호음이 묻히지 않나 (중역대 확인) — §7-2
- [x] 준비 → 보스전 전환이 튀지 않나 — §7-3
- [x] 번들 합계가 예산 안인가 — 452 KB / 500 KB
- [x] `npm run sim`이 그대로 도나 (오디오가 로직에 안 섞였는가) — 중앙값 12 유지
- [ ] 신호 셋을 눈 감고 구분할 수 있나 — SFX 미착수(시제품은 통과, §4-0)
- [ ] 열 마리가 동시에 때릴 때 소음이 되지 않나 — SFX 미착수

---

## 7. 실제로 만들어진 것

BGM 4곡을 §3의 프롬프트로 생성해서 받았다. **받은 대로는 못 쓴다** — 검수하고
고쳐서 넣었다. 여기 적는 것은 무엇을 쟀고 무엇이 어긋났는지다.

곡을 들을 수 없는 조건에서 검수했으므로, 판단은 전부 **§3에 미리 적어 둔
조건이 지켜졌는가**로만 했다. "좋은 곡인가"는 여기서 답하지 않는다.

### 7-1. 요청 대 실제

| | 요청 | 실제 | |
|---|---|---|---|
| 준비 | 72 BPM · 90초 | **71.8 BPM** · 30.8초 → 8마디 26.74초 루프 | 템포 일치 |
| 보스전 | 132 BPM · 60초 | **132.5 BPM** · 30.8초 → 12마디 21.74초 루프 | 템포 일치 |
| 타이틀 | 4초 원샷 | 30.8초로 옴 → **11.0~15.0초를 잘라 씀** | 길이 불일치, 편집으로 해결 |
| 부검 | 60 BPM · 타악 없음 | **60.1 BPM** · 어택 1.2/초(넷 중 최저) | 일치 |

보스곡 템포는 처음에 **87.6 BPM**으로 찍혀 요청과 다른 줄 알았다. 자기상관
1등만 봐서 생긴 오독이다 — 후보를 셋 뽑아 보니 132.5가 세 번째로 있었고
87.6 = 132 × 2/3, 즉 셋잇단 그루브의 주기였다. **1등만 믿으면 안 된다.**

### 7-2. 보스곡 중역 — 이 검수의 핵심

신호음 셋(붉은·청록·금빛)이 곡에 묻히면 소리를 넣은 의미가 없다.

| | 저역 <200 | 중저 200-800 | **중역 800-2k** | 고역 2k-6k |
|---|---|---|---|---|
| 준비 | -16.4 | -19.9 | -33.3 | -40.1 |
| **보스전** | -15.4 | -23.7 | **-30.8** | -34.7 |
| 타이틀 | -21.5 | -19.0 | -21.8 | -30.8 |
| 부검 | -26.8 | -18.6 | -23.2 | -49.3 |

보스곡 중역이 곡 전체(-14.6 dBFS)보다 **16.1 dB 아래**다. 신호음을 중역보다
6 dB 위(-24.8 dBFS)에 두어도 클리핑까지 24.8 dB가 남는다. **비었다.**

> 처음에는 대역 **비중(%)**으로 쟀는데 그건 틀린 질문이었다. 보스곡은 저역이
> 88%라 중역 비중이 자동으로 작아진다 — 중역을 비웠기 때문이 아니라 저역이
> 크기 때문이다. 묻히느냐 마느냐는 **절대 레벨**로만 답할 수 있다.

### 7-3. 조성 — 준비 ↔ 보스 전환

크로스페이드로 겹치는 곳은 여기 하나뿐이다(나머지는 순차 재생이라 조가 바뀌어도
장면 전환으로 들린다). **둘의 근음이 A#(B♭)로 같다.** 요청은 A minor였는데
모델이 반음 올렸지만 **둘이 같이 올라갔으므로** 필요한 조건은 지켜졌다.

실제로 겹쳐서 거칠기(임계대역 안에서 부딪히는 부분음 쌍)를 재 보니 같은 곡끼리
겹친 것보다 **1.7 dB 낮았다.** 부딪히지 않는다.

> 이 판정에도 한 번 헛짚었다. 처음 크로마 분석은 2048점 FFT를 썼는데 그러면
> 빈 하나가 21.5Hz — 110Hz 근처에서 **세 반음**이다. 이 곡들은 에너지의 70~88%가
> 200Hz 아래에 있어서, 조성을 판단할 재료가 대부분 해상도 없는 구간에 있었다.
> 32768점으로 다시 잡고 베이스 음역만 봐서야 답이 나왔다. 튜닝도 마찬가지로
> 준비곡이 +47c(반음의 절반 = 최대 모호점)로 찍혔다가 고해상도에서는 +1c였다.

### 7-4. 손본 것

1. **피크가 0dBFS에 붙어 있었다**(0.0 / -0.3 / -2.4 / -0.0). 그 위에 효과음을
   얹으면 바로 깨진다. 전부 **-20 dBFS RMS · 피크 -3 dBFS 이하**로 내렸다
   (부검곡만 -22 dBFS). 압축은 안 걸었다 — 로파이의 다이내믹을 뭉개면 배경에
   안 남고 앞으로 튀어나온다
2. **루프 지점을 마디에 맞춰 잘랐다.** 스펙트럼으로 "여기가 처음과 이어지는가"를
   보되 후보는 마디 격자에만 뒀다. 0.1초 어긋난 지점보다 마디에 맞는 지점이
   항상 낫다 — 이음새가 안 들려도 박자가 절뚝이면 티가 난다
3. **이음새에 0.25초 크로스페이드를 구워 넣었다.** 길이는 정확히 유지한다.
   검증: 두 바퀴 이어 붙였을 때 이음새의 최대 파형 변화가 곡 내부 99.9%p보다
   작다(준비 0.046 vs 0.095, 보스 0.017 vs 0.098)
4. **부검곡은 루프하지 않는다.** 끝 1초가 처음보다 25.6 dB 낮다 = 페이드아웃이다.
   억지로 루프를 만드는 것보다 한 번 듣고 조용해지는 편이 낫다 — 죽었으니까

### 7-5. 브라우저에서 확인한 것

`AudioContext`를 가로채 무엇이 언제 재생되는지 기록하고 실제 빌드를 조작했다.
캔버스 게임의 소리는 밖에서 안 보이므로, 화면을 찍는 것과 같은 이유로 계측한다.

```
OK  입력 전 무음                 AudioContext 0개, 재생 0건
OK  첫 입력에 음악 시작            26.74초 버퍼, loop=true, loopEnd=26.74
OK  준비곡이 마디 길이로 루프
OK  보스전에서 보스곡으로 갈아탐      loopEnd=21.74
OK  크로스페이드 0.8초가 걸림        페이드 3건 (들어옴 2 / 나감 1)
OK  죽으면 부검곡(원샷)            30.75초 버퍼, loop 없음
OK  외부 요청 0건                전부 동일 출처 · 오디오 4건
OK  음소거가 localStorage에 남음
OK  새로고침해도 기억
```

### 7-6. 타이틀 스팅이 첫 부팅에는 안 울린다

브라우저는 사용자 입력 전에 소리를 못 낸다. 그런데 "냥 아레나" 막은 게임을 켜는
**즉시** 뜬다. 그래서 첫 판에는 스팅이 없고, 죽고 다시 시작할 때부터 울린다.

시작 화면에 "탭해서 시작"을 두면 해결되지만 그건 **소리 하나 때문에 모든
플레이어에게 문턱을 하나 세우는** 것이다. 첫 판에 스팅이 없는 쪽을 택했다.
