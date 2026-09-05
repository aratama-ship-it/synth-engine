import { readFile } from "node:fs/promises";

export async function importSource(relativeUrl) {
  const sourceUrl = new URL(relativeUrl, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const testableSource = source.replaceAll("import.meta.url", JSON.stringify(sourceUrl.href));
  return import(`data:text/javascript;base64,${Buffer.from(testableSource).toString("base64")}`);
}
