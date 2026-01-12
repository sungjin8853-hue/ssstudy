
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 하위 디렉토리 배포를 위해 상대 경로로 설정
  base: './', 
  define: {
    // process.env.API_KEY가 없는 경우 빈 문자열로 처리하여 빌드 에러 방지
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || '')
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});
