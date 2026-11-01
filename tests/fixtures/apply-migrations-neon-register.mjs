import "../helpers/install-fixture-keys.ts";
import { register } from "node:module";

register("./apply-migrations-neon-loader.mjs", import.meta.url);
