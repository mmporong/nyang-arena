#!/usr/bin/env bash
# Unix 호환 진입점. 실제 오케스트레이션과 런타임 고정은 Node가 담당한다.
exec npm run --silent measure:all
