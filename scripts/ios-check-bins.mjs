// 检查 histogram 分箱字段：打印每个 fields[i] 的类型与 bins 是否含 ratio
// usage: node scripts\ios-check-bins.mjs <file.json>
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fields = data.fields ?? [];
for (const field of fields) {
  const histograms = [];
  const visit = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.bins)) {
      histograms.push({ path, sample: node.bins[0] ?? null, keys: node.bins[0] ? Object.keys(node.bins[0]) : [] });
    }
    for (const key of Object.keys(node)) {
      if (key === "bins") continue;
      if (typeof node[key] === "object") visit(node[key], path ? `${path}.${key}` : key);
    }
  };
  visit(field, "");
  console.log(`field ${field.key} (${field.type}) filled=${field.filled}`);
  for (const h of histograms) {
    console.log(`   hist ${h.path || "(root)"}: keys=[${h.keys.join(",")}] sample=${JSON.stringify(h.sample)}`);
  }
}
