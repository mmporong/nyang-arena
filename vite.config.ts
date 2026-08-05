import { defineConfig } from "vite";

// GitHub Pages는 https://<user>.github.io/<repo>/ 아래에 배포되므로 base가 필요하다.
// 로컬 dev에서는 "/"여야 하므로 빌드 시에만 저장소 경로를 붙인다.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/nyang-arena/" : "/",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
}));
