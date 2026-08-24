#!/usr/bin/env python3
"""색을 갈아 품종을 늘린다 — `npm run recolor`

**왜 이게 필요했나.** 원본 시트(`CatCharacterSheet.png`)에 고양이가 정확히
20마리 있고, 우리가 8 · 악몽이 8 · 보스가 4로 이미 다 썼다. 슬라이서의
`ROWS = 20`이 그 상한이고 21번째 행은 시트에 없다. 그래서 새 품종을 넣으려면
새 아트가 필요했는데, 유료 팩을 더 사는 대신 **있는 그림의 색을 갈기로 했다.**

**런타임 필터가 아니라 미리 굽는 이유.** `ctx.filter = "hue-rotate(...)"`는
채도가 있는 픽셀만 돌린다. 그런데 우리 고양이 여덟 중 절반이 검정·회색·
흰색이라(턱시도·까망이·하양이·줄줄이) 색상환을 아무리 돌려도 그대로다.
여기서는 밝기를 남기고 색상과 채도를 **덮어쓰므로** 회색 고양이도 색이 든다.
게다가 매 프레임 필터를 거는 비용도 없고, 결과를 눈으로 확인할 수 있다.

**무엇을 남기나.** 밝기의 **순서**만 남긴다. 줄무늬가 몸보다 어둡고 턱받이가
몸보다 밝다는 관계가 유지되므로 무늬가 그대로 읽힌다. 절대 밝기는 [LO, HI]로
눌러 넣는데, 그러지 않으면 순검정과 순백이 어떤 색상을 줘도 안 물들기
때문이다(자세한 것은 아래 상수 주석).

산출물은 `assets/sprites-src/`에 커밋된다. `npm run recolor`은 완료 뒤
Node atlas 생성기를 호출해 public 런타임 파일 두 장도 갱신한다.
"""

import colorsys
import pathlib
import os
import sys
import tempfile

from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "sprites-src"
POSES = ["idle", "sleep", "wink", "move", "back", "run"]

# 밝기를 눌러 넣을 범위.
#
# **이게 핵심이다.** 색상만 갈아서는 양 끝이 안 물든다 — 밝기 0은 어떤 색상을
# 줘도 검정이고 밝기 1은 흰색이다. 그런데 우리 고양이 팔레트는 색이 네댓 개뿐이고
# 그중 가장 넓은 면적이 하필 순검정(턱시도·까망이)이거나 순백(악몽 넷)이다.
# 범위를 [LO, HI]로 압축하면 검정은 짙은 색, 흰색은 옅은 색이 되고, 그 사이
# 순서는 그대로라 줄무늬·턱받이가 읽힌다.
#
# 외곽선도 같이 물든다. 원본에서 외곽선과 검은 털이 **똑같은 `000000`**이라
# 색만으로 갈라낼 수가 없었다 — 하나를 지키려면 다른 하나를 포기해야 하고,
# 몸이 안 물들면 색을 가는 의미가 없다. 짙게 물든 외곽선은 픽셀아트에서
# 흔한 표현이기도 하다.
LO, HI = 0.15, 0.88
#: 항목별로 범위를 좁히고 싶을 때. 바탕이 순백이면 기본 범위로는 결과가 HI
#: 근처에 몰려 색이 흐려진다 — 남색을 흰 고양이에서 뽑으니 연회색으로 읽혔다.
#: 짙은 색을 원하면 HI를 낮춘다.
# 무채색 픽셀에 넣어 줄 최소 채도. 이게 없으면 회색 고양이가 그대로 회색이다.
MIN_SAT = 0.45

