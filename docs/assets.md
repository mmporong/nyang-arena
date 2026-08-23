# 에셋 조사 — 무엇을 갖고 있고, 무엇을 썼고, 왜 나머지는 안 썼나

외부 에셋 팩 두 개를 조사했지만 최종 빌드에서는 모두 제거했다. **왜 기각했고
무엇으로 대체했는지**를 남겨, 나중에 같은 팩을 다시 열어 보는 사람이 같은 조사와
라이선스 위험을 반복하지 않도록 한다.

한 줄 결론: **UI 아이콘 17종은 전부 Canvas 2D 자체 패스다.** 외부 아이콘 파일은
현재 소스와 배포본에 한 장도 없다.

---

## 1. 갖고 있는 것

### A. GUI Pro - Minimal Game Light (Layer Lab) — 유료 구매

- 스토어: <https://assetstore.unity.com/packages/2d/gui/gui-pro-minimal-game-light-355406>
- 로컬: `C:\Unity\NumLink\Assets\Layer Lab`
- 규모: **226 MB · PNG 3,049장 · 프리팹 713개**

| 갈래 | 내용 | 장수 |
|---|---|---|
| `Shared/Icons/PictoIcon` | **흰 실루엣 픽토그램** (64/128/256/512px) | 300 × 4크기 |
| `Shared/Icons/UniqueIcon` | 풀컬러 아이템(음식·물약·폭탄·건물) | 314 × 3크기 |
| `Shared/Icons/Weapon` | 풀컬러 무기 | 10 × 3크기 |
| `Shared/Icons/CharacterParts` | 캐릭터 부위 | 66 |
| `Shared/Icons/Chest` · `League` · `ShopItem` | 상자·등급·상점 아이템 | 109 |
| `Shared/Sprite_Common/Frame` | 프레임 9-slice 조각 | 188 |
| `Shared/Sprite_Common/Button` | 버튼 9-slice 조각 | 26 |
| `Shared/Sprite_Common/Label` · `Popup` · `Slider` · `Control` · `Flag` · `HUD` | UI 부품 | 104 |
| `Theme_Light/Sprites/HUD` | 풀컬러 HUD(젬·별·룰렛·보상 주머니) | 32 |
| `Theme_Light/Sprites/Title` · `Control` · `Frame` · `Popup` | 테마 스킨 | 77 |

**라이선스**: 유니티 에셋스토어 EULA(유료). 빌드된 결과물에 통합해 배포하는 것은
허용, 에셋 자체를 재사용 가능한 형태로 배포하는 것은 금지.
번들된 폰트 둘(Afacad Flux, LT Avocado)은 **SIL OFL**이라 자유 배포 가능하다.

### B. Addin's Weapon Icons - RPG Icon Pack (Addin) — 무료

- 스토어: <https://assetstore.unity.com/packages/2d/gui/icons/addin-s-free-weapon-icons-rpg-icon-pack-333936>
- 로컬: `C:\Unity\NumLink\Assets\Addin's Weapon Icons- RPG Icon Pack`
- 규모: **4.3 MB · PNG 978장** (개별 325종 × 16/32/64px + 시트 3장)
- 내용: 픽셀 무기 아이콘 — 검·도끼·망치·활·창·방패·지팡이 × 5등급(철/주황/은/금/청록)

**라이선스** (`License.txt` 원문):

```
YOU CAN:   Edit and use the asset in any commercial or non commercial project
           Credit the creator if you want to :)
YOU CAN'T: Redistribute or resale, even if modified.
```

---

## 2. 최종 채택 — Canvas 아이콘 17종

`src/game/icons.ts`가 생선 1종·직업 5종·유물 11종을 전부 단색 Canvas 패스로
그린다. 이미지 로더·틴트 캐시·`public/icons/`·아이콘 네트워크 요청은 없다.

