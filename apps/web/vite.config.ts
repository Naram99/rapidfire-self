import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const target = `http://${env.HOST || '127.0.0.1'}:${env.PORT || '3000'}`;
  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': { target },
        '/socket.io': { target, ws: true },
      },
    },
  };
});
