// Dump the key structure of a JSON file (paths + value types) for API/model comparison.
// usage: node scripts\ios-json-shape.mjs <file.json>
import { readFileSync } from "node:fs";

const file = process.argv[2];
const data = JSON.parse(readFileSync(file, "utf8"));

const out = [];
function walk(value, path, depth) {
  if (depth > 7) return;
  if (Array.isArray(value)) {
    out.push(`${path} : array[${value.length}]`);
    if (value.length > 0) walk(value[0], `${path}[0]`, depth + 1);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walk(value[key], path ? `${path}.${key}` : key, depth + 1);
  } else if (value === null) {
    out.push(`${path} : null`);
  } else if (typeof value === "string") {
    out.push(`${path} : string "${value.slice(0, 44)}"`);
  } else {
    out.push(`${path} : ${typeof value} = ${value}`);
  }
}
walk(data, "", 0);
console.log(out.join("\n"));