#: 새 품종 = (새 id, 바탕 id, 색상 0..1, 이름[, 밝기 하한, 상한])
#:
#: 이름은 `src/game/breeds.ts`의 것과 같아야 한다 — 여기 이름표는 사람이
#: 읽는 용도지만, 어긋나면 어느 파일이 새 품종을 만든 것인지 추적이 끊긴다.
#:
#: 색상은 **지금 명단에 없는 것**으로 골랐다. 검정·회색·주황·삼색·크림·흰색이
#: 이미 있으므로 청록·보라·연두·분홍이면 난전에서 헷갈리지 않는다.
#:
#: 바탕은 우리 고양이와 악몽을 갈라서 쓴다. 같은 바탕에 색만 다르면 진영이
#: 색으로만 갈리는데, 발밑 고리도 색이라 셋이 겹치면 서로를 가린다.
RECOLORS = [
    # 우리 고양이 — 바탕은 아군 스프라이트(1~8)
    (21, 1, 0.50, "물결이 (청록 턱시도)"),
    (22, 4, 0.75, "보라돌이 (보라 줄무늬)"),
    (23, 8, 0.28, "풀잎이 (연두 범무늬)"),
    (24, 2, 0.92, "복숭이 (분홍 줄무늬)"),
    # 소환사 — 다섯 번째 직업. 바탕은 아직 안 쓴 아군 스프라이트를 고른다
    # 바탕은 **밝은 것**만 고른다. 까망이(3)로 남색을 만들어 보니 거의 검정이라
    # 기존 검은 고양이와 안 갈렸다 — 밝기를 [LO,HI]로 눌러도 원본이 순검정이면
    # 결과가 LO 근처에 깔린다. 무늬가 읽히려면 원본에 밝기 폭이 있어야 한다.
    (29, 5, 0.62, "부르미 (남색)", 0.08, 0.60),
    (30, 6, 0.13, "깃들이 (노랑)"),
    (31, 7, 0.99, "메아리 (진홍)"),
    # 악몽 — 바탕은 악몽 스프라이트(13~20).
    # **소환사는 없다** — 적이 소환하면 웨이브 성격이 지워진다(breeds.ts 참고)
    (25, 20, 0.50, "진땀이 (청록)"),
    (26, 15, 0.75, "멍울이 (보라)"),
    (27, 13, 0.28, "곰팡이 (연두)"),
    (28, 18, 0.92, "열꽃이 (분홍)"),
]


def recolor_pixel(
    r: int, g: int, b: int, hue: float, lo: float, hi: float
) -> tuple[int, int, int]:
    """밝기 순서는 남기고 색상·채도를 갈아끼운다."""
    _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return tuple(
        round(c * 255) for c in colorsys.hls_to_rgb(hue, lo + l * (hi - lo), max(s, MIN_SAT))
    )


def recolor(src: Image.Image, hue: float, lo: float = LO, hi: float = HI) -> Image.Image:
    out = src.convert("RGBA").copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            px[x, y] = (*recolor_pixel(r, g, b, hue, lo, hi), a)
    return out


def main() -> int:
    if not OUT.is_dir():
        print(f"스프라이트 폴더가 없다: {OUT}", file=sys.stderr)
        return 1

    expected = {f"{entry[0]:02d}_{pose}.png" for entry in RECOLORS for pose in POSES}
    with tempfile.TemporaryDirectory(prefix="nyang-recolor-", dir=OUT.parent) as temporary:
        staging = pathlib.Path(temporary)
        written = 0
        for entry in RECOLORS:
            new_id, base_id, hue, label = entry[:4]
            lo, hi = (entry[4], entry[5]) if len(entry) > 5 else (LO, HI)
            for pose in POSES:
                src_path = OUT / f"{base_id:02d}_{pose}.png"
                if not src_path.is_file():
                    raise RuntimeError(f"리컬러 원본 누락: {src_path.name}")
                with Image.open(src_path) as src:
                    if src.size != (197, 197) or src.mode != "RGBA":
                        raise RuntimeError(f"리컬러 원본 규격 위반: {src_path.name} {src.size}/{src.mode}")
                    recolor(src, hue, lo, hi).save(staging / f"{new_id:02d}_{pose}.png")
                written += 1
            print(f"  {new_id:02d}  ← {base_id:02d}  색상 {hue:.2f}  {label}")

        actual = {path.name for path in staging.glob("*.png")}
        if written != 66 or actual != expected:
            raise RuntimeError(f"리컬러 완성도 위반: written={written}, files={len(actual)}")
        for name in sorted(expected):
            with Image.open(staging / name) as candidate:
                if candidate.size != (197, 197) or candidate.mode != "RGBA":
                    raise RuntimeError(f"리컬러 출력 규격 위반: {name} {candidate.size}/{candidate.mode}")

        # 66개가 모두 검증된 뒤에만 파생 ID를 교체한다.
        for name in sorted(expected):
            os.replace(staging / name, OUT / name)

    print(f"완료: {written}장 → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
