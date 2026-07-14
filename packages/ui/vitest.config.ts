// Отдельный конфиг: vite.config.ts задаёт root src/web (фронтенд),
// а тесты живут в test/ на уровне пакета — vitest не должен наследовать root.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {} });
