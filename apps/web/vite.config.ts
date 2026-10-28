import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '../..', '');
  const target = `http://${env.HOST || '127.0.0.1'}:${env.PORT || '3000'}`;
  const https = command === 'serve' && env.WEB_HTTPS === 'true';
  return {
    plugins: [react(), ...(https ? [basicSsl()] : [])],
    server: {
      host: true,
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      proxy: {
        '/api': { target },
        '/socket.io': { target, ws: true },
      },
    },
  };
});
