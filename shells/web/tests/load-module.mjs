import { readFile } from "node:fs/promises";

export async function importSource(relativeUrl) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
