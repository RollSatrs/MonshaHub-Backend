/**
 * Экспорт OpenAPI-контракта в openapi.json (без запуска HTTP-сервера и без БД).
 * Frontend генерирует из него типы: `pnpm api:types` в репозитории frontend.
 */
import './openapi-env';
import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { buildSwaggerDocument } from '../src/app.setup';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const document = buildSwaggerDocument(app);
  const out = join(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  await app.close();
  console.log(`OpenAPI записан в ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
