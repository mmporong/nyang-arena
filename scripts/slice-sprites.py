#!/usr/bin/env python3
"""캐릭터 시트를 개별 스프라이트 PNG로 슬라이싱한다.

원본: PKM/06_Ideas/assets/CatCharacterSheet.png (1374x4306, RGBA)
격자: 6열(Idle/Sleep/Wink/Move/Back/Run) x 20행(#01~#20)
셀:   x = 124 + 208*col, y = 144 + 208*row, 197x197

배경(셀 베이지 + 둥근 모서리 바깥의 페이지 흰색)은 테두리에서 flood fill로만
제거한다. 전역 색상 치환을 쓰면 크림색 고양이(#18)와 흰 고양이(#05·#14)의 몸통까지
지워진다. 고양이는 셀 테두리에 닿지 않으므로 flood fill이 몸통에 도달하지 않는다.

출력은 197x197 균일 셀을 유지한다. bbox로 타이트하게 자르면 스프라이트마다 크기가
달라져 앵커 오프셋을 따로 관리해야 하고, 포즈 전환 시 발 위치가 튄다.
"""
import os
import sys
from collections import deque
from pathlib import Path

from PIL import Image

# 원본 시트는 저장소 밖에 있다(용량 때문에 커밋하지 않는다). 기본 경로는 만든
# 기기의 위치이고, 다른 기기에서는 NYANG_SHEET로 알려 주면 된다.
#
#   NYANG_SHEET=/경로/CatCharacterSheet.png npm run slice
#
# 보통은 돌릴 일이 없다 — 잘라 낸 결과 120장이 public/sprites/에 커밋돼 있다.
SHEET = Path(os.environ.get("NYANG_SHEET") or Path.home() / "PKM/06_Ideas/assets/CatCharacterSheet.png")
OUT = Path(__file__).resolve().parent.parent / "public/sprites"

ORIGIN_X, ORIGIN_Y, PITCH, CELL = 124, 144, 208, 197
POSES = ["idle", "sleep", "wink", "move", "back", "run"]
ROWS = 20
# 셀 배경(베이지) + 페이지 배경(둥근 모서리 바깥) + 순백 여백
BGS = ((240, 228, 210), (255, 252, 245), (255, 255, 255))
TOL = 10


def near_bg(px):
    return any(all(abs(px[i] - bg[i]) <= TOL for i in range(3)) for bg in BGS)


def strip_background(cell):
    """테두리에서 시작하는 flood fill로 배경만 투명 처리."""
    w, h = cell.size
    px = cell.load()
    seen = [[False] * w for _ in range(h)]
    q = deque()

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y][x] and near_bg(px[x, y]):
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y][x] and near_bg(px[x, y]):
                seen[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and near_bg(px[nx, ny]):
                seen[ny][nx] = True
                q.append((nx, ny))
    return cell


def main():
    if not SHEET.exists():
        sys.exit(f"시트를 찾을 수 없음: {SHEET}")

    sheet = Image.open(SHEET).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)

    written = 0
    for row in range(ROWS):
        for col, pose in enumerate(POSES):
            box = (
                ORIGIN_X + PITCH * col,
                ORIGIN_Y + PITCH * row,
                ORIGIN_X + PITCH * col + CELL,
                ORIGIN_Y + PITCH * row + CELL,
            )
            cell = strip_background(sheet.crop(box))
            bbox = cell.getbbox()
            if bbox is None:
                print(f"  경고: 빈 셀 {row + 1:02d}_{pose}")
                continue
            # 남은 불투명 픽셀이 셀의 1% 미만이면 배경 제거가 몸통까지 먹은 것
            opaque = sum(1 for p in cell.getdata() if p[3] > 0)
            if opaque < CELL * CELL * 0.01:
                print(f"  경고: {row + 1:02d}_{pose} 불투명 픽셀 {opaque}개뿐")
            cell.save(OUT / f"{row + 1:02d}_{pose}.png")
            written += 1

    print(f"완료: {written}장 → {OUT} (각 {CELL}x{CELL})")


if __name__ == "__main__":
    main()
