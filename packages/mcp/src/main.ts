import { startServer } from './server.js';

startServer().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
