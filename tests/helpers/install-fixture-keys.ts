/** Explicit test dependency: reflects the per-test credential fixtures as they change. */
import { installSavedValues } from "../../lib/core/keys-values.ts";
const values = new Proxy(new Map<string, string>(), {
  get(_target, property) {
    const current = new Map(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const value: unknown = Reflect.get(current, property, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});
installSavedValues({ values });
