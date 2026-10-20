// Where the renderer's development server listens. The port is FotoReady's fixed reservation, so
// the server must take exactly it (strictPort) and run-dev can tell an occupied port from a slow
// start. Plain ESM because both electron.vite.config.ts and the launcher helper import it.
export const DEV_HOST = "127.0.0.1";
export const DEV_PORT = 23339;
