import { defineConfig } from '@mikro-orm/postgresql';
import { ormConfig } from './src/db/index';

export default defineConfig(ormConfig);
