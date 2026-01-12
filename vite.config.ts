
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 배포 시 저장소 이름을 base에 넣으세요 (예: '/your-repo-name/')
  // 여기서는 루트 배포를 가정합니다.
  base: './', 
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
});
