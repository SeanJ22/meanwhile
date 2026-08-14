/** Registers the `@/` alias resolver for `node --test` (see test-alias-loader.mjs). */
import { register } from "node:module";

register("./test-alias-loader.mjs", import.meta.url);
