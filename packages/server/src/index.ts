/**
 * Arranque del servidor de LAN.
 *
 *   npm run dev:server            # escucha en 0.0.0.0:8787
 *   PORT=9000 npm run dev:server
 *   ALLOWED_ORIGINS=https://ejemplo.com npm run dev:server
 *
 * Si `packages/client/dist` existe, tambien lo sirve, asi que una partida en la red local
 * se levanta con un unico comando.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);

const running = await startServer({ port: PORT, allowedOrigins });
console.log(`Chess Minesweeper — servidor en http://0.0.0.0:${running.port}`);
if (!existsSync(CLIENT_DIST)) {
  console.log('Sin cliente compilado: ejecuta `npm run build` para servirlo desde aqui.');
}