| 쓰는 곳 | 아이콘 | 구분 실루엣 |
|---|---|---|
| 화폐 | 생선 | 몸통·꼬리·눈 |
| 직업 5종 | 전사·도적·궁수·마법사·소환사 | 방패·단검·활·모자·소환진 |
| 유물 11종 | 목걸이·발톱·눈·별지팡이·한 마리·무리·왕관·무지개 방울·거울·바구니·빈 방울 | 닫힘/열림·단일/복수·외곽/채움이 서로 다름 |

**왜 코드 패스인가.**

1. 호출부의 직업색·켜짐/꺼짐 색을 그대로 받아 **색상 계약이 한 곳**에 있다.
2. 기존 발바닥·왕관·생선 패스를 재사용해 UI 언어가 갈리지 않는다.
3. 파일 13개·34,365 bytes와 시작 시 이미지 요청 13건을 없앤다.
4. 유료 팩 원본을 공개 저장소에서 개별 다운로드하게 만드는 라이선스 위험이 없다.

**교체 이력.** 처음 들어온 13장은 Layer Lab 유료 팩과 SHA가 정확히 일치했지만,
공개 Git 저장소와 Pages raw URL에서 원본 PNG가 개별 다운로드됐다. Unity 표준 EULA는
에셋을 실질적인 자체 콘텐츠가 있는 Licensed Product에 embedded한 배포는 허용하지만,
그 밖의 배포 권리는 제한한다. 해석 위험을 제출 직전에 떠안을 이유가 없어 제거했다.
[Unity Asset Store EULA](https://unity.com/legal/as-terms)

소환 시스템과 함께 추가됐던 PNG 4장은 원본 팩·제작 기록과 파일 및 디코딩 픽셀
해시를 대조해도 출처를 입증할 수 없었다. 제출 권리 요건을 추측으로 채우지 않기 위해
파일을 제거하고, 같은 논리 아이콘을 외부 에셋이 아닌 Canvas 패스로 다시 그렸다.
`npm run asset:test`는 아이콘 PNG가 0장이고 Canvas 논리 목록이 정확히 17종인지,
스프라이트는 186장·197×197 RGBA인지 배포 전에 막는다.

---

## 3. 기각 — 그리고 이유

### 3-1. Button · Frame · Label · Slider · Control (Layer Lab, 350장)

**흰 9-slice 조각들이다.** 버튼 하나가 `Bg` + `InnerBorder` + `HighLight` +
`Shadow` + `Gradient` 다섯 장으로 나뉘어 있고, 유니티 UI가 이걸 겹쳐서 완성한다.

Canvas 2D에는 그 합성기가 없다. 직접 만들면 9-slice 분할 + 레이어 순서 + 색 지정을
전부 짜야 하는데, 지금 `theme.ts`의 `bevelPanel`·`roundRect`가 열 줄로 같은 그림을
낸다. **에셋을 쓰는 쪽이 코드가 더 든다.**

### 3-2. HUD · Title · Popup 풀컬러 (Layer Lab, 109장)

밝고 광택 있는 캐주얼 F2P 아트다(금색 별, 보라 보상 주머니, 룰렛). 이 게임은
어두운 따뜻한 갈색(`#17110E`~`#241A14`)에 납작한 픽셀이다. **색조도 질감도 정반대**라
한 화면에 놓으면 둘 중 하나가 이물질이 된다.

### 3-3. UniqueIcon · Weapon · Chest · League (Layer Lab, 500장 이상)

같은 이유. 검은 외곽선 + 하이라이트가 들어간 3D풍 아이템이다. 유물 아이콘 후보로
검토했지만 두 가지에서 걸렸다.

- 풀컬러라 **틴트가 안 된다.** 유물의 켜짐/꺼짐을 색으로 못 나타낸다
- 픽토그램(납작)과 섞으면 같은 줄에 두 가지 그림 언어가 선다

### 3-4. Addin 무기 아이콘 325종 (전부)

**픽셀 아트라 스타일은 오히려 더 잘 맞는다.** 32px 격자가 고양이 스프라이트와
같은 해상도다. 그런데도 안 쓴 이유는 셋이다.

1. **틴트가 안 된다.** 등급별로 색이 박혀 있다(철/주황/은/금/청록). 직업색
   네 가지(붉은·보라·주황·파랑)와 맞출 수 없어서, 쓰면 왼쪽 줄의 색 구분을 버려야 한다
2. **무기뿐이다.** 유물 여덟 중 목걸이·왕관·방울·무리는 무기 팩에 없다.
   절반만 아이콘이 붙으면 안 붙느니 못하다
3. 아이콘이 필요한 자리가 **판 밖(UI)**이다. UI는 이미 한글 시스템 폰트와
   납작한 도형으로 되어 있어 픽셀 격자가 오히려 겉돈다

기각이지 폐기가 아니다. **판 위에 무기를 그리게 되면**(예: 유물이 고양이에게
장비로 보이는 연출) 이 팩이 첫 후보다.

### 3-5. 번들 폰트 (Afacad Flux, LT Avocado)

OFL이라 배포에 제약이 없다. 그런데 **둘 다 라틴 전용**이고 이 게임의 글자는
거의 전부 한글이다. 숫자에만 쓰면 한 줄에 두 글꼴이 서는데, 그건 5×7 비트맵 숫자를
걷어내면서 방금 고친 문제다. 쓸 자리가 없다.

---

## 4. 라이선스 처리

- 현재 소스·빌드·Pages에는 Layer Lab·Addin 아이콘 파일이 0장이다
- UI 아이콘 17종은 `src/game/icons.ts`의 자체 Canvas 패스라 별도 에셋 재배포나
  출처 문제가 없다
- 과거 공개 Git 커밋에는 Layer Lab 13장이 남아 있다. 현재 이력은 재작성하지
  않았으므로, 저장소 이력까지 제거해야 한다면 구매 증빙·Provider 허락을 확인한 뒤
  별도의 파괴적 history purge를 결정해야 한다

---

## 4-2. 음악 (에셋 팩이 아님)

`public/bgm/`의 4곡은 팩에서 가져온 것이 아니라 **생성 AI로 만든 것**이다.
프롬프트를 이 저장소가 갖고 있으므로 출처가 완전히 추적된다.

| 파일 | 쓰임 | OGG | MP3 |
|---|---|---|---|
| `prepare` | 지도·상점·배치·일반 전투 (26.74초 루프) | 154 KB | 194 KB |
| `boss` | 보스전 (21.74초 루프) | 127 KB | 157 KB |
| `title` | 시작 막 (4초 원샷) | 27 KB | 29 KB |
| `outro` | 부검 (30.75초 원샷) | 144 KB | 222 KB |
| | | **452 KB** | 602 KB |

두 포맷을 다 두는 이유와 왜 22.05kHz 모노인지는
[`audio-prompts.md` §1-1](audio-prompts.md)에 있다. **브라우저당 한 쪽만
내려받는다.** 프롬프트는 같은 문서 §3, 받은 파일을 어떻게 검수하고 고쳤는지는 §7.

---

## 5. 다시 열어 볼 때

같은 팩을 또 뒤지게 되면 이 순서로 보면 빠르다.

1. `Shared/Icons/PictoIcon/128` — 300종. 이름으로 찾으면 대개 있다
   (`warrior` `archer` `dagger` `bow` `fish` `crown` `star` `paw` `necklace`
   `target` `user` `friend` `wand_star` `magic_ball` `skull` `map` `scroll` …)
2. 흰 실루엣이라 파일을 그냥 열면 하얗게만 보인다. **어두운 배경에 올려서** 봐야 한다
3. 나머지 갈래는 위 3절의 이유로 이 게임에는 안 맞는다. 게임의 톤이
   바뀌지 않는 한 결론도 안 바뀐다
