import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 배포 시 루트 경로를 인식하도록 설정
  base: './', 
  define: {
    // 빌드 타임에 process.env.API_KEY를 실제 값으로 치환합니다.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
});
